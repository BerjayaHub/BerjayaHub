/**
 * TES MURNI: aritmetika Laba Rugi Outlet.
 *
 * Yang dijaga bukan "apakah angkanya keluar" — melainkan apakah angka yang
 * MUSTAHIL tetap terlihat mustahil, dan apakah yang belum lengkap mengatakan
 * dirinya belum lengkap.
 *
 *   HPP minus didiamkan            -> terbaca sebagai untung besar
 *   bahan tanpa HPP dianggap nol   -> HPP kecil, laba besar, tak ada yang tanya
 *   food cost dibagi omzet nol     -> Infinity% atau 0%, dua-duanya bohong
 *   CK & supplier dilebur          -> tidak tahu harus memeriksa nota atau order
 */
import assert from 'node:assert/strict';
import {
  barisLabaRugi,
  ringkasLabaRugi,
  persen,
  rekapPerBahan,
  pesanLabaRugi
} from '../js/modules/report/laba-rugi-outlet.js';

let n = 0;
const ok = (nama, fn) => {
  n++;
  try {
    fn();
  } catch (e) {
    console.error(`❌ ${nama}\n   ${e.message}`);
    process.exitCode = 1;
  }
};

const OPN = { tanggal: '2026-09-30' };
const OPN2 = { tanggal: '2026-10-31' };

// ---------------------------------------------------------------
console.log('§1 Rumusnya menutup');
// ---------------------------------------------------------------

const B = barisLabaRugi({
  outlet: 'Dago',
  stokAwal: { nilai: 1_000_000 },
  stokAkhir: { nilai: 1_200_000 },
  masukCk: { nilai: 500_000 },
  masukSupplier: { nilai: 300_000 },
  omzet: 4_000_000,
  biayaNonBahan: 400_000,
  opnameAwal: OPN,
  opnameAkhir: OPN2
});

ok('barang masuk = CK + supplier', () => {
  assert.equal(B.masuk, 800_000);
  assert.equal(B.nilaiCk, 500_000);
  assert.equal(B.nilaiSupplier, 300_000);
});

ok('HPP = awal + masuk − keluar − akhir', () => {
  assert.equal(B.hpp, 600_000, '1.000.000 + 800.000 − 0 − 1.200.000');
});

ok('laba kotor = omzet − HPP', () => assert.equal(B.labaKotor, 3_400_000));
ok('laba bersih = laba kotor − biaya non-bahan', () => assert.equal(B.labaBersih, 3_000_000));

ok('food cost = HPP / omzet', () => {
  assert.equal(B.foodCostPersen, 0.15);
  assert.equal(persen(B.foodCostPersen), '15.0%');
});

// ============ KIRIMAN CK TIDAK BOLEH HILANG ============
//
// Ini bug yang baru diperbaiki di laporan COGS: barangnya menaikkan stok akhir
// tapi tidak pernah masuk sisi barang masuk, jadi HPP tercetak jauh lebih
// kecil dari seharusnya — tanpa galat di mana pun.
ok('tanpa kiriman CK, HPP-nya jauh lebih kecil — dan itu yang salah', () => {
  const tanpaCk = barisLabaRugi({
    stokAwal: { nilai: 1_000_000 },
    stokAkhir: { nilai: 1_200_000 },
    masukCk: { nilai: 0 },
    masukSupplier: { nilai: 300_000 },
    omzet: 4_000_000
  });
  assert.equal(tanpaCk.hpp, 100_000);
  assert.notEqual(tanpaCk.hpp, B.hpp, 'bedanya 500.000 — persis nilai kiriman yang hilang');
});

// ---------------------------------------------------------------
console.log('§1b Kiriman internal tidak boleh terhitung dua kali');
// ---------------------------------------------------------------
//
// ============ PEMERIKSAAN TERPENTING DI BERKAS INI ============
//
// Outlet yang MENGIRIM stoknya berkurang sebesar yang dikirim. Tanpa
// mengurangkannya, barang yang ia KIRIM terhitung sebagai barang yang ia
// PAKAI — dan di tingkat BU kiriman internal terhitung DUA KALI.
//
// Gejalanya di lapangan: food cost Central Kitchen ratusan persen, dan total
// BU yang selalu terlalu besar. Keduanya tercetak rapi tanpa satu pun galat.

const CK = barisLabaRugi({
  outlet: 'Central Kitchen',
  stokAwal: { nilai: 100 },
  stokAkhir: { nilai: 40 },
  keluarKiriman: { nilai: 60 },
  omzet: 0
});
const PENERIMA = barisLabaRugi({
  outlet: 'Outlet',
  stokAwal: { nilai: 0 },
  masukCk: { nilai: 60 },
  stokAkhir: { nilai: 10 },
  omzet: 500
});

ok('CK yang hanya mengirim: HPP nol, bukan sebesar kirimannya', () => {
  assert.equal(CK.hpp, 0, '100 + 0 − 60 − 40');
});

ok('outlet penerima tetap benar', () => assert.equal(PENERIMA.hpp, 50));

ok('TOTAL BU tidak lagi dobel — 50, bukan 110', () => {
  assert.equal(ringkasLabaRugi([CK, PENERIMA]).hpp, 50);
});

// ============ SUSUT PERJALANAN JATUH KE PENGIRIM ============
//
// `keluar` dinilai dari qty DITERIMA, bukan qty dikirim. Kalau memakai qty
// dikirim, barang yang hilang di jalan lenyap dari laporan sama sekali.
ok('kirim 60 diterima 50 -> susut 10 jadi beban PENGIRIM', () => {
  const pengirim = barisLabaRugi({
    stokAwal: { nilai: 100 },
    stokAkhir: { nilai: 40 },
    keluarKiriman: { nilai: 50 },
    omzet: 0
  });
  assert.equal(pengirim.hpp, 10, 'susutnya tidak boleh lenyap');
});

ok('barang masuk bersih = masuk − keluar', () => {
  assert.equal(CK.masukBersih, -60);
  assert.equal(PENERIMA.masukBersih, 60);
});

ok('bahan tanpa HPP pada kiriman keluar ikut dihitung', () => {
  const b = barisLabaRugi({ keluarKiriman: { nilai: 0, tanpaHpp: 2 }, omzet: 1, opnameAwal: OPN, opnameAkhir: OPN2 });
  assert.equal(b.tanpaHpp, 2);
});

ok('total keluar dijumlahkan', () => {
  assert.equal(ringkasLabaRugi([CK, PENERIMA]).keluar, 60);
});

// ---------------------------------------------------------------
console.log('§2 Angka yang mustahil tetap terlihat mustahil');
// ---------------------------------------------------------------

const MINUS = barisLabaRugi({
  stokAwal: { nilai: 100_000 },
  stokAkhir: { nilai: 900_000 },
  masukCk: { nilai: 0 },
  masukSupplier: { nilai: 100_000 },
  omzet: 1_000_000,
  opnameAwal: OPN,
  opnameAkhir: OPN2
});

ok('HPP minus dilaporkan apa adanya, tidak dipotong ke nol', () => {
  assert.equal(MINUS.hpp, -700_000);
});

// Tanpa kalimat ini, HPP minus terbaca sebagai laba kotor yang luar biasa.
ok('dan catatannya menyebut bahwa itu mustahil', () => {
  assert.match(MINUS.catatan, /HPP minus/);
  assert.match(MINUS.catatan, /belum tercatat/);
});

ok('laba kotornya ikut membesar — itulah kenapa catatannya wajib', () => {
  assert.equal(MINUS.labaKotor, 1_700_000);
});

// ---------------------------------------------------------------
console.log('§3 Yang belum lengkap mengatakan dirinya belum lengkap');
// ---------------------------------------------------------------

ok('bahan tanpa HPP dihitung terpisah, bukan didiamkan', () => {
  const b = barisLabaRugi({
    stokAwal: { nilai: 10, tanpaHpp: 2 },
    stokAkhir: { nilai: 10, tanpaHpp: 3 },
    masukCk: { nilai: 0, tanpaHpp: 1 },
    omzet: 100,
    opnameAwal: OPN,
    opnameAkhir: OPN2
  });
  assert.equal(b.tanpaHpp, 6);
  assert.match(b.catatan, /6 bahan tanpa HPP/);
});

ok('baris nota tanpa harga ikut dilaporkan', () => {
  const b = barisLabaRugi({ masukSupplier: { nilai: 0, barisTanpaHarga: 4 }, omzet: 1, opnameAwal: OPN, opnameAkhir: OPN2 });
  assert.match(b.catatan, /4 baris nota belum berharga/);
});

ok('belum pernah opname ditandai', () => {
  assert.match(barisLabaRugi({ omzet: 1 }).catatan, /belum pernah opname/);
});

ok('opname sebelah saja dibedakan', () => {
  assert.match(barisLabaRugi({ omzet: 1, opnameAwal: OPN }).catatan, /opname akhir belum ada/);
  assert.match(barisLabaRugi({ omzet: 1, opnameAkhir: OPN2 }).catatan, /opname awal belum ada/);
});

ok('terkunci hanya kalau KEDUA opname ada', () => {
  assert.equal(barisLabaRugi({ opnameAwal: OPN, opnameAkhir: OPN2 }).terkunci, true);
  assert.equal(barisLabaRugi({ opnameAwal: OPN }).terkunci, false);
});

// ============ PEMBAGIAN NOL ============
ok('omzet nol -> food cost null, bukan 0% atau Infinity', () => {
  const b = barisLabaRugi({ stokAwal: { nilai: 500 }, masukCk: { nilai: 100 }, omzet: 0 });
  assert.equal(b.foodCostPersen, null);
  assert.equal(persen(b.foodCostPersen), '—');
  assert.match(b.catatan, /omzet nol/);
});

ok('persen tidak melempar untuk masukan aneh', () => {
  assert.equal(persen(null), '—');
  assert.equal(persen(undefined), '—');
  assert.equal(persen(''), '—');
  assert.equal(persen('abc'), '—');
});

ok('masukan kosong tidak melempar', () => {
  assert.doesNotThrow(() => barisLabaRugi());
  assert.equal(barisLabaRugi().hpp, 0);
});

// ---------------------------------------------------------------
console.log('§4 Ringkasan BU dijumlahkan dari barisnya');
// ---------------------------------------------------------------

const BARIS = [
  B,
  barisLabaRugi({
    outlet: 'Gading',
    stokAwal: { nilai: 500_000 },
    stokAkhir: { nilai: 400_000 },
    masukCk: { nilai: 200_000 },
    masukSupplier: { nilai: 0 },
    omzet: 900_000,
    biayaNonBahan: 800_000,
    opnameAwal: OPN,
    opnameAkhir: OPN2
  }),
  MINUS
];

const R = ringkasLabaRugi(BARIS);

ok('total omzet & HPP = jumlah barisnya', () => {
  assert.equal(R.omzet, 4_000_000 + 900_000 + 1_000_000);
  assert.equal(R.hpp, 600_000 + 300_000 + -700_000);
});

// Total yang dihitung dari sumber terpisah cepat atau lambat menyimpang dari
// jumlah barisnya — dan laporan yang totalnya tidak sama dengan isinya membuat
// orang berhenti mempercayai keduanya.
ok('laba kotor total = omzet total − HPP total', () => {
  assert.equal(R.labaKotor, R.omzet - R.hpp);
});

ok('laba bersih total konsisten', () => {
  assert.equal(R.labaBersih, R.labaKotor - R.biayaNonBahan);
});

ok('outlet rugi dihitung', () => {
  // Gading: laba kotor 600.000 − biaya 800.000 = −200.000
  assert.equal(R.outletRugi, 1);
});

ok('outlet ber-HPP minus dihitung', () => assert.equal(R.outletHppMinus, 1));

ok('outlet yang belum dikunci dihitung', () => {
  assert.equal(R.outletTotal, 3);
  assert.equal(R.outletTerkunci, 3);
});

ok('ringkasan kosong tidak melempar', () => {
  assert.doesNotThrow(() => ringkasLabaRugi());
  assert.equal(ringkasLabaRugi().outletTotal, 0);
});

// ---------------------------------------------------------------
console.log('§5 Rekap per bahan menggabungkan dua sumber');
// ---------------------------------------------------------------

const REKAP = rekapPerBahan(
  [
    { product_id: 'p1', nama: 'Santan', satuan: 'ml', qty: 10, nilai: 100_000 },
    { product_id: 'p2', nama: 'Beras', satuan: 'kg', qty: 5, nilai: 50_000, adaHpp: false }
  ],
  [
    { product_id: 'p1', nama: 'Santan', satuan: 'ml', qty: 3, nilai: 40_000 },
    { product_id: 'p3', nama: 'Gula', satuan: 'kg', qty: 2, nilai: 30_000 }
  ]
);

// ============ BAHAN YANG DATANG DARI DUA SUMBER ============
//
// Pertanyaannya: ada bahan yang dibeli sendiri padahal CK juga mengirimkannya?
// Dua tabel terpisah tidak bisa menjawabnya.
ok('bahan yang datang dari dua sumber jadi SATU baris', () => {
  const santan = REKAP.find((b) => b.productId === 'p1');
  assert.equal(santan.qtyCk, 10);
  assert.equal(santan.qtySupplier, 3);
  assert.equal(santan.nilaiTotal, 140_000);
});

ok('bahan satu sumber tetap muncul', () => {
  assert.equal(REKAP.find((b) => b.productId === 'p3').nilaiCk, 0);
  assert.equal(REKAP.find((b) => b.productId === 'p2').nilaiSupplier, 0);
});

ok('diurutkan dari nilai terbesar', () => {
  assert.equal(REKAP[0].productId, 'p1', 'Santan 140.000 paling besar');
  assert.ok(REKAP[0].nilaiTotal >= REKAP[1].nilaiTotal);
});

ok('bahan tanpa HPP ditandai di barisnya', () => {
  assert.equal(REKAP.find((b) => b.productId === 'p2').tanpaHpp, 1);
});

ok('nama & satuan diambil dari sumber mana pun yang punya', () => {
  const r = rekapPerBahan([{ product_id: 'x', qty: 1, nilai: 1 }], [{ product_id: 'x', nama: 'Tepung', satuan: 'gr', qty: 1, nilai: 1 }]);
  assert.equal(r[0].nama, 'Tepung');
  assert.equal(r[0].satuan, 'gr');
});

ok('rekapPerBahan tidak melempar untuk masukan kosong', () => {
  assert.doesNotThrow(() => rekapPerBahan());
  assert.deepEqual(rekapPerBahan(), []);
  assert.doesNotThrow(() => rekapPerBahan(null, null));
});

// ---------------------------------------------------------------
console.log('§6 Kalimat ringkas menyebut yang perlu dikerjakan');
// ---------------------------------------------------------------

ok('HPP minus disebut lebih dulu — ia yang paling salah', () => {
  const p = pesanLabaRugi(R);
  assert.match(p, /HPP-nya MINUS/);
  assert.ok(p.indexOf('MINUS') < p.indexOf('rugi'), 'minus harus mendahului "rugi"');
});

ok('semuanya beres -> kalimatnya mengatakan begitu', () => {
  const r = ringkasLabaRugi([
    barisLabaRugi({ omzet: 100, stokAwal: { nilai: 10 }, masukCk: { nilai: 50 }, stokAkhir: { nilai: 20 }, opnameAwal: OPN, opnameAkhir: OPN2 })
  ]);
  assert.match(pesanLabaRugi(r), /semuanya untung/);
});

ok('tanpa outlet -> kalimat yang menjelaskan', () => {
  assert.match(pesanLabaRugi(ringkasLabaRugi([])), /Tidak ada outlet/);
  assert.match(pesanLabaRugi(null), /Tidak ada outlet/);
});

console.log('');
if (process.exitCode) console.error('Ada pemeriksaan yang GAGAL.');
else console.log(`${n} pemeriksaan laba rugi outlet lolos. ✅`);
