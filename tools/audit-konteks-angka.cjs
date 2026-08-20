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

/**
 * Layar yang HANYA boleh memakai `d.proyeksi`.
 *
 * Pemisahan ini dua arah, dan arah yang kedua yang lebih berbahaya: layar
 * berlabel ACTUAL yang diam-diam menampilkan satu angka proyeksi tidak akan
 * pernah menampilkan error. Ia menampilkan laba yang lebih besar, dengan label
 * yang mengatakan angka itu sudah terjadi.
 */
const LAYAR_PROYEKSI = ['proyeksi.owner.js'];

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

  // Layar ACTUAL tidak boleh menyentuh proyeksi sama sekali.
  if (/\bd\.proyeksi\b/.test(src)) {
    const baris = src.split('\n').findIndex((b) => /\bd\.proyeksi\b/.test(b)) + 1;
    masalah.push(
      `${nama}:${baris} — layar berlabel ACTUAL membaca d.proyeksi.\n` +
        `    Angka estimasi yang muncul di bawah label "aktual" tidak akan menimbulkan\n` +
        `    error apa pun. Ia hanya menampilkan laba yang lebih besar, dengan label\n` +
        `    yang mengatakan laba itu sudah terjadi.`
    );
  }
}

// =====================================================================
// LAYAR PROYEKSI — cerminnya.
// =====================================================================
for (const nama of LAYAR_PROYEKSI) {
  const jalan = path.join(DIR, nama);
  if (!fs.existsSync(jalan)) {
    masalah.push(`${nama} tidak ditemukan — daftar LAYAR_PROYEKSI sudah basi.`);
    continue;
  }
  const src = tanpaKomentar(fs.readFileSync(jalan, 'utf8'));
  diperiksa++;

  // Mesin lama tetap terlarang di sini juga.
  for (const f of FIELD_LAMA) {
    const pola = new RegExp(f.replace('.', '\\.') + '\\b');
    if (!pola.test(src)) continue;
    const baris = src.split('\n').findIndex((b) => pola.test(b)) + 1;
    masalah.push(`${nama}:${baris} — membaca "${f}" dari mesin lama (bep.js/kpi.js).`);
  }

  // Angka uangnya HARUS datang dari d.proyeksi, bukan d.actual.
  //
  // `d.actual` di layar proyeksi menghasilkan kegagalan yang paling sulit
  // dilihat dari semuanya: halaman berlabel PROJECTED yang sebenarnya
  // menampilkan angka bulan berjalan. Di awal bulan angkanya terlihat rendah,
  // dan itu justru terbaca sebagai "proyeksinya memang buruk".
  if (/\bd\.actual\b/.test(src)) {
    const baris = src.split('\n').findIndex((b) => /\bd\.actual\b/.test(b)) + 1;
    masalah.push(
      `${nama}:${baris} — layar Proyeksi membaca d.actual.\n` +
        `    Seluruh angka uang di layar ini harus datang dari d.proyeksi, yang sudah\n` +
        `    diturunkan dari actual di muat-data.js. Membacanya langsung membuat halaman\n` +
        `    berlabel PROJECTED menampilkan angka periode berjalan tanpa satu pun tanda.`
    );
  }

  if (!/tanda-konteks/.test(src)) {
    masalah.push(`${nama} — tidak memasang penanda konteks di layar.`);
  }

  // Penandanya harus benar-benar bertuliskan PROJECTED. Memasang
  // `tanda-konteks` berisi "ACTUAL" akan lolos pemeriksaan di atas dan
  // menghasilkan persis kesalahpahaman yang mau dicegah.
  if (!/tanda-konteks[^<]*>\s*PROJECTED/.test(src)) {
    masalah.push(
      `${nama} — penanda konteksnya tidak bertuliskan PROJECTED.\n` +
        `    Label yang ada tapi salah lebih buruk daripada tidak ada label: ia\n` +
        `    meyakinkan pembacanya bahwa angka estimasi sudah terjadi.`
    );
  }
}

// =====================================================================
// MESINNYA SENDIRI — tiap hasil membawa konteksnya, bukan hanya layarnya.
//
// Kalau labelnya cuma ditempel di layar, angka yang dioper ke tempat lain
// (unduhan, ringkasan, notifikasi) akan sampai tanpa keterangan apa pun.
// =====================================================================
const MESIN = [
  { berkas: 'profit-outlet.js', konteks: 'actual', fungsi: ['hitungActualOutlet', 'konsolidasiOutlet', 'ringkasBu'] },
  { berkas: 'proyeksi.js', konteks: 'projected', fungsi: ['proyeksiOutlet', 'konsolidasiProyeksi', 'ringkasBuProyeksi'] }
];

for (const m of MESIN) {
  const src = fs.readFileSync(path.join(DIR, m.berkas), 'utf8');
  const lain = m.konteks === 'actual' ? 'projected' : 'actual';

  // SELURUH BERKAS, bukan hanya tubuh fungsi yang diekspor.
  //
  // Pemeriksaan per-fungsi di bawah sempat lolos oleh sabotase yang mengubah
  // label di `proyeksiKosong()` — sebuah helper yang letaknya di luar jangkauan
  // jendela pembacaan. Jalur itu justru yang dipakai outlet tanpa penjualan,
  // yakni kasus yang paling mungkin salah dibaca sebagai "aktualnya nol".
  const salah = new RegExp(`konteks:\\s*'${lain}'`);
  if (salah.test(tanpaKomentar(src))) {
    const baris = tanpaKomentar(src).split('\n').findIndex((b) => salah.test(b)) + 1;
    masalah.push(
      `${m.berkas}:${baris} — ada hasil bertanda konteks: '${lain}' di berkas ${m.konteks}.\n` +
        `    Seluruh isi berkas ini harus menandai dirinya '${m.konteks}', termasuk jalur\n` +
        `    hasil-kosong yang dipakai outlet tanpa penjualan.`
    );
  }

  for (const fn of m.fungsi) {
    const i = src.indexOf(`export function ${fn}`);
    if (i < 0) {
      masalah.push(`${m.berkas} — fungsi ${fn} tidak ada lagi.`);
      continue;
    }
    const tubuh = src.slice(i, i + 6000);
    if (!new RegExp(`konteks:\\s*'${m.konteks}'`).test(tubuh)) {
      masalah.push(`${m.berkas} — ${fn}() mengembalikan hasil tanpa konteks: '${m.konteks}'.`);
    }
  }
}

// Proyeksi harus TURUNAN dari actual, bukan pembaca data mentah.
//
// Begitu `proyeksi.js` mengimpor data mentah sendiri, ia punya definisi kedua
// tentang biaya variabel — dan dua definisi yang berdekatan akan menyimpang
// diam-diam begitu salah satunya diubah.
const proy = fs.readFileSync(path.join(DIR, 'proyeksi.js'), 'utf8');
for (const terlarang of ['bep.js', 'kpi.js', 'hpp.js', '.service.js']) {
  if (new RegExp(`from\\s+'[^']*${terlarang.replace('.', '\\.')}'`).test(proy)) {
    masalah.push(
      `proyeksi.js — mengimpor "${terlarang}".\n` +
        `    Proyeksi harus menerima HASIL hitungActualOutlet(), bukan menghitung ulang\n` +
        `    dari sumbernya. Menghitung ulang membuat ekonominya bisa berbeda dari Actual.`
    );
  }
}

if (masalah.length) {
  console.error('❌ Angka uang berpotensi datang dari dua sumber atau salah label:\n');
  for (const p of masalah) console.error(`  ${p}\n`);
  process.exit(1);
}

console.log(`${diperiksa} layar Actual/Proyeksi diperiksa; satu sumber, konteksnya tidak tertukar. ✅`);
