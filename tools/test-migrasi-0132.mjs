/**
 * MIGRATION 0132 DI POSTGRES SUNGGUHAN (PGlite).
 *
 * ============ YANG DIUJI ============
 *
 *   1. Baris ber-qty kirim NOL bertahan — inti seluruh perubahan ini.
 *      Sebelumnya `v_qty <= 0` membuangnya, dan barang yang tidak dikirim
 *      lenyap dari surat jalan seolah-olah tidak pernah diminta.
 *   2. `ordered_qty` tersimpan, jadi baris nol bisa menjawab sendiri
 *      "berapa sebenarnya yang dipesan".
 *   3. Menyunting draft TIDAK menghapus keterangan & ordered_qty — termasuk
 *      kalau yang menyunting PWA lama yang tidak mengenal kedua kolom itu.
 *   4. Outlet boleh MELENGKAPI keterangan yang kosong, tapi tidak boleh
 *      menimpa keterangan CK.
 *   5. Draft yang SELURUH barisnya nol ditolak — itu bukan surat jalan,
 *      itu penolakan order yang menyamar.
 *   6. Jumlah kirim MINUS tetap ditolak.
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
  create table dispatches (
    id uuid primary key default gen_random_uuid(),
    business_unit_id uuid, from_outlet_id uuid, to_outlet_id uuid, code text,
    status text not null default 'draft', notes text, created_by uuid,
    created_at timestamptz default now(), stock_order_id uuid,
    received_at timestamptz, received_by uuid, esb_exported_at timestamptz);
  create table dispatch_items (
    id uuid primary key default gen_random_uuid(),
    dispatch_id uuid not null references dispatches(id) on delete cascade,
    product_id uuid not null,
    -- Batasan LAMA yang harus dilonggarkan 0132. Ditulis di sini persis
    -- seperti keadaan produksi, supaya migration-nya benar-benar diuji
    -- melawan keadaan yang akan ia temui.
    sent_qty numeric check (sent_qty > 0),
    received_qty numeric);
  create unique index dispatch_items_produk_uk on dispatch_items(dispatch_id, product_id);

  create or replace function has_outlet_scope(p_uid uuid, p_outlet uuid) returns boolean
    language sql stable as $$
      select exists (select 1 from user_profiles where id = p_uid and full_name <> 'ORANG LUAR')
         and p_outlet is not null; $$;
  create or replace function boleh_kelola_draft(p_dispatch uuid) returns boolean
    language sql stable as $$
      select exists (select 1 from dispatches d where d.id = p_dispatch and d.status = 'draft'
                       and has_outlet_scope(auth.uid(), d.from_outlet_id)); $$;
`);

const jalankan = async (b) =>
  db.exec(fs.readFileSync(path.join(AKAR, 'supabase/migrations', b), 'utf8').replace(/notify pgrst[^;]*;/g, ''));
await jalankan('0132_kiriman_nol_dan_keterangan.sql');
console.log('  0132 terpasang.');
await jalankan('0132_kiriman_nol_dan_keterangan.sql');
console.log('  dijalankan ulang: aman.');

const BU = (await satu(`insert into business_units (name) values ('Cafe') returning id`)).id;
const CK = (await satu(`insert into outlets (business_unit_id, name) values ($1,'CK') returning id`, [BU])).id;
const OUT = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Serpong') returning id`, [BU])).id;
const CKSTAFF = '11111111-1111-1111-1111-111111111111';
const OUTSTAFF = '22222222-2222-2222-2222-222222222222';
const LUAR = '33333333-3333-3333-3333-333333333333';
await q(`insert into user_profiles (id, full_name) values ($1,'Rio'), ($2,'Rina'), ($3,'ORANG LUAR')`, [CKSTAFF, OUTSTAFF, LUAR]);
await q(`select set_config('request.jwt.claim.sub', $1, false)`, [CKSTAFF]);

const PISANG = (await satu(`insert into products (name, base_unit) values ('Buah Pisang Uli','GR') returning id`)).id;
const CIRENG = (await satu(`insert into products (name, base_unit) values ('BAHAN CIRENG CRISPY','porsi') returning id`)).id;

// =====================================================================
// §1 & §2. Baris NOL bertahan, lengkap dengan jumlah yang diminta.
// =====================================================================
const D = (
  await satu(
    `select buat_draft_kiriman($1,$2,$3::jsonb,'kiriman pagi',null) as id`,
    [
      CK,
      OUT,
      JSON.stringify([
        { product_id: PISANG, qty: 1065, ordered_qty: 1065, keterangan: 'dikirim via online' },
        // Diminta 10 porsi, TIDAK dikirim karena stok CK habis.
        { product_id: CIRENG, qty: 0, ordered_qty: 10, keterangan: 'stok CK habis' }
      ])
    ]
  )
).id;

const isi = (await q(`select product_id, sent_qty, ordered_qty, keterangan from dispatch_items where dispatch_id=$1`, [D])).rows;
cek('§1 kedua baris tersimpan — yang nol TIDAK dibuang', isi.length, 2);

const nol = isi.find((r) => r.product_id === CIRENG);
benar('§1 barisnya ada', !!nol);
cek('§1 jumlah kirimnya nol', Number(nol.sent_qty), 0);
cek('§2 dan jumlah yang DIMINTA tetap terbaca', Number(nol.ordered_qty), 10);
cek('§2 keterangannya tersimpan', nol.keterangan, 'stok CK habis');

const kirim = isi.find((r) => r.product_id === PISANG);
cek('§1 baris yang dikirim tidak terganggu', Number(kirim.sent_qty), 1065);
cek('§2 keterangan online tersimpan', kirim.keterangan, 'dikirim via online');

// =====================================================================
// §3. Menyunting draft tidak menghapus dua kolom baru.
// =====================================================================
//
// Ini yang paling mudah hilang tanpa terasa: PWA lama mengirim hanya
// {product_id, qty} — persis bentuk di bawah ini.
await q(`select ubah_draft_kiriman($1,$2::jsonb,'catatan baru')`, [
  D,
  JSON.stringify([
    { product_id: PISANG, qty: 900 },
    { product_id: CIRENG, qty: 0 }
  ])
]);
const sesudah = (await q(`select product_id, sent_qty, ordered_qty, keterangan from dispatch_items where dispatch_id=$1`, [D])).rows;
cek('§3 kedua baris masih ada sesudah disunting', sesudah.length, 2);
const nol2 = sesudah.find((r) => r.product_id === CIRENG);
cek('§3 baris nol bertahan', Number(nol2.sent_qty), 0);
cek('§3 keterangan TIDAK hilang walau klien tidak mengirimnya', nol2.keterangan, 'stok CK habis');
cek('§3 jumlah diminta juga bertahan', Number(nol2.ordered_qty), 10);
cek('§3 jumlah kirim yang baru tersimpan', Number(sesudah.find((r) => r.product_id === PISANG).sent_qty), 900);

// Keterangan yang DIKIRIM ulang memang menimpa — itu CK menyunting miliknya.
await q(`select ubah_draft_kiriman($1,$2::jsonb,'x')`, [
  D,
  JSON.stringify([
    { product_id: PISANG, qty: 900, keterangan: 'diantar kurir' },
    { product_id: CIRENG, qty: 0 }
  ])
]);
cek(
  '§3 CK boleh mengubah keterangannya sendiri lewat draft',
  (await satu(`select keterangan from dispatch_items where dispatch_id=$1 and product_id=$2`, [D, PISANG])).keterangan,
  'diantar kurir'
);

// =====================================================================
// §4. Outlet MELENGKAPI yang kosong, tidak menimpa yang sudah ada.
// =====================================================================
const D2 = (
  await satu(`select buat_draft_kiriman($1,$2,$3::jsonb,'',null) as id`, [
    CK,
    OUT,
    JSON.stringify([
      { product_id: PISANG, qty: 100, keterangan: 'dari CK' },
      { product_id: CIRENG, qty: 5 } // keterangan sengaja dikosongkan CK
    ])
  ])
).id;
await q(`update dispatches set status='sent' where id=$1`, [D2]);

const idKosong = (await satu(`select id from dispatch_items where dispatch_id=$1 and product_id=$2`, [D2, CIRENG])).id;
const idIsi = (await satu(`select id from dispatch_items where dispatch_id=$1 and product_id=$2`, [D2, PISANG])).id;

await q(`select set_config('request.jwt.claim.sub', $1, false)`, [OUTSTAFF]);
const n = Number(
  (
    await satu(`select lengkapi_keterangan_kiriman($1,$2::jsonb) as n`, [
      D2,
      JSON.stringify([
        { item_id: idKosong, keterangan: 'diterima via online' },
        { item_id: idIsi, keterangan: 'PERCOBAAN MENIMPA' }
      ])
    ])
  ).n
);
cek('§4 hanya SATU baris yang terisi — yang kosong', n, 1);
cek(
  '§4 outlet melengkapi yang kosong',
  (await satu(`select keterangan from dispatch_items where id=$1`, [idKosong])).keterangan,
  'diterima via online'
);
cek(
  '§4 keterangan CK TIDAK tertimpa',
  (await satu(`select keterangan from dispatch_items where id=$1`, [idIsi])).keterangan,
  'dari CK'
);

// Keterangan kosong/spasi diabaikan, bukan menimpa jadi kosong.
cek(
  '§4 kiriman keterangan kosong tidak menghitung apa pun',
  Number((await satu(`select lengkapi_keterangan_kiriman($1,$2::jsonb) as n`, [D2, JSON.stringify([{ item_id: idKosong, keterangan: '   ' }])])).n),
  0
);

await q(`select set_config('request.jwt.claim.sub', $1, false)`, [LUAR]);
benar(
  '§4 orang luar tidak bisa menyentuh keterangan',
  /bukan wewenangmu/i.test(
    (await gagalkan(() => q(`select lengkapi_keterangan_kiriman($1,$2::jsonb)`, [D2, JSON.stringify([{ item_id: idKosong, keterangan: 'iseng' }])]))) ?? ''
  )
);
await q(`select set_config('request.jwt.claim.sub', $1, false)`, [CKSTAFF]);

// =====================================================================
// §5. Draft yang SELURUHNYA nol ditolak.
// =====================================================================
const semuaNol = await gagalkan(() =>
  q(`select buat_draft_kiriman($1,$2,$3::jsonb,'',null)`, [CK, OUT, JSON.stringify([{ product_id: PISANG, qty: 0 }, { product_id: CIRENG, qty: 0 }])])
);
benar('§5 draft yang semua barisnya nol ditolak', semuaNol !== null);
benar('§5 dan pesannya mengarahkan ke Tolak Order', /Tolak Order/i.test(semuaNol ?? ''), `dapat: ${semuaNol}`);

// Draft yang sudah ada pun tidak boleh disunting jadi seluruhnya nol.
const jadiNol = await gagalkan(() =>
  q(`select ubah_draft_kiriman($1,$2::jsonb,'x')`, [D, JSON.stringify([{ product_id: PISANG, qty: 0 }, { product_id: CIRENG, qty: 0 }])])
);
benar('§5 draft yang disunting jadi seluruhnya nol juga ditolak', jadiNol !== null, `dapat: ${jadiNol}`);
cek(
  '§5 dan isinya tidak berubah karena penolakan itu',
  Number((await satu(`select sent_qty from dispatch_items where dispatch_id=$1 and product_id=$2`, [D, PISANG])).sent_qty),
  900
);

// =====================================================================
// §6. MINUS tetap ditolak — nol punya arti, minus tidak.
// =====================================================================
const D3 = (
  await satu(`select buat_draft_kiriman($1,$2,$3::jsonb,'',null) as id`, [
    CK,
    OUT,
    JSON.stringify([{ product_id: PISANG, qty: 10 }, { product_id: CIRENG, qty: -5 }])
  ])
).id;
cek('§6 baris berjumlah minus dilewati, bukan disimpan', Number((await satu(`select count(*) as c from dispatch_items where dispatch_id=$1`, [D3])).c), 1);
benar(
  '§6 dan tabelnya sendiri menolak minus',
  (await gagalkan(() => q(`insert into dispatch_items (dispatch_id, product_id, sent_qty) values ($1,$2,-1)`, [D3, CIRENG]))) !== null
);
benar(
  '§6 sementara nol diterima tabelnya',
  (await gagalkan(() => q(`insert into dispatch_items (dispatch_id, product_id, sent_qty) values ($1,$2,0)`, [D3, CIRENG]))) === null
);

if (gagal === 0) console.log('Migration 0132 di Postgres sungguhan: 6 bagian LULUS. ✅');
process.exit(gagal === 0 ? 0 : 1);
