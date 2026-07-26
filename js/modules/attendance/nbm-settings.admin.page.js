import { listOutletsWithGeofence } from './attendance.service.js';
import {
  getNbmConfig,
  upsertNbmConfig,
  listOvertimeTiers,
  addOvertimeTier,
  removeOvertimeTier,
  listHolidays,
  addHoliday,
  addHolidaysBulk,
  removeHoliday,
  getHolidayPolicy,
  setHolidayPolicy
} from './nbm.service.js';
import { fetchNationalHolidays, holidayLabel } from './holiday-api.js';
import { toast, confirmDialog, formDialog } from '../../core/ui.js';
import { formatThousands, formatRupiah, parseNumber, attachThousandsInput } from '../../core/format.js';

const DAY_NAMES = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

export async function renderNbmSettingsTab(container, businessUnitId) {
  container.innerHTML = `<p>Memuat pengaturan NBM...</p>`;
  const [outlets, policy] = await Promise.all([
    listOutletsWithGeofence(businessUnitId),
    getHolidayPolicy(businessUnitId).catch(() => ({ holiday_policy: 'operational', weekly_off_days: [] }))
  ]);

  if (!outlets.length) {
    container.innerHTML = `<p>Belum ada outlet di BU ini.</p>`;
    return;
  }

  container.innerHTML = `
    <div id="holiday-policy-card"></div>
    <div class="field" style="max-width:280px;margin-top:16px">
      <label>Pilih Outlet</label>
      <select id="nbm-outlet-select">
        ${outlets.map((o) => `<option value="${o.id}">${o.name}</option>`).join('')}
      </select>
    </div>
    <div id="nbm-outlet-detail"></div>
  `;

  renderHolicyCard(container.querySelector('#holiday-policy-card'), businessUnitId, policy);

  const select = document.getElementById('nbm-outlet-select');
  select.addEventListener('change', () => renderOutletDetail(select.value, businessUnitId));
  await renderOutletDetail(select.value, businessUnitId);
}

// ---- Kartu kebijakan hari libur (level BU) ----

function renderHolicyCard(host, businessUnitId, policy) {
  const isCalendar = policy.holiday_policy === 'follow_calendar';
  const offDays = new Set((policy.weekly_off_days ?? []).map(Number));

  host.innerHTML = `
    <div class="inline-card" style="max-width:560px">
      <h3 style="margin-top:0">Kebijakan Hari Libur (BU ini)</h3>
      <div class="field">
        <label for="hp-mode">Bagaimana BU ini memperlakukan Minggu & hari besar?</label>
        <select id="hp-mode">
          <option value="operational"${isCalendar ? '' : ' selected'}>Tetap beroperasi — staff yang masuk dapat kompensasi PH</option>
          <option value="follow_calendar"${isCalendar ? ' selected' : ''}>Ikut kalender libur nasional — otomatis libur</option>
        </select>
        <span class="field-help">
          Cafe/Bengkel biasanya <strong>tetap beroperasi</strong> (Minggu justru ramai). Divisi Admin biasanya <strong>ikut kalender</strong>.
        </span>
      </div>
      <div class="field" id="hp-weekly-wrap" style="${isCalendar ? '' : 'display:none'}">
        <label>Hari libur mingguan tetap</label>
        <div style="display:flex;flex-wrap:wrap;gap:10px">
          ${DAY_NAMES.map(
            (d, i) => `<label class="scope-badge" style="cursor:pointer">
              <input type="checkbox" class="hp-day" value="${i}" style="width:auto;margin:0"${offDays.has(i) ? ' checked' : ''} /> ${d}
            </label>`
          ).join('')}
        </div>
        <span class="field-help">Hari yang dicentang otomatis muncul sebagai <strong>Libur</strong> di Jadwal Shift tanpa perlu diisi satu-satu.</span>
      </div>
      <button class="primary" id="hp-save" style="max-width:200px">Simpan Kebijakan</button>
      <p style="font-size:0.78rem;color:var(--color-text-muted);margin-bottom:0">
        Daftar hari libur nasional di bawah tetap diisi untuk <strong>kedua</strong> mode — bedanya cuma efeknya:
        mode “tetap beroperasi” memakainya untuk menaikkan NBM &amp; menghitung cuti pengganti, mode “ikut kalender” memakainya untuk meliburkan.
      </p>
    </div>
  `;

  const modeSel = host.querySelector('#hp-mode');
  modeSel.addEventListener('change', () => {
    host.querySelector('#hp-weekly-wrap').style.display = modeSel.value === 'follow_calendar' ? '' : 'none';
  });

  host.querySelector('#hp-save').addEventListener('click', async () => {
    const mode = modeSel.value;
    const days = [...host.querySelectorAll('.hp-day')].filter((c) => c.checked).map((c) => Number(c.value));
    try {
      await setHolidayPolicy(businessUnitId, { holiday_policy: mode, weekly_off_days: mode === 'follow_calendar' ? days : [] });
      toast('Kebijakan hari libur disimpan.', 'success');
    } catch (error) {
      toast(error.message ?? 'Gagal menyimpan kebijakan.', 'error');
    }
  });
}

async function renderOutletDetail(outletId, businessUnitId) {
  const detail = document.getElementById('nbm-outlet-detail');
  detail.innerHTML = `<p>Memuat...</p>`;

  const [config, tiers, holidays] = await Promise.all([
    getNbmConfig(outletId),
    listOvertimeTiers(outletId),
    listHolidays({ businessUnitId, outletId })
  ]);

  detail.innerHTML = `
    <form class="inline-card" id="nbm-config-form" style="max-width:420px;margin-top:16px">
      <h3>Nominal NBM</h3>
      <div class="field">
        <label>NBM Normal (Rp)</label>
        <input type="text" inputmode="numeric" class="js-money" name="base_amount" value="${formatThousands(config?.base_amount ?? 0)}" required />
      </div>
      <div class="field">
        <label>NBM Hari Libur (Rp) — kosongkan kalau sama seperti NBM normal</label>
        <input type="text" inputmode="numeric" class="js-money" name="holiday_amount" value="${config?.holiday_amount == null ? '' : formatThousands(config.holiday_amount)}" />
      </div>
      <div class="field">
        <label>Bonus Storing (Rp)</label>
        <input type="text" inputmode="numeric" class="js-money" name="storing_bonus_amount" value="${formatThousands(config?.storing_bonus_amount ?? 0)}" required />
      </div>

      <h3 style="margin-top:18px">Kompensasi Hari Libur Nasional (PH)</h3>
      <p style="font-size:0.78rem;color:var(--color-text-muted);margin-top:0">
        Untuk staff yang <strong>tetap masuk</strong> di tanggal yang terdaftar sebagai hari libur. Isi 0 kalau tidak dipakai.
      </p>
      <div class="field">
        <label>Bonus PH tambahan (Rp)</label>
        <input type="text" inputmode="numeric" class="js-money" name="ph_bonus_amount" value="${formatThousands(config?.ph_bonus_amount ?? 0)}" />
        <span class="field-help">Ditambahkan <em>di atas</em> NBM hari libur, bukan menggantikannya.</span>
      </div>
      <div class="field">
        <label>Cuti pengganti (hari per hari kerja)</label>
        <input type="number" step="0.5" min="0" name="ph_replacement_days" value="${config?.ph_replacement_days ?? 0}" />
        <span class="field-help">Contoh: isi <strong>1</strong> berarti masuk 1 hari libur nasional = dapat 1 hari cuti pengganti. Rekapnya ada di Laporan → Hak Cuti Pengganti (PH).</span>
      </div>

      <button class="primary" type="submit">Simpan</button>
      <p class="error-text" id="nbm-config-error"></p>
    </form>

    <div class="inline-card" style="max-width:480px;margin-top:16px">
      <h3>Bonus Lembur Bertingkat</h3>
      <table class="data-table">
        <thead><tr><th>Lewat Jam</th><th>Bonus</th><th></th></tr></thead>
        <tbody id="nbm-tiers-body">
          ${tiers.map((t) => tierRowHtml(t)).join('') || '<tr><td colspan="3">Belum ada.</td></tr>'}
        </tbody>
      </table>
      <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;align-items:flex-end">
        <div class="field" style="margin:0"><label>Jam (24h)</label><input type="time" id="tier-time" /></div>
        <div class="field" style="margin:0;display:flex;align-items:center;gap:6px">
          <input type="checkbox" id="tier-next-day" style="width:auto" />
          <label style="margin:0" for="tier-next-day">Keesokan hari (lewat tengah malam)</label>
        </div>
        <div class="field" style="margin:0"><label>Bonus (Rp)</label><input type="text" inputmode="numeric" class="js-money" id="tier-amount" /></div>
        <button class="primary" id="btn-add-tier" style="max-width:100px">+ Tambah</button>
      </div>
    </div>

    <div class="inline-card" style="max-width:560px;margin-top:16px">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
        <h3 style="margin:0">Hari Libur</h3>
        <button id="btn-pull-holidays">⇩ Tarik hari libur nasional</button>
      </div>
      <p style="font-size:0.78rem;color:var(--color-text-muted);margin:6px 0 10px">
        Hasil tarikan ditampilkan dulu untuk kamu setujui sebelum disimpan. Cuti bersama tahun depan biasanya belum terbit
        (menunggu SKB 3 Menteri), dan tanggal Idul Fitri/Adha bisa geser sehari dari prediksi — tambahkan/koreksi manual bila perlu.
      </p>
      <table class="data-table">
        <thead><tr><th>Tanggal</th><th>Nama</th><th></th></tr></thead>
        <tbody id="nbm-holidays-body">
          ${holidays.map((h) => holidayRowHtml(h)).join('') || '<tr><td colspan="3">Belum ada.</td></tr>'}
        </tbody>
      </table>
      <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;align-items:flex-end">
        <div class="field" style="margin:0"><label>Tanggal</label><input type="date" id="holiday-date" /></div>
        <div class="field" style="margin:0"><label>Nama</label><input type="text" id="holiday-name" placeholder="misal: Lebaran" /></div>
        <button class="primary" id="btn-add-holiday" style="max-width:100px">+ Tambah</button>
      </div>
    </div>
  `;

  detail.querySelectorAll('.js-money').forEach((el) => attachThousandsInput(el));

  document.getElementById('nbm-config-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    try {
      await upsertNbmConfig(outletId, {
        base_amount: parseNumber(form.base_amount.value),
        holiday_amount: form.holiday_amount.value.trim() === '' ? null : parseNumber(form.holiday_amount.value),
        storing_bonus_amount: parseNumber(form.storing_bonus_amount.value),
        ph_bonus_amount: parseNumber(form.ph_bonus_amount.value),
        ph_replacement_days: Number(form.ph_replacement_days.value) || 0
      });
      toast('Nominal NBM disimpan.', 'success');
    } catch (error) {
      document.getElementById('nbm-config-error').textContent = error.message ?? 'Gagal menyimpan.';
      toast(error.message ?? 'Gagal menyimpan NBM.', 'error');
    }
  });

  document.getElementById('btn-add-tier').addEventListener('click', async () => {
    const time = document.getElementById('tier-time').value; // "HH:MM"
    const nextDay = document.getElementById('tier-next-day').checked;
    const amount = document.getElementById('tier-amount').value;
    if (!time || parseNumber(amount) <= 0) return toast('Isi jam dan nominal bonus dulu.', 'warning');
    const [hh, mm] = time.split(':').map(Number);
    const thresholdMinutes = (nextDay ? 1440 : 0) + hh * 60 + mm;
    try {
      await addOvertimeTier(outletId, {
        threshold_minutes: thresholdMinutes,
        bonus_amount: parseNumber(amount),
        label: `Lewat ${time}${nextDay ? ' (besok)' : ''}`
      });
      toast('Tingkatan lembur ditambahkan.', 'success');
      await renderOutletDetail(outletId, businessUnitId);
    } catch (error) {
      toast(error.message ?? 'Gagal menambah tingkatan lembur.', 'error');
    }
  });

  document.getElementById('btn-add-holiday').addEventListener('click', async () => {
    const date = document.getElementById('holiday-date').value;
    const name = document.getElementById('holiday-name').value.trim();
    if (!date || !name) return toast('Isi tanggal dan nama hari libur dulu.', 'warning');
    try {
      await addHoliday({ holiday_date: date, name, outlet_id: outletId });
      toast('Hari libur ditambahkan.', 'success');
      await renderOutletDetail(outletId, businessUnitId);
    } catch (error) {
      toast(error.message ?? 'Gagal menambah hari libur.', 'error');
    }
  });

  document.getElementById('btn-pull-holidays').addEventListener('click', async () => {
    const tahun = await formDialog({
      title: 'Tarik Hari Libur Nasional',
      description:
        'Data diambil dari layanan hari libur publik Indonesia. Layanan ini pihak ketiga dan bisa mati sewaktu-waktu — ' +
        'kalau gagal, hari libur tetap bisa ditambah manual.',
      fields: [{ name: 'year', label: 'Tahun', type: 'number', required: true, min: 2020, value: String(new Date().getFullYear()) }],
      submitText: 'Tarik'
    });
    if (!tahun) return;

    toast('Menghubungi layanan hari libur…', 'info');
    let hasil;
    try {
      hasil = await fetchNationalHolidays(Number(tahun.year));
    } catch (error) {
      toast(error.message ?? 'Gagal menarik hari libur.', 'error');
      return;
    }

    // Tanggal yang sudah ada ditandai supaya admin tahu mana yang baru.
    const sudahAda = new Set(holidays.map((h) => h.holiday_date));
    const pilihan = await formDialog({
      title: `Hari Libur ${tahun.year} (${hasil.holidays.length} tanggal)`,
      description: `Sumber: ${hasil.source}. Hilangkan centang untuk tanggal yang tidak dipakai BU ini. Tanggal yang sudah ada akan diperbarui, bukan diduplikasi.`,
      fields: hasil.holidays.map((h) => ({
        name: `d_${h.date}`,
        label: holidayLabel(h) + (sudahAda.has(h.date) ? ' — sudah ada' : ''),
        type: 'checkbox',
        value: true
      })),
      submitText: 'Simpan yang dicentang'
    });
    if (!pilihan) return;

    const dipilih = hasil.holidays.filter((h) => pilihan[`d_${h.date}`]);
    if (!dipilih.length) return toast('Tidak ada tanggal yang dipilih.', 'warning');
    try {
      await addHolidaysBulk(businessUnitId, dipilih);
      toast(`${dipilih.length} hari libur tersimpan.`, 'success');
      await renderOutletDetail(outletId, businessUnitId);
    } catch (error) {
      toast(error.message ?? 'Gagal menyimpan hari libur.', 'error');
    }
  });

  document.querySelectorAll('.btn-remove-tier').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const ok = await confirmDialog({ title: 'Hapus tingkatan lembur?', confirmText: 'Hapus', danger: true });
      if (!ok) return;
      try {
        await removeOvertimeTier(btn.dataset.tierId);
        toast('Tingkatan lembur dihapus.', 'success');
        await renderOutletDetail(outletId, businessUnitId);
      } catch (error) {
        toast(error.message ?? 'Gagal menghapus.', 'error');
      }
    });
  });

  document.querySelectorAll('.btn-remove-holiday').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const ok = await confirmDialog({ title: 'Hapus hari libur?', confirmText: 'Hapus', danger: true });
      if (!ok) return;
      try {
        await removeHoliday(btn.dataset.holidayId);
        toast('Hari libur dihapus.', 'success');
        await renderOutletDetail(outletId, businessUnitId);
      } catch (error) {
        toast(error.message ?? 'Gagal menghapus.', 'error');
      }
    });
  });
}

function tierRowHtml(t) {
  return `
    <tr>
      <td>${t.label ?? formatThreshold(t.threshold_minutes)}</td>
      <td>${formatRupiah(t.bonus_amount)}</td>
      <td><button class="btn-remove-tier" data-tier-id="${t.id}">✕</button></td>
    </tr>
  `;
}

function holidayRowHtml(h) {
  const hari = new Date(h.holiday_date + 'T00:00:00').toLocaleDateString('id-ID', { weekday: 'short' });
  return `
    <tr>
      <td>${h.holiday_date}<div style="font-size:0.72rem;color:var(--color-text-muted)">${hari}</div></td>
      <td>${h.name}
        ${h.is_joint_leave ? '<span class="badge badge-pending" style="font-size:0.65rem">cuti bersama</span>' : ''}
        ${h.source === 'api' ? '<div style="font-size:0.7rem;color:var(--color-text-muted)">dari kalender nasional</div>' : ''}
      </td>
      <td><button class="btn-remove-holiday" data-holiday-id="${h.id}">✕</button></td>
    </tr>
  `;
}

function formatThreshold(minutes) {
  const day = minutes >= 1440 ? ' (besok)' : '';
  const m = minutes % 1440;
  const hh = String(Math.floor(m / 60)).padStart(2, '0');
  const mm = String(m % 60).padStart(2, '0');
  return `${hh}:${mm}${day}`;
}
