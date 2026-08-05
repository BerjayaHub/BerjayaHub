import { formatNum, formatRupiah } from '../../core/format.js';
import { listSalesReport } from './sales.service.js';
import { monthRangeWIB } from '../../core/dates.js';
import { listMyOutlets, PESAN_TANPA_OUTLET } from '../../core/my-outlets.js';

export async function renderSalesAdminPage(container, { businessUnitId }) {
  const outlets = (await listMyOutlets(businessUnitId).catch(() => [])).map((o) => ({ id: o.id, name: o.name }));
  if (!outlets.length) {
    container.innerHTML = `<h1>Penjualan</h1><p style="color:var(--color-text-muted)">${PESAN_TANPA_OUTLET}</p>`;
    return;
  }
  const range = monthRangeWIB();
  container.innerHTML = `
    <h1>Penjualan</h1>
    <div class="inline-card" style="max-width:620px;display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end">
      <div class="field" style="margin:0"><label>Outlet</label>
        <select id="sr-outlet"><option value="">Semua</option>${outlets.map((o) => `<option value="${o.id}">${esc(o.name)}</option>`).join('')}</select>
      </div>
      <div class="field" style="margin:0"><label>Dari</label><input type="date" id="sr-from" value="${range.from}" /></div>
      <div class="field" style="margin:0"><label>Sampai</label><input type="date" id="sr-to" value="${range.to}" /></div>
      <button class="primary" id="sr-go" style="max-width:120px">Tampilkan</button>
    </div>
    <div id="sr-result"></div>
  `;
  const go = () => load(container, businessUnitId);
  container.querySelector('#sr-go').addEventListener('click', go);
  await go();
}

async function load(container, businessUnitId) {
  const outletId = container.querySelector('#sr-outlet').value || '';
  const from = container.querySelector('#sr-from').value;
  const to = container.querySelector('#sr-to').value;
  const result = container.querySelector('#sr-result');
  result.innerHTML = `<p>Memuat...</p>`;
  let rows;
  try {
    rows = await listSalesReport({ businessUnitId, outletId, dateFrom: from || '', dateTo: to || '' });
  } catch (error) {
    result.innerHTML = `<p class="error-text">${error.message ?? error}</p>`;
    return;
  }
  // Agregasi per menu
  const byProduct = new Map();
  let totalRevenue = 0;
  let totalQty = 0;
  for (const r of rows) {
    const key = r.product_id;
    const cur = byProduct.get(key) ?? { name: r.products?.name ?? '-', category: r.products?.category ?? '-', qty: 0, revenue: 0 };
    cur.qty += Number(r.qty) || 0;
    cur.revenue += Number(r.revenue) || 0;
    byProduct.set(key, cur);
    totalRevenue += Number(r.revenue) || 0;
    totalQty += Number(r.qty) || 0;
  }
  const list = [...byProduct.values()].sort((a, b) => b.revenue - a.revenue);

  result.innerHTML = `
    <p style="margin:14px 0 6px;font-weight:600">Total: ${formatNum(totalQty)} menu terjual · Omzet ${formatRupiah(totalRevenue)}</p>
    <div class="table-scroll"><table class="data-table table-freeze-1">
      <thead><tr><th>Menu</th><th>Kategori</th><th>Terjual</th><th>Omzet</th></tr></thead>
      <tbody>
        ${list.map((p) => `<tr><td>${esc(p.name)}</td><td>${esc(p.category)}</td><td>${formatNum(p.qty)}</td><td>${formatRupiah(p.revenue)}</td></tr>`).join('') || '<tr><td colspan="4">Tidak ada data.</td></tr>'}
      </tbody>
    </table></div>
  `;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
