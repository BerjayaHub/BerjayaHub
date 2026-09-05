/**
 * MIGRATION 0124 DI POSTGRES SUNGGUHAN (PGlite).
 *
 * ============ KASUSNYA ============
 *
 *   "wortel itu harga beli 9000 diinput oleh user, lalu setelah di push kode
 *    dia tetap jadi harga per satuan, apakah ini semua bisa digeser ke
 *    harga beli?"
 *
 * Nota yang dilaporkan: Wortel 500 gr, Strawberry 500 gr, Nanas 1.636 gr —
 * totalnya terbaca **Rp84.260.000** padahal yang dimaksud Rp89.000.
 *
 * ============ YANG DIUJI ============
 *
 *   1. Angka yang dulu diketik jadi `line_total`; per satuannya jadi turunan.
 *   2. `stock_movements` ikut, dan biaya rata-rata bahannya ikut turun —
 *      kalau tidak, layar nota benar sementara laporan biayanya tetap salah.
 *   3. TIDAK BISA digeser dua kali.
 *   4. Nota LUNAS ditolak (nominal kasnya dihitung dari harga lama).
 *   5. Nota yang tidak disebut TIDAK tersentuh.
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
const gagalkan = async (fn) => {
  try {
    await fn();
    return null;
  } catch (e) {
    return String(e.message ?? e);
  }
};

await db.exec(`
  create role authenticated;
  create schema if not exists auth;
  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
  $$;

  create table business_units (id uuid primary key default gen_random_uuid(), name text);
  create table outlets (id uuid primary key default gen_random_uuid(), business_unit_id uuid, name text);
  create table user_profiles (id uuid primary key, full_name text, cash_account_limit int not null default 1);
  create table membership_scopes (user_id uuid, business_unit_id uuid, outlet_id uuid, role text);
  create table products (id uuid primary key default gen_random_uuid(), business_unit_id uuid, name text,
    base_unit text default 'gr', product_type text default 'raw', purchase_price numeric, purchase_qty numeric);
  create table cash_categories (id uuid primary key default gen_random_uuid(), business_unit_id uuid, name text);
  create table stock_movements (id uuid primary key default gen_random_uuid(),
    business_unit_id uuid, outlet_id uuid, product_id uuid, movement_type text,
    qty_delta numeric, unit_cost numeric, notes text, receipt_id uuid, created_by uuid,
    created_at timestamptz not null default now());

  create table cash_accounts (
    id uuid primary key default gen_random_uuid(),
    holder_id uuid not null references user_profiles(id) on delete cascade,
    name text not null, sort_order int not null default 0,
    is_active boolean not null default true,
    created_at timestamptz not null default now(),
    unique (holder_id, name)
  );
  create table cash_entries (
    id uuid primary key default gen_random_uuid(),
    business_unit_id uuid, outlet_id uuid,
    holder_id uuid not null references user_profiles(id) on delete cascade,
    account_id uuid references cash_accounts(id) on delete restrict,
    entry_type text not null check (entry_type in ('in','out','transfer_in','transfer_out')),
    amount numeric not null,
    category_id uuid, counterpart_id uuid, transfer_id uuid,
    notes text, proof_path text, qty numeric, unit text,
    entry_date date not null default (now() at time zone 'Asia/Jakarta')::date,
    created_by uuid references user_profiles(id) on delete set null,
    created_at timestamptz not null default now()
  );
  alter table cash_entries add constraint cash_entries_nota_wajib
    check (entry_type <> 'out' or proof_path is not null);

  create or replace function has_bu_scope(p_uid uuid, p_bu uuid) returns boolean language sql stable as $$
    select exists (select 1 from membership_scopes where user_id = p_uid and business_unit_id = p_bu);
  $$;
  create or replace function has_outlet_scope(p_uid uuid, p_outlet uuid) returns boolean language sql stable as $$
    select exists (select 1 from membership_scopes ms where ms.user_id = p_uid
      and (ms.outlet_id = p_outlet or (ms.outlet_id is null and ms.business_unit_id = (select business_unit_id from outlets where id = p_outlet))));
  $$;
  create or replace function is_super_admin(p_uid uuid) returns boolean language sql stable as $$
    select exists (select 1 from membership_scopes where user_id = p_uid and role = 'super_admin');
  $$;

  create schema if not exists storage;
  create table storage.buckets (id text primary key, name text, public boolean);
  create table storage.objects (id uuid default gen_random_uuid(), bucket_id text, name text, owner uuid);
  alter table storage.objects enable row level security;
  create or replace function storage.foldername(p text) returns text[] language sql immutable as $$
    select string_to_array(p, '/');
  $$;
`);

const jalankan = async (b) =>
  db.exec(fs.readFileSync(path.join(AKAR, 'supabase/migrations', b), 'utf8').replace(/notify pgrst[^;]*;/g, ''));

for (const b of [
  '0084_nota_penerimaan.sql',
  '0118_biaya_rata_bahan.sql',
  '0119_ubah_nota_tanpa_menghapus.sql',
  '0120_kas_outlet_boleh_dibebani.sql',
  '0122_nota_status_bayar.sql',
  '0123_harga_beli_per_baris.sql',
  '0124_geser_harga_ke_harga_beli.sql'
])
  await jalankan(b);
console.log('  0084 -> … -> 0124 terpasang.');
await jalankan('0124_geser_harga_ke_harga_beli.sql');
console.log('  dijalankan ulang: aman.');

const BU = (await satu(`insert into business_units (name) values ('Cafe') returning id`)).id;
const OUT = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Serpong') returning id`, [BU])).id;
const OUT2 = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Sentul') returning id`, [BU])).id;
const WORTEL = (await satu(`insert into products (business_unit_id, name) values ($1,'Wortel') returning id`, [BU])).id;
const STRAW = (await satu(`insert into products (business_unit_id, name) values ($1,'Buah Strawberry') returning id`, [BU])).id;
const NANAS = (await satu(`insert into products (business_unit_id, name) values ($1,'Buah Nanas') returning id`, [BU])).id;

const STAFF = '11111111-1111-1111-1111-111111111111';
const LAIN = '22222222-2222-2222-2222-222222222222';
await q(`insert into user_profiles (id, full_name) values ($1,'Staff'), ($2,'Orang Lain')`, [STAFF, LAIN]);
await q(`insert into membership_scopes (user_id, business_unit_id, outlet_id, role) values ($1,$2,$3,'staff'), ($4,$2,$5,'staff')`, [
  STAFF, BU, OUT, LAIN, OUT2
]);
await q(`select set_config('request.jwt.claim.sub', $1, false)`, [STAFF]);
const KAS = (await satu(`insert into cash_accounts (holder_id, name, outlet_id) values ($1,'Kas Ops',$2) returning id`, [STAFF, OUT])).id;

// Nota persis seperti di layar yang dilaporkan — dibuat dengan BENTUK LAMA
// (`unit_cost`), karena begitulah data yang terlanjur ada terbentuk.
const A = (
  await satu(`select simpan_nota_terima($1,'2026-09-05','Pasar',null,null,null,$2::jsonb) as id`, [
    OUT,
    JSON.stringify([
      { product_id: WORTEL, qty: 500, unit_cost: 9000 },
      { product_id: STRAW, qty: 500, unit_cost: 45000 },
      { product_id: NANAS, qty: 1636, unit_cost: 35000 }
    ])
  ])
).id;

const ringkas = (id) =>
  satu(`select total::text as total, total_jika_digeser::text as jika, baris_berharga, harga_digeser_at from nota_ringkas where id = $1`, [id]);

// =====================================================================
// §1. Sebelum digeser: angkanya persis yang dilaporkan.
// =====================================================================
const sebelum = await ringkas(A);
cek('§1 total sebelum digeser = 84.260.000, persis seperti di layar', sebelum.total, '84260000');
cek('§1 pratinjau menjanjikan 89.000', sebelum.jika, '89000');

// =====================================================================
// §2. INTI: digeser.
// =====================================================================
const n = await satu(`select geser_harga_nota(array[$1]::uuid[]) as n`, [A]);
cek('§2 tiga baris berubah', Number(n.n), 3);

const sesudah = await ringkas(A);
cek('§2 INTI: total jadi 89.000', sesudah.total, '89000');
benar('§2 penandanya terisi', !!sesudah.harga_digeser_at);

// Dibandingkan sebagai ANGKA di SQL, bukan sebagai teks. `numeric` membawa
// skala hasil pembagiannya, jadi 18 pulang sebagai "18.0000000000000000" —
// dan tes yang membandingkan teks akan merah untuk nilai yang benar.
const wortel = await satu(
  `select (line_total = 9000) as lt, (unit_cost = 18) as uc, unit_cost::text as t
     from goods_receipt_items where receipt_id = $1 and product_id = $2`,
  [A, WORTEL]
);
benar('§2 wortel: harga beli 9.000, per satuan 18', wortel.lt && wortel.uc, `dapat: ${wortel.t}`);

// Nanas 57.260.000 -> 35.000 untuk 1.636 gr. Pembagiannya TIDAK bulat, jadi
// perbandingannya di SQL dengan `numeric` penuh — bukan lewat `Number()` di JS.
const nanas = await satu(
  `select (line_total = 35000) as lt_tepat, (unit_cost = 35000::numeric / 1636) as uc_tepat
     from goods_receipt_items where receipt_id = $1 and product_id = $2`,
  [A, NANAS]
);
benar('§2 nanas: harga beli PERSIS 35.000', nanas.lt_tepat);
benar('§2 nanas: per satuannya hasil bagi penuh, bukan pembulatan klien', nanas.uc_tepat);

// =====================================================================
// §3. `stock_movements` ikut — dan biaya rata-ratanya ikut turun.
//
// Ini bagian yang paling mudah terlewat: nota di layar sudah benar sementara
// laporan biayanya masih memakai Rp9.000/gram.
// =====================================================================
const gerak = await satu(
  `select (unit_cost = 18) as tepat, unit_cost::text as uc from stock_movements
    where receipt_id = $1 and product_id = $2 and qty_delta > 0`,
  [A, WORTEL]
);
benar('§3 stock_movements memakai harga per satuan yang baru', gerak.tepat, `dapat: ${gerak.uc}`);

const rata = await satu(
  `select (rata = 18) as tepat, rata::text as r from biaya_rata_bahan where outlet_id = $1 and product_id = $2`,
  [OUT, WORTEL]
);
benar('§3 biaya rata-rata bahannya ikut tersegarkan', rata?.tepat, `dapat: ${rata?.r}`);

// =====================================================================
// §4. Tidak bisa digeser dua kali.
// =====================================================================
const dua = await gagalkan(() => q(`select geser_harga_nota(array[$1]::uuid[])`, [A]));
benar('§4 penggeseran kedua ditolak', /sudah pernah digeser/i.test(dua ?? ''), `dapat: ${dua}`);
cek('§4 dan angkanya tidak bergerak', (await ringkas(A)).total, '89000');

// =====================================================================
// §5. Nota LUNAS ditolak — nominal kasnya dihitung dari harga lama.
// =====================================================================
const B = (
  await satu(`select simpan_nota_terima($1,'2026-09-05','Pasar',null,null,null,$2::jsonb) as id`, [
    OUT,
    JSON.stringify([{ product_id: WORTEL, qty: 100, unit_cost: 500 }])
  ])
).id;
await q(`select bayar_nota(array[$1]::uuid[], $2, '2026-09-06', null)`, [B, KAS]);
const lunas = await gagalkan(() => q(`select geser_harga_nota(array[$1]::uuid[])`, [B]));
benar('§5 nota lunas ditolak', /sudah dibayar/i.test(lunas ?? ''), `dapat: ${lunas}`);

// PERLU DICATAT JUJUR: penghalang sesungguhnya di sini BUKAN pemeriksaan di
// `geser_harga_nota`, melainkan trigger `trg_tolak_ubah_nota_lunas` (0122)
// yang menolak setiap perubahan `goods_receipt_items` pada nota lunas.
// Sabotase yang membuang pemeriksaan itu tetap ditolak, cuma dengan kalimat
// yang berbeda — dan pemeriksaan `/sudah dibayar/` di atas ikut lolos, karena
// kedua kalimatnya memuat kata yang sama.
//
// Yang benar-benar milik 0124 adalah SEBABNYA: kenapa nota lunas berbahaya
// untuk digeser. Itu yang diuji di bawah, supaya penjelasannya tidak diam-diam
// hilang dan orangnya cuma membaca "isinya tidak bisa diubah" tanpa tahu
// bahwa nominal kasnya yang jadi soal.
benar(
  '§5 alasannya disebut: nominal kasnya dihitung dari harga lama',
  /nominal kasnya dihitung dari harga yang lama/i.test(lunas ?? ''),
  `dapat: ${lunas}`
);

// Setelah pembayarannya dibatalkan, boleh.
await q(`select batalkan_pembayaran_nota($1)`, [B]);
const setelahBatal = await gagalkan(() => q(`select geser_harga_nota(array[$1]::uuid[])`, [B]));
benar('§5 setelah pembayaran dibatalkan, boleh digeser', setelahBatal === null, `dapat: ${setelahBatal}`);
cek('§5 totalnya jadi 500', (await ringkas(B)).total, '500');

// =====================================================================
// §6. Nota yang TIDAK disebut tidak tersentuh.
//
// Ini yang membuat konversinya aman dipakai: nota yang harganya sudah benar
// akan RUSAK kalau ikut digeser, jadi fungsinya tidak boleh menyapu apa pun
// di luar daftar yang diberikan.
// =====================================================================
const C = (
  await satu(`select simpan_nota_terima($1,'2026-09-05','Pasar',null,null,null,$2::jsonb) as id`, [
    OUT,
    JSON.stringify([{ product_id: STRAW, qty: 500, line_total: 45000 }])
  ])
).id;
const D = (
  await satu(`select simpan_nota_terima($1,'2026-09-05','Pasar',null,null,null,$2::jsonb) as id`, [
    OUT,
    JSON.stringify([{ product_id: NANAS, qty: 200, unit_cost: 700 }])
  ])
).id;
await q(`select geser_harga_nota(array[$1]::uuid[])`, [D]);
cek('§6 nota yang benar TIDAK ikut tergeser', (await ringkas(C)).total, '45000');
benar('§6 dan penandanya tetap kosong', (await ringkas(C)).harga_digeser_at === null);

// =====================================================================
// §7. Wewenang outlet ditegakkan; satu gagal berarti tidak ada yang berubah.
// =====================================================================
await q(`select set_config('request.jwt.claim.sub', $1, false)`, [LAIN]);
const bukanWewenang = await gagalkan(() => q(`select geser_harga_nota(array[$1]::uuid[])`, [C]));
benar('§7 outlet lain ditolak', /bukan wewenangmu/i.test(bukanWewenang ?? ''), `dapat: ${bukanWewenang}`);

await q(`select set_config('request.jwt.claim.sub', $1, false)`, [STAFF]);
const E = (
  await satu(`select simpan_nota_terima($1,'2026-09-05','Pasar',null,null,null,$2::jsonb) as id`, [
    OUT,
    JSON.stringify([{ product_id: WORTEL, qty: 10, unit_cost: 100 }])
  ])
).id;
// A sudah pernah digeser -> seluruh permintaan harus gagal, termasuk E.
const campur = await gagalkan(() => q(`select geser_harga_nota(array[$1,$2]::uuid[])`, [E, A]));
benar('§7 satu nota bermasalah membatalkan seluruhnya', campur !== null, `dapat: ${campur}`);
cek('§7 nota yang sehat TIDAK ikut tergeser sebagian', (await ringkas(E)).total, '1000');

// =====================================================================
// §8. Baris tanpa harga dilewati, bukan menggagalkan notanya.
// =====================================================================
const F = (
  await satu(`select simpan_nota_terima($1,'2026-09-05','Pasar',null,null,null,$2::jsonb) as id`, [
    OUT,
    JSON.stringify([
      { product_id: WORTEL, qty: 100, unit_cost: 2000 },
      { product_id: STRAW, qty: 50 }
    ])
  ])
).id;
const nF = await satu(`select geser_harga_nota(array[$1]::uuid[]) as n`, [F]);
cek('§8 hanya baris berharga yang dihitung', Number(nF.n), 1);
cek('§8 totalnya jadi 2.000', (await ringkas(F)).total, '2000');
cek(
  '§8 baris tanpa harga tetap tanpa harga, bukan jadi nol',
  (await satu(`select line_total, unit_cost from goods_receipt_items where receipt_id = $1 and product_id = $2`, [F, STRAW])),
  { line_total: null, unit_cost: null }
);

if (gagal === 0) console.log('Migration 0124 di Postgres sungguhan: 8 bagian LULUS. ✅');
process.exit(gagal === 0 ? 0 : 1);
