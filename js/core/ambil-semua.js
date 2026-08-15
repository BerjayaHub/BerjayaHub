/**
 * Mengambil SELURUH baris dari sebuah query, bukan hanya sebanyak yang
 * kebetulan dikirim server.
 *
 * KENAPA FILE INI ADA — GEJALANYA. Puluhan resep tampil sebagai "Resep ini
 * kosong — bahannya tidak pernah tersimpan", padahal begitu resep yang sama
 * dibuka di editor, bahannya lengkap semua. Dua layar menampilkan resep yang
 * sama dengan isi yang berbeda, dan keduanya membaca dari database yang sama.
 *
 * SEBABNYA: PostgREST membatasi jawaban pada sekitar 1.000 baris kalau tidak
 * diminta lain. Batas itu BUKAN error — jawabannya sukses, cuma dipotong.
 * `listRecipesFull()` mengambil seluruh `recipe_items` satu BU dalam satu
 * permintaan; begitu bahan-bahannya melewati seribu baris, resep yang
 * kebetulan berada di belakang antrean pulang tanpa bahan. Editor tidak kena
 * karena ia bertanya per resep, jadi jawabannya selalu jauh di bawah batas.
 *
 * Ini bentuk kegagalan paling mahal yang berulang di proyek ini: TIDAK ADA
 * ERROR. Datanya utuh di database, layarnya bilang hilang, dan orangnya
 * menghabiskan waktu mengisi ulang resep yang sebenarnya sudah benar — lalu
 * impor ulang menjawab "dilewati, resep sudah ada".
 *
 * DUA HAL YANG DITANGANI:
 *   1. `ambilSemua` — mengambil bertahap sampai habis, bukan sekali ambil.
 *   2. `ambilPerPotong` — memecah daftar id untuk `.in(...)`. Seribu UUID di
 *      query string menghasilkan URL puluhan kilobyte, dan itu ditolak
 *      sebagian perantara jaringan dengan galat yang tidak menyebut sebabnya.
 *
 * Tidak ada impor di file ini, supaya bisa diuji tanpa browser maupun jaringan.
 */

/** Sengaja di bawah batas bawaan PostgREST (1.000) supaya tetap aman kalau servernya diubah. */
export const UKURAN_HALAMAN = 500;

/** Batas jumlah id per `.in(...)`. Menjaga panjang URL tetap wajar. */
export const UKURAN_POTONG = 200;

/**
 * @param {(dari: number, sampai: number) => Promise<{data: any[]|null, error: any}>} minta
 *   dipanggil dengan indeks baris (inklusif), persis seperti `.range()`
 * @returns {Promise<any[]>}
 */
export async function ambilSemua(minta, { ukuran = UKURAN_HALAMAN } = {}) {
  const semua = [];
  let dari = 0;
  let total = null; // diisi kalau server memberi tahu jumlah seluruhnya

  // Batas putaran: kalau server mengabaikan `range` dan selalu mengembalikan
  // halaman yang sama, tanpa ini aplikasinya menggantung selamanya — kegagalan
  // yang jauh lebih buruk daripada data yang kurang.
  for (let putaran = 0; putaran < 1000; putaran++) {
    const { data, error, count } = await minta(dari, dari + ukuran - 1);
    if (error) throw error;
    const potong = data ?? [];
    if (Number.isFinite(count)) total = count;

    if (!potong.length) return semua;
    semua.push(...potong);
    // Maju sebanyak yang BENAR-BENAR diterima, bukan sebanyak yang diminta —
    // server boleh mengirim lebih sedikit karena batasnya sendiri.
    dari += potong.length;

    // KENAPA `count` DIPAKAI KALAU ADA. Tanpa jumlah total, satu-satunya cara
    // aman berhenti adalah menunggu halaman kosong — dan itu berarti SATU
    // PERMINTAAN TAMBAHAN setiap kali, termasuk untuk daftar sepuluh baris.
    //
    // Berhenti pada "halaman lebih kecil dari yang diminta" memang menghindari
    // permintaan itu, tapi SALAH untuk sebab yang persis sedang diperbaiki file
    // ini: server boleh punya batas sendiri yang lebih kecil dari ukuran
    // halaman kita. Kalau PostgREST memotong di 300 sementara kita meminta 500,
    // halaman pertama pulang 300, dianggap habis, dan sisanya hilang diam-diam.
    //
    // `count` menyelesaikan keduanya: pemanggil yang menyertakan
    // `{ count: 'exact' }` berhenti tepat waktu tanpa permintaan tambahan;
    // yang tidak menyertakannya tetap aman, cuma membayar satu permintaan.
    if (total != null && semua.length >= total) return semua;
  }
  throw new Error('Terlalu banyak halaman saat mengambil data — kemungkinan server mengabaikan penomoran halaman.');
}

/**
 * Memecah daftar id jadi beberapa permintaan lalu menggabungkan hasilnya.
 *
 * @param {any[]} ids
 * @param {(potongan: any[]) => Promise<any[]>} minta
 */
export async function ambilPerPotong(ids, minta, { ukuran = UKURAN_POTONG } = {}) {
  const daftar = ids ?? [];
  if (!daftar.length) return [];
  const hasil = [];
  for (let i = 0; i < daftar.length; i += ukuran) {
    hasil.push(...(await minta(daftar.slice(i, i + ukuran))));
  }
  return hasil;
}
