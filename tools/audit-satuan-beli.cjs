/**
 * AUDIT: satuan beli tampil di pemilih barang, tanpa merusak pencariannya.
 *
 * ============ CARA FITUR INI RUSAK TANPA TERLIHAT RUSAK ============
 *
 *   keterangannya masuk ke `label`   -> mengetik "100" memunculkan SETIAP
 *                                       barang yang isi pack-nya 100. Kotak
 *                                       carinya berhenti menyaring, tanpa satu
 *                                       pun error — dan tidak ada yang akan
 *                                       menyebutnya kerusakan; ia cuma "jadi
 *                                       kurang enak dipakai"
 *   pencariannya dialihkan ke teks   -> kerusakan yang sama, dari sisi lain
 *   tampil di dropdown saja          -> begitu dipilih, keterangannya hilang —
 *                                       padahal justru SESUDAH memilih orangnya
 *                                       mengetik jumlahnya
 *   dialog Edit nota dilupakan       -> yang memperbaiki nota tidak melihat
 *                                       pengalinya, dan koreksinya salah lagi
 *   pengalinya ditebak dari NAMA     -> "DUS" dan "KARUNG" tidak memuat angka;
 *                                       yang menentukan selalu purchase_qty
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
const murni = baca('js/modules/product/satuan-beli.js');
if (murni) {
  const kode = bersih(murni, 'satuan-beli.js', ['export function hintSatuanBeli']);

  for (const f of ['hintSatuanBeli', 'jumlahKecil']) {
    if (!new RegExp(`export function ${f}\\(`).test(kode)) salah(`satuan-beli.js: \`${f}\` tidak diekspor.`);
  }
  // Pengalinya dari purchase_qty, bukan dari nama satuannya.
  if (!/angka\(p\?\.purchase_qty\)/.test(kode)) {
    salah(
      'satuan-beli.js: isi pack tidak lagi dibaca dari `purchase_qty`. Nama satuan beli diketik manusia — "DUS" dan ' +
        '"KARUNG" tidak memuat angka sama sekali, jadi menebaknya dari nama akan diam-diam salah untuk sebagian barang.'
    );
  }
  // `Number('')` dan `Number(null)` adalah 0, bukan NaN.
  if (!/v === null \|\| v === undefined \|\| v === ''/.test(kode)) {
    salah('satuan-beli.js: nilai kosong tidak disaring sebelum `Number()` — "" dan null akan lolos sebagai isi 0.');
  }
  if (!/if \(isi === 1\) return '';/.test(kode)) {
    salah('satuan-beli.js: isi 1 ikut ditampilkan ("1 BOTOL = 1 botol") — ratusan baris tanpa guna, dan yang penting ikut terabaikan.');
  }
  if (!/unit\.toLowerCase\(\) === kecil\.toLowerCase\(\)/.test(kode)) {
    salah('satuan-beli.js: satuan beli yang sama dengan satuan kecil tapi isinya bukan 1 ikut ditampilkan — "1 pcs = 100 pcs" mengajari staff mengalikan yang salah.');
  }
}

// ---------------------------------------------------------------
// 2. search-select: TAMPIL dan CARI dipisah.
// ---------------------------------------------------------------
const ui = baca('js/core/ui.js');
if (ui) {
  const kode = bersih(ui, 'ui.js', ['export function teksOpsi', 'export function wireSearchSelect']);

  if (!/export function teksOpsi\(/.test(kode)) {
    salah('ui.js: `teksOpsi` tidak ada — teks yang tampil dan teks yang dicocokkan kembali jadi satu.');
  }

  // INI pemeriksaan terpentingnya, dan ia menyebut `o.label` secara harfiah.
  if (!/draw\(options\.filter\(\(o\) => fuzzyMatch\(input\.value, o\.label\)\)\)/.test(kode)) {
    salah(
      'ui.js: pencarian search-select tidak lagi mencocokkan `o.label`. Kalau ia mencocokkan teks yang tampil, ' +
        'mengetik "100" akan memunculkan setiap barang yang isi pack-nya 100 — kotak carinya berhenti menyaring ' +
        'tanpa satu pun error.'
    );
  }
  // Sebaliknya: keterangannya HARUS ikut tampil, di daftar dan di kotaknya.
  // Kelasnya dicocokkan lengkap dengan tanda kutipnya. `/\.ss-hint/` yang
  // longgar tetap cocok dengan `ss-hint-nonaktif` — jebakan pencocokan awalan
  // yang sudah beberapa kali membuat audit di proyek ini "hijau" atas kelas
  // yang sebenarnya sudah dimatikan.
  if (!/class="ss-hint"/.test(kode)) {
    salah('ui.js: keterangan opsi tidak digambar di daftar.');
  }
  // Lewat `teksKotak`, bukan `teksOpsi` langsung.
  //
  // `teksKotak` menambahkan satu keputusan yang tidak boleh hilang: pada field
  // `allowCreate`, isi kotak ITULAH nilainya, jadi keterangan tidak boleh ikut
  // ke sana. Untuk pemilih barang (`allowCreate` mati) ia tetap mengembalikan
  // `teksOpsi`, jadi keterangan satuan beli tetap terlihat sesudah dipilih.
  if (!/function teksKotak\(o, allowCreate\)/.test(kode)) {
    salah('ui.js: `teksKotak` hilang — pemisah antara teks yang TAMPIL dan teks yang jadi NILAI tidak ada lagi.');
  }
  if (!/return allowCreate \? String\(o\?\.label \?\? ''\) : teksOpsi\(o\);/.test(kode)) {
    salah(
      'ui.js: `teksKotak` tidak lagi membedakan mode. Kalau ia selalu memakai `teksOpsi`, keterangan ikut jadi bagian ' +
        'nama supplier; kalau selalu label saja, keterangan satuan beli hilang dari pemilih barang.'
    );
  }
  if (!/const shownLabel = selected \? teksKotak\(selected, allowCreate\)/.test(kode)) {
    salah('ui.js: kotaknya tidak memakai `teksKotak` saat nilainya sudah terisi.');
  }
  if (!/return o \? teksKotak\(o, allowCreate\)/.test(kode)) {
    salah(
      'ui.js: `labelFor` tidak memakai `teksKotak`. Keterangannya akan lenyap tepat sesudah barangnya dipilih — padahal ' +
        'justru SESUDAH memilih orangnya mengetik jumlahnya.'
    );
  }
}

// ---------------------------------------------------------------
// 3. Pemilih barangnya.
// ---------------------------------------------------------------
const picker = baca('js/modules/dispatch/item-picker.js');
if (picker) {
  const kode = bersih(picker, 'item-picker.js', ['const optionsOf']);

  if (!/import \{ hintSatuanBeli \} from '\.\.\/product\/satuan-beli\.js'/.test(kode)) {
    salah('item-picker.js: `hintSatuanBeli` tidak diimpor.');
  }
  if (!/hint: hintSatuanBeli\(p\)/.test(kode)) {
    salah('item-picker.js: opsinya tidak membawa keterangan satuan beli — staff kembali harus mengingat isi pack 279 barang.');
  }
  // Keterangannya TIDAK boleh ikut masuk ke label.
  if (!/label: `\$\{p\.name\} \(\$\{p\.base_unit\}\)`/.test(kode)) {
    salah(
      'item-picker.js: `label` bukan lagi sekadar nama + satuan kecil. Kalau satuan belinya ikut masuk ke sana, ' +
        'pencariannya rusak — lihat catatan di `teksOpsi`.'
    );
  }
}

// ---------------------------------------------------------------
// 4. Kedua jalur nota: tambah DAN edit.
// ---------------------------------------------------------------
const nota = baca('js/modules/inventory/nota-staff.js');
if (nota) {
  const kode = bersih(nota, 'nota-staff.js', ['createItemPicker(']);

  // Dua pemanggilan: form tambah, dan dialog Edit. Yang kedua paling mudah
  // terlupakan — dan justru di sanalah kesalahan jumlah diperbaiki.
  const n = (kode.match(/createItemPicker\(/g) ?? []).length;
  if (n < 2) {
    salah(
      `nota-staff.js: hanya ${n} pemanggilan createItemPicker. Dialog Edit nota harus memakai pemilih yang sama — ` +
        'kalau ia menggambar daftarnya sendiri, keterangan satuan beli tidak akan ikut ke sana, dan yang memperbaiki ' +
        'nota mengulangi kesalahan yang sedang ia perbaiki.'
    );
  }
}

// ---------------------------------------------------------------
// 5. Gayanya ada.
// ---------------------------------------------------------------
const css = baca('css/styles.css');
// Selektornya dicocokkan sampai kurung buka aturannya.
//
// `/\.ss-hint/` yang longgar tetap cocok dengan `.ss-hint-nonaktif` — sabotase
// yang mengganti nama kelasnya pernah LOLOS persis begitu. Pencocokan awalan
// sudah menipu beberapa audit di proyek ini; di sini ia ditutup dengan menyebut
// selektor yang lengkap.
if (css && !/\.search-select \.ss-list li \.ss-hint\s*\{/.test(css)) {
  salah('styles.css: `.ss-hint` tidak punya gaya — keterangannya menempel di nama barangnya dan terbaca sebagai satu kalimat.');
}
if (css && !/\.ss-hint\s*\{[^}]*display:\s*block/.test(css)) {
  salah('styles.css: `.ss-hint` bukan `display:block` — di HP, nama barang yang panjang akan mendorongnya keluar layar.');
}

if (gagal === 0) {
  console.log('Satuan beli tampil di pemilih barang (dropdown & sesudah dipilih), dan pencariannya tetap hanya pada nama. ✅');
}
process.exit(gagal === 0 ? 0 : 1);
