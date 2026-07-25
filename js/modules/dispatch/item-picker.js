import { renderSearchSelect, wireSearchSelect } from '../../core/ui.js';
import { formatNum } from '../../core/format.js';

/**
 * Komponen pemilih produk untuk form Order / Kirim / Transfer.
 * - Filter Kategori & Sub-kategori untuk mempersempit pilihan.
 * - Pencarian fuzzy pada tiap baris.
 * - Opsional menampilkan kolom "Stok Akhir" di outlet asal.
 *
 * @returns {{ getItems: () => Array<{product_id:string, qty:number}> }}
 */
export function createItemPicker(mountEl, { products, stockMap = new Map(), showStock = true }) {
  const categories = [...new Set(products.map((p) => p.category).filter(Boolean))].sort();
  const state = { category: '', subcategory: '' };

  mountEl.innerHTML = `
    <div class="picker-filters">
      <div class="field" style="margin:0;max-width:190px">
        <label>Kategori</label>
        <select class="pf-cat"><option value="">Semua</option>${categories.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}</select>
      </div>
      <div class="field" style="margin:0;max-width:190px">
        <label>Sub-kategori</label>
        <select class="pf-sub"><option value="">Semua</option></select>
      </div>
    </div>
    <div class="picker-rows"></div>
    <button type="button" class="pf-add" style="margin-top:8px">+ Tambah Produk</button>
  `;

  const catSel = mountEl.querySelector('.pf-cat');
  const subSel = mountEl.querySelector('.pf-sub');
  const rowsBox = mountEl.querySelector('.picker-rows');

  const filtered = () =>
    products.filter((p) => (!state.category || p.category === state.category) && (!state.subcategory || p.subcategory === state.subcategory));
  const optionsOf = (list) => list.map((p) => ({ value: p.id, label: `${p.name} (${p.base_unit})` }));

  function refreshSubOptions() {
    const subs = [...new Set(filteredByCategoryOnly().map((p) => p.subcategory).filter(Boolean))].sort();
    subSel.innerHTML = `<option value="">Semua</option>${subs.map((s) => `<option value="${esc(s)}"${s === state.subcategory ? ' selected' : ''}>${esc(s)}</option>`).join('')}`;
  }
  function filteredByCategoryOnly() {
    return products.filter((p) => !state.category || p.category === state.category);
  }

  /** Simpan isian baris saat ini supaya tidak hilang ketika filter berubah. */
  function snapshot() {
    return [...rowsBox.querySelectorAll('.picker-row')].map((row) => ({
      product_id: row.querySelector('.search-select input[type="hidden"]').value,
      qty: row.querySelector('.pf-qty').value
    }));
  }

  function rowHtml(entry, opts) {
    const p = products.find((x) => x.id === entry.product_id);
    const stok = p ? stockMap.get(p.id) ?? 0 : null;
    return `
      <div class="picker-row">
        ${renderSearchSelect({ name: 'pp', options: opts, value: entry.product_id ?? '', placeholder: 'cari produk…' })}
        ${showStock ? `<span class="pf-stock" title="Stok akhir di outlet ini">${p ? `${formatNum(stok)} ${esc(p.base_unit)}` : '–'}</span>` : ''}
        <input type="number" class="pf-qty" min="0" placeholder="jumlah" value="${entry.qty ?? ''}" />
        <button type="button" class="pf-remove" title="Hapus">✕</button>
      </div>`;
  }

  function wireRow(row, opts) {
    const widget = row.querySelector('.search-select');
    const stockEl = row.querySelector('.pf-stock');
    wireSearchSelect(widget, opts, (val) => {
      if (!stockEl) return;
      const p = products.find((x) => x.id === val);
      stockEl.textContent = p ? `${formatNum(stockMap.get(p.id) ?? 0)} ${p.base_unit}` : '–';
    });
    row.querySelector('.pf-remove').addEventListener('click', () => {
      row.remove();
      if (!rowsBox.querySelector('.picker-row')) addRow();
    });
  }

  function renderRows(entries) {
    const opts = optionsOf(filtered());
    rowsBox.innerHTML = (entries.length ? entries : [{ product_id: '', qty: '' }]).map((e) => rowHtml(e, opts)).join('');
    rowsBox.querySelectorAll('.picker-row').forEach((row) => wireRow(row, opts));
  }

  function addRow() {
    const opts = optionsOf(filtered());
    const wrap = document.createElement('div');
    wrap.innerHTML = rowHtml({ product_id: '', qty: '' }, opts);
    const row = wrap.firstElementChild;
    rowsBox.appendChild(row);
    wireRow(row, opts);
  }

  catSel.addEventListener('change', () => {
    state.category = catSel.value;
    state.subcategory = '';
    refreshSubOptions();
    renderRows(snapshot());
  });
  subSel.addEventListener('change', () => {
    state.subcategory = subSel.value;
    renderRows(snapshot());
  });
  mountEl.querySelector('.pf-add').addEventListener('click', addRow);

  refreshSubOptions();
  renderRows([]);

  return {
    getItems: () =>
      snapshot()
        .map((e) => ({ product_id: e.product_id, qty: Number(e.qty) }))
        .filter((i) => i.product_id && i.qty > 0),
    reset: () => renderRows([])
  };
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
