/**
 * MIGRATION 0148 DI POSTGRES SUNGGUHAN (PGlite).
 *
 * ============ YANG DIUJI ============
 *
 *   §1 Kolom `sku` & indeks uniknya terpasang, dan uniknya PARSIAL — ratusan
 *      produk yang belum berkode bukan ratusan bentrokan.
 *   §2 Uniknya per BU, dan mengabaikan huruf besar-kecil & spasi tepi.
 *   §3 `ubah_sku_produk` mengisi, melewati yang kosong, dan TIDAK menghapus.
 *   §4 Bentrokan dilaporkan sebagai daftar nama — bukan 23505 yang
 *      membatalkan 646 baris lain tanpa penjelasan.
 *   §5 Bukan admin ditolak; produk BU lain tidak tersentuh.
 *   §6 Dijalankan dua kali tetap aman, termasuk di atas data yang sudah ada.
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
  } else console.log(`  ✔ ${nama}`);
};
const benar = (nama, syarat, ket = '') => {
  if (!syarat) {
    gagal++;
    console.error(`❌ ${nama}${ket ? ' — ' + ket : ''}`);
  } else console.log(`  ✔ ${nama}`);
};

const db = new PGlite();
const q = (sql, params) => db.query(sql, params);
const satu = async (sql, params) => (await q(sql, params)).rows[0];
const galat = async (sql, params) => {
  try {
    await q(sql, params);
    return null;
  } catch (e) {
    return String(e.message ?? e);
  }
};
const jadi = async (uid) => q(`select set_config('request.jwt.claim.sub', $1, false)`, [uid ?? '']);

await db.exec(`
  create role authenticated;
  create schema if not exists auth;
  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
  $$;
  create table membership_scopes (
    id uuid primary key default gen_random_uuid(),
    user_id uuid, business_unit_id uuid, outlet_id uuid, role text);
  create table business_units (id uuid primary key default gen_random_uuid(), name text);

  -- products TANPA kolom sku. Kalau 0148 tidak menambahkannya, §1 gagal —
  -- bukan lolos karena kolomnya kebetulan sudah ada.
  create table products (
    id uuid primary key default gen_random_uuid(),
    business_unit_id uuid not null references business_units(id) on delete cascade,
    name text not null, product_type text, base_unit text);

  create or replace function is_bu_admin(p_uid uuid, p_bu uuid) returns boolean
    language sql security definer stable as $$
      select exists (select 1 from membership_scopes ms
        where ms.user_id = p_uid
          and (ms.role = 'super_admin' or (ms.role = 'bu_admin' and ms.business_unit_id = p_bu))) $$;
`);

const BU = (await satu(`insert into business_units (name) values ('Cafe') returning id`)).id;
const BU2 = (await satu(`insert into business_units (name) values ('Lain') returning id`)).id;
const ADMIN = '11111111-1111-1111-1111-111111111111';
const STAFF = '22222222-2222-2222-2222-222222222222';
await q(`insert into membership_scopes (user_id, business_unit_id, role) values ($1,$2,'bu_admin'), ($3,$2,'staff')`, [
  ADMIN,
  BU,
  STAFF
]);

const buat = async (nama, bu = BU) =>
  (await satu(`insert into products (business_unit_id, name, product_type, base_unit) values ($1,$2,'raw','gr') returning id`, [bu, nama])).id;

const GULA = await buat('Gula Pasir');
const BERAS = await buat('Beras Premium');
const TELUR = await buat('Telur Ayam');
const LAIN = await buat('Gula Pasir', BU2);

const jalankan = async (b) =>
  db.exec(fs.readFileSync(path.join(AKAR, 'supabase/migrations', b), 'utf8').replace(/notify pgrst[^;]*;/g, ''));

await jalankan('0148_sku_produk.sql');
console.log('  0148 terpasang.');

console.log('\n§1 Kolom & indeksnya');

benar(
  '§1 kolom sku terpasang',
  (await satu(`select 1 from information_schema.columns where table_name='products' and column_name='sku'`)) !== undefined
);
benar(
  '§1 indeks unik sku ada',
  (await satu(`select 1 from pg_indexes where indexname='idx_produk_sku_unik'`)) !== undefined
);

// UNIKNYA PARSIAL. Tanpa `where sku is not null`, produk KEDUA yang belum
// berkode akan ditolak — dan hampir seluruh Master Produk jadi tidak bisa
// dibuat, dengan pesan yang menyebut nama indeks.
cek(
  '§1 INTI: dua produk yang sama-sama belum berkode tetap boleh',
  await galat(`insert into products (business_unit_id, name, product_type) values ($1,'Kosong A','raw'), ($1,'Kosong B','raw')`, [BU]),
  null
);

console.log('\n§2 Uniknya, dan batasnya');

await q(`update products set sku = 'BCK-001' where id = $1`, [GULA]);
benar(
  '§2 kode yang sama di BU yang sama DITOLAK',
  (await galat(`update products set sku = 'BCK-001' where id = $1`, [BERAS])) !== null
);
// Manusia yang menyalin dari Excel membawa spasi & huruf besar-kecil apa
// adanya. Membiarkan keduanya masuk berarti dua produk berkode sama.
benar(
  '§2 beda huruf besar-kecil & spasi tepi tetap dihitung kembar',
  (await galat(`update products set sku = '  bck-001 ' where id = $1`, [BERAS])) !== null
);
// Dua BU adalah dua perusahaan dengan daftar produk ESB yang berbeda.
cek('§2 kode yang sama di BU LAIN boleh', await galat(`update products set sku = 'BCK-001' where id = $1`, [LAIN]), null);

console.log('\n§3 ubah_sku_produk');

const panggil = async (items, bu = BU) => (await satu(`select ubah_sku_produk($1, $2::jsonb) as r`, [bu, JSON.stringify(items)])).r;

await jadi(ADMIN);
let r = await panggil([{ id: BERAS, sku: 'BCK-002' }, { id: TELUR, sku: 'BCK-003' }]);
cek('§3 dua kode tersimpan', r.diubah, 2);
cek('§3 nilainya benar', (await satu(`select sku from products where id = $1`, [BERAS])).sku, 'BCK-002');

// INTI: sel kosong BUKAN perintah menghapus.
r = await panggil([{ id: BERAS, sku: '' }, { id: TELUR, sku: '   ' }]);
cek('§3 baris berkode kosong: 0 diubah', r.diubah, 0);
cek(
  '§3 INTI: kode yang sudah ada TIDAK terhapus oleh sel kosong',
  (await satu(`select sku from products where id = $1`, [BERAS])).sku,
  'BCK-002'
);

// Yang nilainya sudah sama tidak ikut disentuh — `updated_at` yang berubah
// untuk 600 produk yang tidak berubah apa-apa membuat riwayatnya tak terbaca.
r = await panggil([{ id: BERAS, sku: 'BCK-002' }]);
cek('§3 nilai yang sudah sama: 0 diubah', r.diubah, 0);
// ...DAN TIDAK DILAPORKAN SEBAGAI BENTROK.
//
// Tanpa `p.id <> r.id` di pencarian pemiliknya, produk dihitung bertabrakan
// dengan DIRINYA SENDIRI. Angka `diubah` tetap 0 — jadi pemeriksaan di atas
// tetap hijau — tapi tiap unggahan ulang melaporkan ratusan "bentrok" palsu,
// dan tidak ada satu pun kode yang bisa disimpan ulang.
cek('§3 INTI: nilai yang sama tidak dilaporkan bentrok dengan dirinya sendiri', r.bentrok.length, 0);
cek('§3 daftar kosong: 0, tanpa melempar', (await panggil([])).diubah, 0);
cek('§3 null: 0, tanpa melempar', (await satu(`select ubah_sku_produk($1, null) as r`, [BU])).r.diubah, 0);

// Spasi tepi dirapikan sebelum disimpan.
await panggil([{ id: BERAS, sku: '  BCK-009  ' }]);
cek('§3 spasi tepi dirapikan sebelum disimpan', (await satu(`select sku from products where id = $1`, [BERAS])).sku, 'BCK-009');

console.log('\n§4 Bentrokan dilaporkan, bukan melempar');

// Kalau ini lepas, indeks uniknya melempar 23505 — pesannya menyebut nama
// indeks, bukan produk mana yang bertabrakan, dan karena seluruhnya satu
// transaksi, SATU bentrokan membatalkan seluruh unggahan tanpa penjelasan.
r = await panggil([{ id: TELUR, sku: 'BCK-001' }, { id: BERAS, sku: 'BCK-077' }]);
cek('§4 INTI: yang bentrok dilewati, yang sah tetap tersimpan', r.diubah, 1);
cek('§4 bentrokan dilaporkan satu baris', r.bentrok.length, 1);
benar('§4 laporannya menyebut siapa yang sudah memakainya', /Gula Pasir/.test(r.bentrok[0]), r.bentrok[0]);
cek('§4 dan kode yang bentrok memang tidak tertulis', (await satu(`select sku from products where id = $1`, [TELUR])).sku, 'BCK-003');

// Produk milik BU lain, atau yang dihapus sejak templatenya diunduh.
r = await panggil([{ id: LAIN, sku: 'X-1' }]);
cek('§4 produk BU lain dilaporkan sebagai asing', r.asing.length, 1);
cek('§4 dan tidak tersentuh', (await satu(`select sku from products where id = $1`, [LAIN])).sku, 'BCK-001');

console.log('\n§5 Wewenang');

await jadi(STAFF);
benar(
  '§5 staff DITOLAK, bukan diam-diam 0',
  (await galat(`select ubah_sku_produk($1, $2::jsonb)`, [BU, JSON.stringify([{ id: BERAS, sku: 'Z-1' }])])) !== null,
  'diam-diam 0 membuat staff mengira pekerjaannya tersimpan'
);
await jadi(null);
benar(
  '§5 tanpa login ditolak',
  (await galat(`select ubah_sku_produk($1, $2::jsonb)`, [BU, JSON.stringify([{ id: BERAS, sku: 'Z-1' }])])) !== null
);
await jadi(ADMIN);
benar(
  '§5 admin BU ini tidak bisa menyentuh BU lain',
  (await galat(`select ubah_sku_produk($1, $2::jsonb)`, [BU2, JSON.stringify([{ id: LAIN, sku: 'Z-1' }])])) !== null
);

console.log('\n§6 Dijalankan ulang');

// Dijalankan ulang DI ATAS DATA YANG SUDAH BERISI — bukan di atas tabel
// kosong. Indeks unik yang dibuat ulang di atas data yang sudah bentrok akan
// gagal, dan gagalnya di tengah migration.
await jalankan('0148_sku_produk.sql');
cek(
  '§6 aman dijalankan dua kali — kodenya tetap',
  (await satu(`select count(*)::int as n from products where sku is not null`)).n,
  4
);

// String kosong yang terlanjur masuk sebelum 0148 dirapikan jadi null: `''`
// akan bentrok dengan `''` lain dan menolak produk kedua yang belum berkode.
await q(`update products set sku = '' where id = $1`, [TELUR]);
await jalankan('0148_sku_produk.sql');
cek(
  '§6 string kosong dirapikan jadi null saat migration dijalankan lagi',
  (await satu(`select sku from products where id = $1`, [TELUR])).sku,
  null
);

console.log('');
if (gagal === 0) console.log('Semua pemeriksaan 0148 lolos. ✅');
else console.error(`${gagal} pemeriksaan 0148 GAGAL.`);
process.exit(gagal === 0 ? 0 : 1);
