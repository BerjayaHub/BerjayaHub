/**
 * TES: cuti yang berlaku saat orangnya hendak clock in.
 *
 *   §1 Tanggal dari PostgREST, apa pun bentuknya.
 *   §2 Hari ini cuti atau tidak.
 *   §3 "Sampai kapan" — hari BERUNTUN, bukan sekadar baris terakhir.
 *   §4 Rentang yang diminta cukup panjang untuk menjawabnya.
 *   §5 Kalimat peringatannya.
 */
import assert from 'node:assert/strict';
import {
  keTanggal,
  tanggalWIB,
  akhirRentangCuti,
  cutiPada,
  peringatanCuti,
  tanggalPanjang,
  CATATAN_LANJUT
} from '../js/modules/attendance/cuti-presensi.js';

let n = 0;
const ok = (nama) => {
  n += 1;
  console.log(`  ✔ ${nama}`);
};

console.log('§1 Bentuk tanggal');

assert.equal(keTanggal('2026-10-05'), '2026-10-05');
// `generate_series` atas `interval '1 day'` pernah mengembalikan bentuk
// bertimestamp. Kalau penyusun & pembaca peta memakai bentuk berbeda, TIDAK
// ADA yang cocok — dan gejalanya cuma "peringatannya tidak muncul".
assert.equal(keTanggal('2026-10-05T00:00:00+00:00'), '2026-10-05');
assert.equal(keTanggal(null), '');
assert.equal(keTanggal(undefined), '');
ok('INTI: dua bentuk tanggal dari PostgREST menghasilkan kunci yang sama');

console.log('\n§2 Hari ini cuti?');

const baris = [
  { tanggal: '2026-10-05', jenis: 'Cuti Tahunan', leave_request_id: 'c1' },
  { tanggal: '2026-10-06', jenis: 'Cuti Tahunan', leave_request_id: 'c1' },
  { tanggal: '2026-10-07', jenis: 'Cuti Tahunan', leave_request_id: 'c1' }
];

assert.equal(cutiPada(baris, '2026-10-04'), null);
assert.equal(cutiPada(baris, '2026-10-08'), null);
ok('hari di luar rentang menjawab null');

const c = cutiPada(baris, '2026-10-05');
assert.equal(c.jenis, 'Cuti Tahunan');
assert.equal(c.id, 'c1');
ok('jenis & id cutinya ikut terbawa');

assert.equal(cutiPada([], '2026-10-05'), null);
assert.equal(cutiPada(null, '2026-10-05'), null);
assert.equal(cutiPada(undefined, '2026-10-05'), null);
ok('daftar kosong & undefined tidak melempar');

// Bentuk bertimestamp harus tetap cocok.
assert.ok(cutiPada([{ tanggal: '2026-10-05T00:00:00+00:00', jenis: 'Sakit' }], '2026-10-05'));
ok('INTI: baris bertimestamp tetap ketemu');

console.log('\n§3 Sampai kapan');

assert.equal(cutiPada(baris, '2026-10-05').sampai, '2026-10-07');
assert.equal(cutiPada(baris, '2026-10-05').hari, 3);
ok('INTI: hari terakhir dihitung dari hari BERUNTUN, bukan baris terakhir');

// Dihitung dari tanggal yang ditanyakan, bukan dari awal rentangnya.
assert.equal(cutiPada(baris, '2026-10-06').hari, 2);
assert.equal(cutiPada(baris, '2026-10-07').hari, 1);
ok('sisa harinya dihitung dari hari ini, bukan dari awal cutinya');

// ============ LUBANG DI TENGAH ============
//
// Dua pengajuan terpisah dengan jeda di tengah BUKAN satu rentang. Kalau yang
// dipakai cuma "tanggal terbesar di daftar", kalimatnya akan berbunyi "sampai
// 20 Oktober" untuk cuti yang sebenarnya habis tanggal 7 — dan orangnya
// menyimpulkan ia masih cuti dua minggu lagi.
const berlubang = [
  { tanggal: '2026-10-05', jenis: 'A' },
  { tanggal: '2026-10-06', jenis: 'A' },
  { tanggal: '2026-10-20', jenis: 'B' }
];
assert.equal(cutiPada(berlubang, '2026-10-05').sampai, '2026-10-06');
assert.equal(cutiPada(berlubang, '2026-10-05').hari, 2);
ok('INTI: jeda di tengah memutus rentangnya — bukan melompat ke tanggal terjauh');

// Dua pengajuan BERSEBELAHAN sengaja dibaca sebagai satu rentang: bagi orang
// yang berdiri di depan tombol, "sampai kapan" adalah satu pertanyaan.
const bersebelahan = [
  { tanggal: '2026-10-05', jenis: 'A', leave_request_id: 'a' },
  { tanggal: '2026-10-06', jenis: 'B', leave_request_id: 'b' }
];
assert.equal(cutiPada(bersebelahan, '2026-10-05').sampai, '2026-10-06');
ok('dua pengajuan bersebelahan dibaca sebagai satu rentang');

// Melewati pergantian bulan & tahun.
const lintas = ['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02'].map((t) => ({ tanggal: t, jenis: 'A' }));
assert.equal(cutiPada(lintas, '2026-12-30').sampai, '2027-01-02');
assert.equal(cutiPada(lintas, '2026-12-30').hari, 4);
ok('INTI: rentang yang melewati pergantian tahun dihitung benar');

console.log('\n§4 Rentang yang diminta');

// Rentang sehari cukup menjawab "apakah cuti", tapi tidak "sampai kapan".
assert.ok(akhirRentangCuti('2026-10-05') > '2026-10-05');
assert.equal(akhirRentangCuti('2026-10-05'), '2026-12-04');
ok('INTI: rentangnya 60 hari ke depan, bukan sehari');

assert.equal(akhirRentangCuti('2026-12-30'), '2027-02-28');
ok('batas rentang melewati pergantian tahun dengan benar');

console.log('\n§5 Peringatannya');

const p = peringatanCuti(cutiPada(baris, '2026-10-05'));
assert.match(p.pesan, /Cuti Tahunan/);
assert.match(p.pesan, /3 hari/);
assert.match(p.pesan, /Oktober/);
ok('INTI: pesannya menyebut jenis, tanggal akhir, dan berapa hari');

const sehari = peringatanCuti(cutiPada([{ tanggal: '2026-10-05', jenis: 'Sakit' }], '2026-10-05'));
assert.match(sehari.pesan, /hari ini/);
assert.doesNotMatch(sehari.pesan, /1 hari\)/);
ok('cuti sehari tidak ditulis "(1 hari)" — itu cuma keramaian');

// Nadanya BUKAN tuduhan: yang paling sering terjadi adalah orang yang memang
// dipanggil masuk, dan kalimat yang menuduh membuatnya mencari jalan lain.
for (const kata of [/tidak boleh/i, /dilarang/i, /melanggar/i, /curang/i]) {
  assert.doesNotMatch(p.pesan, kata);
  assert.doesNotMatch(p.judul, kata);
}
ok('INTI: nadanya tidak menuduh — absennya memang boleh diteruskan');

assert.equal(p.lanjut, 'Tetap absen');
assert.match(CATATAN_LANJUT, /tetap tercatat/i);
assert.match(CATATAN_LANJUT, /admin/i);
ok('disebut terus terang: presensinya tetap tercatat dan ditandai');

console.log('\n§6 Masukan aneh');

assert.equal(typeof peringatanCuti({}).pesan, 'string');
assert.equal(typeof peringatanCuti(null).pesan, 'string');
assert.equal(tanggalPanjang('bukan tanggal'), 'bukan tanggal');
ok('cuti tanpa jenis/tanggal tidak melempar');

assert.match(tanggalWIB(new Date('2026-10-05T16:30:00Z')), /^\d{4}-\d{2}-\d{2}$/);
// 16.30 UTC = 23.30 WIB hari yang sama.
assert.equal(tanggalWIB(new Date('2026-10-05T16:30:00Z')), '2026-10-05');
// 17.30 UTC = 00.30 WIB HARI BERIKUTNYA — dan di sinilah zona waktunya
// menentukan jawaban.
assert.equal(tanggalWIB(new Date('2026-10-05T17:30:00Z')), '2026-10-06');
ok('INTI: tanggalnya WIB, bukan UTC dan bukan zona perangkatnya');

console.log(`\n${n} pemeriksaan cuti-presensi lolos. ✅`);
