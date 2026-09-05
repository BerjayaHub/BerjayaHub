/**
 * Argumen RPC yang tidak bisa hilang di jalan.
 *
 * ============ BUG YANG MELAHIRKAN FILE INI ============
 *
 *   "Could not find the function public.ubah_nota_terima(p_id, p_invoice_no,
 *    p_items, p_notes, p_receipt_date, p_supplier) in the schema cache"
 *
 * Tujuh argumen dikirim; enam yang sampai. Penyebabnya satu baris:
 *
 *     p_photo_path: photoPath      // `photoPath` undefined saat tidak disebut
 *
 * `JSON.stringify` MEMBUANG kunci yang bernilai `undefined` — tanpa peringatan,
 * tanpa error, dan tanpa jejak apa pun di sisi klien. Yang berangkat ke server
 * adalah objek yang lebih kecil daripada yang tertulis di kode.
 *
 * Dan PostgREST memilih fungsi berdasarkan **himpunan NAMA argumen** yang
 * diterimanya. Jadi satu `undefined` tidak berarti "argumen ini NULL"; ia
 * berarti "panggil fungsi LAIN yang kebetulan berargumen enam".
 *
 * Dua bentuk kegagalannya, dan yang kedua jauh lebih buruk:
 *
 *   - Tidak ada fungsi berargumen enam -> galat 42883, menyebut nama fungsi
 *     yang tidak pernah ada dan tidak menyinggung kunci yang hilang sama
 *     sekali. Ini yang terjadi pada tombol Edit nota, dan gejalanya terbaca
 *     sebagai "fitur editnya rusak".
 *
 *   - ADA fungsi berargumen enam (mis. versi lama yang masih tertinggal, atau
 *     yang parameternya ber-DEFAULT) -> panggilannya BERHASIL, mengerjakan hal
 *     yang berbeda, dan tidak ada satu pun error di sepanjang jalan.
 *
 * ============ KENAPA BUKAN AUDIT MENYELURUH ============
 *
 * Menuntut `?? null` pada SETIAP argumen RPC di repo ini menyentuh 141 tempat,
 * hampir semuanya id wajib yang tidak pernah `undefined`. Aturan sebising itu
 * akan diabaikan, dan aturan yang diabaikan lebih buruk daripada tidak ada.
 *
 * Yang dijaga di sini adalah bentuk objeknya, sekali, di satu tempat yang bisa
 * diuji tanpa jaringan.
 */

/**
 * Ubah setiap `undefined` jadi `null`, supaya kuncinya SELAMAT melewati
 * `JSON.stringify`.
 *
 * Dangkal saja, tidak menelusuri ke dalam — argumen RPC memang datar, dan
 * `undefined` di dalam array item ditangani pemanggilnya sendiri (`?? null`
 * per baris) karena di sana artinya berbeda: "harga belum diisi", bukan
 * "kolom ini jangan disentuh".
 *
 * @template {Record<string, any>} T
 * @param {T} args
 * @returns {T}
 */
export function argumenRpc(args) {
  const hasil = {};
  for (const [k, v] of Object.entries(args ?? {})) hasil[k] = v === undefined ? null : v;
  return hasil;
}

/**
 * Apakah objek ini akan kehilangan kunci saat dikirim?
 *
 * Dipakai tes; sengaja diekspor supaya kegagalannya bisa ditunjukkan sebagai
 * daftar nama, bukan sebagai galat 42883 yang menyebut fungsi karangan.
 *
 * @param {Record<string, any>} args
 * @returns {string[]} nama kunci yang akan dibuang `JSON.stringify`
 */
export function kunciHilang(args) {
  return Object.entries(args ?? {})
    .filter(([, v]) => v === undefined)
    .map(([k]) => k);
}
