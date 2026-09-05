/**
 * MIGRATION 0125 DI POSTGRES SUNGGUHAN (PGlite).
 *
 * ============ YANG DIMINTA ============
 *
 *   "untuk jatuh tempo, bisakah, selain diambil dari kas outlet dia diambil
 *    dari Pusat, jadi ini dibayar oleh pusat tanpa berpengaruh ke kas manapun"
 *
 * ============ YANG DIUJI ============
 *
 *   1. Pembayaran PUSAT menandai lunas TANPA satu pun baris di `cash_entries`.
 *   2. Ia bisa DIBEDAKAN dari nota bertotal 0 yang juga lunas tanpa entri kas.
 *   3. Pembungkus 4 argumen (PWA lama) tetap berperilaku 'kas'.
 *   4. Pembayaran pusat boleh LINTAS OUTLET; pembayaran kas tetap tidak.
 *   5. Pembatalannya tidak membuat entri balik, dan hanya melepas nota itu.
 *   6. Jalur kas TIDAK berubah sedikit pun (regresi 0122).
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
  '0124_geser_harga_ke_harga_beli.sql',
  '0125_nota_dibayar_pusat.sql'
])
  await jalankan(b);
console.log('  0084 -> … -> 0125 terpasang.');
await jalankan('0125_nota_dibayar_pusat.sql');
console.log('  dijalankan ulang: aman.');

const BU = (await satu(`insert into business_units (name) values ('Cafe') returning id`)).id;
const OUT = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Serpong') returning id`, [BU])).id;
const OUT2 = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Sentul') returning id`, [BU])).id;
const TELUR = (await satu(`insert into products (business_unit_id, name) values ($1,'Telur') returning id`, [BU])).id;

const STAFF = '11111111-1111-1111-1111-111111111111';
await q(`insert into user_profiles (id, full_name) values ($1,'Staff')`, [STAFF]);
// Cakupan se-BU: berhak di KEDUA outlet, supaya penolakan lintas-outlet nanti
// benar-benar datang dari aturannya, bukan dari wewenang yang kebetulan kurang.
await q(`insert into membership_scopes (user_id, business_unit_id, outlet_id, role) values ($1,$2,null,'staff')`, [STAFF, BU]);
await q(`select set_config('request.jwt.claim.sub', $1, false)`, [STAFF]);
const KAS = (await satu(`insert into cash_accounts (holder_id, name, outlet_id) values ($1,'Kas Ops',$2) returning id`, [STAFF, OUT])).id;

const buat = async (outlet, items) =>
  (await satu(`select simpan_nota_terima($1,'2026-09-05','Pasar',null,null,null,$2::jsonb) as id`, [outlet, JSON.stringify(items)])).id;
const ringkas = (id) =>
  satu(`select payment_status, payment_source, payment_entry_id, total::text as total from nota_ringkas where id = $1`, [id]);
const jumlahEntri = async () => Number((await satu(`select count(*) as n from cash_entries`)).n);

// =====================================================================
// §1. INTI: dibayar PUSAT — lunas, tanpa satu pun baris kas.
// =====================================================================
const A = await buat(OUT, [{ product_id: TELUR, qty: 100, line_total: 300000 }]);
const sebelum = await jumlahEntri();
const hasil = await satu(`select bayar_nota(array[$1]::uuid[], null, '2026-09-06', null, 'pusat') as id`, [A]);
cek('§1 INTI: tidak ada entri kas yang dikembalikan', hasil.id, null);
cek('§1 dan tidak ada baris kas yang lahir', await jumlahEntri(), sebelum);

const a = await ringkas(A);
cek('§1 notanya lunas dan sumbernya tercatat', [a.payment_status, a.payment_source, a.payment_entry_id], ['lunas', 'pusat', null]);

// =====================================================================
// §2. Bisa DIBEDAKAN dari nota bertotal 0.
//
// Keduanya lunas tanpa entri kas. Tanpa `payment_source`, barang sampel yang
// gratis dan tagihan Rp300.000 yang dibayar kantor pusat terlihat persis sama.
// =====================================================================
const GRATIS = await buat(OUT, [{ product_id: TELUR, qty: 5, line_total: 0 }]);
await q(`select bayar_nota(array[$1]::uuid[], $2, '2026-09-06', null, 'kas')`, [GRATIS, KAS]);
const g = await ringkas(GRATIS);
cek('§2 nota bertotal 0 tetap bersumber kas', [g.payment_status, g.payment_source, g.payment_entry_id], ['lunas', 'kas', null]);
benar('§2 keduanya sama-sama tanpa entri kas, tapi sumbernya berbeda', a.payment_source !== g.payment_source);

// =====================================================================
// §3. Pembungkus 4 argumen (PWA lama) tetap 'kas'.
// =====================================================================
const B = await buat(OUT, [{ product_id: TELUR, qty: 10, line_total: 50000 }]);
const lama = await satu(`select bayar_nota(array[$1]::uuid[], $2, '2026-09-06', null) as id`, [B, KAS]);
benar('§3 bentuk lama tetap membuat entri kas', !!lama.id);
cek('§3 dan sumbernya kas', (await ringkas(B)).payment_source, 'kas');
const e = await satu(`select amount::text as a, untuk_nota from cash_entries where id = $1`, [lama.id]);
cek('§3 nominalnya benar dan ditandai untuk_nota', [e.a, e.untuk_nota], ['-50000', true]);

// =====================================================================
// §4. Pusat boleh lintas outlet; kas tetap tidak.
//
// Batas satu-outlet itu ADA karena `cash_entries.outlet_id` cuma satu nilai.
// Pembayaran pusat tidak membuat entri kas, jadi batas itu tidak punya sebab.
// =====================================================================
const C = await buat(OUT, [{ product_id: TELUR, qty: 1, line_total: 1000 }]);
const D = await buat(OUT2, [{ product_id: TELUR, qty: 1, line_total: 2000 }]);
const kasLintas = await gagalkan(() => q(`select bayar_nota(array[$1,$2]::uuid[], $3, '2026-09-06', null, 'kas')`, [C, D, KAS]));
benar('§4 kas lintas outlet TETAP ditolak', /outlet berbeda/i.test(kasLintas ?? ''), `dapat: ${kasLintas}`);

const pusatLintas = await gagalkan(() => q(`select bayar_nota(array[$1,$2]::uuid[], null, '2026-09-06', null, 'pusat')`, [C, D]));
benar('§4 pusat lintas outlet DITERIMA', pusatLintas === null, `dapat: ${pusatLintas}`);
cek('§4 keduanya lunas atas nama pusat', [(await ringkas(C)).payment_source, (await ringkas(D)).payment_source], ['pusat', 'pusat']);

// =====================================================================
// §5. Pembatalan pusat: tanpa entri balik, dan hanya nota itu.
// =====================================================================
const sebelumBatal = await jumlahEntri();
const n = await satu(`select batalkan_pembayaran_nota($1) as n`, [C]);
cek('§5 hanya satu nota yang dilepas', Number(n.n), 1);
cek('§5 tidak ada entri kas balik yang lahir', await jumlahEntri(), sebelumBatal);
cek(
  '§5 statusnya kembali belum dan sumbernya dikosongkan',
  [(await ringkas(C)).payment_status, (await ringkas(C)).payment_source],
  ['belum', null]
);
cek('§5 nota lain yang dibayar pusat bersamaan TIDAK ikut terlepas', (await ringkas(D)).payment_status, 'lunas');

// =====================================================================
// §6. REGRESI: pembatalan jalur KAS tetap membuat entri balik.
// =====================================================================
const sebelumKas = await jumlahEntri();
await q(`select batalkan_pembayaran_nota($1)`, [B]);
cek('§6 pembatalan kas tetap melahirkan entri balik', await jumlahEntri(), sebelumKas + 1);
const balik = await satu(`select entry_type, amount::text as a from cash_entries order by created_at desc limit 1`);
cek('§6 entri baliknya masuk sebesar nominal yang sama', [balik.entry_type, balik.a], ['in', '50000']);

// =====================================================================
// §7. Aturan yang tidak boleh longgar hanya karena sumbernya pusat.
// =====================================================================
const KOSONG = await buat(OUT, [{ product_id: TELUR, qty: 10 }]);
const tanpaHarga = await gagalkan(() => q(`select bayar_nota(array[$1]::uuid[], null, '2026-09-06', null, 'pusat')`, [KOSONG]));
benar(
  '§7 nota tanpa harga tetap ditolak walau dibayar pusat',
  /tanpa harga/i.test(tanpaHarga ?? ''),
  `dapat: ${tanpaHarga}`
);

const sumberNgawur = await gagalkan(() => q(`select bayar_nota(array[$1]::uuid[], null, '2026-09-06', null, 'owner')`, [KOSONG]));
benar('§7 sumber yang tidak dikenal ditolak', /kas atau pusat/i.test(sumberNgawur ?? ''), `dapat: ${sumberNgawur}`);

const dobel = await gagalkan(() => q(`select bayar_nota(array[$1]::uuid[], null, '2026-09-07', null, 'pusat')`, [A]));
benar('§7 nota yang sudah lunas pusat tidak bisa dibayar lagi', dobel !== null, `dapat: ${dobel}`);

// Nota lunas tetap terkunci isinya, apa pun sumbernya.
const kunci = await gagalkan(() =>
  q(`select ubah_nota_terima($1, null, null, null, null, null, $2::jsonb)`, [A, JSON.stringify([{ product_id: TELUR, qty: 1, line_total: 1 }])])
);
benar('§7 isi nota yang dibayar pusat tetap terkunci', /sudah dibayar/i.test(kunci ?? ''), `dapat: ${kunci}`);

if (gagal === 0) console.log('Migration 0125 di Postgres sungguhan: 7 bagian LULUS. ✅');
process.exit(gagal === 0 ? 0 : 1);
