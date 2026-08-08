import { toast, confirmDialog, formDialog, infoDialog, shareDialog, fuzzyMatch } from '../../core/ui.js';
import { exportTablePDF } from '../../core/pdf.js';
import { todayWIB } from '../../core/dates.js';
import {
  VEHICLE_STATUS,
  STATUS_BADGE,
  STATUS_OPTIONS,
  VEHICLE_TYPES,
  DOC_BADGE,
  docStatus,
  getFleetSettings,
  upsertFleetSettings,
  loadFleetMasters,
  ensureBrand,
  ensureModel,
  ensureArea,
  renameMaster,
  deleteMaster,
  listVehicles,
  createVehicle,
  updateVehicle,
  deleteVehicle,
  startRental,
  endRental,
  listRentals
} from './fleet.service.js';
import { importVehicles, downloadVehicleTemplate } from './fleet-import.js';
import { loadingHtml, sekaliJalan } from '../../core/loading.js';

const TABS = [
  { key: 'vehicles', label: 'Kendaraan' },
  { key: 'rental', label: 'Rental' },
  { key: 'docs', label: 'Dokumen & Reminder' },
  { key: 'settings', label: 'Pengaturan' }
];

export async function renderFleetAdminPage(container, { businessUnitId }) {
  container.innerHTML = `
    <h1>Armada</h1>
    <div class="tab-bar">
      ${TABS.map((t, i) => `<button class="tab-btn ${i === 0 ? 'active' : ''}" data-tab="${t.key}">${t.label}</button>`).join('')}
    </div>
    <div id="fleet-content"></div>
  `;
  const content = container.querySelector('#fleet-content');
  const [settings, masters] = await Promise.all([
    getFleetSettings(businessUnitId).catch(() => ({ reminder_lead_days: 30 })),
    loadFleetMasters(businessUnitId)
  ]);
  // `ctx` dibagikan ke semua tab; masters di-refresh setiap ada penambahan.
  const ctx = { businessUnitId, settings, masters };

  async function showTab(key) {
    container.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === key));
    if (key === 'vehicles') await renderVehiclesTab(content, ctx);
    if (key === 'rental') await renderRentalTab(content, ctx);
    if (key === 'docs') await renderDocsTab(content, ctx);
    if (key === 'settings') await renderSettingsTab(content, ctx);
  }
  container.querySelectorAll('.tab-btn').forEach((btn) => btn.addEventListener('click', () => showTab(btn.dataset.tab)));
  await showTab('vehicles');
}

/** Muat ulang master (dipanggil setelah ada merk/tipe/area baru). */
async function refreshMasters(ctx) {
  ctx.masters = await loadFleetMasters(ctx.businessUnitId);
}

const norm = (s) => String(s ?? '').trim();
const same = (a, b) => norm(a).toLowerCase() === norm(b).toLowerCase();
const brandByName = (masters, name) => masters.brands.find((b) => same(b.name, name)) ?? null;
/** Opsi Tipe yang cocok untuk satu merk (kosong kalau merk belum dipilih). */
const modelOptionsFor = (masters, brandName) => {
  const b = brandByName(masters, brandName);
  if (!b) return [];
  return masters.models.filter((m) => m.brand_id === b.id).map((m) => ({ value: m.name, label: m.name }));
};

// ---- Tab: Kendaraan ----

async function renderVehiclesTab(content, ctx) {
  const { businessUnitId, settings } = ctx;
  content.innerHTML = loadingHtml('Memuat kendaraan…', { baris: 5 });
  let vehicles;
  try {
    vehicles = await listVehicles(businessUnitId);
  } catch (error) {
    content.innerHTML = `<p class="error-text">${error.message ?? error}</p>`;
    return;
  }
  const state = { q: '', status: '', area: '', stnkFrom: '', stnkTo: '', kirFrom: '', kirTo: '' };

  content.innerHTML = `
    <div class="page-header">
      <h2 style="font-size:1.05rem;margin:0">Data Kendaraan</h2>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button id="fl-import">⇧ Import xlsx</button>
        <button id="fl-export">⇩ Export PDF</button>
        <button class="primary" id="fl-new" style="max-width:190px">+ Tambah Kendaraan</button>
      </div>
    </div>

    <div class="inline-card" style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin-bottom:12px">
      <div class="field" style="margin:0;max-width:180px"><label>Status</label>
        <select id="fl-status"><option value="">Semua</option>${STATUS_OPTIONS.map((s) => `<option value="${s.value}">${esc(s.label)}</option>`).join('')}</select>
      </div>
      <div class="field" style="margin:0;max-width:200px"><label>Area Rental</label>
        <select id="fl-area">${areaFilterOptions(ctx.masters, vehicles)}</select>
      </div>
      <div class="field" style="margin:0;max-width:220px"><label>Cari</label>
        <input type="text" id="fl-q" placeholder="plat / merk / tipe / penyewa…" />
      </div>
      <div style="flex-basis:100%;height:0"></div>
      <div class="field" style="margin:0;max-width:165px"><label>Pajak STNK dari</label><input type="date" id="fl-stnk-from" /></div>
      <div class="field" style="margin:0;max-width:165px"><label>s/d</label><input type="date" id="fl-stnk-to" /></div>
      <div class="field" style="margin:0;max-width:165px"><label>KIR dari</label><input type="date" id="fl-kir-from" /></div>
      <div class="field" style="margin:0;max-width:165px"><label>s/d</label><input type="date" id="fl-kir-to" /></div>
      <button id="fl-reset">Reset filter</button>
    </div>

    <div id="fl-list"></div>
  `;

  const list = content.querySelector('#fl-list');
  const bind = (sel, key, evt = 'change') =>
    content.querySelector(sel).addEventListener(evt, (e) => {
      state[key] = e.target.value;
      draw();
    });
  bind('#fl-status', 'status');
  bind('#fl-area', 'area');
  bind('#fl-q', 'q', 'input');
  bind('#fl-stnk-from', 'stnkFrom');
  bind('#fl-stnk-to', 'stnkTo');
  bind('#fl-kir-from', 'kirFrom');
  bind('#fl-kir-to', 'kirTo');
  content.querySelector('#fl-reset').addEventListener('click', () => {
    Object.keys(state).forEach((k) => (state[k] = ''));
    content.querySelectorAll('#fl-status, #fl-area, #fl-q, #fl-stnk-from, #fl-stnk-to, #fl-kir-from, #fl-kir-to').forEach((el) => (el.value = ''));
    draw();
  });

  content.querySelector('#fl-new').addEventListener('click', () => openVehicleDialog(content, ctx, null));
  content.querySelector('#fl-import').addEventListener('click', () => openImportDialog(content, ctx));
  content.querySelector('#fl-export').addEventListener('click', () => exportVehicles(visible(), settings, filterSummary()));

  /** Tanggal `d` masuk rentang [from, to]? Kalau rentang diisi, baris tanpa tanggal disaring keluar. */
  function inRange(d, from, to) {
    if (!from && !to) return true;
    if (!d) return false;
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  }

  function visible() {
    return vehicles.filter(
      (v) =>
        (!state.status || v.status === state.status) &&
        (!state.area || same(v.rental_area, state.area)) &&
        inRange(v.stnk_tax_expiry, state.stnkFrom, state.stnkTo) &&
        inRange(v.kir_expiry, state.kirFrom, state.kirTo) &&
        (!state.q ||
          fuzzyMatch(
            state.q,
            `${v.plate_number} ${v.brand ?? ''} ${v.model ?? ''} ${v.vehicle_type ?? ''} ${v.renter_name ?? ''} ${v.rental_area ?? ''} ${v.stnk_owner_name ?? ''}`
          ))
    );
  }

  function filterSummary() {
    const parts = [];
    if (state.status) parts.push(`Status: ${VEHICLE_STATUS[state.status] ?? state.status}`);
    if (state.area) parts.push(`Area: ${state.area}`);
    if (state.stnkFrom || state.stnkTo) parts.push(`Pajak STNK ${state.stnkFrom || '…'} s/d ${state.stnkTo || '…'}`);
    if (state.kirFrom || state.kirTo) parts.push(`KIR ${state.kirFrom || '…'} s/d ${state.kirTo || '…'}`);
    return parts.join(' · ') || 'Semua kendaraan';
  }

  function draw() {
    const rows = visible();
    list.innerHTML = `
      <p style="font-size:0.8rem;color:var(--color-text-muted);margin:0 0 8px">
        Menampilkan <strong>${rows.length}</strong> dari ${vehicles.length} kendaraan${rows.length !== vehicles.length ? ` — ${esc(filterSummary())}` : ''}
      </p>
      <div class="table-scroll">
        <table class="data-table table-freeze-1">
          <thead><tr><th>Plat</th><th>Kendaraan</th><th>Area Rental</th><th>Status</th><th>Penyewa</th><th>STNK (pajak)</th><th>KIR</th><th>Aksi</th></tr></thead>
          <tbody>
            ${
              rows
                .map((v) => {
                  const tax = docStatus(v.stnk_tax_expiry, settings.reminder_lead_days);
                  const kir = docStatus(v.kir_expiry, settings.reminder_lead_days);
                  return `<tr>
                    <td><strong>${esc(v.plate_number)}</strong>${v.is_active === false ? ' <span style="font-size:0.7rem;color:var(--color-danger)">(nonaktif)</span>' : ''}
                      ${v.stnk_owner_name ? `<div style="font-size:0.72rem;color:var(--color-text-muted)">STNK: ${esc(v.stnk_owner_name)}</div>` : ''}</td>
                    <td style="font-size:0.85rem">${esc([v.brand, v.model].filter(Boolean).join(' ') || '-')}
                      <div style="font-size:0.74rem;color:var(--color-text-muted)">${esc(v.vehicle_type ?? '-')}${v.year ? ` · ${v.year}` : ''}${v.color ? ` · ${esc(v.color)}` : ''}</div></td>
                    <td style="font-size:0.85rem">${v.rental_area ? esc(v.rental_area) : '<span style="color:var(--color-text-muted)">-</span>'}</td>
                    <td><span class="badge ${STATUS_BADGE[v.status] ?? ''}">${VEHICLE_STATUS[v.status] ?? v.status}</span></td>
                    <td style="font-size:0.82rem">${
                      v.status === 'rented'
                        ? `${esc(v.renter_name ?? '-')}${v.rental_end ? `<div style="font-size:0.74rem;color:var(--color-text-muted)">s/d ${fmtDate(v.rental_end)}</div>` : ''}`
                        : '<span style="color:var(--color-text-muted)">-</span>'
                    }</td>
                    <td style="font-size:0.8rem">${docCell(v.stnk_tax_expiry, tax)}</td>
                    <td style="font-size:0.8rem">${docCell(v.kir_expiry, kir)}</td>
                    <td>
                      <button class="fl-detail" data-id="${v.id}">Detail</button>
                      <button class="fl-edit" data-id="${v.id}">Edit</button>
                      ${
                        v.status === 'rented'
                          ? `<button class="fl-end" data-id="${v.id}">Selesai Rental</button>`
                          : `<button class="fl-start" data-id="${v.id}">Rentalkan</button>`
                      }
                      <button class="fl-del" data-id="${v.id}">Hapus</button>
                    </td>
                  </tr>`;
                })
                .join('') || `<tr><td colspan="8">${vehicles.length ? 'Tidak ada kendaraan yang cocok dengan filter.' : 'Belum ada kendaraan.'}</td></tr>`
            }
          </tbody>
        </table>
      </div>`;

    const byId = (id) => vehicles.find((v) => v.id === id);
    list.querySelectorAll('.fl-edit').forEach((b) => b.addEventListener('click', () => openVehicleDialog(content, ctx, byId(b.dataset.id))));
    list.querySelectorAll('.fl-detail').forEach((b) => b.addEventListener('click', () => showDetail(byId(b.dataset.id), settings)));
    list.querySelectorAll('.fl-start').forEach((b) => b.addEventListener('click', () => openRentalDialog(content, ctx, byId(b.dataset.id))));
    list.querySelectorAll('.fl-end').forEach((b) =>
      b.addEventListener('click', async () => {
        const v = byId(b.dataset.id);
        const ok = await confirmDialog({
          title: 'Selesaikan rental?',
          message: `${v.plate_number} akan kembali berstatus Tersedia. Area Rental kendaraan tetap tersimpan.`,
          confirmText: 'Selesaikan'
        });
        if (!ok) return;
        try {
          await endRental(v.id, todayWIB());
          toast('Rental diselesaikan.', 'success');
          renderVehiclesTab(content, ctx);
        } catch (error) {
          toast(error.message ?? 'Gagal menyelesaikan rental.', 'error');
        }
      })
    );
    list.querySelectorAll('.fl-del').forEach((b) =>
      b.addEventListener('click', sekaliJalan(async () => {
        const ok = await confirmDialog({ title: 'Hapus kendaraan?', message: 'Riwayat rental kendaraan ini ikut terhapus.', confirmText: 'Hapus', danger: true });
        if (!ok) return;
        try {
          await deleteVehicle(b.dataset.id);
          toast('Kendaraan dihapus.', 'success');
          renderVehiclesTab(content, ctx);
        } catch (error) {
          toast(error.message ?? 'Gagal menghapus.', 'error');
        }
      }))
    );
  }

  draw();
}

/** Opsi filter area: master + area yang sudah terpakai di data (jaga-jaga master belum lengkap). */
function areaFilterOptions(masters, vehicles) {
  const names = new Set(masters.areas.map((a) => a.name));
  for (const v of vehicles) if (norm(v.rental_area)) names.add(norm(v.rental_area));
  return (
    '<option value="">Semua area</option>' +
    [...names].sort((a, b) => a.localeCompare(b)).map((n) => `<option value="${escAttr(n)}">${esc(n)}</option>`).join('')
  );
}

function docCell(dateStr, st) {
  if (!dateStr) return '<span style="color:var(--color-text-muted)">-</span>';
  return `${fmtDate(dateStr)}<div><span class="badge ${DOC_BADGE[st.level]}">${esc(st.label)}</span></div>`;
}

async function showDetail(v, settings) {
  if (!v) return;
  const item = (l, val) => `<div class="profile-row"><span class="profile-label">${l}</span><span class="profile-value">${val ? esc(val) : '-'}</span></div>`;
  const tax = docStatus(v.stnk_tax_expiry, settings.reminder_lead_days);
  const stnk = docStatus(v.stnk_expiry, settings.reminder_lead_days);
  const kir = docStatus(v.kir_expiry, settings.reminder_lead_days);
  await infoDialog({
    title: `${v.plate_number}`,
    bodyHtml: `<div class="profile-list">
      ${item('Merk', v.brand)}
      ${item('Tipe', v.model)}
      ${item('Jenis', v.vehicle_type)}
      ${item('Tahun', v.year)}
      ${item('Warna', v.color)}
      ${item('No. Rangka', v.chassis_number)}
      ${item('No. Mesin', v.engine_number)}
      ${item('Nama STNK', v.stnk_owner_name)}
      ${item('Area Rental', v.rental_area)}
      ${item('Status', VEHICLE_STATUS[v.status] ?? v.status)}
      ${item('Penyewa', v.renter_name)}
      ${item('Periode Rental', v.rental_start ? `${fmtDate(v.rental_start)} – ${v.rental_end ? fmtDate(v.rental_end) : 'belum ditentukan'}` : '')}
      ${item('No. STNK', v.stnk_number)}
      ${item('Pajak STNK', v.stnk_tax_expiry ? `${fmtDate(v.stnk_tax_expiry)} (${tax.label})` : '')}
      ${item('STNK 5 Tahun', v.stnk_expiry ? `${fmtDate(v.stnk_expiry)} (${stnk.label})` : '')}
      ${item('No. KIR', v.kir_number)}
      ${item('Masa KIR', v.kir_expiry ? `${fmtDate(v.kir_expiry)} (${kir.label})` : '')}
      ${item('Catatan', v.notes)}
    </div>`
  });
}

async function openVehicleDialog(content, ctx, existing) {
  const { businessUnitId, masters } = ctx;
  const isEdit = !!existing;
  const brandOptions = masters.brands.map((b) => ({ value: b.name, label: b.name }));
  const areaOptions = masters.areas.map((a) => ({ value: a.name, label: a.name }));
  // Array HIDUP: isinya diganti di tempat saat merk berubah, sehingga daftar
  // Tipe langsung ikut menyesuaikan tanpa perlu me-render ulang dialog.
  const modelOptions = modelOptionsFor(masters, existing?.brand ?? '');

  const values = await formDialog({
    title: isEdit ? `Edit Kendaraan ${existing.plate_number}` : 'Tambah Kendaraan',
    description: 'Merk, Tipe, dan Area Rental bisa langsung ditambah dari sini — ketik nama baru lalu pilih “+ Tambah”.',
    fields: [
      { name: 'plate_number', label: 'Nomor Polisi', type: 'text', required: true, value: existing?.plate_number ?? '', placeholder: 'B 1234 XYZ' },
      {
        name: 'brand',
        label: 'Merk',
        type: 'searchselect',
        allowCreate: true,
        value: existing?.brand ?? '',
        options: brandOptions,
        placeholder: 'ketik / pilih merk…',
        help: 'Belum ada di daftar? Ketik nama merk baru lalu pilih “+ Tambah”.'
      },
      {
        name: 'model',
        label: 'Tipe',
        type: 'searchselect',
        allowCreate: true,
        value: existing?.model ?? '',
        options: modelOptions,
        placeholder: 'pilih merk dulu…',
        help: 'Daftar tipe mengikuti merk yang dipilih.'
      },
      { name: 'vehicle_type', label: 'Jenis Kendaraan', type: 'select', value: existing?.vehicle_type ?? '', options: VEHICLE_TYPES },
      { name: 'year', label: 'Tahun', type: 'number', min: 1900, value: existing?.year ?? '' },
      { name: 'color', label: 'Warna', type: 'text', value: existing?.color ?? '' },
      { name: 'chassis_number', label: 'No. Rangka', type: 'text', value: existing?.chassis_number ?? '' },
      { name: 'engine_number', label: 'No. Mesin', type: 'text', value: existing?.engine_number ?? '' },
      { name: 'stnk_owner_name', label: 'Nama STNK', type: 'text', value: existing?.stnk_owner_name ?? '', placeholder: 'nama pemilik sesuai STNK' },
      {
        name: 'rental_area',
        label: 'Area Rental',
        type: 'searchselect',
        allowCreate: true,
        value: existing?.rental_area ?? '',
        options: areaOptions,
        placeholder: 'ketik / pilih area…',
        help: 'Dipakai bersama semua admin supaya penulisan area seragam.'
      },
      { name: 'status', label: 'Status', type: 'select', required: true, value: existing?.status ?? 'idle', options: STATUS_OPTIONS },
      { name: 'stnk_number', label: 'No. STNK', type: 'text', value: existing?.stnk_number ?? '' },
      { name: 'stnk_tax_expiry', label: 'Jatuh tempo pajak STNK (tahunan)', type: 'date', value: existing?.stnk_tax_expiry ?? '' },
      { name: 'stnk_expiry', label: 'Masa berlaku STNK (5 tahun)', type: 'date', value: existing?.stnk_expiry ?? '' },
      { name: 'kir_number', label: 'No. KIR', type: 'text', value: existing?.kir_number ?? '' },
      { name: 'kir_expiry', label: 'Masa berlaku KIR', type: 'date', value: existing?.kir_expiry ?? '' },
      { name: 'notes', label: 'Catatan', type: 'text', value: existing?.notes ?? '' },
      ...(isEdit ? [{ name: 'is_active', label: 'Aktif', type: 'checkbox', value: existing.is_active }] : [])
    ],
    submitText: 'Simpan',
    onReady: (form) => {
      const brandWidget = form.querySelector('.search-select[data-name="brand"]');
      const modelWidget = form.querySelector('.search-select[data-name="model"]');
      if (!brandWidget || !modelWidget) return;
      const modelText = modelWidget.querySelector('.ss-input');
      const modelHidden = modelWidget.querySelector('input[type="hidden"]');

      let currentBrand = norm(existing?.brand ?? '');

      const syncModels = (brandName, { clear = true } = {}) => {
        const next = modelOptionsFor(masters, brandName);
        // Mutasi di tempat supaya closure di wireSearchSelect ikut terbarui.
        modelOptions.length = 0;
        modelOptions.push(...next);
        modelText.placeholder = brandName ? 'ketik / pilih tipe…' : 'pilih merk dulu…';
        // Tipe lama hanya dikosongkan kalau MERKNYA benar-benar berganti —
        // jangan sampai tipe lama hilang cuma karena belum terdaftar di master.
        if (clear && !same(brandName, currentBrand) && modelHidden.value) {
          modelHidden.value = '';
          modelText.value = '';
        }
        currentBrand = norm(brandName);
      };

      // Berlaku untuk pilih-dari-daftar maupun ketik merk baru.
      brandWidget.querySelector('.ss-input').addEventListener('input', (e) => syncModels(e.target.value));
      brandWidget.querySelector('.ss-list').addEventListener('mousedown', (e) => {
        const li = e.target.closest('li[data-val]');
        if (li) syncModels(li.dataset.val);
      });
      syncModels(existing?.brand ?? '', { clear: false });
    }
  });
  if (!values) return;

  // Daftarkan master baru dulu supaya pilihan berikutnya seragam.
  try {
    const brand = await ensureBrand(businessUnitId, values.brand);
    if (brand) await ensureModel(businessUnitId, brand.id, values.model);
    await ensureArea(businessUnitId, values.rental_area);
    await refreshMasters(ctx);
  } catch (error) {
    toast(`Master tidak tersimpan: ${error.message ?? error}`, 'warning');
  }

  const payload = {
    business_unit_id: businessUnitId,
    plate_number: values.plate_number,
    brand: values.brand,
    model: values.model,
    vehicle_type: values.vehicle_type,
    year: values.year ? Number(values.year) : null,
    color: values.color,
    chassis_number: values.chassis_number,
    engine_number: values.engine_number,
    stnk_owner_name: values.stnk_owner_name,
    rental_area: values.rental_area,
    status: values.status,
    stnk_number: values.stnk_number,
    stnk_tax_expiry: values.stnk_tax_expiry,
    stnk_expiry: values.stnk_expiry,
    kir_number: values.kir_number,
    kir_expiry: values.kir_expiry,
    notes: values.notes,
    ...(isEdit ? { is_active: values.is_active } : {})
  };
  try {
    if (isEdit) await updateVehicle(existing.id, payload);
    else await createVehicle(payload);
    toast(isEdit ? 'Kendaraan diperbarui.' : 'Kendaraan ditambahkan.', 'success');
    renderVehiclesTab(content, ctx);
  } catch (error) {
    toast(error.message ?? 'Gagal menyimpan (nomor polisi mungkin sudah dipakai).', 'error');
  }
}

async function openRentalDialog(content, ctx, v) {
  if (!v) return;
  const { businessUnitId, masters } = ctx;
  const values = await formDialog({
    title: `Rentalkan ${v.plate_number}`,
    fields: [
      { name: 'renter_name', label: 'Nama Penyewa', type: 'text', required: true },
      {
        name: 'rental_area',
        label: 'Area Rental',
        type: 'searchselect',
        allowCreate: true,
        value: v.rental_area ?? '',
        options: masters.areas.map((a) => ({ value: a.name, label: a.name })),
        placeholder: 'ketik / pilih area…',
        help: 'Kosongkan untuk memakai area kendaraan saat ini.'
      },
      { name: 'start_date', label: 'Mulai', type: 'date', required: true, value: todayWIB() },
      { name: 'end_date', label: 'Sampai (opsional)', type: 'date' },
      { name: 'notes', label: 'Catatan', type: 'text' }
    ],
    submitText: 'Mulai Rental'
  });
  if (!values) return;
  try {
    if (values.rental_area) {
      await ensureArea(businessUnitId, values.rental_area).catch(() => {});
      await refreshMasters(ctx);
    }
    await startRental({
      businessUnitId,
      vehicleId: v.id,
      renterName: values.renter_name,
      rentalArea: values.rental_area,
      startDate: values.start_date,
      endDate: values.end_date,
      notes: values.notes
    });
    toast('Kendaraan ditandai sedang direntalkan.', 'success');
    renderVehiclesTab(content, ctx);
  } catch (error) {
    toast(error.message ?? 'Gagal memulai rental.', 'error');
  }
}

// ---- Import massal ----

async function openImportDialog(content, ctx) {
  const values = await formDialog({
    title: 'Import Data Kendaraan',
    description:
      'Unggah file .xlsx / .csv. Kolom wajib: Nomor Polisi. Kolom lain opsional: Merk, Tipe, Jenis, Tahun, Warna, No Rangka, No Mesin, Nama STNK, Area Rental, Status, No STNK, Pajak STNK, STNK 5 Tahun, No KIR, Masa KIR, Catatan. Merk/Tipe/Area baru otomatis masuk ke master.',
    fields: [
      { name: 'file', label: 'File .xlsx / .csv', type: 'file', required: true, accept: '.xlsx,.xls,.csv' },
      {
        name: 'update_existing',
        label: 'Perbarui kendaraan yang nomor polisinya sudah ada',
        type: 'checkbox',
        value: true
      }
    ],
    submitText: 'Import',
    onReady: (form) => {
      // Tombol template diselipkan di dalam form supaya user bisa ambil contoh
      // formatnya tanpa menutup dialog.
      const p = document.createElement('p');
      p.innerHTML = '<button type="button" id="fl-tpl" class="btn-ghost">⇩ Download template</button>';
      form.appendChild(p);
      p.querySelector('#fl-tpl').addEventListener('click', () => downloadVehicleTemplate());
    }
  });
  if (!values?.file) return;

  toast('Memproses file…', 'info');
  try {
    const res = await importVehicles(ctx.businessUnitId, values.file, { updateExisting: values.update_existing });
    await refreshMasters(ctx);
    await infoDialog({
      title: 'Hasil Import Kendaraan',
      bodyHtml: `<div class="profile-list">
        <div class="profile-row"><span class="profile-label">Ditambahkan</span><span class="profile-value">${res.added}</span></div>
        <div class="profile-row"><span class="profile-label">Diperbarui</span><span class="profile-value">${res.updated}</span></div>
        <div class="profile-row"><span class="profile-label">Dilewati</span><span class="profile-value">${res.skipped}</span></div>
        <div class="profile-row"><span class="profile-label">Merk baru</span><span class="profile-value">${res.newBrands}</span></div>
        <div class="profile-row"><span class="profile-label">Tipe baru</span><span class="profile-value">${res.newModels}</span></div>
        <div class="profile-row"><span class="profile-label">Area baru</span><span class="profile-value">${res.newAreas}</span></div>
      </div>
      ${
        res.errors.length
          ? `<p style="margin-top:10px;font-weight:600">Gagal (${res.errors.length}):</p>
             <ul style="font-size:0.82rem;color:var(--color-danger);max-height:180px;overflow:auto;padding-left:18px">
               ${res.errors.slice(0, 50).map((e) => `<li>${esc(e)}</li>`).join('')}
             </ul>`
          : '<p style="margin-top:10px;color:var(--color-text-muted);font-size:0.85rem">Semua baris berhasil diproses.</p>'
      }`
    });
    renderVehiclesTab(content, ctx);
  } catch (error) {
    toast(error.message ?? 'Gagal mengimport file.', 'error');
  }
}

async function exportVehicles(rows, settings, subtitle) {
  if (!rows.length) return toast('Tidak ada data untuk diexport.', 'warning');
  try {
    await exportTablePDF({
      title: 'Data Kendaraan (Armada)',
      subtitle: `${subtitle} · ${rows.length} kendaraan`,
      columns: [
        { header: 'Plat', width: 1 },
        { header: 'Merk/Tipe', width: 1.4 },
        { header: 'Area Rental', width: 1.2 },
        { header: 'Nama STNK', width: 1.2 },
        { header: 'Status', width: 0.9 },
        { header: 'Penyewa', width: 1.2 },
        { header: 'Pajak STNK', width: 1.1 },
        { header: 'KIR', width: 1.1 }
      ],
      rows: rows.map((v) => [
        v.plate_number,
        [v.brand, v.model].filter(Boolean).join(' ') || '-',
        v.rental_area ?? '-',
        v.stnk_owner_name ?? '-',
        VEHICLE_STATUS[v.status] ?? v.status,
        v.status === 'rented' ? v.renter_name ?? '-' : '-',
        v.stnk_tax_expiry ? `${v.stnk_tax_expiry} (${docStatus(v.stnk_tax_expiry, settings.reminder_lead_days).label})` : '-',
        v.kir_expiry ? `${v.kir_expiry} (${docStatus(v.kir_expiry, settings.reminder_lead_days).label})` : '-'
      ]),
      filename: 'data-kendaraan'
    });
    toast('PDF data kendaraan terunduh.', 'success');
  } catch (error) {
    toast(error.message ?? 'Gagal membuat PDF.', 'error');
  }
}

// ---- Tab: Rental ----

async function renderRentalTab(content, ctx) {
  const { businessUnitId } = ctx;
  content.innerHTML = loadingHtml('Memuat rental…', { baris: 5 });
  let vehicles, rentals;
  try {
    [vehicles, rentals] = await Promise.all([listVehicles(businessUnitId), listRentals(businessUnitId)]);
  } catch (error) {
    content.innerHTML = `<p class="error-text">${error.message ?? error}</p>`;
    return;
  }
  const active = vehicles.filter((v) => v.status === 'rented');
  const areaOf = new Map(vehicles.map((v) => [v.id, v.rental_area]));

  content.innerHTML = `
    <h2 style="font-size:1.05rem">Sedang Direntalkan (${active.length})</h2>
    <div class="table-scroll">
      <table class="data-table table-freeze-1">
        <thead><tr><th>Plat</th><th>Penyewa</th><th>Area Rental</th><th>Mulai</th><th>Sampai</th><th>Catatan</th></tr></thead>
        <tbody>
          ${
            active
              .map(
                (v) => `<tr>
                  <td><strong>${esc(v.plate_number)}</strong></td>
                  <td>${esc(v.renter_name ?? '-')}</td>
                  <td>${esc(v.rental_area ?? '-')}</td>
                  <td>${v.rental_start ? fmtDate(v.rental_start) : '-'}</td>
                  <td>${v.rental_end ? fmtDate(v.rental_end) : '<span style="color:var(--color-text-muted)">belum ditentukan</span>'}</td>
                  <td style="font-size:0.8rem">${esc(v.rental_notes ?? '-')}</td>
                </tr>`
              )
              .join('') || '<tr><td colspan="6">Tidak ada kendaraan yang sedang direntalkan.</td></tr>'
          }
        </tbody>
      </table>
    </div>

    <h2 style="font-size:1.05rem;margin-top:20px">Riwayat Rental</h2>
    <div class="table-scroll">
      <table class="data-table table-freeze-1">
        <thead><tr><th>Plat</th><th>Penyewa</th><th>Area Rental</th><th>Mulai</th><th>Selesai</th></tr></thead>
        <tbody>
          ${
            rentals
              .map(
                (r) => `<tr>
                  <td>${esc(r.vehicles?.plate_number ?? '-')}</td>
                  <td>${esc(r.renter_name)}</td>
                  <td>${esc(r.rental_area ?? areaOf.get(r.vehicle_id) ?? '-')}</td>
                  <td>${fmtDate(r.start_date)}</td>
                  <td>${r.end_date ? fmtDate(r.end_date) : '<span class="badge badge-pending">berjalan</span>'}</td>
                </tr>`
              )
              .join('') || '<tr><td colspan="5">Belum ada riwayat rental.</td></tr>'
          }
        </tbody>
      </table>
    </div>
  `;
}

// ---- Tab: Dokumen & Reminder ----

async function renderDocsTab(content, ctx) {
  const { businessUnitId, settings } = ctx;
  content.innerHTML = loadingHtml('Memuat dokumen…', { baris: 5 });
  let vehicles;
  try {
    vehicles = await listVehicles(businessUnitId);
  } catch (error) {
    content.innerHTML = `<p class="error-text">${error.message ?? error}</p>`;
    return;
  }
  const lead = settings.reminder_lead_days;

  // Satu baris per dokumen supaya mudah diurutkan berdasarkan yang paling mendesak.
  const docs = [];
  for (const v of vehicles) {
    if (v.is_active === false) continue;
    const push = (jenis, tanggal) => {
      const st = docStatus(tanggal, lead);
      if (st.level === 'none') return;
      docs.push({ v, jenis, tanggal, st });
    };
    push('Pajak STNK (tahunan)', v.stnk_tax_expiry);
    push('STNK (5 tahun)', v.stnk_expiry);
    push('KIR', v.kir_expiry);
  }
  docs.sort((a, b) => (a.st.days ?? 9999) - (b.st.days ?? 9999));
  const perlu = docs.filter((d) => d.st.level === 'expired' || d.st.level === 'urgent');
  const belumDiisi = vehicles.filter((v) => v.is_active !== false && (!v.stnk_tax_expiry || !v.kir_expiry));

  content.innerHTML = `
    <div class="incoming-highlight${perlu.length ? ' has-items' : ''}">
      <div class="incoming-head">
        <h2>🔔 Perlu Perpanjangan${perlu.length ? ` <span class="incoming-count">${perlu.length}</span>` : ''}</h2>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          ${perlu.length ? '<button id="fl-share-doc">📤 Kirim via WhatsApp</button><button id="fl-export-doc">⇩ Export PDF</button>' : ''}
        </div>
      </div>
      ${
        perlu.length
          ? `<p style="font-size:0.8rem;color:var(--color-text-muted);margin:6px 0 0">Ambang peringatan: ${lead} hari sebelum jatuh tempo (diatur di tab Pengaturan).</p>
             <div class="table-scroll" style="margin-top:10px">
               <table class="data-table table-freeze-1">
                 <thead><tr><th>Plat</th><th>Kendaraan</th><th>Area</th><th>Dokumen</th><th>Jatuh Tempo</th><th>Status</th></tr></thead>
                 <tbody>
                   ${perlu
                     .map(
                       (d) => `<tr>
                         <td><strong>${esc(d.v.plate_number)}</strong></td>
                         <td style="font-size:0.82rem">${esc([d.v.brand, d.v.model].filter(Boolean).join(' ') || '-')}</td>
                         <td style="font-size:0.82rem">${esc(d.v.rental_area ?? '-')}</td>
                         <td>${d.jenis}</td>
                         <td>${fmtDate(d.tanggal)}</td>
                         <td><span class="badge ${DOC_BADGE[d.st.level]}">${d.st.level === 'expired' ? 'Kedaluwarsa' : 'Segera'} · ${esc(d.st.label)}</span></td>
                       </tr>`
                     )
                     .join('')}
                 </tbody>
               </table>
             </div>`
          : '<p class="incoming-empty">Tidak ada dokumen yang mendekati jatuh tempo. 👍</p>'
      }
    </div>

    <h2 style="font-size:1.05rem;margin-top:18px">Semua Dokumen</h2>
    <div class="table-scroll">
      <table class="data-table table-freeze-1">
        <thead><tr><th>Plat</th><th>Dokumen</th><th>Nomor</th><th>Jatuh Tempo</th><th>Status</th></tr></thead>
        <tbody>
          ${
            docs
              .map(
                (d) => `<tr>
                  <td>${esc(d.v.plate_number)}</td>
                  <td>${d.jenis}</td>
                  <td style="font-size:0.8rem">${esc(d.jenis === 'KIR' ? d.v.kir_number ?? '-' : d.v.stnk_number ?? '-')}</td>
                  <td>${fmtDate(d.tanggal)}</td>
                  <td><span class="badge ${DOC_BADGE[d.st.level]}">${esc(d.st.label)}</span></td>
                </tr>`
              )
              .join('') || '<tr><td colspan="5">Belum ada tanggal dokumen yang diisi.</td></tr>'
          }
        </tbody>
      </table>
    </div>
    ${
      belumDiisi.length
        ? `<p style="font-size:0.8rem;color:var(--color-text-muted);margin-top:8px">
             ${belumDiisi.length} kendaraan belum lengkap tanggal dokumennya: ${belumDiisi.map((v) => esc(v.plate_number)).join(', ')}
           </p>`
        : ''
    }
  `;

  content.querySelector('#fl-share-doc')?.addEventListener('click', () => {
    const text = [
      '*Pengingat Perpanjangan Dokumen Kendaraan*',
      `Per ${fmtDate(todayWIB())}`,
      '',
      ...perlu.map(
        (d) => `• ${d.v.plate_number}${d.v.rental_area ? ` (${d.v.rental_area})` : ''} — ${d.jenis}: ${fmtDate(d.tanggal)} (${d.st.level === 'expired' ? 'KEDALUWARSA' : 'segera'} ${d.st.label})`
      )
    ].join('\n');
    shareDialog({ title: 'Kirim Pengingat Dokumen', helper: 'Teks bisa diedit sebelum dikirim.', defaultMessage: text });
  });

  content.querySelector('#fl-export-doc')?.addEventListener('click', async () => {
    try {
      await exportTablePDF({
        title: 'Dokumen Kendaraan Perlu Perpanjangan',
        subtitle: `Ambang ${lead} hari · per ${fmtDate(todayWIB())}`,
        columns: [
          { header: 'Plat', width: 1 },
          { header: 'Kendaraan', width: 1.3 },
          { header: 'Area', width: 1.1 },
          { header: 'Dokumen', width: 1.2 },
          { header: 'Jatuh Tempo', width: 1 },
          { header: 'Status', width: 1.2 }
        ],
        rows: perlu.map((d) => [
          d.v.plate_number,
          [d.v.brand, d.v.model].filter(Boolean).join(' ') || '-',
          d.v.rental_area ?? '-',
          d.jenis,
          d.tanggal,
          `${d.st.level === 'expired' ? 'Kedaluwarsa' : 'Segera'} — ${d.st.label}`
        ]),
        filename: 'dokumen-kendaraan'
      });
      toast('PDF pengingat dokumen terunduh.', 'success');
    } catch (error) {
      toast(error.message ?? 'Gagal membuat PDF.', 'error');
    }
  });
}

// ---- Tab: Pengaturan (reminder + master data) ----

async function renderSettingsTab(content, ctx) {
  const { businessUnitId, settings } = ctx;
  content.innerHTML = `
    <div class="inline-card" style="max-width:420px">
      <h3 style="margin-top:0">Pengaturan Reminder</h3>
      <div class="field">
        <label>Peringatkan berapa hari sebelum jatuh tempo?</label>
        <input type="number" id="fl-lead" min="1" value="${settings.reminder_lead_days}" />
        <span class="field-help">Dipakai untuk STNK (pajak & 5 tahun) dan KIR.</span>
      </div>
      <button class="primary" id="fl-save-settings" style="max-width:200px">Simpan</button>
    </div>

    <div class="inline-card" style="margin-top:16px">
      <h3 style="margin-top:0">Master Data</h3>
      <p style="font-size:0.82rem;color:var(--color-text-muted);margin-top:0">
        Daftar pilihan yang dipakai di form kendaraan. Mengubah nama di sini ikut memperbarui kendaraan yang memakainya.
      </p>
      <div id="fl-masters"></div>
    </div>
  `;

  content.querySelector('#fl-save-settings').addEventListener('click', async () => {
    const val = Number(content.querySelector('#fl-lead').value);
    if (!(val >= 1)) return toast('Isi jumlah hari yang valid.', 'warning');
    try {
      await upsertFleetSettings(businessUnitId, { reminder_lead_days: val });
      settings.reminder_lead_days = val;
      toast('Pengaturan reminder disimpan.', 'success');
    } catch (error) {
      toast(error.message ?? 'Gagal menyimpan.', 'error');
    }
  });

  drawMasters(content.querySelector('#fl-masters'), ctx);
}

function drawMasters(host, ctx) {
  const { masters } = ctx;
  const modelsOf = (brandId) => masters.models.filter((m) => m.brand_id === brandId);

  host.innerHTML = `
    <div style="display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(280px,1fr))">
      <div>
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
          <h4 style="margin:0;font-size:0.95rem">Merk & Tipe</h4>
          <button id="fl-add-brand">+ Merk</button>
        </div>
        <div style="margin-top:8px">
          ${
            masters.brands
              .map(
                (b) => `<div class="inline-card" style="padding:10px;margin-bottom:8px">
                  <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
                    <strong>${esc(b.name)}</strong>
                    <span style="display:flex;gap:6px">
                      <button class="fl-add-model" data-id="${b.id}" data-name="${escAttr(b.name)}">+ Tipe</button>
                      <button class="fl-ren" data-kind="brand" data-id="${b.id}" data-name="${escAttr(b.name)}">Ubah</button>
                      <button class="fl-delm" data-kind="brand" data-id="${b.id}" data-name="${escAttr(b.name)}">Hapus</button>
                    </span>
                  </div>
                  <div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:6px">
                    ${
                      modelsOf(b.id)
                        .map(
                          (m) => `<span class="scope-badge">${esc(m.name)}
                            <button class="fl-ren scope-edit" data-kind="model" data-id="${m.id}" data-name="${escAttr(m.name)}" data-brand="${b.id}">✎</button>
                            <button class="fl-delm scope-remove" data-kind="model" data-id="${m.id}" data-name="${escAttr(m.name)}">✕</button>
                          </span>`
                        )
                        .join('') || '<span style="font-size:0.8rem;color:var(--color-text-muted)">belum ada tipe</span>'
                    }
                  </div>
                </div>`
              )
              .join('') || '<p style="color:var(--color-text-muted);font-size:0.85rem">Belum ada merk. Tambah dari sini atau langsung dari form kendaraan.</p>'
          }
        </div>
      </div>

      <div>
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
          <h4 style="margin:0;font-size:0.95rem">Area Rental</h4>
          <button id="fl-add-area">+ Area</button>
        </div>
        <div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:6px">
          ${
            masters.areas
              .map(
                (a) => `<span class="scope-badge">${esc(a.name)}
                  <button class="fl-ren scope-edit" data-kind="area" data-id="${a.id}" data-name="${escAttr(a.name)}">✎</button>
                  <button class="fl-delm scope-remove" data-kind="area" data-id="${a.id}" data-name="${escAttr(a.name)}">✕</button>
                </span>`
              )
              .join('') || '<p style="color:var(--color-text-muted);font-size:0.85rem">Belum ada area rental.</p>'
          }
        </div>
      </div>
    </div>
  `;

  const reload = async () => {
    await refreshMasters(ctx);
    drawMasters(host, ctx);
  };

  host.querySelector('#fl-add-brand')?.addEventListener('click', sekaliJalan(async () => {
    const v = await formDialog({ title: 'Tambah Merk', fields: [{ name: 'name', label: 'Nama merk', type: 'text', required: true }], submitText: 'Tambah' });
    if (!v) return;
    try {
      await ensureBrand(ctx.businessUnitId, v.name);
      toast('Merk ditambahkan.', 'success');
      reload();
    } catch (error) {
      toast(error.message ?? 'Gagal menambah merk.', 'error');
    }
  }));

  host.querySelector('#fl-add-area')?.addEventListener('click', sekaliJalan(async () => {
    const v = await formDialog({ title: 'Tambah Area Rental', fields: [{ name: 'name', label: 'Nama area', type: 'text', required: true }], submitText: 'Tambah' });
    if (!v) return;
    try {
      await ensureArea(ctx.businessUnitId, v.name);
      toast('Area ditambahkan.', 'success');
      reload();
    } catch (error) {
      toast(error.message ?? 'Gagal menambah area.', 'error');
    }
  }));

  host.querySelectorAll('.fl-add-model').forEach((btn) =>
    btn.addEventListener('click', sekaliJalan(async () => {
      const v = await formDialog({
        title: `Tambah Tipe — ${btn.dataset.name}`,
        fields: [{ name: 'name', label: 'Nama tipe', type: 'text', required: true, placeholder: 'mis. Avanza' }],
        submitText: 'Tambah'
      });
      if (!v) return;
      try {
        await ensureModel(ctx.businessUnitId, btn.dataset.id, v.name);
        toast('Tipe ditambahkan.', 'success');
        reload();
      } catch (error) {
        toast(error.message ?? 'Gagal menambah tipe.', 'error');
      }
    }))
  );

  host.querySelectorAll('.fl-ren').forEach((btn) =>
    btn.addEventListener('click', sekaliJalan(async () => {
      const v = await formDialog({
        title: 'Ubah Nama',
        fields: [{ name: 'name', label: 'Nama baru', type: 'text', required: true, value: btn.dataset.name }],
        submitText: 'Simpan'
      });
      if (!v) return;
      try {
        await renameMaster(btn.dataset.kind, btn.dataset.id, v.name, {
          businessUnitId: ctx.businessUnitId,
          oldName: btn.dataset.name,
          brandId: btn.dataset.brand
        });
        toast('Nama diperbarui.', 'success');
        reload();
      } catch (error) {
        toast(error.message ?? 'Gagal mengubah nama.', 'error');
      }
    }))
  );

  host.querySelectorAll('.fl-delm').forEach((btn) =>
    btn.addEventListener('click', sekaliJalan(async () => {
      const ok = await confirmDialog({
        title: `Hapus "${btn.dataset.name}"?`,
        message:
          btn.dataset.kind === 'brand'
            ? 'Semua tipe di bawah merk ini ikut terhapus dari master. Data kendaraan tidak ikut terhapus.'
            : 'Hanya dihapus dari daftar pilihan. Data kendaraan tidak ikut terhapus.',
        confirmText: 'Hapus',
        danger: true
      });
      if (!ok) return;
      try {
        await deleteMaster(btn.dataset.kind, btn.dataset.id);
        toast('Dihapus dari master.', 'success');
        reload();
      } catch (error) {
        toast(error.message ?? 'Gagal menghapus.', 'error');
      }
    }))
  );
}

function fmtDate(d) {
  return d ? new Date(d + 'T00:00:00').toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) : '-';
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escAttr(s) {
  return esc(s);
}
