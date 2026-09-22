/**
 * TES: kapan kantong kas ditanyakan, dan kapan wajib.
 *
 * ============ YANG DIJAGA BERKAS INI ============
 *
 *   §1 Gerbangnya "PUNYA kantong", bukan "jatahnya lebih dari satu".
 *   §2 "Kas Utama" tidak pernah jadi pilihan.
 *   §3 Kantong tanpa outlet TETAP ditawarkan — dengan keterangan.
 *   §4 Kalimatnya berbeda untuk kas masuk & kas keluar.
 *   §5 Nama yang dipakai tabel sama dengan nama di layar lain.
 */
import assert from 'node:assert/strict';
import {
  kantongWajib,
  opsiKantong,
  periksaKantong,
  namaKantong,
  tanpaKantong,
  NAMA_TANPA_KANTONG,
  HINT_TANPA_OUTLET,
  PESAN_WAJIB,
  PESAN_WAJIB_MASUK
} from '../js/modules/cash/kantong-wajib.js';

let n = 0;
const ok = (nama) => {
  n += 1;
  console.log(`  ✔ ${nama}`);
};

const SERPONG = { id: 'a1', name: 'Kas Serpong', outlet_id: 'o1', outlet_name: 'AB Gading Serpong' };
const PRIBADI = { id: 'a2', name: 'Kas Pribadi', outlet_id: null, outlet_name: null };

console.log('§1 Gerbangnya: PUNYA kantong, bukan jatahnya');

// INILAH bugnya. Gerbang lamanya `limit > 1` — jatah, yang menjawab "berapa
// banyak boleh punya", bukan "apakah perlu ditanya". Pemegang berjatah 1
// dengan satu kantong tidak pernah ditanya, dan seluruh entrinya mendarat di
// Kas Utama: tercatat penuh, tapi tanpa kantong.
assert.equal(kantongWajib([SERPONG]), true);
ok('INTI: satu kantong sudah cukup — yang berjatah 1 pun ditanya');

assert.equal(kantongWajib([]), false);
assert.equal(kantongWajib(null), false);
assert.equal(kantongWajib(undefined), false);
ok('yang belum punya kantong sama sekali tidak ditanya');

// Dan tidak ditolak. Menolak formnya hanya membuat pengeluaran jam 9 malam
// tidak tercatat sama sekali — jauh lebih buruk daripada tercatat di Kas
// Utama, yang setidaknya bisa dipindahkan belakangan.
assert.equal(periksaKantong('', []), null);
assert.equal(periksaKantong(null, []), null);
ok('INTI: tanpa kantong, form tetap bisa disimpan — bukan form yang menolak semuanya');

assert.equal(periksaKantong('', [SERPONG]), PESAN_WAJIB);
assert.equal(periksaKantong('   ', [SERPONG]), PESAN_WAJIB);
assert.equal(periksaKantong(null, [SERPONG]), PESAN_WAJIB);
assert.equal(periksaKantong(undefined, [SERPONG]), PESAN_WAJIB);
ok('punya kantong → yang kosong ditolak, termasuk yang cuma spasi');

assert.equal(periksaKantong('a1', [SERPONG]), null);
ok('kantong yang sah lolos');

// Id yang tidak ada di daftarnya ditolak di layar, bukan diteruskan: database
// memang menolaknya juga, tapi pesannya di sana berbicara tentang foreign key.
assert.match(periksaKantong('a9', [SERPONG]) ?? '', /bukan milikmu/);
ok('id kantong asing ditolak dengan kalimat yang bisa ditindaklanjuti');

console.log('\n§2 "Kas Utama" bukan pilihan');

const opsi = opsiKantong([SERPONG, PRIBADI]);
assert.equal(opsi.length, 2);
assert.ok(!opsi.some((o) => o.label === NAMA_TANPA_KANTONG));
assert.ok(!opsi.some((o) => !o.value));
ok('INTI: Kas Utama tidak ditawarkan — ia keadaan yang diperbaiki, bukan jawaban yang sah');

console.log('\n§3 Kantong tanpa outlet tetap ditawarkan');

// Membuangnya akan membuat orang yang SELURUH kantongnya belum ber-outlet
// menghadapi dropdown kosong yang wajib diisi — form yang tidak bisa disimpan.
const hanyaPribadi = opsiKantong([PRIBADI]);
assert.equal(hanyaPribadi.length, 1);
assert.equal(hanyaPribadi[0].hint, HINT_TANPA_OUTLET);
assert.match(HINT_TANPA_OUTLET, /tertahan/);
ok('INTI: kantong tanpa outlet ditawarkan, dan keterangannya menyebut akibatnya');

assert.equal(opsi[0].hint, 'AB Gading Serpong');
ok('kantong ber-outlet menyebut outletnya — dua kantong bernama mirip bisa dibedakan');

console.log('\n§4 Kalimat per arah');

assert.match(PESAN_WAJIB, /keluar dari/);
assert.match(PESAN_WAJIB_MASUK, /masuk ke/);
assert.equal(periksaKantong('', [SERPONG], 'in'), PESAN_WAJIB_MASUK);
assert.equal(periksaKantong('', [SERPONG], 'out'), PESAN_WAJIB);
// Arah yang tidak disebut diperlakukan sebagai kas keluar — bukan melempar.
assert.equal(periksaKantong('', [SERPONG]), PESAN_WAJIB);
ok('kas masuk & kas keluar memakai kalimat yang benar masing-masing');

console.log('\n§5 Nama yang sama di semua layar');

assert.equal(namaKantong({ account_id: 'a1', cash_accounts: { name: 'Kas Serpong' } }), 'Kas Serpong');
assert.equal(namaKantong({ account_id: null, cash_accounts: null }), NAMA_TANPA_KANTONG);
assert.equal(namaKantong({}), NAMA_TANPA_KANTONG);
assert.equal(namaKantong(null), NAMA_TANPA_KANTONG);
// Nama kosong dari embed yang gagal tidak menghasilkan sel kosong.
assert.equal(namaKantong({ cash_accounts: { name: '   ' } }), NAMA_TANPA_KANTONG);
assert.equal(NAMA_TANPA_KANTONG, 'Kas Utama');
ok('INTI: "Kas Utama" — nama yang sama dengan layar Kantong Kas, laporan, dan alasan tertahan di ESB');

assert.equal(tanpaKantong({ account_id: null }), true);
assert.equal(tanpaKantong({ account_id: '' }), true);
assert.equal(tanpaKantong({}), true);
assert.equal(tanpaKantong(null), true);
assert.equal(tanpaKantong({ account_id: 'a1' }), false);
ok('baris tanpa kantong bisa ditandai — itu yang menahan ekspornya');

console.log('\n§6 Masukan aneh');

assert.deepEqual(opsiKantong(null), []);
assert.deepEqual(opsiKantong([{ name: 'tanpa id' }, null, {}]), []);
assert.equal(opsiKantong([{ id: 'x' }])[0].label, '(tanpa nama)');
ok('daftar cacat tidak melempar, dan tidak menghasilkan pilihan tanpa nilai');

console.log(`\n${n} pemeriksaan kantong kas lolos. ✅`);
