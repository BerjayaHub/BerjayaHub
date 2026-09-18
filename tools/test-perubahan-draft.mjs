/**
 * TES: selisih isi draft — apa yang BENAR-BENAR dikirim ke server.
 *
 * Yang dijaga: baris yang cuma TERLIHAT di layar tapi tidak diubah TIDAK ikut
 * dikirim. Mengirimnya sebagai upsert akan mengembalikan nilai lama ke baris
 * yang baru saja diubah HP sebelah — bug yang sama, cuma pindah dari tingkat
 * dokumen ke tingkat baris, dan jauh lebih sulit dilihat karena barisnya masih
 * ada di layar.
 */
import assert from 'node:assert/strict';
import { susunPerubahan, pesanGabung } from '../js/modules/dispatch/perubahan-draft.js';

let n = 0;
const ok = (nama) => {
  n += 1;
  console.log(`  ✔ ${nama}`);
};

const SIRUP = 'p-sirup';
const DAGING = 'p-daging';
const GULA = 'p-gula';

console.log('§1 Skenario aslinya');

// Kitchen membuka draft KOSONG, menambah daging.
const k = susunPerubahan([], [{ product_id: DAGING, qty: 5000 }]);
assert.deepEqual(k.ubah, [{ product_id: DAGING, qty: 5000 }]);
assert.deepEqual(k.hapus, []);
ok('dari daftar kosong: kirim tambahannya saja, tanpa hapus apa pun');

// Dan yang TIDAK dikirim itulah intinya: sirup milik Bar tidak pernah disebut,
// jadi tidak ada yang bisa menghapusnya.
assert.ok(!k.ubah.some((x) => x.product_id === SIRUP));
assert.ok(!k.hapus.includes(SIRUP));
ok('sirup milik HP sebelah tidak ikut disebut sama sekali');

console.log('\n§2 Baris yang cuma terlihat, tidak disentuh');

// INI yang membatalkan seluruh gunanya kalau salah.
//
// Layar Kitchen memegang Sirup 2000 (dimuat tadi) dan ia cuma menambah gula.
// Sirupnya TIDAK boleh ikut — kalau ikut, ia akan mengembalikan sirup ke 2000
// padahal Bar baru saja menaikkannya ke 3000.
const awal = [{ product_id: SIRUP, qty: 2000 }];
const sekarang = [
  { product_id: SIRUP, qty: 2000 },
  { product_id: GULA, qty: 500 }
];
const s = susunPerubahan(awal, sekarang);
assert.deepEqual(s.ubah, [{ product_id: GULA, qty: 500 }]);
assert.deepEqual(s.hapus, []);
ok('INTI: baris yang nilainya tidak berubah TIDAK dikirim');

// Tidak ada yang berubah sama sekali -> tidak ada yang dikirim.
const diam = susunPerubahan(awal, [{ product_id: SIRUP, qty: 2000 }]);
assert.deepEqual(diam.ubah, []);
assert.deepEqual(diam.hapus, []);
assert.equal(diam.adaPerubahan, false);
ok('membuka lalu menyimpan tanpa mengubah apa pun tidak mengirim apa pun');

// Angka yang sama tapi bertipe string tetap dianggap sama — kotak isian HTML
// mengembalikan string, sementara yang dimuat dari database berupa angka.
const tipe = susunPerubahan([{ product_id: SIRUP, qty: 2000 }], [{ product_id: SIRUP, qty: '2000' }]);
assert.deepEqual(tipe.ubah, []);
ok('"2000" dari kotak isian tidak dikira berbeda dari 2000 milik database');

console.log('\n§3 Yang benar-benar berubah');

const naik = susunPerubahan([{ product_id: SIRUP, qty: 2000 }], [{ product_id: SIRUP, qty: 3000 }]);
assert.deepEqual(naik.ubah, [{ product_id: SIRUP, qty: 3000 }]);
ok('jumlah yang diubah ikut dikirim');

console.log('\n§4 Menghapus disebut eksplisit');

const hapus = susunPerubahan(
  [
    { product_id: SIRUP, qty: 2000 },
    { product_id: DAGING, qty: 5000 }
  ],
  [{ product_id: DAGING, qty: 5000 }]
);
assert.deepEqual(hapus.hapus, [SIRUP]);
assert.deepEqual(hapus.ubah, []);
ok('baris yang dibuang dari layar masuk daftar hapus');

// Kalau "tidak disebut" berarti "jangan sentuh", maka menghapus TIDAK bisa
// dinyatakan dengan cara menghilangkannya begitu saja — dan itulah sebabnya
// daftar hapus ada. Aturan yang sama dengan `dicek_qty` di 0142.
const hapusSemua = susunPerubahan([{ product_id: SIRUP, qty: 1 }, { product_id: GULA, qty: 2 }], []);
assert.deepEqual(hapusSemua.hapus.sort(), [GULA, SIRUP].sort());
ok('mengosongkan seluruh daftar menyebut semuanya, bukan mengirim daftar kosong');

// Hapus lalu tambah lagi produk yang sama sebelum menyimpan: yang menang
// "ubah", bukan "hapus" — dan servernya memang menghapus dulu baru mengisi.
const balik = susunPerubahan([{ product_id: SIRUP, qty: 2000 }], [{ product_id: SIRUP, qty: 2000 }]);
assert.deepEqual(balik.hapus, []);
ok('menghapus lalu menambahkannya kembali = tidak ada perubahan');

console.log('\n§5 Qty nol & masukan aneh');

// Di draft order, nol tidak punya arti: "pesan 0 sirup" sama dengan tidak
// memesannya. (Berbeda dari surat jalan, tempat "dikirim 0" adalah jawaban.)
const nol = susunPerubahan([{ product_id: SIRUP, qty: 2000 }], [{ product_id: SIRUP, qty: 0 }]);
assert.deepEqual(nol.hapus, [SIRUP]);
assert.deepEqual(nol.ubah, []);
ok('qty diubah jadi 0 berarti dihapus, bukan disimpan sebagai baris nol');

const kosong = susunPerubahan([], [{ product_id: SIRUP, qty: '' }, { product_id: '', qty: 5 }, { product_id: GULA, qty: null }]);
assert.deepEqual(kosong.ubah, []);
assert.deepEqual(kosong.hapus, []);
ok('baris tanpa id atau tanpa qty dilewati — bukan dikirim sebagai nol');

assert.deepEqual(susunPerubahan(null, null), { ubah: [], hapus: [], adaPerubahan: false });
assert.deepEqual(susunPerubahan(undefined, undefined), { ubah: [], hapus: [], adaPerubahan: false });
ok('masukan null/undefined tidak melempar');

// `Number('')` dan `Number(null)` adalah 0, bukan NaN — kalau tidak disaring,
// keduanya lolos sebagai qty 0 dan barisnya ikut terhapus diam-diam.
const spasi = susunPerubahan([{ product_id: SIRUP, qty: 2000 }], [{ product_id: SIRUP, qty: 2000 }, { product_id: GULA, qty: '' }]);
assert.deepEqual(spasi.ubah, []);
ok('kotak jumlah yang dibiarkan kosong tidak jadi baris ber-qty nol');

console.log('\n§6 Kalimat hasilnya');

// Tanpa kalimat ini, orangnya menyimpan dua baris lalu membuka draft dan
// menemukan enam — dan tebakan pertama yang wajar adalah "aplikasinya
// menggandakan pesananku".
const pesan = pesanGabung({ diubah: 2, dihapus: 0, total: 6 }, 2);
assert.match(pesan, /2 baris disimpan/);
assert.match(pesan, /6 baris/);
assert.match(pesan, /4 dari rekanmu/);
ok('menyebut berapa yang disimpan DAN berapa yang datang dari rekan');

const sendiri = pesanGabung({ diubah: 3, dihapus: 0, total: 3 }, 3);
assert.doesNotMatch(sendiri, /rekan/);
ok('tidak menyebut rekan kalau memang tidak ada — kalimat yang selalu muncul berhenti dibaca');

assert.match(pesanGabung({ diubah: 0, dihapus: 2, total: 1 }, 0), /2 dihapus/);
assert.match(pesanGabung({ diubah: 0, dihapus: 0, total: 0 }, 0), /Tidak ada yang berubah/);
ok('penghapusan & keadaan tanpa perubahan punya kalimatnya sendiri');

assert.match(pesanGabung(null, 0), /Tidak ada yang berubah/);
assert.match(pesanGabung({}, 0), /Tidak ada yang berubah/);
ok('hasil yang tidak terbaca dari server tidak melempar');

console.log(`\n${n} pemeriksaan selisih draft lolos. ✅`);
