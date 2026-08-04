#!/usr/bin/env node
/**
 * Audit: embed PostgREST yang bisa jadi ambigu.
 *
 * Jalankan:  node tools/audit-embed-ambigu.cjs
 *
 * KENAPA ADA:
 * PostgREST menolak embed kalau ada LEBIH DARI SATU foreign key antara dua
 * tabel, dengan pesan:
 *
 *     Could not embed because more than one relationship was found
 *
 * Yang berbahaya: query-nya sudah lama jalan dan tidak disentuh sama sekali.
 * Yang berubah cuma SKEMA — satu kolom foreign key baru ditambahkan ke tabel
 * yang sama, dan seluruh halaman yang memakai embed itu mendadak gagal total.
 *
 * Ini benar-benar terjadi: migration 0062 menambah
 * `attendance_records.nbm_outlet_changed_by -> user_profiles`, sementara
 * `user_id -> user_profiles` sudah ada. Rekap Presensi langsung mati dengan
 * pesan di atas, padahal kodenya tidak diubah satu baris pun.
 *
 * ATURANNYA: embed ke tabel yang sering jadi tujuan banyak foreign key
 * (`user_profiles`, `outlets`) WAJIB menyebutkan kolomnya —
 * `user_profiles!user_id(...)`, bukan `user_profiles(...)`.
 *
 * Menyebut kolomnya juga membuat maksudnya terbaca: `!created_by` vs `!user_id`
 * langsung menjelaskan orang mana yang dimaksud.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', 'js');

// Tabel yang jadi tujuan banyak FK di skema ini.
const RAWAN = ['user_profiles', 'outlets'];

// Tabel yang FK-nya memang cuma satu ke tujuan itu -> embed polos masih aman.
// Kalau nanti ditambahi FK kedua, hapus dari daftar ini dan sebutkan kolomnya.
const PENGECUALIAN = {
  'modules/cleaning/cleaning.service.js':
    'checklist_runs & checklist_sessions hanya punya satu FK ke user_profiles (user_id).',
  'modules/production/production.service.js':
    'production_logs hanya punya satu FK ke user_profiles (created_by).',
  'modules/sales/sales.service.js': 'sales hanya punya satu FK ke user_profiles.',
  'modules/master-user/master-user.service.js':
    'membership_scopes hanya punya satu FK ke user_profiles (user_id).'
};

function daftarFile(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) daftarFile(p, out);
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

let masalah = 0;
let diperiksa = 0;

for (const file of daftarFile(ROOT)) {
  const rel = path.relative(ROOT, file).split(path.sep).join('/');
  const src = fs.readFileSync(file, 'utf8');

  src.split('\n').forEach((ln, i) => {
    for (const tabel of RAWAN) {
      // `tabel(` tanpa `!` di depan kurung = embed tanpa menyebut kolom FK.
      const pola = new RegExp(`(?<![!\\w:])\\b${tabel}\\(`);
      if (!pola.test(ln)) continue;
      if (!/\.select\(|'[^']*\(/.test(ln)) continue; // bukan bagian select
      diperiksa++;
      if (PENGECUALIAN[rel]) return;

      console.error(`✗ js/${rel}:${i + 1}`);
      console.error(`  embed \`${tabel}(...)\` tanpa menyebut kolom FK.`);
      console.error(`  Tulis \`${tabel}!nama_kolom(...)\` — atau daftarkan pengecualian + alasannya.`);
      console.error(`  ${ln.trim().slice(0, 110)}`);
      masalah++;
    }
  });
}

if (masalah) {
  console.error(`\n${masalah} embed berpotensi ambigu.`);
  console.error('Menambah SATU kolom foreign key baru bisa mematikan seluruh halaman yang memakainya.');
  process.exit(1);
}
console.log(`${diperiksa} embed diperiksa. Semua menyebut kolom FK-nya, atau dikecualikan beralasan. ✅`);
