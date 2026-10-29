/**
 * SABOTASE: audit FK pelaku (`user_profiles!kolom`).
 *
 * ============ KENAPA BERKAS INI ADA ============
 *
 * Audit ini baru saja diperbaiki: cara lamanya menentukan tabel asal sebuah
 * embed dengan mengambil `.from()` TERDEKAT SEBELUMNYA, dan itu salah untuk
 * embed yang hidup di konstanta di atas fungsinya. Akibat yang terlihat cuma
 * temuan palsu; akibat yang TIDAK terlihat jauh lebih mahal — embed yang
 * benar-benar rusak bisa ditimpakan ke tabel lain yang kebetulan punya FK
 * yang pas, dan auditnya diam.
 *
 * Jadi yang diuji di sini: apakah ia masih menangkap embed rusak pada KETIGA
 * bentuk yang dipakai di repo ini — langsung di rantai, lewat konstanta, dan
 * lewat konstanta yang dioper ke pembungkus lokal.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AKAR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const P = (rel) => path.join(AKAR, rel);

const MIG = 'supabase/migrations/0003_attendance.sql';
const PRESENSI = 'js/modules/attendance/attendance.service.js';
const NOTA = 'js/modules/inventory/nota.service.js';
const PRODUKSI = 'js/modules/production/production.service.js';

const BERKAS = [MIG, PRESENSI, NOTA, PRODUKSI];
const asli = new Map();
for (const rel of BERKAS) asli.set(rel, fs.readFileSync(P(rel), 'utf8'));

const PENANDA = path.join(AKAR, 'tools/.sabotase-aktif');
const tandai = (rel) => fs.writeFileSync(PENANDA, `${path.basename(process.argv[1])} merusak ${rel}\n`);
const lepasTanda = () => {
  try {
    fs.unlinkSync(PENANDA);
  } catch {
    /* belum pernah ada — tidak apa-apa */
  }
};

const pulih = () => {
  if (process.env.SABOTASE_PERIKSA_POLA) return lepasTanda();
  for (const [rel, isi] of asli) fs.writeFileSync(P(rel), isi);
  lepasTanda();
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
  if (process.env.SABOTASE_PERIKSA_POLA) {
    console.log(`   ✔ pola terpasang: ${nama}`);
    return;
  }
  tandai(rel);
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

const AUDIT = 'tools/audit-fk-pelaku.cjs';

// =====================================================================
console.log('SABOTASE FK DI MIGRATION:');
// =====================================================================

// ============ `auth.users` PUNYA NILAI YANG SAMA, RELASI YANG BEDA ============
//
// Kolomnya terisi uuid yang persis sama, jadi seluruh kode yang membacanya
// tetap benar. Yang patah cuma embed-nya — dan patahnya membatalkan SELURUH
// query, bukan cuma kolom nama.
sabotase(
  'FK presensi dipindah ke auth.users — embed-nya patah total',
  MIG,
  'user_id uuid not null references user_profiles(id) on delete cascade,',
  'user_id uuid not null references auth.users(id) on delete cascade,',
  AUDIT
);

sabotase(
  'FK presensi dihapus sama sekali',
  MIG,
  'user_id uuid not null references user_profiles(id) on delete cascade,',
  'user_id uuid not null,',
  AUDIT
);

// =====================================================================
console.log('\nSABOTASE EMBED — tiga bentuk penulisan:');
// =====================================================================

// (1) Lewat KONSTANTA di atas fungsinya, lalu dioper ke pembungkus lokal.
//     Inilah bentuk yang dulu salah dikenali audit ini.
sabotase(
  'embed presensi menunjuk kolom yang FK-nya ke outlets (lewat konstanta + pembungkus)',
  PRESENSI,
  'outlet_id, user_profiles!user_id(full_name)',
  'outlet_id, user_profiles!outlet_id(full_name)',
  AUDIT
);

// (2) Lewat konstanta string biasa di dalam fungsinya.
sabotase(
  'embed nota menunjuk kolom yang FK-nya ke outlets',
  NOTA,
  'pembuat:user_profiles!created_by(full_name)',
  'pembuat:user_profiles!outlet_id(full_name)',
  AUDIT
);

// (3) Langsung di rantai `.from().select()`.
sabotase(
  'embed produksi menunjuk kolom yang tidak punya FK sama sekali',
  PRODUKSI,
  "'products(name, base_unit), outlets!outlet_id(name), pencatat:user_profiles!created_by(full_name)'",
  "'products(name, base_unit), outlets!outlet_id(name), pencatat:user_profiles!output_qty(full_name)'",
  AUDIT
);

// ---------------------------------------------------------------
console.log('');
if (gagal === 0) console.log('Semua sabotase FK pelaku tertangkap. ✅');
else console.error(`${gagal} sabotase LOLOS / tidak terpasang.`);
process.exit(gagal === 0 ? 0 : 1);
