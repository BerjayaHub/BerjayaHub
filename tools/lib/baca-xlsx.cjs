/**
 * PEMBACA .xlsx MINIMAL — hanya untuk TES.
 *
 * ============ KENAPA ADA, DAN KENAPA SEKECIL INI ============
 *
 * Impor aset mencocokkan foto ke barang lewat BARIS JANGKAR gambar. Angka itu
 * datang dari bentuk berkas .xlsx, bukan dari kode Berjaya Hub — jadi satu-
 * satunya cara membuktikannya benar adalah membaca berkas .xlsx SUNGGUHAN.
 *
 * Fixture yang ditulis tangan sebagai JSON akan memantulkan kembali anggapan
 * yang sedang diuji: kalau saya salah mengira jangkarnya 1-based, fixture-nya
 * pun saya tulis 1-based, dan tesnya hijau untuk kode yang salah.
 *
 * ExcelJS TIDAK dipakai di sini dengan sengaja: `npm install` gagal di mesin
 * ini (ENOTEMPTY saat rename di dalam folder yang di-mount), dan tes yang
 * menuntut pustaka yang tidak bisa dipasang adalah tes yang tidak pernah
 * dijalankan siapa pun. Yang dibaca berkas ini cuma DUA hal yang memang
 * dibutuhkan tesnya — isi sel dan baris jangkar gambar — dengan `zlib` bawaan
 * Node, tanpa satu pun dependensi.
 *
 * Ini BUKAN pembaca xlsx serbaguna, dan tidak boleh dipakai di luar tes.
 */
const fs = require('fs');
const zlib = require('zlib');

/**
 * Bongkar .zip (dan .xlsx adalah .zip) jadi Map nama -> Buffer.
 *
 * Dibaca dari CENTRAL DIRECTORY di ekor berkas, bukan dengan menelusuri local
 * header satu per satu: local header boleh menuliskan ukuran 0 dan menaruh
 * ukuran sebenarnya di data descriptor SETELAH isinya, dan penelusuran maju
 * yang mempercayai angka itu akan membaca sampah tanpa melempar apa pun.
 */
function bongkarZip(path) {
  const buf = fs.readFileSync(path);

  // End of Central Directory: 0x06054b50, dicari mundur karena ada komentar
  // opsional di belakangnya.
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error(`${path}: bukan berkas zip/xlsx yang sah (EOCD tidak ketemu).`);

  const jumlah = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const isi = new Map();

  for (let n = 0; n < jumlah; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error(`${path}: central directory rusak di entri ke-${n}.`);
    const metode = buf.readUInt16LE(p + 10);
    const ukuranPack = buf.readUInt32LE(p + 20);
    const panjangNama = buf.readUInt16LE(p + 28);
    const panjangExtra = buf.readUInt16LE(p + 30);
    const panjangKomentar = buf.readUInt16LE(p + 32);
    const offset = buf.readUInt32LE(p + 42);
    const nama = buf.toString('utf8', p + 46, p + 46 + panjangNama);

    // Local header punya panjang nama & extra-nya SENDIRI, dan extra-nya
    // sering berbeda dari yang di central directory. Memakai angka central
    // directory di sini menggeser titik awal datanya beberapa byte — dan
    // inflate atas data yang bergeser melempar, bukan mengembalikan sampah,
    // jadi setidaknya ia tidak diam.
    const lnNama = buf.readUInt16LE(offset + 26);
    const lnExtra = buf.readUInt16LE(offset + 28);
    const mulai = offset + 30 + lnNama + lnExtra;
    const data = buf.subarray(mulai, mulai + ukuranPack);

    isi.set(nama, metode === 0 ? Buffer.from(data) : zlib.inflateRawSync(data));
    p += 46 + panjangNama + panjangExtra + panjangKomentar;
  }
  return isi;
}

const nyahEntitas = (s) =>
  String(s)
    // Entitas NUMERIK lebih dulu. Excel menulis "·" sebagai `&#183;`, dan
    // subjudul yang penuh `&#183;` terbaca seperti berkas rusak.
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

/** "B7" -> 1 (indeks kolom 0-based). */
function kolomDariRef(ref) {
  const huruf = String(ref).match(/^[A-Z]+/)?.[0] ?? 'A';
  let n = 0;
  for (const c of huruf) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}

/**
 * Baca sheet pertama jadi array-of-array, plus baris jangkar tiap gambar.
 *
 * @returns {{aoa: Array[], gambar: Array<{row:number, col:number, nama:string}>}}
 */
function bacaXlsx(path) {
  const zip = bongkarZip(path);
  const ambil = (nama) => zip.get(nama)?.toString('utf8') ?? '';

  // sharedStrings: sel bertipe `t="s"` menyimpan INDEKS ke daftar ini, bukan
  // teksnya. Mengabaikannya membuat seluruh kolom teks terbaca sebagai angka
  // 0,1,2… — dan angka itu terlihat seperti data yang sah.
  const shared = [];
  for (const si of ambil('xl/sharedStrings.xml').split('<si>').slice(1)) {
    // Satu `<si>` bisa berisi beberapa `<t>` (teks berformat campuran).
    const potong = [...si.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => nyahEntitas(m[1]));
    shared.push(potong.join(''));
  }

  const sheet = ambil('xl/worksheets/sheet1.xml');
  const aoa = [];
  for (const m of sheet.matchAll(/<row[^>]*\sr="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
    const r = Number(m[1]) - 1; // atribut `r` 1-based; `aoa` 0-based
    const baris = aoa[r] ?? (aoa[r] = []);
    for (const c of m[2].matchAll(/<c\s+r="([A-Z]+\d+)"([^>]*)>([\s\S]*?)<\/c>/g)) {
      const tipe = c[2].match(/\st="([^"]+)"/)?.[1] ?? 'n';
      const v = c[3].match(/<v>([\s\S]*?)<\/v>/)?.[1];
      const inline = c[3].match(/<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>/)?.[1];
      let nilai = null;
      if (tipe === 's') nilai = shared[Number(v)] ?? '';
      else if (tipe === 'inlineStr') nilai = nyahEntitas(inline ?? '');
      else if (v !== undefined) nilai = Number(v);
      baris[kolomDariRef(c[1])] = nilai;
    }
  }
  for (let i = 0; i < aoa.length; i++) if (!aoa[i]) aoa[i] = [];

  // Jangkar gambar. `oneCellAnchor` & `twoCellAnchor` sama-sama punya `<from>`,
  // dan `<from><row>` itulah baris tempat gambarnya menempel — 0-based, sama
  // sistem dengan indeks `aoa`. Ini angka yang sedang dibuktikan tesnya.
  const gambar = [];
  const drawing = ambil('xl/drawings/drawing1.xml');
  for (const a of drawing.matchAll(/<(?:oneCellAnchor|twoCellAnchor)[^>]*>([\s\S]*?)<\/(?:oneCellAnchor|twoCellAnchor)>/g)) {
    const from = a[1].match(/<from>([\s\S]*?)<\/from>/)?.[1] ?? '';
    const row = Number(from.match(/<row>(\d+)<\/row>/)?.[1]);
    const col = Number(from.match(/<col>(\d+)<\/col>/)?.[1]);
    const nama = a[1].match(/name="([^"]*)"/)?.[1] ?? '';
    if (Number.isInteger(row)) gambar.push({ row, col, nama });
  }

  return { aoa, gambar };
}

module.exports = { bacaXlsx, bongkarZip };
