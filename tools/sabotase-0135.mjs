/**
 * SABOTASE 0135 — waste/spoil wajib berfoto.
 *
 * Yang dijaga bukan "fiturnya jalan", melainkan bahwa waste TIDAK PERNAH bisa
 * tersimpan tanpa foto — termasuk dari HP yang aplikasinya tertinggal versi.
 * Kegagalannya diam total: stok tetap berkurang, laporan tetap rapi, dan yang
 * hilang cuma satu-satunya bukti yang tersisa sesudah barangnya dibuang.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AKAR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const P = (rel) => path.join(AKAR, rel);

const MIG = 'supabase/migrations/0135_waste_foto_wajib.sql';
const MIG36 = 'supabase/migrations/0136_rekap_waste_ikut_yang_lama.sql';
const MURNI = 'js/modules/inventory/laporan-waste.js';
const HAL = 'js/modules/inventory/inventory.page.js';
const ADM = 'js/modules/inventory/waste.admin.js';
const SVC = 'js/modules/inventory/waste.service.js';
const TAB = 'js/modules/inventory/inventory.admin.page.js';

const asli = new Map();
for (const rel of [MIG, MIG36, MURNI, HAL, ADM, SVC, TAB]) asli.set(rel, fs.readFileSync(P(rel), 'utf8'));

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

const TES = 'tools/test-migrasi-0135.mjs';
const TES_MURNI = 'tools/test-laporan-waste.mjs';
const AUDIT = 'tools/audit-waste-foto.cjs';

console.log('SABOTASE KEWAJIBAN FOTO (tiga lapisnya):');

sabotase(
  'LAPIS 1: kolom foto boleh string kosong lagi',
  MIG,
  "  photo_path text not null check (btrim(photo_path) <> ''),",
  '  photo_path text,',
  TES
);
sabotase(
  'LAPIS 2: RPC berhenti memeriksa fotonya sendiri',
  MIG,
  "  if v_foto is null then\n    raise exception 'Foto wajib diisi. Ambil foto bahan yang rusak atau menu yang terbuang dulu, baru simpan.';\n  end if;",
  '',
  TES
);
sabotase(
  'LAPIS 2: spasi lolos jadi foto yang sah',
  MIG,
  "  v_foto text := nullif(btrim(coalesce(p_photo, '')), '');",
  '  v_foto text := p_photo;',
  TES
);
sabotase(
  'LAPIS 3: trigger dilepas — insert langsung tanpa foto hidup lagi',
  MIG,
  'create trigger trg_waste_wajib_dokumen',
  'create trigger trg_waste_nonaktif_0135',
  TES
);
sabotase(
  'LAPIS 3: syarat triggernya dilonggarkan',
  MIG,
  "  if new.movement_type = 'waste' and new.waste_run_id is null then",
  '  if false then',
  TES
);
sabotase(
  'LAPIS 3: record_menu_waste lama dihidupkan kembali',
  MIG,
  "  raise exception 'Pencatatan waste sekarang wajib menyertakan foto. Tutup aplikasi ini lalu buka lagi supaya versinya diperbarui, kemudian catat ulang lewat tombol Waste / Spoil.'\n    using errcode = 'check_violation';",
  '  return;',
  TES
);

console.log('\nSABOTASE ANGKA & STOK:');

sabotase(
  'waste menu mencatat menunya, bukan bahan resepnya',
  MIG,
  '      values (v_id, r.ingredient_product_id, r.qty * p_qty / v_recipe.yield_qty)',
  '      values (v_id, p_product, r.qty * p_qty / v_recipe.yield_qty)',
  TES
);
sabotase(
  'porsi resepnya diabaikan — 2 porsi memotong sebanyak 1 porsi',
  MIG,
  '      values (v_id, r.ingredient_product_id, r.qty * p_qty / v_recipe.yield_qty)',
  '      values (v_id, r.ingredient_product_id, r.qty / v_recipe.yield_qty)',
  TES
);
sabotase(
  'stoknya BERTAMBAH, bukan berkurang',
  MIG,
  "    values (v_bu, p_outlet, p_product, 'waste', -p_qty,",
  "    values (v_bu, p_outlet, p_product, 'waste', p_qty,",
  TES
);
sabotase(
  'waste ikut menulis unit_cost — biaya rata-rata bahan tercemar',
  MIG,
  "    insert into stock_movements (business_unit_id, outlet_id, product_id, movement_type, qty_delta, notes, created_by, waste_run_id)\n    values (v_bu, p_outlet, p_product, 'waste', -p_qty,",
  "    insert into stock_movements (business_unit_id, outlet_id, product_id, movement_type, qty_delta, unit_cost, notes, created_by, waste_run_id)\n    values (v_bu, p_outlet, p_product, 'waste', -p_qty, 1,",
  AUDIT
);
sabotase(
  'tanggal rekapnya kembali UTC — waste tengah malam pindah hari',
  MIG,
  "         (w.created_at at time zone 'Asia/Jakarta')::date as tanggal,",
  '         w.created_at::date as tanggal,',
  AUDIT
);
sabotase('bucket fotonya dibuat publik', MIG, "values ('waste-photos', 'waste-photos', false)", "values ('waste-photos', 'waste-photos', true)", TES);
sabotase(
  'wewenang outlet tidak diperiksa',
  MIG,
  '  if not has_outlet_scope(v_uid, p_outlet) then',
  '  if false then',
  TES
);

console.log('\nSABOTASE 0136 — catatan lama harus tetap terlihat:');

const TES36 = 'tools/test-migrasi-0136.mjs';

sabotase(
  'gabungan catatan lama dicabut — tab rekap kosong lagi sementara Riwayat penuh',
  MIG36,
  '  union all',
  '  ;-- union all',
  TES36
);
sabotase(
  'penyaring `waste_run_id is null` hilang — kejadian baru muncul dua kali',
  MIG36,
  "   where sm.movement_type = 'waste'\n     and sm.waste_run_id is null;",
  "   where sm.movement_type = 'waste';",
  TES36
);
sabotase(
  'jenis baris lama tidak dipulihkan — semuanya jadi "bahan mentah"',
  MIG36,
  "         case when sm.notes like 'Waste menu: %' then 'menu' else 'spoil' end as jenis,",
  "         'spoil' as jenis,",
  TES36
);
sabotase(
  'nama menu lama tidak dipulihkan dari catatannya',
  MIG36,
  "             then coalesce(nullif(substring(sm.notes from '^Waste menu: (.+) x[0-9]'), ''), '(menu tidak tercatat)')",
  "             then '(menu tidak tercatat)'",
  TES36
);
sabotase(
  'baris satu waste menu lama tidak dikelompokkan — jumlah kejadian berlipat',
  MIG36,
  "         md5(sm.outlet_id::text || sm.created_at::text || coalesce(sm.notes, ''))::uuid as waste_id,",
  '         sm.id as waste_id,',
  TES36
);
sabotase(
  'penanda `lama` dihapus — sel foto kosong terbaca sebagai staff yang lupa memfoto',
  MIG36,
  '         true        as lama',
  '         false       as lama',
  TES36
);
sabotase(
  'jumlah yang terbuang jadi negatif di rekap',
  MIG36,
  '         abs(sm.qty_delta) as bahan_qty,',
  '         sm.qty_delta as bahan_qty,',
  TES36
);
sabotase(
  'jalan cadangan saat kolom `lama` belum ada dicabut',
  SVC,
  '    return await ambil(KOLOM_DASAR);',
  '    throw e;',
  AUDIT
);

console.log('\nSABOTASE ATURAN REKAP:');

sabotase(
  'keterangan berhenti membedakan waste menu dari spoil',
  MURNI,
  "  if (baris?.jenis === JENIS_MENU) {",
  '  if (false) {',
  TES_MURNI
);
sabotase(
  'kunci biaya kehilangan outletnya — harga outlet lain terpakai',
  MURNI,
  '  return `${teks(outletId)}|${teks(productId)}`;',
  '  return `${teks(productId)}`;',
  TES_MURNI
);
sabotase(
  'nilai yang belum ada ditulis Rp0, bukan "-"',
  MURNI,
  "    r.nilai === null ? '-' : formatRupiah(r.nilai),",
  '    formatRupiah(r.nilai),',
  TES_MURNI
);
sabotase('baris tanpa biaya berhenti dihitung', MURNI, '    if (nilai === null) tanpaNilai++;', '    if (false) tanpaNilai++;', TES_MURNI);
sabotase(
  'kolom Foto berhenti ditandai — gambarnya tidak jadi disisipkan',
  MURNI,
  "  { header: 'Foto', width: 1.6, foto: true }",
  "  { header: 'Foto', width: 1.6 }",
  TES_MURNI
);

console.log('\nSABOTASE LAYAR:');

sabotase('field foto tidak lagi wajib di dialognya', HAL, "          type: 'photo',\n          required: true,", "          type: 'photo',", AUDIT);
sabotase(
  'layar kembali ke jalur lama tanpa foto',
  HAL,
  '      await catatWaste({ outletId: state.outletId, jenis, productId, qty, photoPath, notes: v.notes });',
  "      await recordMenuWaste({ businessUnitId, outletId: state.outletId, productId, qty, notes: v.notes });",
  AUDIT
);
sabotase(
  'foto yang gagal dimuat dikosongkan — terbaca sebagai waste yang tidak difoto',
  ADM,
  "            baris[KOLOM_FOTO] = dataUrl ?? 'GAGAL';",
  '            baris[KOLOM_FOTO] = dataUrl;',
  AUDIT
);
sabotase('ekspornya berhenti menyisipkan foto', ADM, 'await exportTableXLSXFoto({', 'await exportTanpaFoto({', AUDIT);
sabotase('tab Waste / Spoil dihapus dari Admin Portal', TAB, "  { key: 'waste', label: 'Waste / Spoil' },", '', AUDIT);
sabotase('foto tidak dikecilkan sebelum diunggah', SVC, 'compressImage(file, { preset: ', 'Promise.resolve(file, { preset: ', AUDIT);
// Polanya menyasar `rekapWaste` saja. `getBiayaRataBu` juga memakai
// `ambilSemua`, tapi bentuknya tanpa `{` — jadi pola ini tidak bisa salah
// mengenainya, dan auditnya memang sudah dipersempit ke blok `rekapWaste`.
sabotase('rekapnya terpotong di 1000 baris', SVC, '    ambilSemua((dari, sampai) => {', '    (async (dari, sampai) => {', AUDIT);

console.log('');
if (gagal === 0) console.log('Semua sabotase 0135 tertangkap. ✅');
else console.error(`${gagal} sabotase LOLOS.`);
process.exit(gagal === 0 ? 0 : 1);
