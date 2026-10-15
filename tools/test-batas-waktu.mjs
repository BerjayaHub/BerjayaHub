/**
 * TES: batas waktu pemuatan layar.
 *
 *   §1 Yang selesai tepat waktu lewat apa adanya.
 *   §2 Yang MENGGANTUNG jadi galat yang bisa dibaca — bukan kerangka abadi.
 *   §3 Galat asli diteruskan apa adanya, tidak ditelan batas waktu.
 *   §4 `semuaDenganBatas` menyebut BAGIAN mana yang macet.
 *   §5 Timer dibersihkan; tidak ada penyelesaian ganda.
 */
import assert from 'node:assert/strict';
import {
  denganBatas,
  semuaDenganBatas,
  galatBatasWaktu,
  NAMA_GALAT_BATAS,
  BATAS_DETIK
} from '../js/core/batas-waktu.js';

let n = 0;
const ok = (nama) => {
  n += 1;
  console.log(`  ✔ ${nama}`);
};

// ============ TIMER PALSU ============
//
// Tes yang benar-benar tidur 25 detik adalah tes yang tidak pernah dijalankan
// siapa pun — dan tes yang tidak dijalankan tidak menjaga apa pun. Jadi
// timernya disuntikkan, dan di sini ia menyala segera.
const segera = (fn) => {
  const id = setTimeout(fn, 0);
  return id;
};
/** Timer yang TIDAK PERNAH menyala — untuk menguji jalur sukses. */
const takPernah = () => 0;

const menggantung = () => new Promise(() => {});
const tunggu = (ms, nilai) => new Promise((r) => setTimeout(() => r(nilai), ms));

console.log('§1 Yang selesai tepat waktu');

assert.equal(await denganBatas(Promise.resolve('siap'), { timer: takPernah }), 'siap');
assert.equal(await denganBatas(tunggu(5, 42), { timer: takPernah }), 42);
ok('nilai aslinya diteruskan utuh');

console.log('\n§2 Yang menggantung');

// ============ INI YANG MELAHIRKAN BERKAS ITU ============
//
// `await` yang tidak pernah selesai TIDAK melempar apa-apa, jadi `try/catch`
// tidak menangkap apa pun dan kerangka "Memuat…" bertahan selamanya. Layar
// yang terlihat sedang bekerja padahal tidak membuat orang MENUNGGU, bukan
// melapor — itu yang membuatnya mahal.
const e2 = await denganBatas(menggantung(), { detik: 7, apa: 'Daftar induk ESB', timer: segera }).then(
  () => null,
  (err) => err
);
assert.ok(e2, 'yang menggantung harus menjadi galat');
assert.equal(e2.name, NAMA_GALAT_BATAS);
ok('INTI: permintaan yang menggantung jadi galat, bukan menunggu selamanya');

// Pesannya harus menyebut BAGIAN yang macet dan BERAPA LAMA — tanpa keduanya,
// orang yang membacanya tidak tahu apa yang harus diperiksa berikutnya.
assert.match(e2.message, /Daftar induk ESB/);
assert.match(e2.message, /7 detik/);
assert.match(e2.message, /muat ulang/i);
ok('INTI: pesannya menyebut bagiannya, lamanya, dan apa yang bisa dilakukan');

console.log('\n§3 Galat asli tidak ditelan');

const asli = new Error('relation "esb_master" does not exist');
const e3 = await denganBatas(Promise.reject(asli), { timer: takPernah }).then(
  () => null,
  (err) => err
);
// Galat sungguhan jauh lebih berguna daripada "tidak selesai dalam 25 detik".
// Menggantinya dengan pesan batas waktu akan membuang satu-satunya keterangan
// yang menyebut sebabnya.
assert.equal(e3, asli);
assert.notEqual(e3.name, NAMA_GALAT_BATAS);
ok('INTI: galat sungguhan diteruskan apa adanya, bukan diganti pesan batas waktu');

console.log('\n§4 Bagian mana yang macet');

const e4 = await semuaDenganBatas(
  [
    { apa: 'Daftar induk ESB', janji: Promise.resolve([1]) },
    { apa: 'Supplier yang dipakai nota', janji: menggantung() },
    { apa: 'Daftar produk', janji: Promise.resolve([]) }
  ],
  { detik: 9, timer: segera }
).then(
  () => null,
  (err) => err
);
assert.ok(e4);
// Enam permintaan dimuat bersamaan. Tahu bahwa yang macet "Supplier yang
// dipakai nota" dan bukan "Daftar induk ESB" adalah bedanya antara satu menit
// dan satu sore.
assert.match(e4.message, /Supplier yang dipakai nota/);
assert.doesNotMatch(e4.message, /Daftar induk ESB/);
ok('INTI: yang dilaporkan adalah bagian yang MACET, bukan yang kebetulan pertama');

const hasil = await semuaDenganBatas(
  [
    { apa: 'A', janji: Promise.resolve('a') },
    { apa: 'B', janji: Promise.resolve('b') }
  ],
  { timer: takPernah }
);
assert.deepEqual(hasil, ['a', 'b']);
ok('urutan hasilnya tetap sesuai urutan bagiannya');

// Bagian tanpa `apa` tidak menghasilkan "undefined tidak selesai dimuat".
const e4b = await semuaDenganBatas([{ janji: menggantung() }], { detik: 3, timer: segera }).then(
  () => null,
  (err) => err
);
assert.match(e4b.message, /^Data tidak selesai/);
ok('bagian tanpa nama tidak menghasilkan "undefined" di layar');

assert.deepEqual(await semuaDenganBatas(null, { timer: takPernah }), []);
assert.deepEqual(await semuaDenganBatas(undefined, { timer: takPernah }), []);
ok('daftar bagian yang cacat tidak melempar');

console.log('\n§5 Tidak ada penyelesaian ganda');

// Promise yang selesai SESUDAH batas waktunya lewat tidak boleh membuat
// `resolve` dipanggil pada promise yang sudah ditolak — di beberapa runtime
// itu memunculkan unhandled rejection yang menyesatkan diagnosa berikutnya.
let meledak = null;
process.once('unhandledRejection', (e) => {
  meledak = e;
});
const lambat = tunggu(30, 'telat');
const e5 = await denganBatas(lambat, { detik: 1, apa: 'X', timer: segera }).then(
  () => null,
  (err) => err
);
assert.equal(e5.name, NAMA_GALAT_BATAS);
await tunggu(60);
assert.equal(meledak, null, 'tidak boleh ada unhandled rejection sesudah batas waktu');
ok('INTI: promise yang selesai terlambat tidak menimbulkan galat liar');

assert.equal(BATAS_DETIK, 25);
assert.equal(galatBatasWaktu('x').name, NAMA_GALAT_BATAS);
ok('bawaannya 25 detik, dan penanda galatnya konsisten');

console.log(`\n${n} pemeriksaan batas waktu lolos. ✅`);
