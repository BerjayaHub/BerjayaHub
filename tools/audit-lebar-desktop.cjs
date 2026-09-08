/**
 * AUDIT: pelebaran tampilan DESKTOP tidak boleh menyentuh MOBILE.
 *
 * ============ PERMINTAANNYA PUNYA DUA SISI ============
 *
 *   "tampilan dekstop saya ingin lebih lebar sesuai dengan layar"
 *   "jangan ubah tampilan di ukuran mobile, karena sudah pas"
 *
 * Sisi kedua yang sulit dijaga. CSS tidak punya "hanya desktop" — yang ada
 * hanya syarat media, dan syarat yang meleset satu piksel atau lupa satu
 * dimensi akan diam-diam mengenai HP. Bentuk kegagalannya khas: tidak ada
 * error, tidak ada yang berubah di layar orang yang menulisnya, dan yang
 * menemukannya adalah staff yang sedang berdiri di depan rak.
 *
 * Yang dijaga:
 *
 *   1. Aturan pelebaran DIKURUNG media query desktop — tidak ada satu pun yang
 *      bocor ke lingkup global.
 *   2. Syaratnya menyebut LEBAR dan TINGGI. HP yang diputar mendatar jadi
 *      ~800px lebar dan lolos syarat lebar saja.
 *   3. Batasnya bersambung persis dengan aturan mobile (769/768, 501/500) —
 *      tidak ada lebar yang masuk dua-duanya, tidak ada yang tidak masuk
 *      keduanya.
 *   4. Isinya hanya soal LEBAR. Ukuran huruf dan target sentuh tidak ikut.
 *   5. Aturan mobile yang sudah ada tidak dilemahkan.
 */
const fs = require('fs');
const path = require('path');

const AKAR = path.dirname(__dirname);
let gagal = 0;
const salah = (pesan) => {
  gagal++;
  console.error(`❌ ${pesan}`);
};

const BERKAS = 'css/styles.css';
const p = path.join(AKAR, BERKAS);
if (!fs.existsSync(p)) {
  console.error(`❌ ${BERKAS} tidak ada — audit ini kehilangan sasarannya.`);
  process.exit(1);
}
const css = fs.readFileSync(p, 'utf8');

// ---------------------------------------------------------------
// Ambil isi blok media desktop.
// ---------------------------------------------------------------
const kepala = /@media \(min-width: (\d+)px\) and \(min-height: (\d+)px\) \{/.exec(css);
if (!kepala) {
  salah(
    'Blok media desktop tidak ditemukan. Bentuknya harus `@media (min-width: …px) and (min-height: …px)` — ' +
      'syarat lebar saja akan mengenai HP yang diputar mendatar.'
  );
} else {
  const [, lebar, tinggi] = kepala.map(Number);

  // 2 & 3. Batasnya bersambung dengan aturan mobile.
  if (lebar !== 769) {
    salah(`Batas lebar desktop ${lebar}px tidak bersambung dengan aturan mobile 768px. Harus tepat 769px.`);
  }
  if (tinggi !== 501) {
    salah(`Batas tinggi desktop ${tinggi}px tidak bersambung dengan \`max-height: 500px\` di aturan mobile. Harus tepat 501px.`);
  }
  if (!/@media \(max-width: 768px\), \(max-height: 500px\)/.test(css)) {
    salah('Aturan mobile `@media (max-width: 768px), (max-height: 500px)` hilang — pasangan batas desktop jadi menggantung.');
  }

  // Potong isi bloknya dengan menghitung kurung.
  const mulai = kepala.index + kepala[0].length;
  let dalam = 1;
  let i = mulai;
  for (; i < css.length && dalam > 0; i++) {
    if (css[i] === '{') dalam++;
    else if (css[i] === '}') dalam--;
  }
  const blok = css.slice(mulai, i - 1);

  // 1. Pelebaran harus ADA di dalamnya.
  if (!/\.staff-main\s*\{[^}]*max-width:\s*none/.test(blok)) {
    salah('Blok desktop tidak melebarkan `.staff-main` — yang dikeluhkan justru layar Staff App yang terkunci 760px.');
  }
  if (!/\.inline-card[^{]*\{[^}]*max-width:\s*none\s*!important/.test(blok)) {
    salah(
      'Kartu isi tidak dilebarkan dengan `!important`. Batasnya menempel sebagai atribut `style`, ' +
        'dan atribut selalu menang atas stylesheet — tanpa `!important` aturan ini tidak melakukan apa pun.'
    );
  }

  // 4. Hanya soal lebar.
  //
  // Properti di bawah mengubah ukuran huruf, target sentuh, atau susunan.
  // Semuanya sama pentingnya di desktop dan di HP, jadi kalau salah satunya
  // muncul di sini, artinya blok ini sudah bukan sekadar pelebaran lagi.
  //
  // Diperiksa pada DEKLARASI saja, bukan seluruh teks blok. Dua kali audit ini
  // menuduh dirinya sendiri: `display:` yang ia temukan ada di dalam pemilih
  // `[style*="display:flex"]`, dan `.modal-card` yang ia laporkan ada di
  // komentar penjelasnya. Audit yang menuduh kode benar akan dimatikan orang,
  // dan sesudah itu ia tidak menjaga apa pun.
  const deklarasi = blok
    .replace(/\/\*[\s\S]*?\*\//g, '') // komentar
    .replace(/\[[^\]]*\]/g, '') // pemilih atribut, tempat `display:flex` muncul sebagai teks
    .replace(/[^{}]*\{/g, '{'); // sisakan isi kurung, buang pemilihnya

  for (const prop of ['font-size', 'flex-direction', 'grid-template-columns', 'display:', 'gap:', 'min-height:']) {
    if (deklarasi.includes(prop)) {
      salah(`Blok desktop memuat \`${prop}\` — blok ini hanya boleh mengurus LEBAR, bukan ukuran huruf atau susunan.`);
    }
  }

  // Jarak vertikal tidak boleh berubah: yang melebar itu sisi kiri-kanan.
  const pad = /\.staff-main\s*\{[^}]*padding:\s*([^;]+);/.exec(blok);
  if (pad && !pad[1].trim().startsWith('var(--spacing-lg)')) {
    salah(`Jarak atas-bawah \`.staff-main\` ikut berubah (\`${pad[1].trim()}\`). Yang diminta lebarnya, bukan tingginya.`);
  }

  // Dialog sengaja TIDAK ikut melebar: ia mengambang di atas halaman, dan
  // selebar layar ia berhenti terlihat sebagai dialog.
  //
  // Komentar dibuang dulu — versi pertama pemeriksaan ini menemukan
  // `.modal-card` di kalimat yang menjelaskan kenapa ia dikecualikan.
  const blokTanpaKomentar = blok.replace(/\/\*[\s\S]*?\*\//g, '');
  if (/\.modal-card/.test(blokTanpaKomentar)) {
    salah('Blok desktop menyentuh `.modal-card`. Dialog selebar layar berhenti terbaca sebagai dialog.');
  }

  // Kotak isian tunggal tetap dibatasi — kotak "Nomor nota" sepanjang meja
  // membuat pengisian lebih sulit, bukan lebih mudah.
  if (!/\.field > input[^{]*\{[^}]*max-width:\s*\d/.test(blok)) {
    salah('Kotak isian tunggal tidak dibatasi di desktop — `.field input` lebarnya 100%, jadi di kartu selebar layar ia ikut memanjang.');
  }
}

// ---------------------------------------------------------------
// 5. Aturan mobile yang sudah ada tidak dilemahkan.
// ---------------------------------------------------------------
const blokMobile = /@media \(max-width: 768px\), \(max-height: 500px\) \{([\s\S]*?)\n\}/.exec(css);
if (blokMobile && !/\.inline-card\s*\{\s*max-width:\s*100%\s*!important/.test(blokMobile[1])) {
  salah('Aturan mobile `.inline-card { max-width: 100% !important }` hilang — kartu di HP kembali terikat batas inline-nya.');
}
if (!/\.staff-main\s*\{\s*padding: var\(--spacing-md\); \}/.test(css) && !/@media \(max-width: 768px\) \{\s*\.staff-main \{ padding: var\(--spacing-md\); \}/.test(css)) {
  salah('Jarak `.staff-main` versi mobile (`var(--spacing-md)`) hilang.');
}

// ---------------------------------------------------------------
// Tidak ada `max-width: none !important` yang berkeliaran di luar media query.
//
// Satu baris seperti itu di lingkup global akan melebarkan kartu di HP juga —
// dan karena `!important`, aturan mobile di baris 485 tidak bisa menahannya.
// ---------------------------------------------------------------
let kedalaman = 0;
let baris = 1;
for (let i = 0; i < css.length; i++) {
  const c = css[i];
  if (c === '\n') baris++;
  if (c === '@' && css.startsWith('@media', i)) kedalaman = -1; // menunggu '{' pembuka media
  if (c === '{') kedalaman = kedalaman === -1 ? 1 : kedalaman + (kedalaman > 0 ? 1 : 0);
  if (c === '}' && kedalaman > 0) kedalaman--;
  if (kedalaman === 0 && css.startsWith('max-width: none !important', i)) {
    salah(`css/styles.css:${baris} — \`max-width: none !important\` di luar media query akan melebarkan kartu di HP juga.`);
  }
}

if (gagal === 0) {
  console.log('Lebar desktop: dikurung media query 769/501, hanya mengurus lebar, aturan mobile utuh. ✅');
}
process.exit(gagal === 0 ? 0 : 1);
