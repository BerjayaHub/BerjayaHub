/**
 * Urutan tabel stok: YANG PALING SEDIKIT DI ATAS.
 *
 * ============ KENAPA BUKAN URUT NAMA ============
 *
 * Daftar bahan di sini ratusan baris. Diurutkan menurut nama, bahan yang
 * stoknya minus bisa berada di baris ke-180 — dan tidak ada yang menggulir
 * sampai ke sana kecuali sedang mencarinya. Peringatan "⚠ 7 bahan stoknya
 * minus" di atas tabel sudah ada, tapi peringatan yang menyuruh orang mencari
 * sendiri di 300 baris adalah peringatan yang akan diabaikan.
 *
 * Mengurutkan dari yang terkecil membuat yang minus selalu muncul lebih dulu,
 * tanpa perlu tombol, tanpa perlu saringan, dan tanpa mengubah isi tabelnya.
 *
 * ============ KENAPA DI BERKAS SENDIRI ============
 *
 * Aturannya dipakai DUA layar — Staff App dan Admin Portal — dan keduanya
 * menyimpan barisnya dalam bentuk yang berbeda. Kalau masing-masing menulis
 * `sort()` sendiri, keduanya akan menyimpang: yang satu menaruh stok kosong di
 * atas yang minus, yang lain sebaliknya, dan tidak ada yang menyadarinya karena
 * dua layar itu jarang dilihat berdampingan.
 *
 * Tidak ada impor di berkas ini.
 */

/**
 * Angka, atau `null`. Jenisnya diperiksa lebih dulu, BUKAN hasil konversinya —
 * `Number(null)` adalah 0 dan lolos `isFinite`, sehingga stok yang tidak
 * diketahui akan menyamar jadi "kosong" dan duduk di antara bahan yang benar-
 * benar habis. Pola yang sama dipakai di `js/modules/owner/pricing.js`.
 */
function angka(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Urutkan baris stok: paling sedikit dulu, lalu menurut nama.
 *
 * Nama dipakai sebagai pemecah seri karena stok `0` akan sangat banyak. Tanpa
 * pemecah seri, urutan di antara mereka ditentukan `Array.prototype.sort` —
 * yang memang stabil sejak ES2019, tapi kestabilan itu mewarisi urutan
 * SEBELUMNYA, dan urutan sebelumnya berubah setiap kali saringan diubah.
 * Akibatnya daftar seolah "mengacak diri sendiri" saat orang mengetik di kotak
 * cari, padahal isinya sama.
 *
 * Stok yang TIDAK DIKETAHUI (null) ditaruh paling BAWAH, bukan dianggap nol.
 * Bahan yang saldonya belum pernah tercatat bukan bahan yang habis, dan
 * menempatkannya di puncak daftar "paling menipis" akan menenggelamkan yang
 * benar-benar minus.
 *
 * TIDAK mengubah array masukan — layar lain masih memegang array yang sama.
 *
 * @param {any[]} baris
 * @param {(b:any) => number|null|undefined} ambilQty
 * @param {(b:any) => string} ambilNama
 */
export function urutStokTerendah(baris, ambilQty, ambilNama) {
  return [...(baris ?? [])].sort((a, b) => {
    const qa = angka(ambilQty(a));
    const qb = angka(ambilQty(b));

    if (qa == null && qb == null) return banding(ambilNama(a), ambilNama(b));
    if (qa == null) return 1;
    if (qb == null) return -1;
    if (qa !== qb) return qa - qb;

    return banding(ambilNama(a), ambilNama(b));
  });
}

function banding(a, b) {
  return String(a ?? '').localeCompare(String(b ?? ''), 'id');
}
