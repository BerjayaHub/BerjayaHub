/**
 * MIGRATION 0109 DI POSTGRES SUNGGUHAN (PGlite).
 *
 * ============ YANG DIBUKTIKAN DI SINI ============
 *
 * Laporannya: transfer antar outlet / retur ke CK berkata "jadi draft", tapi
 * drafnya tidak ada di mana pun.
 *
 * Sebabnya satu anggapan yang sudah tidak berlaku — "yang punya draft cuma
 * Central Kitchen" — yang tertulis di TIGA tempat. Yang di database adalah
 * `v_draft` yang dihitung di dalam `if v_role = 'central_kitchen'`.
 *
 * Yang membuat bug ini bertahan: TIDAK ADA satu pun error. Fungsi pembuat
 * drafnya sendiri sudah benar sejak awal — `buat_draft_kiriman` dan
 * `boleh_kelola_draft` memakai `has_outlet_scope(from_outlet_id)` dan tidak
 * pernah memeriksa peran outlet. Datanya masuk dengan rapi ke tabel yang benar.
 * Yang hilang cuma cara melihatnya, dan angka nol di lencana terlihat persis
 * seperti "memang tidak ada apa-apa".
 *
 * Jadi §1 sengaja dimulai dengan MEMBUAT draft lewat jalur outlet biasa: kalau
 * pembuatannya saja gagal, seluruh cerita di atas salah dan tes ini harus
 * merah di baris pertama, bukan di baris lencananya.
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
    user_id uuid, business_unit_id uuid, outlet_id uuid, nbm_outlet_id uuid,
    clock_in_at timestamptz not null default now(), clock_out_at timestamptz,
    late_dinilai_ulang_at timestamptz
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

// Urutan produksi. Tiap migration menimpa yang sebelumnya, jadi yang diuji
// selalu versi TERAKHIR — dan kalau 0109 lupa menyalin sesuatu dari 0107,
// bagian lain tesnya yang jatuh, bukan bagian draftnya.
await jalankan('0104_lencana_beranda.sql');
await jalankan('0105_lencana_shift_cuti_reservasi.sql');
await jalankan('0107_kabar_shift_dari_penilaian_ulang.sql');
await jalankan('0109_lencana_draft_semua_outlet.sql');
console.log('  0104 -> 0105 -> 0107 -> 0109 terpasang.');
await jalankan('0109_lencana_draft_semua_outlet.sql');
console.log('  dijalankan ulang: aman.');

// =====================================================================
// DATA
//
//   CK       central_kitchen
//   SERPONG  outlet biasa  <- yang melakukan transfer & retur
//   SENTUL   outlet biasa  <- tujuan transfer
// =====================================================================
const BU = (await satu(`insert into business_units (name) values ('Cafe') returning id`)).id;
const CK = (await satu(`insert into outlets (business_unit_id, name, outlet_role) values ($1,'Central Kitchen','central_kitchen') returning id`, [BU])).id;
const SERPONG = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Serpong') returning id`, [BU])).id;
const SENTUL = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Sentul') returning id`, [BU])).id;

const AKU = '11111111-1111-1111-1111-111111111111';
const ORANG_LUAR = '99999999-9999-9999-9999-999999999999';
await q(`insert into user_profiles (id, full_name) values ($1,'Aku'),($2,'Luar')`, [AKU, ORANG_LUAR]);
await q(`insert into membership_scopes (user_id, business_unit_id, outlet_id) values
  ($1,$2,$3),($1,$2,$4),($1,$2,$5)`, [AKU, BU, CK, SERPONG, SENTUL]);

const draft = (dari, ke) =>
  q(`insert into dispatches (business_unit_id, from_outlet_id, to_outlet_id, status) values ($1,$2,$3,'draft')`, [BU, dari, ke]);

await sebagai(AKU);

// =====================================================================
// 1. TRANSFER ANTAR OUTLET — draft dari outlet BIASA
// =====================================================================
let L = await lencana(BU, SERPONG);
cek('1. mula-mula tidak ada draft', rincian(L, 'dispatch').draft, 0);

await draft(SERPONG, SENTUL);
L = await lencana(BU, SERPONG);
cek('1. draft transfer terhitung di outlet ASAL', rincian(L, 'dispatch').draft, 1);
cek('1. dan ikut menaikkan angka lencananya', jumlah(L, 'dispatch'), 1);

// Yang berkepentingan adalah outlet ASAL — dia yang harus mengirim. Outlet
// TUJUAN tidak boleh melihat apa pun: barangnya belum berangkat, dan lencana
// yang menyala di sana berarti menunggu sesuatu yang belum ada.
cek('1. outlet TUJUAN tidak ikut berlencana', rincian(await lencana(BU, SENTUL), 'dispatch').draft, 0);

// =====================================================================
// 2. RETUR KE CK — draft dari outlet biasa, tujuannya CK
// =====================================================================
await draft(SERPONG, CK);
cek('2. draft retur ikut terhitung', rincian(await lencana(BU, SERPONG), 'dispatch').draft, 2);
cek('2. CK sebagai TUJUAN retur tidak ikut', rincian(await lencana(BU, CK), 'dispatch').draft, 0);

// =====================================================================
// 3. CK TIDAK BOLEH KEHILANGAN APA PUN
//
// Perbaikan ini memindahkan `v_draft` keluar dari `if v_role = ...`.
// Kalau pemindahannya meleset, yang paling mungkin rusak justru sisi CK yang
// selama ini sudah benar.
// =====================================================================
await draft(CK, SERPONG);
const LCK = await lencana(BU, CK);
cek('3. draft CK tetap terhitung', rincian(LCK, 'dispatch').draft, 1);

await q(`insert into stock_orders (business_unit_id, from_outlet_id, to_outlet_id, status) values ($1,$2,$3,'open')`, [BU, SERPONG, CK]);
cek('3. order masuk CK tetap terhitung', rincian(await lencana(BU, CK), 'dispatch').order_masuk, 1);

// ORDER MASUK tetap khusus CK — itu memang benar, dan tidak ikut dilonggarkan.
// Kalau ia ikut terbuka, outlet biasa akan melihat angka order yang tidak
// pernah bisa ia proses.
await q(`insert into stock_orders (business_unit_id, from_outlet_id, to_outlet_id, status) values ($1,$2,$3,'open')`, [BU, CK, SERPONG]);
cek('3. order masuk TIDAK dihitung untuk outlet biasa', rincian(await lencana(BU, SERPONG), 'dispatch').order_masuk, 0);

// =====================================================================
// 4. DRAFT YANG SUDAH DIKIRIM BERHENTI DIHITUNG
//
// Lencana yang tidak pernah padam sesudah pekerjaannya selesai akan berhenti
// dipercaya, dan sesudah itu ia sama saja dengan tidak ada.
// =====================================================================
await q(`update dispatches set status='sent', sent_at=now() where from_outlet_id=$1 and to_outlet_id=$2`, [SERPONG, SENTUL]);
cek('4. draft yang dikirim tidak lagi dihitung sebagai draft', rincian(await lencana(BU, SERPONG), 'dispatch').draft, 1);
cek('4. dan muncul sebagai kiriman masuk di tujuannya', rincian(await lencana(BU, SENTUL), 'dispatch').kiriman_masuk, 1);

// =====================================================================
// 5. WEWENANG TIDAK IKUT LONGGAR
//
// `lencana_beranda` itu `security definer` — RLS mati di dalamnya. Tanpa
// `has_outlet_scope`, siapa pun bisa membaca keadaan operasional outlet mana
// pun sekadar dengan menebak id-nya.
// =====================================================================
await sebagai(ORANG_LUAR);
cek('5. orang di luar outlet tidak dapat apa-apa', await lencana(BU, SERPONG), {});

// =====================================================================
// 6. MODUL LAIN TIDAK IKUT BERGESER
//
// 0109 menyalin fungsi sepanjang tujuh modul dari 0107. Satu baris yang
// bergeser tanpa sengaja tidak menghasilkan error — hanya angka yang meleset
// di modul yang tidak ada hubungannya dengan draft.
// =====================================================================
await sebagai(AKU);
const LS = await lencana(BU, SERPONG);
for (const kode of ['dispatch', 'inventory', 'cleaning_checklist', 'sales', 'shift', 'leave', 'reservation']) {
  benar(`6. modul "${kode}" masih dilaporkan`, LS?.modul?.[kode] != null, JSON.stringify(Object.keys(LS?.modul ?? {})));
}
cek('6. jenis lencana dispatch tetap angka', LS.modul.dispatch.jenis, 'angka');
cek('6. jenis lencana penjualan tetap seru', LS.modul.sales.jenis, 'seru');

console.log(gagal === 0 ? '✅ migrasi 0109: draft outlet terhitung, sisi CK utuh, wewenang tetap.' : `❌ migrasi 0109: ${gagal} gagal`);
process.exit(gagal === 0 ? 0 : 1);
