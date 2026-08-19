#!/usr/bin/env node
/**
 * BARIS BERKOLOM TETAP HARUS PUNYA RENCANA UNTUK LAYAR SEMPIT.
 *
 * ============ BENTUK KEGAGALANNYA ============
 *
 * Sebuah baris `display:flex` berisi beberapa kolom berlebar TETAP
 * (`width: 96px; flex-shrink: 0`) dan satu kolom lentur (`flex: 1`). Di layar
 * lebar semuanya lapang. Begitu layarnya sempit, kolom tetapnya tidak ikut
 * mengecil — dan seluruh penyempitan ditanggung kolom lentur sendirian.
 *
 * Contoh nyatanya, editor resep:
 *
 *     layar 360px, di dalam dialog  ->  ruang ~296px
 *     jumlah 96 + satuan 56 + tombol 44 + 3 celah x8 = 220px
 *     sisa untuk pemilih bahan     ->  ~76px
 *
 * Tujuh puluh enam piksel untuk nama bahan yang rata-rata 20 karakter. Yang
 * terlihat di layar: kotak selebar dua huruf, dan daftar pilihannya pecah
 * jadi satu-dua huruf per baris.
 *
 * ============ KENAPA MESIN YANG HARUS MENJAGANYA ============
 *
 * Tidak ada yang rusak. Tidak ada error. Di layar tempat kodenya ditulis,
 * barisnya terlihat sempurna — dan tetap terlihat sempurna selamanya, karena
 * yang membuatnya sesak baru muncul di perangkat orang lain.
 *
 * Buktinya ada di repo ini: `.picker-row` sudah punya aturan menumpuk sejak
 * lama, `.line-row` yang bentuknya nyaris identik tidak pernah kebagian. Yang
 * satu diperbaiki karena ada yang mengeluh; yang satu lagi menunggu keluhan
 * berikutnya.
 *
 * ============ APA YANG DIPERIKSA ============
 *
 * Untuk tiap wadah `display:flex`, dijumlahkan lebar tetap anak-anaknya
 * ditambah celahnya. Kalau jumlahnya melewati ANGGARAN dan tidak ada aturan
 * menumpuk di `@media (max-width: …)`, auditnya merah.
 *
 * Tanpa dependensi — sama seperti audit lain di folder ini.
 */

const fs = require('fs');
const path = require('path');

const AKAR_REPO = path.join(__dirname, '..');
const BERKAS = path.join(AKAR_REPO, 'css', 'styles.css');

/**
 * Ruang terpakai maksimum sebelum kolom lentur jadi tidak berguna.
 *
 * Layar tersempit yang ditargetkan 360px. Dikurangi padding halaman (16x2) dan
 * padding dialog (24x2) -> ~280px. Kolom lentur di baris seperti ini hampir
 * selalu berisi NAMA (bahan, produk, orang), dan nama butuh setidaknya ~120px
 * supaya terbaca. Jadi kolom tetapnya tidak boleh melewati 160px.
 */
const ANGGARAN = 160;
const LEBAR_TOMBOL = 44; // tombol ikon: 44px, ambang sentuh yang dipakai repo ini

function tanpaKomentar(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

const cssAsli = fs.readFileSync(BERKAS, 'utf8');
const css = tanpaKomentar(cssAsli);

/** Semua blok `selector { isi }`, beserta apakah ia di dalam @media sempit. */
function bacaBlok(teks) {
  const blok = [];
  const pola = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = pola.exec(teks))) {
    const selector = m[1].trim().replace(/\s+/g, ' ');
    if (selector.startsWith('@')) continue;
    blok.push({ selector, isi: m[2], indeks: m.index });
  }
  return blok;
}

/** Rentang karakter tiap `@media (max-width: N)` — dipakai menandai blok di dalamnya. */
function rentangMediaSempit(teks) {
  const rentang = [];
  const pola = /@media[^{]*max-width:\s*(\d+)px[^{]*\{/g;
  let m;
  while ((m = pola.exec(teks))) {
    const lebar = Number(m[1]);
    // Cari kurung penutup yang seimbang.
    let dalam = 1;
    let i = m.index + m[0].length;
    while (i < teks.length && dalam > 0) {
      if (teks[i] === '{') dalam++;
      else if (teks[i] === '}') dalam--;
      i++;
    }
    rentang.push({ lebar, dari: m.index, sampai: i });
  }
  return rentang;
}

const semuaBlok = bacaBlok(css);
const mediaSempit = rentangMediaSempit(css);

const diMediaSempit = (indeks) => mediaSempit.some((r) => indeks >= r.dari && indeks < r.sampai && r.lebar <= 768);

// ---------------------------------------------------------
// Kumpulkan wadah flex dan anak-anaknya yang berlebar tetap.
// ---------------------------------------------------------
const wadah = new Map(); // selector wadah -> { gap, anak: [{nama, lebar}] , adaLentur }

for (const b of semuaBlok) {
  if (diMediaSempit(b.indeks)) continue; // aturan sempit diperiksa terpisah
  if (!/display:\s*flex/.test(b.isi)) continue;
  if (/flex-direction:\s*column/.test(b.isi)) continue; // kolom: tidak berebut lebar
  if (/flex-wrap:\s*wrap/.test(b.isi)) continue; // sudah boleh membungkus

  const gap = Number(b.isi.match(/(?:^|[^-])gap:\s*(\d+)px/)?.[1] ?? 0);
  for (const sel of b.selector.split(',').map((x) => x.trim())) {
    if (!sel.startsWith('.')) continue;
    wadah.set(sel, { gap, anak: [], adaLentur: false });
  }
}

for (const b of semuaBlok) {
  if (diMediaSempit(b.indeks)) continue;
  for (const sel of b.selector.split(',').map((x) => x.trim())) {
    const spasi = sel.lastIndexOf(' ');
    if (spasi < 0) continue;
    const induk = sel.slice(0, spasi).trim();
    const w = wadah.get(induk);
    if (!w) continue;

    if (/flex:\s*1|flex-basis:\s*(?!0)/.test(b.isi)) w.adaLentur = true;

    const takMengecil = /flex-shrink:\s*0/.test(b.isi) || /flex:\s*0\s+0/.test(b.isi);
    if (!takMengecil) continue;

    const lebar = Number(b.isi.match(/(?:^|[^-])width:\s*(\d+)px/)?.[1] ?? 0);
    w.anak.push({ nama: sel.slice(spasi + 1), lebar: lebar || LEBAR_TOMBOL, ditebak: !lebar });
  }
}

// ---------------------------------------------------------
// Aturan menumpuk yang tersedia di @media sempit.
// ---------------------------------------------------------
const punyaAturanSempit = new Set();
for (const b of semuaBlok) {
  if (!diMediaSempit(b.indeks)) continue;
  if (!/flex-wrap:\s*wrap|flex-direction:\s*column/.test(b.isi)) continue;
  for (const sel of b.selector.split(',').map((x) => x.trim())) punyaAturanSempit.add(sel);
}

// ---------------------------------------------------------
const masalah = [];
let diperiksa = 0;

for (const [sel, w] of wadah) {
  if (!w.anak.length || !w.adaLentur) continue;
  diperiksa++;

  const celah = w.gap * w.anak.length;
  const total = w.anak.reduce((t, a) => t + a.lebar, 0) + celah;
  if (total <= ANGGARAN) continue;
  if (punyaAturanSempit.has(sel)) continue;

  const rincian = w.anak.map((a) => `${a.nama}=${a.lebar}px${a.ditebak ? '(tebakan tombol)' : ''}`).join(' + ');
  masalah.push(
    `${sel} — kolom tetapnya memakan ${total}px (${rincian} + celah ${celah}px).\n` +
      `    Di layar 360px hanya tersisa ~${Math.max(0, 280 - total)}px untuk kolom lenturnya,\n` +
      `    yang hampir selalu berisi NAMA. Tambahkan di @media (max-width: 560px):\n` +
      `        ${sel} { flex-wrap: wrap; }\n` +
      `        ${sel} .<kolom-nama> { flex-basis: 100%; }`
  );
}

// =====================================================================
// (2) TABEL TIDAK BOLEH MEMBAWA LEBAR TETAP DI ATRIBUT `style`
//
// Gaya inline mengalahkan stylesheet. Sebuah `style="min-width:520px"` pada
// tabel membuat mode kartu — yang menyetel `min-width: 0` — kalah, sehingga di
// layar 360px tabelnya tetap dipaksa 520px: label kartunya terlihat di kiri,
// nilainya terdorong keluar layar.
//
// Yang terlihat pengguna bukan "tabel kelebaran", melainkan "datanya hilang".
// Itu ditemukan dari laporan lapangan, bukan dari audit — dan justru karena
// itulah ia perlu dijaga sekarang.
//
// CSS-nya sudah dibuat menang dengan `!important`, jadi ini lapis kedua. Tapi
// lapis kedua yang murah tetap layak: `!important` itu satu baris yang bisa
// hilang dalam penyuntingan berikutnya, dan hilangnya tidak akan terlihat.
// =====================================================================
const DIR_JS = path.join(__dirname, '..', 'js');

function berkasJs(dir, keluar = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const j = path.join(dir, e.name);
    if (e.isDirectory()) berkasJs(j, keluar);
    else if (e.name.endsWith('.js')) keluar.push(j);
  }
  return keluar;
}

let tabelDiperiksa = 0;
for (const berkas of berkasJs(DIR_JS)) {
  const src = fs.readFileSync(berkas, 'utf8');
  for (const m of src.matchAll(/<table[^>]*class="[^"]*data-table[^"]*"[^>]*>/g)) {
    tabelDiperiksa++;
    const tag = m[0];
    const lebar = tag.match(/style="[^"]*(?:^|[;\s])(min-width|width):\s*(\d+)px/);
    if (!lebar) continue;
    const baris = src.slice(0, m.index).split('\n').length;
    masalah.push(
      `${path.relative(AKAR_REPO, berkas)}:${baris} — tabel membawa ${lebar[1]}:${lebar[2]}px di atribut style.\n` +
        `    Gaya inline mengalahkan mode kartu, jadi di layar sempit isinya terdorong\n` +
        `    keluar layar dan terbaca sebagai "datanya hilang". Lebar tabel diatur\n` +
        `    lewat .table-scroll, bukan lewat style inline.`
    );
  }
}

if (masalah.length) {
  console.error('❌ Baris yang akan terjepit di layar sempit:\n');
  for (const p of masalah) console.error(`  ${p}\n`);
  process.exit(1);
}

console.log(
  `${diperiksa} baris berkolom tetap (anggaran ${ANGGARAN}px) + ${tabelDiperiksa} tabel diperiksa. ` +
    `Semuanya muat atau punya aturan menumpuk. ✅`
);

// BATAS YANG DIAKUI: baris flex yang dibangun lewat `style="display:flex"` di
// dalam JS TIDAK diperiksa. Ada 24 di aplikasi ini, dan hampir semuanya tidak
// berbahaya — kolom, pasangan tombol, dua item ber-space-between. Menuntut
// `flex-wrap` pada semuanya akan menyalakan audit ini untuk hal yang bukan
// masalah, dan audit yang sering salah tuduh akan berhenti dipercaya lalu
// diabaikan. Batas ini ditulis supaya tidak ada yang mengira sudah tercakup.
