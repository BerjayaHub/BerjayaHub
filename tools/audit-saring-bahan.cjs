/**
 * AUDIT: pencarian nama bahan di dalam satu dokumen kiriman.
 *
 * ============ SATU ATURAN, DAN SELURUH AUDIT INI DEMI ITU ============
 *
 *     MENYARING HANYA BOLEH MENYEMBUNYIKAN BARIS, TIDAK MEMBUANGNYA.
 *
 * Baris di ketiga layar ini memuat kotak isian yang sudah diketik orang —
 * jumlah kirim, jumlah terima, keterangan. Menggambar ulang tabelnya berisi
 * baris yang cocok saja akan:
 *
 *   1. menghapus angka yang sudah diketik untuk baris lain, dan
 *   2. membuat baris yang tidak terlihat TIDAK IKUT TERKIRIM ke server —
 *      karena `querySelectorAll` hanya menemukan yang ada di DOM.
 *
 * Akibat kedua itu persis kegagalan yang baru saja diperbaiki 0132: barang
 * yang lenyap dari surat jalan tanpa satu pun error. Menyaring dengan
 * menggambar ulang menghidupkannya kembali lewat pintu yang berbeda — dan
 * kali ini tidak akan ada yang mencurigai fitur pencarian.
 *
 * Yang dijaga:
 *   1. Penyaringnya memakai `hidden`, dan TIDAK memakai `remove()`/`innerHTML`.
 *   2. Ketiga layar benar-benar punya kotaknya, dan kotaknya tersambung.
 *   3. Barisnya membawa nama yang bisa dicari.
 *   4. Keadaan "tidak ada yang cocok" DIKATAKAN, bukan tabel kosong senyap.
 */
const fs = require('fs');
const path = require('path');
const { tanpaKomentar } = require('./lib/tanpa-komentar.cjs');

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

// ---------------------------------------------------------------
// 1. Penyaringnya: sembunyikan, jangan buang.
// ---------------------------------------------------------------
const helper = baca('js/modules/dispatch/saring-tabel.js');
if (helper) {
  const kode = tanpaKomentar(helper);

  if (!/\.hidden = !cocok/.test(kode)) {
    salah('saring-tabel.js: tidak menyembunyikan lewat `hidden`. Kalau barisnya dibuang, isian yang sudah diketik ikut hilang dan tidak terkirim ke server.');
  }
  for (const [pola, apa] of [
    [/\.remove\(\)/, '`remove()`'],
    [/innerHTML\s*=/, 'menulis ulang `innerHTML`'],
    [/\.replaceChildren\(/, '`replaceChildren()`']
  ]) {
    if (pola.test(kode)) {
      salah(
        `saring-tabel.js: memakai ${apa} — itu MEMBUANG baris, bukan menyembunyikannya. ` +
          'Baris yang lenyap dari DOM lenyap juga dari `querySelectorAll` saat disimpan.'
      );
    }
  }
  if (!/ringkasSaringan\(/.test(kode)) {
    salah('saring-tabel.js: tidak menulis ringkasan "x dari y" — tabel yang tiba-tiba berisi dua baris terbaca seperti datanya hilang.');
  }
  // Dijalankan sekali saat dipasang, supaya keadaan awalnya benar.
  if (!/kotak\.addEventListener\('input', jalankan\);\s*\n\s*jalankan\(\);/.test(kode)) {
    salah('saring-tabel.js: tidak dijalankan sekali saat dipasang — ringkasannya kosong sampai orang mengetik.');
  }
}

// ---------------------------------------------------------------
// Modul murni
// ---------------------------------------------------------------
const murni = baca('js/modules/dispatch/saring-baris.js');
if (murni) {
  const kode = tanpaKomentar(murni);
  for (const fn of ['normalTeks', 'cocokKata', 'barisCocok', 'ringkasSaringan']) {
    if (!new RegExp(`export function ${fn}\\(`).test(kode)) salah(`saring-baris.js: \`${fn}\` tidak diekspor.`);
  }
  // Kata kunci kosong TIDAK menyaring — itu keadaan awal tiap layar, bukan
  // kasus pinggiran. Kalau kosong dianggap "tidak cocok", seluruh tabel
  // menghilang begitu layarnya dibuka.
  if (!/if \(!q\) return true;/.test(kode)) {
    salah('saring-baris.js: kata kunci kosong tidak dikembalikan sebagai "semua cocok" — seluruh baris akan tersembunyi saat layar baru dibuka.');
  }
  if (!/split\(' '\)\.every\(/.test(kode)) {
    salah('saring-baris.js: mencocokkan seluruh kata kunci sebagai satu potongan. "crispy cireng" tidak akan pernah menemukan "BAHAN CIRENG CRISPY".');
  }
  if (!/disembunyikan, bukan hilang/i.test(murni)) {
    salah('saring-baris.js: keadaan "tidak ada yang cocok" tidak menegaskan bahwa sisanya disembunyikan — orang akan mengira datanya lenyap.');
  }
}

// ---------------------------------------------------------------
// 2 & 3. Ketiga layar.
// ---------------------------------------------------------------
const hal = baca('js/modules/dispatch/dispatch.page.js');
if (hal) {
  const kode = tanpaKomentar(hal);

  // Order Masuk (CK) & Terima (outlet): kotak, penyambungan, dan nama baris.
  for (const [kelas, layar] of [
    ['ord-cari-bahan', 'Order Masuk (CK)'],
    ['recv-cari-bahan', 'Terima kiriman (outlet)']
  ]) {
    if (!new RegExp(`class="${kelas}"`).test(kode)) salah(`dispatch.page.js: kotak pencarian bahan tidak ada di ${layar}.`);
    if (!new RegExp(`querySelector\\('\\.${kelas}'\\)`).test(kode)) {
      salah(`dispatch.page.js: kotak pencarian ${layar} tidak tersambung — diketik, tidak terjadi apa-apa.`);
    }
  }
  if ((kode.match(/saringTabel\(/g) ?? []).length < 2) {
    salah('dispatch.page.js: `saringTabel` tidak dipakai di kedua layar (Order Masuk & Terima).');
  }
  // Barisnya harus membawa namanya, kalau tidak tidak ada yang bisa dicocokkan.
  if ((kode.match(/data-nama="\$\{esc\(it\.products\?\.name \?\? ''\)\}"/g) ?? []).length < 2) {
    salah('dispatch.page.js: baris tabel tidak membawa `data-nama` di kedua layar — penyaringnya tidak punya apa pun untuk dicocokkan.');
  }
  // Draft Surat Jalan lewat picker.
  if (!/cariBaris: true/.test(kode)) {
    salah('dispatch.page.js: Draft Surat Jalan tidak menyalakan `cariBaris` — daftar tiga puluh baris tetap harus digulir satu per satu.');
  }
}

const picker = baca('js/modules/dispatch/item-picker.js');
if (picker) {
  const kode = tanpaKomentar(picker);
  if (!/cariBaris = false/.test(kode)) {
    salah('item-picker.js: opsi `cariBaris` tidak ada, padahal layar draft mengirimnya — opsi yang tidak dikenal diabaikan diam-diam.');
  }
  if (!/class="pf-cari"/.test(kode)) salah('item-picker.js: kotak pencariannya tidak digambar.');
  if (!/querySelector\('\.pf-cari'\)\?\.addEventListener\('input', terapkanSaringan\)/.test(kode)) {
    salah('item-picker.js: kotak pencarian picker tidak tersambung.');
  }
  if (!/row\.hidden = !cocok;/.test(kode)) {
    salah(
      'item-picker.js: baris disaring tanpa `hidden`. `snapshot()` membaca seluruh `.picker-row` di DOM — baris yang dibuang hilang juga dari `getItems()`.'
    );
  }
  // Baris kosong harus tetap terlihat, kalau tidak "+ Tambah Produk" terasa
  // tidak melakukan apa pun saat pencarian sedang aktif.
  if (!/const cocok = !id \|\| cocokKata\(/.test(kode)) {
    salah('item-picker.js: baris yang produknya belum dipilih ikut tersembunyi — "+ Tambah Produk" akan terlihat tidak melakukan apa-apa.');
  }
  // Saringan harus dijalankan ulang di KEDUA tempat yang mengubah daftar
  // barisnya: menggambar ulang (ganti kategori) dan menambah baris.
  //
  // Diperiksa per tempat, bukan dengan menghitung kemunculan. Versi pertama
  // menuntut tiga panggilan — angka yang saya karang dari salah hitung, dan
  // ia menuduh kode yang sudah lengkap.
  for (const [fn, kapan] of [
    ['function renderRows', 'sesudah barisnya digambar ulang'],
    ['function addRow', 'sesudah baris baru ditambahkan']
  ]) {
    const i = kode.indexOf(fn);
    if (i < 0) {
      salah(`item-picker.js: \`${fn}\` tidak ditemukan.`);
      continue;
    }
    if (!/terapkanSaringan\(\);/.test(kode.slice(i, kode.indexOf('\n  }', i)))) {
      salah(`item-picker.js: \`terapkanSaringan\` tidak dipanggil ${kapan} — baris itu muncul walau tidak cocok pencarian.`);
    }
  }
  // Namanya dibaca dari produk yang SEDANG dipilih, bukan atribut yang basi.
  if (/row\.dataset\.nama/.test(kode)) {
    salah('item-picker.js: nama baris dibaca dari atribut. Produk sebuah baris bisa diganti kapan saja, dan atribut yang basi menyembunyikan baris yang seharusnya muncul.');
  }
}

if (gagal === 0) {
  console.log('Cari bahan: menyembunyikan (bukan membuang), tersambung di tiga layar, dan keadaan kosongnya dikatakan. ✅');
}
process.exit(gagal === 0 ? 0 : 1);
