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
 *   rows     array of array. Tiap sel boleh berupa teks, ATAU objek
 *            { image: dataUrl, w?, h? } untuk menyisipkan gambar.
 *   filename nama file (tanpa .pdf)
 *
 * CATATAN GAMBAR: pakai data URL (base64), bukan URL http. jsPDF memuat gambar
 * secara sinkron, jadi URL jaringan akan menghasilkan halaman kosong tanpa
 * error apa pun — kegagalan sunyi yang sulit dilacak. Ubah dulu ke data URL
 * lewat `imageToDataUrl()` di bawah, yang sekaligus memperkecil ukurannya.
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

  const isGambar = (c) => c && typeof c === 'object' && typeof c.image === 'string';

  for (const row of rows) {
    // Baris bergambar lebih tinggi. Dihitung SEBELUM cek ganti halaman, supaya
    // gambar tidak terpotong di batas bawah kertas.
    const tinggiGambar = row.reduce((t, c) => (isGambar(c) ? Math.max(t, c.h ?? 34) : t), 0);
    const tinggiBaris = tinggiGambar ? tinggiGambar + 6 : 14;

    if (y + tinggiBaris > H - M - 20) {
      doc.addPage();
      y = M;
      drawHeader();
    }

    row.forEach((cell, i) => {
      if (isGambar(cell)) {
        const w = cell.w ?? 46;
        const h = cell.h ?? 34;
        try {
          // y adalah garis dasar teks, jadi gambar digeser ke atas supaya
          // sejajar dengan teks di kolom sebelahnya.
          doc.addImage(cell.image, 'JPEG', colX[i], y - h + 8, w, h);
        } catch {
          // Satu gambar rusak tidak boleh membatalkan seluruh laporan.
          doc.text('(foto gagal)', colX[i], y, { maxWidth: colW[i] - 4 });
        }
        return;
      }
      const text = String(cell ?? '-');
      doc.text(text.length > 60 ? text.slice(0, 57) + '…' : text, colX[i], y, { maxWidth: colW[i] - 4 });
    });

    y += tinggiBaris;
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

/**
 * Unduh gambar lalu ubah jadi data URL JPEG yang sudah diperkecil.
 *
 * KENAPA DIPERKECIL: foto dari kamera HP berukuran 2-4 MB. Menyisipkan 50 foto
 * mentah menghasilkan PDF ratusan MB yang tidak bisa dibuka di HP — dan
 * gejalanya bukan error, melainkan browser yang menggantung. Di PDF fotonya
 * hanya dicetak sebesar ~46x34 pt, jadi 160 px sudah lebih dari cukup.
 *
 * Mengembalikan null kalau gagal (URL kedaluwarsa, offline, file hilang) —
 * pemanggil cukup mencetak "-" di sel itu. Satu foto bermasalah tidak boleh
 * membatalkan seluruh laporan.
 */
export function imageToDataUrl(url, maxPx = 160, quality = 0.7) {
  return new Promise((resolve) => {
    if (!url) return resolve(null);
    const img = new Image();
    img.crossOrigin = 'anonymous'; // signed URL Supabase mengirim header CORS
    img.onload = () => {
      try {
        const skala = Math.min(1, maxPx / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.width * skala));
        c.height = Math.max(1, Math.round(img.height * skala));
        const ctx = c.getContext('2d');
        // Latar putih: JPEG tidak punya transparansi, tanpa ini area transparan
        // jadi hitam.
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', quality));
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}
