/**
 * SATUAN BELI SEBAGAI ACUAN SAAT OPNAME.
 *
 * Murni: tidak menyentuh DOM, tidak menyentuh Supabase.
 *
 * ============ MASALAH YANG DIPECAHKAN ============
 *
 *   "misal ada 1 dus lunch box, karena belum dibuka maka seharusnya isi satu
 *    dus itu masih utuh, mereka tidak perlu bongkar lagi untuk hitung per pcs
 *    nya jika ada label satuan beli disana"
 *
 * Opname diisi dalam SATUAN KECIL — itu satuan yang dipakai resep, stok, dan
 * seluruh laporan. Tapi yang berdiri di depan rak melihat DUS, bukan pcs. Tanpa
 * acuan, satu-satunya cara memastikan isinya adalah membuka dusnya dan
 * menghitung satu per satu; dan yang membuka dus demi opname sering lupa
 * menutupnya kembali.
 *
 * ============ YANG DIBERIKAN, DAN YANG SENGAJA TIDAK ============
 *
 * Diberikan: isi satu satuan beli ("1 dus = 50 pcs"), dan terjemahan stok
 * sistem ke satuan beli ("≈ 4 dus + 40 pcs").
 *
 * TIDAK diberikan: kotak isian dalam satuan beli. Dua kotak untuk satu angka
 * berarti satu dari keduanya akan terisi sendirian, dan tidak ada cara
 * mengetahui mana yang dimaksud orangnya. Satuan kecil tetap satu-satunya
 * yang diketik — acuannya hanya untuk dibaca.
 */

const teks = (v) => (v === null || v === undefined ? '' : String(v).trim());

const angka = (v) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};

/**
 * Apakah produk ini punya satuan beli yang BERGUNA sebagai acuan?
 *
 * Tiga keadaan yang terlihat seperti punya tapi tidak berguna:
 *
 *   isi 1          -> "1 pack = 1 pcs" tidak memberi tahu apa pun, dan
 *                     menambah satu baris teks di tiap kartu opname
 *   satuan sama    -> "1 pcs = 1 pcs", sama saja
 *   isi tidak sah  -> 0, negatif, atau bukan angka. Membaginya menghasilkan
 *                     Infinity/NaN yang akan tercetak apa adanya di layar.
 *
 * ============ AMBANGNYA PERSIS SAMA DENGAN `konversi-satuan.js` ============
 *
 * `isi <= 0 || isi === 1` — BUKAN `isi <= 1`. Bedanya kecil dan nyata: isi
 * PECAHAN (1 pack = 0,5 kg) adalah data yang sah, dan `<= 1` membuangnya.
 * Percobaan pertama berkas ini memakai `<= 1`, dan akibatnya produk yang sama
 * dianggap bersatuan beli saat diekspor ke ESB tapi tidak saat opname —
 * perbedaan yang tidak memunculkan galat di mana pun, dan baru terasa saat
 * angkanya tidak cocok.
 */
export function punyaAcuan(produk) {
  const unit = teks(produk?.purchase_unit);
  const isi = angka(produk?.purchase_qty);
  const kecil = teks(produk?.base_unit);
  if (!unit || isi === null || isi <= 0 || isi === 1) return false;
  return unit.toLowerCase() !== kecil.toLowerCase();
}

/** "1 dus = 50 pcs" — atau '' kalau tidak ada acuan yang berguna. */
export function labelAcuan(produk) {
  if (!punyaAcuan(produk)) return '';
  return `1 ${teks(produk.purchase_unit)} = ${rapi(angka(produk.purchase_qty))} ${teks(produk.base_unit)}`;
}

/**
 * Pecah jumlah satuan kecil jadi satuan beli + sisanya.
 *
 * 240 pcs dengan isi 50 -> { besar: 4, sisa: 40 }
 */
export function pecahSatuanBeli(qty, produk) {
  const n = angka(qty);
  if (!punyaAcuan(produk) || n === null || n < 0) return null;
  const isi = angka(produk.purchase_qty);

  const besar = Math.floor(n / isi);
  // Sisanya dihitung dari perkalian, BUKAN dengan `%`.
  //
  // `240.0000001 % 50` dan bilangan pecahan pada umumnya menghasilkan sisa
  // yang ekornya panjang (`39.99999999999999`), dan ekor itu akan tercetak
  // apa adanya di layar. Dibulatkan ke 4 desimal: cukup untuk bahan yang
  // dicatat per gram, jauh di bawah ketelitian yang masuk akal untuk opname.
  const sisa = bulat(n - besar * isi);
  return { besar, sisa };
}

/**
 * "≈ 4 dus + 40 pcs" — terjemahan jumlah ke satuan beli, untuk DIBACA.
 *
 * Memakai "≈" walau angkanya persis: yang membacanya sedang mencocokkan
 * dengan rak, dan tanda itu mengingatkan bahwa yang mengikat tetap angka
 * satuan kecilnya. Tanpa itu, "4 dus" terbaca seperti perintah mengisi 4.
 */
export function teksAcuanStok(qty, produk) {
  const p = pecahSatuanBeli(qty, produk);
  if (!p) return '';
  const unitBesar = teks(produk.purchase_unit);
  const unitKecil = teks(produk.base_unit);

  // Di bawah satu satuan beli, menyebut "0 dus" cuma menambah kata tanpa
  // menambah keterangan.
  if (p.besar === 0) return '';
  if (p.sisa === 0) return `≈ ${rapi(p.besar)} ${unitBesar}`;
  return `≈ ${rapi(p.besar)} ${unitBesar} + ${rapi(p.sisa)} ${unitKecil}`;
}

/** Pembulatan 4 desimal — sama dengan ketelitian ekspor ESB. */
function bulat(n) {
  return Math.round(n * 10000) / 10000;
}

/** Angka tanpa ekor nol: 4 bukan "4.0000", 1.5 tetap "1.5". */
function rapi(n) {
  const x = angka(n);
  if (x === null) return '-';
  return String(bulat(x));
}
