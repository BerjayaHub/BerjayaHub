#!/usr/bin/env node
/**
 * Audit: layar ADMIN yang mengisi dropdown outletnya dari `listMyOutlets()`.
 *
 * Jalankan:  node tools/audit-outlet-tulis.cjs
 *
 * KENAPA ADA:
 * `listMyOutlets()` menjawab "outlet mana yang boleh KULIHAT". Aturannya
 * membuka seluruh outlet BU untuk siapa pun yang punya scope tanpa `outlet_id`.
 * Yang menentukan boleh tidaknya MENULIS adalah `is_admin_of_outlet()` di
 * database, yang untuk `outlet_admin` mensyaratkan outletnya disebut persis.
 *
 * Selisih itu sampai ke user sebagai *"new row violates row-level security
 * policy"* setelah dia menekan sesuatu — pesan yang tidak bisa ditindaklanjuti
 * siapa pun, dan yang terdengar seperti "aplikasinya rusak" padahal izinnya
 * bekerja persis seperti seharusnya.
 *
 * ATURANNYA: file `*.admin.page.js` yang mengambil daftar outlet dari sumber
 * "boleh dilihat" mana pun harus juga memakai `listOutletsSayaKelola` — atau
 * terdaftar di PENGECUALIAN di bawah beserta alasannya.
 *
 * Sumbernya tidak cuma `listMyOutlets`. Yang pertama lolos dari audit ini
 * justru `cleaning.admin`, karena ia memanggil `listBuOutlets()` — nama lain
 * untuk hal yang sama, satu lapis di dalam service-nya. Aturan yang hanya
 * mengenali satu nama akan selalu kalah oleh nama kedua.
 *
 * Pengecualiannya ditulis satu per satu dengan sengaja. Daftar yang harus
 * ditambahi manual memaksa orang berhenti sejenak dan menjawab "layar ini
 * menulis atau tidak?" — pertanyaan yang tepat, dan yang dulu tidak pernah
 * ditanyakan.
 */

const fs = require('fs');
const path = require('path');

const AKAR = path.resolve(__dirname, '..');
const MODUL = path.join(AKAR, 'js', 'modules');

/**
 * Layar yang boleh tetap memakai `listMyOutlets()` — HANYA MEMBACA.
 *
 * Untuk layar baca, memakai daftar "yang boleh diatur" justru MERUGIKAN: admin
 * outlet kehilangan angka yang memang berhak dia baca, dan laporannya bolong
 * tanpa ada tanda apa pun bahwa ada yang disembunyikan.
 */
const PENGECUALIAN = {
  'production/production.admin.page.js': 'Laporan produksi — hanya menampilkan, tidak ada tombol yang menulis.',
  'sales/sales.admin.page.js': 'Laporan penjualan — hanya menampilkan.',
  'report/report.admin.page.js': 'Laporan lintas modul — hanya menampilkan & export.',
  'inventory/inventory.admin.page.js':
    'Tab Stok & Riwayat hanya menampilkan. Satu-satunya tombol yang menulis (izin opname staff) berskala BU dan sudah dibatasi super admin.',
  'attendance/nbm-report.admin.page.js': 'Daftar outletnya cuma dipakai untuk memetakan id -> nama di tabel laporan.',
  'profile/staff-data.admin.page.js': 'Tabel data staff + export PDF — hanya menampilkan.',
  'attendance/attendance.admin.page.js':
    'Menulis ke tabel `outlets`, yang policy update-nya mensyaratkan admin BU — bukan admin outlet. Jadi listOutletsSayaKelola pun daftar yang salah di sini; tombolnya digambar berdasarkan sayaAdminBu().',
  'attendance/nbm-settings.admin.page.js': 'Sama seperti attendance.admin: kebijakan libur outlet hanya boleh diubah admin BU, dan tombolnya sudah dijaga sayaAdminBu().'
};

/**
 * Nama fungsi yang mengembalikan daftar "outlet yang boleh DILIHAT".
 *
 * `listBuOutlets` (cleaning.service.js) sengaja TIDAK ada di sini: isinya sudah
 * diganti jadi `listOutletsSayaKelola`. Namanya memang menyesatkan, tapi
 * mendaftarkannya di sini akan membuat audit menuduh kode yang justru sudah
 * benar.
 */
const SUMBER_LIHAT = ['listMyOutlets', 'listAttendanceOutlets', 'listOutletsWithGeofence'];

function daftarFile(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) daftarFile(p, out);
    else if (e.name.endsWith('.admin.page.js')) out.push(p);
  }
  return out;
}

let masalah = 0;
let diperiksa = 0;
let dikecualikan = 0;

for (const file of daftarFile(MODUL)) {
  const rel = path.relative(MODUL, file).split(path.sep).join('/');
  const isi = fs.readFileSync(file, 'utf8');
  const dipakai = SUMBER_LIHAT.filter((n) => new RegExp(`\\b${n}\\b`).test(isi));
  if (!dipakai.length) continue;
  diperiksa++;

  if (PENGECUALIAN[rel]) {
    dikecualikan++;
    continue;
  }
  if (/\blistOutletsSayaKelola\b/.test(isi)) continue;

  console.error(`✗ js/modules/${rel}`);
  console.error(`  Memakai ${dipakai.join(', ')}() (daftar "boleh dilihat") di layar admin, tanpa listOutletsSayaKelola().`);
  console.error('  Kalau layar ini MENULIS: pakai listOutletsSayaKelola() untuk dropdown/tombolnya.');
  console.error('  Kalau hanya MEMBACA: daftarkan di PENGECUALIAN pada tools/audit-outlet-tulis.cjs beserta alasannya.');
  masalah++;
}

if (masalah) {
  console.error(`\n${masalah} layar admin memakai daftar outlet yang salah.`);
  process.exit(1);
}
console.log(
  `${diperiksa} layar admin menyentuh daftar outlet — ${dikecualikan} dikecualikan beralasan (hanya-baca atau dijaga sayaAdminBu), sisanya sudah memisahkan "boleh lihat" dari "boleh atur". ✅`
);
