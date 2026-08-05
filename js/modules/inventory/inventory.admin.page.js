import { toast } from '../../core/ui.js';
import { formatNum, formatRupiah } from '../../core/format.js';
import { listProducts, listRecipesFull, computeCosts, TYPE_LABEL } from '../product/product.service.js';
import { listStockBalances, listMovements, MOVEMENT_LABEL, amISuperAdmin, getAllowStaffOpname, setAllowStaffOpname } from './inventory.service.js';
import { monthRangeWIB, isoFrom, isoTo } from '../../core/dates.js';
import { listMyOutlets, PESAN_TANPA_OUTLET } from '../../core/my-outlets.js';
import { loadingHtml } from '../../core/loading.js';

const TABS = [
  { key: 'stock', label: 'Stok' },
  { key: 'history', label: 'Riwayat' }
];

export async function renderInventoryAdminPage(container, { businessUnitId }) {
  container.innerHTML = `
    <h1>Inventory</h1>
    <div id="inv-opname-setting"></div>
    <div class="tab-bar">
      ${TABS.map((t, i) => `<button class="tab-btn ${i === 0 ? 'active' : ''}" data-tab="${t.key}">${t.label}</button>`).join('')}
    </div>
    <div id="inv-admin-content"></div>
  `;
  const content = document.getElementById('inv-admin-content');
  renderOpnameSetting(container.querySelector('#inv-opname-setting'), businessUnitId);
  const outlets = (await listMyOutlets(businessUnitId).catch(() => [])).map((o) => ({ id: o.id, name: o.name }));
  if (!outlets.length) {
    container.innerHTML = `<h1>Stok</h1><p style="color:var(--color-text-muted)">${PESAN_TANPA_OUTLET}</p>`;
    return;
  }

  async function showTab(key) {
    container.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === key));
    if (key === 'stock') await renderStockTab(content, businessUnitId, outlets);
    if (key === 'history') await renderHistoryTab(content, businessUnitId, outlets);
  }
  container.querySelectorAll('.tab-btn').forEach((btn) => btn.addEventListener('click', () => showTab(btn.dataset.tab)));
  await showTab('stock');
}

async function renderOpnameSetting(el, businessUnitId) {
  let isSuper = false;
  let allow = false;
  try {
    [isSuper, allow] = await Promise.all([amISuperAdmin(), getAllowStaffOpname(businessUnitId)]);
  } catch {
    return;
  }
  if (!isSuper) return; // hanya Super Admin yang lihat & ubah
  el.innerHTML = `
    <div class="inline-card field-check" style="max-width:520px">
      <input type="checkbox" id="chk-opname" ${allow ? 'checked' : ''} />
      <label for="chk-opname" style="margin:0">Izinkan staff melakukan <strong>stok opname</strong> di Staff App (BU ini)</label>
    </div>
  `;
  el.querySelector('#chk-opname').addEventListener('change', async (e) => {
    try {
      await setAllowStaffOpname(businessUnitId, e.target.checked);
      toast(e.target.checked ? 'Opname staff diaktifkan.' : 'Opname staff dimatikan.', 'success');
    } catch (error) {
      e.target.checked = !e.target.checked;
      toast(error.message ?? 'Gagal mengubah (hanya Super Admin).', 'error');
    }
  });
}

// ---- Tab: Stok ----

async function renderStockTab(content, businessUnitId, outlets) {
  content.innerHTML = `
    <div class="field" style="max-width:280px">
      <label>Outlet</label>
      <select id="stock-outlet"><option value="">Semua outlet (gabungan)</option>${outlets.map((o) => `<option value="${o.id}">${escapeHtml(o.name)}</option>`).join('')}</select>
    </div>
    <div id="stock-result">${loadingHtml('Memuat…')}</div>
  `;
  const sel = content.querySelector('#stock-outlet');
  sel.addEventListener('change', () => loadStock(content, businessUnitId, sel.value));
  await loadStock(content, businessUnitId, '');
}

async function loadStock(content, businessUnitId, outletId) {
  const result = content.querySelector('#stock-result');
  result.innerHTML = loadingHtml('Memuat stok…', { baris: 5 });
  let balances, products, recipes;
  try {
    [balances, products, recipes] = await Promise.all([
      listStockBalances(businessUnitId, outletId || undefined),
      listProducts(businessUnitId),
      listRecipesFull(businessUnitId)
    ]);
  } catch (error) {
    result.innerHTML = `<p class="error-text">${error.message ?? error}</p>`;
    return;
  }
  const costs = computeCosts(products, recipes);
  const productById = new Map(products.map((p) => [p.id, p]));

  const byProduct = new Map();
  for (const b of balances) byProduct.set(b.product_id, (byProduct.get(b.product_id) ?? 0) + Number(b.qty));

  let totalValue = 0;
  const rows = [...byProduct.entries()]
    .map(([pid, qty]) => ({ p: productById.get(pid), qty }))
    .filter((r) => r.p)
    .sort((a, b) => a.p.name.localeCompare(b.p.name));

  const bodyHtml = rows
    .map((r) => {
      const cost = costs.get(r.p.id);
      const value = cost != null ? cost * r.qty : null;
      if (value != null) totalValue += value;
      return `<tr>
        <td>${escapeHtml(r.p.name)}</td>
        <td>${TYPE_LABEL[r.p.product_type] ?? r.p.product_type}</td>
        <td>${formatNum(r.qty)}</td>
        <td>${escapeHtml(r.p.base_unit)}</td>
        <td>${value != null ? formatRupiah(value) : '-'}</td>
      </tr>`;
    })
    .join('');

  result.innerHTML = `
    <div class="table-scroll" style="margin-top:12px"><table class="data-table table-freeze-1">
      <thead><tr><th>Produk</th><th>Tipe</th><th>Stok</th><th>Satuan</th><th>Nilai (HPP)</th></tr></thead>
      <tbody>${bodyHtml || '<tr><td colspan="5">Belum ada stok.</td></tr>'}</tbody>
    </table></div>
    <p style="margin-top:10px;font-weight:600">Total nilai stok: ${formatRupiah(totalValue)}</p>
  `;
}

// ---- Tab: Riwayat ----

async function renderHistoryTab(content, businessUnitId, outlets) {
  const range = monthRangeWIB();
  content.innerHTML = `
    <div class="inline-card" style="max-width:640px;display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end">
      <div class="field" style="margin:0"><label>Outlet</label>
        <select id="hist-outlet"><option value="">Semua</option>${outlets.map((o) => `<option value="${o.id}">${escapeHtml(o.name)}</option>`).join('')}</select>
      </div>
      <div class="field" style="margin:0"><label>Jenis</label>
        <select id="hist-type"><option value="">Semua</option>${Object.entries(MOVEMENT_LABEL).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
      </div>
      <div class="field" style="margin:0"><label>Dari</label><input type="date" id="hist-from" value="${range.from}" /></div>
      <div class="field" style="margin:0"><label>Sampai</label><input type="date" id="hist-to" value="${range.to}" /></div>
      <button class="primary" id="hist-go" style="max-width:120px">Tampilkan</button>
    </div>
    <div id="hist-result"></div>
  `;
  const go = () => loadHistory(content, businessUnitId);
  content.querySelector('#hist-go').addEventListener('click', go);
  await go();
}

async function loadHistory(content, businessUnitId) {
  const outletId = content.querySelector('#hist-outlet').value || '';
  const movementType = content.querySelector('#hist-type').value || '';
  const from = content.querySelector('#hist-from').value;
  const to = content.querySelector('#hist-to').value;
  const result = content.querySelector('#hist-result');
  result.innerHTML = loadingHtml('Memuat…', { baris: 5 });
  let rows;
  try {
    rows = await listMovements({
      businessUnitId,
      outletId,
      movementType,
      dateFrom: isoFrom(from),
      dateTo: isoTo(to)
    });
  } catch (error) {
    result.innerHTML = `<p class="error-text">${error.message ?? error}</p>`;
    return;
  }
  result.innerHTML = `
    <table class="data-table" style="margin-top:16px">
      <thead><tr><th>Waktu</th><th>Outlet</th><th>Produk</th><th>Jenis</th><th>Qty</th><th>Oleh</th><th>Catatan</th></tr></thead>
      <tbody>
        ${rows
          .map((r) => {
            const sign = Number(r.qty_delta) >= 0 ? '+' : '';
            const ref = r.ref?.name ? ` → ${escapeHtml(r.ref.name)}` : '';
            return `<tr>
              <td style="font-size:0.8rem">${fmtDateTime(r.created_at)}</td>
              <td>${escapeHtml(r.outlets?.name ?? '-')}</td>
              <td>${escapeHtml(r.products?.name ?? '-')}</td>
              <td>${MOVEMENT_LABEL[r.movement_type] ?? r.movement_type}${ref}</td>
              <td>${sign}${formatNum(r.qty_delta)} ${escapeHtml(r.products?.base_unit ?? '')}</td>
              <td>${escapeHtml(r.user_profiles?.full_name ?? '-')}</td>
              <td style="font-size:0.8rem">${escapeHtml(r.notes ?? '-')}</td>
            </tr>`;
          })
          .join('') || '<tr><td colspan="7">Tidak ada data.</td></tr>'}
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
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
