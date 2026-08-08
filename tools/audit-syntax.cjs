#!/usr/bin/env node
/**
 * Audit: seluruh file di js/ — DAN <script type="module"> di dalam HTML —
 * harus valid sebagai ES module.
 *
 * Jalankan:  node tools/audit-syntax.cjs
 *
 * KENAPA ADA:
 * Satu SyntaxError di file mana pun membuat SELURUH aplikasi berhenti di
 * "Memuat..." — layar kosong tanpa petunjuk, karena browser membatalkan seluruh
 * graf impor. Gejalanya sama persis untuk semua penyebab, jadi mahal dilacak
 * secara manual.
 *
 * KENAPA BUKAN `node --check`:
 * `node --check file.js` mem-parse sebagai CommonJS, bukan ES module. Untuk file
 * yang memakai import/export ia bisa lolos padahal ada kesalahan nyata — persis
 * yang pernah terjadi di sini: sebuah backtick di dalam komentar HTML memotong
 * template literal, `--check` diam saja, dan Staff App mati total.
 *
 * Jebakan paling sering: BACKTICK atau ${...} yang tidak sengaja tertulis di
 * dalam template literal — termasuk di dalam komentar HTML, yang secara visual
 * terlihat seperti komentar tapi bagi JavaScript tetap bagian dari string.
 *
 * HTML ikut diperiksa karena `reservasi.html` memuat logika sungguhan di dalam
 * <script type="module"> — dan halaman itu justru yang dilihat CALON TAMU. Kalau
 * ia mati, tidak ada satu pun staff yang tahu; yang tahu cuma orang yang sudah
 * pergi ke tempat lain.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

if (typeof vm.SourceTextModule !== 'function') {
  console.error('Jalankan dengan flag ini:  node --experimental-vm-modules tools/audit-syntax.cjs');
  process.exit(2);
}

const AKAR = path.resolve(__dirname, '..');
const ROOT = path.join(AKAR, 'js');

function daftarFile(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) daftarFile(p, out);
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

let masalah = 0;
const periksa = (kode, nama) => {
  try {
    new vm.SourceTextModule(kode, { identifier: nama });
  } catch (err) {
    console.error(`✗ ${nama}`);
    console.error(`  ${err.message}`);
    masalah++;
  }
};

const files = daftarFile(ROOT);
for (const file of files) periksa(fs.readFileSync(file, 'utf8'), path.relative(AKAR, file));

// <script type="module"> di halaman HTML di akar repo.
const html = fs.readdirSync(AKAR).filter((f) => f.endsWith('.html'));
let blok = 0;
for (const f of html) {
  const isi = fs.readFileSync(path.join(AKAR, f), 'utf8');
  for (const m of isi.matchAll(/<script\b[^>]*type=["']module["'][^>]*>([\s\S]*?)<\/script>/g)) {
    // Baris dihitung supaya pesan errornya menunjuk ke tempat yang benar di
    // dalam HTML-nya, bukan ke baris ke-3 sebuah potongan tanpa konteks.
    const barisAwal = isi.slice(0, m.index).split('\n').length;
    periksa(m[1], `${f} (script baris ${barisAwal})`);
    blok++;
  }
}

if (masalah) {
  console.error(`\n${masalah} file gagal di-parse. Aplikasi TIDAK akan jalan sampai ini beres.`);
  console.error('Petunjuk: cari backtick atau ${ } liar di dalam template literal, termasuk di komentar HTML.');
  process.exit(1);
}
console.log(`${files.length} file di js/ + ${blok} blok <script type="module"> di HTML valid sebagai ES module. ✅`);
