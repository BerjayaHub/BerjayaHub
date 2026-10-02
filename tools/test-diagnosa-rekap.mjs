/**
 * TES: vonis atas jawaban rekap reservasi harian.
 *
 * ============ APA YANG SESUNGGUHNYA DIUJI ============
 *
 * Bukan apakah kalimatnya enak dibaca, melainkan apakah empat keadaan yang
 * SAMA-SAMA SENYAP bisa dibedakan satu sama lain:
 *
 *   §1 panggilannya sendiri gagal (401 / jaringan)
 *   §2 tidak ada outlet yang direkap — modul Reservasi mati
 *   §3 ada outlet, tapi grup tujuannya belum diatur
 *   §4 terkirim, tapi jatuh ke rute "Reservasi baru"
 *   §5 semuanya siap — dan vonisnya TIDAK boleh berbunyi "semua beres"
 *   §6 penanda anti-kirim-ganda
 */
import assert from 'node:assert/strict';
import {
  diagnosaRekap,
  vonisOutlet,
  pakaiRuteCadangan,
  ikonVonis,
  VONIS
} from '../js/modules/notifications/diagnosa-rekap.js';

let n = 0;
const ok = (nama) => {
  n += 1;
  console.log(`  ✔ ${nama}`);
};

console.log('§1 Panggilannya gagal');

const g = diagnosaRekap(null, new Error('Unauthorized'));
assert.equal(g.vonis, VONIS.GAGAL);
// Pesan aslinya DIBAWA, bukan dirangkum. "Unauthorized" dan "Failed to fetch"
// menunjuk ke dua sebab yang berbeda jauh — yang pertama gerbang/secret, yang
// kedua CORS atau jaringan. Merangkum keduanya jadi "gagal" menghapus
// satu-satunya petunjuk yang ada.
assert.match(g.saran, /Unauthorized/);
ok('INTI: pesan galat aslinya dibawa apa adanya, tidak dirangkum');

assert.equal(diagnosaRekap({ error: 'Hanya Admin BU & Super Admin yang bisa...' }).vonis, VONIS.GAGAL);
ok('penolakan dari function juga dibaca sebagai gagal');

assert.equal(diagnosaRekap(null).vonis, VONIS.TIDAK_DIKENALI);
assert.equal(diagnosaRekap('bukan objek').vonis, VONIS.TIDAK_DIKENALI);
ok('jawaban yang bukan JSON tidak melempar, dan tidak menyamar jadi "siap"');

console.log('\n§2 Tidak ada outlet yang direkap');

const mati = diagnosaRekap({ ok: true, sent: 0, reason: 'Tidak ada BU yang mengaktifkan modul Reservasi.' });
assert.equal(mati.vonis, VONIS.MODUL_MATI);
assert.match(mati.ringkas, /modul Reservasi/i);
// Sebab ini yang PALING mudah salah dibaca: reservasi masuk tetap normal,
// karena jalurnya trigger dan trigger tidak memeriksa `bu_modules`.
assert.match(mati.saran, /modul Reservasi/i);
ok('INTI: "tidak ada BU yang mengaktifkan modul" dikenali tersendiri');

assert.equal(diagnosaRekap({ ok: true, telegram: [] }).vonis, VONIS.MODUL_MATI);
ok('daftar telegram kosong juga jatuh ke sini, bukan ke "siap"');

console.log('\n§3 Grup tujuan belum diatur');

const tanpa = diagnosaRekap({
  ok: true,
  telegram: [
    { outlet: 'AB Sentul', chat_id: null, sumber_rute: 'tidak ada rute', jumlah: 2 },
    { outlet: 'AB Gading', chat_id: '-100123', sumber_rute: 'reservation_digest (umum)', jumlah: 0 }
  ]
});
assert.equal(tanpa.vonis, VONIS.TANPA_RUTE);
assert.match(tanpa.ringkas, /1 dari 2/);
ok('INTI: satu outlet tanpa rute mengalahkan vonis "siap" seluruhnya');

assert.equal(tanpa.baris[0].vonis, VONIS.TANPA_RUTE);
assert.equal(tanpa.baris[1].vonis, VONIS.SIAP);
ok('vonis per outlet tetap dibedakan di dalam daftarnya');

console.log('\n§4 Jatuh ke rute "Reservasi baru"');

assert.equal(pakaiRuteCadangan({ sumber_rute: 'reservation (umum)' }), true);
assert.equal(pakaiRuteCadangan({ sumber_rute: 'TELEGRAM_CHAT_ID (cadangan secret)' }), true);
assert.equal(pakaiRuteCadangan({ sumber_rute: 'reservation_digest (khusus BU ini)' }), false);
// `reservation_digest` DIAWALI `reservation` — pembedanya harus `startsWith`
// pada nama lengkapnya, bukan "mengandung kata reservation".
assert.equal(pakaiRuteCadangan({ sumber_rute: 'reservation_digest (umum)' }), false);
ok('INTI: `reservation_digest` tidak tertukar dengan `reservation` yang jadi awalannya');

const cad = diagnosaRekap({
  ok: true,
  telegram: [{ outlet: 'AB Sentul', chat_id: '-100123', sumber_rute: 'reservation (umum)', jumlah: 3 }]
});
assert.equal(cad.vonis, VONIS.RUTE_CADANGAN);
assert.match(cad.saran, /grup yang sama/i);
ok('rute cadangan dilaporkan sebagai peringatan, bukan sebagai gagal');

console.log('\n§5 Semuanya siap');

const siap = diagnosaRekap({
  ok: true,
  telegram: [
    { outlet: 'AB Sentul', chat_id: '-100123', sumber_rute: 'reservation_digest (umum)', jumlah: 3 },
    { outlet: 'AB Gading', chat_id: '-100123', sumber_rute: 'reservation_digest (umum)', jumlah: 0 }
  ]
});
assert.equal(siap.vonis, VONIS.SIAP);

// ============ PEMERIKSAAN TERPENTING DI BERKAS INI ============
//
// "Siap" di sini artinya: kalau ADA yang memanggil, pesannya masuk. Ia tidak
// mengatakan apa pun tentang apakah ada yang memanggil — dan justru itu
// keadaan yang sedang dicari orangnya. Vonis yang berbunyi "semuanya beres"
// akan menutup satu-satunya sebab yang tersisa, yaitu cron-nya.
assert.match(siap.saran, /cron/i);
assert.match(siap.saran, /401|Authorization/);
ok('INTI: vonis "siap" tetap menunjuk ke cron sebagai sebab yang tersisa');

assert.equal(siap.baris.length, 2);
assert.match(siap.baris[1].pesan, /0 reservasi/);
ok('outlet tanpa reservasi tetap dilaporkan — hari kosong memang ikut dikirim');

console.log('\n§6 Penanda anti-kirim-ganda');

const skip = diagnosaRekap({ ok: true, skipped: true, reason: 'Sudah dikirim untuk 2026-10-02.' });
assert.equal(skip.vonis, VONIS.SUDAH_DIKIRIM);
assert.match(skip.saran, /paksa/i);
ok('INTI: dedupe dibedakan dari "berhasil" — penanda ada belum tentu pesannya sampai');

console.log('\n§7 Ikon');

assert.equal(ikonVonis(VONIS.SIAP), '✅');
assert.equal(ikonVonis(VONIS.RUTE_CADANGAN), '⚠️');
assert.notEqual(ikonVonis(VONIS.TANPA_RUTE), ikonVonis(VONIS.SIAP));
ok('keadaan yang berbeda tidak memakai ikon yang sama');

console.log('\n§8 Masukan aneh');

assert.equal(vonisOutlet({}).vonis, VONIS.TANPA_RUTE);
assert.equal(vonisOutlet(null).vonis, VONIS.TANPA_RUTE);
assert.equal(typeof vonisOutlet({ chat_id: '-1', sumber_rute: 'reservation_digest (umum)' }).pesan, 'string');
ok('baris tanpa chat_id dianggap TIDAK berjalan, bukan dianggap siap');

console.log(`\n${n} pemeriksaan diagnosa rekap lolos. ✅`);
