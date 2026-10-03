/**
 * 0156 — PRESENSI SAAT CUTI DITANDAI DATABASE (PGlite — Postgres sungguhan).
 *
 * ============ YANG SESUNGGUHNYA DIUJI ============
 *
 * Bukan "apakah kolomnya ada". Yang diuji adalah apakah tandanya terisi TANPA
 * BANTUAN LAYAR — karena itulah seluruh alasan ia ditaruh di trigger.
 *
 * Peringatan di Staff App menjaga ORANGNYA, bukan DATANYA. Clock-in adalah
 * `insert` langsung, dan ada beberapa jalan masuk yang tidak lewat layar itu:
 * koreksi presensi oleh admin, PWA lama yang masih di cache HP, dan siapa pun
 * yang memanggil PostgREST sendiri. Kalau penandanya dikirim layar, semua
 * jalan itu menghasilkan `null` — yang artinya "tidak sedang cuti", persis
 * sama dengan baris yang memang tidak sedang cuti.
 *
 *   §1 Clock-in polos (tanpa kolom cuti sama sekali) tetap tertandai.
 *   §2 TANGGALNYA WIB, bukan UTC — ini jebakan utamanya.
 *   §3 Cuti yang belum disetujui / sudah lewat TIDAK menandai.
 *   §4 Cuti orang lain tidak menular.
 *   §5 Nilai yang sudah diisi tidak ditimpa.
 *   §6 Cuti yang dihapus tidak menghapus presensinya.
 */
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AKAR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

let gagal = 0;
let n = 0;
const cek = (nama, dapat, harap) => {
  n++;
  if (JSON.stringify(dapat) !== JSON.stringify(harap)) {
    gagal++;
    console.error(`❌ ${nama}\n   dapat : ${JSON.stringify(dapat)}\n   harap : ${JSON.stringify(harap)}`);
  }
};
const benar = (nama, syarat, ket = '') => {
  n++;
  if (!syarat) {
    gagal++;
    console.error(`❌ ${nama}${ket ? ' — ' + ket : ''}`);
  }
};

const db = new PGlite();
const q = (sql, params) => db.query(sql, params);
const satu = async (sql, params) => (await q(sql, params)).rows[0];

// ============ ZONA SESINYA DIPAKSA UTC ============
//
// Supabase menjalankan Postgres dengan `TimeZone = UTC`, dan itulah yang
// membuat `::date` atas `timestamptz` berbahaya di sini.
//
// PGlite TIDAK memakai UTC secara bawaan. Percobaan pertama tes ini
// membiarkannya apa adanya, dan seluruh §2 — bagian yang justru dibuat untuk
// menjebak kesalahan zona — lolos tanpa menguji apa pun, karena zonanya
// kebetulan sudah dekat WIB. Tesnya hijau untuk kode yang belum tentu benar
// di produksi.
await db.exec(`set time zone 'UTC';`);

// Skema seadanya — hanya yang disentuh 0156.
await db.exec(`
  create schema if not exists auth;
  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
  $$;

  create table user_profiles (id uuid primary key, full_name text);
  create table leave_types (id uuid primary key default gen_random_uuid(), name text);
  create table leave_requests (
    id uuid primary key default gen_random_uuid(),
    user_id uuid references user_profiles(id),
    leave_type_id uuid references leave_types(id),
    start_date date not null,
    end_date date not null,
    status text not null default 'pending'
  );
  create table attendance_records (
    id uuid primary key default gen_random_uuid(),
    user_id uuid references user_profiles(id),
    business_unit_id uuid,
    outlet_id uuid,
    clock_in_at timestamptz not null default now(),
    late_status text
  );
`);

const sql = fs.readFileSync(path.join(AKAR, 'supabase/migrations/0156_presensi_saat_cuti.sql'), 'utf8');
await db.exec(sql.replace(/notify pgrst[^;]*;/g, ''));
console.log('  0156 terpasang.');

// =====================================================================
// DATA
// =====================================================================
const ANI = '11111111-1111-1111-1111-111111111111';
const BUDI = '22222222-2222-2222-2222-222222222222';
await q(`insert into user_profiles (id, full_name) values ($1,'Ani'),($2,'Budi')`, [ANI, BUDI]);
const TAHUNAN = (await satu(`insert into leave_types (name) values ('Cuti Tahunan') returning id`)).id;

/** Satu clock-in POLOS — persis seperti yang dikirim aplikasi: tanpa kolom cuti. */
const absen = async (uid, saat) =>
  (
    await satu(`insert into attendance_records (user_id, clock_in_at) values ($1, $2::timestamptz) returning id, cuti_request_id`, [
      uid,
      saat
    ])
  );

// =====================================================================
// §1 CLOCK-IN POLOS TETAP TERTANDAI
// =====================================================================
console.log('\n§1 Tanpa bantuan layar');

const CUTI = (
  await satu(
    `insert into leave_requests (user_id, leave_type_id, start_date, end_date, status)
     values ($1,$2,'2026-10-05','2026-10-09','approved') returning id`,
    [ANI, TAHUNAN]
  )
).id;

const a1 = await absen(ANI, '2026-10-06 09:00+07');
cek('1. INTI: insert polos tertandai oleh trigger, bukan oleh layar', a1.cuti_request_id, CUTI);

// Hari di luar rentang cuti: tidak tertandai.
const a2 = await absen(ANI, '2026-10-10 09:00+07');
cek('1. hari sesudah cutinya habis tidak tertandai', a2.cuti_request_id, null);
const a3 = await absen(ANI, '2026-10-04 09:00+07');
cek('1. hari sebelum cutinya mulai tidak tertandai', a3.cuti_request_id, null);

// Batas rentangnya INKLUSIF di kedua ujung.
cek('1. hari pertama cuti ikut', (await absen(ANI, '2026-10-05 09:00+07')).cuti_request_id, CUTI);
cek('1. hari terakhir cuti ikut', (await absen(ANI, '2026-10-09 09:00+07')).cuti_request_id, CUTI);

// =====================================================================
// §2 TANGGALNYA WIB, BUKAN UTC
//
// Inilah jebakan utamanya, dan ia senyap sempurna: barisnya tetap tersimpan,
// tandanya saja yang kosong.
// =====================================================================
console.log('\n§2 Tanggal WIB');

// Clock-in 06.30 WIB tanggal 5 = 23.30 UTC tanggal 4. `::date` tanpa konversi
// zona akan membacanya sebagai tanggal 4 — di luar cuti — dan shift PAGI
// justru yang paling sering bertabrakan dengan cuti.
const pagi = await absen(ANI, '2026-10-05 06:30+07');
cek('2. INTI: clock-in 06.30 WIB hari pertama cuti tetap tertandai', pagi.cuti_request_id, CUTI);
cek(
  '2. dan memang jatuh di tanggal UTC SEBELUMNYA',
  (await satu(`select (timestamptz '2026-10-05 06:30+07')::date::text d`)).d,
  '2026-10-04'
);

// Ujung satunya: 23.30 WIB tanggal 9 (hari terakhir cuti) = 16.30 UTC tanggal 9.
cek('2. clock-in 23.30 WIB hari terakhir cuti tetap tertandai', (await absen(ANI, '2026-10-09 23:30+07')).cuti_request_id, CUTI);
// Dan 00.30 WIB tanggal 10 sudah DI LUAR cuti, walau di UTC masih tanggal 9.
cek('2. INTI: 00.30 WIB sehari sesudahnya sudah di luar cuti', (await absen(ANI, '2026-10-10 00:30+07')).cuti_request_id, null);

// =====================================================================
// §3 HANYA CUTI YANG DISETUJUI
// =====================================================================
console.log('\n§3 Status pengajuan');

for (const status of ['pending', 'rejected', 'cancelled']) {
  await q(`update leave_requests set status = $1 where id = $2`, [status, CUTI]);
  cek(`3. status '${status}' TIDAK menandai`, (await absen(ANI, '2026-10-06 09:00+07')).cuti_request_id, null);
}
await q(`update leave_requests set status = 'approved' where id = $1`, [CUTI]);
cek('3. disetujui lagi, menandai lagi', (await absen(ANI, '2026-10-06 09:00+07')).cuti_request_id, CUTI);

// =====================================================================
// §4 CUTI ORANG LAIN TIDAK MENULAR
// =====================================================================
console.log('\n§4 Milik siapa');

cek('4. INTI: Budi absen di tanggal cuti ANI — tidak tertandai', (await absen(BUDI, '2026-10-06 09:00+07')).cuti_request_id, null);

// =====================================================================
// §5 NILAI YANG SUDAH DIISI TIDAK DITIMPA
// =====================================================================
console.log('\n§5 Tidak menimpa');

// Admin yang mengoreksi tanda yang salah tidak boleh dikembalikan lagi oleh
// trigger pada penulisan berikutnya.
const paksa = await satu(
  `insert into attendance_records (user_id, clock_in_at, cuti_request_id)
   values ($1, '2026-10-20 09:00+07', $2) returning cuti_request_id`,
  [ANI, CUTI]
);
cek('5. nilai yang dikirim pemanggil dipertahankan walau tanggalnya di luar cuti', paksa.cuti_request_id, CUTI);

// =====================================================================
// §6 CUTI DIHAPUS, PRESENSINYA TIDAK IKUT HILANG
// =====================================================================
console.log('\n§6 Cuti dihapus');

const sebelum = Number((await satu(`select count(*) n from attendance_records`)).n);
await q(`delete from leave_requests where id = $1`, [CUTI]);
const sesudah = Number((await satu(`select count(*) n from attendance_records`)).n);
cek('6. INTI: menghapus cuti TIDAK ikut menghapus presensinya', sesudah, sebelum);
cek(
  '6. tandanya jadi NULL, bukan menunjuk baris yang sudah tidak ada',
  Number((await satu(`select count(*) n from attendance_records where cuti_request_id is not null`)).n),
  0
);

// =====================================================================
// §7 DIJALANKAN ULANG
// =====================================================================
console.log('\n§7 Dijalankan ulang');

await db.exec(sql.replace(/notify pgrst[^;]*;/g, ''));
benar(
  '7. aman dijalankan dua kali',
  Number((await satu(`select count(*) n from pg_trigger where tgname = 'trg_tandai_presensi_saat_cuti'`)).n) === 1
);
benar(
  '7. triggernya tidak digandakan',
  Number((await satu(`select count(*) n from pg_indexes where indexname = 'idx_attendance_cuti'`)).n) === 1
);

console.log('');
if (gagal === 0) console.log(`${n} pemeriksaan 0156 lolos. ✅`);
else console.error(`${gagal} dari ${n} pemeriksaan GAGAL.`);
process.exit(gagal === 0 ? 0 : 1);
