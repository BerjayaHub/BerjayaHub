/**
 * SABOTASE: Export Excel buku resep.
 *
 * Yang dijaga: berkasnya bisa diunggah balik tanpa MENGALIKAN HPP 1800 kali,
 * isinya sama dengan yang dilihat orangnya, dan angkanya tetap angka.
 *
 * ============ JEBAKAN `String.replace` ============
 *
 * Mengganti dengan STRING hanya mengenai kemunculan PERTAMA. Pola yang muncul
 * lebih dari sekali harus memakai regex `/…/g` — `numeric: true` di
 * `buku-resep.js` adalah kasus itu.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AKAR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const P = (rel) => path.join(AKAR, rel);

const BUKU = 'js/modules/product/buku-resep.js';
const PAGE = 'js/modules/product/product.admin.page.js';
const IMP = 'js/modules/product/product-import.js';

const asli = new Map();
for (const rel of [BUKU, PAGE, IMP]) asli.set(rel, fs.readFileSync(P(rel), 'utf8'));

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

const TES = 'tools/test-buku-resep.mjs';
const AUDIT = 'tools/audit-ekspor-resep.cjs';

console.log('SABOTASE JUDUL KOLOM (bug yang baru diperbaiki):');

sabotase(
  'kolom Yield kembali bernama "Hasil/Yield" — yield 1800 jatuh jadi 1 saat diunggah balik',
  BUKU,
  "export const KOLOM_IMPOR_RESEP = ['Produk', 'Varian', 'Yield', 'Bahan', 'Jumlah'];",
  "export const KOLOM_IMPOR_RESEP = ['Produk', 'Varian', 'Hasil/Yield', 'Bahan', 'Jumlah'];",
  TES
);
sabotase(
  'kolom Jumlah dinamai "Takaran" — bahannya masuk tanpa jumlah',
  BUKU,
  "export const KOLOM_IMPOR_RESEP = ['Produk', 'Varian', 'Yield', 'Bahan', 'Jumlah'];",
  "export const KOLOM_IMPOR_RESEP = ['Produk', 'Varian', 'Yield', 'Bahan', 'Takaran'];",
  TES
);
sabotase(
  'judul kolom ditulis ulang sebagai literal — dua salinan yang akan menyimpang',
  BUKU,
  '    { header: KOLOM_IMPOR_RESEP[2], width: 0.9, align: \'right\', numeric: true },',
  "    { header: 'Yield', width: 0.9, align: 'right', numeric: true },",
  AUDIT
);
sabotase(
  'ejaan varian diganti jadi yang tidak dikenali pengimpor',
  BUKU,
  "const MODE_TEKS = { production: 'Produksi (CK)', standalone: 'Standalone', served_by_ck: 'Dilayani CK' };",
  "const MODE_TEKS = { production: 'CK Produksi', standalone: 'Mandiri Sendiri', served_by_ck: 'Via CK' };",
  TES
);
// Sisi SEBERANGNYA juga dijaga: kalau templatenya yang berubah, ekspornya ikut
// harus dibetulkan — dan pemeriksaannya harus berteriak, bukan diam.
sabotase(
  'template resepnya yang berubah — ekspornya jadi tertinggal',
  IMP,
  "'Produk,Varian,Yield,Bahan,Jumlah\\n'",
  "'Produk,Varian,Hasil,Bahan,Jumlah\\n'",
  AUDIT
);

console.log('\nSABOTASE RESEP KOSONG:');

sabotase(
  'penanda resep kosong kembali ke kolom Bahan — berkasnya mencari bahan bernama "(resep kosong…)"',
  BUKU,
  "        p.category ?? '',\n        modeTeks,\n        angka(r.yield_qty),\n        '',\n        '',\n        '',",
  "        p.category ?? '',\n        modeTeks,\n        angka(r.yield_qty),\n        '(resep kosong — bahannya tidak tersimpan)',\n        '',\n        '',",
  TES
);
sabotase(
  'resep kosong dilewati diam-diam — berkasnya terlihat lengkap padahal aplikasinya memperingatkan',
  BUKU,
  '    if (!items.length) {',
  '    if (items.length === 0 && true) { continue; } if (!items.length) {',
  TES
);
sabotase(
  'yield resep kosong tidak ikut terbawa',
  BUKU,
  "        modeTeks,\n        angka(r.yield_qty),\n        '',\n        '',\n        '',",
  "        modeTeks,\n        '',\n        '',\n        '',\n        '',",
  TES
);

console.log('\nSABOTASE NILAI & CATATAN:');

sabotase(
  'bahan tanpa harga ditulis Rp0 — kolom Biaya terlihat sah, totalnya salah',
  BUKU,
  "        ...(denganNilai ? [hpp == null ? '-' : rupiah(hpp), biaya == null ? '-' : rupiah(biaya), rupiah(hppProduk)] : []),",
  '        ...(denganNilai ? [rupiah(hpp ?? 0), rupiah(biaya ?? 0), rupiah(hppProduk)] : []),',
  TES
);
sabotase(
  'sebab bahan tak berharga berhenti ditulis di Catatan',
  BUKU,
  "      else if (hpp == null) catatan.push(`${b.name}: harganya belum ada, jadi biayanya tidak bisa dihitung`);",
  '      else if (false) catatan.push();',
  TES
);
sabotase(
  'bahan yang sudah dihapus berhenti ditandai',
  BUKU,
  "      if (!b) catatan.push('Bahan sudah dihapus dari Master Produk');",
  '      if (false) catatan.push();',
  TES
);
sabotase(
  'varian yang HPP-nya belum bisa dihitung berhenti dihitung',
  BUKU,
  '    if (hppProduk == null) tanpaHpp++;',
  '    if (false) tanpaHpp++;',
  TES
);
// `/…/g`: `numeric: true` muncul di SEMBILAN tempat. Mematikan satu saja tidak
// membuktikan delapan lainnya dijaga.
sabotase(
  'seluruh kolom angka jadi TEKS — Yield & Jumlah tidak bisa dipivot',
  BUKU,
  /numeric: true/g,
  'numeric: false',
  AUDIT
);

console.log('\nSABOTASE SARINGAN & KEJUJURAN BERKAS:');

sabotase(
  'unduhan mengabaikan saringan — berkas 400 varian padahal layarnya menampilkan 12',
  BUKU,
  '    if (!lolos(p)) continue;',
  '',
  TES
);
sabotase(
  'nama tidak dibakukan — "sirup gula" tidak menemukan "Sirup  Gula"',
  BUKU,
  '    if (s.nama && !bakukan(p.name).includes(s.nama)) return false;',
  '    if (s.nama && !String(p.name).includes(s.nama)) return false;',
  TES
);
sabotase(
  'saringan digabung ATAU, bukan DAN',
  BUKU,
  "    if (s.tipe && (TIPE_TEKS[p.product_type] ?? p.product_type) !== s.tipe) return false;",
  '    if (false) return false;',
  TES
);
sabotase(
  'subjudul berhenti mengaku disaring',
  BUKU,
  "      (adaSaringan ? `Saringan: ${sebutSaringan || '(aktif)'} · ` : '') +",
  "      '' +",
  TES
);
sabotase(
  'subjudul berhenti menyebut "sekian dari sekian"',
  BUKU,
  '      `${jumlahVarian} dari ${varianTotal} varian resep · ${baris.length} baris bahan · dicetak ${tanggal}` +',
  '      `${jumlahVarian} varian resep · ${baris.length} baris bahan · dicetak ${tanggal}` +',
  TES
);
sabotase(
  'urutan barisnya jadi acak — dua unduhan tidak bisa dibandingkan',
  BUKU,
  '  const urut = [...(recipes ?? [])].sort((a, b) => {',
  '  const urut = [...(recipes ?? [])]; const _abaikan = ((a, b) => {',
  TES
);

console.log('\nSABOTASE LAYAR:');

sabotase('tombol unduh Excel resep dihapus', PAGE, '<button id="btn-unduh-resep-xlsx">⬇ Excel</button>', '', AUDIT);
sabotase(
  'layar tidak lagi mengirim saringan nama resep',
  PAGE,
  "        nama: content.querySelector('#cari-resep')?.value ?? '',",
  "        nama: '',",
  AUDIT
);
sabotase(
  'layar tidak lagi mengirim saringan tipe resep',
  PAGE,
  "        tipe: content.querySelector('#tipe-resep')?.value ?? '',",
  "        tipe: '',",
  AUDIT
);
sabotase(
  'sheet Rekap resep tidak ikut ditulis',
  PAGE,
  '      await exportSheetsXLSX({\n        filename: b.namaBerkas,\n        sheets: [\n          { name: \'Resep\',',
  "      await exportTableXLSX({\n        filename: b.namaBerkas,\n        sheetsXX: [\n          { name: 'Resep',",
  AUDIT
);
sabotase(
  'berkas kosong tetap diunduh — orangnya mengira unduhannya yang rusak',
  PAGE,
  "      if (!b.baris.length) return toast('Tidak ada resep yang cocok dengan saringan ini.', 'info');",
  '',
  AUDIT
);
sabotase(
  'PDF menyusun barisnya sendiri — takarannya bisa menyimpang dari berkas Excel',
  PAGE,
  '  content.querySelector(\'#btn-unduh-resep-pdf\').addEventListener(\n    \'click\',\n    sekaliJalan(async () => {\n      const b = susun();',
  "  content.querySelector('#btn-unduh-resep-pdf').addEventListener(\n    'click',\n    sekaliJalan(async () => {\n      const b = susunBukuResep({ products, recipes });",
  AUDIT
);

console.log('');
if (gagal === 0) console.log('Semua sabotase ekspor resep tertangkap. ✅');
else console.error(`${gagal} sabotase LOLOS.`);
process.exit(gagal === 0 ? 0 : 1);
