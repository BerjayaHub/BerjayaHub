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
 *   orientation 'landscape' (default) atau 'portrait'. Landscape untuk laporan
 *            berkolom banyak; portrait untuk daftar yang ingin dicetak/dibaca
 *            seperti dokumen biasa. Lebar kolom dihitung dari lebar kertas,
 *            jadi `width` pada kolom tetap bekerja di keduanya.
 *
 * CATATAN GAMBAR: pakai data URL (base64), bukan URL http. jsPDF memuat gambar
 * secara sinkron, jadi URL jaringan akan menghasilkan halaman kosong tanpa
 * error apa pun — kegagalan sunyi yang sulit dilacak. Ubah dulu ke data URL
 * lewat `imageToDataUrl()` di bawah, yang sekaligus memperkecil ukurannya.
 */
export async function exportTablePDF({
  title,
  subtitle = '',
  columns,
  rows,
  filename = 'laporan',
  maxLines = 3,
  orientation = 'landscape'
}) {
  const JsPDF = await loadJsPDF();
  const doc = new JsPDF({ unit: 'pt', format: 'a4', orientation });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 32;
  const LH = 10; // tinggi satu baris teks
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

  // KENAPA DIPOTONG SENDIRI, BUKAN PAKAI maxWidth:
  // opsi { maxWidth } milik jsPDF memang membungkus teks, tapi ia menggambar
  // baris kelanjutannya ke BAWAH tanpa memberi tahu siapa pun. Tinggi baris di
  // sini dulu dipatok 14pt, jadi alamat KTP yang panjang menimpa baris staff
  // berikutnya — persis "teks tumpuk" yang terlihat di export Data Staff.
  // Sekarang teksnya dipecah lebih dulu supaya tinggi barisnya bisa dihitung.
  const pecah = (teks, lebar) => {
    const baris = doc.splitTextToSize(String(teks ?? '-'), Math.max(12, lebar - 6));
    if (baris.length <= maxLines) return baris;
    const dipangkas = baris.slice(0, maxLines);
    dipangkas[maxLines - 1] = String(dipangkas[maxLines - 1]).replace(/\s*\S*$/, '') + '…';
    return dipangkas;
  };

  const tulisSel = (baris, i, atas) => {
    const c = columns[i] ?? {};
    baris.forEach((t, k) => {
      const opsi = {};
      if (c.align === 'right') opsi.align = 'right';
      else if (c.align === 'center') opsi.align = 'center';
      const x = c.align === 'right' ? colX[i] + colW[i] - 6 : c.align === 'center' ? colX[i] + colW[i] / 2 : colX[i];
      doc.text(t, x, atas + k * LH, opsi);
    });
  };

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
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    const judulKolom = columns.map((c, i) => pecah(c.header, colW[i]));
    const tinggiJudul = Math.max(...judulKolom.map((b) => b.length)) * LH;
    judulKolom.forEach((b, i) => tulisSel(b, i, y));
    y += tinggiJudul - LH + 5;
    doc.setDrawColor(180);
    doc.line(M, y, W - M, y);
    y += 11;
    doc.setFont('helvetica', 'normal');
  };

  drawHeader();

  const isGambar = (c) => c && typeof c === 'object' && typeof c.image === 'string';

  for (const row of rows) {
    // Tinggi baris ditentukan oleh isi paling tinggi — gambar ATAU teks yang
    // membungkus jadi beberapa baris. Dihitung SEBELUM cek ganti halaman supaya
    // tidak ada yang terpotong di batas bawah kertas.
    const sel = row.map((c, i) => (isGambar(c) ? null : pecah(c, colW[i])));
    const tinggiGambar = row.reduce((t, c) => (isGambar(c) ? Math.max(t, c.h ?? 34) : t), 0);
    const tinggiTeks = Math.max(1, ...sel.map((b) => (b ? b.length : 1))) * LH;
    const tinggiBaris = Math.max(tinggiGambar ? tinggiGambar + 6 : 0, tinggiTeks) + 4;

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
          // y adalah garis dasar teks baris pertama, jadi gambar digeser ke atas
          // supaya sejajar dengan teks di kolom sebelahnya.
          doc.addImage(cell.image, 'JPEG', colX[i], y - h + 8, w, h);
        } catch {
          // Satu gambar rusak tidak boleh membatalkan seluruh laporan.
          doc.text('(foto gagal)', colX[i], y);
        }
        return;
      }
      tulisSel(sel[i], i, y);
    });

    y += tinggiBaris;
    doc.setDrawColor(232);
    doc.line(M, y - 7, W - M, y - 7);
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
