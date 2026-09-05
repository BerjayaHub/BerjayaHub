/**
 * AUDIT: harga di nota benar-benar bisa diisi, dan angkanya tidak diam-diam
 *        masuk ke HPP.
 *
 * ============ DUA JANJI YANG BERLAWANAN ARAH ============
 *
 * 1. HARUS ADA jalannya. `goods_receipt_items.unit_cost` sudah ada sejak 0084,
 *    RPC-nya menerimanya, dan `laporan-nota.js` membacanya — tapi tidak pernah
 *    ada kotak isiannya, jadi kolom itu selalu NULL. Ini bentuk kegagalan yang
 *    paling sering muncul di repo ini: kemampuannya ada di database, jalannya
 *    tidak ada di layar.
 *
 * 2. TIDAK BOLEH masuk HPP. Rata-rata nota adalah pembanding. Kalau ia menyusup
 *    ke `hpp.js`, satu salah ketik harga menggeser HPP, margin, dan
 *    pertimbangan harga jual seluruh menu yang memakai bahan itu — tanpa
 *    seorang pun menyetujuinya, dan tanpa satu pun error.
 *
 * Yang kedua dijaga dengan melarang, bukan menuntut. Larangan lebih sulit
 * diuji dengan tes: tidak ada perilaku yang bisa diperiksa, hanya ketiadaan
 * yang harus bertahan.
 */
const fs = require('fs');
const path = require('path');

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

// Pemotong komentar yang MENGHORMATI STRING — lihat tools/lib/tanpa-komentar.cjs.
//
// Versi dua-baris yang dulu disalin ke tiap audit memperlakukan `/*` di dalam
// string (`accept="image/*"`) sebagai awal komentar, lalu menelan puluhan baris
// kode sampai `*/` JSDoc berikutnya. Pada pemeriksaan LARANGAN, itu berarti
// audit hijau karena kodenya sudah terlanjur terhapus.
const { tanpaKomentar } = require('./lib/tanpa-komentar.cjs');

// ---------------------------------------------------------------
// 1. Kotak harganya ada di layar nota, dan HANYA di sana.
// ---------------------------------------------------------------
const notaStaff = baca('js/modules/inventory/nota-staff.js');
if (notaStaff) {
  const kode = tanpaKomentar(notaStaff);
  if (!/hargaSatuan:\s*true/.test(kode)) {
    salah(
      'js/modules/inventory/nota-staff.js: item picker dipanggil tanpa `hargaSatuan: true`. ' +
        'Kolom `unit_cost` sudah ada di database sejak 0084 dan tetap akan selalu NULL — ' +
        'kemampuannya ada, jalannya tidak ada di layar.'
    );
  }
}

const picker = baca('js/modules/dispatch/item-picker.js');
if (picker) {
  const kode = tanpaKomentar(picker);
  if (!/hargaSatuan\s*=\s*false/.test(kode)) {
    salah(
      'js/modules/dispatch/item-picker.js: `hargaSatuan` tidak berbawaan `false`. ' +
        'Order ke CK, transfer, dan retur memakai picker yang sama — barangnya berpindah antar outlet, ' +
        'bukan dibeli. Kotak harga di sana akan diisi dengan tebakan, dan tebakan itu masuk ke ' +
        'biaya rata-rata seolah-olah pembelian sungguhan.'
    );
  }
  // Kosong tetap kosong, bukan nol — dan itu dijamin `bacaRupiah`, yang
  // mengembalikan `null` untuk isian kosong (lihat test-rupiah-desimal.mjs).
  if (!/unit_cost:\s*bacaRupiah\(/.test(kode)) {
    salah(
      "js/modules/dispatch/item-picker.js: `unit_cost` tidak dibaca lewat `bacaRupiah`. " +
        'Isiannya sekarang teks berformat ("13.800,5"), jadi `Number()` langsung menghasilkan NaN — ' +
        'dan untuk isian KOSONG, `Number("")` menghasilkan 0, yang tersimpan sebagai "barangnya gratis" ' +
        'lalu ikut menimbang biaya rata-rata.'
    );
  }
  // Kotak angka bawaan browser menolak titik ribuan dan mengosongkan dirinya.
  if (/class="pf-harga"[^>]*type="number"|type="number"[^>]*class="pf-harga"/.test(kode)) {
    salah(
      'js/modules/dispatch/item-picker.js: kotak harga memakai `type="number"`. ' +
        'Begitu titik ribuan diketik, browser menganggap isinya tidak sah dan `.value` jadi string ' +
        'kosong — seluruh angka yang sudah diketik lenyap tanpa satu pun tanda.'
    );
  }
  if (!/attachRupiahInput\(/.test(kode)) {
    salah(
      'js/modules/dispatch/item-picker.js: `attachRupiahInput` tidak dipasang. ' +
        'Pemisah ribuannya tidak akan pernah muncul saat mengetik.'
    );
  }
}

// Layar lain TIDAK boleh menyalakannya.
const LAYAR_TANPA_HARGA = [
  'js/modules/dispatch/dispatch.page.js',
  'js/modules/inventory/inventory.page.js'
];
for (const rel of LAYAR_TANPA_HARGA) {
  const isi = baca(rel);
  if (!isi) continue;
  if (/hargaSatuan:\s*true/.test(tanpaKomentar(isi))) {
    salah(
      `${rel}: menyalakan \`hargaSatuan\` pada item picker. ` +
        'Layar ini memindahkan barang antar outlet, bukan membelinya — harganya akan ditebak, ' +
        'lalu tebakan itu ikut menimbang biaya rata-rata.'
    );
  }
}

// ---------------------------------------------------------------
// 2. YANG PALING PENTING: rata-rata nota TIDAK menyusup ke HPP.
// ---------------------------------------------------------------
const hpp = baca('js/modules/product/hpp.js');
if (hpp) {
  for (const dilarang of ['biaya_rata_bahan', 'biayaRata', 'getBiayaRataOutlet', 'rataTertimbang']) {
    if (new RegExp(`\\b${dilarang}\\b`).test(hpp)) {
      salah(
        `js/modules/product/hpp.js: menyebut \`${dilarang}\`. ` +
          'Mesin HPP harus tetap memakai `purchase_price / purchase_qty` saja. Begitu rata-rata nota ' +
          'masuk ke sini, satu salah ketik harga menggeser HPP, margin, dan harga jual seluruh menu ' +
          'yang memakai bahan itu — tanpa ada yang menyetujuinya.'
      );
    }
  }
  // Dan rumus masternya masih yang itu — kalau berubah, `hargaMaster()` di
  // `biaya-rata.js` (yang menuliskannya ulang supaya tetap tanpa impor) jadi
  // menyimpang, dan pembandingnya membandingkan dua hal yang berbeda.
  if (!/purchase_price\s*\)\s*\/\s*Number\(p\.purchase_qty\)|purchase_price\) \/ Number\(p\.purchase_qty\)/.test(hpp)) {
    salah(
      'js/modules/product/hpp.js: rumus harga bahan baku tidak lagi `purchase_price / purchase_qty`. ' +
        '`hargaMaster()` di biaya-rata.js menuliskannya ulang (supaya modulnya tetap tanpa impor), ' +
        'jadi perubahan di sini membuat pembandingnya membandingkan dua hal yang berbeda.'
    );
  }
}

// ---------------------------------------------------------------
// 3. Migration: tabelnya turunan, tidak bisa ditulis tangan.
// ---------------------------------------------------------------
const mig = baca('supabase/migrations/0118_biaya_rata_bahan.sql');
if (mig) {
  if (!/create trigger stock_movements_biaya_rata\b/.test(mig)) {
    salah(
      'supabase/migrations/0118: trigger `stock_movements_biaya_rata` tidak dipasang. ' +
        'Tanpa itu angkanya hanya terisi saat backfill dan tidak pernah berubah lagi — tabel yang ' +
        'terlihat hidup padahal beku.'
    );
  }
  if (/create policy[^;]*on biaya_rata_bahan[^;]*for (all|insert|update|delete)/i.test(mig)) {
    salah(
      'supabase/migrations/0118: ada kebijakan TULIS di `biaya_rata_bahan`. ' +
        'Isinya sepenuhnya turunan dari `stock_movements`. Tabel turunan yang bisa disunting tangan ' +
        'berhenti menjadi turunan, dan selisihnya terhadap sumbernya tidak akan pernah terlihat.'
    );
  }
  // Larangan yang paling menentukan: migration ini tidak boleh menyentuh
  // kolom harga master.
  if (/update\s+products\s+set[^;]*purchase_price/i.test(mig)) {
    salah(
      'supabase/migrations/0118: menulis ke `products.purchase_price`. ' +
        'Itu melanggar janji utama fitur ini — HPP tidak boleh bergeser sendiri.'
    );
  }
}

// ---------------------------------------------------------------
// 4. Layar Bahan menampilkan pembandingnya.
// ---------------------------------------------------------------
const invPage = baca('js/modules/inventory/inventory.page.js');
if (invPage) {
  const kode = tanpaKomentar(invPage);
  if (!/bandingHarga\s*\(/.test(kode)) {
    salah(
      'js/modules/inventory/inventory.page.js: tabel Bahan tidak menampilkan pembanding harga. ' +
        'Angkanya tersimpan tapi tidak pernah dilihat siapa pun — dan fitur yang tidak terlihat ' +
        'sama saja dengan tidak ada.'
    );
  }
  if (!/getBiayaRataOutlet\s*\(/.test(kode)) {
    salah('js/modules/inventory/inventory.page.js: peta biaya rata-rata tidak pernah dimuat.');
  }
  // Kegagalan memuatnya tidak boleh menggagalkan tabel stoknya.
  if (!/getBiayaRataOutlet\([^)]*\)\s*\.catch\(/.test(kode)) {
    salah(
      'js/modules/inventory/inventory.page.js: kegagalan memuat biaya rata-rata tidak ditangkap. ' +
        'Ia cuma pembanding — stok yang tidak tampil karena harga gagal dimuat adalah pertukaran ' +
        'yang jelas merugikan.'
    );
  }
}


// ---------------------------------------------------------------
// 5. Nota yang sudah tersimpan tetap bisa diperbaiki.
//
// Harga sering baru diketahui belakangan (nota fisiknya menyusul), dan jumlah
// bisa salah ketik. Tanpa jalan memperbaikinya, satu-satunya cara adalah
// membuat nota baru — dan stok jadi terhitung dua kali.
// ---------------------------------------------------------------
if (notaStaff) {
  const kode = tanpaKomentar(notaStaff);
  if (!/class="nota-edit"/.test(kode)) {
    salah(
      'js/modules/inventory/nota-staff.js: tidak ada tombol Edit di riwayat nota. ' +
        'Harga yang baru diketahui belakangan tidak punya jalan masuk, dan satu-satunya cara ' +
        'memperbaiki salah ketik adalah membuat nota baru — yang menghitung stoknya dua kali.'
    );
  }
  if (!/type:\s*'rupiah'/.test(kode)) {
    salah(
      "js/modules/inventory/nota-staff.js: dialog edit tidak memakai field `type: 'rupiah'`. " +
        "`money` membuang desimalnya — harga Rp13,80/gram tersimpan sebagai Rp1.380, seratus kali lipat."
    );
  }
  // Baris berjumlah 0 harus DIBUANG dari daftar, bukan dikirim sebagai 0.
  if (!/\.filter\(\(i\) => i\.qty > 0\)/.test(kode)) {
    salah(
      'js/modules/inventory/nota-staff.js: baris berjumlah 0 tidak dibuang sebelum dikirim. ' +
        'Server MELEWATI item berjumlah 0 tanpa efek apa pun (0084), jadi barangnya tetap ada ' +
        'sementara orangnya mengira sudah membatalkannya. Yang membatalkan adalah KETIADAANNYA di daftar.'
    );
  }
}

// ---------------------------------------------------------------
// 6. Service tidak boleh mengubah `undefined` jadi string kosong.
// ---------------------------------------------------------------
const notaSvc = baca('js/modules/inventory/nota.service.js');
if (notaSvc) {
  const kode = tanpaKomentar(notaSvc);
  for (const [param, kolom] of [
    ['p_supplier', 'nama supplier'],
    ['p_invoice_no', 'no. invoice'],
    ['p_notes', 'catatan']
  ]) {
    if (new RegExp(`${param}:\\s*\\w+\\s*\\?\\?\\s*''`).test(kode)) {
      salah(
        `js/modules/inventory/nota.service.js: \`${param}\` memakai \`?? ''\`. ` +
          `Servernya membedakan NULL ("jangan sentuh") dari string kosong ("hapus"), jadi pemanggil ` +
          `yang tidak menyebut ${kolom} akan diam-diam MEMINTA kolom itu dikosongkan. ` +
          'Itu persis bug "+ Foto menghapus nama supplier".'
      );
    }
  }
}

if (gagal === 0) {
  console.log('Biaya rata-rata: harga bisa diisi di nota, tampil sebagai pembanding, dan tidak menyusup ke HPP. ✅');
}
process.exit(gagal === 0 ? 0 : 1);
