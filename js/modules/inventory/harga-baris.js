/**
 * Harga beli SATU BARIS nota — satu jawaban, dipakai semua laporan.
 *
 * ============ KENAPA INI PERLU BERDIRI SENDIRI ============
 *
 * Sejak `0123`, angka yang DIKETIK ORANG saat menerima barang adalah harga beli
 * seluruh baris (`line_total`), bukan harga per satuan:
 *
 *     "beras 12,5 kg — Rp175.000"
 *
 * `unit_cost` masih ada dan masih jadi satu-satunya sumber biaya rata-rata
 * (`0118`), tapi ia TURUNAN: `line_total / qty` = 14.000/kg. Perkalian baliknya
 * tidak selalu kembali ke angka yang sama — 175.000 / 12,5 kebetulan bulat,
 * tapi 100.000 / 3 tidak, dan `33.333 × 3 = 99.999`.
 *
 * Seribu rupiah tidak terlihat salah di layar mana pun. Ia terlihat salah di
 * meja, saat admin menyandingkan laporan dengan tagihan supplier dan angkanya
 * meleset tanpa sebab yang bisa ditunjuk.
 *
 * Dan itu BUKAN kemungkinan teoretis: `nota_ringkas` serta `bayar_nota` di
 * server sudah memakai `coalesce(line_total, qty * unit_cost)` sejak `0123`,
 * sementara `susunLaporanNota` di layar masih mengalikan `unit_cost × qty`.
 * Dua sumber untuk satu angka yang dipakai berdebat soal uang.
 *
 * ============ URUTANNYA, DAN KENAPA ============
 *
 *   1. `line_total`  — yang diketik orang pada nota itu. Menang selalu.
 *   2. `unit_cost × qty` — baris lama sebelum 0124 menggeser datanya.
 *   3. `hpp × qty`   — cadangan terakhir; harga yang berlaku SEKARANG, bukan
 *                      saat notanya dibuat. Dipakai hanya kalau notanya memang
 *                      tidak menyimpan harga apa pun.
 *   4. `null`        — bukan 0. Nol membuat total terlihat sah padahal ada
 *                      barang yang belum bernilai.
 *
 * Tidak ada impor di berkas ini, supaya bisa diuji tanpa browser.
 */

/** `null`/`undefined`/`''` berarti kosong. `0` TIDAK. */
function angkaAtauNull(v) {
  // `Number('')` adalah 0, bukan NaN — jebakan yang sudah menggigit di
  // `keAngka` dan di `bacaRupiah`. String kosong disaring lebih dulu.
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Harga beli seluruh baris ini, atau `null` kalau memang belum berharga.
 *
 * @param {{qty?: number|string, line_total?: number|null, unit_cost?: number|null, product_id?: string}} item
 * @param {Map<string, number>} [hpp] cadangan terakhir, per product_id
 * @returns {number|null}
 */
export function hargaBeliBaris(item, hpp = new Map()) {
  if (!item) return null;

  const total = angkaAtauNull(item.line_total);
  if (total !== null) return total;

  const qty = angkaAtauNull(item.qty) ?? 0;

  // `??` dan bukan `||`: harga 0 adalah harga yang sah (barang bonus/promo) dan
  // tidak boleh jatuh ke HPP produk seolah-olah harganya belum diisi.
  const satuan = angkaAtauNull(item.unit_cost) ?? (hpp instanceof Map ? angkaAtauNull(hpp.get(item.product_id)) : null);
  if (satuan === null) return null;

  return satuan * qty;
}

/**
 * Harga per satuan yang KONSISTEN dengan harga barisnya.
 *
 * Diturunkan dari total barisnya, bukan dibaca sendiri dari `unit_cost`. Kalau
 * keduanya dibaca terpisah, kolom "harga/satuan" dan kolom "nilai" di laporan
 * yang sama bisa tidak saling mengalikan — dan yang membacanya akan mengira
 * salah satunya salah ketik.
 *
 * @returns {number|null} `null` kalau barisnya belum berharga atau qty-nya 0
 */
export function hargaSatuanBaris(item, hpp = new Map()) {
  const total = hargaBeliBaris(item, hpp);
  if (total === null) return null;
  const qty = angkaAtauNull(item?.qty) ?? 0;
  if (!qty) return null;
  return total / qty;
}
