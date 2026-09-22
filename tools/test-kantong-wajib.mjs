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
  BAYAR_PUSAT,
  LABEL_PUSAT,
  NAMA_PUSAT,
  pilihPusat,
  sumberDana,
  namaOutlet,
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

console.log('\n§7 Dibayar Pusat');

// Pusat TIDAK ditawarkan kecuali diminta — form Kas MASUK memakai fungsi yang
// sama, dan uang masuk yang "dibayar pusat" tidak berarti apa-apa.
assert.ok(!opsiKantong([SERPONG]).some((o) => o.value === BAYAR_PUSAT));
const denganPusat = opsiKantong([SERPONG], { pusat: true });
assert.equal(denganPusat.length, 2);
// Di PALING BAWAH: menaruhnya di atas membuatnya terpilih karena kebetulan
// paling dekat, bukan karena memang itu yang terjadi.
assert.equal(denganPusat[denganPusat.length - 1].value, BAYAR_PUSAT);
assert.equal(denganPusat[denganPusat.length - 1].label, LABEL_PUSAT);
ok('INTI: Pusat cuma muncul kalau diminta, dan di paling bawah');

// Sentinel, bukan uuid nol — uuid nol terlihat seperti id sungguhan di log.
assert.equal(BAYAR_PUSAT, '__pusat__');
assert.equal(pilihPusat(BAYAR_PUSAT), true);
assert.equal(pilihPusat('a1'), false);
assert.equal(pilihPusat(''), false);
assert.equal(pilihPusat(null), false);
ok('penandanya sentinel yang tidak bisa tertukar dengan id kantong');

// Penerjemahan ke argumen RPC tinggal di SATU tempat.
assert.deepEqual(sumberDana(BAYAR_PUSAT), { accountId: null, dibayarPusat: true });
assert.deepEqual(sumberDana('a1'), { accountId: 'a1', dibayarPusat: false });
assert.deepEqual(sumberDana(''), { accountId: null, dibayarPusat: false });
assert.deepEqual(sumberDana(null), { accountId: null, dibayarPusat: false });
ok('INTI: Pusat tidak pernah membawa accountId — keduanya ditolak database');

// Pusat sah untuk kas KELUAR, ditolak untuk kas MASUK.
assert.equal(periksaKantong(BAYAR_PUSAT, [SERPONG], 'out'), null);
assert.match(periksaKantong(BAYAR_PUSAT, [SERPONG], 'in') ?? '', /tidak bisa/);
ok('INTI: Pusat hanya sah untuk kas keluar');

// Barisnya TIDAK ditandai merah di tabel: ia sengaja tanpa kantong, dan
// ekspornya tahu itu. Menandainya akan menyuruh orang membereskan yang sudah
// benar.
assert.equal(namaKantong({ dibayar_pusat: true, account_id: null, cash_accounts: null }), NAMA_PUSAT);
assert.equal(tanpaKantong({ dibayar_pusat: true, account_id: null }), false);
assert.equal(tanpaKantong({ dibayar_pusat: false, account_id: null }), true);
assert.equal(NAMA_PUSAT, 'Pusat');
ok('INTI: baris Pusat dinamai "Pusat" dan tidak ditandai perlu dibereskan');

console.log('\n§8 Dua bentuk nama outlet');

// `kantong_pemegang` (0152) mengembalikan `outlet_name` datar; query
// `cash_accounts` mengembalikannya sebagai embed `outlets.name`. Modul ini
// menerima keduanya — kalau tidak, separuh layar menampilkan keterangan
// kosong tanpa satu pun galat.
assert.equal(namaOutlet({ outlet_name: 'AB Gading Serpong' }), 'AB Gading Serpong');
assert.equal(namaOutlet({ outlets: { name: 'Central Kitchen' } }), 'Central Kitchen');
assert.equal(namaOutlet({}), '');
assert.equal(namaOutlet(null), '');
const embed = opsiKantong([{ id: 'x', name: 'Kas CK', outlet_id: 'o9', outlets: { name: 'Central Kitchen' } }]);
assert.equal(embed[0].hint, 'Central Kitchen');
ok('INTI: nama outlet terbaca dari bentuk datar maupun embed');

// OUTLET & PEMEGANG ikut di `label`, bukan di `hint`.
//
// `formDialog` menggambar `type: 'select'` hanya dari `o.label` — `o.hint`
// tidak dipakai sama sekali (js/core/ui.js). Versi pertama menaruh nama
// outletnya di `hint`, dan dropdown-nya cuma menampilkan "Kas Serpong" dan
// "Kas CK": dua kantong milik dua orang di dua outlet, tidak bisa dibedakan.
const milikIis = opsiKantong([
  { id: 'y', name: 'Kas CK', outlet_id: 'o9', outlets: { name: 'Central Kitchen Tangerang' }, user_profiles: { full_name: 'Iis' } }
]);
assert.equal(milikIis[0].label, 'Kas CK — Central Kitchen Tangerang (Iis)');
ok('INTI: outlet & pemegangnya ada di LABEL — `select` membuang `hint`');

// Yang tidak punya keduanya tetap ringkas, bukan "Kas Pribadi —  ()".
assert.equal(opsiKantong([{ id: 'z', name: 'Kas Pribadi' }])[0].label, 'Kas Pribadi');
assert.equal(opsiKantong([SERPONG])[0].label, 'Kas Serpong — AB Gading Serpong');
ok('tanpa outlet/pemegang labelnya tetap bersih');

// Pilihan Pusat menjelaskan dirinya SENDIRI di label — tanpa itu ia terbaca
// seperti nama kantong.
assert.match(LABEL_PUSAT, /tidak mengurangi kas/);
ok('pilihan Pusat menjelaskan dirinya di label, bukan di hint yang dibuang');

console.log(`\n${n} pemeriksaan kantong kas lolos. ✅`);
