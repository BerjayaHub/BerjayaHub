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

import { toast, confirmDialog, formDialog, infoDialog, escapeHtml, renderSearchSelect, wireSearchSelect } from '../../core/ui.js';
import { loadingHtml, sekaliJalan } from '../../core/loading.js';
import { formatNum, formatRupiah } from '../../core/format.js';
import { loadXLSX, exportSheetsXLSX } from '../../core/xlsx.js';
import { monthRangeWIB } from '../../core/dates.js';
import { listOutletsForBu } from '../organization/organization.service.js';
import { listSpareparts } from '../sparepart/sparepart.service.js';
import { barisKosong, dariMaster, totalBaris, susunBarisKorporat, ringkasBarisKorporat } from './baris-korporat.js';
import { bacaEksporTurboly, untukRpc, PESAN_MASALAH } from './baca-invoice-turboly.js';
import { bacaEksporPo, poUntukRpc, semuaHarganyaNol, PESAN_MASALAH_PO } from './baca-po-turboly.js';
import { susunLaporanBengkel, ringkasPenjualan, catatanLaporan, rupiah } from './laporan-penjualan-bengkel.js';
import { cocokkanBeliJual, catatanCocok } from './cocokkan-beli-jual.js';
import { susunLaporanJual, susunLaporanBeli, catatanBentukSheet } from './laporan-bentuk-sheet.js';
import {
  daftarStoreMap,
  petakanStore,
  daftarKirimMap,
  petakanTujuanKirim,
  imporPenjualanTurboly,
  imporPembelianTurboly,
  barisPembelian,
  riwayatImpor,
  pratinjauTarikImpor,
  tarikImpor,
  hapusDokumenImpor,
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
  const state = { tab: 'impor', sub: 'jual', dari: awal, sampai: akhir, outletId: '', sumber: '', q: '' };

  let outlets = [];
  try {
    outlets = await listOutletsForBu(businessUnitId);
  } catch (e) {
    container.innerHTML = `<p class="error-text">Gagal memuat outlet: ${esc(e.message ?? e)}</p>`;
    return;
  }
  const namaOutlet = (id) => outlets.find((o) => o.id === id)?.name ?? '—';

  // ============ OUTLET YANG JADI WEWENANGNYA (0189) ============
  //
  // Dipakai tiap dropdown outlet di layar ini: pemetaan store, pemetaan alamat
  // kirim, dan invoice korporat. Ketiganya ditolak server kalau outletnya
  // bukan wewenangnya (0189 untuk dua yang pertama, `is_admin_of_outlet` di
  // 0185 untuk korporat).
  //
  // Dropdown yang tetap menawarkan SELURUH outlet berarti ia memilih, menekan
  // Simpan, lalu membaca penolakan: yang salah daftarnya, tapi yang terlihat
  // salah adalah dirinya.
  //
  // Admin BU & super admin tetap melihat semuanya (`adminBu`), dan kalau
  // perannya tidak terbaca sama sekali daftarnya dibiarkan utuh: server tetap
  // penjaga terakhirnya, dan daftar kosong akan memblokir orang yang
  // sebenarnya berwenang.
  let outletKewenanganku = outlets;
  try {
    const { adminBu, outlets: punyaku } = await scopeAdminSaya(businessUnitId);
    if (!adminBu && punyaku.size) outletKewenanganku = outlets.filter((o) => punyaku.has(o.id));
  } catch {
    /* peran tidak terbaca — biarkan utuh, server yang memutuskan */
  }

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
    isi.innerHTML = loadingHtml('Memuat pemetaan…', { baris: 3 });
    let peta = [];
    let petaKirim = [];
    let riwayat = [];
    try {
      [peta, petaKirim, riwayat] = await Promise.all([
        daftarStoreMap(businessUnitId),
        daftarKirimMap(businessUnitId),
        // Riwayat gagal dimuat tidak boleh mematikan layar impornya — yang
        // hilang cuma daftarnya, dan itu dikatakan di tempatnya.
        // Dibedakan: `null` = gagal dimuat biasa, `'belum'` = tabelnya memang
        // belum ada. Keduanya menghasilkan layar kosong, dan hanya satu yang
        // bisa diperbaiki orangnya sendiri — kalau disamakan, ia akan
        // mencari-cari tombol yang memang belum mungkin ada.
        riwayatImpor(businessUnitId).catch((e) =>
          /bengkel_import_runs|does not exist|schema cache/i.test(String(e?.message ?? e)) ? 'belum' : null
        )
      ]);
    } catch (e) {
      isi.innerHTML = `<p class="error-text">${esc(e.message ?? e)}</p>`;
      return;
    }

    isi.innerHTML = `
      <!-- ============ DUA IMPOR, SATU TAB ============
           Keduanya ditaruh bersebelahan dengan sengaja: pencocokan beli↔jual
           baru bekerja kalau KEDUA sisi periode yang sama sudah masuk. Dipisah
           ke dua tab, orang akan mengimpor satu sisi lalu bertanya kenapa
           kolom Harga Beli kosong — dan jawabannya ada di tab sebelah. -->
      <h3 style="margin:0 0 8px;font-size:1rem">A. Penjualan — Detailed Service Invoice</h3>
      <div class="inline-card" style="max-width:720px">
        <h4 style="margin:0 0 6px;font-size:0.94rem">1. Pemetaan Store Turboly → Outlet</h4>
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
        <h4 style="margin:0 0 6px;font-size:0.94rem">2. Unggah berkas penjualan</h4>
        <p style="margin:0 0 8px;font-size:0.84rem;color:var(--color-text-muted)">
          Turboly → laporan <strong>Detailed Service Invoice</strong> → unduh Excel. Berkasnya dibaca dulu dan
          ditampilkan ringkasannya; tidak ada yang tersimpan sampai kamu menekan tombol impor di dialog itu.
        </p>
        <button id="pr-unggah" class="primary" style="max-width:220px">Pilih berkas penjualan…</button>
      </div>

      <h3 style="margin:18px 0 8px;font-size:1rem">B. Pembelian — Detailed Purchase Orders</h3>
      <div class="inline-card" style="max-width:720px">
        <h4 style="margin:0 0 6px;font-size:0.94rem">3. Pemetaan Alamat Kirim → Outlet</h4>
        <p style="margin:0 0 8px;font-size:0.84rem;color:var(--color-text-muted)">
          Di ekspor pembelian, kolom <code>Warehouse</code> berisi nama gudang pusat yang SAMA untuk semua baris —
          yang menunjuk cabang adalah <code>Deliver To</code>, berisi alamat kirim. Alamat yang belum dipetakan
          tidak ditebak: barisnya masuk sebagai <strong>pembelian pusat</strong>, dan begitu kamu memetakannya,
          baris yang sudah terlanjur masuk ikut dibetulkan.
        </p>
        <table class="data-table" style="max-width:620px">
          <thead><tr><th>Alamat kirim (Turboly)</th><th>Outlet</th><th>Aksi</th></tr></thead>
          <tbody>${
            petaKirim
              .map(
                (p) => `<tr>
                  <td data-label="Alamat">${esc(p.store_name)}</td>
                  <td data-label="Outlet">${esc(p.outlets?.name ?? namaOutlet(p.outlet_id))}</td>
                  <td data-label="Aksi"><button class="pr-kirim-ubah" data-alamat="${esc(p.store_name)}">Ubah</button></td>
                </tr>`
              )
              .join('') || '<tr><td colspan="3">Belum ada pemetaan — pembelian akan masuk sebagai pembelian pusat.</td></tr>'
          }</tbody>
        </table>
        <button id="pr-kirim-baru" style="margin-top:8px">+ Petakan alamat kirim</button>
      </div>

      <div class="inline-card" style="max-width:720px;margin-top:12px">
        <h4 style="margin:0 0 6px;font-size:0.94rem">4. Unggah berkas pembelian</h4>
        <p style="margin:0 0 8px;font-size:0.84rem;color:var(--color-text-muted)">
          Turboly → laporan <strong>Detailed Purchase Orders</strong> → unduh Excel. Pakai ekspor
          <strong>warehouse</strong>: ekspor <em>store</em> mengembalikan harga 0 di seluruh barisnya, dan laporan
          yang memakainya akan memuat nol yang terlihat seperti fakta.
        </p>
        <button id="pr-unggah-beli" class="primary" style="max-width:220px">Pilih berkas pembelian…</button>
      </div>

      <h3 style="margin:18px 0 8px;font-size:1rem">C. Riwayat impor — hapus satu berkas yang terlanjur diunggah</h3>
      <div class="inline-card" style="max-width:860px">
        <p style="margin:0 0 8px;font-size:0.84rem;color:var(--color-text-muted)">
          Salah berkas? <strong>Tarik kembali</strong> membuang seluruh isi impor itu sekaligus. Invoice/PO yang
          sudah <strong>digantikan impor berikutnya</strong> tidak ikut tertarik — isinya memang bukan lagi milik
          impor ini. Baris riwayatnya tidak pernah dihapus: ia satu-satunya yang bisa menjawab
          "siapa memasukkan ini, dan siapa yang menariknya".
        </p>
        ${
          riwayat === 'belum'
            ? `<p class="error-text" style="margin:0">
                 <strong>Migration 0187 &amp; 0188 belum dijalankan di Supabase.</strong>
                 Riwayat impor dan tombol <strong>Tarik kembali</strong> (menghapus SELURUH isi satu berkas impor)
                 baru muncul sesudah keduanya dijalankan.
               </p>`
            : riwayat === null
            ? '<p class="error-text" style="margin:0">Riwayat impor gagal dimuat.</p>'
            : !Array.isArray(riwayat) || !riwayat.length
              ? '<p style="margin:0;color:var(--color-text-muted)">Belum ada impor.</p>'
              : `<div class="table-scroll"><table class="data-table kartu-sempit">
                  <thead><tr><th>Waktu</th><th>Jenis</th><th>Berkas</th><th>Periode</th><th>Dok.</th><th>Baris</th><th>Nilai</th><th>Oleh</th><th>Aksi</th></tr></thead>
                  <tbody>${riwayat
                    .map(
                      (r) => `<tr${r.ditarik_at ? ' style="opacity:.55"' : ''}>
                        <td data-label="Waktu">${esc(String(r.dibuat_at ?? '').slice(0, 16).replace('T', ' '))}</td>
                        <td data-label="Jenis">${r.jenis === 'pembelian' ? 'Pembelian' : 'Penjualan'}</td>
                        <td data-label="Berkas" style="font-size:0.78rem">${esc(r.berkas || '—')}</td>
                        <td data-label="Periode" style="font-size:0.78rem">${esc([r.periode_dari, r.periode_sampai].filter(Boolean).join(' s/d ') || '—')}</td>
                        <td data-label="Dok." style="text-align:right">${r.invoice ?? 0}</td>
                        <td data-label="Baris" style="text-align:right">${r.baris ?? 0}</td>
                        <td data-label="Nilai" style="text-align:right">${formatRupiah(r.nilai ?? 0)}</td>
                        <td data-label="Oleh">${esc(r.user_profiles?.full_name ?? '—')}</td>
                        <td data-label="Aksi">${
                          r.ditarik_at
                            ? `<span style="font-size:0.76rem;color:var(--color-text-muted)">ditarik${r.alasan_tarik ? ` — ${esc(r.alasan_tarik)}` : ''}</span>`
                            : `<button class="pr-tarik btn-danger" data-run="${r.id}">Tarik kembali</button>`
                        }</td>
                      </tr>`
                    )
                    .join('')}</tbody>
                </table></div>`
        }
        <p style="margin:10px 0 4px;font-size:0.82rem;color:var(--color-text-muted)">
          Butuh membuang <strong>satu invoice / satu PO</strong> saja, bukan seluruh berkas?
        </p>
        <button id="pr-hapus-dok">Hapus satu dokumen (1 invoice / 1 PO)…</button>
      </div>`;

    isi.querySelector('#pr-map-baru').addEventListener('click', sekaliJalan(() => dialogPetakan('')));
    isi.querySelectorAll('.pr-map-ubah').forEach((b) =>
      b.addEventListener('click', sekaliJalan(() => dialogPetakan(b.dataset.store)))
    );
    isi.querySelector('#pr-unggah').addEventListener('click', sekaliJalan(bukaImpor));
    isi.querySelector('#pr-kirim-baru').addEventListener('click', sekaliJalan(() => dialogPetakanKirim('')));
    isi.querySelectorAll('.pr-kirim-ubah').forEach((b) =>
      b.addEventListener('click', sekaliJalan(() => dialogPetakanKirim(b.dataset.alamat)))
    );
    isi.querySelector('#pr-unggah-beli').addEventListener('click', sekaliJalan(bukaImporBeli));
    isi.querySelectorAll('.pr-tarik').forEach((b) =>
      b.addEventListener('click', sekaliJalan(() => dialogTarik(b.dataset.run)))
    );
    isi.querySelector('#pr-hapus-dok').addEventListener('click', sekaliJalan(dialogHapusDokumen));
  }

  /**
   * Tarik kembali satu impor.
   *
   * Angkanya diambil ULANG dari database sebelum dikonfirmasi, bukan dari
   * baris tabel yang mungkin sudah basi: invoice yang digantikan impor lain
   * sesudah halaman ini dibuka tidak akan ikut terhapus, dan jumlahnya harus
   * sesuai dengan yang benar-benar terjadi.
   */
  async function dialogTarik(runId) {
    let pra;
    try {
      pra = await pratinjauTarikImpor(runId);
    } catch (e) {
      toast(e.message ?? 'Gagal memeriksa impor.', 'error');
      return;
    }
    const diganti = Number(pra.sudah_digantikan) || 0;
    const v = await formDialog({
      title: 'Tarik kembali impor ini?',
      description:
        `${pra.jenis === 'pembelian' ? 'Pembelian' : 'Penjualan'} · ${esc(pra.berkas || 'tanpa nama berkas')} — ` +
        `berkas ini memuat ${pra.nomor_di_berkas ?? '?'} dokumen. ` +
        `${pra.invoice} di antaranya masih milik impor ini (${pra.baris} baris, ${rupiah(pra.nilai)}) dan akan DIHAPUS.` +
        (diganti
          ? ` ${diganti} dokumen lainnya sudah DIGANTIKAN impor berikutnya (${pra.digantikan_baris} baris, ${rupiah(pra.digantikan_nilai)}) — ` +
            'isinya sekarang berasal dari berkas yang lebih baru, jadi secara bawaan TIDAK ikut terhapus.'
          : ''),
      fields: [
        { name: 'alasan', label: 'Alasan penarikan (wajib)', type: 'text', required: true, placeholder: 'mis. salah periode / salah store' },
        // Pilihan ini hanya muncul kalau memang ADA yang sudah digantikan —
        // centang yang tidak pernah berakibat apa pun cuma melatih orang
        // mencentang tanpa membaca.
        ...(diganti
          ? [
              {
                name: 'semua',
                label: `Hapus juga ${diganti} dokumen yang sudah digantikan impor lain`,
                type: 'checkbox',
                help:
                  'Pilih ini kalau seluruh nomor di berkas ini memang harus lenyap (mis. berkas yang sama terunggah dua kali). ' +
                  'JANGAN pilih kalau yang menggantikannya adalah berkas yang benar — data yang sudah betul akan ikut terhapus.'
              }
            ]
          : [])
      ],
      submitText: 'Tarik kembali',
      danger: true
    });
    if (!v?.alasan?.trim()) return;
    try {
      const h = await tarikImpor({ runId, alasan: v.alasan, semua: Boolean(v.semua) });
      toast(
        `${h.invoice} dokumen (${h.baris} baris) ditarik` +
          (Number(h.ikut_terhapus) ? ` · ${h.ikut_terhapus} dokumen yang sudah digantikan ikut terhapus` : ''),
        'success'
      );
    } catch (e) {
      toast(e.message ?? 'Gagal menarik impor.', 'error');
      return;
    }
    await gambarImpor();
  }

  /** Hapus SATU invoice/PO hasil impor — untuk kekeliruan yang cuma satu dokumen. */
  async function dialogHapusDokumen() {
    const v = await formDialog({
      title: 'Hapus satu dokumen hasil impor',
      description:
        'Untuk satu invoice atau satu PO yang keliru. Kalau yang mau dibuang adalah SELURUH isi satu berkas ' +
        'impor, tutup dialog ini dan pakai tombol "Tarik kembali" di tabel Riwayat impor. ' +
        'Ingat: kalau berkas yang sama diimpor lagi, dokumen ini akan MUNCUL KEMBALI — betulkan di Turboly dulu ' +
        'kalau memang salah di sana.',
      fields: [
        {
          name: 'jenis',
          label: 'Jenis dokumen',
          type: 'select',
          required: true,
          options: [
            { value: 'penjualan', label: 'Invoice penjualan (Turboly)' },
            { value: 'pembelian', label: 'PO pembelian' }
          ]
        },
        { name: 'nomor', label: 'Nomor dokumen', type: 'text', required: true, placeholder: 'mis. SRI/OTXM/26110089 atau PO/HO/26110050' },
        { name: 'alasan', label: 'Alasan (wajib)', type: 'text', required: true }
      ],
      submitText: 'Hapus',
      danger: true
    });
    if (!v?.nomor?.trim() || !v?.alasan?.trim()) return;
    try {
      const h = await hapusDokumenImpor({ businessUnitId, jenis: v.jenis, nomor: v.nomor, alasan: v.alasan });
      toast(`${h.nomor} dihapus (${h.dihapus} baris).`, 'success');
    } catch (e) {
      toast(e.message ?? 'Gagal menghapus dokumen.', 'error');
      return;
    }
    await gambarImpor();
  }

  async function dialogPetakanKirim(alamat) {
    const v = await formDialog({
      title: alamat ? 'Petakan alamat kirim' : 'Petakan alamat kirim → outlet',
      description:
        'Alamat ditulis PERSIS seperti di kolom Deliver To pada berkas ekspor pembelian. ' +
        'Huruf besar-kecil dan spasi ganda tidak masalah.',
      fields: [
        { name: 'alamat', label: 'Alamat kirim (Deliver To)', type: 'text', required: true, value: alamat ?? '', placeholder: 'mis. Jl. Borobudur 45, Blimbing, Malang, Jawa Timur' },
        { name: 'outlet', label: 'Outlet di Berjaya Hub', type: 'select', required: true, options: outletKewenanganku.map((o) => ({ value: o.id, label: o.name })) }
      ],
      submitText: 'Simpan'
    });
    if (!v?.alamat || !v?.outlet) return;
    try {
      const h = await petakanTujuanKirim({ businessUnitId, alamat: v.alamat, outletId: v.outlet });
      const n = Number(h?.baris_dibetulkan) || 0;
      toast(
        `Alamat dipetakan ke ${namaOutlet(v.outlet)}` + (n ? ` — ${n} baris pembelian yang sudah masuk ikut dibetulkan.` : '.'),
        'success'
      );
    } catch (e) {
      toast(e.message ?? 'Gagal memetakan alamat.', 'error');
      return;
    }
    await gambarImpor();
  }

  /**
   * Impor pembelian.
   *
   * Pratinjaunya menampilkan hal yang TIDAK ada di sisi penjualan: apakah
   * seluruh berkasnya berharga nol. Itu ciri ekspor *store*, dan kalau
   * diimpor diam-diam, seluruh kolom Harga Beli di laporan akan berisi nol
   * yang terlihat seperti harga sungguhan.
   */
  async function bukaImporBeli() {
    const pilih = await formDialog({
      title: 'Impor Detailed Purchase Orders',
      fields: [{ name: 'file', label: 'Berkas Excel dari Turboly', type: 'file', required: true, accept: '.xlsx,.xls' }],
      submitText: 'Baca berkas'
    });
    if (!pilih?.file) return;

    let hasil;
    try {
      const XLSX = await loadXLSX();
      const wb = XLSX.read(await pilih.file.arrayBuffer(), { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      hasil = bacaEksporPo(XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }));
    } catch (e) {
      toast(`Gagal membaca berkas: ${e.message ?? e}`, 'error');
      return;
    }
    if (hasil.galat) {
      await infoDialog({ title: 'Berkas tidak bisa dipakai', bodyHtml: `<p>${esc(hasil.galat)}</p>` });
      return;
    }

    const petaKirim = await daftarKirimMap(businessUnitId).catch(() => []);
    const dikenal = new Set(petaKirim.map((p) => String(p.store_name).trim().toLowerCase().replace(/\s+/g, ' ')));
    const alamat = [...new Set(hasil.baris.map((b) => String(b.kirim_ke ?? '').trim().replace(/\s+/g, ' ')).filter(Boolean))];
    const belum = alamat.filter((a) => !dikenal.has(a.toLowerCase()));
    const tanpaAlamat = hasil.baris.filter((b) => !String(b.kirim_ke ?? '').trim()).length;
    const r = hasil.ringkas;
    const nol = semuaHarganyaNol(r);

    const ok = await confirmDialog({
      title: 'Periksa dulu sebelum mengimpor',
      messageHtml: `
        <div style="max-height:56vh;overflow:auto;font-size:0.88rem">
          <p style="margin:0 0 6px"><strong>Periode berkas:</strong> ${esc(r.dari || '?')} – ${esc(r.sampai || '?')}</p>
          <p style="margin:0 0 6px">${r.po} PO · ${r.baris} baris · ${r.qty} unit ·
            nilai <strong>${esc(rupiah(r.nilai))}</strong></p>
          <p style="margin:0 0 8px">${r.supplier.length} supplier</p>
          ${
            nol
              ? `<p class="error-text" style="margin:0 0 8px"><strong>Seluruh barisnya berharga 0.</strong>
                   Itu ciri ekspor <em>store</em> — harganya tidak ikut keluar. Pakai ekspor <strong>warehouse</strong>,
                   kalau tidak kolom Harga Beli di laporan akan berisi nol yang terlihat seperti harga sungguhan.</p>`
              : ''
          }
          ${
            belum.length
              ? `<p style="margin:0 0 8px;color:var(--color-warning,#b26a00)"><strong>Alamat kirim belum dipetakan:</strong>
                   ${esc(belum.join(' · '))}. Barisnya tetap masuk sebagai <strong>pembelian pusat</strong>, dan
                   akan ikut dibetulkan begitu alamatnya dipetakan.</p>`
              : ''
          }
          ${tanpaAlamat ? `<p style="margin:0 0 4px;color:var(--color-text-muted)">${tanpaAlamat} baris tanpa alamat kirim → pembelian pusat.</p>` : ''}
          ${r.tanpaSku ? `<p style="margin:0 0 4px;color:var(--color-warning,#b26a00)">${r.tanpaSku} baris tanpa SKU — tetap masuk, tapi tidak bisa dicocokkan dengan penjualan.</p>` : ''}
          ${
            hasil.ditolak.length
              ? `<details style="margin:4px 0"><summary style="cursor:pointer;color:var(--color-danger)">Baris ditolak (${hasil.ditolak.length})</summary>
                   <ul style="margin:6px 0 0;padding-left:18px;font-size:0.8rem;max-height:150px;overflow:auto">
                     ${hasil.ditolak.slice(0, 40).map((b) => `<li>baris ${b.nomor} — ${esc(PESAN_MASALAH_PO[b.sebab] ?? b.sebab)}</li>`).join('')}
                   </ul></details>`
              : ''
          }
          <p style="margin:8px 0 0">PO yang sudah ada akan <strong>diganti isinya</strong>, bukan digandakan.</p>
        </div>`,
      confirmText: `Impor ${r.baris} baris`,
      cancelText: 'Batal'
    });
    if (!ok) return;

    try {
      const h = await imporPembelianTurboly({
        businessUnitId,
        baris: poUntukRpc(hasil.baris),
        berkas: pilih.file.name
      });
      const catatan = [];
      if (Number(h.ke_pusat)) catatan.push(`${h.ke_pusat} baris jadi pembelian pusat`);
      if (Number(h.tanpa_sku)) catatan.push(`${h.tanpa_sku} tanpa SKU`);
      if (Number(h.dilewati)) catatan.push(`${h.dilewati} dilewati`);
      if (Number(h.dilewati_outlet_lain)) catatan.push(`${h.dilewati_outlet_lain} baris outlet lain dilewati`);
      toast(
        `${h.po_baru} PO baru, ${h.po_diganti} diganti, ${h.baris} baris` + (catatan.length ? ` · ${catatan.join('; ')}` : ''),
        catatan.length ? 'warning' : 'success'
      );
      // Alasannya disebut, bukan cuma jumlahnya — lihat alasan yang sama di
      // impor penjualan. Satu angka tanpa alamatnya tidak bisa ditindaklanjuti.
      if (Number(h.dilewati_outlet_lain)) {
        await infoDialog({
          title: 'Sebagian berkas tidak ikut diimpor',
          bodyHtml: `
            <p><strong>${Number(h.dilewati_outlet_lain)} baris</strong> dikirim ke alamat yang
              <strong>bukan outlet yang kamu pegang</strong>${
                h.alamat_outlet_lain?.length ? `: <strong>${esc(h.alamat_outlet_lain.join(' · '))}</strong>` : ''
              }.</p>
            <p style="color:var(--color-text-muted);font-size:0.86rem">PO milik outlet lain tidak ditulis dan tidak
              dihapus — isinya tetap seperti sebelumnya. Pembelian <em>pusat</em> (tanpa alamat, atau alamat yang
              belum dipetakan) tetap ikut masuk.</p>`
        });
      }
    } catch (e) {
      toast(e.message ?? 'Gagal mengimpor pembelian.', 'error');
      return;
    }
    await gambarImpor();
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
          options: outletKewenanganku.map((o) => ({ value: o.id, label: o.name }))
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
      // ============ BUKAN TOAST (0189) ============
      //
      // Baris yang dilewati karena bukan wewenangnya perlu DIBACA, bukan
      // dilewati bersama toast yang hilang sendiri dalam tiga detik. Tanpa ini
      // ia menyangka seluruh berkasnya masuk — dan kekurangannya baru terasa
      // di akhir bulan, saat sudah tidak ada yang ingat berkas mana.
      if (h.dilewati_outlet_lain?.length) {
        await infoDialog({
          title: 'Sebagian berkas tidak ikut diimpor',
          bodyHtml: `
            <p>Berkas ini memuat store yang <strong>bukan outlet yang kamu pegang</strong>:</p>
            <p style="margin:6px 0"><strong>${esc(h.dilewati_outlet_lain.join(' · '))}</strong></p>
            <p style="color:var(--color-text-muted);font-size:0.86rem">Invoice dari store itu tidak ditulis dan
              tidak diubah — datanya tetap seperti sebelumnya. Kalau memang harus ikut masuk, mintakan ke
              Admin BU, atau minta berkas yang sudah difilter per cabang dari Turboly.</p>`
        });
      }
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
  /**
   * Dialog invoice korporat.
   *
   * ============ SATU KOTAK PER ISIAN, BUKAN SATU KOTAK UNTUK SEMUA ============
   *
   * Versi pertamanya meminta seluruh baris diketik sebagai teks berpemisah
   * `|`. Itu cepat dibuat, dan salah dipakai: satu pemisah yang hilang
   * menggeser seluruh kolom sesudahnya — harga masuk ke kolom modal, dan
   * labanya tetap berupa angka yang masuk akal. Tidak ada galat, dan yang
   * menemukannya adalah orang yang membaca laporan sebulan kemudian.
   *
   * Sekarang: satu baris = satu deret kotak, dengan dropdown sparepart dari
   * master yang sudah terdaftar. Memilih dari master mengisi SKU, nama, harga
   * jual, dan modal sekaligus — dan ketiganya tetap bisa diubah, karena harga
   * korporat sering berbeda dari harga umum.
   */
  async function dialogKorporat(invoice) {
    let master = [];
    try {
      master = await listSpareparts(businessUnitId, { hanyaAktif: true });
    } catch (e) {
      // Master gagal dimuat TIDAK menutup pintu: baris masih bisa diketik
      // manual. Yang hilang cuma dropdownnya, dan itu dikatakan.
      toast(`Daftar sparepart gagal dimuat (${e.message ?? e}) — nama barang bisa diketik manual.`, 'warning');
    }
    const opsiMaster = master.map((m) => ({
      value: m.id,
      label: `${m.sku ? m.sku + ' — ' : ''}${m.name}${m.jenis === 'jasa' ? ' (jasa)' : ''}`
    }));
    const petaMaster = new Map(master.map((m) => [m.id, m]));

    let awalBaris = [barisKosong()];
    if (invoice) {
      try {
        const lama = await barisInvoice(invoice.id);
        if (lama.length) {
          awalBaris = lama.map((b) => ({
            item_type: b.item_type,
            // Dicocokkan balik ke master lewat SKU supaya dropdownnya ikut
            // terpilih saat disunting — kalau tidak, membuka invoice lama
            // akan menampilkan dropdown kosong di sebelah nama yang terisi.
            sparepart_id: master.find((m) => m.sku && b.sku && m.sku.toUpperCase() === b.sku.toUpperCase())?.id ?? '',
            sku: b.sku ?? '',
            nama: b.nama ?? '',
            qty: b.qty === null || b.qty === undefined ? '' : String(b.qty),
            harga: b.harga_satuan === null || b.harga_satuan === undefined ? '' : String(b.harga_satuan),
            modal: b.modal === null || b.modal === undefined ? '' : String(b.modal)
          }));
          awalBaris.push(barisKosong());
        }
      } catch (e) {
        toast(`Baris invoice gagal dimuat: ${e.message ?? e}`, 'error');
        return;
      }
    }

    const idBaris = () => `kb-${Math.random().toString(36).slice(2, 9)}`;
    const gambarBaris = (b, key) => `
      <tr data-baris="${key}">
        <td data-label="Jenis">
          <select class="kb-jenis" style="min-width:104px">
            <option value="sparepart"${b.item_type === 'sparepart' ? ' selected' : ''}>Sparepart</option>
            <option value="jasa"${b.item_type === 'jasa' ? ' selected' : ''}>Jasa</option>
          </select>
        </td>
        <td data-label="Pilih dari master" style="min-width:230px">
          ${renderSearchSelect({
            name: `sp-${key}`,
            options: opsiMaster,
            value: b.sparepart_id,
            placeholder: opsiMaster.length ? 'ketik SKU / nama…' : 'master tidak termuat'
          })}
        </td>
        <td data-label="SKU"><input class="kb-sku" value="${esc(b.sku)}" style="min-width:96px" placeholder="opsional" /></td>
        <td data-label="Nama barang / jasa"><input class="kb-nama" value="${esc(b.nama)}" style="min-width:160px" /></td>
        <td data-label="Qty"><input class="kb-qty" inputmode="decimal" value="${esc(b.qty)}" style="min-width:64px;text-align:right" /></td>
        <td data-label="Harga jual"><input class="kb-harga" inputmode="decimal" value="${esc(b.harga)}" style="min-width:104px;text-align:right" /></td>
        <td data-label="Modal"><input class="kb-modal" inputmode="decimal" value="${esc(b.modal)}" style="min-width:104px;text-align:right" placeholder="boleh kosong" /></td>
        <td data-label="Total" class="kb-total" style="text-align:right;white-space:nowrap">—</td>
        <td data-label=""><button type="button" class="kb-hapus btn-ghost" title="Hapus baris">✕</button></td>
      </tr>`;

    const htmlBaris = `
      <div class="table-scroll" style="max-height:38vh">
        <table class="data-table kartu-sempit" id="kb-tabel" style="font-size:0.84rem">
          <thead><tr>
            <th>Jenis</th><th>Pilih dari master</th><th>SKU</th><th>Nama barang / jasa</th>
            <th>Qty</th><th>Harga jual</th><th>Modal</th><th>Total</th><th></th>
          </tr></thead>
          <tbody>${awalBaris.map((b) => gambarBaris(b, idBaris())).join('')}</tbody>
        </table>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:6px;flex-wrap:wrap">
        <button type="button" id="kb-tambah">+ Tambah baris</button>
        <span id="kb-ringkas" style="font-size:0.84rem;color:var(--color-text-muted)"></span>
      </div>`;

    const v = await formDialog({
      title: invoice ? `Ubah ${invoice.invoice_no}` : 'Invoice Korporat Baru',
      description:
        'Pilih sparepart dari master supaya SKU, nama, harga, dan modalnya ikut terisi — semuanya masih bisa diubah. ' +
        'Modal yang dikosongkan TIDAK dianggap nol; laporannya akan menyebut berapa baris yang belum bermodal.',
      fields: [
        {
          name: 'outlet',
          label: 'Outlet',
          type: 'select',
          required: true,
          value: invoice?.outlet_id ?? '',
          options: outletKewenanganku.map((o) => ({ value: o.id, label: o.name }))
        },
        { name: 'tanggal', label: 'Tanggal', type: 'date', required: true, value: invoice?.tanggal ?? state.sampai },
        { name: 'company', label: 'Perusahaan', type: 'text', value: invoice?.company ?? '', placeholder: 'mis. PT SEMEN INDONESIA' },
        { name: 'customer', label: 'Nama PIC / pelanggan', type: 'text', value: invoice?.customer ?? '' },
        { name: 'nopol', label: 'Nopol', type: 'text', value: invoice?.nopol ?? '', placeholder: 'kosongkan kalau penjualan barang saja' },
        { name: 'pembayaran', label: 'Pembayaran', type: 'text', value: invoice?.pembayaran ?? '', placeholder: 'mis. Transfer / Tempo 30 hari' },
        { name: 'catatan', label: 'Catatan', type: 'text', value: invoice?.catatan ?? '' },
        { name: 'baris', label: 'Baris barang / jasa', type: 'html', html: htmlBaris }
      ],
      submitText: 'Simpan',
      onReady: (form, { kumpulkan, setError }) => {
        const tbody = form.querySelector('#kb-tabel tbody');
        const ringkasEl = form.querySelector('#kb-ringkas');

        const bacaBaris = (tr) => ({
          item_type: tr.querySelector('.kb-jenis').value,
          sparepart_id: tr.querySelector('.search-select input[type="hidden"]')?.value ?? '',
          sku: tr.querySelector('.kb-sku').value,
          nama: tr.querySelector('.kb-nama').value,
          qty: tr.querySelector('.kb-qty').value,
          harga: tr.querySelector('.kb-harga').value,
          modal: tr.querySelector('.kb-modal').value
        });
        const semua = () => [...tbody.querySelectorAll('tr')].map(bacaBaris);

        const segarkan = () => {
          for (const tr of tbody.querySelectorAll('tr')) {
            const t = totalBaris(bacaBaris(tr));
            tr.querySelector('.kb-total').textContent = t === null ? '—' : formatRupiah(t);
          }
          const r = ringkasBarisKorporat(semua());
          ringkasEl.textContent = r.baris
            ? `${r.baris} baris · total ${formatRupiah(r.total)}` +
              (r.tanpaModal ? ` · ${r.tanpaModal} baris belum bermodal` : '')
            : 'Belum ada baris terisi.';
        };

        const pasangBaris = (tr) => {
          // Dropdown master: memilih mengisi SKU, nama, harga, modal, dan
          // jenisnya sekaligus. Yang TIDAK diisi: qty — angka itu harus datang
          // dari orangnya, dan bawaan "1" adalah cara tercepat menyimpan
          // jumlah yang tidak pernah dihitung siapa pun.
          wireSearchSelect(tr.querySelector('.search-select'), opsiMaster, (val) => {
            const sp = petaMaster.get(val);
            if (!sp) return;
            const isi = dariMaster(sp);
            tr.querySelector('.kb-jenis').value = isi.item_type;
            tr.querySelector('.kb-sku').value = isi.sku;
            tr.querySelector('.kb-nama').value = isi.nama;
            if (!tr.querySelector('.kb-harga').value) tr.querySelector('.kb-harga').value = isi.harga;
            if (!tr.querySelector('.kb-modal').value) tr.querySelector('.kb-modal').value = isi.modal;
            segarkan();
            tr.querySelector('.kb-qty').focus();
          });
          tr.querySelectorAll('input, select').forEach((el) => el.addEventListener('input', segarkan));
          tr.querySelector('.kb-hapus').addEventListener('click', () => {
            // Baris terakhir tidak dihapus, cuma dikosongkan — daftar yang
            // kehabisan baris membuat orang mencari tombol Tambah untuk bisa
            // mulai mengetik lagi.
            if (tbody.querySelectorAll('tr').length === 1) {
              tr.querySelectorAll('input').forEach((el) => (el.value = ''));
            } else {
              tr.remove();
            }
            segarkan();
          });
        };

        tbody.querySelectorAll('tr').forEach(pasangBaris);
        form.querySelector('#kb-tambah').addEventListener('click', () => {
          tbody.insertAdjacentHTML('beforeend', gambarBaris(barisKosong(), idBaris()));
          pasangBaris(tbody.lastElementChild);
          segarkan();
        });
        segarkan();

        // Nilainya dikumpulkan SAAT Simpan ditekan, selagi dialognya masih
        // berdiri — bukan dibaca sesudah dialognya ditutup.
        kumpulkan(() => {
          const { baris, salah } = susunBarisKorporat(semua());
          if (salah.length) return salah.join(' ');
          if (!baris.length) return 'Isi minimal satu baris barang atau jasa.';
          setError('');
          return { barisKorporat: baris };
        });
      }
    });
    if (!v) return;

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
          baris: v.barisKorporat
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
  /**
   * TAB LAPORAN — tiga bentuk, satu data.
   *
   * Dua yang pertama MENIRU tata kolom sheet Otonix supaya bisa dibandingkan
   * baris demi baris dengan yang lama; yang ketiga ringkasan untuk dibaca
   * cepat. Ketiganya dihitung dari satu pengambilan data dan satu pencocokan
   * — tiga perhitungan terpisah pasti menyimpang, dan tidak ada cara tahu
   * mana yang benar.
   */
  async function gambarLaporan() {
    isi.innerHTML =
      saringanHtml() +
      `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">
         ${[['jual', '📄 Penjualan (bentuk sheet)'], ['beli', '🧾 Pengeluaran (bentuk sheet)'], ['ringkas', '📊 Ringkasan']]
           .map(([k, l]) => `<button class="tab-btn pr-sub${state.sub === k ? ' active' : ''}" data-sub="${k}">${esc(l)}</button>`)
           .join('')}
       </div>
       <div id="pr-lap">${loadingHtml('Menyusun laporan…', { baris: 5 })}</div>`;
    wiringSaringan(gambarLaporan);
    isi.querySelectorAll('.pr-sub').forEach((b) =>
      b.addEventListener('click', () => {
        state.sub = b.dataset.sub;
        gambarLaporan();
      })
    );
    const kotak = isi.querySelector('#pr-lap');

    let baris = [];
    let beli = [];
    try {
      [baris, beli] = await Promise.all([
        barisPenjualan(businessUnitId, state),
        // Pembelian TIDAK ikut disaring sumber (`sumber` cuma milik penjualan)
        // dan outletnya dibiarkan apa adanya: pembelian pusat harus tetap
        // ikut dicocokkan, kalau tidak part yang dibeli HO lalu dipakai di
        // cabang akan selalu berbunyi "tidak ketemu".
        barisPembelian(businessUnitId, { dari: state.dari, sampai: state.sampai })
      ]);
    } catch (e) {
      kotak.innerHTML = `<p class="error-text">${esc(
        /bengkel_p/.test(String(e.message ?? e))
          ? 'Migration 0185 & 0186 belum dijalankan di Supabase.'
          : e.message ?? e
      )}</p>`;
      return;
    }
    if (!baris.length && !beli.length) {
      kotak.innerHTML = `<p style="color:var(--color-text-muted)">Tidak ada data pada rentang ini.</p>`;
      return;
    }

    // ============ SATU PENCOCOKAN UNTUK KEDUA LAPORAN ============
    const cocokan = cocokkanBeliJual({
      pembelian: beli.map((b) => ({ ...b, kirim_ke: b.kirim_ke })),
      penjualan: baris.map((b) => ({ ...b, item_type: b.item_type }))
    });
    const lapJual = susunLaporanJual({ baris, cocok: cocokan.jual });
    const lapBeli = susunLaporanBeli({ baris: beli, cocok: cocokan.beli });
    const catatan = [...catatanCocok(cocokan.ringkas), ...catatanBentukSheet(lapJual.ringkas, lapBeli.ringkas)];

    const rentang = [state.dari, state.sampai].filter(Boolean).join(' s/d ');
    const subjudul = `${state.outletId ? namaOutlet(state.outletId) : 'Semua outlet'} · ${rentang}`;
    const namaBerkas = `bengkel-${(rentang || 'semua').replace(/[^\w.-]+/g, '-')}`;

    const tabelSheet = (lap) => `
      <div class="table-scroll"><table class="data-table kartu-sempit" style="font-size:0.82rem">
        <thead><tr>${lap.kolom.map((k) => `<th>${esc(k.header)}</th>`).join('')}</tr></thead>
        <tbody>${lap.rows
          .map(
            (r, i) => `<tr${r[0] === 'TOTAL' ? ' style="font-weight:600;background:var(--color-bg-alt,#f6f6f6)"' : ''}>${r
              .map((sel, j) => {
                const kol = lap.kolom[j] ?? {};
                const angka = kol.numeric;
                // null DIBIARKAN KOSONG, bukan jadi "0" atau "-".
                //
                // Di laporan ini kosong memang berarti "tidak berlaku untuk
                // baris itu" (mis. kolom Jasa pada baris sparepart). Mengisinya
                // dengan 0 membuat kolomnya penuh angka nol yang harus dibaca
                // satu per satu untuk dipastikan tidak berarti apa-apa.
                // ============ QTY BUKAN RUPIAH ============
                //
                // `numeric` cuma berarti "rata kanan & tetap angka di Excel".
                // Yang dirupiahkan hanya kolom ber-`uang`. Sheet lama
                // memformat QTY sebagai mata uang — "Rp191" di baris TOTAL —
                // dan itu kekeliruan format yang tidak perlu ikut ditiru.
                const isiSel =
                  sel === null || sel === undefined || sel === ''
                    ? ''
                    : kol.uang
                      ? formatRupiah(sel)
                      : angka
                        ? formatNum(sel)
                        : esc(sel);
                return `<td data-label="${esc(kol.header ?? '')}"${angka ? ' style="text-align:right"' : ''}>${isiSel}</td>`;
              })
              .join('')}</tr>`
          )
          .join('')}</tbody>
      </table></div>`;

    const kepala = `
      <p style="font-size:0.84rem;color:var(--color-text-muted);margin:0 0 4px">${esc(subjudul)}</p>
      ${catatan.map((c) => `<p class="nota-telat" style="margin:2px 0;font-size:0.8rem">${esc(c)}</p>`).join('')}
      <button id="pr-ekspor" style="margin:8px 0 10px">⬇ Export Excel (kedua laporan)</button>`;

    if (state.sub === 'jual') {
      kotak.innerHTML = kepala + tabelSheet(lapJual);
    } else if (state.sub === 'beli') {
      kotak.innerHTML = kepala + tabelSheet(lapBeli);
    } else {
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
      kotak.innerHTML =
        kepala +
        `<div class="inline-card" style="max-width:720px">
          <table class="data-table" style="max-width:460px">
            <tbody>
              <tr><td>Omzet sparepart</td><td style="text-align:right">${formatRupiah(r.omzetSparepart)}</td></tr>
              <tr><td>Omzet jasa</td><td style="text-align:right">${formatRupiah(r.omzetJasa)}</td></tr>
              <tr><td><strong>Omzet total</strong></td><td style="text-align:right"><strong>${formatRupiah(r.omzet)}</strong></td></tr>
              <tr><td>Modal sparepart (yang diketahui)</td><td style="text-align:right">${formatRupiah(r.modal)}</td></tr>
              <tr><td><strong>Laba sparepart</strong></td><td style="text-align:right"><strong>${formatRupiah(r.laba)}</strong>${
                r.margin === null ? '' : ` <span style="color:var(--color-text-muted)">(${r.margin}%)</span>`
              }</td></tr>
              <tr><td>Nilai pembelian (periode ini)</td><td style="text-align:right">${formatRupiah(lapBeli.ringkas.nilai)}</td></tr>
              <tr><td>Pembelian yang ketemu pemakaiannya</td><td style="text-align:right">${cocokan.ringkas.cocok + cocokan.ringkas.sebagian} dari ${cocokan.ringkas.jualSparepart} baris jual</td></tr>
            </tbody>
          </table>
        </div>
        ${tabel('Per outlet', lap.perOutlet, 'Outlet')}
        ${tabel('Per asal data', lap.perSumber, 'Asal')}
        ${tabel('Per nopol (sparepart)', lap.perNopol, 'Nopol')}
        ${tabel('Per SKU (sparepart)', lap.perSku, 'SKU')}`;
    }

    kotak.querySelector('#pr-ekspor')?.addEventListener(
      'click',
      sekaliJalan(async () => {
        // SATU berkas, dua lembar — persis dua laporan yang diminta. Dua
        // berkas terpisah berarti dua kali kirim, dan yang menerimanya harus
        // mencocokkan sendiri periodenya.
        await exportSheetsXLSX({
          filename: namaBerkas,
          sheets: [
            {
              sheetName: 'Penjualan',
              title: 'Rincian Penjualan Bengkel',
              subtitle: [subjudul, ...catatan].join(' · '),
              columns: lapJual.kolom,
              rows: lapJual.rows
            },
            {
              sheetName: 'Pengeluaran',
              title: 'Laporan Pengeluaran / Pembelian Sparepart',
              subtitle: [subjudul, ...catatan].join(' · '),
              columns: lapBeli.kolom,
              rows: lapBeli.rows
            }
          ]
        });
        toast('Dua laporan terunduh dalam satu berkas.', 'success');
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
