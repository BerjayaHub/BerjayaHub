/**
 * SARINGAN INVENTARIS ASET — apa yang sedang aktif, dikatakan sekali.
 *
 * ============ KENAPA MODUL SENDIRI UNTUK SATU KALIMAT ============
 *
 * Kalimat "filter yang sedang aktif" ditulis di TIGA tempat: subjudul PDF,
 * subjudul Excel, dan kalimat "tidak ada yang cocok" di tabel kosong. Ketiganya
 * disusun terpisah, dan ketiganya sudah menyimpang sebelum berkas ini ada:
 *
 *   PDF   — menyebut kategori & kondisi, TIDAK menyebut kata pencarian
 *   Excel — menyebut ketiganya
 *   tabel — memeriksa ketiganya
 *
 * Akibatnya: menyaring "kursi" lalu mengunduh PDF menghasilkan berkas berjudul
 * "Semua outlet · 3 jenis barang" untuk data yang sudah disaring. Yang
 * menerimanya tidak punya cara tahu bahwa ia melihat sebagian.
 *
 * Itu bukan galat, dan tidak ada tes yang bisa menyebutnya rusak. Ia cuma
 * laporan yang diam-diam tidak lengkap — dan begitu saringan KEEMPAT
 * ditambahkan (Cari catatan), ketiganya harus diperbarui lagi, masing-masing.
 *
 * Tidak ada impor di berkas ini, supaya bisa diuji tanpa browser.
 */

const teks = (v) => (v === null || v === undefined ? '' : String(v).trim());

/**
 * Apakah ADA saringan yang sedang aktif?
 *
 * Outlet TIDAK dihitung. Untuk staff ia selalu terisi (outletnya sendiri), jadi
 * menghitungnya membuat "Belum ada aset tercatat" tidak pernah muncul di Staff
 * App — dan yang membacanya akan mengira ada saringan tersembunyi yang harus
 * dibersihkan dulu.
 */
export function adaSaringan(state) {
  return Boolean(teks(state?.q) || teks(state?.catatan) || teks(state?.category) || teks(state?.condition));
}

/**
 * Kalimat "yang sedang disaring", untuk subjudul laporan.
 *
 * @param {object} state saringan layar
 * @param {Record<string,string>} labelKondisi peta kode kondisi -> label
 * @returns {string} mis. " · Kategori: Meja · Cari nama: \"kursi\"", atau ''
 */
export function ringkasSaringan(state, labelKondisi = {}) {
  const bagian = [];
  const kategori = teks(state?.category);
  const kondisi = teks(state?.condition);
  const q = teks(state?.q);
  const catatan = teks(state?.catatan);

  if (kategori) bagian.push(`Kategori: ${kategori}`);
  // Kondisi yang tidak dikenal ditulis APA ADANYA, bukan dibuang. Kode mentah
  // di subjudul jelek; subjudul yang diam-diam kehilangan satu saringan jauh
  // lebih buruk.
  if (kondisi) bagian.push(`Kondisi: ${labelKondisi[kondisi] ?? kondisi}`);
  if (q) bagian.push(`Cari nama: "${q}"`);
  if (catatan) bagian.push(`Cari catatan: "${catatan}"`);

  return bagian.length ? ` · ${bagian.join(' · ')}` : '';
}
