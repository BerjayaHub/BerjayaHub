/**
 * MIGRATION 0114 DI POSTGRES SUNGGUHAN (PGlite).
 *
 * ============ BUG YANG DIPERBAIKI ============
 *
 *   Nanas: stok sistem 6.400, dihitung fisik 4.600.
 *   Sesudah sesi ditutup, stoknya jadi 11.000 — BERTAMBAH, bukan disesuaikan.
 *
 * Sebabnya `catat_hitungan_opname` (0085) menerima `p_system` DARI LAYAR, dan
 * layar mengirimnya dari peta stok yang dimuat saat halaman dibuka. Peta yang
 * basi mengirim 0, penyesuaiannya jadi `4.600 - 0` = +4.600 di atas 6.400.
 *
 * ============ KENAPA TESNYA MENIRUKAN PETA BASI ============
 *
 * Yang diuji BUKAN "apakah hitungannya tersimpan" — itu selalu berhasil, dan
 * itulah yang membuat bugnya bertahan. Yang diuji: apakah angka SALAH yang
 * dikirim layar masih bisa memengaruhi hasilnya.
 *
 * Jadi tiap pemanggilan di §2 sengaja mengirim `p_system` yang ngawur, lalu
 * saldo akhirnya dituntut tetap benar.
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

await db.exec(`
  create schema if not exists auth;
  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
  $$;

  create table business_units (id uuid primary key default gen_random_uuid(), name text);
  create table outlets (id uuid primary key default gen_random_uuid(), business_unit_id uuid, name text);
  create table user_profiles (id uuid primary key, full_name text);
  create table products (id uuid primary key default gen_random_uuid(), business_unit_id uuid, name text, base_unit text default 'gr');
  create table membership_scopes (user_id uuid, business_unit_id uuid, outlet_id uuid, role text);

  create table stock_movements (
    id uuid primary key default gen_random_uuid(),
    business_unit_id uuid, outlet_id uuid, product_id uuid,
    movement_type text, qty_delta numeric, notes text, count_id uuid,
    created_by uuid, created_at timestamptz not null default now()
  );
  create view stock_balances as
    select business_unit_id, outlet_id, product_id, sum(qty_delta) as qty
      from stock_movements group by business_unit_id, outlet_id, product_id;

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
`);

const jalankan = async (b) =>
  db.exec(fs.readFileSync(path.join(AKAR, 'supabase/migrations', b), 'utf8').replace(/notify pgrst[^;]*;/g, ''));

// Urutan produksi: 0085 memasang versi yang percaya pada layar, 0114 menutupnya.
await jalankan('0085_opname_bernomor.sql');
await jalankan('0114_opname_stok_sistem_dari_server.sql');
console.log('  0085 -> 0114 terpasang.');
await jalankan('0114_opname_stok_sistem_dari_server.sql');
console.log('  dijalankan ulang: aman.');

// =====================================================================
// DATA — kasus nanas, apa adanya.
// =====================================================================
const BU = (await satu(`insert into business_units (name) values ('Cafe') returning id`)).id;
const OUT = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Serpong') returning id`, [BU])).id;
// OUTLET KEDUA, dan ia bukan hiasan.
//
// Tanpa outlet kedua yang memegang bahan YANG SAMA, "saldo dihitung per outlet"
// dan "saldo dihitung lintas outlet" memberi angka yang sama persis — dan
// sabotase yang membuang penyaring outletnya LOLOS. Itu yang terjadi pada
// percobaan pertama saya.
const OUT2 = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Sentul') returning id`, [BU])).id;

const STAFF = '11111111-1111-1111-1111-111111111111';
const ADMIN = '22222222-2222-2222-2222-222222222222';
await q(`insert into user_profiles (id, full_name) values ($1,'Staff'),($2,'Admin')`, [STAFF, ADMIN]);
await q(`insert into membership_scopes (user_id, business_unit_id, outlet_id, role) values
  ($1,$3,$4,'staff'), ($2,$3,$4,'bu_admin'), ($2,$3,$5,'bu_admin')`, [STAFF, ADMIN, BU, OUT, OUT2]);

const NANAS = (await satu(`insert into products (business_unit_id, name) values ($1,'Nanas') returning id`, [BU])).id;
const GULA = (await satu(`insert into products (business_unit_id, name) values ($1,'Gula') returning id`, [BU])).id;

const saldo = async (p) =>
  Number((await satu(`select coalesce(sum(qty_delta),0) s from stock_movements where product_id=$1 and outlet_id=$2`, [p, OUT])).s);

// Stok awal nanas 6.400 — hasil penerimaan sebelumnya.
await q(`insert into stock_movements (business_unit_id, outlet_id, product_id, movement_type, qty_delta, created_by)
  values ($1,$2,$3,'purchase',6400,$4)`, [BU, OUT, NANAS, ADMIN]);
cek('0. stok nanas mula-mula 6.400', await saldo(NANAS), 6400);

// NANAS JUGA ADA DI SENTUL, sebanyak 2.500.
//
// Angkanya sengaja dibuat menonjol: kalau penyaring outletnya hilang, potret
// sistem Serpong akan terbaca 8.900 dan seluruh §1 langsung merah.
await q(`insert into stock_movements (business_unit_id, outlet_id, product_id, movement_type, qty_delta, created_by)
  values ($1,$2,$3,'purchase',2500,$4)`, [BU, OUT2, NANAS, ADMIN]);
cek('0. nanas di Sentul 2.500 (outlet berbeda)',
  Number((await satu(`select coalesce(sum(qty_delta),0) s from stock_movements where product_id=$1 and outlet_id=$2`, [NANAS, OUT2])).s), 2500);
cek('0.   dan Serpong TETAP 6.400', await saldo(NANAS), 6400);

// =====================================================================
// 1. PERSIS KASUS YANG DILAPORKAN
//
// Layar mengirim `p_system = 0` (peta basi). Sebelum 0114 ini menghasilkan
// 11.000; sesudahnya harus 4.600.
// =====================================================================
await sebagai(ADMIN);
const SESI = (await satu(`select buka_opname($1,null) s`, [OUT])).s;

await sebagai(STAFF);
await q(`select catat_hitungan_opname($1,$2,4600,0,null)`, [SESI, NANAS]);

// Yang tersimpan harus 6.400, BUKAN 0 yang dikirim layar.
const baris = await satu(`select system_qty, counted_qty from stock_count_items where count_id=$1 and product_id=$2`, [SESI, NANAS]);
cek('1. system_qty dibaca server, bukan dari layar', Number(baris.system_qty), 6400);
// TEGAS: bukan 8.900 (6.400 + 2.500 milik Sentul). Saldo harus per OUTLET.
benar('1.   dan BUKAN saldo lintas outlet (8.900)', Number(baris.system_qty) !== 8900, String(baris.system_qty));
cek('1. hitungan fisiknya tersimpan apa adanya', Number(baris.counted_qty), 4600);

await sebagai(ADMIN);
await q(`select tutup_opname($1)`, [SESI]);
cek('1. STOK JADI 4.600, bukan 11.000', await saldo(NANAS), 4600);

const koreksi = Number((await satu(
  `select qty_delta d from stock_movements where product_id=$1 and movement_type='adjustment'`, [NANAS])).d);
cek('1. penyesuaiannya NEGATIF (-1.800)', koreksi, -1800);

// =====================================================================
// 2. ANGKA NGAWUR DARI LAYAR TIDAK BOLEH BERPENGARUH SAMA SEKALI
//
// Inti perbaikannya. Bukan "peta basi ditolak", melainkan "suara layar dalam
// angka ini dicabut" — jadi seberapa pun ngawurnya, hasilnya tetap benar.
// =====================================================================
await sebagai(ADMIN);
const SESI2 = (await satu(`select buka_opname($1,null) s`, [OUT])).s;
await sebagai(STAFF);

for (const ngawur of [0, -999, 99999, null]) {
  await q(`select catat_hitungan_opname($1,$2,5000,$3,null)`, [SESI2, NANAS, ngawur]);
  const b = await satu(`select system_qty from stock_count_items where count_id=$1 and product_id=$2`, [SESI2, NANAS]);
  cek(`2. p_system=${JSON.stringify(ngawur)} diabaikan`, Number(b.system_qty), 4600);
}

await sebagai(ADMIN);
await q(`select tutup_opname($1)`, [SESI2]);
cek('2. hasil akhirnya tetap 5.000', await saldo(NANAS), 5000);

// =====================================================================
// 3. POTRET DISEGARKAN TIAP KALI DISIMPAN ULANG
//
// Kekhawatiran 0085: barang masuk di tengah sesi. Penyesuaiannya dihitung
// SELISIH, jadi selama potretnya sezaman dengan hitungannya, hasilnya benar.
// =====================================================================
const SESI3 = (await satu(`select buka_opname($1,null) s`, [OUT])).s;
await sebagai(STAFF);
await q(`select catat_hitungan_opname($1,$2,5000,null,null)`, [SESI3, NANAS]);

// Nota masuk 1.000 SESUDAH dihitung. Stok jadi 6.000.
await q(`insert into stock_movements (business_unit_id, outlet_id, product_id, movement_type, qty_delta, created_by)
  values ($1,$2,$3,'purchase',1000,$4)`, [BU, OUT, NANAS, ADMIN]);
cek('3. stok jadi 6.000 sesudah nota', await saldo(NANAS), 6000);

// Tidak dihitung ulang -> potretnya tetap 5.000, selisihnya 0, dan stok
// akhirnya 6.000. Barang yang benar-benar masuk TIDAK terhapus.
await sebagai(ADMIN);
await q(`select tutup_opname($1)`, [SESI3]);
cek('3. nota yang masuk sesudah hitung TIDAK terhapus', await saldo(NANAS), 6000);

// Dihitung ULANG sesudah nota masuk -> potretnya ikut segar.
const SESI4 = (await satu(`select buka_opname($1,null) s`, [OUT])).s;
await sebagai(STAFF);
await q(`select catat_hitungan_opname($1,$2,5800,null,null)`, [SESI4, NANAS]);
cek('3. potret segar 6.000',
  Number((await satu(`select system_qty from stock_count_items where count_id=$1 and product_id=$2`, [SESI4, NANAS])).system_qty), 6000);
await sebagai(ADMIN);
await q(`select tutup_opname($1)`, [SESI4]);
cek('3. hasilnya 5.800', await saldo(NANAS), 5800);

// =====================================================================
// 4. PRODUK YANG MEMANG BELUM PUNYA PERGERAKAN
//
// `coalesce(..., 0)` di server SAH di sini: gula memang belum pernah
// bergerak, jadi stoknya memang nol. Bedanya dengan nol yang bikin bug: yang
// ini dihitung dari kenyataan, bukan dikirim peta basi.
// =====================================================================
const SESI5 = (await satu(`select buka_opname($1,null) s`, [OUT])).s;
await sebagai(STAFF);
await q(`select catat_hitungan_opname($1,$2,250,null,null)`, [SESI5, GULA]);
cek('4. gula: potret sistem 0 (memang belum pernah bergerak)',
  Number((await satu(`select system_qty from stock_count_items where count_id=$1 and product_id=$2`, [SESI5, GULA])).system_qty), 0);
await sebagai(ADMIN);
await q(`select tutup_opname($1)`, [SESI5]);
cek('4. gula jadi 250', await saldo(GULA), 250);

// =====================================================================
// 5. ALAT PERIKSA POTRET BASI
//
// Untuk sesi yang tersimpan SEBELUM 0114, `system_qty`-nya bisa saja basi.
// Fungsinya harus menunjukkannya — dan TIDAK memperbaiki apa pun sendiri.
// =====================================================================
const SESI6 = (await satu(`select buka_opname($1,null) s`, [OUT])).s;
await sebagai(STAFF);
await q(`select catat_hitungan_opname($1,$2,4000,null,null)`, [SESI6, NANAS]);

// Ditulis basi secara paksa, meniru baris peninggalan versi lama.
await q(`update stock_count_items set system_qty = 0 where count_id=$1 and product_id=$2`, [SESI6, NANAS]);

const basi = (await q(`select * from opname_potret_basi($1)`, [SESI6])).rows;
cek('5. baris basi terdeteksi', basi.length, 1);
cek('5.   nama bahannya disebut', basi[0].nama, 'Nanas');
cek('5.   sistem tersimpan (basi)', Number(basi[0].system_tersimpan), 0);
cek('5.   sistem sebenarnya', Number(basi[0].system_sebenarnya), 5800);
benar('5.   alat periksa juga per outlet, bukan 8.300',
  Number(basi[0].system_sebenarnya) !== 8300, String(basi[0].system_sebenarnya));
cek('5.   selisih kalau ditutup sekarang: +4.000 (SALAH)', Number(basi[0].selisih_jika_ditutup_sekarang), 4000);
cek('5.   selisih yang seharusnya: -1.800', Number(basi[0].selisih_seharusnya), -1800);

// Alatnya TIDAK memperbaiki apa pun.
cek('5. alat periksa tidak mengubah barisnya',
  Number((await satu(`select system_qty from stock_count_items where count_id=$1 and product_id=$2`, [SESI6, NANAS])).system_qty), 0);

// Menyimpan ulang MEMBETULKANNYA — inilah jalan keluar untuk sesi peninggalan.
await sebagai(STAFF);
await q(`select catat_hitungan_opname($1,$2,4000,null,null)`, [SESI6, NANAS]);
cek('5. disimpan ulang: potretnya segar kembali',
  Number((await satu(`select system_qty from stock_count_items where count_id=$1 and product_id=$2`, [SESI6, NANAS])).system_qty), 5800);
cek('5.   dan tidak ada lagi yang basi', (await q(`select * from opname_potret_basi($1)`, [SESI6])).rows.length, 0);

if (gagal === 0) {
  console.log('✅ migrasi 0114: stok sistem dibaca server; angka dari layar tidak lagi bisa merusak hasil opname.');
} else {
  console.error(`\n${gagal} pemeriksaan gagal.`);
}
process.exit(gagal === 0 ? 0 : 1);
