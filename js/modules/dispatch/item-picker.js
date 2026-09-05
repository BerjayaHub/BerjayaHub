import { renderSearchSelect, wireSearchSelect } from '../../core/ui.js';
import { formatNum } from '../../core/format.js';

/**
 * Komponen pemilih produk untuk form Order / Kirim / Transfer.
 * - Filter Kategori & Sub-kategori untuk mempersempit pilihan.
 * - Pencarian fuzzy pada tiap baris.
 * - Opsional menampilkan kolom "Stok Akhir" di outlet asal.
 * - Opsional memperingatkan kalau jumlahnya MELEBIHI stok itu.
 *
 * ============ KENAPA PERINGATANNYA OPT-IN ============
 *
 * `peringatanKurang` sengaja bawaannya MATI, dan itu bukan kehati-hatian
 * berlebihan — menyalakannya di mana-mana justru salah.
 *
 * Di layar Kirim/Transfer dan isi Draft SJ, `stockMap` adalah stok outlet
 * PENGIRIM, jadi "jumlah melebihi stok" berarti barangnya memang tidak ada di
 * rak. Itu perlu diketahui sekarang, bukan besok.
 *
 * Tapi di layar "Order ke CK", `stockMap` adalah stok outlet yang MEMESAN —
 * dan orang memesan justru KARENA stoknya menipis. Peringatan di sana akan
 * menyala pada hampir setiap baris yang benar, dan peringatan yang menyala
 * saat semuanya normal berhenti dibaca dalam hitungan hari.
 *
 * @returns {{ getItems: () => Array<{product_id:string, qty:number}> }}
 */
export function createItemPicker(
  mountEl,
  { products, stockMap = new Map(), showStock = true, initial = [], peringatanKurang = false, hargaSatuan = false }
) {
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
      qty: row.querySelector('.pf-qty').value,
      // Ikut disimpan walau `hargaSatuan` mati — nilainya cuma `undefined` di
      // situ, dan menyalinnya apa adanya jauh lebih aman daripada dua bentuk
      // snapshot yang berbeda tergantung opsi.
      unit_cost: row.querySelector('.pf-harga')?.value
    }));
  }

  /** Apakah jumlah ini melebihi stok yang ada? Dipakai untuk menyalakan ⚠. */
  function kurang(productId, qty) {
    if (!peringatanKurang || !productId) return false;
    const stok = stockMap.get(productId);
    // `stok == null` berarti produknya belum pernah punya pergerakan sama
    // sekali — bukan berarti nol. Memperingatkan di situ akan menyala untuk
    // setiap produk baru, dan itu bising tanpa arti.
    if (stok == null) return false;
    const n = Number(qty);
    return Number.isFinite(n) && n > Number(stok);
  }

  function rowHtml(entry, opts) {
    const p = products.find((x) => x.id === entry.product_id);
    const stok = p ? stockMap.get(p.id) ?? 0 : null;
    const kur = kurang(entry.product_id, entry.qty);
    return `
      <div class="picker-row">
        ${renderSearchSelect({ name: 'pp', options: opts, value: entry.product_id ?? '', placeholder: 'cari produk…' })}
        ${
          showStock
            ? `<span class="pf-stock${kur ? ' pf-kurang' : ''}" title="Stok akhir di outlet ini">${
                p ? `${formatNum(stok)} ${esc(p.base_unit)}${kur ? ' ⚠' : ''}` : '–'
              }</span>`
            : ''
        }
        <input type="number" class="pf-qty" min="0" placeholder="jumlah" value="${entry.qty ?? ''}" />
        ${
          // HARGA SATUAN — opt-in, dan mati untuk pemakai lain picker ini.
          //
          // Order ke CK, transfer, dan retur tidak punya harga: barangnya
          // berpindah antar outlet sendiri, bukan dibeli. Kotak harga di sana
          // hanya akan diisi orang dengan tebakan, lalu tebakan itu masuk ke
          // rata-rata biaya seolah-olah pembelian sungguhan.
          hargaSatuan
            ? `<input type="number" class="pf-harga" min="0" step="any" placeholder="harga/${esc(
                p?.base_unit ?? 'satuan'
              )}" value="${entry.unit_cost ?? ''}" title="Harga per ${esc(
                p?.base_unit ?? 'satuan'
              )} menurut nota supplier — boleh dikosongkan kalau belum tahu" />`
            : ''
        }
        <button type="button" class="pf-remove" title="Hapus">✕</button>
      </div>`;
  }

  function wireRow(row, opts) {
    const widget = row.querySelector('.search-select');
    const stockEl = row.querySelector('.pf-stock');
    const qtyEl = row.querySelector('.pf-qty');
    const idEl = () => widget.querySelector('input[type="hidden"]')?.value ?? '';

    /** Gambar ulang label stok + tanda ⚠ untuk baris ini saja. */
    const segarkanStok = () => {
      if (!stockEl) return;
      const p = products.find((x) => x.id === idEl());
      const kur = kurang(idEl(), qtyEl.value);
      stockEl.textContent = p ? `${formatNum(stockMap.get(p.id) ?? 0)} ${p.base_unit}${kur ? ' ⚠' : ''}` : '–';
      stockEl.classList.toggle('pf-kurang', kur);
    };

    wireSearchSelect(widget, opts, segarkanStok);
    // Diperbarui SAAT MENGETIK, bukan saat menyimpan. Peringatan yang baru
    // muncul sesudah tombol ditekan datang terlambat: keputusannya sudah
    // diambil.
    qtyEl.addEventListener('input', segarkanStok);
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
  renderRows(initial.map((i) => ({ product_id: i.product_id, qty: i.qty, unit_cost: i.unit_cost })));

  return {
    getItems: () =>
      snapshot()
        .map((e) => ({
          product_id: e.product_id,
          qty: Number(e.qty),
          // KOSONG TETAP KOSONG, BUKAN NOL.
          //
          // `Number('')` adalah 0, bukan NaN. Kalau kosong diteruskan sebagai
          // 0, harga yang belum diisi tersimpan sebagai "gratis" — dan biaya
          // rata-rata bahan itu anjlok tanpa satu pun tanda bahwa ada yang
          // salah. Jebakan yang sama sudah beberapa kali menggigit di repo ini.
          unit_cost: e.unit_cost == null || e.unit_cost === '' ? null : Number(e.unit_cost)
        }))
        .filter((i) => i.product_id && i.qty > 0),
    /** Dipanggil layar untuk menggambar ulang totalnya saat harga diketik. */
    onUbah: (fn) => rowsBox.addEventListener('input', fn),
    reset: () => renderRows([])
  };
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
