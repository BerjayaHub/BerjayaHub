/**
 * Tes modul murni ekspor ESB Simple Transfer.
 *
 * Yang dijaga di sini, berurutan sesuai keputusan pengguna:
 *   Qty diambil dari `received_qty`, BUKAN `sent_qty`.
 *   Tanggalnya `received_at`, dikonversi ke tanggal WIB.
 *   Kiriman yang qty terimanya belum dicatat DITAHAN, bukan dikirim sebagai 0.
 *   Origin/Destination memakai peta branch & location yang sama dengan Purchase.
 *   Product Code datang dari master ESB lewat nama hasil pemetaan.
 *
 * Jalankan: node tools/test-esb-transfer.mjs
 */

import assert from 'node:assert/strict';
import { KOLOM_TRANSFER, barisEsbTransfer, ringkasTransfer } from '../js/modules/inventory/esb-transfer.js';
import { buatPeta } from '../js/modules/inventory/esb-purchase.js';

let lulus = 0;
const uji = (nama, fn) => {
  try {
    fn();
    lulus += 1;
    console.log(`  ok  ${nama}`);
  } catch (e) {
    console.error(`  GAGAL  ${nama}\n        ${e.message}`);
    process.exitCode = 1;
  }
};

const K = Object.fromEntries(KOLOM_TRANSFER.map((n, i) => [n, i]));

const petaLengkap = () =>
  buatPeta([
    { jenis: 'branch', kunci: 'Central Kitchen Tangerang', nilai: 'HEAD OFFICE' },
    { jenis: 'location', kunci: 'Central Kitchen Tangerang', nilai: 'Central Kitchen' },
    { jenis: 'branch', kunci: 'AB Sentul', nilai: 'Awal Bermula Cafe & Eatery Sentul' },
    { jenis: 'location', kunci: 'AB Sentul', nilai: 'Awal Bermula Cafe & Eatery Sentul' },
    { jenis: 'item', kunci: 'Wortel', nilai: 'WORTEL' },
    { jenis: 'item', kunci: 'Beras', nilai: 'BERAS PANDAN WANGI' },
    { jenis: 'unit', kunci: 'GR', nilai: 'GRAM' }
  ]);

const kodeItem = () =>
  new Map([
    ['WORTEL', 'BHN-0001'],
    ['BERAS PANDAN WANGI', 'BHN-0002']
  ]);

const kiriman1 = () => ({
  id: 'd1',
  code: 'KRM-001',
  received_at: '2026-09-05T06:00:00Z', // 13:00 WIB, 5 Sep
  notes: 'kirim rutin',
  from_outlet_name: 'Central Kitchen Tangerang',
  to_outlet_name: 'AB Sentul'
});

const items1 = () =>
  new Map([
    [
      'd1',
      [
        { product_name: 'Wortel', base_unit: 'GR', sent_qty: 10000, received_qty: 9500 },
        { product_name: 'Beras', base_unit: 'GR', sent_qty: 5000, received_qty: 5000 }
      ]
    ]
  ]);

console.log('\n== §1 Bentuk template ==');

uji('13 kolom, urutan persis seperti berkas ESB', () => {
  assert.equal(KOLOM_TRANSFER.length, 13);
  assert.deepEqual(KOLOM_TRANSFER, [
    'Sequence',
    'Date',
    'Origin Branch',
    'Origin Location',
    'Destination Branch',
    'Destination Location',
    'Cost Center',
    'Project',
    'Additional Info',
    'Product Name',
    'Product Code',
    'Unit',
    'Qty'
  ]);
});

uji('tiap baris data punya sebanyak kolom headernya', () => {
  const h = barisEsbTransfer({ kiriman: [kiriman1()], itemsPerKiriman: items1(), peta: petaLengkap(), kodeItem: kodeItem() });
  assert.equal(h.baris.length, 2);
  for (const b of h.baris) assert.equal(b.length, KOLOM_TRANSFER.length);
});

console.log('\n== §2 Qty = yang DITERIMA ==');

uji('Qty memakai received_qty, bukan sent_qty', () => {
  const h = barisEsbTransfer({ kiriman: [kiriman1()], itemsPerKiriman: items1(), peta: petaLengkap(), kodeItem: kodeItem() });
  const wortel = h.baris.find((b) => b[K['Product Name']] === 'WORTEL');
  assert.equal(wortel[K.Qty], 9500, 'yang dikirim 10000, yang sampai 9500 — ESB harus dapat 9500');
  assert.notEqual(wortel[K.Qty], 10000);
});

uji('baris yang qty terimanya 0 dibuang, kirimannya tetap berangkat', () => {
  const it = items1();
  it.get('d1')[0].received_qty = 0; // wortel tidak sampai sama sekali
  const h = barisEsbTransfer({ kiriman: [kiriman1()], itemsPerKiriman: it, peta: petaLengkap(), kodeItem: kodeItem() });
  assert.equal(h.baris.length, 1);
  assert.equal(h.baris[0][K['Product Name']], 'BERAS PANDAN WANGI');
  assert.deepEqual(h.kirimanIds, ['d1']);
});

uji('qty terima BELUM dicatat menahan seluruh kirimannya', () => {
  const it = items1();
  it.get('d1')[0].received_qty = null;
  const h = barisEsbTransfer({ kiriman: [kiriman1()], itemsPerKiriman: it, peta: petaLengkap(), kodeItem: kodeItem() });
  assert.equal(h.baris.length, 0, 'null bukan nol — kalau lolos, stok tujuan berkurang diam-diam');
  assert.deepEqual(h.kirimanIds, []);
  assert.ok(h.kurang.some((k) => k.jenis === 'qty-terima' && k.nilai === 'Wortel'));
});

uji('semua qty terima nol: tidak ada dokumen sama sekali', () => {
  const it = items1();
  it.get('d1')[0].received_qty = 0;
  it.get('d1')[1].received_qty = 0;
  const h = barisEsbTransfer({ kiriman: [kiriman1()], itemsPerKiriman: it, peta: petaLengkap(), kodeItem: kodeItem() });
  assert.equal(h.baris.length, 0);
  assert.deepEqual(h.kirimanIds, []);
});

console.log('\n== §3 Tanggal ==');

uji('Date = tanggal DITERIMA dalam WIB', () => {
  const h = barisEsbTransfer({ kiriman: [kiriman1()], itemsPerKiriman: items1(), peta: petaLengkap(), kodeItem: kodeItem() });
  assert.equal(h.baris[0][K.Date], '2026-09-05');
});

uji('terima 00:30 WIB tidak dilaporkan sebagai kemarin', () => {
  // 2026-09-06 00:30 WIB tersimpan sebagai 2026-09-05T17:30:00Z.
  // Memotong 10 huruf pertama akan menghasilkan 2026-09-05 — salah sehari.
  const d = { ...kiriman1(), received_at: '2026-09-05T17:30:00Z' };
  const h = barisEsbTransfer({ kiriman: [d], itemsPerKiriman: items1(), peta: petaLengkap(), kodeItem: kodeItem() });
  assert.equal(h.baris[0][K.Date], '2026-09-06');
  assert.notEqual(h.baris[0][K.Date], String(d.received_at).slice(0, 10));
});

uji('tanpa received_at kirimannya ditahan', () => {
  const d = { ...kiriman1(), received_at: null };
  const h = barisEsbTransfer({ kiriman: [d], itemsPerKiriman: items1(), peta: petaLengkap(), kodeItem: kodeItem() });
  assert.equal(h.baris.length, 0);
  assert.ok(h.kurang.some((k) => k.jenis === 'tanggal-terima'));
});

console.log('\n== §4 Asal & tujuan ==');

uji('Origin dan Destination diambil dari outlet yang benar, tidak tertukar', () => {
  const h = barisEsbTransfer({ kiriman: [kiriman1()], itemsPerKiriman: items1(), peta: petaLengkap(), kodeItem: kodeItem() });
  const b = h.baris[0];
  assert.equal(b[K['Origin Branch']], 'HEAD OFFICE');
  assert.equal(b[K['Origin Location']], 'Central Kitchen');
  assert.equal(b[K['Destination Branch']], 'Awal Bermula Cafe & Eatery Sentul');
  assert.equal(b[K['Destination Location']], 'Awal Bermula Cafe & Eatery Sentul');
});

uji('Branch dan Location dibedakan — bukan salinan satu sama lain', () => {
  const h = barisEsbTransfer({ kiriman: [kiriman1()], itemsPerKiriman: items1(), peta: petaLengkap(), kodeItem: kodeItem() });
  const b = h.baris[0];
  assert.notEqual(b[K['Origin Branch']], b[K['Origin Location']], 'HEAD OFFICE ≠ Central Kitchen');
});

uji('outlet tujuan belum dipetakan menahan seluruh kirimannya', () => {
  const d = { ...kiriman1(), to_outlet_name: 'AB Hampton' };
  const h = barisEsbTransfer({ kiriman: [d], itemsPerKiriman: items1(), peta: petaLengkap(), kodeItem: kodeItem() });
  assert.equal(h.baris.length, 0);
  assert.deepEqual(h.kirimanIds, []);
  assert.ok(h.kurang.some((k) => k.jenis === 'branch' && k.nilai === 'AB Hampton'));
  assert.ok(h.kurang.some((k) => k.jenis === 'location' && k.nilai === 'AB Hampton'));
});

uji('peta yang sama dengan Purchase — tidak ada jenis pemetaan baru', () => {
  const h = barisEsbTransfer({ kiriman: [kiriman1()], itemsPerKiriman: items1(), peta: petaLengkap(), kodeItem: kodeItem() });
  assert.equal(h.baris.length, 2, 'buatPeta() milik esb-purchase.js harus cukup');
});

console.log('\n== §5 Item, satuan, kode ==');

uji('Product Name & Unit memakai nama ESB, bukan nama lokal', () => {
  const h = barisEsbTransfer({ kiriman: [kiriman1()], itemsPerKiriman: items1(), peta: petaLengkap(), kodeItem: kodeItem() });
  const b = h.baris[0];
  assert.equal(b[K['Product Name']], 'WORTEL');
  assert.equal(b[K.Unit], 'GRAM');
});

uji('Product Code datang dari master ESB lewat nama hasil pemetaan', () => {
  const h = barisEsbTransfer({ kiriman: [kiriman1()], itemsPerKiriman: items1(), peta: petaLengkap(), kodeItem: kodeItem() });
  assert.equal(h.baris[0][K['Product Code']], 'BHN-0001');
  assert.equal(h.baris[1][K['Product Code']], 'BHN-0002');
});

uji('kode yang tidak ada di master menjadi sel kosong, bukan "undefined"', () => {
  const h = barisEsbTransfer({ kiriman: [kiriman1()], itemsPerKiriman: items1(), peta: petaLengkap(), kodeItem: new Map() });
  assert.equal(h.baris[0][K['Product Code']], '');
});

uji('item belum dipetakan menahan seluruh kirimannya', () => {
  const it = items1();
  it.get('d1').push({ product_name: 'Daun Bawang', base_unit: 'GR', sent_qty: 100, received_qty: 100 });
  const h = barisEsbTransfer({ kiriman: [kiriman1()], itemsPerKiriman: it, peta: petaLengkap(), kodeItem: kodeItem() });
  assert.equal(h.baris.length, 0, 'transfer separuh jadi harus dikoreksi di dua outlet sekaligus');
  assert.ok(h.kurang.some((k) => k.jenis === 'item' && k.nilai === 'Daun Bawang'));
});

uji('satuan belum dipetakan menahan kirimannya', () => {
  const it = items1();
  it.get('d1')[0].base_unit = 'ML';
  const h = barisEsbTransfer({ kiriman: [kiriman1()], itemsPerKiriman: it, peta: petaLengkap(), kodeItem: kodeItem() });
  assert.equal(h.baris.length, 0);
  assert.ok(h.kurang.some((k) => k.jenis === 'unit' && k.nilai === 'ML'));
});

uji('nama beda huruf besar-kecil & spasi tepi tetap ketemu', () => {
  const it = items1();
  it.get('d1')[0].product_name = '  wortel ';
  const d = { ...kiriman1(), from_outlet_name: 'central kitchen tangerang' };
  const h = barisEsbTransfer({ kiriman: [d], itemsPerKiriman: it, peta: petaLengkap(), kodeItem: kodeItem() });
  assert.equal(h.baris.length, 2);
  assert.equal(h.baris[0][K['Origin Branch']], 'HEAD OFFICE');
});

console.log('\n== §6 Sequence ==');

uji('satu kiriman = satu Sequence, diulang di tiap barisnya', () => {
  const h = barisEsbTransfer({ kiriman: [kiriman1()], itemsPerKiriman: items1(), peta: petaLengkap(), kodeItem: kodeItem() });
  assert.equal(h.baris[0][K.Sequence], 1);
  assert.equal(h.baris[1][K.Sequence], 1, 'dua baris satu dokumen harus punya Sequence yang sama');
});

uji('Sequence naik hanya untuk kiriman yang IKUT berangkat', () => {
  const d2 = { ...kiriman1(), id: 'd2', code: 'KRM-002', to_outlet_name: 'AB Hampton' }; // tertahan
  const d3 = { ...kiriman1(), id: 'd3', code: 'KRM-003' };
  const items = items1();
  items.set('d2', [{ product_name: 'Wortel', base_unit: 'GR', sent_qty: 1, received_qty: 1 }]);
  items.set('d3', [{ product_name: 'Wortel', base_unit: 'GR', sent_qty: 2, received_qty: 2 }]);

  const h = barisEsbTransfer({ kiriman: [kiriman1(), d2, d3], itemsPerKiriman: items, peta: petaLengkap(), kodeItem: kodeItem() });
  assert.deepEqual(h.kirimanIds, ['d1', 'd3']);
  const seq = [...new Set(h.baris.map((b) => b[K.Sequence]))];
  assert.deepEqual(seq, [1, 2], 'tidak boleh ada nomor yang bolong karena dokumen yang tertahan');
});

uji('mulaiSequence dihormati', () => {
  const h = barisEsbTransfer({
    kiriman: [kiriman1()],
    itemsPerKiriman: items1(),
    peta: petaLengkap(),
    kodeItem: kodeItem(),
    opsi: { mulaiSequence: 7 }
  });
  assert.equal(h.baris[0][K.Sequence], 7);
});

console.log('\n== §7 Ringkasan & masukan aneh ==');

uji('ringkasTransfer menghitung yang tertahan', () => {
  const d2 = { ...kiriman1(), id: 'd2', code: 'KRM-002', to_outlet_name: 'AB Hampton' };
  const items = items1();
  items.set('d2', [{ product_name: 'Wortel', base_unit: 'GR', sent_qty: 1, received_qty: 1 }]);
  const h = barisEsbTransfer({ kiriman: [kiriman1(), d2], itemsPerKiriman: items, peta: petaLengkap(), kodeItem: kodeItem() });
  const r = ringkasTransfer(h, 2);
  assert.equal(r.siap, 1);
  assert.equal(r.tertahan, 1);
  assert.equal(r.baris, 2);
  assert.ok(r.kurang >= 1);
});

uji('daftar kosong / bukan array tidak melempar', () => {
  for (const k of [[], null, undefined, 'bukan array']) {
    const h = barisEsbTransfer({ kiriman: k, itemsPerKiriman: new Map(), peta: petaLengkap() });
    assert.deepEqual(h.baris, []);
    assert.deepEqual(h.kirimanIds, []);
  }
});

uji('kiriman tanpa item tidak menghasilkan dokumen kosong', () => {
  const h = barisEsbTransfer({ kiriman: [kiriman1()], itemsPerKiriman: new Map(), peta: petaLengkap() });
  assert.equal(h.baris.length, 0);
  assert.deepEqual(h.kirimanIds, []);
});

uji('kurang menyebut kiriman mana yang terpengaruh', () => {
  const d = { ...kiriman1(), to_outlet_name: 'AB Hampton' };
  const h = barisEsbTransfer({ kiriman: [d], itemsPerKiriman: items1(), peta: petaLengkap(), kodeItem: kodeItem() });
  const k = h.kurang.find((x) => x.jenis === 'branch');
  assert.deepEqual(k.dok, ['KRM-001'], 'tanpa nomor kiriman, admin tidak tahu harus membetulkan apa');
});

uji('tidak ada kolom harga yang bocor ke template', () => {
  assert.ok(!KOLOM_TRANSFER.some((k) => /price|amount|cost(?!\sCenter)/i.test(k)));
});

console.log(`\n${lulus} pemeriksaan lulus.`);
if (process.exitCode) console.error('ADA YANG GAGAL.');
