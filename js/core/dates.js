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

/** Geser sebuah 'YYYY-MM-DD' sebanyak n hari. */
export function geserHari(tanggal, n) {
  const d = new Date(tanggal + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Batas ISO untuk query timestamptz dari input date 'YYYY-MM-DD'. */
export function isoFrom(dateStr) {
  return dateStr ? new Date(`${dateStr}T00:00:00`).toISOString() : '';
}
export function isoTo(dateStr) {
  return dateStr ? new Date(`${dateStr}T23:59:59`).toISOString() : '';
}
