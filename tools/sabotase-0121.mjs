/**
 * SABOTASE 0121 — memeriksa bahwa tes & auditnya benar-benar MENGGIGIT.
 *
 * Tes yang hijau membuktikan kodenya lulus; ia tidak membuktikan tesnya bisa
 * merah. Di repo ini sudah beberapa kali ada pemeriksaan yang hijau karena
 * sasarannya tidak ada, karena namanya kebetulan muncul di komentar, atau —
 * yang terburuk — karena PGlite berjalan sebagai pemilik tabel sehingga RLS
 * tidak diterapkan sama sekali.
 *
 * Tiap baris di bawah merusak SATU hal, lalu menuntut pemeriksaannya merah.
 *
 * Filenya dipulihkan lewat `process.on('exit')` juga: pernah ada sesi yang
 * mati karena timeout dan meninggalkan migration dalam keadaan tersabotase.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AKAR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const P = (rel) => path.join(AKAR, rel);

const MIG = 'supabase/migrations/0121_kelola_kantong_kas_dari_admin.sql';
const SVC = 'js/modules/cash/cash.service.js';
const HAL = 'js/modules/cash/cash.admin.page.js';

const asli = new Map();
for (const rel of [MIG, SVC, HAL]) asli.set(rel, fs.readFileSync(P(rel), 'utf8'));

const pulih = () => {
  for (const [rel, isi] of asli) fs.writeFileSync(P(rel), isi);
};
process.on('exit', pulih);
process.on('SIGINT', () => process.exit(130));

const jalan = (cmd) => {
  try {
    execFileSync('node', [cmd], { cwd: AKAR, stdio: 'pipe' });
    return true; // hijau
  } catch {
    return false; // merah
  }
};

let gagal = 0;
/**
 * @param {string} nama   apa yang dirusak
 * @param {string} rel    file yang dirusak
 * @param {string|RegExp} dari
 * @param {string} ke
 * @param {string} pemeriksa  file tes/audit yang harus jadi merah
 */
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

const TES = 'tools/test-migrasi-0121.mjs';
const AUDIT = 'tools/audit-kelola-kantong-admin.cjs';

console.log('SABOTASE MIGRATION (ditangkap oleh tes di Postgres sungguhan):');

sabotase(
  'penjagaan super admin dicabut dari atur_kantong_kas',
  MIG,
  'if not is_super_admin(auth.uid()) then',
  'if false then',
  TES
);

sabotase(
  'daftar kantong terbuka untuk semua orang',
  MIG,
  /where is_super_admin\(auth\.uid\(\)\)\n\n  union all/,
  'where true\n\n  union all',
  TES
);

sabotase(
  'kantong boleh pindah pemegang',
  MIG,
  'if p_holder is not null and p_holder <> v_holder then',
  'if false then',
  TES
);

sabotase(
  'pemeriksaan jatah dilewati',
  MIG,
  'if v_aktif_lain >= v_jatah then',
  'if false then',
  TES
);

sabotase(
  'kantong berisi boleh ditutup',
  MIG,
  'if v_saldo <> 0 then',
  'if false then',
  TES
);

sabotase(
  'nama bentrok tidak diperiksa',
  MIG,
  /if exists \(\n    select 1 from cash_accounts\n     where holder_id = v_holder/,
  'if false and exists (\n    select 1 from cash_accounts\n     where holder_id = v_holder',
  TES
);

sabotase('nama kosong diterima', MIG, "if v_nama = '' then", 'if false then', TES);

sabotase(
  'outlet yang tidak ada diterima',
  MIG,
  'if p_outlet is not null and not exists (select 1 from outlets where id = p_outlet) then',
  'if false then',
  TES
);

// Label barisnya, bukan sekadar keberadaannya. Percobaan pertama memberi
// sabotase ini nama yang salah ("entri mendarat di pencatat") — itu penjagaan
// 0120, bukan 0121 — dan ia LOLOS, karena tidak ada satu pun pemeriksaan yang
// membaca nama barisnya. Sabotase yang salah nama menyembunyikan lubang yang
// nyata: nama yang berbeda dari layar lain membuat orang mengira ada dua kantong.
sabotase('baris Kas Utama berganti nama', MIG, "'Kas Utama',", "'Kas Lain-lain',", TES);

sabotase(
  'baris Kas Utama disaring habis',
  MIG,
  'and coalesce(s.balance, 0) <> 0',
  'and false',
  TES
);

console.log('\nSABOTASE YANG HANYA AUDIT YANG BISA MENANGKAP (jalur layar):');

sabotase(
  "tab 'accounts' dihapus dari TABS",
  HAL,
  "{ key: 'accounts', label: 'Kantong Kas' },",
  '',
  AUDIT
);

sabotase(
  "tab 'accounts' ada tapi tidak dihubungkan ke penggambarnya",
  HAL,
  "if (key === 'accounts') await renderAccountsTab(content);",
  '',
  AUDIT
);

sabotase(
  'penjelasan akibat memilih outlet dihapus dari dialognya',
  HAL,
  'help: KET_OUTLET_KANTONG_ADMIN',
  'help: null',
  AUDIT
);

sabotase(
  'mencabut outlet tidak lagi dikonfirmasi',
  HAL,
  'if (isEdit && existing.outlet_id && !values.outlet_id) {',
  'if (false) {',
  AUDIT
);

sabotase(
  'field pemegang dikunci dengan `disabled` yang tidak dikenal formDialog',
  HAL,
  "{ name: 'name', label: 'Nama kantong', type: 'text'",
  "{ name: 'holder_id', label: 'Pemegang', type: 'select', disabled: true, options: [] },\n      { name: 'name', label: 'Nama kantong', type: 'text'",
  AUDIT
);

sabotase(
  'service berhenti mengirim p_outlet (bug bentuk 0119)',
  SVC,
  'p_outlet: outletId || null,',
  '',
  AUDIT
);

sabotase(
  'kebijakan cash_accounts_own dilonggarkan di migration 0121',
  MIG,
  'notify pgrst',
  "drop policy if exists cash_accounts_own on cash_accounts;\ncreate policy cash_accounts_own on cash_accounts for all to authenticated using (true) with check (true);\n\nnotify pgrst",
  AUDIT
);

console.log('');
if (gagal === 0) console.log('Semua sabotase 0121 tertangkap. ✅');
else console.error(`${gagal} sabotase LOLOS.`);
process.exit(gagal === 0 ? 0 : 1);
