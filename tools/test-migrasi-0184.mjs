/**
 * MIGRATION 0184 — MENGUBAH JUMLAH DI DRAFT ORDER.
 *
 * ============ BUG-NYA DIBUKTIKAN DULU, BARU DIPERBAIKI ============
 *
 * §1 menjalankan `ubah_draft_order` versi 0145 di atas trigger 0129 dan
 * menuntutnya GAGAL. Tanpa itu, seluruh tes di bawah bisa hijau untuk
 * perbaikan yang tidak memperbaiki apa pun — dan "sudah saya tes" akan
 * berarti lebih sedikit daripada kelihatannya.
 *
 *   §1 Sebelum 0184: mengubah jumlah baris yang sudah ada DITOLAK.
 *   §2 Sesudah 0184: jumlahnya berubah, barisnya tetap satu.
 *   §3 Menambah barang BARU tetap jalan.
 *   §4 Baris kembar sungguhan TETAP ditolak — triggernya tidak dilonggarkan.
 *   §5 Hapus + ubah dalam satu panggilan.
 *   §6 Penjagaan lain (status, wewenang, catatan) tidak ikut hilang.
 *   §7 Hitungannya jujur: diubah / dihapus / total.
 *   §8 Dijalankan dua kali tetap aman.
 */
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AKAR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let gagal = 0;
let n = 0;
const cek = (nama, dapat, harap) => {
  n++;
  if (JSON.stringify(dapat) !== JSON.stringify(harap)) {
    gagal++;
    console.error(`❌ ${nama}\n   dapat : ${JSON.stringify(dapat)}\n   harap : ${JSON.stringify(harap)}`);
  }
};
const benar = (nama, syarat, ket = '') => {
  n++;
  if (!syarat) {
    gagal++;
    console.error(`❌ ${nama}${ket ? ' — ' + ket : ''}`);
  }
};

const db = new PGlite();
const q = (sql, p) => db.query(sql, p);
const satu = async (sql, p) => (await q(sql, p)).rows[0];
const jadi = (uid) => q(`select set_config('request.jwt.claim.sub', $1, false)`, [uid ?? '']);
const galat = async (sql, p) => {
  try {
    await q(sql, p);
    return null;
  } catch (e) {
    return String(e.message ?? e);
  }
};

await db.exec(`
  create role authenticated;
  create schema if not exists auth;
  create or replace function auth.uid() returns uuid language sql stable as $x$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $x$;

  create table business_units (id uuid primary key default gen_random_uuid(), name text);
  create table outlets (id uuid primary key default gen_random_uuid(), business_unit_id uuid, name text);
  create table user_profiles (id uuid primary key, full_name text);
  create table membership_scopes (id uuid primary key default gen_random_uuid(),
    user_id uuid, business_unit_id uuid, outlet_id uuid, role text);
  create table products (id uuid primary key default gen_random_uuid(), business_unit_id uuid, name text, base_unit text);
  create table stock_orders (id uuid primary key default gen_random_uuid(),
    code text, from_outlet_id uuid, to_outlet_id uuid, status text default 'draft',
    notes text, created_by uuid, edited_by uuid, edited_at timestamptz,
    created_at timestamptz default now());
  create table stock_order_items (id uuid primary key default gen_random_uuid(),
    order_id uuid references stock_orders(id) on delete cascade, product_id uuid, qty numeric);
  -- Tabel lain yang ikut disentuh 0129; isinya tidak diuji di sini.
  create table dispatch_items (id uuid primary key default gen_random_uuid(),
    dispatch_id uuid, product_id uuid, sent_qty numeric, received_qty numeric,
    dicek_qty numeric, keterangan text, ordered_qty numeric, revisi boolean default false);
  create table goods_receipt_items (id uuid primary key default gen_random_uuid(),
    receipt_id uuid, product_id uuid, qty numeric, unit_cost numeric, line_total numeric, notes text);
  create table stock_movements (id uuid primary key default gen_random_uuid(),
    receipt_id uuid, product_id uuid, qty_delta numeric, unit_cost numeric);

  create or replace function has_outlet_scope(p_uid uuid, p_outlet uuid) returns boolean
    language sql security definer stable as $x$
      select exists (select 1 from membership_scopes ms
        where ms.user_id = p_uid
          and (ms.role = 'super_admin'
               or ms.outlet_id = p_outlet
               or ms.business_unit_id = (select business_unit_id from outlets where id = p_outlet))) $x$;
`);

const jalankan = async (b) =>
  db.exec(fs.readFileSync(path.join(AKAR, 'supabase/migrations', b), 'utf8').replace(/notify pgrst[^;]*;/g, ''));

// Trigger 0129 APA ADANYA — inti bug-nya ada pada urutan trigger vs
// `on conflict`, jadi tiruan yang disederhanakan tidak membuktikan apa pun.
await jalankan('0129_satu_bahan_satu_baris.sql');
await jalankan('0145_draft_order_digabung.sql');

const BU = (await satu(`insert into business_units (name) values ('Cafe') returning id`)).id;
const OUT = (await satu(`insert into outlets (business_unit_id, name) values ($1,'AB Sentul') returning id`, [BU])).id;
const CK = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Central Kitchen') returning id`, [BU])).id;
const STAFF = '11111111-1111-1111-1111-111111111111';
const ORANG_LUAR = '22222222-2222-2222-2222-222222222222';
await q(`insert into user_profiles (id, full_name) values ($1,'Elsa'),($2,'Orang Luar')`, [STAFF, ORANG_LUAR]);
await q(`insert into membership_scopes (user_id, business_unit_id, outlet_id, role) values ($1,$2,$3,'staff')`, [STAFF, BU, OUT]);

const JERUK = (await satu(`insert into products (business_unit_id, name, base_unit) values ($1,'Jeruk Nipis','gr') returning id`, [BU])).id;
const GULA = (await satu(`insert into products (business_unit_id, name, base_unit) values ($1,'Gula','gr') returning id`, [BU])).id;
const SUSU = (await satu(`insert into products (business_unit_id, name, base_unit) values ($1,'Susu','ml') returning id`, [BU])).id;

const buatDraft = async () => {
  const o = (await satu(
    `insert into stock_orders (code, from_outlet_id, to_outlet_id, status, created_by)
     values ('ORD-TEST-' || substr(gen_random_uuid()::text,1,4), $1, $2, 'draft', $3) returning id`,
    [OUT, CK, STAFF]
  )).id;
  await q(`insert into stock_order_items (order_id, product_id, qty) values ($1,$2,250)`, [o, JERUK]);
  return o;
};
const qtyDi = async (order, produk) =>
  Number((await satu(`select coalesce(sum(qty),0) s from stock_order_items where order_id=$1 and product_id=$2`, [order, produk])).s);
const barisDi = async (order) => Number((await satu(`select count(*)::int n from stock_order_items where order_id=$1`, [order])).n);
const ubah = (order, isi, hapus = []) =>
  galat(`select ubah_draft_order($1,$2::jsonb,$3::uuid[],null)`, [order, JSON.stringify(isi), hapus]);

await jadi(STAFF);

// ===============================================================
console.log('§1 Sebelum 0184: mengubah jumlah DITOLAK');
// ===============================================================
const ORDER_LAMA = await buatDraft();
const bugnya = await ubah(ORDER_LAMA, [{ product_id: JERUK, qty: 750 }]);
benar(
  '§1 versi 0145 memang gagal saat jumlahnya diubah',
  bugnya !== null,
  'justru berhasil — berarti bug-nya tidak tereproduksi di sini, dan §2 tidak membuktikan apa pun'
);
benar('§1 dan kalimatnya yang membingungkan itu', /jangan tambah baris baru/.test(bugnya ?? ''), bugnya);
cek('§1 jumlahnya karena itu tidak berubah', await qtyDi(ORDER_LAMA, JERUK), 250);

await jalankan('0184_ubah_draft_order_tanpa_upsert.sql');

// ===============================================================
console.log('§2 Sesudah 0184: jumlahnya berubah, barisnya tetap satu');
// ===============================================================
cek('§2 tidak ada galat lagi', await ubah(ORDER_LAMA, [{ product_id: JERUK, qty: 750 }]), null);
cek('§2 jumlahnya jadi 750', await qtyDi(ORDER_LAMA, JERUK), 750);
cek('§2 barisnya tetap satu', await barisDi(ORDER_LAMA), 1);
// Diubah dua kali berturut-turut: yang terakhir yang berlaku, bukan ditumpuk.
await ubah(ORDER_LAMA, [{ product_id: JERUK, qty: 300 }]);
cek('§2 perubahan kedua menggantikan, bukan menjumlah', await qtyDi(ORDER_LAMA, JERUK), 300);

// ===============================================================
console.log('§3 Menambah barang BARU tetap jalan');
// ===============================================================
cek('§3 barang baru diterima', await ubah(ORDER_LAMA, [{ product_id: GULA, qty: 500 }]), null);
cek('§3 jumlahnya benar', await qtyDi(ORDER_LAMA, GULA), 500);
cek('§3 dan yang lama tidak tersentuh', await qtyDi(ORDER_LAMA, JERUK), 300);
// Satu panggilan berisi keduanya: yang sudah ada DAN yang baru.
cek(
  '§3 ubah + tambah dalam satu simpanan',
  await ubah(ORDER_LAMA, [{ product_id: JERUK, qty: 100 }, { product_id: SUSU, qty: 1000 }]),
  null
);
cek('§3 yang lama berubah', await qtyDi(ORDER_LAMA, JERUK), 100);
cek('§3 yang baru masuk', await qtyDi(ORDER_LAMA, SUSU), 1000);
cek('§3 totalnya tiga baris', await barisDi(ORDER_LAMA), 3);

// ===============================================================
console.log('§4 Baris kembar SUNGGUHAN tetap ditolak');
// ===============================================================
//
// Triggernya tidak boleh ikut dilonggarkan: ia yang menahan baris kembar dari
// enam penulis berbeda (0129). Kalau ia mati, CK menyiapkan barang dua kali.
const kembar = await galat(
  `insert into stock_order_items (order_id, product_id, qty) values ($1,$2,50)`,
  [ORDER_LAMA, JERUK]
);
benar('§4 insert langsung yang kembar tetap ditolak', kembar !== null, 'triggernya ikut mati');
benar('§4 dengan pesan yang menyebut namanya', /Jeruk Nipis/.test(kembar ?? ''), kembar);
cek('§4 dan barisnya tetap satu', await barisDi(ORDER_LAMA), 3);
benar(
  '§4 trigger untuk surat jalan & nota juga masih ada',
  (await satu(`select count(*)::int n from pg_trigger where tgname in ('trg_bahan_kembar_kiriman','trg_bahan_kembar_nota')`)).n === 2
);

// ===============================================================
console.log('§5 Hapus + ubah dalam satu panggilan');
// ===============================================================
cek('§5 hapus satu, ubah satu', await ubah(ORDER_LAMA, [{ product_id: GULA, qty: 900 }], [SUSU]), null);
cek('§5 yang dihapus hilang', await qtyDi(ORDER_LAMA, SUSU), 0);
cek('§5 yang diubah berubah', await qtyDi(ORDER_LAMA, GULA), 900);
// Dihapus lalu ditambahkan lagi dalam satu simpanan: hapus dikerjakan DULU,
// jadi yang dimaksudkan ada tetap ada.
cek('§5 hapus lalu isi lagi produk yang sama', await ubah(ORDER_LAMA, [{ product_id: GULA, qty: 400 }], [GULA]), null);
cek('§5 hasilnya yang baru, bukan hilang', await qtyDi(ORDER_LAMA, GULA), 400);

// ===============================================================
console.log('§6 Penjagaan lain tidak ikut hilang');
// ===============================================================
await jadi(ORANG_LUAR);
benar('§6 orang di luar outlet ditolak', /outlet asal/.test(await ubah(ORDER_LAMA, [{ product_id: GULA, qty: 1 }]) ?? ''));
await jadi(null);
benar('§6 tanpa login ditolak', /login/i.test(await ubah(ORDER_LAMA, [{ product_id: GULA, qty: 1 }]) ?? ''));
await jadi(STAFF);
await q(`update stock_orders set status='open' where id=$1`, [ORDER_LAMA]);
benar('§6 order yang sudah dikirim ditolak', /sudah dikirim ke CK/.test(await ubah(ORDER_LAMA, [{ product_id: GULA, qty: 1 }]) ?? ''));
await q(`update stock_orders set status='fulfilled' where id=$1`, [ORDER_LAMA]);
benar('§6 order yang sudah diproses ditolak', /sudah diproses/.test(await ubah(ORDER_LAMA, [{ product_id: GULA, qty: 1 }]) ?? ''));
await q(`update stock_orders set status='draft', notes='catatan lama' where id=$1`, [ORDER_LAMA]);
await ubah(ORDER_LAMA, [{ product_id: GULA, qty: 2 }]);
// `null` berarti "tidak menyentuh catatan" — HP yang cuma menambah barang
// tidak boleh menghapus catatan yang baru ditulis orang lain.
cek('§6 catatan tidak ikut terhapus', (await satu(`select notes from stock_orders where id=$1`, [ORDER_LAMA])).notes, 'catatan lama');
cek('§6 jejak penyuntingnya terisi', (await satu(`select edited_by from stock_orders where id=$1`, [ORDER_LAMA])).edited_by, STAFF);
// Jumlah nol / negatif dilewati, bukan disimpan.
await ubah(ORDER_LAMA, [{ product_id: GULA, qty: 0 }]);
cek('§6 jumlah nol dilewati, bukan menimpa', await qtyDi(ORDER_LAMA, GULA), 2);

// ===============================================================
console.log('§7 Hitungannya jujur');
// ===============================================================
const ORDER2 = await buatDraft();
await q(`insert into stock_order_items (order_id, product_id, qty) values ($1,$2,10)`, [ORDER2, GULA]);
const hasil = (await satu(`select ubah_draft_order($1,$2::jsonb,$3::uuid[],null) as h`, [
  ORDER2,
  JSON.stringify([{ product_id: JERUK, qty: 900 }, { product_id: SUSU, qty: 5 }]),
  [GULA]
])).h;
cek('§7 diubah', hasil.diubah, 2);
cek('§7 dihapus', hasil.dihapus, 1);
cek('§7 total baris sesudahnya', hasil.total, 2);

// ===============================================================
console.log('§8 Dijalankan dua kali');
// ===============================================================
await jalankan('0184_ubah_draft_order_tanpa_upsert.sql');
cek('§8 masih bekerja', await ubah(ORDER2, [{ product_id: JERUK, qty: 123 }]), null);
cek('§8 dan angkanya benar', await qtyDi(ORDER2, JERUK), 123);

console.log(`\n${gagal === 0 ? '✅' : '❌'} test-migrasi-0184: ${n - gagal}/${n} lulus`);
process.exit(gagal === 0 ? 0 : 1);
