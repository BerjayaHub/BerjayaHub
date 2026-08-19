/**
 * Aturan penyaringan tabel Produk & Resep.
 *
 * Dipisah dan tanpa impor supaya BISA DIUJI. Penyaring terlihat sepele sampai
 * ia salah: baris yang seharusnya muncul ikut tersembunyi, orangnya
 * menyimpulkan produknya belum ada, lalu membuatnya lagi dengan nama yang
 * sedikit berbeda. Setelah itu ada dua "Gula" di master produk, resep menunjuk
 * ke yang berbeda-beda, dan HPP-nya tidak pernah bisa dijelaskan.
 *
 * Dua keputusan yang dikunci di sini:
 *
 *   - Saringan digabung dengan DAN, bukan ATAU. Memilih tipe "Bahan Baku" lalu
 *     mengetik "gula" berarti bahan baku yang bernama gula.
 *   - Saringan yang kosong berarti "semua", bukan "tidak ada". Kedengarannya
 *     sudah pasti, tapi ini justru yang paling mudah terbalik saat nilainya
 *     `null`/`undefined`/string kosong dicampur — dan akibatnya tabel kosong
 *     yang terlihat seperti data hilang.
 */

/** Kategori kosong dianggap satu kelompok sendiri, bukan cocok dengan apa pun. */
export const TANPA_KATEGORI = '(tanpa kategori)';

/** Sama untuk sub kategori. Dibedakan supaya labelnya jujur di layar. */
export const TANPA_SUB = '(tanpa sub kategori)';

const bersih = (v) => String(v ?? '').trim();

/**
 * @param {object} baris  { nama, tipe, kategori, subKategori } — `nama` sudah dibakukan
 * @param {object} saring { nama, tipe, kategori, subKategori } — kosong = semua
 */
export function cocokSaringan(baris, saring = {}) {
  const q = bersih(saring.nama).toLowerCase();
  if (q && !String(baris?.nama ?? '').includes(q)) return false;

  const tipe = bersih(saring.tipe);
  if (tipe && bersih(baris?.tipe) !== tipe) return false;

  const kategori = bersih(saring.kategori);
  if (kategori) {
    const punya = bersih(baris?.kategori);
    // Produk tanpa kategori hanya cocok dengan pilihan "(tanpa kategori)".
    // Kalau ia ikut muncul di kategori mana pun, orangnya akan menyangka
    // kategorinya sudah terisi dan tidak pernah membetulkannya.
    if (kategori === TANPA_KATEGORI ? punya !== '' : punya !== kategori) return false;
  }

  const sub = bersih(saring.subKategori);
  if (sub) {
    const punya = bersih(baris?.subKategori);
    if (sub === TANPA_SUB ? punya !== '' : punya !== sub) return false;
  }
  return true;
}

/** Menyaring sekumpulan baris; dipakai tes dan bisa dipakai layar mana pun. */
export function saringBaris(daftar, saring = {}) {
  return (daftar ?? []).filter((b) => cocokSaringan(b, saring));
}

/**
 * Daftar kategori untuk isi dropdown — terurut, tanpa duplikat, dan menaruh
 * "(tanpa kategori)" di akhir kalau memang ada produk yang belum berkategori.
 * Ditempatkan di akhir karena ia bukan kategori, melainkan ketiadaannya.
 */
export function daftarKategori(produk) {
  const ada = new Set();
  let adaKosong = false;
  for (const p of produk ?? []) {
    const c = bersih(p?.category);
    if (c) ada.add(c);
    else adaKosong = true;
  }
  const urut = [...ada].sort((a, b) => a.localeCompare(b, 'id'));
  return adaKosong ? [...urut, TANPA_KATEGORI] : urut;
}

/**
 * Daftar sub kategori untuk isi dropdown.
 *
 * ============ MENGIKUTI KATEGORI YANG SEDANG DIPILIH ============
 *
 * Kalau `kategori` diisi, yang ditawarkan HANYA sub kategori yang benar-benar
 * ada di dalam kategori itu.
 *
 * Tanpa pembatasan ini, orang bisa memilih pasangan yang mustahil — kategori
 * "Beverage" dengan sub "Daging" — dan mendapat tabel kosong. Tabel kosong
 * terbaca sebagai data yang hilang, bukan sebagai saringan yang salah, dan
 * yang berikutnya terjadi adalah produk dibuat ulang dengan nama yang sedikit
 * berbeda. Sesudah itu ada dua "Gula" di master produk dan HPP-nya tidak
 * pernah bisa dijelaskan lagi.
 *
 * `TANPA_KATEGORI` diperlakukan sama seperti di `cocokSaringan`: yang dilihat
 * adalah produk yang kategorinya memang kosong.
 */
export function daftarSubKategori(produk, kategori = '') {
  const kat = bersih(kategori);
  const ada = new Set();
  let adaKosong = false;

  for (const p of produk ?? []) {
    if (kat) {
      const punya = bersih(p?.category);
      if (kat === TANPA_KATEGORI ? punya !== '' : punya !== kat) continue;
    }
    const s = bersih(p?.subcategory);
    if (s) ada.add(s);
    else adaKosong = true;
  }

  const urut = [...ada].sort((a, b) => a.localeCompare(b, 'id'));
  // "(tanpa sub kategori)" hanya ditawarkan kalau ada SUB yang terisi juga.
  // Kalau seluruh produk di kategori itu memang belum bersub, satu-satunya
  // pilihan yang ada cuma "tanpa sub" — saringan yang tidak menyaring apa pun,
  // dan hanya menambah satu kotak untuk ditebak artinya.
  return adaKosong && urut.length ? [...urut, TANPA_SUB] : urut;
}
