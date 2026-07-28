import { listProducts, TYPE_LABEL } from './product.service.js';
import { listAttendanceOutlets } from '../attendance/attendance.service.js';
import { getOutletStockMap } from '../inventory/inventory.service.js';
import { formatNum } from '../../core/format.js';

// Halaman "Produk" di Staff App — LIHAT SAJA: nama produk & jumlah stok.
// Tidak ada edit (master produk dikelola admin di Admin Portal).
export async function renderProductStaffPage(container, { businessUnitId, outletId }) {
  container.innerHTML = `<p>Memuat produk...</p>`;

  let outlets, products;
  try {
    [outlets, products] = await Promise.all([
      listAttendanceOutlets().then((all) => all.filter((o) => o.business_unit_id === businessUnitId).map((o) => ({ id: o.id, name: o.name }))),
      listProducts(businessUnitId)
    ]);
  } catch (error) {
    container.innerHTML = `<p class="error-text">Gagal memuat: ${error.message ?? error}</p>`;
    return;
  }
  const active = products.filter((p) => p.is_active !== false);
  if (!active.length) {
    container.innerHTML = `<h1>Produk</h1><p style="color:var(--color-text-muted)">Belum ada produk di BU ini.</p>`;
    return;
  }
  const state = { outletId: outlets.some((o) => o.id === outletId) ? outletId : outlets[0]?.id };

  container.innerHTML = `
    <h1>Produk</h1>
    ${
      outlets.length
        ? `<div class="field" style="max-width:280px"><label>Outlet (untuk lihat stok)</label>
            <select id="pv-outlet">${outlets.map((o) => `<option value="${o.id}"${o.id === state.outletId ? ' selected' : ''}>${esc(o.name)}</option>`).join('')}</select></div>`
        : ''
    }
    <div id="pv-body"></div>
  `;
  const sel = container.querySelector('#pv-outlet');
  sel?.addEventListener('change', () => {
    state.outletId = sel.value;
    refresh();
  });

  async function refresh() {
    const body = container.querySelector('#pv-body');
    body.innerHTML = `<p>Memuat stok...</p>`;
    let map = new Map();
    if (state.outletId) {
      try {
        map = await getOutletStockMap(businessUnitId, state.outletId);
      } catch {
        map = new Map();
      }
    }
    body.innerHTML = `
      <table class="data-table">
        <thead><tr><th>Produk</th><th>Tipe</th><th>Stok</th><th>Satuan</th></tr></thead>
        <tbody>
          ${active
            .map((p) => `<tr><td>${esc(p.name)}</td><td>${TYPE_LABEL[p.product_type] ?? p.product_type}</td><td>${formatNum(map.get(p.id) ?? 0)}</td><td>${esc(p.base_unit)}</td></tr>`)
            .join('')}
        </tbody>
      </table>
    `;
  }
  refresh();
}

function round(n) {
  return Math.round(Number(n) * 100) / 100;
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
