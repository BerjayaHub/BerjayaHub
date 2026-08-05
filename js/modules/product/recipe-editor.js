import { toast, renderSearchSelect, wireSearchSelect } from '../../core/ui.js';
import { TYPE_LABEL, getRecipeForProduct, saveRecipe } from './product.service.js';
import { loadingHtml } from '../../core/loading.js';

export const MODE_LABEL = { production: 'Produksi (CK)', standalone: 'Standalone', served_by_ck: 'Dilayani CK' };
export const modesForType = (t) => (t === 'semi' ? ['production'] : t === 'finished' ? ['standalone', 'served_by_ck'] : []);

/**
 * Editor resep (dipakai Master Produk & modul Menu).
 * @param mountEl  elemen tempat editor dirender
 * @param opts     { businessUnitId, product, products, mode, onSaved }
 */
export async function openRecipeEditor(mountEl, { businessUnitId, product, products, mode, onSaved }) {
  mountEl.innerHTML = loadingHtml('Memuat resep…');
  let current;
  try {
    current = await getRecipeForProduct(product.id, mode);
  } catch (error) {
    mountEl.innerHTML = `<p class="error-text">${error.message ?? error}</p>`;
    return;
  }

  // Bahan yang boleh: bahan baku & setengah jadi, kecuali produk ini sendiri.
  const ingredientOptions = products.filter((p) => (p.product_type === 'raw' || p.product_type === 'semi') && p.id !== product.id);
  const ingOpts = ingredientOptions.map((o) => ({ value: o.id, label: `${o.name} (${TYPE_LABEL[o.product_type]})` }));

  const rowsHtml = (current.items.length ? current.items : [{ ingredient_product_id: '', qty: '' }])
    .map((it) => ingredientRowHtml(it, ingOpts))
    .join('');

  mountEl.innerHTML = `
    <div class="inline-card fade-in" style="max-width:640px">
      <h3 style="margin-top:0">Resep: ${esc(product.name)}
        <span style="font-size:0.8rem;color:var(--color-text-muted)">(${TYPE_LABEL[product.product_type]} · ${MODE_LABEL[mode] ?? mode})</span>
      </h3>
      <div class="field" style="max-width:280px">
        <label>Hasil / yield (dalam ${esc(product.base_unit)})</label>
        <input type="number" id="recipe-yield" min="0" value="${current.recipe?.yield_qty ?? 1}" />
      </div>
      <h4 style="margin:12px 0 6px;font-size:0.9rem">Bahan</h4>
      <div class="line-rows" id="recipe-rows">${rowsHtml}</div>
      <button id="btn-add-ingredient" style="margin-top:10px">+ Tambah Bahan</button>
      <div class="field" style="margin-top:12px"><label>Catatan (opsional)</label><input type="text" id="recipe-notes" value="${esc(current.recipe?.notes ?? '')}" /></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px">
        <button class="primary" id="btn-save-recipe" style="max-width:200px">Simpan Resep</button>
        <button id="btn-close-recipe">Tutup</button>
      </div>
      <p class="error-text" id="recipe-error"></p>
    </div>
  `;

  const rowsBody = mountEl.querySelector('#recipe-rows');
  const wireRow = (row) => {
    const widget = row.querySelector('.search-select');
    const unitCell = row.querySelector('.ln-unit');
    const updateUnit = (val) => {
      const p = ingredientOptions.find((o) => o.id === val);
      unitCell.textContent = p ? p.base_unit : '-';
    };
    wireSearchSelect(widget, ingOpts, updateUnit);
    updateUnit(widget.querySelector('input[type="hidden"]').value);
    row.querySelector('.ln-remove').addEventListener('click', () => row.remove());
  };
  rowsBody.querySelectorAll('.line-row').forEach(wireRow);

  mountEl.querySelector('#btn-add-ingredient').addEventListener('click', () => {
    const wrap = document.createElement('div');
    wrap.innerHTML = ingredientRowHtml({ ingredient_product_id: '', qty: '' }, ingOpts);
    const row = wrap.firstElementChild;
    rowsBody.appendChild(row);
    wireRow(row);
  });

  mountEl.querySelector('#btn-close-recipe').addEventListener('click', () => {
    mountEl.innerHTML = '';
  });

  mountEl.querySelector('#btn-save-recipe').addEventListener('click', async () => {
    const errorEl = mountEl.querySelector('#recipe-error');
    errorEl.textContent = '';
    const yieldQty = Number(mountEl.querySelector('#recipe-yield').value);
    if (!(yieldQty > 0)) {
      errorEl.textContent = 'Hasil/yield harus lebih dari 0.';
      return;
    }
    const items = [...rowsBody.querySelectorAll('.line-row')]
      .map((row) => ({
        ingredient_product_id: row.querySelector('.search-select input[type="hidden"]').value,
        qty: Number(row.querySelector('.ln-qty').value)
      }))
      .filter((i) => i.ingredient_product_id && i.qty > 0);
    if (!items.length) {
      errorEl.textContent = 'Tambahkan minimal satu bahan.';
      return;
    }
    try {
      await saveRecipe({
        productId: product.id,
        businessUnitId,
        mode,
        yield_qty: yieldQty,
        notes: mountEl.querySelector('#recipe-notes').value,
        items
      });
      toast('Resep disimpan.', 'success');
      await onSaved?.();
    } catch (error) {
      errorEl.textContent = error.message ?? 'Gagal menyimpan resep.';
    }
  });
}

function ingredientRowHtml(it, ingOpts) {
  return `
    <div class="line-row">
      ${renderSearchSelect({ name: 'ing', options: ingOpts, value: it.ingredient_product_id ?? '', placeholder: 'cari bahan…' })}
      <input type="number" class="ln-qty" min="0" placeholder="jumlah" value="${it.qty ?? ''}" />
      <span class="ln-unit">-</span>
      <button class="ln-remove" title="Hapus bahan">✕</button>
    </div>`;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
