import { renderSearchSelect, wireSearchSelect } from '../../core/ui.js';
import { formatNum, formatRibuanDesimal, bacaRupiah, attachRupiahInput } from '../../core/format.js';
import { cariDuplikat, gabungDuplikat } from './duplikat-item.js';
import { cocokKata, ringkasSaringan } from './saring-baris.js';

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
 * ============ SATU BAHAN, SATU BARIS ============
 *
 * `tanpaDuplikat` menyalakan penjagaan terhadap bahan kembar dalam satu
 * dokumen. Sejak 0110 order milik OUTLET: bar mengisi sirup, kitchen menambah
 * daging, ke satu nomor order yang sama. Tanpa penjagaan ini, orang kedua bisa
 * memilih barang yang sudah dipesan orang pertama, dan dokumennya berangkat ke
 * CK dengan dua baris untuk satu barang — tanpa error, tanpa peringatan, dan
 * keduanya terlihat wajar.
 *
 * Yang dilakukan di sini cuma MENANDAI dan MENAWARKAN penggabungan. Penjumlahan
 * senyap ditolak dengan sengaja: staff yang mengetik 150 harus melihat angkanya
 * jadi 250 sebelum menyimpan, kalau tidak ia akan mengira memesan 150.
 *
 * @returns {{ getItems: () => Array<{product_id:string, qty:number}> }}
 */
export function createItemPicker(
  mountEl,
  {
    products,
    stockMap = new Map(),
    showStock = true,
    initial = [],
    peringatanKurang = false,
    hargaSatuan = false,
    tanpaDuplikat = false,
    // Baris ber-jumlah NOL ikut disimpan, bukan dibuang (0132).
    //
    // Di surat jalan, "diminta 10, dikirim 0" adalah jawaban — dan jawaban itu
    // yang menutup perdebatan "outlet tidak pesan" versus "CK tidak kirim".
    // Di layar lain (nota, order) baris nol memang tidak punya arti, jadi
    // bawaannya tetap membuang.
    bolehNol = false,
    // Kotak pencarian nama bahan di atas barisnya.
    //
    // Untuk daftar panjang — draft surat jalan dari order berisi tiga puluh
    // baris. Yang tidak cocok DISEMBUNYIKAN, tidak pernah dibuang: kotak
    // isiannya hidup di dalam barisnya, dan baris yang lenyap dari DOM lenyap
    // juga dari `getItems()`.
    cariBaris = false
  }
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
    ${
      cariBaris
        ? `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:6px 0">
             <input type="text" class="pf-cari" placeholder="Cari nama bahan…" style="flex:1 1 200px;min-width:160px" />
             <span class="pf-cari-info" style="font-size:0.78rem;color:var(--color-text-muted)"></span>
           </div>`
        : ''
    }
    <div class="pf-kembar-box" hidden></div>
    <div class="picker-rows"></div>
    <button type="button" class="pf-add" style="margin-top:8px">+ Tambah Produk</button>
  `;

  const catSel = mountEl.querySelector('.pf-cat');
  const subSel = mountEl.querySelector('.pf-sub');
  const rowsBox = mountEl.querySelector('.picker-rows');
  const kembarBox = mountEl.querySelector('.pf-kembar-box');

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
      line_total: row.querySelector('.pf-harga')?.value
    }));
  }

  /**
   * Isi baris dengan harga yang sudah jadi ANGKA.
   *
   * `snapshot()` mengembalikan harga apa adanya dari kotaknya — "12.500",
   * lengkap dengan titik ribuan. `Number('12.500')` adalah 12,5, bukan 12500.
   * Menyerahkan bentuk itu ke penjumlahan akan mengubah dua belas ribu lima
   * ratus jadi dua belas setengah, dan hasilnya tetap terlihat seperti angka.
   */
  function isiTerbaca() {
    return snapshot().map((e) => ({
      product_id: e.product_id,
      qty: e.qty,
      ...(hargaSatuan ? { line_total: bacaRupiah(e.line_total) } : {})
    }));
  }

  /**
   * Tandai baris yang produknya kembar, dan tawarkan penggabungannya.
   *
   * Dipanggil SAAT MEMILIH, bukan saat menyimpan. Peringatan yang baru muncul
   * sesudah tombol Simpan ditekan datang terlambat — orangnya sudah mengisi
   * seluruh baris, dan yang tersisa cuma membongkar pekerjaannya sendiri.
   */
  function segarkanDuplikat() {
    if (!tanpaDuplikat) return;
    const isi = isiTerbaca();
    const kembar = cariDuplikat(isi);
    const baris = [...rowsBox.querySelectorAll('.picker-row')];

    for (const row of baris) {
      const id = row.querySelector('.search-select input[type="hidden"]')?.value ?? '';
      row.classList.toggle('picker-row-kembar', !!id && kembar.has(id));
    }

    if (!kembar.size) {
      kembarBox.hidden = true;
      kembarBox.innerHTML = '';
      return;
    }

    const daftar = [...kembar.entries()].map(([id, idx]) => {
      const p = products.find((x) => x.id === id);
      const total = idx.reduce((n, j) => n + (Number(isi[j]?.qty) || 0), 0);
      return `<li><strong>${esc(p?.name ?? 'Bahan')}</strong> ada di ${idx.length} baris — kalau digabung jadi <strong>${formatNum(
        total
      )} ${esc(p?.base_unit ?? '')}</strong></li>`;
    });

    kembarBox.hidden = false;
    kembarBox.innerHTML = `
      <div class="pf-kembar-pesan">
        <p style="margin:0 0 6px"><strong>Bahan yang sama tidak boleh dua baris.</strong>
        Ubah jumlah di baris yang sudah ada, jangan tambah baris baru.</p>
        <ul style="margin:0 0 8px;padding-left:18px">${daftar.join('')}</ul>
        <button type="button" class="pf-gabung">Gabungkan jadi satu baris</button>
      </div>`;

    kembarBox.querySelector('.pf-gabung').addEventListener('click', () => {
      const { items: hasil, digabung } = gabungDuplikat(isiTerbaca());
      renderRows(hasil);
      // Harga yang hilang DIKATAKAN, tidak dibiarkan jadi kotak kosong yang
      // orangnya kira memang belum pernah diisi.
      const hilang = digabung.filter((d) => d.hargaHilang).map((d) => products.find((p) => p.id === d.product_id)?.name ?? 'Bahan');
      if (hilang.length) {
        kembarBox.hidden = false;
        kembarBox.innerHTML = `<div class="pf-kembar-pesan">Jumlahnya sudah digabung. <strong>Harga ${esc(
          hilang.join(', ')
        )} dikosongkan</strong> karena salah satu barisnya belum berharga — isi ulang harga belinya.</div>`;
      }
    });
  }

  /**
   * Sembunyikan baris yang namanya tidak cocok pencarian.
   *
   * DISEMBUNYIKAN, bukan dibuang — `snapshot()` membaca seluruh
   * `.picker-row` di DOM, jadi baris yang dihapus akan hilang juga dari
   * `getItems()` beserta angka yang sudah diketik di dalamnya.
   *
   * Namanya dibaca dari produk yang SEDANG dipilih, bukan dari atribut yang
   * ditulis saat menggambar: orang bisa mengganti produk sebuah baris kapan
   * saja, dan atribut yang basi akan menyembunyikan baris yang seharusnya
   * muncul.
   */
  function terapkanSaringan() {
    if (!cariBaris) return;
    const kotak = mountEl.querySelector('.pf-cari');
    const info = mountEl.querySelector('.pf-cari-info');
    if (!kotak) return;
    const kata = kotak.value;
    const semua = [...rowsBox.querySelectorAll('.picker-row')];
    let tampil = 0;
    for (const row of semua) {
      const id = row.querySelector('.search-select input[type="hidden"]')?.value ?? '';
      // Baris yang produknya BELUM dipilih selalu terlihat: itu baris kosong
      // di bawah daftar, satu-satunya tempat menambah barang baru. Menyembunyi-
      // kannya membuat "+ Tambah Produk" terlihat tidak melakukan apa pun.
      const cocok = !id || cocokKata(products.find((p) => p.id === id)?.name ?? '', kata);
      row.hidden = !cocok;
      if (cocok) tampil += 1;
    }
    if (info) info.textContent = ringkasSaringan(semua.length, tampil, kata);
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
            ? // `type="text"` + `inputmode="decimal"`, BUKAN `type="number"`.
              //
              // Kotak angka bawaan browser MENOLAK titik ribuan — begitu "13."
              // diketik, isinya dianggap tidak sah dan `.value` jadi string
              // kosong. Seluruh angka yang sudah diketik lenyap, tanpa satu pun
              // tanda bahwa itu terjadi.
              //
              // `inputmode="decimal"` tetap memunculkan papan angka di HP, yang
              // memang satu-satunya alasan `type="number"` menggoda di sini.
              // ISINYA HARGA BELI SELURUH BARIS, BUKAN HARGA PER SATUAN.
              //
              // Versi pertama berlabel "harga/gr" dan disimpan sebagai
              // `unit_cost`. Orang yang memegang nota supplier membaca SATU
              // angka di kertas itu — Rp180.000 untuk 5 kg beras — lalu
              // mengetiknya. Itu perilaku yang wajar; labelnya yang menuntut
              // pembagian yang tidak pernah diminta siapa pun.
              //
              // Akibatnya bukan selisih kecil: 5.000 gr x 180.000 =
              // Rp900.000.000, lima ribu kali lipat, tanpa satu pun error.
              // Pembagiannya sekarang dikerjakan server (`harga_baris_nota`).
              `<span class="pf-rp">Rp</span><input type="text" inputmode="decimal" class="pf-harga" placeholder="harga beli" value="${esc(
                formatRibuanDesimal(entry.line_total ?? '')
              )}" title="Harga beli SELURUH baris ini menurut nota supplier — bukan harga per ${esc(
                p?.base_unit ?? 'satuan'
              )}. Boleh dikosongkan kalau belum tahu." />`
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

    // Pemisah ribuan hidup saat mengetik. Dipasang per baris karena barisnya
    // digambar ulang tiap kali saringan kategori berubah.
    attachRupiahInput(row.querySelector('.pf-harga'));

    wireSearchSelect(widget, opts, () => {
      segarkanStok();
      segarkanDuplikat();
    });
    // Diperbarui SAAT MENGETIK, bukan saat menyimpan. Peringatan yang baru
    // muncul sesudah tombol ditekan datang terlambat: keputusannya sudah
    // diambil.
    qtyEl.addEventListener('input', () => {
      segarkanStok();
      segarkanDuplikat();
    });
    row.querySelector('.pf-remove').addEventListener('click', () => {
      row.remove();
      if (!rowsBox.querySelector('.picker-row')) addRow();
      segarkanDuplikat();
    });
  }

  function renderRows(entries) {
    const opts = optionsOf(filtered());
    rowsBox.innerHTML = (entries.length ? entries : [{ product_id: '', qty: '' }]).map((e) => rowHtml(e, opts)).join('');
    rowsBox.querySelectorAll('.picker-row').forEach((row) => wireRow(row, opts));
    segarkanDuplikat();
    terapkanSaringan();
  }

  function addRow() {
    const opts = optionsOf(filtered());
    const wrap = document.createElement('div');
    wrap.innerHTML = rowHtml({ product_id: '', qty: '' }, opts);
    const row = wrap.firstElementChild;
    rowsBox.appendChild(row);
    wireRow(row, opts);
    segarkanDuplikat();
    terapkanSaringan();
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

  mountEl.querySelector('.pf-cari')?.addEventListener('input', terapkanSaringan);

  refreshSubOptions();
  renderRows(initial.map((i) => ({ product_id: i.product_id, qty: i.qty, line_total: i.line_total })));

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
          line_total: bacaRupiah(e.line_total)
        }))
        // Produknya WAJIB; jumlahnya boleh nol hanya kalau layar memintanya.
        // `Number('')` adalah 0, jadi tanpa `bolehNol` baris yang belum diisi
        // sama sekali akan ikut tersimpan sebagai nol yang tidak pernah
        // dimaksudkan siapa pun.
        .filter((i) => i.product_id && (bolehNol ? i.qty >= 0 : i.qty > 0)),
    /** Dipanggil layar untuk menggambar ulang totalnya saat harga diketik. */
    onUbah: (fn) => rowsBox.addEventListener('input', fn),
    reset: () => renderRows([]),

    /**
     * Masih ada bahan kembar? Dipakai layar untuk MENOLAK SIMPAN.
     *
     * Penandaan di layar saja tidak cukup: orang bisa menekan Simpan tanpa
     * membaca kotak merah di atasnya, dan dokumen yang terlanjur berangkat ke
     * CK tidak bisa diubah lagi (0111).
     *
     * Selalu `false` kalau `tanpaDuplikat` mati, supaya pemakai lama picker ini
     * tidak tiba-tiba tertahan.
     */
    adaDuplikat: () => (tanpaDuplikat ? cariDuplikat(isiTerbaca()).size > 0 : false),

    /** Nama bahan yang kembar — untuk disebut di pesan galat layar. */
    namaDuplikat: () =>
      [...cariDuplikat(isiTerbaca()).keys()].map((id) => products.find((p) => p.id === id)?.name ?? 'Bahan')
  };
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
