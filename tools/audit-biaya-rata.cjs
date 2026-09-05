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
  // Sejak 0123 isinya `line_total` (harga beli seluruh baris), bukan
  // `unit_cost` — pembagiannya dikerjakan server. Yang dijaga di sini tetap
  // sama: cara MEMBACA kotaknya.
  if (!/line_total:\s*bacaRupiah\(/.test(kode)) {
    salah(
      "js/modules/dispatch/item-picker.js: `line_total` tidak dibaca lewat `bacaRupiah`. " +
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
  // Dialog editnya memakai ITEM PICKER, bukan deretan field menurun.
  //
  // Bentuk lama membuat sepasang field per barang ("Telur — jumlah", "Telur —
  // harga per gr"). Untuk nota berisi enam barang itu dua belas kotak
  // bertumpuk, dan — yang lebih menentukan — jumlah fieldnya ditetapkan saat
  // dialog dibuka, jadi barang BARU tidak bisa ditambahkan sama sekali.
  // `createItemPicker(wadah, …)` — bukan lagi `createItemPicker(form.…)`.
  //
  // Wadahnya sekarang diambil ke variabel lebih dulu supaya bisa diperiksa
  // (lihat §7). Pola audit yang menuntut bentuk lama akan merah pada perbaikan
  // yang benar — dan audit yang menghalangi perbaikan akan dimatikan orang.
  if (!/createItemPicker\(\s*(form\.|wadah)/.test(kode)) {
    salah(
      'js/modules/inventory/nota-staff.js: dialog edit tidak menanam `createItemPicker`. ' +
        'Tanpa itu jumlah & harga kembali berderet menurun satu per satu, dan barang baru tidak bisa ' +
        'ditambahkan ke nota yang sudah tersimpan.'
    );
  }
  // `initial` HARUS BERISI, bukan sekadar disebut.
  //
  // Percobaan pertama cuma menuntut kata `initial:` ada — dan sabotase
  // `initial: []` memenuhinya. Membuka Edit lalu menampilkan nota KOSONG
  // terlihat seperti nota yang memang tidak berisi apa-apa; menekan Simpan di
  // situ MEMBATALKAN seluruh barang yang sebenarnya ada, lengkap dengan
  // pergerakan stok penyeimbangnya.
  if (!/initial:\s*isi\.map\(/.test(kode)) {
    salah(
      'js/modules/inventory/nota-staff.js: picker di dialog edit tidak diisi dari `isi` nota yang ada. ' +
        'Dialog yang terbuka kosong terlihat seperti nota tanpa barang — dan menyimpannya membatalkan ' +
        'seluruh isinya beserta stoknya.'
    );
  }
  if (!/hargaSatuan:\s*true[\s\S]{0,200}initial:/.test(kode) && !/initial:[\s\S]{0,200}hargaSatuan:\s*true/.test(kode)) {
    salah(
      'js/modules/inventory/nota-staff.js: picker di dialog edit tidak menyalakan `hargaSatuan` — ' +
        'kotak harganya tidak akan muncul sama sekali, dan tombol Edit jadi tidak bisa dipakai untuk ' +
        'hal yang justru paling sering: mengisi harga yang menyusul.'
    );
  }
  // Isi picker dibaca lewat `kumpulkan`, bukan sesudah dialognya ditutup.
  if (!/kumpulkan\(\(\) =>/.test(kode)) {
    salah(
      'js/modules/inventory/nota-staff.js: isi picker tidak dibaca lewat `kumpulkan()`. ' +
        'Membacanya sesudah `await` KEBETULAN masih berhasil karena `close()` menunda pembongkaran ' +
        'DOM 200 ms untuk animasi — ketergantungan pada jeda animasi tidak terlihat di kode mana pun, ' +
        'dan patahnya berupa data yang hilang tanpa pesan.'
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


// ---------------------------------------------------------------
// 7. Dialog yang separuh tergambar harus BERTERIAK, bukan diam.
//
// Kejadian nyata: HP yang masih memegang `js/core/ui.js` versi lama di cache
// HTTP bertemu `nota-staff.js` versi baru. `type: 'html'` tidak dikenal, jatuh
// ke `<input type="html">` — yang browser perlakukan sebagai kotak teks biasa.
// Layar edit menampilkan kotak kosong berlabel "Barang", tanpa satu pun error.
// Di desktop, cache-nya segar, layarnya benar. Dua perangkat, dua perilaku.
// ---------------------------------------------------------------
const ui = baca('js/core/ui.js');
if (ui) {
  const kode = tanpaKomentar(ui);
  // DUA HAL TERPISAH: daftarnya ADA, dan daftarnya DIPAKAI sebagai penjaga.
  //
  // Percobaan pertama cuma mencari kata `TIPE_INPUT_BIASA`. Dua sabotase lolos:
  // mengganti penjaganya jadi `if (false)` (namanya masih ada di deklarasi),
  // dan mengganti nama deklarasinya (namanya masih ada di `.has()` yang kini
  // menunjuk variabel yang tidak pernah didefinisikan). Keduanya mematikan
  // penjaganya sepenuhnya sambil menyisakan namanya di berkas.
  if (!/const TIPE_INPUT_BIASA = new Set\(/.test(kode)) {
    salah(
      'js/core/ui.js: daftar tertutup `TIPE_INPUT_BIASA` tidak dideklarasikan. ' +
        'Tipe yang tidak dikenal akan jatuh ke `<input type="...">` dan tampil sebagai kotak teks ' +
        'yang terlihat sempurna wajar — seluruh komponen yang seharusnya ada lenyap tanpa tanda.'
    );
  }
  if (!/if\s*\(!TIPE_INPUT_BIASA\.has\(f\.type\)\)/.test(kode)) {
    salah(
      'js/core/ui.js: `TIPE_INPUT_BIASA` tidak dipakai sebagai penjaga. ' +
        'Daftarnya ada tapi tidak menghalangi apa pun — dan daftar yang tidak dipakai sama saja ' +
        'dengan tidak ada.'
    );
  }
  if (!/data-tipe-tak-dikenal/.test(kode)) {
    salah('js/core/ui.js: field bertipe tak dikenal tidak ditandai, jadi submit tidak bisa menolaknya.');
  }
  if (!/querySelector\('\[data-tipe-tak-dikenal\]'\)/.test(kode)) {
    salah(
      'js/core/ui.js: submit tidak memeriksa apakah ada field yang gagal digambar. ' +
        'Menyimpan dari dialog yang separuh tergambar berarti mengirim keadaan yang tidak pernah ' +
        'dilihat siapa pun.'
    );
  }
}

if (notaStaff) {
  const kode = tanpaKomentar(notaStaff);
  if (!/typeof kumpulkan !== 'function'/.test(kode)) {
    salah(
      'js/modules/inventory/nota-staff.js: `onReady` tidak memeriksa wadah picker & `kumpulkan`. ' +
        'Pada perangkat dengan `ui.js` lama, `createItemPicker(null, …)` melempar DI DALAM `onReady` — ' +
        'lemparan di situ tidak terlihat di mana pun kecuali console, sementara dialognya tetap ' +
        'berdiri dan tombol Simpan tetap bisa ditekan.'
    );
  }
}

if (gagal === 0) {
  console.log('Biaya rata-rata: harga bisa diisi di nota, tampil sebagai pembanding, dan tidak menyusup ke HPP. ✅');
}
process.exit(gagal === 0 ? 0 : 1);
