#!/usr/bin/env node
/**
 * HARGA JUAL DATANG DARI OUTLET, BUKAN DARI BU.
 *
 * ============ APA YANG DIJAGA ============
 *
 * Sejak `0096`, `products.sale_price` berstatus ACUAN SAJA. Harga yang dipakai
 * mencatat transaksi dan menghitung profitabilitas ada di `outlet_menu_prices`.
 *
 * Kolomnya sengaja TIDAK dihapus — ia masih dipakai Master Produk, impor xlsx,
 * dan sebagai nilai awal saat harga outlet dibuat. Justru karena masih ada
 * itulah ia gampang terpakai lagi di tempat yang salah: namanya `sale_price`,
 * nilainya angka rupiah yang wajar, dan tidak ada yang terlihat keliru.
 *
 * Kalau itu terjadi, akibatnya persis kembali ke keadaan sebelum revisi: dua
 * outlet menampilkan margin yang sama karena keduanya membaca satu harga BU —
 * dan tidak ada error apa pun yang menandainya.
 *
 * ============ DUA ATURAN ============
 *
 *   1. `sale_price` dilarang di jalur PENJUALAN dan PROFITABILITAS.
 *      Diizinkan di master produk, menu (editor harga acuan), dan impor.
 *
 *   2. `record_sales` tidak boleh dipanggil tanpa `p_ref`.
 *      Tanpa penanda kiriman, perlindungan penjualan-ganda hilang — dan
 *      hilangnya tidak terlihat: transaksinya tetap tersimpan, hanya bisa
 *      tersimpan dua kali.
 */

const fs = require('fs');
const path = require('path');

const AKAR = path.join(__dirname, '..');
const DIR_JS = path.join(AKAR, 'js');

/**
 * Berkas yang BOLEH menyentuh `products.sale_price`, beserta alasannya.
 *
 * Daftar ini pendek dan sadar. Yang tidak terdaftar otomatis dilarang — jadi
 * berkas baru yang memakainya akan berbunyi, bukan diam-diam lolos.
 */
const BOLEH_SALE_PRICE = {
  'product.service.js': 'CRUD master produk — sale_price adalah kolomnya sendiri',
  'product.admin.page.js': 'Master Produk menampilkan & menyunting harga acuan',
  'product-import.js': 'impor xlsx mengisi harga acuan',
  'import-merge.js': 'pemetaan kolom xlsx',
  'menu.admin.page.js': 'editor harga acuan BU (nilai awal saat harga outlet dibuat)',
  'harga-outlet.service.js': 'membaca acuan sebagai nilai awal harga outlet'
};

/** Jalur yang paling berbahaya bila memakai harga BU. */
const JALUR_TERLARANG = [/[\\/]sales[\\/]/, /[\\/]owner[\\/]/, /[\\/]report[\\/]/];

function berkasJs(dir, keluar = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) berkasJs(p, keluar);
    else if (e.name.endsWith('.js')) keluar.push(p);
  }
  return keluar;
}

function tanpaKomentar(js) {
  return js
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((b) => b.replace(/(^|[^:])\/\/.*$/, '$1'))
    .join('\n');
}

const masalah = [];
let diperiksa = 0;
let dipakaiSah = 0;

for (const berkas of berkasJs(DIR_JS)) {
  const rel = path.relative(AKAR, berkas);
  const nama = path.basename(berkas);
  const src = tanpaKomentar(fs.readFileSync(berkas, 'utf8'));
  diperiksa++;

  // --- (1) sale_price di jalur terlarang
  for (const m of src.matchAll(/\bsale_price\b/g)) {
    if (BOLEH_SALE_PRICE[nama]) {
      dipakaiSah++;
      continue;
    }
    if (!JALUR_TERLARANG.some((p) => p.test(rel))) {
      dipakaiSah++;
      continue;
    }
    const baris = src.slice(0, m.index).split('\n').length;
    masalah.push(
      `${rel}:${baris} — memakai products.sale_price di jalur penjualan/profitabilitas.\n` +
        `    Sejak 0096 itu harga ACUAN BU, bukan harga transaksi. Memakainya di sini\n` +
        `    membuat semua outlet menampilkan margin yang sama, tanpa satu pun error.\n` +
        `    Yang benar: outlet_menu_prices (lihat menu/harga-outlet.service.js).`
    );
  }

  // --- (2) record_sales tanpa p_ref
  //
  // Rantainya dipotong di `;`, BUKAN di kurung tutup pertama. Versi pertama
  // memakai `[\s\S]{0,400}?\)` — non-greedy sampai `)` — dan kurung pertama
  // yang ditemuinya adalah kurung di dalam `items.map((i) => ({...}))`.
  // Jendelanya menutup sebelum `p_ref` sempat terbaca, jadi audit ini
  // menyalahkan panggilan yang sudah benar pada jalan pertamanya.
  for (const m of src.matchAll(/rpc\(\s*['"`]record_sales['"`]/g)) {
    const sisa = src.slice(m.index, m.index + 800);
    const akhir = sisa.indexOf(';');
    const panggilan = akhir >= 0 ? sisa.slice(0, akhir) : sisa;
    if (/p_ref/.test(panggilan)) continue;
    const baris = src.slice(0, m.index).split('\n').length;
    masalah.push(
      `${rel}:${baris} — memanggil record_sales tanpa p_ref.\n` +
        `    Tanpa penanda kiriman, kirim ulang menghasilkan penjualan & pemakaian\n` +
        `    stok yang dobel. Transaksinya tetap tersimpan, jadi tidak ada tanda apa pun.`
    );
  }
}

// --- (3) Keadaan sebaliknya: kalau tidak ada satu pun pemakaian yang sah, berarti
// penelusurannya rusak dan audit ini hijau tanpa memeriksa apa-apa.
if (dipakaiSah === 0) {
  masalah.push('Tidak satu pun pemakaian sale_price ditemukan. Penelusurannya kemungkinan rusak.');
}

if (masalah.length) {
  console.error('❌ Harga BU dipakai di tempat yang seharusnya harga outlet:\n');
  for (const p of masalah) console.error(`  ${p}\n`);
  process.exit(1);
}

console.log(`${diperiksa} berkas diperiksa; ${dipakaiSah} pemakaian sale_price semuanya di jalur yang sah. ✅`);
