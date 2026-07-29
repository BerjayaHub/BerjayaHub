#!/usr/bin/env node
/**
 * Audit: seluruh file di js/ harus valid sebagai ES module.
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
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

if (typeof vm.SourceTextModule !== 'function') {
  console.error('Jalankan dengan flag ini:  node --experimental-vm-modules tools/audit-syntax.cjs');
  process.exit(2);
}

const ROOT = path.resolve(__dirname, '..', 'js');

function daftarFile(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) daftarFile(p, out);
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

let masalah = 0;
const files = daftarFile(ROOT);
for (const file of files) {
  const rel = path.relative(path.join(ROOT, '..'), file);
  try {
    new vm.SourceTextModule(fs.readFileSync(file, 'utf8'), { identifier: rel });
  } catch (err) {
    console.error(`✗ ${rel}`);
    console.error(`  ${err.message}`);
    masalah++;
  }
}

if (masalah) {
  console.error(`\n${masalah} file gagal di-parse. Aplikasi TIDAK akan jalan sampai ini beres.`);
  console.error('Petunjuk: cari backtick atau ${ } liar di dalam template literal, termasuk di komentar HTML.');
  process.exit(1);
}
console.log(`${files.length} file di js/ valid sebagai ES module. ✅`);
