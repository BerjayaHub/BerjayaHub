/**
 * Kapan sebuah item Daily Activities perlu dikerjakan.
 *
 * ATURANNYA dihitung DARI TERAKHIR DIKERJAKAN, bukan dari tanggal tetap: yang
 * penting untuk pekerjaan seperti ini adalah JARAK antar pengerjaan ("minyak
 * tidak boleh lebih dari 2 hari"), bukan jatuh pada tanggal ganjil.
 *
 * DUA KEADAAN YANG SENGAJA DIPERLAKUKAN SEBAGAI "JATUH TEMPO":
 *
 *   1. Belum pernah dikerjakan sama sekali.
 *      Kalau ini dianggap belum waktunya, item baru tidak akan pernah muncul —
 *      ia menunggu pengerjaan pertama yang tidak akan pernah terjadi.
 *
 *   2. Sudah lewat jadwalnya dan belum dikerjakan.
 *      Item tetap jatuh tempo SETIAP HARI sampai benar-benar dicentang. Ini
 *      yang membuat pekerjaan yang diabaikan makin menonjol alih-alih
 *      menghilang — dan sekaligus yang membuat "kalau terlewat" tidak butuh
 *      mekanisme tersendiri: cukup satu aturan yang sama.
 *
 * SEMUA PERBANDINGAN MEMAKAI TANGGAL LOKAL BERBENTUK 'YYYY-MM-DD', bukan objek
 * waktu. Presensi dan pengerjaan di sini dicatat per HARI kerja; memakai
 * timestamp berarti "dua hari" bisa berarti 47 atau 49 jam tergantung jam
 * berapa orangnya menekan tombol, dan di WIB pergeseran 7 jam dari UTC cukup
 * untuk memindahkan pekerjaan malam ke hari sebelumnya.
 *
 * Tidak ada impor di file ini, supaya bisa diuji tanpa browser.
 */

const HARI_MS = 24 * 60 * 60 * 1000;

/**
 * 'YYYY-MM-DD' -> angka hari.
 *
 * `.slice(0, 10)` yang menjadikannya bebas zona waktu: apa pun yang masuk
 * dipotong jadi tanggal polos dulu, jadi '2026-08-17T23:30+07:00' tetap
 * dihitung sebagai 17 Agustus, bukan 18.
 *
 * `T00:00:00Z` sesudahnya adalah PENEGASAN, bukan penjaga — spesifikasi JS
 * sudah mengurai tanggal polos sebagai UTC. Dicatat apa adanya supaya tidak
 * ada yang mengira baris itu menahan sesuatu: sabotase yang membuangnya tetap
 * hijau, dan penjaga yang tidak menjaga apa-apa lebih baik diakui daripada
 * dihitung sebagai keamanan.
 */
function keHari(tanggal) {
  const s = String(tanggal ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const t = Date.parse(s + 'T00:00:00Z');
  return Number.isNaN(t) ? null : Math.round(t / HARI_MS);
}

/** Angka hari -> 'YYYY-MM-DD'. */
function keTanggal(hari) {
  return new Date(hari * HARI_MS).toISOString().slice(0, 10);
}

/** Selisih hari antara dua tanggal; `null` kalau salah satunya tidak sah. */
export function selisihHari(dari, sampai) {
  const a = keHari(dari);
  const b = keHari(sampai);
  return a == null || b == null ? null : b - a;
}

/**
 * Apakah item ini perlu muncul hari ini?
 *
 * @param {object} o
 * @param {string} o.hariIni   'YYYY-MM-DD'
 * @param {string|null} o.terakhir 'YYYY-MM-DD' terakhir dikerjakan di outlet ini
 * @param {number|null} o.interval hari; null/1 = harian
 * @returns {boolean}
 */
export function jatuhTempo({ hariIni, terakhir, interval } = {}) {
  const n = Number(interval);
  // Harian: selalu muncul. Ini juga jalur untuk SELURUH item lama yang
  // `interval_days`-nya masih NULL, jadi perilaku sebelumnya tidak berubah.
  if (!Number.isFinite(n) || n <= 1) return true;
  if (!terakhir) return true; // belum pernah dikerjakan
  const lewat = selisihHari(terakhir, hariIni);
  if (lewat == null) return true; // tanggal tidak terbaca -> tampilkan, jangan sembunyikan
  return lewat >= n;
}

/**
 * Berapa hari LEWAT dari jadwalnya. 0 = tepat jadwalnya, >0 = tertunda.
 *
 * Dipakai untuk menandai item yang menumpuk. Angkanya penting, bukan sekadar
 * "tertunda": beda antara telat sehari dan telat dua minggu adalah beda antara
 * kelalaian kecil dan sesuatu yang harus ditanyakan.
 */
export function hariTerlambat({ hariIni, terakhir, interval } = {}) {
  const n = Number(interval);
  if (!Number.isFinite(n) || n <= 1) return 0;
  if (!terakhir) return 0; // belum pernah dikerjakan bukan "tertunda"
  const lewat = selisihHari(terakhir, hariIni);
  if (lewat == null) return 0;
  return Math.max(0, lewat - n);
}

/** Kalimat singkat untuk ditempel di layar. `null` kalau tidak perlu apa-apa. */
export function labelJadwal(interval) {
  const n = Number(interval);
  if (!Number.isFinite(n) || n <= 1) return null;
  if (n === 7) return 'tiap minggu';
  if (n === 14) return 'tiap 2 minggu';
  if (n === 30) return 'tiap bulan';
  return `tiap ${n} hari`;
}

/**
 * Pratinjau tanggal kemunculan berikutnya.
 *
 * PENTING — INI PERKIRAAN, BUKAN JADWAL PASTI, dan pemanggilnya wajib
 * mengatakannya. Karena hitungannya dari terakhir dikerjakan, tanggal kedua dan
 * seterusnya mengandaikan item itu DIKERJAKAN TEPAT pada tanggal sebelumnya.
 * Kalau telat sehari, seluruh tanggal sesudahnya ikut bergeser. Menampilkannya
 * sebagai kalender pasti akan membuat orang menjanjikan sesuatu yang tidak
 * dijamin sistemnya.
 *
 * @returns {string[]} daftar 'YYYY-MM-DD'
 */
export function perkiraanBerikutnya({ hariIni, terakhir, interval, jumlah = 5 } = {}) {
  const n = Number(interval);
  const ini = keHari(hariIni);
  if (ini == null) return [];
  if (!Number.isFinite(n) || n <= 1) {
    // Harian: tanggalnya berurutan mulai hari ini.
    return Array.from({ length: Math.max(0, jumlah) }, (_, i) => keTanggal(ini + i));
  }

  const lalu = keHari(terakhir);
  // Kemunculan pertama = hari ini kalau memang sudah jatuh tempo; kalau belum,
  // pada hari genap intervalnya sesudah terakhir dikerjakan.
  let mulai = lalu == null ? ini : Math.max(ini, lalu + n);
  const keluar = [];
  for (let i = 0; i < Math.max(0, jumlah); i++) {
    keluar.push(keTanggal(mulai));
    mulai += n;
  }
  return keluar;
}

/**
 * Menyaring daftar item untuk satu hari & satu outlet.
 *
 * @param {Array<{id: string, interval_days?: number|null}>} items
 * @param {Map<string, string>} terakhirPerItem itemId -> 'YYYY-MM-DD'
 * @returns {Array} item yang jatuh tempo, masing-masing diberi `terlambat`
 */
export function saringJatuhTempo(items, terakhirPerItem, hariIni) {
  const peta = terakhirPerItem ?? new Map();
  return (items ?? [])
    .filter((it) => jatuhTempo({ hariIni, terakhir: peta.get(it.id) ?? null, interval: it?.interval_days }))
    .map((it) => ({
      ...it,
      terlambat: hariTerlambat({ hariIni, terakhir: peta.get(it.id) ?? null, interval: it?.interval_days })
    }));
}
