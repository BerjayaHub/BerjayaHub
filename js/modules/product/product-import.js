import { listProducts, createProduct, updateProduct, listRecipesFull, saveRecipe, listUnits, createUnit } from './product.service.js';
import { bakukanNama, palingMirip, bacaAngka } from '../../core/nama.js';
import { rencanaLengkapi, saringMenurutTipe, kolomDiabaikan, petaResep } from './import-merge.js';
import { curigaHargaTertukar } from './harga-curiga.js';
import { periksaBahan } from './periksa-resep.js';

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

/**
 * Kolom harga beli — menerima judul lama DAN yang baru.
 *
 * Judulnya diperjelas jadi "Harga Beli (per Satuan Beli)" karena "Harga Beli"
 * saja bisa dibaca dua arah, dan salah baca di kolom ini tidak menimbulkan
 * error apa pun — cuma HPP yang salah diam-diam. Tapi file lama yang sudah
 * beredar di WhatsApp tetap harus bisa dipakai: memaksa orang mengunduh
 * template baru untuk mengimpor data yang sudah benar bukan perbaikan.
 */
const hargaBeli = (r) => r['harga beli (per satuan beli)'] ?? r['harga beli'];

/**
 * @param {object} [opsi]
 * @param {boolean} [opsi.timpa=false]        ganti juga nilai yang sudah terisi
 * @param {boolean} [opsi.hanyaRencana=false] hitung saja, JANGAN simpan apa pun
 *
 * `hanyaRencana` ada supaya mode timpa bisa diperlihatkan dulu sebelum
 * dijalankan. Menghitungnya lewat jalur yang SAMA — bukan kode pratinjau
 * tersendiri — adalah intinya: pratinjau yang disusun kode lain akan
 * menyimpang dari yang benar-benar terjadi, dan pratinjau yang berbohong lebih
 * berbahaya daripada tidak ada pratinjau, karena orang menekan Simpan
 * justru karena sudah memeriksanya.
 */
/**
 * Mengumpulkan kolom yang diisi tapi tidak berlaku, beserta jumlah barisnya.
 *
 * Dihitung per BARIS lalu diringkas per kolom: laporan yang menyebut lima puluh
 * baris satu per satu tidak akan dibaca, sedangkan "Harga Beli diabaikan di 50
 * baris" langsung memberi tahu bahwa ini pola, bukan salah ketik sekali.
 */
function catatDiabaikan(peta, type, nilai) {
  for (const label of kolomDiabaikan(type, nilai)) peta.set(label, (peta.get(label) ?? 0) + 1);
}

export async function importProducts(businessUnitId, file, { timpa = false, hanyaRencana = false } = {}) {
  const rows = await readRows(file);
  const existing = await listProducts(businessUnitId);
  // Peta ke PRODUKNYA, bukan sekadar himpunan nama: impor ulang kini bisa
  // melengkapi kolom yang masih kosong, dan untuk itu nilai lamanya harus
  // terbaca.
  const byName = new Map(existing.map((p) => [bakukanNama(p.name), p]));

  // Satuan yang belum ada di Master Satuan didaftarkan otomatis.
  //
  // `products.base_unit` cuma kolom teks — tidak ada FK ke `units` — jadi
  // satuan baru TIDAK PERNAH menggagalkan impor produk. Yang terjadi tanpa ini:
  // produknya masuk, tapi satuannya tidak muncul di dropdown saat produk itu
  // disunting manual, dan orangnya harus mengetiknya ulang persis sama.
  // Satuan baru tidak didaftarkan saat menghitung rencana — pratinjau tidak
  // boleh mengubah apa pun, termasuk hal yang terasa sepele seperti menambah
  // satuan. Kalau orangnya membatalkan, tidak ada sisa yang tertinggal.
  const satuanBaru = hanyaRencana ? { ditambah: [], gagal: [] } : await daftarkanSatuanBaru(rows);

  let added = 0;
  let skipped = 0;
  let dilengkapi = 0;
  const errors = [];
  const catatan = [];
  const perubahan = [];
  const diabaikan = new Map(); // "Harga Beli" -> berapa baris
  const peringatan = [];
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
    const sudahAda = byName.get(bakukanNama(name));
    const type = TYPE_MAP[bakukanNama(r['tipe'])];
    const baseUnit = String(r['satuan pakai'] ?? '').trim();

    // ---- Nama yang SUDAH ADA: dilengkapi, bukan dibuat ulang atau dilewati ----
    if (sudahAda) {
      // Tipe yang BERLAKU adalah tipe di sistem, bukan yang di file: impor tidak
      // pernah mengubah tipe (lihat STRUKTURAL), jadi memakai tipe dari file
      // untuk memutuskan kolom mana yang boleh ditulis akan membuka celah yang
      // sama lewat pintu lain — cukup menulis "Bahan Baku" di file untuk
      // menitipkan harga beli ke sebuah setengah jadi.
      const tipeBerlaku = sudahAda.product_type ?? type;
      catatDiabaikan(diabaikan, tipeBerlaku, {
        purchase_unit: String(r['satuan beli'] ?? '').trim(),
        purchase_qty: num(r['isi per satuan beli']),
        purchase_price: num(hargaBeli(r)),
        sale_price: num(r['harga jual'])
      });
      const { patch, terisi, diubah, konflik } = rencanaLengkapi(
        sudahAda,
        saringMenurutTipe(tipeBerlaku, {
          category: String(r['kategori'] ?? '').trim(),
          subcategory: String(r['sub kategori'] ?? r['subkategori'] ?? '').trim(),
          purchase_unit: String(r['satuan beli'] ?? '').trim(),
          purchase_qty: num(r['isi per satuan beli']),
          purchase_price: num(hargaBeli(r)),
          sale_price: num(r['harga jual']),
          product_type: type,
          base_unit: baseUnit
        }),
        { timpa }
      );
      if (konflik.length) {
        errors.push(`Baris ${i + 2} — ${name}: ${konflik.join('; ')} — nilai di sistem DIPERTAHANKAN, ubah manual kalau file yang benar`);
      }
      if (diubah.length) perubahan.push(`${name} — ${diubah.join('; ')}`);
      if (Object.keys(patch).length) {
        try {
          // Seluruh kolom dikirim ulang karena `updateProduct` menulis semuanya;
          // yang tidak ada di patch memakai nilai lamanya.
          if (!hanyaRencana) await updateProduct(sudahAda.id, { ...sudahAda, ...patch });
          dilengkapi++;
          if (terisi.length) catatan.push(`${name}: ${terisi.join(', ')} dilengkapi`);
          const curigaLengkap = curigaHargaTertukar({ ...sudahAda, ...patch });
          if (curigaLengkap) peringatan.push(`Baris ${noBaris} — ${curigaLengkap}`);
        } catch (e) {
          errors.push(`Baris ${i + 2} — ${name}: gagal melengkapi — ${e.message ?? e}`);
        }
      } else {
        skipped++;
      }
      continue;
    }

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
    catatDiabaikan(diabaikan, type, {
      purchase_unit: String(r['satuan beli'] ?? '').trim(),
      purchase_qty: num(r['isi per satuan beli']),
      purchase_price: num(hargaBeli(r)),
      sale_price: num(r['harga jual'])
    });
    try {
      if (!hanyaRencana) {
        await createProduct({
          businessUnitId,
          name,
          product_type: type,
          // Kategori diambil apa adanya dari file — TIDAK dicocokkan ke daftar
          // tetap. Kategori itu urusan yang punya usaha ("Minuman", "Makanan",
          // "Snack", "Frozen"), dan mengunci daftarnya di kode berarti setiap
          // kategori baru harus menunggu deploy.
          category: String(r['kategori'] ?? '').trim() || null,
          subcategory: String(r['sub kategori'] ?? r['subkategori'] ?? '').trim() || null,
          base_unit: baseUnit,
          // Aturan "kolom mana berlaku untuk tipe apa" dipakai dari SATU tempat
          // yang sama dengan jalur lengkapi. Sebelumnya keduanya menuliskannya
          // sendiri-sendiri, dan sudah terlanjur menyimpang.
          ...saringMenurutTipe(type, {
            purchase_unit: String(r['satuan beli'] ?? '').trim() || null,
            purchase_qty: num(r['isi per satuan beli']),
            purchase_price: num(hargaBeli(r)),
            sale_price: num(r['harga jual'])
          })
        });
      }
      byName.set(bakukanNama(name), { id: null, name, product_type: type, base_unit: baseUnit });
      added++;
      // Diperiksa SESUDAH tersimpan, dan hasilnya peringatan — bukan penolakan.
      // Tidak ada rumus yang bisa memastikan angka mana yang dimaksud orangnya.
      const curiga = curigaHargaTertukar({
        name,
        product_type: type,
        base_unit: baseUnit,
        purchase_unit: String(r['satuan beli'] ?? '').trim(),
        purchase_qty: num(r['isi per satuan beli']),
        purchase_price: num(hargaBeli(r))
      });
      if (curiga) peringatan.push(`Baris ${noBaris} — ${curiga}`);
    } catch (e) {
      errors.push(`Baris ${noBaris} — ${name}: ${e.message ?? e}`);
    }
  }
  if (barisKosong) {
    errors.push(`${barisKosong} baris dilewati karena kolom "Nama" kosong (sel tergabung, baris judul, atau baris sisa di bawah tabel)`);
  }
  // Diurutkan dari yang paling sering supaya yang paling mungkin disalahpahami
  // muncul lebih dulu.
  const diabaikanTeks = [...diabaikan.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([label, n]) => `${label} diabaikan di ${n} baris — kolom itu hanya berlaku untuk tipe tertentu`);
  return { added, skipped, dilengkapi, catatan, perubahan, errors, peringatan, diabaikan: diabaikanTeks, satuanBaru };
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
  // "Sudah ada" diukur dari ISINYA, bukan dari adanya baris — aturannya di
  // `petaResep()` beserta alasannya.
  const { berisi: hasRecipe, kosong: resepKosong } = petaResep(recipesFull);

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
  const catatanResep = [];
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
    // RESEP KOSONG TIDAK DILEWATI — ia diisi.
    //
    // Sebelumnya "sudah ada" diukur dari ADANYA BARIS resep, bukan isinya.
    // Akibatnya resep yang tertinggal kosong (penyimpanan terputus di tengah —
    // lihat 0082) menjadi TIDAK BISA DIPERBAIKI LEWAT IMPOR: tiap impor ulang
    // menjawab "dilewati, resep sudah ada", sementara di layar tetap tertulis
    // resepnya kosong. Satu-satunya jalan keluar adalah membuka dan mengisi
    // ratusan resep satu per satu — yang justru pekerjaan yang mau dihindari
    // dengan mengimpor.
    //
    // Baris resepnya tidak dihapus dulu: `saveRecipe` memang memperbarui yang
    // sudah ada, dan menghapus lebih dulu berarti membuka lagi celah setengah
    // jadi yang sama.
    const mengisiYangKosong = resepKosong.has(`${p.id}|${mode}`);
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
    // Penjaga yang SAMA dengan editor: bahan yang menunjuk produknya sendiri
    // ditolak (siklus = HPP null selamanya), dan bahan yang muncul dua kali
    // digabung, bukan disimpan dua baris yang biayanya ikut dijumlahkan.
    // Lewat impor keduanya jauh lebih mudah terjadi daripada lewat form.
    const namaBahan = new Map(products.map((x) => [x.id, x.name]));
    const tipeBahan = new Map(products.map((x) => [x.id, x.product_type]));
    const { items: bersih, masalah } = periksaBahan(items, { productId: p.id, nama: namaBahan, tipe: tipeBahan });
    if (masalah.length) {
      errors.push(`${prodName}: ${masalah.join('; ')}`);
      continue;
    }
    if (!bersih.length) {
      errors.push(`${prodName}: tidak ada bahan`);
      continue;
    }
    if (bersih.length !== items.length) {
      catatanResep.push(`${prodName}: ada bahan yang disebut lebih dari sekali — jumlahnya digabung`);
    }
    try {
      await saveRecipe({ productId: p.id, businessUnitId, mode, yield_qty: g.yield || 1, notes: null, items: bersih });
      hasRecipe.add(`${p.id}|${mode}`);
      resepKosong.delete(`${p.id}|${mode}`);
      added++;
      if (mengisiYangKosong) {
        catatanResep.push(`${prodName} (${MODE_TEKS[mode] ?? mode}): resep yang tadinya kosong sekarang terisi`);
      }
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
  return { added, skipped, errors, catatan: catatanResep };
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
    'Nama,Tipe,Kategori,Sub Kategori,Satuan Pakai,Satuan Beli,Isi per Satuan Beli,Harga Beli (per Satuan Beli),Harga Jual\n' +
      'Gula,Bahan Baku,Bahan Kering,,gram,karung,25000,150000,\n' +
      'Sirup Gula,Setengah Jadi,Bahan Olahan,,ml,,,,\n' +
      'Es Kopi Susu,Menu,Minuman,Kopi,gelas,,,,18000\n'
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
    'Nama,Tipe,Kategori,Sub Kategori,Satuan Pakai,Satuan Beli,Isi per Satuan Beli,Harga Beli (per Satuan Beli),Harga Jual\n' +
      'Es Kopi Susu,Menu,Minuman,Kopi,gelas,,,,18000\n' +
      'Lemon Tea,Menu,Minuman,Teh,gelas,,,,15000\n' +
      'Cheesy Fries,Menu,Makanan,Snack,porsi,,,,25000\n'
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
