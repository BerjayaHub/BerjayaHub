import { listMyOutlets } from '../../core/my-outlets.js';
import { toast, renderSearchSelect, wireSearchSelect, formDialog, confirmDialog } from '../../core/ui.js';
import { formatNum } from '../../core/format.js';
import { getOutletStockMap } from '../inventory/inventory.service.js';
import { listManufacturable, computeNeeds, recordProduction, listProductionRuns, ubahProduksi, hapusProduksi } from './production.service.js';
import { loadingHtml, sekaliJalan } from '../../core/loading.js';

export async function renderProductionPage(container, { businessUnitId, outletId }) {
  container.innerHTML = loadingHtml('Memuat produksi…');

  let outlets, products;
  try {
    [outlets, products] = await Promise.all([
      // Produksi hanya di outlet Central Kitchen, dan hanya CK yang boleh diakses akun ini.
      listMyOutlets(businessUnitId).then((all) =>
        all.filter((o) => o.outlet_role === 'central_kitchen').map((o) => ({ id: o.id, name: o.name }))
      ),
      listManufacturable(businessUnitId)
    ]);
  } catch (error) {
    container.innerHTML = `<p class="error-text">Gagal memuat: ${error.message ?? error}</p>`;
    return;
  }
  if (!outlets.length) {
    container.innerHTML = `<h1>Produksi</h1><p style="color:var(--color-text-muted)">Produksi hanya untuk outlet <strong>Central Kitchen</strong>. Belum ada outlet CK yang bisa kamu akses di BU ini.</p>`;
    return;
  }
  if (!products.length) {
    container.innerHTML = `<h1>Produksi</h1><p style="color:var(--color-text-muted)">Belum ada produk yang punya resep. Minta admin mengisi Resep di Master Produk dulu.</p>`;
    return;
  }

  const productById = new Map(products.map((p) => [p.id, p]));
  const productOptions = products.map((p) => ({ value: p.id, label: `${p.name} (${p.base_unit})` }));
  const state = { outletId: outlets.some((o) => o.id === outletId) ? outletId : outlets[0].id, productId: '', stockMap: new Map() };

  container.innerHTML = `
    <h1>Produksi</h1>
    <div class="inline-card" style="max-width:560px">
      <div class="field"><label>Outlet</label>
        <select id="prod-outlet">${outlets.map((o) => `<option value="${o.id}"${o.id === state.outletId ? ' selected' : ''}>${esc(o.name)}</option>`).join('')}</select>
      </div>
      <div class="field"><label>Produk yang dibuat</label>
        ${renderSearchSelect({ name: 'prod-product', options: productOptions, placeholder: 'cari produk…' })}
      </div>
      <div class="field"><label>Jumlah hasil (output)</label>
        <input type="number" id="prod-qty" min="0" placeholder="mis. 1800" />
        <span class="field-help" id="prod-unit-help"></span>
      </div>
      <div id="prod-preview"></div>
      <div class="field"><label>Catatan (opsional)</label><input type="text" id="prod-notes" /></div>
      <button class="primary" id="prod-submit">Catat Produksi</button>
      <p class="error-text" id="prod-error"></p>
    </div>

    <h2 style="font-size:1rem;margin:18px 0 6px">Produksi Terakhir</h2>
    <p style="font-size:0.8rem;color:var(--color-text-muted);margin:0 0 8px">
      Daftar ini satu-satunya cara memastikan pencatatan benar-benar masuk. Kalau produksi yang barusan
      tidak muncul di sini, berarti belum tersimpan — periksa pesan merah di atas.
    </p>
    <div id="prod-riwayat"></div>
  `;

  const outletSel = container.querySelector('#prod-outlet');
  const qtyInput = container.querySelector('#prod-qty');
  const unitHelp = container.querySelector('#prod-unit-help');
  const preview = container.querySelector('#prod-preview');
  const widget = container.querySelector('.search-select[data-name="prod-product"]');

  /**
   * RIWAYAT PRODUKSI DI STAFF APP.
   *
   * Sebelumnya layar ini tidak punya riwayat sama sekali: satu-satunya tanda
   * bahwa produksi tercatat adalah toast yang hilang beberapa detik kemudian.
   * Kalau stoknya tidak ikut berubah — misalnya karena orangnya memeriksa
   * outlet yang berbeda — tidak ada apa pun yang bisa dipakai membedakan
   * "tidak tersimpan" dari "tersimpan tapi saya salah lihat".
   *
   * Itu persis pertanyaan yang muncul dari lapangan, dan tidak terjawab.
   */
  async function gambarRiwayat() {
    const box = container.querySelector('#prod-riwayat');
    if (!box) return;
    box.innerHTML = loadingHtml('Memuat riwayat…', { baris: 2 });
    let runs = [];
    try {
      runs = await listProductionRuns({ businessUnitId, outletId: state.outletId });
    } catch (error) {
      box.innerHTML = `<p class="error-text">${esc(error.message ?? error)}</p>`;
      return;
    }
    const tampil = runs.slice(0, 15);
    box.innerHTML = tampil.length
      ? `<div class="table-scroll"><table class="data-table kartu-sempit">
          <thead><tr><th>Waktu</th><th>Produk</th><th>Hasil</th><th>Oleh</th><th>Catatan</th><th>Aksi</th></tr></thead>
          <tbody>${tampil
            .map(
              (r) => `<tr>
                <td data-label="Waktu" style="font-size:0.82rem">${esc(fmtWaktu(r.created_at))}</td>
                <td data-label="Produk">${esc(r.products?.name ?? '-')}</td>
                <td data-label="Hasil"><strong>${formatNum(r.output_qty)}</strong> ${esc(r.products?.base_unit ?? '')}</td>
                <td data-label="Oleh" style="font-size:0.82rem">${esc(r.user_profiles?.full_name ?? '-')}</td>
                <td data-label="Catatan" style="font-size:0.82rem">${esc(r.notes ?? '-')}</td>
                <td data-label="Aksi" class="prod-aksi">
                  <button class="prod-ubah" data-id="${r.id}" data-qty="${esc(r.output_qty)}"
                          data-nama="${esc(r.products?.name ?? '')}" data-satuan="${esc(r.products?.base_unit ?? '')}"
                          data-notes="${esc(r.notes ?? '')}">✏️ Ubah</button>
                  <button class="prod-hapus" data-id="${r.id}" data-nama="${esc(r.products?.name ?? '')}"
                          data-qty="${esc(r.output_qty)}" data-satuan="${esc(r.products?.base_unit ?? '')}">🗑 Hapus</button>
                </td>
              </tr>`
            )
            .join('')}</tbody>
        </table></div>`
      : '<p style="color:var(--color-text-muted);font-size:0.88rem">Belum ada produksi tercatat di outlet ini.</p>';

    // ---- UBAH JUMLAH HASIL ----
    //
    // Produknya sengaja TIDAK bisa diganti. Mengganti produk berarti
    // membatalkan pemakaian bahan resep lama lalu menerapkan resep baru —
    // hasilnya sama dengan "batalkan lalu catat ulang", tapi menyamarkan bahwa
    // dua hal berbeda pernah terjadi dalam satu baris riwayat.
    box.querySelectorAll('.prod-ubah').forEach((btn) =>
      btn.addEventListener(
        'click',
        sekaliJalan(async () => {
          const v = await formDialog({
            title: `Ubah Produksi — ${btn.dataset.nama}`,
            description:
              'Stok ikut dikoreksi otomatis sebesar SELISIHNYA saja: hasilnya disesuaikan, dan pemakaian bahannya ikut naik atau turun. ' +
              'Pergerakan stok yang lama tidak diubah — yang ditulis pergerakan baru, supaya riwayatnya tetap bisa ditelusuri.',
            fields: [
              { name: 'qty', label: `Jumlah hasil (${btn.dataset.satuan})`, type: 'qty', required: true, value: btn.dataset.qty },
              { name: 'notes', label: 'Catatan (opsional)', type: 'text', value: btn.dataset.notes }
            ],
            submitText: 'Simpan Perubahan'
          });
          if (!v) return;
          if (!(Number(v.qty) > 0)) return toast('Jumlah hasil harus lebih dari 0.', 'error');
          try {
            await ubahProduksi({ runId: btn.dataset.id, outputQty: Number(v.qty), notes: v.notes });
            toast('Produksi diperbarui — stok ikut dikoreksi.', 'success');
            await loadStock();
            updatePreview();
            await gambarRiwayat();
          } catch (error) {
            toast(error.message ?? 'Gagal mengubah produksi.', 'error');
          }
        })
      )
    );

    // ---- BATALKAN ----
    box.querySelectorAll('.prod-hapus').forEach((btn) =>
      btn.addEventListener(
        'click',
        sekaliJalan(async () => {
          const v = await formDialog({
            title: `Hapus produksi ${btn.dataset.nama}?`,
            description:
              `Hasil ${btn.dataset.qty} ${btn.dataset.satuan} akan dikurangi dari stok, dan bahan yang terpakai DIKEMBALIKAN. ` +
              'Barisnya hilang dari daftar ini, tapi tetap tersimpan di buku besar stok supaya koreksinya bisa ditelusuri.',
            fields: [{ name: 'alasan', label: 'Alasan (opsional)', type: 'text', placeholder: 'mis. salah ketik jumlah' }],
            submitText: 'Hapus & kembalikan stok',
            cancelText: 'Batal'
          });
          if (!v) return;
          const yakin = await confirmDialog({
            title: 'Yakin?',
            message: 'Stok akan langsung berubah dan tindakan ini tidak bisa dibatalkan lagi.',
            confirmText: 'Ya, hapus',
            danger: true
          });
          if (!yakin) return;
          try {
            await hapusProduksi({ runId: btn.dataset.id, alasan: v.alasan });
            toast('Produksi dihapus — stok dikembalikan.', 'success');
            await loadStock();
            updatePreview();
            await gambarRiwayat();
          } catch (error) {
            toast(error.message ?? 'Gagal menghapus produksi.', 'error');
          }
        })
      )
    );
  }

  async function loadStock() {
    try {
      state.stockMap = await getOutletStockMap(businessUnitId, state.outletId);
    } catch {
      state.stockMap = new Map();
    }
  }

  function updatePreview() {
    const product = productById.get(state.productId);
    unitHelp.textContent = product ? `dalam ${product.base_unit} (1 resep menghasilkan ${formatNum(product.yield_qty)} ${product.base_unit})` : '';
    const qty = Number(qtyInput.value);
    if (!product || !(qty > 0)) {
      preview.innerHTML = '';
      return;
    }
    const needs = computeNeeds(product, qty);
    preview.innerHTML = `
      <p style="font-size:0.85rem;font-weight:600;margin:4px 0">Kebutuhan bahan:</p>
      <div class="table-scroll"><table class="data-table table-freeze-1 kartu-sempit">
        <thead><tr><th>Bahan</th><th>Butuh</th><th>Stok</th><th>Cukup?</th></tr></thead>
        <tbody>
          ${needs
            .map((n) => {
              const stok = state.stockMap.get(n.ingredient_product_id) ?? 0;
              const cukup = stok >= n.need;
              return `<tr>
                <td data-label="Bahan">${esc(n.name)}</td>
                <td data-label="Butuh">${formatNum(n.need)} ${esc(n.base_unit)}</td>
                <td data-label="Stok">${formatNum(stok)} ${esc(n.base_unit)}</td>
                <td data-label="Cukup?">${cukup ? '✅' : '<span style="color:var(--color-danger)">kurang</span>'}</td>
              </tr>`;
            })
            .join('')}
        </tbody>
      </table></div>
      ${needs.some((n) => (state.stockMap.get(n.ingredient_product_id) ?? 0) < n.need) ? '<p style="font-size:0.8rem;color:#8a5800">Sebagian bahan kurang — produksi tetap diizinkan, stok bahan bisa jadi minus.</p>' : ''}
    `;
  }

  wireSearchSelect(widget, productOptions, (val) => {
    state.productId = val;
    updatePreview();
  });
  outletSel.addEventListener('change', async () => {
    state.outletId = outletSel.value;
    await loadStock();
    updatePreview();
    await gambarRiwayat();
  });
  qtyInput.addEventListener('input', updatePreview);

  container.querySelector('#prod-submit').addEventListener('click', async (e) => {
    const errorEl = container.querySelector('#prod-error');
    errorEl.textContent = '';
    const product = productById.get(state.productId);
    const qty = Number(qtyInput.value);
    if (!product) {
      errorEl.textContent = 'Pilih produk dulu.';
      return;
    }
    if (!(qty > 0)) {
      errorEl.textContent = 'Isi jumlah hasil yang valid.';
      return;
    }
    e.target.disabled = true;
    try {
      await recordProduction({ businessUnitId, outletId: state.outletId, productId: state.productId, outputQty: qty, notes: container.querySelector('#prod-notes').value });
      toast(`Produksi ${product.name} tercatat. Stok diperbarui.`, 'success');
      qtyInput.value = '';
      container.querySelector('#prod-notes').value = '';
      await loadStock();
      updatePreview();
      await gambarRiwayat();
    } catch (error) {
      errorEl.textContent = error.message ?? 'Gagal mencatat produksi.';
    } finally {
      e.target.disabled = false;
    }
  });

  await loadStock();
  await gambarRiwayat();
}

/** Waktu singkat untuk riwayat — tanggal + jam, tanpa detik. */
function fmtWaktu(iso) {
  return new Date(iso).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function round(n) {
  return Math.round(Number(n) * 100) / 100;
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
