/**
 * SABOTASE: Nilai Opname & laporan COGS.
 *
 * Yang dijaga bukan "laporannya muncul", melainkan bahwa angkanya tidak pernah
 * SALAH BESAR SAMBIL TERLIHAT WAJAR. COGS cuma tiga angka; tiap cara ia rusak
 * menghasilkan laporan bulanan yang tetap rapi dan tetap tercetak.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AKAR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const P = (rel) => path.join(AKAR, rel);

const OPN = 'js/modules/inventory/laporan-opname.js';
const OPN_ADM = 'js/modules/inventory/opname.admin.js';
const MURNI = 'js/modules/report/cogs.js';
const SVC = 'js/modules/report/report.service.js';

const asli = new Map();
for (const rel of [OPN, OPN_ADM, MURNI, SVC]) asli.set(rel, fs.readFileSync(P(rel), 'utf8'));

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

const TES_OPN = 'tools/test-laporan-opname.mjs';
const TES = 'tools/test-cogs.mjs';
const AUDIT = 'tools/audit-cogs.cjs';

console.log('SABOTASE NILAI OPNAME:');

sabotase(
  'nilai opname dihitung dari stok SISTEM, bukan yang dihitung — jadi angka catatan lagi',
  OPN,
  '      const nilaiAda = h == null ? null : h * dihitung;',
  '      const nilaiAda = h == null ? null : h * sistem;',
  TES_OPN
);
sabotase(
  'nilai opname memakai SELISIH — jadi menduplikasi kolom sebelahnya',
  OPN,
  '      const nilaiAda = h == null ? null : h * dihitung;',
  '      const nilaiAda = h == null ? null : h * selisih;',
  TES_OPN
);
sabotase('kolom Nilai Opname dihapus', OPN, "      { header: 'Nilai Opname', width: 1.1, align: 'right', numeric: true },", '', TES_OPN);
sabotase(
  'baris berstok tanpa HPP berhenti ditandai — total nilai opname diam-diam lebih kecil',
  OPN,
  '      if (h == null && (selisih !== 0 || dihitung !== 0)) adaTanpaHpp = true;',
  '      if (h == null && selisih !== 0) adaTanpaHpp = true;',
  TES_OPN
);
sabotase('nilai opname dihitung tapi tidak pernah ditampilkan', OPN_ADM, 'lap.nilaiOpnameTeks', "''", AUDIT);

console.log('\nSABOTASE RUMUS COGS:');

sabotase(
  'opname yang tidak ada diam-diam jadi NOL — COGS melonjak atau jadi negatif',
  MURNI,
  '    cogs: bisa ? nAwal + beli - nAkhir : null,',
  '    cogs: (nAwal ?? 0) + beli - (nAkhir ?? 0),',
  TES
);
sabotase(
  'stok akhir DITAMBAHKAN, bukan dikurangi',
  MURNI,
  '    cogs: bisa ? nAwal + beli - nAkhir : null,',
  '    cogs: bisa ? nAwal + beli + nAkhir : null,',
  TES
);
sabotase(
  'stok awal dan akhir tertukar',
  MURNI,
  '    cogs: bisa ? nAwal + beli - nAkhir : null,',
  '    cogs: bisa ? nAkhir + beli - nAwal : null,',
  TES
);
sabotase(
  'satu opname yang hilang dianggap cukup',
  MURNI,
  '  const bisa = nAwal !== null && nAkhir !== null;',
  '  const bisa = nAwal !== null || nAkhir !== null;',
  TES
);
sabotase(
  'HPP 0 terbaca "belum punya harga" — bahan bonus salah dilaporkan kurang',
  MURNI,
  '    if (h === null) {',
  '    if (!h) {',
  TES
);
sabotase(
  'bahan tanpa HPP berhenti dilaporkan — stok akhir lebih kecil tanpa tanda',
  MURNI,
  '      if (qty !== 0) tanpaHpp++;',
  '      /* diam */',
  TES
);
sabotase(
  'outlet tanpa opname ikut ke total — total tidak konsisten dengan barisnya',
  MURNI,
  '  const daftar = (Array.isArray(baris) ? baris : []).filter((b) => b?.bisaDihitung);',
  '  const daftar = Array.isArray(baris) ? baris : [];',
  TES
);

console.log('\nSABOTASE PENGAMBILAN DATA:');

sabotase(
  "sesi 'open' & 'cancelled' ikut dinilai — hitungan yang belum/tidak pernah berlaku",
  SVC,
  "      .eq('status', 'closed')",
  "      .not('status', 'is', null)",
  AUDIT
);
sabotase(
  'opname diurutkan MENAIK — yang terambil sesi paling awal, bukan paling akhir',
  SVC,
  "      .order('count_date', { ascending: false })\n      .order('closed_at', { ascending: false });",
  "      .order('count_date', { ascending: true })\n      .order('closed_at', { ascending: true });",
  AUDIT
);
sabotase(
  'stok awal diambil dari hari pertama periode — pembelian hari itu terhitung dua kali',
  SVC,
  '  sebelum.setDate(sebelum.getDate() - 1);',
  '  sebelum.setDate(sebelum.getDate());',
  AUDIT
);
sabotase(
  'nota dibatalkan ikut jadi pembelian — COGS lebih besar dari yang sebenarnya',
  SVC,
  "    if (n.status === 'dibatalkan') continue;",
  '    if (false) continue;',
  AUDIT
);
sabotase(
  'baris tanpa opname ditulis Rp0, bukan "-"',
  SVC,
  "    b.cogs === null ? '-' : rp(b.cogs),",
  '    rp(b.cogs),',
  AUDIT
);
sabotase('laporan COGS dicabut dari katalog', SVC, "    key: 'cogs',", "    key: 'cogs_nonaktif',", AUDIT);

console.log('');
if (gagal === 0) console.log('Semua sabotase COGS tertangkap. ✅');
else console.error(`${gagal} sabotase LOLOS.`);
process.exit(gagal === 0 ? 0 : 1);
