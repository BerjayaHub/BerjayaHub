import { listProducts, createProduct, listRecipesFull, saveRecipe } from './product.service.js';

// ---- Loader SheetJS (dari CDN, dipakai untuk baca .xlsx/.csv) ----
let xlsxPromise = null;
function loadXLSX() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (!xlsxPromise) {
    xlsxPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
      s.onload = () => resolve(window.XLSX);
      s.onerror = () => reject(new Error('Gagal memuat pustaka Excel (cek koneksi internet).'));
      document.head.appendChild(s);
    });
  }
  return xlsxPromise;
}

async function readRows(file) {
  const XLSX = await loadXLSX();
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { defval: '' });
}

function lc(row) {
  const o = {};
  for (const k in row) o[String(k).trim().toLowerCase()] = row[k];
  return o;
}
function num(v) {
  if (v === '' || v == null) return null;
  const n = Number(String(v).replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

const TYPE_MAP = {
  'bahan baku': 'raw',
  raw: 'raw',
  'setengah jadi': 'semi',
  semi: 'semi',
  'produk jadi': 'finished',
  menu: 'finished',
  jadi: 'finished',
  finished: 'finished'
};

export async function importProducts(businessUnitId, file) {
  const rows = await readRows(file);
  const existing = await listProducts(businessUnitId);
  const names = new Set(existing.map((p) => p.name.trim().toLowerCase()));
  let added = 0;
  let skipped = 0;
  const errors = [];

  for (const raw of rows) {
    const r = lc(raw);
    const name = String(r['nama'] ?? '').trim();
    if (!name) continue;
    if (names.has(name.toLowerCase())) {
      skipped++;
      continue;
    }
    const type = TYPE_MAP[String(r['tipe'] ?? '').trim().toLowerCase()];
    const baseUnit = String(r['satuan pakai'] ?? '').trim();
    if (!type) {
      errors.push(`${name}: tipe tidak dikenal`);
      continue;
    }
    if (!baseUnit) {
      errors.push(`${name}: satuan pakai kosong`);
      continue;
    }
    try {
      await createProduct({
        businessUnitId,
        name,
        product_type: type,
        base_unit: baseUnit,
        purchase_unit: type === 'raw' ? String(r['satuan beli'] ?? '').trim() || null : null,
        purchase_qty: type === 'raw' ? num(r['isi per satuan beli']) : null,
        purchase_price: type === 'raw' ? num(r['harga beli']) : null,
        sale_price: type === 'finished' ? num(r['harga jual']) : null
      });
      names.add(name.toLowerCase());
      added++;
    } catch (e) {
      errors.push(`${name}: ${e.message ?? e}`);
    }
  }
  return { added, skipped, errors };
}

export async function importRecipes(businessUnitId, file) {
  const rows = await readRows(file);
  const products = await listProducts(businessUnitId);
  const byName = new Map(products.map((p) => [p.name.trim().toLowerCase(), p]));
  const recipesFull = await listRecipesFull(businessUnitId);
  const hasRecipe = new Set(recipesFull.map((r) => `${r.product_id}|${r.mode}`));

  const groups = new Map();
  for (const raw of rows) {
    const r = lc(raw);
    const prod = String(r['produk'] ?? '').trim();
    if (!prod) continue;
    if (!groups.has(prod)) groups.set(prod, { yield: 1, items: [] });
    const g = groups.get(prod);
    const y = num(r['yield']);
    if (y != null) g.yield = y;
    const bahan = String(r['bahan'] ?? '').trim();
    const qty = num(r['jumlah']);
    if (bahan && qty != null) g.items.push({ bahan, qty });
  }

  let added = 0;
  let skipped = 0;
  const errors = [];
  for (const [prodName, g] of groups) {
    const p = byName.get(prodName.toLowerCase());
    if (!p) {
      errors.push(`${prodName}: produk tidak ditemukan`);
      continue;
    }
    if (p.product_type === 'raw') {
      errors.push(`${prodName}: bahan baku tidak punya resep`);
      continue;
    }
    const mode = p.product_type === 'semi' ? 'production' : 'standalone';
    if (hasRecipe.has(`${p.id}|${mode}`)) {
      skipped++;
      continue;
    }
    const items = [];
    let ok = true;
    for (const it of g.items) {
      const ing = byName.get(it.bahan.toLowerCase());
      if (!ing) {
        errors.push(`${prodName}: bahan "${it.bahan}" tidak ditemukan`);
        ok = false;
        break;
      }
      items.push({ ingredient_product_id: ing.id, qty: it.qty });
    }
    if (!ok) continue;
    if (!items.length) {
      errors.push(`${prodName}: tidak ada bahan`);
      continue;
    }
    try {
      await saveRecipe({ productId: p.id, businessUnitId, mode, yield_qty: g.yield || 1, notes: null, items });
      hasRecipe.add(`${p.id}|${mode}`);
      added++;
    } catch (e) {
      errors.push(`${prodName}: ${e.message ?? e}`);
    }
  }
  return { added, skipped, errors };
}

function downloadCsv(filename, content) {
  const blob = new Blob(['﻿' + content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadProductTemplate() {
  downloadCsv(
    'template-produk.csv',
    'Nama,Tipe,Satuan Pakai,Satuan Beli,Isi per Satuan Beli,Harga Beli,Harga Jual\n' +
      'Gula,Bahan Baku,gram,karung,25000,150000,\n' +
      'Sirup Gula,Setengah Jadi,ml,,,,\n' +
      'Es Kopi Susu,Menu,gelas,,,,18000\n'
  );
}

export function downloadRecipeTemplate() {
  downloadCsv(
    'template-resep.csv',
    'Produk,Yield,Bahan,Jumlah\n' +
      'Sirup Gula,1800,Gula,1000\n' +
      'Sirup Gula,1800,Air,1000\n' +
      'Es Kopi Susu,1,Kopi,18\n' +
      'Es Kopi Susu,1,Sirup Gula,30\n'
  );
}
