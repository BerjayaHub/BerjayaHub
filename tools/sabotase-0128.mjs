/**
 * SABOTASE 0128 — memeriksa bahwa tes & audit ekspor Simple Transfer
 * benar-benar MENGGIGIT.
 *
 * Yang dipertaruhkan di sini adalah STOK DI DUA OUTLET SEKALIGUS. Tiap
 * pelonggaran di bawah menghasilkan berkas yang terlihat benar, diterima ESB
 * tanpa keluhan, dan baru ketahuan salah saat opname — kalau ketahuan.
 *
 * Jalankan: node tools/sabotase-0128.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AKAR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const P = (rel) => path.join(AKAR, rel);

const MIG = 'supabase/migrations/0128_ekspor_esb_transfer.sql';
const MOD = 'js/modules/inventory/esb-transfer.js';
const SVC = 'js/modules/inventory/esb.service.js';
const HAL = 'js/modules/inventory/esb.admin.js';
const TGL = 'js/core/dates.js';

const asli = new Map();
for (const rel of [MIG, MOD, SVC, HAL, TGL]) asli.set(rel, fs.readFileSync(P(rel), 'utf8'));

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
  // Pemeriksanya harus ADA. Sabotase yang "tertangkap" karena `node` gagal
  // membuka berkas yang tidak pernah ditulis sudah pernah terjadi di repo ini,
  // dan itu kebalikan dari jaminan.
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

const TES_MIG = 'tools/test-migrasi-0128.mjs';
const TES_MOD = 'tools/test-esb-transfer.mjs';
const AUDIT = 'tools/audit-esb-transfer.cjs';

console.log('\n== Migration ==');

sabotase(
  "penyaring status 'received' dilepas — barang yang masih di jalan ikut berangkat",
  MIG,
  /and d\.status = 'received'/,
  '',
  TES_MIG
);

sabotase(
  'kiriman tanpa tanggal terima boleh ditandai — ESB akan mengisi Date dengan tanggal unggah',
  MIG,
  /and d\.received_at is not null/,
  '',
  TES_MIG
);

sabotase(
  'stempel lama boleh tertimpa — jejak kapan ia benar-benar berangkat hilang',
  MIG,
  /and d\.esb_exported_at is null/,
  '',
  TES_MIG
);

sabotase(
  'penjaga wewenang dilepas — security definer tanpa is_bu_admin melewati RLS',
  MIG,
  /and is_bu_admin\(v_uid, d\.business_unit_id\)/,
  '',
  TES_MIG
);

sabotase(
  'kiriman terekspor boleh diubah diam-diam — ESB dan Berjaya Hub menyimpan angka berbeda selamanya',
  MIG,
  /if v_ada then/,
  'if false then',
  TES_MIG
);

console.log('\n== Modul murni ==');

sabotase(
  'Qty diambil dari sent_qty — stok tujuan di ESB lebih besar dari isi raknya',
  MOD,
  /const q = angka\(it\?\.received_qty\);/g,
  'const q = angka(it?.sent_qty);',
  TES_MOD
);

sabotase(
  'qty terima yang belum dicatat diperlakukan sebagai nol, bukan ditahan',
  MOD,
  /if \(q === null\) \{[\s\S]*?continue;\n {6}\}/,
  'if (q === null) { continue; }',
  TES_MOD
);

sabotase(
  'tanggal dipotong 10 huruf dari UTC — penerimaan dini hari jadi tanggal kemarin',
  MOD,
  /const tanggal = tanggalWIB\(d\.received_at\);/,
  'const tanggal = String(d.received_at ?? "").slice(0, 10);',
  TES_MOD
);

sabotase(
  'Origin dan Destination tertukar — stok berpindah ke arah yang salah',
  MOD,
  /const asalB = padanan\(peta\.branch, d\.from_outlet_name\);/,
  'const asalB = padanan(peta.branch, d.to_outlet_name);',
  TES_MOD
);

sabotase(
  'kiriman yang itemnya belum dipetakan tetap berangkat separuh jadi',
  MOD,
  /if \(masalahItem \|\| adaBelumDicatat \|\| kepalaBermasalah \|\| !barisDok\.length\) continue;/,
  'if (!barisDok.length) continue;',
  TES_MOD
);

sabotase(
  'Sequence naik untuk kiriman yang tertahan juga — nomor dokumennya bolong',
  MOD,
  /baris\.push\(\.\.\.barisDok\);\n {4}kirimanIds\.push\(d\.id\);\n {4}seq \+= 1;/,
  'baris.push(...barisDok);\n    kirimanIds.push(d.id);',
  TES_MOD
);

sabotase(
  'satu kolom template dihapus — data bergeser satu kolom tanpa ketahuan',
  MOD,
  /'Product Code',\n/,
  '',
  TES_MOD
);

console.log('\n== Audit ==');

sabotase(
  "layanan berhenti menyaring status 'received'",
  SVC,
  /\.eq\('status', 'received'\)/,
  '',
  AUDIT
);

sabotase(
  'batas tanggal timestamptz kehilangan offset WIB — kiriman sore hari terakhir hilang',
  SVC,
  /\.lte\('received_at', isoTo\(to\)\)/,
  ".lte('received_at', to)",
  AUDIT
);

// Pola berikut HARUS menyebut baris `.or(...)` di atasnya.
//
// Baris `if (!termasukSudahEkspor) …` muncul dua kali di berkas ini — sekali di
// `notaUntukEsb`, sekali di `kirimanUntukEsb` — dan `String.replace` mengganti
// yang PERTAMA. Versi pertama sabotase ini merusak fungsi Purchase, lalu
// dilaporkan "lolos" karena audit transfer memang tidak menjaga fungsi itu.
// Yang sebenarnya ditemukan bukan sabotase yang lemah, melainkan sisi Purchase
// yang tidak dijaga siapa pun.
sabotase(
  'kiriman yang sudah diekspor ikut ditawarkan lagi',
  SVC,
  /if \(outletId\) q = q\.or\(`from_outlet_id[^\n]*\n\s*if \(!termasukSudahEkspor\) q = q\.is\('esb_exported_at', null\);/,
  'if (outletId) q = q.or(`from_outlet_id.eq.${outletId},to_outlet_id.eq.${outletId}`);',
  AUDIT
);

sabotase(
  'nota yang sudah diekspor ikut ditawarkan lagi (sisi Purchase, berkas yang sama)',
  SVC,
  /if \(!termasukSudahEkspor\) q = q\.is\('esb_exported_at', null\);/,
  '',
  AUDIT
);

sabotase(
  'pemilih jenis dokumen hilang dari layar — Transfer tidak bisa dipilih siapa pun',
  HAL,
  /id="esb-dokumen"/,
  'id="esb-dokumen-nonaktif"',
  AUDIT
);

sabotase(
  'penandaan dipindah ke SEBELUM berkasnya jadi',
  HAL,
  /const n = jenis === 'transfer' \? await tandaiKirimanEsb\(ids\) : await tandaiNotaEsb\(ids\);/,
  'const n = 0;',
  AUDIT
);

sabotase(
  'header berkas tidak lagi di baris 1 — ESB menolak seluruh berkasnya',
  HAL,
  /aoa_to_sheet\(\[kolom, \.\.\.baris\]\)/,
  "aoa_to_sheet([['Ekspor ESB'], kolom, ...baris])",
  AUDIT
);

sabotase(
  'tanggalWIB berhenti menggeser ke WIB — seluruh sistem kembali membaca UTC',
  TGL,
  /const w = new Date\(d\.getTime\(\) \+ 7 \* 3600000\);/,
  'const w = new Date(d.getTime());',
  TES_MOD
);

console.log('');
if (gagal === 0) {
  console.log('Semua sabotase 0128 tertangkap. Tes & auditnya menggigit. ✅');
} else {
  console.error(`${gagal} sabotase LOLOS.`);
}
process.exit(gagal === 0 ? 0 : 1);
