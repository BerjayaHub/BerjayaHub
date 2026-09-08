/**
 * Ekspor nota Berjaya Hub -> template ESB Simple Purchase.
 *
 * Yang dijaga di sini adalah hal-hal yang KELIHATAN benar kalau salah:
 * berkas yang terunduh dengan sel kosong, harga yang tergandakan sebesar qty,
 * dan kolom yang bergeser satu posisi tanpa ada yang menyadarinya.
 */
import assert from 'node:assert/strict';
import { KOLOM_ESB, buatPeta, barisEsbPurchase, ringkasEkspor } from '../js/modules/inventory/esb-purchase.js';

let lulus = 0;
const uji = (nama, fn) => {
  try {
    fn();
    lulus++;
  } catch (e) {
    console.error(`❌ ${nama}\n   ${e.message}`);
    process.exitCode = 1;
  }
};

const K = Object.fromEntries(KOLOM_ESB.map((h, i) => [h, i]));

const peta = buatPeta([
  { jenis: 'branch', kunci: 'Central Kitchen Tangerang', nilai: 'Kantor Pusat' },
  { jenis: 'location', kunci: 'Central Kitchen Tangerang', nilai: 'GUDANG Kantor Pst' },
  { jenis: 'payment_method', kunci: 'kas', nilai: 'Cash' },
  { jenis: 'payment_method', kunci: 'tempo', nilai: 'Credit' },
  { jenis: 'coa', kunci: 'kas', nilai: '1 1 01 01' },
  { jenis: 'coa', kunci: 'tempo', nilai: '2 1 01 01' },
  { jenis: 'unit', kunci: 'gr', nilai: 'GR' },
  { jenis: 'item', kunci: 'Beras', nilai: 'Beras' },
  { jenis: 'item', kunci: 'Telur', nilai: 'Telur Ayam' }
]);

const nota = (o) => ({
  id: o.id ?? 'n1',
  code: o.code ?? 'TRM-01',
  receipt_date: o.tgl ?? '2026-09-05',
  supplier: o.supplier ?? 'Toko Beras',
  invoice_no: o.inv ?? 'INV-1',
  notes: o.notes ?? '',
  outlet_name: o.outlet ?? 'Central Kitchen Tangerang',
  payment_status: o.status ?? 'belum',
  payment_source: o.sumber ?? null
});
// Beras 5.000 gr seharga Rp180.000 -> Rp36/gram.
const BERAS = { product_name: 'Beras', base_unit: 'gr', qty: 5000, unit_cost: 36, line_total: 180000 };
const TELUR = { product_name: 'Telur', base_unit: 'gr', qty: 100, unit_cost: 3000, line_total: 300000 };

// ---------------------------------------------------------------
// 1. Bentuk templatenya
// ---------------------------------------------------------------
uji('INTI: 25 kolom, urutan & nama persis template ESB', () => {
  assert.equal(KOLOM_ESB.length, 25);
  assert.equal(KOLOM_ESB[0], 'Sequence');
  assert.equal(KOLOM_ESB[13], 'Type');
  assert.equal(KOLOM_ESB[16], 'Qty');
  assert.equal(KOLOM_ESB[17], 'Price');
  assert.equal(KOLOM_ESB[24], 'Additional Info');
});

uji('tiap baris data panjangnya sama dengan headernya', () => {
  const r = barisEsbPurchase({ notas: [nota({})], itemsPerNota: new Map([['n1', [BERAS]]]), peta });
  assert.equal(r.baris.length, 1);
  assert.equal(r.baris[0].length, KOLOM_ESB.length, 'kolom bergeser satu posisi tidak akan terlihat di Excel');
});

// ---------------------------------------------------------------
// 2. INTI: harga PER SATUAN
// ---------------------------------------------------------------
uji('INTI: Price = harga per satuan, bukan harga baris', () => {
  const r = barisEsbPurchase({ notas: [nota({})], itemsPerNota: new Map([['n1', [BERAS]]]), peta });
  const b = r.baris[0];
  assert.equal(b[K.Qty], 5000);
  assert.equal(b[K.Price], 36, 'Rp180.000 adalah harga BARIS; ESB membaca Price sebagai per satuan');
  assert.notEqual(b[K.Price], 180000, 'inilah kesalahan yang melahirkan 0123/0124 — 5.000x lipat');
});

uji('harga yang belum diisi menahan notanya, bukan jadi Rp0', () => {
  const tanpaHarga = { product_name: 'Beras', base_unit: 'gr', qty: 10, unit_cost: null, line_total: null };
  const r = barisEsbPurchase({ notas: [nota({})], itemsPerNota: new Map([['n1', [tanpaHarga]]]), peta });
  assert.equal(r.baris.length, 0);
  assert.ok(r.kurang.some((k) => k.jenis === 'harga'));
});

// ---------------------------------------------------------------
// 3. Sequence mengelompokkan per NOTA
// ---------------------------------------------------------------
uji('INTI: satu nota = satu Sequence, walau banyak baris', () => {
  const r = barisEsbPurchase({
    notas: [nota({ id: 'n1', code: 'A' }), nota({ id: 'n2', code: 'B' })],
    itemsPerNota: new Map([
      ['n1', [BERAS, TELUR]],
      ['n2', [BERAS]]
    ]),
    peta
  });
  assert.equal(r.baris.length, 3);
  assert.deepEqual(
    r.baris.map((b) => b[K.Sequence]),
    [1, 1, 2],
    'dua baris nota pertama harus berbagi Sequence; nota kedua dapat nomor berikutnya'
  );
});

uji('Sequence tidak melompat karena nota yang tertahan', () => {
  // Nota B tertahan (itemnya belum dipetakan). Nomor nota C harus 2, bukan 3 —
  // ESB membaca Sequence sebagai pengelompok, dan nomor yang bolong membuat
  // orang mengira ada dokumen yang hilang.
  const r = barisEsbPurchase({
    notas: [nota({ id: 'n1', code: 'A' }), nota({ id: 'n2', code: 'B' }), nota({ id: 'n3', code: 'C' })],
    itemsPerNota: new Map([
      ['n1', [BERAS]],
      ['n2', [{ product_name: 'Barang Asing', base_unit: 'gr', qty: 1, unit_cost: 1 }]],
      ['n3', [BERAS]]
    ]),
    peta
  });
  assert.deepEqual(
    r.baris.map((b) => b[K.Sequence]),
    [1, 2]
  );
});

// ---------------------------------------------------------------
// 4. Pemetaan master ESB
// ---------------------------------------------------------------
uji('kepala nota memakai padanan ESB, bukan nama lokal', () => {
  const b = barisEsbPurchase({ notas: [nota({})], itemsPerNota: new Map([['n1', [BERAS]]]), peta }).baris[0];
  assert.equal(b[K.Branch], 'Kantor Pusat');
  assert.equal(b[K.Location], 'GUDANG Kantor Pst');
  assert.equal(b[K.Unit], 'GR', 'satuan kami "gr", ESB "GR"');
  assert.equal(b[K.Item], 'Beras');
});

uji('nama item lokal diterjemahkan ke nama ESB', () => {
  const b = barisEsbPurchase({ notas: [nota({})], itemsPerNota: new Map([['n1', [TELUR]]]), peta }).baris[0];
  assert.equal(b[K.Item], 'Telur Ayam', 'nama di Berjaya Hub "Telur", di ESB "Telur Ayam"');
});

uji('pemetaan tidak membedakan huruf besar-kecil & spasi tepi', () => {
  const n = nota({ outlet: '  central kitchen tangerang ' });
  const b = barisEsbPurchase({ notas: [n], itemsPerNota: new Map([['n1', [BERAS]]]), peta }).baris[0];
  assert.equal(b[K.Branch], 'Kantor Pusat');
});

uji('INTI: yang belum terpetakan MENAHAN notanya, tidak dikosongkan', () => {
  const r = barisEsbPurchase({
    notas: [nota({ outlet: 'Outlet Baru' })],
    itemsPerNota: new Map([['n1', [BERAS]]]),
    peta
  });
  assert.equal(r.baris.length, 0, 'berkas dengan sel kosong akan ditolak ESB jauh belakangan');
  const jenis = r.kurang.map((k) => k.jenis).sort();
  assert.deepEqual(jenis, ['branch', 'location']);
  assert.deepEqual(r.kurang[0].nota, ['TRM-01'], 'harus menyebut nota mana yang terpengaruh');
});

uji('satu baris bermasalah menahan SELURUH notanya', () => {
  // Dokumen separuh jadi di ESB lebih sulit dibereskan daripada tidak ada
  // dokumen: ia harus dihapus lalu diunggah ulang.
  const r = barisEsbPurchase({
    notas: [nota({})],
    itemsPerNota: new Map([['n1', [BERAS, { product_name: 'Asing', base_unit: 'gr', qty: 1, unit_cost: 1 }]]]),
    peta
  });
  assert.equal(r.baris.length, 0);
  assert.equal(r.notaIds.length, 0);
});

// ---------------------------------------------------------------
// 5. Cara bayar
// ---------------------------------------------------------------
uji('cara bayar dipetakan dari sumbernya', () => {
  const kas = barisEsbPurchase({
    notas: [nota({ status: 'lunas', sumber: 'kas' })],
    itemsPerNota: new Map([['n1', [BERAS]]]),
    peta
  }).baris[0];
  assert.equal(kas[K['Payment Method']], 'Cash');
  assert.equal(kas[K.COANo], '1 1 01 01');

  const tempo = barisEsbPurchase({
    notas: [nota({ status: 'belum' })],
    itemsPerNota: new Map([['n1', [BERAS]]]),
    peta
  }).baris[0];
  assert.equal(tempo[K['Payment Method']], 'Credit');
  assert.equal(tempo[K.COANo], '2 1 01 01');
});

uji('sumber pusat yang belum dipetakan ditahan, bukan disamakan dengan kas', () => {
  const r = barisEsbPurchase({
    notas: [nota({ status: 'lunas', sumber: 'pusat' })],
    itemsPerNota: new Map([['n1', [BERAS]]]),
    peta
  });
  assert.equal(r.baris.length, 0);
  assert.ok(r.kurang.some((k) => k.jenis === 'payment_method' && k.nilai === 'pusat'));
});

// ---------------------------------------------------------------
// 6. Konstanta & kolom yang memang kosong
// ---------------------------------------------------------------
uji('Currency, Rate, dan Type berisi tetap', () => {
  const b = barisEsbPurchase({ notas: [nota({})], itemsPerNota: new Map([['n1', [BERAS]]]), peta }).baris[0];
  assert.equal(b[K.Currency], 'IDR');
  assert.equal(b[K.Rate], 1);
  assert.equal(b[K.Type], 'Item', 'Berjaya Hub tidak pernah mengekspor baris Cost');
});

uji('kolom yang tidak ada padanannya dikirim KOSONG, bukan ditebak', () => {
  const b = barisEsbPurchase({ notas: [nota({})], itemsPerNota: new Map([['n1', [BERAS]]]), peta }).baris[0];
  for (const k of ['Cost Center', 'Project', 'Credit Term', 'Other Tax', 'Tax Rate', 'Amount', 'Additional Info']) {
    assert.equal(b[K[k]], '', k);
  }
});

// ---------------------------------------------------------------
// 7. Perbatasan
// ---------------------------------------------------------------
uji('nota tanpa barang tidak menghasilkan dokumen kosong di ESB', () => {
  const r = barisEsbPurchase({ notas: [nota({})], itemsPerNota: new Map([['n1', []]]), peta });
  assert.equal(r.baris.length, 0);
  assert.equal(r.notaIds.length, 0);
});

uji('baris berjumlah nol dilewati', () => {
  const r = barisEsbPurchase({
    notas: [nota({})],
    itemsPerNota: new Map([['n1', [{ ...BERAS, qty: 0 }]]]),
    peta
  });
  assert.equal(r.baris.length, 0);
});

uji('masukan kosong/rusak tidak melempar', () => {
  assert.deepEqual(barisEsbPurchase({ notas: null, itemsPerNota: null, peta: buatPeta(null) }).baris, []);
  assert.deepEqual(buatPeta([{ jenis: 'ngawur', kunci: 'a', nilai: 'b' }]).item.size, 0);
});

uji('ringkasan menyebut yang tertahan', () => {
  const r = barisEsbPurchase({
    notas: [nota({ id: 'n1', code: 'A' }), nota({ id: 'n2', code: 'B', outlet: 'Outlet Baru' })],
    itemsPerNota: new Map([
      ['n1', [BERAS]],
      ['n2', [BERAS]]
    ]),
    peta
  });
  const s = ringkasEkspor(r, 2);
  assert.equal(s.siap, 1);
  assert.equal(s.tertahan, 1);
  assert.equal(s.baris, 1);
});

if (process.exitCode !== 1) console.log(`Ekspor ESB Purchase: ${lulus} pemeriksaan lulus. ✅`);
