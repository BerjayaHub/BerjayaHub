/**
 * SABOTASE: master supplier ESB.
 *
 * Yang dijaga: nama KANONIK yang berangkat, nota bersupplier tak dikenal
 * tertahan, daftar kosong tidak menahan apa pun, dan staff tidak terkunci.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AKAR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const P = (rel) => path.join(AKAR, rel);

const MIG = 'supabase/migrations/0144_master_supplier_esb.sql';
const MURNI = 'js/modules/inventory/cocok-supplier.js';
const PUR = 'js/modules/inventory/esb-purchase.js';
const ADM = 'js/modules/inventory/esb.admin.js';
const NOTA = 'js/modules/inventory/nota-staff.js';

const asli = new Map();
for (const rel of [MIG, MURNI, PUR, ADM, NOTA]) asli.set(rel, fs.readFileSync(P(rel), 'utf8'));

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

const TES_DB = 'tools/test-migrasi-0144.mjs';
const TES = 'tools/test-cocok-supplier.mjs';
const AUDIT = 'tools/audit-master-supplier.cjs';

console.log('SABOTASE MIGRATION:');

// Memperlebar `check` berarti mengetik ulang seluruh daftarnya — dan satu jenis
// yang tertinggal menutup seluruh pemetaan jenis itu, diam-diam.
sabotase(
  "jenis 'coa' hilang saat check ditulis ulang — seluruh pemetaan COA jadi mustahil disimpan",
  MIG,
  "  check (jenis in ('branch', 'location', 'unit', 'item', 'payment_method', 'coa', 'supplier'));\n\n-- ---------------------------------------------------------\n-- (2) Pemetaan boleh berjenis supplier.",
  "  check (jenis in ('branch', 'location', 'unit', 'item', 'payment_method', 'supplier'));\n\n-- ---------------------------------------------------------\n-- (2) Pemetaan boleh berjenis supplier.",
  TES_DB
);
sabotase(
  "jenis 'supplier' tidak ikut masuk ke esb_map — ejaan lama tidak punya tempat untuk dibereskan",
  MIG,
  "alter table esb_map\n  add constraint esb_map_jenis_check\n  check (jenis in ('branch', 'location', 'unit', 'item', 'payment_method', 'coa', 'supplier'));",
  "alter table esb_map\n  add constraint esb_map_jenis_check\n  check (jenis in ('branch', 'location', 'unit', 'item', 'payment_method', 'coa'));",
  TES_DB
);
sabotase(
  'check-nya dilonggarkan sepenuhnya — salah ketik jenis tersimpan diam-diam',
  MIG,
  "alter table esb_master\n  add constraint esb_master_jenis_check\n  check (jenis in ('branch', 'location', 'unit', 'item', 'payment_method', 'coa', 'supplier'));",
  'alter table esb_master\n  add constraint esb_master_jenis_check\n  check (jenis is not null);',
  TES_DB
);
sabotase(
  'nota yang DIBATALKAN ikut terhitung — ejaannya tidak akan pernah diekspor siapa pun',
  MIG,
  "     and g.status = 'aktif'\n",
  '',
  TES_DB
);
sabotase(
  'spasi tepi tidak dirapikan — "Pasar" dan "Pasar " jadi dua baris yang terlihat identik',
  MIG,
  '  select btrim(g.supplier) as nama,',
  '  select g.supplier as nama,',
  TES_DB
);
sabotase(
  'yang belum diekspor tidak dihitung terpisah — yang menahan 40 nota terlihat sama dengan yang menahan nol',
  MIG,
  '         count(*) filter (where g.esb_exported_at is null) as belum_ekspor',
  '         0::bigint as belum_ekspor',
  TES_DB
);
sabotase(
  'nama constraint lama DITEBAK, bukan dicari di katalog',
  MIG,
  '  select conname into v_nama from pg_constraint',
  "  select 'esb_master_jenis_check'::text into v_nama from pg_constraint",
  AUDIT
);

// INI sabotase terpenting di berkas ini: ia memulihkan keadaan yang membuat
// seluruh fitur tidak berguna bagi orang yang dituju, TANPA satu pun error.
sabotase(
  'izin baca untuk staff dicabut — dropdown supplier selalu kosong di layar staff, dan tidak ada error di mana pun',
  MIG,
  'create policy esb_master_baca_anggota on esb_master\n  for select to authenticated\n  using (has_bu_scope(auth.uid(), business_unit_id));',
  '',
  TES_DB
);
sabotase(
  'izin bacanya jadi `for all` — staff bisa mengubah daftar induknya sendiri',
  MIG,
  '  for select to authenticated\n  using (has_bu_scope(auth.uid(), business_unit_id));',
  '  for all to authenticated\n  using (has_bu_scope(auth.uid(), business_unit_id))\n  with check (has_bu_scope(auth.uid(), business_unit_id));',
  TES_DB
);
sabotase(
  'izin bacanya dilonggarkan lintas BU — daftar supplier BU lain ikut terlihat',
  MIG,
  '  using (has_bu_scope(auth.uid(), business_unit_id));',
  '  using (true);',
  TES_DB
);

console.log('\nSABOTASE PENCOCOKAN:');

// INI inti perubahannya: yang dikirim nama DAFTARNYA, bukan yang diketik.
sabotase(
  'yang dikembalikan ejaan yang DIKETIK, bukan nama kanonik ESB',
  MURNI,
  "  if (diDaftar) return { keadaan: 'daftar', nama: diDaftar.nama, diketik };",
  "  if (diDaftar) return { keadaan: 'daftar', nama: diketik, diketik };",
  TES
);
sabotase(
  'normalisasinya membuang tanda baca — "PT KIMIA YASA" jadi sama dengan "CV KIMIA YASA"',
  MURNI,
  "  return teks(nama).trim().replace(/\\s+/g, ' ').toLowerCase();",
  "  return teks(nama).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();",
  AUDIT
);
sabotase(
  'spasi ganda berhenti dirapikan — "Duta  Buah" jadi supplier yang berbeda selamanya',
  MURNI,
  "  return teks(nama).trim().replace(/\\s+/g, ' ').toLowerCase();",
  '  return teks(nama).trim().toLowerCase();',
  TES
);
sabotase(
  'pemetaan ke nama yang sudah lenyap dari daftar dianggap sah — nama hantu terus dikirim ke ESB',
  MURNI,
  '    const masihAda = master?.get?.(normalNama(dipetakan));\n    if (masihAda) return { keadaan: \'dipetakan\', nama: masihAda.nama, diketik };\n    return { keadaan: \'tak-dikenal\', nama: null, diketik };',
  "    return { keadaan: 'dipetakan', nama: dipetakan, diketik };",
  TES
);
sabotase(
  'nama kembar: yang TERAKHIR menang — ejaan kanoniknya berubah tergantung urutan dari database',
  MURNI,
  '    if (!peta.has(k)) peta.set(k, { nama, kode: teks(m?.kode).trim() });',
  '    peta.set(k, { nama, kode: teks(m?.kode).trim() });',
  TES
);
sabotase(
  'supplier kosong tidak dibedakan dari yang tidak dikenal',
  MURNI,
  "  if (!diketik) return { keadaan: 'kosong', nama: null, diketik: '' };",
  "  if (!diketik) return { keadaan: 'tak-dikenal', nama: null, diketik: '' };",
  TES
);
sabotase(
  'baris berjenis lain ikut masuk ke daftar supplier — nama produk & cabang jadi "supplier yang sah"',
  MURNI,
  "    if (teks(m?.jenis) !== 'supplier') continue;",
  '    if (false) continue;',
  TES
);
sabotase(
  'yang sudah dipetakan ikut muncul lagi di daftar yang perlu dibereskan',
  MURNI,
  "    .filter((t) => !supplierSiap(t.hasil) && t.hasil.keadaan !== 'kosong')",
  "    .filter((t) => t.hasil.keadaan !== 'kosong')",
  TES
);
sabotase(
  'urutannya mengabaikan yang benar-benar menghambat',
  MURNI,
  '        Number(b.belum_ekspor ?? 0) - Number(a.belum_ekspor ?? 0) ||\n',
  '',
  TES
);

console.log('\nSABOTASE EKSPOR:');

sabotase(
  'sel Supplier kembali diisi ejaan yang diketik — berkasnya terunduh rapi dan ditolak ESB',
  PUR,
  "        supplier ?? '',",
  '        String(n.supplier ?? ""),',
  AUDIT
);
sabotase(
  'nota bersupplier tak dikenal tetap berangkat — persis keadaan sebelum 0144',
  PUR,
  'const kepalaBermasalah = tanggal === null || !supplier ||',
  'const kepalaBermasalah = tanggal === null ||',
  TES
);
sabotase(
  'alasannya tidak dicatat — notanya tertahan tanpa ada yang tahu kenapa',
  PUR,
  "    if (adaMasterSupplier && !supplierSiap(cocokSup)) catat('supplier', n.supplier, kode);",
  '    if (false) { /* diam saja */ }',
  TES
);
// Kelonggaran yang SENGAJA ada. Mencabutnya membuat BU yang belum sempat
// mengimpor daftar kehilangan seluruh notanya sekaligus.
sabotase(
  'daftar induk yang masih kosong ikut menahan SEMUA nota',
  PUR,
  '    const adaMasterSupplier = masterSupplier?.size > 0;',
  '    const adaMasterSupplier = true;',
  TES
);
sabotase(
  'supplier dicabut dari JENIS_PETA — ejaan lama tidak punya tempat untuk dibereskan',
  PUR,
  "export const JENIS_PETA = ['branch', 'location', 'payment_method', 'coa', 'unit', 'item', 'supplier'];",
  "export const JENIS_PETA = ['branch', 'location', 'payment_method', 'coa', 'unit', 'item'];",
  TES
);
sabotase(
  'kunci pemetaan kembali memakai aturan normalisasi sendiri — dua aturan untuk satu pekerjaan',
  PUR,
  '    const k = normalNama(b?.kunci);',
  '    const k = teks(b?.kunci).toLowerCase();',
  TES
);

console.log('\nSABOTASE HARGA:');

sabotase(
  'harga kembali dikirim mentah — ESB menolak "price cannot have more than 4 decimal places"',
  PUR,
  '      const perSatuan = bulatkanHarga(angka(it.unit_cost));',
  '      const perSatuan = angka(it.unit_cost);',
  TES
);
sabotase(
  'batasnya dilonggarkan jadi 6 desimal — tetap ditolak ESB, dan tidak ada yang tahu kenapa',
  PUR,
  'export const DESIMAL_HARGA_MAKS = 4;',
  'export const DESIMAL_HARGA_MAKS = 6;',
  TES
);
// "Belum tahu harganya" dan "gratis" adalah dua hal yang berbeda, dan yang
// kedua ikut masuk ke biaya rata-rata bahan.
sabotase(
  'harga yang belum diisi dibulatkan jadi 0 — notanya berangkat dengan harga gratis',
  PUR,
  "  if (v === null || v === undefined || v === '') return null;\n  const n = Number(v);\n  if (!Number.isFinite(n)) return null;\n  return Number(n.toFixed(DESIMAL_HARGA_MAKS));",
  '  return Number(Number(v).toFixed(DESIMAL_HARGA_MAKS));',
  TES
);

console.log('\nSABOTASE IMPOR & LAYAR:');

sabotase(
  'Master Supplier hilang dari dropdown impor — daftarnya tidak bisa dimasukkan dari mana pun',
  ADM,
  '<option value="supplier">Master Supplier</option>',
  '',
  AUDIT
);
sabotase(
  'bacaMasterEsb tidak mengenal kolom Supplier Name',
  ADM,
  "    supplier: ['Supplier Name']",
  "    supplier: ['Nama Supplier']",
  AUDIT
);
sabotase(
  'daftar induk supplier tidak diberikan ke ekspor — pemeriksaannya tidak pernah menyala',
  ADM,
  'masterSupplier: petaSupplier(master)',
  'masterSupplier: new Map()',
  AUDIT
);
sabotase(
  'kelompok Supplier memuat SELURUH nama yang pernah dipakai — yang bermasalah tenggelam',
  ADM,
  '!m.has(normalNama(nama))',
  'true',
  AUDIT
);
sabotase(
  'staff DIPAKSA memilih dari daftar — pembelian mendadak jam 9 malam tidak bisa dicatat',
  NOTA,
  '                  allowCreate: true',
  '                  allowCreate: false',
  AUDIT
);
sabotase(
  'nama supplier dibaca langsung dari #nota-supplier — Simpan Nota mati total saat kotaknya search-select',
  NOTA,
  '          supplier: bacaSupplier(),',
  "          supplier: wadah.querySelector('#nota-supplier').value,",
  AUDIT
);

console.log('');
if (gagal === 0) console.log('Semua sabotase master supplier tertangkap. ✅');
else console.error(`${gagal} sabotase LOLOS.`);
process.exit(gagal === 0 ? 0 : 1);
