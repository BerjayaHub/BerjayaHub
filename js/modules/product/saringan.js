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

const bersih = (v) => String(v ?? '').trim();

/**
 * @param {object} baris  { nama, tipe, kategori } — `nama` sudah dibakukan
 * @param {object} saring { nama, tipe, kategori } — kosong = semua
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
