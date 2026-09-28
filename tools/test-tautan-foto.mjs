/**
 * TES: sebab kegagalan foto dibedakan, dan umur tautannya.
 *
 * ============ KENAPA INI PENTING ============
 *
 * Sebelum ini SETIAP kegagalan foto memakai satu kalimat yang menuduh peran
 * outlet. Yang tautannya cuma kedaluwarsa pergi meminta hak akses yang sudah
 * ia punya, dan yang sungguh tidak berizin mendapat kalimat yang sama — jadi
 * tidak ada satu pun keluhan yang bisa dibedakan dari keluhan lain.
 *
 *   §1 Kedaluwarsa dikenali dari pesan Storage-nya sendiri.
 *   §2 403/401/404 = izin, dan kalimatnya menunjuk ke admin.
 *   §3 Sisanya kalimat umum — bukan tuduhan izin.
 *   §4 Umur tautan: yang diketuk PENDEK, dan lebih pendek dari thumbnail.
 *   §5 Masukan aneh tidak melempar.
 */
import assert from 'node:assert/strict';
import {
  UMUR_TAUTAN_KETUK,
  UMUR_TAUTAN_THUMBNAIL,
  PESAN_KEDALUWARSA,
  PESAN_TIDAK_BERIZIN,
  PESAN_GAGAL_UMUM,
  pesanGagalFoto
} from '../js/core/tautan-foto.js';

let n = 0;
const ok = (nama) => {
  n += 1;
  console.log(`  ✔ ${nama}`);
};

console.log('§1 Kedaluwarsa');

// Pesan Storage APA ADANYA, disalin dari layar yang dilaporkan:
// {"statusCode":"403","error":"Invalid JWT","message":"\"exp\" claim timestamp check failed","code":"invalid JWT"}
assert.equal(pesanGagalFoto({ message: '"exp" claim timestamp check failed', statusCode: '403' }), PESAN_KEDALUWARSA);
ok('INTI: pesan Storage yang sesungguhnya dikenali sebagai kedaluwarsa');

// Dan ia menang atas 403-nya. Kalau urutannya terbalik, kasus yang paling
// sering justru yang salah dikenali — dan itu keadaan sebelum perbaikan ini.
assert.notEqual(pesanGagalFoto({ message: '"exp" claim timestamp check failed', statusCode: '403' }), PESAN_TIDAK_BERIZIN);
ok('INTI: kedaluwarsa menang atas kode 403-nya, bukan sebaliknya');

assert.equal(pesanGagalFoto({ message: 'jwt expired' }), PESAN_KEDALUWARSA);
assert.equal(pesanGagalFoto({ message: 'Token has expired' }), PESAN_KEDALUWARSA);
ok('ejaan lain dari kedaluwarsa juga dikenali');

// Kalimatnya menyuruh MEMUAT ULANG, bukan menghubungi admin.
assert.match(PESAN_KEDALUWARSA, /[Mm]uat ulang/);
assert.doesNotMatch(PESAN_KEDALUWARSA, /admin/i);
ok('INTI: kalimat kedaluwarsa menyuruh memuat ulang, bukan meminta hak akses');

console.log('\n§2 Tidak berizin');

assert.equal(pesanGagalFoto({ statusCode: '403', message: 'Unauthorized' }), PESAN_TIDAK_BERIZIN);
assert.equal(pesanGagalFoto({ status: 401, message: 'no' }), PESAN_TIDAK_BERIZIN);
assert.equal(pesanGagalFoto({ message: 'new row violates permission' }), PESAN_TIDAK_BERIZIN);
ok('403/401/permission dikenali sebagai izin');

// Storage menjawab "not found" untuk objek yang TIDAK BOLEH dibaca — ia
// sengaja tidak membocorkan keberadaan berkasnya. Jadi "tidak ketemu" paling
// sering berarti izin, bukan berkas hilang.
assert.equal(pesanGagalFoto({ message: 'Object not found' }), PESAN_TIDAK_BERIZIN);
assert.equal(pesanGagalFoto({ statusCode: '404', message: '-' }), PESAN_TIDAK_BERIZIN);
ok('INTI: "not found" dibaca sebagai izin — Storage tidak membocorkan keberadaan berkas');

assert.match(PESAN_TIDAK_BERIZIN, /admin/i);
ok('kalimat izin menyebut ke siapa harus bertanya');

console.log('\n§3 Sisanya bukan tuduhan izin');

for (const e of [{ message: 'Failed to fetch' }, { message: 'network error' }, new Error('timeout'), {}, null, undefined]) {
  assert.equal(pesanGagalFoto(e), PESAN_GAGAL_UMUM, `salah menuduh untuk ${JSON.stringify(e)}`);
}
ok('INTI: gangguan jaringan & sebab tak dikenal TIDAK dituduh soal izin');

assert.doesNotMatch(PESAN_GAGAL_UMUM, /admin/i);
assert.doesNotMatch(PESAN_GAGAL_UMUM, /izin/i);
ok('kalimat umum tidak menuduh apa pun');

// Ketiganya BERBEDA. Kalau dua di antaranya sama, seluruh gunanya hilang.
assert.equal(new Set([PESAN_KEDALUWARSA, PESAN_TIDAK_BERIZIN, PESAN_GAGAL_UMUM]).size, 3);
ok('INTI: ketiga kalimatnya sungguh berbeda satu sama lain');

console.log('\n§4 Umur tautan');

// Yang DIKETUK pendek: ia dibuat tepat sebelum dipakai, jadi pendek tidak
// pernah mengganggu — sementara panjang membuat tautan yang terlanjur
// tersalin ke WhatsApp bisa dibuka siapa pun tanpa login.
assert.ok(UMUR_TAUTAN_KETUK <= 120, `umur tautan ketuk ${UMUR_TAUTAN_KETUK} detik terlalu panjang`);
assert.ok(UMUR_TAUTAN_KETUK > 0);
ok('INTI: tautan yang diketuk berumur pendek — dibuat tepat sebelum dipakai');

// Thumbnail boleh lebih panjang (`loading="lazy"` memuatnya saat digulir),
// tapi tidak sejam. Sejam cuma memperpanjang jendela bocornya.
assert.ok(UMUR_TAUTAN_THUMBNAIL > UMUR_TAUTAN_KETUK);
assert.ok(UMUR_TAUTAN_THUMBNAIL <= 900, `umur thumbnail ${UMUR_TAUTAN_THUMBNAIL} detik terlalu panjang`);
ok('INTI: thumbnail lebih panjang dari ketukan, tapi jauh di bawah sejam');

console.log('\n§5 Masukan aneh');

assert.equal(typeof pesanGagalFoto({ message: 123 }), 'string');
assert.equal(typeof pesanGagalFoto('exp claim gagal'), 'string');
assert.equal(pesanGagalFoto({ statusCode: 403 }), PESAN_TIDAK_BERIZIN, 'kode angka, bukan teks');
ok('kode berupa angka maupun teks sama-sama dikenali');

console.log(`\n${n} pemeriksaan tautan foto lolos. ✅`);
