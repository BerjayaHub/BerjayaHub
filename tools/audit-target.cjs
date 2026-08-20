#!/usr/bin/env node
/**
 * TARGET ADALAH LAPISAN BACA. IA TIDAK BOLEH MENYENTUH APA PUN.
 *
 * ============ MASALAHNYA ============
 *
 * Layar Target penuh kotak isian: target laba, hari operasional, ASP
 * perencanaan. Semua kotak isian di aplikasi ini, di setiap modul lain,
 * berakhir di tombol simpan.
 *
 * Di sini justru tidak boleh. Asumsi perencanaan yang tersimpan akan dibaca
 * bulan depan oleh orang yang tidak tahu siapa yang mengetiknya dan kapan — dan
 * yang lebih buruk, ASP perencanaan yang bocor ke `outlet_menu_prices` akan
 * mengubah harga jual sungguhan. Tidak ada error; harga menu berubah karena
 * seseorang mengisi kotak di halaman perencanaan.
 *
 * ============ YANG DIPERIKSA ============
 *
 *   1. `target.js` murni: tidak menulis, tidak memanggil jaringan.
 *   2. `target.js` tidak memakai `products.sale_price` sebagai harga.
 *   3. Seluruh hasilnya berkonteks `target`, tidak pernah `actual`/`projected`.
 *   4. Biaya `shared_bu`/`corporate` tidak masuk ke jalur target OUTLET.
 *   5. Konsolidasi bukan BEP gabungan yang disamarkan.
 *   6. Target tidak menghitung ulang ekonominya sendiri (tidak impor mesin lain).
 *   7. Layar Target memasang ketiga label konteks.
 *   8. Layar Actual & Proyeksi tidak diam-diam menampilkan angka target.
 */

const fs = require('fs');
const path = require('path');

const AKAR = path.join(__dirname, '..');
const DIR = path.join(AKAR, 'js', 'modules', 'owner');

const MESIN = path.join(DIR, 'target.js');
const LAYAR = path.join(DIR, 'target.owner.js');

function tanpaKomentar(js) {
  return js
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((b) => b.replace(/(^|[^:])\/\/.*$/, '$1'))
    .join('\n');
}

/**
 * Tubuh sebuah `export function`, dipotong di `export` berikutnya.
 *
 * Namanya dicocokkan sampai kurung buka — BUKAN dengan `indexOf` biasa.
 * `indexOf('export function hitungTarget')` juga cocok dengan
 * `export function hitungTargetLama`, jadi fungsi yang diganti nama akan
 * terlihat masih ada dan seluruh pemeriksaan di bawahnya justru memeriksa
 * fungsi yang salah. Sabotase mengganti nama sempat lolos persis begini.
 */
function tubuhFungsi(src, nama) {
  const cocok = new RegExp(`export\\s+function\\s+${nama}\\s*\\(`).exec(src);
  if (!cocok) return null;
  const sisa = src.slice(cocok.index + 10);
  const j = sisa.indexOf('\nexport ');
  return j < 0 ? sisa : sisa.slice(0, j);
}

const masalah = [];

for (const jalan of [MESIN, LAYAR]) {
  if (!fs.existsSync(jalan)) masalah.push(`${path.basename(jalan)} tidak ditemukan — audit ini sudah basi.`);
}
if (masalah.length) {
  console.error('❌ ' + masalah.join('\n'));
  process.exit(1);
}

const mesin = tanpaKomentar(fs.readFileSync(MESIN, 'utf8'));
const layar = tanpaKomentar(fs.readFileSync(LAYAR, 'utf8'));

const catat = (pesan) => masalah.push(pesan);
const barisKe = (src, pola) => src.split('\n').findIndex((b) => pola.test(b)) + 1;

// =====================================================================
// 1. TIDAK MENULIS APA PUN
// =====================================================================
const TULIS = [
  { pola: /\.insert\s*\(/, apa: '.insert()' },
  { pola: /\.update\s*\(/, apa: '.update()' },
  { pola: /\.upsert\s*\(/, apa: '.upsert()' },
  { pola: /\.delete\s*\(/, apa: '.delete()' },
  { pola: /\.rpc\s*\(/, apa: '.rpc()' },
  { pola: /supabase/i, apa: 'klien supabase' },
  { pola: /\bfetch\s*\(/, apa: 'fetch()' },
  { pola: /localStorage|sessionStorage/, apa: 'penyimpanan peramban' }
];

for (const berkas of [
  { nama: 'target.js', src: mesin },
  { nama: 'target.owner.js', src: layar }
]) {
  for (const t of TULIS) {
    if (!t.pola.test(berkas.src)) continue;
    catat(
      `${berkas.nama}:${barisKe(berkas.src, t.pola)} — memakai ${t.apa}.\n` +
        `    Target adalah lapisan BACA. Asumsi perencanaan yang tersimpan akan dipakai\n` +
        `    bulan depan tanpa ada yang tahu asalnya; ASP perencanaan yang bocor ke\n` +
        `    outlet_menu_prices akan mengubah harga jual sungguhan tanpa satu pun error.`
    );
  }
}

// =====================================================================
// 2. BUKAN HARGA MASTER
// =====================================================================
for (const berkas of [
  { nama: 'target.js', src: mesin },
  { nama: 'target.owner.js', src: layar }
]) {
  if (/sale_price/.test(berkas.src)) {
    catat(
      `${berkas.nama}:${barisKe(berkas.src, /sale_price/)} — membaca products.sale_price.\n` +
        `    Harga target harus datang dari ASP tertimbang aktual atau dari ASP perencanaan\n` +
        `    yang berlabel. sale_price adalah harga BU — satu angka untuk semua outlet,\n` +
        `    yaitu persis yang dihapus di Phase 1–7.`
    );
  }
}

// =====================================================================
// 3. KONTEKSNYA SELALU `target`
// =====================================================================
const FUNGSI = ['ekonomiTarget', 'hitungTarget', 'pencapaianTarget', 'konsolidasiTarget', 'ringkasBuTarget'];
const WAJIB_KONTEKS = ['hitungTarget', 'konsolidasiTarget', 'ringkasBuTarget'];

for (const fn of FUNGSI) {
  if (tubuhFungsi(mesin, fn) == null) catat(`target.js — fungsi ${fn}() tidak ada lagi.`);
}
for (const fn of WAJIB_KONTEKS) {
  const tubuh = tubuhFungsi(mesin, fn);
  if (tubuh && !/konteks:\s*'target'/.test(tubuh)) {
    catat(`target.js — ${fn}() mengembalikan hasil tanpa konteks: 'target'.`);
  }
}

// SELURUH berkas, bukan hanya fungsi ekspornya — jalur hasil-kosong dan helper
// juga harus menandai dirinya. Aturan ini ditambahkan setelah sebuah sabotase
// pada helper `proyeksiKosong()` di Phase 9 lolos dari pemeriksaan per-fungsi.
for (const lain of ['actual', 'projected']) {
  const pola = new RegExp(`konteks:\\s*'${lain}'`);
  if (pola.test(mesin)) {
    catat(
      `target.js:${barisKe(mesin, pola)} — ada hasil bertanda konteks: '${lain}'.\n` +
        `    Seluruh isi berkas ini harus menandai dirinya 'target', termasuk jalur\n` +
        `    hasil-kosong yang dipakai outlet tanpa transaksi.`
    );
  }
}

// =====================================================================
// 4. BIAYA BERSAMA TIDAK MASUK JALUR OUTLET
// =====================================================================
const JALUR_OUTLET = ['ekonomiTarget', 'hitungTarget'];
for (const fn of JALUR_OUTLET) {
  const tubuh = tubuhFungsi(mesin, fn);
  if (!tubuh) continue;
  for (const cakupan of ['shared_bu', 'corporate']) {
    if (new RegExp(cakupan).test(tubuh)) {
      catat(
        `target.js — ${fn}() menyebut "${cakupan}".\n` +
          `    Jalur target OUTLET hanya boleh memuat biaya direct_outlet. Menambahkan\n` +
          `    biaya bersama membuat target tiap outlet terlihat lebih berat, dan kalau\n` +
          `    dibagi rata ia juga akan terhitung berulang di setiap outlet.`
      );
    }
  }
}

// Sebaliknya: ringkasan BU HARUS menyebut keduanya, terpisah.
const tubuhBu = tubuhFungsi(mesin, 'ringkasBuTarget');
if (tubuhBu) {
  for (const cakupan of ['shared_bu', 'corporate']) {
    if (!new RegExp(cakupan).test(tubuhBu)) {
      catat(`target.js — ringkasBuTarget() tidak lagi menampilkan biaya "${cakupan}". Ia harus terlihat, meski tidak dialokasikan.`);
    }
  }
}

// =====================================================================
// 5. KONSOLIDASI BUKAN BEP GABUNGAN YANG DISAMARKAN
// =====================================================================
const tubuhKons = tubuhFungsi(mesin, 'konsolidasiTarget');
if (tubuhKons) {
  // Penjumlahan murni tidak butuh CM sama sekali. Begitu CM muncul di sini,
  // hampir pasti ada pembagian biaya tetap total dengan margin rata-rata —
  // angka yang selisihnya dari penjumlahan sebenarnya bisa ke arah mana saja.
  for (const jejak of ['cmRasio', 'cmPersen', 'variabelPersen', 'fixedBulanan']) {
    if (new RegExp(`\\b${jejak}\\b`).test(tubuhKons)) {
      catat(
        `target.js — konsolidasiTarget() menyentuh "${jejak}".\n` +
          `    Penjumlahan target tidak memerlukan margin maupun biaya tetap. Kehadirannya\n` +
          `    di sini berarti ada BEP gabungan yang dihitung ulang dari angka rata-rata —\n` +
          `    yang justru menyembunyikan outlet bermargin tipis di balik yang tebal.`
      );
    }
  }

  if (!/SUM OF OUTLET TARGETS/.test(tubuhKons)) {
    catat(`target.js — konsolidasiTarget() tidak lagi memberi label "SUM OF OUTLET TARGETS".`);
  }
  if (!/bepGabungan:\s*false/.test(tubuhKons)) {
    catat(`target.js — konsolidasiTarget() tidak lagi menyatakan bepGabungan: false di dalam datanya.`);
  }
}

// =====================================================================
// 6. EKONOMINYA DIPINJAM, BUKAN DIHITUNG ULANG
// =====================================================================
for (const terlarang of ['bep.js', 'kpi.js', 'hpp.js', 'proyeksi.js', '.service.js']) {
  const pola = new RegExp(`from\\s+'[^']*${terlarang.replace('.', '\\.')}'`);
  if (pola.test(mesin)) {
    catat(
      `target.js — mengimpor "${terlarang}".\n` +
        `    Target harus meminjam ekonomi dari hasil hitungActualOutlet(). Mesin HPP atau\n` +
        `    mesin margin kedua akan menyimpang dari yang pertama begitu salah satunya\n` +
        `    diubah, dan yang muncul adalah dua BEP berbeda untuk outlet yang sama.`
    );
  }
}

// =====================================================================
// 7. LAYAR TARGET MEMASANG KETIGA LABEL
// =====================================================================
for (const label of ['TARGET', 'ACTUAL', 'PROJECTED']) {
  if (!new RegExp(`tanda-konteks[^<]*>\\s*${label}`).test(layar)) {
    catat(
      `target.owner.js — tidak memasang penanda "${label}".\n` +
        `    Layar ini SATU-SATUNYA yang menampilkan ketiga konteks berdampingan, dan\n` +
        `    justru karena itu ketiganya harus berlabel. Angka omzet yang terlepas dari\n` +
        `    kolomnya tidak bisa dibedakan sama sekali.`
    );
  }
}

// Perbandingannya harus tabel berkepala kolom, bukan kartu berdampingan:
// kepala kolom tidak bisa terlepas dari angkanya saat digulir atau dipotret.
if (!/<th>\$\{TANDA_ACTUAL\}<\/th>/.test(layar) || !/<th>\$\{TANDA_PROJECTED\}<\/th>/.test(layar)) {
  catat(
    `target.owner.js — perbandingan tiga konteks tidak lagi digambar sebagai kepala kolom tabel.\n` +
      `    Tiga kartu berdampingan bisa terpotong saat dipotret atau digulir, dan angka\n` +
      `    yang terlepas dari labelnya adalah kegagalan paling mahal di modul ini.`
  );
}

// =====================================================================
// 9. SETIAP ASUMSI YANG DIDUKUNG MESIN HARUS PUNYA KOTAK ISIANNYA
//
// Ini aturan yang lahir dari kegagalan sungguhan. Mesin sudah menerima
// `asumsi.variabelPersen` sejak awal dan tesnya lulus — tapi layar tidak pernah
// menyediakan kotaknya. Akibatnya AB Sentul, yang biaya tetapnya sudah
// terdaftar tapi belum punya transaksi, menampilkan "belum bisa dihitung" tanpa
// satu pun jalan keluar. Mesinnya benar; yang tidak ada justru pintunya.
//
// Tes tidak bisa menangkap ini — tes memanggil mesin langsung. Hanya audit yang
// bisa memeriksa bahwa layarnya benar-benar menyediakan jalan masuknya.
// =====================================================================
const ISIAN_WAJIB = [
  { kunci: 'laba', apa: 'Target laba / bulan' },
  { kunci: 'hari', apa: 'Hari operasional' },
  { kunci: 'variabel', apa: 'Variable Cost % perencanaan' },
  { kunci: 'asp', apa: 'ASP perencanaan' }
];

for (const i of ISIAN_WAJIB) {
  if (!new RegExp(`data-kunci="${i.kunci}"`).test(layar)) {
    catat(
      `target.owner.js — tidak ada kotak isian untuk "${i.apa}" (data-kunci="${i.kunci}").\n` +
        `    Mesin menerima asumsi ini, tapi tanpa kotaknya pengguna tidak punya jalan\n` +
        `    mengisinya. Outlet yang belum punya transaksi akan berhenti di "belum bisa\n` +
        `    dihitung" selamanya — dan justru outlet itulah yang paling butuh perencanaan.`
    );
  }
}

// Dan isian itu harus benar-benar SAMPAI ke mesin, bukan sekadar tergambar.
if (!/variabelPersen:/.test(layar)) {
  catat(
    `target.owner.js — kotak Variable Cost % tidak diteruskan sebagai asumsi.variabelPersen.\n` +
      `    Kotak yang tergambar tapi tidak dipakai lebih buruk daripada tidak ada:\n` +
      `    pengguna mengisinya, tidak terjadi apa-apa, dan tidak ada yang menjelaskan kenapa.`
  );
}

// Kotak yang dikosongkan harus jadi null, BUKAN 0.
//
// `Number('')` adalah 0. Variable Cost 0% berarti CM 100% — target yang jauh
// lebih ringan daripada yang sebenarnya, lahir dari kotak yang tidak diisi
// siapa pun. ASP 0 menghasilkan pembagian dengan nol.
//
// Dicari PERSIS pada baris yang menyimpan isian per outlet. Versi pertama
// aturan ini hanya mencari polanya "di mana saja dalam berkas", dan sabotase
// yang merusak justru baris per-outlet tetap lolos — karena baris asumsi umum
// masih memakai pola yang sama beberapa puluh baris di atasnya.
const polaKosongNull = /state\.perOutlet\[[^\]]+\]\[[^\]]+\]\s*=\s*[^;]*===\s*''\s*\?\s*null\s*:/;
if (!polaKosongNull.test(layar)) {
  catat(
    `target.owner.js — isian per outlet tidak lagi mengubah kotak kosong jadi null.\n` +
      `    Number('') adalah 0. Variable Cost 0% berarti CM 100%, yaitu target jauh\n` +
      `    lebih ringan daripada yang sebenarnya — dari kotak yang tidak diisi siapa pun.\n` +
      `    ASP 0 menghasilkan pembagian dengan nol.`
  );
}

// =====================================================================
// 10. "BELUM ADA DATA" TIDAK BOLEH JADI "NOL"
// =====================================================================
const tubuhEkonomi = tubuhFungsi(mesin, 'ekonomiTarget');
// Diperiksa lewat MEKANISMENYA — ada-tidaknya baris `outlet_costs` — bukan lewat
// kata "tersedia", yang tetap ada meski logikanya dimatikan jadi `true`.
if (tubuhEkonomi && !/rincianFixed/.test(tubuhEkonomi)) {
  catat(
    `target.js — ekonomiTarget() tidak lagi membedakan biaya tetap yang BELUM ADA dari yang NOL.\n` +
      `    Outlet tanpa satu pun baris outlet_costs akan menghasilkan BEP Rp 0, yaitu\n` +
      `    "sudah impas sebelum menjual apa pun" — kesimpulan terbaik yang bisa\n` +
      `    dibayangkan, diberikan justru ke outlet yang datanya paling kosong.`
  );
}

// Status harus menyebut YANG MANA yang kurang, bukan sekadar gagal.
for (const s of ['LENGKAPI_VARIABEL', 'LENGKAPI_FIXED', 'BISA']) {
  if (!new RegExp(`\\b${s}\\s*:`).test(mesin)) {
    catat(`target.js — STATUS_HITUNG.${s} tidak ada lagi. Layar memakainya untuk menunjuk kotak yang menahan.`);
  }
}
const tubuhHitung = tubuhFungsi(mesin, 'hitungTarget');
if (tubuhHitung && !/\bstatus\b/.test(tubuhHitung)) {
  catat(`target.js — hitungTarget() tidak lagi mengembalikan status. "Belum bisa dihitung" tanpa menyebut yang mana adalah jalan buntu.`);
}

// =====================================================================
// 8. TARGET TIDAK BOCOR KE LAYAR LAIN
// =====================================================================
for (const nama of ['actual.owner.js', 'proyeksi.owner.js', 'ringkasan.owner.js']) {
  const jalan = path.join(DIR, nama);
  if (!fs.existsSync(jalan)) {
    catat(`${nama} tidak ditemukan — daftar layar di audit ini sudah basi.`);
    continue;
  }
  const src = tanpaKomentar(fs.readFileSync(jalan, 'utf8'));
  const pola = /from\s+'\.\/target\.js'/;
  if (pola.test(src)) {
    catat(
      `${nama}:${barisKe(src, pola)} — mengimpor target.js.\n` +
        `    Angka target di layar Actual atau Proyeksi akan terbaca sebagai omzet yang\n` +
        `    sudah terjadi atau yang diperkirakan. Perbandingan ketiganya hanya boleh\n` +
        `    digambar di layar Target, tempat ketiganya berlabel.`
    );
  }
}

if (masalah.length) {
  console.error('❌ Target berpotensi mengubah data atau menyamar jadi konteks lain:\n');
  for (const p of masalah) console.error(`  ${p}\n`);
  process.exit(1);
}

console.log('Target: lapisan baca, konteksnya utuh, konsolidasinya penjumlahan. ✅');
