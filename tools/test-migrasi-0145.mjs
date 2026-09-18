/**
 * MIGRATION 0145 DI POSTGRES SUNGGUHAN (PGlite).
 *
 * ============ YANG DIUJI ============
 *
 *   §1 SKENARIO ASLINYA, diputar ulang: dua HP mengisi satu draft berselang
 *      beberapa detik, dan KEDUANYA tersimpan.
 *   §2 Baris yang tidak disebut tidak disentuh — termasuk saat HP sebelah baru
 *      saja mengubah jumlahnya.
 *   §3 Menghapus harus disebut eksplisit, dan hanya menghapus yang disebut.
 *   §4 Catatan: `null` = jangan sentuh, bukan kosongkan.
 *   §5 Satu produk tetap satu baris walau dua HP menyimpan bersamaan.
 *   §6 Penjaga status & wewenang tetap berdiri.
 *   §7 Jejak per-baris: siapa menyentuh baris mana.
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
const semua = async (sql, params) => (await q(sql, params)).rows;
const galat = async (sql, params) => {
  try {
    await q(sql, params);
    return null;
  } catch (e) {
    return String(e.message ?? e);
  }
};

await db.exec(`
  create role authenticated;
  create schema if not exists auth;
  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

  create table business_units(id uuid primary key default gen_random_uuid(), name text);
  create table outlets(id uuid primary key default gen_random_uuid(), business_unit_id uuid, name text);
  create table user_profiles(id uuid primary key, full_name text);
  create table membership_scopes(id uuid primary key default gen_random_uuid(),
    user_id uuid, business_unit_id uuid, outlet_id uuid, role text);
  create table products(id uuid primary key default gen_random_uuid(), name text, base_unit text);
  create table stock_orders(id uuid primary key default gen_random_uuid(), code text, business_unit_id uuid,
    from_outlet_id uuid, to_outlet_id uuid, status text default 'draft', notes text,
    created_by uuid, created_at timestamptz default now(), edited_by uuid, edited_at timestamptz);
  create table stock_order_items(id uuid primary key default gen_random_uuid(),
    order_id uuid references stock_orders(id) on delete cascade, product_id uuid, qty numeric);

  -- Indeks unik dari 0129. Klausa "on conflict" di 0145 bergantung padanya.
  -- (Tanpa tanda kutip balik: berkas ini sendiri sebuah template literal, dan
  --  satu tanda kutip balik di dalamnya mengakhirinya di tengah jalan.)
  create unique index stock_order_items_produk_uk on stock_order_items(order_id, product_id);

  create or replace function has_outlet_scope(p_uid uuid, p_outlet uuid) returns boolean
    language sql security definer stable as $$
      select exists(select 1 from membership_scopes ms join outlets o on o.id = p_outlet
        where ms.user_id = p_uid and (ms.role = 'super_admin'
          or (ms.business_unit_id = o.business_unit_id and ms.role = 'bu_admin')
          or ms.outlet_id = p_outlet)) $$;
`);

const jalankan = async (b) =>
  db.exec(fs.readFileSync(path.join(AKAR, 'supabase/migrations', b), 'utf8').replace(/notify pgrst[^;]*;/g, ''));

await jalankan('0145_draft_order_digabung.sql');
console.log('  0145 terpasang.');
await jalankan('0145_draft_order_digabung.sql');
console.log('  dijalankan ulang: aman.');

// =====================================================================
// DATA
// =====================================================================
const BU = (await satu(`insert into business_units(name) values('Cafe') returning id`)).id;
const OUT = (await satu(`insert into outlets(business_unit_id,name) values($1,'AB Sentul') returning id`, [BU])).id;
const CK = (await satu(`insert into outlets(business_unit_id,name) values($1,'Central Kitchen') returning id`, [BU])).id;
const LUAR = (await satu(`insert into outlets(business_unit_id,name) values($1,'Outlet Lain') returning id`, [BU])).id;

const BAR = '11111111-1111-1111-1111-111111111111';
const KITCHEN = '22222222-2222-2222-2222-222222222222';
const ORANG_LUAR = '33333333-3333-3333-3333-333333333333';
await q(`insert into user_profiles(id,full_name) values($1,'Bar'),($2,'Kitchen'),($3,'Orang Luar')`, [BAR, KITCHEN, ORANG_LUAR]);
await q(
  `insert into membership_scopes(user_id,business_unit_id,outlet_id,role)
   values($1,$4,$5,'staff'),($2,$4,$5,'staff'),($3,$4,$6,'staff')`,
  [BAR, KITCHEN, ORANG_LUAR, BU, OUT, LUAR]
);

const SIRUP = (await satu(`insert into products(name,base_unit) values('Sirup Vanila','ml') returning id`)).id;
const DAGING = (await satu(`insert into products(name,base_unit) values('Daging Sapi','gr') returning id`)).id;
const GULA = (await satu(`insert into products(name,base_unit) values('Gula Pasir','gr') returning id`)).id;

const buatDraft = async () =>
  (
    await satu(
      `insert into stock_orders(code,business_unit_id,from_outlet_id,to_outlet_id,status,created_by)
       values('OR-1',$1,$2,$3,'draft',$4) returning id`,
      [BU, OUT, CK, BAR]
    )
  ).id;

const jadi = (uid) => q(`select set_config('request.jwt.claim.sub',$1,false)`, [uid]);
const isi = async (ord) =>
  (await semua(
    `select p.name, i.qty::float8 as qty from stock_order_items i join products p on p.id = i.product_id
      where i.order_id = $1 order by p.name`,
    [ord]
  )).map((r) => `${r.name} ${r.qty}`);

const simpan = (ord, ubah, hapus = [], notes = null) =>
  satu(`select ubah_draft_order($1,$2::jsonb,$3::uuid[],$4) as r`, [ord, JSON.stringify(ubah), hapus, notes]);

// =====================================================================
// §1 SKENARIO ASLINYA
// =====================================================================
const A = await buatDraft();

// Kedua HP membuka draft KOSONG pada saat yang sama.
const dilihatBar = await isi(A);
const dilihatKitchen = await isi(A);
cek('§1 kedua HP membuka draft yang sama-sama kosong', [dilihatBar, dilihatKitchen], [[], []]);

// 10:00:03 — Bar menambah sirup, lalu simpan.
await jadi(BAR);
await simpan(A, [{ product_id: SIRUP, qty: 2000 }]);

// 10:00:09 — Kitchen, yang layarnya masih memegang daftar KOSONG dari tadi,
// menambah daging lalu simpan. Selisih dari daftar kosong = "tambahkan daging".
await jadi(KITCHEN);
await simpan(A, [{ product_id: DAGING, qty: 5000 }]);

cek('§1 INTI: keduanya tersimpan', await isi(A), ['Daging Sapi 5000', 'Sirup Vanila 2000']);

// =====================================================================
// §2 Baris yang tidak disebut tidak disentuh
// =====================================================================
// Bar menaikkan sirup 2000 -> 3000.
await jadi(BAR);
await simpan(A, [{ product_id: SIRUP, qty: 3000 }]);
cek('§2 Bar menaikkan sirup jadi 3000', await isi(A), ['Daging Sapi 5000', 'Sirup Vanila 3000']);

// Kitchen menambah gula. Layarnya masih memegang Sirup 2000 yang TIDAK ia
// sentuh — dan karena tidak disentuh, sirupnya tidak ikut dikirim.
await jadi(KITCHEN);
await simpan(A, [{ product_id: GULA, qty: 500 }]);
cek(
  '§2 INTI: sirup 3000 milik Bar TIDAK dikembalikan ke 2000',
  await isi(A),
  ['Daging Sapi 5000', 'Gula Pasir 500', 'Sirup Vanila 3000']
);

// =====================================================================
// §3 Menghapus disebut eksplisit
// =====================================================================
await jadi(KITCHEN);
const hasilHapus = (await simpan(A, [], [GULA])).r;
cek('§3 hanya yang disebut yang terhapus', await isi(A), ['Daging Sapi 5000', 'Sirup Vanila 3000']);
cek('§3 ringkasannya menyebut jumlah yang dihapus', hasilHapus.dihapus, 1);

// Daftar hapus KOSONG tidak boleh menghapus apa pun. Ini yang membedakan
// "tidak menghapus" dari "menghapus semuanya".
await simpan(A, [], []);
cek('§3 daftar hapus kosong tidak menghapus apa pun', await isi(A), ['Daging Sapi 5000', 'Sirup Vanila 3000']);
await simpan(A, [], null);
cek('§3 daftar hapus null juga tidak menghapus apa pun', await isi(A), ['Daging Sapi 5000', 'Sirup Vanila 3000']);

// Produk yang memang tidak ada di draft: tidak melempar, tidak menghitung.
cek('§3 menghapus produk yang tidak ada = 0', (await simpan(A, [], [GULA])).r.dihapus, 0);

// =====================================================================
// §4 Catatan: null = jangan sentuh
// =====================================================================
await jadi(BAR);
await simpan(A, [], [], 'tolong kirim pagi');
cek('§4 catatan tersimpan', (await satu(`select notes from stock_orders where id=$1`, [A])).notes, 'tolong kirim pagi');

await jadi(KITCHEN);
await simpan(A, [{ product_id: GULA, qty: 250 }]);
cek(
  '§4 INTI: HP yang tidak menyentuh catatan tidak menghapusnya',
  (await satu(`select notes from stock_orders where id=$1`, [A])).notes,
  'tolong kirim pagi'
);

await simpan(A, [], [], 'ganti: kirim siang');
cek('§4 catatan bisa diganti kalau memang dikirim', (await satu(`select notes from stock_orders where id=$1`, [A])).notes, 'ganti: kirim siang');

// =====================================================================
// §5 Satu produk tetap satu baris
// =====================================================================
const B = await buatDraft2();
async function buatDraft2() {
  return (
    await satu(
      `insert into stock_orders(code,business_unit_id,from_outlet_id,to_outlet_id,status,created_by)
       values('OR-2',$1,$2,$3,'draft',$4) returning id`,
      [BU, OUT, CK, BAR]
    )
  ).id;
}
await jadi(BAR);
await simpan(B, [{ product_id: SIRUP, qty: 100 }]);
await jadi(KITCHEN);
await simpan(B, [{ product_id: SIRUP, qty: 400 }]);
cek('§5 dua HP menyentuh produk yang sama -> tetap SATU baris', await isi(B), ['Sirup Vanila 400']);
cek(
  '§5 dan tidak ada baris kembar di database',
  Number((await satu(`select count(*)::int as n from stock_order_items where order_id=$1 and product_id=$2`, [B, SIRUP])).n),
  1
);

// Qty nol / negatif dilewati, bukan disimpan sebagai baris kosong.
await simpan(B, [{ product_id: DAGING, qty: 0 }, { product_id: GULA, qty: -5 }]);
cek('§5 qty nol & negatif tidak jadi baris', await isi(B), ['Sirup Vanila 400']);

// =====================================================================
// §6 Penjaga status & wewenang
// =====================================================================
await jadi(ORANG_LUAR);
benar(
  '§6 staff outlet lain ditolak',
  /bukan|Hanya staff outlet asal/i.test((await galat(`select ubah_draft_order($1,'[]'::jsonb,'{}'::uuid[],null)`, [B])) ?? '')
);

await jadi(BAR);
await q(`update stock_orders set status='open' where id=$1`, [B]);
benar(
  '§6 order yang sudah DIKIRIM ditolak, dengan arahan membatalkan',
  /sudah dikirim ke CK[\s\S]*batalkan/i.test((await galat(`select ubah_draft_order($1,'[]'::jsonb,'{}'::uuid[],null)`, [B])) ?? '')
);
await q(`update stock_orders set status='fulfilled' where id=$1`, [B]);
benar(
  '§6 order yang sudah diproses ditolak',
  /sudah diproses/i.test((await galat(`select ubah_draft_order($1,'[]'::jsonb,'{}'::uuid[],null)`, [B])) ?? '')
);
benar(
  '§6 order yang tidak ada ditolak',
  /tidak ditemukan/i.test(
    (await galat(`select ubah_draft_order('00000000-0000-0000-0000-000000000000'::uuid,'[]'::jsonb,'{}'::uuid[],null)`)) ?? ''
  )
);

// =====================================================================
// §7 Jejak per-baris
// =====================================================================
// `stock_orders.edited_by` hanya mencatat penyimpan TERAKHIR — itulah yang
// membuat kejadian aslinya sulit ditelusuri. Jejak per baris menjawab
// "siapa yang menaruh barang ini di sini".
const jejak = await semua(
  `select p.name, u.full_name from stock_order_items i
     join products p on p.id = i.product_id
     left join user_profiles u on u.id = i.diubah_by
    where i.order_id = $1 order by p.name`,
  [A]
);
const petaJejak = Object.fromEntries(jejak.map((r) => [r.name, r.full_name]));
cek('§7 sirup tercatat disentuh Bar', petaJejak['Sirup Vanila'], 'Bar');
cek('§7 daging tercatat disentuh Kitchen', petaJejak['Daging Sapi'], 'Kitchen');
benar(
  '§7 waktunya ikut tercatat',
  (await satu(`select count(*)::int as n from stock_order_items where order_id=$1 and diubah_at is null`, [A])).n === 0
);

console.log('');
if (gagal === 0) console.log('MIGRATION 0145: semua pemeriksaan lolos. ✅');
else console.error(`${gagal} pemeriksaan GAGAL.`);
await db.close();
process.exit(gagal === 0 ? 0 : 1);
