/**
 * AUDIT: acuan satuan beli di layar opname.
 *
 * ============ CARA FITUR INI RUSAK TANPA TERLIHAT RUSAK ============
 *
 *   acuan tampil sama menonjol
 *     dengan satuan kecilnya     -> orang mengisi "4" untuk 4 dus, dan
 *                                   stoknya tercatat 4 pcs
 *   aturan "punya acuan" beda
 *     dari konversi-satuan       -> produk yang sama dianggap bersatuan beli
 *                                   di ekspor ESB tapi tidak di sini, atau
 *                                   sebaliknya
 *   dipanggil dengan stok yang
 *     salah                      -> angka acuannya benar bentuknya, salah
 *                                   isinya, dan tidak ada yang akan
 *                                   membandingkannya dengan apa pun
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

const bacaKode = (rel) => {
  const asli = baca(rel);
  if (!asli) return null;
  const kode = tanpaKomentar(asli);
  const pesan = periksaKewarasan(asli, kode, ['labelAcuan', 'opname-acuan', 'purchase_qty']);
  if (pesan) {
    salah(`${rel}: ${pesan} — audit ini tidak bisa dipercaya untuk berkas itu.`);
    return null;
  }
  return kode;
};

const MURNI = 'js/modules/inventory/acuan-satuan-beli.js';
const PAGE = 'js/modules/inventory/inventory.page.js';
const CSS = 'css/styles.css';
const TES = 'tools/test-acuan-satuan-beli.mjs';

// =====================================================================
// 1. Modul murni
// =====================================================================
const murni = bacaKode(MURNI);
if (murni) {
  // ============ ATURANNYA HARUS SAMA DENGAN EKSPOR ESB ============
  //
  // `konversi-satuan.js` menolak `purchase_qty <= 1` sebagai "tidak punya
  // satuan beli". Kalau layar opname memakai ambang yang berbeda, produk yang
  // sama akan dianggap bersatuan beli di satu tempat dan tidak di tempat lain
  // — dan bedanya baru terasa saat angkanya tidak cocok.
  // `isi <= 0 || isi === 1`, BUKAN `isi <= 1`: isi PECAHAN (1 pack = 0,5 kg)
  // adalah data yang sah. Versi pertama berkas ini memakai `<= 1` dan membuang
  // produk semacam itu — perbedaan yang tidak memunculkan galat di mana pun.
  if (!/isi <= 0 \|\| isi === 1/.test(murni)) {
    salah(`${MURNI}: ambang "isi minimal" tidak sama dengan konversi-satuan.js (\`isi <= 0 || isi === 1\`).`);
  }
  if (!/toLowerCase\(\) !== kecil\.toLowerCase\(\)/.test(murni)) {
    salah(`${MURNI}: satuan beli yang sama dengan satuan kecil tidak disaring — "1 pcs = 1 pcs" di tiap kartu.`);
  }
  // Ekor desimal di layar membuat orang ragu pada hitungan yang benar, dan
  // keraguan itu berakhir dengan dus yang dibongkar.
  if (!/Math\.round\(n \* 10000\) \/ 10000/.test(murni)) {
    salah(`${MURNI}: hasilnya tidak dibulatkan — sisa seperti 40.299999999999955 akan tercetak apa adanya.`);
  }
  if (!fs.existsSync(path.join(AKAR, TES))) salah(`${TES} tidak ada — aturannya tidak dibuktikan di mana pun.`);
}

const konversi = baca('js/modules/inventory/konversi-satuan.js');
if (konversi && murni) {
  // Dibandingkan apa adanya: dua berkas yang memutuskan hal yang sama harus
  // memakai ambang yang sama, dan audit yang cuma memeriksa salah satunya
  // tidak menjaga kesamaannya.
  if (!/isi <= 0 \|\| isi === 1/.test(konversi)) {
    salah('js/modules/inventory/konversi-satuan.js: ambangnya berubah — acuan opname & ekspor ESB tidak lagi sepakat.');
  }
}

// =====================================================================
// 2. Layar opname
// =====================================================================
const page = bacaKode(PAGE);
if (page) {
  // Dicari DI DALAM markupnya, bukan di syaratnya saja: `labelAcuan(p)` muncul
  // dua kali (penjaga `? :` dan isi templatnya), jadi memeriksa namanya saja
  // membuat isinya bisa diganti pemanggil lain sementara auditnya tetap hijau.
  if (!/<div class="opname-acuan">[^`]*\$\{esc\(labelAcuan\(p\)\)\}/.test(page)) {
    salah(`${PAGE}: acuan satuan beli tidak digambar di kartu opname.`);
  }
  // Sama seperti di atas: `teksAcuanStok(sys, p)` muncul dua kali (penjaga
  // `? :` dan isi templatnya). Yang menentukan apa yang TERBACA orang adalah
  // yang di templat — dan itu yang bisa diganti diam-diam sementara
  // penjaganya tetap memakai `sys`.
  if (!/sistem \$\{esc\(teksAcuanStok\(sys, p\)\)\}/.test(page)) {
    salah(
      `${PAGE}: terjemahan stok ke satuan beli tidak dipanggil dengan stok SISTEM (\`sys\`). ` +
        'Dipanggil dengan angka lain, bentuknya tetap benar dan isinya salah.'
    );
  }
  // Satuan yang boleh diketik harus menonjol lebih dulu daripada acuannya.
  if (!/opname-satuan-utama/.test(page)) {
    salah(`${PAGE}: satuan kecil di sebelah kotak isian tidak ditandai sebagai satuan utama.`);
  }
  // Kotak isian TETAP satu, dalam satuan kecil. Dua kotak untuk satu angka
  // berarti satu dari keduanya akan terisi sendirian.
  const jumlahInput = (page.match(/class="opname-input"/g) ?? []).length;
  if (jumlahInput !== 1) {
    salah(`${PAGE}: kotak isian opname ada ${jumlahInput} — harus tepat satu, dalam satuan kecil.`);
  }
}

// =====================================================================
// 3. Tampilannya: acuan lebih redup, satuan kecil lebih menonjol
// =====================================================================
const css = baca(CSS);
if (css) {
  const blok = (sel) => {
    const i = css.indexOf(sel);
    return i >= 0 ? css.slice(i, css.indexOf('}', i)) : '';
  };
  const acuan = blok('.opname-acuan {');
  const utama = blok('.opname-satuan-utama {');
  if (!acuan) salah(`${CSS}: \`.opname-acuan\` tidak punya gaya.`);
  else if (!/color: var\(--color-text-muted\)/.test(acuan)) {
    salah(`${CSS}: acuan satuan beli tidak diredupkan — ia akan terbaca sepenting satuan yang harus diketik.`);
  }
  if (!utama) salah(`${CSS}: \`.opname-satuan-utama\` tidak punya gaya.`);
  else if (!/font-weight: 700/.test(utama)) {
    salah(`${CSS}: satuan kecil tidak ditebalkan — dua satuan yang tampil sama adalah cara tercepat salah isi.`);
  }
}

console.log('');
if (gagal === 0) console.log('Audit acuan satuan beli bersih. ✅');
else console.error(`${gagal} masalah ditemukan.`);
process.exit(gagal === 0 ? 0 : 1);
