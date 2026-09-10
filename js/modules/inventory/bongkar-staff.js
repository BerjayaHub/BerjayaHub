/**
 * Layar "Bongkar Bahan" — membuka bahan setengah jadi kembali jadi bahan
 * bakunya (0134).
 *
 * ============ BENTUKNYA MENGIKUTI KENYATAAN FISIK ============
 *
 * Resepnya ditampilkan sebagai daftar dengan jumlah TERISI OTOMATIS sebesar
 * porsinya, tapi tiap baris bisa diubah atau dinolkan. Alasannya bukan
 * fleksibilitas: UDANG PACK berisi udang + tepung + bumbu, dan udangnya bisa
 * dipisahkan sementara tepung yang sudah menempel tidak.
 *
 * Mengembalikan seluruh resep secara otomatis akan menambah stok tepung yang
 * sebenarnya sudah terbuang — dan angka itu terlihat persis seperti stok yang
 * sungguhan.
 *
 * ============ BATASNYA DISEBUT DI SEBELAH KOTAKNYA ============
 *
 * Tiap baris menyebut "maks N" di sampingnya. Server menolak yang melebihi
 * (0134), tapi penolakan yang datang sesudah seluruh form diisi memaksa orang
 * menebak baris mana yang salah. Angkanya ada di depan mata sejak awal.
 */

import { toast, formDialog, confirmDialog } from '../../core/ui.js';
import { loadingHtml, sekaliJalan } from '../../core/loading.js';
import { formatNum } from '../../core/format.js';
import { porsiBongkar, periksaBongkar, pesanStok } from './bongkar.js';
import { bongkarBahan, batalkanBongkar, riwayatBongkar } from './inventory.service.js';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const fmtWaktu = (t) =>
  t ? new Date(t).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '-';

/**
 * @param {HTMLElement} wadah
 * @param {object} o
 * @param {string} o.businessUnitId
 * @param {string} o.outletId
 * @param {Array} o.products  seluruh produk BU (untuk nama & satuan)
 * @param {Array} o.recipes   hasil `listRecipesFull` — {product_id, yield_qty, items[]}
 * @param {Map<string, number>} o.stockMap  stok outlet ini
 * @param {() => void} [o.sesudah] dipanggil setelah stok berubah
 */
export function renderBongkarStaff(wadah, { businessUnitId, outletId, products, recipes, stockMap, sesudah }) {
  const produkById = new Map(products.map((p) => [p.id, p]));
  const resepByProduk = new Map((recipes ?? []).map((r) => [r.product_id, r]));

  // HANYA yang punya resep DAN bahannya. Produk tanpa resep tidak punya
  // "isi" yang bisa dikembalikan, dan menawarkannya cuma menghasilkan
  // penolakan server yang tidak bisa ditindaklanjuti siapa pun.
  const bisaDibongkar = products
    .filter((p) => p.is_active !== false && p.product_type !== 'finished')
    .filter((p) => {
      const r = resepByProduk.get(p.id);
      return r && Number(r.yield_qty) > 0 && Array.isArray(r.items) && r.items.length > 0;
    })
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));

  if (!bisaDibongkar.length) {
    wadah.innerHTML = `
      <div class="inline-card">
        <h3 style="margin-top:0;font-size:0.95rem">Bongkar Bahan</h3>
        <p style="color:var(--color-text-muted);font-size:0.88rem;margin:0">
          Belum ada bahan setengah jadi yang punya resep. Resep itulah yang menyatakan
          <em>apa isi</em> sebuah pack — tanpa itu tidak ada yang bisa dikembalikan.
          Isi resepnya dulu di <strong>Master Produk</strong>.
        </p>
      </div>`;
    return;
  }

  wadah.innerHTML = `
    <div class="inline-card">
      <h3 style="margin-top:0;font-size:0.95rem">🔧 Bongkar Bahan Setengah Jadi</h3>
      <p class="report-note" style="margin:0 0 10px">
        Membuka kembali bahan setengah jadi jadi bahan bakunya — <strong>UDANG PACK</strong> dibongkar,
        stoknya berkurang dan <strong>udangnya kembali</strong>. Ini kejadian baru, bukan pembatalan produksi:
        packnya boleh saja datang dari kiriman CK.
        <br /><br />
        Isi jumlah <strong>hanya untuk bahan yang benar-benar bisa dipisahkan</strong>. Yang sudah tercampur
        — tepung yang menempel, bumbu yang meresap — biarkan <strong>0</strong>.
      </p>

      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">
        <div class="field" style="margin:0;flex:2;min-width:180px">
          <label>Bahan yang dibongkar</label>
          <select id="bkr-produk">${bisaDibongkar
            .map((p) => `<option value="${p.id}">${esc(p.name)} (${esc(p.base_unit ?? '')})</option>`)
            .join('')}</select>
        </div>
        <div class="field" style="margin:0;flex:1;min-width:110px">
          <label>Jumlah</label>
          <input type="number" id="bkr-qty" min="0" step="any" placeholder="0" />
        </div>
      </div>
      <p id="bkr-stok" style="font-size:0.8rem;margin:6px 0 0"></p>

      <div id="bkr-hasil" style="margin-top:10px"></div>

      <div class="field" style="margin-top:10px"><label>Catatan (opsional)</label><input type="text" id="bkr-notes" /></div>
      <button class="primary" id="bkr-simpan" style="max-width:240px">Bongkar sekarang</button>
      <p class="error-text" id="bkr-error"></p>
    </div>

    <div class="inline-card" style="margin-top:12px">
      <h3 style="margin-top:0;font-size:0.95rem">Riwayat bongkar</h3>
      <div id="bkr-riwayat">${loadingHtml('Memuat…', { baris: 2 })}</div>
    </div>
  `;

  const produkSel = wadah.querySelector('#bkr-produk');
  const qtyEl = wadah.querySelector('#bkr-qty');
  const hasilEl = wadah.querySelector('#bkr-hasil');
  const stokEl = wadah.querySelector('#bkr-stok');
  const errorEl = wadah.querySelector('#bkr-error');

  /** Gambar ulang daftar bahan hasil bongkar sesuai produk & jumlahnya. */
  function gambarBaris() {
    const pid = produkSel.value;
    const qty = Number(qtyEl.value);
    const p = produkById.get(pid);
    const resep = resepByProduk.get(pid);

    // Peringatan stok — MEMPERINGATKAN, bukan menghalangi. Konsisten dengan
    // produksi (0020), kiriman, dan penjualan.
    const pesan = pesanStok(p?.name, stockMap.get(pid) ?? 0, qty, p?.base_unit);
    stokEl.innerHTML = pesan
      ? `<span style="color:var(--color-danger)">${esc(pesan)}</span>`
      : `<span style="color:var(--color-text-muted)">Stok sekarang: ${formatNum(stockMap.get(pid) ?? 0)} ${esc(p?.base_unit ?? '')}</span>`;

    const porsi = porsiBongkar(resep, qty);
    if (!porsi.size) {
      hasilEl.innerHTML =
        '<p style="color:var(--color-text-muted);font-size:0.85rem;margin:0">Isi jumlahnya dulu untuk melihat bahan apa saja yang bisa kembali.</p>';
      return;
    }

    hasilEl.innerHTML = `
      <!-- baris-sejajar SAJA, tanpa kartu-sempit. Keduanya mengatur display sel
           yang sama, dan yang menang ditentukan urutan di stylesheet, bukan niat
           penulisnya. Tabel berisi kotak isian memakai baris-sejajar, sama
           dengan tabel Order Masuk di modul Pengiriman.
           (Tanpa tanda kutip miring di komentar ini: satu backtick di dalam
           template literal mengakhiri literalnya, dan itu sudah menggigit lima
           kali di repo ini.) -->
      <div class="table-scroll"><table class="data-table baris-sejajar">
        <thead><tr><th>Bahan baku</th><th>Maksimal</th><th>Kembali ke stok</th></tr></thead>
        <tbody>${[...porsi.entries()]
          .map(([bpid, maks]) => {
            const b = produkById.get(bpid);
            return `<tr>
              <td data-label="Bahan">${esc(b?.name ?? '(produk terhapus)')}</td>
              <td data-label="Maksimal" style="color:var(--color-text-muted)">${formatNum(maks)} ${esc(b?.base_unit ?? '')}</td>
              <td data-label="Kembali"><input type="number" class="bkr-item isian-sempit" min="0" step="any"
                    data-product="${bpid}" data-maks="${maks}" value="${maks}" /></td>
            </tr>`;
          })
          .join('')}</tbody>
      </table></div>
      <p style="font-size:0.78rem;color:var(--color-text-muted);margin:6px 0 0">
        Nolkan baris yang bahannya sudah tidak bisa dipisahkan lagi.
      </p>`;
  }

  produkSel.addEventListener('change', gambarBaris);
  qtyEl.addEventListener('input', gambarBaris);
  gambarBaris();

  wadah.querySelector('#bkr-simpan').addEventListener(
    'click',
    sekaliJalan(async () => {
      errorEl.textContent = '';
      const pid = produkSel.value;
      const qty = Number(qtyEl.value);
      const p = produkById.get(pid);
      if (!qty || qty <= 0) {
        errorEl.textContent = 'Isi dulu berapa yang dibongkar.';
        return;
      }

      const pilihan = [...wadah.querySelectorAll('.bkr-item')].map((el) => ({
        product_id: el.dataset.product,
        qty: el.value.trim() === '' ? 0 : Number(el.value)
      }));
      const { boleh, masalah } = periksaBongkar(resepByProduk.get(pid), qty, pilihan);

      // Diperiksa DI SINI dengan rumus yang sama dengan server, supaya
      // penolakannya tidak datang sesudah tombol ditekan.
      if (masalah.length) {
        const m = masalah[0];
        errorEl.textContent =
          m.sebab === 'lebih'
            ? `${produkById.get(m.product_id)?.name ?? 'Bahan itu'} paling banyak ${formatNum(m.maks)} dari ${formatNum(qty)} ${p?.name ?? ''} — itu isinya menurut resep.`
            : `${produkById.get(m.product_id)?.name ?? 'Bahan itu'} bukan bahan dari ${p?.name ?? 'produk ini'}.`;
        return;
      }
      if (!boleh.length) {
        errorEl.textContent =
          'Tidak ada bahan yang dikembalikan. Kalau packnya memang dibuang, pakai Waste — bukan Bongkar.';
        return;
      }

      const daftar = boleh
        .map((b) => `${produkById.get(b.product_id)?.name ?? '?'} ${formatNum(b.qty)} ${produkById.get(b.product_id)?.base_unit ?? ''}`)
        .join(', ');
      const ok = await confirmDialog({
        title: `Bongkar ${formatNum(qty)} ${p?.base_unit ?? ''} ${p?.name ?? ''}?`,
        message: `Stok ${p?.name ?? 'produk'} berkurang ${formatNum(qty)}, dan yang kembali:\n\n${daftar}`,
        confirmText: 'Ya, bongkar'
      });
      if (!ok) return;

      try {
        await bongkarBahan({
          outletId,
          productId: pid,
          qty,
          items: boleh,
          notes: wadah.querySelector('#bkr-notes').value
        });
      } catch (e) {
        errorEl.textContent = e.message ?? 'Gagal membongkar.';
        return;
      }
      toast(`${p?.name ?? 'Bahan'} dibongkar. Stok bahan bakunya sudah bertambah.`, 'success');
      qtyEl.value = '';
      wadah.querySelector('#bkr-notes').value = '';
      gambarBaris();
      muatRiwayat();
      sesudah?.();
    })
  );

  async function muatRiwayat() {
    const box = wadah.querySelector('#bkr-riwayat');
    let daftar = [];
    try {
      daftar = await riwayatBongkar(businessUnitId, outletId);
    } catch (e) {
      box.innerHTML = `<p class="error-text">${esc(e.message ?? e)}</p>`;
      return;
    }
    if (!daftar.length) {
      box.innerHTML = '<p style="color:var(--color-text-muted);font-size:0.85rem;margin:0">Belum ada bongkar di outlet ini.</p>';
      return;
    }
    box.innerHTML = `
      <div class="table-scroll"><table class="data-table kartu-sempit">
        <thead><tr><th>Nomor</th><th>Bahan</th><th>Jumlah</th><th>Waktu</th><th>Aksi</th></tr></thead>
        <tbody>${daftar
          .map((b) => {
            const batal = !!b.dibatalkan_at;
            return `<tr${batal ? ' class="nota-baris-batal"' : ''}>
              <td data-label="Nomor" style="font-family:ui-monospace,Menlo,monospace;font-size:0.78rem">${esc(b.code ?? '-')}</td>
              <td data-label="Bahan">${esc(b.products?.name ?? '-')}${
                batal
                  ? `<div style="font-size:0.72rem;color:var(--color-danger)">dibatalkan${b.alasan_batal ? ': ' + esc(b.alasan_batal) : ''}</div>`
                  : ''
              }</td>
              <td data-label="Jumlah">${formatNum(b.qty)} ${esc(b.products?.base_unit ?? '')}</td>
              <td data-label="Waktu" style="font-size:0.78rem">${fmtWaktu(b.created_at)}<div style="color:var(--color-text-muted)">${esc(
                b.user_profiles?.full_name ?? ''
              )}</div></td>
              <td data-label="Aksi">${
                batal
                  ? '<span style="font-size:0.78rem;color:var(--color-text-muted)">—</span>'
                  : `<button class="btn-danger bkr-batal" data-id="${b.id}" data-code="${esc(b.code ?? '')}">Batalkan</button>`
              }</td>
            </tr>`;
          })
          .join('')}</tbody>
      </table></div>`;

    box.querySelectorAll('.bkr-batal').forEach((btn) =>
      btn.addEventListener(
        'click',
        sekaliJalan(async () => {
          const isian = await formDialog({
            title: `Batalkan bongkar ${btn.dataset.code}?`,
            description:
              'Packnya kembali ke stok, dan bahan baku yang tadi dikembalikan ditarik lagi.\n\n' +
              'Catatan bongkarnya tidak dihapus — ia tetap ada di riwayat, ditandai dibatalkan beserta alasanmu.',
            fields: [{ name: 'alasan', label: 'Alasan pembatalan', type: 'text', value: '', placeholder: 'mis. salah input jumlah' }],
            submitText: 'Ya, batalkan',
            danger: true
          });
          if (!isian) return;
          if (!String(isian.alasan ?? '').trim()) {
            toast('Sebutkan alasan pembatalannya.', 'warning');
            return;
          }
          try {
            await batalkanBongkar(btn.dataset.id, isian.alasan);
            toast(`Bongkar ${btn.dataset.code} dibatalkan.`, 'success');
          } catch (e) {
            toast(e.message ?? 'Gagal membatalkan.', 'error');
            return;
          }
          muatRiwayat();
          sesudah?.();
        })
      )
    );
  }

  muatRiwayat();
}
