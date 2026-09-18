/**
 * KONVERSI SATUAN KECIL -> SATUAN BELI, untuk sel Unit/Qty/Price berkas ESB.
 *
 * ============ KENAPA INI ADA ============
 *
 * ESB menolak pembelian yang dikirim dalam satuan yang bukan satuan belinya:
 * "product must be set to purchasable". Berjaya Hub menyimpan segalanya dalam
 * satuan KECIL — 3 pack plastik tersimpan sebagai 300 pcs — jadi yang berangkat
 * selama ini selalu pcs/gram.
 *
 * Maka di titik ekspor (dan HANYA di situ) angkanya diubah ke satuan beli:
 *
 *     300 pcs  @ Rp40/pcs      ->  3 PACK@100PCS  @ Rp4.000/pack
 *     496 gr   @ Rp43,9012/gr  ->  0,496 KG       @ Rp43.901,2097/kg
 *
 * Stok, HPP, dan seluruh isi database TIDAK tersentuh. Satu-satunya yang
 * berubah adalah tiga sel di berkas unduhan.
 *
 * ============ ANGKANYA DARI BERJAYA HUB, BUKAN DARI ESB ============
 *
 * Pengalinya `purchase_qty` milik Master Produk Berjaya Hub — BUKAN kolom `Qty`
 * pada Master Product Data ESB.
 *
 * Alasannya konkret: kolom `Qty` ESB terbukti TERBALIK pada 234 dari 647
 * produk. Ayam Dada Fillet tercatat "GR = 1000, KG = 1" sementara kolom harga
 * di baris yang sama bilang sebaliknya (Rp50/gr, Rp50.000/kg). Mengonversi
 * dengan angka itu menghasilkan berkas yang DITERIMA ESB dengan jumlah yang
 * salah seribu kali lipat — dan kesalahan yang diterima jauh lebih mahal
 * daripada kesalahan yang ditolak.
 *
 * ============ YANG TIDAK PUNYA SATUAN BELI TIDAK DIUBAH ============
 *
 * Produk tanpa `purchase_unit`/`purchase_qty` berangkat dalam satuan kecil,
 * persis seperti sebelumnya. Sebagian bahan memang dibeli eceran, dan menahan
 * notanya karena kolom yang belum sempat diisi akan menghentikan pekerjaan yang
 * selama ini berjalan.
 *
 * ============ PECAHAN DITERIMA APA ADANYA ============
 *
 * 100 pcs dari pack isi 62 adalah 1,6129 pack. Dikirim apa adanya.
 *
 * Membulatkannya ke 2 pack berarti mengirim 124 pcs untuk barang yang diterima
 * 100 pcs — jumlahnya berubah dari yang sungguh masuk gudang, dan angkanya
 * tetap terlihat wajar di ESB. Untuk satuan berat pecahan malah normal: 0,496
 * kg bukan kesalahan siapa pun.
 *
 * Tidak ada impor di berkas ini, supaya bisa diuji tanpa Excel maupun browser.
 */

/**
 * Batas desimal Qty di berkas ESB.
 *
 * Sengaja lebih longgar dari harga (yang dibatasi 4 oleh ESB sendiri): jumlah
 * adalah angka yang dicocokkan orang dengan nota kertas, dan memotongnya
 * terlalu pendek membuat Qty × Price meleset dari total notanya.
 */
export const DESIMAL_QTY_MAKS = 6;

const angka = (v) => {
  // `Number('')` dan `Number(null)` adalah 0, bukan NaN.
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const teks = (v) => (v === null || v === undefined ? '' : String(v).trim());

const bulat = (n, d) => (n === null ? null : Number(n.toFixed(d)));

/**
 * Ubah satu baris item ke satuan beli — atau biarkan apa adanya.
 *
 * @param {object} item  { product_name, base_unit, qty, unit_cost, line_total }
 * @param {object} produk { purchase_unit, purchase_qty } — baris Master Produk
 * @returns {{
 *   unitLokal: string,   // nilai yang dicari di pemetaan Unit
 *   qty: number|null,
 *   harga: number|null,  // per `unitLokal`
 *   dikonversi: boolean,
 *   isi: number|null     // pengali yang dipakai; null kalau tidak dikonversi
 * }}
 */
export function keSatuanBeli(item, produk) {
  const qtyKecil = angka(item?.qty);
  const hargaKecil = angka(item?.unit_cost);
  const unitKecil = teks(item?.base_unit);

  const unitBeli = teks(produk?.purchase_unit);
  const isi = angka(produk?.purchase_qty);

  // Tidak punya satuan beli, isinya tidak masuk akal, atau isinya 1 (satuan
  // belinya sama saja dengan satuan kecil) -> tidak ada yang perlu diubah.
  if (!unitBeli || isi === null || isi <= 0 || isi === 1) {
    return { unitLokal: unitKecil, qty: qtyKecil, harga: hargaKecil, dikonversi: false, isi: null };
  }

  // Satuan beli yang namanya SAMA dengan satuan kecil tapi isinya bukan 1:
  // datanya saling bertentangan. Tidak ditebak, tidak dikonversi — aturan yang
  // sama dengan keterangan di layar pemilih barang.
  if (unitKecil && unitBeli.toLowerCase() === unitKecil.toLowerCase()) {
    return { unitLokal: unitKecil, qty: qtyKecil, harga: hargaKecil, dikonversi: false, isi: null };
  }

  // HARGA DIHITUNG DARI TOTAL BARISNYA, BUKAN DARI `unit_cost × isi`.
  //
  // `unit_cost` sendiri sudah hasil bagi (`line_total / qty`), jadi mengalikannya
  // kembali menumpuk galat pembulatan di atas galat pembulatan. Rp12.000 untuk
  // 62 pcs menjadi 193.5483870967742, dan × 62 kembali menghasilkan
  // 11999.999999999998 — bukan 12.000.
  //
  // Dihitung dari `line_total` langsung, satu pack berharga persis Rp12.000.
  const qtyBeli = qtyKecil === null ? null : qtyKecil / isi;
  const total = angka(item?.line_total) ?? (qtyKecil !== null && hargaKecil !== null ? qtyKecil * hargaKecil : null);
  const hargaBeli =
    total !== null && qtyBeli !== null && qtyBeli !== 0
      ? total / qtyBeli
      : hargaKecil !== null
        ? hargaKecil * isi
        : null;

  return {
    unitLokal: unitBeli,
    qty: bulat(qtyBeli, DESIMAL_QTY_MAKS),
    harga: hargaBeli,
    dikonversi: true,
    isi
  };
}

/**
 * Daftar nilai satuan yang PERLU dipetakan ke nama satuan ESB.
 *
 * Satuan beli ikut, dan itu wajib: sejak ekspor memakai satuan beli, nilai yang
 * dicari di pemetaan bukan lagi `base_unit` melainkan `purchase_unit`. Layar
 * pemetaan yang masih menampilkan daftar lama akan membuat SELURUH nota
 * tertahan tanpa satu pun baris untuk memperbaikinya — kemampuannya ada,
 * jalannya tidak ada di layar.
 *
 * Keduanya dikembalikan, bukan salah satu: produk tanpa satuan beli tetap
 * berangkat dalam satuan kecilnya.
 */
export function satuanPerluDipetakan(produk) {
  const keluar = new Set();
  for (const p of Array.isArray(produk) ? produk : []) {
    const kecil = teks(p?.base_unit);
    if (kecil) keluar.add(kecil);
    const beli = teks(p?.purchase_unit);
    const isi = angka(p?.purchase_qty);
    // Hanya satuan beli yang BENAR-BENAR dipakai `keSatuanBeli` yang ikut.
    // Menambahkan yang isinya kosong atau 1 cuma memanjangkan daftar dengan
    // baris yang tidak pernah berangkat ke mana pun.
    if (beli && isi !== null && isi > 1 && beli.toLowerCase() !== kecil.toLowerCase()) keluar.add(beli);
  }
  return [...keluar].sort((a, b) => a.localeCompare(b, 'id'));
}
