/**
 * MIGRATION 0113 DI POSTGRES SUNGGUHAN (PGlite).
 *
 * ============ YANG PALING MUDAH MELESET ============
 *
 * `leave_requests` menyimpan RENTANG; jadwal shift butuh SATU BARIS PER
 * TANGGAL. Penguraian rentang punya tiga cara gagal yang semuanya senyap —
 * tidak ada error, hanya hari yang hilang atau muncul di tempat yang salah:
 *
 *   1. Syarat rentangnya "termuat di dalam" alih-alih "bersinggungan".
 *      Cuti 28 Agu - 3 Sep akan HILANG SELURUHNYA saat layar menampilkan
 *      September, karena `start_date >= p_from` tidak terpenuhi.
 *
 *   2. `generate_series` tidak dipotong pada rentang yang diminta.
 *      Cuti yang sama akan menghasilkan tanggal Agustus yang tidak dipakai
 *      siapa pun — dan kalau layar memetakannya per tanggal, sel-sel itu
 *      sekadar menguap.
 *
 *   3. Penyaring outlet terlalu ketat. `leave_requests.outlet_id` boleh null,
 *      dan `= p_outlet` membuang seluruh pengajuan tanpa outlet.
 *
 * Ketiganya diuji sebagai kasus tersendiri di bawah.
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

await db.exec(`
  create schema if not exists auth;
  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
  $$;

  create table business_units (id uuid primary key default gen_random_uuid(), name text);
  create table outlets (id uuid primary key default gen_random_uuid(), business_unit_id uuid, name text);
  create table user_profiles (id uuid primary key, full_name text);
  create table membership_scopes (user_id uuid, business_unit_id uuid, outlet_id uuid, role text);

  create table leave_types (
    id uuid primary key default gen_random_uuid(),
    business_unit_id uuid, name text not null,
    deducts_quota boolean not null default true,
    is_active boolean not null default true
  );
  create table leave_requests (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null, business_unit_id uuid not null, outlet_id uuid,
    leave_type_id uuid not null references leave_types(id),
    start_date date not null, end_date date not null, day_count int not null default 1,
    reason text, status text not null default 'pending'
      check (status in ('pending','approved','rejected','cancelled')),
    reviewed_by uuid, reviewed_at timestamptz, created_at timestamptz not null default now()
  );

  create role authenticated;

  create or replace function has_outlet_scope(p_uid uuid, p_outlet uuid) returns boolean language sql stable as $$
    select exists (select 1 from membership_scopes where user_id = p_uid and outlet_id = p_outlet);
  $$;
`);

await db.exec(
  fs.readFileSync(path.join(AKAR, 'supabase/migrations/0113_cuti_di_jadwal_shift.sql'), 'utf8')
    .replace(/notify pgrst[^;]*;/g, '')
);
console.log('  0113 terpasang.');
await db.exec(
  fs.readFileSync(path.join(AKAR, 'supabase/migrations/0113_cuti_di_jadwal_shift.sql'), 'utf8')
    .replace(/notify pgrst[^;]*;/g, '')
);
console.log('  dijalankan ulang: aman.');

// =====================================================================
// DATA
// =====================================================================
const BU = (await satu(`insert into business_units (name) values ('Cafe') returning id`)).id;
const SERPONG = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Serpong') returning id`, [BU])).id;
const SENTUL = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Sentul') returning id`, [BU])).id;

const ADHE = '11111111-1111-1111-1111-111111111111';
const SHENDA = '22222222-2222-2222-2222-222222222222';
const ORANG_SENTUL = '33333333-3333-3333-3333-333333333333';
const ORANG_LUAR = '99999999-9999-9999-9999-999999999999';
await q(`insert into user_profiles (id, full_name) values ($1,'Adhe'),($2,'Shenda'),($3,'Sentul'),($4,'Luar')`,
  [ADHE, SHENDA, ORANG_SENTUL, ORANG_LUAR]);
await q(`insert into membership_scopes (user_id, business_unit_id, outlet_id, role) values
  ($1,$5,$6,'staff'), ($2,$5,$6,'staff'), ($3,$5,$7,'staff'), ($4,$5,null,'staff')`,
  [ADHE, SHENDA, ORANG_SENTUL, ORANG_LUAR, BU, SERPONG, SENTUL]);

const TAHUNAN = (await satu(`insert into leave_types (business_unit_id, name) values ($1,'Cuti Tahunan') returning id`, [BU])).id;
const SAKIT = (await satu(`insert into leave_types (business_unit_id, name, deducts_quota) values ($1,'Sakit',false) returning id`, [BU])).id;
// JENIS BUATAN BU. Modulnya tidak boleh mengenal daftar tetap.
const PH = (await satu(`insert into leave_types (business_unit_id, name, deducts_quota) values ($1,'PH',false) returning id`, [BU])).id;

const ajukan = async (user, jenis, dari, sampai, status = 'approved', outlet = SERPONG) =>
  (await satu(
    `insert into leave_requests (user_id, business_unit_id, outlet_id, leave_type_id, start_date, end_date, day_count, status)
     values ($1,$2,$3,$4,$5,$6,1,$7) returning id`,
    [user, BU, outlet, jenis, dari, sampai, status]
  )).id;

/**
 * Tanggal jadi 'YYYY-MM-DD', apa pun bentuk aslinya.
 *
 * PGlite mengembalikan kolom `date` sebagai objek Date JavaScript, sedangkan
 * PostgREST (yang dipakai aplikasi sungguhan) mengembalikannya sebagai string
 * '2026-09-05'. Percobaan pertama saya memakai `String(x).slice(0,10)` dan
 * menghasilkan 'Sat Sep 05' — tesnya merah padahal SQL-nya benar.
 *
 * Dipakai `toISOString()` dengan penyesuaian zona: `Date` dari PGlite dibuat
 * pada tengah malam waktu LOKAL, dan `toISOString()` yang polos bisa
 * menggesernya mundur satu hari di zona bertanda positif seperti WIB.
 */
const tgl = (v) => {
  if (typeof v === 'string') return v.slice(0, 10);
  const d = new Date(v);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

const rentang = async (outlet, dari, sampai) =>
  (await q(`select * from cuti_disetujui_rentang($1,$2,$3) order by user_id, tanggal`, [outlet, dari, sampai])).rows;

await sebagai(ADHE);

// =====================================================================
// 1. RENTANG DIURAI JADI SATU BARIS PER TANGGAL
// =====================================================================
await ajukan(ADHE, TAHUNAN, '2026-09-05', '2026-09-07');
let hasil = await rentang(SERPONG, '2026-09-01', '2026-09-30');
cek('1. 3 hari jadi 3 baris', hasil.length, 3);
cek('1. tanggalnya berurutan', hasil.map((r) => tgl(r.tanggal)),
  ['2026-09-05', '2026-09-06', '2026-09-07']);
cek('1. jenisnya terbawa', hasil[0].jenis, 'Cuti Tahunan');

// =====================================================================
// 2. RENTANG LINTAS BULAN — kasus yang paling mudah hilang
//
// Cuti 28 Agu - 3 Sep. Saat layar menampilkan SEPTEMBER, yang harus muncul
// hanya 1-3 Sep. Kalau syaratnya "termuat di dalam", cuti ini hilang total.
// Kalau generate_series tidak dipotong, ia menghasilkan tanggal Agustus juga.
// =====================================================================
await ajukan(SHENDA, SAKIT, '2026-08-28', '2026-09-03');

const sept = (await rentang(SERPONG, '2026-09-01', '2026-09-30')).filter((r) => r.user_id === SHENDA);
cek('2. muncul di September', sept.length, 3);
cek('2.   dan HANYA tanggal September', sept.map((r) => tgl(r.tanggal)),
  ['2026-09-01', '2026-09-02', '2026-09-03']);

const agu = (await rentang(SERPONG, '2026-08-01', '2026-08-31')).filter((r) => r.user_id === SHENDA);
cek('2. muncul juga di Agustus', agu.length, 4);
cek('2.   dan HANYA tanggal Agustus', agu.map((r) => tgl(r.tanggal)),
  ['2026-08-28', '2026-08-29', '2026-08-30', '2026-08-31']);

// Rentang SEMPIT di tengah cuti panjang tetap terjaring.
const tengah = (await rentang(SERPONG, '2026-08-30', '2026-08-31')).filter((r) => r.user_id === SHENDA);
cek('2. rentang sempit di tengah cuti panjang', tengah.length, 2);

// =====================================================================
// 3. HANYA YANG DISETUJUI
// =====================================================================
await ajukan(ADHE, TAHUNAN, '2026-09-15', '2026-09-15', 'pending');
await ajukan(ADHE, TAHUNAN, '2026-09-16', '2026-09-16', 'rejected');
await ajukan(ADHE, TAHUNAN, '2026-09-17', '2026-09-17', 'cancelled');

const sepAdhe = (await rentang(SERPONG, '2026-09-01', '2026-09-30')).filter((r) => r.user_id === ADHE);
cek('3. pending/rejected/cancelled tidak ikut', sepAdhe.length, 3);
benar('3.   tidak ada tanggal 15-17', !sepAdhe.some((r) => /2026-09-1[567]/.test(tgl(r.tanggal))));

// CUTI YANG DIBATALKAN LANGSUNG HILANG — inti dari "tidak menyalin".
const DIBATALKAN = await ajukan(ADHE, PH, '2026-09-20', '2026-09-20');
cek('3. PH tampil dulu', (await rentang(SERPONG, '2026-09-20', '2026-09-20')).length, 1);
await q(`update leave_requests set status = 'cancelled' where id = $1`, [DIBATALKAN]);
cek('3. begitu dibatalkan, langsung lenyap tanpa disinkronkan',
  (await rentang(SERPONG, '2026-09-20', '2026-09-20')).length, 0);

// =====================================================================
// 4. JENIS BUATAN BU TERBAWA APA ADANYA
// =====================================================================
await ajukan(ADHE, PH, '2026-09-25', '2026-09-25');
const ph = (await rentang(SERPONG, '2026-09-25', '2026-09-25'));
cek('4. jenis PH terbawa', ph[0]?.jenis, 'PH');

// =====================================================================
// 5. PENYARING OUTLET
// =====================================================================
await ajukan(ORANG_SENTUL, TAHUNAN, '2026-09-05', '2026-09-05', 'approved', SENTUL);
const serpongSaja = await rentang(SERPONG, '2026-09-05', '2026-09-05');
benar('5. cuti outlet lain tidak nyasar ke Serpong',
  !serpongSaja.some((r) => r.user_id === ORANG_SENTUL), JSON.stringify(serpongSaja));

// PENGAJUAN TANPA OUTLET tetap muncul, lewat keanggotaan orangnya.
//
// `leave_requests.outlet_id` boleh null (`on delete set null` di 0013, dan
// pengajuan lama bisa saja tidak mengisinya). Penyaring `= p_outlet` yang
// ketat akan membuangnya sepenuhnya — dan cutinya tidak muncul di mana pun.
await ajukan(ADHE, SAKIT, '2026-09-28', '2026-09-28', 'approved', null);
const tanpaOutlet = (await rentang(SERPONG, '2026-09-28', '2026-09-28'));
cek('5. pengajuan tanpa outlet tetap muncul di outlet keanggotaannya', tanpaOutlet.length, 1);
cek('5.   jenisnya benar', tanpaOutlet[0]?.jenis, 'Sakit');

// Tapi tidak boleh nyasar ke outlet yang orangnya bukan anggota.
const tanpaOutletDiSentul = (await rentang(SENTUL, '2026-09-28', '2026-09-28')).filter((r) => r.user_id === ADHE);
cek('5.   dan TIDAK muncul di outlet lain', tanpaOutletDiSentul.length, 0);

// =====================================================================
// 6. WEWENANG
//
// `security definer` mematikan RLS. Tanpa `has_outlet_scope`, siapa pun bisa
// membaca cuti seluruh outlet sekadar dengan menebak id-nya — dan cuti sakit
// adalah data yang paling tidak boleh bocor lintas outlet.
// =====================================================================
await sebagai(ORANG_LUAR);
cek('6. orang tanpa scope outlet tidak dapat apa-apa', (await rentang(SERPONG, '2026-09-01', '2026-09-30')).length, 0);

await sebagai(ORANG_SENTUL);
cek('6. staff Sentul tidak bisa membaca cuti Serpong', (await rentang(SERPONG, '2026-09-01', '2026-09-30')).length, 0);
benar('6.   tapi tetap bisa membaca outletnya sendiri',
  (await rentang(SENTUL, '2026-09-05', '2026-09-05')).length === 1);

// =====================================================================
// 7. CUTI SAYA SENDIRI — tidak bergantung outlet
// =====================================================================
const cutiSaya = async (u, dari, sampai) => {
  await sebagai(u);
  return (await q(`select * from cuti_saya_rentang($1,$2) order by tanggal`, [dari, sampai])).rows;
};

const milikAdhe = await cutiSaya(ADHE, '2026-09-01', '2026-09-30');
cek('7. cuti saya: 3 (5-7 Sep) + PH 25 + Sakit 28', milikAdhe.length, 5);
benar('7.   memuat PH', milikAdhe.some((r) => r.jenis === 'PH'));
benar('7.   memuat Sakit tanpa outlet', milikAdhe.some((r) => r.jenis === 'Sakit'));

// Yang muncul HANYA milik sendiri.
const milikShenda = await cutiSaya(SHENDA, '2026-09-01', '2026-09-30');
cek('7. cuti Shenda hanya miliknya', milikShenda.length, 3);
benar('7.   dan semuanya Sakit', milikShenda.every((r) => r.jenis === 'Sakit'));

if (gagal === 0) {
  console.log('✅ migrasi 0113: rentang diurai per tanggal, lintas bulan utuh, hanya yang disetujui, wewenang terjaga.');
} else {
  console.error(`\n${gagal} pemeriksaan gagal.`);
}
process.exit(gagal === 0 ? 0 : 1);
