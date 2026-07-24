import { toast, renderSearchSelect, wireSearchSelect, shareDialog } from '../../core/ui.js';
import { formatNum } from '../../core/format.js';
import { listAttendanceOutlets } from '../attendance/attendance.service.js';
import { listProducts } from '../product/product.service.js';
import { createDispatch, receiveDispatch, listIncomingDispatches, getDispatchItems, getDispatchForPdf, getMyScopedOutlets } from './dispatch.service.js';
import { buildSuratJalanPDF, suratJalanWaText } from './dispatch-pdf.js';

export async function renderDispatchPage(container, { businessUnitId, outletId }) {
  container.innerHTML = `<p>Memuat pengiriman...</p>`;

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
  // Outlet milik akun ini (untuk pemilih & kiriman masuk). Tujuan kirim boleh outlet mana pun.
  const myOutlets = await getMyScopedOutlets(businessUnitId, allOutlets);
  const active = products.filter((p) => p.is_active !== false);
  const productOptions = active.map((p) => ({ value: p.id, label: `${p.name} (${p.base_unit})` }));
  const outletsById = new Map(allOutlets.map((o) => [o.id, o]));
  const ckOutlets = allOutlets.filter((o) => o.outlet_role === 'central_kitchen');

  const myHasBase = myOutlets.some((o) => o.id === outletId);
  const state = { outletId: myHasBase ? outletId : myOutlets[0].id };

  container.innerHTML = `
    <h1>Pengiriman</h1>
    <div class="field" style="max-width:280px"><label>Outlet saya</label>
      <select id="disp-outlet">${myOutlets.map((o) => `<option value="${o.id}"${o.id === state.outletId ? ' selected' : ''}>${esc(o.name)}${o.outlet_role === 'central_kitchen' ? ' (CK)' : ''}</option>`).join('')}</select>
    </div>
    <div id="disp-send"></div>
    <div style="display:flex;justify-content:space-between;align-items:center;max-width:560px;margin-top:20px;gap:8px">
      <h2 style="font-size:1rem;margin:0">Kiriman Masuk (belum diterima)</h2>
      <button id="disp-refresh" title="Muat ulang">⟳ Refresh</button>
    </div>
    <div id="disp-incoming"></div>
  `;

  const outletSel = container.querySelector('#disp-outlet');
  outletSel.addEventListener('change', () => {
    state.outletId = outletSel.value;
    renderSend();
    renderIncoming();
  });

  container.querySelector('#disp-refresh').addEventListener('click', () => renderIncoming());

  // Auto-refresh kiriman masuk tiap 15 detik (berhenti sendiri saat halaman diganti,
  // dan dilewati kalau ada tabel penerimaan yang sedang dibuka/diisi).
  const pollTimer = setInterval(() => {
    if (!document.body.contains(container) || !container.querySelector('#disp-incoming')) {
      clearInterval(pollTimer);
      return;
    }
    if (container.querySelector('.recv-body:not([hidden])')) return;
    renderIncoming();
  }, 15000);

  renderSend();
  renderIncoming();

  // ---- Bagian Kirim (adaptif per peran outlet terpilih) ----
  function renderSend() {
    const box = container.querySelector('#disp-send');
    const fromOutlet = outletsById.get(state.outletId);
    if (!active.length || !fromOutlet) {
      box.innerHTML = '';
      return;
    }
    const isCK = fromOutlet.outlet_role === 'central_kitchen';
    const title = isCK ? 'Kirim ke Outlet' : 'Transfer / Retur Stok';
    const showJenis = !isCK;

    const destOptions = (jenis) => {
      if (isCK) return allOutlets.filter((o) => o.id !== fromOutlet.id);
      if (jenis === 'retur') return ckOutlets.filter((o) => o.id !== fromOutlet.id);
      return allOutlets.filter((o) => o.id !== fromOutlet.id && o.outlet_role !== 'central_kitchen');
    };

    box.innerHTML = `
      <div class="inline-card" style="max-width:600px">
        <h3 style="margin-top:0">${title} <span style="font-size:0.8rem;color:var(--color-text-muted)">dari ${esc(fromOutlet.name)}</span></h3>
        ${showJenis ? `<div class="field"><label>Jenis</label><select id="disp-jenis"><option value="transfer">Transfer antar Outlet</option><option value="retur">Retur ke Central Kitchen</option></select></div>` : ''}
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
    const fillDest = () => {
      const list = destOptions(jenisSel?.value);
      toSel.innerHTML = list.map((o) => `<option value="${o.id}">${esc(o.name)}</option>`).join('') || '<option value="">-- tidak ada tujuan --</option>';
    };
    fillDest();
    jenisSel?.addEventListener('change', fillDest);

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
      const to = toSel.value;
      if (!to) {
        errorEl.textContent = 'Pilih outlet tujuan.';
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
        const id = await createDispatch({ fromOutlet: fromOutlet.id, toOutlet: to, items, notes: box.querySelector('#disp-notes').value });
        const { code, waText } = await emitSuratJalan(id, { showReceived: false, title: 'SURAT JALAN' });
        toast(`Surat jalan ${code ?? ''} dibuat. Menunggu konfirmasi tujuan.`, 'success');
        renderSend();
        await shareDialog({ title: `Surat Jalan ${code ?? ''}`, helper: 'PDF sudah terunduh. Kirim info via WhatsApp (lampirkan file PDF-nya manual).', defaultMessage: waText });
      } catch (error) {
        errorEl.textContent = error.message ?? 'Gagal membuat pengiriman.';
      } finally {
        e.target.disabled = false;
      }
    });
  }

  // ---- Kiriman masuk untuk outlet terpilih: daftar No. Surat Jalan, tap untuk buka tabel ----
  async function renderIncoming() {
    const box = container.querySelector('#disp-incoming');
    box.innerHTML = `<p>Memuat...</p>`;
    let incoming;
    try {
      incoming = await listIncomingDispatches([state.outletId]);
    } catch (error) {
      box.innerHTML = `<p class="error-text">${error.message ?? error}</p>`;
      return;
    }
    if (!incoming.length) {
      box.innerHTML = '<p style="color:var(--color-text-muted)">Tidak ada kiriman yang menunggu diterima untuk outlet ini.</p>';
      return;
    }
    const itemsByDispatch = await Promise.all(incoming.map((d) => getDispatchItems(d.id).catch(() => [])));

    box.innerHTML = incoming
      .map((d, idx) => {
        const items = itemsByDispatch[idx];
        return `
        <div class="inline-card" style="max-width:560px" data-dispatch="${d.id}">
          <button class="disp-expand" data-id="${d.id}" style="border:none;background:none;cursor:pointer;text-align:left;width:100%;padding:0;font-size:0.92rem;color:var(--color-text)">
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
