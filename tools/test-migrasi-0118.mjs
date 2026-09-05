/**
 * MIGRATION 0118 DI POSTGRES SUNGGUHAN (PGlite).
 *
 * ============ YANG DIUJI ============
 *
 *   1. Rumus tertimbang stoknya benar — termasuk `stok_sebelum` yang TIDAK
 *      boleh ikut menghitung pembeliannya sendiri.
 *   2. Pemakaian di antara dua pembelian ikut menentukan hasilnya. Kalau
 *      pergerakan non-nota tidak ikut dibaca, tiap pembelian dirata-ratakan
 *      terhadap stok yang tidak pernah ada.
 *   3. Nota yang DIEDIT menghasilkan angka yang benar — inilah alasan
 *      perhitungannya diputar ulang, bukan ditambahkan sedikit-sedikit.
 *   4. Stok MINUS tidak meledakkan angkanya.
 *   5. HPP menu TIDAK bergeser sedikit pun. Ini janji utama fitur ini.
 *   6. DUA OUTLET, karena rata-ratanya per outlet — dengan satu outlet,
 *      "per outlet" dan "se-BU" memberi hasil yang sama dan sabotase apa pun
 *      di antara keduanya akan lolos.
 */
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AKAR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

let gagal = 0;
const cek = (nama, dapat, harap) => {
  const a = typeof dapat === 'number' ? Number(dapat.toFixed(2)) : dapat;
  const b = typeof harap === 'number' ? Number(harap.toFixed(2)) : harap;
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    gagal++;
    console.error(`❌ ${nama}\n   dapat : ${JSON.stringify(a)}\n   harap : ${JSON.stringify(b)}`);
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

await db.exec(`
  create schema if not exists auth;
  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
  $$;

  create table business_units (id uuid primary key default gen_random_uuid(), name text);
  create table outlets (id uuid primary key default gen_random_uuid(), business_unit_id uuid, name text);
  create table user_profiles (id uuid primary key, full_name text);
  create table products (
    id uuid primary key default gen_random_uuid(),
    business_unit_id uuid, name text, base_unit text default 'gr',
    product_type text default 'raw',
    purchase_price numeric, purchase_qty numeric
  );
  create table goods_receipts (
    id uuid primary key default gen_random_uuid(),
    business_unit_id uuid, outlet_id uuid, code text, receipt_date date,
    supplier text, invoice_no text, photo_path text, notes text,
    created_by uuid, created_at timestamptz default now(), updated_at timestamptz default now()
  );
  create table goods_receipt_items (
    id uuid primary key default gen_random_uuid(),
    receipt_id uuid, product_id uuid, qty numeric, unit_cost numeric, notes text
  );
  create table stock_movements (
    id uuid primary key default gen_random_uuid(),
    business_unit_id uuid, outlet_id uuid, product_id uuid,
    movement_type text, qty_delta numeric, unit_cost numeric, notes text,
    receipt_id uuid, created_by uuid,
    created_at timestamptz not null default now()
  );
  create table membership_scopes (user_id uuid, business_unit_id uuid, outlet_id uuid, role text);
  create role authenticated;

  create or replace function has_bu_scope(p_uid uuid, p_bu uuid) returns boolean language sql stable as $$
    select exists (select 1 from membership_scopes where user_id = p_uid and business_unit_id = p_bu);
  $$;
  create or replace function has_outlet_scope(p_uid uuid, p_outlet uuid) returns boolean language sql stable as $$
    select exists (
      select 1 from membership_scopes ms
       where ms.user_id = p_uid
         and (ms.outlet_id = p_outlet
              or (ms.outlet_id is null and ms.business_unit_id = (select business_unit_id from outlets where id = p_outlet)))
    );
  $$;

  -- Tiruan schema storage. 0084 memasang kebijakan foto nota di sini; isinya
  -- tidak diuji, tapi tanpa tabelnya migration-nya tidak bisa dijalankan sama
  -- sekali — dan menjalankan 0084 APA ADANYA adalah inti tes ini, karena 0118
  -- menulis ulang salah satu fungsinya.
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

// 0084 dulu — 0118 MENULIS ULANG `ubah_nota_terima` miliknya, jadi urutannya
// harus sama dengan produksi.
await jalankan('0084_nota_penerimaan.sql');
await jalankan('0118_biaya_rata_bahan.sql');
console.log('  0084 -> 0118 terpasang.');
await jalankan('0118_biaya_rata_bahan.sql');
console.log('  dijalankan ulang: aman.');

// =====================================================================
// DATA
// =====================================================================
const BU = (await satu(`insert into business_units (name) values ('Cafe') returning id`)).id;
const SERPONG = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Serpong') returning id`, [BU])).id;
const SENTUL = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Sentul') returning id`, [BU])).id;
const BERAS = (
  await satu(
    // Harga master SENGAJA dipilih supaya tidak pernah sama dengan rata-rata
    // nota mana pun di tes ini (50.000/5.000 = 10/gr, sementara notanya 12–20).
    //
    // Percobaan pertama memakai 60.000/5.000 = 12, dan sesudah §6 rata-ratanya
    // kebetulan juga 12 — penjaga di §8 yang menangkapnya. "Harga master tidak
    // tersentuh" tidak membuktikan apa pun kalau keduanya memang identik.
    `insert into products (business_unit_id, name, purchase_price, purchase_qty) values ($1,'Beras',50000,5000) returning id`,
    [BU]
  )
).id;

/** Jam berurut supaya urutan pemutaran ulangnya pasti, bukan bergantung keberuntungan. */
let jam = 0;
const waktu = () => `2026-09-01 08:00:00+07`.replace('08', String(8 + jam++).padStart(2, '0'));

const notaKe = async (outlet, qty, harga) => {
  const nid = (
    await satu(`insert into goods_receipts (business_unit_id, outlet_id, code) values ($1,$2,$3) returning id`, [
      BU,
      outlet,
      'TRM-' + Math.random().toString(36).slice(2, 8)
    ])
  ).id;
  await q(`insert into goods_receipt_items (receipt_id, product_id, qty, unit_cost) values ($1,$2,$3,$4)`, [
    nid,
    BERAS,
    qty,
    harga
  ]);
  await q(
    `insert into stock_movements (business_unit_id, outlet_id, product_id, movement_type, qty_delta, unit_cost, receipt_id, created_at)
     values ($1,$2,$3,'receive',$4,$5,$6,$7::timestamptz)`,
    [BU, outlet, BERAS, qty, harga, nid, waktu()]
  );
  return nid;
};

const pakai = (outlet, qty) =>
  q(
    `insert into stock_movements (business_unit_id, outlet_id, product_id, movement_type, qty_delta, created_at)
     values ($1,$2,$3,'usage',$4,$5::timestamptz)`,
    [BU, outlet, BERAS, -qty, waktu()]
  );

const rata = async (outlet) =>
  Number((await satu(`select rata from biaya_rata_bahan where outlet_id = $1 and product_id = $2`, [outlet, BERAS]))?.rata ?? NaN);

// =====================================================================
// §1. Pembelian pertama menetapkan harganya.
// =====================================================================
await notaKe(SERPONG, 10000, 12);
cek('§1 pembelian pertama', await rata(SERPONG), 12);

// =====================================================================
// §2. INTI: pemakaian di antara dua pembelian ikut menentukan hasilnya.
//
// Beli 10.000 @12 -> pakai 6.000 (sisa 4.000) -> beli 6.000 @15.
// (4.000×12 + 6.000×15) / 10.000 = (48.000 + 90.000) / 10.000 = 13,8
// =====================================================================
await pakai(SERPONG, 6000);
await notaKe(SERPONG, 6000, 15);
cek('§2 rata-rata tertimbang stok', await rata(SERPONG), 13.8);

benar(
  '§2 hasilnya BEDA dari rata-rata polos',
  Math.abs((await rata(SERPONG)) - (10000 * 12 + 6000 * 15) / 16000) > 0.01,
  'kalau sama, tesnya tidak bisa membedakan "tertimbang stok" dari "rata-rata seluruh pembelian"'
);

// =====================================================================
// §3. Per OUTLET — Sentul punya angkanya sendiri.
// =====================================================================
await notaKe(SENTUL, 1000, 30);
cek('§3 Sentul punya rata-ratanya sendiri', await rata(SENTUL), 30);
cek('§3 Serpong tidak ikut berubah', await rata(SERPONG), 13.8);

// =====================================================================
// §4. Stok MINUS tidak meledakkan angkanya.
// =====================================================================
const CABAI = (await satu(`insert into products (business_unit_id, name) values ($1,'Cabai') returning id`, [BU])).id;
await q(
  `insert into stock_movements (business_unit_id, outlet_id, product_id, movement_type, qty_delta, created_at)
   values ($1,$2,$3,'usage',-500,$4::timestamptz)`,
  [BU, SERPONG, CABAI, waktu()]
);
const nCabai = (
  await satu(`insert into goods_receipts (business_unit_id, outlet_id, code) values ($1,$2,'TRM-CB') returning id`, [BU, SERPONG])
).id;
await q(
  `insert into stock_movements (business_unit_id, outlet_id, product_id, movement_type, qty_delta, unit_cost, receipt_id, created_at)
   values ($1,$2,$3,'receive',100,50,$4,$5::timestamptz)`,
  [BU, SERPONG, CABAI, nCabai, waktu()]
);
const rataCabai = async () =>
  Number((await satu(`select rata from biaya_rata_bahan where outlet_id = $1 and product_id = $2`, [SERPONG, CABAI]))?.rata ?? NaN);
cek('§4 pembelian pertama saat stok minus', await rataCabai(), 50);

// PEMBELIAN KEDUA saat stok MINUS — di sinilah penjaganya benar-benar diuji.
//
// Percobaan pertama berhenti di pembelian PERTAMA, dan sabotase yang mencabut
// `r.stok_sebelum <= 0` LOLOS: pada pembelian pertama `v_rata` memang masih
// null, jadi kedua cabangnya menghasilkan angka yang sama. Penjaga yang tidak
// pernah dilewati tidak sedang dijaga.
//
// Sekarang: stok 100, dipakai 600 -> stok -500, lalu beli 100 @80.
//   dengan penjaga  : 80          (stok minus = tidak ada yang dirata-ratakan)
//   tanpa penjaga   : (-500x50 + 100x80) / (-500+100) = -17.000 / -400 = 42,5
await q(
  `insert into stock_movements (business_unit_id, outlet_id, product_id, movement_type, qty_delta, created_at)
   values ($1,$2,$3,'usage',-600,$4::timestamptz)`,
  [BU, SERPONG, CABAI, waktu()]
);
const nCabai2 = (
  await satu(`insert into goods_receipts (business_unit_id, outlet_id, code) values ($1,$2,'TRM-CB2') returning id`, [BU, SERPONG])
).id;
await q(
  `insert into stock_movements (business_unit_id, outlet_id, product_id, movement_type, qty_delta, unit_cost, receipt_id, created_at)
   values ($1,$2,$3,'receive',100,80,$4,$5::timestamptz)`,
  [BU, SERPONG, CABAI, nCabai2, waktu()]
);
cek('§4 INTI: stok minus tidak masuk rumus', await rataCabai(), 80);

// =====================================================================
// §5. Nota tanpa harga tidak menarik rata-rata ke nol.
// =====================================================================
await notaKe(SERPONG, 5000, null);
cek('§5 nota tanpa harga diabaikan', await rata(SERPONG), 13.8);

// =====================================================================
// §6. INTI: nota yang DIEDIT menghasilkan angka yang benar.
//
// Inilah alasan perhitungannya diputar ulang, bukan ditambahkan
// sedikit-sedikit. Harga nota kedua dikoreksi dari 15 jadi 20:
// (4.000×12 + 6.000×20) / 10.000 = (48.000 + 120.000) / 10.000 = 16,8
// =====================================================================
await q(
  `update stock_movements set unit_cost = 20
    where outlet_id = $1 and product_id = $2 and unit_cost = 15 and qty_delta > 0`,
  [SERPONG, BERAS]
);
cek('§6 koreksi harga nota terhitung ulang seluruhnya', await rata(SERPONG), 16.8);

// Menghapus pergerakan notanya mengembalikan angka sebelum nota itu.
await q(`delete from stock_movements where outlet_id = $1 and product_id = $2 and unit_cost = 20 and qty_delta > 0`, [
  SERPONG,
  BERAS
]);
cek('§6 hapus nota -> kembali ke keadaan sebelumnya', await rata(SERPONG), 12);

// =====================================================================
// §7. Semua nota berharga hilang -> BARISNYA ikut hilang, bukan nol.
// =====================================================================
await q(`delete from stock_movements where outlet_id = $1 and product_id = $2 and unit_cost is not null`, [SENTUL, BERAS]);
cek(
  '§7 barisnya dihapus, bukan disisakan bernilai 0',
  Number((await satu(`select count(*)::int n from biaya_rata_bahan where outlet_id = $1 and product_id = $2`, [SENTUL, BERAS])).n),
  0
);

// =====================================================================
// §8. JANJI UTAMA: harga master TIDAK tersentuh sama sekali.
// =====================================================================
const master = await satu(`select purchase_price, purchase_qty from products where id = $1`, [BERAS]);
cek(
  '§8 INTI: purchase_price & purchase_qty tidak berubah',
  [Number(master.purchase_price), Number(master.purchase_qty)],
  [50000, 5000]
);
// Dibaca dari BARIS MASTERNYA, bukan dari angka yang ditulis ulang di sini.
//
// Percobaan pertama menuliskan `60000 / 5000` sebagai literal. Saat harga
// masternya diubah di atas, pembanding ini tertinggal di angka lama — dan
// tesnya merah dengan alasan yang tidak ada hubungannya dengan kodenya.
// Angka yang sama ditulis di dua tempat selalu berakhir berbeda.
const hargaMaster = Number(master.purchase_price) / Number(master.purchase_qty);
benar(
  '§8 dan rata-rata nota memang BERBEDA dari harga master',
  Math.abs((await rata(SERPONG)) - hargaMaster) > 0.01,
  `kalau kebetulan sama (master ${hargaMaster}), tesnya tidak membuktikan apa pun tentang "tidak tersentuh"`
);

// =====================================================================
// §9. Pergerakan non-nota tidak memicu penghitungan ulang…
//     …tapi tetap ikut dibaca saat menghitung.
// =====================================================================
// `::text`, BUKAN kolom mentahnya.
//
// PGlite mengembalikan `timestamptz` sebagai objek Date JS, dan `String(date)`
// memotongnya sampai DETIK — milidetiknya hilang. Dua penghitungan ulang dalam
// detik yang sama lalu terbaca identik, dan sabotase yang membuat trigger
// menyala untuk SETIAP pergerakan LOLOS dari pemeriksaan ini.
//
// Ini jebakan PGlite yang sama persis dengan yang menggigit di tes 0113.
const capNya = async () =>
  (await satu(`select dihitung_at::text as t from biaya_rata_bahan where outlet_id = $1 and product_id = $2`, [SERPONG, BERAS]))
    ?.t ?? null;

const sebelum = await capNya();
await pakai(SERPONG, 100);
const sesudah = await capNya();
benar('§9 penanda waktunya terbaca', sebelum !== null);
cek('§9 penjualan/pemakaian tidak memicu hitung ulang', sesudah, sebelum);

// Dan sebaliknya: nota BARU memang harus memicunya.
//
// Tanpa pasangan ini, sabotase yang mematikan trigger sepenuhnya juga akan
// lolos dari §9 — cap waktunya memang tidak berubah, karena tidak ada apa pun
// yang pernah berjalan.
await notaKe(SERPONG, 1000, 25);
benar(
  '§9 nota baru MEMICU hitung ulang',
  (await capNya()) !== sebelum,
  'kalau tidak, §9 hijau hanya karena tidak ada yang pernah berjalan'
);

// =====================================================================
// §10. Tabelnya tidak bisa ditulis peran biasa.
// =====================================================================
const kebijakanTulis = Number(
  (
    await satu(
      `select count(*)::int n from pg_policies
        where tablename = 'biaya_rata_bahan' and cmd in ('INSERT','UPDATE','DELETE','ALL')`
    )
  ).n
);
cek('§10 tidak ada kebijakan tulis', kebijakanTulis, 0);
benar(
  '§10 kebijakan baca ada',
  Number((await satu(`select count(*)::int n from pg_policies where tablename = 'biaya_rata_bahan' and cmd = 'SELECT'`)).n) > 0
);


// =====================================================================
// §11. KOREKSI HARGA LEWAT `ubah_nota_terima` sampai ke rata-ratanya.
//
// Celah yang paling mudah terlewat: kalau HANYA harganya yang diubah,
// jumlahnya tetap, jadi TIDAK ADA pergerakan baru sama sekali. Tanpa perbaikan
// di 0118, `stock_movements` tetap memegang harga lama — layar nota menampilkan
// harga yang sudah dibetulkan sementara biaya rata-ratanya masih memakai yang
// salah.
// =====================================================================
const GULA = (await satu(`insert into products (business_unit_id, name) values ($1,'Gula') returning id`, [BU])).id;
await q(`insert into membership_scopes (user_id, business_unit_id, outlet_id, role) values ($1,$2,$3,'staff')`, [
  '99999999-9999-9999-9999-999999999999',
  BU,
  SERPONG
]);
await q(`select set_config('request.jwt.claim.sub', $1, false)`, ['99999999-9999-9999-9999-999999999999']);

const notaGula = await satu(`select simpan_nota_terima($1, null, null, null, null, null, $2::jsonb) as id`, [
  SERPONG,
  JSON.stringify([{ product_id: GULA, qty: 1000, unit_cost: 14 }])
]);
const rataGula = async () =>
  Number((await satu(`select rata from biaya_rata_bahan where outlet_id = $1 and product_id = $2`, [SERPONG, GULA]))?.rata ?? NaN);
cek('§11 nota lewat RPC sungguhan tercatat', await rataGula(), 14);

// HANYA harganya yang diubah — jumlahnya tetap 1000.
await q(`select ubah_nota_terima($1, null, null, null, null, null, $2::jsonb)`, [
  notaGula.id,
  JSON.stringify([{ product_id: GULA, qty: 1000, unit_cost: 18 }])
]);
cek('§11 INTI: koreksi harga saja ikut mengubah rata-rata', await rataGula(), 18);

// Menambah jumlah pada nota yang sama: penyeimbangnya ikut berharga.
// Stok 1000 @18, tambah 500 @18 -> tetap 18 (harga sama), tapi dasarnya naik.
await q(`select ubah_nota_terima($1, null, null, null, null, null, $2::jsonb)`, [
  notaGula.id,
  JSON.stringify([{ product_id: GULA, qty: 1500, unit_cost: 18 }])
]);
cek('§11 penambahan jumlah tetap 18', await rataGula(), 18);
cek(
  '§11 penyeimbangnya IKUT jadi dasar (berarti ia berharga)',
  Number((await satu(`select qty_dasar from biaya_rata_bahan where outlet_id = $1 and product_id = $2`, [SERPONG, GULA])).qty_dasar),
  1500
);

if (gagal === 0) console.log('Migration 0084 + 0118: semua pemeriksaan lulus. ✅');
process.exit(gagal === 0 ? 0 : 1);
