import { toast, formDialog, renderSearchSelect, wireSearchSelect } from '../../core/ui.js';
import { formatThousands } from '../../core/format.js';
import { listAttendanceOutlets } from '../attendance/attendance.service.js';
import { listProducts } from '../product/product.service.js';
import { createDispatch, listIncomingDispatches, getDispatchItems, receiveDispatch } from './dispatch.service.js';

export async function renderDispatchPage(container, { businessUnitId }) {
  container.innerHTML = `<p>Memuat pengiriman...</p>`;

  let outlets, products;
  try {
    [outlets, products] = await Promise.all([
      listAttendanceOutlets().then((all) => all.filter((o) => o.business_unit_id === businessUnitId)),
      listProducts(businessUnitId)
    ]);
  } catch (error) {
    container.innerHTML = `<p class="error-text">Gagal memuat: ${error.message ?? error}</p>`;
    return;
  }
  const active = products.filter((p) => p.is_active !== false);
  const productOptions = active.map((p) => ({ value: p.id, label: `${p.name} (${p.base_unit})` }));
  const ckOutlets = outlets.filter((o) => o.outlet_role === 'central_kitchen');
  const outletIds = outlets.map((o) => o.id);

  container.innerHTML = `
    <h1>Pengiriman</h1>
    ${
      ckOutlets.length && active.length
        ? `
      <div class="inline-card" style="max-width:600px">
        <h3 style="margin-top:0">Kirim ke Outlet</h3>
        <div class="field"><label>Dari (Central Kitchen)</label>
          <select id="disp-from">${ckOutlets.map((o) => `<option value="${o.id}">${o.name}</option>`).join('')}</select>
        </div>
        <div class="field"><label>Ke outlet</label>
          <select id="disp-to">${outlets.map((o) => `<option value="${o.id}">${o.name}</option>`).join('')}</select>
        </div>
        <div class="line-rows" id="disp-items"></div>
        <button id="disp-add" style="margin-top:8px">+ Tambah Produk</button>
        <div class="field" style="margin-top:12px"><label>Catatan (opsional)</label><input type="text" id="disp-notes" /></div>
        <button class="primary" id="disp-send">Kirim</button>
        <p class="error-text" id="disp-error"></p>
      </div>`
        : ''
    }
    <h2 style="font-size:1rem;margin-top:20px">Kiriman Masuk (belum diterima)</h2>
    <div id="disp-incoming"></div>
  `;

  // ---- Kirim ----
  const itemsBody = container.querySelector('#disp-items');
  if (itemsBody) {
    const addRow = () => {
      const wrap = document.createElement('div');
      wrap.innerHTML = `<div class="line-row">
        ${renderSearchSelect({ name: 'dp', options: productOptions, placeholder: 'cari produk…' })}
        <input type="number" class="ln-qty" min="0" placeholder="jumlah" />
        <button class="ln-remove" title="Hapus">✕</button>
      </div>`;
      const row = wrap.firstElementChild;
      itemsBody.appendChild(row);
      wireSearchSelect(row.querySelector('.search-select'), productOptions);
      row.querySelector('.ln-remove').addEventListener('click', () => row.remove());
    };
    addRow();
    container.querySelector('#disp-add').addEventListener('click', addRow);

    container.querySelector('#disp-send').addEventListener('click', async (e) => {
      const errorEl = container.querySelector('#disp-error');
      errorEl.textContent = '';
      const fromOutlet = container.querySelector('#disp-from').value;
      const toOutlet = container.querySelector('#disp-to').value;
      if (fromOutlet === toOutlet) {
        errorEl.textContent = 'Outlet asal & tujuan tidak boleh sama.';
        return;
      }
      const items = [...itemsBody.querySelectorAll('.line-row')]
        .map((row) => ({ product_id: row.querySelector('.search-select input[type="hidden"]').value, qty: Number(row.querySelector('.ln-qty').value) }))
        .filter((i) => i.product_id && i.qty > 0);
      if (!items.length) {
        errorEl.textContent = 'Tambahkan minimal satu produk dengan jumlah.';
        return;
      }
      e.target.disabled = true;
      try {
        await createDispatch({ fromOutlet, toOutlet, items, notes: container.querySelector('#disp-notes').value });
        toast('Pengiriman dibuat. Menunggu konfirmasi outlet tujuan.', 'success');
        itemsBody.innerHTML = '';
        addRow();
        container.querySelector('#disp-notes').value = '';
        await renderIncoming();
      } catch (error) {
        errorEl.textContent = error.message ?? 'Gagal membuat pengiriman.';
      } finally {
        e.target.disabled = false;
      }
    });
  }

  // ---- Kiriman masuk ----
  async function renderIncoming() {
    const box = container.querySelector('#disp-incoming');
    box.innerHTML = `<p>Memuat...</p>`;
    let incoming;
    try {
      incoming = await listIncomingDispatches(outletIds);
    } catch (error) {
      box.innerHTML = `<p class="error-text">${error.message ?? error}</p>`;
      return;
    }
    box.innerHTML =
      incoming
        .map(
          (d) => `
        <div class="inline-card" style="max-width:520px">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
            <div>
              <strong>${esc(d.from_outlet?.name ?? '-')}</strong> → <strong>${esc(d.to_outlet?.name ?? '-')}</strong>
              <div style="font-size:0.78rem;color:var(--color-text-muted)">${fmtDateTime(d.created_at)} · oleh ${esc(d.user_profiles?.full_name ?? '-')}${d.notes ? ' · ' + esc(d.notes) : ''}</div>
            </div>
            <button class="primary btn-inline btn-receive" data-id="${d.id}">Terima</button>
          </div>
        </div>`
        )
        .join('') || '<p style="color:var(--color-text-muted)">Tidak ada kiriman yang menunggu diterima.</p>';

    box.querySelectorAll('.btn-receive').forEach((btn) => btn.addEventListener('click', () => openReceive(btn.dataset.id, renderIncoming)));
  }

  await renderIncoming();
}

async function openReceive(dispatchId, refresh) {
  let items;
  try {
    items = await getDispatchItems(dispatchId);
  } catch (error) {
    toast(error.message ?? 'Gagal memuat detail.', 'error');
    return;
  }
  const values = await formDialog({
    title: 'Konfirmasi Terima',
    description: 'Isi jumlah aktual yang diterima tiap produk (default = jumlah dikirim).',
    fields: items.map((it) => ({
      name: it.id,
      label: `${it.products?.name ?? '-'} — dikirim ${formatThousands(round(it.sent_qty))} ${it.products?.base_unit ?? ''}`,
      type: 'number',
      value: it.sent_qty
    })),
    submitText: 'Konfirmasi Terima'
  });
  if (!values) return;
  const payload = items.map((it) => ({ item_id: it.id, received_qty: Number(values[it.id]) || 0 }));
  try {
    await receiveDispatch(dispatchId, payload);
    toast('Kiriman diterima. Stok outlet diperbarui.', 'success');
    await refresh();
  } catch (error) {
    toast(error.message ?? 'Gagal konfirmasi.', 'error');
  }
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
