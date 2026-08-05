import { toast, shareDialog } from '../../core/ui.js';
import { formatNum, formatRupiah } from '../../core/format.js';
import { listProducts } from '../product/product.service.js';
import { recordSales, getSalesSummary, todayWIB } from './sales.service.js';
import { listMyOutlets } from '../../core/my-outlets.js';

export async function renderSalesPage(container, { businessUnitId, outletId }) {
  container.innerHTML = `<p>Memuat penjualan...</p>`;
  const date = todayWIB();

  let allOutlets, products;
  try {
    [allOutlets, products] = await Promise.all([
      listMyOutlets(businessUnitId),
      listProducts(businessUnitId)
    ]);
  } catch (error) {
    container.innerHTML = `<p class="error-text">Gagal memuat: ${error.message ?? error}</p>`;
    return;
  }
  // allOutlets sudah hasil listMyOutlets() -> tidak perlu disaring dua kali.
  const myOutlets = allOutlets.filter((o) => o.allow_sales !== false);
  const menus = products.filter((p) => p.product_type === 'finished' && p.is_active !== false);
  if (!myOutlets.length) {
    container.innerHTML = `<h1>Penjualan</h1><p style="color:var(--color-text-muted)">Penjualan belum diaktifkan untuk outletmu. (Diatur admin di Master BU & Outlet.)</p>`;
    return;
  }
  if (!menus.length) {
    container.innerHTML = `<h1>Penjualan</h1><p style="color:var(--color-text-muted)">Belum ada menu. Minta admin mengisi di Master Produk.</p>`;
    return;
  }
  const categories = [...new Set(menus.map((m) => m.category).filter(Boolean))].sort();
  const state = { outletId: myOutlets.some((o) => o.id === outletId) ? outletId : myOutlets[0].id, category: '', summary: new Map() };

  container.innerHTML = `
    <h1>Penjualan</h1>
    <p style="color:var(--color-text-muted);font-size:0.85rem;margin:0 0 10px">Isi jumlah terjual tiap menu hari ini (${fmtDate(date)}), lalu Simpan. Stok bahan otomatis berkurang sesuai resep, omzet tercatat.</p>
    <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end;margin-bottom:8px">
      <div class="field" style="margin:0"><label>Outlet</label>
        <select id="sl-outlet">${myOutlets.map((o) => `<option value="${o.id}"${o.id === state.outletId ? ' selected' : ''}>${esc(o.name)}</option>`).join('')}</select>
      </div>
      <div class="field" style="margin:0"><label>Kategori</label>
        <select id="sl-cat"><option value="">Semua</option>${categories.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}</select>
      </div>
    </div>
    <div class="table-scroll"><table class="data-table table-freeze-1">
      <thead><tr><th>Menu</th><th>Harga</th><th>Jumlah terjual</th></tr></thead>
      <tbody id="sl-rows"></tbody>
    </table></div>
    <button class="primary" id="sl-save" style="max-width:220px;margin-top:12px">Simpan Penjualan</button>
    <div id="sl-summary" style="margin-top:18px"></div>
  `;

  const outletSel = container.querySelector('#sl-outlet');
  const catSel = container.querySelector('#sl-cat');

  function renderRows() {
    const tbody = container.querySelector('#sl-rows');
    const list = state.category ? menus.filter((m) => m.category === state.category) : menus;
    tbody.innerHTML = list
      .map(
        (m) => `<tr>
          <td>${esc(m.name)}</td>
          <td>${m.sale_price != null ? formatRupiah(m.sale_price) : '-'}</td>
          <td><input type="number" class="sl-qty" data-id="${m.id}" min="0" placeholder="0" style="max-width:90px" /></td>
        </tr>`
      )
      .join('') || '<tr><td colspan="3">Tidak ada menu di kategori ini.</td></tr>';
  }

  async function loadSummary() {
    const box = container.querySelector('#sl-summary');
    try {
      state.summary = await getSalesSummary(state.outletId, date);
    } catch {
      state.summary = new Map();
    }
    const rows = menus
      .filter((m) => state.summary.has(m.id))
      .map((m) => {
        const s = state.summary.get(m.id);
        return `<tr><td>${esc(m.name)}</td><td>${formatNum(s.qty)}</td><td>${formatRupiah(s.revenue)}</td></tr>`;
      });
    let total = 0;
    for (const s of state.summary.values()) total += s.revenue;
    box.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;max-width:420px;flex-wrap:wrap">
        <h2 style="font-size:1rem;margin:0">Rekap Penjualan Hari Ini</h2>
        ${rows.length ? '<button id="sl-share">📤 Kirim via WhatsApp</button>' : ''}
      </div>
      ${
        rows.length
          ? `<table class="data-table" style="max-width:420px;margin-top:8px"><thead><tr><th>Menu</th><th>Terjual</th><th>Omzet</th></tr></thead><tbody>${rows.join('')}</tbody></table>
             <p style="font-weight:600;margin-top:8px">Total omzet: ${formatRupiah(total)}</p>`
          : '<p style="color:var(--color-text-muted)">Belum ada penjualan tercatat hari ini.</p>'
      }
    `;

    box.querySelector('#sl-share')?.addEventListener('click', () => {
      const outletName = myOutlets.find((o) => o.id === state.outletId)?.name ?? '-';
      let qtyTotal = 0;
      const lines = menus
        .filter((m) => state.summary.has(m.id))
        .map((m) => {
          const s = state.summary.get(m.id);
          qtyTotal += s.qty;
          return `• ${m.name}: ${formatNum(s.qty)} — ${formatRupiah(s.revenue)}`;
        });
      const text = [
        `*Rekap Penjualan — ${outletName}*`,
        fmtDate(date),
        '',
        ...lines,
        '',
        `Total terjual: ${formatNum(qtyTotal)} menu`,
        `*Total omzet: ${formatRupiah(total)}*`
      ].join('\n');
      shareDialog({
        title: 'Kirim Rekap Penjualan',
        helper: 'Teks bisa diedit dulu sebelum dikirim ke WhatsApp/chat.',
        defaultMessage: text
      });
    });
  }

  outletSel.addEventListener('change', () => {
    state.outletId = outletSel.value;
    loadSummary();
  });
  catSel.addEventListener('change', () => {
    state.category = catSel.value;
    renderRows();
  });

  container.querySelector('#sl-save').addEventListener('click', async (e) => {
    const items = [...container.querySelectorAll('.sl-qty')]
      .map((inp) => ({ product_id: inp.dataset.id, qty: Number(inp.value) }))
      .filter((i) => i.qty > 0);
    if (!items.length) {
      toast('Isi jumlah terjual dulu.', 'warning');
      return;
    }
    e.target.disabled = true;
    try {
      await recordSales({ businessUnitId, outletId: state.outletId, date, items });
      toast('Penjualan tersimpan. Stok & omzet diperbarui.', 'success');
      container.querySelectorAll('.sl-qty').forEach((inp) => (inp.value = ''));
      await loadSummary();
    } catch (error) {
      toast(error.message ?? 'Gagal menyimpan penjualan.', 'error');
    } finally {
      e.target.disabled = false;
    }
  });

  renderRows();
  await loadSummary();
}

function fmtDate(d) {
  return new Date(d + 'T00:00:00').toLocaleDateString('id-ID', { weekday: 'long', day: '2-digit', month: 'short' });
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
