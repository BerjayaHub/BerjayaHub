/**
 * TES: kolom Date berkas ESB berisi tanggal sungguhan.
 *
 * Yang dijaga: angkanya bilangan bulat tanpa sisa zona waktu, tanggal yang tidak
 * terbaca MENAHAN dokumennya alih-alih dikosongkan, dan format tampilannya
 * menempel di kolom Date — bukan di kolom sebelahnya.
 */
import assert from 'node:assert/strict';
import {
  serialTanggalExcel,
  pasangFormatTanggal,
  FORMAT_TANGGAL_EXCEL,
  KOLOM_TANGGAL
} from '../js/modules/inventory/tanggal-excel.js';
import { KOLOM_ESB, barisEsbPurchase, buatPeta } from '../js/modules/inventory/esb-purchase.js';
import { KOLOM_TRANSFER, barisEsbTransfer } from '../js/modules/inventory/esb-transfer.js';

let n = 0;
const ok = (nama) => {
  n += 1;
  console.log(`  ✔ ${nama}`);
};

console.log('§1 Nomor seri');

// Nilai patokannya diambil dari template ESB asli, bukan dari hitungan saya
// sendiri: C2 pada ESB_FNB_SIMPLE_PURCHASE_TEMPLATE dibaca openpyxl sebagai
// 1 September 2020, dan serialnya di berkas itu 44075.
assert.equal(serialTanggalExcel('2020-09-01'), 44075);
ok('1 Sep 2020 -> 44075, sama dengan sel C2 template resmi ESB');

assert.equal(serialTanggalExcel('2026-09-01'), 46266);
ok('1 Sep 2026 -> 46266');

// Ini inti persoalannya. `new Date(2026, 8, 1)` yang diserahkan ke SheetJS di
// zona Asia/Jakarta menghasilkan 46266.00013888889 — sisa 12 detik dari LMT
// Jakarta (+07:07:12). Sel yang bukan bilangan bulat adalah "1 Sep 2026 pukul
// 00:00:12", dan bagaimana ESB memperlakukan komponen jamnya tidak diketahui.
for (const t of ['2020-09-01', '2026-09-01', '2026-12-31', '1900-01-01', '2100-02-28']) {
  const s = serialTanggalExcel(t);
  assert.ok(Number.isInteger(s), `${t} menghasilkan ${s}, bukan bilangan bulat`);
}
ok('semuanya bilangan bulat — tidak ada sisa zona waktu yang ikut terbawa');

// Hasilnya tidak boleh bergantung pada zona waktu mesin yang membuatnya. Berkas
// yang sama harus keluar sama, dibuat dari laptop di Jakarta atau dari server
// mana pun.
const zonaAsli = process.env.TZ;
const hasilPerZona = [];
for (const tz of ['Asia/Jakarta', 'UTC', 'America/New_York', 'Pacific/Kiritimati']) {
  process.env.TZ = tz;
  hasilPerZona.push(serialTanggalExcel('2026-09-01'));
}
if (zonaAsli === undefined) delete process.env.TZ;
else process.env.TZ = zonaAsli;
assert.deepEqual(hasilPerZona, [46266, 46266, 46266, 46266]);
ok('hasilnya sama di Jakarta, UTC, New York dan Kiritimati');

// Satu hari = satu langkah. Titik nol yang bergeser satu hari tidak akan pernah
// terlihat salah — 31 Agustus tetap tanggal yang masuk akal untuk sebuah nota.
assert.equal(serialTanggalExcel('2026-09-02') - serialTanggalExcel('2026-09-01'), 1);
assert.equal(serialTanggalExcel('2026-03-01') - serialTanggalExcel('2026-02-28'), 1);
ok('selisih satu hari selalu 1, termasuk melewati akhir bulan');

console.log('\n§2 Yang ditolak');

for (const buruk of [null, undefined, '', '   ', 'kemarin', '01/09/2026', '1-9-2026', '2026/09/01', 20260901]) {
  assert.equal(serialTanggalExcel(buruk), null, `${JSON.stringify(buruk)} seharusnya ditolak`);
}
ok('bentuk selain YYYY-MM-DD ditolak, termasuk "01/09/2026"');

// "01/09/2026" ditolak, bukan ditebak. Menebaknya berarti memilih antara
// 1 September dan 9 Januari, dan tebakan itu tidak akan pernah terlihat salah
// di layar mana pun — ia cuma memindahkan pembelian ke bulan yang keliru.

assert.equal(serialTanggalExcel('2026-02-30'), null);
assert.equal(serialTanggalExcel('2025-02-29'), null);
assert.equal(serialTanggalExcel('2026-13-01'), null);
assert.equal(serialTanggalExcel('2026-00-10'), null);
ok('tanggal yang tidak ada ditolak, tidak digulirkan diam-diam ke bulan berikutnya');

assert.equal(serialTanggalExcel('2024-02-29'), 45351);
ok('29 Februari tahun kabisat tetap diterima');

assert.equal(serialTanggalExcel('1899-12-30'), null);
assert.equal(serialTanggalExcel('1800-01-01'), null);
ok('tanggal sebelum penanggalan Excel ditolak, bukan jadi angka nol/negatif');

assert.equal(serialTanggalExcel('2026-09-01T03:00:00Z'), 46266);
assert.equal(serialTanggalExcel('2026-09-01 10:00:00+07'), 46266);
ok('timestamp yang diawali YYYY-MM-DD dibaca harinya');

console.log('\n§3 Sel Purchase');

const petaLengkap = buatPeta([
  { jenis: 'branch', kunci: 'ab sentul', nilai: 'AB SENTUL' },
  { jenis: 'location', kunci: 'ab sentul', nilai: 'GUDANG SENTUL' },
  { jenis: 'payment_method', kunci: 'kas', nilai: 'CASH' },
  { jenis: 'coa', kunci: 'kas', nilai: '1101' },
  { jenis: 'item', kunci: 'beras', nilai: 'BERAS PREMIUM' },
  { jenis: 'unit', kunci: 'gr', nilai: 'GRAM' }
]);

const notaBaik = {
  id: 'n1',
  code: 'NT-001',
  receipt_date: '2026-09-01',
  supplier: 'Toko Berkah',
  outlet_name: 'AB Sentul',
  payment_status: 'lunas',
  payment_source: 'outlet'
};
const itemBeras = [{ product_name: 'Beras', base_unit: 'gr', qty: 5000, unit_cost: 36 }];

const iDate = KOLOM_ESB.indexOf('Date');
assert.equal(iDate, 2, 'kolom Date pindah — tes ini menguji kolom yang salah');

const p1 = barisEsbPurchase({
  notas: [notaBaik],
  itemsPerNota: new Map([['n1', itemBeras]]),
  peta: petaLengkap
});
assert.equal(p1.baris.length, 1);
assert.equal(p1.baris[0][iDate], 46266);
assert.equal(typeof p1.baris[0][iDate], 'number');
ok('nota berangkat dengan Date berupa angka 46266, bukan tulisan "2026-09-01"');

// Bukti bahwa bug lamanya benar-benar hilang: apa pun isinya, sel itu tidak
// boleh lagi berupa string tanggal.
assert.notEqual(p1.baris[0][iDate], '2026-09-01');
ok('tidak ada lagi string "2026-09-01" di kolom Date');

const p2 = barisEsbPurchase({
  notas: [{ ...notaBaik, receipt_date: null }],
  itemsPerNota: new Map([['n1', itemBeras]]),
  peta: petaLengkap
});
assert.equal(p2.baris.length, 0, 'nota tanpa tanggal seharusnya TERTAHAN');
assert.equal(p2.notaIds.length, 0);
assert.ok(
  p2.kurang.some((k) => k.jenis === 'tanggal' && k.nota.includes('NT-001')),
  'alasannya harus muncul di daftar kurang, lengkap dengan kode notanya'
);
ok('nota tanpa tanggal tertahan DAN alasannya terbaca — bukan diunduh dengan sel kosong');

// Kenapa ditahan, bukan dikosongkan: sel Date kosong tidak ditolak ESB, ia
// diisi tanggal unggah. Nota bulan lalu akan masuk sebagai pembelian hari ini.

const p3 = barisEsbPurchase({
  notas: [{ ...notaBaik, receipt_date: '2026-02-30' }],
  itemsPerNota: new Map([['n1', itemBeras]]),
  peta: petaLengkap
});
assert.equal(p3.baris.length, 0);
ok('nota bertanggal 30 Februari tertahan, bukan berangkat sebagai 2 Maret');

console.log('\n§4 Sel Transfer');

const iDateT = KOLOM_TRANSFER.indexOf('Date');
assert.equal(iDateT, 1, 'kolom Date transfer pindah — tes ini menguji kolom yang salah');

const kirimanBaik = {
  id: 'k1',
  code: 'SJ-001',
  received_at: '2026-09-01T03:00:00Z',
  from_outlet_name: 'AB Sentul',
  to_outlet_name: 'AB Sentul'
};
const t1 = barisEsbTransfer({
  kiriman: [kirimanBaik],
  itemsPerKiriman: new Map([['k1', [{ product_name: 'Beras', base_unit: 'gr', received_qty: 100 }]]]),
  peta: petaLengkap
});
assert.equal(t1.baris.length, 1);
assert.equal(t1.baris[0][iDateT], 46266);
ok('kiriman berangkat dengan Date berupa angka — Simple Transfer punya bug yang sama, dan ikut diperbaiki');

// Jam 23.30 WIB adalah 16.30 UTC di HARI yang sama, tapi jam 00.30 WIB adalah
// 17.30 UTC di hari SEBELUMNYA. Harinya wajib dipilih menurut waktu Jakarta —
// kalau tidak, kiriman sore hari tercatat mundur satu hari.
const t2 = barisEsbTransfer({
  kiriman: [{ ...kirimanBaik, received_at: '2026-09-01T17:30:00Z' }],
  itemsPerKiriman: new Map([['k1', [{ product_name: 'Beras', base_unit: 'gr', received_qty: 100 }]]]),
  peta: petaLengkap
});
assert.equal(t2.baris[0][iDateT], 46267, '01 Sep 17.30 UTC = 02 Sep 00.30 WIB');
ok('harinya dipilih menurut waktu Jakarta, bukan UTC mentah');

const t3 = barisEsbTransfer({
  kiriman: [{ ...kirimanBaik, received_at: null }],
  itemsPerKiriman: new Map([['k1', [{ product_name: 'Beras', base_unit: 'gr', received_qty: 100 }]]]),
  peta: petaLengkap
});
assert.equal(t3.baris.length, 0);
assert.ok(t3.kurang.some((k) => k.jenis === 'tanggal-terima'));
ok('kiriman tanpa tanggal terima tetap tertahan');

console.log('\n§5 Format tampilan');

const alamat = (c, r) => `${String.fromCharCode(65 + c)}${r + 1}`;
const ws = {
  A1: { v: 'Sequence', t: 's' },
  B1: { v: 'Supplier', t: 's' },
  C1: { v: 'Date', t: 's' },
  A2: { v: 1, t: 'n' },
  B2: { v: 'Toko Berkah', t: 's' },
  C2: { v: 46266, t: 'n' },
  C3: { v: 46267, t: 'n' }
};
const dipasang = pasangFormatTanggal(ws, ['Sequence', 'Supplier', 'Date'], 2, alamat);
assert.equal(dipasang, 2);
assert.equal(ws.C2.z, FORMAT_TANGGAL_EXCEL);
assert.equal(ws.C3.z, FORMAT_TANGGAL_EXCEL);
ok('setiap sel data di kolom Date diberi format');

assert.equal(ws.A2.z, undefined);
assert.equal(ws.B2.z, undefined);
ok('kolom lain tidak ikut diberi format tanggal');

assert.equal(ws.C1.z, undefined);
ok('baris header tidak diformat — "Date" sebagai tanggal akan tampil sebagai sesuatu yang lain');

// Indeksnya diturunkan dari daftar judul. Kolom yang ditambah di depan tidak
// boleh membuat formatnya menempel di kolom sebelahnya.
const ws2 = { B2: { v: 46266, t: 'n' }, C2: { v: 9, t: 'n' } };
pasangFormatTanggal(ws2, ['Sequence', KOLOM_TANGGAL, 'Qty'], 1, alamat);
assert.equal(ws2.B2.z, FORMAT_TANGGAL_EXCEL);
assert.equal(ws2.C2.z, undefined);
ok('posisi kolomnya dicari lewat judul, bukan ditulis sebagai angka tetap');

const ws3 = { A2: { v: 1, t: 'n' } };
assert.equal(pasangFormatTanggal(ws3, ['Sequence', 'Qty'], 1, alamat), 0);
ok('daftar tanpa kolom Date tidak membuat apa pun diformat');

const ws4 = { A2: { v: '', t: 's' } };
pasangFormatTanggal(ws4, ['Date'], 1, alamat);
assert.equal(ws4.A2.z, undefined);
ok('sel kosong dilewati — kalau tidak, ia tampil sebagai "00/01/1900"');

console.log(`\n${n} pemeriksaan tanggal ESB lolos. ✅`);
