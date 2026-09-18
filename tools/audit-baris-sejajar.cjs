/**
 * AUDIT: tabel berjajar di layar sempit.
 *
 * ============ APA YANG DIJAGA DI SINI ============
 *
 * Keluhan aslinya: di HP, satu baris tabel isian pecah jadi tiga baris —
 * nama menu, lalu harganya, lalu kotak isiannya. Perbaikannya adalah kelas
 * `baris-sejajar`.
 *
 * Semua kegagalan yang mungkin terjadi pada perbaikan itu bersifat SENYAP.
 * Tidak ada error, tidak ada tes yang merah; tampilannya sekadar kembali
 * menumpuk di sebagian layar, dan biasanya baru ketahuan berbulan-bulan
 * kemudian saat ada yang mengeluh lagi.
 *
 * Ada empat bentuknya, dan keempatnya diperiksa di sini:
 *
 *   1. `tabel-responsif.js` lupa diajari melewati `baris-sejajar`, sehingga
 *      `kartu-sempit` tetap ditempelkan otomatis. Kedua kelas mengatur
 *      `display` sel yang sama, dan yang menang ditentukan urutan tulisannya
 *      di stylesheet — bukan sesuatu yang bisa dibaca dari file JS-nya.
 *
 *   2. Satu tabel menulis KEDUA kelas sekaligus. Sama akibatnya, tapi sebabnya
 *      manusia, bukan otomatisasi.
 *
 *   3. Kotak isian masih membawa `style="max-width:..."` inline. Gaya inline
 *      menang atas stylesheet, jadi aturan mengecilkan kotak di 560px ada,
 *      terlihat benar saat dibaca, dan tidak berpengaruh apa-apa.
 *
 *   4. Aturan CSS-nya sendiri hilang atau keluar dari media query-nya.
 */
const fs = require('fs');
const path = require('path');

const AKAR = path.dirname(__dirname);
let gagal = 0;
const salah = (pesan) => {
  gagal++;
  console.error(`❌ ${pesan}`);
};

const baca = (p) => fs.readFileSync(path.join(AKAR, p), 'utf8');

/**
 * Apakah CSS ini benar-benar punya selektor `sel`?
 *
 * TIDAK boleh memakai `includes()` biasa. Selektor yang diganti namanya jadi
 * `.panel-lengket-atas-x` atau `tbody > tr-x` masih MENGANDUNG nama aslinya
 * sebagai penggalan teks — jadi `includes()` menyatakan aturannya masih ada
 * sementara yang tersisa cuma namanya.
 *
 * Ini bukan kekhawatiran teoretis: dua sabotase lolos persis lewat celah ini,
 * dan sebelumnya kelemahan yang sama pernah ditemukan pada
 * `audit-target.cjs` (`indexOf('export function X')` ikut cocok dengan
 * `Xsomething`) dan `audit-konteks-angka.cjs`.
 *
 * Jadi yang diperiksa adalah nama selektor DIIKUTI pembatas yang sah: `{`,
 * `,`, atau akhir baris.
 */
function punyaSelektor(css, sel) {
  const pola = new RegExp(
    sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*') + '\\s*(\\{|,|$)',
    'm'
  );
  return pola.test(css);
}

function semuaJs(dir, keluar = []) {
  for (const nama of fs.readdirSync(path.join(AKAR, dir))) {
    const rel = `${dir}/${nama}`;
    if (fs.statSync(path.join(AKAR, rel)).isDirectory()) semuaJs(rel, keluar);
    else if (nama.endsWith('.js')) keluar.push(rel);
  }
  return keluar;
}

// ---------------------------------------------------------------
// 1. CSS-nya ada, dan ada DI DALAM media query layar sempit.
// ---------------------------------------------------------------
const css = baca('css/styles.css');

const blokSempit = [...css.matchAll(/@media\s*\(max-width:\s*560px\)\s*\{/g)].map((m) => {
  // Ambil isi blok dengan menghitung kurung, bukan regex — aturan bersarang
  // (`.a { ... }`) membuat pencocokan sampai `}` pertama berhenti terlalu awal
  // dan menyatakan aturannya "tidak ada" padahal ada.
  let i = m.index + m[0].length;
  let dalam = 1;
  const awal = i;
  while (i < css.length && dalam > 0) {
    if (css[i] === '{') dalam++;
    else if (css[i] === '}') dalam--;
    i++;
  }
  return css.slice(awal, i);
});

if (!blokSempit.length) salah('css/styles.css: tidak ada @media (max-width: 560px) sama sekali.');
const sempitGabung = blokSempit.join('\n');

for (const aturan of [
  '.data-table.baris-sejajar tbody > tr',
  '.data-table.baris-sejajar td',
  '.data-table.baris-sejajar td:first-child'
]) {
  if (!punyaSelektor(sempitGabung, aturan)) {
    salah(`css/styles.css: aturan "${aturan}" tidak ada di dalam @media (max-width: 560px). Di luar media query ia akan ikut merusak tampilan desktop yang sudah benar.`);
  }
}

// `min-width: 0` pada kolom pertama. Tanpa ini flex item menolak menyusut di
// bawah lebar kontennya, dan nama menu yang panjang mendorong kotak isian
// keluar layar — persis gejala yang sedang diperbaiki, tapi mendatar.
const kolomPertama = sempitGabung.slice(
  sempitGabung.indexOf('.data-table.baris-sejajar td:first-child')
).split('}')[0];
if (!/min-width:\s*0/.test(kolomPertama)) {
  salah('css/styles.css: `.data-table.baris-sejajar td:first-child` tanpa `min-width: 0` — nama panjang akan mendorong kotak isian keluar layar.');
}

// ---------------------------------------------------------------
// 2. tabel-responsif.js diajari melewati baris-sejajar.
// ---------------------------------------------------------------
const responsif = baca('js/core/tabel-responsif.js');
if (!/baris-sejajar/.test(responsif)) {
  salah('js/core/tabel-responsif.js tidak menyebut `baris-sejajar` — MutationObserver-nya akan tetap menempelkan `kartu-sempit` ke tabel yang justru minta tidak dikartukan.');
}
const barisTambah = responsif.split('\n').find((b) => b.includes("classList.add('kartu-sempit')") || b.includes('KELAS_SEJAJAR'));
if (!barisTambah) {
  salah('js/core/tabel-responsif.js: tidak ditemukan tempat `kartu-sempit` ditempelkan — audit ini kehilangan sasarannya, jadi ia dianggap gagal daripada diam-diam lolos.');
} else {
  const potongan = responsif.slice(
    Math.max(0, responsif.indexOf("classList.add('kartu-sempit')") - 300),
    responsif.indexOf("classList.add('kartu-sempit')") + 60
  );
  if (!/KELAS_SEJAJAR|baris-sejajar/.test(potongan)) {
    salah('js/core/tabel-responsif.js: `kartu-sempit` ditempelkan tanpa memeriksa `baris-sejajar` lebih dulu.');
  }
}

// ---------------------------------------------------------------
// 3. Tidak ada tabel yang memakai kedua kelas sekaligus.
// ---------------------------------------------------------------
const berkas = semuaJs('js');
for (const rel of berkas) {
  const isi = baca(rel);
  for (const m of isi.matchAll(/class="([^"]*data-table[^"]*)"/g)) {
    const kelas = m[1];
    if (kelas.includes('baris-sejajar') && kelas.includes('kartu-sempit')) {
      salah(`${rel}: satu tabel memakai "baris-sejajar" dan "kartu-sempit" sekaligus (class="${kelas}"). Keduanya mengatur display sel yang sama; yang menang ditentukan urutan di stylesheet, bukan niat penulisnya.`);
    }
  }
}

// ---------------------------------------------------------------
// 4. Tidak ada `style="max-width"` inline pada kotak isian.
//
// Diperiksa hanya di berkas yang memang memakai `baris-sejajar` — di tabel
// biasa gaya inline itu tidak menimbulkan masalah apa pun.
// ---------------------------------------------------------------
for (const rel of berkas) {
  const isi = baca(rel);
  if (!isi.includes('baris-sejajar')) continue;

  for (const m of isi.matchAll(/<input[^>]*>/g)) {
    const tag = m[0];
    if (!/type="(number|text)"/.test(tag)) continue;
    if (/style="[^"]*max-width/.test(tag)) {
      const baris = isi.slice(0, m.index).split('\n').length;
      salah(`${rel}:${baris}: kotak isian membawa style="max-width:..." inline. Gaya inline menang atas stylesheet, jadi aturan mengecilkan kotak di layar sempit tidak akan pernah berlaku. Pakai kelas (mis. \`isian-sempit\`).`);
    }
  }
}

// ---------------------------------------------------------------
// 5. Penjualan: tombol Simpan ada DI ATAS tabel, bukan di bawahnya.
// ---------------------------------------------------------------
const sales = baca('js/modules/sales/sales.page.js');
const posTombol = sales.indexOf('id="sl-save"');
const posTabel = sales.indexOf('id="sl-rows"');
if (posTombol === -1 || posTabel === -1) {
  salah('js/modules/sales/sales.page.js: tidak menemukan #sl-save atau #sl-rows — audit kehilangan sasarannya.');
} else if (posTombol > posTabel) {
  salah('js/modules/sales/sales.page.js: tombol Simpan digambar SESUDAH tabel menu. Dengan dua ratus baris menu, staff harus menggulir melewati seluruh daftar untuk menyimpan — dan biasanya lupa.');
}

for (const kelas of ['panel-lengket-atas', 'panel-lengket-bawah', 'gulir-baris']) {
  if (!sales.includes(kelas)) {
    salah(`js/modules/sales/sales.page.js: kelas "${kelas}" hilang — header/footer tidak lagi tetap saat daftar digulir.`);
  }
  if (!punyaSelektor(css, `.${kelas}`)) {
    salah(`css/styles.css: kelas "${kelas}" dipakai di JS tapi tidak ada aturannya.`);
  }
}

// ---------------------------------------------------------------
// 5. LIMA KOLOM BERISI KOTAK ISIAN WAJIB `judul-sendiri`.
//
// `baris-sejajar` benar untuk tabel tiga-empat kolom yang selnya cuma angka.
// Kirim & Terima punya LIMA kolom, dua di antaranya berisi kotak isian — dan
// di 360px yang tersisa untuk nama bahan sekitar sepuluh piksel. Nama barangnya
// tetap "ada" di layar, jadi tidak ada satu pun pemeriksaan otomatis yang bisa
// menyebutnya rusak; ia cuma tercetak satu huruf per baris.
//
//    U
//    D
//    A
//    N
//    G
//
// Yang menemukannya orang yang harus mencocokkan 27 bahan dengan barang di
// depannya.
// ---------------------------------------------------------------
for (const rel of berkas) {
  const isi = baca(rel);
  for (const m of isi.matchAll(/<table class="([^"]*baris-sejajar[^"]*)"[\s\S]{0,400}?<thead>([\s\S]*?)<\/thead>/g)) {
    const kelas = m[1];
    const kolom = (m[2].match(/<th/g) ?? []).length;
    const adaIsian = /<input/.test(isi.slice(m.index, m.index + 4000));
    if (kolom >= 5 && adaIsian && !/judul-sendiri/.test(kelas)) {
      salah(
        `${rel}: tabel ${kolom} kolom berisi kotak isian memakai "baris-sejajar" tanpa "judul-sendiri". Di 360px nama ` +
          'bahan akan terperas jadi satu huruf per baris — dan tetap terlihat "ada", jadi tidak ada yang menyebutnya rusak.'
      );
    }
  }
}

// Aturannya harus ADA, dan harus DI DALAM media query layar sempit.
//
// `sempitGabung` dipakai ulang — berkas ini sudah memotong isi tiap
// `@media (max-width: 560px)` dengan benar di bagian atas. Percobaan pertama
// memotongnya lagi dengan `indexOf` + `slice(iSempit)`, dan itu mengambil
// SELURUH sisa stylesheet termasuk yang di luar media query-nya: aturan yang
// lolos dari dalam kurung tetap dianggap aman.
for (const pola of [
  ['judul-sendiri tbody > tr', /\.judul-sendiri tbody > tr \{[^}]*flex-wrap: wrap/],
  ['nama satu baris penuh', /\.judul-sendiri td:first-child \{[^}]*flex: 1 1 100%/],
  ['sel isian 58%', /\.judul-sendiri td\.sel-isian \{[^}]*flex: 1 1 58%/]
]) {
  if (!pola[1].test(sempitGabung)) {
    salah(`css/styles.css: aturan "${pola[0]}" hilang atau keluar dari @media layar sempit — namanya kembali terperas.`);
  }
}

// `:not(.sel-isian)` menjaga dua arti "Dikirim": angka mati di layar Terima,
// kotak isian di layar Kirim. Tanpa itu kotak isiannya ikut mengecil jadi
// keterangan abu-abu.
if (!/td\[data-label='Dikirim'\]:not\(\.sel-isian\)/.test(css)) {
  salah(
    'css/styles.css: aturan keterangan abu-abu tidak lagi mengecualikan `.sel-isian`. "Dikirim" berperan berbeda di dua ' +
      'tabel — di Kirim ia justru kotak isiannya, dan akan ikut dikecilkan jadi teks.'
  );
}
// Markup-nya harus benar-benar memasang kelas itu.
const dispatch = baca('js/modules/dispatch/dispatch.page.js');
if ((dispatch.match(/class="sel-isian"/g) ?? []).length < 2) {
  salah('dispatch.page.js: sel kotak isian tidak ditandai `sel-isian` di kedua tabel (Kirim & Terima) — aturan CSS-nya tidak punya sasaran.');
}

if (gagal === 0) {
  console.log('Tabel berjajar: CSS di media query yang benar, tabel-responsif melewatinya, tidak ada kelas bentrok, tidak ada max-width inline, tombol Simpan di atas. ✅');
}
process.exit(gagal === 0 ? 0 : 1);
