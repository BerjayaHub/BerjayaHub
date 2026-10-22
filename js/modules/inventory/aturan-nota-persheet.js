/**
 * ATURAN MURNI untuk ekspor "satu sheet per nota".
 *
 * Tanpa jaringan, tanpa Excel — supaya aturan yang membuat berkasnya GAGAL
 * DIBUKA bisa diuji tanpa menyentuh Supabase sama sekali.
 *
 * Dipisah dari `ekspor-nota-persheet.js` karena berkas itu mengimpor
 * `nota.service.js`, yang menarik klien Supabase dari CDN — dan satu impor itu
 * membuat SELURUH aturan di sini tidak bisa dijalankan di Node. Tesnya gagal
 * dengan `ERR_UNSUPPORTED_ESM_URL_SCHEME`, yang tidak menyebut apa pun tentang
 * nama sheet.
 */

/**
 * ============ KENAPA ADA BATAS, DAN KENAPA IA MENOLAK ============
 *
 * Tiap sheet membawa satu foto. Di 50 nota itu ~50 gambar yang harus diunduh,
 * dikecilkan, dan ditanam — berkasnya belasan MB dan penyiapannya puluhan
 * detik. Di 300 nota, peramban di HP kehabisan memori dan tabnya mati tanpa
 * satu pun pesan.
 *
 * Jadi batasnya MENOLAK dengan menyebut angkanya dan jalan keluarnya, bukan
 * memotong diam-diam di nota ke-50. Unduhan yang berisi separuh rentang tanpa
 * memberi tahu adalah bentuk kegagalan yang paling mahal di berkas yang dipakai
 * mencocokkan tagihan.
 */
export const BATAS_SHEET = 60;

export function periksaBatas(jumlahNota, batas = BATAS_SHEET) {
  if (jumlahNota <= batas) return null;
  return (
    `Rentang ini berisi ${jumlahNota} nota — terlalu banyak untuk satu berkas bersheet-per-nota ` +
    `(batas ${batas}). Persempit rentang tanggalnya, atau pilih satu outlet, lalu ulangi. ` +
    `Ekspor "Rincian + Rekap" yang lama tidak punya batas ini.`
  );
}

/** Nama sheet: kode nota, dibersihkan dari karakter yang ditolak Excel. */
export function namaSheet(nota, urutan) {
  const kode = String(nota?.code || nota?.invoice_no || `Nota ${urutan + 1}`);
  // Excel menolak : \ / ? * [ ] pada nama sheet — berkasnya GAGAL DIBUKA,
  // bukan sekadar tampil aneh. Nomor nota supplier sering memuat "/".
  return kode.replace(/[:\\/?*[\]]+/g, '-').slice(0, 31) || `Nota ${urutan + 1}`;
}

/** Kalimat hasil — menyebut yang kurang, bukan cuma "berhasil". */
export function pesanHasilPerSheet(h) {
  if (!h) return '';
  const catatan = [
    h.tanpaBaris ? `${h.tanpaBaris} nota belum ada rincian barangnya` : '',
    h.tanpaFoto ? `${h.tanpaFoto} nota tidak berfoto` : '',
    h.gagalFoto ? `${h.gagalFoto} foto gagal dimuat` : ''
  ].filter(Boolean);
  return `${h.nota} nota diekspor (${h.adaFoto} berfoto).` + (catatan.length ? ` Catatan: ${catatan.join('; ')}.` : '');
}
