/**
 * TES: aturan Supplier ("Payment To") pada kas keluar.
 *
 * ============ YANG DIJAGA BERKAS INI ============
 *
 *   §1 BU dibaca dari OUTLET, bukan dari kolom yang selalu NULL — inilah yang
 *      membuat kotak suppliernya tidak pernah digambar di dialog admin.
 *   §2 Wajib HANYA kalau daftar induknya ada.
 *   §3 Nilai lama di luar daftar tetap ditawarkan, dan tetap boleh disimpan.
 *   §4 Nama BARU di luar daftar ditolak.
 *   §5 Masukan aneh tidak melempar.
 *   §6 Labelnya "Dibayarkan ke" (0159), dan penerima internal ikut ditawarkan.
 */
import assert from 'node:assert/strict';
import {
  buKasEntri,
  supplierKasWajib,
  opsiSupplierKas,
  periksaSupplierKas,
  PESAN_WAJIB,
  PESAN_DI_LUAR_DAFTAR,
  HINT_DI_LUAR_DAFTAR,
  LABEL_PENERIMA
} from '../js/modules/cash/supplier-kas.js';

let n = 0;
const ok = (nama) => {
  n += 1;
  console.log(`  ✔ ${nama}`);
};

const BU = '11111111-1111-1111-1111-111111111111';
const DAFTAR = [
  { nama: 'AICE', kode: 'CK19' },
  { nama: 'Pasar', kode: 'CK01' },
  { nama: 'Bintang Jaya', kode: '' }
];

console.log('§1 BU dibaca dari outletnya');

// INILAH bugnya. `cash_entries.business_unit_id` DEPRECATED sejak 0040 dan
// selalu NULL pada tiap baris yang dibuat sejak itu. Dialog koreksi admin
// memakainya untuk memuat daftar supplier — daftarnya kosong, kotaknya tidak
// digambar, dan tidak ada satu pun galat di mana pun.
assert.equal(buKasEntri({ business_unit_id: null, outlets: { business_unit_id: BU } }), BU);
ok('INTI: BU diambil dari outlet walau kolom `business_unit_id` NULL');

// Baris LAMA (sebelum 0040) memang punya isinya. Dipakai sebagai cadangan,
// bukan sebagai sumber utama.
assert.equal(buKasEntri({ business_unit_id: BU, outlets: null }), BU);
ok('baris lama yang kolomnya terisi tetap terbaca');

// Outletnya menang: kalau keduanya ada dan berbeda, yang berlaku adalah BU
// tempat entrinya akan diekspor — dan `kas_untuk_esb` menyaring lewat outlet.
assert.equal(buKasEntri({ business_unit_id: 'lama', outlets: { business_unit_id: BU } }), BU);
ok('kalau keduanya ada, outletnya yang menang — itu sumbu yang dipakai ekspornya');

assert.equal(buKasEntri(null), null);
assert.equal(buKasEntri({}), null);
ok('entri kosong menjawab null, tidak melempar');

console.log('\n§2 Wajib hanya kalau daftarnya ada');

assert.equal(supplierKasWajib(DAFTAR), true);
assert.equal(supplierKasWajib([]), false);
assert.equal(supplierKasWajib(null), false);
assert.equal(supplierKasWajib(undefined), false);
ok('daftar kosong / tidak terbaca = kolomnya tidak digambar');

// BU yang belum mengimpor Master Supplier tidak boleh kehilangan SELURUH
// kemampuan mencatat kas keluar. "Sesuai daftar terdaftar" tidak bisa dipenuhi
// kalau belum ada yang terdaftar.
assert.equal(periksaSupplierKas('', []), null);
assert.equal(periksaSupplierKas('Warung Ujung', []), null);
ok('INTI: tanpa daftar induk, apa pun lolos — bukan form yang menolak semuanya');

assert.equal(periksaSupplierKas('', DAFTAR), PESAN_WAJIB);
assert.equal(periksaSupplierKas('   ', DAFTAR), PESAN_WAJIB);
assert.equal(periksaSupplierKas(null, DAFTAR), PESAN_WAJIB);
assert.equal(periksaSupplierKas(undefined, DAFTAR), PESAN_WAJIB);
ok('dengan daftar induk, yang kosong ditolak — termasuk yang cuma spasi');

console.log('\n§3 Nilai lama di luar daftar');

// Ratusan entri terlanjur tersimpan dengan nama yang diketik sendiri. Kalau
// dropdown-nya hanya berisi daftar induk, membuka dialog koreksi untuk
// membetulkan satu huruf di keterangan akan MENGHAPUS nama yang sudah ada —
// bug 0119 dalam bentuknya yang keempat.
const opsiLama = opsiSupplierKas(DAFTAR, 'Warung Ujung');
assert.equal(opsiLama.length, 4);
assert.equal(opsiLama[0].value, 'Warung Ujung', 'nilai lama tidak di paling atas');
assert.equal(opsiLama[0].hint, HINT_DI_LUAR_DAFTAR);
ok('INTI: nilai lama di luar daftar ikut ditawarkan, di paling atas, dan ditandai');

// …dan boleh disimpan apa adanya. Tanpa ini, dialog koreksi entri lama jadi
// form yang tidak bisa disimpan sama sekali: membetulkan nominalnya mustahil
// sampai seseorang menemukan padanan ESB untuk "Warung Ujung".
assert.equal(periksaSupplierKas('Warung Ujung', DAFTAR, { nilaiLama: 'Warung Ujung' }), null);
// Beda spasi bukan perubahan.
assert.equal(periksaSupplierKas('  warung   ujung ', DAFTAR, { nilaiLama: 'Warung Ujung' }), null);
ok('INTI: nilai lama yang tidak disentuh tetap boleh disimpan');

// Ia tidak jadi SAH karenanya — ekspornya tetap menahannya, dan keterangannya
// mengatakan begitu.
assert.match(HINT_DI_LUAR_DAFTAR, /tertahan/);
ok('keterangannya mengatakan ia akan tertahan saat diekspor');

// Yang SUDAH ada di daftar tidak digandakan.
const opsiAda = opsiSupplierKas(DAFTAR, 'aice');
assert.equal(opsiAda.length, 3);
assert.equal(opsiAda.filter((o) => o.value === 'AICE').length, 1);
ok('nilai lama yang sudah ada di daftar tidak digandakan, walau beda huruf besar/kecil');

console.log('\n§4 Nama baru di luar daftar ditolak');

assert.equal(periksaSupplierKas('Warung Ujung', DAFTAR), PESAN_DI_LUAR_DAFTAR);
// Nilai lama yang BERBEDA tidak memaafkan nama baru.
assert.equal(periksaSupplierKas('Warung Ujung', DAFTAR, { nilaiLama: 'Pasar' }), PESAN_DI_LUAR_DAFTAR);
ok('INTI: nama baru di luar daftar ditolak, walau entrinya punya nilai lama');

// Yang ada di daftar lolos, apa pun ejaan spasi & huruf besarnya — aturan
// pembanding yang SAMA dengan yang dipakai ekspornya.
for (const v of ['AICE', 'aice', '  AiCe  ', 'Bintang  Jaya']) {
  assert.equal(periksaSupplierKas(v, DAFTAR), null, `"${v}" ditolak padahal ada di daftar`);
}
ok('yang ada di daftar lolos — pembanding yang sama dengan ekspornya');

console.log('\n§5 Masukan aneh');

assert.deepEqual(opsiSupplierKas(null), []);
assert.deepEqual(opsiSupplierKas(undefined, 'x'), [{ value: 'x', label: 'x', hint: HINT_DI_LUAR_DAFTAR }]);
// Baris tanpa nama dibuang, bukan jadi pilihan kosong yang bisa dipilih.
assert.deepEqual(opsiSupplierKas([{ nama: '' }, { nama: null }, {}]), []);
ok('daftar cacat tidak melempar, dan tidak menghasilkan pilihan kosong');

// Urutannya abjad Indonesia, supaya dua layar menampilkan urutan yang sama.
assert.deepEqual(
  opsiSupplierKas(DAFTAR).map((o) => o.value),
  ['AICE', 'Bintang Jaya', 'Pasar']
);
ok('urutannya abjad — dua layar menampilkan daftar yang sama');

// Kode ESB jadi KETERANGAN, bukan bagian dari nilainya. Keterangan yang ikut
// jadi bagian nilai adalah bug yang sudah pernah terjadi di repo ini.
assert.equal(opsiSupplierKas(DAFTAR)[0].value, 'AICE');
assert.equal(opsiSupplierKas(DAFTAR)[0].hint, 'kode ESB CK19');
assert.equal(opsiSupplierKas(DAFTAR)[1].hint, '');
ok('kode ESB jadi keterangan, tidak menempel ke nilainya');

console.log('\n§6 Dibayarkan ke (0159)');

// ============ LABELNYA YANG SALAH, BUKAN KEWAJIBANNYA ============
//
//   "untuk pembayaran uang hadir staff ... karena ada pewajiban memasukkan
//    supplier di kas keluar"
//
// Kasir yang membayar uang hadir staff membaca "Supplier", tidak menemukan
// yang cocok, dan berhenti. Tidak ada galat — formnya hanya tidak bisa
// diselesaikan, dan uang yang sudah keluar tidak tercatat.
assert.equal(LABEL_PENERIMA, 'Dibayarkan ke');
assert.doesNotMatch(LABEL_PENERIMA, /supplier/i);
ok('INTI: labelnya tidak lagi menyebut "supplier"');

// Pesan penolakannya harus MENYEBUTKAN jalan keluarnya. Kalimat yang cuma
// mengatakan "tidak ada di daftar" meninggalkan kasir di tempat yang sama.
assert.match(PESAN_DI_LUAR_DAFTAR, /internal/i);
assert.match(PESAN_DI_LUAR_DAFTAR, /Kas Operasional/);
assert.doesNotMatch(PESAN_WAJIB, /supplier/i);
ok('pesan penolakannya menyebut penerima internal sebagai jalan keluarnya');

// ============ INTERNAL IKUT DITAWARKAN DI KAS, TANPA SYARAT ============
//
// Saringannya di `listSuppliers` (nota minta `jenis: 'supplier'`), jadi daftar
// yang MASUK ke sini sudah berisi keduanya. Berkas ini tidak boleh menyaring
// lagi — kalau ia menyaring, uang hadir staff kembali tidak punya penerima dan
// keluhan aslinya kembali utuh.
const DENGAN_INTERNAL = [
  { nama: 'AICE', esb_kode: 'CK19' },
  { nama: 'Kas Operasional', jenis: 'internal', esb_kode: 'KAS-1' }
];
assert.deepEqual(
  opsiSupplierKas(DENGAN_INTERNAL).map((o) => o.value),
  ['AICE', 'Kas Operasional']
);
ok('INTI: penerima internal muncul di dropdown kas keluar');

assert.equal(periksaSupplierKas('Kas Operasional', DENGAN_INTERNAL), null);
ok('memilih penerima internal LOLOS pemeriksaan — bukan ditolak sebagai "di luar daftar"');

// Keterangannya membedakannya, supaya kasir tidak mencari alamat atau nomor
// telepon yang tidak akan pernah ada.
assert.match(opsiSupplierKas(DENGAN_INTERNAL)[1].hint, /bukan supplier/i);
ok('keterangannya mengatakan ia bukan penjual');

console.log(`\n${n} pemeriksaan supplier kas lolos. ✅`);
