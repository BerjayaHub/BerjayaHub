/**
 * Batas tanggal untuk query `timestamptz`.
 *
 * ============ BUG YANG DIJAGA ============
 *
 * Rekap NBM difilter 31 Agustus – 5 September, dan tanggal 31 Agustus tidak
 * muncul. Batasnya dibangun begini:
 *
 *     dateFrom: new Date(from).toISOString()              // '2026-08-31'
 *     dateTo:   new Date(to + 'T23:59:59').toISOString()  // '2026-09-05T23:59:59'
 *
 * Dua bentuk itu dibaca JavaScript dengan aturan yang BERBEDA:
 *
 *   - 'YYYY-MM-DD' polos      -> UTC   -> 2026-08-31T00:00:00Z = 07:00 WIB
 *   - 'YYYY-MM-DDTHH:MM:SS'   -> LOKAL -> 2026-09-05T16:59:59Z = 23:59:59 WIB
 *
 * Jadi batas awalnya melompat tujuh jam ke depan, dan setiap absensi sebelum
 * pukul 07:00 pada tanggal pertama hilang dari rekap — tanpa satu pun error.
 *
 * Yang diuji di sini adalah hal yang membuat bug itu MUSTAHIL terulang:
 * kedua batas memakai offset WIB yang ditulis eksplisit, dan hasilnya tidak
 * bergantung pada zona waktu perangkat yang menjalankannya.
 */
import assert from 'node:assert/strict';
import { isoFrom, isoTo, todayWIB, geserHari, monthRangeWIB } from '../js/core/dates.js';

let lulus = 0;
const uji = (nama, fn) => {
  try {
    fn();
    lulus++;
  } catch (e) {
    console.error(`❌ ${nama}\n   ${e.message}`);
    process.exitCode = 1;
  }
};

uji('INTI: batas awal = tengah malam WIB, bukan 07:00', () => {
  assert.equal(isoFrom('2026-08-31'), '2026-08-30T17:00:00.000Z');
  // Bentuk lama menghasilkan ini, dan itulah yang memotong tujuh jam:
  assert.notEqual(isoFrom('2026-08-31'), new Date('2026-08-31').toISOString());
});

uji('INTI: batas akhir = ujung hari WIB', () => {
  assert.equal(isoTo('2026-09-05'), '2026-09-05T16:59:59.999Z');
});

uji('INTI: keduanya memakai aturan yang SAMA', () => {
  // Selisih awal-ke-akhir untuk SATU hari harus tepat 24 jam kurang 1 ms.
  // Kalau salah satunya memakai UTC dan satunya waktu lokal, angka ini akan
  // meleset sebesar offset zona waktunya — persis bug yang dilaporkan.
  const a = new Date(isoFrom('2026-08-31')).getTime();
  const b = new Date(isoTo('2026-08-31')).getTime();
  assert.equal(b - a, 24 * 3600 * 1000 - 1, 'rentang satu hari harus utuh 24 jam');
});

uji('rentang 31 Agu – 5 Sep memuat seluruh 31 Agustus', () => {
  const dari = new Date(isoFrom('2026-08-31')).getTime();
  const sampai = new Date(isoTo('2026-09-05')).getTime();
  // Absen pukul 06:00 WIB tanggal 31 Agustus — inilah yang hilang sebelumnya.
  const absenPagi = new Date('2026-08-31T06:00:00+07:00').getTime();
  assert.ok(absenPagi >= dari, 'absen 06:00 WIB tanggal pertama HARUS ikut terhitung');
  assert.ok(absenPagi <= sampai);

  // Dan sedetik sebelum tengah malam WIB tanggal itu TIDAK boleh ikut.
  const sebelumnya = new Date('2026-08-30T23:59:59+07:00').getTime();
  assert.ok(sebelumnya < dari, 'hari sebelum rentang tidak boleh ikut');
});

uji('absen 23:59 WIB di tanggal terakhir tetap ikut', () => {
  const sampai = new Date(isoTo('2026-09-05')).getTime();
  assert.ok(new Date('2026-09-05T23:59:30+07:00').getTime() <= sampai);
  assert.ok(new Date('2026-09-06T00:00:00+07:00').getTime() > sampai, 'hari berikutnya tidak boleh ikut');
});

uji('TIDAK bergantung zona waktu perangkat', () => {
  // Nilainya literal, bukan dihitung dari `new Date(...)` tanpa offset — jadi
  // admin yang laptopnya masih WITA melihat rentang yang sama dengan rekannya.
  assert.equal(isoFrom('2026-01-01'), '2025-12-31T17:00:00.000Z');
  assert.equal(isoTo('2026-12-31'), '2026-12-31T16:59:59.999Z');
});

uji('kosong tetap kosong, bukan Invalid Date', () => {
  // String kosong berarti "tanpa batas" di seluruh pemanggilnya. Mengubahnya
  // jadi 'Invalid Date' akan menghasilkan query yang ditolak PostgREST dengan
  // pesan yang tidak menyebut tanggal sama sekali.
  assert.equal(isoFrom(''), '');
  assert.equal(isoTo(''), '');
  assert.equal(isoFrom(null), '');
  assert.equal(isoTo(undefined), '');
});

uji('geserHari tidak ikut bergeser zona', () => {
  assert.equal(geserHari('2026-08-31', 1), '2026-09-01');
  assert.equal(geserHari('2026-09-01', -1), '2026-08-31');
  assert.equal(geserHari('2026-03-01', -1), '2026-02-28');
});

uji('todayWIB & monthRangeWIB berbentuk YYYY-MM-DD', () => {
  assert.match(todayWIB(), /^\d{4}-\d{2}-\d{2}$/);
  const r = monthRangeWIB();
  assert.match(r.from, /^\d{4}-\d{2}-01$/);
  assert.match(r.to, /^\d{4}-\d{2}-\d{2}$/);
});

if (process.exitCode !== 1) console.log(`Batas tanggal WIB: ${lulus} pemeriksaan lulus. ✅`);
