/**
 * PENJUALAN BENGKEL (RINCI) — Admin Portal.
 *
 *   "saya ingin berjaya hub menjadi penengah bagi kedua jalur input, jalur
 *    input customer umum yang diinput melalui turboly dan jalur input manual
 *    spreadsheet dari customer korporate"
 *
 * Empat tab, dan pembagiannya mengikuti dua jalur itu:
 *
 *   Impor      -> berkas Turboly masuk. Pratinjau dulu, baru simpan.
 *   Penjualan  -> seluruh baris, dari kedua jalur, dengan penanda asalnya.
 *   Korporat   -> invoice yang diketik di sini. Impor tidak menyentuhnya.
 *   Laporan    -> ringkasan + per nopol + per SKU, beserta catatan jujurnya.
 *
 * ============ KENAPA PRATINJAU WAJIB ============
 *
 * Impor mengganti isi invoice. Berkas periode lain yang terlanjur diimpor
 * akan mengganti data yang benar dengan data yang salah — dan satu-satunya
 * tanda adalah angka yang berubah tanpa sebab. Maka layar ini menampilkan
 * periode, store, jumlah invoice baru vs diganti, dan masalah yang ditemukan
 * SEBELUM ada tombol yang bisa ditekan.
 */

import { toast, confirmDialog, formDialog, infoDialog, escapeHtml } from '../../core/ui.js';
import { loadingHtml, sekaliJalan } from '../../core/loading.js';
import { formatNum, formatRupiah } from '../../core/format.js';
import { loadXLSX, exportSheetsXLSX } from '../../core/xlsx.js';
import { monthRangeWIB } from '../../core/dates.js';
import { listOutletsForBu } from '../organization/organization.service.js';
import { bacaEksporTurboly, untukRpc, PESAN_MASALAH } from './baca-invoice-turboly.js';
import { susunLaporanBengkel, ringkasPenjualan, catatanLaporan, rupiah } from './laporan-penjualan-bengkel.js';
import {
  daftarStoreMap,
  petakanStore,
  imporPenjualanTurboly,
  simpanInvoiceKorporat,
  hapusInvoiceKorporat,
  barisPenjualan,
  invoiceKorporat,
  barisInvoice
} from './penjualan-rinci.service.js';

const esc = escapeHtml;
const TAB = [
  { kode: 'impor', label: '⬆ Impor Turboly' },
  { kode: 'penjualan', label: '📋 Penjualan' },
  { kode: 'korporat', label: '🏢 Korporat' },
  { kode: 'laporan', label: '📊 Laporan' }
];

export async function renderPenjualanRinciAdminPage(container, { businessUnitId }) {
  const { from: awal, to: akhir } = monthRangeWIB();
  const state = { tab: 'impor', dari: awal, sampai: akhir, outletId: '', sumber: '', q: '' };

  let outlets = [];
  try {
    outlets = await listOutletsForBu(businessUnitId);
  } catch (e) {
    container.innerHTML = `<p class="error-text">Gagal memuat outlet: ${esc(e.message ?? e)}</p>`;
    return;
  }
  const namaOutlet = (id) => outlets.find((o) => o.id === id)?.name ?? '—';

  container.innerHTML = `
    <div class="page-header">
      <h2 style="font-size:1.05rem;margin:0">Penjualan Bengkel (Rinci)</h2>
    </div>
    <p style="color:var(--color-text-muted);font-size:0.88rem;margin:0 0 10px;max-width:720px">
      Dua jalur masuk, satu laporan: <strong>Turboly</strong> lewat impor Detailed Service Invoice, dan
      <strong>korporat</strong> diketik di sini. Baris hasil impor tidak bisa disunting di Berjaya Hub —
      betulkan di Turboly lalu impor ulang, dan isinya akan terganti, bukan tergandakan.
    </p>
    <div class="tab-bar" id="pr-tabs" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">
      ${TAB.map(
        (t) => `<button class="tab-btn${t.kode === state.tab ? ' active' : ''}" data-tab="${t.kode}">${esc(t.label)}</button>`
      ).join('')}
    </div>
    <div id="pr-isi"></div>
  `;

  const isi = container.querySelector('#pr-isi');
  container.querySelectorAll('#pr-tabs .tab-btn').forEach((b) =>
    b.addEventListener('click', () => {
      state.tab = b.dataset.tab;
      container.querySelectorAll('#pr-tabs .tab-btn').forEach((x) => x.classList.toggle('active', x === b));
      gambar();
    })
  );

  function saringanHtml() {
    return `
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin-bottom:10px">
        <div class="field" style="margin:0;min-width:140px"><label>Dari</label>
          <input type="date" id="pr-dari" value="${esc(state.dari)}" /></div>
        <div class="field" style="margin:0;min-width:140px"><label>Sampai</label>
          <input type="date" id="pr-sampai" value="${esc(state.sampai)}" /></div>
        <div class="field" style="margin:0;min-width:150px"><label>Outlet</label>
          <select id="pr-outlet"><option value="">Semua</option>${outlets
            .map((o) => `<option value="${o.id}"${o.id === state.outletId ? ' selected' : ''}>${esc(o.name)}</option>`)
            .join('')}</select></div>
        <div class="field" style="margin:0;min-width:130px"><label>Sumber</label>
          <select id="pr-sumber">
            <option value="">Semua</option>
            <option value="turboly"${state.sumber === 'turboly' ? ' selected' : ''}>Turboly</option>
            <option value="korporat"${state.sumber === 'korporat' ? ' selected' : ''}>Korporat</option>
          </select></div>
        <button id="pr-tampil" class="primary">Tampilkan</button>
      </div>`;
  }

  function wiringSaringan(onTampil) {
    isi.querySelector('#pr-tampil')?.addEventListener('click', () => {
      state.dari = isi.querySelector('#pr-dari').value;
      state.sampai = isi.querySelector('#pr-sampai').value;
      state.outletId = isi.querySelector('#pr-outlet').value;
      state.sumber = isi.querySelector('#pr-sumber').value;
      onTampil();
    });
  }

  // =====================================================================
  // TAB IMPOR
  // =====================================================================
  async function gambarImpor() {
    isi.innerHTML = loadingHtml('Memuat pemetaan store…', { baris: 3 });
    let peta = [];
    try {
      peta = await daftarStoreMap(businessUnitId);
    } catch (e) {
      isi.innerHTML = `<p class="error-text">${esc(e.message ?? e)}</p>`;
      return;
    }

    isi.innerHTML = `
      <div class="inline-card" style="max-width:720px">
        <h3 style="margin:0 0 6px;font-size:0.98rem">1. Pemetaan Store Turboly → Outlet</h3>
        <p style="margin:0 0 8px;font-size:0.84rem;color:var(--color-text-muted)">
          Satu berkas ekspor bisa memuat <strong>beberapa store sekaligus</strong> (contohmu: Malang &amp; Mojokerto
          dalam satu berkas). Karena itu outlet ditentukan dari kolom <code>Store</code> tiap invoice, bukan dari
          satu pilihan di layar. Store yang belum ada di sini <strong>dilewati</strong> saat impor — tidak ditebak.
        </p>
        <table class="data-table" style="max-width:520px">
          <thead><tr><th>Store (Turboly)</th><th>Outlet</th><th>Aksi</th></tr></thead>
          <tbody>${
            peta
              .map(
                (p) => `<tr>
                  <td data-label="Store">${esc(p.store_name)}</td>
                  <td data-label="Outlet">${esc(p.outlets?.name ?? namaOutlet(p.outlet_id))}</td>
                  <td data-label="Aksi"><button class="pr-map-ubah" data-store="${esc(p.store_name)}">Ubah</button></td>
                </tr>`
              )
              .join('') || '<tr><td colspan="3">Belum ada pemetaan.</td></tr>'
          }</tbody>
        </table>
        <button id="pr-map-baru" style="margin-top:8px">+ Petakan store</button>
      </div>

      <div class="inline-card" style="max-width:720px;margin-top:12px">
        <h3 style="margin:0 0 6px;font-size:0.98rem">2. Unggah berkas</h3>
        <p style="margin:0 0 8px;font-size:0.84rem;color:var(--color-text-muted)">
          Turboly → laporan <strong>Detailed Service Invoice</strong> → unduh Excel. Berkasnya dibaca dulu dan
          ditampilkan ringkasannya; tidak ada yang tersimpan sampai kamu menekan tombol impor di dialog itu.
        </p>
        <button id="pr-unggah" class="primary" style="max-width:220px">Pilih berkas Excel…</button>
      </div>`;

    isi.querySelector('#pr-map-baru').addEventListener('click', sekaliJalan(() => dialogPetakan('')));
    isi.querySelectorAll('.pr-map-ubah').forEach((b) =>
      b.addEventListener('click', sekaliJalan(() => dialogPetakan(b.dataset.store)))
    );
    isi.querySelector('#pr-unggah').addEventListener('click', sekaliJalan(bukaImpor));
  }

  async function dialogPetakan(store) {
    const v = await formDialog({
      title: store ? `Petakan "${store}"` : 'Petakan store Turboly',
      description: 'Nama store ditulis PERSIS seperti di kolom Store pada berkas ekspor. Huruf besar-kecil tidak masalah.',
      fields: [
        { name: 'store', label: 'Nama Store di Turboly', type: 'text', required: true, value: store ?? '', placeholder: 'mis. OTONIX Malang' },
        {
          name: 'outlet',
          label: 'Outlet di Berjaya Hub',
          type: 'select',
          required: true,
          options: outlets.map((o) => ({ value: o.id, label: o.name }))
        }
      ],
      submitText: 'Simpan'
    });
    if (!v?.store || !v?.outlet) return;
    try {
      await petakanStore({ businessUnitId, store: v.store, outletId: v.outlet });
      toast(`"${v.store}" dipetakan ke ${namaOutlet(v.outlet)}.`, 'success');
    } catch (e) {
      toast(e.message ?? 'Gagal memetakan store.', 'error');
      return;
    }
    await gambarImpor();
  }

  async function bukaImpor() {
    const pilih = await formDialog({
      title: 'Impor Detailed Service Invoice',
      fields: [{ name: 'file', label: 'Berkas Excel dari Turboly', type: 'file', required: true, accept: '.xlsx,.xls' }],
      submitText: 'Baca berkas'
    });
    if (!pilih?.file) return;

    let hasil;
    try {
      const XLSX = await loadXLSX();
      const wb = XLSX.read(await pilih.file.arrayBuffer(), { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      hasil = bacaEksporTurboly(XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }));
    } catch (e) {
      toast(`Gagal membaca berkas: ${e.message ?? e}`, 'error');
      return;
    }
    if (hasil.galat) {
      await infoDialog({ title: 'Berkas tidak bisa dipakai', bodyHtml: `<p>${esc(hasil.galat)}</p>` });
      return;
    }

    // Store yang belum dipetakan DIHITUNG DI SINI juga, bukan hanya oleh
    // database — supaya orangnya tahu sebelum menekan impor, bukan dari
    // ringkasan sesudahnya.
    const peta = await daftarStoreMap(businessUnitId).catch(() => []);
    const dikenal = new Set(peta.map((p) => String(p.store_name).trim().toLowerCase()));
    const belum = hasil.ringkas.store.filter((s) => !dikenal.has(s.trim().toLowerCase()));

    const r = hasil.ringkas;
    const daftarMasalah = (judul, baris, warna) =>
      baris.length
        ? `<details style="margin:4px 0"><summary style="cursor:pointer;color:${warna}">${esc(judul)} (${baris.length})</summary>
             <ul style="margin:6px 0 0;padding-left:18px;font-size:0.8rem;max-height:150px;overflow:auto">
               ${baris.slice(0, 40).map((b) => `<li>baris ${b.nomor} — ${esc(PESAN_MASALAH[b.sebab] ?? b.sebab)}</li>`).join('')}
             </ul></details>`
        : '';

    const ok = await confirmDialog({
      title: 'Periksa dulu sebelum mengimpor',
      messageHtml: `
        <div style="max-height:56vh;overflow:auto;font-size:0.88rem">
          <p style="margin:0 0 6px"><strong>Periode berkas:</strong> ${esc(hasil.pengantar.dari || '?')} – ${esc(hasil.pengantar.sampai || '?')}
            · <strong>Store:</strong> ${esc(r.store.join(', ') || hasil.pengantar.store || '?')}</p>
          <p style="margin:0 0 6px">${r.invoice} invoice · ${r.baris} baris
            (${r.sparepart} sparepart, ${r.jasa} jasa)</p>
          <p style="margin:0 0 6px">Omzet <strong>${esc(rupiah(r.omzet))}</strong>
            — sparepart ${esc(rupiah(r.omzetSparepart))}, jasa ${esc(rupiah(r.omzetJasa))}</p>
          <p style="margin:0 0 8px">Modal sparepart ${esc(rupiah(r.modal))} · laba
            <strong>${esc(rupiah(r.laba))}</strong></p>
          ${
            belum.length
              ? `<p class="error-text" style="margin:0 0 8px"><strong>Store belum dipetakan:</strong> ${esc(belum.join(', '))}.
                   Invoice dari store itu akan <strong>dilewati</strong>. Petakan dulu kalau memang mau ikut.</p>`
              : ''
          }
          ${r.tanpaModal ? `<p style="margin:0 0 4px;color:var(--color-warning,#b26a00)">${r.tanpaModal} baris sparepart tanpa modal.</p>` : ''}
          ${r.tanpaNopol ? `<p style="margin:0 0 4px;color:var(--color-text-muted)">${r.tanpaNopol} baris tanpa nopol (penjualan langsung).</p>` : ''}
          ${daftarMasalah('Baris ditolak', hasil.ditolak, 'var(--color-danger)')}
          ${daftarMasalah('Gross Profit tidak cocok dengan Total − Cost', hasil.peringatan, 'var(--color-warning,#b26a00)')}
          <p style="margin:8px 0 0">Invoice yang sudah ada akan <strong>diganti isinya</strong>, bukan digandakan.</p>
        </div>`,
      confirmText: `Impor ${r.invoice} invoice`,
      cancelText: 'Batal'
    });
    if (!ok) return;

    try {
      const h = await imporPenjualanTurboly({
        businessUnitId,
        invoices: untukRpc(hasil.invoices),
        berkas: pilih.file.name
      });
      const lewat = [];
      if (h.store_belum_dipetakan?.length) lewat.push(`store belum dipetakan: ${h.store_belum_dipetakan.join(', ')}`);
      if (h.dilewati_korporat?.length) lewat.push(`${h.dilewati_korporat.length} invoice korporat tidak ditimpa`);
      if (h.dilewati_kosong?.length) lewat.push(`${h.dilewati_kosong.length} invoice tanpa baris`);
      toast(
        `${h.invoice_baru} invoice baru, ${h.invoice_diganti} diganti, ${h.baris} baris` +
          (lewat.length ? ` · dilewati — ${lewat.join('; ')}` : ''),
        lewat.length ? 'warning' : 'success'
      );
    } catch (e) {
      toast(e.message ?? 'Gagal mengimpor.', 'error');
      return;
    }
    await gambarImpor();
  }

  // =====================================================================
  // TAB PENJUALAN
  // =====================================================================
  async function gambarPenjualan() {
    isi.innerHTML = saringanHtml() + `<div id="pr-tabel">${loadingHtml('Memuat penjualan…', { baris: 5 })}</div>`;
    wiringSaringan(gambarPenjualan);
    const kotak = isi.querySelector('#pr-tabel');

    let baris = [];
    try {
      baris = await barisPenjualan(businessUnitId, state);
    } catch (e) {
      kotak.innerHTML = `<p class="error-text">${esc(
        /bengkel_penjualan_rinci/.test(String(e.message ?? e))
          ? 'Migration 0185 belum dijalankan di Supabase, jadi modul ini belum punya tabelnya.'
          : e.message ?? e
      )}</p>`;
      return;
    }
    if (!baris.length) {
      kotak.innerHTML = `<p style="color:var(--color-text-muted)">Tidak ada penjualan pada rentang ini.</p>`;
      return;
    }

    const r = ringkasPenjualan(baris);
    kotak.innerHTML = `
      <p style="font-size:0.84rem;color:var(--color-text-muted);margin:0 0 6px">
        ${r.invoice} invoice · ${r.baris} baris · omzet <strong>${esc(rupiah(r.omzet))}</strong> ·
        laba sparepart <strong>${esc(rupiah(r.laba))}</strong>
        ${catatanLaporan(r).map((c) => `<br><span class="nota-telat">${esc(c)}</span>`).join('')}
      </p>
      <div class="table-scroll"><table class="data-table kartu-sempit">
        <thead><tr>
          <th>Tanggal</th><th>Invoice</th><th>Asal</th><th>Outlet</th><th>Nopol</th><th>Pelanggan</th>
          <th>Jenis</th><th>SKU</th><th>Nama</th><th>Qty</th><th>Harga</th><th>Total</th><th>Modal</th><th>Laba</th>
        </tr></thead>
        <tbody>${baris
          .map(
            (b) => `<tr>
              <td data-label="Tanggal">${esc(b.tanggal ?? '')}</td>
              <td data-label="Invoice" style="font-family:monospace;font-size:0.76rem">${esc(b.invoice_no ?? '')}</td>
              <td data-label="Asal">${
                b.sumber === 'korporat'
                  ? '<span class="badge badge-pending">Korporat</span>'
                  : '<span class="badge">Turboly</span>'
              }</td>
              <td data-label="Outlet">${esc(b.outlet_nama ?? '')}</td>
              <td data-label="Nopol">${esc(b.nopol || '—')}</td>
              <td data-label="Pelanggan">${esc(b.company || b.customer || '—')}</td>
              <td data-label="Jenis">${b.item_type === 'sparepart' ? 'Sparepart' : 'Jasa'}</td>
              <td data-label="SKU" style="font-family:monospace;font-size:0.76rem">${esc(b.sku || '—')}</td>
              <td data-label="Nama">${esc(b.nama ?? '')}</td>
              <td data-label="Qty" style="text-align:right">${formatNum(b.qty)}</td>
              <td data-label="Harga" style="text-align:right">${b.harga_satuan === null ? '—' : formatRupiah(b.harga_satuan)}</td>
              <td data-label="Total" style="text-align:right">${formatRupiah(b.total)}</td>
              <td data-label="Modal" style="text-align:right">${
                // "—", BUKAN Rp0. Modal yang belum diketahui dan modal nol
                // adalah dua hal berbeda, dan Rp0 membuat labanya terlihat penuh.
                b.modal === null ? '<span style="color:var(--color-text-muted)">—</span>' : formatRupiah(b.modal)
              }</td>
              <td data-label="Laba" style="text-align:right">${
                b.laba === null ? '<span style="color:var(--color-text-muted)">—</span>' : formatRupiah(b.laba)
              }</td>
            </tr>`
          )
          .join('')}</tbody>
      </table></div>`;
  }

  // =====================================================================
  // TAB KORPORAT
  // =====================================================================
  async function gambarKorporat() {
    isi.innerHTML =
      saringanHtml() +
      `<button id="pr-korp-baru" class="primary" style="max-width:240px;margin-bottom:10px">+ Invoice Korporat</button>
       <div id="pr-korp">${loadingHtml('Memuat…', { baris: 4 })}</div>`;
    wiringSaringan(gambarKorporat);
    isi.querySelector('#pr-korp-baru').addEventListener('click', sekaliJalan(() => dialogKorporat(null)));
    const kotak = isi.querySelector('#pr-korp');

    let daftar = [];
    try {
      daftar = await invoiceKorporat(businessUnitId, state);
    } catch (e) {
      kotak.innerHTML = `<p class="error-text">${esc(e.message ?? e)}</p>`;
      return;
    }
    if (!daftar.length) {
      kotak.innerHTML = `<p style="color:var(--color-text-muted)">Belum ada invoice korporat pada rentang ini.</p>`;
      return;
    }
    kotak.innerHTML = `
      <div class="table-scroll"><table class="data-table kartu-sempit">
        <thead><tr><th>Invoice</th><th>Tanggal</th><th>Outlet</th><th>Perusahaan</th><th>Nopol</th><th>Aksi</th></tr></thead>
        <tbody>${daftar
          .map(
            (i) => `<tr>
              <td data-label="Invoice" style="font-family:monospace;font-size:0.78rem">${esc(i.invoice_no)}</td>
              <td data-label="Tanggal">${esc(i.tanggal)}</td>
              <td data-label="Outlet">${esc(i.outlets?.name ?? namaOutlet(i.outlet_id))}</td>
              <td data-label="Perusahaan">${esc(i.company || i.customer || '—')}</td>
              <td data-label="Nopol">${esc(i.nopol || '—')}</td>
              <td data-label="Aksi">
                <button class="pr-korp-ubah" data-id="${i.id}">Ubah</button>
                <button class="pr-korp-hapus btn-danger" data-id="${i.id}" data-no="${esc(i.invoice_no)}">Hapus</button>
              </td>
            </tr>`
          )
          .join('')}</tbody>
      </table></div>`;

    kotak.querySelectorAll('.pr-korp-ubah').forEach((b) =>
      b.addEventListener('click', sekaliJalan(() => dialogKorporat(daftar.find((x) => x.id === b.dataset.id))))
    );
    kotak.querySelectorAll('.pr-korp-hapus').forEach((b) =>
      b.addEventListener(
        'click',
        sekaliJalan(async () => {
          const ok = await confirmDialog({
            title: `Hapus ${b.dataset.no}?`,
            message: 'Invoice beserta seluruh barisnya dihapus. Tidak bisa dibatalkan.',
            confirmText: 'Hapus',
            danger: true
          });
          if (!ok) return;
          try {
            await hapusInvoiceKorporat(b.dataset.id);
            toast('Invoice dihapus.', 'success');
          } catch (e) {
            toast(e.message ?? 'Gagal menghapus.', 'error');
            return;
          }
          await gambarKorporat();
        })
      )
    );
  }

  /**
   * Dialog invoice korporat.
   *
   * Barisnya diketik sebagai TEKS banyak baris, satu baris per barang:
   *
   *     sparepart | OLI.X | OLI MESIN | 4 | 150000 | 400000
   *
   * Bukan karena itu bentuk terbaik, tapi karena yang mengetiknya sekarang
   * memakai spreadsheet — dan menyalin-tempel dari sana jauh lebih dekat ke
   * kebiasaannya daripada mengisi lima kotak per barang di layar HP. Kolom
   * modal boleh dikosongkan; yang kosong tetap kosong, bukan nol.
   */
  async function dialogKorporat(invoice) {
    let awalBaris = '';
    if (invoice) {
      try {
        const baris = await barisInvoice(invoice.id);
        awalBaris = baris
          .map((b) => [b.item_type, b.sku ?? '', b.nama, b.qty, b.harga_satuan ?? '', b.modal ?? ''].join(' | '))
          .join('\n');
      } catch (e) {
        toast(`Baris invoice gagal dimuat: ${e.message ?? e}`, 'error');
        return;
      }
    }

    const v = await formDialog({
      title: invoice ? `Ubah ${invoice.invoice_no}` : 'Invoice Korporat Baru',
      description:
        'Satu baris per barang/jasa: jenis | SKU | nama | qty | harga | modal. ' +
        'Jenis diisi "sparepart" atau "jasa". SKU & modal boleh dikosongkan — modal yang kosong TIDAK dianggap nol, ' +
        'dan laporannya akan menyebut berapa baris yang belum bermodal.',
      fields: [
        {
          name: 'outlet',
          label: 'Outlet',
          type: 'select',
          required: true,
          value: invoice?.outlet_id ?? '',
          options: outlets.map((o) => ({ value: o.id, label: o.name }))
        },
        { name: 'tanggal', label: 'Tanggal', type: 'date', required: true, value: invoice?.tanggal ?? state.sampai },
        { name: 'company', label: 'Perusahaan', type: 'text', value: invoice?.company ?? '', placeholder: 'mis. PT SEMEN INDONESIA' },
        { name: 'customer', label: 'Nama PIC / pelanggan', type: 'text', value: invoice?.customer ?? '' },
        { name: 'nopol', label: 'Nopol', type: 'text', value: invoice?.nopol ?? '', placeholder: 'kosongkan kalau penjualan barang saja' },
        { name: 'pembayaran', label: 'Pembayaran', type: 'text', value: invoice?.pembayaran ?? '', placeholder: 'mis. Transfer / Tempo 30 hari' },
        { name: 'catatan', label: 'Catatan', type: 'text', value: invoice?.catatan ?? '' },
        {
          name: 'baris',
          label: 'Baris barang / jasa',
          type: 'textarea',
          required: true,
          value: awalBaris,
          placeholder: 'sparepart | OLI.X | OLI MESIN 10W40 | 4 | 150000 | 400000\njasa | | SERVICE BERKALA | 1 | 250000 |'
        }
      ],
      submitText: 'Simpan'
    });
    if (!v) return;

    const { baris, salah } = bacaBarisKorporat(v.baris);
    if (salah.length) {
      await infoDialog({
        title: 'Ada baris yang belum bisa dibaca',
        bodyHtml: `<ul style="margin:0;padding-left:18px">${salah.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>`
      });
      return;
    }
    if (!baris.length) return toast('Isi minimal satu baris.', 'warning');

    try {
      const h = await simpanInvoiceKorporat({
        businessUnitId,
        invoice: {
          id: invoice?.id ?? null,
          outlet_id: v.outlet,
          tanggal: v.tanggal,
          company: v.company,
          customer: v.customer,
          nopol: v.nopol,
          pembayaran: v.pembayaran,
          catatan: v.catatan,
          baris
        }
      });
      toast(`${h.invoice_no} tersimpan — ${h.baris} baris.`, 'success');
    } catch (e) {
      toast(e.message ?? 'Gagal menyimpan.', 'error');
      return;
    }
    await gambarKorporat();
  }

  // =====================================================================
  // TAB LAPORAN
  // =====================================================================
  async function gambarLaporan() {
    isi.innerHTML = saringanHtml() + `<div id="pr-lap">${loadingHtml('Menyusun laporan…', { baris: 5 })}</div>`;
    wiringSaringan(gambarLaporan);
    const kotak = isi.querySelector('#pr-lap');

    let baris = [];
    try {
      baris = await barisPenjualan(businessUnitId, state);
    } catch (e) {
      kotak.innerHTML = `<p class="error-text">${esc(e.message ?? e)}</p>`;
      return;
    }
    if (!baris.length) {
      kotak.innerHTML = `<p style="color:var(--color-text-muted)">Tidak ada data pada rentang ini.</p>`;
      return;
    }

    const lap = susunLaporanBengkel({
      baris,
      periode: { dari: state.dari, sampai: state.sampai, outlet: state.outletId ? namaOutlet(state.outletId) : '' }
    });
    const r = lap.ringkas;
    const tabel = (judul, daftar, kolomKunci) => `
      <h4 style="margin:14px 0 4px;font-size:0.92rem">${esc(judul)}</h4>
      <div class="table-scroll"><table class="data-table kartu-sempit">
        <thead><tr><th>${esc(kolomKunci)}</th><th>Baris</th><th>Qty</th><th>Omzet</th><th>Modal</th><th>Laba</th><th>Margin</th></tr></thead>
        <tbody>${daftar
          .slice(0, 100)
          .map(
            (k) => `<tr>
              <td data-label="${esc(kolomKunci)}">${esc(k.label ?? k.kunci)}</td>
              <td data-label="Baris" style="text-align:right">${k.baris}</td>
              <td data-label="Qty" style="text-align:right">${formatNum(k.qtySparepart)}</td>
              <td data-label="Omzet" style="text-align:right">${formatRupiah(k.omzet)}</td>
              <td data-label="Modal" style="text-align:right">${k.tanpaModal === k.baris ? '—' : formatRupiah(k.modal)}</td>
              <td data-label="Laba" style="text-align:right">${k.omzetBermodal ? formatRupiah(k.laba) : '—'}</td>
              <td data-label="Margin" style="text-align:right">${k.margin === null ? '—' : k.margin + '%'}</td>
            </tr>`
          )
          .join('')}</tbody>
      </table></div>`;

    kotak.innerHTML = `
      <div class="inline-card" style="max-width:720px">
        <p style="margin:0 0 4px;font-size:0.84rem;color:var(--color-text-muted)">${esc(lap.subjudul)}</p>
        <table class="data-table" style="max-width:420px;margin-top:8px">
          <tbody>
            <tr><td>Omzet sparepart</td><td style="text-align:right">${formatRupiah(r.omzetSparepart)}</td></tr>
            <tr><td>Omzet jasa</td><td style="text-align:right">${formatRupiah(r.omzetJasa)}</td></tr>
            <tr><td><strong>Omzet total</strong></td><td style="text-align:right"><strong>${formatRupiah(r.omzet)}</strong></td></tr>
            <tr><td>Modal sparepart (yang diketahui)</td><td style="text-align:right">${formatRupiah(r.modal)}</td></tr>
            <tr><td><strong>Laba sparepart</strong></td><td style="text-align:right"><strong>${formatRupiah(r.laba)}</strong>${
              r.margin === null ? '' : ` <span style="color:var(--color-text-muted)">(${r.margin}%)</span>`
            }</td></tr>
          </tbody>
        </table>
        ${lap.catatan.map((c) => `<p class="nota-telat" style="margin:6px 0 0;font-size:0.82rem">${esc(c)}</p>`).join('')}
        <button id="pr-ekspor" style="margin-top:10px">⬇ Export Excel</button>
      </div>
      ${tabel('Per outlet', lap.perOutlet, 'Outlet')}
      ${tabel('Per asal data', lap.perSumber, 'Asal')}
      ${tabel('Per nopol (sparepart)', lap.perNopol, 'Nopol')}
      ${tabel('Per SKU (sparepart)', lap.perSku, 'SKU')}`;

    kotak.querySelector('#pr-ekspor').addEventListener(
      'click',
      sekaliJalan(async () => {
        const lembarRingkas = (judul, daftar) => ({
          sheetName: judul.slice(0, 28),
          title: `${lap.judul} — ${judul}`,
          subtitle: lap.subjudul,
          columns: [
            { header: judul, width: 28 },
            { header: 'Baris', numeric: true, width: 10 },
            { header: 'Qty', numeric: true, width: 10 },
            { header: 'Omzet', numeric: true, width: 16 },
            { header: 'Modal', numeric: true, width: 16 },
            { header: 'Laba', numeric: true, width: 16 },
            { header: 'Margin %', numeric: true, width: 12 }
          ],
          rows: daftar.map((k) => [k.label ?? k.kunci, k.baris, k.qtySparepart, k.omzet, k.modal, k.laba, k.margin])
        });
        await exportSheetsXLSX({
          filename: lap.namaBerkas,
          sheets: [
            {
              sheetName: 'Rincian',
              title: lap.judul,
              subtitle: lap.subjudul,
              columns: [
                { header: 'Tanggal', width: 12 },
                { header: 'Invoice', width: 20 },
                { header: 'Asal', width: 10 },
                { header: 'Outlet', width: 18 },
                { header: 'Nopol', width: 12 },
                { header: 'Pelanggan', width: 22 },
                { header: 'Jenis', width: 11 },
                { header: 'SKU', width: 18 },
                { header: 'Nama', width: 30 },
                { header: 'Qty', numeric: true, width: 8 },
                { header: 'Harga', numeric: true, width: 14 },
                { header: 'Total', numeric: true, width: 14 },
                { header: 'Modal', numeric: true, width: 14 },
                { header: 'Laba', numeric: true, width: 14 }
              ],
              rows: baris.map((b) => [
                b.tanggal,
                b.invoice_no,
                b.sumber === 'korporat' ? 'Korporat' : 'Turboly',
                b.outlet_nama,
                b.nopol ?? '',
                b.company || b.customer || '',
                b.item_type === 'sparepart' ? 'Sparepart' : 'Jasa',
                b.sku ?? '',
                b.nama,
                Number(b.qty) || 0,
                b.harga_satuan === null ? null : Number(b.harga_satuan),
                Number(b.total) || 0,
                // null, BUKAN 0 — sel kosong di Excel terbaca "belum diisi",
                // dan 0 terbaca "gratis". Keduanya berbeda artinya.
                b.modal === null ? null : Number(b.modal),
                b.laba === null ? null : Number(b.laba)
              ])
            },
            lembarRingkas('Per outlet', lap.perOutlet),
            lembarRingkas('Per nopol', lap.perNopol),
            lembarRingkas('Per SKU', lap.perSku)
          ]
        });
        toast('Laporan terunduh.', 'success');
      })
    );
  }

  function gambar() {
    if (state.tab === 'impor') return gambarImpor();
    if (state.tab === 'penjualan') return gambarPenjualan();
    if (state.tab === 'korporat') return gambarKorporat();
    return gambarLaporan();
  }

  await gambar();
}

/**
 * Baca baris korporat dari teks.
 *
 * Diekspor supaya bisa diuji tanpa browser — dan ia memang perlu diuji:
 * salah urutan kolom di sini berarti harga masuk ke kolom modal, dan laba
 * yang dihasilkan tetap berupa angka yang masuk akal.
 */
export function bacaBarisKorporat(teks) {
  const baris = [];
  const salah = [];
  const daftar = String(teks ?? '').split('\n');
  daftar.forEach((raw, i) => {
    const b = raw.trim();
    if (!b) return;
    const k = b.split('|').map((x) => x.trim());
    if (k.length < 4) {
      salah.push(`Baris ${i + 1}: butuh minimal "jenis | sku | nama | qty".`);
      return;
    }
    const [jenis, sku, nama, qtyT, hargaT, modalT] = k;
    const jenisBaku = /^spare/i.test(jenis) ? 'sparepart' : /^jasa|^service/i.test(jenis) ? 'jasa' : '';
    if (!jenisBaku) {
      salah.push(`Baris ${i + 1}: jenis "${jenis}" tidak dikenal — tulis "sparepart" atau "jasa".`);
      return;
    }
    if (!nama) {
      salah.push(`Baris ${i + 1}: nama barang kosong.`);
      return;
    }
    const num = (v) => {
      const s = String(v ?? '').replace(/[^\d.,-]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.');
      if (s === '') return null;
      const x = Number(s);
      return Number.isFinite(x) ? x : null;
    };
    const qty = num(qtyT);
    if (qty === null || qty <= 0) {
      salah.push(`Baris ${i + 1}: qty "${qtyT}" bukan angka lebih dari 0.`);
      return;
    }
    const harga = num(hargaT);
    const modal = num(modalT);
    baris.push({
      item_type: jenisBaku,
      sku,
      nama,
      qty,
      harga_satuan: harga,
      // Total dihitung di sini, bukan diminta diketik: dua angka yang harus
      // cocok satu sama lain selalu berakhir tidak cocok.
      total: (harga ?? 0) * qty,
      // Modal yang dikosongkan tetap kosong — bukan 0. Lihat `0185`.
      modal: modal === null ? '' : String(modal)
    });
  });
  return { baris, salah };
}
