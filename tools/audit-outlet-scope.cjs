#!/usr/bin/env node
/**
 * Audit: dropdown outlet yang tidak menghormati scope user.
 *
 * Jalankan:  node tools/audit-outlet-scope.cjs
 *
 * KENAPA ADA:
 * `listAttendanceOutlets()` adalah RPC security-definer yang mengembalikan
 * SELURUH outlet aktif LINTAS BU — sengaja begitu, karena staff boleh absen di
 * outlet BU lain (tugas luar). Tapi begitu hasilnya dipakai untuk mengisi
 * dropdown pilihan outlet di modul lain, staf satu outlet jadi melihat — dan
 * bisa memilih — outlet tetangganya.
 *
 * Bocornya tidak terlihat sebagai error. Datanya tetap dibatasi RLS, jadi yang
 * muncul cuma daftar kosong atau angka nol; user hanya bingung kenapa ada
 * outlet yang tidak bisa dibuka. Yang benar: outlet itu tidak boleh muncul
 * sejak awal. Pakai `listMyOutlets()` dari core/my-outlets.js.
 *
 * PENGECUALIAN di bawah ini semuanya SAH dan disertai alasannya. Kalau menambah
 * pengecualian baru, tulis alasannya — daftar pengecualian tanpa alasan cepat
 * berubah jadi tempat menyembunyikan bug.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', 'js');

const PENGECUALIAN = {
  'modules/attendance/attendance.page.js':
    'Presensi memang lintas BU — staff bisa absen di outlet BU lain (tugas luar/storing).',
  'modules/attendance/attendance.admin.page.js':
    'Dipakai sebagai DIREKTORI NAMA untuk menerjemahkan outlet lintas BU di rekap, bukan untuk mengisi dropdown pilihan.',
  'modules/attendance/nbm-report.admin.page.js':
    'Peta id -> nama outlet saja; daftar barisnya sendiri sudah dibatasi RLS.',
  'modules/leave/leave.page.js':
    'Hanya untuk menampilkan NAMA outlet basis (★) di teks tujuan pengajuan.',
  'modules/profile/staff-data.admin.page.js':
    'Menu Data Staff khusus super admin (SUPER_ADMIN_ONLY_TABS), jadi memang berhak melihat semua outlet.',
  'modules/dispatch/dispatch.page.js':
    'Outlet TUJUAN kiriman harus mencakup Central Kitchen meski bukan scope si pengirim — kalau disaring, alur order stok mati. Outlet pengirim tetap dari listMyOutlets().',
  'core/my-outlets.js': 'Justru di sinilah penyaringannya dikerjakan.'
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
let dikecualikan = 0;

for (const file of daftarFile(ROOT)) {
  const rel = path.relative(ROOT, file).split(path.sep).join('/');
  if (rel === 'modules/attendance/attendance.service.js') continue; // definisinya

  const src = fs.readFileSync(file, 'utf8');
  if (!src.includes('listAttendanceOutlets')) continue;

  diperiksa++;
  if (PENGECUALIAN[rel]) {
    dikecualikan++;
    continue;
  }

  console.error(`✗ js/${rel}`);
  console.error('  memakai listAttendanceOutlets() (SEMUA outlet lintas BU).');
  console.error("  Pakai listMyOutlets() dari core/my-outlets.js, atau daftarkan pengecualian + alasannya di tools/audit-outlet-scope.cjs");
  masalah++;
}

if (masalah) {
  console.error(`\n${masalah} file memakai daftar outlet yang tidak disaring scope.`);
  process.exit(1);
}
console.log(`${diperiksa} file diperiksa · ${dikecualikan} dikecualikan (beralasan).`);
console.log('Semua dropdown outlet menghormati scope user. ✅');
