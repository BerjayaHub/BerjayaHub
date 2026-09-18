/**
 * TES: daftar master supplier di Admin Portal.
 *
 * Yang dijaga: keempat status bisa dibedakan, yang MENGHAMBAT naik ke atas, dan
 * satu nama tidak pernah muncul dua kali — ejaan lama yang dipetakan dan nama
 * ESB tujuannya adalah satu supplier, bukan dua.
 */
import assert from 'node:assert/strict';
import { susunDaftarSupplier, ringkasStatus, pesanRingkas, LABEL_STATUS, STATUS_MENGHAMBAT } from '../js/modules/inventory/daftar-supplier.js';
import { petaEjaanSupplier } from '../js/modules/inventory/cocok-supplier.js';

let n = 0;
const ok = (nama) => {
  n += 1;
  console.log(`  ✔ ${nama}`);
};

const MASTER = [
  { jenis: 'supplier', nama: 'Pasar', kode: 'CK01' },
  { jenis: 'supplier', nama: 'Toko Beras Ridho', kode: 'CK11' },
  { jenis: 'supplier', nama: 'PD. Es Cristal Glass', kode: 'CK16' },
  { jenis: 'supplier', nama: 'Hypermart', kode: 'CK09' },
  { jenis: 'item', nama: 'BERAS PREMIUM', kode: 'X1' }
];
const EJAAN = petaEjaanSupplier([{ jenis: 'supplier', kunci: 'PD Es Cristal Glass', nilai: 'PD. Es Cristal Glass' }]);

const TERPAKAI = [
  { nama: 'Pasar', jumlah: 50, belum_ekspor: 2 },
  { nama: 'PD Es Cristal Glass', jumlah: 9, belum_ekspor: 9 },
  { nama: 'Toko Sebelah', jumlah: 3, belum_ekspor: 3 },
  { nama: 'Warung Ujung', jumlah: 40, belum_ekspor: 0 }
];

console.log('§1 Empat status');

const daftar = susunDaftarSupplier(MASTER, TERPAKAI, EJAAN);
const per = Object.fromEntries(daftar.map((b) => [b.nama, b]));

assert.equal(per['Pasar'].status, 'cocok');
ok('nama yang ada di ESB dan dipakai nota: cocok');

assert.equal(per['PD Es Cristal Glass'].status, 'dipetakan');
assert.equal(per['PD Es Cristal Glass'].namaEsb, 'PD. Es Cristal Glass');
ok('ejaan lama yang sudah dipetakan menyebut nama tujuannya');

assert.equal(per['Toko Sebelah'].status, 'belum-terdaftar');
assert.equal(per['Toko Sebelah'].namaEsb, null);
ok('dipakai nota tapi tidak ada di ESB: belum-terdaftar');

assert.equal(per['Hypermart'].status, 'belum-terpakai');
ok('ada di ESB tapi belum pernah dipakai: belum-terpakai');

// Baris berjenis LAIN tidak boleh ikut. Satu tabel menampung semua daftar
// induk, dan nama produk yang menyelinap ke sini akan terbaca sebagai supplier
// yang sah — lalu dipilih orang di layar nota.
assert.ok(!per['BERAS PREMIUM']);
ok('baris berjenis item tidak ikut masuk');

console.log('\n§2 Satu nama, satu baris');

// "PD. Es Cristal Glass" (nama ESB) TIDAK boleh muncul lagi sebagai
// "belum-terpakai" — ia memang sedang dipakai, lewat ejaan lain. Tanpa
// penjagaan ini, satu supplier tampil dua kali dengan status berlawanan.
assert.ok(!per['PD. Es Cristal Glass'], 'nama ESB tujuannya muncul dua kali');
ok('nama ESB yang dipakai lewat ejaan lain tidak muncul sebagai "belum dipakai"');

const nama = daftar.map((b) => b.nama);
assert.equal(new Set(nama).size, nama.length);
ok('tidak ada nama kembar di seluruh daftar');

// 4 nama yang dipakai nota + 2 sisa daftar ESB yang belum tersentuh
// (Toko Beras Ridho, Hypermart). "PD. Es Cristal Glass" TIDAK ikut sebagai
// sisa — ia sudah terwakili oleh ejaan yang dipetakan kepadanya.
assert.equal(daftar.length, 6);
ok('4 nama terpakai + 2 sisa daftar ESB = 6 baris, tanpa nama tujuan yang kembar');

console.log('\n§3 Kode ESB');

assert.equal(per['Pasar'].kode, 'CK01');
ok('kode diambil dari baris ESB-nya');

// Untuk ejaan yang DIPETAKAN, kode yang benar milik nama TUJUANNYA.
// Mengosongkannya akan terbaca sebagai "belum terdaftar" padahal sudah
// dijembatani.
assert.equal(per['PD Es Cristal Glass'].kode, 'CK16');
ok('ejaan yang dipetakan memakai kode nama tujuannya, bukan kosong');

assert.equal(per['Toko Sebelah'].kode, '');
ok('yang belum terdaftar tidak punya kode — tidak dikarang');

console.log('\n§4 Urutan mendahulukan pekerjaan');

// Dengan 35 supplier, satu nama yang menahan ekspor bisa ada di baris ke-30
// dan tidak pernah terbaca.
assert.equal(daftar[0].status, 'belum-terdaftar');
assert.equal(daftar[daftar.length - 1].status, 'belum-terpakai');
ok('yang menghambat di atas, yang tidak dipakai di bawah');

const banyak = susunDaftarSupplier(
  [{ jenis: 'supplier', nama: 'A', kode: '1' }],
  [
    { nama: 'X', jumlah: 1, belum_ekspor: 1 },
    { nama: 'Y', jumlah: 90, belum_ekspor: 0 },
    { nama: 'Z', jumlah: 5, belum_ekspor: 5 }
  ]
);
assert.deepEqual(banyak.slice(0, 3).map((b) => b.nama), ['Z', 'X', 'Y']);
ok('di antara yang sama-sama menghambat, yang paling banyak tertahan didahulukan');

console.log('\n§5 Ringkasan & kalimatnya');

const r = ringkasStatus(daftar);
assert.equal(r.cocok, 1);
assert.equal(r.dipetakan, 1);
assert.equal(r['belum-terdaftar'], 2);
assert.equal(r['belum-terpakai'], 2);
assert.equal(r.total, 6);
ok('hitungan per status benar');

assert.equal(STATUS_MENGHAMBAT, 'belum-terdaftar');
assert.equal(Object.keys(LABEL_STATUS).length, 4);
ok('keempat status punya label, dan yang menghambat disebut satu kali di satu tempat');

assert.match(pesanRingkas(r, false), /2 nama supplier/);
assert.match(pesanRingkas(r, false), /tertahan/);
ok('kalimatnya menyebut berapa dan akibatnya');

assert.match(pesanRingkas({ 'belum-terdaftar': 0 }, false), /sudah cocok/);
ok('tidak ada yang menghambat: kalimatnya berubah, bukan tetap menakut-nakuti');

assert.match(pesanRingkas(r, true), /belum diimpor/);
assert.match(pesanRingkas(r, true), /Master Supplier/);
ok('daftar ESB yang belum diimpor punya kalimatnya sendiri, lengkap dengan cara mengisinya');

console.log('\n§6 Masukan aneh');

assert.deepEqual(susunDaftarSupplier(null, null), []);
assert.deepEqual(susunDaftarSupplier([], []), []);
ok('masukan kosong tidak melempar');

const spasi = susunDaftarSupplier(
  [{ jenis: 'supplier', nama: '  Pasar  ', kode: 'CK01' }],
  [{ nama: 'pasar', jumlah: 1, belum_ekspor: 0 }]
);
assert.equal(spasi.length, 1);
assert.equal(spasi[0].status, 'cocok');
ok('beda huruf besar-kecil & spasi tetap satu supplier yang sama');

const kosong = susunDaftarSupplier([{ jenis: 'supplier', nama: '   ' }], [{ nama: '  ', jumlah: 2 }]);
assert.deepEqual(kosong, []);
ok('nama kosong tidak jadi baris');

assert.equal(ringkasStatus(null).total, 0);
assert.equal(ringkasStatus([{ status: 'ngawur' }]).total, 0);
ok('status yang tidak dikenal tidak ikut dihitung');

console.log(`\n${n} pemeriksaan daftar supplier lolos. ✅`);
