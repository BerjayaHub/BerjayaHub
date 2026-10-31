/**
 * SABOTASE: tampilan presensi & bilah bawah mobile.
 *
 * ============ KENAPA BERKAS INI ADA ============
 *
 * Tidak satu pun kerusakan UI di sini memunculkan galat. Semuanya berakhir
 * sebagai layar yang "agak beda" — kartu yang putih semua, bunyi yang
 * terdengar sebelum datanya tersimpan, baris terakhir tabel yang bersembunyi
 * di balik bilah bawah. Yang memakainya menyesuaikan diri tanpa pernah
 * melaporkannya, dan itulah kenapa ia bisa bertahan berbulan-bulan.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AKAR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const P = (rel) => path.join(AKAR, rel);

const CSS = 'css/styles.css';
const RUPA = 'js/modules/attendance/tampilan-presensi.js';
const SUARA = 'js/core/suara-presensi.js';
const SHELL = 'js/main-staff.js';
const PAGE = 'js/modules/attendance/attendance.page.js';
const KAS = 'js/modules/cash/cash.page.js';

const BERKAS = [CSS, RUPA, SUARA, SHELL, PAGE, KAS];
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

const AUDIT = 'tools/audit-tampilan-presensi.cjs';
const TES = 'tools/test-tampilan-presensi.mjs';

// =====================================================================
console.log('SABOTASE WARNA — yang kalah tanpa bersuara:');
// =====================================================================

// ============ KEKHUSUSAN YANG MENGALAHKAN DIAM-DIAM ============
//
// Tiap `:not(.x)` pada aturan tombol sekunder menaikkan kekhususannya sampai
// ia mengalahkan aturan `.kelas` tunggal yang ditulis belakangan. Kartu
// presensi sempat putih semua karena ini — empat keadaan terlihat sama, tanpa
// satu pun galat.
sabotase(
  'kartu presensi tidak lagi dikecualikan dari aturan tombol sekunder',
  CSS,
  ':not(.module-card):not(.att-mini):not(.btn-att-break):not(.scope-remove)',
  ':not(.module-card):not(.btn-att-break):not(.scope-remove)',
  AUDIT
);

sabotase(
  'tombol istirahat tidak lagi dikecualikan — warnanya kalah',
  CSS,
  ':not(.att-mini):not(.btn-att-break):not(.scope-remove)',
  ':not(.att-mini):not(.scope-remove)',
  AUDIT
);

sabotase(
  'dua tombol presensi memakai warna yang sama',
  CSS,
  '.staff-main button.btn-att-out { background: #9c2b2b; }',
  '.staff-main button.btn-att-out { background: #1f7a4d; }',
  AUDIT
);

sabotase(
  'keadaan "bekerja" kehilangan warnanya',
  CSS,
  '.att-state-bekerja {\n  --att-bg: #dceafc;',
  '.att-state-bekerja-mati {\n  --att-bg: #dceafc;',
  AUDIT
);

// =====================================================================
console.log('\nSABOTASE BILAH BAWAH:');
// =====================================================================

// `fixed` MENUTUPI konten, tidak mendorongnya.
sabotase(
  'ruang bawah dicabut — baris terakhir bersembunyi di balik bilah',
  CSS,
  '  .staff-main {\n    padding-bottom: calc(var(--footer-mobile-h) + env(safe-area-inset-bottom, 0px) + 12px);\n  }',
  '',
  AUDIT
);

sabotase(
  'tombol lama tetap tinggal di header — dua tempat untuk satu tombol',
  CSS,
  '  .staff-topbar #btn-home-top,\n  .staff-topbar #btn-profile {\n    display: none;\n  }',
  '',
  AUDIT
);

sabotase(
  'tinggi riwayat kas tidak lagi mengurangi bilah bawah',
  KAS,
  "    const bilah = document.getElementById('mobile-footer');",
  '    const bilah = null;',
  AUDIT
);

sabotase(
  'sorotan bilah tidak dibersihkan saat modul dibuka',
  SHELL,
  "  tandaiFooter('');",
  '',
  AUDIT
);

sabotase(
  'tombol Profil di bilah bawah tidak dipasangi penangan',
  SHELL,
  "  document.getElementById('mf-profile').addEventListener('click', keProfil);",
  '',
  AUDIT
);

// =====================================================================
console.log('\nSABOTASE SATU SUMBER RUPA:');
// =====================================================================

// Dua layar yang mewarnai keadaan yang sama dengan warna berbeda adalah dua
// jawaban untuk satu pertanyaan — dan bedanya cuma terlihat kalau keduanya
// dibuka berdampingan, yang tidak pernah terjadi di HP.
sabotase(
  'Beranda berhenti memakai modul rupa bersama',
  SHELL,
  '        const rupa = tampilanPresensi(keadaan);',
  "        const rupa = { kelas: 'att-state-belum', lencana: '🕐', judul: keadaan, ajakan: '' };",
  AUDIT
);

sabotase(
  'istirahat diperiksa sebelum clock out — yang sudah pulang terlihat istirahat',
  RUPA,
  "  if (sesi.clock_out_at) return 'selesai';",
  '',
  TES
);

sabotase(
  'keadaan tak dikenal jatuh ke "bekerja", bukan "belum"',
  RUPA,
  '  return TAMPILAN[keadaan] ?? TAMPILAN.belum;',
  '  return TAMPILAN[keadaan] ?? TAMPILAN.bekerja;',
  TES
);

// =====================================================================
console.log('\nSABOTASE BUNYI:');
// =====================================================================

// ============ ARAHNYA YANG MEMBEDAKAN ============
//
// Dua bunyi yang sama-sama naik cuma terdengar seperti "bunyi aplikasi".
sabotase(
  'nada pulang ikut NAIK — tidak bisa dibedakan dari masuk tanpa melihat layar',
  SUARA,
  '      { hz: NADA.G5, mulai: 0, lama: 0.12 },\n      { hz: NADA.E5, mulai: 0.1, lama: 0.12 },\n      { hz: NADA.C5, mulai: 0.2, lama: 0.26 }',
  '      { hz: NADA.C5, mulai: 0, lama: 0.12 },\n      { hz: NADA.E5, mulai: 0.1, lama: 0.12 },\n      { hz: NADA.G5, mulai: 0.2, lama: 0.26 }',
  TES
);

sabotase(
  'jenis tak dikenal ikut berbunyi — "pulang" bisa terdengar seperti "masuk"',
  SUARA,
  '  return [];\n}',
  "  return polaNada('masuk');\n}",
  TES
);

// Presensi tetap sah dengan atau tanpa bunyi. Galat audio yang dibiarkan naik
// akan menggagalkan clock in di perangkat yang tidak bisa berbunyi.
sabotase(
  'galat audio tidak lagi ditelan — clock in bisa gagal karena speaker',
  SUARA,
  '  } catch {\n    /* Presensinya tetap sah tanpa bunyi — lihat kepala berkas. */\n  }',
  '  } finally {\n    /* dibiarkan naik */\n  }',
  AUDIT
);

sabotase(
  'bunyi clock in dipindah ke SEBELUM tersimpan',
  PAGE,
  "      bunyiPresensi(bunyiUntuk('clock_in'));",
  '',
  AUDIT
);

// ---------------------------------------------------------------
console.log('');
if (gagal === 0) console.log('Semua sabotase tampilan presensi tertangkap. ✅');
else console.error(`${gagal} sabotase LOLOS / tidak terpasang.`);
process.exit(gagal === 0 ? 0 : 1);
