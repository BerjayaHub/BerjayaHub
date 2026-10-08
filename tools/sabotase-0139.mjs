/**
 * SABOTASE 0139 — daftar staff per outlet basis.
 *
 * Yang dijaga: laporan disiplin tidak boleh mencampur "tidak pernah masuk"
 * dengan "memang bertugas di outlet lain". Keduanya tampil sebagai baris nol,
 * dan begitu tercampur, laporan itu berhenti bisa dipakai menilai siapa pun.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AKAR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const P = (rel) => path.join(AKAR, rel);

const MIG = 'supabase/migrations/0139_staff_per_outlet_basis.sql';
const SVC = 'js/modules/leave/leave.service.js';
const RPT = 'js/modules/report/report.service.js';

const asli = new Map();
for (const rel of [MIG, SVC, RPT]) asli.set(rel, fs.readFileSync(P(rel), 'utf8'));

// ============ JEJAK "SABOTASE SEDANG TERPASANG" ============
//
// `process.on('exit')` TIDAK berjalan kalau prosesnya di-SIGKILL — mis. saat
// harness ini kena batas waktu di luar. Yang tertinggal adalah berkas repo
// yang masih tersabotase, dan ia TIDAK terlihat sebagai apa pun: migration-nya
// tetap sah, aplikasinya tetap jalan, dan satu-satunya tanda adalah satu tes
// yang merah entah kenapa berjam-jam kemudian.
//
// Itu benar-benar terjadi: `0153` tertinggal dengan `if false then` di tempat
// penjaga "kas keluar harus menyebut outlet peruntukannya".
//
// Jadi penanda ini ditulis SEBELUM berkas pertama dirusak dan dibuang sesudah
// semuanya pulih. `tools/audit-sisa-sabotase.cjs` berteriak kalau ia tertinggal.
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
  // ============ MODE PERIKSA POLA TIDAK MEMULIHKAN APA PUN ============
  //
  // Karena ia tidak pernah merusak apa pun. `fs.writeFileSync` dengan isi yang
  // SAMA tetap sebuah penulisan: berkasnya dipotong lebih dulu, lalu diisi
  // ulang. Proses lain yang kebetulan membacanya pada milidetik itu melihat
  // berkas kosong atau separuh.
  //
  // Itu benar-benar terjadi: `audit-sabotase-terpasang.cjs` menjalankan 53
  // harness sekaligus, ketiganya-puluh-tiga menulis ulang berkasnya saat
  // keluar, dan `audit-import-ekspor.cjs` yang berjalan berbarengan melaporkan
  // "mengimpor REPORTS tapi berkasnya tidak mengekspornya" — untuk berkas yang
  // isinya tidak pernah berubah sedetik pun.
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
    console.error(`❌ PEMERIKSANYA TIDAK ADA: ${pemeriksa}`);
    return;
  }
  const isi = asli.get(rel);
  const rusak = isi.replace(dari, ke);
  if (rusak === isi) {
    gagal++;
    console.error(`❌ SABOTASE TIDAK TERPASANG: ${nama} — polanya tidak ketemu di ${rel}.`);
    return;
  }
  // ============ MODE PERIKSA POLA ============
  //
  // Dipakai `tools/audit-sabotase-terpasang.cjs`: berhenti TEPAT sesudah pola
  // `dari` dipastikan cocok, sebelum satu berkas pun disentuh.
  //
  // Alasannya satu kejadian nyata: `sabotase-0132.mjs` basi sejak `0142` —
  // tiga polanya tidak cocok lagi dengan kodenya — dan tidak ada yang tahu
  // berbulan-bulan, karena harness sabotase berat (tiap sabotase menjalankan
  // pemeriksanya sendiri) sehingga tidak pernah ikut sweep rutin. Harness yang
  // polanya tidak terpasang TIDAK menguji apa pun, dan ia melaporkannya hanya
  // kalau ada yang menjalankannya.
  //
  // Mode ini tidak menjalankan pemeriksa sama sekali, jadi seluruh 50+ harness
  // bisa disapu dalam hitungan detik.
  if (process.env.SABOTASE_PERIKSA_POLA) {
    console.log(`   \u2714 pola terpasang: ${nama}`);
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

const TES = 'tools/test-migrasi-0139.mjs';
const AUDIT = 'tools/audit-staff-per-outlet.cjs';

console.log('SABOTASE SARINGAN OUTLET:');

sabotase(
  'saringan outlet dicabut — seluruh staff BU tampil lagi dengan nilai nol',
  MIG,
  '    and (p_outlet_id is null or ms.outlet_id = p_outlet_id)',
  '',
  TES
);
sabotase(
  'cakupan level BU ikut terbawa — daftar panjangnya kembali',
  MIG,
  '    and (p_outlet_id is null or ms.outlet_id = p_outlet_id)',
  '    and (p_outlet_id is null or ms.outlet_id = p_outlet_id or ms.outlet_id is null)',
  TES
);
sabotase(
  'bentuk lama dibiarkan hidup — panggilan dua argumen jadi ambigu',
  MIG,
  'drop function if exists list_bu_staff_for_admin(uuid, boolean);',
  '',
  TES
);
sabotase(
  'pemeriksaan "tepat satu bentuk" dilepas',
  MIG,
  "    raise exception 'Harus TEPAT satu bentuk list_bu_staff_for_admin. Lebih dari satu membuat panggilan dua argumen jadi ambigu dan ditolak PostgREST.';",
  '    null;',
  AUDIT
);

console.log('\nSABOTASE JALUR LAYAR:');

sabotase(
  '`p_outlet_id` tidak selalu dikirim — PostgREST mencari fungsi yang salah',
  SVC,
  '    p_outlet_id: outletId ?? null',
  '    ...(outletId ? { p_outlet_id: outletId } : {})',
  AUDIT
);
sabotase(
  'laporan disiplin berhenti menyaring daftar staffnya',
  RPT,
  'outletId ? listBuStaff(businessUnitId, { includeInactive: true, outletId }).catch(() => null) : Promise.resolve(null),',
  'Promise.resolve(null),',
  AUDIT
);
sabotase(
  'staff yang punya presensi di outlet itu ikut dibuang — angkanya hilang dari laporan',
  RPT,
  '  const tampil = (uid) => !cakupanOutlet || cakupanOutlet.has(uid) || agg.has(uid);',
  '  const tampil = (uid) => !cakupanOutlet || cakupanOutlet.has(uid);',
  AUDIT
);
sabotase(
  'gagal memuat daftar per outlet jadi mengosongkan tabel, bukan menampilkan semua',
  RPT,
  '  const tampil = (uid) => !cakupanOutlet || cakupanOutlet.has(uid) || agg.has(uid);',
  '  const tampil = (uid) => cakupanOutlet?.has(uid) ?? false;',
  AUDIT
);

console.log('');
if (gagal === 0) console.log('Semua sabotase 0139 tertangkap. ✅');
else console.error(`${gagal} sabotase LOLOS.`);
process.exit(gagal === 0 ? 0 : 1);
