import { listProducts, createProduct, listRecipesFull, saveRecipe, listUnits, createUnit } from './product.service.js';
import { bakukanNama, palingMirip, bacaAngka } from '../../core/nama.js';

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
/** Angka dari sel Excel/CSV. Aturannya di js/core/nama.js — ada jebakan koma. */
const num = bacaAngka;

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
  const names = new Set(existing.map((p) => bakukanNama(p.name)));

  // Satuan yang belum ada di Master Satuan didaftarkan otomatis.
  //
  // `products.base_unit` cuma kolom teks — tidak ada FK ke `units` — jadi
  // satuan baru TIDAK PERNAH menggagalkan impor produk. Yang terjadi tanpa ini:
  // produknya masuk, tapi satuannya tidak muncul di dropdown saat produk itu
  // disunting manual, dan orangnya harus mengetiknya ulang persis sama.
  const satuanBaru = await daftarkanSatuanBaru(rows);

  let added = 0;
  let skipped = 0;
  const errors = [];
  let barisKosong = 0;

  for (const [i, raw] of rows.entries()) {
    const r = lc(raw);
    const name = String(r['nama'] ?? '').trim();
    // Baris tanpa nama DIHITUNG, bukan dilewati diam-diam.
    //
    // Ini penyebab "tidak ada laporan produk mana saja yang gagal": baris yang
    // kolom Nama-nya kosong — akibat sel tergabung, judul antar-bagian, atau
    // baris sisa di bawah tabel — hilang tanpa masuk hitungan mana pun. Bukan
    // ditambahkan, bukan dilewati, bukan error. Seolah tidak pernah ada.
    if (!name) {
      barisKosong++;
      continue;
    }
    // Nomor barisnya disebut supaya bisa langsung dicari di file aslinya.
    // +2: satu untuk baris judul, satu karena Excel mulai dari 1.
    const noBaris = i + 2;
    if (names.has(bakukanNama(name))) {
      skipped++;
      continue;
    }
    const type = TYPE_MAP[bakukanNama(r['tipe'])];
    const baseUnit = String(r['satuan pakai'] ?? '').trim();
    if (!type) {
      const isi = String(r['tipe'] ?? '').trim();
      errors.push(
        `Baris ${noBaris} — ${name}: tipe ${isi ? `"${isi}" tidak dikenal` : 'kosong'}. ` +
          'Isi dengan "Bahan Baku", "Setengah Jadi", atau "Menu"'
      );
      continue;
    }
    if (!baseUnit) {
      errors.push(`Baris ${noBaris} — ${name}: kolom "Satuan Pakai" kosong`);
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
      names.add(bakukanNama(name));
      added++;
    } catch (e) {
      errors.push(`Baris ${noBaris} — ${name}: ${e.message ?? e}`);
    }
  }
  if (barisKosong) {
    errors.push(`${barisKosong} baris dilewati karena kolom "Nama" kosong (sel tergabung, baris judul, atau baris sisa di bawah tabel)`);
  }
  return { added, skipped, errors, satuanBaru };
}

/**
 * Daftarkan satuan yang dipakai file tapi belum ada di Master Satuan.
 *
 * @returns {Promise<{ditambah: string[], gagal: string[]}>}
 *
 * TIDAK PERNAH menggagalkan impor. Policy `units_modify` hanya membuka untuk
 * super admin, jadi admin BU yang mengimpor tidak akan bisa menambah satuan —
 * dan itu memang tidak menghalangi apa pun, karena `base_unit` cuma kolom teks.
 * Yang hilang hanya kenyamanan: satuannya tidak muncul di dropdown nanti. Itu
 * dilaporkan sebagai catatan, bukan sebagai kegagalan.
 */
async function daftarkanSatuanBaru(rows) {
  const ditambah = [];
  const gagal = [];
  let adaSekarang;
  try {
    adaSekarang = new Set((await listUnits()).map((u) => bakukanNama(u.name)));
  } catch {
    return { ditambah, gagal }; // daftar satuan tidak terbaca -> lewati saja
  }

  const calon = new Map(); // bentuk baku -> tulisan asli (yang pertama muncul)
  for (const raw of rows) {
    const r = lc(raw);
    for (const kolom of ['satuan pakai', 'satuan beli']) {
      const teks = String(r[kolom] ?? '').trim();
      if (!teks) continue;
      const kunci = bakukanNama(teks);
      if (!kunci || adaSekarang.has(kunci) || calon.has(kunci)) continue;
      calon.set(kunci, teks);
    }
  }

  for (const teks of calon.values()) {
    try {
      await createUnit(teks);
      ditambah.push(teks);
    } catch {
      gagal.push(teks);
    }
  }
  return { ditambah, gagal };
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
  const byName = new Map(products.map((p) => [bakukanNama(p.name), p]));
  const semuaNama = products.map((p) => p.name);
  const recipesFull = await listRecipesFull(businessUnitId);
  const hasRecipe = new Set(recipesFull.map((r) => `${r.product_id}|${r.mode}`));

  // Dikelompokkan per PRODUK + VARIAN, bukan per produk saja.
  //
  // Sebelum ini varian tidak pernah dibaca: modenya ditebak dari tipe produk,
  // sehingga menu SELALU jadi "Standalone" dan resep "Dilayani CK" mustahil
  // diimpor — kolomnya tetap menampilkan "Belum" sesudah impor yang dilaporkan
  // berhasil. Dari sisi yang memakainya, itu tidak bisa dibedakan dari gagal.
  const groups = new Map();
  // Varian terakhir yang DISEBUT untuk tiap produk. Di spreadsheet, orang
  // lumrah mengisi kolom berulang hanya di baris pertama lalu mengosongkan
  // sisanya. Tanpa pewarisan ini, baris kedua dan seterusnya jatuh ke varian
  // BAWAAN — satu resep terbelah dua, dan yang kedua isinya bahan yang tidak
  // lengkap.
  const varianTerakhir = new Map();
  let barisKosong = 0;
  for (const raw of rows) {
    const r = lc(raw);
    const prod = String(r['produk'] ?? '').trim();
    // Sama seperti impor produk: baris tanpa nama DIHITUNG. Di file resep ini
    // lebih sering terjadi lagi, karena orang lumrah mengisi kolom Produk hanya
    // di baris pertama tiap kelompok bahan.
    if (!prod) {
      if (String(r['bahan'] ?? '').trim()) barisKosong++;
      continue;
    }
    const kunciProduk = bakukanNama(prod);
    let varian = bacaVarian(r['varian']);
    if (varian === null && varianTerakhir.has(kunciProduk)) varian = varianTerakhir.get(kunciProduk);
    if (varian !== null && varian !== 'TIDAK_DIKENAL') varianTerakhir.set(kunciProduk, varian);
    const kunci = `${prod}||${varian ?? ''}`;
    if (!groups.has(kunci)) groups.set(kunci, { nama: prod, varian, yield: 1, items: [], rusak: [] });
    const g = groups.get(kunci);
    const y = num(r['yield']);
    if (y != null) g.yield = y;
    const bahan = String(r['bahan'] ?? '').trim();
    const qty = num(r['jumlah']);
    if (bahan && qty != null) g.items.push({ bahan, qty });
    // Baris yang menyebut bahan tapi jumlahnya tidak terbaca DILAPORKAN, bukan
    // dibuang diam-diam. Resep yang kehilangan satu bahan tanpa pemberitahuan
    // menghasilkan HPP yang lebih murah dari kenyataan — dan tidak ada yang
    // curiga, karena impornya "berhasil".
    else if (bahan) g.rusak.push(`${bahan} (jumlah "${String(r['jumlah'] ?? '').trim()}" tidak terbaca)`);
  }

  let added = 0;
  let skipped = 0;
  const errors = [];
  for (const g of groups.values()) {
    const prodName = g.nama;
    const p = byName.get(bakukanNama(prodName));
    if (!p) {
      const mirip = palingMirip(prodName, semuaNama);
      errors.push(
        `${prodName}: produk tidak ditemukan di Master Produk BU ini` + (mirip ? ` — mirip dengan "${mirip}", samakan namanya` : '')
      );
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
      const ing = byName.get(bakukanNama(it.bahan));
      if (!ing) {
        const mirip = palingMirip(it.bahan, semuaNama);
        errors.push(
          `${prodName}: bahan "${it.bahan}" tidak ditemukan di Master Produk BU ini` +
            (mirip
              ? ` — mirip dengan "${mirip}", samakan namanya`
              : '. Pastikan bahannya sudah terdaftar, dan BU yang aktif di pojok atas sudah benar')
        );
        ok = false;
        break;
      }
      items.push({ ingredient_product_id: ing.id, qty: it.qty });
    }
    if (!ok) continue;
    if (g.rusak.length) {
      errors.push(`${prodName}: ${g.rusak.join(', ')} — perbaiki jumlahnya lalu impor ulang`);
      continue;
    }
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
  if (barisKosong) {
    errors.push(
      `${barisKosong} baris punya Bahan tapi kolom "Produk"-nya kosong, jadi tidak masuk resep mana pun. ` +
        'Isi nama produknya di SETIAP baris bahan (kolom Varian boleh dikosongkan — ia mewarisi baris di atasnya)'
    );
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

/**
 * Template khusus MENU — kolomnya sama persis dengan template produk, tapi
 * kolom Tipe sudah terisi "Menu" dan kolom yang cuma berlaku untuk bahan baku
 * dibiarkan kosong.
 *
 * File yang dihasilkan diimpor lewat jalur yang SAMA (Master Produk → Import
 * Excel). Membuat pengimpor kedua khusus menu akan berarti dua kode yang
 * membuat produk dengan aturan yang perlahan menyimpang — dan yang paling
 * mungkin menyimpang justru pemeriksaan duplikat dan satuan, dua hal yang baru
 * saja diperbaiki di satu tempat.
 */
export function downloadMenuTemplate() {
  downloadCsv(
    'template-menu.csv',
    'Nama,Tipe,Satuan Pakai,Satuan Beli,Isi per Satuan Beli,Harga Beli,Harga Jual\n' +
      'Es Kopi Susu,Menu,gelas,,,,18000\n' +
      'Cheesy Fries,Menu,porsi,,,,25000\n'
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
