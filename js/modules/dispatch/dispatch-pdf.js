import { formatNum } from '../../core/format.js';
import { loadJsPDF } from '../../core/pdf.js';
import { catatanBaris } from './pesan-kiriman.js';

// Teks WhatsApp-nya pindah ke `pesan-kiriman.js` — modul murni yang juga
// dipakai PDF di bawah, supaya kertas dan pesan tidak pernah menyimpang.
// Diekspor ulang dari sini supaya pemanggil lama tidak perlu diubah.
export { suratJalanWaText } from './pesan-kiriman.js';

const qty = (n) => (n == null ? '-' : formatNum(n));

/**
 * Buat & UNDUH PDF surat jalan.
 * data: { code, fromName, toName, dateStr, items:[{name, unit, sent, received}], notes, showReceived, title }
 * Return nama file.
 */
export async function buildSuratJalanPDF(data) {
  const JsPDF = await loadJsPDF();
  const doc = new JsPDF({ unit: 'pt', format: 'a5' });
  const M = 36;
  let y = M;
  const W = doc.internal.pageSize.getWidth();

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text(data.title || 'SURAT JALAN', W / 2, y, { align: 'center' });
  y += 20;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(`No: ${data.code || '-'}`, M, y);
  doc.text(`Tanggal: ${data.dateStr || '-'}`, W - M, y, { align: 'right' });
  y += 16;
  doc.text(`Dari : ${data.fromName || '-'}`, M, y);
  y += 14;
  doc.text(`Ke   : ${data.toName || '-'}`, M, y);
  y += 18;

  // Header tabel
  doc.setFont('helvetica', 'bold');
  const colProduk = M;
  const colSent = data.showReceived ? W - M - 120 : W - M - 70;
  const colRecv = W - M;
  doc.text('Produk', colProduk, y);
  doc.text('Dikirim', colSent, y, { align: 'right' });
  if (data.showReceived) doc.text('Diterima', colRecv, y, { align: 'right' });
  y += 6;
  doc.setLineWidth(0.5);
  doc.line(M, y, W - M, y);
  y += 12;

  doc.setFont('helvetica', 'normal');
  for (const it of data.items) {
    doc.text(String(it.name ?? '-').slice(0, 40), colProduk, y);
    doc.text(`${qty(it.sent)} ${it.unit ?? ''}`, colSent, y, { align: 'right' });
    if (data.showReceived) doc.text(`${qty(it.received)} ${it.unit ?? ''}`, colRecv, y, { align: 'right' });
    y += 14;

    // BARIS DI BAWAH NAMANYA: berapa yang diminta & keterangannya (0132).
    //
    // Surat jalan adalah dokumen yang dipegang saat barangnya diserahkan, dan
    // di situlah perselisihan "outlet tidak pesan" versus "CK tidak kirim"
    // terjadi. Kalau kertasnya tidak memuat jawabannya, layar yang memuatnya
    // tidak menolong siapa pun yang sedang berdiri di depan mobil.
    //
    // Disusun `pesan-kiriman.js`, SATU sumber dengan teks WhatsApp. Pemotongan
    // 60 karakter tetap diminta dari sini: lebar A5 adalah batas kertas, bukan
    // aturan bersama — memotong pesan WhatsApp sepanjang itu berarti membuang
    // kalimat yang muat hanya karena dokumen lain tidak muat.
    const catatan = catatanBaris(it, { potong: 60 });
    if (catatan.length) {
      doc.setFontSize(8);
      doc.setTextColor(110);
      doc.text(catatan.join(' — '), colProduk + 10, y);
      doc.setTextColor(0);
      doc.setFontSize(10);
      y += 12;
    }
    if (y > doc.internal.pageSize.getHeight() - 60) {
      doc.addPage();
      y = M;
    }
  }
  y += 6;
  doc.line(M, y, W - M, y);
  y += 16;

  if (data.notes) {
    doc.text(`Catatan: ${data.notes}`, M, y, { maxWidth: W - M * 2 });
    y += 24;
  }

  y = doc.internal.pageSize.getHeight() - 60;
  doc.text('Pengirim', M + 30, y, { align: 'center' });
  doc.text('Penerima', W - M - 30, y, { align: 'center' });

  const filename = `${(data.code || 'surat-jalan').replace(/[^\w-]/g, '')}.pdf`;
  doc.save(filename);
  return filename;
}

/** Buka WhatsApp dengan teksnya sudah terisi. PDF-nya dilampirkan manual. */
export function openWhatsApp(text) {
  window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank');
}
