/**
 * SABOTASE 0138 — istirahat & clock out otomatis.
 *
 * Dua janji yang dijaga di sini, dan dua-duanya diingkari tanpa satu pun error:
 *
 *   "tidak berpengaruh terhadap nbm sama sekali"
 *   "dianggap masuk seperti biasa TANPA LEMBUR"
 *
 * Yang terjadi kalau diingkari bukan aplikasi rusak, melainkan gaji orang yang
 * berubah diam-diam.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AKAR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const P = (rel) => path.join(AKAR, rel);

const MIG = 'supabase/migrations/0138_istirahat_dan_tutup_otomatis.sql';
const MURNI = 'js/modules/attendance/istirahat.js';
const HAL = 'js/modules/attendance/attendance.page.js';
const ADM = 'js/modules/attendance/attendance.admin.page.js';
const SVC = 'js/modules/attendance/attendance.service.js';
const NBM = 'js/modules/attendance/nbm.service.js';

const asli = new Map();
for (const rel of [MIG, MURNI, HAL, ADM, SVC, NBM]) asli.set(rel, fs.readFileSync(P(rel), 'utf8'));

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

const TES = 'tools/test-migrasi-0138.mjs';
const TES_MURNI = 'tools/test-istirahat.mjs';
const AUDIT = 'tools/audit-istirahat.cjs';

console.log('SABOTASE "TANPA LEMBUR" (clock out otomatis):');

sabotase(
  'ditutup di JAM PEMICU, bukan jam pulang shift — lembur yang tidak pernah terjadi',
  MIG,
  "      v_keluar := ((v_tanggal + case when v_shift.end_time <= v_shift.start_time then 1 else 0 end)\n                   + v_shift.end_time) at time zone 'Asia/Jakarta';",
  '      v_keluar := now();',
  TES
);
sabotase(
  'shift lintas tengah malam pulang di hari yang sama — jam keluar mendahului masuk',
  MIG,
  '      v_keluar := ((v_tanggal + case when v_shift.end_time <= v_shift.start_time then 1 else 0 end)',
  '      v_keluar := ((v_tanggal + 0',
  TES
);
sabotase(
  'penjaga "keluar tidak boleh mendahului masuk" dicabut',
  MIG,
  '    if v_keluar <= r.clock_in_at then',
  '    if false then',
  TES
);
sabotase(
  'tanggal kerja diambil dari UTC, bukan WIB — shift malam pindah hari',
  MIG,
  "    v_tanggal := (r.clock_in_at at time zone 'Asia/Jakarta')::date;",
  '    v_tanggal := r.clock_in_at::date;',
  AUDIT
);
sabotase(
  'baris yang ditebak sistem tidak lagi ditandai',
  MIG,
  '           auto_closed_at = now(),',
  '           auto_closed_at = null,',
  TES
);
sabotase(
  'sesi yang belum lewat batas ikut ditutup',
  MIG,
  '    continue when r.clock_in_at + make_interval(hours => floor(v_set.auto_close_after_hours)::int,',
  '    continue when false and r.clock_in_at + make_interval(hours => floor(v_set.auto_close_after_hours)::int,',
  TES
);

console.log('\nSABOTASE ISTIRAHAT:');

sabotase(
  'jendela jam hanya aturan tampilan — server berhenti menegakkannya',
  MIG,
  "  if v_set.break_mode = 'ditentukan' then",
  '  if false then',
  TES
);
sabotase(
  'jendela lintas tengah malam salah dibandingkan di server',
  MIG,
  '    if v_set.break_start <= v_set.break_end then',
  '    if true then',
  AUDIT
);
sabotase(
  'lupa kembali ditutup di "sekarang", bukan mulai + 2 jam',
  MIG,
  '     set selesai_at = b.mulai_at + batas_istirahat(),',
  '     set selesai_at = now(),',
  TES
);
sabotase(
  'istirahat yang ditutup otomatis tidak ditandai',
  MIG,
  '         otomatis = true\n    from sasaran s',
  '         otomatis = false\n    from sasaran s',
  TES
);
// Indeks ini menjaga hal yang TIDAK BISA diuji dari satu koneksi: dua ketukan
// tombol beruntun yang keduanya lolos pemeriksaan sebelum salah satunya
// menulis. `mulai_istirahat` sudah memeriksanya lebih dulu, jadi penolakan
// biasa tetap terjadi walau indeksnya dicabut — sabotase pertama lolos persis
// begitu. Sekarang tesnya memeriksa keberadaan indeksnya sendiri.
sabotase('dua istirahat terbuka sekaligus dibiarkan', MIG, 'create unique index if not exists attendance_breaks_satu_berjalan', 'create unique index if not exists attendance_breaks_nonaktif', TES);
sabotase(
  'clock out tidak lagi menutup istirahat yang berjalan — rekap berisi istirahat yang berakhir sesudah pulang',
  MIG,
  'create trigger trg_tutup_istirahat_saat_pulang',
  'create trigger trg_tutup_istirahat_nonaktif',
  TES
);
sabotase(
  'istirahat ditutup di jam pulang tanpa dijepit 2 jam — janji di layar staff dilanggar',
  MIG,
  '       set selesai_at = least(new.clock_out_at, mulai_at + batas_istirahat()),',
  '       set selesai_at = new.clock_out_at,',
  TES
);
sabotase(
  'kembali dari istirahat ikut dibatasi jendela — menghukum yang kembali lebih awal',
  MIG,
  "  update attendance_breaks\n     set selesai_at = now(), otomatis = false",
  "  if (select break_mode from setelan_presensi(v_rec.outlet_id)) = 'ditentukan' then\n    raise exception 'di luar jam';\n  end if;\n  update attendance_breaks\n     set selesai_at = now(), otomatis = false",
  AUDIT
);
sabotase(
  'kolom setelan dikembalikan `not null default` — outlet tidak bisa mewarisi angka BU',
  MIG,
  '  standard_work_hours numeric check (standard_work_hours > 0 and standard_work_hours <= 24),',
  '  standard_work_hours numeric not null default 8 check (standard_work_hours > 0 and standard_work_hours <= 24),',
  AUDIT
);
sabotase(
  'dua baris setelan bawaan BU jadi mungkin',
  MIG,
  'create unique index if not exists attendance_settings_bu_uk\n  on attendance_settings(business_unit_id) where outlet_id is null;',
  '',
  TES
);

console.log('\nSABOTASE ATURAN MURNI:');

sabotase(
  'jendela lintas tengah malam salah dibandingkan',
  MURNI,
  '  return a <= b ? j >= a && j <= b : j >= a || j <= b;',
  '  return j >= a && j <= b;',
  TES_MURNI
);
sabotase(
  'jam tutup boleh mendahului jam masuk',
  MURNI,
  "  if (waktu <= masuk) return { waktu: masuk + standar, dari: 'standar' };",
  '',
  TES_MURNI
);
sabotase(
  'shift lintas hari tidak digeser ke besok',
  MURNI,
  '  const lintasHari = b <= a ? 24 * 60 : 0;',
  '  const lintasHari = 0;',
  TES_MURNI
);
sabotase(
  'penimpaan setelan jadi per BARIS, bukan per kolom — outlet kehilangan jam kerja BU',
  MURNI,
  '    const dariBu = bu?.[nama];\n    if (dariBu !== null && dariBu !== undefined && dariBu !== \'\') return ubah(dariBu);',
  '    if (outlet) return undefined;\n    const dariBu = bu?.[nama];\n    if (dariBu !== null && dariBu !== undefined && dariBu !== \'\') return ubah(dariBu);',
  TES_MURNI
);
sabotase(
  'istirahat berjalan tidak dijepit 2 jam — rekap tumbuh terus lalu berbeda dari angka final',
  MURNI,
  '      menit += (Math.min(sekarangMs, batas) - mulai) / 60000;',
  '      menit += (sekarangMs - mulai) / 60000;',
  TES_MURNI
);
sabotase(
  'sebab tombol istirahat mati tidak lagi menyebut jamnya',
  MURNI,
  '      sebab: `Istirahat hanya bisa diambil antara ${setelan.breakStart.slice(0, 5)} dan ${setelan.breakEnd.slice(0, 5)}.`',
  "      sebab: 'Belum bisa istirahat.'",
  TES_MURNI
);

console.log('\nSABOTASE JANJI "TIDAK MENYENTUH NBM":');

sabotase(
  'NBM mulai membaca istirahat — gaji orang berkurang diam-diam',
  NBM,
  'export function calculateNbm(record, config, tiers, holidayDates) {',
  'export function calculateNbm(record, config, tiers, holidayDates) {\n  // menitIstirahat dipotong dari jam kerja\n  const menitIstirahat = 0;',
  AUDIT
);

console.log('\nSABOTASE GERBANG BUKTI ISTIRAHAT:');

sabotase(
  'kolom bukti cuma ada di `create table` — database yang sudah terpasang tidak akan mendapatkannya',
  MIG,
  'alter table attendance_breaks add column if not exists foto_selesai text;',
  '',
  AUDIT
);
sabotase(
  'foto tidak lagi wajib saat mulai istirahat',
  MIG,
  "  if v_foto is null then\n    raise exception 'Ambil foto selfie dulu sebelum mulai istirahat.';\n  end if;",
  '',
  TES
);
sabotase(
  'bentuk lama tanpa foto dibiarkan hidup — pintu belakang untuk PWA lama',
  MIG,
  'drop function if exists mulai_istirahat(uuid);',
  '',
  AUDIT
);
sabotase(
  'geofence tidak diperiksa saat mulai istirahat — bisa ditekan dari rumah',
  HAL,
  "await pastikanDiAreaOutlet(openSession, 'Istirahat');",
  '',
  AUDIT
);
sabotase(
  'GPS yang gagal dibaca diloloskan — gerbangnya bisa dilewati dengan mematikan izin lokasi',
  HAL,
  '    throw new Error(`Lokasi tidak terbaca, jadi ${aksi} belum bisa dicatat. Nyalakan GPS lalu coba lagi.`);',
  '    return;',
  AUDIT
);
sabotase(
  'kecocokan wajah tidak diperiksa saat mulai istirahat',
  HAL,
  "            throw new Error('Wajah tidak cocok dengan yang terdaftar. Istirahat ditolak.');",
  '',
  AUDIT
);

console.log('\nSABOTASE PERINGATAN & PENEGASAN:');

sabotase(
  'Clock Out tetap tampil berdampingan saat istirahat — orang pulang padahal cuma mau kembali',
  HAL,
  '          berjalan\n            ? `<button class="primary" id="btn-istirahat-selesai" disabled>↩️ Kembali dari Istirahat</button>`\n            : `<button class="primary" id="btn-clock-out" disabled>Clock Out</button>`',
  '          `<button class="primary" id="btn-clock-out" disabled>Clock Out</button>`',
  AUDIT
);
sabotase(
  'peringatan tegas diganti kalimat yang meremehkan',
  HAL,
  '⚠️ Wajib absen kembali begitu istirahatmu selesai.',
  'Kalau lupa, kamu otomatis dianggap kembali 2 jam sesudah mulai.',
  AUDIT
);
sabotase('dialog penegasan clock in dihapus', HAL, /title: isStoring \? '🚩 Kamu sudah Clock In \(Tugas Luar\)' : '👋 Kamu sudah Clock In'/g, "title: 'x'", AUDIT);
sabotase('dialog penegasan clock out dihapus', HAL, /title: '🙌 Kamu sudah Clock Out'/g, "title: 'x'", AUDIT);
sabotase('dialog penegasan mulai istirahat dihapus', HAL, /title: '☕ Istirahatmu dimulai'/g, "title: 'x'", AUDIT);
sabotase('dialog penegasan kembali istirahat dihapus', HAL, /title: '👋 Selamat bekerja kembali'/g, "title: 'x'", AUDIT);

console.log('\nSABOTASE LAYAR:');

// REGEX GLOBAL, bukan string.
//
// `String.replace` dengan sebuah STRING hanya mengganti kemunculan PERTAMA.
// Ketiga penanda ini masing-masing muncul dua kali (di template HTML dan di
// `querySelector`), jadi versi string-nya menyisakan satu — dan auditnya, yang
// cuma bertanya "apakah kata ini ada", tetap hijau.
//
// Jebakan yang sama sudah tercatat tiga kali di repo ini. Ini yang keempat.
sabotase('tombol istirahat dihapus dari layar staff', HAL, /btn-istirahat-mulai/g, 'btn-istirahat-x', AUDIT);
sabotase('layar berhenti mengatakan istirahat tidak mengurangi NBM', HAL, /tidak mengurangi NBM/g, 'dihitung terpisah', AUDIT);
sabotase('panel setelan istirahat dihapus dari Admin Portal', ADM, /istirahat-setelan/g, 'istirahat-x', AUDIT);
sabotase('penanda ⏱ otomatis dihapus dari rekap', ADM, 'r.auto_closed_at', 'false', AUDIT);
sabotase('kolom Istirahat dihapus dari rekap', ADM, '<th>Istirahat</th>', '', AUDIT);
sabotase(
  'istirahat diambil satu permintaan per baris',
  ADM,
  'petaIstirahat = await listIstirahatBanyak(records.map((r) => r.id));',
  'petaIstirahat = new Map();',
  AUDIT
);
sabotase(
  'jalan cadangan saat kolom auto_closed_* belum ada dicabut',
  SVC,
  '    return await ambil(KOLOM_REKAP_PRESENSI);',
  '    throw e;',
  AUDIT
);

console.log('');
if (gagal === 0) console.log('Semua sabotase 0138 tertangkap. ✅');
else console.error(`${gagal} sabotase LOLOS.`);
process.exit(gagal === 0 ? 0 : 1);
