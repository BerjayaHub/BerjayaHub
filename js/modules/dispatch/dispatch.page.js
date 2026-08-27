import { listAttendanceOutlets } from '../attendance/attendance.service.js';
import { toast, shareDialog, formDialog, confirmDialog } from '../../core/ui.js';
import { formatNum } from '../../core/format.js';
import { listProducts } from '../product/product.service.js';
import { getOutletStockMap } from '../inventory/inventory.service.js';
import { createItemPicker } from './item-picker.js';
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
  createStockOrder,
  updateStockOrder,
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

const ORDER_BADGE = { open: 'badge-pending', fulfilled: 'badge-approved', rejected: 'badge-rejected', cancelled: 'badge-cancelled' };

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
  const state = { outletId: myOutlets.some((o) => o.id === outletId) ? outletId : myOutlets[0].id, tab: null, stockMap: new Map() };

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
          riwayat
        ];
  }

  function buildTabs() {
    const tabs = tabsFor();
    if (!tabs.some((t) => t.key === state.tab)) state.tab = tabs[0].key;
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
               <div id="ord-picker"></div>
               <div class="field" style="margin-top:12px"><label>Catatan (opsional)</label><input type="text" id="ord-notes" /></div>
               <button class="primary" id="ord-send" style="max-width:220px">Kirim Order</button>
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
                       <td style="font-size:0.78rem" data-label="Keterangan">${
                         o.edited_at
                           ? `<span class="badge badge-pending">✎</span> Diedit oleh ${esc(o.editor?.full_name ?? 'staff')} · ${fmtDateTime(o.edited_at)}`
                           : '<span style="color:var(--color-text-muted)">-</span>'
                       }</td>
                       <td data-label="Aksi">${
                         o.status === 'open'
                           ? `<button class="btn-edit-order" data-id="${o.id}" data-code="${esc(o.code ?? '')}">Edit</button>
                              <button class="btn-cancel-order" data-id="${o.id}">Batalkan</button>`
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
      const picker = createItemPicker(box.querySelector('#ord-picker'), {
        products: stockProducts,
        stockMap: state.stockMap,
        showStock: true
      });
      box.querySelector('#ord-send').addEventListener('click', async (e) => {
        const errorEl = box.querySelector('#ord-error');
        errorEl.textContent = '';
        const toOutlet = servedCk ? servedCk.id : box.querySelector('#ord-to')?.value;
        if (!toOutlet) {
          errorEl.textContent = 'Pilih Central Kitchen tujuan.';
          return;
        }
        const items = picker.getItems();
        if (!items.length) {
          errorEl.textContent = 'Tambahkan minimal satu produk dengan jumlah.';
          return;
        }
        e.target.disabled = true;
        try {
          await createStockOrder({ fromOutlet: state.outletId, toOutlet, items, notes: box.querySelector('#ord-notes').value });
          toast('Order terkirim ke Central Kitchen.', 'success');
          showTab();
        } catch (error) {
          errorEl.textContent = error.message ?? 'Gagal membuat order.';
          e.target.disabled = false;
        }
      });
    }

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
              Nomor order tetap sama. Perubahan tercatat atas namamu beserta waktunya.
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
    const itemsByOrder = await Promise.all(orders.map((o) => getOrderItems(o.id).catch(() => [])));

    box.innerHTML = orders
      .map((o, idx) => {
        const items = itemsByOrder[idx];
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
          await siapkanOrderJadiDraft({ orderId: btn.dataset.id, items, notes: card.querySelector('.ord-sj-notes').value });
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
      showStock: true
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
        toast('Draft surat jalan dibuat. Periksa lalu kirim dari tab Draft.', 'success');
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
          Belum ada draft surat jalan.
          <br /><br />
          Draft dibuat dari <strong>Order Masuk</strong> (tombol “Siapkan &amp; Buat Draft SJ”) atau dari
          <strong>Kirim ke Outlet</strong>. Gunanya untuk menyiapkan barang H-1: nomor SJ sudah ada dan bisa
          ditempel ke keranjang, tapi <strong>stok belum bergerak sama sekali</strong>.
        </p>`;
      return;
    }

    box.innerHTML = `
      <p class="report-note" style="margin-bottom:12px">
        <strong>${drafts.length} draft</strong> menunggu dikirim.
        Selama masih draft, <strong>stok CK belum berkurang</strong> — isinya masih bisa diperiksa & diubah.
        <br /><br />
        Stok baru bergeser saat outlet tujuan <strong>mengonfirmasi terima</strong>: stok CK berkurang sebesar yang
        dikirim, stok outlet bertambah sebesar yang diterima.
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

    body.innerHTML = `
      <div class="table-scroll">
        <table class="data-table baris-sejajar">
          <thead><tr><th>Barang</th><th>Stok CK</th><th>Jumlah kirim</th></tr></thead>
          <tbody>
            ${items
              .map((i) => {
                const stok = state.stockMap.get(i.product_id);
                // Stok CK ditampilkan di sebelah jumlah kirim supaya kekurangan
                // ketahuan SEKARANG, saat masih draft — bukan besok saat
                // barangnya ternyata tidak ada di rak.
                const kurang = stok != null && Number(stok) < Number(i.sent_qty);
                return `<tr>
                  <td data-label="Barang">${esc(i.products?.name ?? '-')}</td>
                  <td data-label="Stok CK" style="text-align:right${kurang ? ';color:var(--color-danger)' : ''}">
                    ${stok == null ? '-' : formatNum(stok)}${kurang ? ' ⚠' : ''}
                  </td>
                  <td data-label="Jumlah kirim">
                    <input type="number" class="drf-qty isian-sempit" data-product="${i.product_id}" min="0" step="any"
                      inputmode="decimal" value="${i.sent_qty}" />
                    <span style="font-size:0.75rem;color:var(--color-text-muted)">${esc(i.products?.base_unit ?? '')}</span>
                  </td>
                </tr>`;
              })
              .join('')}
          </tbody>
        </table>
      </div>

      <div class="field" style="margin:10px 0 0">
        <label style="font-size:0.72rem">Catatan surat jalan</label>
        <input type="text" class="drf-notes" value="${esc(draft.notes ?? '')}" />
      </div>

      <p class="report-note" style="margin-top:10px">
        Angka bertanda <strong>⚠</strong> melebihi stok CK saat ini. Kiriman tetap bisa dibuat — sistem ini
        memang mengizinkan stok menembus nol — tapi selisihnya akan muncul di opname.
      </p>

      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
        <button class="drf-save" data-id="${draft.id}">Simpan perubahan</button>
        <button class="primary drf-send" data-id="${draft.id}">🚚 Kirim sekarang</button>
        <button class="drf-del" data-id="${draft.id}">Hapus draft</button>
      </div>`;

    const ambilItem = () =>
      [...body.querySelectorAll('.drf-qty')]
        .map((el) => ({ product_id: el.dataset.product, qty: Number(el.value) }))
        .filter((i) => i.qty > 0);

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
          // SUSUT DISEBUT ANGKANYA, bukan didiamkan. Selisih kirim-vs-terima yang
          // tidak pernah dikatakan akan ditemukan berminggu-minggu kemudian
          // sebagai angka opname yang tidak bisa dijelaskan siapa pun.
          toast(
            Number(hasil?.susut) > 0
              ? `Surat jalan ${code ?? ''} diterima. Stok CK berkurang & stok outlet bertambah — ${formatNum(hasil.susut)} susut di perjalanan.`
              : `Surat jalan ${code ?? ''} diterima. Stok CK berkurang & stok outlet bertambah.`,
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
