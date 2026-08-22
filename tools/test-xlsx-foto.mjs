/**
 * EXPORT EXCEL BERGAMBAR — dibongkar isinya, bukan sekadar "tidak error".
 *
 * ============ KENAPA TES INI ADA ============
 *
 * Kegagalan yang paling mungkin di sini TIDAK melempar error sama sekali:
 * berkasnya terunduh, ukurannya wajar, Excel membukanya tanpa keluhan — dan
 * kolom fotonya kosong. Persis itulah yang terjadi kalau dipakai SheetJS
 * komunitas, yang memang tidak bisa menyisipkan gambar dan tidak mengatakannya.
 *
 * Maka yang diuji bukan "berhasil dijalankan", melainkan isi ZIP-nya: apakah
 * `xl/media/` benar-benar berisi berkas gambar, dan apakah drawing XML-nya
 * menunjuk ke gambar itu pada baris yang benar.
 *
 * Berkas .xlsx adalah arsip ZIP berisi XML. Di sini ia dibongkar apa adanya.
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const AKAR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

let gagal = 0;
const cek = (nama, dapat, harap) => {
  if (JSON.stringify(dapat) !== JSON.stringify(harap)) {
    gagal++;
    console.error(`❌ ${nama}\n   dapat : ${JSON.stringify(dapat)}\n   harap : ${JSON.stringify(harap)}`);
  }
};
const benar = (nama, syarat, ket = '') => {
  if (!syarat) {
    gagal++;
    console.error(`❌ ${nama}${ket ? ' — ' + ket : ''}`);
  }
};

// =====================================================================
// SHIM PERAMBAN
//
// `xlsx-foto.js` ditulis untuk peramban. Yang dibutuhkannya cuma empat hal, dan
// keempatnya dipalsukan seadanya di sini supaya modul ASLI yang diuji — bukan
// salinan logikanya, yang justru akan menyimpang diam-diam dari yang dipakai.
// =====================================================================
// ExcelJS TIDAK ada di repo — ia dimuat dari CDN saat dipakai di peramban, dan
// `node_modules/` memang tidak ikut di-commit. Jadi tes ini melewatkan dirinya
// dengan jelas kalau pustakanya belum dipasang, bukan gagal.
//
// Gagal di sini akan terbaca sebagai "export Excel-nya rusak", padahal yang
// kurang cuma perkakas uji — dan laporan merah yang penyebabnya bukan kode
// adalah cara tercepat membuat orang berhenti membaca hasil regresi.
let ExcelJS;
try {
  ExcelJS = require('exceljs');
} catch {
  console.log('⏭️  xlsx-foto: dilewati — jalankan `npm install --no-save exceljs` dulu untuk mengujinya.');
  process.exit(0);
}

const unduhan = [];

globalThis.window = { ExcelJS };
globalThis.document = {
  head: { appendChild() {} },
  body: { appendChild() {} },
  createElement: () => ({ click() {}, remove() {}, set href(_v) {}, set download(_v) {} })
};
globalThis.URL.createObjectURL = (blob) => {
  unduhan.push(blob);
  return 'blob:palsu';
};
globalThis.URL.revokeObjectURL = () => {};

const { exportTableXLSXFoto } = await import(path.join(AKAR, 'js/core/xlsx-foto.js'));

/** JPEG 2×2 piksel yang sah — cukup untuk membuktikan gambarnya benar-benar ditanam. */
const JPEG_KECIL =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
  'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAACAAIBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAA' +
  'AAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';

const KOLOM = [
  { header: 'Foto', foto: true },
  { header: 'Nama Barang', width: 28 },
  { header: 'Jumlah', numeric: true },
  { header: 'Kondisi' }
];

const BARIS = [
  [JPEG_KECIL, 'Kursi kayu', 12, 'Normal'],
  [null, 'Meja lipat', 4, 'Normal'], // memang tidak berfoto
  ['GAGAL', 'Kulkas', 1, 'Rusak'], // berfoto, tapi gambarnya tidak terambil
  [JPEG_KECIL, 'Rak besi', 7, 'Normal']
];

const hasil = await exportTableXLSXFoto({
  filename: 'uji',
  sheetName: 'Inventaris Aset',
  title: 'Inventaris Aset',
  subtitle: 'Semua outlet · 4 jenis barang',
  columns: KOLOM,
  rows: BARIS
});

// =====================================================================
// 1. LAPORAN BALIKNYA JUJUR
// =====================================================================
cek('1. 2 foto ikut', hasil.adaFoto, 2);
cek('1. 1 foto gagal dilaporkan', hasil.gagalFoto, 1);
cek('1. 4 baris terkirim', hasil.barisTerkirim, 4);

// Yang tidak berfoto TIDAK dihitung sebagai gagal. Kalau tercampur, laporan
// akan menyuruh orang memotret ulang barang yang memang belum pernah difoto.
benar('1. tanpa-foto ≠ gagal', hasil.gagalFoto === 1 && hasil.adaFoto + hasil.gagalFoto === 3);

// =====================================================================
// 2. BERKASNYA BENAR-BENAR TERUNDUH DAN BERTIPE XLSX
// =====================================================================
cek('2. tepat satu unduhan', unduhan.length, 1);
cek('2. MIME xlsx', unduhan[0]?.type, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

const buf = Buffer.from(await unduhan[0].arrayBuffer());
benar('2. ukurannya masuk akal (>3 KB)', buf.length > 3000, `${buf.length} byte`);
cek('2. bermagic ZIP "PK"', buf.subarray(0, 2).toString('latin1'), 'PK');

// =====================================================================
// 3. GAMBARNYA BENAR-BENAR ADA DI DALAM ZIP
//
// Ini inti seluruh perubahan. Tanpa pemeriksaan ini, berkas tanpa gambar akan
// lolos setiap tes lain: ia terunduh, terbuka, dan rapi.
// =====================================================================
/** Daftar nama berkas di dalam ZIP, dibaca dari central directory. */
function isiZip(b) {
  const nama = [];
  const ukuran = new Map();
  for (let i = 0; i < b.length - 46; i++) {
    if (b.readUInt32LE(i) !== 0x02014b50) continue; // signature central directory
    const ukuranTerkompresi = b.readUInt32LE(i + 20);
    const panjangNama = b.readUInt16LE(i + 28);
    const panjangExtra = b.readUInt16LE(i + 30);
    const panjangKomentar = b.readUInt16LE(i + 32);
    const n = b.subarray(i + 46, i + 46 + panjangNama).toString('utf8');
    nama.push(n);
    ukuran.set(n, ukuranTerkompresi);
    i += 46 + panjangNama + panjangExtra + panjangKomentar - 1;
  }
  return { nama, ukuran };
}

const zip = isiZip(buf);
// Entri direktori (`xl/media/` itu sendiri) dibuang — ia bukan berkas gambar.
const media = zip.nama.filter((n) => n.startsWith('xl/media/') && !n.endsWith('/'));
const drawings = zip.nama.filter((n) => n.startsWith('xl/drawings/') && n.endsWith('.xml'));

benar('3. ada berkas di xl/media/', media.length > 0, `isi zip: ${zip.nama.slice(0, 20).join(', ')}`);
cek('3. dua gambar unik ditanam', media.length, 2);
benar('3. berekstensi jpeg', media.every((n) => /\.jpe?g$/i.test(n)), media.join(', '));
benar('3. gambarnya berisi (bukan 0 byte)', media.every((n) => (zip.ukuran.get(n) ?? 0) > 0));
benar('3. ada drawing XML yang menempatkannya', drawings.length > 0, zip.nama.join(', '));
benar('3. sheet-nya ada', zip.nama.includes('xl/worksheets/sheet1.xml'));

// =====================================================================
// 4. DIBACA ULANG — NILAI SELNYA BENAR
// =====================================================================
const wb2 = new ExcelJS.Workbook();
await wb2.xlsx.load(buf);
const ws = wb2.getWorksheet('Inventaris Aset');

benar('4. sheet-nya bernama benar', !!ws);
cek('4. judul di baris 1', ws.getCell('A1').value, 'Inventaris Aset');
cek('4. subjudul di baris 2', ws.getCell('A2').value, 'Semua outlet · 4 jenis barang');

// Judul + subjudul + baris kosong => kepala di baris 4, data mulai baris 5.
const KEPALA = 4;
cek('4. kepala kolom', KOLOM.map((_, i) => ws.getCell(KEPALA, i + 1).value), ['Foto', 'Nama Barang', 'Jumlah', 'Kondisi']);
cek('4. nama barang baris pertama', ws.getCell(KEPALA + 1, 2).value, 'Kursi kayu');
cek('4. nama barang baris terakhir', ws.getCell(KEPALA + 4, 2).value, 'Rak besi');

// SEL FOTO: tiga keadaan yang harus terlihat berbeda.
cek('4. sel foto (ada gambar) dibiarkan kosong', ws.getCell(KEPALA + 1, 1).value, null);
cek('4. sel foto (tidak berfoto) berisi "-"', ws.getCell(KEPALA + 2, 1).value, '-');
cek('4. sel foto (gagal dimuat) mengatakannya', ws.getCell(KEPALA + 3, 1).value, '(foto gagal dimuat)');

// Ini pembedaan yang paling gampang hilang saat kode diringkas nanti.
benar(
  '4. "tidak berfoto" ≠ "gagal dimuat"',
  ws.getCell(KEPALA + 2, 1).value !== ws.getCell(KEPALA + 3, 1).value
);

// =====================================================================
// 5. ANGKA TETAP ANGKA
//
// Kolom Jumlah yang tertulis sebagai teks membuat SUM di Excel berbunyi nol —
// gagal yang tidak terlihat, karena selnya tetap tampil rapi. Dan justru
// menjumlahkan itulah alasan orang meminta Excel alih-alih PDF.
// =====================================================================
for (let i = 0; i < BARIS.length; i++) {
  const sel = ws.getCell(KEPALA + 1 + i, 3);
  benar(`5. baris ${i + 1}: Jumlah bertipe number`, typeof sel.value === 'number', `dapat ${typeof sel.value}`);
  cek(`5. baris ${i + 1}: nilainya benar`, sel.value, BARIS[i][2]);
}

// Angka yang datang sudah TERFORMAT pun harus kembali jadi angka.
unduhan.length = 0;
await exportTableXLSXFoto({
  filename: 'uji2',
  sheetName: 'Angka',
  columns: [{ header: 'Nilai', numeric: true }],
  rows: [['1.500.000'], ['12'], ['bukan angka']]
});
const wb3 = new ExcelJS.Workbook();
await wb3.xlsx.load(Buffer.from(await unduhan[0].arrayBuffer()));
const ws3 = wb3.getWorksheet('Angka');
cek('5. "1.500.000" -> 1500000', ws3.getCell(2, 1).value, 1500000);
cek('5. "12" -> 12', ws3.getCell(3, 1).value, 12);
cek('5. teks bukan angka dibiarkan apa adanya', ws3.getCell(4, 1).value, 'bukan angka');

// =====================================================================
// 6. GAMBAR DITEMPATKAN DI BARIS YANG BENAR
//
// Gambar yang tertanam tapi salah baris justru lebih buruk daripada tidak ada:
// foto kulkas yang muncul di baris kursi adalah data yang keliru, bukan data
// yang hilang.
// =====================================================================
const gambar = ws.getImages ? ws.getImages() : [];
cek('6. dua gambar ditempatkan', gambar.length, 2);

// ExcelJS memakai indeks berbasis nol. Baris data pertama (Excel baris 5)
// berarti row 4; baris keempat (Excel baris 8) berarti row 7.
const barisGambar = gambar.map((g) => Math.floor(g.range?.tl?.nativeRow ?? -1)).sort((a, b) => a - b);
cek('6. gambar di baris data ke-1 dan ke-4', barisGambar, [KEPALA + 1 - 1, KEPALA + 4 - 1]);

// Keduanya di kolom Foto (kolom pertama, indeks 0).
benar('6. keduanya di kolom Foto', gambar.every((g) => Math.floor(g.range?.tl?.nativeCol ?? -1) === 0));

// Baris yang memuat gambar harus ditinggikan, kalau tidak gambarnya menimpa
// baris di bawahnya dan tabelnya jadi tidak terbaca.
benar('6. tinggi baris disetel', (ws.getRow(KEPALA + 1).height ?? 0) > 30, `${ws.getRow(KEPALA + 1).height}`);

// =====================================================================
// 7. TANPA FOTO SAMA SEKALI — tetap sah, tidak ada media kosong
// =====================================================================
unduhan.length = 0;
const tanpaFoto = await exportTableXLSXFoto({
  filename: 'uji3',
  sheetName: 'Kosong',
  columns: [{ header: 'Foto', foto: true }, { header: 'Nama' }],
  rows: [[null, 'A'], [null, 'B']]
});
cek('7. tidak ada foto yang ikut', tanpaFoto.adaFoto, 0);
cek('7. tidak ada yang dilaporkan gagal', tanpaFoto.gagalFoto, 0);

const bufKosong = Buffer.from(await unduhan[0].arrayBuffer());
cek('7. tidak ada berkas gambar', isiZip(bufKosong).nama.filter((n) => n.startsWith('xl/media/') && !n.endsWith('/')).length, 0);

const wb4 = new ExcelJS.Workbook();
await wb4.xlsx.load(bufKosong);
cek('7. berkasnya tetap terbaca', wb4.getWorksheet('Kosong').getCell(2, 2).value, 'A');

// =====================================================================
// 8. DATA URL RUSAK TIDAK MERUNTUHKAN SELURUH EXPORT
//
// Satu baris bermasalah tidak boleh membuat seluruh laporan gagal diunduh —
// laporan 300 aset yang batal karena satu foto rusak adalah kegagalan yang
// jauh lebih mahal daripada satu sel kosong.
// =====================================================================
unduhan.length = 0;
const rusak = await exportTableXLSXFoto({
  filename: 'uji4',
  sheetName: 'Rusak',
  columns: [{ header: 'Foto', foto: true }, { header: 'Nama' }],
  rows: [
    ['data:image/jpeg;base64,BUKAN-BASE64-YANG-SAH???', 'A'], // karakter di luar base64
    ['bukan data url sama sekali', 'B'],
    // Ini yang paling berbahaya: SELURUH karakternya sah sebagai base64, hanya
    // panjangnya yang bukan kelipatan 4 — persis bentuk data URL yang terpotong
    // di tengah jalan. Ia lolos pemeriksaan karakter, dan baru meledak di dalam
    // pustaka ZIP saat berkasnya ditulis, yaitu setelah seluruh baris selesai
    // diproses. Satu foto cacat membatalkan laporan 300 aset, dengan pesan
    // ("Invalid base64 input") yang tidak menunjuk baris mana pun.
    ['data:image/jpeg;base64,AAAAA', 'D'],
    [JPEG_KECIL, 'C']
  ]
});
cek('8. hanya yang sah yang ditanam', rusak.adaFoto, 1);
benar('8. berkasnya tetap terunduh', unduhan.length === 1);

const wb5 = new ExcelJS.Workbook();
await wb5.xlsx.load(Buffer.from(await unduhan[0].arrayBuffer()));
const ws5 = wb5.getWorksheet('Rusak');
cek('8. baris rusak jadi "-", bukan sel hantu', ws5.getCell(2, 1).value, '-');
cek('8. base64 terpotong jadi "-" juga', ws5.getCell(4, 1).value, '-');
cek('8. baris terakhir tetap utuh', ws5.getCell(5, 2).value, 'C');

console.log(gagal === 0 ? '✅ xlsx-foto: semua lulus' : `❌ xlsx-foto: ${gagal} gagal`);
process.exit(gagal === 0 ? 0 : 1);
