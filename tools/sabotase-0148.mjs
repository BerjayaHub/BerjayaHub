/**
 * SABOTASE: kode SKU produk.
 *
 * Dua kerusakan paling mahal di fitur ini tidak melempar apa pun:
 *
 *   - sel kosong yang jadi perintah menghapus: unggahan berikutnya membuang
 *     ratusan kode yang sudah diisi tangan, dan yang mengunggahnya melihat
 *     "berhasil";
 *   - pencocokan lewat nama: satu produk yang namanya dibetulkan di antara
 *     unduh dan unggah mendapat kode milik produk lain, lalu pembelian
 *     tercatat atas barang yang salah di ESB.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AKAR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const P = (rel) => path.join(AKAR, rel);

const MIG = 'supabase/migrations/0148_sku_produk.sql';
const MURNI = 'js/modules/product/sku-template.js';
const SVC = 'js/modules/product/product.service.js';
const HAL = 'js/modules/product/product.admin.page.js';
const ESB = 'js/modules/inventory/esb.admin.js';

const asli = new Map();
for (const rel of [MIG, MURNI, SVC, HAL, ESB]) asli.set(rel, fs.readFileSync(P(rel), 'utf8'));

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
  if (typeof dari === 'string' && isi.split(dari).length > 2) {
    gagal++;
    console.error(`❌ POLANYA MUNCUL >1 KALI: ${nama} di ${rel} — sabotasenya cuma mengenai yang pertama.`);
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

const PG = 'tools/test-migrasi-0148.mjs';
const TES = 'tools/test-sku-template.mjs';
const AUDIT = 'tools/audit-sku-produk.cjs';

console.log('SABOTASE "SEL KOSONG" — yang membuang pekerjaan diam-diam:');

sabotase(
  'sel kosong jadi perintah MENGHAPUS kode di database',
  MIG,
  "     where coalesce(btrim(x->>'sku'), '') <> ''",
  '     where true',
  PG
);
sabotase(
  'modul murninya ikut mengirim baris yang dikosongkan',
  MURNI,
  '    if (!sku) {\n      kosong += 1;\n      continue;\n    }',
  '    if (!sku) kosong += 1;',
  TES
);

console.log('\nSABOTASE PENCOCOKANNYA:');

sabotase(
  'dicocokkan lewat NAMA — kode mendarat di produk yang salah begitu namanya dibetulkan',
  MURNI,
  '    const p = peta.get(b.id);',
  '    const p = [...peta.values()].find((x) => x.name === b.id);',
  TES
);
sabotase(
  'posisi kolom ID ditulis sebagai angka — kolom yang ditambah membuatnya menunjuk sel yang salah',
  MURNI,
  "export const KOL_ID = KOLOM_SKU.indexOf('ID (jangan diubah)');",
  'export const KOL_ID = 0;',
  AUDIT
);
// Percobaan pertama memakai `const iHeader = 0 || isi.findIndex(` — dan itu
// BUKAN sabotase sama sekali: `0 || x` bernilai `x`. Pemeriksanya tetap hijau
// karena tidak ada yang rusak, bukan karena ia lolos. Sabotase yang tidak
// merusak apa pun adalah bukti palsu, ke arah yang paling menenangkan.
sabotase(
  'baris header diasumsikan di baris pertama — baris judul tambahan menggeser seluruh datanya',
  MURNI,
  '  const iHeader = isi.findIndex(',
  '  const iHeader = isi.length ? 0 : -1;\n  const _abai = isi.findIndex(',
  TES
);
sabotase(
  'kolomnya dibaca lewat posisi tetap, bukan lewat judulnya',
  MURNI,
  '  const cId = header.indexOf(KOLOM_SKU[KOL_ID]);',
  '  const cId = KOL_ID;',
  TES
);
sabotase(
  'baris tanpa ID hilang tanpa jejak — orang mengira produk barunya ikut terdaftar',
  MURNI,
  '      if (sku) tanpaId += 1;',
  '      void sku;',
  TES
);

console.log('\nSABOTASE YANG DIKIRIM:');

sabotase(
  'seluruh baris ikut dikirim — 647 updated_at berubah tanpa ada yang berubah',
  MURNI,
  '    if (teks(p.sku) === sku) {\n      sama += 1;\n      continue;\n    }',
  '    if (false) {\n      sama += 1;\n      continue;\n    }',
  TES
);
sabotase(
  'baris yang produknya sudah tidak ada ditelan, bukan dilaporkan',
  MURNI,
  '      asing.push(b.id);\n      continue;',
  '      continue;',
  TES
);
sabotase(
  'kode kembar diteruskan ke database — 23505 membatalkan 646 baris lain',
  MURNI,
  '    if (bentrok.length > 1) {',
  '    if (false) {',
  TES
);
sabotase(
  'laporan kode kembar dikumpulkan lewat kalimatnya — satu bentrokan jadi dua laporan',
  MURNI,
  '      if (!dilapor.has(k)) {',
  '      if (true) {',
  AUDIT
);
sabotase(
  'menu ikut di template — ratusan baris yang kodenya tidak dipakai di mana pun',
  MURNI,
  "    (p) => p && p.id && p.product_type !== 'finished'",
  '    (p) => p && p.id',
  TES
);

console.log('\nSABOTASE MIGRATION 0148:');

// Diarahkan ke AUDIT, bukan ke tes Postgres — dan alasannya ditulis terus
// terang: mencabut `where sku is not null` TIDAK merusak apa pun yang bisa
// diamati. Postgres menganggap tiap NULL berbeda, jadi ratusan produk yang
// belum berkode tetap lolos. Yang hilang cuma ukuran indeksnya, dan ukuran
// tidak bisa dibuktikan sebuah tes perilaku.
sabotase(
  'indeks uniknya tidak lagi parsial — memuat 647 baris padahal belasan yang berisi',
  MIG,
  '  on products (business_unit_id, lower(btrim(sku)))\n  where sku is not null;',
  '  on products (business_unit_id, lower(btrim(sku)));',
  AUDIT
);
sabotase(
  'uniknya jadi peka huruf besar-kecil — dua produk berkode sama lolos',
  MIG,
  '  on products (business_unit_id, lower(btrim(sku)))',
  '  on products (business_unit_id, sku)',
  PG
);
sabotase(
  'uniknya lintas BU — dua perusahaan dengan daftar ESB berbeda saling menghalangi',
  MIG,
  '  on products (business_unit_id, lower(btrim(sku)))',
  '  on products (lower(btrim(sku)))',
  PG
);
sabotase(
  'string kosong tidak dirapikan jadi null',
  MIG,
  "update products set sku = null where sku is not null and btrim(sku) = '';",
  '',
  PG
);
sabotase(
  'siapa pun bisa mengisi kode SKU BU mana pun — fungsinya security definer',
  MIG,
  '  if not is_bu_admin(v_uid, p_bu) then',
  '  if false then',
  PG
);
sabotase(
  'bentrokan diserahkan ke indeks uniknya — 23505 tanpa menyebut produk mana',
  MIG,
  '    if v_pemilik is not null then',
  '    if false then',
  PG
);
sabotase(
  'produk dihitung bentrok dengan dirinya sendiri — tidak ada kode yang bisa disimpan ulang',
  MIG,
  '       and p.id <> r.id\n',
  '',
  PG
);
sabotase(
  'baris yang nilainya sudah sama ikut ditulis ulang',
  MIG,
  '       and (p.sku is distinct from r.sku);',
  ';',
  PG
);
// Lapis KEDUA: pencarian nama di atasnya sudah menolak id milik BU lain, jadi
// mencabutnya tidak membuka lubang yang bisa ditunjukkan sebuah tes. Auditnya
// yang menjaga — karena kedua penjaganya bisa dicabut satu per satu, dan yang
// mencabut yang pertama tidak punya alasan menduga yang kedua menanggungnya.
sabotase(
  'lapis kedua pembatas BU pada update-nya dicabut',
  MIG,
  '     where p.id = r.id\n       and p.business_unit_id = p_bu',
  '     where p.id = r.id',
  AUDIT
);
sabotase(
  'produk asing tidak dilaporkan — baris yang tidak tersimpan menghilang tanpa jejak',
  MIG,
  '      v_asing := v_asing || r.id::text;\n      continue;',
  '      continue;',
  PG
);

console.log('\nSABOTASE JALUR LAYANAN & LAYARNYA:');

sabotase(
  'kolom sku tidak diminta — kodenya ada di database tapi tidak pernah sampai ke layar',
  SVC,
  '    return await ambil(`${KOLOM}, sku`);',
  '    return await ambil(KOLOM);',
  AUDIT
);
sabotase(
  'galat izin & jaringan ikut ditelan, menyamar jadi "0148 belum dijalankan"',
  SVC,
  "    if (!/\\bsku\\b/.test(String(e?.message ?? ''))) throw e;",
  '    void e;',
  AUDIT
);
sabotase(
  'jalan mundurnya dicabut — satu kolom baru mematikan hampir seluruh aplikasi',
  SVC,
  '    return await ambil(KOLOM);\n  }\n}',
  '    throw e;\n  }\n}',
  AUDIT
);
sabotase(
  'tombol unduh template dicabut dari layar',
  HAL,
  '<button id="btn-tpl-sku"',
  '<button id="btn-tpl-sku-nonaktif"',
  AUDIT
);
sabotase(
  'tombol unggah tidak disambungkan ke apa pun',
  HAL,
  "  document.getElementById('btn-unggah-sku').addEventListener('click', () =>",
  '  void ((() =>',
  AUDIT
);
sabotase(
  'template ditulis dengan baris judul — datanya bergeser saat dibaca kembali',
  HAL,
  '  const ws = XLSX.utils.aoa_to_sheet([KOLOM_SKU, ...baris]);',
  "  const ws = XLSX.utils.aoa_to_sheet([['Daftar Kode SKU'], [], KOLOM_SKU, ...baris]);",
  AUDIT
);
sabotase(
  'unggahan langsung disimpan tanpa ringkasan — salah berkas baru ketahuan sesudahnya',
  HAL,
  '  const ok = await confirmDialog({\n    title: `Simpan ${hasil.ubah.length} kode SKU?`,',
  '  const ok = true;\n  await Promise.resolve({\n    title: `Simpan ${hasil.ubah.length} kode SKU?`,',
  AUDIT
);
sabotase(
  'hasil dari database tidak dibandingkan — "0 tersimpan" dilaporkan sebagai berhasil',
  HAL,
  '    const sisa = hasil.ubah.length - r.diubah;',
  '    const sisa = 0;',
  AUDIT
);

console.log('\nSABOTASE ALASAN FITUR INI DIBUAT:');

sabotase(
  'pencocokan ESB berhenti memakai kode — jembatannya kembali cuma nama',
  ESB,
  '      const kodeEsb = new Map(',
  '      const kodeEsbNonaktif = new Map(',
  AUDIT
);
sabotase(
  'kode dipakai untuk semua jenis — lima jenis lain tidak punya kode di Berjaya Hub',
  ESB,
  "          const sku = j === 'item' ? namaKeSku.get(normal(k)) : null;",
  '          const sku = namaKeSku.get(normal(k));',
  AUDIT
);
sabotase(
  'nama kembali didahulukan dari kode — pemetaan yang putus tidak tertolong',
  ESB,
  '          const lewatSku = sku ? kodeEsb.get(sku) : null;',
  '          const lewatSku = null;\n          void sku;',
  AUDIT
);

console.log('');
if (gagal === 0) console.log('Semua sabotase kode SKU tertangkap. ✅');
else console.error(`${gagal} sabotase LOLOS.`);
process.exit(gagal === 0 ? 0 : 1);
