import { toast, formDialog, confirmDialog, fuzzyMatch } from '../../core/ui.js';
import { formatNum } from '../../core/format.js';
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
      ${allowOpname ? '<button id="inv-opname">📋 Stok Opname</button>' : ''}
      <button id="inv-transfer">Transfer</button>
    </div>
    <div id="inv-opname-panel"></div>
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
              return `<tr><td>${escapeHtml(p.name)}</td><td>${formatNum(qty)}</td><td>${escapeHtml(p.base_unit)}</td></tr>`;
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

  // ---- Stok Opname: tabel yang langsung diisi (bukan pop up per produk) ----
  const opnameState = { open: false, category: '', q: '' };
  const categories = [...new Set(activeProducts.map((p) => p.category).filter(Boolean))].sort();

  container.querySelector('#inv-opname')?.addEventListener('click', () => {
    opnameState.open = !opnameState.open;
    renderOpnamePanel();
  });

  function renderOpnamePanel() {
    const panel = container.querySelector('#inv-opname-panel');
    if (!opnameState.open) {
      panel.innerHTML = '';
      return;
    }
    panel.innerHTML = `
      <div class="inline-card fade-in" style="max-width:100%">
        <div class="page-header" style="margin-bottom:8px">
          <h3 style="margin:0;font-size:1rem">Stok Opname — ${esc(outlets.find((o) => o.id === state.outletId)?.name ?? '')}</h3>
          <button id="opname-close">Tutup</button>
        </div>
        <p style="font-size:0.83rem;color:var(--color-text-muted);margin:0 0 10px">
          Isi <strong>Stok Fisik</strong> hasil hitung di lapangan. Baris yang dikosongkan diabaikan; selisih dihitung otomatis.
        </p>
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin-bottom:10px">
          <div class="field" style="margin:0;max-width:200px"><label>Kategori</label>
            <select id="opname-cat"><option value="">Semua</option>${categories.map((c) => `<option value="${esc(c)}"${c === opnameState.category ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select>
          </div>
          <div class="field" style="margin:0;max-width:240px"><label>Cari bahan</label>
            <input type="text" id="opname-q" placeholder="ketik nama bahan…" value="${esc(opnameState.q)}" />
          </div>
        </div>
        <div id="opname-rows"></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
          <button class="primary" id="opname-save" style="max-width:220px">Simpan Hasil Opname</button>
          <button id="opname-clear">Kosongkan Isian</button>
        </div>
      </div>`;

    const rowsBox = panel.querySelector('#opname-rows');
    const draft = new Map(); // productId -> nilai yang sedang diketik

    function renderRows() {
      const list = activeProducts.filter(
        (p) =>
          (!opnameState.category || p.category === opnameState.category) &&
          (!opnameState.q || fuzzyMatch(opnameState.q, `${p.name} ${p.category ?? ''} ${p.subcategory ?? ''}`))
      );
      rowsBox.innerHTML = `
        <table class="data-table">
          <thead><tr><th>Bahan</th><th>Kategori</th><th>Stok Akhir</th><th>Stok Fisik</th><th>Satuan</th><th>Selisih</th></tr></thead>
          <tbody>
            ${
              list
                .map((p) => {
                  const sys = stockMap?.get(p.id) ?? 0;
                  const val = draft.has(p.id) ? draft.get(p.id) : '';
                  return `<tr data-p="${p.id}">
                    <td>${esc(p.name)}</td>
                    <td style="font-size:0.82rem;color:var(--color-text-muted)">${esc(p.category ?? '-')}</td>
                    <td>${formatNum(sys)}</td>
                    <td><input type="number" class="opname-input" data-p="${p.id}" data-sys="${sys}" min="0" placeholder="—" value="${val}" style="max-width:110px" /></td>
                    <td style="font-size:0.85rem">${esc(p.base_unit)}</td>
                    <td class="opname-diff" data-p="${p.id}" style="font-size:0.85rem;color:var(--color-text-muted)">-</td>
                  </tr>`;
                })
                .join('') || '<tr><td colspan="6">Tidak ada bahan pada filter ini.</td></tr>'
            }
          </tbody>
        </table>`;

      rowsBox.querySelectorAll('.opname-input').forEach((inp) => {
        const updateDiff = () => {
          const cell = rowsBox.querySelector(`.opname-diff[data-p="${inp.dataset.p}"]`);
          if (inp.value === '') {
            draft.delete(inp.dataset.p);
            cell.textContent = '-';
            cell.style.color = 'var(--color-text-muted)';
            return;
          }
          draft.set(inp.dataset.p, inp.value);
          const diff = Number(inp.value) - Number(inp.dataset.sys);
          cell.textContent = diff === 0 ? 'sesuai' : `${diff > 0 ? '+' : ''}${formatNum(diff)}`;
          cell.style.color = diff === 0 ? 'var(--color-text-muted)' : diff > 0 ? 'var(--color-primary)' : 'var(--color-danger)';
        };
        inp.addEventListener('input', updateDiff);
        updateDiff();
      });
    }

    panel.querySelector('#opname-close').addEventListener('click', () => {
      opnameState.open = false;
      renderOpnamePanel();
    });
    panel.querySelector('#opname-cat').addEventListener('change', (e) => {
      opnameState.category = e.target.value;
      renderRows();
    });
    panel.querySelector('#opname-q').addEventListener('input', (e) => {
      opnameState.q = e.target.value;
      renderRows();
    });
    panel.querySelector('#opname-clear').addEventListener('click', () => {
      draft.clear();
      renderRows();
    });

    panel.querySelector('#opname-save').addEventListener('click', async (e) => {
      const changes = [];
      for (const [pid, raw] of draft.entries()) {
        if (raw === '') continue;
        const sys = stockMap?.get(pid) ?? 0;
        const delta = Number(raw) - sys;
        if (delta !== 0) changes.push({ pid, actual: Number(raw), sys, delta });
      }
      if (!changes.length) {
        toast('Tidak ada selisih untuk disimpan.', 'info');
        return;
      }
      const ok = await confirmDialog({
        title: 'Simpan hasil opname?',
        message: `${changes.length} bahan akan dikoreksi sesuai hitungan fisik. Stok sistem akan disesuaikan.`,
        confirmText: 'Simpan'
      });
      if (!ok) return;
      e.target.disabled = true;
      let saved = 0;
      try {
        for (const c of changes) {
          await recordMovement({
            businessUnitId,
            outletId: state.outletId,
            productId: c.pid,
            movementType: 'adjustment',
            qtyDelta: c.delta,
            unitCost: costs.get(c.pid) ?? null,
            notes: `Opname: fisik ${c.actual} (sistem ${round(c.sys)})`
          });
          saved++;
        }
        toast(`Opname tersimpan — ${saved} bahan dikoreksi.`, 'success');
        stockMap = await refresh();
        opnameState.open = false;
        renderOpnamePanel();
      } catch (error) {
        toast(`${error.message ?? 'Gagal menyimpan opname.'} (${saved} tersimpan)`, 'error');
        e.target.disabled = false;
      }
    });

    renderRows();
  }

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
function esc(s) {
  return escapeHtml(s);
}
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
