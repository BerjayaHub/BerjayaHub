/**
 * MIGRATION 0112 DI POSTGRES SUNGGUHAN (PGlite).
 *
 * ============ KASUSNYA ============
 *
 *   Staff salah ketik: Nasi Goreng 50 porsi, seharusnya 15.
 *   Ketahuan BESOKNYA. Admin membetulkannya.
 *
 * Yang harus terjadi:
 *   - omzet jadi 15 x harga SAAT ITU (bukan harga hari ini)
 *   - stok bahan DIKEMBALIKAN sebanyak 35 porsi
 *   - alasannya wajib, dan tercatat di baris penjualan MAUPUN di catatan stok
 *   - jumlah aslinya (50) tetap terbaca selamanya
 *
 * ============ YANG PALING MUDAH SALAH ============
 *
 * Tanda tangan fungsinya berubah dari (uuid, numeric) jadi (uuid, numeric, text).
 * `create or replace` dengan parameter tambahan TIDAK menimpa — ia membuat
 * OVERLOAD, dan versi dua-parameter yang tanpa penjagaan alasan tetap hidup.
 * §6 memeriksa versi lama itu benar-benar lenyap, karena kalau tidak, seluruh
 * penjagaan yang ditulis di sini bisa dilewati tanpa satu pun tanda.
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
const galat = async (fn) => {
  try {
    await fn();
    return null;
  } catch (e) {
    return e.message ?? String(e);
  }
};

await db.exec(`
  create schema if not exists auth;
  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
  $$;

  create table business_units (id uuid primary key default gen_random_uuid(), name text);
  create table outlets (
    id uuid primary key default gen_random_uuid(),
    business_unit_id uuid, name text, outlet_role text default 'standalone', allow_sales boolean default true
  );
  create table user_profiles (id uuid primary key, full_name text);
  create table products (id uuid primary key default gen_random_uuid(), business_unit_id uuid, name text, category text);
  create table recipes (id uuid primary key default gen_random_uuid(), product_id uuid, mode text, yield_qty numeric);
  create table recipe_items (id uuid primary key default gen_random_uuid(), recipe_id uuid, ingredient_product_id uuid, qty numeric);
  create table membership_scopes (user_id uuid, business_unit_id uuid, outlet_id uuid, role text);

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
    movement_type text, qty_delta numeric, sale_id uuid, notes text,
    created_by uuid, created_at timestamptz not null default now()
  );
  create table outlet_menu_prices (
    id uuid primary key default gen_random_uuid(),
    outlet_id uuid, product_id uuid, selling_price numeric, packaging_cost numeric default 0
  );

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

const jalankan = async (b) =>
  db.exec(fs.readFileSync(path.join(AKAR, 'supabase/migrations', b), 'utf8').replace(/notify pgrst[^;]*;/g, ''));

// Urutan produksi: 0101 memasang versi DUA-parameter, 0112 menggantinya.
await jalankan('0101_ubah_hapus_penjualan.sql');
await jalankan('0112_koreksi_penjualan_berjejak.sql');
console.log('  0101 -> 0112 terpasang.');
await jalankan('0112_koreksi_penjualan_berjejak.sql');
console.log('  dijalankan ulang: aman.');

// =====================================================================
// DATA — Nasi Goreng: 1 porsi = 200 g beras.
// =====================================================================
const BU = (await satu(`insert into business_units (name) values ('Cafe') returning id`)).id;
const OUT = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Serpong') returning id`, [BU])).id;

const STAFF = '11111111-1111-1111-1111-111111111111';
const ADMIN = '22222222-2222-2222-2222-222222222222';
await q(`insert into user_profiles (id, full_name) values ($1,'Staff'),($2,'Admin')`, [STAFF, ADMIN]);
await q(`insert into membership_scopes (user_id, business_unit_id, outlet_id, role) values
  ($1,$3,$4,'staff'), ($2,$3,$4,'bu_admin')`, [STAFF, ADMIN, BU, OUT]);

const MENU = (await satu(`insert into products (business_unit_id, name) values ($1,'Nasi Goreng') returning id`, [BU])).id;
const BERAS = (await satu(`insert into products (business_unit_id, name) values ($1,'Beras') returning id`, [BU])).id;
const RES = (await satu(`insert into recipes (product_id, mode, yield_qty) values ($1,'standalone',1) returning id`, [MENU])).id;
await q(`insert into recipe_items (recipe_id, ingredient_product_id, qty) values ($1,$2,200)`, [RES, BERAS]);
await q(`insert into outlet_menu_prices (outlet_id, product_id, selling_price) values ($1,$2,25000)`, [OUT, MENU]);

const saldoBeras = async () =>
  Number((await satu(`select coalesce(sum(qty_delta),0) s from stock_movements where product_id=$1`, [BERAS])).s);

const ubah = (id, qty, alasan = null) =>
  satu(`select ubah_penjualan($1,$2,$3) r`, [id, qty, alasan]);

// =====================================================================
// 1. PENJUALAN KEMARIN — 50 porsi, salah ketik
// =====================================================================
await sebagai(STAFF);
await q(`select record_sales($1,$2,(now() at time zone 'Asia/Jakarta')::date - 1,$3::jsonb,$4)`, [
  BU, OUT, JSON.stringify([{ product_id: MENU, qty: 50 }]), '44444444-4444-4444-4444-444444444441'
]);
const SALE = (await satu(`select id from sales limit 1`)).id;
cek('1. tercatat 50 porsi', Number((await satu(`select qty from sales where id=$1`, [SALE])).qty), 50);
cek('1. beras terpotong 10.000 g', await saldoBeras(), -10000);

// `created_at` IKUT DIMUNDURKAN, dan ini bukan sekadar kerapian data uji.
//
// `boleh_ubah_penjualan` (0101) memberi hak pada pembuatnya "pada HARI YANG
// SAMA", dan yang dibandingkannya `created_at` — kapan barisnya DIKETIK —
// bukan `sale_date`, tanggal penjualannya.
//
// Percobaan pertama saya tidak memundurkannya: barisnya bertanggal kemarin
// tapi diketik hari ini, jadi staff-nya MASIH berhak dan §2 gagal. Yang salah
// tesnya, bukan kodenya — dan bedanya memang halus.
//
// (Perilaku itu sendiri benar: staff yang menginput penjualan kemarin pagi ini
// memang wajar boleh membetulkan ketikannya sendiri sore ini. Penjagaan alasan
// di 0112 berpatokan pada `sale_date`, jadi ia tetap diminta alasan.)
await q(`update sales set created_at = now() - interval '1 day' where id = $1`, [SALE]);

// =====================================================================
// 2. STAFF TIDAK BISA MENGOREKSI TANGGAL LAMPAU
//
// `boleh_ubah_penjualan` (0101) hanya mengizinkan pembuatnya pada HARI YANG
// SAMA. Penjagaan itu tidak boleh ikut longgar hanya karena admin sekarang
// punya layarnya.
// =====================================================================
const tolakStaff = await galat(() => ubah(SALE, 15, 'salah ketik'));
benar('2. staff ditolak mengoreksi penjualan kemarin', /hanya boleh memperbaiki/i.test(tolakStaff ?? ''), String(tolakStaff));
cek('2. angkanya tidak tersentuh', Number((await satu(`select qty from sales where id=$1`, [SALE])).qty), 50);

// =====================================================================
// 3. ADMIN TANPA ALASAN — DITOLAK
// =====================================================================
await sebagai(ADMIN);
const tolakKosong = await galat(() => ubah(SALE, 15, '   '));
benar('3. koreksi tanggal lampau tanpa alasan ditolak', /alasan/i.test(tolakKosong ?? ''), String(tolakKosong));
benar('3.   pesannya menyebut tanggalnya', /\d{2} \w{3} \d{4}/.test(tolakKosong ?? ''), String(tolakKosong));
cek('3. stok tidak ikut bergerak saat ditolak', await saldoBeras(), -10000);

// Dipanggil TANPA argumen ketiga sama sekali (PWA lama) juga harus ditolak.
const tolakDuaArg = await galat(() => q(`select ubah_penjualan($1,15)`, [SALE]));
benar('3. panggilan dua-argumen pada tanggal lampau juga ditolak', /alasan/i.test(tolakDuaArg ?? ''), String(tolakDuaArg));

// =====================================================================
// 4. ADMIN DENGAN ALASAN — berhasil, stok kembali
// =====================================================================

// DAFTAR HARGA DINAIKKAN LEBIH DULU — dan ini bagian yang paling menentukan.
//
// Percobaan pertama saya menuliskan di komentar bahwa harganya "sengaja
// dinaikkan lebih dulu", padahal barisnya tidak pernah ada. Akibatnya sabotase
// yang mengganti sumber harga jadi `outlet_menu_prices` LOLOS: harga lama dan
// harga sekarang kebetulan sama, jadi kedua rumus menghasilkan angka identik.
//
// Pemeriksaan yang tidak bisa membedakan dua perilaku bukan pemeriksaan.
await q(`update outlet_menu_prices set selling_price = 30000 where outlet_id=$1 and product_id=$2`, [OUT, MENU]);

const hasil = await ubah(SALE, 15, 'salah ketik nol, seharusnya 15');
cek('4. dilaporkan berubah', hasil.r.berubah, true);
cek('4. dilaporkan sebagai tanggal lampau', hasil.r.tanggal_lampau, true);

const baris = await satu(
  `select qty, revenue, unit_price, qty_awal, dikoreksi_by, dikoreksi_alasan, dikoreksi_at from sales where id=$1`, [SALE]);
cek('4. jumlahnya jadi 15', Number(baris.qty), 15);

// HARGA TIDAK DIHITUNG ULANG.
//
// Daftar harga sudah dinaikkan ke 30.000 di atas. Kalau omzetnya jadi 450.000,
// berarti harga SEKARANG yang dipakai — dan mengoreksi satu salah ketik di
// bulan lalu akan menggeser omzet seluruh periode itu tanpa ada yang menyentuh
// transaksi lain mana pun.
cek('4. harga satuan tetap 25.000 (bukan 30.000 yang baru)', Number(baris.unit_price), 25000);
cek('4. omzet 15 x 25.000 = 375.000, BUKAN 450.000', Number(baris.revenue), 375000);

cek('4. jumlah ASLI tetap terbaca', Number(baris.qty_awal), 50);
cek('4. pengoreksinya tercatat', baris.dikoreksi_by, ADMIN);
benar('4. alasannya tersimpan', /salah ketik nol/.test(baris.dikoreksi_alasan ?? ''), baris.dikoreksi_alasan);
benar('4. waktunya tercatat', baris.dikoreksi_at != null);

// Stok: 50 -> 15 berarti 35 porsi dikembalikan = +7.000 g.
cek('4. beras dikembalikan jadi -3.000 g', await saldoBeras(), -3000);

// Pergerakan LAMA tidak diubah — yang ditulis penyeimbang baru.
cek('4. buku besar bertambah, bukan ditimpa',
  Number((await satu(`select count(*) n from stock_movements where product_id=$1`, [BERAS])).n), 2);

// ALASANNYA IKUT KE CATATAN PERGERAKAN STOK.
//
// Yang membaca buku besar stok biasanya sedang menelusuri selisih opname, dan
// ia tidak akan tahu harus membuka tabel `sales` untuk mencari sebabnya.
const catatan = (await satu(
  `select notes from stock_movements where product_id=$1 order by created_at desc, id desc limit 1`, [BERAS])).notes;
benar('4. catatan stok menyebut alasannya', /salah ketik nol/.test(catatan ?? ''), catatan);
benar('4. catatan stok menyebut 50 -> 15', /50 -> 15/.test(catatan ?? ''), catatan);

// =====================================================================
// 5. KOREKSI KEDUA TIDAK MENIMPA POTRET PERTAMA
//
// Kalau `qty_awal` ditimpa, angka yang benar-benar diinput staff hilang
// sesudah dua kali koreksi — dan yang tersisa justru angka yang paling tidak
// berarti.
// =====================================================================
await ubah(SALE, 12, 'dicek ulang struk, ternyata 12');
const baris2 = await satu(`select qty, qty_awal from sales where id=$1`, [SALE]);
cek('5. jumlahnya jadi 12', Number(baris2.qty), 12);
cek('5. qty_awal TETAP 50, bukan 15', Number(baris2.qty_awal), 50);
cek('5. beras jadi -2.400 g', await saldoBeras(), -2400);

// =====================================================================
// 6. VERSI DUA-PARAMETER HARUS LENYAP
//
// Kalau ia masih ada, seluruh penjagaan alasan di atas bisa dilewati begitu
// saja lewat overload yang lain — tanpa satu pun tanda.
// =====================================================================
const jumlahVersi = Number((await satu(
  `select count(*) n from pg_proc where proname = 'ubah_penjualan'`)).n);
cek('6. hanya ada SATU versi ubah_penjualan', jumlahVersi, 1);
const tandaTangan = (await satu(
  `select pg_get_function_identity_arguments(oid) a from pg_proc where proname='ubah_penjualan'`)).a;
benar('6. tanda tangannya bertiga parameter', /text/.test(tandaTangan ?? ''), tandaTangan);

// =====================================================================
// 7. HARI INI TETAP BEBAS ALASAN
//
// Staff membetulkan ketikannya sendiri beberapa menit kemudian; menuntut
// alasan di situ cuma memperlambat tanpa menambah apa pun.
// =====================================================================
await sebagai(STAFF);
await q(`select record_sales($1,$2,(now() at time zone 'Asia/Jakarta')::date,$3::jsonb,$4)`, [
  BU, OUT, JSON.stringify([{ product_id: MENU, qty: 8 }]), '44444444-4444-4444-4444-444444444442'
]);
const SALE_HARI_INI = (await satu(
  `select id from sales where sale_date = (now() at time zone 'Asia/Jakarta')::date limit 1`)).id;

const hasilHariIni = await ubah(SALE_HARI_INI, 6);
cek('7. koreksi hari ini tanpa alasan: berhasil', hasilHariIni.r.berubah, true);
cek('7.   dan ditandai bukan tanggal lampau', hasilHariIni.r.tanggal_lampau, false);
cek('7.   qty_awal tetap terisi', Number((await satu(`select qty_awal from sales where id=$1`, [SALE_HARI_INI])).qty_awal), 8);

// =====================================================================
// 7b. "LAMPAU" DIUKUR DARI TANGGAL PENJUALAN, BUKAN KAPAN DIKETIK
//
// Kasus yang membedakan keduanya: penjualan bertanggal KEMARIN yang baru
// diinput HARI INI (staff terlambat mencatat). `sale_date` lampau, tapi
// `created_at` hari ini.
//
// Kalau penjagaannya berpatokan pada `created_at`, baris seperti ini lolos
// tanpa alasan — padahal angkanya masuk ke rekap KEMARIN, yang mungkin sudah
// dibahas dan dicetak. Sabotase yang menukar keduanya LOLOS sampai kasus ini
// ditambahkan, karena §1 memundurkan kedua kolomnya sekaligus.
// =====================================================================
await sebagai(STAFF);
await q(`select record_sales($1,$2,(now() at time zone 'Asia/Jakarta')::date - 2,$3::jsonb,$4)`, [
  BU, OUT, JSON.stringify([{ product_id: MENU, qty: 4 }]), '44444444-4444-4444-4444-444444444443'
]);
const SALE_TELAT = (await satu(
  `select id from sales where sale_date = (now() at time zone 'Asia/Jakarta')::date - 2 limit 1`)).id;

// `created_at` SENGAJA dibiarkan hari ini — itu inti kasusnya.
const tolakTelat = await galat(() => ubah(SALE_TELAT, 3));
benar('7b. sale_date lampau + baru diketik hari ini: alasan TETAP wajib',
  /alasan/i.test(tolakTelat ?? ''), String(tolakTelat));

const okTelat = await ubah(SALE_TELAT, 3, 'struk tertinggal, dihitung ulang');
cek('7b. dengan alasan: berhasil', okTelat.r.berubah, true);
cek('7b.   dan ditandai tanggal lampau', okTelat.r.tanggal_lampau, true);
await q(`select hapus_penjualan($1,'bersih-bersih data uji')`, [SALE_TELAT]);

// =====================================================================
// 8. HAPUS — tanggal lampau juga menuntut alasan
// =====================================================================
await sebagai(ADMIN);
const tolakHapus = await galat(() => q(`select hapus_penjualan($1, null)`, [SALE]));
benar('8. hapus tanggal lampau tanpa alasan ditolak', /alasan/i.test(tolakHapus ?? ''), String(tolakHapus));
benar('8.   barisnya masih ada', (await satu(`select id from sales where id=$1`, [SALE]))?.id === SALE);

await q(`select hapus_penjualan($1,'batal, pelanggan komplain')`, [SALE]);
benar('8. dengan alasan: terhapus', (await satu(`select id from sales where id=$1`, [SALE])) == null);
cek('8. seluruh stoknya dikembalikan', await saldoBeras(), -1200);

const catatanHapus = (await satu(
  `select notes from stock_movements where product_id=$1 order by created_at desc, id desc limit 1`, [BERAS])).notes;
benar('8. catatan penghapusan menyebut alasannya', /pelanggan komplain/.test(catatanHapus ?? ''), catatanHapus);

// Hapus HARI INI tetap boleh tanpa alasan.
await sebagai(STAFF);
const hapusHariIni = await galat(() => q(`select hapus_penjualan($1, null)`, [SALE_HARI_INI]));
benar('8. hapus hari ini tanpa alasan: boleh', hapusHariIni === null, String(hapusHariIni));
cek('8. stoknya kembali penuh', await saldoBeras(), 0);

if (gagal === 0) {
  console.log('✅ migrasi 0112: koreksi tanggal lampau menuntut alasan, stok ikut terkoreksi, jumlah asli tetap terbaca.');
} else {
  console.error(`\n${gagal} pemeriksaan gagal.`);
}
process.exit(gagal === 0 ? 0 : 1);
