import { formatNum } from '../../core/format.js';
import { listAttendanceOutlets } from '../attendance/attendance.service.js';
import { listProductionRuns } from './production.service.js';

export async function renderProductionAdminPage(container, { businessUnitId }) {
  const outlets = (await listAttendanceOutlets().catch(() => [])).filter((o) => o.business_unit_id === businessUnitId).map((o) => ({ id: o.id, name: o.name }));
  container.innerHTML = `
    <h1>Produksi</h1>
    <div class="inline-card" style="max-width:600px;display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end">
      <div class="field" style="margin:0"><label>Outlet</label>
        <select id="pr-outlet"><option value="">Semua</option>${outlets.map((o) => `<option value="${o.id}">${o.name}</option>`).join('')}</select>
      </div>
      <div class="field" style="margin:0"><label>Dari</label><input type="date" id="pr-from" /></div>
      <div class="field" style="margin:0"><label>Sampai</label><input type="date" id="pr-to" /></div>
      <button class="primary" id="pr-go" style="max-width:120px">Tampilkan</button>
    </div>
    <div id="pr-result"></div>
  `;
  const go = () => loadRuns(container, businessUnitId);
  container.querySelector('#pr-go').addEventListener('click', go);
  await go();
}

async function loadRuns(container, businessUnitId) {
  const outletId = container.querySelector('#pr-outlet').value || '';
  const from = container.querySelector('#pr-from').value;
  const to = container.querySelector('#pr-to').value;
  const result = container.querySelector('#pr-result');
  result.innerHTML = `<p>Memuat...</p>`;
  let runs;
  try {
    runs = await listProductionRuns({
      businessUnitId,
      outletId,
      dateFrom: from ? new Date(from).toISOString() : '',
      dateTo: to ? new Date(to + 'T23:59:59').toISOString() : ''
    });
  } catch (error) {
    result.innerHTML = `<p class="error-text">${error.message ?? error}</p>`;
    return;
  }
  result.innerHTML = `
    <table class="data-table" style="margin-top:16px">
      <thead><tr><th>Waktu</th><th>Outlet</th><th>Produk</th><th>Jumlah</th><th>Oleh</th><th>Catatan</th></tr></thead>
      <tbody>
        ${runs
          .map(
            (r) => `<tr>
              <td style="font-size:0.8rem">${fmtDateTime(r.created_at)}</td>
              <td>${esc(r.outlets?.name ?? '-')}</td>
              <td>${esc(r.products?.name ?? '-')}</td>
              <td>${formatNum(r.output_qty)} ${esc(r.products?.base_unit ?? '')}</td>
              <td>${esc(r.user_profiles?.full_name ?? '-')}</td>
              <td style="font-size:0.8rem">${esc(r.notes ?? '-')}</td>
            </tr>`
          )
          .join('') || '<tr><td colspan="6">Tidak ada data.</td></tr>'}
      </tbody>
    </table>
  `;
}

function round(n) {
  return Math.round(Number(n) * 100) / 100;
}
function fmtDateTime(iso) {
  return new Date(iso).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
