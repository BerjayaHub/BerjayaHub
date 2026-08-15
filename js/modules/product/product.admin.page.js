import { toast, confirmDialog, formDialog, renderSearchSelect, wireSearchSelect, infoDialog } from '../../core/ui.js';
import { formatRupiah, formatNum } from '../../core/format.js';
import { sayaAdminBu } from '../../core/base-scope.js';
import { bakukanNama } from '../../core/nama.js';
import { pemakaiResep } from './recipe-graph.js';
import { periksaPindah, pasanganVarian } from './varian-pindah.js';
import { curigaHargaTertukar } from './harga-curiga.js';
import { cocokSaringan, daftarKategori } from './saringan.js';
import { susunBukuResep } from './buku-resep.js';
import { susunPanelBahan } from './panel-bahan.js';
import { exportTablePDF } from '../../core/pdf.js';
import { exportTableXLSX } from '../../core/xlsx.js';
import { importProducts, importRecipes, downloadProductTemplate, downloadRecipeTemplate } from './product-import.js';
import { openRecipeEditor, MODE_LABEL, modesForType } from './recipe-editor.js';
import {
  PRODUCT_TYPES,
  TYPE_LABEL,
  listProducts,
  createProduct,
  updateProduct,
  deleteProduct,
  deleteRecipe,
  getRecipeForProduct,
  saveRecipe,
  listRecipesFull,
  computeCosts,
  costForMode,
  sebabHppKosong,
  sebabBahan,
  pindahVarianResep,
  listUnits,
  createUnit,
  deleteUnit,
  distinctCategories
} from './product.service.js';
import { loadingHtml, sekaliJalan } from '../../core/loading.js';

const TABS = [
  { key: 'products', label: 'Produk' },
  { key: 'recipes', label: 'Resep' },
  { key: 'units', label: 'Satuan' }
];


export async function renderMasterProductPage(container, { businessUnitId, layarAwal = null, catatLayar = null }) {
  // Tab yang dipulihkan diperiksa dulu masih dikenal — `layarAwal` datang dari
  // sessionStorage dan bisa berasal dari versi aplikasi yang lebih lama.
  const awal = TABS.some((t) => t.key === layarAwal) ? layarAwal : TABS[0].key;
  container.innerHTML = `
    <h1>Master Produk</h1>
    <div class="tab-bar">
      ${TABS.map((t) => `<button class="tab-btn ${t.key === awal ? 'active' : ''}" data-tab="${t.key}">${t.label}</button>`).join('')}
    </div>
    <div id="mp-content"></div>
  `;
  const content = document.getElementById('mp-content');
  async function showTab(key) {
    container.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === key));
    catatLayar?.(key);
    if (key === 'products') await renderProductsTab(content, businessUnitId);
    if (key === 'recipes') await renderRecipesTab(content, businessUnitId);
    if (key === 'units') await renderUnitsTab(content);
  }
  container.querySelectorAll('.tab-btn').forEach((btn) => btn.addEventListener('click', () => showTab(btn.dataset.tab)));
  await showTab(awal);
}

async function loadProductsAndCosts(businessUnitId) {
  const [products, recipes] = await Promise.all([listProducts(businessUnitId), listRecipesFull(businessUnitId)]);
  const costs = computeCosts(products, recipes);
  return { products, recipes, costs };
}

// ---- Tab: Produk ----

async function renderProductsTab(content, businessUnitId) {
  content.innerHTML = loadingHtml('Memuat produk…', { baris: 5 });
  let data;
  try {
    data = await loadProductsAndCosts(businessUnitId);
  } catch (error) {
    content.innerHTML = `<p class="error-text">${error.message ?? error}</p>`;
    return;
  }
  const { products, costs } = data;

  content.innerHTML = `
    <div class="page-header">
      <h2 style="font-size:1.05rem;margin:0">Produk</h2>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button id="btn-tpl-product">Template</button>
        <button id="btn-import-product">Import Excel</button>
        <button class="primary" id="btn-new-product" style="max-width:180px">+ Tambah Produk</button>
      </div>
    </div>
    ${saringanHtml({
      id: 'produk',
      placeholder: 'Cari nama produk…',
      tipeOpsi: PRODUCT_TYPES.map((t) => TYPE_LABEL[t.value] ?? t.value),
      kategoriOpsi: daftarKategori(products)
    })}
    <div class="table-scroll"><table class="data-table table-freeze-1">
      <thead><tr><th>Nama</th><th>Tipe</th><th>Kategori</th><th>Satuan</th><th>Harga Beli</th><th>HPP / Satuan</th><th>Harga Jual</th><th>Margin</th><th>Aksi</th></tr></thead>
      <tbody id="baris-produk">
        ${products.map((p) => productRowHtml(p, costs.get(p.id))).join('') || '<tr><td colspan="9">Belum ada produk.</td></tr>'}
      </tbody>
    </table></div>
  `;

  // Penyaring dikerjakan DI SISI TAMPILAN, bukan dengan memuat ulang dari
  // server: daftar produknya sudah ada di memori, dan menunggu jaringan untuk
  // tiap huruf yang diketik membuat pencarian terasa berat justru saat dipakai
  // untuk menelusuri daftar yang panjang.
  pasangPenyaring({
    input: content.querySelector('#cari-produk'),
    tipeSel: content.querySelector('#tipe-produk'),
    katSel: content.querySelector('#kat-produk'),
    info: content.querySelector('#cari-produk-info'),
    baris: () => content.querySelectorAll('#baris-produk tr[data-nama]'),
    satuan: 'produk'
  });
  document.getElementById('btn-new-product').addEventListener('click', () => openProductDialog(content, businessUnitId, null));
  document.getElementById('btn-tpl-product').addEventListener('click', downloadProductTemplate);
  document.getElementById('btn-import-product').addEventListener('click', () =>
    openImport(content, businessUnitId, 'products', () => renderProductsTab(content, businessUnitId))
  );
  content.querySelectorAll('.btn-edit-product').forEach((btn) =>
    btn.addEventListener('click', () => openProductDialog(content, businessUnitId, JSON.parse(btn.dataset.json)))
  );
  content.querySelectorAll('.btn-del-product').forEach((btn) =>
    btn.addEventListener('click', sekaliJalan(async () => {
      const ok = await confirmDialog({ title: 'Hapus produk?', message: 'Produk & resep terkait akan terhapus. Bahan yang masih dipakai resep lain tidak bisa dihapus.', confirmText: 'Hapus', danger: true });
      if (!ok) return;
      try {
        await deleteProduct(btn.dataset.id);
        toast('Produk dihapus.', 'success');
        await renderProductsTab(content, businessUnitId);
      } catch (error) {
        toast(error.message ?? 'Gagal menghapus (mungkin masih dipakai resep lain).', 'error');
      }
    }))
  );
}

/**
 * Sambungkan kotak pencarian ke baris tabel.
 *
 * Mencocokkan pakai `bakukanNama()` yang sama dengan impor: orang mengetik
 * "gula pasir" untuk mencari "Gula  Pasir", dan penyaring yang gagal karena
 * spasi ganda akan membuatnya menyimpulkan produknya tidak ada — persis
 * kesalahan yang sama yang membuat impor menolak bahan yang jelas ada.
 *
 * Baris yang tersembunyi tetap ADA di DOM, jadi tombol yang sudah tersambung
 * tidak perlu dipasang ulang setiap kali orangnya mengetik satu huruf.
 */
function pasangPenyaring({ input, tipeSel, katSel, info, baris, satuan, sesudah }) {
  if (!input && !tipeSel && !katSel) return;
  const saring = () => {
    const nilai = {
      nama: bakukanNama(input?.value ?? ''),
      tipe: tipeSel?.value ?? '',
      kategori: katSel?.value ?? ''
    };
    const adaSaringan = Boolean(nilai.nama || nilai.tipe || nilai.kategori);
    let tampil = 0;
    let total = 0;
    for (const tr of baris()) {
      total++;
      const cocok = cocokSaringan({ nama: tr.dataset.nama, tipe: tr.dataset.tipe, kategori: tr.dataset.kategori }, nilai);
      tr.hidden = !cocok;
      if (cocok) tampil++;
    }
    if (info) {
      // Saat tidak ada yang cocok, penyebabnya disebut — bukan cuma "0 produk".
      // Tanpa itu, saringan tipe yang tertinggal aktif dari pencarian
      // sebelumnya terlihat persis seperti data yang hilang.
      info.textContent = !adaSaringan
        ? `${total} ${satuan}`
        : tampil
          ? `${tampil} dari ${total} ${satuan}`
          : `Tidak ada ${satuan} yang cocok dengan saringan ini — kosongkan salah satunya untuk memperluas pencarian`;
    }
    // Baris rincian yang sedang terbuka ikut disembunyikan bersama induknya;
    // itu urusan pemanggilnya, karena bentuk barisnya berbeda tiap tabel.
    sesudah?.();
  };
  input?.addEventListener('input', saring);
  tipeSel?.addEventListener('change', saring);
  katSel?.addEventListener('change', saring);
  saring();
}

/** Kotak saringan yang sama bentuknya di tab Produk & tab Resep. */
function saringanHtml({ id, tipeOpsi, kategoriOpsi, placeholder }) {
  const opsi = (daftar) => daftar.map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
  return `
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin:0 0 10px">
      <div class="field" style="margin:0;min-width:200px;flex:1 1 200px">
        <input type="search" id="cari-${id}" placeholder="${escapeHtml(placeholder)}" autocomplete="off" />
      </div>
      <div class="field" style="margin:0;min-width:150px">
        <select id="tipe-${id}"><option value="">Semua tipe</option>${opsi(tipeOpsi)}</select>
      </div>
      <div class="field" style="margin:0;min-width:150px">
        <select id="kat-${id}"><option value="">Semua kategori</option>${opsi(kategoriOpsi)}</select>
      </div>
    </div>
    <span class="field-help" id="cari-${id}-info" style="display:block;margin:-6px 0 10px"></span>
  `;
}

/**
 * Konfirmasi hapus satu varian resep — menyebut apa saja yang ikut terdampak.
 *
 * HPP dihitung BERANTAI. Menghapus resep "Produksi" sebuah setengah jadi
 * membuat biayanya tidak diketahui, dan semua menu yang memakainya ikut
 * kehilangan HPP — diam-diam, di layar lain. Konfirmasi yang cuma bertanya
 * "yakin hapus?" tidak menambah apa pun yang belum diketahui orangnya; yang
 * berguna adalah daftar nama yang akan ikut kosong.
 */
async function konfirmasiHapusResep({ produk, mode, products, recipes, label }) {
  const terdampak = pemakaiResep(products, recipes, produk.id);
  const daftar = terdampak
    .slice(0, 8)
    .map((t) => `${t.name} (${label[t.mode] ?? t.mode})`)
    .join(', ');
  return confirmDialog({
    title: `Hapus resep ${label[mode] ?? mode}?`,
    message:
      `Seluruh bahan pada varian ini dihapus dari "${produk.name}". Varian lainnya tidak ikut terhapus, ` +
      'dan produknya sendiri tetap ada — hanya resepnya yang hilang, jadi kamu bisa mengisinya ulang atau impor ulang.' +
      (terdampak.length
        ? ` HPP ${terdampak.length} varian resep lain yang memakai produk ini ikut jadi kosong: ${daftar}${terdampak.length > 8 ? ', dan lainnya' : ''}.`
        : ''),
    confirmText: 'Hapus resep',
    danger: true
  });
}

function productRowHtml(p, cost) {
  // Tanda ini juga menjaring produk yang MASUK SEBELUM peringatan impor ada.
  // Peringatan yang cuma muncul sekali saat impor tidak menolong siapa pun yang
  // datanya sudah telanjur salah — dan justru itu yang sudah ada di database.
  const curiga = curigaHargaTertukar(p);
  const beli =
    p.product_type === 'raw' && p.purchase_price != null
      ? `${formatRupiah(p.purchase_price)} / ${escapeHtml(p.purchase_unit ?? p.base_unit)}${p.purchase_qty ? ` <span style="color:var(--color-text-muted)">(${p.purchase_qty} ${escapeHtml(p.base_unit)})</span>` : ''}${
          curiga ? ` <span class="badge badge-pending" title="${escapeHtml(curiga)}" style="cursor:help">⚠ cek satuan</span>` : ''
        }`
      : '-';
  const hpp = cost != null ? `${formatRupiah(cost)} <span style="color:var(--color-text-muted)">/${escapeHtml(p.base_unit)}</span>` : '<span style="color:var(--color-text-muted)">-</span>';
  const jual = p.product_type === 'finished' && p.sale_price != null ? formatRupiah(p.sale_price) : '-';
  let margin = '-';
  if (p.product_type === 'finished' && p.sale_price != null && cost != null) {
    const m = Number(p.sale_price) - cost;
    const pct = p.sale_price > 0 ? Math.round((m / Number(p.sale_price)) * 100) : 0;
    margin = `${formatRupiah(m)} <span style="color:var(--color-text-muted)">(${pct}%)</span>`;
  }
  return `
    <tr data-nama="${escapeHtml(bakukanNama(p.name))}" data-tipe="${escapeHtml(TYPE_LABEL[p.product_type] ?? p.product_type)}" data-kategori="${escapeHtml(p.category ?? '')}">
      <td>${escapeHtml(p.name)}${p.is_active === false ? ' <span style="font-size:0.7rem;color:var(--color-danger)">(nonaktif)</span>' : ''}</td>
      <td>${TYPE_LABEL[p.product_type] ?? p.product_type}</td>
      <td style="font-size:0.85rem">${escapeHtml(p.category ?? '-')}${p.subcategory ? `<div style="font-size:0.75rem;color:var(--color-text-muted)">${escapeHtml(p.subcategory)}</div>` : ''}</td>
      <td>${escapeHtml(p.base_unit)}</td>
      <td>${beli}</td>
      <td>${hpp}</td>
      <td>${jual}</td>
      <td>${margin}</td>
      <td>
        <button class="btn-edit-product" data-json='${escapeAttr(JSON.stringify(p))}'>Edit</button>
        <button class="btn-del-product" data-id="${p.id}">Hapus</button>
      </td>
    </tr>`;
}

async function openProductDialog(content, businessUnitId, existing) {
  const isEdit = !!existing;
  let units = [];
  let cats = { categories: [], subcategories: [] };
  try {
    const [u, prods] = await Promise.all([listUnits(), listProducts(businessUnitId)]);
    units = u;
    cats = distinctCategories(prods);
  } catch {
    units = [];
  }
  const unitOptions = units.map((u) => ({ value: u.name, label: u.name }));
  const catOptions = cats.categories.map((c) => ({ value: c, label: c }));
  const subOptions = cats.subcategories.map((c) => ({ value: c, label: c }));
  const values = await formDialog({
    title: isEdit ? 'Edit Produk' : 'Tambah Produk',
    fields: [
      { name: 'name', label: 'Nama Produk', type: 'text', required: true, value: existing?.name ?? '' },
      { name: 'product_type', label: 'Tipe', type: 'select', required: true, value: existing?.product_type ?? 'raw', options: PRODUCT_TYPES },
      {
        name: 'category',
        label: 'Kategori',
        type: 'searchselect',
        allowCreate: true,
        value: existing?.category ?? '',
        options: catOptions,
        placeholder: 'cari / ketik kategori baru…',
        help: 'Ketik nama baru lalu pilih “+ Tambah …” untuk membuat kategori.'
      },
      {
        name: 'subcategory',
        label: 'Sub-kategori',
        type: 'searchselect',
        allowCreate: true,
        value: existing?.subcategory ?? '',
        options: subOptions,
        placeholder: 'cari / ketik sub-kategori baru…'
      },
      { name: 'base_unit', label: 'Satuan pakai (di resep/stok)', type: 'select', required: true, value: existing?.base_unit ?? '', options: [{ value: '', label: '-- pilih satuan --' }, ...unitOptions] },
      { name: 'purchase_unit', label: 'Satuan beli', type: 'select', value: existing?.purchase_unit ?? '', options: [{ value: '', label: '-- pilih satuan --' }, ...unitOptions] },
      { name: 'purchase_qty', label: 'Isi per satuan beli (dalam satuan pakai)', type: 'number', min: 0, value: existing?.purchase_qty ?? '', placeholder: 'mis. 25000' },
      {
        name: 'purchase_price',
        label: 'Harga beli / satuan beli',
        type: 'money',
        value: existing?.purchase_price ?? '',
        // Contohnya konkret karena label saja terbukti bisa dibaca dua arah,
        // dan salah baca di sini tidak menimbulkan gejala apa pun.
        help: 'Harga SATU satuan beli — mis. harga sekarung gula 25 kg = 250.000, bukan harga per gram.'
      },
      { name: 'sale_price', label: 'Harga jual', type: 'money', value: existing?.sale_price ?? '' },
      ...(isEdit ? [{ name: 'is_active', label: 'Aktif', type: 'checkbox', value: existing.is_active }] : [])
    ],
    submitText: 'Simpan',
    onReady: (form) => {
      const typeSel = form.elements['product_type'];
      const show = (name, on) => {
        const el = form.elements[name]?.closest('.field');
        if (el) el.style.display = on ? 'block' : 'none';
      };
      const sync = () => {
        const t = typeSel.value;
        show('purchase_unit', t === 'raw');
        show('purchase_qty', t === 'raw');
        show('purchase_price', t === 'raw');
        show('sale_price', t === 'finished');
      };
      typeSel.addEventListener('change', sync);
      sync();
    }
  });
  if (!values) return;

  const isRaw = values.product_type === 'raw';
  const isFinished = values.product_type === 'finished';
  const payload = {
    businessUnitId,
    name: values.name,
    product_type: values.product_type,
    category: values.category || null,
    subcategory: values.subcategory || null,
    base_unit: values.base_unit,
    purchase_unit: isRaw ? values.purchase_unit : null,
    purchase_qty: isRaw && values.purchase_qty !== '' ? Number(values.purchase_qty) : null,
    purchase_price: isRaw && values.purchase_price ? values.purchase_price : null,
    sale_price: isFinished && values.sale_price ? values.sale_price : null,
    is_active: isEdit ? values.is_active : true
  };
  try {
    if (isEdit) await updateProduct(existing.id, payload);
    else await createProduct(payload);
    toast(isEdit ? 'Produk diperbarui.' : 'Produk ditambahkan.', 'success');
    await renderProductsTab(content, businessUnitId);
  } catch (error) {
    toast(error.message ?? 'Gagal menyimpan produk.', 'error');
  }
}

// ---- Tab: Resep ----

async function renderRecipesTab(content, businessUnitId) {
  content.innerHTML = loadingHtml('Memuat resep…', { baris: 5 });
  let data;
  try {
    data = await loadProductsAndCosts(businessUnitId);
  } catch (error) {
    content.innerHTML = `<p class="error-text">${error.message ?? error}</p>`;
    return;
  }
  const { products, recipes } = data;
  // Policy `recipes_modify` mensyaratkan admin BU. Tombol simpan yang pasti
  // ditolak lebih buruk daripada tidak ada tombol: orangnya mengisi seluruh
  // resep dulu, baru tahu.
  const bolehUbah = await sayaAdminBu(businessUnitId).catch(() => false);
  const manufactured = products.filter((p) => p.product_type === 'semi' || p.product_type === 'finished');
  const namaProduk = new Map(products.map((p) => [p.id, p]));
  const resepPer = new Map(recipes.map((r) => [`${r.product_id}|${r.mode}`, r]));

  content.innerHTML = `
    <div class="page-header">
      <p style="color:var(--color-text-muted);font-size:0.9rem;margin:0;max-width:460px">
        Setengah Jadi punya 1 varian: <strong>Produksi</strong> (dibuat di CK).
        <strong>Menu</strong> bisa punya 2: <strong>Standalone</strong> (dari bahan baku) &amp;
        <strong>Dilayani CK</strong> (memakai setengah jadi). HPP dihitung otomatis dari bahannya.
      </p>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button id="btn-tpl-recipe">Template</button>
        ${bolehUbah ? '<button id="btn-import-recipe">Import Excel</button>' : ''}
        <button id="btn-unduh-resep-xlsx">⬇ Excel</button>
        <button id="btn-unduh-resep-pdf">⬇ PDF</button>
      </div>
    </div>
    ${saringanHtml({
      id: 'resep',
      placeholder: 'Cari nama produk…',
      // Hanya dua tipe yang punya resep — menawarkan "Bahan Baku" di sini
      // adalah pilihan yang pasti mengosongkan tabel, dan pilihan semacam itu
      // membuat orang mengira saringannya rusak.
      tipeOpsi: ['semi', 'finished'].map((t) => TYPE_LABEL[t] ?? t),
      kategoriOpsi: daftarKategori(manufactured)
    })}
    <p style="font-size:0.82rem;color:var(--color-text-muted);margin:0 0 8px">
      Ketuk baris produk untuk melihat bahan-bahannya${bolehUbah ? ' dan mengubahnya' : ''}.
      ${
        bolehUbah
          ? ''
          : '<br /><strong>Resep hanya bisa diubah Admin BU</strong> — di sini kamu bisa memeriksanya, tapi tidak menyimpannya.'
      }
    </p>
    <div class="table-scroll"><table class="data-table table-freeze-1">
      <thead><tr><th>Produk</th><th>Tipe</th><th>Varian resep &amp; HPP</th></tr></thead>
      <tbody>
        ${
          manufactured
            .map((p) => {
              const modes = modesForType(p.product_type);
              const variants = modes
                .map((m) => {
                  const has = resepPer.has(`${p.id}|${m}`);
                  const cost = costForMode(products, recipes, p.id, m);
                  // Dulu tertulis "resep belum lengkap", yang menyesatkan:
                  // resepnya sendiri sering sudah lengkap — yang kurang adalah
                  // harga di salah satu BAHANNYA. Orang lalu membongkar resep
                  // yang tidak rusak. Sekarang sebabnya ikut disebut.
                  const sebab = has && cost == null ? sebabHppKosong(products, recipes, p.id, m) : [];
                  const val = has
                    ? cost != null
                      ? formatRupiah(cost) + `/${escapeHtml(p.base_unit)}`
                      : `<span class="badge badge-pending" title="${escapeHtml(sebab.join(' · '))}">HPP belum bisa dihitung</span>`
                    : '<span class="badge badge-pending">Belum</span>';
                  return `<div style="margin:2px 0"><strong>${MODE_LABEL[m]}:</strong> ${val}</div>`;
                })
                .join('');
              return `<tr class="rcp-row" data-id="${p.id}" data-nama="${escapeHtml(bakukanNama(p.name))}" data-tipe="${escapeHtml(TYPE_LABEL[p.product_type] ?? p.product_type)}" data-kategori="${escapeHtml(p.category ?? '')}" style="cursor:pointer">
                  <td><span class="rcp-arrow" data-id="${p.id}" style="display:inline-block;width:1em">▸</span> ${escapeHtml(p.name)}</td>
                  <td>${TYPE_LABEL[p.product_type]}</td>
                  <td style="font-size:0.85rem">${variants}</td>
                </tr>
                <tr class="rcp-detail" data-for="${p.id}" data-induk="${escapeHtml(bakukanNama(p.name))}" hidden><td colspan="3" style="background:var(--color-surface-alt,#fafafa)"></td></tr>`;
            })
            .join('') || '<tr><td colspan="3">Belum ada produk setengah jadi / jadi.</td></tr>'
        }
      </tbody>
    </table></div>
  `;

  const muat = () => renderRecipesTab(content, businessUnitId);

  /** Isi panel rincian sebuah produk: bahan per varian + tombol yang jelas. */
  const gambarRincian = (produk) => {
    const sel = content.querySelector(`.rcp-detail[data-for="${produk.id}"] td`);
    const modes = modesForType(produk.product_type);
    sel.innerHTML = modes
      .map((m) => {
        const r = resepPer.get(`${produk.id}|${m}`);
        // Bahan diambil dari resep yang SUDAH ADA — termasuk yang baru diimpor.
        // Inilah yang dulu tidak pernah bisa dilihat tanpa membuka editor satu
        // per satu: hasil impor "berhasil" tapi isinya tidak bisa diperiksa.
        // Baris bahan yang bermasalah DISOROT, bukan cuma disebut di daftar di
        // bawah tabel. Daftar kalimat masih menyuruh orangnya mencocokkan nama
        // sendiri — pada resep berisi 15 bahan itu pekerjaan yang tidak perlu
        // ada, dan yang biasanya terjadi adalah orangnya menyerah membacanya.
        // Isinya disusun `susunPanelBahan()` — SATU sumber dengan Staff App.
        // Bedanya cuma `denganNilai`: kolom rupiah ada di sini, tidak di sana.
        // Kalau kedua sisi menyusun sendiri, cepat atau lambat resep yang sama
        // akan tampil berbeda di dua layar, dan orang berhenti percaya keduanya.
        const panel = susunPanelBahan({
          products,
          recipes,
          productId: produk.id,
          mode: m,
          denganNilai: true,
          hppBahan: (id) => costForMode(products, recipes, id, null),
          hppVarian: (id, mode) => costForMode(products, recipes, id, mode),
          sebabBahan: (id) => sebabBahan(products, recipes, id)
        });
        const baris = panel.baris
          .map(
            (b) => `<tr${b.masalah ? ' style="background:var(--color-warning-bg,#fff8e1)"' : ''}>
              <td>${escapeHtml(b.nama)}${
                b.masalah ? `<div style="font-size:0.72rem;color:var(--color-danger,#c0392b);margin-top:2px">⚠ ${escapeHtml(b.masalah)}</div>` : ''
              }</td>
              <td style="text-align:right;vertical-align:top;white-space:nowrap">${formatNum(b.jumlah)} ${escapeHtml(b.satuan)}</td>
              <td style="text-align:right;vertical-align:top;white-space:nowrap">${b.hppSatuan == null ? '-' : formatRupiah(b.hppSatuan)}</td>
              <td style="text-align:right;vertical-align:top;white-space:nowrap">${b.biaya == null ? '-' : formatRupiah(b.biaya)}</td>
            </tr>`
          )
          .join('');
        const isi = r
          ? `<div class="table-scroll"><table class="data-table" style="margin:6px 0;min-width:520px">
               <thead><tr><th>Bahan</th><th style="text-align:right">Jumlah</th><th style="text-align:right">HPP/satuan</th><th style="text-align:right">Biaya</th></tr></thead>
               <tbody>${baris || `<tr><td colspan="4" style="background:var(--color-warning-bg,#fff8e1)">
                 <strong>Resep ini kosong — bahannya tidak pernah tersimpan.</strong>
                 <div style="font-size:0.78rem;margin-top:3px">
                   Biasanya karena penyimpanan terputus di tengah (sinyal hilang, halaman tertutup, atau aplikasi ditutup paksa)
                   sesudah bahan lama dihapus tapi sebelum bahan barunya masuk. Isi ulang lewat "Ubah resep", atau hapus resepnya
                   supaya kembali berstatus "Belum".
                 </div>
               </td></tr>`}</tbody>
               ${
                 panel.baris.length
                   ? `<tfoot><tr>
                        <th colspan="3" style="text-align:right">Total bahan per ${escapeHtml(formatNum(panel.yieldQty))} ${escapeHtml(panel.satuan)}</th>
                        <th style="text-align:right">${panel.totalBiaya == null ? '-' : formatRupiah(panel.totalBiaya)}</th>
                      </tr>
                      <tr>
                        <th colspan="3" style="text-align:right">HPP per ${escapeHtml(panel.satuan)}</th>
                        <th style="text-align:right">${panel.hpp == null ? '-' : formatRupiah(panel.hpp)}</th>
                      </tr></tfoot>`
                   : ''
               }
             </table></div>
             <p style="font-size:0.78rem;color:var(--color-text-muted);margin:0 0 8px">
               Hasil/yield: <strong>${formatNum(r.yield_qty)} ${escapeHtml(produk.base_unit)}</strong>
             </p>`
          : `<p style="font-size:0.85rem;color:var(--color-text-muted);margin:6px 0 8px">Varian ini belum punya resep.</p>`;
        // Sebab HPP kosong ditulis LENGKAP di sini, bukan cuma sebagai tooltip:
        // di HP tidak ada hover, dan ini justru tempat orang mencari jawabannya.
        const sebab = r && costForMode(products, recipes, produk.id, m) == null ? sebabHppKosong(products, recipes, produk.id, m) : [];
        const catatanHpp = sebab.length
          ? `<div style="font-size:0.78rem;background:var(--color-warning-bg,#fff8e1);border-left:3px solid var(--color-warning,#e6a700);padding:6px 8px;margin:0 0 8px;max-width:420px">
               <strong>HPP belum bisa dihitung.</strong> Bukan karena stok — stok tidak ikut menentukan HPP.
               <ul style="margin:4px 0 0 16px;padding:0">${sebab.map((s) => `<li>${escapeHtml(s)}</li>`).join('')}</ul>
             </div>`
          : '';
        const tujuan = pasanganVarian(produk.product_type, m);
        const bolehPindah = tujuan && periksaPindah({ productType: produk.product_type, dari: m, ke: tujuan, adaDari: !!r, adaKe: resepPer.has(`${produk.id}|${tujuan}`) }).boleh;
        return `<div style="padding:10px 4px;border-top:1px solid var(--color-border,#e5e5e5)">
            <div style="font-weight:600;margin-bottom:2px">${MODE_LABEL[m]}</div>
            ${isi}
            ${catatanHpp}
            ${
              bolehUbah
                ? `<button class="btn-edit-recipe" data-id="${produk.id}" data-mode="${m}">${r ? '✎ Ubah resep' : '+ Isi resep'}</button>` +
                  (r ? ` <button class="btn-del-recipe" data-id="${produk.id}" data-mode="${m}">🗑 Hapus resep</button>` : '') +
                  (bolehPindah
                    ? ` <button class="btn-pindah-recipe" data-id="${produk.id}" data-mode="${m}" data-ke="${tujuan}">⇄ Pindahkan ke ${MODE_LABEL[tujuan]}</button>`
                    : '')
                : ''
            }
          </div>`;
      })
      .join('');

    // Tombolnya dulu hanya bertuliskan nama varian ("Produksi (CK)") — terbaca
    // sebagai LABEL, bukan sesuatu yang bisa ditekan. Itu sebabnya form isian
    // resep dikira tidak ada, dan satu-satunya jalan yang terlihat adalah impor.
    sel.querySelectorAll('.btn-del-recipe').forEach((btn) =>
      btn.addEventListener(
        'click',
        sekaliJalan(async (e) => {
          e.stopPropagation();
          const ok = await konfirmasiHapusResep({ produk, mode: btn.dataset.mode, products, recipes, label: MODE_LABEL });
          if (!ok) return;
          try {
            await deleteRecipe(produk.id, btn.dataset.mode);
            toast('Resep dihapus.', 'success');
            await muat();
          } catch (error) {
            toast(error.message ?? 'Gagal menghapus resep.', 'error');
          }
        })
      )
    );

    sel.querySelectorAll('.btn-pindah-recipe').forEach((btn) =>
      btn.addEventListener(
        'click',
        sekaliJalan(async (e) => {
          e.stopPropagation();
          const { mode: dari, ke } = btn.dataset;
          // Konfirmasinya menyebut apa yang TIDAK berubah juga. Kekhawatiran
          // yang wajar saat memindahkan resep adalah "bahannya ikut hilang?" —
          // dan pertanyaan yang tidak dijawab akan membuat orang tidak menekan.
          const ok = await confirmDialog({
            title: 'Pindahkan resep',
            message: `Resep <strong>${escapeHtml(produk.name)}</strong> dipindahkan dari <strong>${MODE_LABEL[dari]}</strong> ke <strong>${MODE_LABEL[ke]}</strong>.<br /><br />Bahan dan hasil/yield-nya ikut pindah apa adanya — tidak ada yang dihapus. Setelah ini varian ${MODE_LABEL[dari]} menjadi kosong.`,
            confirmText: 'Pindahkan'
          });
          if (!ok) return;
          try {
            await pindahVarianResep(produk.id, dari, ke);
            toast(`Resep pindah ke ${MODE_LABEL[ke]}.`, 'success');
            await muat();
          } catch (error) {
            toast(error.message ?? 'Gagal memindahkan resep.', 'error');
          }
        })
      )
    );

    sel.querySelectorAll('.btn-edit-recipe').forEach((btn) =>
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openRecipeEditor(sel.querySelector('.rcp-editor') ?? sisipkanEditor(sel), {
          businessUnitId,
          product: produk,
          products,
          mode: btn.dataset.mode,
          onSaved: muat
        });
      })
    );
  };

  const sisipkanEditor = (sel) => {
    const wrap = document.createElement('div');
    wrap.className = 'rcp-editor';
    sel.appendChild(wrap);
    return wrap;
  };

  content.querySelectorAll('.rcp-row').forEach((row) =>
    row.addEventListener('click', () => {
      const id = row.dataset.id;
      const detail = content.querySelector(`.rcp-detail[data-for="${id}"]`);
      const panah = row.querySelector('.rcp-arrow');
      const buka = detail.hidden;
      detail.hidden = !buka;
      panah.textContent = buka ? '▾' : '▸';
      if (buka) gambarRincian(namaProduk.get(id));
    })
  );

  // Penyaring resep punya satu kerumitan yang tidak dimiliki tabel produk:
  // tiap produk punya DUA baris — barisnya sendiri dan baris rincian di
  // bawahnya. Baris rincian harus ikut tersembunyi, tapi tidak boleh ikut
  // TERBUKA hanya karena namanya cocok.
  pasangPenyaring({
    input: content.querySelector('#cari-resep'),
    tipeSel: content.querySelector('#tipe-resep'),
    katSel: content.querySelector('#kat-resep'),
    info: content.querySelector('#cari-resep-info'),
    baris: () => content.querySelectorAll('.rcp-row'),
    satuan: 'produk',
    // Baris rincian mengikuti induknya: ikut tersembunyi kalau induknya
    // tersembunyi, tapi TIDAK ikut terbuka hanya karena namanya cocok.
    sesudah: () => {
      for (const tr of content.querySelectorAll('.rcp-row')) {
        const detail = content.querySelector(`.rcp-detail[data-for="${tr.dataset.id}"]`);
        if (detail && (tr.hidden || !tr.querySelector('.rcp-arrow')?.textContent.includes('▾'))) detail.hidden = true;
      }
    }
  });

  // Unduhan memakai SATU penyusun untuk kedua format — kalau xlsx dan PDF
  // menyusun barisnya sendiri-sendiri, takarannya akan menyimpang, dan resep
  // yang angkanya berbeda antara file Excel dan lembar di dapur tidak bisa
  // dipakai memeriksa apa pun.
  const susun = () =>
    susunBukuResep({
      products,
      recipes,
      hppVarian: (id, mode) => costForMode(products, recipes, id, mode),
      hppBahan: (id) => costForMode(products, recipes, id, null),
      denganNilai: true
    });
  content.querySelector('#btn-unduh-resep-xlsx').addEventListener(
    'click',
    sekaliJalan(async () => {
      const b = susun();
      if (!b.baris.length) return toast('Belum ada resep untuk diunduh.', 'info');
      await exportTableXLSX({ filename: b.namaBerkas, sheetName: 'Resep', title: b.judul, subtitle: b.subjudul, columns: b.kolom, rows: b.baris });
    })
  );
  content.querySelector('#btn-unduh-resep-pdf').addEventListener(
    'click',
    sekaliJalan(async () => {
      const b = susun();
      if (!b.baris.length) return toast('Belum ada resep untuk diunduh.', 'info');
      await exportTablePDF({ filename: b.namaBerkas, title: b.judul, subtitle: b.subjudul, columns: b.kolom, rows: b.baris });
    })
  );

  document.getElementById('btn-tpl-recipe').addEventListener('click', downloadRecipeTemplate);
  document.getElementById('btn-import-recipe')?.addEventListener('click', () => openImport(content, businessUnitId, 'recipes', muat));
}

async function openImport(content, businessUnitId, kind, refresh) {
  const isProducts = kind === 'products';
  const v = await formDialog({
    title: isProducts ? 'Import Produk (Excel/CSV)' : 'Import Resep (Excel/CSV)',
    description: isProducts
      ? 'Kolom: Nama, Tipe, Kategori, Sub Kategori, Satuan Pakai, Satuan Beli, Isi per Satuan Beli, Harga Beli (per Satuan Beli), Harga Jual. ' +
        'Harga Beli diisi harga SATU satuan beli — mis. harga sekarung, bukan harga per gram. ' +
        'Kategori diisi bebas — tidak ada daftar tetap. ' +
        'Nama yang sudah ada TIDAK dibuat ulang: kolom yang masih kosong di data lama akan dilengkapi, ' +
        'dan nilai yang sudah terisi tidak pernah ditimpa diam-diam (selisihnya dilaporkan).'
      : // `description` di-escape oleh formDialog, jadi ditulis polos tanpa tag.
        'Kolom: Produk, Varian, Yield, Bahan, Jumlah — satu baris per bahan. ' +
        'Varian: "Produksi" untuk Setengah Jadi; "Standalone" atau "Dilayani CK" untuk Menu. ' +
        'Kosongkan untuk memakai varian bawaan tipe produknya. ' +
        'Produk & bahan harus sudah terdaftar di Master Produk. ' +
        'Varian yang resepnya sudah ada akan dilewati — ubah lewat tombol Ubah di tabel.',
    fields: [{ name: 'file', label: 'File .xlsx / .csv', type: 'file', required: true, accept: '.xlsx,.xls,.csv' }],
    submitText: 'Import'
  });
  if (!v || !v.file) return;
  toast('Memproses file...', 'info');
  try {
    const res = isProducts ? await importProducts(businessUnitId, v.file) : await importRecipes(businessUnitId, v.file);
    const errHtml = res.errors.length
      ? `<p style="color:var(--color-danger);margin-top:8px">Gagal/terlewat (${res.errors.length}):</p><ul style="margin:0;padding-left:18px;max-height:200px;overflow:auto">${res.errors.map((e) => `<li>${escapeHtml(e)}</li>`).join('')}</ul>`
      : '';
    // Satuan baru dilaporkan terpisah dari error: menambahnya BUKAN kegagalan,
    // dan menaruhnya di daftar merah akan membuat impor yang mulus terlihat
    // bermasalah.
    const s = res.satuanBaru;
    const satuanHtml = s
      ? (s.ditambah?.length ? `<p style="margin-top:8px">Satuan baru ditambahkan ke Master Satuan: <strong>${escapeHtml(s.ditambah.join(', '))}</strong></p>` : '') +
        (s.gagal?.length
          ? `<p style="margin-top:8px;font-size:0.85rem;color:var(--color-text-muted)">
               Satuan <strong>${escapeHtml(s.gagal.join(', '))}</strong> dipakai di file ini tapi belum ada di Master Satuan.
               Produknya tetap tersimpan dengan satuan itu — hanya saja satuannya belum muncul di dropdown.
               Minta Super Admin menambahkannya.
             </p>`
          : '')
      : '';
    // "Dilengkapi" dipisahkan dari "ditambahkan" dan "dilewati". Menggabungkannya
    // menyembunyikan justru yang paling ingin diketahui saat mengimpor ulang:
    // apakah data lama benar-benar berubah.
    const lengkapHtml = res.dilengkapi
      ? `<p style="margin-top:6px"><strong>${res.dilengkapi}</strong> produk lama <strong>dilengkapi</strong> kolom yang tadinya kosong.</p>` +
        `<ul style="margin:0;padding-left:18px;max-height:160px;overflow:auto;font-size:0.85rem">${res.catatan
          .map((c) => `<li>${escapeHtml(c)}</li>`)
          .join('')}</ul>`
      : '';
    // Peringatan harga terbalik BUKAN error — datanya tersimpan dan mungkin
    // memang benar. Tapi ia ditaruh SEBELUM daftar merah dan diberi warna
    // sendiri, karena inilah satu-satunya kesalahan di jalur ini yang tidak
    // menimbulkan gejala apa pun: impornya sukses, angkanya jalan, dan HPP-nya
    // salah ratusan kali lipat sampai ada yang curiga berbulan-bulan kemudian.
    const peringatanHtml = res.peringatan?.length
      ? `<div style="margin-top:10px;background:var(--color-warning-bg,#fff8e1);border-left:3px solid var(--color-warning,#e6a700);padding:8px 10px">
           <strong>Periksa lagi ${res.peringatan.length} harga beli.</strong>
           Kolom "Harga Beli" diisi harga <em>satu satuan beli</em> (harga sekarung), bukan harga per satuan pakai.
           Datanya tetap tersimpan — perbaiki lewat tombol Ubah kalau memang keliru.
           <ul style="margin:6px 0 0 16px;padding:0;max-height:180px;overflow:auto;font-size:0.85rem">${res.peringatan
             .map((w) => `<li>${escapeHtml(w)}</li>`)
             .join('')}</ul>
         </div>`
      : '';
    await infoDialog({
      title: 'Hasil Import',
      bodyHtml:
        `<p><strong>${res.added}</strong> ditambahkan, <strong>${res.skipped}</strong> dilewati (tidak ada yang perlu diubah).</p>` +
        `${lengkapHtml}${satuanHtml}${peringatanHtml}${errHtml}`
    });
    await refresh();
  } catch (error) {
    toast(error.message ?? 'Gagal import.', 'error');
  }
}

// ---- Tab: Satuan (global) ----

async function renderUnitsTab(content) {
  content.innerHTML = loadingHtml('Memuat satuan…', { baris: 5 });
  let units;
  try {
    units = await listUnits();
  } catch (error) {
    content.innerHTML = `<p class="error-text">${error.message ?? error}</p>`;
    return;
  }
  content.innerHTML = `
    <div class="page-header">
      <h2 style="font-size:1.05rem;margin:0">Satuan (dipakai semua BU)</h2>
      <button class="primary" id="btn-new-unit" style="max-width:180px">+ Tambah Satuan</button>
    </div>
    <p style="color:var(--color-text-muted);font-size:0.85rem">Satuan dipilih lewat dropdown saat menambah produk, biar konsisten. Hanya Super Admin yang bisa ubah daftar ini.</p>
    <table class="data-table" style="max-width:360px">
      <thead><tr><th>Satuan</th><th>Aksi</th></tr></thead>
      <tbody>
        ${units.map((u) => `<tr><td>${escapeHtml(u.name)}</td><td><button class="btn-del-unit" data-id="${u.id}">Hapus</button></td></tr>`).join('') || '<tr><td colspan="2">Belum ada satuan.</td></tr>'}
      </tbody>
    </table>
  `;
  document.getElementById('btn-new-unit').addEventListener('click', sekaliJalan(async () => {
    const v = await formDialog({ title: 'Tambah Satuan', fields: [{ name: 'name', label: 'Nama Satuan', type: 'text', required: true, placeholder: 'mis. gram' }], submitText: 'Simpan' });
    if (!v) return;
    try {
      await createUnit(v.name.trim());
      toast('Satuan ditambahkan.', 'success');
      await renderUnitsTab(content);
    } catch (error) {
      toast(error.message ?? 'Gagal menambah (hanya Super Admin).', 'error');
    }
  }));
  content.querySelectorAll('.btn-del-unit').forEach((btn) =>
    btn.addEventListener('click', sekaliJalan(async () => {
      const ok = await confirmDialog({ title: 'Hapus satuan?', confirmText: 'Hapus', danger: true });
      if (!ok) return;
      try {
        await deleteUnit(btn.dataset.id);
        toast('Satuan dihapus.', 'success');
        await renderUnitsTab(content);
      } catch (error) {
        toast(error.message ?? 'Gagal menghapus.', 'error');
      }
    }))
  );
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(s) {
  return escapeHtml(s);
}
