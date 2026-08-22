// =========================================================
// Helper Excel bersama (SheetJS dari CDN, tanpa build step).
//
// Sebelumnya loader-nya hanya ada di dalam fleet-import.js. Begitu ada fitur
// kedua yang butuh Excel, menyalin loadernya berarti dua salinan yang harus
// dijaga sinkron — dan salah satunya pasti tertinggal saat versinya diganti.
// =========================================================

let xlsxPromise = null;

export function loadXLSX() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (!xlsxPromise) {
    xlsxPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
      s.onload = () => resolve(window.XLSX);
      s.onerror = () => reject(new Error('Gagal memuat pustaka Excel (cek koneksi internet).'));
      document.head.appendChild(s);
    });
  }
  return xlsxPromise;
}

/**
 * Teks yang sudah diformat -> angka, atau apa adanya kalau memang bukan angka.
 *
 * ============ `Number('')` ADALAH 0 ============
 *
 * Versi pertama fungsi ini membuang semua karakter non-angka lalu memanggil
 * `Number()`. Untuk "Rp 1.500.000" itu benar. Untuk "-", "n/a", atau "belum
 * ada", hasil pembuangannya adalah string KOSONG — dan `Number('')` adalah `0`,
 * yang lolos `isFinite`.
 *
 * Akibatnya sel bertanda "-" di kolom rupiah tertulis sebagai NOL. Selnya tampak
 * wajar, SUM-nya jalan, totalnya salah, dan tidak ada satu pun tanda. Bug ini
 * baru ketahuan saat helper Excel bergambar diuji isinya, dan diperbaiki di
 * kedua berkas sekaligus supaya tidak ada satu pun laporan yang tertinggal.
 *
 * Maka sisa pembuangannya diperiksa dulu: kalau tidak ada satu digit pun,
 * nilainya dikembalikan apa adanya sebagai teks.
 */
export function keAngka(nilai) {
  if (typeof nilai === 'number') return Number.isFinite(nilai) ? nilai : (nilai ?? '');
  if (nilai == null || nilai === '') return '';

  const bersih = String(nilai)
    .replace(/[^\d,.-]/g, '')
    .replace(/\.(?=\d{3}\b)/g, '')
    .replace(',', '.');

  if (!/\d/.test(bersih)) return nilai;

  const n = Number(bersih);
  return Number.isFinite(n) ? n : nilai;
}

/**
 * Unduh tabel sebagai .xlsx.
 *
 * @param {object} o
 *   filename  nama file tanpa ekstensi
 *   sheetName nama sheet
 *   columns   [{ header, numeric? }] — `numeric` menjaga angka tetap ANGKA
 *   rows      array of array
 *   title     judul opsional di baris pertama
 *   subtitle  keterangan opsional (periode, filter)
 *
 * KENAPA `numeric` PENTING: kalau semua sel ditulis sebagai teks, kolom rupiah
 * tidak bisa dijumlahkan di Excel — dan justru menjumlahkan itulah alasan orang
 * meminta export .xlsx alih-alih PDF.
 */
export async function exportTableXLSX({ filename = 'laporan', sheetName = 'Laporan', columns, rows, title = '', subtitle = '' }) {
  const XLSX = await loadXLSX();

  const aoa = [];
  if (title) aoa.push([title]);
  if (subtitle) aoa.push([subtitle]);
  if (title || subtitle) aoa.push([]);
  aoa.push(columns.map((c) => c.header));

  for (const row of rows) {
    aoa.push(
      row.map((sel, i) => {
        if (!columns[i]?.numeric) return sel ?? '';
        return keAngka(sel);
      })
    );
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  // Lebar kolom mengikuti isi terpanjang, dibatasi supaya tidak melebar liar.
  ws['!cols'] = columns.map((c, i) => {
    const isi = [c.header, ...rows.map((r) => String(r[i] ?? ''))];
    return { wch: Math.min(40, Math.max(10, ...isi.map((v) => String(v).length + 2))) };
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31)); // Excel batasi 31 karakter
  XLSX.writeFile(wb, `${filename}.xlsx`);
}
