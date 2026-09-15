/**
 * EKSPOR MASTER PRODUK — bahan & menu, satu berkas Excel.
 *
 * ============ YANG DIMINTA ============
 *
 *   "sediakan export excel di master produk, untuk saya mendownload data bahan
 *    dan produk dari berjaya hub"
 *
 * ============ SEMBILAN KOLOM PERTAMANYA BUKAN PILIHAN BEBAS ============
 *
 * Kolom 1-9 SAMA PERSIS dengan `template-produk.csv` (`product-import.js`),
 * berikut judulnya, urutannya, dan ejaan tipenya ("Bahan Baku" / "Setengah
 * Jadi" / "Menu" — yang dikenali `TYPE_MAP`).
 *
 * Sebabnya: "download data" hampir selalu berarti "sunting di Excel lalu
 * masukkan lagi". Berkas ekspor yang judulnya sedikit berbeda dari template
 * impor tidak akan gagal dengan jelas — ia akan terimpor SEBAGIAN, kolom yang
 * judulnya tidak dikenali dibaca sebagai kosong, dan harga beli 785 produk
 * lenyap tanpa satu pun pesan.
 *
 * Kolom sesudahnya (HPP, margin, status, catatan) TURUNAN: pengimpor
 * mengabaikan kolom yang tidak dikenalnya, jadi ia aman ikut dalam berkas yang
 * sama.
 *
 * ============ KOSONG ITU DUA ARTI, DAN DIBEDAKAN ============
 *
 *   Kolom yang bisa diimpor  -> sel KOSONG. Sama seperti template, dan
 *                               `bacaAngka('')` memang null. Menulis "-" di
 *                               sini membuat orang mengetiknya balik apa adanya.
 *   Kolom turunan (HPP dsb)  -> "-". Ia BUKAN isian yang lupa diisi, melainkan
 *                               angka yang tidak bisa dihitung — dan kolom
 *                               Catatan menyebut sebabnya.
 *
 * Tidak ada impor selain pemformat & aturan murni lain, supaya bisa diuji tanpa
 * browser.
 */

import { formatNum, formatRupiah } from '../../core/format.js';
import { bakukanNama } from '../../core/nama.js';
import { cocokSaringan } from './saringan.js';
import { curigaHargaTertukar } from './harga-curiga.js';

export const TYPE_LABEL = { raw: 'Bahan Baku', semi: 'Setengah Jadi', finished: 'Menu' };

/**
 * Judul kolom 1-9 HARUS sama dengan `downloadProductTemplate()`.
 *
 * Ditulis sebagai konstanta tersendiri supaya audit bisa membandingkannya
 * langsung dengan baris template di `product-import.js`. Dua daftar judul yang
 * "kelihatannya sama" adalah persis jenis hal yang menyimpang diam-diam.
 */
export const KOLOM_IMPOR = [
  'Nama',
  'Tipe',
  'Kategori',
  'Sub Kategori',
  'Satuan Pakai',
  'Satuan Beli',
  'Isi per Satuan Beli',
  'Harga Beli (per Satuan Beli)',
  'Harga Jual'
];

export const KOLOM_PRODUK = [
  { header: KOLOM_IMPOR[0], width: 2.4 },
  { header: KOLOM_IMPOR[1], width: 1 },
  { header: KOLOM_IMPOR[2], width: 1.3 },
  { header: KOLOM_IMPOR[3], width: 1.3 },
  { header: KOLOM_IMPOR[4], width: 0.9 },
  { header: KOLOM_IMPOR[5], width: 0.9 },
  { header: KOLOM_IMPOR[6], width: 1.1, align: 'right', numeric: true },
  { header: KOLOM_IMPOR[7], width: 1.4, align: 'right', numeric: true },
  { header: KOLOM_IMPOR[8], width: 1.2, align: 'right', numeric: true },
  // ---- mulai di sini: turunan, tidak dibaca pengimpor ----
  { header: 'HPP / Satuan', width: 1.2, align: 'right', numeric: true },
  { header: 'Margin', width: 1.2, align: 'right', numeric: true },
  { header: 'Margin %', width: 0.8, align: 'right', numeric: true },
  { header: 'Status', width: 0.9 },
  { header: 'Catatan', width: 3.4 }
];

export const KOLOM_REKAP_PRODUK = [
  { header: 'Tipe', width: 1.2 },
  { header: 'Kategori', width: 1.8 },
  { header: 'Jumlah', width: 0.8, align: 'right', numeric: true },
  { header: 'Nonaktif', width: 0.9, align: 'right', numeric: true },
  { header: 'Belum ada HPP', width: 1.1, align: 'right', numeric: true },
  { header: 'Menu tanpa harga jual', width: 1.3, align: 'right', numeric: true },
  { header: 'Harga beli perlu dicek', width: 1.3, align: 'right', numeric: true }
];

export const TANPA_KATEGORI = '(tanpa kategori)';

const teks = (v) => (v === null || v === undefined ? '' : String(v));

/** `null`/`undefined`/`''` berarti kosong; `0` TIDAK. Non-finite juga kosong. */
function angkaAtauNull(v) {
  // `Number('')` dan `Number(null)` adalah 0, bukan NaN — disaring lebih dulu.
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Kenapa baris ini perlu dilihat orangnya.
 *
 * SENGAJA TIDAK memanggil `sebabHppKosong()`. Fungsi itu membangun ulang
 * seluruh graf resep tiap kali dipanggil; untuk 785 produk itu 785 pembangunan
 * graf, dan ekspornya akan menggantungkan tab selama belasan detik tanpa satu
 * pun tanda. Yang ditulis di sini adalah sebab yang bisa dibaca dari BARISNYA
 * SENDIRI — layar Master Produk tetap menyimpan penjelasan berantainya.
 *
 * @returns {string} '' kalau tidak ada yang perlu disebut
 */
export function catatanProduk(p, hpp) {
  const catatan = [];
  const tipe = teks(p?.product_type);

  if (hpp == null) {
    if (tipe === 'raw') {
      if (angkaAtauNull(p?.purchase_price) === null) catatan.push('Harga beli belum diisi');
      else if (!(Number(p?.purchase_qty) > 0)) catatan.push('"Isi per Satuan Beli" belum diisi, jadi harga per satuan pakai tidak bisa dihitung');
      else catatan.push('HPP belum bisa dihitung');
    } else {
      catatan.push('Belum punya resep, atau ada bahannya yang belum berharga');
    }
  }

  if (tipe === 'finished' && angkaAtauNull(p?.sale_price) === null) catatan.push('Harga jual belum diisi');

  // Peringatan harga tertukar dipakai APA ADANYA dari `harga-curiga.js` — sama
  // dengan yang muncul sebagai lencana "⚠ cek satuan" di layar. Menulis ulang
  // kalimatnya di sini berarti dua penjelasan untuk satu aturan, dan yang di
  // berkas Excel-lah yang akan ketinggalan saat aturannya diperbaiki.
  const curiga = curigaHargaTertukar(p);
  if (curiga) catatan.push(curiga);

  if (p?.is_active === false) catatan.push('Produk nonaktif');

  return catatan.join(' · ');
}

/**
 * @param {object} o
 * @param {object[]} o.produk baris `products`
 * @param {Map<string, number|null>} [o.hpp] hasil `computeCosts`
 * @param {{nama?: string, tipe?: string, kategori?: string, subKategori?: string}} [o.saring]
 *   saringan yang SEDANG AKTIF di layar — berkasnya harus berisi apa yang
 *   dilihat orangnya, bukan diam-diam lebih banyak.
 */
export function susunEksporProduk({ produk, hpp = new Map(), saring = {} } = {}) {
  const semua = Array.isArray(produk) ? produk : [];

  // Dibakukan di KEDUA sisi, sama seperti penyaring di layar. Kalau tidak,
  // mengetik "gula pasir" saat "Gula  Pasir" tersimpan dengan spasi ganda akan
  // menghasilkan berkas kosong — dan berkas kosong terbaca sebagai data hilang,
  // bukan sebagai saringan yang tidak cocok.
  const saringan = {
    nama: bakukanNama(saring?.nama ?? ''),
    tipe: teks(saring?.tipe),
    kategori: teks(saring?.kategori),
    subKategori: teks(saring?.subKategori)
  };
  const adaSaringan = Boolean(saringan.nama || saringan.tipe || saringan.kategori || saringan.subKategori);

  const dipakai = semua.filter((p) =>
    cocokSaringan(
      {
        nama: bakukanNama(p?.name),
        tipe: TYPE_LABEL[p?.product_type] ?? teks(p?.product_type),
        kategori: teks(p?.category),
        subKategori: teks(p?.subcategory)
      },
      saringan
    )
  );

  // Urut tipe (bahan baku -> setengah jadi -> menu), lalu kategori, lalu nama —
  // urutan yang sama dengan cara master produk dibaca orang.
  const urutTipe = { raw: 0, semi: 1, finished: 2 };
  const baris = [...dipakai].sort(
    (a, b) =>
      (urutTipe[a?.product_type] ?? 9) - (urutTipe[b?.product_type] ?? 9) ||
      teks(a?.category).localeCompare(teks(b?.category), 'id') ||
      teks(a?.name).localeCompare(teks(b?.name), 'id')
  );

  let tanpaHpp = 0;
  let tanpaHargaJual = 0;
  let perluCek = 0;
  let nonaktif = 0;

  const rincian = baris.map((p) => {
    const h = angkaAtauNull(hpp instanceof Map ? hpp.get(p?.id) : null);
    const jual = angkaAtauNull(p?.sale_price);
    const isMenu = p?.product_type === 'finished';
    const isRaw = p?.product_type === 'raw';

    if (h === null) tanpaHpp++;
    if (isMenu && jual === null) tanpaHargaJual++;
    if (curigaHargaTertukar(p)) perluCek++;
    if (p?.is_active === false) nonaktif++;

    let margin = null;
    let marginPct = null;
    if (isMenu && jual !== null && h !== null) {
      margin = jual - h;
      marginPct = jual > 0 ? (margin / jual) * 100 : 0;
    }

    return [
      // ---- 1-9: SAMA PERSIS dengan template impor; kosong = sel kosong ----
      teks(p?.name),
      TYPE_LABEL[p?.product_type] ?? teks(p?.product_type),
      teks(p?.category),
      teks(p?.subcategory),
      teks(p?.base_unit),
      isRaw ? teks(p?.purchase_unit) : '',
      isRaw && angkaAtauNull(p?.purchase_qty) !== null ? formatNum(Number(p.purchase_qty), 4) : '',
      isRaw && angkaAtauNull(p?.purchase_price) !== null ? formatRupiah(Number(p.purchase_price)) : '',
      isMenu && jual !== null ? formatRupiah(jual) : '',
      // ---- 10 dst: turunan; kosong = "-" karena ia tidak bisa dihitung ----
      h === null ? '-' : formatRupiah(h),
      margin === null ? '-' : formatRupiah(margin),
      marginPct === null ? '-' : `${formatNum(marginPct, 1)}%`,
      p?.is_active === false ? 'Nonaktif' : 'Aktif',
      catatanProduk(p, h)
    ];
  });

  // ---- Rekap kelengkapan per tipe & kategori ----
  //
  // Inilah pertanyaan yang biasanya jadi alasan orang mengunduh master:
  // "mana yang belum lengkap". Menjawabnya di sheet sendiri lebih murah
  // daripada memintanya membuat pivot tiap kali.
  const kelompok = new Map();
  for (const p of baris) {
    const kunci = `${p?.product_type}|${teks(p?.category)}`;
    if (!kelompok.has(kunci)) {
      kelompok.set(kunci, {
        tipe: TYPE_LABEL[p?.product_type] ?? teks(p?.product_type),
        urut: urutTipe[p?.product_type] ?? 9,
        kategori: teks(p?.category) || TANPA_KATEGORI,
        jumlah: 0,
        nonaktif: 0,
        tanpaHpp: 0,
        tanpaJual: 0,
        perluCek: 0
      });
    }
    const g = kelompok.get(kunci);
    g.jumlah++;
    if (p?.is_active === false) g.nonaktif++;
    if (angkaAtauNull(hpp instanceof Map ? hpp.get(p?.id) : null) === null) g.tanpaHpp++;
    if (p?.product_type === 'finished' && angkaAtauNull(p?.sale_price) === null) g.tanpaJual++;
    if (curigaHargaTertukar(p)) g.perluCek++;
  }

  const rekap = [...kelompok.values()]
    .sort((a, b) => a.urut - b.urut || a.kategori.localeCompare(b.kategori, 'id'))
    .map((g) => [
      g.tipe,
      g.kategori,
      formatNum(g.jumlah),
      formatNum(g.nonaktif),
      formatNum(g.tanpaHpp),
      formatNum(g.tanpaJual),
      formatNum(g.perluCek)
    ]);

  const sebutSaringan = [
    saring?.nama ? `cari "${teks(saring.nama)}"` : '',
    saringan.tipe,
    saringan.kategori,
    saringan.subKategori
  ]
    .filter(Boolean)
    .join(' · ');

  const subjudul = [
    // Jumlah yang DISARING KELUAR disebut terus terang. Berkas berisi 40 baris
    // dari master 785 produk tidak punya cara lain untuk mengaku bahwa ia
    // sebagian — dan yang menerimanya lewat WhatsApp tidak melihat layarnya.
    adaSaringan ? `Saringan: ${sebutSaringan || '(aktif)'}` : 'Seluruh produk',
    `${rincian.length} dari ${semua.length} produk`,
    tanpaHpp ? `${tanpaHpp} belum ada HPP` : '',
    tanpaHargaJual ? `${tanpaHargaJual} menu belum ada harga jual` : '',
    perluCek ? `${perluCek} harga beli perlu dicek` : '',
    nonaktif ? `${nonaktif} nonaktif` : ''
  ]
    .filter(Boolean)
    .join(' · ');

  return {
    judul: 'Master Produk & Bahan',
    subjudul,
    namaBerkas: `master-produk-${tanggalBerkas()}`,
    kolomRincian: KOLOM_PRODUK,
    rincian,
    kolomRekap: KOLOM_REKAP_PRODUK,
    rekap,
    ringkas: {
      total: semua.length,
      tampil: rincian.length,
      disaring: semua.length - rincian.length,
      tanpaHpp,
      tanpaHargaJual,
      perluCek,
      nonaktif,
      adaSaringan
    }
  };
}

/** `YYYY-MM-DD` dari komponen LOKAL — `toISOString` bisa menggeser satu hari. */
function tanggalBerkas(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
