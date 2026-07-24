import { toast, confirmDialog, formDialog, renderSearchSelect, wireSearchSelect, infoDialog } from '../../core/ui.js';
import { formatRupiah } from '../../core/format.js';
import { importProducts, importRecipes, downloadProductTemplate, downloadRecipeTemplate } from './product-import.js';
import {
  PRODUCT_TYPES,
  TYPE_LABEL,
  listProducts,
  createProduct,
  updateProduct,
  deleteProduct,
  getRecipeForProduct,
  saveRecipe,
  listRecipesFull,
  computeCosts,
  costForMode,
  listUnits,
  createUnit,
  deleteUnit
} from './product.service.js';

const TABS = [
  { key: 'products', label: 'Produk' },
  { key: 'recipes', label: 'Resep' },
  { key: 'units', label: 'Satuan' }
];

const MODE_LABEL = { production: 'Produksi (CK)', standalone: 'Standalone', served_by_ck: 'Dilayani CK' };
const modesForType = (t) => (t === 'semi' ? ['production'] : t === 'finished' ? ['standalone', 'served_by_ck'] : []);

export async function renderMasterProductPage(container, { businessUnitId }) {
  container.innerHTML = `
    <h1>Master Produk</h1>
    <div class="tab-bar">
      ${TABS.map((t, i) => `<button class="tab-btn ${i === 0 ? 'active' : ''}" data-tab="${t.key}">${t.label}</button>`).join('')}
    </div>
    <div id="mp-content"></div>
  `;
  const content = document.getElementById('mp-content');
  async function showTab(key) {
    container.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === key));
    if (key === 'products') await renderProductsTab(content, businessUnitId);
    if (key === 'recipes') await renderRecipesTab(content, businessUnitId);
    if (key === 'units') await renderUnitsTab(content);
  }
  container.querySelectorAll('.tab-btn').forEach((btn) => btn.addEventListener('click', () => showTab(btn.dataset.tab)));
  await showTab('products');
}

async function loadProductsAndCosts(businessUnitId) {
  const [products, recipes] = await Promise.all([listProducts(businessUnitId), listRecipesFull(businessUnitId)]);
  const costs = computeCosts(products, recipes);
  return { products, recipes, costs };
}

// ---- Tab: Produk ----

async function renderProductsTab(content, businessUnitId) {
  content.innerHTML = `<p>Memuat produk...</p>`;
  let data;
  try {
    data = await loadProductsAndCosts(businessUnitId);
  } catch (error) {
    content.innerHTML = `<p class="error-text">${error.message ?? error}</p>`;
    return;
  }
  const { products, costs } = data;

  content.innerHTML = `
    <div class="page-header">
      <h2 style="font-size:1.05rem;margin:0">Produk</h2>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button id="btn-tpl-product">Template</button>
        <button id="btn-import-product">Import Excel</button>
        <button class="primary" id="btn-new-product" style="max-width:180px">+ Tambah Produk</button>
      </div>
    </div>
    <table class="data-table">
      <thead><tr><th>Nama</th><th>Tipe</th><th>Satuan</th><th>Harga Beli</th><th>HPP / Satuan</th><th>Harga Jual</th><th>Margin</th><th>Aksi</th></tr></thead>
      <tbody>
        ${products.map((p) => productRowHtml(p, costs.get(p.id))).join('') || '<tr><td colspan="8">Belum ada produk.</td></tr>'}
      </tbody>
    </table>
  `;
  document.getElementById('btn-new-product').addEventListener('click', () => openProductDialog(content, businessUnitId, null));
  document.getElementById('btn-tpl-product').addEventListener('click', downloadProductTemplate);
  document.getElementById('btn-import-product').addEventListener('click', () =>
    openImport(content, businessUnitId, 'products', () => renderProductsTab(content, businessUnitId))
  );
  content.querySelectorAll('.btn-edit-product').forEach((btn) =>
    btn.addEventListener('click', () => openProductDialog(content, businessUnitId, JSON.parse(btn.dataset.json)))
  );
  content.querySelectorAll('.btn-del-product').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const ok = await confirmDialog({ title: 'Hapus produk?', message: 'Produk & resep terkait akan terhapus. Bahan yang masih dipakai resep lain tidak bisa dihapus.', confirmText: 'Hapus', danger: true });
      if (!ok) return;
      try {
        await deleteProduct(btn.dataset.id);
        toast('Produk dihapus.', 'success');
        await renderProductsTab(content, businessUnitId);
      } catch (error) {
        toast(error.message ?? 'Gagal menghapus (mungkin masih dipakai resep lain).', 'error');
      }
    })
  );
}

function productRowHtml(p, cost) {
  const beli =
    p.product_type === 'raw' && p.purchase_price != null
      ? `${formatRupiah(p.purchase_price)} / ${escapeHtml(p.purchase_unit ?? p.base_unit)}${p.purchase_qty ? ` <span style="color:var(--color-text-muted)">(${p.purchase_qty} ${escapeHtml(p.base_unit)})</span>` : ''}`
      : '-';
  const hpp = cost != null ? `${formatRupiah(cost)} <span style="color:var(--color-text-muted)">/${escapeHtml(p.base_unit)}</span>` : '<span style="color:var(--color-text-muted)">-</span>';
  const jual = p.product_type === 'finished' && p.sale_price != null ? formatRupiah(p.sale_price) : '-';
  let margin = '-';
  if (p.product_type === 'finished' && p.sale_price != null && cost != null) {
    const m = Number(p.sale_price) - cost;
    const pct = p.sale_price > 0 ? Math.round((m / Number(p.sale_price)) * 100) : 0;
    margin = `${formatRupiah(m)} <span style="color:var(--color-text-muted)">(${pct}%)</span>`;
  }
  return `
    <tr>
      <td>${escapeHtml(p.name)}${p.is_active === false ? ' <span style="font-size:0.7rem;color:var(--color-danger)">(nonaktif)</span>' : ''}</td>
      <td>${TYPE_LABEL[p.product_type] ?? p.product_type}</td>
      <td>${escapeHtml(p.base_unit)}</td>
      <td>${beli}</td>
      <td>${hpp}</td>
      <td>${jual}</td>
      <td>${margin}</td>
      <td>
        <button class="btn-edit-product" data-json='${escapeAttr(JSON.stringify(p))}'>Edit</button>
        <button class="btn-del-product" data-id="${p.id}">Hapus</button>
      </td>
    </tr>`;
}

async function openProductDialog(content, businessUnitId, existing) {
  const isEdit = !!existing;
  let units = [];
  try {
    units = await listUnits();
  } catch {
    units = [];
  }
  const unitOptions = units.map((u) => ({ value: u.name, label: u.name }));
  const values = await formDialog({
    title: isEdit ? 'Edit Produk' : 'Tambah Produk',
    fields: [
      { name: 'name', label: 'Nama Produk', type: 'text', required: true, value: existing?.name ?? '' },
      { name: 'product_type', label: 'Tipe', type: 'select', required: true, value: existing?.product_type ?? 'raw', options: PRODUCT_TYPES },
      { name: 'base_unit', label: 'Satuan pakai (di resep/stok)', type: 'select', required: true, value: existing?.base_unit ?? '', options: [{ value: '', label: '-- pilih satuan --' }, ...unitOptions] },
      { name: 'purchase_unit', label: 'Satuan beli', type: 'select', value: existing?.purchase_unit ?? '', options: [{ value: '', label: '-- pilih satuan --' }, ...unitOptions] },
      { name: 'purchase_qty', label: 'Isi per satuan beli (dalam satuan pakai)', type: 'number', min: 0, value: existing?.purchase_qty ?? '', placeholder: 'mis. 25000' },
      { name: 'purchase_price', label: 'Harga beli / satuan beli', type: 'money', value: existing?.purchase_price ?? '' },
      { name: 'sale_price', label: 'Harga jual', type: 'money', value: existing?.sale_price ?? '' },
      ...(isEdit ? [{ name: 'is_active', label: 'Aktif', type: 'checkbox', value: existing.is_active }] : [])
    ],
    submitText: 'Simpan',
    onReady: (form) => {
      const typeSel = form.elements['product_type'];
      const show = (name, on) => {
        const el = form.elements[name]?.closest('.field');
        if (el) el.style.display = on ? 'block' : 'none';
      };
      const sync = () => {
        const t = typeSel.value;
        show('purchase_unit', t === 'raw');
        show('purchase_qty', t === 'raw');
        show('purchase_price', t === 'raw');
        show('sale_price', t === 'finished');
      };
      typeSel.addEventListener('change', sync);
      sync();
    }
  });
  if (!values) return;

  const isRaw = values.product_type === 'raw';
  const isFinished = values.product_type === 'finished';
  const payload = {
    businessUnitId,
    name: values.name,
    product_type: values.product_type,
    base_unit: values.base_unit,
    purchase_unit: isRaw ? values.purchase_unit : null,
    purchase_qty: isRaw && values.purchase_qty !== '' ? Number(values.purchase_qty) : null,
    purchase_price: isRaw && values.purchase_price ? values.purchase_price : null,
    sale_price: isFinished && values.sale_price ? values.sale_price : null,
    is_active: isEdit ? values.is_active : true
  };
  try {
    if (isEdit) await updateProduct(existing.id, payload);
    else await createProduct(payload);
    toast(isEdit ? 'Produk diperbarui.' : 'Produk ditambahkan.', 'success');
    await renderProductsTab(content, businessUnitId);
  } catch (error) {
    toast(error.message ?? 'Gagal menyimpan produk.', 'error');
  }
}

// ---- Tab: Resep ----

async function renderRecipesTab(content, businessUnitId) {
  content.innerHTML = `<p>Memuat resep...</p>`;
  let data;
  try {
    data = await loadProductsAndCosts(businessUnitId);
  } catch (error) {
    content.innerHTML = `<p class="error-text">${error.message ?? error}</p>`;
    return;
  }
  const { products, recipes } = data;
  const manufactured = products.filter((p) => p.product_type === 'semi' || p.product_type === 'finished');
  const recipeSet = new Set(recipes.map((r) => `${r.product_id}|${r.mode}`));

  content.innerHTML = `
    <div class="page-header">
      <p style="color:var(--color-text-muted);font-size:0.9rem;margin:0;max-width:420px">Setengah Jadi punya 1 resep <strong>Produksi</strong> (dibuat di CK). Produk Jadi bisa 2 varian: <strong>Standalone</strong> (dari bahan baku) &amp; <strong>Dilayani CK</strong> (dari setengah jadi). HPP otomatis.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button id="btn-tpl-recipe">Template</button>
        <button id="btn-import-recipe">Import Excel</button>
      </div>
    </div>
    <table class="data-table">
      <thead><tr><th>Produk</th><th>Tipe</th><th>Varian resep &amp; HPP</th><th>Aksi</th></tr></thead>
      <tbody>
        ${
          manufactured
            .map((p) => {
              const modes = modesForType(p.product_type);
              const variants = modes
                .map((m) => {
                  const has = recipeSet.has(`${p.id}|${m}`);
                  const cost = costForMode(products, recipes, p.id, m);
                  const val = has ? (cost != null ? formatRupiah(cost) + `/${escapeHtml(p.base_unit)}` : 'resep belum lengkap') : '<span class="badge badge-pending">Belum</span>';
                  return `<div style="margin:2px 0"><strong>${MODE_LABEL[m]}:</strong> ${val}</div>`;
                })
                .join('');
              const actions = modes.map((m) => `<button class="btn-edit-recipe" data-id="${p.id}" data-mode="${m}">${MODE_LABEL[m]}</button>`).join(' ');
              return `<tr><td>${escapeHtml(p.name)}</td><td>${TYPE_LABEL[p.product_type]}</td><td style="font-size:0.85rem">${variants}</td><td>${actions}</td></tr>`;
            })
            .join('') || '<tr><td colspan="4">Belum ada produk setengah jadi / jadi.</td></tr>'
        }
      </tbody>
    </table>
    <div id="recipe-editor" style="margin-top:16px"></div>
  `;

  content.querySelectorAll('.btn-edit-recipe').forEach((btn) =>
    btn.addEventListener('click', () => openRecipeEditor(content, businessUnitId, products.find((p) => p.id === btn.dataset.id), products, btn.dataset.mode))
  );
  document.getElementById('btn-tpl-recipe').addEventListener('click', downloadRecipeTemplate);
  document.getElementById('btn-import-recipe').addEventListener('click', () =>
    openImport(content, businessUnitId, 'recipes', () => renderRecipesTab(content, businessUnitId))
  );
}

async function openImport(content, businessUnitId, kind, refresh) {
  const isProducts = kind === 'products';
  const v = await formDialog({
    title: isProducts ? 'Import Produk (Excel/CSV)' : 'Import Resep (Excel/CSV)',
    description: isProducts
      ? 'Kolom: Nama, Tipe, Satuan Pakai, Satuan Beli, Isi per Satuan Beli, Harga Beli, Harga Jual. Yang namanya sudah ada dilewati.'
      : 'Kolom: Produk, Yield, Bahan, Jumlah (satu baris per bahan). Produk & bahan harus sudah ada di Master Produk. Produk yang sudah punya resep dilewati.',
    fields: [{ name: 'file', label: 'File .xlsx / .csv', type: 'file', required: true, accept: '.xlsx,.xls,.csv' }],
    submitText: 'Import'
  });
  if (!v || !v.file) return;
  toast('Memproses file...', 'info');
  try {
    const res = isProducts ? await importProducts(businessUnitId, v.file) : await importRecipes(businessUnitId, v.file);
    const errHtml = res.errors.length
      ? `<p style="color:var(--color-danger);margin-top:8px">Gagal/terlewat (${res.errors.length}):</p><ul style="margin:0;padding-left:18px;max-height:200px;overflow:auto">${res.errors.map((e) => `<li>${escapeHtml(e)}</li>`).join('')}</ul>`
      : '';
    await infoDialog({
      title: 'Hasil Import',
      bodyHtml: `<p><strong>${res.added}</strong> ditambahkan, <strong>${res.skipped}</strong> dilewati (sudah ada).</p>${errHtml}`
    });
    await refresh();
  } catch (error) {
    toast(error.message ?? 'Gagal import.', 'error');
  }
}

async function openRecipeEditor(content, businessUnitId, product, products, mode) {
  const editor = content.querySelector('#recipe-editor');
  editor.innerHTML = `<p>Memuat resep...</p>`;
  let current;
  try {
    current = await getRecipeForProduct(product.id, mode);
  } catch (error) {
    editor.innerHTML = `<p class="error-text">${error.message ?? error}</p>`;
    return;
  }
  // Bahan yang boleh: bahan baku & setengah jadi, kecuali produk ini sendiri.
  const ingredientOptions = products.filter((p) => (p.product_type === 'raw' || p.product_type === 'semi') && p.id !== product.id);
  const ingOpts = ingredientOptions.map((o) => ({ value: o.id, label: `${o.name} (${TYPE_LABEL[o.product_type]})` }));

  const rowsHtml = (current.items.length ? current.items : [{ ingredient_product_id: '', qty: '' }])
    .map((it) => ingredientRowHtml(it, ingOpts))
    .join('');

  editor.innerHTML = `
    <div class="inline-card" style="max-width:640px">
      <h3 style="margin-top:0">Resep: ${escapeHtml(product.name)} <span style="font-size:0.8rem;color:var(--color-text-muted)">(${TYPE_LABEL[product.product_type]} · ${MODE_LABEL[mode] ?? mode})</span></h3>
      <div class="field" style="max-width:280px">
        <label>Hasil / yield (dalam ${escapeHtml(product.base_unit)})</label>
        <input type="number" id="recipe-yield" min="0" value="${current.recipe?.yield_qty ?? 1}" />
      </div>
      <h4 style="margin:12px 0 6px;font-size:0.9rem">Bahan</h4>
      <table class="data-table"><thead><tr><th>Bahan</th><th>Jumlah</th><th>Satuan</th><th></th></tr></thead>
        <tbody id="recipe-rows">${rowsHtml}</tbody>
      </table>
      <button id="btn-add-ingredient" style="margin-top:10px">+ Tambah Bahan</button>
      <div class="field" style="margin-top:12px"><label>Catatan (opsional)</label><input type="text" id="recipe-notes" value="${escapeAttr(current.recipe?.notes ?? '')}" /></div>
      <button class="primary" id="btn-save-recipe" style="max-width:200px">Simpan Resep</button>
      <p class="error-text" id="recipe-error"></p>
    </div>
  `;

  const rowsBody = editor.querySelector('#recipe-rows');
  const wireRow = (tr) => {
    const widget = tr.querySelector('.search-select');
    const unitCell = tr.querySelector('.ing-unit');
    const updateUnit = (val) => {
      const p = ingredientOptions.find((o) => o.id === val);
      unitCell.textContent = p ? p.base_unit : '-';
    };
    wireSearchSelect(widget, ingOpts, updateUnit);
    updateUnit(widget.querySelector('input[type="hidden"]').value);
    tr.querySelector('.ing-remove').addEventListener('click', () => tr.remove());
  };
  rowsBody.querySelectorAll('tr').forEach(wireRow);

  editor.querySelector('#btn-add-ingredient').addEventListener('click', () => {
    const wrap = document.createElement('tbody');
    wrap.innerHTML = ingredientRowHtml({ ingredient_product_id: '', qty: '' }, ingOpts);
    const tr = wrap.firstElementChild;
    rowsBody.appendChild(tr);
    wireRow(tr);
  });

  editor.querySelector('#btn-save-recipe').addEventListener('click', async () => {
    const errorEl = editor.querySelector('#recipe-error');
    errorEl.textContent = '';
    const yieldQty = Number(editor.querySelector('#recipe-yield').value);
    if (!(yieldQty > 0)) {
      errorEl.textContent = 'Hasil/yield harus lebih dari 0.';
      return;
    }
    const items = [...rowsBody.querySelectorAll('tr')]
      .map((tr) => ({ ingredient_product_id: tr.querySelector('.search-select input[type="hidden"]').value, qty: Number(tr.querySelector('.ing-qty').value) }))
      .filter((i) => i.ingredient_product_id && i.qty > 0);
    if (!items.length) {
      errorEl.textContent = 'Tambahkan minimal satu bahan.';
      return;
    }
    try {
      await saveRecipe({ productId: product.id, businessUnitId, mode, yield_qty: yieldQty, notes: editor.querySelector('#recipe-notes').value, items });
      toast('Resep disimpan.', 'success');
      await renderRecipesTab(content, businessUnitId);
    } catch (error) {
      errorEl.textContent = error.message ?? 'Gagal menyimpan resep.';
    }
  });
}

function ingredientRowHtml(it, ingOpts) {
  return `
    <tr>
      <td>${renderSearchSelect({ name: 'ing', options: ingOpts, value: it.ingredient_product_id ?? '', placeholder: 'cari bahan…' })}</td>
      <td><input type="number" class="ing-qty" min="0" value="${it.qty ?? ''}" style="max-width:100px" /></td>
      <td class="ing-unit" style="font-size:0.82rem;color:var(--color-text-muted)">-</td>
      <td><button class="ing-remove" title="Hapus bahan">✕</button></td>
    </tr>`;
}

// ---- Tab: Satuan (global) ----

async function renderUnitsTab(content) {
  content.innerHTML = `<p>Memuat satuan...</p>`;
  let units;
  try {
    units = await listUnits();
  } catch (error) {
    content.innerHTML = `<p class="error-text">${error.message ?? error}</p>`;
    return;
  }
  content.innerHTML = `
    <div class="page-header">
      <h2 style="font-size:1.05rem;margin:0">Satuan (dipakai semua BU)</h2>
      <button class="primary" id="btn-new-unit" style="max-width:180px">+ Tambah Satuan</button>
    </div>
    <p style="color:var(--color-text-muted);font-size:0.85rem">Satuan dipilih lewat dropdown saat menambah produk, biar konsisten. Hanya Super Admin yang bisa ubah daftar ini.</p>
    <table class="data-table" style="max-width:360px">
      <thead><tr><th>Satuan</th><th>Aksi</th></tr></thead>
      <tbody>
        ${units.map((u) => `<tr><td>${escapeHtml(u.name)}</td><td><button class="btn-del-unit" data-id="${u.id}">Hapus</button></td></tr>`).join('') || '<tr><td colspan="2">Belum ada satuan.</td></tr>'}
      </tbody>
    </table>
  `;
  document.getElementById('btn-new-unit').addEventListener('click', async () => {
    const v = await formDialog({ title: 'Tambah Satuan', fields: [{ name: 'name', label: 'Nama Satuan', type: 'text', required: true, placeholder: 'mis. gram' }], submitText: 'Simpan' });
    if (!v) return;
    try {
      await createUnit(v.name.trim());
      toast('Satuan ditambahkan.', 'success');
      await renderUnitsTab(content);
    } catch (error) {
      toast(error.message ?? 'Gagal menambah (hanya Super Admin).', 'error');
    }
  });
  content.querySelectorAll('.btn-del-unit').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const ok = await confirmDialog({ title: 'Hapus satuan?', confirmText: 'Hapus', danger: true });
      if (!ok) return;
      try {
        await deleteUnit(btn.dataset.id);
        toast('Satuan dihapus.', 'success');
        await renderUnitsTab(content);
      } catch (error) {
        toast(error.message ?? 'Gagal menghapus.', 'error');
      }
    })
  );
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(s) {
  return escapeHtml(s);
}
