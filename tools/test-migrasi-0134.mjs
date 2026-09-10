/**
 * MIGRATION 0134 DI POSTGRES SUNGGUHAN (PGlite).
 *
 * ============ YANG DIUJI ============
 *
 *   1. Contoh dari permintaannya: UDANG PACK resep 50gr udang, dibongkar 1 →
 *      pack -1, udang +50.
 *   2. Staff memilih baris mana yang kembali; yang tidak dipilih TIDAK kembali.
 *   3. Batas atas per bahan ditegakkan — 5 pack tidak bisa jadi 500gr udang.
 *      Ini yang menahan fitur ini jadi alat mencetak stok dari udara.
 *   4. Bahan yang kembali TIDAK membawa `unit_cost` — kalau ia membawanya,
 *      ongkos olahan pack merembes ke rata-rata biaya bahan baku (0118).
 *   5. Stok boleh menembus nol (konsisten dengan produksi 0020), tapi produk
 *      tanpa resep dan bahan di luar resep ditolak.
 *   6. Pembatalan mengembalikan keadaan lewat pergerakan penyeimbang, dan
 *      catatan bongkarnya tetap ada.
 *   7. Wewenang outlet & alasan wajib.
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
  if (!syarat) { gagal++; console.error(`❌ ${nama}${ket ? ' — ' + ket : ''}`); }
};

const db = new PGlite();
const q = (sql, params) => db.query(sql, params);
const satu = async (sql, params) => (await q(sql, params)).rows[0];
const gagalkan = async (fn) => { try { await fn(); return null; } catch (e) { return String(e.message ?? e); } };

await db.exec(`
  create role authenticated;
  create schema if not exists auth;
  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
  $$;
  create table business_units (id uuid primary key default gen_random_uuid(), name text);
  create table outlets (id uuid primary key default gen_random_uuid(), business_unit_id uuid, name text);
  create table user_profiles (id uuid primary key, full_name text);
  create table products (id uuid primary key default gen_random_uuid(), name text, base_unit text);
  create table recipes (
    id uuid primary key default gen_random_uuid(),
    business_unit_id uuid, product_id uuid unique, yield_qty numeric not null default 1, notes text);
  create table recipe_items (
    id uuid primary key default gen_random_uuid(),
    recipe_id uuid not null, ingredient_product_id uuid not null, qty numeric not null);
  create table stock_movements (
    id uuid primary key default gen_random_uuid(),
    business_unit_id uuid, outlet_id uuid, product_id uuid,
    movement_type text check (movement_type in ('receive','waste','adjustment','transfer_out','transfer_in','usage','production')),
    qty_delta numeric, unit_cost numeric, notes text, created_by uuid,
    production_id uuid, dispatch_id uuid, receipt_id uuid, ref_outlet_id uuid,
    created_at timestamptz default now());

  create or replace function has_outlet_scope(p_uid uuid, p_outlet uuid) returns boolean
    language sql stable as $$
      select exists (select 1 from user_profiles u
                      where u.id = p_uid and (u.full_name = 'SEMUA' or u.full_name = p_outlet::text)); $$;
  create or replace function has_bu_scope(p_uid uuid, p_bu uuid) returns boolean
    language sql stable as $$ select p_uid is not null $$;
`);

const jalankan = async (b) =>
  db.exec(fs.readFileSync(path.join(AKAR, 'supabase/migrations', b), 'utf8').replace(/notify pgrst[^;]*;/g, ''));
await jalankan('0134_bongkar_bahan.sql');
console.log('  0134 terpasang.');
await jalankan('0134_bongkar_bahan.sql');
console.log('  dijalankan ulang: aman.');

const BU = (await satu(`insert into business_units (name) values ('Cafe') returning id`)).id;
const OUT = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Sentul') returning id`, [BU])).id;
const LAIN = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Serpong') returning id`, [BU])).id;
const STAFF = '11111111-1111-1111-1111-111111111111';
const LUAR = '22222222-2222-2222-2222-222222222222';
await q(`insert into user_profiles (id, full_name) values ($1,'SEMUA'), ($2,$3)`, [STAFF, LUAR, LAIN]);
await q(`select set_config('request.jwt.claim.sub', $1, false)`, [STAFF]);

const PACK = (await satu(`insert into products (name, base_unit) values ('UDANG PACK','pcs') returning id`)).id;
const UDANG = (await satu(`insert into products (name, base_unit) values ('Udang','GR') returning id`)).id;
const TEPUNG = (await satu(`insert into products (name, base_unit) values ('Tepung','GR') returning id`)).id;
const KOPI = (await satu(`insert into products (name, base_unit) values ('Kopi','GR') returning id`)).id;

// UDANG PACK: yield 1 pcs, isinya 50gr udang + 10gr tepung.
const RESEP = (await satu(`insert into recipes (business_unit_id, product_id, yield_qty) values ($1,$2,1) returning id`, [BU, PACK])).id;
await q(`insert into recipe_items (recipe_id, ingredient_product_id, qty) values ($1,$2,50), ($1,$3,10)`, [RESEP, UDANG, TEPUNG]);

const stok = async (pid) =>
  Number((await satu(`select coalesce(sum(qty_delta),0) as t from stock_movements where product_id=$1 and outlet_id=$2`, [pid, OUT])).t);

// Stok awal: 5 pack, dari penerimaan.
await q(
  `insert into stock_movements (business_unit_id, outlet_id, product_id, movement_type, qty_delta, unit_cost, created_by)
   values ($1,$2,$3,'receive',5,12000,$4)`,
  [BU, OUT, PACK, STAFF]
);

// =====================================================================
// §1. Contoh dari permintaannya.
// =====================================================================
const B1 = (
  await satu(`select bongkar_bahan($1,$2,1,$3::jsonb,'coba') as id`, [
    OUT,
    PACK,
    JSON.stringify([{ product_id: UDANG, qty: 50 }])
  ])
).id;
benar('§1 catatan bongkar dibuat', !!B1);
cek('§1 stok UDANG PACK berkurang 1', await stok(PACK), 4);
cek('§1 stok Udang bertambah 50gr — persis contohnya', await stok(UDANG), 50);
benar('§1 nomornya berformat BKR-', /^BKR-/.test((await satu(`select code from bongkar_runs where id=$1`, [B1])).code));

// =====================================================================
// §2. Yang TIDAK dipilih tidak kembali.
// =====================================================================
cek('§2 tepung yang tidak dipilih tetap 0 — ia memang sudah menempel', await stok(TEPUNG), 0);
cek(
  '§2 dan tidak ada barisnya di dokumen bongkar',
  Number((await satu(`select count(*) as c from bongkar_items where bongkar_id=$1`, [B1])).c),
  1
);

// Boleh juga sebagian saja dari porsinya — udang yang terpotong, misalnya.
const B2 = (
  await satu(`select bongkar_bahan($1,$2,1,$3::jsonb,null) as id`, [OUT, PACK, JSON.stringify([{ product_id: UDANG, qty: 30 }])])
).id;
cek('§2 boleh mengembalikan kurang dari porsinya', await stok(UDANG), 80);
void B2;

// =====================================================================
// §3. BATAS ATAS — yang menahan fitur ini jadi alat mencetak stok.
// =====================================================================
const kebanyakan = await gagalkan(() =>
  q(`select bongkar_bahan($1,$2,1,$3::jsonb,null)`, [OUT, PACK, JSON.stringify([{ product_id: UDANG, qty: 500 }])])
);
benar('§3 melebihi porsi resep ditolak', kebanyakan !== null);
benar('§3 pesannya menyebut nama bahannya', /Udang/.test(kebanyakan ?? ''), `dapat: ${kebanyakan}`);
cek('§3 dan stoknya tidak berubah karena penolakan itu', await stok(UDANG), 80);

// Batasnya mengikuti JUMLAH yang dibongkar: 5 pack -> 250gr.
const B3 = (
  await satu(`select bongkar_bahan($1,$2,5,$3::jsonb,null) as id`, [OUT, PACK, JSON.stringify([{ product_id: UDANG, qty: 250 }])])
).id;
cek('§3 lima pack boleh mengembalikan 250gr', await stok(UDANG), 330);
cek('§3 dan packnya berkurang lima', await stok(PACK), -2);
void B3;

// Yield selain 1 ikut dihitung.
const NUGGET = (await satu(`insert into products (name, base_unit) values ('NUGGET PACK','pcs') returning id`)).id;
const R2 = (await satu(`insert into recipes (business_unit_id, product_id, yield_qty) values ($1,$2,4) returning id`, [BU, NUGGET])).id;
await q(`insert into recipe_items (recipe_id, ingredient_product_id, qty) values ($1,$2,200)`, [R2, UDANG]);
const porsi = Number(
  (await satu(`select qty_maks from porsi_bongkar($1,2) where ingredient_product_id=$2`, [NUGGET, UDANG])).qty_maks
);
cek('§3 yield 4: membongkar 2 pack memberi porsi 100gr, bukan 200', porsi, 100);

// =====================================================================
// §4. Bahan yang kembali TIDAK membawa biaya.
// =====================================================================
const biaya = (await q(`select distinct unit_cost from stock_movements where movement_type='bongkar_in'`)).rows;
cek('§4 seluruh pemasukan hasil bongkar tanpa unit_cost', biaya.length, 1);
benar('§4 dan nilainya NULL, bukan 0', biaya[0].unit_cost === null, `dapat: ${biaya[0].unit_cost}`);

// =====================================================================
// §5. Yang ditolak, dan yang sengaja dibiarkan.
// =====================================================================
const tanpaResep = await gagalkan(() =>
  q(`select bongkar_bahan($1,$2,1,$3::jsonb,null)`, [OUT, KOPI, JSON.stringify([{ product_id: UDANG, qty: 1 }])])
);
benar('§5 produk tanpa resep ditolak', /belum punya resep/i.test(tanpaResep ?? ''), `dapat: ${tanpaResep}`);

const bukanBahan = await gagalkan(() =>
  q(`select bongkar_bahan($1,$2,1,$3::jsonb,null)`, [OUT, PACK, JSON.stringify([{ product_id: KOPI, qty: 1 }])])
);
benar('§5 bahan di luar resep ditolak', /bukan bahan dari/i.test(bukanBahan ?? ''), `dapat: ${bukanBahan}`);

const kosong = await gagalkan(() => q(`select bongkar_bahan($1,$2,1,'[]'::jsonb,null)`, [OUT, PACK]));
benar('§5 bongkar tanpa bahan kembali diarahkan ke Waste', /Waste/i.test(kosong ?? ''), `dapat: ${kosong}`);

// SEBABNYA ikut diperiksa, bukan cuma "ada error".
//
// Dengan qty 0, porsinya juga 0 — jadi baris apa pun akan ditolak oleh
// pemeriksa BATAS ATAS, dengan pesan yang sama sekali berbeda. Menuntut
// sekadar "melempar" membuat pencabutan penjaga jumlah lolos tanpa terasa:
// sebuah sabotase memang lolos lewat celah itu.
for (const nol of [0, -3]) {
  const pesan = await gagalkan(() =>
    q(`select bongkar_bahan($1,$2,$3,$4::jsonb,null)`, [OUT, PACK, nol, JSON.stringify([{ product_id: UDANG, qty: 1 }])])
  );
  benar(`§5 jumlah ${nol} ditolak`, pesan !== null);
  benar(
    `§5 dan sebabnya JUMLAHNYA, bukan batas porsi`,
    /harus lebih dari 0/i.test(pesan ?? ''),
    `dapat: ${pesan}`
  );
}

// STOK MENEMBUS NOL SENGAJA DIBIARKAN — konsisten dengan produksi (0020).
cek('§5 stok pack memang sudah minus, dan itu diizinkan', await stok(PACK), -2);
benar(
  '§5 membongkar lagi walau stok minus tetap boleh',
  (await gagalkan(() => q(`select bongkar_bahan($1,$2,1,$3::jsonb,null)`, [OUT, PACK, JSON.stringify([{ product_id: UDANG, qty: 10 }])]))) === null
);

// =====================================================================
// §6. Pembatalan.
// =====================================================================
const packSebelum = await stok(PACK);
const udangSebelum = await stok(UDANG);
await q(`select batalkan_bongkar($1,'salah input')`, [B1]);
cek('§6 pack kembali +1', await stok(PACK), packSebelum + 1);
cek('§6 udang ditarik -50', await stok(UDANG), udangSebelum - 50);

const rowB1 = await satu(`select dibatalkan_at, alasan_batal, dibatalkan_by from bongkar_runs where id=$1`, [B1]);
benar('§6 catatannya tetap ada, ditandai dibatalkan', !!rowB1.dibatalkan_at);
cek('§6 alasannya tersimpan', rowB1.alasan_batal, 'salah input');
cek('§6 pelakunya tercatat', rowB1.dibatalkan_by, STAFF);
benar(
  '§6 tidak bisa dibatalkan dua kali',
  /memang sudah dibatalkan/i.test((await gagalkan(() => q(`select batalkan_bongkar($1,'lagi')`, [B1]))) ?? '')
);
benar(
  '§6 alasan wajib',
  /alasan/i.test((await gagalkan(() => q(`select batalkan_bongkar($1,'  ')`, [B3]))) ?? '')
);

// Pergerakan lamanya TIDAK dihapus.
benar(
  '§6 pergerakan lama tetap ada — riwayatnya jujur',
  Number((await satu(`select count(*) as c from stock_movements where movement_type in ('bongkar_in','bongkar_out')`)).c) > 6
);

// =====================================================================
// §7. Wewenang.
// =====================================================================
await q(`select set_config('request.jwt.claim.sub', $1, false)`, [LUAR]);
benar(
  '§7 orang outlet lain tidak bisa membongkar di sini',
  /tidak berhak/i.test(
    (await gagalkan(() => q(`select bongkar_bahan($1,$2,1,$3::jsonb,null)`, [OUT, PACK, JSON.stringify([{ product_id: UDANG, qty: 1 }])]))) ?? ''
  )
);
benar(
  '§7 dan tidak bisa membatalkan bongkar outlet lain',
  /bukan wewenangmu/i.test((await gagalkan(() => q(`select batalkan_bongkar($1,'iseng')`, [B3]))) ?? '')
);

if (gagal === 0) console.log('Migration 0134 di Postgres sungguhan: 7 bagian LULUS. ✅');
process.exit(gagal === 0 ? 0 : 1);
