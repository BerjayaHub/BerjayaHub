/**
 * SABOTASE: kolom Date berkas ESB.
 *
 * Yang dijaga: selnya tanggal sungguhan dan bilangan bulat, harinya dipilih
 * menurut WIB, tanggal yang tak terbaca menahan dokumennya, dan formatnya
 * menempel di kolom Date saja.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AKAR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const P = (rel) => path.join(AKAR, rel);

const TGL = 'js/modules/inventory/tanggal-excel.js';
const PUR = 'js/modules/inventory/esb-purchase.js';
const TRF = 'js/modules/inventory/esb-transfer.js';
const ADM = 'js/modules/inventory/esb.admin.js';

const asli = new Map();
for (const rel of [TGL, PUR, TRF, ADM]) asli.set(rel, fs.readFileSync(P(rel), 'utf8'));

const pulih = () => {
  for (const [rel, isi] of asli) fs.writeFileSync(P(rel), isi);
};
process.on('exit', pulih);
process.on('SIGINT', () => process.exit(130));
process.on('SIGTERM', () => process.exit(143));

const jalan = (cmd) => {
  try {
    execFileSync('node', [cmd], { cwd: AKAR, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
};

let gagal = 0;
const sabotase = (nama, rel, dari, ke, pemeriksa) => {
  if (!fs.existsSync(P(pemeriksa))) {
    gagal++;
    console.error(`❌ PEMERIKSANYA TIDAK ADA: ${pemeriksa} — "tertangkap" di sini tidak berarti apa-apa.`);
    return;
  }
  const isi = asli.get(rel);
  const rusak = isi.replace(dari, ke);
  if (rusak === isi) {
    gagal++;
    console.error(`❌ SABOTASE TIDAK TERPASANG: ${nama} — polanya tidak ketemu di ${rel}.`);
    return;
  }
  fs.writeFileSync(P(rel), rusak);
  const hijau = jalan(pemeriksa);
  pulih();
  if (hijau) {
    gagal++;
    console.error(`❌ LOLOS: ${nama}\n   ${pemeriksa} tetap hijau padahal ${rel} sudah dirusak.`);
  } else {
    console.log(`   ✔ tertangkap: ${nama}`);
  }
};

const TES = 'tools/test-tanggal-excel.mjs';
const AUDIT = 'tools/audit-tanggal-esb.cjs';

console.log('SABOTASE PERHITUNGAN SERI:');

sabotase(
  'titik nol digeser satu hari — SELURUH tanggal meleset, dan semuanya tetap terlihat masuk akal',
  TGL,
  'const EPOCH_UTC = Date.UTC(1899, 11, 30);',
  'const EPOCH_UTC = Date.UTC(1899, 11, 31);',
  TES
);
// INI yang paling halus: hasilnya tetap "tanggal", cuma membawa sisa 12 detik
// LMT Jakarta. Tidak ada satu pun layar yang menampilkannya.
sabotase(
  'serialnya dihitung lewat waktu LOKAL — 46266.00013888889, sisa LMT Jakarta ikut terbawa',
  TGL,
  '  const utc = Date.UTC(th, bl - 1, hr);',
  '  const utc = new Date(th, bl - 1, hr).getTime();',
  TES
);
sabotase(
  'tanggal mustahil digulirkan diam-diam — 30 Februari berangkat sebagai 2 Maret',
  TGL,
  '  const balik = new Date(utc);',
  '  const balik = new Date(Date.UTC(th, bl - 1, hr));\n  if (true) { /* dilewati */ } else',
  TES
);
sabotase(
  'tanggal sebelum 1900 diterima — serialnya nol atau negatif, dan Excel menampilkannya sebagai sesuatu yang lain',
  TGL,
  '  return serial >= 1 ? serial : null;',
  '  return serial;',
  TES
);
sabotase(
  'bentuk bebas diterima — "01/09/2026" ditebak, entah 1 September entah 9 Januari',
  TGL,
  "  const m = /^(\\d{4})-(\\d{2})-(\\d{2})/.exec(s);\n  if (!m) return null;",
  "  const m = /^(\\d{4})-(\\d{2})-(\\d{2})/.exec(s) ?? (() => { const d = new Date(s); return Number.isNaN(d.getTime()) ? null : [s, String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')]; })();\n  if (!m) return null;",
  TES
);

console.log('\nSABOTASE FORMAT TAMPILAN:');

sabotase(
  'formatnya tidak pernah dipasang — kolom Date tampil sebagai 46266',
  TGL,
  '    sel.z = FORMAT_TANGGAL_EXCEL;',
  '    void FORMAT_TANGGAL_EXCEL;',
  TES
);
// Diperiksa AUDIT, bukan TES, dan alasannya jujur: selama penjaga
// `sel.t !== 'n'` masih berdiri, baris header yang berisi tulisan "Date"
// dilewati juga, jadi memulai dari baris 0 tidak mengubah keluaran apa pun hari
// ini. Tidak ada tes yang bisa menangkapnya tanpa berpura-pura header itu
// angka. Ia tetap dijaga karena kedua penjaganya bisa dicabut satu per satu.
sabotase(
  'baris header ikut disapu — lapis kedua yang menahan judul "Date" ikut diformat',
  TGL,
  '  for (let r = 1; r <= jumlahBaris; r++) {',
  '  for (let r = 0; r <= jumlahBaris; r++) {',
  AUDIT
);
sabotase(
  'posisi kolomnya ditulis sebagai angka tetap — satu kolom baru di depan membuatnya menempel di kolom yang salah',
  TGL,
  '  const c = (Array.isArray(kolom) ? kolom : []).indexOf(KOLOM_TANGGAL);',
  '  const c = 2;',
  TES
);
sabotase(
  'sel kosong ikut diformat — barisnya menampilkan "00/01/1900" seolah ada tanggalnya',
  TGL,
  "    if (!sel || sel.t !== 'n') continue;",
  '    if (!sel) continue;',
  TES
);

console.log('\nSABOTASE SIMPLE PURCHASE:');

// Persis bug yang dikeluhkan: berkasnya terunduh, terbuka rapi, ditolak ESB.
sabotase(
  'kolom Date kembali berisi tulisan — berkasnya terunduh rapi dan ditolak ESB',
  PUR,
  "        tanggal ?? '',",
  '        String(n.receipt_date ?? ""),',
  AUDIT
);
sabotase(
  'objek Date diserahkan apa adanya — SheetJS menambahkan sisa zona waktu sendiri',
  PUR,
  '    const tanggal = serialTanggalExcel(n.receipt_date);',
  '    const tanggal = n.receipt_date ? new Date(n.receipt_date) : null;',
  AUDIT
);
sabotase(
  'nota bertanggal tak terbaca tetap berangkat — sel Date kosong diisi ESB dengan tanggal unggah',
  PUR,
  '    const kepalaBermasalah = tanggal === null || !branch',
  '    const kepalaBermasalah = !branch',
  TES
);
sabotase(
  'alasannya tidak dicatat — notanya tertahan tanpa ada yang tahu kenapa',
  PUR,
  "    if (tanggal === null) catat('tanggal', n.receipt_date, kode);",
  '    if (tanggal === null) { /* diam saja */ }',
  TES
);

console.log('\nSABOTASE SIMPLE TRANSFER:');

sabotase(
  'Transfer dilupakan — B2 template-nya bertipe tanggal juga, jadi separuh masalahnya kembali',
  TRF,
  '    const tanggal = serialTanggalExcel(tanggalWIB(d.received_at));',
  '    const tanggal = tanggalWIB(d.received_at) || null;',
  TES
);
sabotase(
  'tanggalWIB dilewati — kiriman sore hari tercatat mundur satu hari',
  TRF,
  '    const tanggal = serialTanggalExcel(tanggalWIB(d.received_at));',
  '    const tanggal = serialTanggalExcel(d.received_at);',
  TES
);
sabotase(
  'kiriman bertanggal tak terbaca tetap berangkat',
  TRF,
  '    const kepalaBermasalah = tanggal === null || !asalB',
  '    const kepalaBermasalah = !asalB',
  TES
);

console.log('\nSABOTASE BERKAS UNDUHAN:');

sabotase(
  'formatnya tidak dipasang saat berkasnya ditulis',
  ADM,
  '  pasangFormatTanggal(ws, kolom, baris.length, (c, r) => XLSX.utils.encode_cell({ c, r }));',
  '  void pasangFormatTanggal;',
  AUDIT
);
sabotase(
  'formatnya dipasang untuk NOL baris — berkasnya tetap menampilkan angka mentah',
  ADM,
  'pasangFormatTanggal(ws, kolom, baris.length,',
  'pasangFormatTanggal(ws, kolom, 0,',
  AUDIT
);
sabotase(
  'alasan "tanggal" muncul mentah di tabel — orangnya mencarinya di dropdown pemetaan yang memang tidak memuatnya',
  ADM,
  "  tanggal: 'Tanggal nota (perbaiki di notanya)',",
  '',
  AUDIT
);

console.log('');
if (gagal === 0) console.log('Semua sabotase tanggal ESB tertangkap. ✅');
else console.error(`${gagal} sabotase LOLOS.`);
process.exit(gagal === 0 ? 0 : 1);
