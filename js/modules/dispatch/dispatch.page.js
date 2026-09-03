import { listAttendanceOutlets } from '../attendance/attendance.service.js';
import { toast, shareDialog, formDialog, confirmDialog } from '../../core/ui.js';
import { formatNum } from '../../core/format.js';
import { listProducts } from '../product/product.service.js';
import { getOutletStockMap } from '../inventory/inventory.service.js';
import { createItemPicker } from './item-picker.js';
import { petaDraftPerOrder, keadaanOrder, ringkasOrder } from './order-draft.js';
import {
  buatDraftKiriman,
  ubahDraftKiriman,
  hapusDraftKiriman,
  kirimDraftKiriman,
  listDraftKiriman,
  receiveDispatch,
  listIncomingDispatches,
  getDispatchItems,
  getDispatchForPdf,
  ORDER_STATUS,
  DISPATCH_STATUS,
  updateStockOrder,
  ambilAtauBuatDraftOrder,
  kirimDraftOrder,
  siapkanOrderJadiDraft,
  rejectStockOrder,
  cancelStockOrder,
  listIncomingOrders,
  listMyOrders,
  listMyDispatches,
  getOrderItems
} from './dispatch.service.js';
import { buildSuratJalanPDF, suratJalanWaText } from './dispatch-pdf.js';
import { listMyOutlets, PESAN_TANPA_OUTLET } from '../../core/my-outlets.js';
import { loadingHtml, sekaliJalan } from '../../core/loading.js';
import { bukaDokumen } from './dokumen-ui.js';
import { monthRangeWIB, isoFrom, isoTo } from '../../core/dates.js';

const ORDER_BADGE = { draft: 'badge-pending', open: 'badge-pending', fulfilled: 'badge-approved', rejected: 'badge-rejected', cancelled: 'badge-cancelled' };

export async function renderDispatchPage(container, { businessUnitId, outletId }) {
  container.innerHTML = loadingHtml('Memuat pengiriman…');

  // DUA daftar yang berbeda, dan bedanya penting:
  //   allOutlets = seluruh outlet BU -> dipakai sebagai TUJUAN kiriman dan untuk
  //                menerjemahkan nama outlet di riwayat. Staff outlet cabang
  //                HARUS bisa memilih Central Kitchen sebagai tujuan order,
  //                padahal CK itu bukan scope-nya. Kalau daftar ini ikut
  //                disaring, seluruh alur order stok mati.
  //   myOutlets  = outlet yang boleh dia WAKILI sebagai pengirim/pemilik order.
  let allOutlets, products;
  try {
    [allOutlets, products] = await Promise.all([
      listAttendanceOutlets().then((all) => all.filter((o) => o.business_unit_id === businessUnitId)),
      listProducts(businessUnitId)
    ]);
  } catch (error) {
    container.innerHTML = `<p class="error-text">Gagal memuat: ${error.message ?? error}</p>`;
    return;
  }
  if (!allOutlets.length) {
    container.innerHTML = `<h1>Pengiriman</h1><p>Belum ada outlet di BU ini.</p>`;
    return;
  }

  // Order & pengiriman BAHAN: menu (produk jadi) sengaja tidak ditampilkan
  // supaya tidak membingungkan staff.
  const stockProducts = products.filter((p) => p.is_active !== false && p.product_type !== 'finished');
  const outletsById = new Map(allOutlets.map((o) => [o.id, o]));
  const ckOutlets = allOutlets.filter((o) => o.outlet_role === 'central_kitchen');
  const myOutlets = await listMyOutlets(businessUnitId, allOutlets);
  if (!myOutlets.length) {
    container.innerHTML = `<h1>Pengiriman</h1><p style="color:var(--color-text-muted)">${PESAN_TANPA_OUTLET}</p>`;
    return;
  }
  const state = {
    outletId: myOutlets.some((o) => o.id === outletId) ? outletId : myOutlets[0].id,
    tab: null,
    stockMap: new Map(),
    // Nomor draft yang harus langsung terbuka saat tab Draft digambar. Dititipkan
    // lewat `state` karena yang menyalakannya (tab Order Masuk) dan yang
    // memakainya (tab Draft) adalah dua penggambaran yang berbeda.
    fokusDraft: null
  };

  container.innerHTML = `
    <h1>Pengiriman</h1>
    <div class="field" style="max-width:280px"><label>Outlet saya</label>
      <select id="disp-outlet">${myOutlets
        .map((o) => `<option value="${o.id}"${o.id === state.outletId ? ' selected' : ''}>${esc(o.name)}${o.outlet_role === 'central_kitchen' ? ' (CK)' : ''}</option>`)
        .join('')}</select>
    </div>
    <section class="incoming-highlight" id="disp-incoming-box"></section>
    <div class="tab-bar group-tabs" id="disp-tabs"></div>
    <div id="disp-tab-content" class="fade-in"></div>
  `;

  const tabBar = container.querySelector('#disp-tabs');
  const contentBox = container.querySelector('#disp-tab-content');

  container.querySelector('#disp-outlet').addEventListener('change', async (e) => {
    state.outletId = e.target.value;
    state.tab = null;
    await loadStock();
    buildTabs();
    renderIncoming();
  });

  async function loadStock() {
    try {
      state.stockMap = await getOutletStockMap(businessUnitId, state.outletId);
    } catch {
      state.stockMap = new Map();
    }
  }

  function tabsFor() {
    const outlet = outletsById.get(state.outletId);
    const isCK = outlet?.outlet_role === 'central_kitchen';
    // Tab "Riwayat & Dokumen" ada di KEDUA peran outlet. Pertanyaan yang
    // dijawabnya sama di mana pun: "dokumen nomor sekian isinya apa, dan mana
    // salinannya" — dan itu tidak bergantung pada siapa yang mengirim.
    const riwayat = { key: 'docs', label: '📄 Riwayat & Dokumen', render: renderDokumenTab };
    return isCK
      ? [
          { key: 'orders-in', label: '📥 Order Masuk', render: renderIncomingOrders },
          // Draft duduk PERSIS di antara "order masuk" dan "kirim", karena di
          // situlah tempatnya dalam alur: order disiapkan jadi draft H-1, lalu
          // besoknya draft itu yang dibuka dan dikirim.
          { key: 'drafts', label: '📝 Draft Surat Jalan', render: renderDrafts },
          { key: 'send', label: '🚚 Kirim ke Outlet', render: renderSend },
          riwayat
        ]
      : [
          { key: 'order', label: '🧾 Order ke CK', render: renderOrderTab },
          { key: 'transfer', label: '🔁 Transfer / Retur', render: renderSend },
          // TAB INI SEMPAT TIDAK ADA, DAN ITU MENELAN BARANG.
          //
          // Tombol "Kirim & Buat Surat Jalan" di tab Transfer/Retur memanggil
          // `buatDraftKiriman()` — sama seperti sisi CK. Drafnya benar-benar
          // tersimpan (`buat_draft_kiriman` memakai `has_outlet_scope`, tidak
          // peduli peran outletnya), lalu layar menyetel `state.tab = 'drafts'`
          // yang di sini TIDAK ADA, dan `buildTabs()` melemparnya balik ke tab
          // pertama tanpa sepatah kata pun.
          //
          // Hasilnya: staff melihat "Draft dibuat, kirim dari tab Draft",
          // mendarat di "Order ke CK", dan drafnya tidak muncul di mana pun —
          // Riwayat pun mengecualikan draft (`.neq('status','draft')`).
          // Barangnya sudah diserahkan secara fisik sementara sistem masih
          // mencatatnya di outlet asal, tanpa satu pun error.
          { key: 'drafts', label: '📝 Draft Kiriman', render: renderDrafts },
          riwayat
        ];
  }

  function buildTabs() {
    const tabs = tabsFor();

    // PENGALIHAN INI HARUS BERSUARA.
    //
    // Baris ini ada karena peran outlet bisa berganti sementara `state.tab`
    // masih menyimpan tab lama — pengalihannya sendiri benar. Yang salah
    // adalah DIAMNYA: ketika tab 'drafts' tidak ada di sisi outlet, kode yang
    // memintanya tetap "berhasil", layarnya pindah ke tempat lain, dan tidak
    // ada apa pun yang menghubungkan keduanya. Bug itu bertahan sampai ada
    // yang menyadari barangnya tidak pernah sampai.
    //
    // Sekarang ia mengaku. Bukan ke pengguna — mereka tidak bisa berbuat apa
    // pun soal ini — melainkan ke console, supaya jejaknya ada saat ditelusuri.
    if (!tabs.some((t) => t.key === state.tab)) {
      console.warn(
        `[dispatch] tab "${state.tab}" tidak tersedia untuk outlet ini; dialihkan ke "${tabs[0].key}". ` +
          'Kalau ini terjadi sesudah sebuah tombol ditekan, kemungkinan besar tombol itu menunjuk tab yang tidak ada.'
      );
      state.tab = tabs[0].key;
    }
    tabBar.innerHTML = tabs
      .map((t) => `<button class="tab-btn ${t.key === state.tab ? 'active' : ''}" data-dtab="${t.key}">${t.label}</button>`)
      .join('');
    tabBar.querySelectorAll('[data-dtab]').forEach((btn) =>
      btn.addEventListener('click', () => {
        state.tab = btn.dataset.dtab;
        buildTabs();
      })
    );
    showTab();
  }

  async function showTab() {
    const tab = tabsFor().find((t) => t.key === state.tab);
    if (!tab) return;
    contentBox.classList.remove('fade-in');
    void contentBox.offsetWidth;
    contentBox.classList.add('fade-in');
    contentBox.innerHTML = loadingHtml('Memuat…');
    try {
      await tab.render(contentBox);
    } catch (error) {
      contentBox.innerHTML = `<p class="error-text">${error?.message ?? error}</p>`;
    }
  }

  // ---- Tab: Riwayat & Dokumen ----

  const rentang = monthRangeWIB();
  const stateDok = { from: rentang.from, to: rentang.to };

  /**
   * Riwayat order & pengiriman outlet ini, disaring rentang tanggal.
   *
   * Bawaannya tanggal 1 bulan berjalan sampai hari ini — sama dengan modul
   * laporan lain, dan menoleh KE BELAKANG karena yang ditelusuri di sini memang
   * dokumen yang sudah terjadi.
   */
  async function renderDokumenTab(box) {
    box.innerHTML = `
      <div class="inline-card" style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">
        <div class="field" style="margin:0;max-width:165px"><label>Dari tanggal</label>
          <input type="date" id="dok-from" value="${stateDok.from}" /></div>
        <div class="field" style="margin:0;max-width:165px"><label>Sampai tanggal</label>
          <input type="date" id="dok-to" value="${stateDok.to}" /></div>
      </div>
      <p style="font-size:0.82rem;color:var(--color-text-muted);margin:10px 0 0">
        Ketuk nomor dokumen untuk melihat isinya dan mengunduhnya (PDF / Excel).
      </p>
      <div id="dok-hasil"></div>
    `;
    const muat = async () => {
      const hasil = box.querySelector('#dok-hasil');
      hasil.innerHTML = loadingHtml('Memuat dokumen…', { baris: 5 });
      const [orders, kiriman] = await Promise.all([
        listMyOrders([state.outletId], { dateFrom: isoFrom(stateDok.from), dateTo: isoTo(stateDok.to) }).catch(() => []),
        listMyDispatches([state.outletId], { dateFrom: isoFrom(stateDok.from), dateTo: isoTo(stateDok.to) }).catch(() => [])
      ]);
      hasil.innerHTML = `
        <h3 style="font-size:0.95rem;margin:16px 0 6px">Order (${orders.length})</h3>
        <div class="table-scroll"><table class="data-table table-freeze-1 kartu-sempit">
          <thead><tr><th>No. Order</th><th>Ke</th><th>Waktu</th><th>Status</th></tr></thead>
          <tbody>${
            orders
              .map(
                (o) => `<tr>
                  <td data-label="No. Order"><button class="btn-dok" data-jenis="order" data-id="${o.id}"
                    style="font-family:ui-monospace,Menlo,monospace;font-size:0.8rem">${esc(o.code ?? '(tanpa nomor)')}</button></td>
                  <td data-label="Ke">${esc(o.to_outlet?.name ?? '-')}</td>
                  <td style="font-size:0.8rem" data-label="Waktu">${fmtDateTime(o.created_at)}</td>
                  <td data-label="Status"><span class="badge ${ORDER_BADGE[o.status] ?? ''}">${ORDER_STATUS[o.status] ?? o.status}</span></td>
                </tr>`
              )
              .join('') || '<tr><td colspan="4">Tidak ada order pada rentang ini.</td></tr>'
          }</tbody>
        </table></div>

        <h3 style="font-size:0.95rem;margin:18px 0 6px">Pengiriman (${kiriman.length})</h3>
        <div class="table-scroll"><table class="data-table table-freeze-1 kartu-sempit">
          <thead><tr><th>No. Surat Jalan</th><th>Dari</th><th>Ke</th><th>Waktu</th><th>Status</th></tr></thead>
          <tbody>${
            kiriman
              .map(
                (d) => `<tr>
                  <td data-label="No. Surat Jalan"><button class="btn-dok" data-jenis="dispatch" data-id="${d.id}"
                    style="font-family:ui-monospace,Menlo,monospace;font-size:0.8rem">${esc(d.code ?? '(tanpa nomor)')}</button></td>
                  <td data-label="Dari">${esc(d.from_outlet?.name ?? '-')}</td>
                  <td data-label="Ke">${esc(d.to_outlet?.name ?? '-')}</td>
                  <td style="font-size:0.8rem" data-label="Waktu">${fmtDateTime(d.created_at)}</td>
                  <td data-label="Status">${esc(DISPATCH_STATUS[d.status] ?? d.status)}${
                    d.received_at ? `<div style="font-size:0.74rem;color:var(--color-text-muted)">diterima ${fmtDateTime(d.received_at)}</div>` : ''
                  }</td>
                </tr>`
              )
              .join('') || '<tr><td colspan="5">Tidak ada pengiriman pada rentang ini.</td></tr>'
          }</tbody>
        </table></div>
      `;
      // Staff App: TANPA nilai rupiah. Surat jalan yang dipegang kurir tidak
      // perlu memuat modal.
      hasil.querySelectorAll('.btn-dok').forEach((btn) =>
        btn.addEventListener(
          'click',
          sekaliJalan(() => bukaDokumen({ jenis: btn.dataset.jenis, id: btn.dataset.id, businessUnitId, denganNilai: false }))
        )
      );
    };
    box.querySelector('#dok-from').addEventListener('change', (e) => {
      stateDok.from = e.target.value;
      muat();
    });
    box.querySelector('#dok-to').addEventListener('change', (e) => {
      stateDok.to = e.target.value;
      muat();
    });
    await muat();
  }

  // ---- Tab: Order ke Central Kitchen (outlet non-CK) ----
  async function renderOrderTab(box) {
    const outlet = outletsById.get(state.outletId);
    const servedCk = outlet?.served_by_outlet_id ? outletsById.get(outlet.served_by_outlet_id) : null;
    const ckChoices = servedCk ? [servedCk] : ckOutlets;
    const myOrders = await listMyOrders([state.outletId]).catch(() => []);

    box.innerHTML = `
      <div class="inline-card" style="max-width:640px">
        <h3 style="margin-top:0">Order ke Central Kitchen</h3>
        <p class="report-note" style="margin:0 0 10px">
          Order disusun sebagai <strong>draft</strong> dulu. Selama masih draft, siapa pun di outlet ini
          boleh menambah barangnya — bar mengisi sirup, kitchen menambah daging — dan
          <strong>CK belum melihatnya sama sekali</strong>. Baru saat ditekan <strong>Kirim ke CK</strong>,
          ordernya berangkat dan isinya terkunci.
          <br /><br />
          Satu outlet hanya punya <strong>satu draft</strong> per Central Kitchen tujuan. Menekan tombol di
          bawah akan membuka draft yang sudah ada, bukan membuat yang baru.
        </p>
        ${
          ckChoices.length
            ? `<p style="font-size:0.82rem;color:var(--color-text-muted);margin:0 0 10px">
                 Tujuan: <strong>${servedCk ? esc(servedCk.name) : 'pilih CK'}</strong>${servedCk ? ' (otomatis dari setelan outlet)' : ''}
               </p>
               ${
                 servedCk
                   ? ''
                   : `<div class="field"><label>Central Kitchen tujuan</label><select id="ord-to">${ckChoices
                       .map((o) => `<option value="${o.id}">${esc(o.name)}</option>`)
                       .join('')}</select></div>`
               }
               <button class="primary" id="ord-buka-draft" style="max-width:280px">📝 Buka / Buat Draft Order</button>
               <p class="error-text" id="ord-error"></p>`
            : `<p style="color:var(--color-text-muted);font-size:0.88rem;margin:0">Belum ada Central Kitchen di BU ini.</p>`
        }
      </div>
      ${
        myOrders.length
          ? `<h3 style="font-size:0.95rem;margin:18px 0 8px">Order Saya</h3>
             <table class="data-table kartu-sempit">
               <thead><tr><th>No. Order</th><th>Ke</th><th>Waktu</th><th>Status</th><th>Keterangan</th><th>Aksi</th></tr></thead>
               <tbody>
                 ${myOrders
                   .map(
                     (o) => `<tr>
                       <td data-label="No. Order"><button class="btn-dok-order" data-id="${o.id}" title="Lihat & unduh dokumen"
                         style="font-family:ui-monospace,Menlo,monospace;font-size:0.8rem">${esc(o.code ?? o.id.slice(0, 6))}</button></td>
                       <td data-label="Ke">${esc(o.to_outlet?.name ?? '-')}</td>
                       <td style="font-size:0.8rem" data-label="Waktu">${fmtDateTime(o.created_at)}</td>
                       <td data-label="Status"><span class="badge ${ORDER_BADGE[o.status] ?? ''}">${ORDER_STATUS[o.status] ?? o.status}</span>
                         ${o.status === 'rejected' && o.reject_reason ? `<div style="font-size:0.74rem;color:var(--color-danger)">${esc(o.reject_reason)}</div>` : ''}</td>
                       <td style="font-size:0.78rem" data-label="Keterangan">
                         <!-- PEMBUATNYA DISEBUT, selalu.

                              Sejak 0110 order milik OUTLET: siapa pun di outlet
                              itu boleh menambah isinya. Begitu banyak tangan
                              bisa menyentuh satu order, "ini punya siapa"
                              berhenti jelas dengan sendirinya — dan orang yang
                              hendak menambah perlu tahu ia sedang menumpang
                              pada pekerjaan rekannya. -->
                         Dibuat ${esc(o.pembuat?.full_name ?? 'staff')}
                         ${
                           o.edited_at
                             ? `<br /><span class="badge badge-pending">✎</span> diubah ${esc(o.editor?.full_name ?? 'staff')} · ${fmtDateTime(o.edited_at)}`
                             : ''
                         }
                       </td>
                       <td data-label="Aksi">${
                         // TIGA KEADAAN, TIGA KUMPULAN TOMBOL YANG BERBEDA.
                         //
                         //   draft -> masih bisa disusun bersama, dan dikirim
                         //   open  -> sudah di tangan CK; isinya TERKUNCI, yang
                         //            tersisa cuma membatalkan
                         //   lain  -> sudah selesai, tidak ada yang bisa dilakukan
                         //
                         // Tombol Edit yang tetap muncul pada order yang sudah
                         // dikirim akan membuka form, orangnya mengisi, lalu
                         // ditolak server — pekerjaannya terbuang. Bug persis
                         // itu yang baru saja diperbaiki di 0110; jangan
                         // dihidupkan lagi dari sisi layar.
                         o.status === 'draft'
                           ? `<button class="btn-edit-order" data-id="${o.id}" data-code="${esc(o.code ?? '')}"
                                data-pembuat="${esc(o.pembuat?.full_name ?? '')}">Tambah / Edit</button>
                              <button class="primary btn-kirim-order" data-id="${o.id}" data-code="${esc(o.code ?? '')}">🚚 Kirim ke CK</button>
                              <button class="btn-cancel-order" data-id="${o.id}">Hapus draft</button>`
                           : o.status === 'open'
                             ? `<button class="btn-cancel-order" data-id="${o.id}">Batalkan</button>`
                             : ''
                       }</td>
                     </tr>`
                   )
                   .join('')}
               </tbody>
             </table>
             <div id="ord-edit-box" style="margin-top:12px"></div>`
          : ''
      }
    `;

    box.querySelectorAll('.btn-dok-order').forEach((btn) =>
      btn.addEventListener(
        'click',
        sekaliJalan(() => bukaDokumen({ jenis: 'order', id: btn.dataset.id, businessUnitId, denganNilai: false }))
      )
    );

    if (ckChoices.length) {
      box.querySelector('#ord-buka-draft').addEventListener('click', sekaliJalan(async (e) => {
        const errorEl = box.querySelector('#ord-error');
        errorEl.textContent = '';
        const toOutlet = servedCk ? servedCk.id : box.querySelector('#ord-to')?.value;
        if (!toOutlet) {
          errorEl.textContent = 'Pilih Central Kitchen tujuan.';
          return;
        }
        try {
          // Server yang memutuskan apakah ini draft baru atau draft yang sudah
          // ada — TIDAK diperiksa di sini lebih dulu.
          //
          // Pemeriksaan di layar hanya melihat daftar yang termuat beberapa
          // detik lalu; rekan di HP lain bisa membuat draft di antaranya. Yang
          // menjamin cuma satu adalah unique index parsial di database.
          const id = await ambilAtauBuatDraftOrder({ fromOutlet: state.outletId, toOutlet });
          await showTab();
          // Panel editnya langsung dibuka supaya orangnya tidak perlu mencari
          // barisnya sendiri di daftar bawah.
          contentBox.querySelector(`.btn-edit-order[data-id="${id}"]`)?.click();
        } catch (error) {
          errorEl.textContent = error.message ?? 'Gagal membuka draft order.';
        }
      }));
    }

    // Kirim draft ke CK — satu-satunya titik di mana order jadi terlihat CK.
    box.querySelectorAll('.btn-kirim-order').forEach((btn) =>
      btn.addEventListener('click', sekaliJalan(async () => {
        const ok = await confirmDialog({
          title: `Kirim ${btn.dataset.code || 'order'} ke CK?`,
          message:
            'Sesudah dikirim, isinya TIDAK bisa diubah lagi — CK sudah melihatnya dan mungkin langsung menyiapkan barangnya.\n\n' +
            'Pastikan semua divisi sudah menambahkan kebutuhannya.',
          confirmText: 'Ya, kirim'
        });
        if (!ok) return;
        try {
          await kirimDraftOrder(btn.dataset.id);
          toast('Order terkirim ke Central Kitchen.', 'success');
          showTab();
        } catch (error) {
          toast(error.message ?? 'Gagal mengirim order.', 'error');
        }
      }))
    );

    box.querySelectorAll('.btn-cancel-order').forEach((btn) =>
      btn.addEventListener('click', async () => {
        const ok = await confirmDialog({ title: 'Batalkan order?', confirmText: 'Batalkan', danger: true });
        if (!ok) return;
        try {
          await cancelStockOrder(btn.dataset.id);
          toast('Order dibatalkan.', 'success');
          showTab();
        } catch (error) {
          toast(error.message ?? 'Gagal membatalkan order.', 'error');
        }
      })
    );

    // Edit order yang masih menunggu (nomor order tetap sama).
    box.querySelectorAll('.btn-edit-order').forEach((btn) =>
      btn.addEventListener('click', async () => {
        const editBox = box.querySelector('#ord-edit-box');
        editBox.innerHTML = loadingHtml('Memuat isi order…');
        let items;
        try {
          items = await getOrderItems(btn.dataset.id);
        } catch (error) {
          editBox.innerHTML = `<p class="error-text">${error.message ?? error}</p>`;
          return;
        }
        editBox.innerHTML = `
          <div class="inline-card fade-in" style="max-width:640px">
            <h4 style="margin:0 0 4px">Ubah Order ${esc(btn.dataset.code)}</h4>
            <p style="font-size:0.8rem;color:var(--color-text-muted);margin:0 0 10px">
              Daftar di bawah adalah isi order yang <strong>sudah ada</strong>${
                btn.dataset.pembuat ? ` (dibuat ${esc(btn.dataset.pembuat)})` : ''
              }.
              Tambahkan bahanmu ke daftar ini — jangan menghapus punya rekanmu.
              <br />Nomor order tetap sama, dan perubahan tercatat atas namamu beserta waktunya.
            </p>
            <div id="ord-edit-picker"></div>
            <div class="field" style="margin-top:12px"><label>Catatan (opsional)</label><input type="text" id="ord-edit-notes" /></div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <button class="primary" id="ord-edit-save" style="max-width:200px">Simpan Perubahan</button>
              <button id="ord-edit-cancel">Batal</button>
            </div>
            <p class="error-text" id="ord-edit-error"></p>
          </div>`;

        const editPicker = createItemPicker(editBox.querySelector('#ord-edit-picker'), {
          products: stockProducts,
          stockMap: state.stockMap,
          showStock: true,
          initial: items.map((it) => ({ product_id: it.product_id, qty: it.qty }))
        });

        editBox.querySelector('#ord-edit-cancel').addEventListener('click', () => {
          editBox.innerHTML = '';
        });

        editBox.querySelector('#ord-edit-save').addEventListener('click', async (e) => {
          const errorEl = editBox.querySelector('#ord-edit-error');
          errorEl.textContent = '';
          const newItems = editPicker.getItems();
          if (!newItems.length) {
            errorEl.textContent = 'Order harus berisi minimal satu produk.';
            return;
          }
          e.target.disabled = true;
          try {
            await updateStockOrder({ orderId: btn.dataset.id, items: newItems, notes: editBox.querySelector('#ord-edit-notes').value });
            toast('Order diperbarui.', 'success');
            showTab();
          } catch (error) {
            errorEl.textContent = error.message ?? 'Gagal menyimpan perubahan.';
            e.target.disabled = false;
          }
        });
      })
    );
  }

  // ---- Tab: Order Masuk (CK) ----
  async function renderIncomingOrders(box) {
    const orders = await listIncomingOrders([state.outletId]);
    if (!orders.length) {
      box.innerHTML = `<p style="color:var(--color-text-muted)">Tidak ada order menunggu diproses.</p>`;
      return;
    }

    // DRAFT IKUT DIMUAT DI SINI, DAN KEGAGALANNYA TIDAK DITELAN.
    //
    // Order yang sudah disiapkan jadi draft TETAP muncul di daftar ini —
    // `siapkan_order_jadi_draft` sengaja tidak menutup ordernya (0103 §6).
    // Tanpa penandaan, staff mengisi seluruh barisnya lalu baru ditolak server
    // di detik terakhir: penjagaannya benar, tapi pekerjaannya sudah terlanjur.
    //
    // Kalau daftar draftnya sendiri gagal dimuat, layar TIDAK boleh diam-diam
    // menganggap semuanya belum disiapkan — itu persis kebohongan yang sedang
    // diperbaiki. Keadaannya dinyatakan apa adanya di kepala daftar.
    let drafts = [];
    let gagalMemuatDraft = false;
    try {
      drafts = await listDraftKiriman([state.outletId]);
    } catch {
      gagalMemuatDraft = true;
    }
    const petaDraft = petaDraftPerOrder(drafts);
    const ringkas = ringkasOrder(orders, petaDraft, { gagalMemuatDraft });

    // Isi order hanya diambil untuk yang MASIH perlu dikerjakan. Order yang
    // sudah punya draft tidak menampilkan kotak isian sama sekali, jadi
    // memuat isinya cuma menambah panggilan jaringan tanpa ada yang membacanya.
    const perluIsi = orders.filter((o) => keadaanOrder(o, petaDraft, { gagalMemuatDraft }).mode !== 'sudah-draft');
    const isiPerOrder = new Map(
      (await Promise.all(perluIsi.map(async (o) => [o.id, await getOrderItems(o.id).catch(() => [])]))).map(([k, v]) => [k, v])
    );

    const kepala = gagalMemuatDraft
      ? `<p class="report-note" style="margin-bottom:12px">
           <strong>Status draft tidak bisa dicek</strong> — daftar draft surat jalan gagal dimuat.
           Order di bawah ditampilkan apa adanya, jadi bisa saja ada yang sebenarnya sudah disiapkan.
           Buka tab <strong>Draft Surat Jalan</strong> untuk memastikan sebelum menyiapkan ulang.
         </p>`
      : ringkas.sudah
        ? `<p class="report-note" style="margin-bottom:12px">
             <strong>${ringkas.belum} order</strong> perlu disiapkan.
             ${ringkas.sudah} lainnya <strong>sudah jadi draft surat jalan</strong> — ketuk untuk membuka draftnya, jangan disiapkan ulang.
           </p>`
        : '';

    box.innerHTML =
      kepala +
      orders
        .map((o) => {
          const keadaan = keadaanOrder(o, petaDraft, { gagalMemuatDraft });

          // ---- Order yang SUDAH jadi draft: tidak ada form sama sekali ----
          //
          // Bukan sekadar diberi label. Selama kotak isiannya masih ada,
          // mengisinya tetap terasa seperti pekerjaan yang wajar — dan
          // pekerjaan itu tetap berakhir ditolak. Satu-satunya jalan yang
          // ditawarkan kartu ini adalah jalan yang benar: buka draftnya.
          if (keadaan.mode === 'sudah-draft') {
            const d = keadaan.draft;
            return `
        <div class="inline-card ord-sudah-draft" style="max-width:620px" data-order="${o.id}">
          <div class="ord-judul">
            <strong>No. ${esc(o.code ?? o.id.slice(0, 6))}</strong> — dari ${esc(o.from_outlet?.name ?? '-')}
            <span class="badge badge-pending" style="margin-left:6px">SUDAH JADI DRAFT</span>
          </div>
          <div style="font-size:0.78rem;color:var(--color-text-muted);margin-top:2px">
            ${fmtDateTime(o.created_at)} · oleh ${esc(o.user_profiles?.full_name ?? '-')}${o.notes ? ' · ' + esc(o.notes) : ''}
          </div>
          <p style="font-size:0.82rem;margin:8px 0 0">
            Sudah disiapkan jadi <strong>${esc(d.code ?? 'draft surat jalan')}</strong>
            oleh ${esc(d.user_profiles?.full_name ?? '-')} · ${fmtDateTime(d.created_at)}.
            Stoknya <strong>belum bergerak</strong> — isinya masih bisa diubah di draftnya.
          </p>
          <button class="primary btn-buka-draft" data-draft="${d.id}" style="max-width:280px;margin-top:10px">
            Buka draft ${esc(d.code ?? '')} →
          </button>
        </div>`;
          }

          // ---- Order yang masih perlu dikerjakan ----
          const items = isiPerOrder.get(o.id) ?? [];
          return `
        <div class="inline-card" style="max-width:620px" data-order="${o.id}">
          <button class="ord-expand" style="border:none;background:none;cursor:pointer;text-align:left;width:100%;padding:0;font-size:0.92rem;color:var(--color-text)">
            <strong>No. ${esc(o.code ?? o.id.slice(0, 6))}</strong> — dari ${esc(o.from_outlet?.name ?? '-')}
            <div style="font-size:0.78rem;color:var(--color-text-muted)">${fmtDateTime(o.created_at)} · oleh ${esc(o.user_profiles?.full_name ?? '-')}${o.notes ? ' · ' + esc(o.notes) : ''} · ketuk untuk proses ▾</div>
          </button>
          <div class="ord-body" hidden style="margin-top:10px">
            <div class="table-scroll"><table class="data-table baris-sejajar">
              <thead><tr><th>Produk</th><th>Diminta</th><th>Stok CK</th><th>Dikirim</th></tr></thead>
              <tbody>
                ${items
                  .map((it) => {
                    const stok = state.stockMap.get(it.product_id) ?? 0;
                    return `<tr>
                      <td data-label="Produk">${esc(it.products?.name ?? '-')}</td>
                      <td data-label="Diminta">${formatNum(it.qty)} ${esc(it.products?.base_unit ?? '')}</td>
                      <td style="color:${stok < Number(it.qty) ? 'var(--color-danger)' : 'var(--color-text-muted)'}" data-label="Stok CK">${formatNum(stok)}</td>
                      <td data-label="Dikirim"><input type="number" class="ord-send-input isian-sempit" min="0" data-product="${it.product_id}" value="${round(it.qty)}" /></td>
                    </tr>`;
                  })
                  .join('')}
              </tbody>
            </table></div>
            <div class="field" style="margin-top:10px"><label>Catatan surat jalan (opsional)</label><input type="text" class="ord-sj-notes" /></div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <button class="primary btn-fulfill" data-id="${o.id}" style="max-width:280px">Siapkan &amp; Buat Draft SJ</button>
              <button class="btn-reject-order" data-id="${o.id}">Tolak Order</button>
            </div>
          </div>
        </div>`;
        })
        .join('');

    box.querySelectorAll('.ord-expand').forEach((btn) =>
      btn.addEventListener('click', () => {
        const body = btn.parentElement.querySelector('.ord-body');
        body.hidden = !body.hidden;
      })
    );

    // Ketuk order yang sudah jadi draft -> langsung ke draftnya, terbuka.
    box.querySelectorAll('.btn-buka-draft').forEach((btn) =>
      btn.addEventListener('click', () => {
        // Nomor draftnya dititipkan ke `state`, bukan dicari ulang di tab
        // sebelah. Tab Draft bisa berisi belasan draft, dan mendarat di daftar
        // panjang tanpa penunjuk hanya memindahkan pekerjaan mencari — bukan
        // menghapusnya.
        state.fokusDraft = btn.dataset.draft;
        state.tab = 'drafts';
        buildTabs();
      })
    );

    box.querySelectorAll('.btn-fulfill').forEach((btn) =>
      btn.addEventListener('click', async () => {
        const card = btn.closest('[data-order]');
        const items = [...card.querySelectorAll('.ord-send-input')]
          .map((el) => ({ product_id: el.dataset.product, qty: Number(el.value) }))
          .filter((i) => i.qty > 0);
        if (!items.length) {
          toast('Isi jumlah yang dikirim minimal satu produk.', 'warning');
          return;
        }
        btn.disabled = true;
        try {
          // Nomor draftnya dipakai, bukan dibuang: sesudah menyiapkan, yang
          // ingin dilihat orang adalah draft yang BARU SAJA ia buat — bukan
          // daftar draft yang harus ditelusuri lagi dari atas.
          const draftBaru = await siapkanOrderJadiDraft({
            orderId: btn.dataset.id,
            items,
            notes: card.querySelector('.ord-sj-notes').value
          });
          state.fokusDraft = draftBaru ?? null;
          // TIDAK ada PDF & tidak ada share di sini. Draft belum berangkat, dan
          // surat jalan yang sudah tercetak untuk barang yang masih di rak CK
          // adalah dokumen yang menyesatkan siapa pun yang memegangnya.
          toast('Draft surat jalan dibuat. Buka tab Draft untuk memeriksa & mengirimnya.', 'success');
          state.tab = 'drafts';
          buildTabs();
          renderIncoming();
        } catch (error) {
          toast(error.message ?? 'Gagal menyiapkan order.', 'error');
          btn.disabled = false;
        }
      })
    );

    box.querySelectorAll('.btn-reject-order').forEach((btn) =>
      btn.addEventListener('click', async () => {
        const values = await formDialog({
          title: 'Tolak Order',
          description: 'Beri alasan supaya outlet pemesan tahu.',
          fields: [{ name: 'reason', label: 'Alasan', type: 'text', required: true, placeholder: 'mis. stok bahan habis' }],
          submitText: 'Tolak Order'
        });
        if (!values) return;
        try {
          await rejectStockOrder(btn.dataset.id, values.reason);
          toast('Order ditolak.', 'success');
          showTab();
        } catch (error) {
          toast(error.message ?? 'Gagal menolak order.', 'error');
        }
      })
    );
  }

  // ---- Tab: Kirim ke Outlet (CK) / Transfer & Retur (outlet) ----
  async function renderSend(box) {
    const fromOutlet = outletsById.get(state.outletId);
    const isCK = fromOutlet?.outlet_role === 'central_kitchen';
    const showJenis = !isCK;

    const destOptions = (jenis) => {
      if (isCK) return allOutlets.filter((o) => o.id !== fromOutlet.id);
      if (jenis === 'retur') return ckOutlets.filter((o) => o.id !== fromOutlet.id);
      return allOutlets.filter((o) => o.id !== fromOutlet.id && o.outlet_role !== 'central_kitchen');
    };

    box.innerHTML = `
      <div class="inline-card" style="max-width:640px">
        <h3 style="margin-top:0">${isCK ? 'Kirim ke Outlet' : 'Transfer / Retur Stok'}
          <span style="font-size:0.8rem;color:var(--color-text-muted)">dari ${esc(fromOutlet?.name ?? '')}</span>
        </h3>
        ${showJenis ? `<div class="field"><label>Jenis</label><select id="disp-jenis"><option value="transfer">Transfer antar Outlet</option><option value="retur">Retur ke Central Kitchen</option></select></div>` : ''}
        <div class="field"><label>Ke outlet</label><select id="disp-to"></select></div>
        <div id="disp-picker"></div>
        <div class="field" style="margin-top:12px"><label>Catatan (opsional)</label><input type="text" id="disp-notes" /></div>
        <button class="primary" id="disp-send-btn">Kirim &amp; Buat Surat Jalan</button>
        <p class="error-text" id="disp-error"></p>
      </div>`;

    const toSel = box.querySelector('#disp-to');
    const jenisSel = box.querySelector('#disp-jenis');
    const fillDest = () => {
      const list = destOptions(jenisSel?.value);
      toSel.innerHTML = list.map((o) => `<option value="${o.id}">${esc(o.name)}</option>`).join('') || '<option value="">-- tidak ada tujuan --</option>';
    };
    fillDest();
    jenisSel?.addEventListener('change', fillDest);

    const picker = createItemPicker(box.querySelector('#disp-picker'), {
      products: stockProducts,
      stockMap: state.stockMap,
      showStock: true,
      // Layar ini MENGIRIM dari outlet yang sedang dibuka, jadi `stockMap`
      // memang stok pengirimnya — "melebihi stok" berarti barangnya tidak ada.
      peringatanKurang: true
    });

    box.querySelector('#disp-send-btn').addEventListener('click', async (e) => {
      const errorEl = box.querySelector('#disp-error');
      errorEl.textContent = '';
      const to = toSel.value;
      if (!to) {
        errorEl.textContent = 'Pilih outlet tujuan.';
        return;
      }
      const items = picker.getItems();
      if (!items.length) {
        errorEl.textContent = 'Tambahkan minimal satu produk dengan jumlah.';
        return;
      }
      e.target.disabled = true;
      try {
        await buatDraftKiriman({ fromOutlet: state.outletId, toOutlet: to, items, notes: box.querySelector('#disp-notes').value });
        toast('Draft surat jalan dibuat. Periksa isinya, lalu tekan “Kirim sekarang”.', 'success');
        state.tab = 'drafts';
        buildTabs();
      } catch (error) {
        errorEl.textContent = error.message ?? 'Gagal membuat draft.';
        e.target.disabled = false;
      }
    });
  }

  // ---- Tab: Draft Surat Jalan (CK) ----

  /**
   * Draft = barang yang sudah disiapkan tapi BELUM berangkat.
   *
   * Inti perubahan 0103 ada di layar ini: menyiapkan H-1 tidak lagi memotong
   * stok CK semalaman untuk barang yang masih di rak. Stok baru bergeser saat
   * outlet mengonfirmasi terima.
   */
  async function renderDrafts(box) {
    // KATA-KATANYA HARUS TAHU SIAPA YANG SEDANG MEMBACA.
    //
    // Layar ini dulu hanya ada di sisi CK, jadi teksnya menyebut "stok CK" dan
    // menunjuk tab "Kirim ke Outlet" yang tidak ada di sisi outlet. Kalimat
    // yang menyebut tempat yang tidak ada bukan sekadar janggal — ia membuat
    // orang mencari-cari, lalu menyimpulkan aplikasinya rusak.
    const outlet = outletsById.get(state.outletId);
    const isCK = outlet?.outlet_role === 'central_kitchen';
    const namaAsal = outlet?.name ?? 'outlet ini';
    const asalnya = isCK ? 'Order Masuk' : 'Transfer / Retur';

    // Penanda diambil & DIBUANG DI SINI, sebelum satu pun jalan keluar di
    // bawah. Kalau pembuangannya ditaruh di akhir, tiap `return` lebih awal
    // (daftar kosong, gagal memuat) meninggalkan penandanya menempel — dan
    // draft yang sama akan memaksa dirinya terbuka pada penggambaran
    // berikutnya, termasuk sesudah draft itu dikirim atau dihapus.
    const fokus = state.fokusDraft;
    state.fokusDraft = null;

    let drafts;
    try {
      drafts = await listDraftKiriman([state.outletId]);
    } catch (error) {
      box.innerHTML = `<p class="error-text">${esc(error.message ?? error)}</p>`;
      return;
    }

    if (!drafts.length) {
      box.innerHTML = `
        <p class="report-note">
          Belum ada draft surat jalan dari <strong>${esc(namaAsal)}</strong>.
          <br /><br />
          Draft dibuat dari tab <strong>${esc(asalnya)}</strong>${
            isCK ? ' (tombol “Siapkan &amp; Buat Draft SJ”) atau <strong>Kirim ke Outlet</strong>' : ''
          }. Gunanya menyiapkan barang lebih dulu: nomor SJ sudah ada dan bisa ditempel ke keranjang, tapi
          <strong>stok belum bergerak sama sekali</strong>.
        </p>`;
      return;
    }

    box.innerHTML = `
      <p class="report-note" style="margin-bottom:12px">
        <strong>${drafts.length} draft</strong> menunggu dikirim dari <strong>${esc(namaAsal)}</strong>.
        Selama masih draft, <strong>stoknya belum berkurang</strong> — isinya masih bisa diperiksa & diubah.
        <br /><br />
        Stok baru bergeser saat outlet tujuan <strong>mengonfirmasi terima</strong>: stok ${esc(namaAsal)} berkurang
        sebesar yang dikirim, stok outlet tujuan bertambah sebesar yang diterima.
      </p>
      ${drafts
        .map(
          (d) => `
        <div class="inline-card" style="margin-bottom:12px" data-draft="${d.id}">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
            <div>
              <strong>${esc(d.code ?? '(tanpa nomor)')}</strong>
              <span class="badge badge-pending" style="margin-left:6px">DRAFT</span>
              <div style="font-size:0.8rem;color:var(--color-text-muted)">
                → ${esc(d.to_outlet?.name ?? '-')} · disiapkan ${esc(d.user_profiles?.full_name ?? '-')}
                · ${new Date(d.created_at).toLocaleString('id-ID')}
                ${d.stock_order_id ? ' · dari order' : ''}
              </div>
            </div>
            <button class="drf-toggle" data-id="${d.id}">Lihat isi</button>
          </div>
          ${d.notes ? `<p style="font-size:0.82rem;margin:8px 0 0">${esc(d.notes)}</p>` : ''}
          <div class="drf-body" data-id="${d.id}" hidden style="margin-top:10px"></div>
        </div>`
        )
        .join('')}`;

    box.querySelectorAll('.drf-toggle').forEach((btn) =>
      btn.addEventListener('click', async () => {
        const body = box.querySelector(`.drf-body[data-id="${btn.dataset.id}"]`);
        if (!body.hidden) {
          body.hidden = true;
          btn.textContent = 'Lihat isi';
          return;
        }
        body.hidden = false;
        btn.textContent = 'Tutup';
        await gambarIsiDraft(body, drafts.find((d) => d.id === btn.dataset.id));
      })
    );

    // DRAFT YANG DITUJU DARI TAB ORDER MASUK LANGSUNG DIBUKA.
    //
    // Tanpa ini, "buka draftnya" hanya memindahkan orang ke daftar panjang dan
    // menyuruhnya mencari nomor yang tadi tertulis di kartu order. Itu masih
    // pekerjaan sia-sia, cuma bentuknya berubah.
    //
    // Penandanya sudah dibuang di awal fungsi ini — lihat alasannya di sana.
    if (fokus) {
      const tombol = box.querySelector(`.drf-toggle[data-id="${fokus}"]`);
      if (tombol) {
        tombol.click();
        tombol.closest('[data-draft]')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else {
        // Draftnya tidak ada di daftar — kemungkinan besar sudah dikirim orang
        // lain sementara layar ini masih memegang nomornya. Dikatakan, bukan
        // didiamkan: daftar yang terbuka tanpa penjelasan terbaca sebagai
        // tombol yang tidak berfungsi.
        toast('Draft itu sudah tidak ada di daftar — mungkin baru saja dikirim. Periksa Riwayat & Dokumen.', 'info');
      }
    }
  }

  /** Isi satu draft: bisa diperiksa, diubah jumlahnya, lalu dikirim atau dihapus. */
  async function gambarIsiDraft(body, draft) {
    body.innerHTML = loadingHtml('Memuat isi draft…', { baris: 3 });
    let items;
    try {
      items = await getDispatchItems(draft.id);
    } catch (error) {
      body.innerHTML = `<p class="error-text">${esc(error.message ?? error)}</p>`;
      return;
    }

    // BARANG YANG DIMINTA OUTLET, kalau draft ini memang lahir dari sebuah order.
    //
    // Dipakai untuk MENANDAI mana yang tambahan dari CK — bukan untuk membatasi.
    // Outlet penerima perlu tahu bahwa sekarung tepung yang datang itu bukan
    // permintaannya, supaya ia tidak mengira ordernya salah dicatat.
    let diminta = new Set();
    if (draft.stock_order_id) {
      try {
        diminta = new Set((await getOrderItems(draft.stock_order_id)).map((it) => it.product_id));
      } catch {
        // Gagal memuat daftar permintaan TIDAK boleh menggagalkan penyuntingan
        // draftnya. Yang hilang cuma penandaan; isinya tetap bisa diubah.
        diminta = new Set();
      }
    }

    const namaAsal = outletsById.get(state.outletId)?.name ?? 'asal';

    body.innerHTML = `
      <div class="drf-picker"></div>

      <div class="field" style="margin:10px 0 0">
        <label style="font-size:0.72rem">Catatan surat jalan</label>
        <input type="text" class="drf-notes" value="${esc(draft.notes ?? '')}" />
      </div>

      <p class="report-note" style="margin-top:10px">
        Tekan <strong>+ Tambah Produk</strong> untuk mengirim barang <strong>di luar</strong> yang diminta outlet —
        stok titipan, barang promo, atau pengganti yang kosong.
        <br /><br />
        Angka bertanda <strong>⚠</strong> melebihi stok ${esc(namaAsal)} saat ini. Kiriman tetap bisa dibuat —
        sistem ini memang mengizinkan stok menembus nol — tapi selisihnya akan muncul di opname.
      </p>

      ${
        diminta.size
          ? `<div class="drf-ringkas-diminta">
               <strong>Permintaan outlet:</strong>
               ${[...diminta]
                 .map((id) => esc(stockProducts.find((p) => p.id === id)?.name ?? '?'))
                 .join(' · ')}
             </div>`
          : ''
      }

      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
        <button class="drf-save" data-id="${draft.id}">Simpan perubahan</button>
        <button class="primary drf-send" data-id="${draft.id}">🚚 Kirim sekarang</button>
        <button class="drf-del" data-id="${draft.id}">Hapus draft</button>
      </div>`;

    // PICKER, BUKAN TABEL TETAP.
    //
    // Tabel sebelumnya digambar dari isi draft yang sudah ada, jadi hanya baris
    // yang SUDAH di sana yang bisa disentuh — tidak ada cara menambah produk
    // baru. Padahal `ubah_draft_kiriman()` sejak 0103 memang mengganti SELURUH
    // daftar isinya: databasenya tidak pernah membatasi ke barang yang diorder.
    // Yang membatasi cuma layarnya.
    const picker = createItemPicker(body.querySelector('.drf-picker'), {
      products: stockProducts,
      stockMap: state.stockMap,
      showStock: true,
      // Di sini `stockMap` adalah stok outlet PENGIRIM, jadi "melebihi stok"
      // memang berarti barangnya tidak ada di rak. Bandingkan dengan layar
      // Order ke CK, yang sengaja TIDAK menyalakan ini.
      peringatanKurang: true,
      initial: items.map((i) => ({ product_id: i.product_id, qty: i.sent_qty }))
    });

    const ambilItem = () => picker.getItems();

    body.querySelector('.drf-save').addEventListener('click', sekaliJalan(async () => {
      const daftar = ambilItem();
      if (!daftar.length) {
        // Diarahkan ke Hapus, bukan disimpan kosong. Draft kosong tetap memakai
        // satu nomor SJ dan muncul di daftar tanpa isi.
        toast('Isi minimal satu barang. Kalau memang batal, pakai Hapus draft.', 'warning');
        return;
      }
      try {
        await ubahDraftKiriman({ dispatchId: draft.id, items: daftar, notes: body.querySelector('.drf-notes').value });
        toast('Draft diperbarui. Stok masih belum bergerak.', 'success');
        showTab();
      } catch (error) {
        toast(error.message ?? 'Gagal menyimpan draft.', 'error');
      }
    }));

    body.querySelector('.drf-send').addEventListener('click', sekaliJalan(async () => {
      const daftar = ambilItem();
      if (!daftar.length) return toast('Draft kosong, tidak ada yang bisa dikirim.', 'warning');

      const ok = await confirmDialog({
        title: `Kirim ${draft.code ?? 'surat jalan'}?`,
        message:
          `${daftar.length} barang ke ${draft.to_outlet?.name ?? 'outlet tujuan'}.\n\n` +
          'Barang berangkat sekarang. Stok baru bergeser saat outlet tujuan mengonfirmasi terima.',
        confirmText: 'Ya, kirim'
      });
      if (!ok) return;

      try {
        // Perubahan yang belum disimpan ikut dikirim. Tanpa ini, angka yang
        // baru saja diperbaiki di layar akan berangkat dengan jumlah lama —
        // dan tidak ada yang menyadarinya sampai barangnya sampai.
        await ubahDraftKiriman({ dispatchId: draft.id, items: daftar, notes: body.querySelector('.drf-notes').value });
        await kirimDraftKiriman(draft.id);

        // PDF baru dicetak SEKARANG, saat barangnya benar-benar berangkat.
        const { code, waText } = await emitSuratJalan(draft.id, { showReceived: false, title: 'SURAT JALAN' });
        toast(`Surat jalan ${code ?? ''} dikirim. Menunggu konfirmasi outlet tujuan.`, 'success');
        showTab();
        renderIncoming();
        await shareDialog({
          title: `Surat Jalan ${code ?? ''}`,
          helper: 'PDF sudah terunduh. Kirim info via WhatsApp (lampirkan file PDF-nya manual).',
          defaultMessage: waText
        });
      } catch (error) {
        toast(error.message ?? 'Gagal mengirim draft.', 'error');
      }
    }));

    body.querySelector('.drf-del').addEventListener('click', sekaliJalan(async () => {
      const ok = await confirmDialog({
        title: `Hapus draft ${draft.code ?? ''}?`,
        message: 'Draft ini hilang permanen. Tidak ada stok yang terpengaruh karena memang belum bergerak.'
          + (draft.stock_order_id ? '\n\nOrder yang menjadi asalnya kembali menunggu, dan bisa disiapkan ulang.' : ''),
        confirmText: 'Hapus draft',
        danger: true
      });
      if (!ok) return;
      try {
        await hapusDraftKiriman(draft.id);
        toast('Draft dihapus.', 'success');
        showTab();
      } catch (error) {
        toast(error.message ?? 'Gagal menghapus draft.', 'error');
      }
    }));
  }

  // ---- Kiriman Masuk (di luar tab, disorot di atas) ----
  async function renderIncoming() {
    const box = container.querySelector('#disp-incoming-box');
    if (!box) return;
    let incoming;
    try {
      incoming = await listIncomingDispatches([state.outletId]);
    } catch (error) {
      box.innerHTML = `<p class="error-text">${error.message ?? error}</p>`;
      return;
    }
    const header = (count) => `
      <div class="incoming-head">
        <h2>📦 Kiriman Masuk${count ? ` <span class="incoming-count">${count}</span>` : ''}</h2>
        <button id="disp-refresh">⟳ Refresh</button>
      </div>`;

    if (!incoming.length) {
      box.classList.remove('has-items');
      box.innerHTML = `${header(0)}<p class="incoming-empty">Tidak ada kiriman yang menunggu diterima.</p>`;
      box.querySelector('#disp-refresh').addEventListener('click', renderIncoming);
      return;
    }
    box.classList.add('has-items');
    const itemsByDispatch = await Promise.all(incoming.map((d) => getDispatchItems(d.id).catch(() => [])));

    box.innerHTML =
      header(incoming.length) +
      incoming
        .map((d, idx) => {
          const items = itemsByDispatch[idx];
          return `
        <div class="inline-card" style="max-width:560px" data-dispatch="${d.id}">
          <button class="disp-expand" style="border:none;background:none;cursor:pointer;text-align:left;width:100%;padding:0;font-size:0.92rem;color:var(--color-text)">
            <strong>No. ${esc(d.code ?? d.id.slice(0, 6))}</strong> — dari ${esc(d.from_outlet?.name ?? '-')}
            <div style="font-size:0.78rem;color:var(--color-text-muted)">${fmtDateTime(d.created_at)} · oleh ${esc(d.user_profiles?.full_name ?? '-')} · ketuk untuk terima ▾</div>
          </button>
          <div class="recv-body" hidden style="margin-top:10px">
            <div class="table-scroll"><table class="data-table baris-sejajar">
              <thead><tr><th>Produk</th><th>Dikirim</th><th>Diterima</th></tr></thead>
              <tbody>
                ${items
                  .map(
                    (it) => `<tr>
                      <td data-label="Produk">${esc(it.products?.name ?? '-')}</td>
                      <td data-label="Dikirim">${formatNum(it.sent_qty)} ${esc(it.products?.base_unit ?? '')}</td>
                      <td data-label="Diterima"><input type="number" class="recv-input isian-sempit" min="0" data-item="${it.id}" value="${round(it.sent_qty)}" /></td>
                    </tr>`
                  )
                  .join('')}
              </tbody>
            </table></div>
            <button class="primary btn-save-receive" data-id="${d.id}" style="margin-top:10px;max-width:220px">Simpan (Terima)</button>
          </div>
        </div>`;
        })
        .join('');

    box.querySelector('#disp-refresh').addEventListener('click', renderIncoming);
    box.querySelectorAll('.disp-expand').forEach((btn) =>
      btn.addEventListener('click', () => {
        const body = btn.parentElement.querySelector('.recv-body');
        body.hidden = !body.hidden;
      })
    );

    box.querySelectorAll('.btn-save-receive').forEach((btn) =>
      btn.addEventListener('click', async () => {
        const card = btn.closest('[data-dispatch]');
        const items = [...card.querySelectorAll('.recv-input')].map((el) => ({ item_id: el.dataset.item, received_qty: Number(el.value) }));
        btn.disabled = true;
        try {
          const hasil = await receiveDispatch(btn.dataset.id, items);
          const { code, waText } = await emitSuratJalan(btn.dataset.id, { showReceived: true, title: 'BUKTI TERIMA' });

          // PENGIRIMNYA DISEBUT NAMANYA, bukan diasumsikan CK.
          //
          // Sejak transfer antar outlet dan retur ke CK dipakai, "Stok CK
          // berkurang" bisa keliru dua arah sekaligus: pada retur, yang
          // berkurang justru stok outlet, dan yang bertambah stok CK. Kalimat
          // yang salah arah di layar konfirmasi adalah cara tercepat membuat
          // orang berhenti percaya pada angkanya.
          const asal = incoming.find((d) => d.id === btn.dataset.id)?.from_outlet?.name ?? 'outlet asal';

          // SUSUT DISEBUT ANGKANYA, bukan didiamkan. Selisih kirim-vs-terima yang
          // tidak pernah dikatakan akan ditemukan berminggu-minggu kemudian
          // sebagai angka opname yang tidak bisa dijelaskan siapa pun.
          toast(
            Number(hasil?.susut) > 0
              ? `Surat jalan ${code ?? ''} diterima. Stok ${asal} berkurang & stok di sini bertambah — ${formatNum(hasil.susut)} susut di perjalanan.`
              : `Surat jalan ${code ?? ''} diterima. Stok ${asal} berkurang & stok di sini bertambah.`,
            Number(hasil?.susut) > 0 ? 'warning' : 'success'
          );
          await loadStock();
          renderIncoming();
          showTab();
          await shareDialog({ title: `Bukti Terima ${code ?? ''}`, helper: 'PDF sudah terunduh. Kirim info via WhatsApp (lampirkan file PDF-nya manual).', defaultMessage: waText });
        } catch (error) {
          toast(error.message ?? 'Gagal konfirmasi.', 'error');
          btn.disabled = false;
        }
      })
    );
  }

  async function emitSuratJalan(dispatchId, { showReceived, title }) {
    const { header, items } = await getDispatchForPdf(dispatchId);
    const data = {
      code: header.code,
      title,
      fromName: header.from_outlet?.name ?? '-',
      toName: header.to_outlet?.name ?? '-',
      dateStr: new Date(header.created_at).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }),
      notes: header.notes,
      showReceived,
      items: items.map((it) => ({ name: it.products?.name, unit: it.products?.base_unit, sent: it.sent_qty, received: it.received_qty }))
    };
    try {
      await buildSuratJalanPDF(data);
    } catch (error) {
      toast(error.message ?? 'Gagal membuat PDF.', 'error');
    }
    return { code: header.code, waText: suratJalanWaText(data) };
  }

  await loadStock();
  buildTabs();
  renderIncoming();

  // Auto-refresh tab "masuk" tiap 15 detik, dilewati bila ada tabel yang sedang diisi.
  const pollTimer = setInterval(() => {
    if (!document.body.contains(container)) {
      clearInterval(pollTimer);
      return;
    }
    if (container.querySelector('.recv-body:not([hidden])') || container.querySelector('.ord-body:not([hidden])')) return;
    renderIncoming();
    if (state.tab === 'orders-in') showTab();
  }, 15000);
}

function round(n) {
  return Math.round(Number(n) * 100) / 100;
}
function fmtDateTime(iso) {
  return new Date(iso).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
