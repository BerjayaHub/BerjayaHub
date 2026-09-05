/**
 * MIGRATION 0119 DI POSTGRES SUNGGUHAN (PGlite).
 *
 * ============ BUG YANG DIPERBAIKI ============
 *
 * Menekan "+ Foto" pada nota yang sudah berisi supplier "Gerobak Telur"
 * MENGHAPUS nama supplier itu. Layarnya cuma mengirim `photoPath`; tiga kolom
 * lain diisi string kosong oleh service, dan `nullif('','')` menjadikannya
 * NULL.
 *
 * Tombolnya bernama "+ Foto", toast-nya hijau, fotonya benar-benar tersimpan.
 * Satu-satunya yang berubah selain foto adalah tiga kolom yang tidak pernah
 * disebut siapa pun.
 *
 * ============ YANG DIUJI ============
 *
 *   1. Aturan NULL/kosong/berisi berlaku untuk KEEMPAT kolom, bukan cuma foto.
 *   2. Penjagaan 0118 (penyelarasan `unit_cost`) TIDAK hilang saat fungsinya
 *      ditulis ulang — ini risiko utama dari `create or replace`.
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

const db = new PGlite();
const q = (sql, params) => db.query(sql, params);
const satu = async (sql, params) => (await q(sql, params)).rows[0];

await db.exec(`
  create schema if not exists auth;
  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
  $$;
  create table business_units (id uuid primary key default gen_random_uuid(), name text);
  create table outlets (id uuid primary key default gen_random_uuid(), business_unit_id uuid, name text);
  create table user_profiles (id uuid primary key, full_name text);
  create table products (id uuid primary key default gen_random_uuid(), business_unit_id uuid, name text,
    base_unit text default 'gr', product_type text default 'raw', purchase_price numeric, purchase_qty numeric);
  create table goods_receipts (id uuid primary key default gen_random_uuid(),
    business_unit_id uuid, outlet_id uuid, code text, receipt_date date,
    supplier text, invoice_no text, photo_path text, notes text,
    created_by uuid, created_at timestamptz default now(), updated_at timestamptz default now());
  create table goods_receipt_items (id uuid primary key default gen_random_uuid(),
    receipt_id uuid, product_id uuid, qty numeric, unit_cost numeric, notes text);
  create table stock_movements (id uuid primary key default gen_random_uuid(),
    business_unit_id uuid, outlet_id uuid, product_id uuid, movement_type text,
    qty_delta numeric, unit_cost numeric, notes text, receipt_id uuid, created_by uuid,
    created_at timestamptz not null default now());
  create table membership_scopes (user_id uuid, business_unit_id uuid, outlet_id uuid, role text);
  create role authenticated;
  create or replace function has_bu_scope(p_uid uuid, p_bu uuid) returns boolean language sql stable as $$
    select exists (select 1 from membership_scopes where user_id = p_uid and business_unit_id = p_bu);
  $$;
  create or replace function has_outlet_scope(p_uid uuid, p_outlet uuid) returns boolean language sql stable as $$
    select exists (select 1 from membership_scopes ms where ms.user_id = p_uid
      and (ms.outlet_id = p_outlet or (ms.outlet_id is null and ms.business_unit_id = (select business_unit_id from outlets where id = p_outlet))));
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

await jalankan('0084_nota_penerimaan.sql');
await jalankan('0118_biaya_rata_bahan.sql');
await jalankan('0119_ubah_nota_tanpa_menghapus.sql');
console.log('  0084 -> 0118 -> 0119 terpasang.');
await jalankan('0119_ubah_nota_tanpa_menghapus.sql');
console.log('  dijalankan ulang: aman.');

const BU = (await satu(`insert into business_units (name) values ('Cafe') returning id`)).id;
const OUT = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Serpong') returning id`, [BU])).id;
const TELUR = (await satu(`insert into products (business_unit_id, name) values ($1,'Telur') returning id`, [BU])).id;
const STAFF = '11111111-1111-1111-1111-111111111111';
await q(`insert into user_profiles (id, full_name) values ($1,'Staff')`, [STAFF]);
await q(`insert into membership_scopes (user_id, business_unit_id, outlet_id, role) values ($1,$2,$3,'staff')`, [STAFF, BU, OUT]);
await q(`select set_config('request.jwt.claim.sub', $1, false)`, [STAFF]);

const buatNota = async () =>
  (
    await satu(`select simpan_nota_terima($1,'2026-09-05','Gerobak Telur','INV-77',null,'titip di kulkas',$2::jsonb) as id`, [
      OUT,
      JSON.stringify([{ product_id: TELUR, qty: 1000, unit_cost: 30 }])
    ])
  ).id;

const kepala = (id) =>
  satu(`select supplier, invoice_no, photo_path, notes, receipt_date::text from goods_receipts where id = $1`, [id]);

// =====================================================================
// §1. INTI: "+ Foto" hanya menyentuh fotonya.
// =====================================================================
const A = await buatNota();
await q(`select ubah_nota_terima($1, null, null, null, $2, null, null)`, [A, 'foto/abc.jpg']);
const a = await kepala(A);
cek(
  '§1 INTI: supplier, invoice, catatan SELAMAT',
  [a.supplier, a.invoice_no, a.notes],
  ['Gerobak Telur', 'INV-77', 'titip di kulkas']
);
cek('§1 fotonya tersimpan', a.photo_path, 'foto/abc.jpg');
cek('§1 tanggalnya tidak bergeser', a.receipt_date, '2026-09-05');

// =====================================================================
// §2. String KOSONG tetap berarti "hapus" — itu jalur yang sah.
// =====================================================================
const B = await buatNota();
await q(`select ubah_nota_terima($1, null, '', '', '', '', null)`, [B]);
const b = await kepala(B);
cek('§2 kosong = hapus, untuk keempatnya', [b.supplier, b.invoice_no, b.photo_path, b.notes], [null, null, null, null]);

// =====================================================================
// §3. String berisi tetap mengganti.
// =====================================================================
const C = await buatNota();
await q(`select ubah_nota_terima($1, null, 'Pasar Modern', 'INV-99', null, 'ganti', null)`, [C]);
const c = await kepala(C);
cek('§3 berisi = ganti', [c.supplier, c.invoice_no, c.notes], ['Pasar Modern', 'INV-99', 'ganti']);

// FOTONYA JUGA HARUS SELAMAT — dan arah ini sempat tidak diuji sama sekali.
//
// §1 mengirim foto (jadi ia memang berubah), §2 mengosongkan semuanya, §3
// notanya belum pernah punya foto. Tidak satu pun menguji "sudah punya foto,
// lalu diedit tanpa menyebut foto" — dan sabotase yang mengembalikan
// `photo_path` ke penimpaan tanpa syarat LOLOS dari ketiganya.
//
// Aturan `photo_path` sudah benar sejak 0084; yang tidak ada adalah tesnya.
await q(`select ubah_nota_terima($1, null, null, null, 'foto/lama.jpg', null, null)`, [C]);
await q(`select ubah_nota_terima($1, null, 'Supplier Baru', null, null, null, null)`, [C]);
const c2 = await kepala(C);
cek('§3 INTI: mengubah supplier tidak menghapus foto yang sudah ada', c2.photo_path, 'foto/lama.jpg');
cek('§3 …dan suppliernya memang berganti', c2.supplier, 'Supplier Baru');

// =====================================================================
// §4. Penjagaan 0118 tidak hilang saat fungsinya ditulis ulang.
//
// Risiko utama `create or replace`: menyalin sebagian dan kehilangan satu
// penjagaan tanpa menyadarinya. Yang paling mudah hilang di sini adalah
// penyelarasan `unit_cost` ke `stock_movements` — tanpa itu koreksi harga
// tidak pernah sampai ke biaya rata-rata.
// =====================================================================
// BAHAN TERSENDIRI, dan itu bukan kerapian.
//
// Percobaan pertama memakai TELUR — yang sudah dibeli tiga kali di §1–§3 pada
// harga 30. Sesudah koreksi jadi 45, rata-ratanya 33,75: (3.000x30 + 1.000x45)
// / 4.000. Angka itu BENAR; harapan tesnya yang salah.
//
// Pemeriksaan yang datanya tercampur menguji dua hal sekaligus dan tidak bisa
// menjawab satu pun dengan pasti.
const KEJU = (await satu(`insert into products (business_unit_id, name) values ($1,'Keju') returning id`, [BU])).id;
const D = (
  await satu(`select simpan_nota_terima($1,'2026-09-05','Gerobak Telur','INV-77',null,'titip di kulkas',$2::jsonb) as id`, [
    OUT,
    JSON.stringify([{ product_id: KEJU, qty: 1000, unit_cost: 30 }])
  ])
).id;
const rataD = async () =>
  Number((await satu(`select rata from biaya_rata_bahan where outlet_id = $1 and product_id = $2`, [OUT, KEJU]))?.rata ?? NaN);
cek('§4 harga awal tercatat', await rataD(), 30);

await q(`select ubah_nota_terima($1, null, null, null, null, null, $2::jsonb)`, [
  D,
  JSON.stringify([{ product_id: KEJU, qty: 1000, unit_cost: 45 }])
]);
cek('§4 INTI: koreksi harga tetap sampai ke biaya rata-rata', await rataD(), 45);

const d = await kepala(D);
cek(
  '§4 …dan mengubah barang tidak ikut menghapus kepalanya',
  [d.supplier, d.invoice_no],
  ['Gerobak Telur', 'INV-77']
);

if (gagal === 0) console.log('Migration 0119: semua pemeriksaan lulus. ✅');
process.exit(gagal === 0 ? 0 : 1);
