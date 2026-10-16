/**
 * SABOTASE: modul Konten Sosmed (0163 + R2).
 *
 * ============ KENAPA BERKAS INI ADA ============
 *
 * Modul ini memegang berkas yang hanya ada SATU salinannya, di penyimpanan yang
 * akan menghapusnya sendiri. Hampir semua cara ia rusak tidak berbunyi:
 *
 *   penanda bersih diisi walau
 *     ada yang gagal           -> berkas keluar dari antrean SELAMANYA, bocor
 *                                 tanpa jejak, tetap memakan kuota.
 *   baris dicatat sebelum PUT  -> berkas "sah" yang objeknya tidak pernah ada.
 *   konfirmasi kehilangan
 *     kalimat penghapusan      -> tujuh hari kemudian videonya hilang, dan
 *                                 tidak ada tempat lain untuk mencarinya.
 *   trigger sampah kehilangan
 *     `security definer`       -> staff ditolak pada tabel yang tidak pernah ia
 *                                 sebut. Sudah terjadi sekali.
 *
 * Tidak satu pun dari itu muncul sebagai pesan merah di mana pun. Yang
 * diperiksa di sini bukan kodenya — melainkan apakah PEMERIKSANYA benar-benar
 * masih menjaga sesuatu.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AKAR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const P = (rel) => path.join(AKAR, rel);

const MIG = 'supabase/migrations/0163_konten_sosmed.sql';
const ATURAN = 'js/modules/konten/aturan-konten.js';
const SVC = 'js/modules/konten/konten.service.js';
const STAF = 'js/modules/konten/konten.page.js';
const ADM = 'js/modules/konten/konten.admin.page.js';
const R2 = 'supabase/functions/konten-r2/index.ts';
const PURGE = 'supabase/functions/purge-konten/index.ts';
const TABS = 'js/core/admin-tabs.js';

const BERKAS = [MIG, ATURAN, SVC, STAF, ADM, R2, PURGE, TABS];
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
  // Pola yang muncul lebih dari sekali cuma merusak yang PERTAMA — dan kalau
  // yang pertama kebetulan ada di komentar, yang dirusak adalah kalimat
  // penjelas, bukan kodenya. Harness yang menguji komentar melaporkan
  // "tertangkap" untuk penjaga yang sudah dicabut.
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

const AUDIT = 'tools/audit-konten.cjs';
const PGLITE = 'tools/test-migrasi-0163.mjs';
const MURNI = 'tools/test-aturan-konten.mjs';

// =====================================================================
console.log('SABOTASE DATABASE (0163):');
// =====================================================================

// ============ YANG INI DIUJI DUA PEMERIKSA ============
//
// `security definer` dicabut: auditnya membacanya sebagai teks, dan tes
// PGlite-nya MENJALANKANNYA sebagai `authenticated`. Keduanya harus merah —
// kalau cuma auditnya yang merah, tesnya tidak pernah benar-benar menguji
// jalur staff-menghapus-berkasnya-sendiri.
sabotase(
  'trigger sampah kehilangan `security definer` — staff ditolak pada tabel yang tidak pernah ia sebut',
  MIG,
  'language plpgsql\nsecurity definer\nset search_path = public\nas $$\nbegin\n  insert into konten_berkas_sampah',
  'language plpgsql\nset search_path = public\nas $$\nbegin\n  insert into konten_berkas_sampah',
  AUDIT
);
sabotase(
  'trigger sampah kehilangan `security definer` — DAN tes PGlite harus ikut merah',
  MIG,
  'language plpgsql\nsecurity definer\nset search_path = public\nas $$\nbegin\n  insert into konten_berkas_sampah',
  'language plpgsql\nset search_path = public\nas $$\nbegin\n  insert into konten_berkas_sampah',
  PGLITE
);

sabotase(
  'trigger sampah dicabut seluruhnya — objek R2 bocor lewat SETIAP jalan hilangnya baris',
  MIG,
  '  after delete on konten_berkas\n  for each row\n  execute function catat_sampah_berkas_konten();',
  '  after delete on konten_berkas\n  for each row\n  when (false)\n  execute function catat_sampah_berkas_konten();',
  AUDIT
);

sabotase(
  'batas 3 berkas dinaikkan jadi batas yang tidak membatasi',
  MIG,
  'if v_jumlah >= 3 then',
  'if v_jumlah >= 300 then',
  AUDIT
);

sabotase(
  "`tandai_tugas_disetor` kehilangan `status = 'belum'` — berkas baru menurunkan tugas yang sudah selesai",
  MIG,
  "     and status = 'belum';\n  return new;",
  '     ;\n  return new;',
  AUDIT
);

sabotase(
  'indeks unik tugas mingguan dicabut — dua staff bersamaan membuat dua tugas untuk minggu yang sama',
  MIG,
  'create unique index if not exists konten_tugas_mingguan_uk',
  'create index if not exists konten_tugas_mingguan_uk',
  AUDIT
);

sabotase(
  'policy update `konten_tugas` dibuka untuk siapa pun yang lolos select — staff bisa menjadwalkan penghapusan',
  MIG,
  'for update using (is_bu_admin(auth.uid(), business_unit_id))\n  with check (is_bu_admin(auth.uid(), business_unit_id));',
  'for update using (has_bu_scope(auth.uid(), business_unit_id))\n  with check (has_bu_scope(auth.uid(), business_unit_id));',
  AUDIT
);

sabotase(
  'RLS `konten_berkas_sampah` dimatikan — daftar perintah hapus terbuka untuk siapa pun',
  MIG,
  'alter table konten_berkas_sampah enable row level security;',
  '-- (dimatikan)',
  AUDIT
);

// =====================================================================
console.log('\nSABOTASE ATURAN MURNI:');
// =====================================================================

// Dua pemeriksa lagi: auditnya membaca penjaganya, tes murninya MENGUJI
// akibatnya. Penjaga yang dicabut tanpa satu pun tes merah adalah penjaga yang
// tidak pernah dites.
sabotase(
  "penjaga `hariSetor === ''` dicabut — Number('') adalah 0, jadi semua outlet jadi hari Minggu",
  ATURAN,
  "if (hariSetor === null || hariSetor === undefined || hariSetor === '') return '';",
  'if (hariSetor === null || hariSetor === undefined) return .;'.replace('.', "''"),
  AUDIT
);
sabotase(
  "penjaga `hariSetor === ''` dicabut — DAN tes murni harus ikut merah",
  ATURAN,
  "if (hariSetor === null || hariSetor === undefined || hariSetor === '') return '';",
  'if (hariSetor === null || hariSetor === undefined) return .;'.replace('.', "''"),
  MURNI
);

sabotase(
  'rentang hari 0–6 tidak lagi diperiksa — hari ke-9 menghasilkan tenggat di minggu depan',
  ATURAN,
  'if (!d || !Number.isInteger(h) || h < 0 || h > 6) return',
  'if (!d) return',
  AUDIT
);

// ============ SATU SABOTASE YANG SAYA CABUT SENDIRI ============
//
// Percobaan pertama di sini mengganti `sumber ?? {}` jadi `sumber || {}` dan
// LOLOS — tesnya tetap hijau. Dan tesnya BENAR: untuk nilai yang sebenarnya
// masuk ke fungsi ini, `||` berperilaku sama persis dengan `??`. Yang salah
// bukan tesnya, melainkan sabotasenya: ia merusak gaya tulis, bukan jawaban.
//
// Jadi sabotasenya diganti dengan bentuk yang BENAR-BENAR merusak — penjaga
// null dicabut seluruhnya. Mencatatnya di sini, bukan menghapusnya diam-diam,
// karena "sabotase yang lolos" dan "sabotase yang tidak menguji apa pun"
// terlihat sama di layar dan artinya berlawanan.
sabotase(
  'penjaga null di `briefEfektif` dicabut — pemanggil yang mengirim hasil pencarian gagal membuat layarnya mati',
  ATURAN,
  'const o = sumber ?? {};',
  'const o = sumber;',
  MURNI
);

sabotase(
  'brief bawaan diganti string kosong — staff melihat brief KOSONG dan tidak tahu harus mengambil apa',
  ATURAN,
  "return { teks: BRIEF_BAWAAN, asal: 'bawaan' };",
  "return { teks: '', asal: 'bawaan' };",
  MURNI
);

// =====================================================================
console.log('\nSABOTASE LAYANAN:');
// =====================================================================

sabotase(
  'nol baris dari RLS dibiarkan di `simpanSetelanOutlet` — layar bilang "disimpan", tidak ada yang tersimpan',
  SVC,
  "if (!data?.length) throw new Error(pesanTolakan(new Error('row-level security'), 'menyimpan setelan konten'));",
  '/* dibuang */',
  AUDIT
);

sabotase(
  'nol baris dari RLS dibiarkan di `tandaiSelesai` — admin menandai selesai tanpa satu pun perubahan tersimpan',
  SVC,
  "if (!data?.length) throw new Error(pesanTolakan(new Error('row-level security'), 'menandai tugas'));",
  '/* dibuang */',
  AUDIT
);

sabotase(
  '`kirimKeR2` diganti fetch — batang kemajuan hilang, dan staff menutup aplikasinya di 80%',
  SVC,
  'const xhr = new XMLHttpRequest();',
  'const xhr = { upload: {}, open() {}, send() {}, setRequestHeader() {} };',
  AUDIT
);

// ============ SABOTASE YANG MENGEMBALIKAN BUG SUNGGUHAN ============
//
// Bentuk ini BUKAN hipotetis: ia versi pertama yang dikirim ke produksi, dan
// gejalanya "Jadwal setor outlet ini belum lengkap" di layar outlet yang
// jadwalnya sudah benar.
sabotase(
  '`insert` diganti `upsert` lagi — ON CONFLICT tak bisa menyimpulkan indeks partial, tugasnya tidak pernah lahir',
  SVC,
  'const { error: galatBuat } = await supabase.from(\'konten_tugas\').insert({',
  'const { error: galatBuat } = await supabase.from(\'konten_tugas\').upsert({',
  AUDIT
);

sabotase(
  'galat pembuatan tugas ditelan lagi — null yang dibaca layar sebagai jadwal yang salah',
  SVC,
  "if (galatBuat && galatBuat.code !== '23505') {",
  'if (false) {',
  AUDIT
);

sabotase(
  'kedua sebab dilebur jadi null lagi — satu kalimat untuk dua keadaan yang berbeda',
  SVC,
  "      'Tugas minggu ini sudah dibuat tapi tidak bisa dibaca kembali. Biasanya soal izin akses, bukan jadwalnya \u2014 beri tahu admin.'",
  "      'Gagal.'",
  AUDIT
);

sabotase(
  'badan galat Edge Function tidak dibuka — "non-2xx status code" menyembunyikan "setelan R2 belum lengkap"',
  SVC,
  'if (isi?.error) pesan = isi.error;',
  '/* dibuang */',
  AUDIT
);

sabotase(
  '`urlUnggah` mulai mengirim kunci dari browser — satu pemanggil bisa menimpa berkas outlet lain',
  SVC,
  "return panggilR2({ aksi: 'upload-url', tugas_id: tugasId, jenis, ext });",
  "return panggilR2({ aksi: 'upload-url', tugas_id: tugasId, jenis, ext, r2_key: 'bebas' });",
  AUDIT
);

// =====================================================================
console.log('\nSABOTASE STAFF APP:');
// =====================================================================

// ============ URUTANNYA, BUKAN KEBERADAANNYA ============
//
// Sabotase ini TIDAK menghapus apa pun: kedua panggilan tetap ada, dan
// auditnya tetap menemukan keduanya. Yang berubah cuma urutannya — dan itu
// cukup untuk meninggalkan baris yang menunjuk objek yang tidak pernah ada.
sabotase(
  '`catatBerkas` dipindah ke SEBELUM unggahannya — berkas "sah" yang objeknya tidak pernah ada',
  STAF,
  'await kirimKeR2(url, file, {',
  'await catatBerkas({ tugasId: tugas.id, jenis, r2Key: kunci, namaAsli: file.name, ukuran: file.size });\n          await kirimKeR2(url, file, {',
  AUDIT
);

sabotase(
  'dua input berkas dilebur jadi satu — staff memilih foto saat yang diminta video, ketahuan sesudah 141 MB',
  STAF,
  '<input type="file" id="kt-file-video" accept="video/*" hidden />',
  '<input type="file" id="kt-file-video" hidden />',
  AUDIT
);

sabotase(
  "`input.value = ''` dipindah ke sesudah return — memilih berkas yang sama dua kali tidak memicu apa pun",
  STAF,
  "        input.value = '';\n        if (!file) return;",
  "        if (!file) return;\n        input.value = '';",
  AUDIT
);

sabotase(
  'Staff App memakai jalur hapus milik admin — tombol yang selalu ditolak Edge Function',
  STAF,
  'hapusBerkasSendiri(btn.dataset.id)',
  'hapusBerkasR2(btn.dataset.id)',
  AUDIT
);

sabotase(
  'outlet tanpa jadwal ikut ditampilkan — staff mengira ia lupa mengerjakan sesuatu yang tidak ada',
  STAF,
  'const ikut = outlets.filter((o) => setelanPer.has(o.id));',
  'const ikut = outlets;',
  AUDIT
);

// =====================================================================
console.log('\nSABOTASE ADMIN PORTAL:');
// =====================================================================

// ============ TIGA CARA SATU KONFIRMASI BERHENTI MENJAGA ============
//
// Dialognya dicabut; dialognya tetap muncul tapi kalimatnya dilunakkan;
// dialognya tetap muncul dengan kalimat utuh tapi jawabannya diabaikan.
// Hanya yang pertama terlihat dari layar.
sabotase(
  'konfirmasi Tandai Selesai kehilangan kalimat "dihapus otomatis" — tombolnya terbaca seperti penanda biasa',
  ADM,
  'Berkasnya akan dihapus otomatis dari penyimpanan 7 hari setelah ini. ',
  'Setoran ini akan ditutup. ',
  AUDIT
);

sabotase(
  'jawaban konfirmasi Tandai Selesai diabaikan — menekan Batal tetap memulai hitungan ke penghapusan',
  ADM,
  '          if (!yakin) return;\n        }\n        try {\n          await tandaiSelesai(',
  '        }\n        try {\n          await tandaiSelesai(',
  AUDIT
);

sabotase(
  'kekurangan setoran tidak lagi disebut — admin menutup setoran yang videonya belum masuk',
  ADM,
  "(k.lengkap ? '' : ` Catatan: setoran ini masih kurang ${k.kurang.join(' dan ')}.`)",
  "''",
  AUDIT
);

sabotase(
  'penjaga hari setor di dialog dicabut — pilihan kosong tersimpan diam-diam sebagai Minggu',
  ADM,
  'if (!Number.isInteger(hari) || hari < 0 || hari > 6) return toast',
  'if (false) return toast',
  AUDIT
);

sabotase(
  '`tandaiDiunduh` dicabut dari ketukan unduh — kolom "sudah diunduh" selamanya kosong',
  ADM,
  "  panel.querySelector('#kta-unduh').addEventListener('click', () => {\n    tandaiDiunduh(tugasId)",
  "  panel.querySelector('#kta-unduh').addEventListener('click', () => {\n    Promise.resolve(tugasId)",
  AUDIT
);

sabotase(
  'ringkasan dihitung dari daftar yang sudah disaring — banner "semua beres" di atas lima outlet yang belum setor',
  ADM,
  'const r = ringkasAntrean(tugas, ctx.hariIni);',
  'const r = ringkasAntrean(terlihat, ctx.hariIni);',
  AUDIT
);

sabotase(
  'tab dicabut dari katalog — modulnya menyala, layarnya ada, dan tabnya tidak pernah muncul',
  TABS,
  "  { code: 'konten_sosmed', label: 'Konten Sosmed', group: 'Modul lain' },",
  '',
  AUDIT
);

// =====================================================================
console.log('\nSABOTASE EDGE FUNCTION konten-r2:');
// =====================================================================

sabotase(
  'kunci unggah diterima dari browser — seluruh bucket terbuka untuk siapa pun yang punya satu tugas sah',
  R2,
  "const kunci = susunKunci(tugas.outlet_id, tugas.id, jenis, String(body.ext ?? ''));",
  "const kunci = String(body.r2_key ?? '');",
  AUDIT
);

sabotase(
  'id acak dicabut dari kunci — berkas satu outlet bisa ditimpa outlet lain',
  R2,
  'const acak = crypto.randomUUID();',
  "const acak = 'tetap';",
  AUDIT
);

sabotase(
  "unggahan ke tugas 'selesai' diizinkan — berkas baru yang langsung masuk antrean penghapusan",
  R2,
  "if (tugas.status === 'selesai') {",
  'if (false) {',
  AUDIT
);

sabotase(
  'JWT pemanggil tidak diverifikasi — bucket terbuka untuk siapa pun yang punya anon key',
  R2,
  'await admin.auth.getUser(token)',
  'await Promise.resolve({ data: { user: { id: token } }, error: null })',
  AUDIT
);

sabotase(
  'wewenang tidak lagi diperiksa terhadap `membership_scopes` — RLS tidak berlaku di sini, tidak ada yang menolak otomatis',
  R2,
  "    .from('membership_scopes')",
  "    .from('profiles')",
  AUDIT
);

sabotase(
  '`view-url` tidak lagi memastikan kuncinya milik tugas itu — URL untuk kunci mana pun di bucket',
  R2,
  "      .eq('tugas_id', tugas.id)\n      .eq('r2_key', kunci)",
  "      .eq('tugas_id', tugas.id)",
  AUDIT
);

sabotase(
  'aksi `delete` dibuka untuk staff — setoran orang lain bisa dihapus permanen',
  R2,
  "if (!adminBu) return json({ error: 'Hanya Admin BU yang bisa menghapus berkas.' }, 403);",
  '/* dibuang */',
  AUDIT
);

sabotase(
  'pemeriksaan secret dicabut — URL yang TERLIHAT sah lalu ditolak R2 dengan XML yang tidak menyebut sebabnya',
  R2,
  'if (!nilai) return json({ error: `Setelan R2 belum lengkap: ${nama} belum diisi di secret Edge Function.` }, 500);',
  '/* dibuang */',
  AUDIT
);

// =====================================================================
console.log('\nSABOTASE Edge Function purge-konten:');
// =====================================================================

sabotase(
  'penanda bersih diisi walau ada berkas yang gagal — berkas itu keluar dari antrean SELAMANYA',
  PURGE,
  '    if (semuaBeres) {',
  '    if (true) {',
  AUDIT
);

sabotase(
  '404 dianggap gagal — kunci yang memang sudah tidak ada dicoba lagi setiap malam, selamanya',
  PURGE,
  'return res.ok || res.status === 404;',
  'return res.ok;',
  AUDIT
);

sabotase(
  'baris dihapus sebelum penandanya — pekerjaan ini mengejar kunci yang sudah tidak ada',
  PURGE,
  "      await admin.from('konten_tugas').update({ berkas_dihapus_at: new Date().toISOString() }).eq('id', t.id);",
  "      await admin.from('konten_berkas').delete().eq('tugas_id', t.id);\n      await admin.from('konten_tugas').update({ berkas_dihapus_at: new Date().toISOString() }).eq('id', t.id);",
  AUDIT
);

sabotase(
  'pembersih sampah dicabut — objek yang barisnya hilang tidak muncul di layar mana pun',
  PURGE,
  "    .from('konten_berkas_sampah')\n    .select('r2_key')",
  "    .from('konten_tugas')\n    .select('id')",
  AUDIT
);

sabotase(
  '`CRON_SECRET` tidak diperiksa — siapa pun yang tahu URL-nya bisa memicu penghapusan',
  PURGE,
  "const CRON_SECRET = Deno.env.get('CRON_SECRET');",
  'const RAHASIA_CRON = undefined;',
  AUDIT
);

sabotase(
  '`dry_run` dicabut — tidak ada cara memastikan cron-nya mengenai sesuatu sebelum ia menghapus',
  PURGE,
  "  const dryRun = body.dry_run === true;",
  '  const dryRun = false;',
  AUDIT
);

console.log('');
if (gagal === 0) console.log('Semua sabotase tertangkap. ✅');
else console.error(`${gagal} sabotase LOLOS / tidak terpasang.`);
process.exit(gagal === 0 ? 0 : 1);
