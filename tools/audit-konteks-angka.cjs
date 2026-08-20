#!/usr/bin/env node
/**
 * LAYAR ACTUAL TIDAK BOLEH MEMBACA MESIN LAMA.
 *
 * ============ MASALAHNYA ============
 *
 * Ada DUA mesin hitung di halaman owner:
 *
 *   profit-outlet.js  -> per outlet, kemasan dari `outlet_menu_prices`
 *   bep.js            -> dilebur seluruh outlet, kemasan dari `products`
 *
 * Keduanya sengaja hidup berdampingan: yang baru melayani Actual, yang lama
 * masih melayani tab BEP & Simulasi sampai Phase 9/10 menggantikannya.
 *
 * Bahayanya justru dari situ. Kalau layar Actual mengambil satu saja angka uang
 * dari mesin lama, halaman akan menampilkan DUA LABA yang berbeda tipis —
 * sama-sama masuk akal, di dua tab yang sama-sama berlabel "actual", dan tidak
 * ada yang bisa memutuskan mana yang benar. Tidak ada error, tidak ada yang
 * rusak; cuma dua angka yang tidak pernah cocok.
 *
 * ============ YANG DIPERIKSA ============
 *
 *   1. Layar Actual & Ringkasan tidak menyentuh field uang mesin lama.
 *   2. Hasil `profit-outlet.js` selalu membawa `konteks`.
 *   3. Layar yang menampilkan angka uang memasang penanda konteks di layar.
 */

const fs = require('fs');
const path = require('path');

const AKAR = path.join(__dirname, '..');
const DIR = path.join(AKAR, 'js', 'modules', 'owner');

/** Layar yang HANYA boleh memakai `d.actual` untuk angka uang. */
const LAYAR_ACTUAL = ['actual.owner.js', 'ringkasan.owner.js'];

/** Field uang milik mesin lama. Membacanya di layar Actual = dua sumber. */
const FIELD_LAMA = [
  'penjualan.omzet',
  'penjualan.labaKotor',
  'penjualan.marginPersen',
  'ringkasan.omzet',
  'ringkasan.labaKotor',
  'ringkasan.sisaSetelahBiayaTetap',
  'bauran.totalOmzet',
  'bauran.marginTertimbang',
  'bauran.hargaTertimbang',
  'keuangan.biayaTetap'
];

function tanpaKomentar(js) {
  return js
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((b) => b.replace(/(^|[^:])\/\/.*$/, '$1'))
    .join('\n');
}

const masalah = [];
let diperiksa = 0;

for (const nama of LAYAR_ACTUAL) {
  const jalan = path.join(DIR, nama);
  if (!fs.existsSync(jalan)) {
    masalah.push(`${nama} tidak ditemukan — daftar LAYAR_ACTUAL sudah basi.`);
    continue;
  }
  const src = tanpaKomentar(fs.readFileSync(jalan, 'utf8'));
  diperiksa++;

  for (const f of FIELD_LAMA) {
    const pola = new RegExp(f.replace('.', '\\.') + '\\b');
    if (!pola.test(src)) continue;
    const baris = src.split('\n').findIndex((b) => pola.test(b)) + 1;
    masalah.push(
      `${nama}:${baris} — membaca "${f}" dari mesin lama (bep.js/kpi.js).\n` +
        `    Layar ini harus memakai d.actual (profit-outlet.js) untuk SEMUA angka uang.\n` +
        `    Dua sumber = dua laba yang berbeda tipis di dua tab, tanpa cara menentukan\n` +
        `    mana yang benar.`
    );
  }

  if (!/tanda-konteks/.test(src)) {
    masalah.push(
      `${nama} — tidak memasang penanda konteks di layar.\n` +
        `    Angka profitabilitas tanpa label ACTUAL/PROJECTED/SIMULATED akan\n` +
        `    disalahartikan: laba hasil simulasi dan laba dari transaksi terlihat sama.`
    );
  }
}

// Mesin barunya sendiri harus selalu menandai konteks.
const mesin = fs.readFileSync(path.join(DIR, 'profit-outlet.js'), 'utf8');
for (const fn of ['hitungActualOutlet', 'konsolidasiOutlet', 'ringkasBu']) {
  const i = mesin.indexOf(`export function ${fn}`);
  if (i < 0) {
    masalah.push(`profit-outlet.js — fungsi ${fn} tidak ada lagi.`);
    continue;
  }
  const tubuh = mesin.slice(i, i + 6000);
  if (!/konteks:\s*'actual'/.test(tubuh)) {
    masalah.push(`profit-outlet.js — ${fn}() mengembalikan hasil tanpa konteks: 'actual'.`);
  }
}

if (masalah.length) {
  console.error('❌ Angka uang berpotensi datang dari dua sumber:\n');
  for (const p of masalah) console.error(`  ${p}\n`);
  process.exit(1);
}

console.log(`${diperiksa} layar Actual diperiksa; semuanya satu sumber & berlabel konteks. ✅`);
