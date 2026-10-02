/**
 * SABOTASE: rekap reservasi harian bisa dijalankan & didiagnosa dari Admin Portal.
 *
 * ============ KENAPA BERKAS INI ADA ============
 *
 * Seluruh fitur ini ADALAH alat diagnosa. Kalau ia sendiri rusak diam-diam, ia
 * tidak cuma berhenti berguna — ia aktif menyesatkan: layarnya akan berkata
 * "semuanya siap" untuk pemasangan yang tidak pernah mengirim apa pun, dan
 * orang yang membacanya akan berhenti mencari di tempat yang benar.
 *
 * Itu lebih buruk daripada tidak ada layar sama sekali.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AKAR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const P = (rel) => path.join(AKAR, rel);

const FN = 'supabase/functions/send-reservation-digest/index.ts';
const MURNI = 'js/modules/notifications/diagnosa-rekap.js';
const SVC = 'js/modules/notifications/telegram.service.js';
const PAGE = 'js/modules/notifications/telegram.admin.page.js';
const DEPLOY = 'DEPLOY.md';

const asli = new Map();
for (const rel of [FN, MURNI, SVC, PAGE, DEPLOY]) asli.set(rel, fs.readFileSync(P(rel), 'utf8'));

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
  // `String.replace` dengan string hanya mengganti kemunculan PERTAMA.
  if (typeof dari === 'string' && isi.split(dari).length > 2) {
    gagal++;
    console.error(`❌ POLANYA MUNCUL >1 KALI: ${nama} di ${rel} — sabotasenya cuma mengenai yang pertama.`);
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

const TES = 'tools/test-diagnosa-rekap.mjs';
const AUDIT = 'tools/audit-rekap-reservasi.cjs';

console.log('SABOTASE "DIPANGGIL DARI BROWSER":');

sabotase(
  'preflight OPTIONS tidak dijawab — layar bilang "Failed to fetch", menuduh jaringan',
  FN,
  "  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });\n",
  '',
  AUDIT
);
sabotase(
  'CORS_HEADERS didefinisikan tapi jawabannya tidak memakainya',
  FN,
  "  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } });",
  "  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });",
  AUDIT
);

console.log('\nSABOTASE GERBANG:');

sabotase(
  '"lolos gerbang Supabase" dianggap sama dengan "dia admin"',
  FN,
  "    .in('role', ['super_admin', 'bu_admin']);",
  "    .in('role', ['super_admin', 'bu_admin', 'staff']);",
  AUDIT
);
sabotase(
  'JWT-nya tidak diverifikasi — token karangan ikut lolos',
  FN,
  '  const { data: userRes } = await sebagaiDia.auth.getUser();',
  '  const userRes = { user: { id: auth.slice(7) } };',
  AUDIT
);
sabotase(
  'verifikasi memakai service-role, yang tidak memverifikasi siapa pun',
  FN,
  '  const sebagaiDia = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } } });',
  '  const sebagaiDia = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { global: { headers: { Authorization: auth } } });',
  AUDIT
);

console.log('\nSABOTASE URUTAN RUTE:');

sabotase(
  'rute dipilih tanpa melihat event_key — tujuannya ditentukan urutan baris',
  FN,
  "      const ketemu = r.find((x) => x.event_key === u.k && (u.bu ? x.business_unit_id === buId : !x.business_unit_id));",
  '      const ketemu = r.find((x) => (u.bu ? x.business_unit_id === buId : !x.business_unit_id));',
  AUDIT
);
sabotase(
  '`reservation` didahulukan atas `reservation_digest`',
  FN,
  "      { k: 'reservation_digest', bu: true },\n      { k: 'reservation_digest', bu: false },\n      { k: 'reservation', bu: true },",
  "      { k: 'reservation', bu: true },\n      { k: 'reservation_digest', bu: true },\n      { k: 'reservation_digest', bu: false },",
  AUDIT
);
sabotase(
  'rute yang dipakai tidak dilaporkan — "jatuh ke rute Reservasi baru" jadi harus disimpulkan sendiri',
  FN,
  // Diikat ke tempat ia DIPAKAI, bukan ke tempat ia disusun: baris
  // penyusunnya penuh backtick dan `${…}`, dan menuliskannya sebagai pola di
  // sini sudah sekali memecahkan berkas ini sendiri.
  '      sumber_rute: rute.sumber,',
  "      sumber_rute: '',",
  AUDIT
);

console.log('\nSABOTASE DEDUPE:');

sabotase(
  'penanda ditulis dengan insert — pesan masuk, layar bilang gagal',
  FN,
  "    await admin\n      .from('telegram_notifications_sent')\n      .upsert({ kind: 'reservation_digest', ref: refDedupe }, { onConflict: 'kind,ref', ignoreDuplicates: true });",
  "    await admin.from('telegram_notifications_sent').insert({ kind: 'reservation_digest', ref: refDedupe });",
  AUDIT
);
sabotase(
  'cron ikut bisa memaksa — satu salah jadwal membanjiri grup',
  FN,
  '  if (!dryRun && sudahTerkirim && !paksa) {',
  '  if (false) {',
  AUDIT
);
sabotase(
  'pratinjau tidak menyebut penanda hari ini sudah ada',
  FN,
  '      sudah_dikirim_hari_ini: sudahTerkirim,\n',
  '',
  AUDIT
);

console.log('\nSABOTASE MODUL MURNI:');

sabotase(
  'dedupe terbaca sebagai "modul Reservasi mati" — orangnya dikirim ke tempat yang salah',
  MURNI,
  '  if (jawaban.skipped) {\n    return {\n      vonis: VONIS.SUDAH_DIKIRIM,',
  '  if (false) {\n    return {\n      vonis: VONIS.SUDAH_DIKIRIM,',
  TES
);
sabotase(
  '`reservation_digest` dianggap rute cadangan karena diawali `reservation`',
  MURNI,
  "  return !!s && !s.startsWith('reservation_digest');",
  "  return !!s && !s.includes('digest') === false ? false : !s.startsWith('reservation');",
  TES
);
sabotase(
  'vonis "siap" berhenti di situ — cron tidak pernah disebut sebagai sebab yang tersisa',
  MURNI,
  "      'Isi & tujuannya sudah benar. Kalau rekap paginya tetap tidak datang, yang kurang bukan di sini melainkan ' +\n      'CRON-nya: periksa `select jobname, active from cron.job` dan pastikan header Authorization ikut terkirim — ' +\n      'tanpa header itu balasannya 401 sementara cron tetap melaporkan \"succeeded\".',",
  "      'Semuanya sudah beres.',",
  AUDIT
);
sabotase(
  'pesan galat aslinya dirangkum jadi satu kalimat umum',
  MURNI,
  '      saran: teks(galat.message ?? galat),',
  "      saran: 'Terjadi kesalahan.',",
  AUDIT
);
sabotase(
  'baris tanpa chat_id dianggap siap',
  MURNI,
  '  if (!baris?.chat_id) {',
  '  if (false) {',
  TES
);
sabotase(
  'daftar outlet kosong dianggap siap, bukan "modul mati"',
  MURNI,
  '  if (!daftar.length) {',
  '  if (false) {',
  TES
);

console.log('\nSABOTASE LAYANAN & LAYAR:');

sabotase(
  '`dry_run` tidak lagi boolean eksplisit — pratinjau jadi mengirim sungguhan',
  SVC,
  '    dry_run: dryRun === true,',
  '    dry_run: dryRun,',
  AUDIT
);
sabotase(
  'tombol Pratinjau memanggil tanpa dry run',
  PAGE,
  '        const jawaban = await jalankanRekapReservasi({ dryRun: true });',
  '        const jawaban = await jalankanRekapReservasi({ dryRun: false });',
  AUDIT
);
sabotase(
  'isi pesan yang akan dikirim tidak ditampilkan — tinggal ringkasan jumlah',
  PAGE,
  "String(t.preview ?? '')",
  "String('')",
  AUDIT
);
sabotase(
  'jawaban `skipped` tidak ditangani — ditolak diam-diam oleh dedupe',
  PAGE,
  '        if (jawaban?.skipped) {',
  '        if (false) {',
  AUDIT
);
sabotase(
  'kegagalan pemanggilan tidak lewat diagnosaRekap — pesan aslinya hilang',
  PAGE,
  '        gambar(diagnosaRekap(null, error));',
  "        box.innerHTML = '<p class=\"error-text\">Gagal.</p>';",
  AUDIT
);

console.log('\nSABOTASE DEPLOY.md:');

sabotase(
  'peringatan header Authorization wajib dihapus dari panduan deploy',
  DEPLOY,
  '> ⚠️ Header **`Authorization` wajib**.',
  '> Header Authorization opsional.',
  AUDIT
);

console.log('');
if (gagal === 0) console.log('Semua sabotase rekap reservasi tertangkap. ✅');
else console.error(`${gagal} sabotase LOLOS — pemeriksanya tidak menjaga apa yang dikiranya dijaga.`);
process.exit(gagal === 0 ? 0 : 1);
