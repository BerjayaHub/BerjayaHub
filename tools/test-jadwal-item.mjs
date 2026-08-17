/**
 * Item Daily Activities yang dikerjakan beberapa hari sekali.
 *
 * Hitungannya DARI TERAKHIR DIKERJAKAN, bukan tanggal tetap: yang penting untuk
 * pekerjaan seperti ini adalah JARAK antar pengerjaan ("minyak tidak boleh
 * lebih dari 2 hari").
 *
 * Yang paling ditekankan di tes ini adalah dua keadaan yang mudah sekali salah
 * dan tidak menghasilkan error apa pun kalau salah:
 *   - item yang BELUM PERNAH dikerjakan harus muncul (kalau tidak, item baru
 *     menunggu pengerjaan pertama yang tak akan pernah terjadi);
 *   - item yang LEWAT jadwalnya harus tetap muncul tiap hari sampai dicentang
 *     (kalau tidak, pekerjaan yang diabaikan justru menghilang dari layar).
 */
import { jatuhTempo, hariTerlambat, labelJadwal, perkiraanBerikutnya, saringJatuhTempo, selisihHari } from '../js/modules/cleaning/jadwal-item.js';

let gagal = 0;
const cek = (nama, dapat, harap) => {
  if (JSON.stringify(dapat) !== JSON.stringify(harap)) {
    gagal++;
    console.error(`❌ ${nama}\n   dapat : ${JSON.stringify(dapat)}\n   harap : ${JSON.stringify(harap)}`);
  }
};

// ================= Harian: perilaku lama tidak boleh berubah =================
// SELURUH item yang sudah ada punya interval NULL. Kalau jalur ini salah,
// seluruh modul berhenti menampilkan apa pun.
for (const interval of [null, undefined, 0, 1, '']) {
  cek(`interval ${JSON.stringify(interval)} = harian, selalu muncul`, jatuhTempo({ hariIni: '2026-08-17', terakhir: '2026-08-17', interval }), true);
  cek(`interval ${JSON.stringify(interval)} tidak pernah "tertunda"`, hariTerlambat({ hariIni: '2026-08-20', terakhir: '2026-08-17', interval }), 0);
}
cek('harian tidak punya label', labelJadwal(null), null);
cek('harian (1) juga tidak', labelJadwal(1), null);

// ================= Tiap 2 hari =================
const dua = (hariIni, terakhir) => jatuhTempo({ hariIni, terakhir, interval: 2 });
cek('dikerjakan hari ini -> besok belum', dua('2026-08-18', '2026-08-17'), false);
cek('lusa baru jatuh tempo', dua('2026-08-19', '2026-08-17'), true);
cek('lewat sehari -> TETAP jatuh tempo', dua('2026-08-20', '2026-08-17'), true);
cek('lewat seminggu -> masih jatuh tempo', dua('2026-08-24', '2026-08-17'), true);
// Ini yang membuat "kalau terlewat" tidak butuh mekanisme sendiri.
cek('tertunda dihitung dari kelebihannya', hariTerlambat({ hariIni: '2026-08-20', terakhir: '2026-08-17', interval: 2 }), 1);
cek('tepat jadwalnya = 0 tertunda', hariTerlambat({ hariIni: '2026-08-19', terakhir: '2026-08-17', interval: 2 }), 0);
cek('belum jatuh tempo juga 0', hariTerlambat({ hariIni: '2026-08-18', terakhir: '2026-08-17', interval: 2 }), 0);

// ================= Tiap 7 hari =================
cek('7 hari: hari ke-6 belum', jatuhTempo({ hariIni: '2026-08-23', terakhir: '2026-08-17', interval: 7 }), false);
cek('7 hari: hari ke-7 muncul', jatuhTempo({ hariIni: '2026-08-24', terakhir: '2026-08-17', interval: 7 }), true);
cek('label mingguan', labelJadwal(7), 'tiap minggu');
cek('label dua mingguan', labelJadwal(14), 'tiap 2 minggu');
cek('label bulanan', labelJadwal(30), 'tiap bulan');
cek('label angka lain', labelJadwal(10), 'tiap 10 hari');

// ================= BELUM PERNAH dikerjakan =================
// Kalau ini `false`, item baru tidak akan pernah muncul.
cek('belum pernah dikerjakan -> muncul', jatuhTempo({ hariIni: '2026-08-17', terakhir: null, interval: 7 }), true);
cek('belum pernah, interval besar -> tetap muncul', jatuhTempo({ hariIni: '2026-08-17', terakhir: null, interval: 365 }), true);
// Tapi belum pernah dikerjakan BUKAN "tertunda" — tidak ada jadwal yang dilewati.
cek('belum pernah bukan tertunda', hariTerlambat({ hariIni: '2026-08-17', terakhir: null, interval: 7 }), 0);

// ================= Tanggal tidak terbaca: TAMPILKAN =================
// Memihak ke arah yang aman. Menyembunyikan pekerjaan karena satu tanggal rusak
// berarti pekerjaan itu tidak dikerjakan dan tidak ada yang tahu; menampilkannya
// paling banter membuat orang mengerjakan sesuatu lebih cepat dari perlu.
cek('tanggal rusak -> tetap muncul', jatuhTempo({ hariIni: '2026-08-17', terakhir: 'bukan tanggal', interval: 7 }), true);
cek('hariIni rusak -> tetap muncul', jatuhTempo({ hariIni: '??', terakhir: '2026-08-17', interval: 7 }), true);
cek('selisih tanggal rusak = null', selisihHari('x', '2026-08-17'), null);

// ================= Lintas bulan & tahun =================
// Aritmetika tanggal manual paling sering pecah di sini.
cek('lintas bulan', jatuhTempo({ hariIni: '2026-09-01', terakhir: '2026-08-30', interval: 2 }), true);
cek('lintas tahun', jatuhTempo({ hariIni: '2027-01-01', terakhir: '2026-12-30', interval: 2 }), true);
cek('selisih lintas bulan benar', selisihHari('2026-08-30', '2026-09-02'), 3);
// Tahun kabisat: 2028 kabisat, jadi Feb punya 29 hari.
cek('lintas 29 Februari', selisihHari('2028-02-28', '2028-03-01'), 2);
// Waktu di WIB (UTC+7) tidak boleh menggeser hari.
cek('timestamp berzona ikut terpotong ke tanggal', selisihHari('2026-08-17T23:30:00+07:00', '2026-08-19'), 2);

// ================= Perkiraan tanggal berikutnya =================
// PENTING: ini perkiraan, karena tanggal kedua dst. mengandaikan item
// dikerjakan TEPAT pada tanggal sebelumnya.
cek(
  'belum jatuh tempo: mulai dari tanggal jadwalnya',
  perkiraanBerikutnya({ hariIni: '2026-08-18', terakhir: '2026-08-17', interval: 2, jumlah: 3 }),
  ['2026-08-19', '2026-08-21', '2026-08-23']
);
// Kalau sudah lewat, kemunculan pertamanya HARI INI — bukan tanggal yang sudah
// berlalu. Menampilkan tanggal lampau di daftar "berikutnya" membingungkan.
cek(
  'sudah lewat: mulai hari ini',
  perkiraanBerikutnya({ hariIni: '2026-08-25', terakhir: '2026-08-17', interval: 2, jumlah: 2 }),
  ['2026-08-25', '2026-08-27']
);
cek(
  'belum pernah dikerjakan: mulai hari ini',
  perkiraanBerikutnya({ hariIni: '2026-08-17', terakhir: null, interval: 7, jumlah: 2 }),
  ['2026-08-17', '2026-08-24']
);
cek(
  'harian: berurutan',
  perkiraanBerikutnya({ hariIni: '2026-08-17', terakhir: '2026-08-16', interval: 1, jumlah: 3 }),
  ['2026-08-17', '2026-08-18', '2026-08-19']
);
cek('jumlah 0 -> kosong', perkiraanBerikutnya({ hariIni: '2026-08-17', interval: 7, jumlah: 0 }), []);
cek('hariIni rusak -> kosong', perkiraanBerikutnya({ hariIni: 'x', interval: 7 }), []);

// ================= Penyaringan daftar =================
const items = [
  { id: 'harian', label: 'Sapu lantai' },
  { id: 'minyak', label: 'Ganti minyak', interval_days: 2 },
  { id: 'tandon', label: 'Kuras tandon', interval_days: 7 },
  { id: 'baru', label: 'Item baru', interval_days: 7 }
];
const terakhir = new Map([
  ['harian', '2026-08-16'],
  ['minyak', '2026-08-17'], // baru dikerjakan -> belum waktunya
  ['tandon', '2026-08-05'] // sudah lewat 12 hari -> tertunda 5
]);
const hasil = saringJatuhTempo(items, terakhir, '2026-08-17');
cek('yang belum waktunya disembunyikan', hasil.map((h) => h.id), ['harian', 'tandon', 'baru']);
cek('yang tertunda diberi angkanya', hasil.find((h) => h.id === 'tandon').terlambat, 5);
cek('yang harian tidak pernah tertunda', hasil.find((h) => h.id === 'harian').terlambat, 0);
cek('item baru muncul tanpa tanda tertunda', hasil.find((h) => h.id === 'baru').terlambat, 0);
// Peta kosong = belum ada yang pernah dikerjakan di outlet ini -> semua muncul.
cek('outlet baru: semua item muncul', saringJatuhTempo(items, new Map(), '2026-08-17').length, 4);
cek('peta null aman', saringJatuhTempo(items, null, '2026-08-17').length, 4);
cek('items null aman', saringJatuhTempo(null, new Map(), '2026-08-17'), []);


// ================= YANG SUDAH DIKERJAKAN TETAP TAMPIL =================
//
// REGRESI YANG PERNAH TERJADI: item berjadwal LENYAP dari layar tepat setelah
// dicentang. Begitu dikerjakan hari ini, "terakhir dikerjakan" jadi hari ini,
// jatuh temponya pindah ke beberapa hari lagi, dan penyaring membuangnya.
// Staff menekan kirim lalu melihat pekerjaannya menghilang — tanpa tanda apakah
// tersimpan.
//
// Modul ini justru SENGAJA selalu menampilkan item yang sudah dikerjakan,
// karena "apa saja yang sudah beres" adalah pertanyaan paling sering di tengah
// shift. Aturan jadwal tidak boleh diam-diam membatalkan keputusan itu.

const barusanDikerjakan = new Map([['tandon', '2026-08-17']]); // dicentang HARI INI
const tanpaPengaman = saringJatuhTempo(items, barusanDikerjakan, '2026-08-17');
cek('tanpa pengaman: item yang baru dicentang hilang', tanpaPengaman.some((h) => h.id === 'tandon'), false);

const denganPengaman = saringJatuhTempo(items, barusanDikerjakan, '2026-08-17', new Set(['tandon']));
cek('dengan pengaman: tetap tampil', denganPengaman.some((h) => h.id === 'tandon'), true);

// TERTUNDA HARUS DIBERSIHKAN — dan ini hanya teruji kalau petanya BASI.
//
// Skenario nyatanya: riwayat pengerjaan diambil saat layar dibuka, lalu staff
// mencentang itemnya. Sampai layarnya dimuat ulang, peta masih menyebut tanggal
// LAMA (5 Agustus), sementara item itu sudah tercatat di run hari ini.
// Tanpa pembersihan, item yang baru saja beres tetap berteriak "tertunda 5
// hari" — persis kebalikan dari keadaannya, dan cukup untuk membuat orang
// mengerjakannya dua kali.
//
// Versi pertama tes ini memakai peta yang sudah diperbarui, sehingga angkanya
// kebetulan 0 dan penjaganya tidak pernah diuji: sabotase yang mencabutnya
// tetap hijau.
const petaBasi = new Map([['tandon', '2026-08-05']]); // 12 hari lalu -> tertunda 5
const setelahDicentang = saringJatuhTempo(items, petaBasi, '2026-08-17', new Set(['tandon']));
cek('peta basi + baru dicentang -> tidak ditandai tertunda', setelahDicentang.find((h) => h.id === 'tandon').terlambat, 0);
// Sedangkan yang BELUM dicentang dengan peta yang sama tetap ditandai.
cek('yang belum dicentang tetap ditandai tertunda', saringJatuhTempo(items, petaBasi, '2026-08-17').find((h) => h.id === 'tandon').terlambat, 5);

// Pengaman tidak boleh MEMUNCULKAN yang seharusnya belum waktunya dan belum
// disentuh — ia hanya menahan yang sudah tercatat hari itu.
const minyakBelumWaktunya = saringJatuhTempo(items, new Map([['minyak', '2026-08-17']]), '2026-08-17', new Set(['tandon']));
cek('yang belum waktunya tetap disembunyikan', minyakBelumWaktunya.some((h) => h.id === 'minyak'), false);

// Menerima Set maupun daftar biasa — pemanggilnya punya Map.keys().
cek('menerima iterable, bukan cuma Set', saringJatuhTempo(items, barusanDikerjakan, '2026-08-17', ['tandon']).some((h) => h.id === 'tandon'), true);
cek('null = tanpa pengaman', saringJatuhTempo(items, barusanDikerjakan, '2026-08-17', null).some((h) => h.id === 'tandon'), false);

if (gagal) {
  console.error(`\n${gagal} kasus gagal.`);
  process.exit(1);
}
console.log('Jadwal item Daily Activities benar untuk 52 kasus. ✅');
