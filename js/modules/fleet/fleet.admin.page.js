import { toast, confirmDialog, formDialog, infoDialog, shareDialog, fuzzyMatch } from '../../core/ui.js';
import { exportTablePDF } from '../../core/pdf.js';
import { todayWIB } from '../../core/dates.js';
import { listAttendanceOutlets } from '../attendance/attendance.service.js';
import {
  VEHICLE_STATUS,
  STATUS_BADGE,
  STATUS_OPTIONS,
  VEHICLE_TYPES,
  OWNERSHIP_OPTIONS,
  DOC_BADGE,
  docStatus,
  getFleetSettings,
  upsertFleetSettings,
  listVehicles,
  createVehicle,
  updateVehicle,
  deleteVehicle,
  startRental,
  endRental,
  listRentals
} from './fleet.service.js';

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
  const [outlets, settings] = await Promise.all([
    listAttendanceOutlets()
      .then((all) => all.filter((o) => o.business_unit_id === businessUnitId))
      .catch(() => []),
    getFleetSettings(businessUnitId).catch(() => ({ reminder_lead_days: 30 }))
  ]);

  async function showTab(key) {
    container.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === key));
    if (key === 'vehicles') await renderVehiclesTab(content, businessUnitId, outlets, settings);
    if (key === 'rental') await renderRentalTab(content, businessUnitId);
    if (key === 'docs') await renderDocsTab(content, businessUnitId, settings);
    if (key === 'settings') await renderSettingsTab(content, businessUnitId, settings);
  }
  container.querySelectorAll('.tab-btn').forEach((btn) => btn.addEventListener('click', () => showTab(btn.dataset.tab)));
  await showTab('vehicles');
}

// ---- Tab: Kendaraan ----

async function renderVehiclesTab(content, businessUnitId, outlets, settings) {
  content.innerHTML = `<p style="color:var(--color-text-muted)">Memuat kendaraan...</p>`;
  let vehicles;
  try {
    vehicles = await listVehicles(businessUnitId);
  } catch (error) {
    content.innerHTML = `<p class="error-text">${error.message ?? error}</p>`;
    return;
  }
  const state = { q: '', status: '' };

  content.innerHTML = `
    <div class="page-header">
      <h2 style="font-size:1.05rem;margin:0">Data Kendaraan</h2>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button id="fl-export">⇩ Export PDF</button>
        <button class="primary" id="fl-new" style="max-width:190px">+ Tambah Kendaraan</button>
      </div>
    </div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin-bottom:10px">
      <div class="field" style="margin:0;max-width:200px"><label>Status</label>
        <select id="fl-status"><option value="">Semua</option>${STATUS_OPTIONS.map((s) => `<option value="${s.value}">${s.label}</option>`).join('')}</select>
      </div>
      <div class="field" style="margin:0;max-width:240px"><label>Cari</label>
        <input type="text" id="fl-q" placeholder="plat / merek / tipe…" />
      </div>
    </div>
    <div id="fl-list"></div>
  `;

  const list = content.querySelector('#fl-list');
  content.querySelector('#fl-status').addEventListener('change', (e) => {
    state.status = e.target.value;
    draw();
  });
  content.querySelector('#fl-q').addEventListener('input', (e) => {
    state.q = e.target.value;
    draw();
  });
  content.querySelector('#fl-new').addEventListener('click', () => openVehicleDialog(content, businessUnitId, outlets, settings, null));
  content.querySelector('#fl-export').addEventListener('click', () => exportVehicles(visible(), settings));

  function visible() {
    return vehicles.filter(
      (v) =>
        (!state.status || v.status === state.status) &&
        (!state.q || fuzzyMatch(state.q, `${v.plate_number} ${v.brand ?? ''} ${v.model ?? ''} ${v.vehicle_type ?? ''} ${v.renter_name ?? ''} ${v.rental_area ?? ''}`))
    );
  }

  function draw() {
    const rows = visible();
    list.innerHTML = `
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr><th>Plat</th><th>Kendaraan</th><th>Status</th><th>Area / Penyewa</th><th>STNK (pajak)</th><th>KIR</th><th>Aksi</th></tr></thead>
          <tbody>
            ${
              rows
                .map((v) => {
                  const tax = docStatus(v.stnk_tax_expiry, settings.reminder_lead_days);
                  const kir = docStatus(v.kir_expiry, settings.reminder_lead_days);
                  return `<tr>
                    <td><strong>${esc(v.plate_number)}</strong>${v.is_active === false ? ' <span style="font-size:0.7rem;color:var(--color-danger)">(nonaktif)</span>' : ''}</td>
                    <td style="font-size:0.85rem">${esc([v.brand, v.model].filter(Boolean).join(' ') || '-')}
                      <div style="font-size:0.74rem;color:var(--color-text-muted)">${esc(v.vehicle_type ?? '-')}${v.year ? ` · ${v.year}` : ''}${v.color ? ` · ${esc(v.color)}` : ''}</div></td>
                    <td><span class="badge ${STATUS_BADGE[v.status] ?? ''}">${VEHICLE_STATUS[v.status] ?? v.status}</span></td>
                    <td style="font-size:0.82rem">${
                      v.status === 'rented'
                        ? `${esc(v.rental_area ?? '-')}<div style="font-size:0.74rem;color:var(--color-text-muted)">${esc(v.renter_name ?? '-')}${v.rental_end ? ` · s/d ${fmtDate(v.rental_end)}` : ''}</div>`
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
                .join('') || '<tr><td colspan="7">Belum ada kendaraan.</td></tr>'
            }
          </tbody>
        </table>
      </div>`;

    const byId = (id) => vehicles.find((v) => v.id === id);
    list.querySelectorAll('.fl-edit').forEach((b) => b.addEventListener('click', () => openVehicleDialog(content, businessUnitId, outlets, settings, byId(b.dataset.id))));
    list.querySelectorAll('.fl-detail').forEach((b) => b.addEventListener('click', () => showDetail(byId(b.dataset.id), settings)));
    list.querySelectorAll('.fl-start').forEach((b) => b.addEventListener('click', () => openRentalDialog(content, businessUnitId, outlets, settings, byId(b.dataset.id))));
    list.querySelectorAll('.fl-end').forEach((b) =>
      b.addEventListener('click', async () => {
        const v = byId(b.dataset.id);
        const ok = await confirmDialog({
          title: 'Selesaikan rental?',
          message: `${v.plate_number} akan kembali berstatus Tersedia.`,
          confirmText: 'Selesaikan'
        });
        if (!ok) return;
        try {
          await endRental(v.id, todayWIB());
          toast('Rental diselesaikan.', 'success');
          renderVehiclesTab(content, businessUnitId, outlets, settings);
        } catch (error) {
          toast(error.message ?? 'Gagal menyelesaikan rental.', 'error');
        }
      })
    );
    list.querySelectorAll('.fl-del').forEach((b) =>
      b.addEventListener('click', async () => {
        const ok = await confirmDialog({ title: 'Hapus kendaraan?', message: 'Riwayat rental kendaraan ini ikut terhapus.', confirmText: 'Hapus', danger: true });
        if (!ok) return;
        try {
          await deleteVehicle(b.dataset.id);
          toast('Kendaraan dihapus.', 'success');
          renderVehiclesTab(content, businessUnitId, outlets, settings);
        } catch (error) {
          toast(error.message ?? 'Gagal menghapus.', 'error');
        }
      })
    );
  }

  draw();
}

function docCell(dateStr, st) {
  if (!dateStr) return '<span style="color:var(--color-text-muted)">-</span>';
  return `${fmtDate(dateStr)}<div><span class="badge ${DOC_BADGE[st.level]}">${st.label}</span></div>`;
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
      ${item('Merek / Model', [v.brand, v.model].filter(Boolean).join(' '))}
      ${item('Jenis', v.vehicle_type)}
      ${item('Tahun', v.year)}
      ${item('Warna', v.color)}
      ${item('No. Rangka', v.chassis_number)}
      ${item('No. Mesin', v.engine_number)}
      ${item('Kepemilikan', v.ownership)}
      ${item('Outlet / Pool', v.outlets?.name)}
      ${item('Status', VEHICLE_STATUS[v.status] ?? v.status)}
      ${item('Penyewa', v.renter_name)}
      ${item('Area Rental', v.rental_area)}
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

async function openVehicleDialog(content, businessUnitId, outlets, settings, existing) {
  const isEdit = !!existing;
  const values = await formDialog({
    title: isEdit ? `Edit Kendaraan ${existing.plate_number}` : 'Tambah Kendaraan',
    fields: [
      { name: 'plate_number', label: 'Nomor Polisi', type: 'text', required: true, value: existing?.plate_number ?? '', placeholder: 'B 1234 XYZ' },
      { name: 'brand', label: 'Merek', type: 'text', value: existing?.brand ?? '' },
      { name: 'model', label: 'Model / Tipe', type: 'text', value: existing?.model ?? '' },
      { name: 'vehicle_type', label: 'Jenis Kendaraan', type: 'select', value: existing?.vehicle_type ?? '', options: VEHICLE_TYPES },
      { name: 'year', label: 'Tahun', type: 'number', min: 1900, value: existing?.year ?? '' },
      { name: 'color', label: 'Warna', type: 'text', value: existing?.color ?? '' },
      { name: 'chassis_number', label: 'No. Rangka', type: 'text', value: existing?.chassis_number ?? '' },
      { name: 'engine_number', label: 'No. Mesin', type: 'text', value: existing?.engine_number ?? '' },
      { name: 'ownership', label: 'Kepemilikan', type: 'select', value: existing?.ownership ?? '', options: OWNERSHIP_OPTIONS },
      {
        name: 'outlet_id',
        label: 'Outlet / Pool',
        type: 'select',
        value: existing?.outlet_id ?? '',
        options: [{ value: '', label: '-- tidak ditentukan --' }, ...outlets.map((o) => ({ value: o.id, label: o.name }))]
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
    submitText: 'Simpan'
  });
  if (!values) return;
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
    ownership: values.ownership,
    outlet_id: values.outlet_id,
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
    renderVehiclesTab(content, businessUnitId, outlets, settings);
  } catch (error) {
    toast(error.message ?? 'Gagal menyimpan (nomor polisi mungkin sudah dipakai).', 'error');
  }
}

async function openRentalDialog(content, businessUnitId, outlets, settings, v) {
  if (!v) return;
  const values = await formDialog({
    title: `Rentalkan ${v.plate_number}`,
    fields: [
      { name: 'renter_name', label: 'Nama Penyewa', type: 'text', required: true },
      { name: 'rental_area', label: 'Area / Lokasi Rental', type: 'text', placeholder: 'mis. Jakarta Selatan' },
      { name: 'start_date', label: 'Mulai', type: 'date', required: true, value: todayWIB() },
      { name: 'end_date', label: 'Sampai (opsional)', type: 'date' },
      { name: 'notes', label: 'Catatan', type: 'text' }
    ],
    submitText: 'Mulai Rental'
  });
  if (!values) return;
  try {
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
    renderVehiclesTab(content, businessUnitId, outlets, settings);
  } catch (error) {
    toast(error.message ?? 'Gagal memulai rental.', 'error');
  }
}

async function exportVehicles(rows, settings) {
  if (!rows.length) return toast('Tidak ada data untuk diexport.', 'warning');
  try {
    await exportTablePDF({
      title: 'Data Kendaraan (Armada)',
      subtitle: `Dicetak untuk ${rows.length} kendaraan`,
      columns: [
        { header: 'Plat', width: 1 },
        { header: 'Merek/Model', width: 1.4 },
        { header: 'Jenis', width: 0.8 },
        { header: 'Tahun', width: 0.6 },
        { header: 'Status', width: 0.9 },
        { header: 'Area/Penyewa', width: 1.5 },
        { header: 'Pajak STNK', width: 1.1 },
        { header: 'STNK 5th', width: 1.1 },
        { header: 'KIR', width: 1.1 }
      ],
      rows: rows.map((v) => [
        v.plate_number,
        [v.brand, v.model].filter(Boolean).join(' ') || '-',
        v.vehicle_type ?? '-',
        v.year ?? '-',
        VEHICLE_STATUS[v.status] ?? v.status,
        v.status === 'rented' ? `${v.rental_area ?? '-'} / ${v.renter_name ?? '-'}` : '-',
        v.stnk_tax_expiry ? `${v.stnk_tax_expiry} (${docStatus(v.stnk_tax_expiry, settings.reminder_lead_days).label})` : '-',
        v.stnk_expiry ?? '-',
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

async function renderRentalTab(content, businessUnitId) {
  content.innerHTML = `<p style="color:var(--color-text-muted)">Memuat rental...</p>`;
  let vehicles, rentals;
  try {
    [vehicles, rentals] = await Promise.all([listVehicles(businessUnitId), listRentals(businessUnitId)]);
  } catch (error) {
    content.innerHTML = `<p class="error-text">${error.message ?? error}</p>`;
    return;
  }
  const active = vehicles.filter((v) => v.status === 'rented');

  content.innerHTML = `
    <h2 style="font-size:1.05rem">Sedang Direntalkan (${active.length})</h2>
    <div class="table-scroll">
      <table class="data-table">
        <thead><tr><th>Plat</th><th>Penyewa</th><th>Area</th><th>Mulai</th><th>Sampai</th><th>Catatan</th></tr></thead>
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
      <table class="data-table">
        <thead><tr><th>Plat</th><th>Penyewa</th><th>Area</th><th>Mulai</th><th>Selesai</th></tr></thead>
        <tbody>
          ${
            rentals
              .map(
                (r) => `<tr>
                  <td>${esc(r.vehicles?.plate_number ?? '-')}</td>
                  <td>${esc(r.renter_name)}</td>
                  <td>${esc(r.rental_area ?? '-')}</td>
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

async function renderDocsTab(content, businessUnitId, settings) {
  content.innerHTML = `<p style="color:var(--color-text-muted)">Memuat dokumen...</p>`;
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
               <table class="data-table">
                 <thead><tr><th>Plat</th><th>Kendaraan</th><th>Dokumen</th><th>Jatuh Tempo</th><th>Status</th></tr></thead>
                 <tbody>
                   ${perlu
                     .map(
                       (d) => `<tr>
                         <td><strong>${esc(d.v.plate_number)}</strong></td>
                         <td style="font-size:0.82rem">${esc([d.v.brand, d.v.model].filter(Boolean).join(' ') || '-')}</td>
                         <td>${d.jenis}</td>
                         <td>${fmtDate(d.tanggal)}</td>
                         <td><span class="badge ${DOC_BADGE[d.st.level]}">${d.st.level === 'expired' ? 'Kedaluwarsa' : 'Segera'} · ${d.st.label}</span></td>
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
      <table class="data-table">
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
                  <td><span class="badge ${DOC_BADGE[d.st.level]}">${d.st.label}</span></td>
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
      ...perlu.map((d) => `• ${d.v.plate_number} — ${d.jenis}: ${fmtDate(d.tanggal)} (${d.st.level === 'expired' ? 'KEDALUWARSA' : 'segera'} ${d.st.label})`)
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
          { header: 'Kendaraan', width: 1.4 },
          { header: 'Dokumen', width: 1.2 },
          { header: 'Jatuh Tempo', width: 1 },
          { header: 'Status', width: 1.2 }
        ],
        rows: perlu.map((d) => [
          d.v.plate_number,
          [d.v.brand, d.v.model].filter(Boolean).join(' ') || '-',
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

// ---- Tab: Pengaturan ----

async function renderSettingsTab(content, businessUnitId, settings) {
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
}

function fmtDate(d) {
  return d ? new Date(d + 'T00:00:00').toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) : '-';
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
