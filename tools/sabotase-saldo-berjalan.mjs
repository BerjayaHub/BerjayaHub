/**
 * SABOTASE: kolom saldo berjalan di riwayat kas (0175).
 *
 * ============ KENAPA BERKAS INI ADA ============
 *
 * Kolom ini berisi angka rupiah yang dipakai mencocokkan catatan dengan uang
 * fisik di laci. Setiap cara ia rusak menghasilkan angka yang TETAP terlihat
 * masuk akal — tidak ada galat, tidak ada tanda, dan yang membacanya akan
 * mulai mencari selisih uang yang tidak pernah ada.
 *
 * Yang diuji di sini bukan kodenya, melainkan apakah pemeriksanya masih
 * benar-benar menjaga sesuatu.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AKAR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const P = (rel) => path.join(AKAR, rel);

const MIG = 'supabase/migrations/0175_saldo_berjalan_kas.sql';
const MURNI = 'js/modules/cash/saldo-berjalan.js';
const SVC = 'js/modules/cash/cash.service.js';
const STAFF = 'js/modules/cash/cash.page.js';
const ADMIN = 'js/modules/cash/cash.admin.page.js';

const BERKAS = [MIG, MURNI, SVC, STAFF, ADMIN];
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

const AUDIT = 'tools/audit-saldo-berjalan.cjs';
const PG = 'tools/test-migrasi-0175.mjs';
const TES = 'tools/test-saldo-berjalan.mjs';

// =====================================================================
console.log('SABOTASE ANGKA — yang paling mahal:');
// =====================================================================

// ============ DUA PEMERIKSA UNTUK SABOTASE YANG SAMA ============
//
// Auditnya MEMBACA SQL-nya; tes PGlite MENJALANKANNYA lalu membandingkan
// hasilnya dengan `cash_account_balances`. Kalau cuma auditnya yang merah,
// tesnya tidak pernah benar-benar membuktikan kedua angka itu cocok.
sabotase(
  'entri yang dicoret ikut dijumlahkan — saldo berselisih dengan kepala halaman',
  MIG,
  'where ce.dicoret_at is null',
  'where (ce.dicoret_at is null or true)',
  PG
);
sabotase(
  'entri yang dicoret ikut dijumlahkan — DAN auditnya harus merah juga',
  MIG,
  'where ce.dicoret_at is null',
  'where true',
  AUDIT
);

sabotase(
  '"Dibayar Pusat" ikut memotong kantong, padahal uangnya tidak dari sana',
  MIG,
  'and not ce.dibayar_pusat',
  '',
  PG
);

// ============ `=` TIDAK PERNAH COCOK UNTUK NULL ============
//
// Kas Utama berkantong NULL. Dengan `=`, seluruh entrinya kehilangan saldo —
// bukan salah angka, melainkan kolom yang diam-diam kosong untuk satu kantong
// penuh.
sabotase(
  'kantong dicocokkan dengan `=` — seluruh entri Kas Utama kehilangan saldonya',
  MIG,
  'and k.account_id is not distinct from ce.account_id',
  'and k.account_id = ce.account_id',
  PG
);

sabotase(
  'jendelanya tidak dipartisi per kantong — saldo beberapa kantong tercampur',
  MIG,
  'partition by ce.holder_id, ce.account_id',
  'partition by ce.holder_id',
  PG
);

sabotase(
  'urutannya jadi waktu ketik — entri mundur menumpuk di akhir deret',
  MIG,
  'order by ce.entry_date, ce.created_at, ce.id',
  'order by ce.created_at, ce.id',
  PG
);

// =====================================================================
console.log('\nSABOTASE WEWENANG:');
// =====================================================================

sabotase(
  'wewenang dicabut — saldo dihitung dari riwayat yang hanya terbaca separuh',
  MIG,
  'and boleh_lihat_saldo_kas(ce.holder_id)',
  '',
  PG
);

// =====================================================================
console.log('\nSABOTASE "TIDAK DIKETAHUI" vs "NOL":');
// =====================================================================

// ============ KEKELIRUAN PALING MAHAL DI KOLOM INI ============
//
// `Number(null)` adalah 0, dan 0 itu berhingga. Tanpa penjaganya, saldo yang
// TIDAK ADA tampil "Rp 0" — dibaca "kantongnya kosong", lalu orang mulai
// mencari uang yang tidak hilang.
sabotase(
  'nilai kosong jadi nol — "tidak diketahui" terbaca "kantongnya kosong"',
  MURNI,
  "  if (v === null || v === undefined || v === '') return null;",
  '',
  TES
);

sabotase(
  'entri dicoret ikut diberi angka',
  MURNI,
  "  if (entri?.dicoret_at) return { ada: false, nilai: null, sebab: SEBAB.dicoret };",
  '',
  TES
);

sabotase(
  'entri Dibayar Pusat ikut diberi angka',
  MURNI,
  "  if (entri?.dibayar_pusat) return { ada: false, nilai: null, sebab: SEBAB.pusat };",
  '',
  TES
);

// Sebab yang sama untuk dua keadaan berbeda membuat orang mencari pencoretan
// yang tidak pernah ada.
sabotase(
  'sebab "tidak diketahui" disamakan dengan "dicoret"',
  MURNI,
  "  takTahu: 'Saldo kantong untuk entri ini tidak bisa dihitung (di luar wewenangmu atau gagal dimuat).'",
  "  takTahu: 'Entri ini dicoret — tidak pernah memengaruhi saldo kantong.'",
  TES
);

// =====================================================================
console.log('\nSABOTASE LAYAR:');
// =====================================================================

sabotase(
  'kegagalan saldo dilempar — SELURUH riwayat kas ikut kosong',
  SVC,
  "    console.warn('[kas] saldo berjalan tidak terbaca:', error.message);\n    return [];",
  '    throw error;',
  AUDIT
);

// Dicabut dari TABEL RIWAYATNYA — bukan dari tabel ringkasan saldo pemegang
// yang kebetulan memakai kata yang sama di layar yang sama.
sabotase('kolom Saldo hilang dari tabel riwayat Staff App', STAFF, '<th>Jumlah</th><th>Saldo</th>', '<th>Jumlah</th>', AUDIT);
sabotase('kolom Saldo hilang dari tabel mutasi Admin Portal', ADMIN, '<th>Jumlah</th><th>Saldo</th>', '<th>Jumlah</th>', AUDIT);

sabotase(
  'Admin Portal menyalin sendiri sel saldonya — dua salinan yang akan menyimpang',
  ADMIN,
  "import { selSaldoHtml } from './cash.page.js';",
  '',
  AUDIT
);

sabotase(
  'colspan baris kosong tertinggal sesudah kolom bertambah',
  ADMIN,
  'colspan="12"',
  'colspan="11"',
  AUDIT
);

// ---------------------------------------------------------------
console.log('');
if (gagal === 0) console.log('Semua sabotase saldo berjalan tertangkap. ✅');
else console.error(`${gagal} sabotase LOLOS / tidak terpasang.`);
process.exit(gagal === 0 ? 0 : 1);
