/**
 * AUDIT: kolom Date berkas ESB berisi tanggal, bukan tulisan.
 *
 * ============ CARA FITUR INI RUSAK TANPA TERLIHAT RUSAK ============
 *
 *   kembali mengirim teks              -> berkasnya terunduh, terbuka rapi, dan
 *                                         DITOLAK ESB. Persis keluhan yang
 *                                         melahirkan perbaikan ini.
 *   objek `Date` diserahkan ke SheetJS -> 46266.00013888889, sisa 12 detik LMT
 *                                         Jakarta. Selnya jadi "1 Sep 2026
 *                                         00:00:12" dan tidak ada yang tahu
 *                                         bagaimana ESB memperlakukannya
 *   tanggal tak terbaca dikosongkan    -> sel Date kosong TIDAK ditolak ESB; ia
 *                                         diisi tanggal unggah. Nota bulan lalu
 *                                         masuk sebagai pembelian hari ini
 *   format tampilan dicabut            -> isinya benar tapi tampil `46266`, dan
 *                                         yang memeriksa sebelum mengunggah
 *                                         mengira ekspornya rusak
 *   Transfer dilupakan                 -> B2 template Transfer bertipe tanggal
 *                                         juga; memperbaiki Purchase saja
 *                                         menyisakan separuh masalahnya
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

const bersih = (isi, rel, penanda) => {
  const kode = tanpaKomentar(isi);
  const pesan = periksaKewarasan(isi, kode, penanda);
  if (pesan) salah(`${rel}: ${pesan}`);
  return kode;
};

// ---------------------------------------------------------------
// 1. Modul murninya.
// ---------------------------------------------------------------
const tgl = baca('js/modules/inventory/tanggal-excel.js');
if (tgl) {
  const kode = bersih(tgl, 'tanggal-excel.js', ['export function serialTanggalExcel', 'export function pasangFormatTanggal']);

  for (const n of ['serialTanggalExcel', 'pasangFormatTanggal']) {
    if (!new RegExp(`export function ${n}\\(`).test(kode)) salah(`tanggal-excel.js: \`${n}\` tidak diekspor.`);
  }

  // Titik nolnya 30 Desember 1899. Menggeser satu hari membuat SELURUH tanggal
  // meleset satu hari, dan tidak satu pun terlihat salah.
  if (!/Date\.UTC\(1899, 11, 30\)/.test(kode)) {
    salah('tanggal-excel.js: titik nol penanggalan Excel bukan lagi 30 Desember 1899 — seluruh tanggal akan meleset, dan semuanya tetap terlihat masuk akal.');
  }

  // Perhitungannya HARUS lewat Date.UTC dari komponen, bukan lewat waktu lokal.
  if (!/Date\.UTC\(th, bl - 1, hr\)/.test(kode)) {
    salah('tanggal-excel.js: serialnya tidak lagi dihitung dari komponen lewat `Date.UTC` — zona waktu mesin akan ikut masuk ke hasilnya.');
  }
  // Fungsi apa pun yang membaca waktu LOKAL membuat berkasnya bergantung mesin.
  for (const bahaya of ['getFullYear', 'getMonth', 'getDate', 'getHours', 'getTimezoneOffset']) {
    // `getUTCFullYear` dsb. mengandung nama-nama ini sebagai bagian; dicek
    // dengan batas kata supaya `getUTCMonth` tidak salah tertangkap.
    if (new RegExp(`\\.${bahaya}\\(`).test(kode)) {
      salah(`tanggal-excel.js: memakai \`${bahaya}\` (waktu lokal). Berkas yang sama akan keluar berbeda tergantung zona waktu mesin yang membuatnya.`);
    }
  }

  // Tanggal yang tidak ada ditolak, bukan digulirkan.
  if (!/balik\.getUTCFullYear\(\) !== th/.test(kode) || !/balik\.getUTCDate\(\) !== hr/.test(kode)) {
    salah('tanggal-excel.js: tanggal mustahil seperti 30 Februari tidak lagi ditolak — `Date.UTC` menggulirkannya ke 2 Maret tanpa mengeluh, dan pembeliannya tercatat di bulan yang salah.');
  }

  if (!/FORMAT_TANGGAL_EXCEL = 'dd\/mm\/yyyy'/.test(kode)) {
    salah('tanggal-excel.js: format tampilannya berubah dari dd/mm/yyyy.');
  }

  // Kolomnya dicari lewat judul. Angka tetap akan menempel di kolom sebelahnya
  // begitu ada kolom baru di depannya.
  if (!/indexOf\(KOLOM_TANGGAL\)/.test(kode)) {
    salah('tanggal-excel.js: posisi kolom Date tidak lagi dicari lewat judulnya — kolom yang ditambah di depan akan membuat formatnya menempel di kolom yang salah.');
  }
  if (!/sel\.t !== 'n'/.test(kode)) {
    salah('tanggal-excel.js: sel non-angka tidak lagi dilewati — sel kosong yang diberi format tanggal tampil sebagai "00/01/1900".');
  }
  // Lapis kedua, dan diakui begitu: selama penjaga `sel.t !== 'n'` masih berdiri,
  // baris header yang berisi tulisan "Date" akan dilewati juga, jadi memulai
  // dari baris 0 tidak mengubah apa pun hari ini. Ia dijaga karena kedua
  // penjaganya bisa dicabut satu per satu, dan yang mencabut penjaga pertama
  // tidak punya alasan menduga yang kedua sedang menanggungnya.
  //
  // Sejak 0146 baris headernya TIDAK SELALU baris pertama: template Item
  // Journal menaruhnya di baris ke-3. Jadi yang dijaga bukan lagi angka 1,
  // melainkan bahwa perulangannya bermula dari baris sesudah header — dan
  // berhenti sesudah sebanyak `jumlahBaris` baris data, bukan di nomor baris
  // yang kebetulan sama. (Batas `<= jumlahBaris` yang lama, digeser ke bawah,
  // akan memformat lebih sedikit sel dari yang ada.)
  if (!/const awal = Number\.isInteger\(barisHeader\) && barisHeader >= 0 \? barisHeader \+ 1 : 1;/.test(kode)) {
    salah('tanggal-excel.js: baris data pertama tidak lagi diturunkan dari baris headernya.');
  }
  if (!/for \(let r = awal; r < awal \+ jumlahBaris; r\+\+\)/.test(kode)) {
    salah('tanggal-excel.js: pemformatannya tidak lagi dimulai dari baris data pertama — baris header ikut tersapu.');
  }
}

// ---------------------------------------------------------------
// 2. Simple Purchase.
// ---------------------------------------------------------------
const pur = baca('js/modules/inventory/esb-purchase.js');
if (pur) {
  const kode = bersih(pur, 'esb-purchase.js', ['export function barisEsbPurchase']);

  if (!/import \{ serialTanggalExcel \} from '\.\/tanggal-excel\.js'/.test(kode)) {
    salah('esb-purchase.js: `serialTanggalExcel` tidak diimpor.');
  }
  if (!/const tanggal = serialTanggalExcel\(n\.receipt_date\)/.test(kode)) {
    salah('esb-purchase.js: tanggal nota tidak lagi diubah jadi nomor seri Excel.');
  }
  // Bug lamanya, persis: teks di kolom Date.
  if (/teks\(n\.receipt_date\)/.test(kode)) {
    salah('esb-purchase.js: `teks(n.receipt_date)` kembali — kolom Date berisi tulisan lagi, dan ESB menolak berkasnya.');
  }
  // Yang dicek bukan cuma "bug lama tidak kembali" melainkan "sel Date memang
  // diisi dari `tanggal`". Melarang satu bentuk tulisan tertentu tidak melarang
  // bentuk tulisan lain, dan `String(n.receipt_date)` sama menyesatkannya.
  if (!/^\s*tanggal \?\? '',$/m.test(kode)) {
    salah('esb-purchase.js: sel Date tidak diisi dari `tanggal` — apa pun yang mengisinya sekarang, ia bukan nomor seri Excel.');
  }
  if (/n\.receipt_date/.test(kode.replace(/const tanggal = serialTanggalExcel\(n\.receipt_date\);/, '').replace(/catat\('tanggal', n\.receipt_date, kode\);/, ''))) {
    salah('esb-purchase.js: `receipt_date` dipakai di tempat lain selain perhitungan serial & pencatatan alasannya — periksa apakah ia menyelinap kembali ke baris datanya.');
  }
  // Objek Date ke SheetJS: 12 detik LMT Jakarta ikut terbawa.
  if (/new Date\(/.test(kode)) {
    salah('esb-purchase.js: ada `new Date(` — objek Date yang sampai ke SheetJS membawa sisa zona waktu (46266.00013888889).');
  }
  if (!/if \(tanggal === null\) catat\('tanggal', n\.receipt_date, kode\)/.test(kode)) {
    salah('esb-purchase.js: tanggal yang gagal dibaca tidak lagi dicatat sebagai alasan — notanya tertahan tanpa ada yang tahu kenapa.');
  }
  // Ditahan, bukan dikosongkan.
  if (!/const kepalaBermasalah = tanggal === null \|\|/.test(kode)) {
    salah(
      'esb-purchase.js: nota bertanggal tak terbaca tidak lagi tertahan. Sel Date kosong tidak ditolak ESB — ia diisi ' +
        'tanggal unggah, jadi nota bulan lalu masuk sebagai pembelian hari ini.'
    );
  }
}

// ---------------------------------------------------------------
// 3. Simple Transfer — template-nya punya penyakit yang sama.
// ---------------------------------------------------------------
const trf = baca('js/modules/inventory/esb-transfer.js');
if (trf) {
  const kode = bersih(trf, 'esb-transfer.js', ['export function barisEsbTransfer']);

  if (!/import \{ serialTanggalExcel \} from '\.\/tanggal-excel\.js'/.test(kode)) {
    salah('esb-transfer.js: `serialTanggalExcel` tidak diimpor — B2 template Transfer bertipe tanggal juga.');
  }
  // Urutannya: pilih HARI-nya menurut WIB dulu, baru jadikan serial.
  if (!/serialTanggalExcel\(tanggalWIB\(d\.received_at\)\)/.test(kode)) {
    salah(
      'esb-transfer.js: tanggal terima tidak lagi melewati `tanggalWIB` lalu `serialTanggalExcel`. Tanpa tanggalWIB, ' +
        'kiriman sore hari tercatat mundur satu hari; tanpa serialTanggalExcel, selnya kembali jadi tulisan.'
    );
  }
  if (!/if \(tanggal === null\) catat\('tanggal-terima', kode, kode\)/.test(kode)) {
    salah('esb-transfer.js: kiriman tanpa tanggal terima tidak lagi dicatat alasannya.');
  }
  if (!/const kepalaBermasalah = tanggal === null \|\|/.test(kode)) {
    salah('esb-transfer.js: kiriman bertanggal tak terbaca tidak lagi tertahan.');
  }
  if (!/^\s*tanggal \?\? '',$/m.test(kode)) {
    salah('esb-transfer.js: sel Date tidak diisi dari `tanggal`.');
  }
}

// ---------------------------------------------------------------
// 4. Berkas unduhannya.
// ---------------------------------------------------------------
const adm = baca('js/modules/inventory/esb.admin.js');
if (adm) {
  const kode = bersih(adm, 'esb.admin.js', ['async function unduhEsb']);

  if (!/import \{ pasangFormatTanggal \} from '\.\/tanggal-excel\.js'/.test(kode)) {
    salah('esb.admin.js: `pasangFormatTanggal` tidak diimpor.');
  }
  // Argumen kelima (`barisHeader`) masuk bersama Item Journal di 0146 dan
  // WAJIB ikut: tanpa itu formatnya meleset ke atas sebanyak baris kepala
  // berkasnya, dan melesetnya tidak melempar apa pun.
  if (!/pasangFormatTanggal\(ws, kolom, baris\.length, \(c, r\) => XLSX\.utils\.encode_cell\(\{ c, r \}\), barisHeader\)/.test(kode)) {
    salah(
      'esb.admin.js: kolom Date tidak diberi format saat berkasnya ditulis. Isinya benar tapi tampil sebagai `46266`, ' +
        'dan yang membukanya untuk memeriksa sebelum mengunggah akan mengira ekspornya rusak.'
    );
  }
  // Pemasangan formatnya harus SEBELUM buku ditulis ke berkas.
  const iPasang = kode.indexOf('pasangFormatTanggal(ws');
  const iTulis = kode.indexOf('XLSX.writeFile(wb');
  if (iPasang >= 0 && iTulis >= 0 && iPasang > iTulis) {
    salah('esb.admin.js: formatnya dipasang SESUDAH berkasnya ditulis — berkas yang terunduh tidak memuatnya.');
  }

  // Alasan non-pemetaan harus punya label yang terbaca. Tanpa ini barisnya
  // muncul sebagai "tanggal" mentah, dan orangnya mencarinya di dropdown
  // pemetaan yang memang tidak punya baris itu.
  for (const j of ['tanggal', 'tanggal-terima']) {
    if (!new RegExp(`'?${j}'?:`).test(kode)) {
      salah(`esb.admin.js: jenis masalah "${j}" tidak punya label — ia muncul mentah di tabel, dan dicari di pemetaan yang tidak memuatnya.`);
    }
  }
  if (/Petakan dulu di langkah 2/.test(kode)) {
    salah('esb.admin.js: kalimatnya masih menyuruh "petakan dulu" untuk semua baris, padahal tanggal & harga tidak diperbaiki lewat pemetaan.');
  }
}

if (gagal === 0) {
  console.log(
    'Kolom Date Purchase & Transfer berisi nomor seri Excel bulat (bebas zona waktu), diberi format dd/mm/yyyy saat ' +
      'diunduh, dan tanggal yang tak terbaca menahan dokumennya. ✅'
  );
}
process.exit(gagal === 0 ? 0 : 1);
