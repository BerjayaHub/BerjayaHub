import { toast, renderSearchSelect, wireSearchSelect, shareDialog } from '../../core/ui.js';
import { formatNum } from '../../core/format.js';
import { listAttendanceOutlets } from '../attendance/attendance.service.js';
import { listProducts } from '../product/product.service.js';
import { createDispatch, receiveDispatch, listIncomingDispatches, getDispatchItems, getDispatchForPdf } from './dispatch.service.js';
import { buildSuratJalanPDF, suratJalanWaText } from './dispatch-pdf.js';

export async function renderDispatchPage(container, { businessUnitId, outletId }) {
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
  const outletsById = new Map(outlets.map((o) => [o.id, o]));
  const ckOutlets = outlets.filter((o) => o.outlet_role === 'central_kitchen');

  const fromOutlet = outletsById.get(outletId) || null;
  const fromRole = fromOutlet?.outlet_role ?? null;
  const myOutletIds = fromOutlet ? [fromOutlet.id] : outlets.map((o) => o.id);

  container.innerHTML = `
    <h1>Pengiriman</h1>
    <div id="disp-send"></div>
    <h2 style="font-size:1rem;margin-top:20px">Kiriman Masuk (belum diterima)</h2>
    <div id="disp-incoming"></div>
  `;

  renderSend();
  renderIncoming();

  // ---- Bagian Kirim (adaptif per peran outlet) ----
  function renderSend() {
    const box = container.querySelector('#disp-send');
    if (!active.length) {
      box.innerHTML = '';
      return;
    }
    // Konfigurasi berdasar peran outlet basis.
    let title = 'Kirim Stok';
    let showJenis = false;
    if (fromOutlet && fromRole === 'central_kitchen') {
      title = 'Kirim ke Outlet';
    } else if (fromOutlet) {
      title = 'Transfer / Retur Stok';
      showJenis = true;
    }

    const destOptions = (jenis) => {
      let list;
      if (!fromOutlet) list = outlets; // generic
      else if (fromRole === 'central_kitchen') list = outlets.filter((o) => o.id !== fromOutlet.id);
      else if (jenis === 'retur') list = ckOutlets;
      else list = outlets.filter((o) => o.id !== fromOutlet.id && o.outlet_role !== 'central_kitchen');
      return list;
    };

    box.innerHTML = `
      <div class="inline-card" style="max-width:600px">
        <h3 style="margin-top:0">${title}</h3>
        ${
          fromOutlet
            ? `<p style="font-size:0.82rem;color:var(--color-text-muted);margin:0 0 8px">Dari: <strong>${esc(fromOutlet.name)}</strong></p>`
            : `<div class="field"><label>Dari outlet</label><select id="disp-from">${outlets.map((o) => `<option value="${o.id}">${esc(o.name)}</option>`).join('')}</select></div>`
        }
        ${
          showJenis
            ? `<div class="field"><label>Jenis</label><select id="disp-jenis"><option value="transfer">Transfer antar Outlet</option><option value="retur">Retur ke Central Kitchen</option></select></div>`
            : ''
        }
        <div class="field"><label>Ke outlet</label><select id="disp-to"></select></div>
        <div class="line-rows" id="disp-items"></div>
        <button id="disp-add" style="margin-top:8px">+ Tambah Produk</button>
        <div class="field" style="margin-top:12px"><label>Catatan (opsional)</label><input type="text" id="disp-notes" /></div>
        <button class="primary" id="disp-send-btn">Kirim &amp; Buat Surat Jalan</button>
        <p class="error-text" id="disp-error"></p>
      </div>
    `;

    const toSel = box.querySelector('#disp-to');
    const jenisSel = box.querySelector('#disp-jenis');
    const fromSel = box.querySelector('#disp-from');
    const fillDest = () => {
      const list = destOptions(jenisSel?.value);
      const exclude = fromSel?.value;
      toSel.innerHTML = list.filter((o) => o.id !== exclude).map((o) => `<option value="${o.id}">${esc(o.name)}</option>`).join('') || '<option value="">-- tidak ada tujuan --</option>';
    };
    fillDest();
    jenisSel?.addEventListener('change', fillDest);
    fromSel?.addEventListener('change', fillDest);

    const itemsBody = box.querySelector('#disp-items');
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
    box.querySelector('#disp-add').addEventListener('click', addRow);

    box.querySelector('#disp-send-btn').addEventListener('click', async (e) => {
      const errorEl = box.querySelector('#disp-error');
      errorEl.textContent = '';
      const from = fromOutlet ? fromOutlet.id : fromSel.value;
      const to = toSel.value;
      if (!to) {
        errorEl.textContent = 'Pilih outlet tujuan.';
        return;
      }
      if (from === to) {
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
        const id = await createDispatch({ fromOutlet: from, toOutlet: to, items, notes: box.querySelector('#disp-notes').value });
        const { code, waText } = await emitSuratJalan(id, { showReceived: false, title: 'SURAT JALAN' });
        toast(`Surat jalan ${code ?? ''} dibuat. Menunggu konfirmasi tujuan.`, 'success');
        renderSend();
        renderIncoming();
        await shareDialog({ title: `Surat Jalan ${code ?? ''}`, helper: 'PDF sudah terunduh. Kirim info via WhatsApp (lampirkan file PDF-nya manual).', defaultMessage: waText });
      } catch (error) {
        errorEl.textContent = error.message ?? 'Gagal membuat pengiriman.';
      } finally {
        e.target.disabled = false;
      }
    });
  }

  // ---- Kiriman masuk: tabel inline + Simpan ----
  async function renderIncoming() {
    const box = container.querySelector('#disp-incoming');
    box.innerHTML = `<p>Memuat...</p>`;
    let incoming;
    try {
      incoming = await listIncomingDispatches(myOutletIds);
    } catch (error) {
      box.innerHTML = `<p class="error-text">${error.message ?? error}</p>`;
      return;
    }
    if (!incoming.length) {
      box.innerHTML = '<p style="color:var(--color-text-muted)">Tidak ada kiriman yang menunggu diterima.</p>';
      return;
    }
    const itemsByDispatch = await Promise.all(incoming.map((d) => getDispatchItems(d.id).catch(() => [])));

    box.innerHTML = incoming
      .map((d, idx) => {
        const items = itemsByDispatch[idx];
        return `
        <div class="inline-card" style="max-width:560px" data-dispatch="${d.id}">
          <div style="font-size:0.85rem"><strong>${esc(d.from_outlet?.name ?? '-')}</strong> → <strong>${esc(d.to_outlet?.name ?? '-')}</strong>
            <span style="color:var(--color-text-muted)">· ${fmtDateTime(d.created_at)} · oleh ${esc(d.user_profiles?.full_name ?? '-')}</span></div>
          <table class="data-table" style="margin-top:8px">
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
        </div>`;
      })
      .join('');

    box.querySelectorAll('.btn-save-receive').forEach((btn) =>
      btn.addEventListener('click', async () => {
        const card = btn.closest('[data-dispatch]');
        const items = [...card.querySelectorAll('.recv-input')].map((el) => ({ item_id: el.dataset.item, received_qty: Number(el.value) }));
        btn.disabled = true;
        try {
          await receiveDispatch(btn.dataset.id, items);
          const { code, waText } = await emitSuratJalan(btn.dataset.id, { showReceived: true, title: 'BUKTI TERIMA' });
          toast(`Surat jalan ${code ?? ''} diterima. Stok diperbarui.`, 'success');
          await renderIncoming();
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
