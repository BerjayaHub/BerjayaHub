/**
 * SABOTASE: audit "layar admin memakai daftar outlet yang salah".
 *
 * ============ KENAPA BERKAS INI ADA ============
 *
 * Audit ini bersandar pada DAFTAR PENGECUALIAN yang ditulis manusia — dan
 * berkas auditnya sendiri sudah pernah memuat alasan yang basi berbulan-bulan
 * ("Tab Stok & Riwayat hanya menampilkan", padahal dua tabnya sudah menulis).
 *
 * Sekarang klaim "hanya membaca" dibuktikan secara mekanis: fungsi yang
 * diimpor layar itu dibuka, dan kalau badannya menulis (langsung atau lewat
 * RPC yang di migration-nya memuat insert/update/delete), klaimnya gugur.
 *
 * Yang diuji di sini: apakah pembuktian itu benar-benar berjalan, dan apakah
 * penjaga di layarnya masih dituntut.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AKAR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const P = (rel) => path.join(AKAR, rel);

const SALES = 'js/modules/sales/sales.admin.page.js';
const WASTE = 'js/modules/inventory/waste.admin.js';
const NBM = 'js/modules/attendance/nbm-report.admin.page.js';
const DISPATCH = 'js/modules/dispatch/dispatch.admin.page.js';

const BERKAS = [SALES, WASTE, NBM, DISPATCH];
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

const AUDIT = 'tools/audit-outlet-tulis.cjs';

// =====================================================================
console.log('SABOTASE PENJAGA DI LAYAR:');
// =====================================================================

// ============ TOMBOL YANG DITOLAK DIAM-DIAM ============
//
// Tanpa penjaga di layar, tombolnya digambar untuk semua orang; penolakannya
// baru datang dari database SESUDAH dialognya diisi. Untuk `ubah_purpose_waste`
// penolakan itu bahkan bukan galat — ia berupa "0 baris berubah".
sabotase(
  'penjaga Purpose waste dicabut dari layar',
  WASTE,
  'const bolehUbahPurpose = await sayaAdminBu(businessUnitId).catch(() => false);',
  'const bolehUbahPurpose = true;',
  AUDIT
);

sabotase(
  'penjaga koreksi penjualan dicabut dari layar',
  SALES,
  'const bolehKoreksi = await sayaAdminBu(businessUnitId).catch(() => false);',
  'const bolehKoreksi = true;',
  AUDIT
);

// Tujuan koreksi outlet basis WAJIB dari daftar "yang saya kelola": RPC-nya
// menolak dengan `is_admin_of_outlet()` atas outlet TUJUAN.
sabotase(
  'dropdown tujuan koreksi basis kembali memakai daftar "boleh dilihat"',
  NBM,
  'const outletTujuan = await listOutletsSayaKelola(businessUnitId);',
  'const outletTujuan = outlets;',
  AUDIT
);

// =====================================================================
console.log('\nSABOTASE KLAIM "HANYA MEMBACA":');
// =====================================================================

// ============ ALASAN YANG BASI LEBIH BURUK DARIPADA TIDAK ADA ============
//
// Layar yang dikecualikan sebagai hanya-baca lalu menumbuhkan tombol simpan
// adalah bentuk kegagalan yang sudah pernah terjadi di berkas ini. Yang
// membacanya jadi yakin layar itu aman.
sabotase(
  'layar yang diklaim hanya-baca mulai mengimpor fungsi yang MENULIS',
  DISPATCH,
  "import { listDispatchesAdmin, listItemKirimanAdmin, DISPATCH_STATUS } from './dispatch.service.js';",
  "import { listDispatchesAdmin, listItemKirimanAdmin, DISPATCH_STATUS, cancelStockOrder } from './dispatch.service.js';",
  AUDIT
);

// ---------------------------------------------------------------
console.log('');
if (gagal === 0) console.log('Semua sabotase daftar outlet tertangkap. ✅');
else console.error(`${gagal} sabotase LOLOS / tidak terpasang.`);
process.exit(gagal === 0 ? 0 : 1);
