#!/usr/bin/env node
/**
 * Audit: UPDATE/DELETE pada tabel BER-SCOPE OUTLET yang tidak memeriksa hasilnya.
 *
 * Jalankan:  node tools/audit-tulis-senyap.cjs
 *
 * KENAPA ADA:
 * PostgREST TIDAK menganggap penolakan RLS sebagai error pada UPDATE dan
 * DELETE. Barisnya sekadar tidak cocok dengan policy, jadi yang kembali adalah
 * **sukses dengan 0 baris**. Aplikasi lalu menampilkan notifikasi hijau untuk
 * perubahan yang tidak pernah terjadi.
 *
 * Ini kegagalan yang paling mahal di aplikasi ini, karena tidak meninggalkan
 * jejak apa pun: admin outlet menyetujui reservasi outlet lain dan tamunya
 * menunggu konfirmasi yang tidak akan datang; geofence "tersimpan" dan seluruh
 * staf outlet gagal clock in; outlet dicabut dari sebuah item aktivitas tapi
 * tetap menempel. Semua terlihat berhasil.
 *
 * OBATNYA selalu sama: `.select('id')` di ujung rantai, lalu periksa
 * `data.length` dan lempar pesan yang menyebut sebabnya.
 *
 * CAKUPANNYA SENGAJA TERBATAS pada tabel di bawah — yang policy-nya bergantung
 * pada outlet/BU, jadi selisih "boleh lihat" vs "boleh atur" benar-benar
 * menggigit. Audit yang mengklaim memeriksa segalanya tapi diam-diam
 * melewatkan sebagian jauh lebih berbahaya daripada audit yang menyebutkan
 * batasnya. Tabel lain (mis. `products`, `leave_requests`) belum ikut;
 * menambahkannya ke daftar ini adalah pekerjaan tersendiri, bukan pekerjaan
 * yang bisa diklaim selesai hanya dengan mengubah satu baris di sini.
 */

const fs = require('fs');
const path = require('path');
const { rantaiFrom } = require('./lib-rantai.cjs');

const AKAR = path.resolve(__dirname, '..');
const JS = path.join(AKAR, 'js');

const TABEL_BER_SCOPE = new Set([
  'outlets',
  'shift_schedules',
  'outlet_shifts',
  'reservations',
  'reservation_settings',
  'reservation_areas',
  'room_types',
  'checklist_items',
  'checklist_sessions',
  'checklist_item_outlets',
  'checklist_session_items',
  'checklist_run_items',
  'assets',
  'cash_entries',
  'cash_accounts'
]);

/** Rantai yang memang tidak perlu diperiksa, beserta alasannya. */
const PENGECUALIAN = [
  {
    file: 'modules/cleaning/cleaning.service.js',
    tabel: 'checklist_runs',
    alasan: 'Pembersihan run yang gagal dibuat (rollback). Kalau delete-nya ikut gagal, error aslinya yang harus sampai ke user — bukan error pembersihannya.'
  }
];

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

for (const file of daftarFile(JS)) {
  const isi = fs.readFileSync(file, 'utf8');
  const rel = path.relative(JS, file).split(path.sep).join('/');

  // Rantainya dipotong di `;` pada kedalaman kurung 0 (lihat lib-rantai.cjs),
  // bukan dengan menebak dari bentuk indentasi — objek literal di dalam
  // `.update({...})` membuat tebakan itu berhenti terlalu cepat.
  for (const m of rantaiFrom(isi)) {
    const tabel = m.tabel;
    if (!TABEL_BER_SCOPE.has(tabel)) continue;
    const badan = m.badan;
    if (!/\.(update|delete|upsert)\(/.test(badan)) continue;
    diperiksa++;
    if (/\.select\(/.test(badan)) continue;
    if (PENGECUALIAN.some((x) => x.file === rel && x.tabel === tabel)) continue;

    const baris = isi.slice(0, m.index).split('\n').length;
    console.error(`✗ js/${rel}:${baris}`);
    console.error(`  update/delete pada '${tabel}' tanpa .select() — penolakan RLS akan terbaca sebagai BERHASIL.`);
    masalah++;
  }
}

if (masalah) {
  console.error(`\n${masalah} penulisan yang bisa gagal diam-diam.`);
  console.error("Tambahkan .select('id') lalu periksa data.length, atau daftarkan di PENGECUALIAN beserta alasannya.");
  process.exit(1);
}
console.log(`${diperiksa} penulisan pada tabel ber-scope outlet diperiksa. Semuanya memastikan barisnya benar-benar kena. ✅`);
