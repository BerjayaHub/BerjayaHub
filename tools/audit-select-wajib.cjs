#!/usr/bin/env node
/**
 * Audit: field <select> `required` yang nilai DEFAULT-nya string kosong.
 *
 * KENAPA ADA:
 * formDialog menganggap nilai kosong sebagai "belum diisi". Kalau sebuah opsi
 * yang SAH kebetulan bernilai '' (mis. "Kas Utama", "Semua outlet"), memilihnya
 * tetap ditolak dengan pesan "wajib diisi" — padahal di layar pilihannya sudah
 * benar terpilih. Bugnya sulit dilihat karena formnya kelihatan terisi.
 *
 * Aman: opsi '' dipakai sebagai placeholder "-- pilih --" yang memang harus
 * ditolak. Yang ditandai di sini adalah field required yang `value`-nya sendiri
 * kosong ATAU opsi pertamanya bernilai '' dan dipakai sebagai jawaban.
 *
 * Jalankan:  node tools/audit-select-wajib.cjs
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', 'js');

function daftarFile(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) daftarFile(p, out);
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

// Objek field satu baris: { name: 'x', ..., type: 'select', required: true, ... }
const BARIS = /\{[^{}]*type:\s*'select'[^{}]*\}/g;

let masalah = 0;
for (const file of daftarFile(ROOT)) {
  const isi = fs.readFileSync(file, 'utf8');
  isi.split('\n').forEach((ln, i) => {
    for (const m of ln.match(BARIS) ?? []) {
      if (!/required:\s*true/.test(m)) continue;
      // value: '' -> default kosong padahal wajib.
      if (/value:\s*''/.test(m) || /value:\s*""/.test(m)) {
        console.error(`✗ ${path.relative(path.join(ROOT, '..'), file)}:${i + 1}`);
        console.error(`  select required tapi default-nya kosong: ${m.trim().slice(0, 100)}`);
        masalah++;
      }
    }
  });
}

if (masalah) {
  console.error(`\n${masalah} select wajib yang default-nya kosong — akan selalu ditolak "wajib diisi".`);
  process.exit(1);
}
console.log('Tidak ada <select> wajib yang default-nya kosong. ✅');
