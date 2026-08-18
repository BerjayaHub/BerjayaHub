import { formatNum } from '../../core/format.js';
import { listProductionRuns } from './production.service.js';
import { monthRangeWIB, isoFrom, isoTo } from '../../core/dates.js';
import { listMyOutlets, PESAN_TANPA_OUTLET } from '../../core/my-outlets.js';
import { loadingHtml } from '../../core/loading.js';

export async function renderProductionAdminPage(container, { businessUnitId }) {
  const outlets = (await listMyOutlets(businessUnitId).catch(() => [])).map((o) => ({ id: o.id, name: o.name }));
  if (!outlets.length) {
    container.innerHTML = `<h1>Produksi</h1><p style="color:var(--color-text-muted)">${PESAN_TANPA_OUTLET}</p>`;
    return;
  }
  const range = monthRangeWIB();
  container.innerHTML = `
    <h1>Produksi</h1>
    <div class="inline-card" style="max-width:600px;display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end">
      <div class="field" style="margin:0"><label>Outlet</label>
        <select id="pr-outlet"><option value="">Semua</option>${outlets.map((o) => `<option value="${o.id}">${esc(o.name)}</option>`).join('')}</select>
      </div>
      <div class="field" style="margin:0"><label>Dari</label><input type="date" id="pr-from" value="${range.from}" /></div>
      <div class="field" style="margin:0"><label>Sampai</label><input type="date" id="pr-to" value="${range.to}" /></div>
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
  result.innerHTML = loadingHtml('Memuat…', { baris: 5 });
  let runs;
  try {
    // ADMIN MELIHAT YANG DIBATALKAN JUGA.
    //
    // Di Staff App yang dibatalkan disembunyikan — bagi mereka ia memang sudah
    // terhapus. Tapi laporan admin adalah tempat orang menelusuri kenapa stok
    // berubah, dan pergerakan penyeimbang dari pembatalan akan muncul di
    // riwayat stok tanpa asal-usul kalau produksinya tidak ikut terlihat.
    runs = await listProductionRuns({
      businessUnitId,
      outletId,
      dateFrom: isoFrom(from),
      dateTo: isoTo(to),
      denganDibatalkan: true
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
          .map((r) => {
            const batal = !!r.cancelled_at;
            return `<tr${batal ? ' style="opacity:0.65"' : ''}>
              <td style="font-size:0.8rem">${fmtDateTime(r.created_at)}</td>
              <td>${esc(r.outlets?.name ?? '-')}</td>
              <td>${esc(r.products?.name ?? '-')}${
                batal ? ' <span class="badge" style="background:#fdecea;color:#b3261e">dibatalkan</span>' : ''
              }</td>
              <td${batal ? ' style="text-decoration:line-through"' : ''}>${formatNum(r.output_qty)} ${esc(r.products?.base_unit ?? '')}</td>
              <td>${esc(r.pencatat?.full_name ?? '-')}</td>
              <td style="font-size:0.8rem">${esc(r.notes ?? '-')}${
                batal && r.cancel_reason ? ` · <em>batal: ${esc(r.cancel_reason)}</em>` : ''
              }</td>
            </tr>`;
          })
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
