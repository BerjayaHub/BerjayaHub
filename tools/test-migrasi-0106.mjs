/**
 * MIGRATION 0106 (nilai ulang status shift, berjejak) DI POSTGRES SUNGGUHAN.
 *
 * ============ KASUS YANG MEMICU SELURUH BERKAS INI ============
 *
 *   Rabu  : dijadwalkan shift pagi, clock in -> TERLAMBAT 140 menit
 *   Jumat : jadwal Rabu-nya dikoreksi jadi shift siang
 *   Harap : setelah dinilai ulang, statusnya berubah — DAN angka 140 menit
 *           yang lama masih bisa dibaca.
 *
 * ============ DUA UJI YANG PALING MENENTUKAN ============
 *
 * UJI 3 — potret pertama hanya disimpan SEKALI. Menilai ulang untuk kedua
 *         kalinya tidak boleh menimpa `late_status_awal` dengan hasil penilaian
 *         ulang yang pertama. Kalau ditimpa, penilaian ASLI hilang setelah dua
 *         kali koreksi, dan yang tersisa justru angka yang paling tidak berarti.
 *
 * UJI 5 — tombol ↻ yang LAMA tidak boleh ikut berubah artinya. Ia dipakai
 *         sehari-hari untuk memperbaiki "Tanpa jadwal", dan kalau ia diam-diam
 *         mulai menimpa penilaian, setiap klik jadi perubahan riwayat.
 */
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AKAR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

let gagal = 0;
const cek = (nama, dapat, harap) => {
  if (JSON.stringify(dapat) !== JSON.stringify(harap)) {
    gagal++;
    console.error(`❌ ${nama}\n   dapat : ${JSON.stringify(dapat)}\n   harap : ${JSON.stringify(harap)}`);
  }
};
const benar = (nama, syarat, ket = '') => {
  if (!syarat) {
    gagal++;
    console.error(`❌ ${nama}${ket ? ' — ' + ket : ''}`);
  }
};

const db = new PGlite();
const q = (sql, params) => db.query(sql, params);
const satu = async (sql, params) => (await q(sql, params)).rows[0];
const sebagai = (uid) => q(`select set_config('request.jwt.claim.sub', $1, false)`, [uid]);

async function galat(fn) {
  try {
    await fn();
    return null;
  } catch (e) {
    return e.message ?? String(e);
  }
}

await db.exec(`
  create schema if not exists auth;
  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
  $$;
  create role authenticated;

  create table business_units (id uuid primary key default gen_random_uuid(), name text);
  create table outlets (id uuid primary key default gen_random_uuid(), business_unit_id uuid, name text);
  create table user_profiles (id uuid primary key, full_name text);
  create table membership_scopes (user_id uuid, business_unit_id uuid, outlet_id uuid, role text);

  create table shift_settings (business_unit_id uuid primary key, late_tolerance_minutes int default 10);
  create table outlet_shifts (
    id uuid primary key default gen_random_uuid(),
    business_unit_id uuid, outlet_id uuid, slot int, name text,
    start_time time, end_time time, is_active boolean default true
  );
  create table shift_schedules (
    id uuid primary key default gen_random_uuid(),
    business_unit_id uuid, outlet_id uuid, user_id uuid, work_date date,
    shift_id uuid, is_off boolean not null default false,
    updated_at timestamptz not null default now(),
    unique (outlet_id, user_id, work_date),
    constraint shift_or_off check ((is_off and shift_id is null) or (not is_off and shift_id is not null))
  );
  create table attendance_records (
    id uuid primary key default gen_random_uuid(),
    user_id uuid, business_unit_id uuid, outlet_id uuid,
    nbm_business_unit_id uuid, nbm_outlet_id uuid,
    clock_in_at timestamptz not null default now(), clock_out_at timestamptz,
    shift_name text, late_status text, late_minutes int
  );

  create or replace function is_admin_of_outlet(p_uid uuid, p_outlet uuid) returns boolean language sql stable as $$
    select exists (select 1 from membership_scopes
                    where user_id = p_uid and outlet_id = p_outlet and role in ('outlet_admin','bu_admin','super_admin'));
  $$;
`);

const jalankan = async (b) =>
  db.exec(fs.readFileSync(path.join(AKAR, 'supabase/migrations', b), 'utf8').replace(/notify pgrst[^;]*;/g, ''));

await jalankan('0074_hitung_ulang_status_shift.sql');
await jalankan('0106_nilai_ulang_shift_berjejak.sql');
console.log('  0074 lalu 0106 terpasang.');
await jalankan('0106_nilai_ulang_shift_berjejak.sql');
console.log('  dijalankan ulang: aman.');

// =====================================================================
// DATA — persis kasus yang dilaporkan
// =====================================================================
const BU = (await satu(`insert into business_units (name) values ('Cafe') returning id`)).id;
const OUT = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Serpong') returning id`, [BU])).id;
await q(`insert into shift_settings (business_unit_id, late_tolerance_minutes) values ($1, 10)`, [BU]);

const STAFF = '11111111-1111-1111-1111-111111111111';
const ADMIN = '22222222-2222-2222-2222-222222222222';
const BUKAN_ADMIN = '33333333-3333-3333-3333-333333333333';
await q(`insert into user_profiles (id, full_name) values ($1,'Staff'),($2,'Admin'),($3,'Bukan Admin')`, [STAFF, ADMIN, BUKAN_ADMIN]);
await q(`insert into membership_scopes (user_id, business_unit_id, outlet_id, role) values
  ($1,$4,$5,'staff'), ($2,$4,$5,'outlet_admin'), ($3,$4,$5,'staff')`, [STAFF, ADMIN, BUKAN_ADMIN, BU, OUT]);

const PAGI = (await satu(`insert into outlet_shifts (business_unit_id, outlet_id, slot, name, start_time, end_time)
  values ($1,$2,1,'Pagi','07:00','15:00') returning id`, [BU, OUT])).id;
const SIANG = (await satu(`insert into outlet_shifts (business_unit_id, outlet_id, slot, name, start_time, end_time)
  values ($1,$2,2,'Siang','11:00','19:00') returning id`, [BU, OUT])).id;

// Rabu: dijadwalkan PAGI (07:00), clock in 09:20 -> telat 140 menit.
const RABU = '2026-08-19';
await q(`insert into shift_schedules (business_unit_id, outlet_id, user_id, work_date, shift_id)
  values ($1,$2,$3,$4::date,$5)`, [BU, OUT, STAFF, RABU, PAGI]);

const REC = (await satu(`insert into attendance_records
  (user_id, business_unit_id, outlet_id, clock_in_at, shift_name, late_status, late_minutes)
  values ($1,$2,$3, ($4 || ' 09:20')::timestamp at time zone 'Asia/Jakarta', 'Pagi', 'late', 140)
  returning id`, [STAFF, BU, OUT, RABU])).id;

const baris = async () => satu(`select * from attendance_records where id = $1`, [REC]);

let b = await baris();
cek('awal: terlambat 140 menit', [b.late_status, b.late_minutes], ['late', 140]);
cek('awal: belum ada jejak penilaian ulang', b.late_dinilai_ulang_at, null);

// =====================================================================
// 1. TOMBOL ↻ LAMA TIDAK MENYENTUHNYA — persis yang dilaporkan
// =====================================================================
await sebagai(ADMIN);

// Jumat: jadwal Rabu dikoreksi jadi SIANG (11:00). Clock in 09:20 jadi LEBIH AWAL.
await q(`update shift_schedules set shift_id = $1, updated_at = now()
  where user_id = $2 and work_date = $3::date`, [SIANG, STAFF, RABU]);

await q(`select * from hitung_ulang_status_shift($1)`, [REC]);
b = await baris();
cek('1. ↻ lama TIDAK mengubah baris yang sudah dinilai', [b.late_status, b.late_minutes], ['late', 140]);

// =====================================================================
// 2. NILAI ULANG — inilah jalan keluarnya
// =====================================================================
const hasil = await satu(`select * from nilai_ulang_status_shift($1, 'Jadwal Rabu dikoreksi jadi shift siang')`, [REC]);

cek('2. status baru: tepat waktu (masuk 09:20, shift 11:00)', hasil.status, 'ontime');
cek('2.   menitnya nol', hasil.menit, 0);
cek('2.   nama shift ikut berubah', hasil.nama_shift, 'Siang');

// Yang lama DIKEMBALIKAN juga, supaya layar bisa menampilkan keduanya.
cek('2. status lama dilaporkan', hasil.status_lama, 'late');
cek('2.   menit lama dilaporkan', hasil.menit_lama, 140);

b = await baris();
cek('2. baris sudah diperbarui', [b.late_status, b.late_minutes], ['ontime', 0]);

// =====================================================================
// 3. JEJAKNYA TERSIMPAN — dan potret pertama tidak pernah hilang
// =====================================================================
cek('3. potret pertama tersimpan', [b.late_status_awal, b.late_menit_awal], ['late', 140]);
benar('3. waktu penilaian ulang tercatat', b.late_dinilai_ulang_at != null);
cek('3. siapa yang menilai ulang', b.late_dinilai_ulang_by, ADMIN);
cek('3. alasannya tersimpan', b.late_dinilai_ulang_alasan, 'Jadwal Rabu dikoreksi jadi shift siang');

// DINILAI ULANG DUA KALI — potret pertama TIDAK boleh tergeser.
//
// Kalau `late_status_awal` ditimpa hasil penilaian ulang pertama ('ontime'),
// penilaian ASLI (140 menit) hilang selamanya — dan yang tersisa justru angka
// yang paling tidak berarti.
await q(`update shift_schedules set shift_id = $1 where user_id = $2 and work_date = $3::date`, [PAGI, STAFF, RABU]);
const kedua = await satu(`select * from nilai_ulang_status_shift($1, 'Ternyata memang pagi, dikembalikan')`, [REC]);
cek('3. penilaian kedua jalan', kedua.status, 'late');

b = await baris();
cek('3. POTRET PERTAMA TETAP 140, bukan hasil koreksi pertama',
  [b.late_status_awal, b.late_menit_awal], ['late', 140]);
benar('3.   bukan "ontime"', b.late_status_awal !== 'ontime');
cek('3. alasan terbaru yang tersimpan', b.late_dinilai_ulang_alasan, 'Ternyata memang pagi, dikembalikan');

// =====================================================================
// 4. ALASAN WAJIB
// =====================================================================
benar('4. alasan kosong ditolak',
  /Alasan wajib/i.test(await galat(() => q(`select * from nilai_ulang_status_shift($1, '')`, [REC])) ?? ''));
benar('4. alasan null ditolak',
  /Alasan wajib/i.test(await galat(() => q(`select * from nilai_ulang_status_shift($1, null)`, [REC])) ?? ''));
benar('4. alasan spasi saja ditolak',
  /Alasan wajib/i.test(await galat(() => q(`select * from nilai_ulang_status_shift($1, '   ')`, [REC])) ?? ''));

// Alasan disimpan tanpa spasi berlebih.
await q(`select * from nilai_ulang_status_shift($1, '  dirapikan  ')`, [REC]);
cek('4. alasan dirapikan spasinya', (await baris()).late_dinilai_ulang_alasan, 'dirapikan');

// =====================================================================
// 5. WEWENANG — hanya admin outlet
// =====================================================================
await sebagai(BUKAN_ADMIN);
// Pesannya diperiksa PERSIS milik fungsi ini ("menilai ulang presensi ini"),
// bukan sekadar "Hanya admin outlet". `hitung_ulang_status_shift` di dalamnya
// juga menolak dengan kalimat yang mirip — kalau yang dicocokkan cuma
// potongan yang sama, menghapus penjaga di sini akan tetap lolos.
benar('5. staff biasa ditolak oleh penjaga fungsi INI',
  /menilai ulang presensi ini/i.test(await galat(() => q(`select * from nilai_ulang_status_shift($1, 'coba')`, [REC])) ?? ''));
cek('5.   dan barisnya tidak berubah', (await baris()).late_dinilai_ulang_alasan, 'dirapikan');
await sebagai(ADMIN);

// =====================================================================
// 6. PERILAKU LAMA TIDAK BERUBAH ARTINYA
//
// Tombol ↻ dipakai sehari-hari untuk memperbaiki "Tanpa jadwal". Kalau ia
// diam-diam mulai menimpa penilaian, setiap klik jadi perubahan riwayat.
// =====================================================================
const KAMIS = '2026-08-20';
const REC2 = (await satu(`insert into attendance_records
  (user_id, business_unit_id, outlet_id, clock_in_at, late_status)
  values ($1,$2,$3, ($4 || ' 07:05')::timestamp at time zone 'Asia/Jakarta', 'no_schedule')
  returning id`, [STAFF, BU, OUT, KAMIS])).id;
await q(`insert into shift_schedules (business_unit_id, outlet_id, user_id, work_date, shift_id)
  values ($1,$2,$3,$4::date,$5)`, [BU, OUT, STAFF, KAMIS, PAGI]);

await q(`select * from hitung_ulang_status_shift($1)`, [REC2]);
const b2 = await satu(`select * from attendance_records where id=$1`, [REC2]);
cek('6. ↻ lama TETAP memperbaiki "tanpa jadwal"', b2.late_status, 'tolerance');
cek('6.   tanpa meninggalkan jejak penilaian ulang', b2.late_dinilai_ulang_at, null);
cek('6.   dan tanpa mengisi potret awal', b2.late_status_awal, null);

// =====================================================================
// 7. MASSAL — tiga angka, dan rentangnya dibatasi
// =====================================================================
const massal = await satu(
  `select * from nilai_ulang_status_shift_massal($1::date, $2::date, $3, 'Koreksi jadwal seminggu')`,
  [RABU, KAMIS, OUT]
);
cek('7. dua baris diproses', massal.diproses, 2);
benar('7. tiga angka dilaporkan',
  massal.diproses != null && massal.berubah != null && massal.tetap != null);
cek('7.   berubah + tetap = diproses', massal.berubah + massal.tetap, massal.diproses);

benar('7. rentang terlalu lebar ditolak',
  /terlalu lebar/i.test(await galat(() =>
    q(`select * from nilai_ulang_status_shift_massal('2026-01-01'::date, '2026-12-31'::date, $1, 'x')`, [OUT])) ?? ''));
benar('7. alasan kosong ditolak juga di massal',
  /Alasan wajib/i.test(await galat(() =>
    q(`select * from nilai_ulang_status_shift_massal($1::date, $2::date, $3, '')`, [RABU, KAMIS, OUT])) ?? ''));
benar('7. tanggal terbalik ditolak',
  /Rentang tanggalnya belum benar/i.test(await galat(() =>
    q(`select * from nilai_ulang_status_shift_massal($1::date, $2::date, $3, 'x')`, [KAMIS, RABU, OUT])) ?? ''));

// Massal hanya menyentuh yang jadi wewenangnya.
await sebagai(BUKAN_ADMIN);
const kosong = await satu(
  `select * from nilai_ulang_status_shift_massal($1::date, $2::date, $3, 'coba')`, [RABU, KAMIS, OUT]);
cek('7. bukan admin: tidak satu pun diproses', kosong.diproses, 0);

await db.close();
console.log(gagal === 0 ? '✅ migrasi 0106: semua lulus' : `❌ migrasi 0106: ${gagal} gagal`);
process.exit(gagal === 0 ? 0 : 1);
