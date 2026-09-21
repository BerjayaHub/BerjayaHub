/**
 * TES: template kode SKU — unduh berisi, isi di Excel, unggah kembali.
 *
 * ============ DUA ATURAN YANG MENENTUKAN SEGALANYA ============
 *
 *   1. Dicocokkan lewat ID, bukan nama. Nama berubah di antara unduh dan
 *      unggah — orang membetulkan ejaan, dan dua produk bisa bernama sama.
 *   2. Sel kosong berarti "jangan diapa-apakan", BUKAN "hapus kodenya".
 *
 * Melanggar yang kedua adalah cara paling senyap membuang pekerjaan: unggahan
 * berikutnya menghapus ratusan kode yang sudah diisi, dan tidak ada satu pun
 * pesan yang menandakannya.
 */
import assert from 'node:assert/strict';
import {
  KOLOM_SKU,
  KOL_ID,
  KOL_SKU,
  barisTemplateSku,
  bacaTemplateSku,
  susunPerubahanSku,
  pesanPerubahanSku,
  normalSku
} from '../js/modules/product/sku-template.js';

let n = 0;
const ok = (nama) => {
  n += 1;
  console.log(`  ✔ ${nama}`);
};

const PRODUK = [
  { id: 'p1', name: 'Gula Pasir', product_type: 'raw', category: 'Dry Food', base_unit: 'gr', sku: 'BCK-001' },
  { id: 'p2', name: 'Beras Premium', product_type: 'raw', category: 'Dry Food', base_unit: 'gr', sku: null },
  { id: 'p3', name: 'Sirup Gula', product_type: 'semi', category: 'Olahan', base_unit: 'ml' },
  { id: 'p4', name: 'Es Kopi Susu', product_type: 'finished', category: 'Minuman', base_unit: 'gelas' },
  // Nonaktif: notanya yang lama masih perlu diekspor, jadi kodenya tetap perlu benar.
  { id: 'p5', name: 'Kayu Manis', product_type: 'raw', category: 'Bumbu', base_unit: 'gr', is_active: false }
];
const petaProduk = new Map(PRODUK.map((p) => [p.id, p]));

console.log('§1 Berkas yang diunduh');

const baris = barisTemplateSku(PRODUK);
assert.equal(KOLOM_SKU.length, 6);
assert.equal(KOLOM_SKU[KOL_ID], 'ID (jangan diubah)');
assert.equal(KOLOM_SKU[KOL_SKU], 'Kode SKU (ESB)');
ok('enam kolom, dan posisi ID & SKU diturunkan dari judulnya');

// MENU tidak ikut: ia tidak pernah masuk nota pembelian maupun jurnal waste
// bahan, jadi kodenya tidak dipakai di mana pun dan cuma memanjangkan daftar
// yang harus diisi tangan.
assert.ok(!baris.some((r) => r[1] === 'Es Kopi Susu'));
assert.equal(baris.length, 4);
ok('menu tidak ikut — kodenya tidak dipakai di mana pun');

// NONAKTIF ikut: notanya yang lama masih perlu diekspor.
assert.ok(baris.some((r) => r[1] === 'Kayu Manis'));
ok('produk nonaktif tetap ikut — nota lamanya masih perlu diekspor');

const gula = baris.find((r) => r[1] === 'Gula Pasir');
assert.equal(gula[KOL_ID], 'p1');
assert.equal(gula[KOL_SKU], 'BCK-001');
ok('kode yang SUDAH ada ikut terunduh — bukan kolom kosong yang harus diisi ulang');

assert.equal(baris.find((r) => r[1] === 'Beras Premium')[KOL_SKU], '');
ok('yang belum berkode tampil kosong, bukan "null"');

assert.equal(gula[2], 'Bahan Baku');
ok('tipe ditulis dengan kata, bukan kode program');

assert.deepEqual(barisTemplateSku(null), []);
assert.deepEqual(barisTemplateSku([{ name: 'tanpa id' }]), []);
ok('masukan aneh & baris tanpa id tidak ikut');

console.log('\n§2 Membaca berkas yang diunggah');

const sheet = (rows) => [KOLOM_SKU, ...rows];

const dibaca = bacaTemplateSku(sheet([['p1', 'Gula Pasir', 'Bahan Baku', '', 'gr', 'BCK-001'], ['p2', 'Beras', '', '', '', 'BCK-002']]));
assert.deepEqual(dibaca.baris, [
  { id: 'p1', sku: 'BCK-001' },
  { id: 'p2', sku: 'BCK-002' }
]);
ok('dua baris terbaca');

// Header DICARI, bukan diasumsikan di baris pertama. Orang menambahkan judul,
// dan pembacaan yang mengunci nomor baris akan mengisi kode milik produk lain.
const berjudul = bacaTemplateSku([['Daftar Kode SKU'], [], ...sheet([['p1', '', '', '', '', 'X-1']])]);
assert.deepEqual(berjudul.baris, [{ id: 'p1', sku: 'X-1' }]);
ok('INTI: header dicari, jadi baris judul tambahan tidak menggeser datanya');

// Kolom yang urutannya diacak orang tetap terbaca — yang dicari JUDULNYA.
const diacak = bacaTemplateSku([
  ['Kode SKU (ESB)', 'Nama', 'ID (jangan diubah)'],
  ['Z-9', 'Gula', 'p1']
]);
assert.deepEqual(diacak.baris, [{ id: 'p1', sku: 'Z-9' }]);
ok('kolom yang dipindah orang tetap terbaca lewat judulnya');

assert.throws(() => bacaTemplateSku([['Nama', 'Harga'], ['Gula', 1]]), /tidak ditemukan/);
assert.throws(() => bacaTemplateSku(null), /tidak ditemukan/);
ok('berkas yang salah ditolak dengan alasan yang bisa ditindaklanjuti');

// Baris berkode TANPA id: orang menambahkan produk baru di bawah daftarnya.
// Fitur ini mengisi kode, tidak membuat produk — dan itu DIKATAKAN.
const ditambah = bacaTemplateSku(sheet([['', 'Produk Baru', '', '', '', 'X-99'], ['p1', 'Gula', '', '', '', 'A-1']]));
assert.equal(ditambah.tanpaId, 1);
assert.deepEqual(ditambah.baris, [{ id: 'p1', sku: 'A-1' }]);
ok('INTI: baris tanpa ID dihitung & dilaporkan, bukan hilang tanpa jejak');

// Baris kosong di ujung sheet (Excel sering menyisakannya) tidak dihitung.
assert.equal(bacaTemplateSku(sheet([['', '', '', '', '', '']])).tanpaId, 0);
ok('baris kosong di ujung sheet tidak dilaporkan sebagai masalah');

const spasi = bacaTemplateSku(sheet([['  p1  ', '', '', '', '', '  BCK-001  ']]));
assert.deepEqual(spasi.baris, [{ id: 'p1', sku: 'BCK-001' }]);
ok('spasi tepi hasil salin-tempel dirapikan');

console.log('\n§3 Hanya yang BERUBAH yang dikirim');

const hasil = susunPerubahanSku(
  [
    { id: 'p1', sku: 'BCK-001' }, // sama
    { id: 'p2', sku: 'BCK-002' }, // baru
    { id: 'p3', sku: '' }, // dikosongkan
    { id: 'p9', sku: 'X-1' } // produknya tidak ada
  ],
  petaProduk
);
assert.deepEqual(hasil.ubah, [{ id: 'p2', sku: 'BCK-002' }]);
assert.equal(hasil.sama, 1);
ok('yang nilainya sudah sama tidak ikut dikirim');

// INTI ATURAN KEDUA.
assert.equal(hasil.kosong, 1);
assert.ok(!hasil.ubah.some((u) => u.id === 'p3'));
ok('INTI: sel kosong dilewati — BUKAN perintah menghapus kode');

assert.deepEqual(hasil.asing, ['p9']);
ok('baris yang produknya sudah tidak ada dilaporkan, bukan ditelan');

// Beda huruf besar-kecil DIANGGAP berubah: kalau ESB menulisnya "BCK 25-0110",
// itulah yang harus tersimpan. Menganggapnya sama membuat ejaan lama bertahan
// diam-diam, dan berkas ESB menolaknya nanti.
const besarKecil = susunPerubahanSku([{ id: 'p1', sku: 'bck-001' }], petaProduk);
assert.deepEqual(besarKecil.ubah, [{ id: 'p1', sku: 'bck-001' }]);
ok('beda huruf besar-kecil tetap dianggap perubahan — ejaan ESB yang menang');

console.log('\n§4 Kode kembar ditahan, bukan diserahkan ke database');

// Indeks unik di 0148 memang akan menolaknya, tapi terlambat: pesannya
// menyebut nama indeks, bukan dua produk mana yang bertabrakan — dan karena
// seluruhnya satu transaksi, satu bentrokan membatalkan 646 baris lain.
const kembar = susunPerubahanSku(
  [
    { id: 'p1', sku: 'SAMA' },
    { id: 'p2', sku: 'sama ' },
    { id: 'p3', sku: 'BEDA' }
  ],
  petaProduk
);
assert.deepEqual(kembar.ubah, [{ id: 'p3', sku: 'BEDA' }]);
assert.equal(kembar.kembar.length, 1);
assert.match(kembar.kembar[0], /Gula Pasir/);
assert.match(kembar.kembar[0], /Beras Premium/);
ok('INTI: dua baris berkode sama ditahan KEDUANYA, dan namanya disebut');

assert.equal(normalSku('  BCK-001 '), 'bck-001');
ok('kode disamakan sebelum dibandingkan — sama dengan aturan indeks unik 0148');

// Tanda baca TIDAK dibuang: "BCK-001" dan "BCK001" adalah dua kode berbeda
// bagi ESB, dan menyamakannya berarti menahan baris yang sebenarnya sah.
assert.notEqual(normalSku('BCK-001'), normalSku('BCK001'));
ok('tanda baca tidak dibuang — ESB membedakannya');

console.log('\n§5 Masukan aneh');

assert.deepEqual(susunPerubahanSku(null, null).ubah, []);
assert.deepEqual(susunPerubahanSku([], petaProduk).ubah, []);
assert.deepEqual(susunPerubahanSku([{ id: 'p1', sku: 'A' }], null).asing, ['p1']);
ok('masukan kosong tidak melempar');

// Produk yang `sku`-nya undefined (kolomnya belum ada di database) bukan
// berarti "sudah sama dengan string kosong".
const belumAdaKolom = susunPerubahanSku([{ id: 'p3', sku: 'A-1' }], petaProduk);
assert.deepEqual(belumAdaKolom.ubah, [{ id: 'p3', sku: 'A-1' }]);
ok('produk yang kolom sku-nya belum terisi tetap bisa diisi');

console.log('\n§6 Kalimat ringkasannya');

assert.match(pesanPerubahanSku(hasil, 0), /1 kode akan diisi/);
assert.match(pesanPerubahanSku(hasil, 0), /1 sudah sama/);
assert.match(pesanPerubahanSku(hasil, 0), /dibiarkan apa adanya/);
ok('menyebut berapa yang berubah, berapa yang sama, dan bahwa yang kosong dibiarkan');

assert.match(pesanPerubahanSku({ ubah: [] }, 0), /Tidak ada kode yang berubah/);
ok('nol perubahan dikatakan, bukan dibiarkan terbaca sebagai berhasil');

assert.match(pesanPerubahanSku({ ubah: [] }, 3), /tidak membuat produk/);
ok('baris tanpa ID menjelaskan batas fiturnya, bukan cuma jumlahnya');

console.log(`\n${n} pemeriksaan template kode SKU lolos. ✅`);
