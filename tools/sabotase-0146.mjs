/**
 * SABOTASE: ekspor waste/spoil ke ESB Item Journal.
 *
 * Tiap sabotase di bawah menghasilkan berkas yang DITERIMA ESB tanpa keluhan.
 * Tidak satu pun melempar galat di layar mana pun — itulah sebabnya berkas ini
 * ada: yang dijaga bukan "apakah kodenya jalan", tapi "apakah kerusakan yang
 * tidak terlihat masih tertangkap".
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AKAR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const P = (rel) => path.join(AKAR, rel);

const MIG = 'supabase/migrations/0146_ekspor_waste_esb.sql';
const MURNI = 'js/modules/inventory/esb-journal.js';
const PURCHASE = 'js/modules/inventory/esb-purchase.js';
const SVC = 'js/modules/inventory/esb.service.js';
const ADMIN = 'js/modules/inventory/esb.admin.js';
const TGL = 'js/modules/inventory/tanggal-excel.js';

const asli = new Map();
for (const rel of [MIG, MURNI, PURCHASE, SVC, ADMIN, TGL]) asli.set(rel, fs.readFileSync(P(rel), 'utf8'));

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
  // `String.replace` mengganti kemunculan PERTAMA saja. Kalau polanya muncul
  // lebih dari sekali, sabotasenya cuma mengenai salah satu tempat dan
  // "tertangkap" tidak membuktikan tempat yang lain ikut dijaga.
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

const TES = 'tools/test-esb-journal.mjs';
const PG = 'tools/test-migrasi-0146.mjs';
const AUDIT = 'tools/audit-item-journal.cjs';

console.log('SABOTASE SATU-BERKAS-SATU-OUTLET — yang paling mahal dari semuanya:');

sabotase(
  'penjaga di modul murninya dicabut — berkas gabungan berangkat tanpa sepatah kata',
  MURNI,
  '  if (outlet.size > 1) {',
  '  if (false) {',
  TES
);
sabotase(
  'layanannya berhenti menuntut outlet — "Semua outlet" mengumpulkan seluruh outlet ke satu berkas',
  SVC,
  "  if (!outletId) throw new Error('Pilih satu outlet dulu — berkas Item Journal tidak punya kolom outlet.');",
  '  outletId = outletId ?? null;',
  AUDIT
);
sabotase(
  'saringan outletnya dibuang — argumennya diminta lalu diabaikan',
  SVC,
  "      .eq('outlet_id', outletId)\n",
  '',
  AUDIT
);
sabotase(
  'pilihan "Semua outlet" tidak lagi dicabut dari layar',
  ADMIN,
  '      semua.disabled = true;',
  '      semua.disabled = false;',
  AUDIT
);
sabotase(
  'penjaga saat pratinjau dibuang — kalau pilihan di layar lepas, tidak ada yang menangkapnya',
  ADMIN,
  '    if (dok.outletWajib && !outletId) {',
  '    if (false) {',
  AUDIT
);
sabotase(
  'Item Journal tidak lagi ditandai wajib-outlet',
  ADMIN,
  '    outletWajib: true,',
  '    outletWajib: false,',
  AUDIT
);

console.log('\nSABOTASE BENTUK BERKASNYA:');

sabotase(
  'header dipindah ke baris 1 — ESB membaca judulnya sebagai nama kolom pertama',
  MURNI,
  'export const BARIS_HEADER_JOURNAL = 2;',
  'export const BARIS_HEADER_JOURNAL = 0;',
  TES
);
sabotase(
  'baris kepala berkas tidak ditulis — headernya mendarat di baris 1 lagi',
  ADMIN,
  '  for (let r = 0; r < barisHeader; r++) atas.push(r === 0 && judul ? [judul] : []);',
  '  void barisHeader;',
  AUDIT
);
sabotase(
  'angka baris headernya ditulis ulang di layar, bukan diambil dari satu tempat',
  ADMIN,
  '            barisHeader: dok.barisHeader ?? 0,',
  '            barisHeader: 3,',
  AUDIT
);
sabotase(
  'format tanggal tidak diberi tahu baris headernya — melesetnya diam',
  TGL,
  '  for (let r = awal; r < awal + jumlahBaris; r++) {',
  '  for (let r = 1; r <= jumlahBaris; r++) {',
  TES
);
sabotase(
  'satu kolom dihapus dari daftarnya — sel-selnya bergeser satu kolom ke kiri',
  MURNI,
  "'Product Code', 'Unit'",
  "'Unit'",
  TES
);

console.log('\nSABOTASE ARTI ANGKANYA:');

// Mode "Add" pada waste MENAMBAH stok di ESB sebanyak yang terbuang. Dua kali
// salah arahnya, dan tidak ada satu pun pesan.
sabotase(
  'Mode jadi "Add" — stok ESB BERTAMBAH sebanyak yang terbuang',
  MURNI,
  "export const MODE_KURANG = 'Deduct';",
  "export const MODE_KURANG = 'Add';",
  TES
);
sabotase(
  'bahan tanpa harga beli dikirim sebagai 0 — "bahannya gratis", dan ESB menerimanya',
  MURNI,
  "      if (nilai === null) {\n        catat('nilai-bahan', it.product_name, kode);\n        adaMasalah = true;\n      }",
  '      void nilai;',
  TES
);
sabotase(
  'nomor barisnya tidak dikembalikan saat sebuah waste ditahan — No melompat',
  MURNI,
  '      no -= barisWaste.length;',
  '      void barisWaste;',
  TES
);
// Purpose berpindah rumah di 0147: bukan lagi dipetakan dari `jenis`,
// melainkan dibaca dari `waste_runs.purpose` yang dipilih staff. Sabotase
// aturannya sekarang ada di tools/sabotase-0147.mjs; yang tersisa di sini cuma
// menjaga jalur lamanya tidak diam-diam kembali.
sabotase(
  'Purpose kembali dipetakan dari jenis waste — sumbunya salah, akun COGS-nya salah',
  MURNI,
  '    const purpose = teks(w.purpose) || null;',
  "    const purpose = peta?.purpose?.get?.(teks(w.jenis).toLowerCase()) ?? null;",
  AUDIT
);
sabotase(
  'satu baris bermasalah tidak lagi menahan seluruh waste-nya — jurnal separuh jadi di ESB',
  MURNI,
  '    if (adaMasalah || !purpose) {',
  '    if (false) {',
  TES
);
sabotase(
  'Product Code diambil dari kode lokal Berjaya Hub, bukan dari daftar induk ESB',
  MURNI,
  "        item ? kodeItem.get(item) ?? '' : '',",
  "        teks(it.product_id),",
  TES
);
sabotase(
  'biaya diambil dari outlet mana pun — harga beras di Sentul dipakai untuk Serpong',
  ADMIN,
  '          getBiayaRataOutlet(outletId)',
  '          getBiayaRataOutlet(outlets[0]?.id)',
  AUDIT
);

console.log('\nSABOTASE JALAN DI LAYARNYA — kemampuan yang ada tapi tak terjangkau:');

sabotase(
  "'purpose' kembali jadi jenis pemetaan — kelompok kosong yang tidak bisa dikerjakan siapa pun",
  PURCHASE,
  "'unit', 'item', 'supplier'];",
  "'unit', 'item', 'supplier', 'purpose'];",
  TES
);
sabotase(
  'alasan "purpose-kosong" kehilangan labelnya — tabel penahan menampilkan kode mentah',
  ADMIN,
  "  'purpose-kosong': 'Purpose kosong (isi di Rekap Waste / Spoil)'",
  "  'purpose-belum': 'Purpose kosong (isi di Rekap Waste / Spoil)'",
  AUDIT
);
sabotase(
  'Item Journal hilang dari pilihan jenis dokumen',
  ADMIN,
  '<option value="journal">Item Journal — waste / spoil</option>',
  '',
  AUDIT
);
sabotase(
  'jalan membuka tanda ekspor waste dicabut — satu-satunya jalan keluar kembali SQL Editor',
  ADMIN,
  '                  ? await batalkanTandaWasteEsb(ids, periksa.alasan)',
  '                  ? 0',
  AUDIT
);
sabotase(
  'layar "Batalkan tanda ekspor" tidak bisa menampilkan waste bertanda',
  ADMIN,
  '              ? await wasteBertandaEsb({ businessUnitId, from, to, outletId })',
  '              ? []',
  AUDIT
);
// Baris `if (!termasukSudahEkspor) …` ADA DI TIGA fungsi (nota, kiriman,
// waste). Jangkarnya diperpanjang sampai baris yang hanya dimiliki
// `wasteUntukEsb`, supaya yang dirusak memang jalur waste — bukan jalur nota
// yang kebetulan disebut lebih dulu.
sabotase(
  'waste yang sudah diekspor ditawarkan lagi — stoknya dipotong dua kali di ESB',
  SVC,
  "    if (!termasukSudahEkspor) q = q.is('esb_exported_at', null);\n    return q.range(dari, sampai);\n  });\n\n  if (!runs.length) return { waste: [], itemsPerWaste: new Map() };",
  '    return q.range(dari, sampai);\n  });\n\n  if (!runs.length) return { waste: [], itemsPerWaste: new Map() };',
  AUDIT
);

console.log('\nSABOTASE MIGRATION 0146:');

sabotase(
  "'purpose' tidak diterima esb_master — pemetaannya gagal disimpan diam-diam",
  MIG,
  "  check (jenis in ('branch', 'location', 'unit', 'item', 'payment_method', 'coa', 'supplier', 'purpose'));\n\ndo $$",
  "  check (jenis in ('branch', 'location', 'unit', 'item', 'payment_method', 'coa', 'supplier'));\n\ndo $$",
  PG
);
sabotase(
  "jenis 'supplier' terhapus saat check-nya ditulis ulang — seluruh pemetaan supplier tertutup",
  MIG,
  "alter table esb_map\n  add constraint esb_map_jenis_check\n  check (jenis in ('branch', 'location', 'unit', 'item', 'payment_method', 'coa', 'supplier', 'purpose'));",
  "alter table esb_map\n  add constraint esb_map_jenis_check\n  check (jenis in ('branch', 'location', 'unit', 'item', 'payment_method', 'coa', 'purpose'));",
  PG
);
sabotase(
  'nama constraint lama DITEBAK, bukan dicari di katalog — migration gagal di tengah jalan',
  MIG,
  "  select conname into v_nama from pg_constraint\n   where conrelid = 'esb_master'::regclass and contype = 'c'\n     and pg_get_constraintdef(oid) ilike '%jenis%';",
  "  v_nama := 'esb_master_jenis_check1';",
  AUDIT
);
sabotase(
  'penandaan menghitung ulang yang sudah bertanda — "3 ditandai" untuk 0 yang sungguh baru',
  MIG,
  "     and w.esb_exported_at is null\n     and is_bu_admin(v_uid, w.business_unit_id);",
  '     and is_bu_admin(v_uid, w.business_unit_id);',
  PG
);
sabotase(
  'pembatalan tidak lagi menuntut alasan — jejaknya berhenti menjawab pertanyaan apa pun',
  MIG,
  '  v_alasan text := alasan_batal_esb_sah(p_alasan);',
  '  v_alasan text := coalesce(p_alasan, %L);'.replace('%L', "''"),
  PG
);
sabotase(
  'waste yang TIDAK bertanda ikut ditulisi jejak pembatalan yang tidak pernah terjadi',
  MIG,
  '     and w.esb_exported_at is not null\n     and is_bu_admin(v_uid, w.business_unit_id);',
  '     and is_bu_admin(v_uid, w.business_unit_id);',
  PG
);
sabotase(
  'penandaan berhenti memeriksa is_bu_admin — fungsinya security definer, jadi siapa pun bisa',
  MIG,
  "     and w.esb_exported_at is null\n     and is_bu_admin(v_uid, w.business_unit_id);",
  '     and w.esb_exported_at is null;',
  PG
);
sabotase(
  'kolom penandanya tidak dibuat — seluruh fitur berdiri di atas kolom yang tidak ada',
  MIG,
  'alter table waste_runs add column if not exists esb_exported_at timestamptz;',
  '',
  PG
);
sabotase(
  '`if not exists` dicabut — migration gagal saat dijalankan ulang, di tengah jalan',
  MIG,
  'alter table waste_runs add column if not exists esb_alasan_batal text;',
  'alter table waste_runs add column esb_alasan_batal text;',
  PG
);

console.log('');
if (gagal === 0) console.log('Semua sabotase Item Journal tertangkap. ✅');
else console.error(`${gagal} sabotase LOLOS.`);
process.exit(gagal === 0 ? 0 : 1);
