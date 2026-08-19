import { toast } from '../../core/ui.js';
import { formatNum, formatRupiah } from '../../core/format.js';
import { listProducts, listRecipesFull, computeCosts, TYPE_LABEL } from '../product/product.service.js';
import { listStockBalances, listMovements, MOVEMENT_LABEL, amISuperAdmin, getAllowStaffOpname, setAllowStaffOpname } from './inventory.service.js';
import { monthRangeWIB, isoFrom, isoTo } from '../../core/dates.js';
import { listMyOutlets, PESAN_TANPA_OUTLET } from '../../core/my-outlets.js';
import { loadingHtml } from '../../core/loading.js';
import { cocokNama } from '../../core/nama.js';
import { daftarKategori, daftarSubKategori, TANPA_KATEGORI, TANPA_SUB } from '../product/saringan.js';
import { renderOpnameAdmin } from './opname.admin.js';
import { renderNotaAdmin } from './nota.admin.js';
import { renderMenipisAdmin } from './menipis.admin.js';

const TABS = [
  { key: 'stock', label: 'Stok' },
  { key: 'history', label: 'Riwayat' },
  { key: 'nota', label: 'Nota Terima' },
  { key: 'opname', label: 'Opname' },
  { key: 'menipis', label: 'Bahan Menipis' }
];

export async function renderInventoryAdminPage(container, { businessUnitId }) {
  container.innerHTML = `
    <h1>Inventory</h1>
    <div id="inv-opname-setting"></div>
    <div class="tab-bar">
      ${TABS.map((t, i) => `<button class="tab-btn ${i === 0 ? 'active' : ''}" data-tab="${t.key}">${t.label}</button>`).join('')}
    </div>
    <div id="inv-admin-content"></div>
  `;
  const content = document.getElementById('inv-admin-content');
  renderOpnameSetting(container.querySelector('#inv-opname-setting'), businessUnitId);
  const outlets = (await listMyOutlets(businessUnitId).catch(() => [])).map((o) => ({ id: o.id, name: o.name }));
  if (!outlets.length) {
    container.innerHTML = `<h1>Stok</h1><p style="color:var(--color-text-muted)">${PESAN_TANPA_OUTLET}</p>`;
    return;
  }

  async function showTab(key) {
    container.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === key));
    if (key === 'stock') await renderStockTab(content, businessUnitId, outlets);
    if (key === 'history') await renderHistoryTab(content, businessUnitId, outlets);
    if (key === 'nota') await renderNotaAdmin(content, { businessUnitId, outlets });
    if (key === 'opname') await renderOpnameAdmin(content, { businessUnitId, outlets });
    if (key === 'menipis') await renderMenipisAdmin(content, { businessUnitId, outlets });
  }
  container.querySelectorAll('.tab-btn').forEach((btn) => btn.addEventListener('click', () => showTab(btn.dataset.tab)));
  await showTab('stock');
}

async function renderOpnameSetting(el, businessUnitId) {
  let isSuper = false;
  let allow = false;
  try {
    [isSuper, allow] = await Promise.all([amISuperAdmin(), getAllowStaffOpname(businessUnitId)]);
  } catch {
    return;
  }
  if (!isSuper) return; // hanya Super Admin yang lihat & ubah
  el.innerHTML = `
    <div class="inline-card field-check" style="max-width:520px">
      <input type="checkbox" id="chk-opname" ${allow ? 'checked' : ''} />
      <label for="chk-opname" style="margin:0">Izinkan staff melakukan <strong>stok opname</strong> di Staff App (BU ini)</label>
    </div>
  `;
  el.querySelector('#chk-opname').addEventListener('change', async (e) => {
    try {
      await setAllowStaffOpname(businessUnitId, e.target.checked);
      toast(e.target.checked ? 'Opname staff diaktifkan.' : 'Opname staff dimatikan.', 'success');
    } catch (error) {
      e.target.checked = !e.target.checked;
      toast(error.message ?? 'Gagal mengubah (hanya Super Admin).', 'error');
    }
  });
}

// ---- Tab: Stok ----

async function renderStockTab(content, businessUnitId, outlets) {
  content.innerHTML = `
    <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end">
      <div class="field" style="margin:0;max-width:280px">
        <label>Outlet</label>
        <select id="stock-outlet"><option value="">Semua outlet (gabungan)</option>${outlets.map((o) => `<option value="${o.id}">${escapeHtml(o.name)}</option>`).join('')}</select>
      </div>
      <div class="field" style="margin:0;max-width:220px">
        <label>Kategori</label>
        <select id="stock-cat"><option value="">Semua</option></select>
      </div>
      <div class="field" style="margin:0;max-width:220px">
        <label>Sub kategori</label>
        <select id="stock-sub"><option value="">Semua</option></select>
      </div>
      <div class="field" style="margin:0;max-width:240px">
        <label>Cari nama</label>
        <input type="search" id="stock-q" placeholder="ketik nama bahan…" autocomplete="off" />
      </div>
    </div>
    <div id="stock-result">${loadingHtml('Memuat…')}</div>
  `;
  const sel = content.querySelector('#stock-outlet');
  // Penyaring nama & kategori dikerjakan di sisi tampilan; hanya pergantian
  // OUTLET yang perlu memuat ulang dari server, karena itu yang mengubah
  // angkanya. Menunggu jaringan untuk tiap huruf membuat pencarian terasa berat
  // justru saat dipakai menelusuri daftar bahan yang panjang.
  sel.addEventListener('change', () => loadStock(content, businessUnitId, sel.value));
  content.querySelector('#stock-cat').addEventListener('change', () => {
    segarkanSubStok(content);
    gambarStok(content);
  });
  content.querySelector('#stock-sub').addEventListener('change', () => gambarStok(content));
  content.querySelector('#stock-q').addEventListener('input', () => gambarStok(content));
  await loadStock(content, businessUnitId, '');
}

/** Baris stok terakhir yang dimuat — disaring ulang tanpa menyentuh jaringan. */
let barisStok = [];

async function loadStock(content, businessUnitId, outletId) {
  const result = content.querySelector('#stock-result');
  result.innerHTML = loadingHtml('Memuat stok…', { baris: 5 });
  let balances, products, recipes;
  try {
    [balances, products, recipes] = await Promise.all([
      listStockBalances(businessUnitId, outletId || undefined),
      listProducts(businessUnitId),
      listRecipesFull(businessUnitId)
    ]);
  } catch (error) {
    result.innerHTML = `<p class="error-text">${error.message ?? error}</p>`;
    return;
  }
  const costs = computeCosts(products, recipes);
  const productById = new Map(products.map((p) => [p.id, p]));

  const byProduct = new Map();
  for (const b of balances) byProduct.set(b.product_id, (byProduct.get(b.product_id) ?? 0) + Number(b.qty));

  let totalValue = 0;
  const rows = [...byProduct.entries()]
    .map(([pid, qty]) => ({ p: productById.get(pid), qty }))
    .filter((r) => r.p)
    .sort((a, b) => a.p.name.localeCompare(b.p.name));

  barisStok = rows.map((r) => ({ ...r, cost: costs.get(r.p.id) }));

  // Pilihan kategori diisi dari data yang BENAR-BENAR ada stoknya, bukan dari
  // seluruh master produk: kategori yang tidak pernah muncul di daftar hanya
  // menghasilkan filter yang selalu kosong.
  const catSel = content.querySelector('#stock-cat');
  const kategori = daftarKategori(barisStok.map((r) => r.p));
  const terpilih = catSel.value;
  catSel.innerHTML = `<option value="">Semua</option>${kategori.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('')}`;
  catSel.value = kategori.includes(terpilih) ? terpilih : '';

  segarkanSubStok(content);
  gambarStok(content);
}

/**
 * Isi ulang pilihan sub kategori mengikuti kategori yang sedang dipilih.
 *
 * Menawarkan seluruh sub apa pun kategorinya memungkinkan pasangan yang
 * mustahil — "Beverage" + "Unggas" — dan hasilnya tabel kosong yang terbaca
 * sebagai stok yang hilang, bukan saringan yang salah.
 */
function segarkanSubStok(content) {
  const subSel = content.querySelector('#stock-sub');
  if (!subSel) return;
  const cat = content.querySelector('#stock-cat')?.value ?? '';
  const dulu = subSel.value;
  const daftar = daftarSubKategori(barisStok.map((r) => r.p), cat);
  subSel.innerHTML = `<option value="">Semua</option>${daftar.map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('')}`;
  // Pilihan yang sudah tidak berlaku dikosongkan. Membiarkannya akan
  // menyembunyikan seluruh tabel tanpa ada kotak yang terlihat salah.
  subSel.value = daftar.includes(dulu) ? dulu : '';
}

/** Cocok tidaknya satu produk dengan kategori/sub yang dipilih. */
function cocokKategori(p, cat, sub) {
  if (cat) {
    const punya = String(p?.category ?? '').trim();
    if (cat === TANPA_KATEGORI ? punya !== '' : punya !== cat) return false;
  }
  if (sub) {
    const punya = String(p?.subcategory ?? '').trim();
    if (sub === TANPA_SUB ? punya !== '' : punya !== sub) return false;
  }
  return true;
}

function gambarStok(content) {
  const result = content.querySelector('#stock-result');
  if (!result) return;
  const q = content.querySelector('#stock-q')?.value ?? '';
  const cat = content.querySelector('#stock-cat')?.value ?? '';
  const sub = content.querySelector('#stock-sub')?.value ?? '';
  const tampil = barisStok.filter(
    (r) => cocokKategori(r.p, cat, sub) && cocokNama(`${r.p.name} ${r.p.category ?? ''} ${r.p.subcategory ?? ''}`, q)
  );

  let totalValue = 0;
  // Stok minus ditandai di sini juga, dan di layar admin ia bahkan lebih
  // penting: nilai rupiah bahan yang minus ikut NEGATIF, jadi total nilai stok
  // di bawah tampak lebih kecil daripada isi gudang sebenarnya — dan itu angka
  // yang dipakai orang menilai persediaan.
  const jumlahMinus = tampil.filter((r) => Number(r.qty) < 0).length;

  const bodyHtml = tampil
    .map((r) => {
      const value = r.cost != null ? r.cost * r.qty : null;
      if (value != null) totalValue += value;
      const minus = Number(r.qty) < 0;
      return `<tr>
        <td>${escapeHtml(r.p.name)}</td>
        <td>${TYPE_LABEL[r.p.product_type] ?? r.p.product_type}</td>
        <td${minus ? ' style="color:var(--color-danger);font-weight:600"' : ''}>${formatNum(r.qty)}${minus ? ' ⚠' : ''}</td>
        <td>${escapeHtml(r.p.base_unit)}</td>
        <td${minus ? ' style="color:var(--color-danger)"' : ''}>${value != null ? formatRupiah(value) : '-'}</td>
      </tr>`;
    })
    .join('');

  result.innerHTML = `
    <p style="font-size:0.82rem;color:var(--color-text-muted);margin:10px 0 6px">
      ${tampil.length === barisStok.length ? `${barisStok.length} bahan` : `${tampil.length} dari ${barisStok.length} bahan`}
    </p>
    ${
      jumlahMinus
        ? `<p class="error-text" style="margin:0 0 8px;font-size:0.85rem">
             ⚠ ${jumlahMinus} bahan stoknya <strong>minus</strong> — nilainya ikut MENGURANGI total di bawah,
             jadi total nilai stok tampak lebih kecil daripada isi gudang sebenarnya.
             Periksa penerimaan yang belum tercatat, atau isi stok awal lewat Opname.
           </p>`
        : ''
    }
    <div class="table-scroll"><table class="data-table table-freeze-1">
      <thead><tr><th>Produk</th><th>Tipe</th><th>Stok</th><th>Satuan</th><th>Nilai (HPP)</th></tr></thead>
      <tbody>${bodyHtml || '<tr><td colspan="5">Tidak ada bahan pada filter ini.</td></tr>'}</tbody>
    </table></div>
    <p style="margin-top:10px;font-weight:600">
      Total nilai ${tampil.length === barisStok.length ? 'stok' : 'yang tampil'}: ${formatRupiah(totalValue)}
    </p>
  `;
}

// ---- Tab: Riwayat ----

async function renderHistoryTab(content, businessUnitId, outlets) {
  const range = monthRangeWIB();
  content.innerHTML = `
    <div class="inline-card" style="max-width:640px;display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end">
      <div class="field" style="margin:0"><label>Outlet</label>
        <select id="hist-outlet"><option value="">Semua</option>${outlets.map((o) => `<option value="${o.id}">${escapeHtml(o.name)}</option>`).join('')}</select>
      </div>
      <div class="field" style="margin:0"><label>Jenis</label>
        <select id="hist-type"><option value="">Semua</option>${Object.entries(MOVEMENT_LABEL).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
      </div>
      <div class="field" style="margin:0"><label>Kategori</label>
        <select id="hist-cat"><option value="">Semua</option></select>
      </div>
      <div class="field" style="margin:0"><label>Sub kategori</label>
        <select id="hist-sub"><option value="">Semua</option></select>
      </div>
      <div class="field" style="margin:0"><label>Dari</label><input type="date" id="hist-from" value="${range.from}" /></div>
      <div class="field" style="margin:0"><label>Sampai</label><input type="date" id="hist-to" value="${range.to}" /></div>
      <button class="primary" id="hist-go" style="max-width:120px">Tampilkan</button>
    </div>
    <div id="hist-result"></div>
  `;
  // Kategori & sub kategori TIDAK memuat ulang dari jaringan — pergerakannya
  // sudah ada di memori, dan menunggu jaringan untuk tiap pilihan membuat
  // penelusuran terasa berat justru saat dipakai mencari satu bahan.
  const go = () => loadHistory(content, businessUnitId);
  content.querySelector('#hist-go').addEventListener('click', go);
  content.querySelector('#hist-cat').addEventListener('change', () => {
    segarkanSubRiwayat(content);
    gambarRiwayat(content);
  });
  content.querySelector('#hist-sub').addEventListener('change', () => gambarRiwayat(content));
  await go();
}

/** Baris riwayat terakhir yang dimuat, sudah dilengkapi kategori produknya. */
let barisRiwayat = [];

function segarkanSubRiwayat(content) {
  const subSel = content.querySelector('#hist-sub');
  if (!subSel) return;
  const cat = content.querySelector('#hist-cat')?.value ?? '';
  const dulu = subSel.value;
  const daftar = daftarSubKategori(barisRiwayat.map((r) => r.produk).filter(Boolean), cat);
  subSel.innerHTML = `<option value="">Semua</option>${daftar.map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('')}`;
  subSel.value = daftar.includes(dulu) ? dulu : '';
}

async function loadHistory(content, businessUnitId) {
  const outletId = content.querySelector('#hist-outlet').value || '';
  const movementType = content.querySelector('#hist-type').value || '';
  const from = content.querySelector('#hist-from').value;
  const to = content.querySelector('#hist-to').value;
  const result = content.querySelector('#hist-result');
  result.innerHTML = loadingHtml('Memuat…', { baris: 5 });
  let rows, products;
  try {
    // Kategori tidak ikut di baris pergerakan — ia milik produknya. Diambil
    // sekali di sini lalu ditempelkan, supaya penyaringannya bisa dikerjakan
    // di sisi tampilan tanpa menyentuh jaringan lagi.
    [rows, products] = await Promise.all([
      listMovements({ businessUnitId, outletId, movementType, dateFrom: isoFrom(from), dateTo: isoTo(to) }),
      listProducts(businessUnitId)
    ]);
  } catch (error) {
    result.innerHTML = `<p class="error-text">${error.message ?? error}</p>`;
    return;
  }

  const perId = new Map((products ?? []).map((p) => [p.id, p]));
  barisRiwayat = (rows ?? []).map((r) => ({ ...r, produk: perId.get(r.product_id) ?? null }));

  const catSel = content.querySelector('#hist-cat');
  const kategori = daftarKategori(barisRiwayat.map((r) => r.produk).filter(Boolean));
  const terpilih = catSel.value;
  catSel.innerHTML = `<option value="">Semua</option>${kategori.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('')}`;
  catSel.value = kategori.includes(terpilih) ? terpilih : '';

  segarkanSubRiwayat(content);
  gambarRiwayat(content);
}

function gambarRiwayat(content) {
  const result = content.querySelector('#hist-result');
  if (!result) return;
  const cat = content.querySelector('#hist-cat')?.value ?? '';
  const sub = content.querySelector('#hist-sub')?.value ?? '';
  // Pergerakan produk yang sudah TIDAK ADA di master (terhapus) tetap
  // ditampilkan selama tidak ada saringan kategori — buku besar tidak boleh
  // menyembunyikan barisnya hanya karena produknya sudah dihapus.
  const rows = barisRiwayat.filter((r) => (!cat && !sub) || cocokKategori(r.produk, cat, sub));

  result.innerHTML = `
    <table class="data-table" style="margin-top:16px">
      <thead><tr><th>Waktu</th><th>Outlet</th><th>Produk</th><th>Jenis</th><th>Qty</th><th>Oleh</th><th>Catatan</th></tr></thead>
      <tbody>
        ${rows
          .map((r) => {
            const sign = Number(r.qty_delta) >= 0 ? '+' : '';
            const ref = r.ref?.name ? ` → ${escapeHtml(r.ref.name)}` : '';
            return `<tr>
              <td style="font-size:0.8rem">${fmtDateTime(r.created_at)}</td>
              <td>${escapeHtml(r.outlets?.name ?? '-')}</td>
              <td>${escapeHtml(r.products?.name ?? '-')}</td>
              <td>${MOVEMENT_LABEL[r.movement_type] ?? r.movement_type}${ref}</td>
              <td>${sign}${formatNum(r.qty_delta)} ${escapeHtml(r.products?.base_unit ?? '')}</td>
              <td>${escapeHtml(r.user_profiles?.full_name ?? '-')}</td>
              <td style="font-size:0.8rem">${escapeHtml(r.notes ?? '-')}</td>
            </tr>`;
          })
          .join('') || '<tr><td colspan="7">Tidak ada data pada saringan ini.</td></tr>'}
      </tbody>
    </table>
    <p style="font-size:0.82rem;color:var(--color-text-muted);margin:8px 0 0">
      ${rows.length === barisRiwayat.length ? `${barisRiwayat.length} pergerakan` : `${rows.length} dari ${barisRiwayat.length} pergerakan`}
    </p>
  `;
}

function round(n) {
  return Math.round(Number(n) * 100) / 100;
}
function fmtDateTime(iso) {
  return new Date(iso).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
