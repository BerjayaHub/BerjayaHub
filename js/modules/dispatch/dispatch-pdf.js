import { formatNum } from '../../core/format.js';

let jsPdfPromise = null;
function loadJsPDF() {
  if (window.jspdf?.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
  if (!jsPdfPromise) {
    jsPdfPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
      s.onload = () => resolve(window.jspdf.jsPDF);
      s.onerror = () => reject(new Error('Gagal memuat pustaka PDF (cek koneksi internet).'));
      document.head.appendChild(s);
    });
  }
  return jsPdfPromise;
}

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

/** Teks ringkas surat jalan untuk dikirim via WhatsApp (file PDF dilampirkan manual). */
export function suratJalanWaText(data) {
  const lines = [
    `*${data.title || 'Surat Jalan'} ${data.code || ''}*`,
    `Dari: ${data.fromName} → ${data.toName}`,
    `Tanggal: ${data.dateStr}`,
    '',
    ...data.items.map((it) => `• ${it.name}: ${qty(it.sent)}${data.showReceived ? ` (diterima ${qty(it.received)})` : ''} ${it.unit ?? ''}`)
  ];
  if (data.notes) lines.push('', `Catatan: ${data.notes}`);
  lines.push('', '(PDF surat jalan terlampir)');
  return lines.join('\n');
}

export function openWhatsApp(text) {
  window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank');
}
