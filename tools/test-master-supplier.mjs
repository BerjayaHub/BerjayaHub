/**
 * TES: master supplier — status, urutan, dan calon kembar.
 *
 *   §1 Status tiap baris, termasuk urutan pemeriksaannya.
 *   §2 Urutan daftar: yang perlu dikerjakan di atas.
 *   §3 Jumlah nota digabung dari ejaan yang berbeda.
 *   §4 Calon kembar — dan yang BUKAN kembar.
 *   §5 Keterangan dropdown.
 *   §6 Kalimat ringkasnya.
 *   §7 Jenis penerima (0159) — internal vs supplier.
 */
import assert from 'node:assert/strict';
import {
  STATUS,
  LABEL_STATUS,
  STATUS_PERLU_DIKERJAKAN,
  statusSupplier,
  susunMasterSupplier,
  ringkasMaster,
  calonKembar,
  hintSupplier,
  opsiSupplier,
  pesanMaster,
  JENIS,
  LABEL_JENIS,
  jenisSupplier
} from '../js/modules/inventory/master-supplier.js';

let n = 0;
const ok = (nama) => {
  n += 1;
  console.log(`  ✔ ${nama}`);
};

console.log('§1 Status');

assert.equal(statusSupplier({ terverifikasi: true, esb_kode: 'SUP-1', aktif: true }), STATUS.SIAP);
assert.equal(statusSupplier({ terverifikasi: true, esb_kode: '', aktif: true }), STATUS.TANPA_KODE);
assert.equal(statusSupplier({ terverifikasi: false, aktif: true }), STATUS.BARU);
ok('tiga keadaan pokoknya dibedakan');

// ============ URUTAN PEMERIKSAANNYA PENTING ============
//
// Supplier yang sudah dinonaktifkan tidak perlu lagi dikabarkan "kode ESB-nya
// kosong" — pekerjaan itu sudah dibatalkan. Menampilkannya sebagai tugas
// membuat daftar pekerjaan berisi hal yang tidak akan pernah dikerjakan.
assert.equal(statusSupplier({ terverifikasi: false, aktif: false }), STATUS.NONAKTIF);
assert.equal(statusSupplier({ terverifikasi: true, esb_kode: '', aktif: false }), STATUS.NONAKTIF);
ok('INTI: nonaktif menang atas "baru" maupun "kode kosong"');

// Kode berisi spasi saja bukan kode.
assert.equal(statusSupplier({ terverifikasi: true, esb_kode: '   ', aktif: true }), STATUS.TANPA_KODE);
ok('kode berisi spasi saja dianggap kosong');

assert.deepEqual(STATUS_PERLU_DIKERJAKAN, [STATUS.BARU, STATUS.TANPA_KODE]);
assert.equal(Object.keys(LABEL_STATUS).length, 4);
ok('setiap status punya labelnya');

console.log('\n§2 Urutan daftar');

const rows = [
  { id: 'a', nama: 'Zeta Pangan', terverifikasi: true, esb_kode: 'S-1', aktif: true },
  { id: 'b', nama: 'Alfa Mart', terverifikasi: false, aktif: true },
  { id: 'c', nama: 'Beta Jaya', terverifikasi: true, esb_kode: '', aktif: true },
  { id: 'd', nama: 'Omega Lama', terverifikasi: true, esb_kode: 'S-9', aktif: false }
];
const daftar = susunMasterSupplier(rows);
assert.deepEqual(daftar.map((b) => b.status), [STATUS.BARU, STATUS.TANPA_KODE, STATUS.SIAP, STATUS.NONAKTIF]);
ok('INTI: yang perlu dikerjakan di atas, yang nonaktif di bawah');

assert.deepEqual(ringkasMaster(daftar), {
  [STATUS.SIAP]: 1,
  [STATUS.TANPA_KODE]: 1,
  [STATUS.BARU]: 1,
  [STATUS.NONAKTIF]: 1,
  total: 4
});
ok('ringkasannya menghitung keempatnya');

assert.deepEqual(susunMasterSupplier(null), []);
assert.deepEqual(susunMasterSupplier([{ nama: '   ' }]), []);
ok('masukan kosong & nama kosong tidak melempar');

console.log('\n§3 Jumlah nota');

// Dua ejaan berbeda menunjuk satu baris master sejak 0158 merapikannya — jadi
// jumlah notanya DIJUMLAHKAN, bukan yang terakhir menang.
const dgnPakai = susunMasterSupplier([{ id: 'x', nama: 'Toko Berkah', terverifikasi: true, esb_kode: 'S-2', aktif: true }], [
  { nama: 'Toko Berkah', jumlah: 3, belum_ekspor: 1 },
  { nama: 'toko  berkah', jumlah: 2, belum_ekspor: 2 }
]);
assert.equal(dgnPakai[0].jumlah, 5);
assert.equal(dgnPakai[0].belumEkspor, 3);
ok('INTI: dua ejaan dijumlahkan, bukan saling menimpa');

assert.equal(susunMasterSupplier([{ id: 'x', nama: 'Baru', aktif: true }])[0].jumlah, 0);
ok('supplier tanpa nota berjumlah 0, bukan undefined');

console.log('\n§4 Calon kembar');

const mirip = calonKembar([
  { id: '1', nama: 'Toko Berkah' },
  { id: '2', nama: 'Toko Berkah Jaya' },
  { id: '3', nama: 'PT Sumber Pangan' }
]);
assert.deepEqual(mirip.get('1'), ['2']);
assert.deepEqual(mirip.get('2'), ['1']);
assert.equal(mirip.has('3'), false);
ok('INTI: nama yang jadi awalan nama lain ditandai kembar');

// ============ YANG BUKAN KEMBAR ============
//
// Pemisahnya harus di BATAS KATA. Tanpa itu "PT Sari" dan "PT Sarinah"
// ditandai kembar — padahal itu dua perusahaan, dan menggabungkannya
// memindahkan nota ke supplier yang salah.
assert.equal(calonKembar([{ id: '1', nama: 'PT Sari' }, { id: '2', nama: 'PT Sarinah' }]).size, 0);
ok('INTI: potongan di tengah kata BUKAN kembar — "PT Sari" vs "PT Sarinah"');

// Nama pendek jadi awalan hampir semua nama. Tanpa batas panjang, seluruh
// daftar saling ditandai kembar dan tandanya berhenti berarti apa-apa.
assert.equal(calonKembar([{ id: '1', nama: 'CV' }, { id: '2', nama: 'CV Mitra' }]).size, 0);
ok('INTI: nama di bawah 4 huruf tidak menandai apa pun');

// Nama yang sama persis bukan "kembar" — indeks unik 0158 membuatnya mustahil,
// dan menandainya akan menyarankan menggabungkan baris dengan dirinya sendiri.
assert.equal(calonKembar([{ id: '1', nama: 'Toko Berkah' }, { id: '2', nama: 'toko berkah' }]).size, 0);
ok('nama identik (sesudah dinormalkan) tidak ditandai kembar');

assert.equal(calonKembar(null).size, 0);
assert.equal(calonKembar([{ nama: 'Tanpa Id' }]).size, 0);
ok('baris tanpa id diabaikan');

console.log('\n§5 Keterangan dropdown');

assert.equal(hintSupplier({ esb_kode: 'SUP-7' }), 'kode ESB SUP-7');
// Baris `esb_master` lama memakai `kode`. Keduanya diterima supaya pemanggil
// yang belum beralih tidak kehilangan keterangannya diam-diam.
assert.equal(hintSupplier({ kode: 'SUP-8' }), 'kode ESB SUP-8');
ok('INTI: `esb_kode` maupun `kode` lama sama-sama terbaca');

assert.match(hintSupplier({ terverifikasi: false }), /baru/i);
assert.equal(hintSupplier({ terverifikasi: true }), '');
ok('yang belum diperiksa ditandai; yang sudah tidak diberi keramaian');

const opsi = opsiSupplier([{ nama: 'Zeta' }, { nama: 'Alfa' }, { nama: '  ' }]);
assert.deepEqual(opsi.map((o) => o.value), ['Alfa', 'Zeta']);
ok('opsinya alfabetis dan nama kosong dibuang');

console.log('\n§6 Kalimat ringkas');

assert.match(pesanMaster(ringkasMaster(daftar)), /1 supplier baru/);
assert.match(pesanMaster(ringkasMaster(daftar)), /kode ESB/i);
ok('pekerjaan yang ADA disebut lebih dulu');

const beres = ringkasMaster(susunMasterSupplier([{ id: 'a', nama: 'A', terverifikasi: true, esb_kode: 'S-1', aktif: true }]));
assert.match(pesanMaster(beres), /semuanya sudah berkode/);
ok('keadaan beres tidak memunculkan pekerjaan karangan');

assert.match(pesanMaster(ringkasMaster([])), /terisi sendiri/);
ok('daftar kosong menjelaskan cara mengisinya');

console.log('\n§7 Jenis penerima (0159)');

// ============ BARIS LAMA TIDAK PUNYA KOLOMNYA ============
//
// Tabel `suppliers` lahir di 0158, `jenis` menyusul di 0159. Baris yang sudah
// ada sebelum itu dibaca tanpa kolom ini — dan "tanpa kolom" harus berarti
// `'supplier'`, bukan `undefined` yang lalu lolos dari setiap perbandingan dan
// menghilangkan barisnya dari KEDUA saringan jenis sekaligus.
assert.equal(jenisSupplier({ nama: 'Toko Lama' }), JENIS.SUPPLIER);
assert.equal(jenisSupplier({ nama: 'X', jenis: null }), JENIS.SUPPLIER);
assert.equal(jenisSupplier({ nama: 'Kas Operasional', jenis: 'internal' }), JENIS.INTERNAL);
// Nilai asing tidak menjadi jenis ketiga yang tak terlihat di layar mana pun.
assert.equal(jenisSupplier({ nama: 'X', jenis: 'entah' }), JENIS.SUPPLIER);
ok('INTI: baris tanpa `jenis` terbaca `supplier`, bukan `undefined`');

assert.equal(LABEL_JENIS[JENIS.SUPPLIER], 'Supplier');
assert.equal(LABEL_JENIS[JENIS.INTERNAL], 'Internal');
ok('kedua jenis punya label — tidak ada kolom kosong di tabel admin');

const campur = susunMasterSupplier([
  { id: 'i1', nama: 'Kas Operasional', jenis: 'internal', terverifikasi: true, aktif: true },
  { id: 's1', nama: 'Toko Berkah', terverifikasi: true, esb_kode: 'S-1', aktif: true }
]);
assert.equal(campur.find((b) => b.id === 'i1').jenis, JENIS.INTERNAL);
assert.equal(campur.find((b) => b.id === 's1').jenis, JENIS.SUPPLIER);
ok('`jenis` dibawa ke baris siap-tampil — tanpa ini kolomnya tidak bisa digambar');

// `jenis` BUKAN status. "Kas Operasional" yang belum berkode ESB tetap
// dilaporkan sebagai pekerjaan: menjadikan internal sebuah status akan
// menghilangkan pekerjaan itu dari daftar tanpa ada yang memutuskan begitu.
const internalTanpaKode = susunMasterSupplier([
  { id: 'i2', nama: 'Kas Operasional', jenis: 'internal', terverifikasi: true, esb_kode: '', aktif: true }
]);
assert.equal(internalTanpaKode[0].status, STATUS.TANPA_KODE);
ok('internal tetap bisa berstatus "kode ESB kosong" — jenis bukan status');

assert.match(hintSupplier({ jenis: 'internal', terverifikasi: true }), /bukan supplier/i);
// Keterangan internal menang atas kode ESB: yang perlu diketahui orang yang
// sedang memilih adalah bahwa ini bukan penjual, bukan nomor kodenya.
assert.match(hintSupplier({ jenis: 'internal', esb_kode: 'S-9' }), /bukan supplier/i);
ok('keterangan internal mengalahkan kode ESB di dropdown');

// ============ INTERNAL TIDAK PERNAH KEMBAR DENGAN SUPPLIER ============
//
// Satu-satunya aksi yang ditawarkan kekembaran adalah "Gabungkan", dan
// menggabungkan penerima internal ke sebuah supplier memindahkan seluruh nota
// lalu MEMBUBARKAN tempat uang hadir staff dibukukan — dengan satu ketukan
// yang terlihat sedang merapikan daftar.
const beda = susunMasterSupplier([
  { id: 'a', nama: 'Kas Operasional', jenis: 'internal', terverifikasi: true, aktif: true },
  { id: 'b', nama: 'Kas Operasional Pusat', terverifikasi: true, aktif: true }
]);
assert.equal(calonKembar(beda).size, 0);
ok('INTI: jenis berbeda tidak ditawari Gabungkan, sedekat apa pun namanya');

// Tapi dua internal yang memang kembar TETAP ditawarkan — kalau tidak, BU yang
// punya "Kas Operasional" dan "Kas Operasional Outlet" tidak punya jalan
// merapikannya sama sekali.
const duaInternal = susunMasterSupplier([
  { id: 'a', nama: 'Kas Operasional', jenis: 'internal', terverifikasi: true, aktif: true },
  { id: 'b', nama: 'Kas Operasional Outlet', jenis: 'internal', terverifikasi: true, aktif: true }
]);
assert.equal(calonKembar(duaInternal).size, 2);
ok('dua internal yang kembar tetap bisa digabungkan');

assert.equal(opsiSupplier([{ nama: 'Kas Operasional', jenis: 'internal' }])[0].jenis, JENIS.INTERNAL);
ok('opsi dropdown membawa `jenis` — pemanggil bisa menyaring tanpa memuat ulang');

console.log(`\n${n} pemeriksaan master supplier lolos. ✅`);
