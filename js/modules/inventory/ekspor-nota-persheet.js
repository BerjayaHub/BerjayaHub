/**
 * EKSPOR NOTA TERIMA: satu sheet per nota, lengkap dengan foto notanya.
 *
 * Sheet PERTAMA tetap rincian gabungan seluruh rentang. Itu bukan sisa dari
 * bentuk lama — ia yang menjawab pertanyaan "berapa total belanja bulan ini",
 * dan tanpanya orang harus membuka 40 tab untuk menjumlahkan sendiri.
 */
import { exportSheetsXLSXFoto } from '../../core/xlsx-foto.js';
import { imageToDataUrl } from '../../core/pdf.js';
import { itemNotaBanyak, urlFotoNotaBanyak } from './nota.service.js';
import { susunLaporanNota } from './laporan-nota.js';
import { periksaBatas, namaSheet } from './aturan-nota-persheet.js';

/**
 * @param {object} o
 *   notas     nota yang SEDANG TAMPIL di layar
 *   hpp       Map harga pokok, untuk baris yang belum berharga
 *   sheetGabungan { name, title, subtitle, columns, rows } — sheet pertama
 *   namaBerkas
 */
export async function unduhNotaPerSheet({ notas, hpp, sheetGabungan, namaBerkas }) {
  const daftar = (Array.isArray(notas) ? notas : []).filter((n) => n && n.id);
  if (!daftar.length) throw new Error('Tidak ada nota pada rentang ini.');

  const tolak = periksaBatas(daftar.length);
  if (tolak) throw new Error(tolak);

  const items = await itemNotaBanyak(daftar.map((n) => n.id));
  const itemPer = new Map();
  for (const it of items) {
    if (!itemPer.has(it.receipt_id)) itemPer.set(it.receipt_id, []);
    itemPer.get(it.receipt_id).push(it);
  }

  // Foto: satu permintaan tanda tangan untuk seluruh nota, lalu diunduh
  // berurutan. Serentak membuat peramban di HP kehabisan memori.
  const paths = [...new Set(daftar.map((n) => n.photo_path).filter(Boolean))];
  const urls = paths.length ? await urlFotoNotaBanyak(paths).catch(() => new Map()) : new Map();
  const foto = new Map();
  for (const [path, url] of urls.entries()) {
    foto.set(path, (await imageToDataUrl(url, 700, 0.72)) ?? 'GAGAL');
  }

  const sheets = [sheetGabungan].filter(Boolean);
  let tanpaBaris = 0;
  let tanpaFoto = 0;

  daftar.forEach((n, i) => {
    const barisItem = itemPer.get(n.id) ?? [];
    if (!barisItem.length) tanpaBaris += 1;
    if (!n.photo_path) tanpaFoto += 1;

    const lap = susunLaporanNota({ nota: n, items: barisItem, hpp });
    sheets.push({
      name: namaSheet(n, i),
      title: lap.judul,
      subtitle: `${lap.subjudul}${n.status === 'dibatalkan' ? ' · NOTA DIBATALKAN' : ''} — total ${lap.totalTeks}`,
      columns: lap.kolom,
      // Nota tanpa baris tetap mendapat sheetnya sendiri, berisi satu baris
      // penjelas. Melewatinya membuat jumlah sheet tidak cocok dengan jumlah
      // nota di layar, dan yang membacanya akan mengira notanya hilang.
      rows: lap.baris.length ? lap.baris : [['(nota ini belum ada rincian barangnya)', '', '', '', '', '']].map((r) => r.slice(0, lap.kolom.length)),
      foto: n.photo_path ? foto.get(n.photo_path) ?? 'GAGAL' : null,
      fotoKeterangan: `Foto nota ${n.code ?? ''}`.trim()
    });
  });

  const hasil = await exportSheetsXLSXFoto({ filename: namaBerkas, sheets });
  return { ...hasil, nota: daftar.length, tanpaBaris, tanpaFoto };
}

// Diteruskan supaya layar cukup mengimpor satu berkas; aturannya tetap
// tinggal di modul murni yang bisa dites tanpa jaringan.
export { periksaBatas, namaSheet, BATAS_SHEET, pesanHasilPerSheet } from './aturan-nota-persheet.js';
