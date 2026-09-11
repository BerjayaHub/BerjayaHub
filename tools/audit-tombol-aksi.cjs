#!/usr/bin/env node
/**
 * AUDIT: tombol di dalam sel tabel tidak boleh melebarkan halaman.
 *
 * ============ BUG YANG MELAHIRKANNYA ============
 *
 * Di riwayat "Terima dari supplier", tombol merah "Hapus" terpotong di tepi
 * kanan layar. Halamannya harus digeser mendatar — atau diperkecil — supaya
 * tombolnya kelihatan. Seluruh halaman ikut melebar, bukan cuma tabelnya.
 *
 * Sebabnya satu baris CSS yang sudah lama ada dan tidak pernah dicurigai:
 *
 *     @media (max-width: 768px) {
 *       .btn-inline, .btn-ghost, .btn-danger { width: 100% !important; }
 *     }
 *
 * Maksudnya tombol DIALOG: di layar sempit "Batal" dan "Simpan" ditumpuk
 * selebar kartunya. Tapi selektornya tidak menyebut dialog sama sekali, jadi ia
 * kena setiap `.btn-danger` di seluruh aplikasi — termasuk yang duduk di dalam
 * sel "Aksi" bersama empat tombol lain.
 *
 * Di mode kartu, sel itu `display:flex` TANPA `flex-wrap`, dengan 40% lebarnya
 * sudah dipakai label kartu. Satu tombol yang menuntut 100% lebar tidak punya
 * tempat: ia meluap ke kanan, melewati `.table-scroll` yang di mode kartu
 * memang `overflow-x: visible`, lalu melebarkan HALAMAN.
 *
 * Tidak ada error. Tidak ada yang rusak. Dua modul bahkan sudah menambal
 * gejalanya sendiri dengan `style="min-height:38px"` inline (bep.owner,
 * dokumen.admin) tanpa pernah menemukan sebabnya — tanda paling jelas bahwa
 * bentuk kegagalan ini berulang.
 *
 * ============ YANG DIJAGA DI SINI ============
 *
 *  1. Pengecualian sel tabel terhadap `width: 100% !important` tetap ada.
 *  2. Tombol di dalam `.data-table td` punya ukuran seragam yang kecil —
 *     termasuk `.btn-danger`, yang tanpa itu 44px/0.95rem di antara tetangga
 *     34px/0.8rem.
 *  3. Sel mode kartu boleh membungkus (`flex-wrap`) — jaring pengaman untuk
 *     nilai apa pun yang lebih lebar dari selnya, bukan cuma tombol.
 *  4. Sel yang memuat dua tombol atau lebih mendapat barisnya sendiri, dan
 *     `white-space:nowrap` inline dikalahkan di sana.
 *  5. Tidak ada tombol di dalam `<td>` yang membawa ukuran di atribut `style`.
 *     Itu menambal gejala di satu layar sambil membiarkan sebabnya hidup, dan
 *     gaya inline mengalahkan perbaikan bersama di CSS.
 */

const fs = require('fs');
const path = require('path');

const AKAR = path.dirname(__dirname);
let gagal = 0;
const salah = (pesan) => {
  gagal++;
  console.error(`❌ ${pesan}`);
};

// ---------------------------------------------------------------
// Bagian A — CSS
// ---------------------------------------------------------------
const BERKAS_CSS = path.join(AKAR, 'css', 'styles.css');
if (!fs.existsSync(BERKAS_CSS)) {
  salah('css/styles.css tidak ada — audit ini kehilangan sasarannya.');
  process.exit(1);
}
const cssAsli = fs.readFileSync(BERKAS_CSS, 'utf8');

/**
 * Komentar DIBUANG sebelum diperiksa.
 *
 * Blok komentar di berkas ini panjang dan mengutip potongan CSS-nya sendiri
 * ("`overflow-x: visible`", "`width: 100% !important`"). Tanpa pembuangan ini,
 * penjelasan tentang aturan sudah cukup membuat audit menyatakan lulus —
 * padahal aturannya sendiri mungkin sudah dihapus.
 */
const css = cssAsli.replace(/\/\*[\s\S]*?\*\//g, '');

/** Isi sebuah `@media (max-width: N)` — dengan kurung yang dihitung seimbang. */
function isiMedia(teks, maxWidth) {
  const pola = new RegExp(`@media[^{]*max-width:\\s*${maxWidth}px[^{]*\\{`, 'g');
  let hasil = '';
  let m;
  while ((m = pola.exec(teks))) {
    let dalam = 1;
    let i = m.index + m[0].length;
    const mulai = i;
    while (i < teks.length && dalam > 0) {
      if (teks[i] === '{') dalam++;
      else if (teks[i] === '}') dalam--;
      i++;
    }
    hasil += teks.slice(mulai, i - 1);
  }
  return hasil;
}

const media768 = isiMedia(css, 768);
const media560 = isiMedia(css, 560);

// (A1) Pengecualian sel tabel terhadap paksaan lebar penuh.
//
// Diperiksa hanya KALAU paksaannya masih ada. Kalau suatu saat baris
// `width: 100% !important` itu dibuang seluruhnya, pengecualiannya memang tidak
// diperlukan lagi — audit yang tetap menuntutnya akan menuduh kode yang benar.
const adaPaksaanLebar = /\.btn-danger[^{}]*\{[^{}]*width:\s*100%\s*!important/.test(media768);
if (adaPaksaanLebar) {
  const blokPengecualian = media768.match(/\.data-table td[^{}]*\.btn-danger[^{}]*\{([^{}]*)\}/);
  if (!blokPengecualian) {
    salah(
      'css/styles.css: `@media (max-width: 768px)` masih memaksa `.btn-danger { width: 100% !important }` ' +
        'tanpa mengecualikan `.data-table td`.\n' +
        '   Tombol Hapus di sel Aksi akan menuntut 100% lebar sel, meluap keluar `.table-scroll` ' +
        '(yang di mode kartu `overflow-x: visible`), dan MELEBARKAN HALAMAN.'
    );
  } else if (!/width:\s*auto\s*!important/.test(blokPengecualian[1])) {
    salah(
      'css/styles.css: pengecualian `.data-table td .btn-danger` ada tapi tidak mengembalikan lebarnya. ' +
        'Tanpa `width: auto !important`, paksaan `100% !important` tetap menang.'
    );
  }
}

/**
 * Isi SEMUA blok yang salah satu selektornya diawali `awalan`.
 *
 * ============ KENAPA BUKAN `css.match(...)` SAJA ============
 *
 * Versi pertama aturan di bawah memakai kecocokan PERTAMA:
 *
 *     css.match(/\.data-table td \.btn-danger\s*\{([^{}]*)\}/)
 *
 * dan kecocokan pertama bukan blok ukurannya, melainkan blok pengecualian di
 * dalam `@media (max-width: 768px)` — yang isinya memang cuma
 * `width: auto !important` dan memang TIDAK seharusnya punya `min-height`.
 * Auditnya merah untuk CSS yang benar.
 *
 * Dan akibatnya jauh lebih buruk daripada satu pesan palsu: selama audit merah
 * tanpa syarat, SELURUH sabotase yang bersandar padanya melaporkan
 * "tertangkap" — karena pemeriksanya memang selalu gagal, dirusak atau tidak.
 * Sembilan sabotase hijau yang tidak membuktikan apa pun. Bentuk kegagalan
 * yang sama dengan yang dijaga repo ini: hijau yang tidak berarti.
 *
 * Jadi yang dipakai: kumpulkan SEMUA blok, lalu tuntut ADA SATU yang memenuhi.
 */
function blokBerselektor(teks, awalan) {
  return [...teks.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((m) =>
      m[1]
        .split(',')
        .map((s) => s.trim().replace(/\s+/g, ' '))
        .some((s) => s.startsWith(awalan))
    )
    .map((m) => m[2]);
}

const tinggiDari = (isi) => Number(isi.match(/min-height:\s*(\d+)px/)?.[1] ?? 0);
const kecil = (isi) => {
  const t = tinggiDari(isi);
  return t > 0 && t <= 36;
};

// (A2) Ukuran seragam tombol di dalam sel tabel.
const blokTombolSel = blokBerselektor(css, '.data-table td button');
if (!blokTombolSel.length) {
  salah(
    'css/styles.css: tidak ada aturan ukuran untuk `.data-table td button`. ' +
      'Tanpa itu sel Aksi memakai ukuran tombol formulir (padding 8px 13px) untuk lima tombol berjajar.'
  );
} else {
  if (!blokTombolSel.some(kecil)) {
    salah(
      `css/styles.css: \`.data-table td button\` tidak punya min-height <=36px (yang ada: ` +
        `${blokTombolSel.map((i) => tinggiDari(i) || '—').join(', ')}). ` +
        'Di layar lebar tombol sel Aksi harus kecil; ukuran sentuh 40px dikembalikan di mode kartu.'
    );
  }
  if (!blokTombolSel.some((isi) => /(?:^|[;\s])width:\s*auto/.test(isi))) {
    salah(
      'css/styles.css: `.data-table td button` tidak menyetel `width: auto`. ' +
        '`button.primary` membawa `width: 100%`, dan di sel Aksi itu mendorong tetangganya keluar.'
    );
  }
}

// `.btn-danger` punya selektornya sendiri yang LEBIH spesifik daripada
// `.data-table td button`; kalau ia tidak ikut dikecilkan, ia tetap 44px/0.95rem
// di antara tetangga 34px/0.8rem — dan tombol itulah yang paling sering terpotong.
const blokDanger = blokBerselektor(css, '.data-table td .btn-danger');
if (!blokDanger.length) {
  salah(
    'css/styles.css: `.btn-danger` di dalam sel tabel tidak disebut sama sekali. ' +
      'Gaya bawaannya (padding 12px 16px, min-height 44px, 0.95rem) ditulis untuk tombol dialog.'
  );
} else if (!blokDanger.some(kecil)) {
  salah(
    `css/styles.css: \`.data-table td .btn-danger\` tidak punya min-height <=36px ` +
      `(yang ada: ${blokDanger.map((i) => tinggiDari(i) || '—').join(', ')}).`
  );
}

// (A3) Jaring pengaman: sel mode kartu boleh membungkus.
//
// SEMUA blok yang menyasar selektor itu dikumpulkan, bukan yang pertama saja.
// Percobaan pertama aturan ini mengambil kecocokan pertama — dan kecocokan
// pertama adalah `.kartu-sempit tbody, .kartu-sempit tr, .kartu-sempit td
// { display: block }`, blok yang memang tidak punya `flex-wrap` dan memang
// tidak seharusnya punya. Auditnya merah untuk kode yang benar. Audit yang
// menuduh kode benar akan dimatikan orang, dan sesudah itu ia tidak menjaga
// apa pun.
const blokSelKartu = [...media560.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) =>
  m[1]
    .split(',')
    .map((s) => s.trim().replace(/\s+/g, ' '))
    .includes('.data-table.kartu-sempit td')
);
if (!blokSelKartu.length) {
  salah('css/styles.css: aturan `.data-table.kartu-sempit td` di `@media (max-width: 560px)` tidak ditemukan.');
} else if (!blokSelKartu.some((m) => /flex-wrap:\s*wrap/.test(m[2]))) {
  salah(
    'css/styles.css: `.data-table.kartu-sempit td` tidak boleh membungkus. ' +
      'Selnya `display:flex` dengan label memakan 40%; nilai apa pun yang lebih lebar dari sisanya ' +
      'akan meluap keluar layar alih-alih turun ke baris berikutnya.'
  );
}

// (A4) Sel dua tombol atau lebih mendapat barisnya sendiri.
//
// Dipilih lewat BENTUK ISINYA (`button ~ button`), bukan lewat kelas yang harus
// diingat orang untuk dipasang. Modul Produksi dulu menyelesaikannya sendiri
// dengan `.prod-aksi`, dan sepuluh modul lain dengan soal yang sama tidak
// kebagian — persis pola "yang mengeluh diperbaiki, sisanya menunggu".
const blokAksiKartu = media560.match(/\.data-table\.kartu-sempit td:has\(button ~ button\)\s*\{([^{}]*)\}/);
if (!blokAksiKartu) {
  salah(
    'css/styles.css: tidak ada aturan `.data-table.kartu-sempit td:has(button ~ button)`. ' +
      'Sel Aksi berisi dua tombol atau lebih harus mendapat barisnya sendiri di layar sempit, ' +
      'di SEMUA modul — bukan hanya yang kebetulan memasang kelas `.prod-aksi`.'
  );
} else {
  if (!/display:\s*block/.test(blokAksiKartu[1])) {
    salah('css/styles.css: sel Aksi mode kartu tidak dijadikan `display: block` — tombolnya tetap berebut satu baris flex.');
  }
  if (!/white-space:\s*normal\s*!important/.test(blokAksiKartu[1])) {
    salah(
      'css/styles.css: sel Aksi mode kartu tidak mengalahkan `white-space:nowrap`. ' +
        'Dua layar Penjualan memasangnya inline (`<td data-label="Aksi" style="white-space:nowrap">`), ' +
        'dan gaya inline mengalahkan stylesheet — tombolnya tidak akan membungkus di layar 360px.'
    );
  }
}

// ---------------------------------------------------------------
// Bagian B — JS: tidak ada tombol dalam <td> yang membawa ukuran inline.
// ---------------------------------------------------------------
const DIR_JS = path.join(AKAR, 'js');

function berkasJs(dir, keluar = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const j = path.join(dir, e.name);
    if (e.isDirectory()) berkasJs(j, keluar);
    else if (e.name.endsWith('.js')) keluar.push(j);
  }
  return keluar;
}

/**
 * Apakah posisi ini berada DI DALAM sebuah `<td>`?
 *
 * Caranya sederhana dan sengaja begitu: bandingkan jarak ke `<td` terdekat di
 * belakang dengan jarak ke `</td>` terdekat di belakang. Kalau `<td` yang lebih
 * dekat, kita masih di dalam sel. Pemindai HTML utuh tidak dipakai karena
 * markupnya hidup di dalam template literal bersarang, dan parser yang berhenti
 * di tempat salah menghasilkan tuduhan palsu — yang lebih buruk daripada tidak
 * mengaudit sama sekali.
 */
function diDalamTd(teks, posisi) {
  const buka = teks.lastIndexOf('<td', posisi);
  if (buka === -1) return false;
  const tutup = teks.lastIndexOf('</td', posisi);
  return buka > tutup;
}

/**
 * Hanya ukuran yang MEMBESARKAN yang dilarang.
 *
 * Ini pembatasan yang disengaja. Beberapa tombol di dalam sel memang perlu
 * lebih KECIL daripada aturan bersama: `.menu-expand` dilucuti jadi judul baris
 * (`padding:0`), tombol bukti DP di Reservasi sengaja mungil
 * (`padding:2px 6px;font-size:0.72rem`). Melarang semua gaya inline akan
 * menuduh keduanya, dan audit yang menuduh kode benar akan dimatikan orang —
 * sesudah itu ia tidak menjaga apa pun.
 *
 * Yang berbahaya cuma satu arah: tombol di sel yang menuntut lebih banyak ruang
 * daripada yang dipunyai selnya. Jadi yang dilarang persis itu — tinggi >= 38px
 * dan lebar penuh.
 */
function ukuranMembesarkan(gaya) {
  const tinggi = gaya.match(/(?:^|[;\s])(?:min-)?height\s*:\s*(\d+)px/);
  if (tinggi && Number(tinggi[1]) >= 38) return `tinggi ${tinggi[1]}px`;
  if (/(?:^|[;\s])width\s*:\s*100%/.test(gaya)) return 'lebar 100%';
  const minLebar = gaya.match(/(?:^|[;\s])min-width\s*:\s*(\d+)px/);
  if (minLebar && Number(minLebar[1]) >= 120) return `min-width ${minLebar[1]}px`;
  return null;
}

let tombolDiperiksa = 0;
const temuan = [];

for (const berkas of berkasJs(DIR_JS)) {
  const src = fs.readFileSync(berkas, 'utf8');
  const rel = path.relative(AKAR, berkas).replace(/\\/g, '/');
  for (const m of src.matchAll(/<button[^>]*>/g)) {
    const gaya = m[0].match(/style="([^"]*)"/);
    if (!gaya) continue;
    if (!diDalamTd(src, m.index)) continue;
    tombolDiperiksa++;
    const sebab = ukuranMembesarkan(gaya[1]);
    if (!sebab) continue;
    const baris = src.slice(0, m.index).split('\n').length;
    temuan.push(
      `${rel}:${baris} — tombol di dalam <td> memaksa ${sebab} lewat atribut style: "${gaya[1]}".\n` +
        '    Gaya inline mengalahkan aturan bersama `.data-table td button`, jadi layar ini akan\n' +
        '    menyimpang sendiri. Dua modul pernah menambal gejalanya begitu (bep.owner,\n' +
        '    dokumen.admin) dan sebab aslinya — tombol yang melebarkan halaman — hidup terus.'
    );
  }
}

for (const t of temuan) salah(t);

if (gagal === 0) {
  console.log(
    `Tombol aksi: pengecualian lebar terpasang, ukuran seragam di sel tabel, sel Aksi punya barisnya sendiri ` +
      `di layar sempit, dan ${tombolDiperiksa} tombol bergaya inline di dalam <td> bebas ukuran. ✅`
  );
}
process.exit(gagal === 0 ? 0 : 1);
