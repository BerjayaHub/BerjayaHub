/**
 * TES: ekspor ESB dalam SATUAN BELI.
 *
 * Yang dijaga, dan ini yang terpenting: **Qty × Price tetap sama dengan total
 * notanya**. Konversi satuan yang menggeser nilai rupiah akan diterima ESB
 * tanpa keluhan, lalu selisihnya muncul berminggu-minggu kemudian sebagai
 * pembelian yang tidak cocok dengan tagihan supplier.
 */
import assert from 'node:assert/strict';
import { keSatuanBeli, satuanPerluDipetakan, DESIMAL_QTY_MAKS } from '../js/modules/inventory/konversi-satuan.js';
import { KOLOM_ESB, buatPeta, barisEsbPurchase, bulatkanHarga } from '../js/modules/inventory/esb-purchase.js';

let n = 0;
const ok = (nama) => {
  n += 1;
  console.log(`  ✔ ${nama}`);
};

console.log('§1 Konversi dasar');

// 3 pack plastik isi 100 -> tersimpan 300 pcs seharga Rp12.000.
const plastik = {
  product_name: 'Plastik Pex',
  base_unit: 'pcs',
  purchase_unit: 'PACK@100PCS',
  purchase_qty: 100,
  qty: 300,
  unit_cost: 40,
  line_total: 12000
};
const k1 = keSatuanBeli(plastik, plastik);
assert.equal(k1.dikonversi, true);
assert.equal(k1.unitLokal, 'PACK@100PCS');
assert.equal(k1.qty, 3);
assert.equal(k1.harga, 4000);
ok('300 pcs @Rp40 -> 3 PACK@100PCS @Rp4.000');

assert.equal(k1.qty * k1.harga, 12000);
ok('Qty × Price = total nota, persis');

console.log('\n§2 Yang TIDAK dikonversi');

const eceran = { base_unit: 'gr', qty: 500, unit_cost: 30, line_total: 15000 };
const k2 = keSatuanBeli(eceran, eceran);
assert.equal(k2.dikonversi, false);
assert.equal(k2.unitLokal, 'gr');
assert.equal(k2.qty, 500);
assert.equal(k2.harga, 30);
ok('tanpa satuan beli: berangkat apa adanya, persis seperti sebelum perubahan ini');

for (const [nama, p] of [
  ['isi kosong', { base_unit: 'gr', purchase_unit: 'KG', qty: 500, unit_cost: 30 }],
  ['isi null', { base_unit: 'gr', purchase_unit: 'KG', purchase_qty: null, qty: 500, unit_cost: 30 }],
  ['isi string kosong', { base_unit: 'gr', purchase_unit: 'KG', purchase_qty: '', qty: 500, unit_cost: 30 }],
  ['isi nol', { base_unit: 'gr', purchase_unit: 'KG', purchase_qty: 0, qty: 500, unit_cost: 30 }],
  ['isi negatif', { base_unit: 'gr', purchase_unit: 'KG', purchase_qty: -5, qty: 500, unit_cost: 30 }],
  ['isi 1', { base_unit: 'btl', purchase_unit: 'BOTOL', purchase_qty: 1, qty: 5, unit_cost: 30 }],
  // Isinya terisi tapi NAMA satuannya tidak — orang mengisi angkanya lalu lupa
  // namanya. Tanpa nama, tidak ada yang bisa dikirim ke kolom Unit ESB; yang
  // berangkat akan berupa sel kosong, dan ESB menolaknya jauh belakangan.
  ['nama satuan beli kosong', { base_unit: 'gr', purchase_unit: '', purchase_qty: 1000, qty: 500, unit_cost: 30 }],
  ['nama satuan beli spasi', { base_unit: 'gr', purchase_unit: '   ', purchase_qty: 1000, qty: 500, unit_cost: 30 }],
  ['satuan beli = satuan kecil', { base_unit: 'pcs', purchase_unit: 'PCS', purchase_qty: 30, qty: 30, unit_cost: 1 }]
]) {
  const h = keSatuanBeli(p, p);
  assert.equal(h.dikonversi, false, nama);
  assert.equal(h.unitLokal, p.base_unit, nama);
  assert.equal(h.qty, p.qty, nama);
}
ok('isi kosong/nol/negatif/1 dan satuan beli yang sama dengan satuan kecil: tidak diubah');

// `Number('')` dan `Number(null)` adalah 0, bukan NaN — kalau tidak disaring,
// keduanya lolos sebagai isi 0 dan membagi qty dengan nol.
const k0 = keSatuanBeli({ base_unit: 'gr', purchase_unit: 'KG', purchase_qty: '', qty: 500, unit_cost: 30 }, {
  base_unit: 'gr',
  purchase_unit: 'KG',
  purchase_qty: '',
  qty: 500,
  unit_cost: 30
});
assert.ok(Number.isFinite(k0.qty));
ok('tidak ada pembagian dengan nol yang menghasilkan Infinity');

console.log('\n§3 Pecahan diterima apa adanya');

// Dibeli per kg tapi yang datang 496 gram. Pecahan di sini NORMAL.
const alpukat = { base_unit: 'gr', purchase_unit: 'KG', purchase_qty: 1000, qty: 496, unit_cost: 43.90120967741935, line_total: 21775 };
const k3 = keSatuanBeli(alpukat, alpukat);
assert.equal(k3.qty, 0.496);
assert.equal(Math.round(k3.qty * k3.harga), 21775);
ok('496 gr -> 0,496 KG, dan nilainya tetap Rp21.775');

// 100 pcs dari pack isi 62. Sengaja TIDAK dibulatkan: 2 pack berarti 124 pcs,
// dan itu bukan jumlah yang masuk gudang.
const sebagian = { base_unit: 'pcs', purchase_unit: 'PACK@62PCS', purchase_qty: 62, qty: 100, unit_cost: 193.5483870967742, line_total: 19354.838709677417 };
const k4 = keSatuanBeli(sebagian, sebagian);
assert.ok(k4.qty > 1.61 && k4.qty < 1.62, `qty ${k4.qty}`);
assert.notEqual(k4.qty, 2);
ok('100 pcs dari pack isi 62 tetap 1,6129 pack — tidak dibulatkan jadi 2');

assert.ok(String(k4.qty).split('.')[1].length <= DESIMAL_QTY_MAKS);
ok(`qty tidak lebih dari ${DESIMAL_QTY_MAKS} desimal`);

console.log('\n§4 Harga dihitung dari TOTAL, bukan dari unit_cost × isi');

// `unit_cost` sendiri hasil bagi, jadi mengalikannya kembali bisa menumpuk
// galat. Pembagi 290 adalah contoh yang sungguh meleset:
//
//     10000 / 290 = 34.48275862068966
//     34.48275862068966 * 290 = 10000.000000000002
//
// Pembagi 62 KEBETULAN bulat pulang-pergi — dipakai di percobaan pertama, dan
// pemeriksaannya jadi tidak membuktikan apa pun.
assert.notEqual((10000 / 290) * 290, 10000, 'contoh galatnya sudah tidak meleset — ganti pembagi');

const naik = { base_unit: 'pcs', purchase_unit: 'PACK@290PCS', purchase_qty: 290, qty: 290, unit_cost: 10000 / 290, line_total: 10000 };
const k5 = keSatuanBeli(naik, naik);
assert.equal(k5.qty, 1);
assert.equal(k5.harga, 10000);
assert.notEqual(k5.harga, (10000 / 290) * 290);
ok('1 pack berharga persis Rp10.000 — bukan Rp10.000,000000000002');

// Dan sifat yang sesungguhnya dijaga, untuk sederet pembagi sekaligus.
for (const [total, isi] of [[12000, 62], [10000, 290], [20000, 1040], [9690, 39], [3000, 260], [21775, 496]]) {
  const p = { base_unit: 'pcs', purchase_unit: `PACK@${isi}PCS`, purchase_qty: isi, qty: isi, unit_cost: total / isi, line_total: total };
  const h = keSatuanBeli(p, p);
  assert.equal(h.qty, 1, `${total}/${isi}`);
  assert.equal(h.harga, total, `${total}/${isi}`);
}
ok('enam pembagi berbeda: harga satu pack selalu persis total notanya');

// Tanpa line_total, jatuh ke unit_cost × isi. Masih benar, cuma kurang presisi.
const tanpaTotal = { base_unit: 'pcs', purchase_unit: 'PACK@10PCS', purchase_qty: 10, qty: 20, unit_cost: 5 };
const k6 = keSatuanBeli(tanpaTotal, tanpaTotal);
assert.equal(k6.qty, 2);
assert.equal(k6.harga, 50);
ok('tanpa line_total tetap jalan lewat unit_cost × isi');

console.log('\n§5 Daftar satuan yang perlu dipetakan');

const produk = [
  { base_unit: 'gr', purchase_unit: 'KG', purchase_qty: 1000 },
  { base_unit: 'pcs', purchase_unit: 'PACK@30PCS', purchase_qty: 30 },
  { base_unit: 'gr', purchase_unit: 'KG', purchase_qty: 1000 },
  { base_unit: 'ml' },
  { base_unit: 'btl', purchase_unit: 'BOTOL', purchase_qty: 1 },
  { base_unit: 'pcs', purchase_unit: 'pcs', purchase_qty: 12 }
];
const daftar = satuanPerluDipetakan(produk);
assert.deepEqual(daftar, ['btl', 'gr', 'KG', 'ml', 'PACK@30PCS', 'pcs']);
ok('memuat satuan kecil DAN satuan beli, tanpa kembar');

// INI yang menjaga layarnya tidak jadi jalan buntu: kalau daftar pemetaan tidak
// memuat satuan beli, seluruh nota tertahan dengan alasan "PACK@30PCS belum
// dipetakan" dan tidak ada satu pun baris untuk memetakannya.
assert.ok(daftar.includes('PACK@30PCS'), 'satuan beli WAJIB ada di daftar pemetaan');
assert.ok(daftar.includes('gr'), 'satuan kecil tetap ada — produk tanpa satuan beli masih memakainya');
ok('satuan beli ada di daftar — layarnya tidak jadi jalan buntu');

assert.ok(!daftar.includes('BOTOL'), 'satuan beli berisi 1 tidak pernah dikirim, jadi tidak perlu dipetakan');
ok('satuan beli yang tidak pernah dipakai tidak memanjangkan daftar');

assert.deepEqual(satuanPerluDipetakan(null), []);
assert.deepEqual(satuanPerluDipetakan([]), []);
ok('masukan kosong tidak melempar');

console.log('\n§6 Lewat ekspor sungguhan');

const peta = buatPeta([
  { jenis: 'branch', kunci: 'AB Sentul', nilai: 'AB SENTUL' },
  { jenis: 'location', kunci: 'AB Sentul', nilai: 'GUDANG SENTUL' },
  { jenis: 'payment_method', kunci: 'kas', nilai: 'CASH' },
  { jenis: 'coa', kunci: 'kas', nilai: '1101' },
  { jenis: 'item', kunci: 'Plastik Pex', nilai: 'Plastik Pex Bawang Uk.25X48' },
  { jenis: 'item', kunci: 'Gula', nilai: 'GULA PASIR' },
  { jenis: 'unit', kunci: 'PACK@100PCS', nilai: 'PACK@100PCS' },
  { jenis: 'unit', kunci: 'gr', nilai: 'GR' }
]);
const nota = {
  id: 'n1',
  code: 'TRM-001',
  receipt_date: '2026-09-01',
  supplier: 'Toko Berkah',
  outlet_name: 'AB Sentul',
  payment_status: 'lunas',
  payment_source: 'outlet'
};
const iUnit = KOLOM_ESB.indexOf('Unit');
const iQty = KOLOM_ESB.indexOf('Qty');
const iHarga = KOLOM_ESB.indexOf('Price');

const h = barisEsbPurchase({
  notas: [nota],
  itemsPerNota: new Map([['n1', [plastik, { product_name: 'Gula', base_unit: 'gr', qty: 500, unit_cost: 30, line_total: 15000 }]]]),
  peta
});
assert.equal(h.baris.length, 2);
assert.deepEqual([h.baris[0][iUnit], h.baris[0][iQty], h.baris[0][iHarga]], ['PACK@100PCS', 3, 4000]);
ok('baris berpack berangkat sebagai PACK@100PCS 3 @Rp4.000');

assert.deepEqual([h.baris[1][iUnit], h.baris[1][iQty], h.baris[1][iHarga]], ['GR', 500, 30]);
ok('baris tanpa satuan beli tetap GR 500 @Rp30');

// Nilai totalnya harus utuh untuk KEDUA baris.
assert.equal(h.baris[0][iQty] * h.baris[0][iHarga], 12000);
assert.equal(h.baris[1][iQty] * h.baris[1][iHarga], 15000);
ok('Qty × Price kedua baris sama dengan total notanya');

// Satuan BELI yang belum dipetakan harus menahan notanya — dan alasannya
// menyebut satuan beli, bukan satuan kecil. Menyebut "pcs" akan mengirim
// orangnya mencari baris yang memang tidak bermasalah.
const petaTanpaPack = buatPeta([
  { jenis: 'branch', kunci: 'AB Sentul', nilai: 'AB SENTUL' },
  { jenis: 'location', kunci: 'AB Sentul', nilai: 'GUDANG SENTUL' },
  { jenis: 'payment_method', kunci: 'kas', nilai: 'CASH' },
  { jenis: 'coa', kunci: 'kas', nilai: '1101' },
  { jenis: 'item', kunci: 'Plastik Pex', nilai: 'Plastik Pex Bawang Uk.25X48' },
  { jenis: 'unit', kunci: 'pcs', nilai: 'PCS' }
]);
const hTahan = barisEsbPurchase({ notas: [nota], itemsPerNota: new Map([['n1', [plastik]]]), peta: petaTanpaPack });
assert.equal(hTahan.baris.length, 0);
const alasanUnit = hTahan.kurang.find((x) => x.jenis === 'unit');
assert.equal(alasanUnit.nilai, 'PACK@100PCS');
assert.notEqual(alasanUnit.nilai, 'pcs');
ok('satuan beli yang belum dipetakan menahan notanya, dan alasannya menyebut PACK@100PCS');

console.log(`\n${n} pemeriksaan konversi satuan lolos. ✅`);
