#!/usr/bin/env node
/**
 * Audit: daftar "outlet yang boleh DIATUR" hanya boleh dipakai di layar ADMIN.
 *
 * Jalankan:  node tools/audit-daftar-kelola.cjs
 *
 * KENAPA ADA — ini bekas luka, bukan kehati-hatian teoretis:
 *
 * Saat memperbaiki bug "admin outlet tidak bisa mengatur jadwal", satu fungsi
 * di `cleaning.service.js` diganti dari `listMyOutlets()` (boleh dilihat) jadi
 * `listOutletsSayaKelola()` (boleh diatur). Perubahannya benar untuk Admin
 * Portal — dan mematikan modul Daily Activities untuk SELURUH STAFF, karena
 * fungsi itu ternyata dipakai `cleaning.page.js` juga. Staff tidak mengelola
 * outlet mana pun, jadi daftarnya kosong dan yang muncul cuma "Belum ada outlet
 * untukmu di BU ini". Tidak ada error, tidak ada yang merah; modulnya sekadar
 * hilang.
 *
 * Akar masalahnya bukan kecerobohan sesaat: file `*.service.js` memang dipakai
 * BERSAMA oleh Staff App dan Admin Portal. Menaruh konsep "yang boleh diatur"
 * di sana berarti setiap perubahan harus mengingat kedua pemakainya sekaligus —
 * dan ingatan bukan mekanisme yang bisa diandalkan.
 *
 * ATURANNYA: `listOutletsSayaKelola` hanya boleh disebut di
 *   - `js/core/**` (tempat asalnya), dan
 *   - file yang berakhiran `.admin.page.js`.
 *
 * Halaman staff dan file service dilarang menyentuhnya. Kalau sebuah layar
 * admin butuh daftar itu, ia memanggilnya SENDIRI — bukan lewat service yang
 * dipakai bersama.
 */

const fs = require('fs');
const path = require('path');

const AKAR = path.resolve(__dirname, '..');
const JS = path.join(AKAR, 'js');

const NAMA = 'listOutletsSayaKelola';

function daftarFile(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) daftarFile(p, out);
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

/**
 * Buang komentar sebelum mencocokkan.
 *
 * Tanpa ini, MENJELASKAN aturannya di dalam komentar ikut dianggap melanggar —
 * dan satu-satunya cara membuat audit hijau jadi menghapus penjelasan yang
 * justru paling dibutuhkan orang berikutnya. Audit tidak boleh menghukum
 * dokumentasi.
 */
function tanpaKomentar(kode) {
  return kode.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

let masalah = 0;
let dipakaiDi = 0;

for (const file of daftarFile(JS)) {
  const rel = path.relative(JS, file).split(path.sep).join('/');
  const isi = tanpaKomentar(fs.readFileSync(file, 'utf8'));
  if (!new RegExp(`\\b${NAMA}\\b`).test(isi)) continue;
  dipakaiDi++;

  if (rel.startsWith('core/')) continue;
  if (rel.endsWith('.admin.page.js')) continue;

  console.error(`✗ js/${rel}`);
  console.error(`  Menyebut ${NAMA}() di luar layar admin.`);
  if (rel.endsWith('.service.js')) {
    console.error('  File service dipakai BERSAMA oleh Staff App dan Admin Portal — daftar "boleh diatur"');
    console.error('  di sini akan mengosongkan daftarnya untuk staff, dan modulnya mati tanpa satu pun error.');
    console.error('  Panggil dari file *.admin.page.js-nya langsung.');
  } else {
    console.error('  Halaman staff tidak boleh bergantung pada wewenang admin.');
  }
  masalah++;
}

if (masalah) {
  console.error(`\n${masalah} pemakaian di tempat yang salah.`);
  process.exit(1);
}
console.log(`${NAMA}() dipakai di ${dipakaiDi} file, semuanya core atau layar admin. ✅`);
