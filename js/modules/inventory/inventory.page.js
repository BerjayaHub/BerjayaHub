import { toast, formDialog } from '../../core/ui.js';
import { formatThousands } from '../../core/format.js';
import { listAttendanceOutlets } from '../attendance/attendance.service.js';
import { listProducts, listRecipesFull, computeCosts } from '../product/product.service.js';
import { getOutletStockMap, recordMovement, transferStock, getAllowStaffOpname } from './inventory.service.js';

export async function renderInventoryPage(container, { userId, businessUnitId, outletId }) {
  container.innerHTML = `<p>Memuat inventory...</p>`;

  let outlets, products, recipes, allowOpname;
  try {
    [outlets, products, recipes, allowOpname] = await Promise.all([
      listAttendanceOutlets().then((all) => all.filter((o) => o.business_unit_id === businessUnitId).map((o) => ({ id: o.id, name: o.name }))),
      listProducts(businessUnitId),
      listRecipesFull(businessUnitId),
      getAllowStaffOpname(businessUnitId).catch(() => false)
    ]);
  } catch (error) {
    container.innerHTML = `<p class="error-text">Gagal memuat: ${error.message ?? error}</p>`;
    return;
  }
  const activeProducts = products.filter((p) => p.is_active !== false);
  if (!outlets.length) {
    container.innerHTML = `<h1>Inventory</h1><p>Belum ada outlet untukmu di BU ini.</p>`;
    return;
  }
  if (!activeProducts.length) {
    container.innerHTML = `<h1>Inventory</h1><p style="color:var(--color-text-muted)">Belum ada produk. Minta admin mengisi Master Produk dulu.</p>`;
    return;
  }
  const costs = computeCosts(products, recipes);
  const productById = new Map(products.map((p) => [p.id, p]));
  const state = { outletId: outlets.some((o) => o.id === outletId) ? outletId : outlets[0].id };

  container.innerHTML = `
    <h1>Inventory</h1>
    <div class="field" style="max-width:280px">
      <label>Outlet</label>
      <select id="inv-outlet">${outlets.map((o) => `<option value="${o.id}"${o.id === state.outletId ? ' selected' : ''}>${o.name}</option>`).join('')}</select>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
      <button class="primary" id="inv-receive" style="max-width:160px">+ Penerimaan</button>
      <button id="inv-waste">Waste</button>
      ${allowOpname ? '<button id="inv-opname">Opname</button>' : ''}
      <button id="inv-transfer">Transfer</button>
    </div>
    <div id="inv-stock"></div>
  `;

  const outletSelect = container.querySelector('#inv-outlet');
  outletSelect.addEventListener('change', () => {
    state.outletId = outletSelect.value;
    refresh();
  });

  const productOptions = activeProducts.map((p) => ({ value: p.id, label: `${p.name} (${p.base_unit})` }));

  async function refresh() {
    const stockDiv = container.querySelector('#inv-stock');
    stockDiv.innerHTML = `<p>Memuat stok...</p>`;
    let map;
    try {
      map = await getOutletStockMap(businessUnitId, state.outletId);
    } catch (error) {
      stockDiv.innerHTML = `<p class="error-text">${error.message ?? error}</p>`;
      return null;
    }
    stockDiv.innerHTML = `
      <table class="data-table">
        <thead><tr><th>Produk</th><th>Stok</th><th>Satuan</th></tr></thead>
        <tbody>
          ${activeProducts
            .map((p) => {
              const qty = map.get(p.id) ?? 0;
              return `<tr><td>${escapeHtml(p.name)}</td><td>${formatThousands(round(qty))}</td><td>${escapeHtml(p.base_unit)}</td></tr>`;
            })
            .join('')}
        </tbody>
      </table>
    `;
    return map;
  }

  let stockMap = await refresh();

  container.querySelector('#inv-receive').addEventListener('click', async () => {
    const v = await formDialog({
      title: 'Penerimaan Stok',
      fields: [
        { name: 'product_id', label: 'Produk', type: 'searchselect', required: true, options: productOptions },
        { name: 'qty', label: 'Jumlah masuk', type: 'number', required: true, min: 0 },
        { name: 'notes', label: 'Catatan (opsional)', type: 'text' }
      ],
      submitText: 'Simpan'
    });
    if (!v) return;
    await doMovement('receive', v.product_id, Number(v.qty), v.notes);
  });

  container.querySelector('#inv-waste').addEventListener('click', async () => {
    const v = await formDialog({
      title: 'Catat Waste / Rusak',
      fields: [
        { name: 'product_id', label: 'Produk', type: 'searchselect', required: true, options: productOptions },
        { name: 'qty', label: 'Jumlah dibuang', type: 'number', required: true, min: 0 },
        { name: 'notes', label: 'Alasan (opsional)', type: 'text', placeholder: 'mis. kedaluwarsa' }
      ],
      submitText: 'Simpan'
    });
    if (!v) return;
    await doMovement('waste', v.product_id, -Math.abs(Number(v.qty)), v.notes);
  });

  container.querySelector('#inv-opname').addEventListener('click', async () => {
    const v = await formDialog({
      title: 'Stok Opname',
      description: 'Isi jumlah fisik hasil hitung. Sistem menghitung selisihnya otomatis.',
      fields: [
        { name: 'product_id', label: 'Produk', type: 'searchselect', required: true, options: productOptions },
        { name: 'actual', label: 'Jumlah fisik (hasil hitung)', type: 'number', required: true, min: 0 }
      ],
      submitText: 'Simpan Koreksi'
    });
    if (!v) return;
    const current = stockMap?.get(v.product_id) ?? 0;
    const delta = Number(v.actual) - current;
    if (delta === 0) {
      toast('Stok sudah sesuai, tidak ada koreksi.', 'info');
      return;
    }
    await doMovement('adjustment', v.product_id, delta, `Opname: fisik ${v.actual} (sistem ${round(current)})`);
  });

  container.querySelector('#inv-transfer').addEventListener('click', async () => {
    const dests = outlets.filter((o) => o.id !== state.outletId);
    if (!dests.length) {
      toast('Tidak ada outlet tujuan lain di BU ini.', 'warning');
      return;
    }
    const v = await formDialog({
      title: 'Transfer Stok ke Outlet Lain',
      fields: [
        { name: 'product_id', label: 'Produk', type: 'searchselect', required: true, options: productOptions },
        { name: 'qty', label: 'Jumlah dikirim', type: 'number', required: true, min: 0 },
        { name: 'to_outlet', label: 'Outlet tujuan', type: 'select', required: true, options: dests.map((o) => ({ value: o.id, label: o.name })) },
        { name: 'notes', label: 'Catatan (opsional)', type: 'text' }
      ],
      submitText: 'Kirim'
    });
    if (!v) return;
    try {
      await transferStock({
        fromOutlet: state.outletId,
        toOutlet: v.to_outlet,
        productId: v.product_id,
        qty: Math.abs(Number(v.qty)),
        unitCost: costs.get(v.product_id) ?? null,
        notes: v.notes
      });
      toast('Transfer tercatat (keluar & masuk).', 'success');
      stockMap = await refresh();
    } catch (error) {
      toast(error.message ?? 'Gagal transfer.', 'error');
    }
  });

  async function doMovement(type, productId, qtyDelta, notes) {
    try {
      await recordMovement({
        businessUnitId,
        outletId: state.outletId,
        productId,
        movementType: type,
        qtyDelta,
        unitCost: costs.get(productId) ?? null,
        notes
      });
      toast(`${productById.get(productId)?.name ?? 'Stok'} tercatat.`, 'success');
      stockMap = await refresh();
    } catch (error) {
      toast(error.message ?? 'Gagal menyimpan pergerakan.', 'error');
    }
  }
}

function round(n) {
  return Math.round(Number(n) * 100) / 100;
}
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
