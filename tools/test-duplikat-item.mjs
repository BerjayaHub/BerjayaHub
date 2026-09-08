/**
 * Tes aturan "satu bahan, satu baris".
 *
 * Yang dijaga:
 *   Baris kosong tidak dihitung kembar (form baru selalu punya satu).
 *   Baris pertama menang tempat — pesanan rekan tidak pindah ke bawah.
 *   Qty dijumlahkan; 100 + 150 = 250, persis contoh yang diminta.
 *   Harga TIDAK dijumlahkan kalau salah satu baris belum berharga.
 *   Order & surat jalan (yang tidak punya konsep harga) tidak tiba-tiba
 *   membawa kolom `line_total`.
 *
 * Jalankan: node tools/test-duplikat-item.mjs
 */

import assert from 'node:assert/strict';
import { cariDuplikat, adaDuplikat, gabungDuplikat, pesanDuplikat } from '../js/modules/dispatch/duplikat-item.js';

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

console.log('\n== §1 Menemukan yang kembar ==');

uji('dua baris produk sama terdeteksi, beserta indeksnya', () => {
  const k = cariDuplikat([
    { product_id: 'A', qty: 100 },
    { product_id: 'B', qty: 5 },
    { product_id: 'A', qty: 150 }
  ]);
  assert.equal(k.size, 1);
  assert.deepEqual(k.get('A'), [0, 2]);
});

uji('daftar tanpa kembar menghasilkan peta kosong', () => {
  assert.equal(cariDuplikat([{ product_id: 'A' }, { product_id: 'B' }]).size, 0);
  assert.equal(adaDuplikat([{ product_id: 'A' }, { product_id: 'B' }]), false);
});

uji('baris KOSONG tidak dihitung kembar', () => {
  // Form selalu menyisakan satu baris kosong di bawah. Kalau baris kosong
  // dihitung, seluruh form ditandai merah sejak dibuka dan peringatannya
  // berhenti dibaca dalam hitungan hari.
  const items = [{ product_id: '', qty: '' }, { product_id: '', qty: '' }, { product_id: 'A', qty: 1 }];
  assert.equal(cariDuplikat(items).size, 0);
  assert.equal(adaDuplikat(items), false);
});

uji('produk null/undefined tidak dianggap satu kelompok', () => {
  assert.equal(cariDuplikat([{ product_id: null }, { product_id: undefined }, {}]).size, 0);
});

uji('tiga baris produk sama terdeteksi sekaligus', () => {
  const k = cariDuplikat([{ product_id: 'A' }, { product_id: 'A' }, { product_id: 'A' }]);
  assert.deepEqual(k.get('A'), [0, 1, 2]);
});

uji('masukan bukan array tidak melempar', () => {
  for (const x of [null, undefined, 'bukan array', 42]) {
    assert.equal(cariDuplikat(x).size, 0);
    assert.equal(adaDuplikat(x), false);
  }
});

console.log('\n== §2 Menggabungkan — contoh dari permintaannya ==');

uji('bahan A 100gr + bahan A 150gr menjadi 250gr', () => {
  const { items, digabung } = gabungDuplikat([
    { product_id: 'A', qty: 100 },
    { product_id: 'A', qty: 150 }
  ]);
  assert.equal(items.length, 1);
  assert.equal(items[0].qty, 250);
  assert.equal(digabung.length, 1);
  assert.deepEqual(
    { product_id: digabung[0].product_id, dari: digabung[0].dari, qty: digabung[0].qty },
    { product_id: 'A', dari: 2, qty: 250 }
  );
});

uji('baris PERTAMA menang tempat — pesanan rekan tidak pindah ke bawah', () => {
  const { items } = gabungDuplikat([
    { product_id: 'A', qty: 100 },
    { product_id: 'B', qty: 5 },
    { product_id: 'A', qty: 150 }
  ]);
  assert.deepEqual(items.map((i) => i.product_id), ['A', 'B']);
  assert.equal(items[0].qty, 250);
});

uji('barang yang tidak kembar tidak tersentuh sama sekali', () => {
  const asli = [{ product_id: 'A', qty: 100 }, { product_id: 'B', qty: 5 }, { product_id: 'A', qty: 150 }];
  const { items } = gabungDuplikat(asli);
  assert.deepEqual(items[1], { product_id: 'B', qty: 5 });
  assert.equal(asli.length, 3, 'daftar aslinya tidak boleh diubah di tempat');
  assert.equal(asli[0].qty, 100);
});

uji('tiga baris sekaligus dijumlahkan', () => {
  const { items, digabung } = gabungDuplikat([
    { product_id: 'A', qty: 10 },
    { product_id: 'A', qty: 20 },
    { product_id: 'A', qty: 30 }
  ]);
  assert.equal(items.length, 1);
  assert.equal(items[0].qty, 60);
  assert.equal(digabung[0].dari, 3);
});

uji('qty kosong dihitung nol, bukan NaN', () => {
  // `Number('')` adalah 0, bukan NaN — jebakan yang sudah beberapa kali
  // menggigit di repo ini. Yang dijaga: hasilnya angka, bukan NaN yang
  // tersimpan diam-diam.
  const { items } = gabungDuplikat([{ product_id: 'A', qty: '' }, { product_id: 'A', qty: 150 }]);
  assert.equal(items[0].qty, 150);
  assert.ok(Number.isFinite(items[0].qty));
});

uji('qty berupa teks angka tetap dijumlahkan sebagai angka', () => {
  const { items } = gabungDuplikat([{ product_id: 'A', qty: '100' }, { product_id: 'A', qty: '150' }]);
  assert.equal(items[0].qty, 250);
  assert.notEqual(items[0].qty, '100150', 'penggabungan string, bukan penjumlahan');
});

uji('daftar tanpa kembar dikembalikan apa adanya', () => {
  const { items, digabung } = gabungDuplikat([{ product_id: 'A', qty: 1 }, { product_id: 'B', qty: 2 }]);
  assert.equal(items.length, 2);
  assert.deepEqual(digabung, []);
});

console.log('\n== §3 Harga: nota supplier ==');

uji('harga ikut dijumlahkan kalau SEMUA barisnya berharga', () => {
  const { items, digabung } = gabungDuplikat([
    { product_id: 'A', qty: 100, line_total: 5000 },
    { product_id: 'A', qty: 150, line_total: 7500 }
  ]);
  assert.equal(items[0].qty, 250);
  assert.equal(items[0].line_total, 12500);
  assert.equal(digabung[0].hargaHilang, false);
});

uji('harga DIKOSONGKAN kalau salah satu baris belum berharga', () => {
  // 100gr@Rp5.000 + 150gr@(kosong). Menjumlahkan begitu saja menghasilkan
  // 250gr seharga Rp5.000 — biaya per gram anjlok dari 50 ke 20, dan angka itu
  // masuk ke rata-rata biaya bahan seolah-olah pembelian sungguhan.
  const { items, digabung } = gabungDuplikat([
    { product_id: 'A', qty: 100, line_total: 5000 },
    { product_id: 'A', qty: 150, line_total: null }
  ]);
  assert.equal(items[0].qty, 250);
  assert.equal(items[0].line_total, null, 'harga separuh jauh lebih berbahaya daripada harga kosong');
  assert.notEqual(items[0].line_total, 5000);
  assert.equal(digabung[0].hargaHilang, true, 'layar harus bisa memberitahu bahwa harganya perlu diisi ulang');
});

uji('harga string kosong diperlakukan sama dengan null', () => {
  const { items } = gabungDuplikat([
    { product_id: 'A', qty: 1, line_total: 5000 },
    { product_id: 'A', qty: 1, line_total: '' }
  ]);
  assert.equal(items[0].line_total, null);
});

uji('kedua barisnya tanpa harga: hasilnya tetap kosong, bukan nol', () => {
  const { items, digabung } = gabungDuplikat([
    { product_id: 'A', qty: 1, line_total: null },
    { product_id: 'A', qty: 1, line_total: null }
  ]);
  assert.equal(items[0].line_total, null, 'nol berarti GRATIS; kosong berarti belum tahu');
  assert.notEqual(items[0].line_total, 0);
  assert.equal(digabung[0].hargaHilang, true);
});

uji('order & surat jalan tidak tiba-tiba membawa kolom line_total', () => {
  const { items, digabung } = gabungDuplikat([
    { product_id: 'A', qty: 100 },
    { product_id: 'A', qty: 150 }
  ]);
  assert.ok(!('line_total' in items[0]) || items[0].line_total === undefined);
  assert.equal(digabung[0].hargaHilang, false, 'dokumen tanpa harga tidak boleh melaporkan harga hilang');
});

console.log('\n== §4 Pesannya menyebut nama & jumlah ==');

uji('pesan menyebut nama bahan dan jumlah yang sudah ada', () => {
  const p = pesanDuplikat('Wortel', 100, 'GR');
  assert.ok(p.includes('Wortel'), p);
  assert.ok(p.includes('100'), p);
  assert.ok(p.includes('GR'), p);
});

uji('tanpa jumlah pun pesannya tetap masuk akal', () => {
  const p = pesanDuplikat('Wortel', null, 'GR');
  assert.ok(p.includes('Wortel'));
  assert.ok(!p.includes('null'), p);
});

uji('nama kosong tidak menghasilkan kalimat menggantung', () => {
  const p = pesanDuplikat('', 5, '');
  assert.ok(!p.startsWith(' '), p);
  assert.ok(p.length > 20, p);
});

console.log(`\n${lulus} pemeriksaan lulus.`);
if (process.exitCode) console.error('ADA YANG GAGAL.');
