/**
 * AUDIT: Staff App tidak boleh meminjam cakupan BU lain.
 *
 * ============ BUG YANG MELAHIRKANNYA ============
 *
 *     const scopesInBu = context.scopes.filter((s) => s.business_unit_id === activeBuId);
 *     const activeScope = scopesInBu.find((s) => s.is_primary) ?? scopesInBu[0] ?? context.scopes[0];
 *                                                                                 ^^^^^^^^^^^^^^^^^^
 *
 * Super admin melihat SELURUH BU di pemilih atas — termasuk BU yang ia tidak
 * punya baris cakupannya. Untuk BU seperti itu `scopesInBu` kosong, dan
 * sesinya jatuh ke cakupan milik **BU YANG LAIN**.
 *
 * Akun bercakupan tunggal "Admin Divisi / Admin" yang membuka "Awal Bermula
 * Cafe" jadi memakai outlet Admin Divisi untuk SELURUH modul:
 *
 *   - Produksi hilang (outlet itu bukan central kitchen);
 *   - "tidak ada kas yang bisa kamu bebani" (kantong dicari di outlet BU lain);
 *   - nota tersimpan di outlet BU lain, lalu tidak muncul di riwayat.
 *
 * Tidak satu pun menghasilkan error. Yang terlihat cuma modul yang hilang dan
 * daftar yang kosong — dan itu terbaca sebagai aplikasi yang rusak.
 */
const fs = require('fs');
const path = require('path');
const { tanpaKomentar } = require('./lib/tanpa-komentar.cjs');

const AKAR = path.dirname(__dirname);
let gagal = 0;
const salah = (pesan) => {
  gagal++;
  console.error(`❌ ${pesan}`);
};

const baca = (rel) => {
  const p = path.join(AKAR, rel);
  if (!fs.existsSync(p)) {
    salah(`${rel} tidak ada — audit ini kehilangan sasarannya.`);
    return null;
  }
  return fs.readFileSync(p, 'utf8');
};

// ---------------------------------------------------------------
// 1. Aturannya ada di modul murni, dan diuji.
// ---------------------------------------------------------------
const inti = baca('js/core/outlet-aktif.js');
if (inti) {
  const kode = tanpaKomentar(inti);
  for (const n of ['cakupanUntukBu', 'outletAktif', 'modulUntukPeran']) {
    if (!new RegExp(`export function ${n}\\(`).test(kode)) {
      salah(`js/core/outlet-aktif.js: \`${n}\` tidak diekspor.`);
    }
  }
  // PENJUALAN ditentukan SETELAN, bukan peran outlet.
  //
  // `outlets.allow_sales` ada sejak 0021 dan `record_sales` (0025) sudah
  // memeriksanya tanpa pernah melihat `outlet_role` — Central Kitchen memang
  // boleh menjual (tumpeng, dsb). Mengunci kartunya ke peran mengabaikan
  // setelan yang sudah disediakan untuk pertanyaan itu.
  if (!/if \(kode === 'sales'\) return bolehJual !== false;/.test(kode)) {
    salah(
      "js/core/outlet-aktif.js: modul `sales` tidak mengikuti `bolehJual`. " +
        'Kemampuannya sudah ada di database sejak 0021/0025; yang menyembunyikan kartunya cuma layar.'
    );
  }
  if (/kode === 'sales'[^\n]*outletRole !== 'central_kitchen'/.test(kode)) {
    salah("js/core/outlet-aktif.js: `sales` masih dikunci ke peran outlet — CK tidak akan pernah bisa mencatat penjualannya.");
  }

  // Cakupan HARUS disaring per BU.
  if (!/s\?\.business_unit_id === buId/.test(kode)) {
    salah(
      'js/core/outlet-aktif.js: cakupan tidak disaring per BU. ' +
        'Itu seluruh isi perbaikan ini — tanpa saringan itu sesi sebuah BU bisa memakai outlet BU lain.'
    );
  }
  // Outlet tersimpan harus diperiksa masih boleh.
  if (!/tersimpan \? ambil\(tersimpan\) : null/.test(kode)) {
    salah(
      'js/core/outlet-aktif.js: pilihan outlet tersimpan dipakai tanpa diperiksa masih boleh diakses. ' +
        'localStorage lalu jadi izin yang hidup lebih lama daripada pemberiannya.'
    );
  }
  // Tidak boleh ada jalan keluar yang mengembalikan outlet sembarangan.
  if (/scopes\[0\]/.test(kode)) {
    salah('js/core/outlet-aktif.js: masih ada jalan yang mengambil cakupan pertama tanpa memeriksa BU-nya.');
  }
}

// ---------------------------------------------------------------
// 2. Staff App memakai modul itu, dan TIDAK punya fallback lamanya.
// ---------------------------------------------------------------
const shell = baca('js/main-staff.js');
if (shell) {
  const kode = tanpaKomentar(shell);

  // Lookahead `.business_unit_id` DIKECUALIKAN, dan itu bukan pelonggaran.
  //
  // `availableBUs[0]?.id ?? context.scopes[0].business_unit_id` memilih BU
  // default ketika tidak ada BU tersimpan — sah, dan tidak ada outlet yang
  // dipinjam di situ. Yang berbahaya adalah mengambil OBJEK cakupannya utuh,
  // karena dari situlah `outlet_id` dan `outlet_role` ikut terbawa.
  //
  // Percobaan pertama aturan ini menuduh baris pemilih BU itu. Audit yang
  // menuduh kode yang benar akan dimatikan orang, dan sesudahnya ia tidak
  // menjaga apa pun.
  if (/\?\?\s*context\.scopes\[0\](?!\s*\.business_unit_id)/.test(kode)) {
    salah(
      'js/main-staff.js: fallback `?? context.scopes[0]` kembali. ' +
        'Untuk BU tanpa cakupan, sesinya akan memakai outlet BU LAIN — dan tidak ada satu pun error yang menandainya.'
    );
  }
  if (!/outletAktif\(/.test(kode) || !/modulUntukPeran\(/.test(kode)) {
    salah(
      'js/main-staff.js: aturan outlet/modul ditulis ulang di layar alih-alih memakai `js/core/outlet-aktif.js`. ' +
        'Dua sumber jawaban untuk pertanyaan yang sama cepat atau lambat menyimpang.'
    );
  }
  // SETELAN JUAL harus benar-benar sampai ke aturannya.
  //
  // `modulUntukPeran` membaca `opsi.bolehJual`; kalau layar tidak pernah
  // mengirimnya, nilainya selalu `undefined` — dan karena `undefined` berarti
  // "boleh", kartunya tampil di MANA-MANA. Centang "Bisa melakukan penjualan"
  // di Admin Portal jadi hiasan, dan tidak ada satu pun error yang menandainya.
  if (!/bolehJual: moduleCtx\.bolehJual/.test(kode)) {
    salah(
      'js/main-staff.js: `bolehJual` tidak diteruskan ke `modulUntukPeran`. ' +
        'Tanpa itu setelan penjualan per outlet diabaikan diam-diam — kartunya tampil di semua outlet.'
    );
  }
  if (!/allow_sales !== false/.test(kode)) {
    salah('js/main-staff.js: `allow_sales` outlet aktif tidak dibaca — `bolehJual` tidak punya sumber.');
  }
  // Outletnya harus bisa DIPILIH — sebelumnya tidak ada pemilih sama sekali.
  if (!/id="outlet-switcher-staff"/.test(kode)) {
    salah(
      'js/main-staff.js: tidak ada pemilih outlet. ' +
        'Orang yang bertugas di dua outlet tidak punya jalan berpindah, dan super admin tanpa cakupan di BU itu ' +
        'tidak punya cara menentukan tempatnya sama sekali.'
    );
  }
  // Diingat PER BU: satu kunci bersama membawa outlet BU sebelumnya ke BU baru.
  if (!/staff_outlet_\$\{activeBuId\}/.test(kode)) {
    salah(
      'js/main-staff.js: pilihan outlet tidak diingat per BU. ' +
        'Satu kunci bersama akan membawa outlet BU sebelumnya ke BU berikutnya — bentuk yang sama dengan bug yang ' +
        'baru saja diperbaiki, cuma lewat localStorage.'
    );
  }
  // Keadaan "belum dipilih" harus DIKATAKAN.
  if (!/Outlet belum dipilih/.test(kode)) {
    salah(
      'js/main-staff.js: keadaan "outlet belum dipilih" tidak dinyatakan di layar. ' +
        'Modul yang butuh outlet akan menyimpan ke tempat yang salah atau tampil kosong, dan keduanya terlihat ' +
        'seperti aplikasi yang rusak.'
    );
  }
}

if (gagal === 0) {
  console.log('Outlet aktif Staff App: disaring per BU, bisa dipilih, diingat per BU, dan keadaan kosongnya dikatakan. ✅');
}
process.exit(gagal === 0 ? 0 : 1);
