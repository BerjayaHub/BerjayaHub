import { toast } from '../../core/ui.js';
import { formatNum } from '../../core/format.js';
import { listProducts, getRecipeForProduct } from '../product/product.service.js';
import { getOutletStockMap } from '../inventory/inventory.service.js';
import { getMenuPlans, upsertMenuPlan, todayWIB } from './menu.service.js';
import { listMyOutlets } from '../../core/my-outlets.js';
import { loadingHtml } from '../../core/loading.js';

export async function renderMenuPage(container, { businessUnitId, outletId }) {
  container.innerHTML = loadingHtml('Memuat menu…');
  const date = todayWIB();

  let outlets, products;
  try {
    [outlets, products] = await Promise.all([
      listMyOutlets(businessUnitId),
      listProducts(businessUnitId)
    ]);
  } catch (error) {
    container.innerHTML = `<p class="error-text">Gagal memuat: ${error.message ?? error}</p>`;
    return;
  }
  const menus = products.filter((p) => p.product_type === 'finished' && p.is_active !== false);
  if (!outlets.length) {
    container.innerHTML = `<h1>Menu</h1><p>Belum ada outlet untukmu di BU ini.</p>`;
    return;
  }
  if (!menus.length) {
    container.innerHTML = `<h1>Menu</h1><p style="color:var(--color-text-muted)">Belum ada menu (Produk Jadi). Minta admin mengisi di Master Produk.</p>`;
    return;
  }
  const categories = [...new Set(menus.map((m) => m.category).filter(Boolean))].sort();
  const recipeCache = new Map();
  const state = {
    outletId: outlets.some((o) => o.id === outletId) ? outletId : outlets[0].id,
    category: '',
    plans: new Map(),
    stock: new Map()
  };

  container.innerHTML = `
    <h1>Menu</h1>
    <p style="color:var(--color-text-muted);font-size:0.85rem;margin:0 0 10px">Isi jumlah menu yang tersedia hari ini (${fmtDate(date)}) sebagai panduan POS. Mengisi jumlah <strong>tidak</strong> mengurangi stok — stok berkurang saat penjualan.</p>
    <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end;margin-bottom:8px">
      <div class="field" style="margin:0"><label>Outlet</label>
        <select id="menu-outlet">${outlets.map((o) => `<option value="${o.id}"${o.id === state.outletId ? ' selected' : ''}>${esc(o.name)}</option>`).join('')}</select>
      </div>
      <div class="field" style="margin:0"><label>Kategori</label>
        <select id="menu-cat"><option value="">Semua</option>${categories.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}</select>
      </div>
    </div>
    <div class="table-scroll"><table class="data-table table-freeze-1 kartu-sempit">
      <thead><tr><th>Menu</th><th>Kategori</th><th>Jumlah tersedia</th></tr></thead>
      <tbody id="menu-rows"></tbody>
    </table></div>
  `;

  const outletSel = container.querySelector('#menu-outlet');
  const catSel = container.querySelector('#menu-cat');

  async function reload() {
    try {
      [state.plans, state.stock] = await Promise.all([getMenuPlans(state.outletId, date), getOutletStockMap(businessUnitId, state.outletId)]);
    } catch {
      state.plans = new Map();
      state.stock = new Map();
    }
    renderRows();
  }

  function renderRows() {
    const tbody = container.querySelector('#menu-rows');
    const list = state.category ? menus.filter((m) => m.category === state.category) : menus;
    tbody.innerHTML =
      list
        .map(
          (m) => `
        <tr class="menu-row">
          <td data-label="Menu"><button class="menu-expand" data-id="${m.id}" style="border:none;background:none;color:var(--color-primary);cursor:pointer;font-size:0.92rem;padding:0;text-align:left">${esc(m.name)} ▾</button></td>
          <td data-label="Kategori">${esc(m.category ?? '-')}</td>
          <td data-label="Jumlah tersedia">
            <input type="number" class="menu-qty" data-id="${m.id}" min="0" value="${state.plans.has(m.id) ? state.plans.get(m.id) : ''}" style="max-width:90px" />
            <span class="menu-saved" data-id="${m.id}" style="color:var(--color-primary);font-size:0.72rem;margin-left:4px"></span>
          </td>
        </tr>
        <tr class="menu-detail" data-id="${m.id}" hidden><td colspan="3" class="sel-penuh"><div class="menu-detail-body" style="padding:6px 2px"></div></td></tr>`
        )
        .join('') || '<tr><td colspan="3">Tidak ada menu di kategori ini.</td></tr>';

    tbody.querySelectorAll('.menu-qty').forEach((inp) =>
      inp.addEventListener('change', async () => {
        const qty = inp.value === '' ? 0 : Number(inp.value);
        try {
          await upsertMenuPlan({ businessUnitId, outletId: state.outletId, productId: inp.dataset.id, date, qty });
          state.plans.set(inp.dataset.id, qty);
          const s = tbody.querySelector(`.menu-saved[data-id="${inp.dataset.id}"]`);
          if (s) {
            s.textContent = '✓ tersimpan';
            setTimeout(() => (s.textContent = ''), 1500);
          }
        } catch (error) {
          toast(error.message ?? 'Gagal menyimpan jumlah.', 'error');
        }
      })
    );

    tbody.querySelectorAll('.menu-expand').forEach((btn) =>
      btn.addEventListener('click', () => toggleDetail(tbody, menus.find((m) => m.id === btn.dataset.id)))
    );
  }

  async function toggleDetail(tbody, menu) {
    const detailRow = tbody.querySelector(`.menu-detail[data-id="${menu.id}"]`);
    if (!detailRow) return;
    if (!detailRow.hidden) {
      detailRow.hidden = true;
      return;
    }
    detailRow.hidden = false;
    const body = detailRow.querySelector('.menu-detail-body');
    body.innerHTML = 'Memuat resep...';
    const outlet = outlets.find((o) => o.id === state.outletId);
    const mode = outlet?.outlet_role === 'served_by_ck' ? 'served_by_ck' : 'standalone';
    let recipe = recipeCache.get(`${menu.id}|${mode}`);
    if (!recipe) {
      try {
        recipe = await getRecipeForProduct(menu.id, mode);
        recipeCache.set(`${menu.id}|${mode}`, recipe);
      } catch {
        body.innerHTML = '<span class="error-text">Gagal memuat resep.</span>';
        return;
      }
    }
    if (!recipe.recipe || !recipe.items.length) {
      body.innerHTML = `<span style="color:var(--color-text-muted)">Resep (${mode === 'served_by_ck' ? 'Dilayani CK' : 'Standalone'}) belum diatur untuk menu ini.</span>`;
      return;
    }
    const yieldQty = Number(recipe.recipe.yield_qty) || 1;
    let maxMake = Infinity;
    const rows = recipe.items.map((it) => {
      const need = Number(it.qty) / yieldQty; // per 1 menu
      const stock = state.stock.get(it.ingredient_product_id) ?? 0;
      if (need > 0) maxMake = Math.min(maxMake, Math.floor(stock / need));
      return `<tr><td data-label="Bahan">${esc(it.products?.name ?? '-')}</td><td data-label="Per menu">${formatNum(need)} ${esc(it.products?.base_unit ?? '')}</td><td data-label="Stok">${formatNum(stock)} ${esc(it.products?.base_unit ?? '')}</td></tr>`;
    });
    body.innerHTML = `
      <div style="font-size:0.82rem;color:var(--color-text-muted);margin-bottom:4px">Resep ${mode === 'served_by_ck' ? 'Dilayani CK' : 'Standalone'} · perkiraan bisa dibuat: <strong>${Number.isFinite(maxMake) ? maxMake : '—'}</strong> menu</div>
      <table class="data-table kartu-sempit"><thead><tr><th>Bahan</th><th>Per menu</th><th>Stok</th></tr></thead><tbody>${rows.join('')}</tbody></table>
    `;
  }

  outletSel.addEventListener('change', () => {
    state.outletId = outletSel.value;
    reload();
  });
  catSel.addEventListener('change', () => {
    state.category = catSel.value;
    renderRows();
  });

  await reload();
}

function round(n) {
  return Math.round(Number(n) * 100) / 100;
}
function fmtDate(d) {
  return new Date(d + 'T00:00:00').toLocaleDateString('id-ID', { weekday: 'long', day: '2-digit', month: 'short' });
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
