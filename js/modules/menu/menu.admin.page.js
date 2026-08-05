import { toast } from '../../core/ui.js';
import { formatRupiah, formatThousands, parseNumber, attachThousandsInput } from '../../core/format.js';
import { fuzzyMatch } from '../../core/ui.js';
import { listProducts, listRecipesFull, costForMode, updateSalePrice } from '../product/product.service.js';
import { openRecipeEditor, MODE_LABEL } from '../product/recipe-editor.js';
import { loadingHtml } from '../../core/loading.js';

const MENU_MODES = ['standalone', 'served_by_ck'];

/**
 * Modul Menu (Admin Portal): daftar seluruh produk bertipe MENU (finished),
 * dengan HPP per varian resep, edit harga jual langsung di tabel, dan
 * pengaturan resep tiap varian.
 */
export async function renderMenuAdminPage(container, { businessUnitId }) {
  container.innerHTML = `<h1>Menu</h1>${loadingHtml('Memuat menu…')}`;

  let products;
  let recipes;
  try {
    [products, recipes] = await Promise.all([listProducts(businessUnitId), listRecipesFull(businessUnitId)]);
  } catch (error) {
    container.innerHTML = `<h1>Menu</h1><p class="error-text">${error.message ?? error}</p>`;
    return;
  }
  const menus = products.filter((p) => p.product_type === 'finished');
  const categories = [...new Set(menus.map((m) => m.category).filter(Boolean))].sort();
  const recipeSet = new Set(recipes.map((r) => `${r.product_id}|${r.mode}`));
  const state = { category: '', q: '' };

  container.innerHTML = `
    <h1>Menu</h1>
    <p style="color:var(--color-text-muted);font-size:0.88rem;margin:0 0 12px">
      Semua produk bertipe <strong>Menu</strong>. HPP dihitung otomatis dari resep + harga bahan/setengah jadi.
      Harga jual bisa diubah langsung di tabel.
    </p>
    <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end;margin-bottom:10px">
      <div class="field" style="margin:0;max-width:220px"><label>Kategori</label>
        <select id="mn-cat"><option value="">Semua</option>${categories.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}</select>
      </div>
      <div class="field" style="margin:0;max-width:260px"><label>Cari menu</label>
        <input type="text" id="mn-q" placeholder="ketik nama menu…" />
      </div>
    </div>
    <div id="mn-table"></div>
    <div id="mn-recipe" style="margin-top:16px"></div>
  `;

  const tableBox = container.querySelector('#mn-table');
  const recipeBox = container.querySelector('#mn-recipe');

  function visibleMenus() {
    return menus.filter(
      (m) => (!state.category || m.category === state.category) && (!state.q || fuzzyMatch(state.q, `${m.name} ${m.category ?? ''} ${m.subcategory ?? ''}`))
    );
  }

  function renderTable() {
    const list = visibleMenus();
    tableBox.innerHTML = `
      <div class="table-scroll"><table class="data-table table-freeze-1">
        <thead>
          <tr><th>Menu</th><th>Kategori</th><th>Satuan</th><th>Harga Jual</th><th>HPP Standalone</th><th>HPP Dilayani CK</th><th>Margin</th><th>Resep</th></tr>
        </thead>
        <tbody>
          ${
            list
              .map((m) => {
                const cStand = costForMode(products, recipes, m.id, 'standalone');
                const cCk = costForMode(products, recipes, m.id, 'served_by_ck');
                const ref = cStand ?? cCk;
                let margin = '-';
                if (m.sale_price != null && ref != null) {
                  const val = Number(m.sale_price) - ref;
                  const pct = Number(m.sale_price) > 0 ? Math.round((val / Number(m.sale_price)) * 100) : 0;
                  margin = `${formatRupiah(val)} <span style="color:var(--color-text-muted)">(${pct}%)</span>`;
                }
                const btns = MENU_MODES.map(
                  (mode) =>
                    `<button class="btn-menu-recipe${recipeSet.has(`${m.id}|${mode}`) ? '' : ' is-empty'}" data-id="${m.id}" data-mode="${mode}">${MODE_LABEL[mode]}${recipeSet.has(`${m.id}|${mode}`) ? '' : ' •'}</button>`
                ).join(' ');
                return `<tr>
                  <td>${esc(m.name)}${m.is_active === false ? ' <span style="font-size:0.7rem;color:var(--color-danger)">(nonaktif)</span>' : ''}</td>
                  <td style="font-size:0.85rem">${esc(m.category ?? '-')}${m.subcategory ? `<div style="font-size:0.75rem;color:var(--color-text-muted)">${esc(m.subcategory)}</div>` : ''}</td>
                  <td>${esc(m.base_unit)}</td>
                  <td><input type="text" inputmode="numeric" class="nbm-total-input mn-price" data-id="${m.id}" value="${m.sale_price != null ? formatThousands(Math.round(m.sale_price)) : ''}" placeholder="0" /></td>
                  <td>${cStand != null ? formatRupiah(cStand) : '<span style="color:var(--color-text-muted)">-</span>'}</td>
                  <td>${cCk != null ? formatRupiah(cCk) : '<span style="color:var(--color-text-muted)">-</span>'}</td>
                  <td>${margin}</td>
                  <td>${btns}</td>
                </tr>`;
              })
              .join('') || '<tr><td colspan="8">Tidak ada menu.</td></tr>'
          }
        </tbody>
      </table></div>
      <p style="font-size:0.75rem;color:var(--color-text-muted);margin-top:6px">Tanda • pada tombol resep = varian itu belum diatur.</p>
    `;

    // Edit harga jual langsung di tabel
    tableBox.querySelectorAll('.mn-price').forEach((input) => {
      attachThousandsInput(input);
      let before = input.value;
      input.addEventListener('focus', () => {
        before = input.value;
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') input.blur();
        if (e.key === 'Escape') {
          input.value = before;
          input.blur();
        }
      });
      input.addEventListener('blur', async () => {
        if (input.value === before) return;
        const val = input.value.trim() === '' ? null : parseNumber(input.value);
        try {
          await updateSalePrice(input.dataset.id, val);
          const m = menus.find((x) => x.id === input.dataset.id);
          if (m) m.sale_price = val;
          toast('Harga jual diperbarui.', 'success');
          renderTable();
        } catch (error) {
          toast(error.message ?? 'Gagal menyimpan harga.', 'error');
          input.value = before;
        }
      });
    });

    tableBox.querySelectorAll('.btn-menu-recipe').forEach((btn) =>
      btn.addEventListener('click', () =>
        openRecipeEditor(recipeBox, {
          businessUnitId,
          product: menus.find((m) => m.id === btn.dataset.id),
          products,
          mode: btn.dataset.mode,
          onSaved: async () => {
            recipes = await listRecipesFull(businessUnitId);
            recipeSet.clear();
            recipes.forEach((r) => recipeSet.add(`${r.product_id}|${r.mode}`));
            renderTable();
          }
        })
      )
    );
  }

  container.querySelector('#mn-cat').addEventListener('change', (e) => {
    state.category = e.target.value;
    renderTable();
  });
  container.querySelector('#mn-q').addEventListener('input', (e) => {
    state.q = e.target.value;
    renderTable();
  });

  renderTable();
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
