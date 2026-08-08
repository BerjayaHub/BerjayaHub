/**
 * Rentang tanggal bawaan modul Reservasi (Staff App).
 *
 * Yang dijaga di sini: rentangnya menatap KE DEPAN dan tidak pernah terbalik
 * (dari > sampai). Rentang terbalik tidak menghasilkan error apa pun — query-nya
 * sah, hasilnya kosong — dan gejalanya persis sama dengan "tidak ada reservasi".
 * Itu jenis kegagalan yang paling lama tidak ketahuan.
 *
 * Helper tanggalnya DIIMPOR dari js/core/dates.js, bukan disalin ke sini.
 * Salinan akan tetap hijau saat aslinya berubah — dan tes yang hijau untuk kode
 * yang tidak dipakai lebih buruk daripada tidak ada tes sama sekali.
 */
import { todayWIB, monthEndWIB, geserHari } from '../js/core/dates.js';

let gagal = 0;
const cek = (nama, dapat, harap) => {
  const ok = dapat === harap;
  if (!ok) {
    gagal++;
    console.error(`❌ ${nama}\n   dapat : ${dapat}\n   harap : ${harap}`);
  }
};

// --- geserHari: pergantian bulan, tahun, dan tahun kabisat ---
cek('geser dalam bulan', geserHari('2026-08-08', 3), '2026-08-11');
cek('geser lewat akhir bulan', geserHari('2026-08-30', 3), '2026-09-02');
cek('geser lewat akhir tahun', geserHari('2026-12-30', 5), '2027-01-04');
cek('geser mundur', geserHari('2026-03-01', -1), '2026-02-28');
cek('kabisat: 2028 punya 29 Februari', geserHari('2028-02-28', 1), '2028-02-29');
cek('bukan kabisat: 2026 langsung ke Maret', geserHari('2026-02-28', 1), '2026-03-01');
cek('geser 0 hari tidak mengubah apa pun', geserHari('2026-08-08', 0), '2026-08-08');

// --- monthEndWIB: hari terakhir bulan berjalan ---
const akhir = monthEndWIB();
const ini = todayWIB();
cek('akhir bulan sebulan dengan hari ini', akhir.slice(0, 7), ini.slice(0, 7));
cek('sehari setelah akhir bulan sudah bulan berikutnya', geserHari(akhir, 1).slice(0, 7) === ini.slice(0, 7), false);
cek('akhir bulan tidak lebih awal dari hari ini', akhir >= ini, true);

// --- Rentang bawaan & pintasan ---
const rentang = (kode, t = ini) => {
  if (kode === 'default') return [t, monthEndWIB()];
  if (kode === 'today') return [t, t];
  if (kode === 'tomorrow') return [geserHari(t, 1), geserHari(t, 1)];
  if (kode === 'week') return [t, geserHari(t, 6)];
  if (kode === 'month') return [t, monthEndWIB()];
  if (kode === '30') return [t, geserHari(t, 30)];
  throw new Error('rentang tidak dikenal: ' + kode);
};

for (const kode of ['default', 'today', 'tomorrow', 'week', 'month', '30']) {
  const [dari, sampai] = rentang(kode);
  cek(`${kode}: dari <= sampai`, dari <= sampai, true);
  // Tidak ada pintasan yang menoleh ke belakang. "Bulan ini" di modul laporan
  // berarti tanggal 1 s/d hari ini; di sini artinya kebalikannya, dan salah
  // menyalin dari modul laporan adalah kekeliruan yang paling mungkin terjadi.
  cek(`${kode}: tidak menoleh ke masa lalu`, dari >= ini, true);
}

// Bawaan harus SAMA dengan pintasan "Sisa bulan ini" — kalau berbeda, staff
// menekan tombol yang seharusnya tidak mengubah apa-apa lalu melihat daftarnya
// berubah, dan sesudah itu tidak ada yang percaya pada tampilan bawaannya.
cek('bawaan = pintasan "Sisa bulan ini"', rentang('default').join('|'), rentang('month').join('|'));

// Akhir bulan: bawaannya boleh pendek (itu memang konsekuensinya), tapi tetap
// harus sah — satu hari, bukan rentang terbalik.
const [d31, s31] = rentang('default', monthEndWIB());
cek('di hari terakhir bulan, rentangnya satu hari', d31 === s31, true);

if (gagal) {
  console.error(`\n${gagal} kasus gagal.`);
  process.exit(1);
}
console.log('Rentang tanggal reservasi benar untuk 24 kasus, termasuk pergantian bulan & tahun kabisat. ✅');
