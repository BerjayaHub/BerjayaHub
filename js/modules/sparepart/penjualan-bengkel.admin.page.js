import { toast, confirmDialog, formDialog, escapeHtml } from '../../core/ui.js';
import { formatRupiah } from '../../core/format.js';
import { loadingHtml, sekaliJalan } from '../../core/loading.js';
import { exportSheetsXLSX } from '../../core/xlsx.js';
import { exportTablePDF } from '../../core/pdf.js';
import { listOutletsForBu } from '../organization/organization.service.js';
import { omzetRentang, simpanOmzetHari, todayWIB } from './sparepart.service.js';
import { supabase } from '../../config/supabase-client.js';

/**
 * PENJUALAN BENGKEL — Admin Portal.
 *
 * Rekap omzet harian per outlet: Sparepart dan Jasa, nominal saja. Tidak ada
 * stok, tidak ada baris barang, tidak ada HPP — bengkel tidak melaporkannya.
 */
export async function renderPenjualanBengkelAdminPage(container, { businessUnitId }) {
  const akhir = todayWIB();
  const awal = akhir.slice(0, 8) + '01';

  const state = { dari: awal, sampai: akhir, outletId: '' };
  let baris = [];
  let outlets = [];

  const {
    data: { user }
  } = await supabase.auth.getUser();

  // ============ `muat()` DIPANGGIL PALING BAWAH, BUKAN DI SINI ============
  //
  // `muat()` memanggil `gambar()`, yang memanggil `tersaring()` — dan
  // `tersaring` adalah `const`, bukan `function`. `const` TIDAK terangkat:
  // memanggilnya sebelum barisnya dijalankan melempar ReferenceError.
  //
  // Yang terjadi di layar persis seperti yang dilaporkan: spinner "Memuat
  // penjualan bengkel…" berputar selamanya, TANPA pesan galat. Lemparannya
  // keluar dari `gambar()` yang berada di luar `try`, jadi tidak ada yang
  // menggantinya dengan teks kesalahan — satu-satunya jejaknya cuma baris
  // merah di console yang tidak dibuka siapa pun.
  //
  // Lihat pemanggilan `muat()` di baris terakhir fungsi ini.

  async function muat() {
    container.innerHTML = loadingHtml('Memuat penjualan bengkel…');
    try {
      [baris, outlets] = await Promise.all([
        omzetRentang(businessUnitId, state.dari, state.sampai),
        listOutletsForBu(businessUnitId)
      ]);
    } catch (error) {
      container.innerHTML = `<p class="error-text">Gagal memuat: ${error.message ?? error}</p>`;
      return;
    }
    gambar();
  }

  const tersaring = () => (state.outletId ? baris.filter((b) => b.outlet_id === state.outletId) : baris);

  /** Rekap per outlet — dan HARI PELAPORAN, bukan hari kalender. */
  function rekap() {
    const peta = new Map();
    for (const b of tersaring()) {
      const k = b.outlet_id;
      if (!peta.has(k)) peta.set(k, { outlet: b.outlets?.name ?? '—', sparepart: 0, jasa: 0, hari: 0 });
      const r = peta.get(k);
      r.sparepart += Number(b.omzet_sparepart) || 0;
      r.jasa += Number(b.omzet_jasa) || 0;
      // Jumlah HARI YANG DILAPORKAN, bukan jumlah hari dalam rentang. Rata-rata
      // yang dibagi hari kalender akan terlihat turun hanya karena ada hari
      // yang lupa dilapor — dan itu terbaca seperti penjualan yang melemah.
      r.hari += 1;
    }
    return [...peta.values()].sort((a, b) => b.sparepart + b.jasa - (a.sparepart + a.jasa));
  }

  function gambar() {
    const rows = tersaring();
    const rek = rekap();
    const total = rek.reduce(
      (a, r) => ({ sparepart: a.sparepart + r.sparepart, jasa: a.jasa + r.jasa, hari: a.hari + r.hari }),
      { sparepart: 0, jasa: 0, hari: 0 }
    );

    container.innerHTML = `
      <div class="page-header">
        <h1>Penjualan Bengkel</h1>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button id="pb-tambah">+ Catat / betulkan</button>
          <button id="pb-xlsx">Export Excel</button>
          <button id="pb-pdf">Export PDF</button>
        </div>
      </div>

      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-bottom:12px">
        <div class="field" style="margin:0"><label for="pb-dari">Dari</label><input id="pb-dari" type="date" value="${state.dari}"></div>
        <div class="field" style="margin:0"><label for="pb-sampai">Sampai</label><input id="pb-sampai" type="date" value="${state.sampai}"></div>
        <div class="field" style="margin:0">
          <label for="pb-outlet">Outlet</label>
          <select id="pb-outlet">
            <option value="">Semua outlet</option>
            ${outlets.map((o) => `<option value="${o.id}" ${state.outletId === o.id ? 'selected' : ''}>${escapeHtml(o.name)}</option>`).join('')}
          </select>
        </div>
      </div>

      <h2>Rekap per outlet</h2>
      <table class="data-table">
        <thead><tr><th>Outlet</th><th>Hari dilapor</th><th>Sparepart</th><th>Jasa</th><th>Total</th></tr></thead>
        <tbody>
          ${
            rek.length
              ? rek
                  .map(
                    (r) => `<tr>
                      <td>${escapeHtml(r.outlet)}</td>
                      <td>${r.hari}</td>
                      <td>${formatRupiah(r.sparepart)}</td>
                      <td>${formatRupiah(r.jasa)}</td>
                      <td><strong>${formatRupiah(r.sparepart + r.jasa)}</strong></td>
                    </tr>`
                  )
                  .join('')
              : '<tr><td colspan="5" style="color:var(--color-text-muted)">Belum ada laporan di rentang ini.</td></tr>'
          }
        </tbody>
        ${
          rek.length
            ? `<tfoot><tr>
                 <th>TOTAL BU</th><th>${total.hari}</th>
                 <th>${formatRupiah(total.sparepart)}</th>
                 <th>${formatRupiah(total.jasa)}</th>
                 <th>${formatRupiah(total.sparepart + total.jasa)}</th>
               </tr></tfoot>`
            : ''
        }
      </table>

      <h2 style="margin-top:22px">Rincian harian</h2>
      <table class="data-table">
        <thead><tr><th>Tanggal</th><th>Outlet</th><th>Sparepart</th><th>Jasa</th><th>Total</th><th>Catatan</th><th>Aksi</th></tr></thead>
        <tbody>
          ${
            rows.length
              ? rows
                  .map(
                    (b) => `<tr>
                      <td>${b.sale_date}</td>
                      <td>${escapeHtml(b.outlets?.name ?? '—')}</td>
                      <td>${formatRupiah(b.omzet_sparepart)}</td>
                      <td>${formatRupiah(b.omzet_jasa)}</td>
                      <td><strong>${formatRupiah(Number(b.omzet_sparepart) + Number(b.omzet_jasa))}</strong></td>
                      <td>${escapeHtml(b.catatan ?? '')}</td>
                      <td><button class="pb-edit" data-id="${b.id}">Betulkan</button></td>
                    </tr>`
                  )
                  .join('')
              : '<tr><td colspan="7" style="color:var(--color-text-muted)">Belum ada laporan.</td></tr>'
          }
        </tbody>
      </table>
    `;

    container.querySelector('#pb-dari').addEventListener('change', (e) => {
      state.dari = e.target.value;
      muat();
    });
    container.querySelector('#pb-sampai').addEventListener('change', (e) => {
      state.sampai = e.target.value;
      muat();
    });
    container.querySelector('#pb-outlet').addEventListener('change', (e) => {
      state.outletId = e.target.value;
      gambar();
    });
    container.querySelector('#pb-tambah').addEventListener('click', () => dialogOmzet(null));
    container.querySelectorAll('.pb-edit').forEach((b) =>
      b.addEventListener('click', () => dialogOmzet(baris.find((x) => x.id === b.dataset.id)))
    );
    container.querySelector('#pb-xlsx').addEventListener('click', sekaliJalan(eksporXlsx));
    container.querySelector('#pb-pdf').addEventListener('click', sekaliJalan(eksporPdf));
  }

  async function dialogOmzet(existing) {
    if (!outlets.length) return toast('Belum ada outlet di BU ini.', 'warning');
    const values = await formDialog({
      title: existing ? `Betulkan ${existing.sale_date}` : 'Catat penjualan bengkel',
      fields: [
        {
          name: 'outlet_id',
          label: 'Outlet',
          type: 'select',
          required: true,
          value: existing?.outlet_id ?? state.outletId ?? outlets[0].id,
          options: outlets.map((o) => ({ value: o.id, label: o.name }))
        },
        { name: 'sale_date', label: 'Tanggal', type: 'date', required: true, value: existing?.sale_date ?? todayWIB() },
        { name: 'omzet_sparepart', label: 'Omzet Sparepart (Rp)', type: 'number', value: existing?.omzet_sparepart ?? '' },
        { name: 'omzet_jasa', label: 'Omzet Jasa (Rp)', type: 'number', value: existing?.omzet_jasa ?? '' },
        { name: 'catatan', label: 'Catatan (opsional)', type: 'text', value: existing?.catatan ?? '' }
      ],
      submitText: 'Simpan'
    });
    if (!values) return;

    // Satu outlet punya SATU baris per tanggal, dan menyimpan akan MENIMPA.
    // Admin yang mencatat tanggal yang ternyata sudah dilapor staff harus tahu
    // ia sedang mengganti, bukan menambah — kalau tidak, angka staff hilang
    // tanpa jejak dan tidak ada yang bisa menjelaskan selisihnya nanti.
    const bentrok = baris.find(
      (b) => b.outlet_id === values.outlet_id && b.sale_date === values.sale_date && b.id !== existing?.id
    );
    if (bentrok) {
      const ok = await confirmDialog({
        title: 'Tanggal ini sudah dilaporkan',
        message: `${bentrok.outlets?.name ?? 'Outlet ini'} sudah melaporkan ${bentrok.sale_date}: Sparepart ${formatRupiah(
          bentrok.omzet_sparepart
        )}, Jasa ${formatRupiah(bentrok.omzet_jasa)}. Menyimpan akan MENGGANTI angka itu.`,
        confirmText: 'Ganti'
      });
      if (!ok) return;
    }

    try {
      await simpanOmzetHari({
        businessUnitId,
        outletId: values.outlet_id,
        tanggal: values.sale_date,
        sparepart: values.omzet_sparepart,
        jasa: values.omzet_jasa,
        catatan: values.catatan,
        userId: user?.id ?? null
      });
      toast('Tersimpan.', 'success');
      await muat();
    } catch (error) {
      toast(error.message ?? 'Gagal menyimpan.', 'error');
    }
  }

  const KOLOM_HARIAN = [
    { key: 'sale_date', label: 'Tanggal', width: 1 },
    { key: 'outlet', label: 'Outlet', width: 1.6 },
    { key: 'sparepart', label: 'Sparepart', width: 1.2, align: 'right' },
    { key: 'jasa', label: 'Jasa', width: 1.2, align: 'right' },
    { key: 'total', label: 'Total', width: 1.2, align: 'right' },
    { key: 'catatan', label: 'Catatan', width: 2 }
  ];
  const KOLOM_REKAP = [
    { key: 'outlet', label: 'Outlet', width: 1.6 },
    { key: 'hari', label: 'Hari dilapor', width: 0.8, align: 'right' },
    { key: 'sparepart', label: 'Sparepart', width: 1.2, align: 'right' },
    { key: 'jasa', label: 'Jasa', width: 1.2, align: 'right' },
    { key: 'total', label: 'Total', width: 1.2, align: 'right' }
  ];

  const barisHarian = () =>
    tersaring().map((b) => ({
      sale_date: b.sale_date,
      outlet: b.outlets?.name ?? '—',
      sparepart: Number(b.omzet_sparepart) || 0,
      jasa: Number(b.omzet_jasa) || 0,
      total: (Number(b.omzet_sparepart) || 0) + (Number(b.omzet_jasa) || 0),
      catatan: b.catatan ?? ''
    }));
  const barisRekap = () => rekap().map((r) => ({ ...r, total: r.sparepart + r.jasa }));

  const judul = () => `Penjualan Bengkel ${state.dari} s/d ${state.sampai}`;

  async function eksporXlsx() {
    const h = barisHarian();
    if (!h.length) return toast('Tidak ada data untuk diekspor.', 'warning');
    // Dua sheet dalam SATU berkas: rekap dan rincian disusun dari data yang
    // sama pada detik yang sama. Dua berkas terpisah akan berpisah juga di
    // folder unduhan, dan tidak ada apa pun di dalamnya yang bisa dipakai
    // memastikan keduanya dari rentang yang sama.
    await exportSheetsXLSX({
      filename: `penjualan-bengkel-${state.dari}-sd-${state.sampai}`,
      sheets: [
        { name: 'Rekap per outlet', title: judul(), subtitle: 'Rekap', columns: KOLOM_REKAP, rows: barisRekap() },
        { name: 'Rincian harian', title: judul(), subtitle: `${h.length} baris`, columns: KOLOM_HARIAN, rows: h }
      ]
    });
  }

  async function eksporPdf() {
    const h = barisHarian();
    if (!h.length) return toast('Tidak ada data untuk diekspor.', 'warning');
    await exportTablePDF({
      filename: `penjualan-bengkel-${state.dari}-sd-${state.sampai}`,
      title: judul(),
      subtitle: `${h.length} hari laporan`,
      columns: KOLOM_HARIAN,
      rows: h.map((r) => ({
        ...r,
        sparepart: formatRupiah(r.sparepart),
        jasa: formatRupiah(r.jasa),
        total: formatRupiah(r.total)
      }))
    });
  }

  // Semua `const` di atas sudah terinisialisasi pada titik ini.
  await muat();
}
