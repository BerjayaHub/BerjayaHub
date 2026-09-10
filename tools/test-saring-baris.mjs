/**
 * Tes pencarian nama bahan di dalam satu dokumen kiriman.
 *
 * Jalankan: node tools/test-saring-baris.mjs
 */

import assert from 'node:assert/strict';
import { normalTeks, cocokKata, barisCocok, ringkasSaringan } from '../js/modules/dispatch/saring-baris.js';

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

console.log('\n== §1 Kata kunci kosong tidak menyaring apa pun ==');

uji('kosong = semua cocok — itu keadaan awal tiap layar', () => {
  for (const k of ['', '   ', null, undefined]) {
    assert.equal(cocokKata('BAHAN CIRENG CRISPY', k), true, JSON.stringify(k));
  }
});

uji('tanda baca saja juga dianggap kosong', () => {
  assert.equal(cocokKata('Wortel', '---'), true);
});

console.log('\n== §2 Huruf besar-kecil & tanda baca diabaikan ==');

uji('nama huruf besar ketemu dengan ketikan huruf kecil', () => {
  assert.equal(cocokKata('BAHAN CIRENG CRISPY', 'cireng'), true);
});

uji('tanda hubung & spasi rangkap tidak menghalangi', () => {
  assert.equal(cocokKata('Bahan Cireng-Crispy', 'cireng crispy'), true);
  assert.equal(cocokKata('Selada   Romaine', 'selada romaine'), true);
});

uji('normalTeks membuang tanda baca dan merapikan spasi', () => {
  assert.equal(normalTeks('  BAHAN Cireng-Crispy!! '), 'bahan cireng crispy');
});

console.log('\n== §3 Cocok PER KATA, bukan sebagai satu potongan ==');

uji('urutan kata terbalik tetap ketemu', () => {
  // Orang mengetik "crispy cireng" untuk barang yang sama. Kalau dicocokkan
  // sebagai satu string utuh, ia tidak akan pernah menemukannya.
  assert.equal(cocokKata('BAHAN CIRENG CRISPY', 'crispy cireng'), true);
});

uji('SELURUH kata harus ada, bukan salah satu', () => {
  assert.equal(cocokKata('BAHAN CIRENG CRISPY', 'cireng ayam'), false);
});

uji('potongan kata di tengah nama tetap cocok', () => {
  assert.equal(cocokKata('Buah Pisang Uli', 'sang'), true);
});

uji('nama yang tidak berhubungan tidak cocok', () => {
  assert.equal(cocokKata('Selada Romaine', 'pisang'), false);
});

console.log('\n== §4 Indeks baris ==');

const nama = ['BAHAN CIRENG CRISPY', 'BAHAN FISH N CHIP', 'BAHAN CRISPY HONEY CHICKEN', 'Selada Romaine', 'Buah Pisang Uli'];

uji('mengembalikan INDEKS, bukan nilainya', () => {
  // Indeks yang dikembalikan, karena yang memanggil harus menyembunyikan baris
  // ke-n di DOM — bukan menggambar ulang daftarnya.
  assert.deepEqual(barisCocok(nama, 'crispy'), [0, 2]);
});

uji('tanpa kata kunci: semua indeks', () => {
  assert.deepEqual(barisCocok(nama, ''), [0, 1, 2, 3, 4]);
});

uji('tidak ada yang cocok: daftar kosong, bukan melempar', () => {
  assert.deepEqual(barisCocok(nama, 'tidak ada'), []);
});

uji('masukan bukan array tidak melempar', () => {
  for (const x of [null, undefined, 'bukan array', 7]) {
    assert.deepEqual(barisCocok(x, 'apa pun'), []);
  }
});

uji('nama kosong / null di daftar tidak mengacaukan indeksnya', () => {
  assert.deepEqual(barisCocok(['Wortel', null, '', 'Wortel Baby'], 'wortel'), [0, 3]);
});

console.log('\n== §5 Ringkasannya menyebut angka ==');

uji('tanpa pencarian: cukup jumlah totalnya', () => {
  assert.equal(ringkasSaringan(5, 5, ''), '5 bahan');
});

uji('dengan pencarian: berapa dari berapa', () => {
  assert.equal(ringkasSaringan(5, 2, 'crispy'), '2 dari 5 bahan');
});

uji('nol hasil MENEGASKAN bahwa sisanya disembunyikan, bukan hilang', () => {
  // Tabel yang tiba-tiba kosong terbaca seperti datanya lenyap — dan orang
  // yang menyimpulkan begitu akan menutup layarnya lalu mengetik ulang.
  const p = ringkasSaringan(5, 0, 'zzz');
  assert.ok(p.includes('zzz'), p);
  assert.ok(/disembunyikan, bukan hilang/i.test(p), p);
});

console.log(`\n${lulus} pemeriksaan lulus.`);
if (process.exitCode) console.error('ADA YANG GAGAL.');
