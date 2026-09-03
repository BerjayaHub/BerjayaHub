/**
 * Tes: kotak "Cari nama" di Riwayat Stok (Admin Portal).
 *
 * Yang benar-benar diuji di sini bukan "pencarian bisa mencocokkan teks" —
 * itu sudah dijamin `cocokNama`. Yang diuji: DARI MANA namanya diambil.
 *
 * Baris riwayat milik produk yang sudah dihapus dari master masih tampil di
 * tabel dan masih menunjukkan namanya, karena namanya ikut di baris
 * pergerakannya sendiri. Kalau pencariannya mengambil nama dari master, baris
 * itu jadi tidak bisa dicari — terbaca di layar, tapi lenyap begitu diketik.
 */
import assert from 'node:assert/strict';
import { namaUntukCari } from '../js/modules/inventory/riwayat-cari.js';
import { cocokNama } from '../js/core/nama.js';

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

/** Baris seperti yang datang dari `listMovements()` + pelengkapan master. */
const barisNormal = {
  products: { name: 'Susu Full Cream', base_unit: 'ml' },
  produk: { name: 'Susu Full Cream', category: 'Dairy', subcategory: 'Cair' }
};

/** Produk sudah DIHAPUS dari master: `produk` null, nama tetap ada di baris. */
const barisProdukTerhapus = {
  products: { name: 'Topping Sauce Caramel', base_unit: 'ml' },
  produk: null
};

uji('nama biasa ketemu', () => {
  assert.equal(cocokNama(namaUntukCari(barisNormal), 'susu'), true);
});

uji('kategori ikut dicari, sama seperti kotak cari di tab Stok', () => {
  assert.equal(cocokNama(namaUntukCari(barisNormal), 'dairy'), true);
  assert.equal(cocokNama(namaUntukCari(barisNormal), 'cair'), true);
});

uji('bahan lain tidak ikut terbawa', () => {
  assert.equal(cocokNama(namaUntukCari(barisNormal), 'ayam'), false);
});

uji('INTI: baris produk yang sudah dihapus tetap bisa dicari dengan namanya', () => {
  // Inilah yang gagal kalau namanya diambil dari master (`r.produk.name`):
  // hasilnya string kosong, dan baris yang terlihat jelas di tabel tidak bisa
  // ditemukan dengan mengetik nama yang tertulis di barisnya sendiri.
  assert.equal(namaUntukCari(barisProdukTerhapus).trim(), 'Topping Sauce Caramel');
  assert.equal(cocokNama(namaUntukCari(barisProdukTerhapus), 'caramel'), true);
});

uji('spasi ganda & huruf besar tidak menghalangi (lewat bakukanNama)', () => {
  const r = { products: { name: 'Gula  Pasir' }, produk: null };
  assert.equal(cocokNama(namaUntukCari(r), 'gula pasir'), true);
});

uji('ketikan kosong berarti tidak menyaring apa pun', () => {
  assert.equal(cocokNama(namaUntukCari(barisNormal), ''), true);
  assert.equal(cocokNama(namaUntukCari(barisProdukTerhapus), '   '), true);
});

uji('baris tanpa nama di mana pun tidak melempar', () => {
  assert.equal(namaUntukCari({}), '');
  assert.equal(namaUntukCari(null), '');
  assert.equal(cocokNama(namaUntukCari({}), 'apa pun'), false);
});

uji('nama di baris pergerakan MENANG atas nama master kalau berbeda', () => {
  // Master boleh saja sudah diganti namanya; buku besar menunjukkan nama yang
  // berlaku SAAT pergerakan itu terjadi, dan pencarian harus mengikuti apa
  // yang tertulis di layar.
  const r = { products: { name: 'Susu UHT' }, produk: { name: 'Susu Full Cream', category: 'Dairy' } };
  assert.equal(cocokNama(namaUntukCari(r), 'uht'), true);
});

if (!process.exitCode) console.log(`Cari nama di Riwayat Stok: ${lulus} pemeriksaan lulus. ✅`);
