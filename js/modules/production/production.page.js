import { listMyOutlets } from '../../core/my-outlets.js';
import { toast, renderSearchSelect, wireSearchSelect } from '../../core/ui.js';
import { formatNum } from '../../core/format.js';
import { getOutletStockMap } from '../inventory/inventory.service.js';
import { listManufacturable, computeNeeds, recordProduction } from './production.service.js';

export async function renderProductionPage(container, { businessUnitId, outletId }) {
  container.innerHTML = `<p>Memuat produksi...</p>`;

  let outlets, products;
  try {
    [outlets, products] = await Promise.all([
      // Produksi hanya di outlet Central Kitchen, dan hanya CK yang boleh diakses akun ini.
      listMyOutlets(businessUnitId).then((all) =>
        all.filter((o) => o.outlet_role === 'central_kitchen').map((o) => ({ id: o.id, name: o.name }))
      ),
      listManufacturable(businessUnitId)
    ]);
  } catch (error) {
    container.innerHTML = `<p class="error-text">Gagal memuat: ${error.message ?? error}</p>`;
    return;
  }
  if (!outlets.length) {
    container.innerHTML = `<h1>Produksi</h1><p style="color:var(--color-text-muted)">Produksi hanya untuk outlet <strong>Central Kitchen</strong>. Belum ada outlet CK yang bisa kamu akses di BU ini.</p>`;
    return;
  }
  if (!products.length) {
    container.innerHTML = `<h1>Produksi</h1><p style="color:var(--color-text-muted)">Belum ada produk yang punya resep. Minta admin mengisi Resep di Master Produk dulu.</p>`;
    return;
  }

  const productById = new Map(products.map((p) => [p.id, p]));
  const productOptions = products.map((p) => ({ value: p.id, label: `${p.name} (${p.base_unit})` }));
  const state = { outletId: outlets.some((o) => o.id === outletId) ? outletId : outlets[0].id, productId: '', stockMap: new Map() };

  container.innerHTML = `
    <h1>Produksi</h1>
    <div class="inline-card" style="max-width:560px">
      <div class="field"><label>Outlet</label>
        <select id="prod-outlet">${outlets.map((o) => `<option value="${o.id}"${o.id === state.outletId ? ' selected' : ''}>${esc(o.name)}</option>`).join('')}</select>
      </div>
      <div class="field"><label>Produk yang dibuat</label>
        ${renderSearchSelect({ name: 'prod-product', options: productOptions, placeholder: 'cari produk…' })}
      </div>
      <div class="field"><label>Jumlah hasil (output)</label>
        <input type="number" id="prod-qty" min="0" placeholder="mis. 1800" />
        <span class="field-help" id="prod-unit-help"></span>
      </div>
      <div id="prod-preview"></div>
      <div class="field"><label>Catatan (opsional)</label><input type="text" id="prod-notes" /></div>
      <button class="primary" id="prod-submit">Catat Produksi</button>
      <p class="error-text" id="prod-error"></p>
    </div>
  `;

  const outletSel = container.querySelector('#prod-outlet');
  const qtyInput = container.querySelector('#prod-qty');
  const unitHelp = container.querySelector('#prod-unit-help');
  const preview = container.querySelector('#prod-preview');
  const widget = container.querySelector('.search-select[data-name="prod-product"]');

  async function loadStock() {
    try {
      state.stockMap = await getOutletStockMap(businessUnitId, state.outletId);
    } catch {
      state.stockMap = new Map();
    }
  }

  function updatePreview() {
    const product = productById.get(state.productId);
    unitHelp.textContent = product ? `dalam ${product.base_unit} (1 resep menghasilkan ${formatNum(product.yield_qty)} ${product.base_unit})` : '';
    const qty = Number(qtyInput.value);
    if (!product || !(qty > 0)) {
      preview.innerHTML = '';
      return;
    }
    const needs = computeNeeds(product, qty);
    preview.innerHTML = `
      <p style="font-size:0.85rem;font-weight:600;margin:4px 0">Kebutuhan bahan:</p>
      <div class="table-scroll"><table class="data-table table-freeze-1">
        <thead><tr><th>Bahan</th><th>Butuh</th><th>Stok</th><th></th></tr></thead>
        <tbody>
          ${needs
            .map((n) => {
              const stok = state.stockMap.get(n.ingredient_product_id) ?? 0;
              const cukup = stok >= n.need;
              return `<tr>
                <td>${esc(n.name)}</td>
                <td>${formatNum(n.need)} ${esc(n.base_unit)}</td>
                <td>${formatNum(stok)} ${esc(n.base_unit)}</td>
                <td>${cukup ? '✅' : '<span style="color:var(--color-danger)">kurang</span>'}</td>
              </tr>`;
            })
            .join('')}
        </tbody>
      </table></div>
      ${needs.some((n) => (state.stockMap.get(n.ingredient_product_id) ?? 0) < n.need) ? '<p style="font-size:0.8rem;color:#8a5800">Sebagian bahan kurang — produksi tetap diizinkan, stok bahan bisa jadi minus.</p>' : ''}
    `;
  }

  wireSearchSelect(widget, productOptions, (val) => {
    state.productId = val;
    updatePreview();
  });
  outletSel.addEventListener('change', async () => {
    state.outletId = outletSel.value;
    await loadStock();
    updatePreview();
  });
  qtyInput.addEventListener('input', updatePreview);

  container.querySelector('#prod-submit').addEventListener('click', async (e) => {
    const errorEl = container.querySelector('#prod-error');
    errorEl.textContent = '';
    const product = productById.get(state.productId);
    const qty = Number(qtyInput.value);
    if (!product) {
      errorEl.textContent = 'Pilih produk dulu.';
      return;
    }
    if (!(qty > 0)) {
      errorEl.textContent = 'Isi jumlah hasil yang valid.';
      return;
    }
    e.target.disabled = true;
    try {
      await recordProduction({ businessUnitId, outletId: state.outletId, productId: state.productId, outputQty: qty, notes: container.querySelector('#prod-notes').value });
      toast(`Produksi ${product.name} tercatat. Stok diperbarui.`, 'success');
      qtyInput.value = '';
      container.querySelector('#prod-notes').value = '';
      await loadStock();
      updatePreview();
    } catch (error) {
      errorEl.textContent = error.message ?? 'Gagal mencatat produksi.';
    } finally {
      e.target.disabled = false;
    }
  });

  await loadStock();
}

function round(n) {
  return Math.round(Number(n) * 100) / 100;
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
