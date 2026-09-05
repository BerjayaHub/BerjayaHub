/**
 * SABOTASE 0125 — memeriksa bahwa tes & auditnya benar-benar MENGGIGIT.
 *
 * Yang paling penting di sini bukan "pembayaran pusat berhasil", melainkan
 * bahwa ia BERHENTI di batas yang benar: tidak menyentuh kas, tetap menuntut
 * harga lengkap, dan tidak diam-diam melonggarkan jalur kas.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AKAR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const P = (rel) => path.join(AKAR, rel);

const MIG = 'supabase/migrations/0125_nota_dibayar_pusat.sql';
const HAL = 'js/modules/inventory/nota-staff.js';
const SVC = 'js/modules/inventory/nota.service.js';
const ATURAN = 'js/modules/inventory/hutang-nota.js';

const asli = new Map();
for (const rel of [MIG, HAL, SVC, ATURAN]) asli.set(rel, fs.readFileSync(P(rel), 'utf8'));

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

const TES = 'tools/test-migrasi-0125.mjs';
const TES_ATURAN = 'tools/test-hutang-nota.mjs';
const AUDIT = 'tools/audit-hutang-nota.cjs';

console.log('SABOTASE MIGRATION:');

sabotase(
  'INTI: pembayaran pusat tetap memotong kas',
  MIG,
  "if v_sumber = 'kas' and v_total > 0 then",
  'if v_total > 0 then',
  TES
);
sabotase('sumbernya tidak dicatat', MIG, 'payment_source = v_sumber', 'payment_source = null', TES);
sabotase('semua pembayaran dicatat sebagai kas', MIG, 'payment_source = v_sumber', "payment_source = 'kas'", TES);
sabotase('sumber yang tidak dikenal diterima', MIG, "if v_sumber not in ('kas', 'pusat') then", 'if false then', TES);
sabotase(
  'pusat ikut kena batas satu outlet',
  MIG,
  "  if v_sumber = 'kas' then\n    select count(distinct outlet_id)",
  '  if true then\n    select count(distinct outlet_id)',
  TES
);
sabotase(
  'kas IKUT dilonggarkan jadi boleh lintas outlet',
  MIG,
  "  if v_sumber = 'kas' then\n    select count(distinct outlet_id)",
  '  if false then\n    select count(distinct outlet_id)',
  TES
);
sabotase('harga lengkap tidak lagi wajib', MIG, 'if v_tanpa_harga > 0 then', 'if false then', TES);
sabotase(
  'pembungkus 4 argumen diam-diam jadi pusat',
  MIG,
  "select bayar_nota(p_notas, p_account, p_date, p_notes, 'kas');",
  "select bayar_nota(p_notas, p_account, p_date, p_notes, 'pusat');",
  TES
);
sabotase(
  'pembatalan pusat ikut melepas nota lain',
  MIG,
  "           payment_entry_id = null, payment_source = null\n     where id = p_nota;",
  "           payment_entry_id = null, payment_source = null\n     where payment_status = 'lunas';",
  TES
);
sabotase(
  'pembatalan kas berhenti membuat entri balik (regresi)',
  MIG,
  /  insert into cash_entries \(\n    business_unit_id, outlet_id, holder_id, account_id, entry_type, amount,\n    notes, entry_date, created_by, untuk_nota\n  \) values \(\n    v_asli\.business_unit_id[\s\S]*?v_uid, false\n  \);/,
  '',
  TES
);
sabotase('sumbernya tidak ikut di view', MIG, 'g.payment_source,', '', TES);

console.log('\nSABOTASE ATURAN MURNI:');

sabotase('lintasOutlet melonggarkan aturan lain juga', ATURAN, 'if (kurang.length) {', 'if (false) {', TES_ATURAN);
sabotase('kas ikut boleh lintas outlet', ATURAN, 'if (!lintasOutlet && outlet.size > 1) {', 'if (false) {', TES_ATURAN);
sabotase('pusat tetap ditahan batas outlet', ATURAN, 'if (!lintasOutlet && outlet.size > 1) {', 'if (outlet.size > 1) {', TES_ATURAN);

console.log('\nSABOTASE YANG HANYA AUDIT YANG BISA MENANGKAP (jalur layar):');

sabotase('Pusat hilang dari daftar "Dibayar oleh"', HAL, /opsiPembayar\(/g, 'opsiKasSaja(', AUDIT);
sabotase(
  'penanda Pusat jadi string kosong (ditolak formDialog sebagai "wajib diisi")',
  HAL,
  "const BAYAR_PUSAT = '__pusat__'",
  "const BAYAR_PUSAT = ''",
  AUDIT
);
sabotase('pilihan Pusat tidak diterjemahkan jadi sumber pusat', HAL, /sumber: 'pusat'/g, "sumber: 'kas'", AUDIT);
sabotase('layar input nota kembali menawarkan Dibayar Pusat', HAL, '<option value="tunai">', '<option value="pusat">Dibayar Pusat</option>\n            <option value="tunai">', AUDIT);
sabotase('akibat memilih Pusat tidak dijelaskan', HAL, /buku kas mana pun/g, 'kas', AUDIT);
sabotase('dialog kembali memakai label "Kalau Tunai, …"', HAL, "label: 'Dibayar oleh'", "label: 'Kalau Tunai, bayar dari kas'", AUDIT);
sabotase('dialog berhenti menyembunyikan field yang tak relevan', HAL, 'if (kasEl2) kasEl2.hidden = !bayar;', '', AUDIT);
sabotase('penanda lunas tidak lagi membedakan pusat', HAL, /payment_source === 'pusat'/g, 'false', AUDIT);
sabotase('service berhenti mengirim p_sumber', SVC, /p_sumber:/g, 'p_x:', AUDIT);

console.log('');
if (gagal === 0) console.log('Semua sabotase 0125 tertangkap. ✅');
else console.error(`${gagal} sabotase LOLOS.`);
process.exit(gagal === 0 ? 0 : 1);
