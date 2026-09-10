/**
 * Tes aturan bongkar bahan setengah jadi (0134).
 *
 * Jalankan: node tools/test-bongkar.mjs
 */

import assert from 'node:assert/strict';
import { porsiBongkar, periksaBongkar, periksaStok, pesanStok } from '../js/modules/inventory/bongkar.js';

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

// UDANG PACK: yield 1 pcs, isinya 50gr udang + 10gr tepung.
const PACK = {
  yield_qty: 1,
  items: [
    { ingredient_product_id: 'udang', qty: 50 },
    { ingredient_product_id: 'tepung', qty: 10 }
  ]
};

console.log('\n== §1 Contoh dari permintaannya ==');

uji('1 pack -> udang 50gr', () => {
  assert.equal(porsiBongkar(PACK, 1).get('udang'), 50);
});

uji('5 pack -> udang 250gr', () => {
  assert.equal(porsiBongkar(PACK, 5).get('udang'), 250);
});

uji('seluruh bahan resep dapat porsinya', () => {
  const p = porsiBongkar(PACK, 2);
  assert.equal(p.get('udang'), 100);
  assert.equal(p.get('tepung'), 20);
});

console.log('\n== §2 Yield selain 1 ==');

uji('yield 4, dibongkar 2 -> setengah resepnya', () => {
  // 200gr untuk 4 pack; membongkar 2 pack mengembalikan 100gr, bukan 200.
  const NUGGET = { yield_qty: 4, items: [{ ingredient_product_id: 'udang', qty: 200 }] };
  assert.equal(porsiBongkar(NUGGET, 2).get('udang'), 100);
});

uji('yield 0 tidak membagi dengan nol', () => {
  // Produk yang resepnya baru dibuat bisa punya yield 0 sampai ada yang
  // mengisinya — dan Infinity yang lolos ke layar terlihat seperti angka.
  const p = porsiBongkar({ yield_qty: 0, items: [{ ingredient_product_id: 'x', qty: 5 }] }, 3);
  assert.equal(p.size, 0);
});

uji('resep/qty aneh menghasilkan peta kosong, bukan melempar', () => {
  for (const [r, n] of [
    [null, 1],
    [PACK, 0],
    [PACK, -3],
    [PACK, null],
    [{ yield_qty: 1, items: 'bukan array' }, 1],
    [undefined, undefined]
  ]) {
    assert.ok(porsiBongkar(r, n) instanceof Map);
  }
});

console.log('\n== §3 Batas atas — yang menahan pencetakan stok ==');

uji('melebihi porsi ditolak, dan maksimalnya disebut', () => {
  const h = periksaBongkar(PACK, 1, [{ product_id: 'udang', qty: 500 }]);
  assert.equal(h.boleh.length, 0);
  assert.equal(h.masalah.length, 1);
  assert.equal(h.masalah[0].sebab, 'lebih');
  assert.equal(h.masalah[0].maks, 50);
});

uji('persis sebesar porsinya diterima', () => {
  const h = periksaBongkar(PACK, 1, [{ product_id: 'udang', qty: 50 }]);
  assert.deepEqual(h.boleh, [{ product_id: 'udang', qty: 50 }]);
  assert.deepEqual(h.masalah, []);
});

uji('kurang dari porsinya diterima — udang yang terpotong, misalnya', () => {
  const h = periksaBongkar(PACK, 1, [{ product_id: 'udang', qty: 30 }]);
  assert.deepEqual(h.boleh, [{ product_id: 'udang', qty: 30 }]);
});

uji('selisih pembulatan kecil tidak dianggap melebihi', () => {
  // 1/3 pack × 50 menghasilkan 16,666…; angka yang diketik ulang layar bisa
  // meleset satu satuan terakhir. Menolaknya di situ akan terasa seperti
  // kerusakan, bukan aturan.
  const h = periksaBongkar(PACK, 1 / 3, [{ product_id: 'udang', qty: 50 / 3 }]);
  assert.deepEqual(h.masalah, []);
});

uji('bahan di luar resep ditandai sendiri', () => {
  const h = periksaBongkar(PACK, 1, [{ product_id: 'kopi', qty: 1 }]);
  assert.equal(h.masalah[0].sebab, 'bukan-bahan');
});

console.log('\n== §4 Baris nol = tidak bisa dipisahkan ==');

uji('qty 0 dilewati, bukan dianggap salah', () => {
  // Tepung yang sudah menempel tidak bisa kembali. Itu jawaban yang sah, dan
  // bukan kesalahan yang perlu ditolak.
  const h = periksaBongkar(PACK, 1, [
    { product_id: 'udang', qty: 50 },
    { product_id: 'tepung', qty: 0 }
  ]);
  assert.deepEqual(h.boleh, [{ product_id: 'udang', qty: 50 }]);
  assert.deepEqual(h.masalah, []);
});

uji('qty kosong/null juga dilewati', () => {
  const h = periksaBongkar(PACK, 1, [
    { product_id: 'udang', qty: '' },
    { product_id: 'tepung', qty: null }
  ]);
  assert.deepEqual(h.boleh, []);
  assert.deepEqual(h.masalah, []);
});

uji('pilihan bukan array tidak melempar', () => {
  for (const x of [null, undefined, 'bukan array', 5]) {
    assert.deepEqual(periksaBongkar(PACK, 1, x).boleh, []);
  }
});

console.log('\n== §5 Stok: diperingatkan, bukan diblokir ==');

uji('stok cukup: tidak ada pesan', () => {
  assert.equal(periksaStok(10, 5).cukup, true);
  assert.equal(pesanStok('UDANG PACK', 10, 5, 'pcs'), '');
});

uji('stok kurang: pesannya menyebut kedua angkanya', () => {
  const p = pesanStok('UDANG PACK', 3, 5, 'pcs');
  assert.ok(p.includes('3'), p);
  assert.ok(p.includes('5'), p);
  assert.ok(p.includes('UDANG PACK'), p);
});

uji('dan menegaskan bahwa ini BOLEH dilanjutkan', () => {
  // Konsisten dengan produksi/kiriman/penjualan yang membolehkan stok
  // menembus nol. Peringatan yang terbaca seperti larangan akan menghentikan
  // pekerjaan yang benar.
  const p = pesanStok('UDANG PACK', 0, 2, 'pcs');
  assert.ok(/Boleh dilanjutkan/i.test(p), p);
  assert.ok(/opname/i.test(p), p);
});

uji('stok minus tetap dihitung apa adanya', () => {
  const r = periksaStok(-2, 3);
  assert.equal(r.cukup, false);
  assert.equal(r.stok, -2);
  assert.equal(r.kurang, 5);
});

uji('stok null dianggap 0, bukan melempar', () => {
  assert.equal(periksaStok(null, 1).stok, 0);
  assert.equal(periksaStok(undefined, 0).cukup, true);
});

console.log(`\n${lulus} pemeriksaan lulus.`);
if (process.exitCode) console.error('ADA YANG GAGAL.');
