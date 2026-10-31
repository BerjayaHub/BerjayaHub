/**
 * SABOTASE: kantong utama & dua bug yang ditemukan bersamanya (0177).
 *
 * ============ KENAPA BERKAS INI ADA ============
 *
 * Ketiga hal yang diperbaiki 0177 gagal dengan TENANG: tab yang selamanya
 * kosong, dua menu yang membuka layar yang sama, dan kantong utama ganda yang
 * membuat transfer mendarat di tempat berbeda dari yang dikira orangnya.
 * Tidak satu pun memunculkan galat.
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

const MIG = 'supabase/migrations/0177_kantong_utama.sql';
const MENU = 'js/main-admin.js';
const SVC = 'js/modules/cash/cash.service.js';
const PAGE = 'js/modules/cash/cash.page.js';
const ADMIN = 'js/modules/cash/cash.admin.page.js';

const BERKAS = [MIG, MENU, SVC, PAGE, ADMIN];
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

const AUDIT = 'tools/audit-kantong-utama.cjs';
const PG = 'tools/test-migrasi-0177.mjs';

// =====================================================================
console.log('SABOTASE KANTONG UTAMA:');
// =====================================================================

// ============ DUA KANTONG UTAMA = TIDAK ADA KANTONG UTAMA ============
//
// Form mengisi yang mana saja yang kebetulan lebih dulu terbaca, dan transfer
// mendarat di tempat yang berbeda dari yang dikira orangnya.
sabotase(
  'indeks "satu utama per orang" dicabut',
  MIG,
  'create unique index if not exists idx_cash_accounts_satu_utama\n  on cash_accounts (holder_id) where is_primary;',
  '',
  PG
);

sabotase(
  'kantong pertama tidak lagi otomatis jadi utama',
  MIG,
  'create trigger trg_kantong_utama_pertama',
  'create trigger trg_kantong_utama_pertama_mati',
  PG
);

sabotase(
  'wewenang atur_kantong_utama dicabut — kantong orang lain bisa diubah',
  MIG,
  'if not boleh_koreksi_kas(v_holder) then',
  'if false then',
  PG
);

sabotase(
  'kantong yang sudah ditutup boleh jadi bawaan',
  MIG,
  "  if not v_aktif then\n    raise exception 'Kantong yang sudah ditutup tidak bisa dijadikan kantong utama.';\n  end if;",
  '',
  PG
);

// ============ SATU JALUR DIPERBARUI, SATU TERTINGGAL ============
//
// Bentuk kegagalan yang paling sering di repo ini: dua tempat menulis hal yang
// sama, satu diperbarui. Transfer yang DIREVISI terlempar kembali ke Kas
// Utama — justru saat orangnya sedang membetulkan.
sabotase(
  'revisi transfer terlempar balik ke Kas Utama',
  MIG,
  '         account_id = kantong_utama(p_to_user),',
  '         account_id = null,',
  PG
);

sabotase(
  'transfer baru mendarat di Kas Utama lagi',
  MIG,
  "values (p_to_user, kantong_utama(p_to_user), 'transfer_in', p_amount, v_uid, v_tid, p_notes, v_uid);",
  "values (p_to_user, null, 'transfer_in', p_amount, v_uid, v_tid, p_notes, v_uid);",
  PG
);

// =====================================================================
console.log('\nSABOTASE TAB YANG SELAMANYA KOSONG:');
// =====================================================================

// Tabnya bisa dibuka, tombol tambahnya bisa ditekan, tabelnya selalu berbunyi
// "Belum ada kantong kas". Tanpa satu pun galat.
sabotase(
  'daftar kantong kembali super-admin-only',
  MIG,
  '   where boleh_koreksi_kas(a.holder_id)',
  '   where is_super_admin(auth.uid())',
  PG
);

sabotase(
  'Kas Utama yang kosong ikut terdaftar lagi',
  MIG,
  '     and coalesce(s.balance, 0) <> 0',
  '',
  PG
);

// =====================================================================
console.log('\nSABOTASE MENU GANDA:');
// =====================================================================

sabotase(
  'satu modul kembali muncul dua kali di menu admin',
  MENU,
  '    if (sudahAda.has(mod.code)) continue;',
  '',
  AUDIT
);

// =====================================================================
console.log('\nSABOTASE LAYAR:');
// =====================================================================

sabotase(
  'is_primary tidak lagi dibaca — bawaan jatuh ke kantong pertama menurut urutan tampilan',
  SVC,
  "    .select('id, name, sort_order, is_active, is_primary, outlet_id, outlets!outlet_id(name)')",
  "    .select('id, name, sort_order, is_active, outlet_id, outlets!outlet_id(name)')",
  AUDIT
);

sabotase(
  'bawaan kantong tidak lagi mengikuti kantong utama',
  PAGE,
  "    const utama = accounts.find((a) => a.is_primary)?.id ?? accounts[0]?.id ?? '';",
  "    const utama = accounts[0]?.id ?? '';",
  AUDIT
);

sabotase(
  'Kas Utama yang kosong kembali ditawarkan sebagai pilihan',
  PAGE,
  '    const utamaKosong = saldoDari(null) === 0;',
  '    const utamaKosongX = saldoDari(null) === 0;',
  AUDIT
);

sabotase(
  'baris Kas Utama berisi Rp0 kembali tampil di kepala halaman',
  PAGE,
  '      const akunTampil = saldoAkun.filter((a) => a.account_id || Number(a.balance) !== 0);',
  '      const akunTampil = saldoAkun;',
  AUDIT
);

sabotase(
  'tombol "Jadikan utama" digambar tapi tidak dipasangi penangan',
  ADMIN,
  "  content.querySelectorAll('.btn-utama-akun').forEach((btn) =>",
  "  [].forEach((btn) =>",
  AUDIT
);

sabotase('penanda UTAMA hilang dari tabel kantong', ADMIN, 'UTAMA</span>', 'utama</span>', AUDIT);

// ---------------------------------------------------------------
console.log('');
if (gagal === 0) console.log('Semua sabotase kantong utama tertangkap. ✅');
else console.error(`${gagal} sabotase LOLOS / tidak terpasang.`);
process.exit(gagal === 0 ? 0 : 1);
