/**
 * TES: keterangan satuan beli di pemilih barang.
 *
 * Yang dijaga: angka pengalinya benar dan datang dari `purchase_qty` (bukan
 * ditebak dari namanya), keterangan yang tidak berguna tidak ditampilkan, dan
 * — yang paling penting — PENCARIAN tetap hanya mencocokkan nama barang.
 */
import assert from 'node:assert/strict';
import { hintSatuanBeli, jumlahKecil } from '../js/modules/product/satuan-beli.js';
import { teksOpsi, fuzzyMatch } from '../js/core/ui.js';

let n = 0;
const ok = (nama) => {
  n += 1;
  console.log(`  ✔ ${nama}`);
};

const plastik = { name: 'Plastik Pex Bawang Uk.10X30', base_unit: 'pcs', purchase_unit: 'PACK@100PCS', purchase_qty: 100 };

console.log('§1 Bentuk keterangannya');

assert.equal(hintSatuanBeli(plastik), '1 PACK@100PCS = 100 pcs');
ok('1 PACK@100PCS = 100 pcs');

assert.equal(
  hintSatuanBeli({ name: 'Plastik Pex Bawang Uk.15X33', base_unit: 'pcs', purchase_unit: 'PACK@62PCS', purchase_qty: 62 }),
  '1 PACK@62PCS = 62 pcs'
);
ok('isi 62 ikut terbaca — angkanya dari purchase_qty, bukan dari nama satuannya');

// Nama satuan beli diketik manusia dan TIDAK bisa dipercaya memuat angkanya.
// Yang menentukan pengali selalu kolom `purchase_qty`.
assert.equal(hintSatuanBeli({ base_unit: 'pcs', purchase_unit: 'DUS', purchase_qty: 24 }), '1 DUS = 24 pcs');
assert.equal(hintSatuanBeli({ base_unit: 'gr', purchase_unit: 'KARUNG', purchase_qty: 25000 }), '1 KARUNG = 25000 gr');
ok('satuan beli tanpa angka di namanya ("DUS", "KARUNG") tetap menyebut isinya');

// Angka yang bertentangan dengan nama TIDAK diperbaiki diam-diam: yang
// ditampilkan `purchase_qty`, apa adanya. Kalau salah, salahnya terlihat di
// layar — jauh lebih baik daripada layar yang menyembunyikannya.
assert.equal(hintSatuanBeli({ base_unit: 'pcs', purchase_unit: 'PACK@100PCS', purchase_qty: 50 }), '1 PACK@100PCS = 50 pcs');
ok('isi yang tidak cocok dengan namanya ditampilkan apa adanya, bukan ditebak ulang');

assert.equal(hintSatuanBeli({ base_unit: 'gr', purchase_unit: 'BOTOL', purchase_qty: 1.5 }), '1 BOTOL = 1,5 gr');
assert.equal(hintSatuanBeli({ base_unit: 'kg', purchase_unit: 'SAK', purchase_qty: 22.5 }), '1 SAK = 22,5 kg');
ok('isi pecahan pakai koma, tanpa nol desimal yang tidak perlu');

console.log('\n§2 Yang sengaja TIDAK ditampilkan');

for (const [nama, p] of [
  ['tanpa satuan beli', { base_unit: 'gr' }],
  ['satuan beli kosong', { base_unit: 'gr', purchase_unit: '   ', purchase_qty: 100 }],
  ['isi belum diisi', { base_unit: 'pcs', purchase_unit: 'PACK' }],
  ['isi kosong', { base_unit: 'pcs', purchase_unit: 'PACK', purchase_qty: '' }],
  ['isi null', { base_unit: 'pcs', purchase_unit: 'PACK', purchase_qty: null }],
  ['isi nol', { base_unit: 'pcs', purchase_unit: 'PACK', purchase_qty: 0 }],
  ['isi negatif', { base_unit: 'pcs', purchase_unit: 'PACK', purchase_qty: -5 }],
  ['isi bukan angka', { base_unit: 'pcs', purchase_unit: 'PACK', purchase_qty: 'seratus' }],
  ['produknya null', null],
  ['produknya kosong', {}]
]) {
  assert.equal(hintSatuanBeli(p), '', `${nama} seharusnya tidak memberi keterangan`);
}
ok('data yang belum lengkap tampil polos — tidak ada peringatan di ratusan baris yang normal');

// `Number('')` dan `Number(null)` adalah 0, bukan NaN. Kalau tidak disaring
// lebih dulu, keduanya lolos sebagai isi 0 dan menghasilkan "= 0 pcs".
assert.equal(hintSatuanBeli({ base_unit: 'pcs', purchase_unit: 'PACK', purchase_qty: '' }), '');
ok('Number("") yang bernilai 0 tidak menyelinap jadi "= 0 pcs"');

// Satuan belinya sengaja BERBEDA dari satuan kecilnya di sini.
//
// Percobaan pertama memakai `BOTOL`/`botol`, dan pemeriksaan ini jadi tidak
// membuktikan apa pun: yang menahannya bukan aturan "isi 1" melainkan aturan
// "satuan beli = satuan kecil" di bawahnya. Sabotase yang mencabut aturan isi-1
// tetap lolos, karena penjaga sebelah kebetulan menangkapnya.
assert.equal(hintSatuanBeli({ base_unit: 'pcs', purchase_unit: 'PACK', purchase_qty: 1 }), '');
ok('isi 1 tidak dikatakan apa-apa — tidak ada yang perlu dikalikan');

// Datanya saling bertentangan: satuan belinya SAMA dengan satuan kecilnya tapi
// isinya bukan 1. Menampilkan "1 pcs = 100 pcs" akan mengajari staff mengalikan
// yang salah.
assert.equal(hintSatuanBeli({ base_unit: 'pcs', purchase_unit: 'pcs', purchase_qty: 100 }), '');
assert.equal(hintSatuanBeli({ base_unit: 'PCS', purchase_unit: 'pcs', purchase_qty: 100 }), '');
ok('satuan beli = satuan kecil tapi isi ≠ 1 tidak ditampilkan, bukan ditampilkan salah');

console.log('\n§3 Angka yang dimaksudkan');

assert.equal(jumlahKecil(plastik, 3), 300);
ok('beli 3 PACK@100PCS berarti 300 pcs — persis contoh yang diminta');

assert.equal(jumlahKecil(plastik, 1), 100);
assert.equal(jumlahKecil({ purchase_qty: 62 }, 2), 124);
ok('pengalinya konsisten dengan yang ditampilkan');

assert.equal(jumlahKecil({ base_unit: 'gr' }, 3), null);
assert.equal(jumlahKecil(plastik, ''), null);
assert.equal(jumlahKecil(plastik, null), null);
ok('tanpa data isi, tidak ada angka yang dikarang');

console.log('\n§4 Tampil vs cari — INI intinya');

assert.equal(teksOpsi({ label: 'Plastik Pex Bawang Uk.10X30 (pcs)', hint: '1 PACK@100PCS = 100 pcs' }), 'Plastik Pex Bawang Uk.10X30 (pcs) — 1 PACK@100PCS = 100 pcs');
ok('teks yang TAMPIL memuat keterangannya');

assert.equal(teksOpsi({ label: 'Gula (gr)' }), 'Gula (gr)');
assert.equal(teksOpsi({ label: 'Gula (gr)', hint: '   ' }), 'Gula (gr)');
assert.equal(teksOpsi({}), '');
ok('tanpa keterangan, teksnya persis labelnya');

// INILAH yang dijaga berkas ini.
//
// Pencarian mencocokkan `o.label`. Kalau suatu saat ia dialihkan ke teks yang
// tampil, mengetik "100" akan memunculkan SETIAP barang yang isi pack-nya 100 —
// dan kotak carinya berhenti menyaring apa pun tanpa satu pun error.
const daftar = [
  { label: 'Plastik Pex Bawang Uk.10X30 (pcs)', hint: '1 PACK@100PCS = 100 pcs' },
  { label: 'Plastik OPP Sendok (pcs)', hint: '1 PACK@100PCS = 100 pcs' },
  { label: 'Sarung Tangan Karet (pcs)', hint: '1 PACK@100PCS = 100 pcs' },
  { label: 'Sedotan Hitam 6 mm (pcs)', hint: '1 PACK@500PCS = 500 pcs' },
  { label: 'Gula Pasir 100 gram (gr)', hint: '' }
];

const lewatLabel = daftar.filter((o) => fuzzyMatch('100', o.label));
assert.deepEqual(lewatLabel.map((o) => o.label), ['Plastik Pex Bawang Uk.10X30 (pcs)', 'Gula Pasir 100 gram (gr)']);
ok('mengetik "100" lewat label: hanya yang NAMANYA memuat 100');

const lewatTampil = daftar.filter((o) => fuzzyMatch('100', teksOpsi(o)));
assert.equal(lewatTampil.length, 5);
ok('lewat teks tampil: KELIMA-LIMANYA cocok — inilah kerusakan yang dicegah');

assert.ok(lewatLabel.length < lewatTampil.length, 'kalau keduanya sama, pemeriksaan di atas tidak membuktikan apa pun');
ok('dan selisihnya nyata, bukan kebetulan');

// Nama barangnya sendiri tetap bisa dicari seperti biasa.
assert.equal(daftar.filter((o) => fuzzyMatch('sedotan', o.label)).length, 1);
assert.equal(daftar.filter((o) => fuzzyMatch('plastik', o.label)).length, 2);
ok('pencarian nama biasa tidak berubah');

console.log(`\n${n} pemeriksaan satuan beli lolos. ✅`);
