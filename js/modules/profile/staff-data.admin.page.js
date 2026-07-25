import { toast, infoDialog } from '../../core/ui.js';
import { exportTablePDF } from '../../core/pdf.js';
import { listAttendanceOutlets } from '../attendance/attendance.service.js';
import { listBusinessUnitsBasic } from '../organization/organization.service.js';
import { GENDER_LABEL, MARITAL_LABEL, listStaffData, getStaffPhotoUrl } from './profile.service.js';

/** Tab "Data Staff" di grup User: tabel data lengkap staff + filter BU/outlet + export PDF. */
export async function renderStaffDataPage(container, { businessUnitId }) {
  container.innerHTML = `<p style="color:var(--color-text-muted)">Memuat data staff...</p>`;

  let bus = [];
  let outlets = [];
  try {
    [bus, outlets] = await Promise.all([
      listBusinessUnitsBasic().catch(() => []),
      listAttendanceOutlets().catch(() => [])
    ]);
  } catch {
    /* biarkan kosong */
  }
  const state = { buId: businessUnitId, outletId: '', rows: [] };

  container.innerHTML = `
    <div class="inline-card" style="max-width:660px;display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end">
      <div class="field" style="margin:0;max-width:220px"><label>Business Unit</label>
        <select id="sd-bu">${
          bus.length
            ? bus.map((b) => `<option value="${b.id}"${b.id === state.buId ? ' selected' : ''}>${esc(b.name)}</option>`).join('')
            : `<option value="${businessUnitId}">BU aktif</option>`
        }</select>
      </div>
      <div class="field" style="margin:0;max-width:220px"><label>Outlet</label>
        <select id="sd-outlet"></select>
      </div>
      <button class="primary" id="sd-go" style="max-width:120px">Tampilkan</button>
      <button id="sd-export">⇩ Export PDF</button>
    </div>
    <div id="sd-result"></div>
  `;

  const buSel = container.querySelector('#sd-bu');
  const outletSel = container.querySelector('#sd-outlet');

  function fillOutlets() {
    const list = outlets.filter((o) => o.business_unit_id === state.buId);
    outletSel.innerHTML = `<option value="">Semua outlet</option>${list.map((o) => `<option value="${o.id}">${esc(o.name)}</option>`).join('')}`;
  }
  fillOutlets();

  buSel.addEventListener('change', () => {
    state.buId = buSel.value;
    state.outletId = '';
    fillOutlets();
    load();
  });
  outletSel.addEventListener('change', () => {
    state.outletId = outletSel.value;
    load();
  });
  container.querySelector('#sd-go').addEventListener('click', load);
  container.querySelector('#sd-export').addEventListener('click', doExport);

  async function load() {
    const box = container.querySelector('#sd-result');
    box.innerHTML = `<p>Memuat...</p>`;
    try {
      state.rows = await listStaffData(state.buId, state.outletId || undefined);
    } catch (error) {
      box.innerHTML = `<p class="error-text">${error.message ?? error}</p>`;
      return;
    }
    box.innerHTML = `
      <p style="font-size:0.82rem;color:var(--color-text-muted);margin:14px 0 6px">${state.rows.length} staff. Ketuk nama untuk melihat data lengkap.</p>
      <table class="data-table">
        <thead><tr><th>Nama</th><th>Outlet</th><th>Telp</th><th>Nama KTP</th><th>No. KTP</th><th>JK</th><th>Status</th><th>Kelengkapan</th></tr></thead>
        <tbody>
          ${
            state.rows
              .map((r) => {
                const p = r.profile;
                const filled = countFilled(p);
                return `<tr>
                  <td><button class="sd-detail" data-id="${p.id}" style="border:none;background:none;padding:0;color:var(--color-primary);cursor:pointer;font-size:0.9rem;text-align:left">${esc(p.full_name ?? '-')}</button>
                    ${p.is_active === false ? ' <span style="font-size:0.7rem;color:var(--color-danger)">(nonaktif)</span>' : ''}</td>
                  <td style="font-size:0.82rem">${esc(r.outlets.join(', ') || '-')}</td>
                  <td>${esc(p.phone ?? '-')}</td>
                  <td>${esc(p.ktp_name ?? '-')}</td>
                  <td>${esc(p.ktp_number ?? '-')}</td>
                  <td>${GENDER_LABEL[p.gender] ?? '-'}</td>
                  <td>${MARITAL_LABEL[p.marital_status] ?? '-'}</td>
                  <td><span class="badge ${filled.pct === 100 ? 'badge-approved' : 'badge-pending'}">${filled.pct}%</span></td>
                </tr>`;
              })
              .join('') || '<tr><td colspan="8">Belum ada staff di filter ini.</td></tr>'
          }
        </tbody>
      </table>`;

    box.querySelectorAll('.sd-detail').forEach((btn) =>
      btn.addEventListener('click', async () => {
        const r = state.rows.find((x) => x.profile.id === btn.dataset.id);
        if (!r) return;
        const p = r.profile;
        const url = await getStaffPhotoUrl(p.photo_path);
        const item = (l, v) => `<div class="profile-row"><span class="profile-label">${l}</span><span class="profile-value">${v ? esc(v) : '-'}</span></div>`;
        await infoDialog({
          title: p.full_name ?? 'Data Staff',
          bodyHtml: `
            ${url ? `<img src="${url}" alt="Foto" style="width:96px;height:96px;object-fit:cover;border-radius:12px;margin-bottom:10px" />` : ''}
            <div class="profile-list">
              ${item('Outlet', r.outlets.join(', '))}
              ${item('Role', r.roles.join(', '))}
              ${item('No. Telp', p.phone)}
              ${item('Nama KTP', p.ktp_name)}
              ${item('No. KTP', p.ktp_number)}
              ${item('Jenis Kelamin', GENDER_LABEL[p.gender])}
              ${item('Alamat KTP', p.ktp_address)}
              ${item('Kode Pos', p.postal_code)}
              ${item('Nama Ibu Kandung', p.mother_name)}
              ${item('Nomor Darurat', p.emergency_contact)}
              ${item('Ukuran Baju', p.shirt_size)}
              ${item('Ukuran Celana', p.pants_size)}
              ${item('Ukuran Sepatu', p.shoe_size)}
              ${item('Status Kawin', MARITAL_LABEL[p.marital_status])}
              ${item('No. NPWP', p.npwp)}
            </div>`
        });
      })
    );
  }

  async function doExport() {
    if (!state.rows.length) return toast('Tidak ada data untuk diexport.', 'warning');
    const buName = bus.find((b) => b.id === state.buId)?.name ?? '-';
    const outletName = state.outletId ? outlets.find((o) => o.id === state.outletId)?.name ?? '-' : 'Semua outlet';
    try {
      await exportTablePDF({
        title: 'Data Staff',
        subtitle: `${buName} · ${outletName}`,
        columns: [
          { header: 'Nama', width: 1.3 },
          { header: 'Outlet', width: 1 },
          { header: 'Telp', width: 1 },
          { header: 'Nama KTP', width: 1.3 },
          { header: 'No. KTP', width: 1.2 },
          { header: 'JK', width: 0.5 },
          { header: 'Alamat KTP', width: 1.8 },
          { header: 'Kode Pos', width: 0.7 },
          { header: 'Ibu Kandung', width: 1.1 },
          { header: 'No. Darurat', width: 1 },
          { header: 'Baju', width: 0.5 },
          { header: 'Celana', width: 0.5 },
          { header: 'Sepatu', width: 0.5 },
          { header: 'Status', width: 0.8 },
          { header: 'NPWP', width: 1.1 }
        ],
        rows: state.rows.map((r) => {
          const p = r.profile;
          return [
            p.full_name ?? '-',
            r.outlets.join(', ') || '-',
            p.phone ?? '-',
            p.ktp_name ?? '-',
            p.ktp_number ?? '-',
            GENDER_LABEL[p.gender] ?? '-',
            p.ktp_address ?? '-',
            p.postal_code ?? '-',
            p.mother_name ?? '-',
            p.emergency_contact ?? '-',
            p.shirt_size ?? '-',
            p.pants_size ?? '-',
            p.shoe_size ?? '-',
            MARITAL_LABEL[p.marital_status] ?? '-',
            p.npwp ?? '-'
          ];
        }),
        filename: 'data-staff'
      });
      toast('PDF data staff terunduh.', 'success');
    } catch (error) {
      toast(error.message ?? 'Gagal membuat PDF.', 'error');
    }
  }

  await load();
}

function countFilled(p) {
  const keys = ['ktp_name', 'ktp_number', 'gender', 'ktp_address', 'postal_code', 'mother_name', 'emergency_contact', 'shirt_size', 'pants_size', 'shoe_size', 'marital_status', 'npwp'];
  const filled = keys.filter((k) => p[k]).length;
  return { filled, total: keys.length, pct: Math.round((filled / keys.length) * 100) };
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
