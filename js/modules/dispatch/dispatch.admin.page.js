import { listDispatchesAdmin, DISPATCH_STATUS } from './dispatch.service.js';
import { bukaDokumen } from './dokumen-ui.js';
import { loadingHtml, sekaliJalan } from '../../core/loading.js';
import { monthRangeWIB, isoFrom, isoTo } from '../../core/dates.js';

const STATUS_BADGE = { draft: 'badge-pending', sent: 'badge', received: 'badge-approved', cancelled: 'badge-cancelled' };

export async function renderDispatchAdminPage(container, { businessUnitId }) {
  const range = monthRangeWIB();
  container.innerHTML = `
    <h1>Pengiriman</h1>
    <div class="inline-card" style="max-width:600px;display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end">
      <div class="field" style="margin:0"><label>Status</label>
        <select id="dp-status"><option value="">Semua</option>${Object.entries(DISPATCH_STATUS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
      </div>
      <div class="field" style="margin:0"><label>Dari</label><input type="date" id="dp-from" value="${range.from}" /></div>
      <div class="field" style="margin:0"><label>Sampai</label><input type="date" id="dp-to" value="${range.to}" /></div>
      <button class="primary" id="dp-go" style="max-width:120px">Tampilkan</button>
    </div>
    <div id="dp-result"></div>
  `;
  const go = () => load(container, businessUnitId);
  container.querySelector('#dp-go').addEventListener('click', go);
  await go();
}

async function load(container, businessUnitId) {
  const status = container.querySelector('#dp-status').value || '';
  const from = container.querySelector('#dp-from').value;
  const to = container.querySelector('#dp-to').value;
  const result = container.querySelector('#dp-result');
  result.innerHTML = loadingHtml('Memuat…', { baris: 5 });
  let rows;
  try {
    rows = await listDispatchesAdmin({
      businessUnitId,
      status,
      dateFrom: isoFrom(from),
      dateTo: isoTo(to)
    });
  } catch (error) {
    result.innerHTML = `<p class="error-text">${error.message ?? error}</p>`;
    return;
  }
  result.innerHTML = `
    <table class="data-table" style="margin-top:16px">
      <thead><tr><th>No. Surat Jalan</th><th>Waktu</th><th>Dari</th><th>Ke</th><th>Status</th><th>Pengirim</th><th>Penerima</th></tr></thead>
      <tbody>
        ${rows
          .map(
            (d) => `<tr>
              <td>
                <button class="btn-dp-detail" data-id="${d.id}" title="Lihat & unduh dokumen"
                  style="font-family:ui-monospace,Menlo,monospace;font-size:0.8rem">${esc(d.code ?? '(tanpa nomor)')}</button>
              </td>
              <td style="font-size:0.8rem">${fmtDateTime(d.created_at)}</td>
              <td>${esc(d.from_outlet?.name ?? '-')}</td>
              <td>${esc(d.to_outlet?.name ?? '-')}</td>
              <td><span class="badge ${STATUS_BADGE[d.status] ?? ''}">${DISPATCH_STATUS[d.status] ?? d.status}</span></td>
              <td>${esc(d.sender?.full_name ?? '-')}</td>
              <td>${esc(d.receiver?.full_name ?? '-')}</td>
            </tr>`
          )
          .join('') || '<tr><td colspan="7">Tidak ada data.</td></tr>'}
      </tbody>
    </table>
  `;
  // Nomor dokumen bisa diketuk -> dialog rincian + unduh PDF/xlsx.
  // Versi Admin BERNILAI: rekap yang dibaca admin butuh angka modalnya.
  result.querySelectorAll('.btn-dp-detail').forEach((btn) =>
    btn.addEventListener(
      'click',
      sekaliJalan(() => bukaDokumen({ jenis: 'dispatch', id: btn.dataset.id, businessUnitId, denganNilai: true }))
    )
  );
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
