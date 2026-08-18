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
  // CATATAN INI PERNAH BASI DAN MENYESATKAN.
  //
  // Bunyinya dulu: "Tab Stok & Riwayat hanya menampilkan." Itu benar saat
  // ditulis, lalu halaman ini bertambah jadi lima tab — dan dua di antaranya
  // MENULIS (Opname membuka/menutup sesi; Bahan Menipis mengubah hari aman &
  // batas manual). Alasan pengecualian yang sudah tidak benar lebih buruk
  // daripada tidak ada: yang membacanya akan yakin halaman ini tidak menulis.
  //
  // Dikecualikan bukan karena tidak menulis, melainkan karena tulisannya
  // berskala BU dan dijaga `sayaAdminBu()` di layar + `is_bu_admin()` di
  // database — jadi `listOutletsSayaKelola` (yang berskala outlet) memang
  // bukan daftar yang tepat di sini.
  'inventory/inventory.admin.page.js':
    'Daftar outletnya diteruskan ke tab-tab yang menulis (Opname, Bahan Menipis), tapi semua tulisannya berskala BU dan dijaga sayaAdminBu() di layar serta is_bu_admin() di RPC/policy. Lihat pemeriksaan tab di bawah.',
  'attendance/nbm-report.admin.page.js': 'Daftar outletnya cuma dipakai untuk memetakan id -> nama di tabel laporan.',
  'profile/staff-data.admin.page.js': 'Tabel data staff + export PDF — hanya menampilkan.',
  'attendance/attendance.admin.page.js':
    'Menulis ke tabel `outlets`, yang policy update-nya mensyaratkan admin BU — bukan admin outlet. Jadi listOutletsSayaKelola pun daftar yang salah di sini; tombolnya digambar berdasarkan sayaAdminBu().',
  'attendance/nbm-settings.admin.page.js': 'Sama seperti attendance.admin: kebijakan libur outlet hanya boleh diubah admin BU, dan tombolnya sudah dijaga sayaAdminBu().'
};

/** Nama fungsi yang mengembalikan daftar "outlet yang boleh DILIHAT". */
const SUMBER_LIHAT = ['listMyOutlets', 'listBuOutlets', 'listAttendanceOutlets', 'listOutletsWithGeofence'];

function daftarFile(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) daftarFile(p, out);
    // `.admin.js` IKUT DIPERIKSA, bukan hanya `.admin.page.js`.
    //
    // Versi pertama hanya memindai `.admin.page.js`, dan itu titik buta yang
    // sudah terlanjur terpakai: tab-tab Inventory yang baru (nota.admin.js,
    // opname.admin.js, menipis.admin.js) semuanya layar admin yang MENULIS,
    // semuanya menerima daftar outlet dari halaman induknya — dan tidak satu
    // pun pernah diperiksa audit ini, hanya karena namanya berbeda satu kata.
    //
    // Auditnya lulus dengan tenang selama tiga layar dibangun di atasnya.
    else if (e.name.endsWith('.admin.page.js') || e.name.endsWith('.admin.js')) out.push(p);
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

// ---------------------------------------------------------
// PEMERIKSAAN KEDUA: tab admin yang MENERIMA daftar outlet dan MENULIS.
//
// Pemeriksaan pertama hanya melihat siapa yang MEMANGGIL listMyOutlets().
// Tab-tab Inventory tidak memanggilnya — mereka menerima `outlets` dari
// halaman induknya, lalu menulis. Seluruh kelas itu lolos tanpa terlihat.
//
// Aturannya di sini: kalau sebuah layar admin menerima daftar outlet DAN
// menulis ke database, ia wajib menyebut penjaganya sendiri — `sayaAdminBu()`
// (kalau wewenangnya berskala BU) atau `listOutletsSayaKelola()` (kalau
// berskala outlet). Menyandarkan diri sepenuhnya pada penjaga di database
// menghasilkan tombol yang bisa ditekan lalu ditolak diam-diam, dan penolakan
// RLS tidak dianggap error oleh PostgREST.
// ---------------------------------------------------------
// Mendeteksi "menulis" lewat `.rpc(`/`.upsert(` DI BERKASNYA TIDAK BEKERJA —
// tab-tab ini menulis lewat fungsi service yang diimpor, jadi tidak satu pun
// pola itu muncul di sini. Percobaan pertama memakai cara itu dan melaporkan
// "0 tab diperiksa" dengan tenang.
//
// Jadi arahnya dibalik: SETIAP tab admin yang menerima daftar outlet wajib
// menjawab pertanyaannya — entah dengan menyebut penjaganya, atau dengan
// terdaftar sebagai hanya-baca beserta alasannya. Tidak ada jalan diam.
const PENJAGA = /\b(sayaAdminBu|listOutletsSayaKelola|amISuperAdmin)\b/;

/** Tab admin yang menerima daftar outlet tapi HANYA MEMBACA. */
const TAB_HANYA_BACA = {
  'inventory/nota.admin.js': 'Riwayat nota + rincian + unduh xlsx. Tidak ada tombol yang mengubah data; penyimpanan & koreksi nota ada di Staff App.'
};

let tabDiperiksa = 0;

for (const file of daftarFile(MODUL)) {
  const rel = path.relative(MODUL, file).split(path.sep).join('/');
  if (!rel.endsWith('.admin.js')) continue; // halaman induk sudah diperiksa di atas
  const isi = fs.readFileSync(file, 'utf8');

  // Hanya yang MENERIMA outlets, bukan yang mengambilnya sendiri.
  if (!/\boutlets\b\s*[,}]/.test(isi)) continue;
  if (SUMBER_LIHAT.some((n) => new RegExp(`\\b${n}\\b`).test(isi))) continue;

  tabDiperiksa++;
  if (TAB_HANYA_BACA[rel]) continue;
  if (PENJAGA.test(isi)) continue;

  console.error(`✗ js/modules/${rel}`);
  console.error('  Tab admin ini menerima daftar outlet tapi tidak menyebut penjaga wewenang apa pun.');
  console.error('  Kalau MENULIS: pakai sayaAdminBu() (skala BU) atau listOutletsSayaKelola() (skala outlet).');
  console.error('  Kalau hanya MEMBACA: daftarkan di TAB_HANYA_BACA pada tools/audit-outlet-tulis.cjs beserta alasannya.');
  masalah++;
}

if (masalah) {
  console.error(`\n${masalah} layar admin memakai daftar outlet yang salah.`);
  process.exit(1);
}
console.log(
  `${diperiksa} layar admin menyentuh daftar outlet — ${dikecualikan} dikecualikan beralasan (hanya-baca atau dijaga sayaAdminBu), sisanya sudah memisahkan "boleh lihat" dari "boleh atur". ${tabDiperiksa} tab admin yang menerima daftar outlet & menulis semuanya menyebut penjaganya. ✅`
);
