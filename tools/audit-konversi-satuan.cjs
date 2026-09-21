/**
 * AUDIT: ekspor ESB dalam satuan beli.
 *
 * ============ CARA FITUR INI RUSAK TANPA TERLIHAT RUSAK ============
 *
 *   qty dikonversi, harga tidak     -> 3 PACK @Rp40 = Rp120 untuk barang
 *                                      seharga Rp12.000. ESB MENERIMANYA, dan
 *                                      selisihnya baru muncul saat dicocokkan
 *                                      dengan tagihan supplier
 *   harga dikonversi, qty tidak     -> 300 PACK @Rp4.000 = Rp1,2 juta. Juga
 *                                      diterima, juga diam
 *   pemetaan Unit masih satuan kecil-> SELURUH nota tertahan dengan alasan
 *                                      "PACK@30PCS belum dipetakan", dan tidak
 *                                      ada satu pun baris untuk memetakannya
 *   pengalinya diambil dari ESB     -> kolom Qty ESB terbalik pada 234 dari 647
 *                                      produk; hasilnya salah 1000× dan tetap
 *                                      DITERIMA
 *   qty dibulatkan ke pack terdekat -> 100 pcs jadi 124 pcs. Stok ESB berbeda
 *                                      dari gudang, dan angkanya wajar
 *   produk tanpa satuan beli ikut   -> pembagian dengan nol, atau seluruh nota
 *     dikonversi                       eceran mendadak tertahan
 */
const fs = require('fs');
const path = require('path');
const { tanpaKomentar, periksaKewarasan } = require('./lib/tanpa-komentar.cjs');

const AKAR = path.dirname(__dirname);
let gagal = 0;
const salah = (pesan) => {
  gagal++;
  console.error(`❌ ${pesan}`);
};

const baca = (rel) => {
  const p = path.join(AKAR, rel);
  if (!fs.existsSync(p)) {
    salah(`${rel} tidak ada — audit ini kehilangan sasarannya.`);
    return null;
  }
  return fs.readFileSync(p, 'utf8');
};

const bersih = (isi, rel, penanda) => {
  const kode = tanpaKomentar(isi);
  const pesan = periksaKewarasan(isi, kode, penanda);
  if (pesan) salah(`${rel}: ${pesan}`);
  return kode;
};

// ---------------------------------------------------------------
// 1. Modul murninya.
// ---------------------------------------------------------------
const murni = baca('js/modules/inventory/konversi-satuan.js');
if (murni) {
  const kode = bersih(murni, 'konversi-satuan.js', ['export function keSatuanBeli', 'export function satuanPerluDipetakan']);

  for (const f of ['keSatuanBeli', 'satuanPerluDipetakan']) {
    if (!new RegExp(`export function ${f}\\(`).test(kode)) salah(`konversi-satuan.js: \`${f}\` tidak diekspor.`);
  }

  // PENGALINYA DARI BERJAYA HUB, bukan dari ESB.
  if (!/angka\(produk\?\.purchase_qty\)/.test(kode)) {
    salah(
      'konversi-satuan.js: pengalinya bukan lagi `purchase_qty` milik Master Produk. Kolom `Qty` pada Master Product ' +
        'Data ESB terbukti TERBALIK pada 234 dari 647 produk — mengonversi dengan angka itu menghasilkan berkas yang ' +
        'DITERIMA ESB dengan jumlah salah seribu kali lipat.'
    );
  }
  // `Number('')` dan `Number(null)` adalah 0 -> pembagian dengan nol.
  if (!/isi === null \|\| isi <= 0 \|\| isi === 1/.test(kode)) {
    salah('konversi-satuan.js: isi yang kosong/nol/satu tidak disaring — qty dibagi nol, atau dikonversi tanpa guna.');
  }
  if (!/v === null \|\| v === undefined \|\| v === ''/.test(kode)) {
    salah("konversi-satuan.js: `angka()` tidak menyaring nilai kosong — Number('') adalah 0, bukan NaN.");
  }
  // Harga dari TOTAL, bukan dari unit_cost × isi.
  if (!/total \/ qtyBeli/.test(kode)) {
    salah(
      'konversi-satuan.js: harga per satuan beli tidak lagi dihitung dari `line_total`. `unit_cost` sendiri sudah hasil ' +
        'bagi, jadi mengalikannya kembali menumpuk galat: 10000/290 × 290 adalah 10000.000000000002.'
    );
  }
  // TIDAK ADA pembulatan qty ke bilangan bulat.
  //
  // Polanya mencari pembulatan atas EKSPRESI PEMBAGIANNYA, bukan atas nama
  // variabel tertentu. Versi pertama mencari `Math.round(qtyBeli` — dan
  // sabotase yang menulis `Math.round(qtyKecil / isi)` lolos begitu saja,
  // karena hasilnya di-assign ke `qtyBeli` alih-alih membungkusnya.
  if (/Math\.(round|ceil|floor)\s*\([^)]*qtyKecil\s*\/\s*isi/.test(kode) || /Math\.(round|ceil|floor)\s*\(\s*qtyBeli/.test(kode)) {
    salah(
      'konversi-satuan.js: qty dibulatkan ke bilangan bulat. 100 pcs dari pack isi 62 akan berangkat sebagai 2 pack = ' +
        '124 pcs — jumlahnya berubah dari yang sungguh masuk gudang, dan angkanya tetap terlihat wajar di ESB.'
    );
  }
  if (!/const qtyPenuh = qtyKecil === null \? null : qtyKecil \/ isi;/.test(kode)) {
    salah('konversi-satuan.js: qty satuan beli bukan lagi hasil bagi lurus `qtyKecil / isi`.');
  }

  // ESB membatasi qty di 4 desimal juga, bukan hanya harga.
  //
  // Angkanya sendiri pindah ke `desimal-esb.js` — aturan yang sama sempat
  // ditulis di dua berkas, dan jalur KETIGA (ekspor Item Journal) lupa
  // memakainya sama sekali lalu berangkat dengan enam desimal. Yang dijaga di
  // sini sekarang bahwa berkas ini MENURUNKANNYA, bukan menulis angkanya lagi.
  if (!/DESIMAL_QTY_MAKS = DESIMAL_ESB_MAKS;/.test(kode)) {
    salah(
      'konversi-satuan.js: batas desimal qty tidak lagi diturunkan dari `desimal-esb.js`. ESB menolaknya dengan "qty cannot have more than 4 decimal ' +
        'places" — angkanya datang dari pesan penolakan itu, bukan dari penalaran tentang berapa yang pantas.'
    );
  }
  // URUTANNYA: qty dibulatkan DULU, harga menyusul dari qty yang sudah bulat.
  //
  // Kalau harganya dihitung dari qty penuh lalu qty-nya dipotong belakangan,
  // Qty × Price tidak lagi sama dengan total nota — dan selisih itu tidak
  // pernah memicu error apa pun. Ia cuma membuat pembelian di ESB tidak pernah
  // persis cocok dengan tagihan supplier.
  if (!/const qtyBeli = bulat\(qtyPenuh, DESIMAL_QTY_MAKS\);/.test(kode)) {
    salah('konversi-satuan.js: qty tidak dibulatkan sebelum harganya dihitung.');
  }
  if (!/\? total \/ qtyBeli/.test(kode)) {
    salah(
      'konversi-satuan.js: harga tidak dibagi qty yang SUDAH dibulatkan. Qty × Price akan meleset dari total nota — ' +
        '1,6129 × 12.000 adalah Rp19.354,80, bukan Rp19.354,84.'
    );
  }
  if (/qty: bulat\(qtyBeli/.test(kode) || /qty: bulat\(qtyPenuh/.test(kode)) {
    salah('konversi-satuan.js: qty dibulatkan DUA KALI — sekali sebelum harga, sekali saat dikembalikan.');
  }
  // Qty yang membulat jadi NOL tidak boleh berangkat.
  if (!/if \(qtyBeli === 0 && qtyPenuh !== null && qtyPenuh !== 0\)/.test(kode)) {
    salah(
      'konversi-satuan.js: qty yang membulat jadi nol tetap dikonversi. Pembelian berjumlah NOL diterima ESB dengan ' +
        'tenang sebagai barang yang tidak pernah datang.'
    );
  }
  // Satuan beli yang dipakai HARUS ikut ke daftar pemetaan.
  if (!/keluar\.add\(beli\)/.test(kode)) {
    salah('konversi-satuan.js: `satuanPerluDipetakan` tidak memasukkan satuan beli — layar pemetaannya jadi jalan buntu.');
  }
  if (!/if \(kecil\) keluar\.add\(kecil\)/.test(kode)) {
    salah('konversi-satuan.js: satuan kecil hilang dari daftar pemetaan — produk tanpa satuan beli tidak bisa dipetakan lagi.');
  }
}

// ---------------------------------------------------------------
// 2. Ekspor Purchase.
// ---------------------------------------------------------------
const pur = baca('js/modules/inventory/esb-purchase.js');
if (pur) {
  const kode = bersih(pur, 'esb-purchase.js', ['export function barisEsbPurchase']);

  if (!/import \{ keSatuanBeli \} from '\.\/konversi-satuan\.js'/.test(kode)) {
    salah('esb-purchase.js: `keSatuanBeli` tidak diimpor.');
  }
  if (!/const konv = keSatuanBeli\(it, it\);/.test(kode)) {
    salah('esb-purchase.js: barisnya tidak dikonversi ke satuan beli — ESB menolaknya dengan "product must be set to purchasable".');
  }

  // KETIGA sel harus datang dari hasil konversi yang SAMA.
  //
  // Inilah kegagalan paling mahal di fitur ini: mengonversi qty tanpa harga
  // (atau sebaliknya) menghasilkan berkas yang DITERIMA ESB dengan nilai
  // rupiah yang salah puluhan kali lipat, tanpa satu pun keluhan.
  if (!/const unit = padanan\(peta\.unit, konv\.unitLokal\);/.test(kode)) {
    salah('esb-purchase.js: sel Unit tidak memakai satuan hasil konversi — notanya lolos dengan satuan yang tidak pernah diperiksa.');
  }
  if (!/^\s*konv\.qty \?\? 0,$/m.test(kode)) {
    salah('esb-purchase.js: sel Qty tidak memakai hasil konversi. Qty satuan kecil dengan harga per pack = nilai rupiah yang salah, dan ESB MENERIMANYA.');
  }
  if (!/const perSatuan = bulatkanHarga\(konv\.harga\);/.test(kode)) {
    salah('esb-purchase.js: sel Price tidak memakai hasil konversi. Harga per pcs dengan qty per pack = nilai rupiah yang salah, dan ESB MENERIMANYA.');
  }
  // Alasan "unit belum dipetakan" harus menyebut satuan yang DIKIRIM.
  if (!/catat\('unit', konv\.unitLokal, kode\)/.test(kode)) {
    salah(
      'esb-purchase.js: alasan unit tak terpetakan masih menyebut satuan kecil. Orangnya akan mencari baris "pcs" yang ' +
        'memang tidak bermasalah, sementara yang perlu dipetakan "PACK@30PCS".'
    );
  }
  // Sisa pemakaian satuan kecil di baris data adalah tanda konversinya bocor.
  if (/^\s*angka\(it\.qty\) \?\? 0,$/m.test(kode)) {
    salah('esb-purchase.js: sel Qty masih memakai `it.qty` (satuan kecil) — konversinya dihitung lalu dibuang.');
  }
}

// ---------------------------------------------------------------
// 3. Layar pemetaan — tanpa ini seluruhnya jadi jalan buntu.
// ---------------------------------------------------------------
const adm = baca('js/modules/inventory/esb.admin.js');
if (adm) {
  const kode = bersih(adm, 'esb.admin.js', ['const lokal = {']);

  if (!/unit: satuanPerluDipetakan\(produk\)/.test(kode)) {
    salah(
      'esb.admin.js: daftar pemetaan Unit tidak memuat satuan beli. Setiap nota akan tertahan dengan alasan ' +
        '"PACK@30PCS belum dipetakan", dan tidak ada satu pun baris di layar untuk memetakannya — kemampuannya ada, ' +
        'jalannya tidak ada di layar.'
    );
  }
  if (/unit: \[\.\.\.new Set\(produk\.map\(\(p\) => p\.base_unit\)/.test(kode)) {
    salah('esb.admin.js: daftar Unit lama (base_unit saja) masih ada.');
  }
}

// ---------------------------------------------------------------
// 4. Datanya harus sampai ke sana.
// ---------------------------------------------------------------
const svc = baca('js/modules/inventory/esb.service.js');
if (svc) {
  const kode = bersih(svc, 'esb.service.js', ['export async function notaUntukEsb']);

  if (!/products\(name, base_unit, purchase_unit, purchase_qty\)/.test(kode)) {
    salah(
      'esb.service.js: `purchase_unit`/`purchase_qty` tidak ikut diambil. `keSatuanBeli` kehilangan pengalinya, dan ' +
        'SELURUH nota diam-diam berangkat dalam satuan kecil lagi — persis yang ditolak ESB, tanpa satu pun tanda ' +
        'bahwa konversinya tidak jalan.'
    );
  }
  if (!/purchase_unit: it\.products\?\.purchase_unit/.test(kode) || !/purchase_qty: it\.products\?\.purchase_qty/.test(kode)) {
    salah('esb.service.js: keduanya diambil tapi tidak diteruskan ke baris item.');
  }
}

if (gagal === 0) {
  console.log(
    'Ekspor ESB memakai satuan beli: Unit, Qty, dan Price ketiganya dari konversi yang sama, pengalinya dari Master ' +
      'Produk Berjaya Hub, pecahan tidak dibulatkan, dan satuan belinya bisa dipetakan di layar. ✅'
  );
}
process.exit(gagal === 0 ? 0 : 1);
