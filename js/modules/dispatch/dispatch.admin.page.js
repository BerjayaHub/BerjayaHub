import { toast, infoDialog } from '../../core/ui.js';
import { formatThousands } from '../../core/format.js';
import { listDispatchesAdmin, getDispatchItems, DISPATCH_STATUS } from './dispatch.service.js';

const STATUS_BADGE = { sent: 'badge-pending', received: 'badge-approved', cancelled: 'badge-cancelled' };

export async function renderDispatchAdminPage(container, { businessUnitId }) {
  container.innerHTML = `
    <h1>Pengiriman</h1>
    <div class="inline-card" style="max-width:600px;display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end">
      <div class="field" style="margin:0"><label>Status</label>
        <select id="dp-status"><option value="">Semua</option>${Object.entries(DISPATCH_STATUS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
      </div>
      <div class="field" style="margin:0"><label>Dari</label><input type="date" id="dp-from" /></div>
      <div class="field" style="margin:0"><label>Sampai</label><input type="date" id="dp-to" /></div>
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
  result.innerHTML = `<p>Memuat...</p>`;
  let rows;
  try {
    rows = await listDispatchesAdmin({
      businessUnitId,
      status,
      dateFrom: from ? new Date(from).toISOString() : '',
      dateTo: to ? new Date(to + 'T23:59:59').toISOString() : ''
    });
  } catch (error) {
    result.innerHTML = `<p class="error-text">${error.message ?? error}</p>`;
    return;
  }
  result.innerHTML = `
    <table class="data-table" style="margin-top:16px">
      <thead><tr><th>Waktu</th><th>Dari</th><th>Ke</th><th>Status</th><th>Pengirim</th><th>Penerima</th><th></th></tr></thead>
      <tbody>
        ${rows
          .map(
            (d) => `<tr>
              <td style="font-size:0.8rem">${fmtDateTime(d.created_at)}</td>
              <td>${esc(d.from_outlet?.name ?? '-')}</td>
              <td>${esc(d.to_outlet?.name ?? '-')}</td>
              <td><span class="badge ${STATUS_BADGE[d.status] ?? ''}">${DISPATCH_STATUS[d.status] ?? d.status}</span></td>
              <td>${esc(d.sender?.full_name ?? '-')}</td>
              <td>${esc(d.receiver?.full_name ?? '-')}</td>
              <td><button class="btn-dp-detail" data-id="${d.id}">Detail</button></td>
            </tr>`
          )
          .join('') || '<tr><td colspan="7">Tidak ada data.</td></tr>'}
      </tbody>
    </table>
  `;
  result.querySelectorAll('.btn-dp-detail').forEach((btn) =>
    btn.addEventListener('click', async () => {
      try {
        const items = await getDispatchItems(btn.dataset.id);
        const body = `
          <table class="data-table"><thead><tr><th>Produk</th><th>Dikirim</th><th>Diterima</th></tr></thead>
          <tbody>${items
            .map(
              (it) => `<tr><td>${esc(it.products?.name ?? '-')}</td><td>${formatThousands(round(it.sent_qty))} ${esc(it.products?.base_unit ?? '')}</td><td>${it.received_qty == null ? '-' : formatThousands(round(it.received_qty)) + ' ' + esc(it.products?.base_unit ?? '')}</td></tr>`
            )
            .join('')}</tbody></table>`;
        await infoDialog({ title: 'Detail Pengiriman', bodyHtml: body });
      } catch (error) {
        toast(error.message ?? 'Gagal memuat detail.', 'error');
      }
    })
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
