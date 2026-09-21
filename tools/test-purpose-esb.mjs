/**
 * TES: daftar pilihan Purpose untuk form Waste / Spoil.
 *
 * ============ DUA ATURAN YANG MENENTUKAN SEGALANYA ============
 *
 *   1. Ada daftarnya  -> WAJIB dipilih, dan yang tersimpan ejaan DARI DAFTAR.
 *   2. Tidak ada      -> kolomnya tidak muncul, kejadiannya tersimpan tanpa
 *                        Purpose, dan ekspor ESB yang menahannya nanti.
 *
 * Aturan kedua yang paling mudah dilanggar tanpa sengaja — dan pelanggarannya
 * berakibat paling besar: staff berdiri di dapur dengan barang rusak di tangan
 * dan tombol Simpan yang menolak, karena admin belum sempat mengimpor sebuah
 * berkas Excel.
 */
import assert from 'node:assert/strict';
import {
  opsiPurpose,
  purposeWajib,
  periksaPurpose,
  normalPurpose,
  PESAN_WAJIB,
  PESAN_BELUM_ADA_DAFTAR
} from '../js/modules/inventory/purpose-esb.js';

let n = 0;
const ok = (nama) => {
  n += 1;
  console.log(`  ✔ ${nama}`);
};

// Bentuknya persis baris `esb_master` hasil impor berkas Master Purpose ESB
// yang sungguhan — tiga baris, header di baris ke-6, kolom Purpose Account.
const MASTER = [
  { jenis: 'purpose', nama: 'Waste Kitchen', kode: '3', keterangan: 'COGS - Food' },
  { jenis: 'purpose', nama: 'Waste Bar', kode: '4', keterangan: 'COGS - Beverage' },
  { jenis: 'purpose', nama: 'Packaging Spoil', kode: '5', keterangan: 'COGS - Other' },
  // Baris berjenis lain tinggal di tabel yang sama.
  { jenis: 'item', nama: 'BERAS PREMIUM', kode: 'P1' },
  { jenis: 'supplier', nama: 'Pasar', kode: 'CK01' }
];

console.log('§1 Opsi dari daftar induk');

const opsi = opsiPurpose(MASTER);
assert.equal(opsi.length, 3);
// Baris berjenis LAIN tidak boleh ikut: satu tabel menampung semua daftar
// induk, dan nama produk yang menyelinap ke sini akan terbaca sebagai Purpose
// yang sah — lalu dipilih staff, lalu ditolak ESB.
assert.ok(!opsi.some((o) => o.value === 'BERAS PREMIUM' || o.value === 'Pasar'));
ok('hanya jenis purpose yang ikut — item & supplier tidak menyelinap');

assert.deepEqual(opsi.map((o) => o.value), ['Packaging Spoil', 'Waste Bar', 'Waste Kitchen']);
ok('diurut alfabetis, bukan urutan datangnya dari database');

// Purpose Account yang membedakan tiga nama yang mirip. Tanpa ia, yang memilih
// harus hafal mana yang COGS Food dan mana yang COGS Beverage.
assert.equal(opsi.find((o) => o.value === 'Waste Bar').hint, 'COGS - Beverage');
ok('Purpose Account ikut sebagai keterangan');

assert.deepEqual(opsiPurpose(null), []);
assert.deepEqual(opsiPurpose([]), []);
assert.deepEqual(opsiPurpose([{ jenis: 'purpose', nama: '   ' }]), []);
ok('masukan kosong & nama kosong tidak jadi opsi');

// Nama kembar beda huruf besar-kecil: yang PERTAMA menang. Kalau yang terakhir
// menang, ejaan yang dipakai jadi tergantung urutan baris dari database — dan
// urutan itu tidak dijanjikan siapa pun.
const kembar = opsiPurpose([
  { jenis: 'purpose', nama: 'Waste Bar' },
  { jenis: 'purpose', nama: 'WASTE  BAR' }
]);
assert.equal(kembar.length, 1);
assert.equal(kembar[0].value, 'Waste Bar');
ok('nama kembar jadi satu opsi, dan yang pertama yang menang');

console.log('\n§2 Wajib hanya kalau daftarnya ada');

assert.equal(purposeWajib(opsi), true);
assert.equal(purposeWajib([]), false);
assert.equal(purposeWajib(null), false);
ok('daftar kosong berarti tidak wajib — bukan wajib tapi mustahil');

console.log('\n§3 Pemeriksaan nilainya');

// INTI ATURAN KEDUA. Kalau ini salah, seluruh pencatatan waste mati di BU yang
// belum mengimpor daftarnya.
const tanpaDaftar = periksaPurpose('', []);
assert.equal(tanpaDaftar.boleh, true);
assert.equal(tanpaDaftar.nilai, null);
ok('INTI: tanpa daftar induk, kosong tetap boleh disimpan');

// Sisa isian dari daftar yang sempat termuat lalu hilang TIDAK ikut terkirim —
// nilai yang tidak berasal dari daftar mana pun cuma menumbuhkan ejaan liar.
assert.equal(periksaPurpose('Waste Gudang', []).nilai, null);
ok('tanpa daftar induk, nilai yang tersisa di kotak diabaikan, bukan dikirim');

const kosong = periksaPurpose('', opsi);
assert.equal(kosong.boleh, false);
assert.equal(kosong.sebab, PESAN_WAJIB);
assert.match(kosong.sebab, /COGS/);
ok('ada daftar tapi tidak dipilih: ditolak, dan alasannya menyebut akibatnya');

assert.equal(periksaPurpose('   ', opsi).boleh, false);
ok('spasi saja tidak dianggap terisi');

const salah = periksaPurpose('Waste Gudang', opsi);
assert.equal(salah.boleh, false);
assert.match(salah.sebab, /tidak ada di daftar/);
assert.match(salah.sebab, /Waste Gudang/);
ok('nilai di luar daftar ditolak, dan nilainya disebut');

// Yang dikembalikan ejaan DARI DAFTARNYA. Mengirim "waste bar" huruf kecil ke
// ESB akan ditolak di sana — di layar yang berbeda, berminggu-minggu kemudian.
const beda = periksaPurpose('  wASTE  bAR ', opsi);
assert.equal(beda.boleh, true);
assert.equal(beda.nilai, 'Waste Bar');
ok('INTI: yang tersimpan ejaan kanonik dari daftarnya, bukan yang diketik');

assert.equal(periksaPurpose(null, opsi).boleh, false);
assert.equal(periksaPurpose(undefined, opsi).boleh, false);
ok('null & undefined terbaca sebagai belum dipilih');

console.log('\n§4 Normalisasinya');

assert.equal(normalPurpose('  Waste   Bar '), 'waste bar');
assert.equal(normalPurpose(null), '');
ok('huruf besar-kecil & spasi rangkap disamakan');

// TIDAK membuang tanda baca. "COGS - Food" dan "COGS Food" adalah dua nilai
// yang berbeda bagi ESB, dan menyamakannya di sini berarti mengirim yang salah
// tanpa satu pun tanda.
assert.notEqual(normalPurpose('Waste-Kitchen'), normalPurpose('Waste Kitchen'));
ok('tanda baca TIDAK dibuang — ESB membedakannya');

console.log('\n§5 Kalimat untuk orangnya');

assert.match(PESAN_BELUM_ADA_DAFTAR, /tetap tersimpan/);
assert.match(PESAN_BELUM_ADA_DAFTAR, /Rekap Waste/);
ok('pesan "belum ada daftar" menyebut bahwa datanya aman DAN siapa yang membereskannya');

console.log(`\n${n} pemeriksaan Purpose ESB lolos. ✅`);
