/**
 * MIGRATION 0123 DI POSTGRES SUNGGUHAN (PGlite).
 *
 * ============ SALAH PAHAM YANG DIPERBAIKI ============
 *
 *   "beras, qty 5000 gr, harga 180.000, maka yang dimaksud adalah harga
 *    5000 gr itu 180.000 bukan harga per gram nya 180.000"
 *
 * Kotaknya berlabel "harga/gr" dan disimpan sebagai `unit_cost`, jadi
 * 5.000 x 180.000 = Rp900.000.000. Lima ribu kali lipat, tanpa satu pun error.
 *
 * ============ YANG DIUJI ============
 *
 *   1. `line_total` disimpan apa adanya; `unit_cost` jadi turunannya.
 *   2. Bentuk LAMA (`unit_cost`) masih diterima — PWA di HP staff belum tentu
 *      sudah memperbarui diri.
 *   3. Total nota & nominal pembayaran memakai `line_total`, bukan qty x harga.
 *   4. **Penjagaan 0118 dan 0119 selamat.** `ubah_nota_terima` ditulis ulang
 *      untuk KEEMPAT kalinya di sini, dan tiap penulisan ulang bisa
 *      menghilangkan penjagaan versi sebelumnya tanpa suara.
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

await jalankan('0084_nota_penerimaan.sql');
await jalankan('0118_biaya_rata_bahan.sql');
await jalankan('0119_ubah_nota_tanpa_menghapus.sql');
await jalankan('0120_kas_outlet_boleh_dibebani.sql');
await jalankan('0122_nota_status_bayar.sql');
await jalankan('0123_harga_beli_per_baris.sql');
console.log('  0084 -> 0118 -> 0119 -> 0120 -> 0122 -> 0123 terpasang.');
await jalankan('0123_harga_beli_per_baris.sql');
console.log('  dijalankan ulang: aman.');

const BU = (await satu(`insert into business_units (name) values ('Cafe') returning id`)).id;
const OUT = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Serpong') returning id`, [BU])).id;
const BERAS = (await satu(`insert into products (business_unit_id, name) values ($1,'Beras') returning id`, [BU])).id;
const TELUR = (await satu(`insert into products (business_unit_id, name) values ($1,'Telur') returning id`, [BU])).id;
const KEJU = (await satu(`insert into products (business_unit_id, name) values ($1,'Keju') returning id`, [BU])).id;
const STAFF = '11111111-1111-1111-1111-111111111111';
await q(`insert into user_profiles (id, full_name) values ($1,'Staff')`, [STAFF]);
await q(`insert into membership_scopes (user_id, business_unit_id, outlet_id, role) values ($1,$2,$3,'staff')`, [STAFF, BU, OUT]);
await q(`select set_config('request.jwt.claim.sub', $1, false)`, [STAFF]);
const KAS = (await satu(`insert into cash_accounts (holder_id, name, outlet_id) values ($1,'Kas Ops',$2) returning id`, [STAFF, OUT])).id;

const buat = async (items) =>
  (await satu(`select simpan_nota_terima($1,'2026-09-05','Toko Beras',null,null,null,$2::jsonb) as id`, [OUT, JSON.stringify(items)])).id;

const baris = (nota, produk) =>
  satu(`select qty, unit_cost, line_total from goods_receipt_items where receipt_id = $1 and product_id = $2`, [nota, produk]);

// =====================================================================
// §1. INTI: contoh persis dari laporannya.
// =====================================================================
const A = await buat([{ product_id: BERAS, qty: 5000, line_total: 180000 }]);
const a = await baris(A, BERAS);
cek('§1 INTI: line_total tersimpan apa adanya', Number(a.line_total), 180000);
cek('§1 unit_cost jadi TURUNANNYA, bukan angka yang diketik', Number(a.unit_cost), 36);

const ringkasA = await satu(`select total, baris_tanpa_harga from nota_ringkas where id = $1`, [A]);
cek('§1 total nota = 180.000, BUKAN 900.000.000', Number(ringkasA.total), 180000);

// HARGA YANG TIDAK HABIS DIBAGI — dan perbandingannya di SQL, bukan di JS.
//
// 180.000 / 5.000 = 36 tepat, jadi `qty * unit_cost` kebetulan sama persis
// dengan `line_total`. Untuk data seperti itu, sabotase yang mengembalikan
// rumus lama LOLOS — dan memang lolos di percobaan pertama.
//
// 175.000 / 3.000 = 58,3333… dan `3.000 x 58,3333…` BUKAN 175.000. Selisihnya
// recehan di digit ke-20; `Number()` di JavaScript membulatkannya hilang, jadi
// perbandingannya harus dikerjakan Postgres dengan `numeric` penuh.
const A2 = await buat([{ product_id: BERAS, qty: 3000, line_total: 175000 }]);
const tepat = await satu(`select (total = 175000) as sama, total::text as t from nota_ringkas where id = $1`, [A2]);
benar('§1 total nota PERSIS 175.000, bukan hasil kali yang meleset di digit belakang', tepat.sama, `dapat: ${tepat.t}`);

// Pergerakan stoknya membawa harga per satuan — itulah yang dibaca 0118.
const gerakA = await satu(`select unit_cost from stock_movements where receipt_id = $1 and product_id = $2`, [A, BERAS]);
cek('§1 stock_movements memakai harga per satuan', Number(gerakA.unit_cost), 36);

// =====================================================================
// §2. Bentuk LAMA masih diterima (PWA di HP yang belum memperbarui diri).
// =====================================================================
const B = await buat([{ product_id: TELUR, qty: 100, unit_cost: 3000 }]);
const b = await baris(B, TELUR);
cek('§2 unit_cost lama dipakai apa adanya', Number(b.unit_cost), 3000);
cek('§2 line_total diturunkan darinya', Number(b.line_total), 300000);

// Kalau KEDUANYA dikirim, `line_total` menang: ia angka yang diketik orang,
// `unit_cost` cuma turunan yang mungkin sudah dibulatkan klien.
const C = await buat([{ product_id: KEJU, qty: 10, line_total: 99000, unit_cost: 12345 }]);
const c = await baris(C, KEJU);
cek('§2 line_total menang atas unit_cost', [Number(c.line_total), Number(c.unit_cost)], [99000, 9900]);

// Tanpa harga sama sekali tetap boleh disimpan — harganya sering menyusul.
const D = await buat([{ product_id: BERAS, qty: 20 }]);
const d = await baris(D, BERAS);
cek('§2 tanpa harga: keduanya NULL, bukan 0', [d.unit_cost, d.line_total], [null, null]);
cek(
  '§2 view menghitungnya sebagai baris tanpa harga',
  Number((await satu(`select baris_tanpa_harga from nota_ringkas where id = $1`, [D])).baris_tanpa_harga),
  1
);

// =====================================================================
// §3. Pembayaran memakai line_total.
//
// Kalau `bayar_nota` masih menjumlahkan qty x unit_cost sementara layarnya
// menampilkan line_total, orang menyetujui satu angka lalu kasnya berkurang
// sebesar angka yang lain.
// =====================================================================
const E = await buat([
  { product_id: BERAS, qty: 3000, line_total: 175000 }, // 58,333.../gr — tidak bulat
  { product_id: TELUR, qty: 30, line_total: 90000 }
]);
await q(`select bayar_nota(array[$1]::uuid[], $2, '2026-09-06', null)`, [E, KAS]);
// Dibandingkan di SQL. `Number()` di JavaScript membulatkan
// -264999,99999999999999999 jadi -265000, sehingga sabotase yang mengembalikan
// rumus `qty * unit_cost` LOLOS — dan memang lolos di percobaan pertama. Tes
// yang memeriksa presisi tidak boleh membuang presisinya lebih dulu.
const entri = await satu(
  `select (amount = -265000) as tepat, amount::text as a from cash_entries where untuk_nota order by created_at desc limit 1`
);
benar('§3 kas berkurang PERSIS 265.000, tanpa recehan pembulatan', entri.tepat, `dapat: ${entri.a}`);

// =====================================================================
// §4. PENJAGAAN 0118 SELAMAT: koreksi harga sampai ke stock_movements.
//
// Ini celah yang paling mudah hilang saat fungsinya ditulis ulang: kalau HANYA
// harganya yang diubah, selisih jumlahnya 0 dan tidak ada pergerakan baru yang
// membawanya. Barisnya benar, biaya rata-ratanya memakai harga lama.
// =====================================================================
const F = await buat([{ product_id: KEJU, qty: 200, line_total: 100000 }]); // 500/gr
await q(`select ubah_nota_terima($1, null, null, null, null, null, $2::jsonb)`, [
  F,
  JSON.stringify([{ product_id: KEJU, qty: 200, line_total: 160000 }]) // 800/gr, jumlah TETAP
]);
const f = await baris(F, KEJU);
cek('§4 baris notanya ikut terkoreksi', [Number(f.line_total), Number(f.unit_cost)], [160000, 800]);
const gerakF = await q(`select unit_cost from stock_movements where receipt_id = $1 and product_id = $2 and qty_delta > 0`, [F, KEJU]);
benar(
  '§4 PENJAGAAN 0118: seluruh pergerakan masuk memakai harga BARU',
  gerakF.rows.every((r) => Number(r.unit_cost) === 800),
  `dapat: ${JSON.stringify(gerakF.rows)}`
);

// Ubah JUMLAHNYA saja: penyeimbangnya lahir, dan harganya ikut menyesuaikan.
await q(`select ubah_nota_terima($1, null, null, null, null, null, $2::jsonb)`, [
  F,
  JSON.stringify([{ product_id: KEJU, qty: 400, line_total: 160000 }]) // 400/gr
]);
const f2 = await baris(F, KEJU);
cek('§4 jumlah berubah, harga baris tetap, per satuan menyesuaikan', [Number(f2.qty), Number(f2.line_total), Number(f2.unit_cost)], [400, 160000, 400]);
const gerakF2 = await q(`select qty_delta, unit_cost from stock_movements where receipt_id = $1 and qty_delta > 0 order by created_at`, [F]);
cek('§4 penyeimbangnya lahir (200 lalu +200)', gerakF2.rows.map((r) => Number(r.qty_delta)), [200, 200]);
benar('§4 keduanya memakai harga per satuan terbaru', gerakF2.rows.every((r) => Number(r.unit_cost) === 400));

// =====================================================================
// §5. PENJAGAAN 0119 SELAMAT: NULL = jangan sentuh, untuk keempat kolom.
//
// Bug aslinya: menekan "+ Foto" menghapus nama supplier, no. invoice, dan
// catatan notanya sekaligus.
// =====================================================================
const G = (
  await satu(`select simpan_nota_terima($1,'2026-09-05','Gerobak Telur','INV-77',null,'titip di kulkas',$2::jsonb) as id`, [
    OUT,
    JSON.stringify([{ product_id: TELUR, qty: 100, line_total: 300000 }])
  ])
).id;
await q(`select ubah_nota_terima($1, null, null, null, $2, null, null)`, [G, 'foto/abc.jpg']);
const g = await satu(`select supplier, invoice_no, notes, photo_path from goods_receipts where id = $1`, [G]);
cek(
  '§5 PENJAGAAN 0119: "+ Foto" tidak menghapus supplier/invoice/catatan',
  [g.supplier, g.invoice_no, g.notes, g.photo_path],
  ['Gerobak Telur', 'INV-77', 'titip di kulkas', 'foto/abc.jpg']
);
// `p_items` NULL juga tidak boleh membatalkan barangnya.
cek('§5 barangnya tidak ikut dibatalkan', Number((await baris(G, TELUR)).qty), 100);

// String kosong tetap berarti "hapus" — itu jalur yang sah.
await q(`select ubah_nota_terima($1, null, '', '', '', '', null)`, [G]);
const g2 = await satu(`select supplier, invoice_no, notes, photo_path from goods_receipts where id = $1`, [G]);
cek('§5 string kosong = hapus, untuk keempatnya', [g2.supplier, g2.invoice_no, g2.notes, g2.photo_path], [null, null, null, null]);

// =====================================================================
// §6. PENJAGAAN 0084 SELAMAT: barang yang hilang dari daftar = dibatalkan.
// =====================================================================
const H = await buat([
  { product_id: BERAS, qty: 100, line_total: 50000 },
  { product_id: TELUR, qty: 50, line_total: 20000 }
]);
await q(`select ubah_nota_terima($1, null, null, null, null, null, $2::jsonb)`, [
  H,
  JSON.stringify([{ product_id: BERAS, qty: 100, line_total: 50000 }])
]);
cek('§6 barang yang dihapus hilang dari notanya', await baris(H, TELUR), undefined);
const batal = await satu(
  `select qty_delta from stock_movements where receipt_id = $1 and product_id = $2 and qty_delta < 0`,
  [H, TELUR]
);
cek('§6 pergerakan penyeimbang negatifnya dibuat', Number(batal.qty_delta), -50);

// =====================================================================
// §7. PENJAGAAN 0122 SELAMAT: nota lunas tidak bisa diubah isinya.
// =====================================================================
const kunci = await gagalkan(() =>
  q(`select ubah_nota_terima($1, null, null, null, null, null, $2::jsonb)`, [
    E,
    JSON.stringify([{ product_id: BERAS, qty: 3000, line_total: 1 }])
  ])
);
benar('§7 PENJAGAAN 0122: nota lunas tetap terkunci', /sudah dibayar/i.test(kunci ?? ''), `dapat: ${kunci}`);

// =====================================================================
// §8. Baris LAMA (sebelum 0123) diisi line_total oleh migrasinya.
// =====================================================================
await q(`update goods_receipt_items set line_total = null where receipt_id = $1`, [B]);
await jalankan('0123_harga_beli_per_baris.sql');
cek(
  '§8 baris lama terisi qty * unit_cost',
  Number((await baris(B, TELUR)).line_total),
  300000
);

if (gagal === 0) console.log('Migration 0123 di Postgres sungguhan: 8 bagian LULUS. ✅');
process.exit(gagal === 0 ? 0 : 1);
