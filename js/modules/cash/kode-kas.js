/**
 * NOMOR yang bisa dibaca manusia untuk sebuah entri kas.
 *
 * ============ KENAPA BERKAS SENDIRI ============
 *
 * `cash_entries` tidak punya kolom nomor — ia tidak pernah perlu satu, karena
 * tidak ada dokumen fisik yang menunjuknya. Nota punya `TRM-…`, kiriman punya
 * kodenya sendiri; kas cuma punya id.
 *
 * Begitu kas ikut diekspor ke ESB (0149), nomor itu jadi perlu: kolom
 * `Additional Information` di berkas Disbursement adalah satu-satunya jalan
 * dari baris di ESB kembali ke entri kas di sini saat angkanya dipertanyakan.
 *
 * Lalu muncul persoalan yang lebih dekat: layar ekspor menampilkan
 * "KAS-7E9CF9F2" di daftar yang tertahan, dan **nomor itu tidak ada di layar
 * mana pun**. Yang membacanya tahu ada dua entri yang perlu dibereskan, dan
 * tidak punya cara menemukannya di antara tiga puluh enam baris mutasi kas.
 *
 * Jadi rumusnya tinggal di satu tempat, dan DUA layar memakainya: berkas ESB
 * dan tabel Mutasi Kas. Dua salinan akan menghasilkan dua nomor berbeda untuk
 * baris yang sama, dan pencariannya berhenti bekerja tanpa satu pun galat.
 *
 * ============ DITURUNKAN DARI ID, BUKAN NOMOR BERJALAN ============
 *
 * Nomor berjalan menuntut tabel penghitung, dan bisa berulang kalau dua orang
 * mencatat bersamaan. Delapan huruf pertama uuid sudah cukup membedakan —
 * bukan jaminan matematis, tapi cukup untuk seseorang yang mencocokkan satu
 * baris di layar dengan satu baris di Excel.
 *
 * Tidak ada impor di berkas ini, supaya bisa diuji tanpa browser.
 */

/** Awalan yang membedakannya dari `TRM-…` (nota) dan `WST-…` (waste). */
export const AWALAN_KAS = 'KAS-';

/**
 * @param {string|null|undefined} id
 * @returns {string} mis. `KAS-7E9CF9F2`; string kosong kalau id-nya kosong —
 *   BUKAN "KAS-", yang terlihat seperti nomor sungguhan yang rusak.
 */
export function kodeKas(id) {
  const s = String(id ?? '').trim();
  if (!s) return '';
  return `${AWALAN_KAS}${s.slice(0, 8).toUpperCase()}`;
}

/**
 * Apakah sebuah kata pencarian menunjuk entri ini?
 *
 * Mencocokkan nomor LENGKAP maupun sebagiannya: orang menyalin
 * "KAS-7E9CF9F2" dari layar ekspor, tapi juga mengetik "7e9cf9f2" saja.
 * Keduanya ketemu lewat `includes` yang sama — percobaan pertama menambahkan
 * klausa kedua yang membuang awalannya, dan klausa itu tidak pernah mengubah
 * satu pun jawaban: "7E9CF9F2" sudah substring dari "KAS-7E9CF9F2". Ia dibuang
 * alih-alih dijaga sabotase yang tidak bisa merusak apa pun.
 */
export function cocokKodeKas(id, kata) {
  const cari = String(kata ?? '').trim().toUpperCase();
  if (!cari) return true;
  const kode = kodeKas(id);
  if (!kode) return false;
  return kode.includes(cari);
}
