/**
 * TES: search-select — keterangan menolong MEMILIH, tidak ikut jadi NILAI.
 *
 * ============ BUG YANG DIJAGA BERKAS INI ============
 *
 * Pada field `allowCreate`, isi kotak teks ITULAH nilainya: `blur` menyalin
 * `input.value` ke input tersembunyi supaya nama yang diketik sendiri ikut
 * tersimpan. Begitu keterangan ikut ditempel ke kotaknya, keterangan itu ikut
 * jadi bagian nilainya.
 *
 * Yang terjadi di dialog Edit nota — kotaknya cukup DISENTUH lalu ditinggalkan,
 * tanpa mengetik apa pun:
 *
 *     sebelum : "CV BADANSA JAYA ABADI"
 *     sesudah : "CV BADANSA JAYA ABADI — kode ESB CK18"
 *
 * Daftarnya lalu menawarkan `+ Tambah "CV BADANSA JAYA ABADI — kode ESB CK18"`
 * seolah itu supplier yang berbeda. Notanya tersimpan dengan nama itu, dan
 * tertahan saat diekspor dengan alasan "supplier tidak dikenal" — untuk nota
 * yang tidak pernah diubah suppliernya oleh siapa pun.
 *
 * Diuji di DOM sungguhan (linkedom), bukan lewat pembacaan kode: yang rusak di
 * sini adalah INTERAKSInya, dan interaksi tidak bisa dibuktikan dengan regex.
 */
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';

const { window, document } = parseHTML('<!doctype html><html><body></body></html>');
globalThis.window = window;
globalThis.document = document;

const { renderSearchSelect, wireSearchSelect, teksOpsi } = await import('../js/core/ui.js');

let n = 0;
const ok = (nama) => {
  n += 1;
  console.log(`  ✔ ${nama}`);
};

const OPSI = [
  { value: 'CV BADANSA JAYA ABADI', label: 'CV BADANSA JAYA ABADI', hint: 'kode ESB CK18' },
  { value: 'AICE', label: 'AICE', hint: 'kode ESB CK19' },
  { value: 'Pasar', label: 'Pasar', hint: '' }
];

const pasang = (allowCreate, nilai = '') => {
  document.body.innerHTML = renderSearchSelect({ name: 's', options: OPSI, value: nilai, allowCreate });
  const w = document.querySelector('.search-select');
  wireSearchSelect(w, OPSI);
  return { w, input: w.querySelector('.ss-input'), hidden: w.querySelector('input[type="hidden"]') };
};
const sentuhLalu = async (input) => {
  input.dispatchEvent(new window.Event('focus'));
  input.dispatchEvent(new window.Event('blur'));
  // `blur` menunda 150ms supaya klik pada daftar sempat terbaca.
  await new Promise((r) => setTimeout(r, 250));
};

console.log('§1 allowCreate: kotak = nilai');

let a = pasang(true, 'CV BADANSA JAYA ABADI');
assert.equal(a.input.value, 'CV BADANSA JAYA ABADI');
assert.ok(!a.input.value.includes('kode ESB'), 'keterangan menempel di kotak yang merangkap nilai');
ok('kotaknya berisi NAMA saja, tanpa keterangan');

await sentuhLalu(a.input);
assert.equal(a.hidden.value, 'CV BADANSA JAYA ABADI');
ok('INTI: disentuh lalu ditinggalkan tanpa mengetik — nilainya tidak berubah');

a.input.dispatchEvent(new window.Event('focus'));
a.w.querySelector('li[data-val="AICE"]').dispatchEvent(new window.Event('mousedown', { bubbles: true }));
await sentuhLalu(a.input);
assert.equal(a.hidden.value, 'AICE');
assert.equal(a.input.value, 'AICE');
ok('memilih dari daftar menyimpan nama bersihnya');

a.input.value = 'Toko Baru Sekali';
a.input.dispatchEvent(new window.Event('input'));
await sentuhLalu(a.input);
assert.equal(a.hidden.value, 'Toko Baru Sekali');
ok('nama baru yang diketik sendiri tetap tersimpan apa adanya');

// Tawaran "+ Tambah" hanya muncul untuk nama yang BENAR-BENAR baru. Sebelum
// perbaikan, ia muncul untuk supplier yang sudah terdaftar — karena yang
// dibandingkan sudah tercemar keterangannya.
a.input.value = 'AICE';
a.input.dispatchEvent(new window.Event('input'));
assert.equal(a.w.querySelectorAll('li.ss-create').length, 0);
ok('nama yang sudah terdaftar tidak ditawari "+ Tambah"');

a.input.value = 'Warung Ujung';
a.input.dispatchEvent(new window.Event('input'));
assert.equal(a.w.querySelectorAll('li.ss-create').length, 1);
ok('nama yang memang baru tetap ditawari "+ Tambah"');

console.log('\n§2 Tanpa allowCreate: keterangan tetap tampil');

// Di pemilih barang, kotaknya BUKAN nilainya — nilainya id produk di input
// tersembunyi. Di sana keterangan satuan beli justru harus terlihat sesudah
// dipilih, karena saat itulah orangnya mengetik jumlahnya.
const b = pasang(false, 'AICE');
assert.equal(b.input.value, teksOpsi(OPSI[1]));
assert.ok(b.input.value.includes('kode ESB CK19'));
assert.equal(b.hidden.value, 'AICE');
ok('kotaknya memuat keterangan, nilainya tetap bersih');

await sentuhLalu(b.input);
assert.equal(b.hidden.value, 'AICE');
assert.ok(b.input.value.includes('kode ESB CK19'));
ok('disentuh lalu ditinggalkan: keduanya tidak berubah');

console.log('\n§3 Keterangan selalu tampil di DAFTARNYA');

for (const allowCreate of [true, false]) {
  const c = pasang(allowCreate);
  c.input.dispatchEvent(new window.Event('focus'));
  const li = c.w.querySelector('li[data-val="AICE"]');
  assert.ok(li.querySelector('.ss-hint'), `allowCreate=${allowCreate}: keterangan hilang dari daftar`);
  assert.equal(li.querySelector('.ss-hint').textContent, 'kode ESB CK19');
}
ok('daftarnya menampilkan keterangan di kedua mode — di sanalah ia menolong memilih');

const tanpaHint = pasang(true);
tanpaHint.input.dispatchEvent(new window.Event('focus'));
assert.equal(tanpaHint.w.querySelector('li[data-val="Pasar"]').querySelector('.ss-hint'), null);
ok('opsi tanpa keterangan tidak diberi baris kosong');

console.log('\n§4 Pencarian tetap pada nama');

const d = pasang(false);
d.input.value = 'CK19';
d.input.dispatchEvent(new window.Event('input'));
// Keterangan memuat angka; mencocokkannya akan membuat mengetik kode
// memunculkan barang yang tidak bernama kode itu.
assert.equal(d.w.querySelectorAll('li[data-val]').length, 0);
ok('mengetik kode ESB tidak memunculkan apa pun — pencarian tetap pada nama');

d.input.value = 'aice';
d.input.dispatchEvent(new window.Event('input'));
assert.equal(d.w.querySelectorAll('li[data-val="AICE"]').length, 1);
ok('pencarian nama biasa tetap jalan');

console.log(`\n${n} pemeriksaan search-select lolos. ✅`);
