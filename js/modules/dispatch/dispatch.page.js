import { toast, shareDialog, formDialog, confirmDialog } from '../../core/ui.js';
import { formatNum } from '../../core/format.js';
import { listAttendanceOutlets } from '../attendance/attendance.service.js';
import { listProducts } from '../product/product.service.js';
import { getOutletStockMap } from '../inventory/inventory.service.js';
import { createItemPicker } from './item-picker.js';
import {
  createDispatch,
  receiveDispatch,
  listIncomingDispatches,
  getDispatchItems,
  getDispatchForPdf,
  getMyScopedOutlets,
  ORDER_STATUS,
  createStockOrder,
  fulfillStockOrder,
  rejectStockOrder,
  cancelStockOrder,
  listIncomingOrders,
  listMyOrders,
  getOrderItems
} from './dispatch.service.js';
import { buildSuratJalanPDF, suratJalanWaText } from './dispatch-pdf.js';

const ORDER_BADGE = { open: 'badge-pending', fulfilled: 'badge-approved', rejected: 'badge-rejected', cancelled: 'badge-cancelled' };

export async function renderDispatchPage(container, { businessUnitId, outletId }) {
  container.innerHTML = `<p style="color:var(--color-text-muted)">Memuat pengiriman...</p>`;

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
  const myOutlets = await getMyScopedOutlets(businessUnitId, allOutlets);
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
    return isCK
      ? [
          { key: 'orders-in', label: '📥 Order Masuk', render: renderIncomingOrders },
          { key: 'send', label: '🚚 Kirim ke Outlet', render: renderSend }
        ]
      : [
          { key: 'order', label: '🧾 Order ke CK', render: renderOrderTab },
          { key: 'transfer', label: '🔁 Transfer / Retur', render: renderSend }
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
    contentBox.innerHTML = `<p style="color:var(--color-text-muted)">Memuat...</p>`;
    try {
      await tab.render(contentBox);
    } catch (error) {
      contentBox.innerHTML = `<p class="error-text">${error?.message ?? error}</p>`;
    }
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
             <table class="data-table">
               <thead><tr><th>No. Order</th><th>Ke</th><th>Waktu</th><th>Status</th><th></th></tr></thead>
               <tbody>
                 ${myOrders
                   .map(
                     (o) => `<tr>
                       <td>${esc(o.code ?? o.id.slice(0, 6))}</td>
                       <td>${esc(o.to_outlet?.name ?? '-')}</td>
                       <td style="font-size:0.8rem">${fmtDateTime(o.created_at)}</td>
                       <td><span class="badge ${ORDER_BADGE[o.status] ?? ''}">${ORDER_STATUS[o.status] ?? o.status}</span>
                         ${o.status === 'rejected' && o.reject_reason ? `<div style="font-size:0.74rem;color:var(--color-danger)">${esc(o.reject_reason)}</div>` : ''}</td>
                       <td>${o.status === 'open' ? `<button class="btn-cancel-order" data-id="${o.id}">Batalkan</button>` : ''}</td>
                     </tr>`
                   )
                   .join('')}
               </tbody>
             </table>`
          : ''
      }
    `;

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
            <table class="data-table">
              <thead><tr><th>Produk</th><th>Diminta</th><th>Stok CK</th><th>Dikirim</th></tr></thead>
              <tbody>
                ${items
                  .map((it) => {
                    const stok = state.stockMap.get(it.product_id) ?? 0;
                    return `<tr>
                      <td>${esc(it.products?.name ?? '-')}</td>
                      <td>${formatNum(it.qty)} ${esc(it.products?.base_unit ?? '')}</td>
                      <td style="color:${stok < Number(it.qty) ? 'var(--color-danger)' : 'var(--color-text-muted)'}">${formatNum(stok)}</td>
                      <td><input type="number" class="ord-send-input" min="0" data-product="${it.product_id}" value="${round(it.qty)}" style="max-width:110px" /></td>
                    </tr>`;
                  })
                  .join('')}
              </tbody>
            </table>
            <div class="field" style="margin-top:10px"><label>Catatan surat jalan (opsional)</label><input type="text" class="ord-sj-notes" /></div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <button class="primary btn-fulfill" data-id="${o.id}" style="max-width:250px">Kirim &amp; Buat Surat Jalan</button>
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
          const dispatchId = await fulfillStockOrder({ orderId: btn.dataset.id, items, notes: card.querySelector('.ord-sj-notes').value });
          const { code, waText } = await emitSuratJalan(dispatchId, { showReceived: false, title: 'SURAT JALAN' });
          toast(`Surat jalan ${code ?? ''} dibuat dari order.`, 'success');
          await loadStock();
          showTab();
          renderIncoming();
          await shareDialog({ title: `Surat Jalan ${code ?? ''}`, helper: 'PDF sudah terunduh. Kirim info via WhatsApp (lampirkan file PDF-nya manual).', defaultMessage: waText });
        } catch (error) {
          toast(error.message ?? 'Gagal memproses order.', 'error');
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
        const id = await createDispatch({ fromOutlet: state.outletId, toOutlet: to, items, notes: box.querySelector('#disp-notes').value });
        const { code, waText } = await emitSuratJalan(id, { showReceived: false, title: 'SURAT JALAN' });
        toast(`Surat jalan ${code ?? ''} dibuat. Menunggu konfirmasi tujuan.`, 'success');
        await loadStock();
        showTab();
        await shareDialog({ title: `Surat Jalan ${code ?? ''}`, helper: 'PDF sudah terunduh. Kirim info via WhatsApp (lampirkan file PDF-nya manual).', defaultMessage: waText });
      } catch (error) {
        errorEl.textContent = error.message ?? 'Gagal membuat pengiriman.';
        e.target.disabled = false;
      }
    });
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
            <table class="data-table">
              <thead><tr><th>Produk</th><th>Dikirim</th><th>Diterima</th></tr></thead>
              <tbody>
                ${items
                  .map(
                    (it) => `<tr>
                      <td>${esc(it.products?.name ?? '-')}</td>
                      <td>${formatNum(it.sent_qty)} ${esc(it.products?.base_unit ?? '')}</td>
                      <td><input type="number" class="recv-input" min="0" data-item="${it.id}" value="${round(it.sent_qty)}" style="max-width:100px" /></td>
                    </tr>`
                  )
                  .join('')}
              </tbody>
            </table>
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
          await receiveDispatch(btn.dataset.id, items);
          const { code, waText } = await emitSuratJalan(btn.dataset.id, { showReceived: true, title: 'BUKTI TERIMA' });
          toast(`Surat jalan ${code ?? ''} diterima. Stok diperbarui.`, 'success');
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
