#!/usr/bin/env node
/**
 * Audit: tombol dengan aksi ASINKRON yang tidak dikunci selama proses berjalan.
 *
 * Jalankan:  node tools/audit-klik-ganda.cjs
 *
 * KENAPA ADA:
 * Di jaringan lambat — dapur, gudang, HP dengan sinyal satu bar — tombol yang
 * ditekan tidak langsung memberi tanda apa pun. Orang menekannya lagi. Untuk
 * tombol "Kirim", itu berarti DUA transaksi kas, atau dua baris presensi.
 * Kerugiannya bukan tampilan; kerugiannya data yang salah dan sulit ditelusuri.
 *
 * Yang dicari: `addEventListener('click', async ...)` yang di dalamnya ada
 * `await` tapi tidak ada satu pun penguncian tombol
 * (`disabled = true` / `tombolSibuk(` / `sekaliJalan(`).
 *
 * Tombol yang hanya membuka dialog atau memuat ulang tampilan TIDAK berbahaya —
 * karena itu daftar pengecualiannya ditulis dengan alasan, bukan disembunyikan.
 */
const fs = require('fs');
const path = require('path');

const AKAR = path.resolve(__dirname, '..');
const JS = path.join(AKAR, 'js');

// Aksi yang mengubah data. Tombol yang hanya membaca (filter, refresh, buka
// foto) boleh saja ditekan dua kali — hasilnya sama.
const MENGUBAH = /\b(insert|update|delete|upsert|rpc|submit|simpan|kirim|record|create|hapus|save|clockIn|clockOut|transfer|pindah|lanjutkan|tambah)\b/i;
const TERKUNCI = /disabled\s*=\s*true|tombolSibuk\(|sekaliJalan\(/;

function daftarFile(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) daftarFile(p, out);
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

/** Ambil isi handler dengan menghitung kurung kurawal, bukan regex serakah. */
function ambilBadan(isi, mulai) {
  let depth = 0;
  for (let i = mulai; i < isi.length && i < mulai + 4000; i++) {
    if (isi[i] === '{') depth++;
    else if (isi[i] === '}') {
      depth--;
      if (depth === 0) return isi.slice(mulai, i + 1);
    }
  }
  return isi.slice(mulai, mulai + 4000);
}

let masalah = 0;
let diperiksa = 0;

for (const file of daftarFile(JS)) {
  const isi = fs.readFileSync(file, 'utf8');
  const pola = /addEventListener\(\s*'click'\s*,\s*async[^{]*\{/g;
  let m;
  while ((m = pola.exec(isi))) {
    const badan = ambilBadan(isi, m.index + m[0].length - 1);
    if (!badan.includes('await')) continue;
    if (!MENGUBAH.test(badan)) continue; // hanya membaca -> aman ditekan dua kali
    diperiksa++;
    if (TERKUNCI.test(badan)) continue;
    const baris = isi.slice(0, m.index).split('\n').length;
    console.error(`✗ ${path.relative(AKAR, file)}:${baris}`);
    console.error(`  handler klik asinkron yang mengubah data, tanpa mengunci tombolnya.`);
    masalah++;
  }
}

if (masalah) {
  console.error(`\n${masalah} tombol bisa ditekan dua kali saat prosesnya masih berjalan.`);
  process.exit(1);
}
console.log(`${diperiksa} tombol aksi diperiksa. Semuanya terkunci selama proses. ✅`);
