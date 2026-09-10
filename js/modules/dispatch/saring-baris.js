/**
 * Pencarian nama bahan di dalam SATU dokumen — order masuk, draft surat jalan,
 * dan kiriman yang sedang diterima.
 *
 * ============ KENAPA PERLU ============
 *
 *   "berikan filter nama bahan juga di order yang masuk dan draft surat jalan,
 *    untuk memudahkan pencarian bahan yang di order oleh outlet, di sisi outlet
 *    terima barang juga berikan filter nama bahan juga"
 *
 * Satu order dari outlet bisa berisi tiga puluh baris. Staff CK yang memegang
 * satu karung bahan harus menemukan barisnya di antara semuanya, di layar HP,
 * sambil berdiri di depan rak. Menggulir bolak-balik untuk tiap karung adalah
 * pekerjaan yang tidak menghasilkan apa pun.
 *
 * ============ ATURAN YANG PALING PENTING DI SINI ============
 *
 * Menyaring hanya boleh MENYEMBUNYIKAN baris, tidak boleh membuangnya.
 *
 * Kotak "Dikirim" dan "Keterangan" yang sudah diisi hidup di dalam barisnya.
 * Kalau tabelnya digambar ulang berisi baris yang cocok saja, angka yang sudah
 * diketik untuk baris lain lenyap — dan yang lebih buruk, baris yang tidak
 * terlihat tidak ikut terkirim ke server. Itu persis kegagalan yang baru saja
 * diperbaiki 0132: barang yang hilang dari surat jalan tanpa satu pun error.
 *
 * Jadi berkas ini hanya menjawab "baris mana yang cocok". Yang memanggilnya
 * menyembunyikan sisanya lewat CSS, dan seluruh barisnya tetap ada di DOM.
 *
 * Tidak ada impor di sini, supaya aturannya bisa diuji tanpa browser.
 */

/**
 * Samakan bentuk teks sebelum dibandingkan.
 *
 * Huruf besar-kecil, tanda baca, dan spasi rangkap dibuang. "BAHAN CIRENG
 * CRISPY", "bahan cireng crispy", dan "Bahan Cireng-Crispy" adalah nama yang
 * sama bagi orang yang mencarinya.
 */
export function normalTeks(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Apakah `teks` memuat SELURUH kata pada `kata`?
 *
 * Per kata, bukan sebagai satu potongan utuh: orang mengetik "cireng crispy"
 * maupun "crispy cireng" untuk barang yang sama, dan yang kedua tidak akan
 * pernah ketemu kalau dicocokkan sebagai satu string.
 *
 * Kata kunci kosong berarti TIDAK menyaring — semuanya cocok. Itu bukan kasus
 * pinggiran melainkan keadaan awal setiap layar.
 */
export function cocokKata(teks, kata) {
  const q = normalTeks(kata);
  if (!q) return true;
  const t = normalTeks(teks);
  return q.split(' ').every((w) => t.includes(w));
}

/**
 * Indeks baris yang cocok, dari daftar nama.
 *
 * @param {string[]} nama
 * @param {string} kata
 * @returns {number[]}
 */
export function barisCocok(nama, kata) {
  const daftar = Array.isArray(nama) ? nama : [];
  const hasil = [];
  daftar.forEach((n, i) => {
    if (cocokKata(n, kata)) hasil.push(i);
  });
  return hasil;
}

/**
 * Kalimat "menampilkan X dari Y".
 *
 * Angkanya disebut supaya orang tahu ada yang disembunyikan. Tabel yang tiba-
 * tiba berisi dua baris tanpa keterangan apa pun terbaca seperti datanya
 * hilang — dan orang yang menyimpulkan begitu akan menutup layarnya lalu
 * mengetik ulang ordernya.
 */
export function ringkasSaringan(total, tampil, kata) {
  if (!normalTeks(kata)) return `${total} bahan`;
  if (tampil === 0) return `Tidak ada bahan yang cocok dengan "${String(kata).trim()}" — ${total} bahan lainnya disembunyikan, bukan hilang.`;
  return `${tampil} dari ${total} bahan`;
}
