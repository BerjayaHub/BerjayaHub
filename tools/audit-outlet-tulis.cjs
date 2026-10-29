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
  'production/production.admin.page.js': { hanyaBaca: true, alasan: 'Laporan produksi — hanya menampilkan, tidak ada tombol yang menulis.' },
  'report/report.admin.page.js': { hanyaBaca: true, alasan: 'Laporan lintas modul — hanya menampilkan & export.' },
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
  'inventory/inventory.admin.page.js': {
    // BUKAN hanyaBaca — dan itu memang disebutkan di alasannya.
    hanyaBaca: false,
    alasan:
      'Daftar outletnya diteruskan ke tab-tab yang menulis (Opname, Bahan Menipis), tapi semua tulisannya berskala BU dan dijaga sayaAdminBu() di layar serta is_bu_admin() di RPC/policy. Lihat pemeriksaan tab di bawah.'
  },
  'profile/staff-data.admin.page.js': { hanyaBaca: true, alasan: 'Tabel data staff + export PDF — hanya menampilkan.' },
  // Dua dropdown outletnya ("Dari outlet" / "Ke outlet") adalah SARINGAN, bukan
  // pilihan tujuan menulis. Satu-satunya tombol yang membuka data lain adalah
  // `bukaDokumen()`, yang hanya membaca surat jalan lalu mencetaknya; tidak ada
  // RPC, update, atau upsert di jalur mana pun dari layar ini.
  //
  // Justru memakai `listOutletsSayaKelola()` di sini MERUGIKAN: admin outlet
  // kehilangan sisi lawan dari kirimannya sendiri — kiriman dari CK tidak bisa
  // disaring, dan rekapnya bolong tanpa satu pun tanda bahwa ada yang hilang.
  'dispatch/dispatch.admin.page.js': {
    hanyaBaca: true,
    alasan:
      'Daftar outletnya hanya untuk saringan "dari/ke" + unduhan rekap. Satu-satunya aksi adalah bukaDokumen() yang membaca & mencetak surat jalan; pengiriman, penerimaan, dan revisinya ada di Staff App.'
  }
};

/** Nama fungsi yang mengembalikan daftar "outlet yang boleh DILIHAT". */
/** Penjaga wewenang yang benar-benar DIPANGGIL (ada tanda kurungnya). */
const PANGGIL_PENJAGA = /\b(listOutletsSayaKelola|sayaAdminBu|amISuperAdmin)\s*\(/;

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

// ---------------------------------------------------------
// ALASAN PENGECUALIAN DIBUKTIKAN, BUKAN DIPERCAYA
//
// Berkas ini sendiri sudah pernah memuat alasan yang basi: "Tab Stok & Riwayat
// hanya menampilkan" tetap tertulis berbulan-bulan sesudah dua tabnya mulai
// MENULIS. Alasan yang tidak benar lebih buruk daripada tidak ada — yang
// membacanya jadi yakin layar itu aman.
//
// Jadi tiap pengecualian yang mengaku "hanya membaca" ditelusuri satu tingkat:
// fungsi yang diimpornya dibuka, dan kalau badannya memuat .rpc()/.insert()/
// .update()/.upsert()/.delete(), klaimnya gugur.
//
// Satu tingkat, bukan rekursif penuh: cukup untuk menangkap "layar baca yang
// diam-diam menumbuhkan tombol simpan", dan tidak menuntut berkas ini jadi
// penelusur modul.
const TULIS_LANGSUNG = /\.(insert|update|upsert|delete)\s*\(/;

// ============ `.rpc()` BUKAN TANDA MENULIS ============
//
// Sebagian besar BACAAN di repo ini juga lewat RPC (`list_attendance_outlets`,
// `list_bu_staff`) karena perlu `security definer` untuk menembus RLS. Jadi
// menganggap setiap `.rpc(` sebagai tulisan menghasilkan tuduhan palsu pada
// layar laporan yang memang hanya membaca — dan tuduhan palsu adalah cara
// tercepat sebuah audit dimatikan orang.
//
// Yang menentukan: isi fungsinya di migration. Kalau badannya memuat
// insert/update/delete, ia menulis.
const DIR_MIGRASI = path.join(AKAR, 'supabase', 'migrations');
const rpcMenulis = new Map();
if (fs.existsSync(DIR_MIGRASI)) {
  for (const f of fs.readdirSync(DIR_MIGRASI).filter((x) => x.endsWith('.sql'))) {
    const sql = fs.readFileSync(path.join(DIR_MIGRASI, f), 'utf8');
    for (const m of sql.matchAll(/create\s+(?:or\s+replace\s+)?function\s+(\w+)\s*\(/gi)) {
      const mulai = m.index;
      const habis = sql.indexOf('$$;', mulai);
      const badan = sql.slice(mulai, habis < 0 ? sql.length : habis);
      const menulis = /\b(insert\s+into|update\s+\w+\s+set|delete\s+from)\b/i.test(badan);
      // Satu fungsi bisa ditulis ulang di beberapa migration. Cukup SATU versi
      // yang menulis untuk membuatnya terhitung menulis — arah yang aman.
      rpcMenulis.set(m[1], (rpcMenulis.get(m[1]) ?? false) || menulis);
    }
  }
}

/** Apakah badan fungsi JS ini melakukan tulisan ke database? */
function badanMenulis(badan) {
  if (TULIS_LANGSUNG.test(badan)) return true;
  for (const r of badan.matchAll(/\.rpc\(\s*['"](\w+)['"]/g)) {
    if (rpcMenulis.get(r[1])) return true;
  }
  // `argumenRpc({...})` dipakai di repo ini bersama `.rpc(nama, …)`; bentuk
  // `.rpc(` dengan nama yang tidak ketemu di migration TIDAK dianggap menulis,
  // supaya audit ini tidak menebak. Kalau suatu saat ada RPC yang tidak ada
  // di migration, `audit-argumen-rpc` yang menangkapnya.
  return false;
}

function periksaKlaimHanyaBaca(rel, file, pengecualian) {
  if (!pengecualian.hanyaBaca) return; // dikecualikan karena dijaga, bukan karena baca
  const isi = fs.readFileSync(file, 'utf8');

  for (const m of isi.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g)) {
    const sumber = m[2];
    if (!sumber.startsWith('.')) continue;
    const abs = path.resolve(path.dirname(file), sumber);
    if (!fs.existsSync(abs)) continue;
    const modul = fs.readFileSync(abs, 'utf8');

    for (const nama of m[1].split(',').map((x) => x.trim().split(/\s+as\s+/)[0]).filter(Boolean)) {
      const def = new RegExp(`export\\s+(?:async\\s+)?function\\s+${nama}\\b`).exec(modul);
      if (!def) continue;
      // Badannya sampai `export` berikutnya — batas yang cukup untuk fungsi
      // tingkat atas, dan tidak menebak lebih jauh dari yang bisa dipastikan.
      const akhir = modul.indexOf('\nexport ', def.index + 1);
      const badan = modul.slice(def.index, akhir < 0 ? modul.length : akhir);
      if (badanMenulis(badan)) {
        console.error(`\u2717 js/modules/${rel}`);
        console.error(`  Dikecualikan sebagai HANYA MEMBACA, tapi mengimpor ${nama}() dari ${sumber} yang MENULIS.`);
        console.error('  Perbarui alasannya, atau pasang penjaga (sayaAdminBu / listOutletsSayaKelola) di layarnya.');
        masalah++;
        return;
      }
    }
  }
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
    periksaKlaimHanyaBaca(rel, file, PENGECUALIAN[rel]);
    continue;
  }
  // ============ DUA PENJAGA, DUA SKALA ============
  //
  // `listOutletsSayaKelola()` untuk wewenang berskala OUTLET; `sayaAdminBu()`
  // untuk yang berskala BU. Sebelumnya hanya yang pertama diakui, jadi setiap
  // layar yang penjaganya berskala BU harus didaftarkan manual sebagai
  // pengecualian — dan daftar pengecualian yang tumbuh karena aturannya
  // kurang satu nama adalah daftar yang lama-lama tidak dibaca lagi.
  // ============ DIPANGGIL, BUKAN SEKADAR DISEBUT ============
  //
  // Mencari namanya saja membuat BARIS IMPORNYA cukup untuk meluluskan layar.
  // Jadi penjaganya bisa dicabut dari kode — `const boleh = true;` — dan audit
  // ini tetap hijau selama `import { sayaAdminBu }` dibiarkan di atas.
  // Sabotase membuktikannya: tiga dari empat lolos sebelum tanda kurung ini
  // ditambahkan.
  if (PANGGIL_PENJAGA.test(isi)) continue;

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
const PENJAGA = PANGGIL_PENJAGA;

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
