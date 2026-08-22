/**
 * SARINGAN MENU untuk layar Penjualan.
 *
 * Dipisah dari layarnya supaya bisa diuji tanpa peramban. Yang dijaga di sini
 * bukan sekadar "pencariannya bekerja", melainkan hal yang jauh lebih mudah
 * salah: **isian yang tersaring keluar tidak boleh dianggap tidak ada.**
 *
 * ============ KENAPA INI PENTING ============
 *
 * Layar Penjualan menggambar ulang seluruh tabel setiap kali saringannya
 * berubah. Kotak isian yang digambar ulang kehilangan isinya, dan
 * `querySelectorAll` hanya menemukan baris yang sedang terlihat.
 *
 * Jadi tanpa penjagaan, alur yang paling wajar justru yang paling merusak:
 * staff mengetik "Nasi Goreng 20", mencari menu berikutnya, dan angka 20 lenyap
 * — atau lebih buruk, tetap ada di layar tapi tidak ikut tersimpan. Penjualan
 * hilang tanpa satu pun pesan, dan baru ketahuan saat rekap tidak cocok dengan
 * uang di kasir.
 *
 * Tidak ada impor di berkas ini.
 */

/**
 * Menu yang lolos saringan kategori DAN pencarian nama.
 *
 * Kata dicocokkan SATU PER SATU, bukan sebagai satu potongan utuh: "nasi gor"
 * menemukan "Nasi Goreng", dan "goreng nasi" juga. Staff mengetik di ponsel
 * sambil melayani pembeli — memaksa urutan kata persis membuat pencariannya
 * lebih lambat daripada sekadar menggulir.
 *
 * @param {Array<{id: string, name?: string, category?: string, subcategory?: string}>} menus
 * @param {{kategori?: string, q?: string}} saringan
 */
export function saringMenu(menus, { kategori = '', q = '' } = {}) {
  const kata = String(q ?? '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

  return (menus ?? []).filter((m) => {
    if (!m) return false;
    if (kategori && m.category !== kategori) return false;
    if (!kata.length) return true;
    // Subkategori ikut dicari supaya "panas" atau "dingin" langsung menemukan
    // kelompoknya tanpa perlu tahu nama menunya.
    const teks = `${m.name ?? ''} ${m.subcategory ?? ''}`.toLowerCase();
    return kata.every((k) => teks.includes(k));
  });
}

/**
 * Ringkasan isian: berapa yang sudah diisi, dan mana yang sedang TERSEMBUNYI.
 *
 * Yang tersembunyi dilaporkan lengkap dengan nama dan angkanya. Menyebut
 * jumlahnya saja tidak cukup — staff yang melihat "3 tersembunyi" tetap harus
 * membatalkan saringannya satu per satu untuk memastikan yang mana, dan di
 * tengah antrean pembeli ia tidak akan melakukan itu.
 *
 * @param {Map<string, number>} qty        productId -> jumlah yang diketik
 * @param {Array<{id: string}>} terlihat   menu yang sedang lolos saringan
 * @param {Map<string, string>|Array<{id: string, name?: string}>} nama sumber nama menu
 */
export function ringkasIsian(qty, terlihat, nama) {
  const peta =
    nama instanceof Map ? nama : new Map((nama ?? []).map((m) => [m.id, m.name]));
  const idTerlihat = new Set((terlihat ?? []).map((m) => m.id));

  const terisi = [];
  const tersembunyi = [];

  for (const [id, n] of qty ?? []) {
    // Nol dan angka tak sah TIDAK dihitung sebagai "sudah diisi". Kotak yang
    // sempat diketik lalu dikosongkan kembali bukan entri.
    if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) continue;
    const baris = { id, qty: n, nama: peta.get(id) ?? '(menu tidak dikenal)' };
    terisi.push(baris);
    if (!idTerlihat.has(id)) tersembunyi.push(baris);
  }

  return { terisi, tersembunyi, jumlahTerisi: terisi.length, jumlahTersembunyi: tersembunyi.length };
}

/**
 * Isian yang siap dikirim — dari INGATAN, bukan dari kotak yang terlihat.
 *
 * Ini fungsi yang menentukan apa yang benar-benar tercatat sebagai penjualan.
 * Ia sengaja tidak menerima elemen DOM sama sekali, supaya tidak ada jalan bagi
 * layar untuk diam-diam mengirim "yang sedang terlihat saja".
 *
 * @param {Map<string, number>} qty
 * @returns {Array<{product_id: string, qty: number}>}
 */
export function isianTerkirim(qty) {
  const items = [];
  for (const [product_id, n] of qty ?? []) {
    if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) continue;
    items.push({ product_id, qty: n });
  }
  return items;
}
