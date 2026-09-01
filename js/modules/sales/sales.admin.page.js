import { formatNum, formatRupiah } from '../../core/format.js';
import { listSalesReport, listSalesTransaksi, ubahPenjualan, hapusPenjualan, todayWIB } from './sales.service.js';
import { monthRangeWIB } from '../../core/dates.js';
import { listMyOutlets, PESAN_TANPA_OUTLET } from '../../core/my-outlets.js';
import { loadingHtml, sekaliJalan } from '../../core/loading.js';
import { toast, formDialog, confirmDialog } from '../../core/ui.js';

/**
 * Admin Portal — Penjualan.
 *
 * DUA TAB, DUA PERTANYAAN YANG BERBEDA:
 *
 *   Rekap     "menu apa yang laku, berapa omzetnya"  -> diagregat per menu
 *   Transaksi "baris mana yang salah ketik"          -> satu baris per transaksi
 *
 * Sebelum ini hanya ada Rekap, dan itulah sebabnya kesalahan input tidak bisa
 * dibetulkan lewat Admin Portal sama sekali: wewenangnya sudah ada di database
 * sejak 0101 (`boleh_ubah_penjualan` mengizinkan `is_bu_admin` kapan pun), tapi
 * tidak ada baris yang bisa ditekan.
 *
 * Menggabungkan keduanya jadi satu tabel sempat saya pertimbangkan dan saya
 * tolak: yang membaca rekap sedang menilai penjualan, yang membuka transaksi
 * sedang mencari kesalahan. Tabel yang melayani keduanya sekaligus akan penuh
 * kolom yang tidak dipakai separuh pembacanya.
 */
const TAB = [
  { key: 'rekap', label: '📊 Rekap per Menu' },
  { key: 'transaksi', label: '🧾 Transaksi & Koreksi' }
];

export async function renderSalesAdminPage(container, { businessUnitId }) {
  const outlets = (await listMyOutlets(businessUnitId).catch(() => [])).map((o) => ({ id: o.id, name: o.name }));
  if (!outlets.length) {
    container.innerHTML = `<h1>Penjualan</h1><p style="color:var(--color-text-muted)">${PESAN_TANPA_OUTLET}</p>`;
    return;
  }
  const range = monthRangeWIB();
  const state = { tab: 'rekap', outletId: '', from: range.from, to: range.to };

  container.innerHTML = `
    <h1 style="margin-bottom:6px">Penjualan</h1>

    <div class="panel-lengket-atas">
      <div class="tab-bar" id="sr-tabs"></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-top:8px">
        <div class="field" style="margin:0;flex:1;min-width:130px"><label>Outlet</label>
          <select id="sr-outlet"><option value="">Semua</option>${outlets
            .map((o) => `<option value="${o.id}">${esc(o.name)}</option>`)
            .join('')}</select>
        </div>
        <div class="field" style="margin:0;min-width:135px"><label>Dari</label><input type="date" id="sr-from" value="${state.from}" /></div>
        <div class="field" style="margin:0;min-width:135px"><label>Sampai</label><input type="date" id="sr-to" value="${state.to}" /></div>
        <button class="primary" id="sr-go" style="max-width:130px">Tampilkan</button>
      </div>
    </div>
    <div id="sr-result" style="margin-top:8px"></div>
  `;

  const bacaSaringan = () => {
    state.outletId = container.querySelector('#sr-outlet').value || '';
    state.from = container.querySelector('#sr-from').value;
    state.to = container.querySelector('#sr-to').value;
  };

  const muat = async () => {
    bacaSaringan();
    const hasil = container.querySelector('#sr-result');
    hasil.innerHTML = loadingHtml('Memuat…', { baris: 5 });
    try {
      if (state.tab === 'rekap') await gambarRekap(hasil, businessUnitId, state);
      else await gambarTransaksi(hasil, businessUnitId, state, muat);
    } catch (error) {
      hasil.innerHTML = `<p class="error-text">${esc(error.message ?? error)}</p>`;
    }
  };

  const gambarTab = () => {
    container.querySelector('#sr-tabs').innerHTML = TAB.map(
      (t) => `<button class="tab-btn ${t.key === state.tab ? 'active' : ''}" data-tab="${t.key}">${t.label}</button>`
    ).join('');
    container.querySelectorAll('#sr-tabs [data-tab]').forEach((b) =>
      b.addEventListener('click', () => {
        state.tab = b.dataset.tab;
        gambarTab();
        muat();
      })
    );
  };

  container.querySelector('#sr-go').addEventListener('click', muat);
  gambarTab();
  await muat();
}

// =====================================================================
// TAB 1 — REKAP PER MENU (tidak berubah dari sebelumnya)
// =====================================================================
async function gambarRekap(hasil, businessUnitId, state) {
  const rows = await listSalesReport({
    businessUnitId,
    outletId: state.outletId,
    dateFrom: state.from || '',
    dateTo: state.to || ''
  });

  const byProduct = new Map();
  let totalRevenue = 0;
  let totalQty = 0;
  for (const r of rows) {
    const key = r.product_id;
    const cur = byProduct.get(key) ?? { name: r.products?.name ?? '-', category: r.products?.category ?? '-', qty: 0, revenue: 0 };
    cur.qty += Number(r.qty) || 0;
    cur.revenue += Number(r.revenue) || 0;
    byProduct.set(key, cur);
    totalRevenue += Number(r.revenue) || 0;
    totalQty += Number(r.qty) || 0;
  }
  const list = [...byProduct.values()].sort((a, b) => b.revenue - a.revenue);

  hasil.innerHTML = `
    <p style="margin:6px 0;font-weight:600">Total: ${formatNum(totalQty)} menu terjual · Omzet ${formatRupiah(totalRevenue)}</p>
    <div class="table-scroll gulir-baris" style="--tinggi-baris:38px"><table class="data-table table-freeze-1">
      <thead><tr><th>Menu</th><th>Kategori</th><th>Terjual</th><th>Omzet</th></tr></thead>
      <tbody>
        ${
          list
            .map(
              (p) =>
                `<tr><td>${esc(p.name)}</td><td>${esc(p.category)}</td><td>${formatNum(p.qty)}</td><td>${formatRupiah(p.revenue)}</td></tr>`
            )
            .join('') || '<tr><td colspan="4">Tidak ada data.</td></tr>'
        }
      </tbody>
    </table></div>
  `;
}

// =====================================================================
// TAB 2 — TRANSAKSI & KOREKSI
// =====================================================================
async function gambarTransaksi(hasil, businessUnitId, state, muatUlang) {
  const rows = await listSalesTransaksi({
    businessUnitId,
    outletId: state.outletId,
    dateFrom: state.from || '',
    dateTo: state.to || ''
  });

  const hariIni = todayWIB();
  const dikoreksi = rows.filter((r) => r.dikoreksi_at).length;

  hasil.innerHTML = `
    <p class="report-note" style="margin:6px 0 10px">
      <strong>${rows.length} transaksi</strong> pada rentang ini${
        dikoreksi ? ` · <strong>${dikoreksi}</strong> pernah dikoreksi` : ''
      }.
      <br /><br />
      Mengubah jumlah <strong>ikut mengoreksi stok bahan</strong> sesuai resep — mengurangi jumlah mengembalikan
      bahannya, menghapus mengembalikan seluruhnya.
      <strong>Harga tidak dihitung ulang</strong>: yang dipakai tetap harga saat transaksi dicatat, supaya omzet
      periode yang sudah lewat tidak bergeser sendiri.
      <br /><br />
      Untuk transaksi <strong>tanggal lampau</strong>, alasan koreksi wajib diisi dan akan tersimpan.
    </p>
    <div class="table-scroll gulir-baris" style="--tinggi-baris:52px">
      <table class="data-table table-freeze-1 kartu-sempit">
        <thead><tr>
          <th>Tanggal</th><th>Outlet</th><th>Menu</th><th>Jumlah</th><th>Omzet</th><th>Dicatat</th><th>Aksi</th>
        </tr></thead>
        <tbody>
          ${
            rows
              .map((r) => {
                const lampau = r.sale_date < hariIni;
                return `<tr>
                  <td data-label="Tanggal" style="white-space:nowrap;font-size:0.82rem">${esc(r.sale_date)}</td>
                  <td data-label="Outlet">${esc(r.outlets?.name ?? '-')}</td>
                  <td data-label="Menu">${esc(r.products?.name ?? '(menu terhapus)')}</td>
                  <td data-label="Jumlah" style="text-align:right">
                    ${formatNum(r.qty)}
                    ${
                      // JUMLAH SEMULA DITAMPILKAN, bukan cuma disimpan.
                      //
                      // Angka yang pernah diubah harus mengatakannya sendiri di
                      // tempat ia dibaca. Kalau jejaknya cuma ada di database,
                      // "kok omzet Selasa beda dari yang saya catat" tetap tidak
                      // bisa dijawab tanpa membuka SQL.
                      r.dikoreksi_at
                        ? `<div class="sr-jejak">semula ${formatNum(r.qty_awal ?? r.qty)}</div>`
                        : ''
                    }
                  </td>
                  <td data-label="Omzet" style="text-align:right">${formatRupiah(r.revenue)}</td>
                  <td data-label="Dicatat" style="font-size:0.78rem">
                    ${esc(r.pencatat?.full_name ?? '-')}
                    ${
                      r.dikoreksi_at
                        ? `<div class="sr-jejak">✎ dikoreksi ${esc(r.pengoreksi?.full_name ?? 'admin')}
                             · ${new Date(r.dikoreksi_at).toLocaleDateString('id-ID', { day: '2-digit', month: 'short' })}
                             ${r.dikoreksi_alasan ? `<br />“${esc(r.dikoreksi_alasan)}”` : ''}</div>`
                        : ''
                    }
                  </td>
                  <td data-label="Aksi" style="white-space:nowrap">
                    <button class="sr-edit" data-id="${r.id}" data-qty="${r.qty}"
                      data-menu="${esc(r.products?.name ?? '-')}" data-tgl="${esc(r.sale_date)}"
                      data-lampau="${lampau ? '1' : ''}">Ubah</button>
                    <button class="sr-del" data-id="${r.id}"
                      data-menu="${esc(r.products?.name ?? '-')}" data-qty="${r.qty}" data-tgl="${esc(r.sale_date)}"
                      data-lampau="${lampau ? '1' : ''}">Hapus</button>
                  </td>
                </tr>`;
              })
              .join('') || '<tr><td colspan="7">Tidak ada transaksi pada rentang ini.</td></tr>'
          }
        </tbody>
      </table>
    </div>
  `;

  hasil.querySelectorAll('.sr-edit').forEach((btn) =>
    btn.addEventListener(
      'click',
      sekaliJalan(async () => {
        const lampau = btn.dataset.lampau === '1';
        const values = await formDialog({
          title: `Ubah ${btn.dataset.menu}`,
          description: `Penjualan ${btn.dataset.tgl}. Stok bahan ikut dikoreksi sesuai resep. Harga tetap harga saat transaksi dicatat.`,
          fields: [
            { name: 'qty', label: 'Jumlah terjual', type: 'number', required: true, min: 1, step: 'any', value: btn.dataset.qty },
            // ALASAN HANYA MUNCUL SAAT MEMANG DIWAJIBKAN.
            //
            // Kotak yang selalu ada tapi cuma kadang wajib akan diisi
            // seadanya ("-", "koreksi") sampai isinya berhenti berarti.
            ...(lampau
              ? [
                  {
                    name: 'alasan',
                    label: 'Alasan koreksi (wajib — tanggal ini sudah masuk rekap)',
                    type: 'text',
                    required: true,
                    placeholder: 'mis. salah ketik nol, seharusnya 15'
                  }
                ]
              : [])
          ],
          submitText: 'Simpan Koreksi'
        });
        if (!values) return;
        try {
          const hasilUbah = await ubahPenjualan(btn.dataset.id, values.qty, values.alasan ?? null);
          toast(
            hasilUbah?.berubah === false
              ? 'Jumlahnya sama, tidak ada yang diubah.'
              : hasilUbah?.stok_disesuaikan === false
                ? 'Penjualan dikoreksi. Stok TIDAK ikut berubah — menu ini belum punya resep.'
                : 'Penjualan dikoreksi. Stok bahan ikut disesuaikan.',
            hasilUbah?.stok_disesuaikan === false ? 'warning' : 'success'
          );
          await muatUlang();
        } catch (error) {
          toast(error.message ?? 'Gagal mengoreksi penjualan.', 'error');
        }
      })
    )
  );

  hasil.querySelectorAll('.sr-del').forEach((btn) =>
    btn.addEventListener(
      'click',
      sekaliJalan(async () => {
        const lampau = btn.dataset.lampau === '1';
        let alasan = null;
        if (lampau) {
          const v = await formDialog({
            title: `Hapus penjualan ${btn.dataset.menu}?`,
            description: `${btn.dataset.qty} porsi pada ${btn.dataset.tgl}. Seluruh bahannya dikembalikan ke stok.`,
            fields: [
              {
                name: 'alasan',
                label: 'Alasan penghapusan (wajib — tanggal ini sudah masuk rekap)',
                type: 'text',
                required: true,
                placeholder: 'mis. dobel input dengan shift pagi'
              }
            ],
            submitText: 'Hapus Penjualan',
            danger: true
          });
          if (!v) return;
          alasan = v.alasan;
        } else {
          const ok = await confirmDialog({
            title: `Hapus penjualan ${btn.dataset.menu}?`,
            message: `${btn.dataset.qty} porsi pada ${btn.dataset.tgl}. Seluruh bahannya dikembalikan ke stok.`,
            confirmText: 'Hapus',
            danger: true
          });
          if (!ok) return;
        }
        try {
          const hasilHapus = await hapusPenjualan(btn.dataset.id, alasan);
          toast(
            hasilHapus?.stok_dikembalikan === false
              ? 'Penjualan dihapus. Stok tidak berubah — menu ini belum punya resep.'
              : 'Penjualan dihapus. Stok bahan dikembalikan.',
            'success'
          );
          await muatUlang();
        } catch (error) {
          toast(error.message ?? 'Gagal menghapus penjualan.', 'error');
        }
      })
    )
  );
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
