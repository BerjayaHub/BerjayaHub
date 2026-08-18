import { infoDialog, toast } from '../../core/ui.js';
import { exportTablePDF } from '../../core/pdf.js';
import { exportTableXLSX } from '../../core/xlsx.js';
import { susunDokumen } from './dokumen.js';
import { getOrderForDoc, getDispatchForDoc } from './dispatch.service.js';
import { listProducts, listRecipesFull, computeCosts } from '../product/product.service.js';

/**
 * Dialog "lihat dokumen" untuk satu nomor order / surat jalan, plus unduhannya.
 *
 * DIPAKAI BERSAMA Staff App dan Admin Portal, dengan satu perbedaan yang
 * disengaja: `denganNilai`. Surat jalan yang dipegang kurir tidak perlu memuat
 * modal; rekap yang dibaca admin justru butuh.
 *
 * Perlu diingat saat membaca ini: menyembunyikan kolom nilai BUKAN pengaman.
 * `products_select` membuka harga beli untuk semua anggota BU. Yang diatur di
 * sini adalah apa yang ikut BEREDAR di kertas dan WhatsApp.
 */
export async function bukaDokumen({ jenis, id, businessUnitId, denganNilai = false }) {
  let data;
  let biaya = new Map();
  try {
    data = jenis === 'order' ? await getOrderForDoc(id) : await getDispatchForDoc(id);
    if (denganNilai) {
      // HPP diambil HANYA kalau memang akan ditampilkan. Dua query tambahan
      // untuk kolom yang tidak jadi dipakai membuat dialog terasa lambat justru
      // di Staff App, yang paling sering dibuka di jaringan seadanya.
      const [products, recipes] = await Promise.all([listProducts(businessUnitId), listRecipesFull(businessUnitId)]);
      biaya = computeCosts(products, recipes);
    }
  } catch (error) {
    toast(error.message ?? 'Gagal memuat dokumen.', 'error');
    return;
  }

  const dok = susunDokumen({ jenis, header: data.header, items: data.items, denganNilai, biaya });

  const infoHtml = dok.info
    .map(([k, v]) => `<tr><td style="color:var(--color-text-muted);padding-right:10px;white-space:nowrap">${esc(k)}</td><td>${esc(v)}</td></tr>`)
    .join('');
  const barisHtml = dok.baris
    .map((sel) => `<tr>${sel.map((c, i) => `<td${dok.kolom[i]?.align === 'right' ? ' style="text-align:right"' : ''}>${esc(c)}</td>`).join('')}</tr>`)
    .join('');

  infoDialog({
    title: `${dok.judul} ${dok.nomor}`,
    bodyHtml: `
      <table style="font-size:0.85rem;margin-bottom:10px"><tbody>${infoHtml}</tbody></table>
      <div class="table-scroll"><table class="data-table">
        <thead><tr>${dok.kolom.map((k) => `<th${k.align === 'right' ? ' style="text-align:right"' : ''}>${esc(k.header)}</th>`).join('')}</tr></thead>
        <tbody>${barisHtml || `<tr><td colspan="${dok.kolom.length}">Dokumen ini tidak berisi barang.</td></tr>`}</tbody>
      </table></div>
      ${dok.totalTeks ? `<p style="margin:10px 0 0;font-weight:600">Total nilai: ${esc(dok.totalTeks)}</p>` : ''}
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
        <button id="dok-pdf">⇩ PDF</button>
        <button id="dok-xlsx">⇩ Excel (.xlsx)</button>
      </div>
    `,

    // Dipasang lewat `onReady`, yang menerima badan dialog ITU SENDIRI.
    //
    // Versi sebelumnya mencari `document.querySelector('.modal-overlay:last-of-type')`
    // dan kebetulan bekerja. Kebetulan, karena `:last-of-type` menyeleksi <div>
    // terakhir di antara saudaranya — bukan `.modal-overlay` terakhir. Begitu
    // ada satu <div> lain yang menyusul di <body> (wadah toast, sheet, apa pun),
    // seleksinya meleset, `?.` menelan hasilnya diam-diam, dan kedua tombol
    // unduh ini berhenti bekerja tanpa satu pun pesan error.
    onReady: (body) => {
      body.querySelector('#dok-pdf')?.addEventListener('click', async () => {
        try {
          await exportTablePDF({
            title: `${dok.judul} ${dok.nomor}`,
            subtitle: dok.info.map(([k, v]) => `${k}: ${v}`).join(' · '),
            columns: dok.kolom,
            filename: dok.namaBerkas,
            orientation: 'portrait',
            // Total ditaruh sebagai BARIS TERAKHIR, bukan catatan kaki:
            // `exportTablePDF` tidak punya catatan kaki, dan total yang menempel
            // pada tabelnya justru lebih sulit terpisah saat halamannya difoto.
            rows: dok.totalTeks ? [...dok.baris, barisTotal(dok)] : dok.baris
          });
        } catch (error) {
          toast(error.message ?? 'Gagal membuat PDF.', 'error');
        }
      });
      body.querySelector('#dok-xlsx')?.addEventListener('click', async () => {
        try {
          await exportTableXLSX({
            filename: dok.namaBerkas,
            sheetName: dok.judul,
            title: `${dok.judul} ${dok.nomor}`,
            subtitle: dok.info.map(([k, v]) => `${k}: ${v}`).join(' · '),
            columns: dok.kolom,
            rows: dok.totalTeks ? [...dok.baris, barisTotal(dok)] : dok.baris
          });
        } catch (error) {
          toast(error.message ?? 'Gagal membuat Excel.', 'error');
        }
      });
    }
  });
}

/** Baris "Total nilai" yang sejajar dengan kolom Nilai di paling kanan. */
function barisTotal(dok) {
  const sel = Array(dok.kolom.length).fill('');
  sel[0] = 'Total nilai';
  sel[dok.kolom.length - 1] = dok.totalTeks;
  return sel;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
