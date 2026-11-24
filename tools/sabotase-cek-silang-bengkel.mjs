/**
 * SABOTASE: menu bengkel yang digabung + tab Cek Silang.
 *
 * ============ KENAPA BERKAS INI ADA ============
 *
 * Seluruh nilai layar Cek Silang bergantung pada hal-hal yang tidak terlihat
 * kalau hilang:
 *
 *   - tab yang disaring keluar tidak melempar galat, tidak menulis apa pun di
 *     console, dan tidak meninggalkan satu pun petunjuk bahwa ada layar yang
 *     hilang;
 *   - korporat yang ikut dibandingkan membuat SETIAP hari tampak selisih, dan
 *     daftar yang selalu merah berhenti dibaca — kebocoran sungguhan justru
 *     jadi lebih aman;
 *   - selisih yang dijumlahkan apa adanya saling menghapus: bulan yang penuh
 *     kesalahan menunjukkan total nol;
 *   - saringan outlet yang cuma dikenakan satu sisi memunculkan selisih
 *     sebesar omzet penuh, yang terlihat seperti pencurian besar padahal cuma
 *     saringan yang tidak seimbang.
 *
 * Tiap sabotase di bawah adalah salah satunya, dan semuanya tetap berjalan
 * tanpa galat.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AKAR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const P = (rel) => path.join(AKAR, rel);

const MAIN = 'js/main-admin.js';
const KATALOG = 'js/core/admin-tabs.js';
const MURNI = 'js/modules/bengkel/cek-silang-harian.js';
const LAYAR = 'js/modules/bengkel/cek-silang.admin.page.js';

const BERKAS = [MAIN, KATALOG, MURNI, LAYAR];
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

// Pemeriksa yang sudah merah sejak awal melaporkan SELURUH sabotase sebagai
// tertangkap, dan harness ini berubah jadi stempel.
const pastikanHijau = (cmd) => {
  if (process.env.SABOTASE_PERIKSA_POLA) return;
  if (!jalan(cmd)) {
    console.error(`❌ PEMERIKSANYA SUDAH MERAH SEBELUM DISABOTASE: ${cmd} — "tertangkap" di bawah tidak berarti apa-apa.`);
    process.exit(1);
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

const AUDIT = 'tools/audit-cek-silang-bengkel.cjs';
const TES = 'tools/test-cek-silang-harian.mjs';

for (const p of [AUDIT, TES]) pastikanHijau(p);

// =====================================================================
console.log('SABOTASE: MENU & IZIN');
// =====================================================================

sabotase(
  'tab Cek Silang kehilangan syarat modulnya (tidak akan pernah muncul)',
  MAIN,
  "        syaratModul: 'penjualan_bengkel_rinci'\n",
  '',
  AUDIT
);

sabotase(
  'tab Cek Silang dibuang dari grup bengkel',
  MAIN,
  "        code: 'cek_silang_bengkel',",
  "        code: 'cek_silang_bengkel_xx',",
  AUDIT
);

// Begitu seorang admin punya daftar izin, `canAccessTab` menolak kode yang
// tidak ada di katalog — dan kode itu tidak bisa dicentang siapa pun.
sabotase(
  'kode Cek Silang hilang dari katalog izin (layar tak pernah bisa diberikan)',
  KATALOG,
  "  { code: 'cek_silang_bengkel', label: 'Cek Silang (harian vs Turboly)', group: 'Penjualan Bengkel' },",
  '',
  AUDIT
);

sabotase(
  'kode Rinci & Impor hilang dari katalog izin',
  KATALOG,
  "  { code: 'penjualan_bengkel_rinci', label: 'Rinci & Impor Turboly', group: 'Penjualan Bengkel' },",
  '',
  AUDIT
);

sabotase(
  'modul yang sudah masuk grup tampil lagi sebagai menu sendiri',
  MAIN,
  '!GROUPED_CODES.has(mod.code)',
  'true',
  AUDIT
);

// =====================================================================
console.log('\nSABOTASE: KORPORAT IKUT DITUDUH');
// =====================================================================

sabotase(
  'korporat ikut dijumlahkan ke sisi Turboly',
  MURNI,
  "    if (teks(r?.sumber) === 'korporat') {\n      // Tidak ikut dibandingkan — lihat kepala berkas.\n      b.korporat += total;\n      continue;\n    }",
  '',
  AUDIT
);

sabotase(
  'korporat masuk kolomnya sendiri TAPI ikut menyalakan sisi Turboly',
  MURNI,
  '      b.korporat += total;\n      continue;',
  '      b.korporat += total;',
  TES
);

// =====================================================================
console.log('\nSABOTASE: SELISIH YANG SALING MENGHAPUS');
// =====================================================================

sabotase(
  'selisih mutlak tidak dijumlahkan (bulan penuh selisih terlihat nol)',
  MURNI,
  '    r.selisihMutlak += Math.abs(b.selisih);',
  '    r.selisihMutlak += b.selisih;',
  TES
);

sabotase(
  'selisih per jenis dibuang (sparepart lebih yang ditutup jasa kurang terbaca "cocok")',
  MURNI,
  '      selisihSparepart: bulat(b.harianSparepart - b.turbolySparepart),\n      selisihJasa: bulat(b.harianJasa - b.turbolyJasa),',
  '',
  AUDIT
);

// =====================================================================
console.log('\nSABOTASE: HARI YANG CUMA ADA DI SATU SISI');
// =====================================================================

sabotase(
  '"belum diimpor" tidak dibedakan dari selisih',
  MURNI,
  '    if (b.adaHarian && !b.adaRinci) status = STATUS.TANPA_RINCI;',
  '    if (false) status = STATUS.TANPA_RINCI;',
  TES
);

sabotase(
  'toleransi diabaikan (pembulatan kasir Rp500 jadi temuan)',
  MURNI,
  'Math.abs(selisih) <= num(toleransi)',
  'selisih === 0',
  AUDIT
);

// =====================================================================
console.log('\nSABOTASE: SARINGAN OUTLET SEBELAH');
// =====================================================================

sabotase(
  'outlet disaring hanya di sisi rinci (seluruh hari tampak "staff belum lapor")',
  LAYAR,
  "    if (state.outletId) harian = harian.filter((h) => h.outlet_id === state.outletId);",
  '',
  AUDIT
);

sabotase(
  'catatan tidak ikut ke berkas Excel',
  LAYAR,
  "          subtitle: [`${state.dari} s/d ${state.sampai}`, `toleransi ${formatRupiah(state.toleransi)}`, ...catatan].join(' · '),",
  "          subtitle: `${state.dari} s/d ${state.sampai}`,",
  AUDIT
);

console.log('');
if (gagal === 0) console.log('Semua sabotase tertangkap. ✅');
else console.error(`${gagal} sabotase LOLOS — pemeriksanya belum cukup.`);
process.exit(gagal === 0 ? 0 : 1);
