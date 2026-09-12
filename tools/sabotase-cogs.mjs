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
const MIG = 'supabase/migrations/0137_saldo_stok_pada_tanggal.sql';

const asli = new Map();
for (const rel of [OPN, OPN_ADM, MURNI, SVC, MIG]) asli.set(rel, fs.readFileSync(P(rel), 'utf8'));

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
  'stok akhir DITAMBAHKAN, bukan dikurangi',
  MURNI,
  '    cogs: nAwal + beli - nAkhir,',
  '    cogs: nAwal + beli + nAkhir,',
  TES
);
sabotase(
  'stok awal dan akhir tertukar',
  MURNI,
  '    cogs: nAwal + beli - nAkhir,',
  '    cogs: nAkhir + beli - nAwal,',
  TES
);
sabotase(
  'saldo negatif dijepit ke nol — nilai stok lebih besar dari kenyataan',
  MURNI,
  '    nilai += h * qty;',
  '    nilai += h * Math.max(0, qty);',
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
  'penanda "dikunci opname" dimatikan — angka menurut catatan tak bisa dibedakan dari yang diverifikasi fisik',
  MURNI,
  '    terkunci: !!(opnameAwal?.tanggal && opnameAkhir?.tanggal),',
  '    terkunci: true,',
  TES
);
sabotase(
  'peringatan "stok akhir belum dikunci opname" dicabut',
  MURNI,
  '  if (!opnameAkhir?.tanggal) catatan.push(PERINGATAN_AKHIR_TANPA_OPNAME);',
  '',
  TES
);
sabotase(
  'sebagian outlet dibuang dari total — total tidak sama dengan jumlah kolomnya',
  MURNI,
  '  const daftar = Array.isArray(baris) ? baris : [];',
  '  const daftar = (Array.isArray(baris) ? baris : []).filter((b) => b?.terkunci);',
  TES
);

console.log('\nSABOTASE SALDO (inti perbaikannya):');

sabotase(
  'stok kembali diambil dari SATU sesi opname — sesi perbaikan jadi "nilai seluruh stok"',
  SVC,
  '    nilaiStokPerOutlet({ businessUnitId, outletId, tanggal: hariSebelum, hpp }),',
  '    Promise.resolve(new Map()),',
  AUDIT
);
sabotase(
  'saldo diambil tanpa paginasi — 800+ produk terpotong di 1000 baris',
  SVC,
  '  const baris = await ambilSemua((dari, sampai) =>',
  '  const baris = await (async (dari, sampai) =>',
  AUDIT
);
sabotase(
  'batas waktunya bukan akhir hari WIB — pergerakan sore jatuh ke tanggal salah',
  MIG,
  "     and sm.created_at < (((p_tanggal + 1)::timestamp) at time zone 'Asia/Jakarta')",
  '     and sm.created_at::date <= p_tanggal',
  AUDIT
);
// Polanya memuat baris SESUDAHNYA supaya menyasar DEKLARASINYA, bukan kalimat
// "`security invoker`, BUKAN definer" di komentar — yang justru kemunculan
// pertama, dan yang diganti `String.replace` kalau polanya cuma dua kata itu.
sabotase(
  'fungsi saldonya jadi security definer — RLS stock_movements bisa dilewati',
  MIG,
  'security invoker\nset search_path = public',
  'security definer\nset search_path = public',
  AUDIT
);
sabotase(
  'saldo negatif ikut dibuang di server',
  MIG,
  '  having sum(sm.qty_delta) <> 0;',
  '  having sum(sm.qty_delta) > 0;',
  AUDIT
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
sabotase('laporan COGS dicabut dari katalog', SVC, "    key: 'cogs',", "    key: 'cogs_nonaktif',", AUDIT);
sabotase('catatan metodologinya dibuang — COGS dikira menggantikan Laba Kotor', SVC, '    note:\n', '    noteLama:\n', AUDIT);

console.log('');
if (gagal === 0) console.log('Semua sabotase COGS tertangkap. ✅');
else console.error(`${gagal} sabotase LOLOS.`);
process.exit(gagal === 0 ? 0 : 1);
