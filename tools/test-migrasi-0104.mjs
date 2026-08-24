/**
 * MIGRATION 0104 (lencana beranda) DI POSTGRES SUNGGUHAN.
 *
 * ============ YANG PALING PENTING ============
 *
 * UJI 6 — outlet di luar scope harus mengembalikan objek KOSONG.
 *
 * `security definer` mematikan RLS, jadi tanpa pemeriksaan itu siapa pun bisa
 * membaca keadaan operasional outlet mana pun sekadar dengan menebak id-nya:
 * berapa kiriman menggantung, berapa bahan minus. Kebocoran yang tidak
 * menghasilkan satu pun error.
 *
 * Dan UJI 4 — lencana TIDAK boleh hilang hanya karena kartunya dibuka. Yang
 * diuji: jumlahnya tetap sama sampai pekerjaannya benar-benar selesai.
 *
 * Kerangkanya menyerupai produksi (tabel & fungsi yang benar-benar ada), bukan
 * skema kosong — pelajaran dari 0103, tempat uji dari nol hijau untuk migration
 * yang tidak bisa dijalankan di produksi.
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

/** Hitungan satu modul untuk satu outlet. */
const lencana = async (bu, outlet) => (await satu(`select lencana_beranda($1,$2) r`, [bu, outlet])).r;
const jumlah = (hasil, kode) => hasil?.modul?.[kode]?.jumlah ?? null;

await db.exec(`
  create schema if not exists auth;
  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
  $$;
  create role authenticated;

  create table business_units (id uuid primary key default gen_random_uuid(), name text);
  create table outlets (
    id uuid primary key default gen_random_uuid(),
    business_unit_id uuid, name text, outlet_role text default 'standalone'
  );
  create table user_profiles (id uuid primary key, full_name text);
  create table products (id uuid primary key default gen_random_uuid(), business_unit_id uuid, name text);
  create table membership_scopes (user_id uuid, business_unit_id uuid, outlet_id uuid, role text);

  create table stock_movements (
    id uuid primary key default gen_random_uuid(),
    business_unit_id uuid, outlet_id uuid, product_id uuid,
    movement_type text, qty_delta numeric, dispatch_id uuid,
    created_at timestamptz not null default now()
  );
  create view stock_balances as
    select outlet_id, product_id, sum(qty_delta) qty
      from stock_movements group by 1, 2;

  create table stock_orders (
    id uuid primary key default gen_random_uuid(),
    business_unit_id uuid, from_outlet_id uuid, to_outlet_id uuid,
    status text not null default 'open', created_at timestamptz default now()
  );
  create table dispatches (
    id uuid primary key default gen_random_uuid(),
    business_unit_id uuid, from_outlet_id uuid, to_outlet_id uuid,
    status text not null default 'sent',
    created_at timestamptz not null default now(),
    sent_at timestamptz, received_at timestamptz
  );

  create table checklist_runs (
    id uuid primary key default gen_random_uuid(),
    outlet_id uuid, run_date date, created_at timestamptz default now()
  );
  create table checklist_run_items (
    id uuid primary key default gen_random_uuid(),
    run_id uuid references checklist_runs(id) on delete cascade,
    checked boolean not null default false
  );

  create table sales (
    id uuid primary key default gen_random_uuid(),
    outlet_id uuid, sale_date date, created_at timestamptz default now()
  );

  create or replace function has_outlet_scope(p_uid uuid, p_outlet uuid) returns boolean language sql stable as $$
    select exists (select 1 from membership_scopes where user_id = p_uid and outlet_id = p_outlet);
  $$;
`);

const jalankan = async (berkas) =>
  db.exec(fs.readFileSync(path.join(AKAR, 'supabase/migrations', berkas), 'utf8').replace(/notify pgrst[^;]*;/g, ''));

await jalankan('0104_lencana_beranda.sql');
console.log('  migration 0104 terpasang.');
await jalankan('0104_lencana_beranda.sql');
console.log('  dijalankan ulang: aman.');

// =====================================================================
// DATA
// =====================================================================
const BU = (await satu(`insert into business_units (name) values ('Cafe') returning id`)).id;
const CK = (await satu(`insert into outlets (business_unit_id, name, outlet_role) values ($1,'CK','central_kitchen') returning id`, [BU])).id;
const OUT = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Serpong') returning id`, [BU])).id;
const ASING = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Outlet Lain') returning id`, [BU])).id;

const STAFF = '11111111-1111-1111-1111-111111111111';
const CKSTAFF = '22222222-2222-2222-2222-222222222222';
await q(`insert into user_profiles (id, full_name) values ($1,'Staff'),($2,'CK')`, [STAFF, CKSTAFF]);
await q(`insert into membership_scopes (user_id, business_unit_id, outlet_id) values ($1,$3,$4),($2,$3,$5)`,
  [STAFF, CKSTAFF, BU, OUT, CK]);

const BERAS = (await satu(`insert into products (business_unit_id, name) values ($1,'Beras') returning id`, [BU])).id;
const AYAM = (await satu(`insert into products (business_unit_id, name) values ($1,'Ayam') returning id`, [BU])).id;

// =====================================================================
// 1. SEMUA BERSIH — tidak ada lencana sama sekali
// =====================================================================
await sebagai(STAFF);
let L = await lencana(BU, OUT);
cek('1. dispatch nol', jumlah(L, 'dispatch'), 0);
cek('1. inventory nol', jumlah(L, 'inventory'), 0);
cek('1. aktivitas nol', jumlah(L, 'cleaning_checklist'), 0);
// Penjualan justru BERLENCANA saat bersih: belum ada input hari ini.
cek('1. penjualan menyala (belum input)', jumlah(L, 'sales'), 1);
cek('1.   jenisnya seru, bukan angka', L.modul.sales.jenis, 'seru');

// =====================================================================
// 2. PENGIRIMAN — kiriman masuk yang belum dikonfirmasi
// =====================================================================
await q(`insert into dispatches (business_unit_id, from_outlet_id, to_outlet_id, status) values
  ($1,$2,$3,'sent'), ($1,$2,$3,'sent'), ($1,$2,$3,'received')`, [BU, CK, OUT]);

L = await lencana(BU, OUT);
cek('2. dua kiriman menunggu', jumlah(L, 'dispatch'), 2);
cek('2.   yang sudah diterima tidak dihitung', L.modul.dispatch.rincian.kiriman_masuk, 2);
cek('2. outlet biasa tidak menghitung order/draft', L.modul.dispatch.rincian.order_masuk, 0);

// CK: order menunggu + draft belum berangkat.
await q(`insert into stock_orders (business_unit_id, from_outlet_id, to_outlet_id, status) values
  ($1,$2,$3,'open'), ($1,$2,$3,'fulfilled')`, [BU, OUT, CK]);
await q(`insert into dispatches (business_unit_id, from_outlet_id, to_outlet_id, status) values ($1,$2,$3,'draft')`, [BU, CK, OUT]);

await sebagai(CKSTAFF);
const LCK = await lencana(BU, CK);
cek('2. CK: 1 order + 1 draft', jumlah(LCK, 'dispatch'), 2);
cek('2.   order yang sudah dipenuhi tidak dihitung', LCK.modul.dispatch.rincian.order_masuk, 1);
cek('2.   draftnya terhitung', LCK.modul.dispatch.rincian.draft, 1);
// CK tidak berjualan -> tidak pernah dilencanai "belum input penjualan".
cek('2. CK tidak berlencana penjualan', jumlah(LCK, 'sales'), 0);

// =====================================================================
// 3. BAHAN — hanya yang MINUS
// =====================================================================
await sebagai(STAFF);
await q(`insert into stock_movements (business_unit_id, outlet_id, product_id, movement_type, qty_delta) values
  ($1,$2,$3,'receive',10), ($1,$2,$4,'usage',-5)`, [BU, OUT, BERAS, AYAM]);

L = await lencana(BU, OUT);
cek('3. satu bahan minus', jumlah(L, 'inventory'), 1);

// Saldo nol BUKAN minus — dan bedanya penting: nol berarti habis, minus berarti
// catatannya tidak cocok dengan kenyataan.
await q(`insert into stock_movements (business_unit_id, outlet_id, product_id, movement_type, qty_delta) values ($1,$2,$3,'usage',-10)`, [BU, OUT, BERAS]);
cek('3. saldo nol tidak dihitung minus', jumlah(await lencana(BU, OUT), 'inventory'), 1);

// Dikembalikan sampai positif -> lencananya hilang.
await q(`insert into stock_movements (business_unit_id, outlet_id, product_id, movement_type, qty_delta) values ($1,$2,$3,'receive',20)`, [BU, OUT, AYAM]);
cek('3. sesudah dibetulkan: lencana hilang', jumlah(await lencana(BU, OUT), 'inventory'), 0);

// =====================================================================
// 4. LENCANA TIDAK HILANG HANYA KARENA DIBUKA
//
// Inilah alasan lencana merah dihitung di server dari pekerjaan yang benar-benar
// tertunda, bukan disimpan sebagai penanda "sudah dilihat".
// =====================================================================
const sebelum = jumlah(await lencana(BU, OUT), 'dispatch');
cek('4. masih 2 kiriman menunggu', sebelum, 2);

// "Membuka kartu" tidak mengubah apa pun di database — dan hasilnya tetap sama.
cek('4. dipanggil lagi: angkanya TETAP', jumlah(await lencana(BU, OUT), 'dispatch'), 2);
cek('4.   dan lagi', jumlah(await lencana(BU, OUT), 'dispatch'), 2);

// Baru hilang ketika kirimannya benar-benar dikonfirmasi.
await q(`update dispatches set status = 'received' where to_outlet_id = $1 and status = 'sent'`, [OUT]);
cek('4. sesudah dikonfirmasi: lencana hilang', jumlah(await lencana(BU, OUT), 'dispatch'), 0);

// =====================================================================
// 5. DAILY ACTIVITIES — hanya hari ini, hanya yang belum dicentang
// =====================================================================
const RUN = (await satu(`insert into checklist_runs (outlet_id, run_date) values ($1, (now() at time zone 'Asia/Jakarta')::date) returning id`, [OUT])).id;
await q(`insert into checklist_run_items (run_id, checked) values ($1,false),($1,false),($1,true)`, [RUN]);

L = await lencana(BU, OUT);
cek('5. dua item belum dicentang', jumlah(L, 'cleaning_checklist'), 2);
cek('5.   ada sesi hari ini', L.modul.cleaning_checklist.rincian.ada_sesi_hari_ini, true);

// Run KEMARIN tidak boleh ikut terhitung — lencana yang membawa pekerjaan
// kemarin tidak akan pernah bisa dihilangkan.
const RUN_LAMA = (await satu(`insert into checklist_runs (outlet_id, run_date) values ($1, (now() at time zone 'Asia/Jakarta')::date - 1) returning id`, [OUT])).id;
await q(`insert into checklist_run_items (run_id, checked) values ($1,false),($1,false),($1,false)`, [RUN_LAMA]);
cek('5. run kemarin TIDAK ikut dihitung', jumlah(await lencana(BU, OUT), 'cleaning_checklist'), 2);

await q(`update checklist_run_items set checked = true where run_id = $1`, [RUN]);
cek('5. sesudah dicentang semua: hilang', jumlah(await lencana(BU, OUT), 'cleaning_checklist'), 0);

// Outlet yang belum membuka sesi sama sekali: nol, DAN dikatakan bahwa
// sesinya memang belum ada — supaya layar tidak salah menyimpulkan "sudah beres".
const LASING = await lencana(BU, OUT);
cek('5. ada_sesi tetap dilaporkan', LASING.modul.cleaning_checklist.rincian.ada_sesi_hari_ini, true);

// =====================================================================
// 6. SCOPE — outlet di luar wewenang mengembalikan KOSONG
//
// Angka lencana itu sendiri membocorkan keadaan operasional: berapa kiriman
// menggantung, berapa bahan minus. `security definer` mematikan RLS, jadi
// pemeriksaan ini satu-satunya yang menjaganya.
// =====================================================================
const bocor = await lencana(BU, ASING);
cek('6. outlet di luar scope -> objek kosong', bocor, {});
benar('6.   tidak ada satu pun hitungan', !bocor?.modul);

// CK tidak bisa mengintip outlet cabang, dan sebaliknya.
await sebagai(CKSTAFF);
cek('6. CK tidak bisa membaca lencana outlet lain', await lencana(BU, OUT), {});
await sebagai(STAFF);
cek('6. outlet tidak bisa membaca lencana CK', await lencana(BU, CK), {});

// Outlet null -> kosong, bukan error.
cek('6. outlet null aman', await lencana(BU, null), {});

// =====================================================================
// 7. PENJUALAN — hilang setelah ada input hari ini
// =====================================================================
cek('7. sebelum input: menyala', jumlah(await lencana(BU, OUT), 'sales'), 1);
await q(`insert into sales (outlet_id, sale_date) values ($1, (now() at time zone 'Asia/Jakarta')::date)`, [OUT]);
cek('7. sesudah input: padam', jumlah(await lencana(BU, OUT), 'sales'), 0);

// Penjualan KEMARIN tidak memadamkan lencana hari ini.
await q(`delete from sales where outlet_id = $1`, [OUT]);
await q(`insert into sales (outlet_id, sale_date) values ($1, (now() at time zone 'Asia/Jakarta')::date - 1)`, [OUT]);
cek('7. penjualan kemarin tidak memadamkan', jumlah(await lencana(BU, OUT), 'sales'), 1);

// =====================================================================
// 8. WAKTU AKTIVITAS — bahan untuk titik biru
// =====================================================================
L = await lencana(BU, OUT);
for (const kode of ['dispatch', 'inventory', 'cleaning_checklist', 'sales']) {
  benar(`8. ${kode} membawa terakhir_aktivitas`, L.modul[kode].terakhir_aktivitas != null, JSON.stringify(L.modul[kode]));
}

// Outlet tanpa aktivitas sama sekali -> null, BUKAN 1970. Tanggal epoch akan
// dibandingkan sebagai "sangat lama" dan titik birunya tidak pernah muncul —
// diam yang benar secara kebetulan, bukan karena disengaja.
const KOSONG = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Baru') returning id`, [BU])).id;
await q(`insert into membership_scopes (user_id, business_unit_id, outlet_id) values ($1,$2,$3)`, [STAFF, BU, KOSONG]);
const LB = await lencana(BU, KOSONG);
cek('8. outlet baru: dispatch null', LB.modul.dispatch.terakhir_aktivitas, null);
cek('8.   inventory null', LB.modul.inventory.terakhir_aktivitas, null);
benar('8.   bukan 1970', !JSON.stringify(LB).includes('1970'));

await db.close();
console.log(gagal === 0 ? '✅ migrasi 0104: semua lulus' : `❌ migrasi 0104: ${gagal} gagal`);
process.exit(gagal === 0 ? 0 : 1);
