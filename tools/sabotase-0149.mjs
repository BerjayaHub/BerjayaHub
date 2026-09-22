/**
 * SABOTASE: ekspor kas keluar ke ESB Disbursement.
 *
 * Kerusakan paling mahal di fitur ini tidak melempar apa pun — ia menghasilkan
 * berkas yang DITERIMA ESB dengan tenang:
 *
 *   - pembayaran nota yang ikut terkirim: pengeluaran yang SAMA tercatat dua
 *     kali di ESB, sekali sebagai Simple Purchase dan sekali di sini;
 *   - Supplier yang terhapus diam-diam saat entrinya dikoreksi, lalu entrinya
 *     tertahan dengan alasan yang terlihat datang entah dari mana.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AKAR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const P = (rel) => path.join(AKAR, rel);

const MIG = 'supabase/migrations/0149_disbursement_kas.sql';
const MURNI = 'js/modules/inventory/esb-disbursement.js';
const TGL = 'js/modules/inventory/tanggal-excel.js';
const ESVC = 'js/modules/inventory/esb.service.js';
const CSVC = 'js/modules/cash/cash.service.js';
const EADM = 'js/modules/inventory/esb.admin.js';
const CPAGE = 'js/modules/cash/cash.page.js';
const CADM = 'js/modules/cash/cash.admin.page.js';
const MIG150 = 'supabase/migrations/0150_disbursement_lewat_outlet.sql';
const JENIS = 'js/modules/cash/jenis-pengeluaran.js';
const KODE = 'js/modules/cash/kode-kas.js';

const asli = new Map();
for (const rel of [MIG, MURNI, TGL, ESVC, CSVC, EADM, CPAGE, CADM, MIG150, JENIS, KODE])
  asli.set(rel, fs.readFileSync(P(rel), 'utf8'));

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

const PG = 'tools/test-migrasi-0149.mjs';
const TES = 'tools/test-esb-disbursement.mjs';
const AUDIT = 'tools/audit-disbursement.cjs';
const PG150 = 'tools/test-migrasi-0150.mjs';
const TES_JENIS = 'tools/test-jenis-pengeluaran.mjs';

console.log('SABOTASE "SELAIN BAHAN" — dobel-catat yang tidak terlihat:');

// Saringannya PINDAH ke `kas_untuk_esb` (0150) — di klien ia dulu memakai
// `business_unit_id`, kolom yang selalu NULL, jadi nol baris tanpa satu pun
// galat. Sekarang sabotasenya mengenai tempat yang sungguh memutuskan.
sabotase(
  'pembayaran nota ikut terkirim — pengeluaran yang SAMA tercatat dua kali di ESB',
  MIG150,
  '    and ce.untuk_nota = false\n',
  '',
  PG150
);
sabotase(
  'koreksi otomatis nota ikut jadi dokumen pengeluaran',
  MIG150,
  '    and ce.penyesuaian_nota is null\n',
  '',
  PG150
);
sabotase(
  'entri yang sudah DICORET berangkat sebagai pengeluaran yang sah',
  MIG150,
  '    and ce.dicoret_at is null\n',
  '',
  PG150
);
sabotase(
  'kas masuk & transfer ikut jadi pengeluaran',
  MIG150,
  "  where ce.entry_type = 'out'\n    -- HANYA PENGELUARAN SELAIN BAHAN.",
  '  where true\n    -- HANYA PENGELUARAN SELAIN BAHAN.',
  PG150
);
sabotase(
  'yang sudah diekspor ditawarkan lagi — pengeluarannya tercatat dua kali',
  MIG150,
  '    and (p_termasuk_sudah_ekspor or ce.esb_exported_at is null)\n',
  '',
  PG150
);
// PENJAGA KEDUA, di `tandai_kas_esb`. Daftar yang disusun satu aturan dan
// ditandai dengan aturan lain akan menandai baris yang tidak pernah terunduh —
// dan baris itu berhenti ditawarkan selamanya.
sabotase(
  'penjaga kedua dicabut — pembayaran nota bisa ditandai walau tidak pernah terunduh',
  MIG150,
  '     and c.untuk_nota = false\n',
  '',
  PG150
);

console.log('\nSABOTASE SUMBU YANG SALAH — nol baris tanpa satu pun galat:');

// INILAH bug yang dilaporkan dari layar. `business_unit_id` DEPRECATED sejak
// 0040 dan selalu NULL; saringannya cocok dengan nol baris, dan penjaganya
// selalu menolak. Keduanya terlihat persis seperti "memang tidak ada datanya".
sabotase(
  'saringannya kembali ke business_unit_id — layar berbunyi "tidak ada kas keluar baru"',
  MIG150,
  '    and ce.dicoret_at is null\n    and o.business_unit_id = p_bu',
  '    and ce.dicoret_at is null\n    and ce.business_unit_id = p_bu',
  PG150
);
sabotase(
  'wewenang menandai kembali ke is_bu_admin(business_unit_id) — selalu menolak, diam-diam',
  MIG150,
  '     and is_admin_of_outlet(v_uid, c.outlet_id);\n  get diagnostics v_n = row_count;\n  return v_n;\nend;\n$$;\n\nrevoke all on function tandai_kas_esb',
  '     and is_bu_admin(v_uid, c.business_unit_id);\n  get diagnostics v_n = row_count;\n  return v_n;\nend;\n$$;\n\nrevoke all on function tandai_kas_esb',
  PG150
);
sabotase(
  'wewenang melihat daftarnya dicabut — siapa pun bisa membaca kas BU mana pun',
  MIG150,
  '    and is_admin_of_outlet(auth.uid(), ce.outlet_id)\n  order by ce.entry_date, ce.id;',
  '  order by ce.entry_date, ce.id;',
  PG150
);
sabotase(
  'indeksnya kembali ke kolom yang selalu NULL',
  MIG150,
  'create index if not exists idx_kas_belum_esb on cash_entries(outlet_id, entry_date)',
  'create index if not exists idx_kas_belum_esb on cash_entries(business_unit_id, entry_date)',
  PG150
);
sabotase(
  'indeks lama tidak dibuang — `create index if not exists` tidak menggantikannya',
  MIG150,
  'drop index if exists idx_kas_belum_esb;\n',
  '',
  AUDIT
);
sabotase(
  'layanannya menyusun saringannya sendiri lagi, di luar database',
  ESVC,
  "    'kas_untuk_esb',",
  "    'kas_bertanda_esb',",
  AUDIT
);

console.log('\nSABOTASE SARINGAN BAHAN / SELAIN BAHAN:');

sabotase(
  'kas masuk ikut terhitung sebagai "pengeluaran selain bahan"',
  JENIS,
  "export function selainBahan(entri) {\n  if (!entri || entri.entry_type !== 'out') return false;",
  'export function selainBahan(entri) {',
  TES_JENIS
);
sabotase(
  'penyesuaian nota tidak lagi terhitung sebagai pengeluaran bahan',
  JENIS,
  '  return entri.untuk_nota === true || (entri.penyesuaian_nota !== null && entri.penyesuaian_nota !== undefined);',
  '  return entri.untuk_nota === true;',
  TES_JENIS
);
sabotase(
  'nilai saringan yang tidak dikenal mengosongkan daftarnya — terlihat seperti "tidak ada datanya"',
  JENIS,
  '  return daftar;\n}',
  '  return [];\n}',
  TES_JENIS
);
sabotase(
  'yang dicoret ikut dijumlahkan — totalnya tidak cocok dengan saldo mana pun',
  JENIS,
  '    const hidup = !b?.dicoret_at;',
  '    const hidup = true;',
  TES_JENIS
);
sabotase(
  'saringannya digambar tapi tidak dipakai menyaring',
  CADM,
  '  rows = saringPengeluaran(rows, saringBahan);',
  '  rows = rows;',
  AUDIT
);
sabotase(
  'ringkasannya dihitung SESUDAH disaring — angkanya ikut menyusut dan kehilangan artinya',
  CADM,
  '  const rincian = ringkasPengeluaran(rows);\n  const semuaBaris = rows;\n  rows = saringPengeluaran(rows, saringBahan);',
  '  const semuaBaris = rows;\n  rows = saringPengeluaran(rows, saringBahan);\n  const rincian = ringkasPengeluaran(rows);',
  AUDIT
);
sabotase(
  'saringannya tidak menggambar ulang saat dipilih',
  CADM,
  "  content.querySelector('#cm-bahan').addEventListener('change', go);",
  "  void content.querySelector('#cm-bahan');",
  AUDIT
);

console.log('\nSABOTASE KOLOM YANG TIDAK DIMINTA — bug yang sungguh terjadi:');

// `untuk_nota` sempat tidak ikut di `select`. `untukBahan()` lalu selalu false,
// dan layar berbunyi "0 untuk bahan · 35 selain bahan" sambil menampilkan
// tautan "Pembayaran nota TRM-…" di kolom sebelahnya — layar yang membantah
// dirinya sendiri, tanpa satu pun galat.
sabotase(
  'untuk_nota dicabut dari select — SELURUH pembayaran nota terhitung "selain bahan"',
  CSVC,
  "'category_id, outlet_id, qty, unit, supplier, untuk_nota, esb_exported_at, dicoret_at, alasan_coret, diubah_at, ' +",
  "'category_id, outlet_id, qty, unit, supplier, esb_exported_at, dicoret_at, alasan_coret, diubah_at, ' +",
  AUDIT
);
sabotase(
  'daftar kolom yang dituntut dikosongkan — penjagaannya ikut hilang',
  JENIS,
  "export const KOLOM_DIBUTUHKAN = ['entry_type', 'untuk_nota', 'penyesuaian_nota', 'amount', 'dicoret_at'];",
  "export const KOLOM_DIBUTUHKAN = ['entry_type'];",
  AUDIT
);
sabotase(
  'kolom yang tidak diminta dibaca sebagai "lengkap"',
  JENIS,
  '  return KOLOM_DIBUTUHKAN.every((k) => entri[k] !== undefined);',
  '  return true;',
  TES_JENIS
);

console.log('\nSABOTASE NOMOR KAS — nomor yang tidak menunjuk ke mana pun:');

sabotase(
  'nomor kas hilang dari tabel Mutasi Kas — "KAS-7E9CF9F2" tidak bisa dicari di layar mana pun',
  CADM,
  '${esc(kodeKas(r.id))}',
  '',
  AUDIT
);
sabotase(
  'kotak cari nomornya digambar tapi tidak dipakai menyaring',
  CADM,
  '  if (cariKode.trim()) rows = rows.filter((r) => cocokKodeKas(r.id, cariKode));',
  '  void cariKode;',
  AUDIT
);
sabotase(
  'rumus nomornya disalin ke layar ESB — dua nomor berbeda untuk baris yang sama',
  ESVC,
  "import { kodeKas } from '../cash/kode-kas.js';",
  "const kodeKas = (id) => `KAS-${String(id ?? '').slice(0, 8)}`;",
  AUDIT
);
sabotase(
  'id kosong menghasilkan "KAS-" — nomor palsu yang akan dicari orang',
  KODE,
  "  if (!s) return '';",
  '  if (false) return null;',
  TES_JENIS
);
// (Sabotase "klausa pembuang awalan dicabut" DIBUANG: klausa itu tidak pernah
// mengubah satu pun jawaban — "7E9CF9F2" sudah substring dari "KAS-7E9CF9F2".
// Sabotase yang tidak merusak apa pun adalah bukti palsu; klausanya yang
// dibuang, bukan pemeriksanya yang dilonggarkan.)
sabotase(
  'pencocokannya jadi harus PERSIS — mengetik sebagian nomornya tidak ketemu',
  KODE,
  '  return kode.includes(cari);',
  '  return kode === cari;',
  TES_JENIS
);
sabotase(
  'kotak cari yang KOSONG mengosongkan tabelnya sebelum satu huruf pun diketik',
  KODE,
  '  if (!cari) return true;',
  '  if (!cari) return false;',
  TES_JENIS
);

console.log('\nSABOTASE BENTUK BERKASNYA:');

sabotase(
  'Document Date dikirim sebagai nomor seri Excel — templatenya menuntut TEKS',
  MURNI,
  '    const tanggal = tanggalTeksEsb(c.entry_date);',
  '    const tanggal = serialTanggalExcel(c.entry_date);',
  AUDIT
);
sabotase(
  'urutan hari/bulan dibalik — "01/09/2026" terbaca 9 Januari di separuh dunia',
  TGL,
  '  return `${m[3]}/${m[2]}/${m[1]}`;',
  '  return `${m[2]}/${m[3]}/${m[1]}`;',
  TES
);
// `tanggalTeksEsb` MEMINJAM penjaga `serialTanggalExcel`. Memeriksa sendiri
// dengan aturan kedua berarti dua aturan untuk satu pekerjaan — dan yang
// menyimpang meloloskan 30 Februari.
sabotase(
  'tanggal teks diperiksa dengan aturannya sendiri — 30 Februari lolos',
  TGL,
  '  const serial = serialTanggalExcel(v);',
  '  const serial = 1;',
  TES
);
sabotase(
  'Sequence dikirim sebagai angka — sel templatenya bertipe teks',
  MURNI,
  '      String(seq),',
  '      seq,',
  TES
);
sabotase(
  'satu kolom dihapus dari daftarnya — sel-selnya bergeser satu kolom ke kiri',
  MURNI,
  "  'Cost Center',\n  'Project',",
  "  'Project',",
  TES
);
sabotase(
  'kolom yang tidak punya padanan DIKARANG isinya',
  MURNI,
  "      '', // Cost Center",
  "      'CC-01', // Cost Center",
  TES
);

console.log('\nSABOTASE ARTI ANGKANYA:');

sabotase(
  'tanda minusnya ikut terkirim — pengeluaran yang MENAMBAH kas di ESB',
  MURNI,
  '    const jumlah = nominal === null ? null : bulatkanEsb(Math.abs(nominal));',
  '    const jumlah = nominal === null ? null : bulatkanEsb(nominal);',
  TES
);
sabotase(
  'Amount berangkat mentah — lebih dari 4 desimal, ESB menolak berkasnya',
  MURNI,
  '    const jumlah = nominal === null ? null : bulatkanEsb(Math.abs(nominal));',
  '    const jumlah = nominal === null ? null : Math.abs(nominal);',
  TES
);
sabotase(
  'nominal nol berangkat — dokumen pengeluaran senilai nol rupiah',
  MURNI,
  '    if (jumlah === null || jumlah <= 0) {',
  '    if (false) {',
  TES
);
sabotase(
  'tanggal yang tidak terbaca dikosongkan — ESB mengisinya dengan tanggal unggah',
  MURNI,
  '    if (tanggal === null) {',
  '    if (false) {',
  TES
);

console.log('\nSABOTASE PEMETAANNYA:');

// SUMBER COA PINDAH DI 0151 — dari kategori biaya ke outlet MILIK KANTONG.
// Sabotase yang menyebut `kategori_nama` di sini sudah tidak menunjuk ke mana
// pun; penggantinya hidup di `sabotase-0151.mjs`, bersama sabotase yang
// membuktikan kategori biaya TIDAK BOLEH kembali. Yang tinggal di sini cuma
// yang memang masih milik 0149.
sabotase(
  'pencarian COA memakai aturan normalisasi yang BERBEDA dari penyimpannya',
  MURNI,
  '      akun = peta?.coa?.get?.(normalNama(c.kantong_outlet_nama)) ?? null;',
  '      akun = peta?.coa?.get?.(teks(c.kantong_outlet_nama).toLowerCase()) ?? null;',
  AUDIT
);
sabotase(
  'entri yang COA-nya belum dipetakan berangkat dengan sel Account kosong',
  MURNI,
  "      if (!akun) {\n        catat('coa', c.kantong_outlet_nama, kode);\n        adaMasalah = true;\n      }",
  '      void akun;',
  TES
);
sabotase(
  'outlet yang belum dipetakan berangkat dengan Branch kosong',
  MURNI,
  "    if (!branch) {\n      catat('branch', c.outlet_nama, kode);\n      adaMasalah = true;\n    }",
  '    void branch;',
  TES
);
sabotase(
  'kunci COA menyusut jadi cara bayar saja — SELURUH kas keluar tertahan, tanpa cara membereskannya',
  EADM,
  '    coa: [...CARA_BAYAR, ...outlets.map((o) => o.name), ...outletKantong]',
  '    coa: [...CARA_BAYAR]',
  AUDIT
);
sabotase(
  'satu entri bermasalah menahan entri lain — padahal tiap kas keluar berdiri sendiri',
  MURNI,
  '    if (adaMasalah) continue;',
  '    if (adaMasalah) break;',
  TES
);

console.log('\nSABOTASE PAYMENT TO:');

sabotase(
  'yang berangkat ejaan yang DIKETIK, bukan nama kanonik daftarnya',
  MURNI,
  '    const supplier = adaMasterSupplier ? (supplierSiap(cocok) ? cocok.nama : null) : teks(c.supplier);',
  '    const supplier = teks(c.supplier);',
  TES
);
sabotase(
  'BU yang belum mengimpor daftar supplier kehilangan SELURUH ekspornya',
  MURNI,
  '    const adaMasterSupplier = masterSupplier?.size > 0;',
  '    const adaMasterSupplier = true;',
  TES
);
sabotase(
  'Payment To yang kosong ikut berangkat',
  MURNI,
  "    if (!supplier) {\n      catat('supplier', c.supplier, kode);\n      adaMasalah = true;\n    }",
  '    void supplier;',
  TES
);
sabotase(
  'kotak Supplier hilang dari dialog koreksi — kolomnya tidak pernah bisa dibetulkan',
  CPAGE,
  "                      name: 'supplier',\n                      label: 'Dibayar ke (supplier)',",
  "                      name: 'supplier_nonaktif',\n                      label: 'Dibayar ke (supplier)',",
  AUDIT
);
sabotase(
  'nilainya tidak dikirim dari form Kas Keluar — kotaknya digambar, isinya tidak sampai',
  CPAGE,
  '        supplier: values.supplier,\n        file: values.file',
  '        file: values.file',
  AUDIT
);
sabotase(
  'daftar supplier yang gagal dimuat mematikan SELURUH layar Kas',
  CPAGE,
  "      listEsbMaster(businessUnitId, 'supplier').catch(() => [])",
  "      listEsbMaster(businessUnitId, 'supplier')",
  AUDIT
);

console.log('\nSABOTASE BUG 0119, BENTUK KETIGA:');

// `ubah_kas` menulis PENUH. Kolom yang tidak dikirim TERHAPUS — dan yang
// menghapusnya adalah admin yang cuma membetulkan satu huruf di keterangan.
sabotase(
  'supplier tidak diteruskan saat admin mengoreksi — Payment To terhapus diam-diam',
  CADM,
  '      supplier: values.supplier ?? r.supplier ?? null,',
  '      supplier: values.supplier ?? null,',
  AUDIT
);
sabotase(
  'kolom supplier tidak ikut diambil — dialog admin mengirim undefined dan menghapusnya',
  CSVC,
  "qty, unit, supplier, untuk_nota, esb_exported_at",
  'qty, unit, untuk_nota, esb_exported_at',
  AUDIT
);
sabotase(
  'riwayat_kas_saya berhenti mengembalikan supplier — dialog koreksi menampilkannya kosong lalu MENGHAPUSNYA',
  MIG,
  '    ce.supplier,\n    ce.esb_exported_at',
  '    null::text,\n    ce.esb_exported_at',
  AUDIT
);
sabotase(
  'p_supplier tidak dikirim — PostgREST mencari tanda tangan delapan argumen yang sudah dibuang',
  CSVC,
  "      p_supplier: supplier?.trim() || null",
  '      p_supplier: supplier',
  AUDIT
);

console.log('\nSABOTASE MIGRATION 0149:');

sabotase(
  'tanda tangan 8-argumen dibiarkan hidup — Supplier yang baru dipilih lenyap diam-diam',
  MIG,
  'drop function if exists ubah_kas(uuid, numeric, uuid, uuid, text, numeric, text, date);',
  '',
  PG
);
sabotase(
  'yang sudah diekspor masih bisa dikoreksi — catatan berbeda di dua tempat, selamanya',
  MIG,
  '  if v.esb_exported_at is not null then',
  '  if false then',
  PG
);
// Menulis ulang sebuah fungsi berarti mengetik ulang SELURUH isinya — dan itu
// cara paling mudah menghapus satu penjaga tanpa sadar.
sabotase(
  'penjaga "pembayaran nota" hilang saat alasan_tolak_koreksi_kas ditulis ulang',
  MIG,
  '  select string_agg(code, \', \' order by code) into v_kode\n    from goods_receipts where payment_entry_id = p_entry;',
  '  v_kode := null;',
  AUDIT
);
sabotase(
  'penjaga "sudah dicoret" hilang saat ditulis ulang',
  MIG,
  '  if v.dicoret_at is not null then',
  '  if false then',
  AUDIT
);
sabotase(
  'kas masuk ikut menyimpan supplier — kolom yang tidak akan pernah dipakai',
  MIG,
  "         supplier = case when v_type = 'out' then v_supplier else null end,",
  '         supplier = v_supplier,',
  PG
);
sabotase(
  'jejak pengisi supplier ditulis ulang tiap koreksi — mengoreksi nominal terlihat seperti mengisi supplier',
  MIG,
  '           when v_supplier is distinct from v_lama then (case when v_supplier is null then null else v_uid end)\n           else supplier_diisi_by end,',
  '           else v_uid end,',
  PG
);
sabotase(
  'isi-mundur menyentuh entri yang sudah diekspor',
  MIG,
  '     and c.esb_exported_at is null\n     -- Wewenangnya dipinjam dari penjaga koreksi kas yang sudah ada (0141):',
  '     -- Wewenangnya dipinjam dari penjaga koreksi kas yang sudah ada (0141):',
  PG
);
sabotase(
  'isi-mundur menyentuh kas orang lain — wewenang koreksi kas diabaikan',
  MIG,
  '     and boleh_koreksi_kas(c.holder_id);',
  ';',
  PG
);
sabotase(
  'isi-mundur menyentuh entri yang sudah dicoret',
  MIG,
  '     and c.dicoret_at is null\n     and c.esb_exported_at is null',
  '     and c.esb_exported_at is null',
  PG
);
sabotase(
  'mengosongkan supplier lewat isi-mundur diterima — entrinya tetap tertahan, tanpa jejak kenapa',
  MIG,
  '  if v_supplier is null then\n    raise exception \'Pilih suppliernya dulu.',
  '  if false then\n    raise exception \'Pilih suppliernya dulu.',
  PG
);
sabotase(
  'penandaan menghitung ulang yang sudah bertanda',
  MIG,
  '     and c.esb_exported_at is null\n     and c.entry_type = \'out\'\n     and is_bu_admin(v_uid, c.business_unit_id);',
  "     and c.entry_type = 'out'\n     and is_bu_admin(v_uid, c.business_unit_id);",
  PG
);
sabotase(
  'siapa pun bisa menandai kas BU mana pun — fungsinya security definer',
  MIG,
  "     and c.entry_type = 'out'\n     and is_bu_admin(v_uid, c.business_unit_id);",
  "     and c.entry_type = 'out';",
  PG
);
sabotase(
  'pembatalan tidak lagi menuntut alasan',
  MIG,
  '  v_alasan text := alasan_batal_esb_sah(p_alasan);',
  "  v_alasan text := coalesce(p_alasan, '');",
  PG
);
sabotase(
  'kas yang TIDAK bertanda ikut ditulisi jejak pembatalan yang tidak pernah terjadi',
  MIG,
  '     and c.esb_exported_at is not null\n     and is_bu_admin(v_uid, c.business_unit_id);',
  '     and is_bu_admin(v_uid, c.business_unit_id);',
  PG
);
sabotase(
  'riwayat_kas_saya lama tidak dibuang — create or replace menolak perubahan daftar kolomnya',
  MIG,
  'drop function if exists riwayat_kas_saya(int);',
  '',
  PG
);

console.log('\nSABOTASE JALAN DI LAYARNYA:');

sabotase(
  'Disbursement hilang dari pilihan UNDUH',
  EADM,
  '            <option value="disbursement">Disbursement — kas keluar non-bahan</option>\n',
  '',
  AUDIT
);
sabotase(
  'Disbursement hilang dari pilihan "Batalkan tanda ekspor"',
  EADM,
  '            <option value="disbursement">Kas keluar</option>\n',
  '',
  AUDIT
);
sabotase(
  'jalan membuka tanda ekspor kas dicabut — jalan keluarnya kembali SQL Editor',
  EADM,
  '                    ? await batalkanTandaKasEsb(ids, periksa.alasan)',
  '                    ? 0',
  AUDIT
);
sabotase(
  'daftar induk supplier tidak dipakai — Payment To berangkat apa adanya',
  EADM,
  '          // Daftar induk supplier yang SAMA dengan nota — bukan daftar kedua\n          // yang cepat atau lambat menyimpang.\n          masterSupplier: petaSupplier(master)',
  '          masterSupplier: new Map()',
  AUDIT
);
sabotase(
  'jalan mengisi Supplier mundur dicabut — ratusan entri lama harus diisi satu per satu',
  CADM,
  '        const n = await ubahSupplierKas(ids, v.supplier);',
  '        const n = ids.length;',
  AUDIT
);
sabotase(
  'centang ditawarkan pada baris yang pasti ditolak database',
  CADM,
  "            const bisaSupplier = r.entry_type === 'out' && !k.dicoret && !r.esb_exported_at;",
  '            const bisaSupplier = true;',
  AUDIT
);
sabotase(
  '"0 terisi" dilaporkan sebagai berhasil',
  CADM,
  '        if (n === ids.length) toast(',
  '        if (true) toast(',
  AUDIT
);

console.log('');
if (gagal === 0) console.log('Semua sabotase Disbursement tertangkap. ✅');
else console.error(`${gagal} sabotase LOLOS.`);
process.exit(gagal === 0 ? 0 : 1);
