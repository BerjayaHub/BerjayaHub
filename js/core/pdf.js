// =========================================================
// Helper PDF bersama (jsPDF dari CDN). Dipakai untuk export tabel
// (rekap presensi, rekap NBM, dll) dan surat jalan.
// =========================================================

let jsPdfPromise = null;

export function loadJsPDF() {
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

/**
 * Export tabel sederhana ke PDF (A4 landscape) lalu unduh.
 * @param {object} o
 *   title    judul dokumen
 *   subtitle keterangan (mis. periode & outlet)
 *   columns  [{ header, width? , align? }]
 *   rows     array of array (string)
 *   filename nama file (tanpa .pdf)
 */
export async function exportTablePDF({ title, subtitle = '', columns, rows, filename = 'laporan' }) {
  const JsPDF = await loadJsPDF();
  const doc = new JsPDF({ unit: 'pt', format: 'a4', orientation: 'landscape' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 32;
  let y = M;

  const totalW = W - M * 2;
  const weights = columns.map((c) => c.width ?? 1);
  const sumW = weights.reduce((a, b) => a + b, 0);
  const colW = weights.map((w) => (w / sumW) * totalW);
  const colX = [];
  let acc = M;
  for (const w of colW) {
    colX.push(acc);
    acc += w;
  }

  const drawHeader = () => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text(title, M, y);
    y += 16;
    if (subtitle) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(110);
      doc.text(subtitle, M, y);
      doc.setTextColor(0);
      y += 14;
    }
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    columns.forEach((c, i) => doc.text(String(c.header), colX[i], y, { maxWidth: colW[i] - 4 }));
    y += 5;
    doc.setDrawColor(180);
    doc.line(M, y, W - M, y);
    y += 11;
    doc.setFont('helvetica', 'normal');
  };

  drawHeader();

  for (const row of rows) {
    if (y > H - M - 20) {
      doc.addPage();
      y = M;
      drawHeader();
    }
    row.forEach((cell, i) => {
      const text = String(cell ?? '-');
      doc.text(text.length > 60 ? text.slice(0, 57) + '…' : text, colX[i], y, { maxWidth: colW[i] - 4 });
    });
    y += 14;
  }

  y += 4;
  doc.setDrawColor(210);
  doc.line(M, y, W - M, y);
  y += 12;
  doc.setFontSize(8);
  doc.setTextColor(120);
  doc.text(`Dicetak ${new Date().toLocaleString('id-ID')} — Berjaya Hub`, M, y);

  doc.save(`${filename}.pdf`);
}
