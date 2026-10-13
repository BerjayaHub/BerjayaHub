/**
 * SABOTASE: tugas luar di jadwal shift (0160).
 *
 * ============ KENAPA BERKAS INI ADA ============
 *
 * 0160 menambahkan KEADAAN KETIGA ke kolom yang sudah dibaca belasan tempat
 * sejak 0034. Tidak satu pun pembaca lama itu akan melempar galat kalau ia
 * salah baca: baris tugas luar ber-`is_off` false dan ber-`shift_id` null, jadi
 * setiap `is_off ? … : …` menjatuhkannya ke cabang "shift" — shift tanpa nama,
 * tanpa jam, tanpa satu pun tanda.
 *
 * Yang disabotase di sini bukan "apakah fiturnya jalan", tapi URUTAN dan
 * KEPASANGAN: cabang yang benar tapi ditaruh sesudah penjaga yang menelannya,
 * kolom yang tidak ikut di-select, pasangan `is_off = false AND shift_id is not
 * null` yang disederhanakan jadi satu baris. Ketiganya meninggalkan kode yang
 * TERLIHAT benar.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AKAR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const P = (rel) => path.join(AKAR, rel);

const MIG = 'supabase/migrations/0160_tugas_luar_di_jadwal.sql';
const MURNI = 'js/modules/shift/tugas-luar.js';
const CUTI = 'js/modules/shift/cuti-jadwal.js';
const SVC = 'js/modules/shift/shift.service.js';
const ADM = 'js/modules/shift/shift.admin.page.js';
const SP = 'js/modules/shift/shift.page.js';
const AP = 'js/modules/attendance/attendance.page.js';
const M109 = 'supabase/migrations/0109_lencana_draft_semua_outlet.sql';
const WARNA = 'js/modules/shift/warna-shift.js';
const CSS = 'css/styles.css';

const asli = new Map();
for (const rel of [MIG, MURNI, CUTI, SVC, ADM, SP, AP, M109, WARNA, CSS]) asli.set(rel, fs.readFileSync(P(rel), 'utf8'));

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
  // Mode periksa pola tidak memulihkan apa pun, karena ia tidak pernah merusak
  // apa pun — dan `writeFileSync` dengan isi yang sama tetap sebuah penulisan.
  // Alasan panjangnya di `sabotase-master-supplier.mjs`.
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

const PG = 'tools/test-migrasi-0160.mjs';
const TES = 'tools/test-tugas-luar.mjs';
const AUDIT = 'tools/audit-tugas-luar.cjs';

// ---------------------------------------------------------------
console.log('SABOTASE URUTAN — CABANG YANG BENAR, DITARUH TERLAMBAT:');
// ---------------------------------------------------------------
//
// Ketiga sabotase ini meninggalkan kodenya UTUH dan terbaca benar. Yang diubah
// cuma tempatnya, dan di tempat yang salah ia tidak pernah tercapai.

sabotase(
  'cabang `is_tugas_luar` dipindah SESUDAH penjaga "tanpa jam mulai" — tak pernah tercapai',
  MIG,
  `  if v_jadwal.is_tugas_luar then
    update attendance_records
       set late_status = 'tugas_luar', late_minutes = null, shift_name = null
     where id = p_record;
    return query select 'tugas_luar'::text, null::int, null::text;
    return;
  end if;

  if not v_jadwal.is_off and v_jadwal.start_time is null then`,
  `  if not v_jadwal.is_off and v_jadwal.start_time is null then`,
  PG
);
// ============ SABOTASE YANG DIGANTI, DAN KENAPA ============
//
// Versi pertama di sini membalik urutan cabang `nilaiSel` — menaruh `is_off`
// lebih dulu — dan ia LOLOS. Bukan karena tesnya lemah: baris tugas luar
// ber-is_off false (dijamin constraint 0160), jadi membalik urutannya memang
// tidak mengubah satu pun hasil.
//
// Jadi yang salah adalah KLAIM saya di komentar `nilaiSel`, yang menyebut
// urutannya menentukan. Komentarnya dibetulkan, dan sabotasenya diganti dengan
// kegagalan yang NYATA: cabangnya hilang sama sekali, persis seperti
// perhitungan lama sebelum 0160.
sabotase(
  '`nilaiSel` kehilangan cabang tugas luarnya — sel digambar KOSONG, lalu ditimpa admin',
  MURNI,
  `  if (jadwal.is_tugas_luar) {
    const id = teks(jadwal.tugas_luar_type_id);`,
  `  if (false) {
    const id = teks(jadwal.tugas_luar_type_id);`,
  TES
);
sabotase(
  'cabang tugas luar di layar staff dipindah sesudah cabang shift',
  SP,
  '                        if (cur.is_tugas_luar) {',
  '                        if (false) {',
  AUDIT
);

// ---------------------------------------------------------------
console.log('\nSABOTASE KOLOM YANG TIDAK DIMINTA:');
// ---------------------------------------------------------------
//
// Kolom yang tidak diminta terbaca sebagai "tidak ada" — bukan galat. Jadi
// fiturnya mati total sementara setiap barisnya tetap terbaca benar.

sabotase(
  '`is_tugas_luar` tidak ikut di-select di `hitung_ulang_status_shift`',
  MIG,
  '  select ss.is_off, ss.is_tugas_luar, os.name as shift_name, os.start_time',
  '  select ss.is_off, os.name as shift_name, os.start_time',
  AUDIT
);
sabotase(
  'pembaca jadwal berhenti meminta kolom tugas luar',
  SVC,
  "      'id, user_id, work_date, shift_id, is_off, is_tugas_luar, tugas_luar_type_id, tugas_luar_outlet_id, ' +",
  "      'id, user_id, work_date, shift_id, is_off, ' +",
  AUDIT
);

// ---------------------------------------------------------------
console.log('\nSABOTASE CONSTRAINT TIGA KEADAAN:');
// ---------------------------------------------------------------

sabotase(
  'constraint lama `shift_or_off` tidak di-drop — setiap tugas luar ditolak database',
  MIG,
  'alter table shift_schedules drop constraint if exists shift_or_off;',
  '-- (dicabut)',
  PG
);
sabotase(
  'cabang SHIFT berhenti menolak kolom tugas luar — shift membawa jenis, rekapnya memuat hari yang tak pernah ada',
  MIG,
  `    (not is_off and not is_tugas_luar and shift_id is not null
       and tugas_luar_type_id is null and tugas_luar_outlet_id is null)`,
  `    (not is_off and not is_tugas_luar and shift_id is not null)`,
  PG
);
sabotase(
  'tugas luar tidak lagi WAJIB berjenis — rekap per jenis kehilangan barisnya diam-diam',
  MIG,
  `    or (is_tugas_luar and not is_off and shift_id is null
       and tugas_luar_type_id is not null)`,
  `    or (is_tugas_luar and not is_off and shift_id is null)`,
  PG
);
sabotase(
  'FK jenisnya jadi `cascade` — menghapus satu jenis MENGHAPUS HARI KERJA orang',
  MIG,
  'add column if not exists tugas_luar_type_id uuid references tugas_luar_types(id) on delete restrict;',
  'add column if not exists tugas_luar_type_id uuid references tugas_luar_types(id) on delete cascade;',
  PG
);

// ---------------------------------------------------------------
console.log('\nSABOTASE PENJAGA DATABASE:');
// ---------------------------------------------------------------

sabotase(
  'trigger silang-BU dibuang — admin BU A memakai jenis BU B, rekap BU B memuat orang yang bukan stafnya',
  MIG,
  '  before insert or update on shift_schedules',
  '  after truncate on shift_schedules',
  PG
);
// Dijaga AUDIT, bukan tes PGlite — dan itu bukan pilihan selera.
//
// PGlite menjalankan semuanya sebagai SUPERUSER, yang melewati RLS. Jadi
// `security definer` yang hilang tidak mengubah apa pun di sana: tesnya tetap
// hijau untuk fungsi yang akan gagal di Supabase, tempat RLS benar-benar
// berlaku. Versi pertama sabotase ini menunjuk PG dan LOLOS justru karena itu.
sabotase(
  'penjaga silang-BU bukan lagi `security definer` — RLS menutup bacaannya, dan ia menolak yang seharusnya lolos',
  MIG,
  `create or replace function jaga_jenis_tugas_luar()
returns trigger
language plpgsql
security definer`,
  `create or replace function jaga_jenis_tugas_luar()
returns trigger
language plpgsql`,
  AUDIT
);
sabotase(
  'trigger seed `business_units` dibuang — BU berikutnya lahir tanpa satu pun jenis',
  MIG,
  '  after insert on business_units',
  '  after truncate on business_units',
  PG
);
sabotase(
  '`rekap_tugas_luar` kehilangan penjaga scope — siapa pun bisa membaca rekap BU mana pun dengan menebak uuid',
  MIG,
  '     and has_bu_scope(auth.uid(), p_bu)',
  '     and true',
  PG
);
sabotase(
  "`late_status` tidak melebar ke 'tugas_luar' — setiap penyimpanan status itu ditolak check",
  MIG,
  "  check (late_status in ('ontime', 'tolerance', 'late', 'no_schedule', 'off_day', 'tugas_luar'));",
  "  check (late_status in ('ontime', 'tolerance', 'late', 'no_schedule', 'off_day'));",
  PG
);

// ---------------------------------------------------------------
console.log('\nSABOTASE `upsert` YANG MEMBIARKAN NILAI LAMA:');
// ---------------------------------------------------------------

sabotase(
  '`setSchedule` berhenti mengirim jenisnya — Tugas Luar → Libur meninggalkan jenis terisi',
  SVC,
  '      tugas_luar_type_id: isTugasLuar ? tugasLuarTypeId : null,',
  '',
  AUDIT
);
sabotase(
  '`setSchedule` berhenti mengirim `is_tugas_luar`',
  SVC,
  '      is_tugas_luar: !!isTugasLuar,',
  '',
  AUDIT
);

// ---------------------------------------------------------------
console.log('\nSABOTASE SANDI NILAI SEL:');
// ---------------------------------------------------------------

sabotase(
  'prefiks `tl:` hilang — jenis dan shift jadi tidak bisa dibedakan sama sekali',
  MURNI,
  "export const PREFIKS_TL = 'tl:';",
  "export const PREFIKS_TL = '';",
  TES
);
sabotase(
  'layar admin tidak lagi memakai `bacaNilaiSel` — nilai sel diurai sendiri di dua tempat',
  ADM,
  '        const niat = bacaNilaiSel(sel.value);',
  "        const niat = { mode: sel.value ? 'shift' : 'kosong', shiftId: sel.value, isOff: false, isTugasLuar: false, tugasLuarTypeId: null };",
  AUDIT
);
sabotase(
  'sel jadwal admin tidak lagi memakai `nilaiSel`',
  ADM,
  '                        const sel = nilaiSel(cur);',
  "                        const sel = cur ? (cur.is_off ? 'off' : cur.shift_id) : '';",
  AUDIT
);
sabotase(
  'pemeriksaan jenis di layar dicabut — penolakannya datang sebagai pesan constraint',
  ADM,
  '            const salah = periksaSelTugasLuar(niat, jenisTL);',
  '            const salah = null;',
  AUDIT
);
sabotase(
  'tab kelola jenis tidak memuat yang nonaktif — yang dinonaktifkan tak bisa diaktifkan lagi',
  ADM,
  '      daftar = await listTugasLuarTypes(businessUnitId, { semua: true });',
  '      daftar = await listTugasLuarTypes(businessUnitId);',
  AUDIT
);
sabotase(
  'pemuatan jenis di tab Jadwal tanpa `.catch()` — satu tabel yang belum ter-deploy mematikan seluruh layar',
  ADM,
  '        listTugasLuarTypes(businessUnitId).catch(() => [])',
  '        listTugasLuarTypes(businessUnitId)',
  AUDIT
);
sabotase(
  'jenis nonaktif yang SEDANG TERPASANG berhenti ditawarkan — menyentuh selnya menghapus hari kerjanya',
  MURNI,
  '    if (j?.aktif === false && id !== terpasang) continue;',
  '    if (j?.aktif === false) continue;',
  TES
);

// ---------------------------------------------------------------
console.log('\nSABOTASE PEMBACA LAMA & LENCANA:');
// ---------------------------------------------------------------

sabotase(
  '`jadwal_belum_clock_in` disederhanakan — staff yang tugas luar dilencanai "belum clock in"',
  M109,
  '       and s.is_off = false\n       and s.shift_id is not null',
  '       and s.is_off = false',
  AUDIT
);
sabotase(
  '`selJadwal` menyamarkan tugas luar jadi shift tanpa nama',
  CUTI,
  "  if (jadwal.is_tugas_luar) return { mode: 'tugas-luar', jadwal, terkunci: false };",
  '  void 0;',
  TES
);
sabotase(
  'tugas luar dilebur ke hitungan shift — "5 shift minggu ini" terbaca penuh padahal 2 tidak di outlet',
  CUTI,
  "    tugasLuar: daftar.filter((s) => s.mode === 'tugas-luar').length,",
  '    tugasLuar: 0,',
  TES
);
sabotase(
  '`LATE_LABEL.tugas_luar` hilang — kunci database mentah tampil ke admin, lencana tanpa warna',
  SVC,
  "  tugas_luar: 'Tugas luar'\n};",
  '};',
  AUDIT
);

// ---------------------------------------------------------------
console.log('\nSABOTASE PRESENSI:');
// ---------------------------------------------------------------

sabotase(
  '`myShift` berhenti mengecualikan tugas luar — hari itu diperlakukan sebagai hari bershift',
  AP,
  '  const myShift = mySchedule && !mySchedule.is_off && !mySchedule.is_tugas_luar ? mySchedule.outlet_shifts : null;',
  '  const myShift = mySchedule && !mySchedule.is_off ? mySchedule.outlet_shifts : null;',
  AUDIT
);
sabotase(
  'status clock in kembali `no_schedule` — rekap menampilkannya sebagai kelalaian menyusun jadwal',
  AP,
  '        if (mySchedule?.is_tugas_luar) lateInfo = { status: STATUS_PRESENSI_TUGAS_LUAR, minutes: null };',
  '        if (false) lateInfo = { status: STATUS_PRESENSI_TUGAS_LUAR, minutes: null };',
  AUDIT
);
sabotase(
  'keterangan tugas luar berhenti terisi dari jadwalnya',
  AP,
  '        value: keteranganClockIn(mySchedule, jenisTLPerId, outletTLPerId),',
  "        value: '',",
  AUDIT
);
sabotase(
  'keterangan clock in terisi juga pada hari yang BUKAN tugas luar',
  MURNI,
  "  if (!jadwal?.is_tugas_luar) return '';",
  '  void 0;',
  TES
);

// ---------------------------------------------------------------
console.log('\nSABOTASE WARNA:');
// ---------------------------------------------------------------
//
// Warna adalah satu-satunya bagian fitur ini yang dibaca TANPA MEMBACA —
// sekilas, dari seberang meja. Kegagalannya pun begitu: tidak ada galat, tidak
// ada teks yang salah, cuma arti yang berpindah atau hilang.

sabotase(
  'warna shift mengikuti URUTAN daftar — menambah satu shift menggeser arti semua warna',
  WARNA,
  '  return `shift-w${(angkaStabil(id) % JUMLAH_WARNA_SHIFT) + 1}`;',
  '  return `shift-w${(String(id).length % JUMLAH_WARNA_SHIFT) + 1}`;',
  AUDIT
);
sabotase(
  'hash tidak dibuat tak-bertanda — `%` negatif menghasilkan kelas yang tak ada di CSS',
  WARNA,
  '  return h >>> 0;',
  '  return h;',
  AUDIT
);
sabotase(
  'satu warna shift hilang dari CSS — selnya polos di antara sel berwarna, tanpa galat',
  CSS,
  '.shift-chip.shift-w5 { background: #fce7f3; color: #9d174d; border-color: #f9a8d4; }',
  '',
  AUDIT
);
sabotase(
  'warna sel admin hilang dari CSS — skema warnanya cuma berlaku di Staff App',
  CSS,
  'select.sc-cell.shift-w5 { border-style: solid; background-color: #fce7f3; color: #9d174d; border-color: #f9a8d4; }',
  '',
  AUDIT
);
sabotase(
  'chip tugas luar kehilangan warnanya sendiri — digambar seperti shift biasa',
  CSS,
  '.shift-chip.shift-tugas-luar {',
  '.shift-chip.shift-tugas-luar-nonaktif {',
  AUDIT
);
sabotase(
  'chip tugas luar kembali memakai kelas CUTI — dua keadaan berakibat berlawanan terlihat sama',
  SP,
  '<span class="shift-chip shift-tugas-luar">Tugas Luar</span>',
  '<span class="shift-chip shift-cuti">Tugas Luar</span>',
  AUDIT
);
sabotase(
  'chip shift kembali seragam — tidak ada lagi beda warna antar shift',
  SP,
  '<span class="shift-chip ${esc(kelasWarnaShift(cur.shift_id))}">',
  '<span class="shift-chip">',
  AUDIT
);
sabotase(
  'sel admin kehilangan warnanya',
  ADM,
  '                        const warna = kelasWarnaSel(cur);',
  "                        const warna = '';",
  AUDIT
);
sabotase(
  '`<optgroup>` hilang — "Dinas Luar" berdiri sebaris dengan "PAGI" tanpa pembeda',
  ADM,
  // Polanya sengaja PENDEK dan tanpa kutip tunggal: baris aslinya memuat
  // `join('')`, dan kutipnya akan mengakhiri string pola ini di tengah jalan.
  // Galatnya muncul sebagai SyntaxError di harness, bukan di kode yang dijaga.
  '? `<optgroup label=',
  '? `<optgroup-dinonaktifkan label=',
  AUDIT
);
sabotase(
  'label opsi tugas luar kembali membawa awalan panjangnya',
  MURNI,
  "      label: `${labelJenis(j)}${j?.aktif === false ? ' (nonaktif)' : ''}`,",
  "      label: `Tugas Luar · ${labelJenis(j)}${j?.aktif === false ? ' (nonaktif)' : ''}`,",
  TES
);
sabotase(
  '`kelompokOpsi` melebur grup yang berbeda jadi satu',
  MURNI,
  '    if (!indeks.has(grup)) {',
  '    if (false) {',
  TES
);

console.log('');
if (gagal === 0) console.log('Semua sabotase tugas luar tertangkap. ✅');
else console.error(`${gagal} sabotase LOLOS — pemeriksanya tidak menjaga apa yang dikiranya dijaga.`);
process.exit(gagal === 0 ? 0 : 1);
