import { listDispatchesAdmin, listItemKirimanAdmin, DISPATCH_STATUS } from './dispatch.service.js';
import { bukaDokumen } from './dokumen-ui.js';
import { loadingHtml, sekaliJalan } from '../../core/loading.js';
import { monthRangeWIB, isoFrom, isoTo } from '../../core/dates.js';
import { listMyOutlets } from '../../core/my-outlets.js';
import { exportSheetsXLSX } from '../../core/xlsx.js';
import { exportTablePDF } from '../../core/pdf.js';
import { toast } from '../../core/ui.js';
import { listProducts, listRecipesFull, computeCosts } from '../product/product.service.js';
import { KOLOM_RINCIAN, KOLOM_REKAP, susunRekapKiriman, ringkasKiriman } from './rekap-kiriman.js';

const STATUS_BADGE = { draft: 'badge-pending', sent: 'badge', received: 'badge-approved', cancelled: 'badge-cancelled' };

export async function renderDispatchAdminPage(container, { businessUnitId }) {
  const range = monthRangeWIB();
  // Gagal memuat outlet TIDAK mematikan halaman: daftar dokumennya tetap bisa
  // dibaca, yang hilang cuma dua saringan tambahan.
  const outlets = await listMyOutlets(businessUnitId).catch(() => []);
  const opsiOutlet = outlets.map((o) => `<option value="${esc(o.id)}">${esc(o.name)}</option>`).join('');

  container.innerHTML = `
    <h1>Pengiriman</h1>
    <div class="inline-card" style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end">
      <div class="field" style="margin:0"><label>Status</label>
        <select id="dp-status"><option value="">Semua</option>${Object.entries(DISPATCH_STATUS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
      </div>
      <div class="field" style="margin:0;max-width:200px"><label>Dari outlet</label>
        <select id="dp-from-outlet"><option value="">Semua outlet</option>${opsiOutlet}</select>
      </div>
      <div class="field" style="margin:0;max-width:200px"><label>Ke outlet</label>
        <select id="dp-to-outlet"><option value="">Semua outlet</option>${opsiOutlet}</select>
      </div>
      <div class="field" style="margin:0"><label>Dari</label><input type="date" id="dp-from" value="${range.from}" /></div>
      <div class="field" style="margin:0"><label>Sampai</label><input type="date" id="dp-to" value="${range.to}" /></div>
      <button class="primary" id="dp-go" style="max-width:120px">Tampilkan</button>
    </div>

    <!-- UNDUHAN BARANG, bukan unduhan dokumen.
         Tabel di bawah berisi SURAT JALAN; yang dipertanyakan orang justru
         BARANGNYA — "bulan ini Serpong menerima apa saja dari CK". Sebelum ini
         satu-satunya jalan adalah membuka surat jalan satu per satu lalu
         menggabungkannya sendiri di Excel. -->
    <div class="inline-card" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:10px">
      <button id="dp-xlsx">⇩ Excel barang terkirim</button>
      <button id="dp-pdf">⇩ PDF barang terkirim</button>
      <span style="font-size:0.78rem;color:var(--color-text-muted)">
        Satu berkas, dua sheet: <strong>Rincian</strong> per baris barang, dan <strong>Rekap</strong> yang
        menjumlahkannya per barang. Mengikuti saringan di atas.
      </span>
    </div>

    <div id="dp-result"></div>
  `;
  const go = () => load(container, businessUnitId);
  container.querySelector('#dp-go').addEventListener('click', go);
  container.querySelector('#dp-xlsx').addEventListener('click', sekaliJalan(() => unduh(container, businessUnitId, 'xlsx'), { teks: 'Menyiapkan…' }));
  container.querySelector('#dp-pdf').addEventListener('click', sekaliJalan(() => unduh(container, businessUnitId, 'pdf'), { teks: 'Menyiapkan…' }));
  await go();
}

/** Saringan yang sedang aktif — dibaca SEKALI, dipakai daftar & unduhan. */
function saringan(container) {
  return {
    status: container.querySelector('#dp-status').value || '',
    fromOutletId: container.querySelector('#dp-from-outlet')?.value || '',
    toOutletId: container.querySelector('#dp-to-outlet')?.value || '',
    from: container.querySelector('#dp-from').value,
    to: container.querySelector('#dp-to').value
  };
}

/**
 * Kalimat "yang sedang disaring", untuk subjudul berkas.
 *
 * Berkas yang tidak menyebutkan saringannya terlihat seperti laporan LENGKAP
 * di tangan orang yang menerimanya — dan ia tidak punya cara tahu ia cuma
 * melihat sebagian. Kesalahan yang sama baru dibereskan di modul Aset.
 */
function ringkasSaringan(s, namaOutlet) {
  const bagian = [`${s.from} s/d ${s.to}`];
  if (s.status) bagian.push(`Status: ${DISPATCH_STATUS[s.status] ?? s.status}`);
  if (s.fromOutletId) bagian.push(`Dari: ${namaOutlet.get(s.fromOutletId) ?? s.fromOutletId}`);
  if (s.toOutletId) bagian.push(`Ke: ${namaOutlet.get(s.toOutletId) ?? s.toOutletId}`);
  return bagian.join(' · ');
}

async function load(container, businessUnitId) {
  const s = saringan(container);
  const result = container.querySelector('#dp-result');
  result.innerHTML = loadingHtml('Memuat…', { baris: 5 });
  let rows;
  try {
    // SATU saringan, dipakai tabel DAN unduhan — keduanya menyaring di server
    // dengan argumen yang sama. Menyaring tabelnya di klien akan membuat dua
    // jawaban yang cepat atau lambat berbeda, dan bedanya cuma terlihat kalau
    // seseorang membandingkan layar dengan berkasnya.
    rows = await listDispatchesAdmin({
      businessUnitId,
      status: s.status,
      fromOutletId: s.fromOutletId,
      toOutletId: s.toOutletId,
      dateFrom: isoFrom(s.from),
      dateTo: isoTo(s.to)
    });
  } catch (error) {
    result.innerHTML = `<p class="error-text">${esc(error.message ?? error)}</p>`;
    return;
  }

  result.innerHTML = `
    <div class="table-scroll"><table class="data-table" style="margin-top:16px">
      <thead><tr><th>No. Surat Jalan</th><th>Waktu</th><th>Dari</th><th>Ke</th><th>Status</th><th>Pengirim</th><th>Penerima</th></tr></thead>
      <tbody>
        ${rows
          .map(
            (d) => `<tr>
              <td>
                <button class="btn-dp-detail" data-id="${d.id}" title="Lihat & unduh dokumen"
                  style="font-family:ui-monospace,Menlo,monospace;font-size:0.8rem">${esc(d.code ?? '(tanpa nomor)')}</button>
              </td>
              <td style="font-size:0.8rem">${fmtDateTime(d.created_at)}</td>
              <td>${esc(d.from_outlet?.name ?? '-')}</td>
              <td>${esc(d.to_outlet?.name ?? '-')}</td>
              <td><span class="badge ${STATUS_BADGE[d.status] ?? ''}">${DISPATCH_STATUS[d.status] ?? d.status}</span></td>
              <td>${esc(d.sender?.full_name ?? '-')}</td>
              <td>${esc(d.receiver?.full_name ?? '-')}</td>
            </tr>`
          )
          .join('') || '<tr><td colspan="7">Tidak ada data.</td></tr>'}
      </tbody>
    </table></div>
  `;
  // Nomor dokumen bisa diketuk -> dialog rincian + unduh PDF/xlsx.
  // Versi Admin BERNILAI: rekap yang dibaca admin butuh angka modalnya.
  result.querySelectorAll('.btn-dp-detail').forEach((btn) =>
    btn.addEventListener(
      'click',
      sekaliJalan(() => bukaDokumen({ jenis: 'dispatch', id: btn.dataset.id, businessUnitId, denganNilai: true }))
    )
  );
}

/**
 * Unduh BARANG-nya, bukan daftar dokumennya.
 *
 * Kedua bentuk disusun dari SATU penelusuran (`susunRekapKiriman`), jadi total
 * sheet Rincian dan sheet Rekap tidak bisa berbeda. Menyusunnya terpisah akan
 * menghasilkan dua angka yang tidak ada layarnya bisa menjelaskan selisihnya.
 */
async function unduh(container, businessUnitId, bentuk) {
  const s = saringan(container);
  let items;
  let biaya = new Map();
  try {
    // HPP diambil BERSAMAAN, bukan sesudahnya: keduanya tidak saling
    // bergantung, dan menunggunya berurutan membuat unduhan sebulan terasa
    // dua kali lebih lama tanpa alasan.
    const [daftar, products, recipes] = await Promise.all([
      listItemKirimanAdmin({
        businessUnitId,
        status: s.status,
        fromOutletId: s.fromOutletId,
        toOutletId: s.toOutletId,
        dateFrom: isoFrom(s.from),
        dateTo: isoTo(s.to)
      }),
      listProducts(businessUnitId),
      listRecipesFull(businessUnitId)
    ]);
    items = daftar;
    biaya = computeCosts(products, recipes);
  } catch (error) {
    return toast(error.message ?? 'Gagal mengambil data kiriman.', 'error');
  }

  if (!items.length) return toast('Tidak ada barang terkirim pada saringan ini.', 'warning');

  const hasil = susunRekapKiriman({ items, biaya, labelStatus: DISPATCH_STATUS });
  const r = ringkasKiriman(hasil);
  const namaOutlet = new Map(
    [...container.querySelectorAll('#dp-from-outlet option')].filter((o) => o.value).map((o) => [o.value, o.textContent])
  );
  const sub = ringkasSaringan(s, namaOutlet);
  // Angka yang dikatakan APA ADANYA. "belum diterima" disebut di subjudul
  // berkasnya, bukan cuma di layar — yang membuka berkasnya seminggu lagi cuma
  // punya berkasnya.
  const catatan = `${sub} · ${r.dokumen} surat jalan · ${r.baris} baris · ${r.barang} jenis barang${
    r.belum ? ` · ${r.belum} baris belum diterima` : ''
  }`;
  const nama = `barang-terkirim-${s.from}_${s.to}`;

  try {
    if (bentuk === 'xlsx') {
      await exportSheetsXLSX({
        filename: nama,
        sheets: [
          { name: 'Rincian', title: 'Barang Terkirim — Rincian', subtitle: catatan, columns: KOLOM_RINCIAN, rows: hasil.rincian },
          { name: 'Rekap per Barang', title: 'Barang Terkirim — Rekap per Barang', subtitle: catatan, columns: KOLOM_REKAP, rows: hasil.rekap }
        ]
      });
    } else {
      // PDF memuat REKAP-nya saja, dan itu disengaja: rincian sebulan bisa
      // ratusan baris, dan PDF ratusan baris tidak dibaca siapa pun. Yang
      // butuh rinciannya mengunduh Excel-nya — di sana ia bisa disaring.
      await exportTablePDF({
        title: 'Barang Terkirim — Rekap per Barang',
        subtitle: catatan,
        filename: nama,
        orientation: 'landscape',
        columns: KOLOM_REKAP,
        rows: hasil.rekap
      });
    }
    toast(
      r.belum
        ? `Berkas terunduh — ${r.belum} baris belum diterima, jadi kolom Diterima & Selisih-nya sengaja kosong.`
        : 'Berkas terunduh.',
      r.belum ? 'warning' : 'success'
    );
  } catch (error) {
    toast(error.message ?? 'Gagal membuat berkas.', 'error');
  }
}

function fmtDateTime(iso) {
  return new Date(iso).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
