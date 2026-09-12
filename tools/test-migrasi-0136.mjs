/**
 * MIGRATION 0136 DI POSTGRES SUNGGUHAN (PGlite).
 *
 * ============ BUG YANG DIPERBAIKI ============
 *
 * `0135` membangun `waste_rekap` yang hanya membaca `waste_runs`. Waste yang
 * dicatat SEBELUM 0135 hidup di `stock_movements` dengan `waste_run_id` kosong,
 * dan tidak punya satu pun jalan masuk ke view itu — jadi tab rekapnya kosong
 * sementara tab Riwayat penuh.
 *
 * Yang diuji di sini: catatan lama ikut terlihat, jenisnya dipulihkan dari
 * `notes`, baris-baris satu waste menu lama kembali jadi SATU kejadian, dan
 * `photo_path not null` pada data BARU tidak ikut dilonggarkan demi data lama.
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
  create schema if not exists storage;
  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
  $$;
  create table storage.buckets (id text primary key, name text, public boolean default false);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
  alter table storage.objects enable row level security;
  create or replace function storage.foldername(p text) returns text[] language sql immutable as $$
    select string_to_array(p, '/');
  $$;

  create table business_units (id uuid primary key default gen_random_uuid(), name text);
  create table outlets (id uuid primary key default gen_random_uuid(), business_unit_id uuid, name text, outlet_role text);
  create table user_profiles (id uuid primary key, full_name text);
  create table products (id uuid primary key default gen_random_uuid(), name text, base_unit text);
  create table recipes (
    id uuid primary key default gen_random_uuid(),
    business_unit_id uuid, product_id uuid, mode text default 'standalone',
    yield_qty numeric not null default 1, notes text);
  create table recipe_items (
    id uuid primary key default gen_random_uuid(),
    recipe_id uuid not null, ingredient_product_id uuid not null, qty numeric not null);
  create table stock_movements (
    id uuid primary key default gen_random_uuid(),
    business_unit_id uuid, outlet_id uuid, product_id uuid,
    movement_type text check (movement_type in ('receive','waste','adjustment','transfer_out','transfer_in','usage','production')),
    qty_delta numeric, unit_cost numeric, notes text, created_by uuid,
    created_at timestamptz default now());

  create or replace function has_outlet_scope(p_uid uuid, p_outlet uuid) returns boolean
    language sql stable as $$ select true $$;
  create or replace function has_bu_scope(p_uid uuid, p_bu uuid) returns boolean
    language sql stable as $$ select p_uid is not null $$;
  create or replace function record_menu_waste(p_bu uuid, p_outlet uuid, p_product uuid, p_qty numeric, p_notes text)
  returns void language plpgsql as $fn$ begin return; end; $fn$;
`);

const BU = (await satu(`insert into business_units (name) values ('Cafe') returning id`)).id;
const OUT = (await satu(`insert into outlets (business_unit_id, name, outlet_role) values ($1,'AB Sentul','standalone') returning id`, [BU])).id;
const STAFF = '11111111-1111-1111-1111-111111111111';
await q(`insert into user_profiles (id, full_name) values ($1,'Ulinuha')`, [STAFF]);
await q(`select set_config('request.jwt.claim.sub', $1, false)`, [STAFF]);

const BERAS = (await satu(`insert into products (name, base_unit) values ('Beras','gr') returning id`)).id;
const AIR = (await satu(`insert into products (name, base_unit) values ('Air','ml') returning id`)).id;
const JERUK = (await satu(`insert into products (name, base_unit) values ('Jeruk Nipis','gr') returning id`)).id;
const NASI = (await satu(`insert into products (name, base_unit) values ('NASI PUTIH','porsi') returning id`)).id;

// ---------------------------------------------------------------
// CATATAN LAMA — ditulis SEBELUM 0135 dipasang, jadi tanpa waste_run_id.
// Bentuk `notes`-nya persis seperti yang dihasilkan 0032 & layar spoil lama.
// ---------------------------------------------------------------
const WAKTU = '2026-09-11 10:15:00+07';
await q(
  `insert into stock_movements (business_unit_id, outlet_id, product_id, movement_type, qty_delta, notes, created_by, created_at)
   values ($1,$2,$3,'waste',-180,'Waste menu: NASI PUTIH x1 — Spoil',$5,$6),
          ($1,$2,$4,'waste',-90,'Waste menu: NASI PUTIH x1 — Spoil',$5,$6)`,
  [BU, OUT, BERAS, AIR, STAFF, WAKTU]
);
await q(
  `insert into stock_movements (business_unit_id, outlet_id, product_id, movement_type, qty_delta, notes, created_by, created_at)
   values ($1,$2,$3,'waste',-368,'Spoil: busuk',$4,'2026-09-10 15:39:00+07')`,
  [BU, OUT, JERUK, STAFF]
);
// Spoil tanpa alasan — layar lama menulis 'Spoil' saja.
await q(
  `insert into stock_movements (business_unit_id, outlet_id, product_id, movement_type, qty_delta, notes, created_by, created_at)
   values ($1,$2,$3,'waste',-27,'Spoil',$4,'2026-09-10 19:24:00+07')`,
  [BU, OUT, JERUK, STAFF]
);
// Bukan waste — tidak boleh ikut terbawa.
await q(
  `insert into stock_movements (business_unit_id, outlet_id, product_id, movement_type, qty_delta, notes, created_by)
   values ($1,$2,$3,'receive',500,'nota',$4)`,
  [BU, OUT, BERAS, STAFF]
);

const jalankan = async (b) =>
  db.exec(fs.readFileSync(path.join(AKAR, 'supabase/migrations', b), 'utf8').replace(/notify pgrst[^;]*;/g, ''));

await jalankan('0135_waste_foto_wajib.sql');
await jalankan('0136_rekap_waste_ikut_yang_lama.sql');
console.log('  0135 + 0136 terpasang di atas data lama.');
await jalankan('0136_rekap_waste_ikut_yang_lama.sql');
console.log('  0136 dijalankan ulang: aman.');

// =====================================================================
// §1 CATATAN LAMA IKUT TERLIHAT — inti perbaikannya
// =====================================================================
const lama = (await q(`select * from waste_rekap where lama order by tanggal desc, bahan_nama`)).rows;
cek('§1 empat baris lama ikut muncul', lama.length, 4);
benar('§1 semuanya ditandai lama', lama.every((r) => r.lama === true));
benar('§1 semuanya tanpa foto', lama.every((r) => r.photo_path === null));

// =====================================================================
// §2 JENISNYA DIPULIHKAN DARI CATATANNYA
// =====================================================================
const menuLama = lama.filter((r) => r.jenis === 'menu');
cek('§2 dua baris dikenali sebagai waste menu', menuLama.length, 2);
cek('§2 nama menunya dipulihkan', [...new Set(menuLama.map((r) => r.sumber_nama))], ['NASI PUTIH']);
cek('§2 jumlah porsinya dipulihkan', [...new Set(menuLama.map((r) => Number(r.qty_kejadian)))], [1]);
// Awalan yang ditulis kode dibuang supaya kolom Catatan tidak mengulang
// kolom Keterangan.
cek('§2 catatan orangnya saja yang tersisa', [...new Set(menuLama.map((r) => r.notes))], ['Spoil']);

const spoilLama = lama.filter((r) => r.jenis === 'spoil');
cek('§2 dua baris dikenali sebagai spoil', spoilLama.length, 2);
cek('§2 spoil: sumbernya bahan itu sendiri', [...new Set(spoilLama.map((r) => r.sumber_nama))], ['Jeruk Nipis']);
// Diperiksa satu per satu, BUKAN lewat `.sort()`.
//
// `[null, 'busuk'].sort()` menghasilkan `['busuk', null]` — `Array.sort`
// membandingkan sebagai string, dan "busuk" < "null". Percobaan pertama tes ini
// merah untuk data yang benar, dan tes yang menuduh kode benar akan dimatikan
// orang.
cek('§2 alasan spoil dipulihkan', spoilLama.some((r) => r.notes === 'busuk'), true);
cek('§2 "Spoil" polos jadi kosong, bukan teks "Spoil"', spoilLama.some((r) => r.notes === null), true);

// Jumlahnya POSITIF di rekap walau qty_delta-nya negatif — rekap membaca
// "berapa yang terbuang", bukan "berapa stok berubah".
benar('§2 jumlah bahannya positif', lama.every((r) => Number(r.bahan_qty) > 0));
cek('§2 beras 180', Number(menuLama.find((r) => r.bahan_nama === 'Beras').bahan_qty), 180);

// =====================================================================
// §3 SATU WASTE MENU LAMA = SATU KEJADIAN
//
// Dua baris bahannya lahir dari satu perulangan, jadi outlet + waktu +
// catatannya identik. Tanpa pengelompokan ini, "berapa kali waste bulan ini"
// akan menghitung tiap bahan sebagai kejadian tersendiri.
// =====================================================================
cek('§3 dua baris menu berbagi satu waste_id', new Set(menuLama.map((r) => r.waste_id)).size, 1);
cek('§3 dua spoil berbeda TIDAK digabung', new Set(spoilLama.map((r) => r.waste_id)).size, 2);

// =====================================================================
// §4 YANG BUKAN WASTE TIDAK IKUT TERBAWA
// =====================================================================
cek('§4 penerimaan tidak ikut', Number((await satu(`select count(*)::int c from waste_rekap where bahan_nama = 'Beras' and not lama`)).c), 0);
cek('§4 total baris rekap masih 4', Number((await satu(`select count(*)::int c from waste_rekap`)).c), 4);

// =====================================================================
// §5 DATA BARU TETAP WAJIB BERFOTO
//
// Godaan memperbaiki bug ini adalah membuat `waste_runs` untuk tiap baris lama
// (backfill), yang menuntut `photo_path` boleh kosong. Itu akan membuka kembali
// pintu untuk data BARU tanpa foto, selamanya, demi kenyamanan sekali.
// =====================================================================
const tanpaFoto = await gagalkan(() => q(`select catat_waste($1,'spoil',$2,1,null,null)`, [OUT, JERUK]));
benar('§5 foto masih wajib untuk catatan baru', !!tanpaFoto);
benar('§5 pesannya masih yang bisa ditindaklanjuti', /Foto wajib diisi/.test(tanpaFoto ?? ''), tanpaFoto ?? '');

const langsung = await gagalkan(() =>
  q(
    `insert into stock_movements (business_unit_id, outlet_id, product_id, movement_type, qty_delta, created_by)
     values ($1,$2,$3,'waste',-1,$4)`,
    [BU, OUT, JERUK, STAFF]
  )
);
benar('§5 jalur lama tetap tertutup untuk baris BARU', !!langsung);

// =====================================================================
// §6 CATATAN BARU DAN LAMA BERDAMPINGAN
// =====================================================================
const idBaru = (await satu(`select catat_waste($1,'spoil',$2,2,'o/f1.jpg','kena air') as id`, [OUT, JERUK])).id;
benar('§6 catatan baru tersimpan', !!idBaru);

const semua = (await q(`select lama, count(*)::int c from waste_rekap group by lama order by lama`)).rows;
cek('§6 satu baris baru + empat baris lama', semua.map((r) => [r.lama, Number(r.c)]), [[false, 1], [true, 4]]);

const baru = await satu(`select * from waste_rekap where not lama`);
cek('§6 baris baru berfoto', baru.photo_path, 'o/f1.jpg');
benar('§6 baris baru bernomor', /^WST-/.test(baru.code ?? ''), baru.code ?? '');
cek('§6 baris lama tidak bernomor', lama[0].code, null);

if (gagal) {
  console.error(`\n${gagal} kasus gagal.`);
  process.exit(1);
}
console.log('0136 benar — waste lama ikut terlihat tanpa melonggarkan kewajiban foto untuk yang baru. ✅');
