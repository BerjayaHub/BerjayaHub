/**
 * SABOTASE: Export Excel di Master Produk.
 *
 * Yang dijaga bukan "tombolnya jalan", melainkan bahwa berkasnya (a) bisa
 * di-upload balik tanpa kehilangan kolom, (b) isinya sama dengan yang dilihat
 * orangnya, dan (c) angkanya tetap angka.
 *
 * ============ JEBAKAN `String.replace` ============
 *
 * Mengganti dengan STRING hanya mengenai kemunculan PERTAMA. Pola yang muncul
 * lebih dari sekali harus memakai regex `/…/g` — `numeric: true` di
 * `ekspor-produk.js` adalah kasus itu.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AKAR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const P = (rel) => path.join(AKAR, rel);

const EKS = 'js/modules/product/ekspor-produk.js';
const PAGE = 'js/modules/product/product.admin.page.js';
const IMP = 'js/modules/product/product-import.js';

const asli = new Map();
for (const rel of [EKS, PAGE, IMP]) asli.set(rel, fs.readFileSync(P(rel), 'utf8'));

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

const TES = 'tools/test-ekspor-produk.mjs';
const AUDIT = 'tools/audit-ekspor-produk.cjs';

console.log('SABOTASE KECOCOKAN DENGAN TEMPLATE IMPOR:');

sabotase(
  'satu judul kolom digeser sedikit — berkasnya terimpor SEBAGIAN tanpa satu pun pesan',
  EKS,
  "  'Harga Beli (per Satuan Beli)',",
  "  'Harga Beli',",
  TES
);
sabotase(
  'kolom "Sub Kategori" dibuang dari daftar — kolomnya jadi tidak sejajar lagi',
  EKS,
  "  'Sub Kategori',\n",
  '',
  TES
);
sabotase(
  '"Satuan Pakai" ditulis "Satuan" seperti judul di layar',
  EKS,
  "  'Satuan Pakai',",
  "  'Satuan',",
  TES
);
sabotase(
  'KOLOM_PRODUK mengulang judulnya sebagai literal — dua salinan yang akan menyimpang',
  EKS,
  '  { header: KOLOM_IMPOR[0], width: 2.4 },',
  "  { header: 'Nama', width: 2.4 },",
  AUDIT
);
sabotase(
  'ejaan tipe diganti jadi yang tidak dikenali pengimpor',
  EKS,
  "export const TYPE_LABEL = { raw: 'Bahan Baku', semi: 'Setengah Jadi', finished: 'Menu' };",
  "export const TYPE_LABEL = { raw: 'Bahan', semi: 'Semi Jadi', finished: 'Produk' };",
  TES
);
// Sisi SEBERANGNYA juga dijaga: kalau templatenya yang berubah, ekspornya ikut
// harus dibetulkan — dan pemeriksaannya harus berteriak, bukan diam.
sabotase(
  'template impornya yang berubah — ekspornya jadi tertinggal',
  IMP,
  "'Nama,Tipe,Kategori,Sub Kategori,Satuan Pakai,Satuan Beli,Isi per Satuan Beli,Harga Beli (per Satuan Beli),Harga Jual\\n' +\n      'Gula,",
  "'Nama,Tipe,Kelompok,Sub Kategori,Satuan Pakai,Satuan Beli,Isi per Satuan Beli,Harga Beli (per Satuan Beli),Harga Jual\\n' +\n      'Gula,",
  AUDIT
);

console.log('\nSABOTASE KOSONG vs "-":');

sabotase(
  '"-" masuk ke kolom yang dibaca pengimpor — orang mengetiknya balik apa adanya',
  EKS,
  "      isMenu && jual !== null ? formatRupiah(jual) : '',",
  "      isMenu && jual !== null ? formatRupiah(jual) : '-',",
  TES
);
sabotase(
  'harga beli yang belum diisi ditulis "-"',
  EKS,
  "      isRaw && angkaAtauNull(p?.purchase_price) !== null ? formatRupiah(Number(p.purchase_price)) : '',",
  "      isRaw && angkaAtauNull(p?.purchase_price) !== null ? formatRupiah(Number(p.purchase_price)) : '-',",
  TES
);
sabotase(
  'HPP yang tak bisa dihitung dikosongkan — terbaca seperti isian yang terlupa',
  EKS,
  "      h === null ? '-' : formatRupiah(h),",
  "      h === null ? '' : formatRupiah(h),",
  TES
);
sabotase(
  'harga 0 dianggap belum diisi — bahan bonus hilang harganya',
  EKS,
  "  if (v === null || v === undefined || v === '') return null;",
  '  if (!v) return null;',
  TES
);
sabotase(
  'angka non-finite lolos — "Rp∞" di berkas Excel',
  EKS,
  '  return Number.isFinite(n) ? n : null;',
  '  return n;',
  TES
);

console.log('\nSABOTASE SARINGAN & KEJUJURAN BERKAS:');

sabotase(
  'ekspor mengabaikan saringan — berkas 785 baris padahal layarnya menampilkan 40',
  EKS,
  '  const dipakai = semua.filter((p) =>',
  '  const dipakai = semua.filter((p) => true || (',
  TES
);
sabotase(
  'nama tidak dibakukan — "gula pasir" tidak menemukan "Gula  Pasir"',
  EKS,
  '        nama: bakukanNama(p?.name),',
  '        nama: teks(p?.name),',
  TES
);
sabotase(
  'subjudul berhenti menyebut saringan — berkas sebagian tak punya cara mengaku sebagian',
  EKS,
  "    adaSaringan ? `Saringan: ${sebutSaringan || '(aktif)'}` : 'Seluruh produk',",
  "    'Seluruh produk',",
  TES
);
sabotase(
  'subjudul berhenti menyebut "sekian dari sekian"',
  EKS,
  '    `${rincian.length} dari ${semua.length} produk`,',
  '    `${rincian.length} produk`,',
  TES
);
sabotase(
  'jumlah yang disaring keluar berhenti dihitung',
  EKS,
  '      disaring: semua.length - rincian.length,',
  '      disaring: 0,',
  TES
);

console.log('\nSABOTASE CATATAN & REKAP:');

sabotase(
  'sebab HPP kosong tidak lagi dibedakan antara harga beli & isi per satuan',
  EKS,
  "      else if (!(Number(p?.purchase_qty) > 0)) catatan.push('\"Isi per Satuan Beli\" belum diisi, jadi harga per satuan pakai tidak bisa dihitung');",
  "      else catatan.push('HPP belum bisa dihitung');",
  TES
);
sabotase(
  'peringatan harga tertukar dicabut — HPP Rp0,0004/gram lewat tanpa tanda',
  EKS,
  '  const curiga = curigaHargaTertukar(p);\n  if (curiga) catatan.push(curiga);',
  '  const curiga = null;\n  if (curiga) catatan.push(curiga);',
  TES
);
sabotase(
  'menu tanpa harga jual berhenti disebut',
  EKS,
  "  if (tipe === 'finished' && angkaAtauNull(p?.sale_price) === null) catatan.push('Harga jual belum diisi');",
  '  void tipe;',
  TES
);
sabotase(
  'kategori kosong menyatu dengan kategori lain — tidak akan pernah dibetulkan',
  EKS,
  '        kategori: teks(p?.category) || TANPA_KATEGORI,',
  "        kategori: teks(p?.category) || '',",
  TES
);
sabotase(
  'rekap berhenti menghitung yang belum ada HPP',
  EKS,
  '    if (angkaAtauNull(hpp instanceof Map ? hpp.get(p?.id) : null) === null) g.tanpaHpp++;',
  '    void g;',
  TES
);
// `/…/g`: `numeric: true` muncul di DELAPAN tempat. Mematikan satu saja tidak
// membuktikan tujuh lainnya dijaga.
sabotase(
  'seluruh kolom nominal jadi TEKS — SUM-nya nol di Excel',
  EKS,
  /numeric: true/g,
  'numeric: false',
  AUDIT
);

console.log('\nSABOTASE LAYAR:');

sabotase('tombol Export Excel dihapus', PAGE, '<button id="btn-export-product">⇩ Export Excel</button>', '', AUDIT);
sabotase(
  'layar tidak lagi mengirim saringan nama',
  PAGE,
  "          nama: content.querySelector('#cari-produk')?.value ?? '',",
  "          nama: '',",
  AUDIT
);
sabotase(
  'layar tidak lagi mengirim saringan kategori',
  PAGE,
  "          kategori: content.querySelector('#kat-produk')?.value ?? '',",
  "          kategori: '',",
  AUDIT
);
sabotase(
  'tombolnya tidak dikunci — ditekan dua kali menulis dua berkas sekaligus',
  PAGE,
  '    sekaliJalan(async () => {\n      const b = susunEksporProduk({',
  '    (async () => {\n      const b = susunEksporProduk({',
  AUDIT
);
sabotase(
  'berkas kosong tetap diunduh — orangnya mengira ekspornya yang rusak',
  PAGE,
  "      if (!b.rincian.length) return toast('Tidak ada produk yang cocok dengan saringan ini.', 'info');",
  '',
  AUDIT
);
sabotase(
  'ekspornya disusun sendiri di layar, bukan lewat modul murni',
  PAGE,
  '      const b = susunEksporProduk({',
  '      const b = ({',
  AUDIT
);

console.log('');
if (gagal === 0) console.log('Semua sabotase ekspor produk tertangkap. ✅');
else console.error(`${gagal} sabotase LOLOS.`);
process.exit(gagal === 0 ? 0 : 1);
