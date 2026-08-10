import { toast, confirmDialog } from '../../core/ui.js';
import { formatRupiah, formatNum, formatThousands, parseNumber, attachThousandsInput } from '../../core/format.js';
import { listProducts, listRecipesFull, costForMode, updateSalePrice, updateProductCategory, deleteRecipe } from '../product/product.service.js';
import { openRecipeEditor, MODE_LABEL } from '../product/recipe-editor.js';
import { downloadMenuTemplate } from '../product/product-import.js';
import { loadingHtml, sekaliJalan } from '../../core/loading.js';
import { sayaAdminBu } from '../../core/base-scope.js';
import { bakukanNama } from '../../core/nama.js';
import { pemakaiResep } from '../product/recipe-graph.js';

const MENU_MODES = ['standalone', 'served_by_ck'];

/**
 * Modul Menu (Admin Portal).
 *
 * SISTEMATIKANYA SENGAJA DISAMAKAN dengan tab Resep di Master Produk, karena
 * keduanya menjawab pertanyaan yang sama — "apa isi menu ini dan berapa
 * modalnya" — dan sebelumnya dijawab dengan dua cara berbeda:
 *
 *   - Tombol resepnya dulu bertuliskan "Standalone" / "Dilayani CK": nama
 *     varian tanpa kata kerja, jadi terbaca sebagai LABEL. Itu sebabnya form
 *     isian resep dikira tidak ada.
 *   - Bahannya tidak bisa dilihat tanpa membuka editor satu per satu.
 *   - Editornya muncul di DASAR halaman, jauh dari baris yang diketuk — di HP
 *     itu berarti keluar dari layar.
 *
 * Sekarang: ketuk baris -> bahannya tampil di tempat, dengan tombol
 * "+ Isi resep" / "✎ Ubah resep" di dalam baris itu juga.
 */
export async function renderMenuAdminPage(container, { businessUnitId }) {
  container.innerHTML = `<h1>Menu</h1>${loadingHtml('Memuat menu…')}`;

  let products;
  let recipes;
  let bolehUbah = false;
  try {
    [products, recipes, bolehUbah] = await Promise.all([
      listProducts(businessUnitId),
      listRecipesFull(businessUnitId),
      sayaAdminBu(businessUnitId).catch(() => false)
    ]);
  } catch (error) {
    container.innerHTML = `<h1>Menu</h1><p class="error-text">${esc(error.message ?? error)}</p>`;
    return;
  }
  const menus = products.filter((p) => p.product_type === 'finished');
  const namaProduk = new Map(products.map((p) => [p.id, p]));
  const categories = [...new Set(menus.map((m) => m.category).filter(Boolean))].sort();
  let resepPer = new Map(recipes.map((r) => [`${r.product_id}|${r.mode}`, r]));
  const state = { category: '', q: '', terbuka: new Set() };

  container.innerHTML = `
    <div class="page-header">
      <h1 style="margin:0">Menu</h1>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button id="mn-tpl">Template Menu</button>
      </div>
    </div>
    <p style="color:var(--color-text-muted);font-size:0.88rem;margin:0 0 12px;max-width:620px">
      Semua produk bertipe <strong>Menu</strong>. HPP dihitung otomatis dari resep + harga bahan.
      Menu <strong>baru</strong> ditambahkan di <strong>Master Produk → Produk</strong> (tipe "Menu") atau lewat
      Import Excel di sana — unduh <strong>Template Menu</strong> di atas, kolom Tipe-nya sudah terisi.
      ${bolehUbah ? 'Harga jual bisa diubah langsung di tabel.' : '<br /><strong>Harga jual & resep hanya bisa diubah Admin BU</strong> — di sini kamu bisa memeriksanya, tapi tidak menyimpannya.'}
    </p>
    <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end;margin-bottom:10px">
      <div class="field" style="margin:0;max-width:220px"><label>Kategori</label>
        <select id="mn-cat"><option value="">Semua</option>${categories.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}</select>
      </div>
      <div class="field" style="margin:0;max-width:260px"><label>Cari menu</label>
        <input type="search" id="mn-q" placeholder="ketik nama menu…" autocomplete="off" />
        <span class="field-help" id="mn-info"></span>
      </div>
    </div>
    <p style="font-size:0.82rem;color:var(--color-text-muted);margin:0 0 8px">
      Ketuk baris menu untuk melihat bahan tiap varian${bolehUbah ? ' dan mengubahnya' : ''}.${bolehUbah ? ' Kategori bisa diketik langsung di kolomnya — bebas, bukan pilihan tetap.' : ''}
    </p>
    <div id="mn-table"></div>
  `;

  const tableBox = container.querySelector('#mn-table');
  const infoEl = container.querySelector('#mn-info');

  /**
   * Pencocokan nama memakai `bakukanNama()` yang sama dengan impor & tab Resep.
   *
   * Sebelumnya memakai pencocokan sendiri yang tidak membakukan spasi ganda dan
   * karakter tak terlihat dari Excel — jadi mengetik "es kopi susu" bisa gagal
   * menemukan "Es Kopi  Susu", dan orangnya menyimpulkan menunya belum ada.
   * Dua layar yang menjawab pertanyaan sama harus mencocokkan dengan cara sama.
   */
  const cocok = (menu) => {
    if (state.category && menu.category !== state.category) return false;
    const q = bakukanNama(state.q);
    if (!q) return true;
    return bakukanNama(`${menu.name} ${menu.category ?? ''} ${menu.subcategory ?? ''}`).includes(q);
  };

  function renderTable() {
    const list = menus.filter(cocok);
    infoEl.textContent = !bakukanNama(state.q)
      ? `${menus.length} menu`
      : list.length
        ? `${list.length} dari ${menus.length} menu`
        : `Tidak ada menu bernama "${state.q.trim()}"`;

    // Kategori diketik BEBAS, dengan saran dari yang sudah dipakai.
    //
    // Bukan dropdown tertutup: "Minuman", "Makanan", "Snack", "Frozen" adalah
    // urusan yang punya usaha, bukan urusan kode. Daftar tetap di kode berarti
    // setiap kategori baru harus menunggu deploy — dan sementara menunggu,
    // orangnya menaruh menu di kategori yang salah karena itu satu-satunya yang
    // tersedia. `datalist` memberi kecepatan dropdown tanpa mengunci pilihannya.
    const semuaKategori = [...new Set(menus.map((m) => m.category).filter(Boolean))].sort();
    tableBox.innerHTML = `
      <datalist id="mn-cat-list">${semuaKategori.map((c) => `<option value="${esc(c)}"></option>`).join('')}</datalist>
      <div class="table-scroll"><table class="data-table table-freeze-1">
        <thead>
          <tr><th>Menu</th><th>Kategori</th><th>Satuan</th><th>Harga Jual</th><th>HPP Standalone</th><th>HPP Dilayani CK</th><th>Margin</th></tr>
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
                const buka = state.terbuka.has(m.id);
                const harga = bolehUbah
                  ? `<input type="text" inputmode="numeric" class="nbm-total-input mn-price" data-id="${m.id}" value="${m.sale_price != null ? formatThousands(Math.round(m.sale_price)) : ''}" placeholder="0" />`
                  : m.sale_price != null
                    ? formatRupiah(m.sale_price)
                    : '<span style="color:var(--color-text-muted)">-</span>';
                return `<tr class="mn-row" data-id="${m.id}" style="cursor:pointer">
                    <td><span class="mn-arrow" style="display:inline-block;width:1em">${buka ? '▾' : '▸'}</span> ${esc(m.name)}${
                      m.is_active === false ? ' <span style="font-size:0.7rem;color:var(--color-danger)">(nonaktif)</span>' : ''
                    }</td>
                    <td style="font-size:0.85rem">${
                      bolehUbah
                        ? `<input type="text" class="mn-cat-input" data-id="${m.id}" list="mn-cat-list" value="${esc(m.category ?? '')}"
                             placeholder="kategori" style="min-width:110px;margin:0;font-size:0.85rem" />`
                        : esc(m.category ?? '-')
                    }${m.subcategory ? `<div style="font-size:0.75rem;color:var(--color-text-muted)">${esc(m.subcategory)}</div>` : ''}</td>
                    <td>${esc(m.base_unit)}</td>
                    <td data-harga>${harga}</td>
                    <td>${cStand != null ? formatRupiah(cStand) : '<span style="color:var(--color-text-muted)">-</span>'}</td>
                    <td>${cCk != null ? formatRupiah(cCk) : '<span style="color:var(--color-text-muted)">-</span>'}</td>
                    <td>${margin}</td>
                  </tr>
                  <tr class="mn-detail" data-for="${m.id}"${buka ? '' : ' hidden'}><td colspan="7" style="background:var(--color-surface-alt,#fafafa)"></td></tr>`;
              })
              .join('') || '<tr><td colspan="7">Tidak ada menu.</td></tr>'
          }
        </tbody>
      </table></div>
    `;

    for (const id of state.terbuka) gambarRincian(id);
    wireHarga();
    wireKategori();
    wireBaris();
  }

  /** Panel bahan per varian — bentuknya sengaja sama dengan tab Resep. */
  function gambarRincian(menuId) {
    const sel = tableBox.querySelector(`.mn-detail[data-for="${menuId}"] td`);
    if (!sel) return;
    const menu = namaProduk.get(menuId);
    sel.innerHTML = MENU_MODES.map((mode) => {
      const r = resepPer.get(`${menuId}|${mode}`);
      const baris = (r?.items ?? [])
        .map((it) => {
          const bahan = namaProduk.get(it.ingredient_product_id);
          return `<tr>
            <td>${esc(bahan?.name ?? 'bahan tidak ditemukan')}</td>
            <td style="text-align:right">${formatNum(it.qty)} ${esc(bahan?.base_unit ?? '')}</td>
          </tr>`;
        })
        .join('');
      const isi = r
        ? `<table class="data-table" style="margin:6px 0;max-width:420px">
             <thead><tr><th>Bahan</th><th style="text-align:right">Jumlah</th></tr></thead>
             <tbody>${baris || '<tr><td colspan="2">Resepnya ada, tapi belum berisi bahan.</td></tr>'}</tbody>
           </table>
           <p style="font-size:0.78rem;color:var(--color-text-muted);margin:0 0 8px">
             Hasil/yield: <strong>${formatNum(r.yield_qty)} ${esc(menu.base_unit)}</strong>
           </p>`
        : `<p style="font-size:0.85rem;color:var(--color-text-muted);margin:6px 0 8px">Varian ini belum punya resep.</p>`;
      return `<div style="padding:10px 4px;border-top:1px solid var(--color-border,#e5e5e5)">
          <div style="font-weight:600;margin-bottom:2px">${MODE_LABEL[mode]}</div>
          ${isi}
          ${
            bolehUbah
              ? `<button class="mn-edit-recipe" data-id="${menuId}" data-mode="${mode}">${r ? '✎ Ubah resep' : '+ Isi resep'}</button>` +
                (r ? ` <button class="mn-del-recipe" data-id="${menuId}" data-mode="${mode}">🗑 Hapus resep</button>` : '')
              : ''
          }
        </div>`;
    }).join('');

    // Menu punya DUA varian yang berdiri sendiri: menghapus "Standalone" tidak
    // menyentuh "Dilayani CK". Keduanya menjawab cara produksi yang berbeda dan
    // dipakai outlet yang berbeda.
    sel.querySelectorAll('.mn-del-recipe').forEach((btn) =>
      btn.addEventListener(
        'click',
        sekaliJalan(async (e) => {
          e.stopPropagation();
          const produk = namaProduk.get(btn.dataset.id);
          const terdampak = pemakaiResep(products, recipes, produk.id);
          const ok = await confirmDialog({
            title: `Hapus resep ${MODE_LABEL[btn.dataset.mode] ?? btn.dataset.mode}?`,
            message:
              `Seluruh bahan pada varian ini dihapus dari "${produk.name}". Varian lainnya tidak ikut terhapus, ` +
              'dan menunya sendiri tetap ada — hanya resepnya yang hilang, jadi bisa diisi ulang atau diimpor ulang.' +
              (terdampak.length
                ? ` HPP ${terdampak.length} varian resep lain yang memakai menu ini ikut jadi kosong: ${terdampak
                    .slice(0, 8)
                    .map((t) => `${t.name} (${MODE_LABEL[t.mode] ?? t.mode})`)
                    .join(', ')}${terdampak.length > 8 ? ', dan lainnya' : ''}.`
                : ''),
            confirmText: 'Hapus resep',
            danger: true
          });
          if (!ok) return;
          try {
            await deleteRecipe(produk.id, btn.dataset.mode);
            toast('Resep dihapus.', 'success');
            recipes = await listRecipesFull(businessUnitId);
            resepPer = new Map(recipes.map((r) => [`${r.product_id}|${r.mode}`, r]));
            renderTable();
          } catch (error) {
            toast(error.message ?? 'Gagal menghapus resep.', 'error');
          }
        })
      )
    );

    sel.querySelectorAll('.mn-edit-recipe').forEach((btn) =>
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        let dudukan = sel.querySelector('.mn-editor');
        if (!dudukan) {
          dudukan = document.createElement('div');
          dudukan.className = 'mn-editor';
          sel.appendChild(dudukan);
        }
        openRecipeEditor(dudukan, {
          businessUnitId,
          product: namaProduk.get(btn.dataset.id),
          products,
          mode: btn.dataset.mode,
          onSaved: async () => {
            recipes = await listRecipesFull(businessUnitId);
            resepPer = new Map(recipes.map((r) => [`${r.product_id}|${r.mode}`, r]));
            renderTable();
          }
        });
      })
    );
  }

  function wireBaris() {
    tableBox.querySelectorAll('.mn-row').forEach((row) =>
      row.addEventListener('click', (e) => {
        // Mengetik harga tidak boleh ikut membuka/menutup barisnya.
        if (e.target.closest('input')) return;
        const id = row.dataset.id;
        const detail = tableBox.querySelector(`.mn-detail[data-for="${id}"]`);
        const buka = detail.hidden;
        detail.hidden = !buka;
        row.querySelector('.mn-arrow').textContent = buka ? '▾' : '▸';
        if (buka) {
          state.terbuka.add(id);
          gambarRincian(id);
        } else {
          state.terbuka.delete(id);
        }
      })
    );
  }

  function wireKategori() {
    tableBox.querySelectorAll('.mn-cat-input').forEach((input) => {
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
        if (input.value.trim() === before.trim()) return;
        try {
          await updateProductCategory(input.dataset.id, { category: input.value });
          const m = menus.find((x) => x.id === input.dataset.id);
          if (m) m.category = input.value.trim() || null;
          toast('Kategori diperbarui.', 'success');
          // Digambar ulang supaya kategori baru langsung ikut di penyaring dan
          // di daftar saran — kalau tidak, kategori yang baru saja diketik tidak
          // bisa dipakai untuk menu berikutnya sampai halamannya dibuka lagi.
          segarkanKategori();
          renderTable();
        } catch (error) {
          toast(error.message ?? 'Gagal menyimpan kategori.', 'error');
          input.value = before;
        }
      });
    });
  }

  /** Isi ulang dropdown penyaring kategori dari data yang sekarang. */
  function segarkanKategori() {
    const sel = container.querySelector('#mn-cat');
    if (!sel) return;
    const daftar = [...new Set(menus.map((m) => m.category).filter(Boolean))].sort();
    const terpilih = state.category;
    sel.innerHTML = `<option value="">Semua</option>${daftar.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}`;
    // Kalau kategori yang sedang disaring sudah tidak dipakai menu mana pun,
    // penyaringnya dikembalikan ke "Semua" — daftar kosong tanpa sebab yang
    // terlihat lebih membingungkan daripada daftar penuh.
    sel.value = daftar.includes(terpilih) ? terpilih : '';
    state.category = sel.value;
  }

  function wireHarga() {
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
  }

  container.querySelector('#mn-cat').addEventListener('change', (e) => {
    state.category = e.target.value;
    renderTable();
  });
  container.querySelector('#mn-q').addEventListener('input', (e) => {
    state.q = e.target.value;
    renderTable();
  });
  container.querySelector('#mn-tpl').addEventListener('click', downloadMenuTemplate);

  renderTable();
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
