/**
 * ISIAN OUTLET MENURUT TIPE BU — tes murni.
 *
 *   §1 Tipe mana yang kehilangan isian dapur.
 *   §2 Tipe tak dikenal TETAP melihat isiannya.
 *   §3 Isian yang disembunyikan DILENGKAPI, bukan dibiarkan kosong.
 *
 * ============ YANG SEBENARNYA DIUJI DI SINI ============
 *
 * Bukan "apakah isiannya hilang dari layar" — itu bagian yang kelihatan. Yang
 * diuji: apakah menyembunyikan isian ikut MENGUBAH data yang tersimpan.
 *
 * Outlet bengkel yang pernah dibuka dan ditekan Simpan tidak boleh kehilangan
 * `outlet_role`-nya hanya karena isiannya tidak lagi ditampilkan. Kerusakan
 * seperti itu tidak memunculkan galat apa pun: ia baru terbaca berminggu
 * kemudian, dari modul Pengiriman yang tiba-tiba berperilaku lain.
 */
import { isianOutlet, lengkapiNilaiOutlet } from '../js/modules/organization/aturan-tipe-bu.js';

let gagal = 0;
let n = 0;
const cek = (nama, dapat, harap) => {
  n++;
  if (JSON.stringify(dapat) !== JSON.stringify(harap)) {
    gagal++;
    console.error(`❌ ${nama}\n   dapat : ${JSON.stringify(dapat)}\n   harap : ${JSON.stringify(harap)}`);
  }
};
const benar = (nama, syarat, ket = '') => {
  n++;
  if (!syarat) {
    gagal++;
    console.error(`❌ ${nama}${ket ? ' — ' + ket : ''}`);
  }
};

// ===============================================================
console.log('§1 Tipe mana yang kehilangan isian dapur');
// ===============================================================
benar('§1 workshop: tanpa Peran Outlet', isianOutlet('workshop').peranOutlet === false);
benar('§1 workshop: tanpa Mode Reservasi', isianOutlet('workshop').modeReservasi === false);

// "Bisa melakukan penjualan" TETAP ada di bengkel. Bengkel pun punya outlet
// yang tidak menerima penjualan — gudang, kantor — dan menghilangkannya akan
// membuat semua outlet bengkel otomatis bisa berjualan.
benar('§1 workshop: "bisa berjualan" TETAP ada', isianOutlet('workshop').bolehJual === true);

benar('§1 cafe: semua isian tampil', isianOutlet('cafe').peranOutlet && isianOutlet('cafe').modeReservasi);
benar('§1 retail: semua isian tampil', isianOutlet('retail').peranOutlet);

// 'armada' SENGAJA masih melihat isiannya. Menyembunyikannya adalah perubahan
// perilaku yang tidak diminta, dan BU armada yang sudah berjalan mungkin
// memakai `outlet_role` untuk sesuatu yang tidak saya ketahui.
benar('§1 armada BELUM disembunyikan, dengan sengaja', isianOutlet('armada').peranOutlet === true);

cek('§1 huruf besar tetap dikenali', isianOutlet('WORKSHOP').peranOutlet, false);
cek('§1 spasi pinggir tetap dikenali', isianOutlet(' workshop ').peranOutlet, false);

// ===============================================================
console.log('§2 Tipe tak dikenal TETAP melihat isiannya');
// ===============================================================

// Arahnya dipilih dengan sadar. Tipe baru yang ditambahkan ke BU_TYPE_OPTIONS
// tanpa menyentuh aturan ini akan tetap bisa mengatur outletnya. Arah
// sebaliknya — sembunyikan kecuali terdaftar — membuat setelan yang sudah ada
// tidak bisa diubah dari layar mana pun, dan tidak ada galat yang memberi tahu.
benar('§2 tipe baru yang belum didaftarkan', isianOutlet('franchise').peranOutlet === true);
benar('§2 tipe kosong', isianOutlet('').peranOutlet === true);
benar('§2 null', isianOutlet(null).peranOutlet === true);
benar('§2 undefined', isianOutlet(undefined).peranOutlet === true);

// ===============================================================
console.log('§3 Isian yang disembunyikan DILENGKAPI, bukan dibiarkan kosong');
// ===============================================================

// ============ KERUSAKAN YANG SEDANG DICEGAH ============
//
// Outlet bengkel ini pernah bertipe cafe dan jadi Central Kitchen. Admin
// membuka dialognya — yang sekarang tidak punya isian Peran — lalu menekan
// Simpan hanya untuk mengubah namanya.
//
// Kalau `outlet_role` dibiarkan `undefined`, yang terkirim ke `updateOutlet`
// tidak memuat perannya. Hari ini `JSON.stringify` kebetulan membuang kunci
// bernilai undefined sehingga kolomnya tidak tertulis — tapi itu KEBETULAN.
// Satu `?? null` yang ditambahkan nanti di service-nya mengubahnya jadi
// `outlet_role: null`, dan outletnya berhenti jadi CK tanpa satu pun galat.
const lamaCk = { outlet_role: 'central_kitchen', served_by_outlet_id: null, reservation_mode: 'hotel' };
const hasil = lengkapiNilaiOutlet({ nilai: { name: 'Otonix Depok' }, tipeBu: 'workshop', sebelumnya: lamaCk });
cek('§3 peran lama dipertahankan, bukan dihapus', hasil.outlet_role, 'central_kitchen');
cek('§3 mode reservasi lama dipertahankan', hasil.reservation_mode, 'hotel');
benar('§3 tidak ada nilai undefined yang lolos', Object.values(hasil).every((v) => v !== undefined));
cek('§3 isian yang memang diisi tidak diganggu', hasil.name, 'Otonix Depok');

// Outlet BENGKEL BARU: belum punya nilai lama, jadi dipakai default yang masuk
// akal — bukan null, yang akan melanggar kolom NOT NULL atau terbaca sebagai
// peran yang tidak ada.
const baru = lengkapiNilaiOutlet({ nilai: { name: 'Otonix Bogor' }, tipeBu: 'workshop', sebelumnya: null });
cek('§3 outlet bengkel baru: standalone', baru.outlet_role, 'standalone');
cek('§3 outlet bengkel baru: tanpa CK pelayan', baru.served_by_outlet_id, '');
cek('§3 outlet bengkel baru: mode reservasi default', baru.reservation_mode, 'cafe');

// BU cafe: isiannya ditampilkan, jadi jawaban dialog dipakai apa adanya.
// Melengkapi di sini akan MENIMPA jawaban yang baru saja diketik orangnya.
const cafe = lengkapiNilaiOutlet({
  nilai: { name: 'AB Sentul', outlet_role: 'served_by_ck', served_by_outlet_id: 'ck-1', reservation_mode: 'hotel' },
  tipeBu: 'cafe',
  sebelumnya: { outlet_role: 'standalone', reservation_mode: 'cafe' }
});
cek('§3 cafe: jawaban dialog menang atas nilai lama', cafe.outlet_role, 'served_by_ck');
cek('§3 cafe: CK pelayan tidak dihapus', cafe.served_by_outlet_id, 'ck-1');
cek('§3 cafe: mode reservasi dari dialog', cafe.reservation_mode, 'hotel');

// Tidak melempar saat dipanggil tanpa apa-apa.
cek('§3 tanpa argumen tidak melempar', typeof lengkapiNilaiOutlet(), 'object');

// ---------------------------------------------------------------
console.log(`\n${gagal === 0 ? '✅' : '❌'} test-tipe-bu: ${n - gagal}/${n} lulus`);
process.exit(gagal === 0 ? 0 : 1);
