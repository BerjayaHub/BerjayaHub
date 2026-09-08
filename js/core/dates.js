// =========================================================
// Helper tanggal bersama (zona WIB / Asia-Jakarta).
// Dipakai untuk menyeragamkan default filter periode di semua modul:
// "dari" = tanggal 1 bulan berjalan, "sampai" = hari ini.
// =========================================================

const pad = (n) => String(n).padStart(2, '0');

function wibNow() {
  return new Date(Date.now() + 7 * 3600000);
}

/** 'YYYY-MM-DD' hari ini (WIB). */
export function todayWIB() {
  const d = wibNow();
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** { from: tgl 1 bulan ini, to: hari ini } dalam 'YYYY-MM-DD' (WIB). */
export function monthRangeWIB() {
  const d = wibNow();
  const y = d.getUTCFullYear();
  const m = pad(d.getUTCMonth() + 1);
  return { from: `${y}-${m}-01`, to: `${y}-${m}-${pad(d.getUTCDate())}` };
}

/**
 * Tanggal terakhir bulan berjalan (WIB), 'YYYY-MM-DD'.
 *
 * Dipakai modul yang menatap ke DEPAN (reservasi), bukan ke belakang seperti
 * `monthRangeWIB()`. Hari 0 bulan berikutnya = hari terakhir bulan ini, jadi
 * Februari dan tahun kabisat tidak perlu diurus sendiri.
 */
export function monthEndWIB() {
  const d = wibNow();
  const akhir = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
  return `${akhir.getUTCFullYear()}-${pad(akhir.getUTCMonth() + 1)}-${pad(akhir.getUTCDate())}`;
}

/**
 * 'YYYY-MM-DD' (WIB) dari sebuah `timestamptz`.
 *
 * Bukan `String(instant).slice(0, 10)`. Nilai timestamptz datang dari PostgREST
 * dalam UTC, dan penerimaan barang pukul 20:00 WIB tersimpan sebagai
 * `...T13:00:00Z` — hari yang sama. Tapi penerimaan pukul 23:30 WIB tersimpan
 * sebagai `T16:30:00Z` HARI YANG SAMA, sementara input pukul 00:30 WIB
 * tersimpan sebagai `T17:30:00Z` HARI SEBELUMNYA. Memotong sepuluh huruf
 * pertama akan melaporkan penerimaan dini hari ke ESB pada tanggal kemarin.
 *
 * Bentuk kegagalannya persis yang paling mahal di sini: tanggalnya tetap
 * tanggal yang masuk akal, cuma salah satu hari, dan baru terlihat saat stok
 * dua hari itu dibandingkan.
 */
export function tanggalWIB(instant) {
  if (!instant) return '';
  const d = new Date(instant);
  if (Number.isNaN(d.getTime())) return '';
  const w = new Date(d.getTime() + 7 * 3600000);
  return `${w.getUTCFullYear()}-${pad(w.getUTCMonth() + 1)}-${pad(w.getUTCDate())}`;
}

/** Geser sebuah 'YYYY-MM-DD' sebanyak n hari. */
export function geserHari(tanggal, n) {
  const d = new Date(tanggal + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/**
 * Batas ISO untuk query `timestamptz` dari input date 'YYYY-MM-DD'.
 *
 * ============ KENAPA OFFSET WIB DITULIS EKSPLISIT ============
 *
 * Dua jebakan sekaligus, dan keduanya sudah menggigit di Rekap NBM.
 *
 * 1. **`new Date('2026-08-31')` dibaca sebagai UTC**, sementara
 *    `new Date('2026-08-31T00:00:00')` dibaca sebagai waktu LOKAL. Beda tata
 *    bahasa yang sama sekali tidak terlihat. Layar rekap memakai bentuk
 *    pertama untuk batas AWAL dan bentuk kedua untuk batas AKHIR — jadi
 *    batas awalnya melompat ke pukul 07:00 WIB, dan tujuh jam pertama tanggal
 *    itu hilang tanpa satu pun error.
 *
 * 2. **Waktu lokal itu milik BROWSER, bukan milik usahanya.** Admin yang
 *    laptopnya masih WITA, atau yang sedang di luar negeri, mendapat rentang
 *    yang bergeser 1–8 jam dari yang dilihat rekannya — untuk filter tanggal
 *    yang sama persis.
 *
 * Seluruh sistem ini beroperasi di WIB, dan WIB tidak mengenal DST, jadi
 * offsetnya ditulis apa adanya: `+07:00`. Hasilnya sama di perangkat mana pun.
 */
export function isoFrom(dateStr) {
  return dateStr ? new Date(`${dateStr}T00:00:00+07:00`).toISOString() : '';
}
export function isoTo(dateStr) {
  // 23:59:59, bukan 23:59:59.999 — `lte` terhadap `timestamptz` berpresisi
  // mikrodetik akan melewatkan absensi yang jatuh di sisa detik terakhir hari
  // itu. Kasusnya langka, tapi bentuk kegagalannya sama: baris yang ada di
  // database dan tidak pernah muncul di layar.
  return dateStr ? new Date(`${dateStr}T23:59:59.999+07:00`).toISOString() : '';
}
