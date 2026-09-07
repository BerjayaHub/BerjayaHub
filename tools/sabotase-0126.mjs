/**
 * SABOTASE 0126 — memeriksa bahwa tes & auditnya benar-benar MENGGIGIT.
 *
 * Pelonggaran ini menyangkut UANG ORANG LAIN: sesudahnya, siapa pun yang
 * bertugas di BU ini bisa mengurangi kas siapa pun yang kantongnya diberi
 * outlet. Jadi yang paling penting bukan "berhasil", melainkan bahwa ia
 * BERHENTI di batas yang benar — kantong pribadi, dan BU lain.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AKAR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const P = (rel) => path.join(AKAR, rel);

const MIG = 'supabase/migrations/0126_kas_lintas_outlet_se_bu.sql';
const SVC = 'js/modules/cash/cash.service.js';
const HAL = 'js/modules/inventory/nota-staff.js';

const asli = new Map();
for (const rel of [MIG, SVC, HAL]) asli.set(rel, fs.readFileSync(P(rel), 'utf8'));

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
  // membuka berkas yang tidak pernah ditulis sudah terjadi sekali di repo ini,
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

const TES = 'tools/test-migrasi-0126.mjs';
const AUDIT_KAS = 'tools/audit-kas-outlet.cjs';
const AUDIT_NOTA = 'tools/audit-hutang-nota.cjs';

console.log('SABOTASE MIGRATION:');

sabotase(
  'INTI: pelonggaran se-BU dicabut',
  MIG,
  'or (a.outlet_id is not null and has_bu_scope(p_uid, o.business_unit_id))',
  'or false',
  TES
);
sabotase(
  'KANTONG PRIBADI ikut terbuka (janji 0120 dicabut lewat pintu belakang)',
  MIG,
  'or (a.outlet_id is not null and has_bu_scope(p_uid, o.business_unit_id))',
  'or has_bu_scope(p_uid, o.business_unit_id) or a.outlet_id is null',
  TES
);
sabotase(
  'batasnya melebar jadi siapa saja, bukan se-BU',
  MIG,
  'has_bu_scope(p_uid, o.business_unit_id)',
  'true',
  TES
);
sabotase('kantong yang ditutup ikut terbuka', MIG, 'and a.is_active', '', TES);
sabotase(
  'kebijakan baca se-BU dihapus — izinnya ada, kantongnya tak terlihat',
  MIG,
  /drop policy if exists cash_accounts_baca_bu on cash_accounts;\ncreate policy cash_accounts_baca_bu on cash_accounts[\s\S]*?\);/,
  '',
  TES
);
// TIDAK DISABOTASE: `outlet_id is not null` di dalam kebijakan BACA.
//
// Sudah dicoba, dan ia LOLOS — dengan benar. Untuk kantong tanpa outlet,
// sub-query `(select business_unit_id from outlets where id = outlet_id)`
// menghasilkan NULL, dan `has_bu_scope(uid, NULL)` sudah false dengan
// sendirinya. Jadi kantong pribadi tetap tak terlihat tanpa syarat itu.
//
// Ia dipertahankan sebagai pertahanan berlapis, bukan sebagai penjaga — dan
// dicatat di sini supaya tidak ada yang menambahkan sabotase palsu untuknya
// nanti, lalu "memperbaiki" tesnya sampai hijau untuk hal yang tidak diuji.
//
// Yang BENAR-BENAR menjaga kantong pribadi adalah syarat `a.outlet_id is not
// null` di dalam `boleh_membebani_kas` — dan itu disabotase di atas.

sabotase(
  'pemegangnya sendiri kehilangan aksesnya',
  MIG,
  'a.holder_id = p_uid',
  'false',
  TES
);

console.log('\nSABOTASE YANG HANYA AUDIT YANG BISA MENANGKAP (jalur layar):');

sabotase(
  'daftar kantong disaring lagi ke satu outlet di klien',
  SVC,
  '.or(`holder_id.eq.${uid},outlet_id.not.is.null`)',
  '.or(`holder_id.eq.${uid},outlet_id.eq.${outletId}`)',
  AUDIT_KAS
);
sabotase(
  'label kantong berhenti menyebut outlet & pemegangnya',
  HAL,
  '[k.name, k.outlets?.name, k.user_profiles?.full_name].filter(Boolean).join(\' — \')',
  'k.name',
  AUDIT_NOTA
);

console.log('');
if (gagal === 0) console.log('Semua sabotase 0126 tertangkap. ✅');
else console.error(`${gagal} sabotase LOLOS.`);
process.exit(gagal === 0 ? 0 : 1);
