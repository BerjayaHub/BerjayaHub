/**
 * TES: ekspor waste/spoil ke template ESB Item Journal.
 *
 * ============ YANG DIJAGA BERKAS INI ============
 *
 *   §1 Bentuk templatenya — 8 kolom, urutannya, dan header di BARIS KE-3.
 *   §2 Satu berkas satu outlet. Ini penjaga ketiga; dua yang pertama ada di
 *      layar. Kalau yang ini lepas, berkas gabungan DITERIMA ESB dengan tenang
 *      dan stok outlet lain berkurang di sana tanpa pernah berkurang di sini.
 *   §3 Mode selalu Deduct.
 *   §4 `Value per Unit` yang tidak diketahui MENAHAN barisnya, bukan dikirim 0.
 *   §5 Yang belum dipetakan (item/unit/purpose) menahan SELURUH waste-nya.
 *   §6 Product Code datang dari daftar induk ESB lewat nama hasil pemetaan.
 *   §7 Penomoran `No` tidak bocor saat sebuah waste ditahan.
 *   §8 Ringkasannya jujur.
 *   §9 Masukan aneh tidak melempar.
 *   §10 `pasangFormatTanggal` menghormati baris header yang bukan baris 1.
 */
import assert from 'node:assert/strict';
import {
  KOLOM_JOURNAL,
  BARIS_HEADER_JOURNAL,
  MODE_KURANG,
  barisEsbJournal,
  ringkasJournal
} from '../js/modules/inventory/esb-journal.js';
import { pasangFormatTanggal, FORMAT_TANGGAL_EXCEL } from '../js/modules/inventory/tanggal-excel.js';
import { buatPeta, JENIS_PETA } from '../js/modules/inventory/esb-purchase.js';

let n = 0;
const ok = (nama) => {
  n += 1;
  console.log(`  ✔ ${nama}`);
};

// Indeks kolom DITURUNKAN dari daftarnya, bukan ditulis sebagai angka: kolom
// yang dipindah tidak boleh membuat tes ini memeriksa sel yang salah sambil
// tetap hijau.
const K = Object.fromEntries(KOLOM_JOURNAL.map((k, i) => [k, i]));

const OUTLET = 'out-1';
const PETA = buatPeta([
  { jenis: 'item', kunci: 'Beras', nilai: 'BERAS PREMIUM' },
  { jenis: 'item', kunci: 'Telur Ayam', nilai: 'TELUR AYAM NEGERI' },
  { jenis: 'unit', kunci: 'gr', nilai: 'GRAM' },
  { jenis: 'unit', kunci: 'pcs', nilai: 'PCS' }
]);
const KODE = new Map([
  ['BERAS PREMIUM', 'P001'],
  ['TELUR AYAM NEGERI', 'P002']
]);
const BIAYA = new Map([
  ['p-beras', 12.5],
  ['p-telur', 2000]
]);

const waste = (id, purpose = 'Waste Kitchen', outlet = OUTLET) => ({
  id,
  code: `WS-${id}`,
  outlet_id: outlet,
  jenis: 'spoil',
  // Sudah berupa nama ESB kanonik saat sampai ke sini — `purpose_esb_sah()` di
  // database (0147) yang menjaganya, bukan modul ini.
  purpose,
  created_at: '2026-09-10T03:00:00Z'
});
const item = (product_id, product_name, base_unit, qty) => ({ product_id, product_name, base_unit, qty });

const susun = (daftar, isi, extra = {}) =>
  barisEsbJournal({
    waste: daftar,
    itemsPerWaste: new Map(isi),
    peta: PETA,
    kodeItem: KODE,
    biaya: BIAYA,
    ...extra
  });

console.log('§1 Bentuk templatenya');

assert.deepEqual(KOLOM_JOURNAL, [
  'No',
  'Product Name',
  'Product Code',
  'Unit',
  'Mode',
  'Qty',
  'Value per Unit',
  'Purpose'
]);
ok('8 kolom, nama & urutannya persis seperti templatenya');

// Berkas Item Journal menaruh header di baris ke-3. Menyamakannya dengan dua
// template lain membuat ESB membaca baris judul sebagai nama kolom, dan SELURUH
// berkas ditolak.
assert.equal(BARIS_HEADER_JOURNAL, 2);
ok('header di indeks 2 — baris ke-3 di Excel, bukan baris pertama');

console.log('\n§2 Satu berkas, satu outlet');

assert.throws(
  () => susun([waste('a'), waste('b', 'Waste Kitchen', 'out-2')], [['a', [item('p-beras', 'Beras', 'gr', 100)]]]),
  /satu outlet/i,
  'waste dua outlet DITERIMA — berkas gabungan akan masuk seluruhnya ke satu outlet di ESB'
);
ok('INTI: waste dari dua outlet ditolak mentah-mentah, bukan digabung diam-diam');

// Outlet kosong/null tidak boleh dihitung sebagai "outlet kedua" — kalau iya,
// satu baris berdata kurang akan membatalkan ekspor yang sah.
assert.doesNotThrow(() =>
  susun([waste('a'), { ...waste('b'), outlet_id: null }], [
    ['a', [item('p-beras', 'Beras', 'gr', 100)]],
    ['b', [item('p-beras', 'Beras', 'gr', 50)]]
  ])
);
ok('outlet kosong tidak dihitung sebagai outlet kedua');

console.log('\n§3 Mode selalu Deduct');

const satu = susun([waste('a')], [['a', [item('p-beras', 'Beras', 'gr', 100)]]]);
assert.equal(satu.baris.length, 1);
assert.equal(satu.baris[0][K['Mode']], 'Deduct');
assert.equal(MODE_KURANG, 'Deduct');
ok('waste mengurangi stok — Mode "Deduct", disebut satu kali di satu tempat');

assert.equal(satu.baris[0][K['Product Name']], 'BERAS PREMIUM');
assert.equal(satu.baris[0][K['Unit']], 'GRAM');
assert.equal(satu.baris[0][K['Qty']], 100);
assert.equal(satu.baris[0][K['Purpose']], 'Waste Kitchen');
assert.equal(satu.baris[0][K['No']], 1);
ok('nama, satuan, qty, purpose, dan nomornya terisi');

// Purpose dibaca APA ADANYA dari kejadiannya — tidak dipetakan, tidak
// diturunkan dari `jenis` maupun dari kategori produk. Dua waste bahan yang
// sama persis bisa berbeda Purpose, dan memang begitu: satu terbuang di dapur,
// satu di bar.
const bar = susun([waste('b2', 'Waste Bar')], [['b2', [item('p-telur', 'Telur Ayam', 'pcs', 3)]]]);
assert.equal(bar.baris[0][K['Purpose']], 'Waste Bar');
ok('INTI: Purpose datang dari kejadiannya, bukan dari jenis atau kategori');

console.log('\n§4 Value per Unit yang tidak diketahui MENAHAN barisnya');

// Ini inti keputusan yang diambil bersama pemiliknya. Mengirim 0 berarti
// "bahannya gratis" — pernyataan yang BERBEDA dari "belum tahu", dan ESB
// menerimanya tanpa keluhan. Nilai kerugiannya jadi lebih kecil dari yang
// sebenarnya, dan angkanya terlihat wajar.
const tanpaBiaya = susun([waste('a')], [['a', [item('p-entah', 'Beras', 'gr', 100)]]]);
assert.equal(tanpaBiaya.baris.length, 0);
assert.equal(tanpaBiaya.wasteIds.length, 0);
ok('INTI: bahan tanpa harga beli menahan waste-nya, tidak berangkat sebagai 0');

const sebab = tanpaBiaya.kurang.find((k) => k.jenis === 'nilai-bahan');
assert.ok(sebab, 'alasannya tidak terbaca di mana pun');
assert.equal(sebab.nilai, 'Beras');
assert.deepEqual(sebab.dok, ['WS-a']);
ok('alasannya menyebut bahan mana dan waste mana');

assert.equal(satu.baris[0][K['Value per Unit']], 12.5);
ok('yang punya harga berangkat dengan harganya, apa adanya');

// Nol yang MEMANG tercatat sebagai nol bukan "tidak tahu" — ia lewat.
const nol = barisEsbJournal({
  waste: [waste('a')],
  itemsPerWaste: new Map([['a', [item('p-gratis', 'Beras', 'gr', 100)]]]),
  peta: PETA,
  kodeItem: KODE,
  biaya: new Map([['p-gratis', 0]])
});
assert.equal(nol.baris.length, 1);
assert.equal(nol.baris[0][K['Value per Unit']], 0);
ok('harga yang memang tercatat nol tetap lewat — yang ditahan adalah yang TIDAK ADA');

console.log('\n§5 Yang belum dipetakan menahan seluruh waste-nya');

const campur = susun([waste('a')], [
  ['a', [item('p-beras', 'Beras', 'gr', 100), item('p-telur', 'Kubis', 'pcs', 2)]]
]);
// Satu baris bermasalah menahan SELURUH waste-nya. Jurnal separuh jadi di ESB
// memotong sebagian stok, dan sisanya harus dikoreksi manual.
assert.equal(campur.baris.length, 0);
assert.deepEqual(campur.wasteIds, []);
assert.ok(campur.kurang.some((k) => k.jenis === 'item' && k.nilai === 'Kubis'));
ok('satu bahan belum dipetakan -> seluruh waste tertahan, bukan separuh berangkat');

const unitKurang = susun([waste('a')], [['a', [item('p-beras', 'Beras', 'ltr', 1)]]]);
assert.equal(unitKurang.baris.length, 0);
assert.ok(unitKurang.kurang.some((k) => k.jenis === 'unit' && k.nilai === 'ltr'));
ok('satuan belum dipetakan juga menahan');

// Purpose KOSONG menahan waste-nya. Menebaknya berarti mengirim biaya waste ke
// akun COGS yang salah — angkanya tetap terlihat wajar, dan laporan yang
// memakainya tidak punya satu pun petunjuk.
// `undefined` dibuat dengan MENGHAPUS kuncinya, bukan dengan melewatkan
// `undefined` ke pembantu di atas — nilai bawaan parameternya akan mengisinya
// kembali jadi 'Waste Kitchen', dan pemeriksaannya lolos tanpa menguji apa pun.
const tanpaKunci = waste('a');
delete tanpaKunci.purpose;
for (const [ket, w] of [
  ['null', waste('a', null)],
  ['string kosong', waste('a', '')],
  ['spasi saja', waste('a', '   ')],
  ['kuncinya tidak ada', tanpaKunci]
]) {
  const tanpaPurpose = susun([w], [['a', [item('p-beras', 'Beras', 'gr', 100)]]]);
  assert.equal(tanpaPurpose.baris.length, 0, `purpose ${ket} lolos`);
  assert.deepEqual(tanpaPurpose.wasteIds, []);
}
ok('INTI: Purpose kosong menahan waste-nya — null, string kosong, spasi, dan kunci yang tidak ada');

const sebabPurpose = susun([waste('a', null), waste('b', null)], [
  ['a', [item('p-beras', 'Beras', 'gr', 100)]],
  ['b', [item('p-beras', 'Beras', 'gr', 50)]]
]).kurang.filter((k) => k.jenis === 'purpose-kosong');
// SATU baris untuk semuanya, dengan daftar kodenya — bukan satu baris per
// waste. Tiga puluh baris yang mengulang satu pesan akan menenggelamkan alasan
// penahan yang lain di tabel yang sama.
assert.equal(sebabPurpose.length, 1);
assert.deepEqual(sebabPurpose[0].dok, ['WS-a', 'WS-b']);
ok('seluruh waste tanpa Purpose berkumpul jadi satu baris, kodenya terdaftar');

// 'purpose' TIDAK boleh ada di JENIS_PETA. Kalau ia kembali ke sana, layar
// pemetaan menumbuhkan kelompok "Purpose" kosong yang tidak bisa dikerjakan
// siapa pun — dan yang membukanya menyangka ada pekerjaan yang belum selesai.
assert.ok(!JENIS_PETA.includes('purpose'), 'purpose kembali jadi jenis pemetaan');
assert.equal(PETA.purpose, undefined);
ok('Purpose bukan jenis pemetaan lagi — tidak ada kelompok kosong di layar pemetaan');

console.log('\n§6 Product Code dari daftar induk ESB');

assert.equal(satu.baris[0][K['Product Code']], 'P001');
ok('kode diambil lewat nama HASIL PEMETAAN, bukan kode lokal Berjaya Hub');

const tanpaKode = barisEsbJournal({
  waste: [waste('a')],
  itemsPerWaste: new Map([['a', [item('p-beras', 'Beras', 'gr', 100)]]]),
  peta: PETA,
  kodeItem: new Map(),
  biaya: BIAYA
});
// Kode yang tidak ada dikosongkan, BUKAN menahan barisnya: templatenya tetap
// terbaca ESB lewat Product Name, dan menahan seluruh waste karena kolom
// pelengkap akan menghentikan ekspor yang sebenarnya sah.
assert.equal(tanpaKode.baris.length, 1);
assert.equal(tanpaKode.baris[0][K['Product Code']], '');
ok('kode yang tidak ada dikosongkan, tidak dikarang dan tidak menahan');

console.log('\n§7 Penomoran tidak bocor');

const dua = susun(
  [waste('a'), waste('b'), waste('c')],
  [
    ['a', [item('p-beras', 'Beras', 'gr', 10), item('p-telur', 'Telur Ayam', 'pcs', 2)]],
    // 'b' tertahan: bahannya belum dipetakan.
    ['b', [item('p-beras', 'Kubis', 'gr', 5)]],
    ['c', [item('p-telur', 'Telur Ayam', 'pcs', 1)]]
  ]
);
assert.deepEqual(dua.wasteIds, ['a', 'c']);
// Kalau nomornya tidak dikembalikan saat sebuah waste ditahan, berkasnya
// berangkat dengan No 1,2,4 — lompatan yang tidak salah bagi ESB, tapi membuat
// siapa pun yang mencocokkannya mengira ada baris yang hilang.
assert.deepEqual(dua.baris.map((b) => b[K['No']]), [1, 2, 3]);
ok('INTI: waste yang tertahan tidak meninggalkan lubang di penomoran');

console.log('\n§8 Ringkasan yang jujur');

const r = ringkasJournal(dua, 3);
assert.equal(r.siap, 2);
assert.equal(r.tertahan, 1);
assert.equal(r.baris, 3);
assert.ok(r.kurang >= 1);
ok('siap, tertahan, jumlah baris, dan jumlah alasan dihitung apa adanya');

assert.equal(ringkasJournal(dua, 1).tertahan, 0);
ok('tertahan tidak pernah negatif');

console.log('\n§9 Masukan aneh');

assert.deepEqual(susun(null, []).baris, []);
assert.deepEqual(susun([], []).baris, []);
ok('masukan kosong tidak melempar');

// Waste tanpa rincian bahan tidak mengurangi apa pun di ESB; mengekspor
// kepalanya saja menghasilkan jurnal kosong yang harus dihapus manual.
const kosong = susun([waste('a')], []);
assert.deepEqual(kosong.wasteIds, []);
assert.deepEqual(kosong.baris, []);
ok('waste tanpa rincian bahan tidak ikut sama sekali');

const qtyNol = susun([waste('a')], [['a', [item('p-beras', 'Beras', 'gr', 0)]]]);
assert.deepEqual(qtyNol.baris, []);
ok('baris ber-qty nol disaring — Number("") yang bernilai 0 tidak lolos jadi baris');

console.log('\n§10 Format tanggal menghormati baris headernya');

// Item Journal tidak punya kolom Date, jadi di jalur ini fungsinya memang tidak
// bekerja. Yang diuji di sini adalah OFFSET-nya: begitu suatu hari ada template
// berbaris-judul yang punya kolom tanggal, formatnya harus menempel di baris
// yang benar — bukan meleset ke atas tanpa satu pun galat.
assert.equal(pasangFormatTanggal({}, KOLOM_JOURNAL, 3, (c, r2) => `${c}-${r2}`), 0);
ok('template tanpa kolom Date tidak diapa-apakan');

const ws = { '0-3': { t: 'n', v: 1 }, '0-4': { t: 'n', v: 2 }, '0-1': { t: 'n', v: 9 } };
const jml = pasangFormatTanggal(ws, ['Date', 'X'], 2, (c, r2) => `${c}-${r2}`, 2);
assert.equal(jml, 2);
assert.equal(ws['0-3'].z, FORMAT_TANGGAL_EXCEL);
assert.equal(ws['0-4'].z, FORMAT_TANGGAL_EXCEL);
// Baris 1 masih bagian kepala berkas. Memberinya format berarti offset-nya
// diabaikan — dan dua sel data terbawah tidak akan pernah diberi format.
assert.equal(ws['0-1'].z, undefined);
ok('INTI: data dimulai SESUDAH baris header, bukan sesudah baris pertama');

const ws2 = { '0-1': { t: 'n', v: 1 } };
assert.equal(pasangFormatTanggal(ws2, ['Date'], 1, (c, r2) => `${c}-${r2}`), 1);
assert.equal(ws2['0-1'].z, FORMAT_TANGGAL_EXCEL);
ok('tanpa argumen barisHeader, perilakunya persis seperti sebelumnya');

console.log(`\n${n} pemeriksaan ESB Item Journal lolos. ✅`);
