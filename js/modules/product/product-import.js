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

/**
 * Varian resep yang sah untuk sebuah tipe produk.
 * Harus sama dengan `modesForType()` di recipe-editor.js.
 */
const VARIAN_SAH = { semi: ['production'], finished: ['standalone', 'served_by_ck'] };

/**
 * Terjemahkan tulisan orang jadi kode varian.
 *
 * Diterima apa adanya dari kolom "Varian": orang akan mengetik "CK", "Dilayani
 * CK", "produksi", atau membiarkannya kosong. Menolak karena beda huruf besar
 * atau spasi hanya membuat orang menyerah dan kembali mengetik satu per satu.
 */
function bacaVarian(teks) {
  const t = String(teks ?? '')
    .trim()
    .toLowerCase();
  if (!t) return null; // kosong = pakai bawaan tipe produknya
  if (['production', 'produksi', 'ck', 'produksi (ck)'].includes(t)) return 'production';
  if (['standalone', 'mandiri', 'sendiri'].includes(t)) return 'standalone';
  if (['served_by_ck', 'dilayani ck', 'dilayani_ck', 'dari ck', 'semi'].includes(t)) return 'served_by_ck';
  return 'TIDAK_DIKENAL';
}

export async function importRecipes(businessUnitId, file) {
  const rows = await readRows(file);
  const products = await listProducts(businessUnitId);
  const byName = new Map(products.map((p) => [p.name.trim().toLowerCase(), p]));
  const recipesFull = await listRecipesFull(businessUnitId);
  const hasRecipe = new Set(recipesFull.map((r) => `${r.product_id}|${r.mode}`));

  // Dikelompokkan per PRODUK + VARIAN, bukan per produk saja.
  //
  // Sebelum ini varian tidak pernah dibaca: modenya ditebak dari tipe produk,
  // sehingga menu SELALU jadi "Standalone" dan resep "Dilayani CK" mustahil
  // diimpor — kolomnya tetap menampilkan "Belum" sesudah impor yang dilaporkan
  // berhasil. Dari sisi yang memakainya, itu tidak bisa dibedakan dari gagal.
  const groups = new Map();
  for (const raw of rows) {
    const r = lc(raw);
    const prod = String(r['produk'] ?? '').trim();
    if (!prod) continue;
    const varian = bacaVarian(r['varian']);
    const kunci = `${prod}||${varian ?? ''}`;
    if (!groups.has(kunci)) groups.set(kunci, { nama: prod, varian, yield: 1, items: [] });
    const g = groups.get(kunci);
    const y = num(r['yield']);
    if (y != null) g.yield = y;
    const bahan = String(r['bahan'] ?? '').trim();
    const qty = num(r['jumlah']);
    if (bahan && qty != null) g.items.push({ bahan, qty });
  }

  let added = 0;
  let skipped = 0;
  const errors = [];
  for (const g of groups.values()) {
    const prodName = g.nama;
    const p = byName.get(prodName.toLowerCase());
    if (!p) {
      errors.push(`${prodName}: produk tidak ditemukan`);
      continue;
    }
    if (p.product_type === 'raw') {
      errors.push(`${prodName}: bahan baku tidak punya resep`);
      continue;
    }
    if (g.varian === 'TIDAK_DIKENAL') {
      errors.push(`${prodName}: varian tidak dikenal — tulis "Produksi", "Standalone", atau "Dilayani CK"`);
      continue;
    }
    const sah = VARIAN_SAH[p.product_type] ?? [];
    const mode = g.varian ?? sah[0];
    if (!sah.includes(mode)) {
      errors.push(`${prodName}: varian "${MODE_TEKS[mode] ?? mode}" tidak berlaku untuk ${p.product_type === 'semi' ? 'Setengah Jadi' : 'Menu'}`);
      continue;
    }
    if (hasRecipe.has(`${p.id}|${mode}`)) {
      // Disebut varian mananya. "3 dilewati" tanpa keterangan membuat orang
      // menduga file-nya yang salah, lalu mengulang impor yang sama.
      skipped++;
      errors.push(`${prodName} (${MODE_TEKS[mode] ?? mode}): dilewati — resep varian ini sudah ada, hapus/ubah lewat tombol Ubah di tabel`);
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

/** Nama varian untuk pesan ke manusia. */
const MODE_TEKS = { production: 'Produksi (CK)', standalone: 'Standalone', served_by_ck: 'Dilayani CK' };

export function downloadRecipeTemplate() {
  downloadCsv(
    'template-resep.csv',
    'Produk,Varian,Yield,Bahan,Jumlah\n' +
      'Sirup Gula,Produksi,1800,Gula,1000\n' +
      'Sirup Gula,Produksi,1800,Air,1000\n' +
      'Es Kopi Susu,Standalone,1,Kopi,18\n' +
      'Es Kopi Susu,Standalone,1,Sirup Gula,30\n' +
      'Es Kopi Susu,Dilayani CK,1,Base Kopi Susu CK,180\n'
  );
}
