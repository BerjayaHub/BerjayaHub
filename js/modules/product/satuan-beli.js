/**
 * SATUAN BELI, DITULIS DI SEBELAH NAMA BARANGNYA.
 *
 * ============ MASALAH YANG DIPECAHKAN ============
 *
 * Plastik Pex dibeli per PACK isi 100 pcs, tapi yang disimpan Berjaya Hub
 * selalu satuan KECIL — 3 pack masuk sebagai 300 pcs. Angka 100 itu ada di
 * Master Produk, dan layar Terima dari Supplier tidak pernah menampilkannya.
 *
 * Jadi staff yang memegang nota bertuliskan "3 pack" harus mengingat sendiri
 * isi tiap pack untuk 279 barang, atau membuka layar lain untuk mengeceknya.
 * Yang terjadi kalau salah: 3 masuk sebagai 3 pcs, stok kurang 297, dan tidak
 * ada satu pun error — angkanya masuk akal, notanya tersimpan rapi, dan
 * selisihnya baru ketahuan saat stok opname.
 *
 * ============ ANGKA KALINYA DITULIS EKSPLISIT ============
 *
 * Bentuknya `1 PACK@100PCS = 100 pcs`, bukan sekadar `PACK@100PCS`.
 *
 * Nama satuan belinya diketik manusia dan tidak bisa dipercaya memuat
 * angkanya: ada yang menulis "PACK@100PCS", ada yang menulis "DUS", "BALL",
 * atau "KARTON". Yang menentukan pengalinya bukan namanya melainkan kolom
 * `purchase_qty` — jadi angka itulah yang ditampilkan.
 *
 * ============ YANG BELUM DIISI TAMPIL POLOS ============
 *
 * Barang tanpa `purchase_unit`/`purchase_qty` tidak diberi keterangan apa pun.
 * Sebagian besar bahan memang dibeli per satuan kecil (gula per gram), dan
 * memberi mereka label "belum diisi" akan menyalakan peringatan pada ratusan
 * baris yang sebenarnya normal — peringatan yang menyala saat semuanya normal
 * berhenti dibaca dalam hitungan hari.
 *
 * Kelengkapan datanya tetap terpantau di tempat yang memang untuk itu: catatan
 * pada ekspor Master Produk, dan `harga-curiga.js`.
 *
 * Tidak ada impor di berkas ini, supaya bisa diuji tanpa browser.
 */

const teks = (v) => (v === null || v === undefined ? '' : String(v).trim());

const angka = (v) => {
  // `Number('')` dan `Number(null)` adalah 0, bukan NaN — jebakan yang sudah
  // menggigit di modul area presensi. Disaring lebih dulu.
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Angka isi pack ditulis tanpa nol desimal yang tidak perlu: 100, bukan 100,0000. */
function rapikan(n) {
  if (Number.isInteger(n)) return String(n);
  return String(Number(n.toFixed(4))).replace('.', ',');
}

/**
 * Keterangan satuan beli sebuah produk, atau '' kalau tidak ada.
 *
 * @param {{purchase_unit?: string, purchase_qty?: number|string, base_unit?: string}} p
 * @returns {string} mis. `1 PACK@100PCS = 100 pcs`
 */
export function hintSatuanBeli(p) {
  const unit = teks(p?.purchase_unit);
  const isi = angka(p?.purchase_qty);
  const kecil = teks(p?.base_unit);
  if (!unit || isi === null || isi <= 0) return '';

  // Satuan beli yang isinya 1 tidak dikatakan apa-apa.
  //
  // "1 BOTOL = 1 botol" benar tapi tidak berguna: tidak ada yang perlu
  // dikalikan, dan barisnya cuma jadi panjang. Ratusan baris seperti itu
  // membuat keterangan yang SUNGGUH penting ikut terabaikan.
  if (isi === 1) return '';

  // Satuan belinya sama persis dengan satuan kecilnya tapi isinya bukan 1 —
  // datanya saling bertentangan ("1 pcs = 100 pcs"). Tidak ditebak, tidak
  // ditampilkan; menampilkannya justru mengajari staff mengalikan yang salah.
  if (kecil && unit.toLowerCase() === kecil.toLowerCase()) return '';

  return `1 ${unit} = ${rapikan(isi)}${kecil ? ` ${kecil}` : ''}`;
}

/**
 * Berapa satuan kecil untuk sejumlah satuan beli — dipakai tes & penjelasan.
 *
 * Sengaja ada di modul yang sama dengan keterangannya: angka yang DITAMPILKAN
 * dan angka yang DIMAKSUD harus lahir dari satu sumber. Kalau suatu saat
 * keterangannya diubah tanpa mengubah ini, tesnya yang berteriak.
 */
export function jumlahKecil(p, banyakSatuanBeli) {
  const isi = angka(p?.purchase_qty);
  const n = angka(banyakSatuanBeli);
  if (isi === null || isi <= 0 || n === null) return null;
  return n * isi;
}
