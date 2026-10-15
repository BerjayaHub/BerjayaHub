/**
 * TES: kesiapan ekspor ESB (0161) — vonis seluruh jenis kode.
 *
 *   §1 Keadaan siap.
 *   §2 Dua sebab yang berbeda TIDAK dilebur.
 *   §3 Urutannya: yang terkunci di atas yang bisa dikerjakan.
 *   §4 Kalimatnya menyebut PEKERJAANNYA, bukan cuma angkanya.
 *   §5 Akibatnya disebut terus terang.
 *   §6 Masukan aneh tidak melempar.
 */
import assert from 'node:assert/strict';
import { ringkasKesiapan, pesanKesiapan, akibatKesiapan, SEBAB } from '../js/modules/inventory/kesiapan-esb.js';

let n = 0;
const ok = (nama) => {
  n += 1;
  console.log(`  ✔ ${nama}`);
};

console.log('§1 Keadaan siap');

const siap = ringkasKesiapan([
  { jenis: 'item', label: 'Item', belum: 0, total: 647, adaInduk: true },
  { jenis: 'supplier', label: 'Supplier', belum: 0, total: 31, adaInduk: true }
]);
assert.equal(siap.siap, true);
assert.equal(siap.belum, 0);
assert.deepEqual(siap.baris, []);
// Totalnya tetap dijumlahkan walau tidak ada yang bermasalah — bannernya
// menyebut "678 kode diperiksa", yang membedakan "semuanya cocok" dari
// "tidak ada yang diperiksa sama sekali".
assert.equal(siap.total, 678);
ok('INTI: semua cocok — tidak ada baris, totalnya tetap terhitung');

assert.match(pesanKesiapan(siap), /sudah cocok/i);
assert.equal(akibatKesiapan(siap), '');
ok('kalimat keadaan-normal pendek, dan tanpa kalimat akibat');

console.log('\n§2 Dua sebab tidak dilebur');

// ============ KENAPA INI YANG TERPENTING ============
//
// "12 belum cocok" yang melebur keduanya menyuruh orang mengerjakan hal yang
// TIDAK BISA dikerjakan: memilih padanan dari daftar yang kosong. Kalimat yang
// terlihat benar dan tidak bisa ditindaklanjuti adalah bentuk kegagalan yang
// paling sering muncul di layar ini.
const campur = ringkasKesiapan([
  { jenis: 'item', label: 'Item', belum: 8, total: 647, adaInduk: true },
  { jenis: 'unit', label: 'Unit', belum: 4, total: 12, adaInduk: false },
  { jenis: 'supplier', label: 'Supplier', belum: 2, total: 31, adaInduk: true },
  { jenis: 'coa', label: 'COANo', belum: 0, total: 9, adaInduk: true }
]);
assert.equal(campur.belum, 14);
assert.equal(campur.baris.length, 3);
assert.equal(campur.baris.find((b) => b.jenis === 'unit').sebab, SEBAB.TANPA_INDUK);
assert.equal(campur.baris.find((b) => b.jenis === 'item').sebab, SEBAB.BELUM_COCOK);
ok('INTI: "belum diimpor" dan "belum dipilih padanannya" dibedakan');

// Jenis yang sudah beres TIDAK masuk daftar — daftar pekerjaan yang memuat
// pekerjaan yang sudah selesai berhenti dibaca sebagai daftar pekerjaan.
assert.ok(!campur.baris.some((b) => b.jenis === 'coa'));
ok('jenis yang sudah beres tidak ikut di daftar');

// `adaInduk: undefined` berarti pemanggil tidak memberi tahu. Menebaknya
// sebagai "tidak ada induk" akan menyuruh orang mengimpor daftar yang sudah
// ia impor — jadi bawaannya yang paling tidak merugikan.
const diam = ringkasKesiapan([{ jenis: 'item', label: 'Item', belum: 1, total: 2 }]);
assert.equal(diam.baris[0].sebab, SEBAB.BELUM_COCOK);
ok('INTI: `adaInduk` yang tidak disebut tidak ditebak sebagai "belum diimpor"');

console.log('\n§3 Urutan');

// Memilih padanan MUSTAHIL selama daftarnya kosong, jadi yang terkunci harus
// di atas — walau jumlahnya lebih kecil.
assert.equal(campur.baris[0].jenis, 'unit');
assert.deepEqual(campur.baris.map((b) => b.jenis), ['unit', 'item', 'supplier']);
ok('INTI: yang terkunci di atas, sisanya menurut jumlah terbanyak');

const seri = ringkasKesiapan([
  { jenis: 'b', label: 'Beta', belum: 3, total: 5, adaInduk: true },
  { jenis: 'a', label: 'Alfa', belum: 3, total: 5, adaInduk: true }
]);
assert.deepEqual(seri.baris.map((b) => b.label), ['Alfa', 'Beta']);
ok('seri jumlah diputus abjad — urutannya tidak berubah antar-jalan');

console.log('\n§4 Kalimatnya');

const pesan = pesanKesiapan(campur);
// Menyebut pekerjaannya, bukan cuma angkanya: "12 belum cocok" tidak
// memberitahu siapa pun apa yang harus dilakukan berikutnya.
assert.match(pesan, /langkah 3/);
assert.match(pesan, /langkah 5/);
assert.match(pesan, /Unit/);
assert.match(pesan, /Item 8/);
ok('INTI: menyebut langkah yang harus dikerjakan, per sebab');

// Yang belum diimpor TIDAK ikut dihitung sebagai "belum dipilih padanannya" —
// angkanya akan menyuruh orang mencari 4 baris yang tidak bisa diisi.
assert.match(pesan, /10 kode belum dipilih padanannya/);
ok('INTI: jumlah "belum dipilih" tidak memuat yang daftarnya belum diimpor');

const hanyaImpor = ringkasKesiapan([{ jenis: 'unit', label: 'Unit', belum: 4, total: 12, adaInduk: false }]);
assert.doesNotMatch(pesanKesiapan(hanyaImpor), /langkah 5/);
ok('kalau cuma soal impor, langkah 5 tidak ikut disebut');

console.log('\n§5 Akibatnya');

const akibat = akibatKesiapan(campur);
// Peringatan yang tidak menyebutkan akibatnya dibaca sebagai LARANGAN — lalu
// orang yang sebenarnya boleh meneruskan berhenti, dan orang yang terbiasa
// mengabaikannya tidak membacanya lagi.
assert.match(akibat, /tidak dihalangi/i);
assert.match(akibat, /tertahan/i);
assert.match(akibat, /baris lainnya tetap ikut/i);
ok('INTI: menyebut bahwa unduhan tidak dihalangi, dan apa akibatnya');

console.log('\n§6 Masukan aneh');

assert.doesNotThrow(() => ringkasKesiapan(null));
assert.doesNotThrow(() => ringkasKesiapan(undefined));
assert.doesNotThrow(() => pesanKesiapan(null));
assert.doesNotThrow(() => akibatKesiapan(undefined));
assert.equal(ringkasKesiapan(null).siap, true);
assert.equal(ringkasKesiapan([]).total, 0);
ok('daftar kosong/cacat tidak melempar');

// Angka negatif atau NaN tidak boleh menghasilkan "−3 belum cocok", dan tidak
// boleh membuat sebuah jenis masuk daftar pekerjaan tanpa pekerjaan.
const kotor = ringkasKesiapan([
  { jenis: 'a', label: 'A', belum: -3, total: 5, adaInduk: true },
  { jenis: 'b', label: 'B', belum: 'dua', total: 5, adaInduk: true },
  { jenis: '', label: 'Tanpa jenis', belum: 9, total: 9, adaInduk: true }
]);
assert.equal(kotor.belum, 0);
assert.equal(kotor.siap, true);
assert.deepEqual(kotor.baris, []);
ok('INTI: angka cacat & baris tanpa jenis dibuang, bukan jadi "−3 belum cocok"');

// Jenis tanpa `label` memakai kunci jenisnya — bukan "undefined" di layar.
const tanpaLabel = ringkasKesiapan([{ jenis: 'item', belum: 1, total: 1, adaInduk: true }]);
assert.equal(tanpaLabel.baris[0].label, 'item');
ok('jenis tanpa label memakai kuncinya, bukan "undefined"');

console.log(`\n${n} pemeriksaan kesiapan ESB lolos. ✅`);
