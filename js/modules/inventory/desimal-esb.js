/**
 * BATAS DESIMAL YANG DITERIMA ESB — satu angka, satu tempat.
 *
 * ============ ANGKANYA 4, DAN ITU BUKAN DUGAAN ============
 *
 * Ia datang dari pesan penolakan ESB sendiri, dua kali, dengan kata yang
 * berbeda untuk kolom yang berbeda:
 *
 *     "price cannot have more than 4 decimal places"
 *     "qty cannot have more than 4 decimal places"
 *
 * Percobaan pertama menulis 6 untuk qty, dengan alasan "jumlah lebih penting
 * ketepatannya daripada harga". Itu penalaran tentang apa yang SEHARUSNYA,
 * bukan aturan ESB — dan ESB membantahnya.
 *
 * ============ KENAPA BERKAS SENDIRI ============
 *
 * Angka yang sama sempat ditulis di DUA tempat (`DESIMAL_HARGA_MAKS` di
 * `esb-purchase.js`, `DESIMAL_QTY_MAKS` di `konversi-satuan.js`) — dan di
 * tempat KETIGA yang paling penting ia tidak ditulis sama sekali: ekspor Item
 * Journal berangkat dengan `8270,724851` di kolom `Value per Unit`, enam
 * desimal, dan ESB menolak berkasnya.
 *
 * Itulah bentuk kegagalan yang dijaga berkas ini: bukan angkanya yang salah di
 * satu tempat, melainkan sebuah jalur baru yang lupa memakainya sama sekali.
 * Satu aturan yang tinggal di tiga kepala akan tertinggal di kepala keempat.
 *
 * ============ SOAL `toFixed` vs `Math.round(x * 1e4)` ============
 *
 * Keduanya dicoba, dan keduanya berbeda hasil pada nilai tepat-di-tengah:
 * `2.00005` jadi `2` lewat `toFixed` dan `2.0001` lewat `Math.round`.
 *
 * TIDAK ADA yang "benar" di antara keduanya. `2.00005` tidak bisa diwakili
 * persis sebagai double — yang sungguh tersimpan 2.0000499999999999723, jadi
 * membulatkannya ke bawah justru lebih setia pada angkanya.
 *
 * Yang dijamin cuma dua hal, dan itu yang diuji: hasilnya tidak lebih dari 4
 * desimal, dan selisihnya dari angka asli tidak lebih dari setengah satuan
 * desimal terakhir.
 *
 * Tidak ada impor di berkas ini, supaya bisa diuji tanpa browser.
 */

/** Batas desimal seluruh kolom angka ESB. Disebut SATU kali, di sini. */
export const DESIMAL_ESB_MAKS = 4;

/**
 * Bulatkan satu angka ke batas yang diterima ESB.
 *
 * @param {number|string|null|undefined} v
 * @returns {number|null} `null` kalau bukan angka — BUKAN 0. `Number('')` dan
 *   `Number(null)` adalah 0, dan 0 di kolom harga berarti "gratis": pernyataan
 *   yang berbeda dari "belum tahu", yang ESB terima tanpa keluhan.
 */
export function bulatkanEsb(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Number(n.toFixed(DESIMAL_ESB_MAKS));
}

/**
 * Apakah pembulatannya MENGHAPUS angka yang sebenarnya ada?
 *
 * Dipakai memutuskan sebuah baris harus ditahan alih-alih berangkat sebagai 0.
 * Qty `0,00004` yang jadi `0` berarti dokumennya menyatakan "tidak ada yang
 * terbuang"; harga `0,00004` yang jadi `0` berarti "bahannya gratis". Keduanya
 * DITERIMA ESB tanpa keluhan, dan keduanya salah.
 *
 * Dalam data sungguhan ini hampir mustahil — menuntut bahan seberat sepersepuluh
 * ribu gram. Ia dijaga karena "hampir mustahil" bukan "tidak mungkin", dan
 * karena kegagalannya diam.
 */
export function hilangKarenaBulat(asli, bulat) {
  return bulat === 0 && asli !== null && asli !== undefined && Number(asli) !== 0;
}
