import { toast, confirmDialog, formDialog } from '../../core/ui.js';
import { amISuperAdmin } from '../inventory/inventory.service.js';
import {
  getShiftSettings,
  upsertShiftSettings,
  listOutletShifts,
  upsertOutletShift,
  deleteOutletShift,
  setOutletShiftEnabled,
  listSchedules,
  listOutletStaff,
  setSchedule,
  clearSchedule,
  weekRange,
  addDays,
  todayWIB,
  shiftCrossesMidnight,
  resolveAutoOff,
  holidayMapOf,
  kelompokkanPerDivisi
} from './shift.service.js';
import { getHolidayPolicy, listHolidays } from '../attendance/nbm.service.js';
import { listMyOutlets } from '../../core/my-outlets.js';

const TABS = [
  { key: 'schedule', label: 'Jadwal' },
  { key: 'hours', label: 'Jam Shift' },
  { key: 'settings', label: 'Pengaturan' }
];

export async function renderShiftAdminPage(container, { businessUnitId }) {
  container.innerHTML = `
    <h1>Shift</h1>
    <div class="tab-bar">
      ${TABS.map((t, i) => `<button class="tab-btn ${i === 0 ? 'active' : ''}" data-tab="${t.key}">${t.label}</button>`).join('')}
    </div>
    <div id="shift-content"></div>
  `;
  const content = container.querySelector('#shift-content');
  const outlets = await listMyOutlets(businessUnitId).catch(() => []);

  async function showTab(key) {
    container.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === key));
    if (key === 'schedule') await renderScheduleTab(content, businessUnitId, outlets);
    if (key === 'hours') await renderHoursTab(content, businessUnitId, outlets);
    if (key === 'settings') await renderSettingsTab(content, businessUnitId, outlets);
  }
  container.querySelectorAll('.tab-btn').forEach((btn) => btn.addEventListener('click', () => showTab(btn.dataset.tab)));
  await showTab('schedule');
}

// ---- Tab: Jadwal mingguan (diedit langsung di tabel) ----

async function renderScheduleTab(content, businessUnitId, outlets) {
  const enabled = outlets.filter((o) => o.shift_enabled);
  if (!enabled.length) {
    content.innerHTML = `<p style="color:var(--color-text-muted)">Belum ada outlet yang mengaktifkan modul Shift. Aktifkan dulu di tab <strong>Pengaturan</strong> (khusus Super Admin).</p>`;
    return;
  }
  const state = { outletId: enabled[0].id, anchor: todayWIB() };

  content.innerHTML = `
    <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end;margin-bottom:10px">
      <div class="field" style="margin:0;max-width:240px"><label>Outlet</label>
        <select id="sc-outlet">${enabled.map((o) => `<option value="${o.id}">${esc(o.name)}</option>`).join('')}</select>
      </div>
      <div class="field" style="margin:0;max-width:180px"><label>Minggu (tanggal acuan)</label>
        <input type="date" id="sc-date" value="${state.anchor}" />
      </div>
      <button id="sc-prev">← Minggu lalu</button>
      <button id="sc-next">Minggu depan →</button>
    </div>
    <div id="sc-grid"></div>
  `;

  const grid = content.querySelector('#sc-grid');
  const outletSel = content.querySelector('#sc-outlet');
  const dateInput = content.querySelector('#sc-date');

  outletSel.addEventListener('change', () => {
    state.outletId = outletSel.value;
    draw();
  });
  dateInput.addEventListener('change', () => {
    state.anchor = dateInput.value || todayWIB();
    draw();
  });
  content.querySelector('#sc-prev').addEventListener('click', () => {
    state.anchor = addDays(state.anchor, -7);
    dateInput.value = state.anchor;
    draw();
  });
  content.querySelector('#sc-next').addEventListener('click', () => {
    state.anchor = addDays(state.anchor, 7);
    dateInput.value = state.anchor;
    draw();
  });

  async function draw() {
    grid.innerHTML = `<p>Memuat jadwal...</p>`;
    const wk = weekRange(state.anchor);
    let staff, shifts, schedules, policy, holidays;
    try {
      [staff, shifts, schedules, policy, holidays] = await Promise.all([
        // BUKAN listBuStaff(): policy `membership_scopes_select_admin` memakai
        // is_bu_admin(), yang TIDAK mencakup outlet_admin. Admin outlet karena
        // itu hanya bisa membaca baris scope-nya SENDIRI, dan tabel jadwalnya
        // cuma berisi satu nama — padahal RLS `shift_schedules_modify` memakai
        // is_admin_of_outlet() dan memang mengizinkan dia menjadwalkan seluruh
        // stafnya. Izinnya benar; yang salah cara UI mengambil daftar namanya.
        //
        // RPC ini juga membuat daftarnya sesuai OUTLET YANG DIPILIH, bukan
        // seluruh BU — admin outlet Serpong tidak perlu melihat staf Gading.
        // includeInactive: staff yang sudah keluar TAPI masih punya jadwal harus
        // tetap terlihat di sini, supaya jadwalnya bisa dibatalkan. Kalau
        // barisnya disembunyikan padahal jadwalnya ada, tidak akan pernah ada
        // yang tahu jadwal itu masih menggantung. Yang tanpa jadwal disaring
        // beberapa baris di bawah.
        listOutletStaff(state.outletId, { includeInactive: true }),
        listOutletShifts(state.outletId),
        listSchedules({ outletId: state.outletId, from: wk.from, to: wk.to }),
        getHolidayPolicy(businessUnitId, state.outletId).catch(() => ({ holiday_policy: 'operational', weekly_off_days: [] })),
        listHolidays({ businessUnitId, outletId: state.outletId }).catch(() => [])
      ]);
    } catch (error) {
      grid.innerHTML = `<p class="error-text">${error.message ?? error}</p>`;
      return;
    }
    const holidayMap = holidayMapOf(holidays);
    const autoOff = new Map(wk.days.map((d) => [d, resolveAutoOff(d, policy, holidayMap)]));
    const adaAutoOff = [...autoOff.values()].some((a) => a.off);
    const activeShifts = shifts.filter((s) => s.is_active);
    if (!activeShifts.length) {
      grid.innerHTML = `<p style="color:var(--color-text-muted)">Outlet ini belum punya jam shift. Atur dulu di tab <strong>Jam Shift</strong>.</p>`;
      return;
    }
    const map = new Map(); // `${user}|${date}` -> row
    for (const s of schedules) map.set(`${s.user_id}|${s.work_date}`, s);

    // Staff nonaktif disembunyikan — kecuali dia sudah punya jadwal minggu ini.
    // Menyembunyikan baris yang PUNYA data berarti jadwalnya jadi tidak bisa
    // dilihat maupun dibatalkan, dan admin tidak akan pernah tahu itu ada.
    const adaJadwal = new Set(schedules.map((s) => s.user_id));
    staff = staff.filter((s) => s.is_active !== false || adaJadwal.has(s.user_id));

    // Dikelompokkan per divisi, sama seperti Staff App. Yang belum berdivisi
    // tidak muncul di grid — TAPI kalau dia sudah terlanjur punya jadwal, dia
    // tetap ditampilkan: menyembunyikan baris yang punya data berarti jadwalnya
    // tidak bisa dilihat maupun dibatalkan, dan tidak ada yang akan tahu.
    const yatim = staff.filter((s) => !s.division_id && adaJadwal.has(s.user_id));
    const { baris, tanpaDivisi } = kelompokkanPerDivisi(staff);
    if (yatim.length) {
      baris.push({ jenis: 'divisi', nama: 'Tanpa divisi (sudah terjadwal)' });
      for (const y of yatim) baris.push({ jenis: 'staff', ...y });
    }
    const belumDiatur = tanpaDivisi.filter((s) => !adaJadwal.has(s.user_id));

    const opts = (sel) =>
      `<option value=""${!sel ? ' selected' : ''}>–</option>` +
      `<option value="off"${sel === 'off' ? ' selected' : ''}>Libur</option>` +
      activeShifts.map((s) => `<option value="${s.id}"${sel === s.id ? ' selected' : ''}>${esc(s.name)}</option>`).join('');

    grid.innerHTML = `
      <p style="font-size:0.82rem;color:var(--color-text-muted);margin:0 0 8px">
        Periode <strong>${fmtDate(wk.from)} – ${fmtDate(wk.to)}</strong>. Pilih shift langsung di tabel; tersimpan otomatis.
      </p>
      <div class="table-scroll">
        <table class="data-table shift-grid">
          <thead>
            <tr><th style="min-width:150px">Staff</th>${wk.days
              .map((d) => `<th style="text-align:center">${dayLabel(d)}<div style="font-weight:400;font-size:0.72rem;color:var(--color-text-muted)">${fmtShort(d)}</div></th>`)
              .join('')}</tr>
          </thead>
          <tbody>
            ${
              baris
                .map((st) =>
                  st.jenis === 'divisi'
                    ? `<tr class="shift-divisi"><td colspan="8">${esc(st.nama)}</td></tr>`
                    : `<tr>
                    <td>${esc(st.full_name)}${st.is_active === false ? ' <span style="font-size:0.7rem;color:var(--color-danger)">(nonaktif)</span>' : ''}${
                      // Scope level BU (mis. admin BU) mencakup semua outlet, jadi
                      // orangnya muncul di setiap outlet. Diberi tanda supaya admin
                      // tahu dia bukan staf tetap outlet ini.
                      st.tingkat === 'bu' ? ' <span class="badge" style="font-size:0.62rem">level BU</span>' : ''
                    }</td>
                    ${wk.days
                      .map((d) => {
                        const cur = map.get(`${st.user_id}|${d}`);
                        const sel = cur ? (cur.is_off ? 'off' : cur.shift_id) : '';
                        const auto = autoOff.get(d);
                        // Libur otomatis hanya jadi *default tampilan*; admin
                        // tetap bisa menimpanya (mis. lembur di hari libur).
                        const hint = !cur && auto?.off ? `<div style="font-size:0.66rem;color:var(--color-text-muted)">Libur · ${esc(auto.reason)}</div>` : '';
                        return `<td style="text-align:center"><select class="sc-cell${sel === 'off' ? ' is-off' : sel ? ' is-set' : ''}" data-user="${st.user_id}" data-date="${d}">${opts(sel)}</select>${hint}</td>`;
                      })
                      .join('')}
                  </tr>`
                )
                .join('') ||
              `<tr><td colspan="8" style="color:var(--color-text-muted)">Belum ada staff berdivisi di outlet ini. Atur divisinya lewat <strong>Master User → Kelola Divisi</strong>.</td></tr>`
            }
          </tbody>
        </table>
      </div>
      ${
        belumDiatur.length
          ? `<p style="font-size:0.78rem;color:var(--color-danger);margin-top:8px">
               ⚠️ ${belumDiatur.length} staff belum punya divisi, jadi tidak bisa dijadwalkan:
               <em>${belumDiatur.map((s) => esc(s.full_name)).join(', ')}</em>.
               Atur divisinya di <strong>Master User</strong>.
             </p>`
          : ''
      }
      ${
        adaAutoOff
          ? `<p style="font-size:0.76rem;color:var(--color-text-muted);margin-top:8px">
               Tanggal bertanda <strong>Libur</strong> mengikuti kebijakan hari libur BU (Pengaturan NBM &amp; Lembur) — tidak perlu diisi satu-satu,
               tapi tetap bisa ditimpa kalau ada yang masuk.
             </p>`
          : ''
      }
      <p style="font-size:0.76rem;color:var(--color-text-muted);margin-top:8px">
        “–” = belum dijadwalkan · “Libur” = hari libur staff.
        ${activeShifts.map((s) => `<strong>${esc(s.name)}</strong> ${s.start_time.slice(0, 5)}–${s.end_time.slice(0, 5)}${shiftCrossesMidnight(s) ? ' (+1 hari)' : ''}`).join(' · ')}
      </p>
    `;

    grid.querySelectorAll('.sc-cell').forEach((sel) =>
      sel.addEventListener('change', async () => {
        const { user, date } = sel.dataset;
        try {
          if (!sel.value) await clearSchedule(state.outletId, user, date);
          else
            await setSchedule({
              businessUnitId,
              outletId: state.outletId,
              userId: user,
              workDate: date,
              shiftId: sel.value === 'off' ? null : sel.value,
              isOff: sel.value === 'off'
            });
          sel.classList.toggle('is-off', sel.value === 'off');
          sel.classList.toggle('is-set', !!sel.value && sel.value !== 'off');
        } catch (error) {
          toast(error.message ?? 'Gagal menyimpan jadwal.', 'error');
          draw();
        }
      })
    );
  }

  await draw();
}

// ---- Tab: Jam Shift per outlet ----

async function renderHoursTab(content, businessUnitId, outlets) {
  if (!outlets.length) {
    content.innerHTML = `<p style="color:var(--color-text-muted)">Belum ada outlet di BU ini.</p>`;
    return;
  }
  const settings = await getShiftSettings(businessUnitId).catch(() => ({ shift_count: 2, late_tolerance_minutes: 10 }));
  const state = { outletId: outlets[0].id };

  content.innerHTML = `
    <div class="field" style="max-width:260px"><label>Outlet</label>
      <select id="sh-outlet">${outlets.map((o) => `<option value="${o.id}">${esc(o.name)}${o.shift_enabled ? '' : ' (shift nonaktif)'}</option>`).join('')}</select>
    </div>
    <p style="font-size:0.82rem;color:var(--color-text-muted)">Jumlah shift diatur di tab Pengaturan (saat ini <strong>${settings.shift_count} shift</strong>). Jam bisa berbeda tiap outlet.</p>
    <div id="sh-list"></div>
  `;
  const list = content.querySelector('#sh-list');
  content.querySelector('#sh-outlet').addEventListener('change', (e) => {
    state.outletId = e.target.value;
    draw();
  });

  async function draw() {
    list.innerHTML = `<p>Memuat...</p>`;
    const shifts = await listOutletShifts(state.outletId).catch(() => []);
    const bySlot = new Map(shifts.map((s) => [s.slot, s]));
    const slots = Array.from({ length: settings.shift_count }, (_, i) => i + 1);

    list.innerHTML = `
      <table class="data-table" style="max-width:640px">
        <thead><tr><th>Shift</th><th>Nama</th><th>Mulai</th><th>Selesai</th><th>Status</th><th>Aksi</th></tr></thead>
        <tbody>
          ${slots
            .map((slot) => {
              const s = bySlot.get(slot);
              return `<tr>
                <td>Shift ${slot}</td>
                <td>${s ? esc(s.name) : '<span style="color:var(--color-text-muted)">belum diatur</span>'}</td>
                <td>${s ? s.start_time.slice(0, 5) : '-'}</td>
                <td>${s ? `${s.end_time.slice(0, 5)}${shiftCrossesMidnight(s) ? ' <span style="font-size:0.7rem;color:var(--color-text-muted)">(+1 hari)</span>' : ''}` : '-'}</td>
                <td>${s ? (s.is_active ? 'Aktif' : 'Nonaktif') : '-'}</td>
                <td>
                  <button class="btn-edit-shift" data-slot="${slot}" data-json='${s ? escAttr(JSON.stringify(s)) : ''}'>${s ? 'Edit' : 'Atur'}</button>
                  ${s ? `<button class="btn-del-shift" data-id="${s.id}">Hapus</button>` : ''}
                </td>
              </tr>`;
            })
            .join('')}
        </tbody>
      </table>`;

    list.querySelectorAll('.btn-edit-shift').forEach((btn) =>
      btn.addEventListener('click', async () => {
        const existing = btn.dataset.json ? JSON.parse(btn.dataset.json) : null;
        const slot = Number(btn.dataset.slot);
        const values = await formDialog({
          title: `Jam Shift ${slot}`,
          description: 'Kalau jam selesai lebih kecil dari jam mulai, shift dianggap melewati tengah malam.',
          fields: [
            { name: 'name', label: 'Nama Shift', type: 'text', required: true, value: existing?.name ?? `Shift ${slot}`, placeholder: 'mis. Pagi / Siang / Malam' },
            { name: 'start_time', label: 'Jam Mulai', type: 'time', required: true, value: existing?.start_time?.slice(0, 5) ?? '' },
            { name: 'end_time', label: 'Jam Selesai', type: 'time', required: true, value: existing?.end_time?.slice(0, 5) ?? '' },
            { name: 'is_active', label: 'Aktif', type: 'checkbox', value: existing ? existing.is_active : true }
          ],
          submitText: 'Simpan'
        });
        if (!values) return;
        try {
          await upsertOutletShift({
            businessUnitId,
            outletId: state.outletId,
            slot,
            name: values.name,
            start_time: values.start_time,
            end_time: values.end_time,
            is_active: values.is_active
          });
          toast('Jam shift disimpan.', 'success');
          draw();
        } catch (error) {
          toast(error.message ?? 'Gagal menyimpan jam shift.', 'error');
        }
      })
    );

    list.querySelectorAll('.btn-del-shift').forEach((btn) =>
      btn.addEventListener('click', async () => {
        const ok = await confirmDialog({ title: 'Hapus jam shift?', message: 'Jadwal yang memakai shift ini ikut terhapus.', confirmText: 'Hapus', danger: true });
        if (!ok) return;
        try {
          await deleteOutletShift(btn.dataset.id);
          toast('Jam shift dihapus.', 'success');
          draw();
        } catch (error) {
          toast(error.message ?? 'Gagal menghapus.', 'error');
        }
      })
    );
  }

  await draw();
}

// ---- Tab: Pengaturan (jumlah shift, toleransi, aktivasi per outlet) ----

async function renderSettingsTab(content, businessUnitId, outlets) {
  const [settings, isSuper] = await Promise.all([
    getShiftSettings(businessUnitId).catch(() => ({ shift_count: 2, late_tolerance_minutes: 10 })),
    amISuperAdmin().catch(() => false)
  ]);

  content.innerHTML = `
    <div class="inline-card" style="max-width:460px">
      <h3 style="margin-top:0">Pengaturan Shift (BU ini)</h3>
      <div class="field"><label>Jumlah shift</label>
        <select id="st-count">${[2, 3, 4].map((n) => `<option value="${n}"${n === settings.shift_count ? ' selected' : ''}>${n} shift</option>`).join('')}</select>
      </div>
      <div class="field"><label>Toleransi terlambat (menit)</label>
        <input type="number" id="st-tol" min="0" value="${settings.late_tolerance_minutes}" />
        <span class="field-help">Clock in dalam batas ini ditandai “Toleransi”; lebih dari itu “Terlambat”.</span>
      </div>
      <button class="primary" id="st-save" style="max-width:200px">Simpan Pengaturan</button>
    </div>

    <div class="inline-card" style="max-width:460px">
      <h3 style="margin-top:0">Aktifkan Modul Shift per Outlet</h3>
      ${
        isSuper
          ? `<p style="font-size:0.8rem;color:var(--color-text-muted);margin:0 0 8px">Hanya Super Admin yang bisa mengubah ini.</p>
             ${outlets
               .map(
                 (o) => `<div class="field field-check">
                   <input type="checkbox" class="st-outlet" data-id="${o.id}" ${o.shift_enabled ? 'checked' : ''} />
                   <label style="margin:0">${esc(o.name)}</label>
                 </div>`
               )
               .join('') || '<p style="color:var(--color-text-muted)">Belum ada outlet.</p>'}`
          : `<p style="color:var(--color-text-muted);font-size:0.88rem;margin:0">Hanya Super Admin yang bisa mengaktifkan/menonaktifkan modul Shift per outlet.</p>
             <ul style="font-size:0.85rem;color:var(--color-text-muted)">${outlets.map((o) => `<li>${esc(o.name)} — ${o.shift_enabled ? 'aktif' : 'nonaktif'}</li>`).join('')}</ul>`
      }
    </div>
  `;

  content.querySelector('#st-save').addEventListener('click', async () => {
    try {
      await upsertShiftSettings(businessUnitId, {
        shift_count: Number(content.querySelector('#st-count').value),
        late_tolerance_minutes: Number(content.querySelector('#st-tol').value) || 0
      });
      toast('Pengaturan shift disimpan.', 'success');
    } catch (error) {
      toast(error.message ?? 'Gagal menyimpan pengaturan.', 'error');
    }
  });

  content.querySelectorAll('.st-outlet').forEach((chk) =>
    chk.addEventListener('change', async () => {
      try {
        await setOutletShiftEnabled(chk.dataset.id, chk.checked);
        const o = outlets.find((x) => x.id === chk.dataset.id);
        if (o) o.shift_enabled = chk.checked;
        toast(chk.checked ? 'Modul Shift diaktifkan untuk outlet ini.' : 'Modul Shift dinonaktifkan.', 'success');
      } catch (error) {
        chk.checked = !chk.checked;
        toast(error.message ?? 'Gagal mengubah (hanya Super Admin).', 'error');
      }
    })
  );
}

function dayLabel(d) {
  return new Date(d + 'T00:00:00').toLocaleDateString('id-ID', { weekday: 'short' });
}
function fmtShort(d) {
  return new Date(d + 'T00:00:00').toLocaleDateString('id-ID', { day: '2-digit', month: 'short' });
}
function fmtDate(d) {
  return new Date(d + 'T00:00:00').toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escAttr(s) {
  return esc(s);
}
