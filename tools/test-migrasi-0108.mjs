/**
 * MIGRATION 0108 DI POSTGRES SUNGGUHAN (PGlite).
 *
 * ============ PERTANYAAN YANG DIJAWAB DI SINI ============
 *
 *   "saat penjualan menu di input apakah bahan yang digunakan menu yang
 *    terjual tersebut sesuai resep juga berkurang? saya ingin tetap berkurang
 *    walaupun minus"
 *
 * Ada tiga hal berbeda di dalamnya, dan ketiganya diuji terpisah:
 *
 *   §1  stok BERKURANG sesuai takaran resep
 *   §2  ia tetap berkurang SAMPAI MINUS — tidak ditahan di nol
 *   §3  menu yang TIDAK menggerakkan stok mengatakannya, tidak diam
 *
 * §2 tidak bisa dijawab dengan membaca SQL. Penjaga yang menahan di nol bisa
 * berbentuk `greatest(..., 0)`, bisa `case when`, bisa constraint di tabelnya.
 * Yang membuktikan cuma menjual barang yang stoknya kosong lalu melihat
 * angkanya.
 *
 * §3 adalah bagian yang benar-benar BARU di 0108. Sebelumnya cabangnya tidak
 * ada sama sekali, dan menu tanpa resep menambah omzet tanpa jejak apa pun.
 */
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AKAR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

let gagal = 0;
const cek = (nama, dapat, harap) => {
  const a = typeof dapat === 'number' ? Number(dapat.toFixed(6)) : dapat;
  const b = typeof harap === 'number' ? Number(harap.toFixed(6)) : harap;
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    gagal++;
    console.error(`❌ ${nama}\n   dapat : ${JSON.stringify(a)}\n   harap : ${JSON.stringify(b)}`);
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

// =====================================================================
// KERANGKA — mencerminkan produksi, bukan disederhanakan.
//
// Pelajaran dari 0103: kerangka yang membuat fungsi dari nol membuat
// `42P13` (tidak boleh mengubah tipe kembalian) tidak pernah muncul di sini,
// padahal ia menggagalkan migration-nya di produksi. Jadi `record_sales`
// VERSI LAMA dipasang dulu lewat 0101, baru 0108 menimpanya — persis urutan
// yang akan terjadi di SQL Editor.
// =====================================================================
await db.exec(`
  create schema if not exists auth;
  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
  $$;

  create table business_units (id uuid primary key default gen_random_uuid(), name text);
  create table outlets (
    id uuid primary key default gen_random_uuid(),
    business_unit_id uuid references business_units(id),
    name text, outlet_role text default 'standalone', allow_sales boolean default true
  );
  create table user_profiles (id uuid primary key, full_name text);
  create table products (id uuid primary key default gen_random_uuid(), business_unit_id uuid, name text, category text);
  create table recipes (id uuid primary key default gen_random_uuid(), product_id uuid, mode text, yield_qty numeric);
  create table recipe_items (id uuid primary key default gen_random_uuid(), recipe_id uuid, ingredient_product_id uuid, qty numeric);

  create table sales (
    id uuid primary key default gen_random_uuid(),
    business_unit_id uuid, outlet_id uuid, sale_date date, product_id uuid,
    qty numeric, unit_price numeric, revenue numeric,
    created_by uuid, created_at timestamptz not null default now(), submission_id uuid
  );
  create table sales_submissions (
    id uuid primary key, business_unit_id uuid, outlet_id uuid, sale_date date,
    created_by uuid, item_count int default 0, total_revenue numeric default 0
  );
  create table stock_movements (
    id uuid primary key default gen_random_uuid(),
    business_unit_id uuid, outlet_id uuid, product_id uuid,
    movement_type text, qty_delta numeric, notes text,
    created_by uuid, created_at timestamptz not null default now()
  );
  create table outlet_menu_prices (
    id uuid primary key default gen_random_uuid(),
    outlet_id uuid, product_id uuid, selling_price numeric, packaging_cost numeric default 0
  );
  create table assets (
    id uuid primary key default gen_random_uuid(),
    business_unit_id uuid not null, outlet_id uuid not null,
    name text not null, qty numeric default 1, size text, photo_path text,
    condition text default 'normal', condition_note text, notes text,
    created_by uuid, updated_by uuid,
    created_at timestamptz default now(), updated_at timestamptz default now()
  );
  create table membership_scopes (user_id uuid, business_unit_id uuid, outlet_id uuid, role text);

  create role authenticated;

  create or replace function has_bu_scope(p_uid uuid, p_bu uuid) returns boolean language sql stable as $$
    select exists (select 1 from membership_scopes where user_id = p_uid and business_unit_id = p_bu);
  $$;
  create or replace function has_outlet_scope(p_uid uuid, p_outlet uuid) returns boolean language sql stable as $$
    select exists (select 1 from membership_scopes where user_id = p_uid and outlet_id = p_outlet);
  $$;
  create or replace function is_bu_admin(p_uid uuid, p_bu uuid) returns boolean language sql stable as $$
    select exists (select 1 from membership_scopes where user_id = p_uid and business_unit_id = p_bu and role in ('bu_admin','super_admin'));
  $$;
  create or replace function harga_outlet_aktif(p_outlet uuid, p_product uuid, p_date date) returns outlet_menu_prices language sql stable as $$
    select * from outlet_menu_prices where outlet_id = p_outlet and product_id = p_product limit 1;
  $$;
`);

const jalankan = async (berkas) => {
  const sql = fs.readFileSync(path.join(AKAR, 'supabase/migrations', berkas), 'utf8');
  await db.exec(sql.replace(/notify pgrst[^;]*;/g, ''));
};

await jalankan('0101_ubah_hapus_penjualan.sql');
await jalankan('0108_lapor_penjualan_tanpa_resep.sql');
console.log('  0101 lalu 0108 terpasang di atasnya (urutan seperti produksi).');

// Dijalankan dua kali. Migration yang hanya bisa dipasang sekali akan
// menggagalkan pemasangan ulang saat ada perbaikan menyusul.
await jalankan('0108_lapor_penjualan_tanpa_resep.sql');
console.log('  dijalankan ulang: aman.');

// =====================================================================
// DATA UJI
//
//   Nasi Goreng  : 1 porsi = 200 g beras + 50 g bumbu   (resep lengkap)
//   Air Mineral  : tidak punya resep sama sekali
//   Es Teh       : punya resep, TAPI recipe_items-nya kosong
// =====================================================================
const BU = (await satu(`insert into business_units (name) values ('Cafe') returning id`)).id;
const OUT = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Serpong') returning id`, [BU])).id;

const STAFF = '11111111-1111-1111-1111-111111111111';
await q(`insert into user_profiles (id, full_name) values ($1,'Staff')`, [STAFF]);
await q(`insert into membership_scopes (user_id, business_unit_id, outlet_id, role) values ($1,$2,$3,'staff')`, [STAFF, BU, OUT]);

const MENU = (await satu(`insert into products (business_unit_id, name) values ($1,'Nasi Goreng') returning id`, [BU])).id;
const BERAS = (await satu(`insert into products (business_unit_id, name) values ($1,'Beras') returning id`, [BU])).id;
const BUMBU = (await satu(`insert into products (business_unit_id, name) values ($1,'Bumbu') returning id`, [BU])).id;
const AIR = (await satu(`insert into products (business_unit_id, name) values ($1,'Air Mineral') returning id`, [BU])).id;
const TEH = (await satu(`insert into products (business_unit_id, name) values ($1,'Es Teh') returning id`, [BU])).id;

const RES = (await satu(`insert into recipes (product_id, mode, yield_qty) values ($1,'standalone',1) returning id`, [MENU])).id;
await q(`insert into recipe_items (recipe_id, ingredient_product_id, qty) values ($1,$2,200),($1,$3,50)`, [RES, BERAS, BUMBU]);

// Resep yang ADA tapi ISINYA KOSONG. Bentuk kegagalan yang paling menipu:
// di layar Admin menu ini berstatus "sudah ada resep".
await q(`insert into recipes (product_id, mode, yield_qty) values ($1,'standalone',1)`, [TEH]);

await q(`insert into outlet_menu_prices (outlet_id, product_id, selling_price) values
  ($1,$2,25000),($1,$3,5000),($1,$4,8000)`, [OUT, MENU, AIR, TEH]);

const saldo = async (produk) =>
  Number((await satu(`select coalesce(sum(qty_delta),0) s from stock_movements where product_id=$1 and outlet_id=$2`, [produk, OUT])).s);

const jual = async (ref, items) =>
  (await satu(`select record_sales($1,$2,current_date,$3::jsonb,$4) r`, [BU, OUT, JSON.stringify(items), ref])).r;

await sebagai(STAFF);

// =====================================================================
// §1. STOK BERKURANG SESUAI RESEP
// =====================================================================
const h1 = await jual('44444444-4444-4444-4444-444444444441', [{ product_id: MENU, qty: 10 }]);

cek('1. tercatat 1 item', h1.item, 1);
cek('1. omzet 10 × 25.000', Number(h1.omzet), 250000);
cek('1. beras berkurang 10 × 200 g', await saldo(BERAS), -2000);
cek('1. bumbu berkurang 10 × 50 g', await saldo(BUMBU), -500);

// Tipenya harus 'usage'. Kalau tercatat sebagai tipe lain, laporan pemakaian
// bahan akan kehilangan angka ini tanpa satu pun selisih yang kelihatan di
// saldo — saldonya benar, laporannya bohong.
const tipe = (await satu(`select distinct movement_type t from stock_movements where product_id=$1`, [BERAS])).t;
cek('1. tercatat sebagai pemakaian', tipe, 'usage');

cek('1. tidak ada yang perlu dilaporkan', h1.tanpa_resep, []);
cek('1. resep kosong juga tidak ada', h1.resep_kosong, []);

// =====================================================================
// §2. TETAP BERKURANG SAMPAI MINUS
//
// Inti permintaannya. Stok beras sudah −2.000 g dari §1; menjual 10 porsi lagi
// harus membawanya ke −4.000, BUKAN ditahan di 0.
// =====================================================================
const h2 = await jual('44444444-4444-4444-4444-444444444442', [{ product_id: MENU, qty: 10 }]);
cek('2. penjualan kedua tetap tercatat', h2.item, 1);
cek('2. beras menembus minus lebih dalam', await saldo(BERAS), -4000);
cek('2. bumbu ikut menembus minus', await saldo(BUMBU), -1000);

benar('2. tidak ada penjaga yang menahan di nol', (await saldo(BERAS)) < 0, `saldo beras = ${await saldo(BERAS)}`);

// Diperiksa juga pada BARIS pergerakannya, bukan cuma jumlahnya. Penjaga yang
// memotong per baris (`greatest(qty, 0)`) akan tetap menghasilkan saldo negatif
// dari baris-baris sebelumnya, jadi memeriksa saldo saja belum cukup.
const gerakanTerakhir = Number(
  (await satu(`select qty_delta d from stock_movements where product_id=$1 order by created_at desc, id desc limit 1`, [BERAS])).d
);
cek('2. baris terakhir tetap −2.000, bukan dipotong', gerakanTerakhir, -2000);

// =====================================================================
// §3. MENU TANPA RESEP — dilaporkan, bukan didiamkan
// =====================================================================
const h3 = await jual('44444444-4444-4444-4444-444444444443', [{ product_id: AIR, qty: 6 }]);

cek('3. penjualannya TETAP tercatat', h3.item, 1);
cek('3. omzetnya tetap masuk', Number(h3.omzet), 30000);
cek('3. dilaporkan sebagai menu tanpa resep', h3.tanpa_resep, ['Air Mineral']);
cek('3. bukan digolongkan resep kosong', h3.resep_kosong, []);

const gerakanAir = Number((await satu(`select count(*) n from stock_movements where notes ilike '%Air Mineral%'`)).n);
cek('3. memang tidak ada stok yang bergerak', gerakanAir, 0);

// =====================================================================
// §4. RESEP ADA TAPI ISINYA KOSONG — sebab berbeda, laporan berbeda
// =====================================================================
const h4 = await jual('44444444-4444-4444-4444-444444444444', [{ product_id: TEH, qty: 3 }]);

cek('4. penjualannya tercatat', h4.item, 1);
cek('4. dilaporkan sebagai resep kosong', h4.resep_kosong, ['Es Teh']);
cek('4. TIDAK ikut digolongkan tanpa resep', h4.tanpa_resep, []);

// =====================================================================
// §5. SATU KIRIMAN BERISI KETIGANYA
//
// Kasus yang sebenarnya terjadi di kasir: satu simpan berisi menu normal,
// menu tanpa resep, dan menu beresep kosong sekaligus. Yang normal tidak boleh
// ikut dilaporkan, dan yang bermasalah tidak boleh menghentikan yang lain.
// =====================================================================
const h5 = await jual('44444444-4444-4444-4444-444444444445', [
  { product_id: MENU, qty: 2 },
  { product_id: AIR, qty: 1 },
  { product_id: TEH, qty: 1 }
]);

cek('5. ketiganya tercatat', h5.item, 3);
cek('5. hanya yang tanpa resep yang dilaporkan', h5.tanpa_resep, ['Air Mineral']);
cek('5. hanya yang kosong yang digolongkan kosong', h5.resep_kosong, ['Es Teh']);
cek('5. yang normal tetap memotong stok', await saldo(BERAS), -4400);

// =====================================================================
// §6. KUNCI LAMA TIDAK BERGESER
//
// PWA yang sudah ter-cache di HP staff masih membaca `diproses`, `item`, dan
// `omzet`. Kalau salah satunya hilang atau berganti nama, layar lama akan
// menampilkan "undefined item tersimpan" tanpa error apa pun.
// =====================================================================
const h6 = await jual('44444444-4444-4444-4444-444444444445', [{ product_id: MENU, qty: 99 }]);
cek('6. kiriman berulang dikenali', h6.diproses, false);
benar('6. alasannya ikut disebut', /sudah pernah tersimpan/i.test(h6.alasan ?? ''), JSON.stringify(h6));
cek('6. kiriman ulang tidak menambah stok', await saldo(BERAS), -4400);

benar('6. kunci diproses masih ada', 'diproses' in h5, JSON.stringify(h5));
benar('6. kunci item masih ada', 'item' in h5, JSON.stringify(h5));
benar('6. kunci omzet masih ada', 'omzet' in h5, JSON.stringify(h5));

// =====================================================================
// §7. VALIDASI HARGA (0099) TIDAK IKUT BERGESER
//
// 0108 menyalin badan fungsi dari 0101. Kalau penyalinannya meleset, penjaga
// harga bisa hilang tanpa satu pun tes lain yang menyadarinya — dan akibatnya
// adalah penjualan Rp0 yang tercatat rapi.
// =====================================================================
const TANPA_HARGA = (await satu(`insert into products (business_unit_id, name) values ($1,'Menu Baru') returning id`, [BU])).id;
let pesan = null;
try {
  await jual('44444444-4444-4444-4444-444444444447', [{ product_id: TANPA_HARGA, qty: 1 }]);
} catch (e) {
  pesan = e.message ?? String(e);
}
benar('7. menu tanpa harga outlet tetap DITOLAK', /harga jual belum disetting/i.test(pesan ?? ''), pesan);
cek('7. tidak ada penjualan Rp0 yang lolos', Number((await satu(`select count(*) n from sales where revenue = 0`)).n), 0);

// =====================================================================
// §8. WEWENANG TIDAK IKUT BERGESER
// =====================================================================
const ORANG_LUAR = '99999999-9999-9999-9999-999999999999';
await q(`insert into user_profiles (id, full_name) values ($1,'Luar')`, [ORANG_LUAR]);
await sebagai(ORANG_LUAR);
let pesan8 = null;
try {
  await jual('44444444-4444-4444-4444-444444444448', [{ product_id: MENU, qty: 1 }]);
} catch (e) {
  pesan8 = e.message ?? String(e);
}
benar('8. orang di luar BU tetap ditolak', /tidak berhak/i.test(pesan8 ?? ''), pesan8);

if (gagal === 0) console.log('✅ migrasi 0108: stok berkurang sesuai resep, tetap berkurang sampai minus, dan yang tidak bergerak dilaporkan.');
else console.error(`\n${gagal} pemeriksaan gagal.`);
process.exit(gagal === 0 ? 0 : 1);
