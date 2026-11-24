/**
 * AUDIT: menu bengkel yang digabung + tab Cek Silang.
 *
 * ============ DUA KEGAGALAN YANG TIDAK MENINGGALKAN JEJAK ============
 *
 * 1. TAB YANG DISARING KELUAR.
 *    `visibleTabsOf` membuang tab yang kodenya tidak aktif, dan `canAccessTab`
 *    membuang tab yang tidak ada di daftar izin. Keduanya tidak melempar
 *    galat, tidak menulis apa pun di console, dan tidak meninggalkan satu pun
 *    petunjuk bahwa ada layar yang hilang. `cek_silang_bengkel` TIDAK punya
 *    baris di tabel `modules`, jadi tanpa `syaratModul` ia tidak akan pernah
 *    muncul; dan tanpa baris di `ADMIN_TAB_CATALOG` ia tidak akan pernah bisa
 *    diberikan ke admin yang daftar izinnya sudah diatur.
 *
 * 2. DUA SUMBER OMZET YANG DIJUMLAHKAN.
 *    `bengkel_sales` (nominal harian dari staff) dan `bengkel_sale_lines`
 *    (per baris dari Turboly) mengaku mencatat penjualan yang sama lewat dua
 *    jalur. Menunya digabung; DATANYA tidak. Kalau suatu hari ada yang
 *    menjumlahkan keduanya, omzetnya jadi dua kali lipat — dan angkanya tetap
 *    terlihat wajar, karena dua-duanya benar di tempat asalnya.
 *
 * 3. KORPORAT YANG IKUT DIBANDINGKAN.
 *    Penjualan korporat ditagih kantor, tidak lewat kasir, dan tidak pernah
 *    masuk laporan harian staff. Kalau ia ikut dijumlahkan ke sisi Turboly,
 *    SETIAP hari yang ada invoice korporatnya tampak "selisih" — dan daftar
 *    yang selalu merah adalah daftar yang berhenti dibaca orang. Ia justru
 *    membuat kebocoran sungguhan lebih aman bersembunyi.
 */
const fs = require('fs');
const path = require('path');
const { tanpaKomentar, periksaKewarasan } = require('./lib/tanpa-komentar.cjs');

const AKAR = path.dirname(__dirname);
let gagal = 0;
const salah = (pesan) => {
  gagal++;
  console.error(`❌ ${pesan}`);
};

const baca = (rel) => {
  const p = path.join(AKAR, rel);
  if (!fs.existsSync(p)) {
    salah(`${rel} tidak ada — audit ini kehilangan sasarannya.`);
    return null;
  }
  return fs.readFileSync(p, 'utf8');
};

const bacaKode = (rel, penanda) => {
  const asli = baca(rel);
  if (!asli) return null;
  const kode = tanpaKomentar(asli);
  const pesan = periksaKewarasan(asli, kode, penanda);
  if (pesan) {
    salah(`${rel}: ${pesan} — audit ini tidak bisa dipercaya untuk berkas itu.`);
    return null;
  }
  return kode;
};

const MAIN = 'js/main-admin.js';
const KATALOG = 'js/core/admin-tabs.js';
const MURNI = 'js/modules/bengkel/cek-silang-harian.js';
const LAYAR = 'js/modules/bengkel/cek-silang.admin.page.js';
const TES = 'tools/test-cek-silang-harian.mjs';

// =====================================================================
// 1. MENU: grupnya ada, tabnya lengkap, syarat modulnya terpasang
// =====================================================================
const main = bacaKode(MAIN, ['GROUPS', 'visibleTabsOf', 'GROUPED_CODES']);
const katalog = bacaKode(KATALOG, ['ADMIN_TAB_CATALOG', 'canAccessTab']);

if (main) {
  const i = main.indexOf('grp_bengkel: {');
  if (i < 0) {
    salah(`${MAIN}: grup \`grp_bengkel\` tidak ada — kedua modul bengkel kembali jadi dua menu bernama nyaris sama, dan cepat atau lambat ada yang mengetik penjualan korporat ke form harian.`);
  } else {
    const blok = main.slice(i, main.indexOf('\n  },', i));
    for (const kode of ['penjualan_bengkel', 'penjualan_bengkel_rinci', 'cek_silang_bengkel']) {
      if (!blok.includes(`'${kode}'`)) salah(`${MAIN}: tab \`${kode}\` tidak ada di grup bengkel.`);
    }
    // Tanpa `syaratModul`, `activeCodes.has('cek_silang_bengkel')` selalu
    // false (kodenya tidak ada di tabel `modules`) dan tabnya TIDAK PERNAH
    // muncul — tanpa satu pun galat.
    if (!/code: 'cek_silang_bengkel'[\s\S]{0,260}syaratModul: 'penjualan_bengkel_rinci'/.test(blok)) {
      salah(`${MAIN}: tab Cek Silang tidak mengikuti modul \`penjualan_bengkel_rinci\` lewat \`syaratModul\` — ia tidak akan pernah muncul, dan tab yang disaring keluar tidak meninggalkan jejak untuk ditelusuri.`);
    }
    if (!/renderCekSilangAdminPage/.test(main)) salah(`${MAIN}: \`renderCekSilangAdminPage\` tidak dipakai.`);
  }

  // Modul yang sudah diserap ke grup tidak boleh muncul lagi sebagai menu
  // sendiri: dua menu yang membuka layar yang sama membuat yang membacanya
  // mencari bedanya.
  if (!/GROUPED_CODES\.has\(mod\.code\)/.test(main)) {
    salah(`${MAIN}: penyaring \`GROUPED_CODES\` hilang — modul bengkel akan tampil DUA kali: di dalam grup dan sebagai menu sendiri.`);
  }
}

// ============ SETIAP TAB DALAM GRUP HARUS BISA DIIZINKAN ============
//
// Diperiksa untuk SEMUA grup, bukan cuma bengkel: begitu seorang admin punya
// daftar izin (whitelist tidak kosong), `canAccessTab` menolak kode yang tidak
// ada di katalog — dan kode itu tidak bisa dicentang siapa pun karena
// `GRANTABLE_TABS` dibangun dari katalog yang sama. Hasilnya layar yang tidak
// pernah bisa diberikan, tanpa satu pun galat.
if (main && katalog) {
  const kodeKatalog = new Set([...katalog.matchAll(/\{\s*code: '([a-z_]+)'/g)].map((m) => m[1]));
  const iG = main.indexOf('const GROUPS = {');
  const blokGroups = iG < 0 ? '' : main.slice(iG, main.indexOf('\n};', iG));
  if (!blokGroups) salah(`${MAIN}: blok \`GROUPS\` tidak terbaca — pemeriksaan kelengkapan katalog tidak jalan.`);
  const kodeTab = [...blokGroups.matchAll(/code: '([a-z_]+)'/g)].map((m) => m[1]);
  if (kodeTab.length < 10) salah(`${MAIN}: hanya ${kodeTab.length} kode tab terbaca dari GROUPS — polanya kemungkinan sudah berubah, dan audit ini jadi longgar.`);
  for (const kode of kodeTab) {
    if (!kodeKatalog.has(kode)) {
      salah(`${KATALOG}: tab \`${kode}\` dipakai di menu tapi tidak terdaftar di \`ADMIN_TAB_CATALOG\` — admin yang daftar izinnya sudah diatur tidak akan pernah bisa diberi aksesnya, dan layarnya hilang tanpa galat.`);
    }
  }
}

// =====================================================================
// 2. MODUL MURNI: korporat tidak ikut dibandingkan, selisih tidak saling
//    menghapus
// =====================================================================
const murni = bacaKode(MURNI, ['cekSilangHarian', 'ringkasCekSilang', 'STATUS']);
if (murni) {
  const i = murni.indexOf('export function cekSilangHarian(');
  const fn = i < 0 ? '' : murni.slice(i, murni.indexOf('\nexport function ringkasCekSilang', i));
  if (!fn) salah(`${MURNI}: \`cekSilangHarian\` tidak terbaca.`);

  // Korporat dipisah SEBELUM dijumlahkan ke sisi Turboly, dan `continue`
  // memastikan ia tidak ikut menyalakan `adaRinci` — hari yang isinya cuma
  // korporat bukan hari yang "Turboly-nya ada".
  if (!/=== 'korporat'/.test(fn) || !/korporat \+= total;\s*\n\s*continue;/.test(fn)) {
    salah(`${MURNI}: penjualan korporat ikut dijumlahkan ke sisi Turboly — setiap hari yang ada invoice korporatnya akan tampak selisih, dan daftar yang selalu merah berhenti dibaca orang.`);
  }
  if (!/Math\.abs\(selisih\) <= num\(toleransi\)/.test(fn)) {
    salah(`${MURNI}: toleransi tidak dipakai saat menentukan status — pembulatan kasir Rp500 akan tercatat sebagai selisih.`);
  }
  // Total yang kebetulan sama bisa menyembunyikan sparepart kelebihan yang
  // ditutup jasa kekurangan: dua kesalahan yang saling menutupi, bukan nol
  // kesalahan.
  if (!/selisihSparepart:/.test(fn) || !/selisihJasa:/.test(fn)) {
    salah(`${MURNI}: selisih per jenis tidak dihitung — sparepart kelebihan yang ditutup jasa kekurangan akan terbaca "cocok".`);
  }
  if (!/adaHarian && !b\.adaRinci/.test(fn) || !/!b\.adaHarian && b\.adaRinci/.test(fn)) {
    salah(`${MURNI}: hari yang hanya ada di satu sisi tidak dibedakan — "belum diimpor" akan terbaca sebagai selisih sebesar seluruh omzet, atau sebaliknya.`);
  }

  const j = murni.indexOf('export function ringkasCekSilang(');
  const ringkas = j < 0 ? '' : murni.slice(j, murni.indexOf('\nexport function catatanCekSilang', j));
  // Kelebihan di satu hari dan kekurangan di hari lain saling menghapus di
  // total: hasilnya nol yang membuat seluruh bulan terlihat beres.
  if (!/selisihMutlak \+= Math\.abs\(b\.selisih\)/.test(ringkas)) {
    salah(`${MURNI}: \`ringkasCekSilang\` tidak menjumlahkan selisih MUTLAK — kelebihan dan kekurangan saling menghapus, dan bulan yang penuh selisih terlihat beres.`);
  }
  if (!/catatanCekSilang/.test(murni)) salah(`${MURNI}: \`catatanCekSilang\` hilang — angkanya bisa dibawa ke mana-mana tanpa kalimat yang menjelaskan apa yang TIDAK ikut dibandingkan.`);

  if (!fs.existsSync(path.join(AKAR, TES))) salah(`${TES} tidak ada — aturannya tidak pernah dijalankan.`);
}

// =====================================================================
// 3. LAYAR: saringan outlet dikenakan pada KEDUA sisi
// =====================================================================
const layar = bacaKode(LAYAR, ['renderCekSilangAdminPage', 'cekSilangHarian']);
if (layar) {
  // `omzetRentang` tidak menerima outlet, jadi saringannya dikerjakan di JS.
  // Menyaring satu sisi saja membuat SELURUH hari tampak "staff belum lapor"
  // (atau sebaliknya) — selisih sebesar omzet penuh, yang tampak seperti
  // kebocoran besar padahal cuma saringan yang tidak seimbang.
  if (!/harian = harian\.filter\(\(h\) => h\.outlet_id === state\.outletId\)/.test(layar)) {
    salah(`${LAYAR}: saringan outlet tidak dikenakan pada sisi harian — memilih satu outlet akan membuat seluruh hari tampak tidak punya pasangan.`);
  }
  if (!/outletId: state\.outletId/.test(layar)) {
    salah(`${LAYAR}: saringan outlet tidak diteruskan ke sisi rinci.`);
  }
  if (!/catatanCekSilang/.test(layar)) {
    salah(`${LAYAR}: catatan tidak ditampilkan — pembacanya tidak diberi tahu bahwa korporat tidak ikut dibandingkan.`);
  }
  // Catatannya ikut ke Excel: angka yang diunduh akan dibaca jauh dari layar
  // ini, oleh orang yang tidak pernah melihat keterangannya.
  if (!/subtitle:[\s\S]{0,200}catatan/.test(layar)) {
    salah(`${LAYAR}: catatan tidak dibawa ke berkas Excel — angkanya akan dibaca tanpa keterangan apa pun tentang apa yang tidak dibandingkan.`);
  }
  if (!/0185/.test(layar) || !/0188/.test(layar)) {
    salah(`${LAYAR}: tidak ada pesan khusus saat migration 0185–0188 belum dijalankan — yang muncul cuma galat PostgREST tentang relasi yang tidak ada.`);
  }
}

// =====================================================================
// 4. DUA SUMBER OMZET TIDAK PERNAH DIJUMLAHKAN
// =====================================================================
//
// Dicari di SELURUH js/: yang berbahaya bukan berkas tertentu, tapi satu baris
// di mana pun yang menambahkan nominal harian ke nilai per baris.
const berkasJs = [];
(function telusuri(dir) {
  for (const n of fs.readdirSync(dir)) {
    const p = path.join(dir, n);
    if (fs.statSync(p).isDirectory()) telusuri(p);
    else if (n.endsWith('.js')) berkasJs.push(p);
  }
})(path.join(AKAR, 'js'));

for (const p of berkasJs) {
  const isi = fs.readFileSync(p, 'utf8');
  const kode = tanpaKomentar(isi);
  const rel = path.relative(AKAR, p).split(path.sep).join('/');
  // Satu fungsi yang membaca KEDUA sumber sekaligus hanya sah kalau ia
  // membandingkannya. `cek-silang` boleh; yang lain tidak.
  const duaSumber = /bengkel_sales/.test(kode) && /(bengkel_penjualan_rinci|bengkel_sale_lines|barisPenjualan)/.test(kode);
  if (duaSumber && !/cek-silang/.test(rel)) {
    salah(`${rel}: membaca omzet harian DAN penjualan rinci di satu berkas tanpa menjadi layar cek silang — kalau keduanya dijumlahkan, omzetnya dua kali lipat dan angkanya tetap terlihat wajar.`);
  }
}

console.log('');
if (gagal === 0) console.log('Audit cek silang & menu bengkel bersih. ✅');
else console.error(`${gagal} masalah ditemukan.`);
process.exit(gagal === 0 ? 0 : 1);
