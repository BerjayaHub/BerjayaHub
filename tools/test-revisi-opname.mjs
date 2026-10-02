/**
 * TES: siapa boleh merevisi opname, dan berapa stok yang akan bergerak.
 *
 * ============ KENAPA ARITMETIKANYA DIUJI TERSENDIRI ============
 *
 * Angka yang ditulis ke buku stok adalah SELISIH, bukan hitungannya. Selisih
 * yang tandanya terbalik tidak melempar apa pun: ia menggeser stok dua kali
 * besar kesalahannya ke arah yang salah, dan layarnya tetap berbunyi "berhasil".
 *
 *   §1 Siapa boleh merevisi.
 *   §2 `closed_at` yang kosong tidak boleh membuka pintu.
 *   §3 Delta ubah — `system_qty` TIDAK ikut (jebakan ganda-hitung).
 *   §4 Delta tambah & buang.
 *   §5 Baris yang dibuang tidak ikut dihitung.
 *   §6 Label "semula".
 */
import assert from 'node:assert/strict';
import {
  bolehRevisiOpname,
  deltaRevisi,
  deltaTambah,
  deltaHapus,
  teksDelta,
  adaRevisi,
  qtyAsli,
  labelDihitung,
  itemTerpakai,
  ringkasRevisi,
  TOLAK_BUKAN_ADMIN,
  TOLAK_MASIH_BERJALAN,
  TOLAK_DIBATALKAN,
  TOLAK_ADA_YANG_LEBIH_BARU,
  TOLAK_ADA_SESI_TERBUKA
} from '../js/modules/inventory/revisi-opname.js';

let n = 0;
const ok = (nama) => {
  n += 1;
  console.log(`  ✔ ${nama}`);
};

const SEP = { id: 's1', outlet_id: 'o1', status: 'closed', closed_at: '2026-09-30T14:00:00Z' };
const OKT = { id: 's2', outlet_id: 'o1', status: 'closed', closed_at: '2026-10-02T14:00:00Z' };
const CK = { id: 's3', outlet_id: 'o2', status: 'closed', closed_at: '2026-10-05T14:00:00Z' };
const BERJALAN = { id: 's4', outlet_id: 'o1', status: 'open', closed_at: null };
const BATAL = { id: 's5', outlet_id: 'o1', status: 'cancelled', closed_at: '2026-10-06T14:00:00Z' };

console.log('§1 Siapa boleh merevisi');

assert.deepEqual(bolehRevisiOpname(SEP, [SEP], { adminBu: true }), { boleh: true, alasan: '' });
ok('satu-satunya sesi tertutup boleh direvisi');

assert.equal(bolehRevisiOpname(SEP, [SEP], { adminBu: false }).alasan, TOLAK_BUKAN_ADMIN);
ok('bukan Admin BU ditolak');

assert.equal(bolehRevisiOpname(BERJALAN, [BERJALAN], { adminBu: true }).alasan, TOLAK_MASIH_BERJALAN);
ok('sesi yang masih berjalan diarahkan ke Staff App');

assert.equal(bolehRevisiOpname(BATAL, [BATAL], { adminBu: true }).alasan, TOLAK_DIBATALKAN);
ok('sesi dibatalkan tidak pernah menyentuh stok, jadi tidak ada yang direvisi');

// INTI: sesi lampau yang sudah ketiban opname berikutnya.
assert.equal(bolehRevisiOpname(SEP, [SEP, OKT], { adminBu: true }).alasan, TOLAK_ADA_YANG_LEBIH_BARU);
assert.equal(bolehRevisiOpname(OKT, [SEP, OKT], { adminBu: true }).boleh, true);
ok('INTI: yang boleh direvisi hanya sesi tertutup TERAKHIR di outlet itu');

// Sesi berjalan di outlet yang sama menghalangi — potret stoknya akan basi.
assert.equal(bolehRevisiOpname(SEP, [SEP, BERJALAN], { adminBu: true }).alasan, TOLAK_ADA_SESI_TERBUKA);
ok('INTI: sesi berjalan di outlet itu menghalangi revisi sesi sebelumnya');

// Outlet LAIN tidak ikut menghalangi, walau tanggalnya lebih baru.
assert.equal(bolehRevisiOpname(SEP, [SEP, CK], { adminBu: true }).boleh, true);
assert.equal(bolehRevisiOpname(SEP, [SEP, { ...BERJALAN, outlet_id: 'o2' }], { adminBu: true }).boleh, true);
ok('INTI: sesi di outlet lain tidak menghalangi — penyaringnya outlet, bukan BU');

console.log('\n§2 closed_at yang kosong');

const tanpaTanggal = { id: 's9', outlet_id: 'o1', status: 'closed', closed_at: null };

// Satu sisi kosong masih tertangkap perbandingan biasa — apa pun lebih besar
// dari string kosong.
assert.equal(bolehRevisiOpname(tanpaTanggal, [tanpaTanggal, OKT], { adminBu: true }).alasan, TOLAK_ADA_YANG_LEBIH_BARU);
ok('closed_at kosong vs sesi bertanggal: yang bertanggal dianggap lebih baru');

// ============ DUA-DUANYA KOSONG — DI SINI PENJAGANYA BEKERJA ============
//
// `'' > ''` adalah false, jadi tanpa klausa `!ini ||` sesi ini akan dianggap
// "tidak ada yang lebih baru" dan revisinya ditawarkan — padahal ada sesi
// tertutup LAIN di outlet yang sama dan tidak ada satu pun cara menentukan
// mana yang terakhir. Yang benar adalah menolak, bukan menebak.
//
// Keadaan ini bukan teoretis: ia tepat yang terjadi kalau `closed_at` lupa
// diminta dari PostgREST — seluruh daftar jadi kosong tanggalnya sekaligus.
const kembarTanpaTanggal = { id: 's10', outlet_id: 'o1', status: 'closed', closed_at: null };
assert.equal(
  bolehRevisiOpname(tanpaTanggal, [tanpaTanggal, kembarTanpaTanggal], { adminBu: true }).alasan,
  TOLAK_ADA_YANG_LEBIH_BARU
);
ok('INTI: dua sesi tertutup tanpa tanggal — ditolak, bukan ditebak');

console.log('\n§3 Delta ubah');

// 46.000 diketik, seharusnya 4.600.
assert.equal(deltaRevisi({ lama: 46000, baru: 4600 }), -41400);
ok('INTI: delta = baru − lama, dan tandanya negatif saat angkanya diperkecil');

assert.equal(deltaRevisi({ lama: 4600, baru: 4650 }), 50);
ok('revisi berikutnya dihitung dari angka revisi, bukan angka asli');

// ============ `system_qty` TIDAK IKUT ============
//
// Kalau ia ikut, deltanya dihitung terhadap stok yang SUDAH memuat hasil
// opname — dan koreksinya diterapkan dua kali (bentuk bug nanas di 0114).
assert.equal(deltaRevisi({ lama: 46000, baru: 4600, system_qty: 6400, sistem: 6400 }), -41400);
ok('INTI: `sistem` yang diselipkan ke argumennya tidak mengubah apa pun');

assert.equal(deltaRevisi({ lama: '46000', baru: '4600' }), -41400);
assert.equal(deltaRevisi({}), 0);
assert.equal(deltaRevisi({ lama: null, baru: '-' }), 0);
ok('masukan aneh tidak melempar dan tidak menghasilkan NaN');

console.log('\n§4 Delta tambah & buang');

assert.equal(deltaTambah({ counted: 38, sistem: 40 }), -2);
ok('tambah bahan terlewat: delta = dihitung − stok saat sesi ditutup');

// INTI: kembali ke angka SEBELUM opname, bukan ke nol. Opname tidak pernah
// mengklaim nol untuk bahan yang tidak dihitung.
assert.equal(deltaHapus({ system_qty: 40, counted_qty: 38 }), 2);
assert.equal(deltaHapus({ system_qty: 100, counted_qty: 100 }), 0);
ok('INTI: buang = sistem − dihitung, jadi stoknya pulih ke angka sebelum opname');

// Dan ia kebalikan persis dari apa yang dulu ditulis penutupan.
for (const [sis, hit] of [
  [6400, 4600],
  [0, 50],
  [40, 0],
  [12.5, 11.75]
]) {
  assert.equal(deltaHapus({ system_qty: sis, counted_qty: hit }) + (hit - sis), 0, `tidak saling membalik untuk ${sis}/${hit}`);
}
ok('INTI: delta buang selalu kebalikan penyesuaian yang dulu ditulis penutupan');

console.log('\n§5 Baris dibuang tidak ikut dihitung');

const items = [
  { product_id: 'a', counted_qty: 4600, revisi: [{ qty_lama: 46000, qty_baru: 4600 }] },
  { product_id: 'b', counted_qty: 100, revisi: [] },
  // DIREVISI lalu DIBUANG. Bentuk ini wajib ada di fixture-nya: tanpa entri
  // `revisi` di baris yang dibuang, sabotase "ringkasan ikut menghitung baris
  // dibuang sebagai direvisi" tidak mengubah satu pun angka, dan tesnya hijau
  // untuk kode yang sudah salah.
  { product_id: 'c', counted_qty: 7, revisi: [{ qty_lama: 9, qty_baru: 7 }], dibuang_at: '2026-10-02T10:00:00Z' },
  { product_id: 'd', counted_qty: 38, revisi: [{ qty_lama: null, qty_baru: 38 }] }
];

assert.deepEqual(itemTerpakai(items).map((i) => i.product_id), ['a', 'b', 'd']);
ok('INTI: baris yang dibuang disaring keluar — ia tidak boleh ikut Nilai Opname');

assert.deepEqual(ringkasRevisi(items), { jumlahDirevisi: 2, jumlahDibuang: 1 });
ok('jumlah direvisi & dibuang dihitung dari daftar LENGKAP');

// Yang dibuang TIDAK ikut dihitung sebagai "direvisi": dua angka yang
// menjawab pertanyaan berbeda tidak boleh saling menambah.
assert.equal(ringkasRevisi([items[2]]).jumlahDirevisi, 0);
ok('baris dibuang tidak dihitung dua kali');

assert.deepEqual(itemTerpakai(), []);
assert.deepEqual(ringkasRevisi(), { jumlahDirevisi: 0, jumlahDibuang: 0 });
ok('daftar kosong & undefined tidak melempar');

console.log('\n§6 Label "semula"');

assert.equal(labelDihitung(items[0]), '4600 (semula 46000)');
ok('INTI: angka hasil revisi selalu membawa angka aslinya');

assert.equal(labelDihitung(items[1]), '100');
ok('baris yang tidak pernah direvisi tetap bersih');

assert.equal(labelDihitung(items[3]), '38 (ditambahkan admin)');
ok('baris yang ditambahkan admin dibedakan dari baris yang direvisi');

// Jejak revisi BERANTAI: yang ditampilkan adalah angka PALING AWAL, bukan
// angka sebelum revisi terakhir — yang dicari orang adalah "staff mengetik
// apa", bukan "apa yang saya ubah barusan".
assert.equal(
  labelDihitung({ counted_qty: 4650, revisi: [{ qty_lama: 46000 }, { qty_lama: 4600 }] }),
  '4650 (semula 46000)'
);
ok('INTI: sesudah dua kali revisi, yang disebut tetap angka asli staff');

// Nol yang sungguhan harus tetap terbaca sebagai nol, bukan hilang.
assert.equal(qtyAsli({ revisi: [{ qty_lama: 0 }] }), 0);
assert.equal(labelDihitung({ counted_qty: 5, revisi: [{ qty_lama: 0 }] }), '5 (semula 0)');
ok('INTI: angka asli NOL tidak tertukar dengan "tidak ada angka asli"');

assert.equal(adaRevisi({ revisi: [] }), false);
assert.equal(adaRevisi({}), false);
assert.equal(adaRevisi({ revisi: 'bukan array' }), false);
ok('jejak yang hilang atau bentuknya salah tidak dianggap revisi');

console.log('\n§7 Tanda delta');

assert.equal(teksDelta(50), '+50');
assert.equal(teksDelta(-41400), '−41400');
assert.equal(teksDelta(0), '0');
assert.equal(teksDelta(-1.5), '−1,5');
ok('tanda + ditulis eksplisit, dan minusnya minus tipografis');

console.log(`\n${n} pemeriksaan revisi opname lolos. ✅`);
