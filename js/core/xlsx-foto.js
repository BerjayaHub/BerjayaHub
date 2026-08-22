// =========================================================
// Export Excel YANG BISA MEMUAT GAMBAR.
//
// ============ KENAPA BUKAN PAKAI xlsx.js YANG SUDAH ADA ============
//
// `core/xlsx.js` memakai SheetJS versi komunitas, dan versi itu TIDAK BISA
// menyisipkan gambar ke dalam .xlsx sama sekali — kemampuannya hanya ada di
// versi berbayar. Tidak ada opsi, tidak ada jalan memutar; `writeFile` cuma
// akan menghasilkan file tanpa gambar tanpa memberi tahu apa pun.
//
// Dua jalan pintas yang sengaja TIDAK diambil:
//
//   1. Formula `=IMAGE("url")`. Bucket foto aset bersifat privat, jadi yang bisa
//      dimasukkan hanya signed URL — dan signed URL kedaluwarsa. File yang hari
//      ini penuh gambar akan jadi deretan #REF dalam hitungan hari, di komputer
//      orang yang sudah tidak ingat file itu datang dari mana.
//
//   2. Tautan "lihat foto". Itu bukan yang diminta, dan ia punya masalah
//      kedaluwarsa yang sama.
//
// Jadi dipakai ExcelJS, yang menanam gambarnya SEBAGAI FILE di dalam .xlsx.
// Hasilnya tetap bergambar meski dibuka lima tahun lagi tanpa internet.
//
// Muatnya on-demand: pustakanya ~1 MB dan hanya perlu saat tombol ditekan.
// =========================================================

// Satu definisi saja untuk "teks terformat -> angka". Menyalinnya ke sini
// berarti dua tempat yang harus diperbaiki setiap kali bug `Number('')` muncul
// lagi — dan yang terlupakan tidak akan menghasilkan error, hanya total yang
// salah di salah satu laporan.
import { keAngka } from './xlsx.js';

let excelPromise = null;

export function loadExcelJS() {
  if (window.ExcelJS) return Promise.resolve(window.ExcelJS);
  if (!excelPromise) {
    excelPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js';
      s.onload = () => (window.ExcelJS ? resolve(window.ExcelJS) : reject(new Error('Pustaka Excel termuat tapi tidak dikenali.')));
      s.onerror = () => reject(new Error('Gagal memuat pustaka Excel bergambar (cek koneksi internet).'));
      document.head.appendChild(s);
    });
    // Janji yang gagal tidak boleh menetap. Kalau dibiarkan, satu gangguan
    // jaringan sesaat membuat tombolnya rusak sampai halaman dimuat ulang.
    excelPromise.catch(() => {
      excelPromise = null;
    });
  }
  return excelPromise;
}

/** Ukuran gambar di dalam sel, dalam piksel. */
const FOTO_W = 64;
const FOTO_H = 48;

/**
 * `data:image/jpeg;base64,…` -> { base64, extension } yang dimengerti ExcelJS.
 *
 * Base64-nya DIPERIKSA, bukan diteruskan begitu saja. Isi yang rusak membuat
 * pustaka ZIP melempar error saat berkasnya ditulis — yaitu di paling akhir,
 * setelah seluruh baris selesai diproses. Akibatnya laporan 300 aset batal
 * seluruhnya gara-gara satu foto yang cacat, dan pesannya ("Invalid base64
 * input") tidak menunjuk baris mana pun.
 *
 * Lebih baik satu sel berbunyi "-" daripada seluruh unduhan hilang.
 */
function pisahDataUrl(dataUrl) {
  const cocok = /^data:image\/(png|jpe?g|gif);base64,([A-Za-z0-9+/\s]+={0,2})$/i.exec(String(dataUrl ?? ''));
  if (!cocok) return null;

  const base64 = cocok[2].replace(/\s/g, '');
  // Base64 yang sah selalu kelipatan 4 karakter. Yang tidak, pasti terpotong.
  if (!base64 || base64.length % 4 !== 0) return null;

  const ext = cocok[1].toLowerCase() === 'jpg' ? 'jpeg' : cocok[1].toLowerCase();
  return { base64, extension: ext };
}

/**
 * Unduh tabel sebagai .xlsx dengan satu kolom berisi gambar.
 *
 * @param {object} o
 *   filename   nama file tanpa ekstensi
 *   sheetName  nama sheet
 *   columns    [{ header, numeric?, foto?, width? }] — tepat satu boleh `foto: true`
 *   rows       array of array. Sel di kolom foto berisi data URL, atau null.
 *   title      judul opsional
 *   subtitle   keterangan opsional
 *
 * SEL FOTO YANG KOSONG DIBEDAKAN DUA MACAM, dan ini bukan kerapian:
 *
 *   null / ''  -> "-"                    barangnya memang tidak berfoto
 *   'GAGAL'    -> "(foto gagal dimuat)"  berfoto, tapi gambarnya tidak terambil
 *
 * Kalau keduanya sama-sama dikosongkan, laporan inventaris akan terlihat seperti
 * separuh asetnya belum difoto — dan orang akan disuruh memfoto ulang barang
 * yang fotonya sudah ada.
 */
export async function exportTableXLSXFoto({
  filename = 'laporan',
  sheetName = 'Laporan',
  columns,
  rows,
  title = '',
  subtitle = ''
}) {
  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  wb.created = new Date();
  const ws = wb.addWorksheet(sheetName.slice(0, 31)); // Excel batasi 31 karakter

  const iFoto = columns.findIndex((c) => c.foto);

  // --- Judul
  let baris = 1;
  if (title) {
    ws.getCell(baris, 1).value = title;
    ws.getCell(baris, 1).font = { bold: true, size: 14 };
    baris++;
  }
  if (subtitle) {
    ws.getCell(baris, 1).value = subtitle;
    ws.getCell(baris, 1).font = { size: 10, color: { argb: 'FF666666' } };
    baris++;
  }
  if (title || subtitle) baris++;

  // --- Kepala kolom
  const barisKepala = baris;
  columns.forEach((c, i) => {
    const sel = ws.getCell(barisKepala, i + 1);
    sel.value = c.header;
    sel.font = { bold: true };
    sel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEFEF' } };
    sel.border = { bottom: { style: 'thin', color: { argb: 'FFBBBBBB' } } };
    sel.alignment = { vertical: 'middle' };
  });
  baris++;

  // --- Isi
  let adaFoto = 0;
  let gagalFoto = 0;

  for (const row of rows) {
    const r = baris;

    columns.forEach((c, i) => {
      const sel = ws.getCell(r, i + 1);
      sel.alignment = { vertical: 'middle', wrapText: !c.numeric && !c.foto };

      if (c.foto) {
        const nilai = row[i];
        const gambar = pisahDataUrl(nilai);
        if (gambar) {
          const id = wb.addImage(gambar);
          // `tl` + `ext` = jangkar satu-sel dengan ukuran tetap. Pecahan pada
          // col/row memberi sedikit jarak dari garis sel supaya gambarnya tidak
          // menempel ke pinggir.
          ws.addImage(id, {
            tl: { col: i + 0.12, row: r - 1 + 0.08 },
            ext: { width: FOTO_W, height: FOTO_H },
            editAs: 'oneCell'
          });
          adaFoto++;
        } else if (nilai === 'GAGAL') {
          // Dibedakan dari "tidak berfoto" — lihat penjelasan di JSDoc.
          sel.value = '(foto gagal dimuat)';
          sel.font = { size: 9, color: { argb: 'FFB03A2E' }, italic: true };
          gagalFoto++;
        } else {
          sel.value = '-';
          sel.font = { size: 9, color: { argb: 'FF999999' } };
        }
        return;
      }

      if (c.numeric) {
        // Angka yang sudah diformat ("1.500") dikembalikan jadi angka mentah,
        // supaya SUM di Excel bekerja — dan itu alasan orang meminta Excel
        // alih-alih PDF. Teks yang memang bukan angka ("-", "n/a") dibiarkan
        // apa adanya; lihat penjelasan panjang di `keAngka()`.
        sel.value = keAngka(row[i]);
        sel.alignment = { vertical: 'middle', horizontal: 'right' };
        return;
      }

      sel.value = row[i] ?? '';
    });

    // Tinggi baris disetel supaya gambarnya muat utuh. Tanpa ini gambar akan
    // menumpuk ke baris di bawahnya dan tabelnya jadi tidak terbaca.
    // ~0,75 pt per piksel, ditambah sedikit ruang.
    ws.getRow(r).height = iFoto >= 0 ? Math.round(FOTO_H * 0.78) + 6 : 18;
    baris++;
  }

  // --- Lebar kolom
  ws.columns.forEach((kolom, i) => {
    const c = columns[i];
    if (!c) return;
    if (c.foto) {
      // Lebar dalam satuan karakter; ~7 px per karakter.
      kolom.width = Math.round(FOTO_W / 7) + 2;
      return;
    }
    if (c.width) {
      kolom.width = c.width;
      return;
    }
    const isi = [c.header, ...rows.map((r) => String(r[i] ?? ''))];
    kolom.width = Math.min(40, Math.max(10, ...isi.map((v) => String(v).length + 2)));
  });

  // Baris kepala dibekukan supaya judul kolom tetap terlihat saat digulir —
  // pada tabel inventaris ratusan baris, ini bedanya bisa dibaca atau tidak.
  ws.views = [{ state: 'frozen', ySplit: barisKepala }];
  ws.autoFilter = { from: { row: barisKepala, column: 1 }, to: { row: barisKepala, column: columns.length } };

  const buffer = await wb.xlsx.writeBuffer();
  unduh(buffer, `${filename}.xlsx`);

  // Dikembalikan supaya pemanggil bisa mengatakan apa adanya berapa foto yang
  // ikut dan berapa yang gagal — bukan sekadar "berhasil".
  return { adaFoto, gagalFoto, barisTerkirim: rows.length };
}

function unduh(buffer, namaFile) {
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = namaFile;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Ditunda sebentar: mencabut URL terlalu cepat membatalkan unduhan di
  // sebagian peramban.
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
