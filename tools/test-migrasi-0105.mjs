/**
 * MIGRATION 0105 (lencana shift, cuti, reservasi) DI POSTGRES SUNGGUHAN.
 *
 * ============ TIGA UJI YANG PALING MENENTUKAN ============
 *
 * UJI 1 — outlet yang TIDAK memakai shift tidak boleh berlencana. Lencana yang
 *         tidak bisa dihilangkan akan diabaikan, termasuk saat ia benar.
 *
 * UJI 3 — lencana shift bersifat PRIBADI. Kalau ia menghitung jadwal seluruh
 *         outlet, setiap orang melihat tanda untuk shift rekannya — dan tidak
 *         ada satu pun yang bisa menghilangkannya sendiri.
 *
 * UJI 5 — reservasi hari ini yang masih pending tidak boleh terhitung DUA KALI
 *         (sekali sebagai "hari ini", sekali sebagai "menunggu putusan").
 *         Angkanya akan terlihat wajar dan tidak akan pernah cocok dengan layar.
 *
 * Kerangkanya menyerupai produksi, bukan skema kosong — pelajaran dari 0103.
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

const lencana = async (bu, outlet) => (await satu(`select lencana_beranda($1,$2) r`, [bu, outlet])).r;
const jumlah = (h, kode) => h?.modul?.[kode]?.jumlah ?? null;
const rincian = (h, kode) => h?.modul?.[kode]?.rincian ?? null;

await db.exec(`
  create schema if not exists auth;
  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
  $$;
  create role authenticated;

  create table business_units (id uuid primary key default gen_random_uuid(), name text);
  create table outlets (id uuid primary key default gen_random_uuid(), business_unit_id uuid, name text, outlet_role text default 'standalone');
  create table user_profiles (id uuid primary key, full_name text);
  create table products (id uuid primary key default gen_random_uuid(), business_unit_id uuid, name text);
  create table membership_scopes (user_id uuid, business_unit_id uuid, outlet_id uuid, role text);

  create table stock_movements (
    id uuid primary key default gen_random_uuid(),
    business_unit_id uuid, outlet_id uuid, product_id uuid,
    movement_type text, qty_delta numeric, dispatch_id uuid, created_at timestamptz not null default now()
  );
  create view stock_balances as select outlet_id, product_id, sum(qty_delta) qty from stock_movements group by 1,2;

  create table stock_orders (id uuid primary key default gen_random_uuid(), business_unit_id uuid, from_outlet_id uuid, to_outlet_id uuid, status text default 'open', created_at timestamptz default now());
  create table dispatches (id uuid primary key default gen_random_uuid(), business_unit_id uuid, from_outlet_id uuid, to_outlet_id uuid, status text default 'sent', created_at timestamptz default now(), sent_at timestamptz, received_at timestamptz);
  create table checklist_runs (id uuid primary key default gen_random_uuid(), outlet_id uuid, run_date date, created_at timestamptz default now());
  create table checklist_run_items (id uuid primary key default gen_random_uuid(), run_id uuid references checklist_runs(id) on delete cascade, checked boolean default false);
  create table sales (id uuid primary key default gen_random_uuid(), outlet_id uuid, sale_date date, created_at timestamptz default now());

  create table outlet_shifts (
    id uuid primary key default gen_random_uuid(),
    business_unit_id uuid, outlet_id uuid, slot int, name text,
    start_time time, end_time time, is_active boolean not null default true
  );
  create table shift_schedules (
    id uuid primary key default gen_random_uuid(),
    business_unit_id uuid, outlet_id uuid, user_id uuid, work_date date,
    shift_id uuid, is_off boolean not null default false,
    updated_at timestamptz not null default now(),
    unique (outlet_id, user_id, work_date),
    -- Constraint ASLI dari 0034. Tanpa ini, kerangka uji mengizinkan baris yang
    -- mustahil di produksi (libur TAPI berisi shift_id), dan sabotase jadi
    -- terlihat lolos padahal keadaannya memang tidak bisa terjadi.
    constraint shift_or_off check ((is_off and shift_id is null) or (not is_off and shift_id is not null))
  );
  create table attendance_records (
    id uuid primary key default gen_random_uuid(),
    user_id uuid, business_unit_id uuid, outlet_id uuid,
    clock_in_at timestamptz not null default now(), clock_out_at timestamptz
  );
  create table leave_requests (
    id uuid primary key default gen_random_uuid(),
    user_id uuid, business_unit_id uuid, outlet_id uuid,
    status text not null default 'pending',
    reviewed_at timestamptz, created_at timestamptz not null default now()
  );
  create table reservations (
    id uuid primary key default gen_random_uuid(),
    business_unit_id uuid, outlet_id uuid, customer_name text,
    reserve_date date, status text not null default 'pending',
    created_at timestamptz not null default now()
  );

  create or replace function has_outlet_scope(p_uid uuid, p_outlet uuid) returns boolean language sql stable as $$
    select exists (select 1 from membership_scopes where user_id = p_uid and outlet_id = p_outlet);
  $$;
`);

const jalankan = async (b) =>
  db.exec(fs.readFileSync(path.join(AKAR, 'supabase/migrations', b), 'utf8').replace(/notify pgrst[^;]*;/g, ''));

// 0104 dulu, lalu 0105 menimpanya — persis urutan di produksi.
await jalankan('0104_lencana_beranda.sql');
await jalankan('0105_lencana_shift_cuti_reservasi.sql');
console.log('  0104 lalu 0105 terpasang.');
await jalankan('0105_lencana_shift_cuti_reservasi.sql');
console.log('  dijalankan ulang: aman.');

// =====================================================================
// DATA
// =====================================================================
const BU = (await satu(`insert into business_units (name) values ('Cafe') returning id`)).id;
const SHIFTAN = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Serpong') returning id`, [BU])).id;
const TANPA_SHIFT = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Sentul') returning id`, [BU])).id;

const AKU = '11111111-1111-1111-1111-111111111111';
const REKAN = '22222222-2222-2222-2222-222222222222';
await q(`insert into user_profiles (id, full_name) values ($1,'Aku'),($2,'Rekan')`, [AKU, REKAN]);
await q(`insert into membership_scopes (user_id, business_unit_id, outlet_id) values
  ($1,$3,$4),($1,$3,$5),($2,$3,$4)`, [AKU, REKAN, BU, SHIFTAN, TANPA_SHIFT]);

const HARI_INI = `(now() at time zone 'Asia/Jakarta')::date`;

// =====================================================================
// 1. OUTLET TANPA SHIFT — tidak pernah berlencana
// =====================================================================
await sebagai(AKU);
let L = await lencana(BU, TANPA_SHIFT);
cek('1. outlet tanpa jam shift: nol', jumlah(L, 'shift'), 0);
cek('1.   dan dikatakan tidak pakai shift', rincian(L, 'shift').pakai_shift, false);

// Bahkan kalau ADA jadwalnya — data lama yang tertinggal tidak boleh
// menyalakan lencana di outlet yang tidak memakai shift.
await q(`insert into shift_schedules (business_unit_id, outlet_id, user_id, work_date, shift_id)
  values ($1,$2,$3,${HARI_INI},gen_random_uuid())`, [BU, TANPA_SHIFT, AKU]);
cek('1. ada jadwal tapi tanpa jam shift: tetap nol', jumlah(await lencana(BU, TANPA_SHIFT), 'shift'), 0);

// Jam shift yang DINONAKTIFKAN juga bukan "pakai shift".
const SLOT_MATI = (await satu(`insert into outlet_shifts (business_unit_id, outlet_id, slot, name, start_time, end_time, is_active)
  values ($1,$2,1,'Pagi','07:00','15:00',false) returning id`, [BU, TANPA_SHIFT])).id;
cek('1. jam shift nonaktif: tetap nol', jumlah(await lencana(BU, TANPA_SHIFT), 'shift'), 0);
cek('1.   pakai_shift tetap false', rincian(await lencana(BU, TANPA_SHIFT), 'shift').pakai_shift, false);

// =====================================================================
// 2. OUTLET BERSHIFT — belum clock in
// =====================================================================
const PAGI = (await satu(`insert into outlet_shifts (business_unit_id, outlet_id, slot, name, start_time, end_time)
  values ($1,$2,1,'Pagi','07:00','15:00') returning id`, [BU, SHIFTAN])).id;

L = await lencana(BU, SHIFTAN);
cek('2. pakai shift tapi belum dijadwalkan: nol', jumlah(L, 'shift'), 0);
cek('2.   pakai_shift true', rincian(L, 'shift').pakai_shift, true);

await q(`insert into shift_schedules (business_unit_id, outlet_id, user_id, work_date, shift_id)
  values ($1,$2,$3,${HARI_INI},$4)`, [BU, SHIFTAN, AKU, PAGI]);

L = await lencana(BU, SHIFTAN);
cek('2. dijadwalkan & belum clock in: menyala', jumlah(L, 'shift'), 1);
cek('2.   jenisnya seru, bukan angka', L.modul.shift.jenis, 'seru');
cek('2.   dikatakan belum clock in', rincian(L, 'shift').belum_clock_in, true);

// Sesudah clock in -> padam.
await q(`insert into attendance_records (user_id, business_unit_id, outlet_id) values ($1,$2,$3)`, [AKU, BU, SHIFTAN]);
cek('2. sesudah clock in: padam', jumlah(await lencana(BU, SHIFTAN), 'shift'), 0);

// Clock in KEMARIN tidak memadamkan lencana hari ini.
await q(`delete from attendance_records where user_id = $1`, [AKU]);
await q(`insert into attendance_records (user_id, business_unit_id, outlet_id, clock_in_at)
  values ($1,$2,$3, now() - interval '1 day')`, [AKU, BU, SHIFTAN]);
cek('2. clock in kemarin tidak memadamkan', jumlah(await lencana(BU, SHIFTAN), 'shift'), 1);

// Clock in di OUTLET LAIN juga tidak memadamkan.
await q(`delete from attendance_records where user_id = $1`, [AKU]);
await q(`insert into attendance_records (user_id, business_unit_id, outlet_id) values ($1,$2,$3)`, [AKU, BU, TANPA_SHIFT]);
cek('2. clock in di outlet lain tidak memadamkan', jumlah(await lencana(BU, SHIFTAN), 'shift'), 1);
await q(`delete from attendance_records where user_id = $1`, [AKU]);

// LIBUR yang dijadwalkan bukan pekerjaan.
await q(`update shift_schedules set is_off = true, shift_id = null where user_id = $1 and outlet_id = $2`, [AKU, SHIFTAN]);
cek('2. dijadwalkan LIBUR: tidak menyala', jumlah(await lencana(BU, SHIFTAN), 'shift'), 0);
await q(`update shift_schedules set is_off = false, shift_id = $3 where user_id = $1 and outlet_id = $2`, [AKU, SHIFTAN, PAGI]);

// Jadwal KEMARIN tidak menyalakan lencana hari ini.
await q(`update shift_schedules set work_date = ${HARI_INI} - 1 where user_id = $1 and outlet_id = $2`, [AKU, SHIFTAN]);
cek('2. jadwal kemarin tidak menyala', jumlah(await lencana(BU, SHIFTAN), 'shift'), 0);
await q(`update shift_schedules set work_date = ${HARI_INI} where user_id = $1 and outlet_id = $2`, [AKU, SHIFTAN]);

// =====================================================================
// 3. LENCANA SHIFT ITU PRIBADI
//
// Kalau ia menghitung jadwal seluruh outlet, setiap orang melihat tanda untuk
// shift rekannya — dan tidak ada yang bisa menghilangkannya sendiri.
// =====================================================================
await q(`insert into shift_schedules (business_unit_id, outlet_id, user_id, work_date, shift_id)
  values ($1,$2,$3,${HARI_INI},$4)`, [BU, SHIFTAN, REKAN, PAGI]);

cek('3. aku: menyala (jadwalku sendiri)', jumlah(await lencana(BU, SHIFTAN), 'shift'), 1);

// Aku clock in; rekan belum. Lencanaku HARUS padam.
await q(`insert into attendance_records (user_id, business_unit_id, outlet_id) values ($1,$2,$3)`, [AKU, BU, SHIFTAN]);
cek('3. aku sudah clock in: padam walau rekan belum', jumlah(await lencana(BU, SHIFTAN), 'shift'), 0);

// Dan lencana rekan tetap menyala.
await sebagai(REKAN);
cek('3. rekan: masih menyala', jumlah(await lencana(BU, SHIFTAN), 'shift'), 1);
await sebagai(AKU);

// =====================================================================
// 4. CUTI — hanya kabar, tidak pernah berangka
// =====================================================================
L = await lencana(BU, SHIFTAN);
cek('4. tanpa pengajuan: nol', jumlah(L, 'leave'), 0);
cek('4.   belum ada kabar', L.modul.leave.terakhir_aktivitas, null);
cek('4.   ditandai hanya kabar', rincian(L, 'leave').hanya_kabar, true);

// Mengajukan cuti TIDAK menyalakan kabar untuk diri sendiri.
const CUTI = (await satu(`insert into leave_requests (user_id, business_unit_id, outlet_id, status)
  values ($1,$2,$3,'pending') returning id`, [AKU, BU, SHIFTAN])).id;
L = await lencana(BU, SHIFTAN);
cek('4. baru mengajukan: belum ada kabar', L.modul.leave.terakhir_aktivitas, null);
cek('4.   dan tetap nol', jumlah(L, 'leave'), 0);

// Diputus -> baru ada kabar.
await q(`update leave_requests set status = 'approved', reviewed_at = now() where id = $1`, [CUTI]);
L = await lencana(BU, SHIFTAN);
benar('4. sesudah diputus: ada kabar', L.modul.leave.terakhir_aktivitas != null);
cek('4.   TETAP nol (bukan pekerjaan)', jumlah(L, 'leave'), 0);

// WAKTUNYA HARUS DARI KEPUTUSAN, BUKAN DARI PENGAJUAN.
//
// Pengajuan lama yang baru diputus hari ini adalah kabar HARI INI. Kalau yang
// dipakai `created_at`, waktunya tertinggal di masa lalu — titik birunya tidak
// akan pernah menyala, dan staff tidak pernah tahu cutinya sudah diputus.
await q(`delete from leave_requests where user_id = $1`, [AKU]);
await q(`insert into leave_requests (user_id, business_unit_id, outlet_id, status, created_at, reviewed_at)
  values ($1,$2,$3,'approved', now() - interval '30 days', now())`, [AKU, BU, SHIFTAN]);

const waktuKabar = Date.parse((await lencana(BU, SHIFTAN)).modul.leave.terakhir_aktivitas);
const selisihJam = Math.abs(Date.now() - waktuKabar) / 3600000;
benar('4. waktu kabar = KEPUTUSAN (hari ini), bukan pengajuan (30 hari lalu)',
  selisihJam < 1, `selisih ${selisihJam.toFixed(1)} jam`);

// Pengajuan ORANG LAIN tidak jadi kabar untukku.
await q(`insert into leave_requests (user_id, business_unit_id, outlet_id, status, reviewed_at)
  values ($1,$2,$3,'approved', now() + interval '1 hour')`, [REKAN, BU, SHIFTAN]);
const kabarKu = (await lencana(BU, SHIFTAN)).modul.leave.terakhir_aktivitas;
await sebagai(REKAN);
const kabarRekan = (await lencana(BU, SHIFTAN)).modul.leave.terakhir_aktivitas;
await sebagai(AKU);
benar('4. kabar cuti bersifat pribadi', kabarKu !== kabarRekan, `${kabarKu} vs ${kabarRekan}`);

// =====================================================================
// 5. RESERVASI — hari ini + menunggu putusan, TANPA hitung ganda
// =====================================================================
L = await lencana(BU, SHIFTAN);
cek('5. tanpa reservasi: nol', jumlah(L, 'reservation'), 0);

await q(`insert into reservations (business_unit_id, outlet_id, customer_name, reserve_date, status) values
  ($1,$2,'A',${HARI_INI},'confirmed'),
  ($1,$2,'B',${HARI_INI},'pending'),
  ($1,$2,'C',${HARI_INI},'done'),
  ($1,$2,'D',${HARI_INI},'cancelled')`, [BU, SHIFTAN]);

L = await lencana(BU, SHIFTAN);
cek('5. hari ini: hanya yang aktif', rincian(L, 'reservation').hari_ini, 2);
cek('5.   done & cancelled tidak dihitung', jumlah(L, 'reservation'), 2);

// INI UJI PALING PENTING DI BAGIAN INI.
// "B" berstatus pending DAN tanggalnya hari ini. Ia sudah terhitung sebagai
// `hari_ini` — tidak boleh ikut terhitung lagi sebagai `menunggu_putusan`.
cek('5. pending HARI INI tidak terhitung dua kali', rincian(L, 'reservation').menunggu_putusan, 0);

// Pending untuk hari lain -> menunggu putusan.
await q(`insert into reservations (business_unit_id, outlet_id, customer_name, reserve_date, status)
  values ($1,$2,'E',${HARI_INI} + 3,'pending')`, [BU, SHIFTAN]);
L = await lencana(BU, SHIFTAN);
cek('5. pending hari lain terhitung', rincian(L, 'reservation').menunggu_putusan, 1);
cek('5.   totalnya 2 + 1', jumlah(L, 'reservation'), 3);

// Pending yang tanggalnya SUDAH LEWAT tidak dihitung — ia tidak bisa lagi
// disiapkan, dan lencananya tidak akan pernah padam.
await q(`insert into reservations (business_unit_id, outlet_id, customer_name, reserve_date, status)
  values ($1,$2,'F',${HARI_INI} - 5,'pending')`, [BU, SHIFTAN]);
cek('5. pending yang sudah lewat tidak dihitung', jumlah(await lencana(BU, SHIFTAN), 'reservation'), 3);

// Reservasi outlet lain tidak ikut.
await q(`insert into reservations (business_unit_id, outlet_id, customer_name, reserve_date, status)
  values ($1,$2,'G',${HARI_INI},'confirmed')`, [BU, TANPA_SHIFT]);
cek('5. reservasi outlet lain tidak ikut', jumlah(await lencana(BU, SHIFTAN), 'reservation'), 3);

benar('5. ada kabar reservasi', (await lencana(BU, SHIFTAN)).modul.reservation.terakhir_aktivitas != null);

// =====================================================================
// 6. EMPAT MODUL LAMA TIDAK RUSAK
// =====================================================================
L = await lencana(BU, SHIFTAN);
for (const kode of ['dispatch', 'inventory', 'cleaning_checklist', 'sales']) {
  benar(`6. ${kode} masih ada`, L.modul[kode] != null);
}
cek('6. penjualan masih menyala (belum input)', jumlah(L, 'sales'), 1);
cek('6.   jenisnya masih seru', L.modul.sales.jenis, 'seru');

await q(`insert into dispatches (business_unit_id, from_outlet_id, to_outlet_id, status)
  values ($1,$2,$3,'sent')`, [BU, TANPA_SHIFT, SHIFTAN]);
cek('6. dispatch masih terhitung', jumlah(await lencana(BU, SHIFTAN), 'dispatch'), 1);

// =====================================================================
// 7. SCOPE tetap dijaga
// =====================================================================
const ASING = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Asing') returning id`, [BU])).id;
cek('7. outlet di luar scope: kosong', await lencana(BU, ASING), {});

await db.close();
console.log(gagal === 0 ? '✅ migrasi 0105: semua lulus' : `❌ migrasi 0105: ${gagal} gagal`);
process.exit(gagal === 0 ? 0 : 1);
