/**
 * MIGRATION 0135 DI POSTGRES SUNGGUHAN (PGlite).
 *
 * ============ YANG DIUJI ============
 *
 *   1. Foto WAJIB, dan yang menolak adalah server — bukan layar. Kosong, spasi,
 *      dan NULL sama-sama ditolak, dengan pesan yang bisa ditindaklanjuti.
 *   2. Penolakannya ATOMIK: tidak ada `waste_runs`, `waste_items`, maupun
 *      `stock_movements` yang tertinggal separuh.
 *   3. JALUR LAMA TERTUTUP. Ini yang membuat "wajib" berarti sesuatu:
 *        - insert langsung `stock_movements` bertipe waste ditolak trigger
 *        - `record_menu_waste` (0032) menolak dengan MENJELASKAN
 *      Tanpa dua ini, staff ber-PWA lama tetap bisa menyimpan waste tanpa foto
 *      dan tidak ada satu pun error yang menandainya.
 *   4. Spoil memotong bahan itu sendiri; waste menu memotong bahan RESEPNYA
 *      sebanding porsinya — rumus yang sama dengan `record_menu_waste` lama
 *      supaya angka historisnya tetap sebanding.
 *   5. Tidak ada `unit_cost` yang ikut tertulis (0118/0123).
 *   6. View `waste_rekap` memberi satu baris per BAHAN, dengan tanggal WIB.
 *   7. Wewenang outlet ditegakkan.
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
    language sql stable as $$
      select exists (select 1 from user_profiles u
                      where u.id = p_uid and (u.full_name = 'SEMUA' or u.full_name = p_outlet::text)); $$;
  create or replace function has_bu_scope(p_uid uuid, p_bu uuid) returns boolean
    language sql stable as $$ select p_uid is not null $$;

  -- Bentuk 0032 yang akan DIGANTI isinya oleh 0135.
  create or replace function record_menu_waste(p_bu uuid, p_outlet uuid, p_product uuid, p_qty numeric, p_notes text)
  returns void language plpgsql security definer set search_path = public as $fn$
  begin
    insert into stock_movements(business_unit_id, outlet_id, product_id, movement_type, qty_delta, notes, created_by)
      values (p_bu, p_outlet, p_product, 'waste', -p_qty, 'lama', auth.uid());
  end;
  $fn$;
`);

const jalankan = async (b) =>
  db.exec(fs.readFileSync(path.join(AKAR, 'supabase/migrations', b), 'utf8').replace(/notify pgrst[^;]*;/g, ''));

await jalankan('0135_waste_foto_wajib.sql');
console.log('  0135 terpasang.');
await jalankan('0135_waste_foto_wajib.sql');
console.log('  dijalankan ulang: aman.');

const BU = (await satu(`insert into business_units (name) values ('Cafe') returning id`)).id;
const OUT = (await satu(`insert into outlets (business_unit_id, name, outlet_role) values ($1,'Sentul','standalone') returning id`, [BU])).id;
const LAIN = (await satu(`insert into outlets (business_unit_id, name, outlet_role) values ($1,'Serpong','standalone') returning id`, [BU])).id;
const STAFF = '11111111-1111-1111-1111-111111111111';
const LUAR = '22222222-2222-2222-2222-222222222222';
await q(`insert into user_profiles (id, full_name) values ($1,'SEMUA'), ($2,$3)`, [STAFF, LUAR, LAIN]);
await q(`select set_config('request.jwt.claim.sub', $1, false)`, [STAFF]);

const BERAS = (await satu(`insert into products (name, base_unit) values ('Beras','kg') returning id`)).id;
const TELUR = (await satu(`insert into products (name, base_unit) values ('Telur','butir') returning id`)).id;
const NASGOR = (await satu(`insert into products (name, base_unit) values ('Nasi Goreng','porsi') returning id`)).id;
const SOTO = (await satu(`insert into products (name, base_unit) values ('Soto','porsi') returning id`)).id;

// Nasi Goreng: yield 1 porsi = 0,2 kg beras + 1 butir telur.
const RESEP = (await satu(
  `insert into recipes (business_unit_id, product_id, mode, yield_qty) values ($1,$2,'standalone',1) returning id`,
  [BU, NASGOR]
)).id;
await q(`insert into recipe_items (recipe_id, ingredient_product_id, qty) values ($1,$2,0.2), ($1,$3,1)`, [RESEP, BERAS, TELUR]);

// =====================================================================
// §1 FOTO WAJIB — DITEGAKKAN SERVER
// =====================================================================
const tanpaFoto = await gagalkan(() => q(`select catat_waste($1,'spoil',$2,2,null,null)`, [OUT, BERAS]));
benar('§1 foto NULL ditolak', !!tanpaFoto);
benar('§1 pesannya menyebut foto', /[Ff]oto/.test(tanpaFoto ?? ''), tanpaFoto ?? '');

const fotoKosong = await gagalkan(() => q(`select catat_waste($1,'spoil',$2,2,'',null)`, [OUT, BERAS]));
benar('§1 foto string kosong ditolak', !!fotoKosong);

// Spasi adalah cara paling mudah menembus `not null` tanpa sadar: sebuah form
// yang bidangnya tidak diisi mengirim string, bukan NULL.
const fotoSpasi = await gagalkan(() => q(`select catat_waste($1,'spoil',$2,2,'   ',null)`, [OUT, BERAS]));
benar('§1 foto berisi spasi saja ditolak', !!fotoSpasi);

// PESANNYA DIPERIKSA, bukan cuma "ada error".
//
// Kalau pemeriksaan di dalam `catat_waste` dilepas, constraint kolomnya tetap
// menolak — jadi tesnya tetap hijau kalau yang diuji hanya "gagal atau tidak".
// Yang berubah cuma kalimatnya: dari "Foto wajib diisi…" jadi "null value in
// column photo_path violates not-null constraint", yang dibaca staff di dapur.
benar('§1 pesan kosong bisa ditindaklanjuti', /Foto wajib diisi/.test(fotoKosong ?? ''), fotoKosong ?? '');
benar('§1 pesan spasi bisa ditindaklanjuti', /Foto wajib diisi/.test(fotoSpasi ?? ''), fotoSpasi ?? '');

// LAPIS 1 diuji sendiri, langsung ke kolomnya.
//
// Tanpa ini, melepas `not null` dari kolomnya tidak ketahuan sama sekali —
// `catat_waste` masih menolak, jadi seluruh §1 di atas tetap hijau. Yang hilang
// adalah jaring terakhir untuk jalan masuk mana pun di masa depan.
const kolomNull = await gagalkan(() =>
  q(
    `insert into waste_runs (business_unit_id, outlet_id, jenis, product_id, qty, photo_path, created_by)
     values ($1,$2,'spoil',$3,1,null,$4)`,
    [BU, OUT, BERAS, STAFF]
  )
);
benar('§1 kolom photo_path menolak NULL', !!kolomNull);
const kolomSpasi = await gagalkan(() =>
  q(
    `insert into waste_runs (business_unit_id, outlet_id, jenis, product_id, qty, photo_path, created_by)
     values ($1,$2,'spoil',$3,1,'   ',$4)`,
    [BU, OUT, BERAS, STAFF]
  )
);
benar('§1 kolom photo_path menolak spasi kosong', !!kolomSpasi);

// §2 PENOLAKANNYA ATOMIK.
cek('§2 tidak ada waste_runs yang tertinggal', Number((await satu(`select count(*)::int c from waste_runs`)).c), 0);
cek('§2 tidak ada waste_items yang tertinggal', Number((await satu(`select count(*)::int c from waste_items`)).c), 0);
cek('§2 tidak ada stock_movements yang tertinggal', Number((await satu(`select count(*)::int c from stock_movements`)).c), 0);

// =====================================================================
// §3 JALUR LAMA TERTUTUP
// =====================================================================
const langsung = await gagalkan(() =>
  q(
    `insert into stock_movements (business_unit_id, outlet_id, product_id, movement_type, qty_delta, created_by)
     values ($1,$2,$3,'waste',-1,$4)`,
    [BU, OUT, BERAS, STAFF]
  )
);
benar('§3 insert waste langsung ditolak trigger', !!langsung);
benar('§3 pesannya mengarahkan ke layar Waste/Spoil', /Waste\/Spoil/.test(langsung ?? ''), langsung ?? '');

const lama = await gagalkan(() => q(`select record_menu_waste($1,$2,$3,1,null)`, [BU, OUT, NASGOR]));
benar('§3 record_menu_waste menolak', !!lama);
benar('§3 pesannya menyuruh memperbarui aplikasi', /buka lagi/i.test(lama ?? ''), lama ?? '');

// Jenis pergerakan LAIN tidak ikut terkena — triggernya hanya soal waste.
await q(
  `insert into stock_movements (business_unit_id, outlet_id, product_id, movement_type, qty_delta, created_by)
   values ($1,$2,$3,'receive',5,$4)`,
  [BU, OUT, BERAS, STAFF]
);
cek(
  '§3 penerimaan biasa tidak ikut ditolak',
  Number((await satu(`select count(*)::int c from stock_movements where movement_type = 'receive'`)).c),
  1
);

// =====================================================================
// §4 SPOIL — bahan itu sendiri yang berkurang
// =====================================================================
const idSpoil = (await satu(`select catat_waste($1,'spoil',$2,2.5,'o/f1.jpg','kena air') as id`, [OUT, BERAS])).id;
benar('§4 spoil mengembalikan id', !!idSpoil);

const runSpoil = await satu(`select jenis, product_id, qty, photo_path, code, notes from waste_runs where id = $1`, [idSpoil]);
cek('§4 jenisnya spoil', runSpoil.jenis, 'spoil');
cek('§4 produknya bahan itu sendiri', runSpoil.product_id, BERAS);
cek('§4 fotonya tersimpan', runSpoil.photo_path, 'o/f1.jpg');
benar('§4 kodenya berawalan WST-', /^WST-\d{6}-[0-9A-F]{4}$/.test(runSpoil.code ?? ''), runSpoil.code ?? '');

const itemSpoil = (await q(`select product_id, qty from waste_items where waste_id = $1`, [idSpoil])).rows;
cek('§4 satu baris rincian', itemSpoil.length, 1);
cek('§4 rinciannya bahan itu sendiri', itemSpoil[0].product_id, BERAS);
cek('§4 jumlahnya utuh', Number(itemSpoil[0].qty), 2.5);

const smSpoil = (await q(`select product_id, qty_delta, unit_cost, waste_run_id from stock_movements where waste_run_id = $1`, [idSpoil])).rows;
cek('§4 satu pergerakan stok', smSpoil.length, 1);
cek('§4 stoknya BERKURANG (negatif)', Number(smSpoil[0].qty_delta), -2.5);
// §5 — `unit_cost` adalah sumber tunggal biaya rata-rata (0118) dan sejak 0123
// hanya diisi PEMBELIAN. Waste adalah pengeluaran barang, bukan pemasukan.
cek('§5 tanpa unit_cost', smSpoil[0].unit_cost, null);

// =====================================================================
// §4b WASTE MENU — bahan resepnya yang berkurang
// =====================================================================
const idMenu = (await satu(`select catat_waste($1,'menu',$2,2,'o/f2.jpg',null) as id`, [OUT, NASGOR])).id;
const itemMenu = (await q(`select product_id, qty from waste_items where waste_id = $1 order by qty`, [idMenu])).rows;
cek('§4b dua bahan dari resepnya', itemMenu.length, 2);
cek('§4b beras 0,2 x 2 porsi', Number(itemMenu.find((r) => r.product_id === BERAS).qty), 0.4);
cek('§4b telur 1 x 2 porsi', Number(itemMenu.find((r) => r.product_id === TELUR).qty), 2);

const smMenu = (await q(`select product_id, qty_delta, notes from stock_movements where waste_run_id = $1`, [idMenu])).rows;
cek('§4b dua pergerakan stok', smMenu.length, 2);
benar('§4b catatannya menyebut nama menunya', /Waste menu: Nasi Goreng/.test(smMenu[0].notes ?? ''), smMenu[0].notes ?? '');
benar(
  '§4b semua pergerakannya negatif',
  smMenu.every((r) => Number(r.qty_delta) < 0)
);

// Menu tanpa resep ditolak — bahan yang terbuang tidak bisa dihitung.
const tanpaResep = await gagalkan(() => q(`select catat_waste($1,'menu',$2,1,'o/f3.jpg',null)`, [OUT, SOTO]));
benar('§4b menu tanpa resep ditolak', !!tanpaResep);
benar('§4b pesannya menyebut resep', /resep/i.test(tanpaResep ?? ''), tanpaResep ?? '');

// =====================================================================
// §6 VIEW REKAP — SATU BARIS PER BAHAN
// =====================================================================
const rekap = (await q(`select * from waste_rekap order by bahan_nama`)).rows;
cek('§6 tiga baris bahan dari dua kejadian', rekap.length, 3);
cek('§6 nama bahannya ikut', rekap.map((r) => r.bahan_nama).sort(), ['Beras', 'Beras', 'Telur']);

const barisMenu = rekap.find((r) => r.jenis === 'menu' && r.bahan_nama === 'Beras');
cek('§6 sumbernya nama MENU, bukan bahan', barisMenu.sumber_nama, 'Nasi Goreng');
cek('§6 qty kejadiannya jumlah porsi', Number(barisMenu.qty_kejadian), 2);
cek('§6 qty bahannya hasil resep', Number(barisMenu.bahan_qty), 0.4);
cek('§6 fotonya ikut tiap baris', barisMenu.photo_path, 'o/f2.jpg');
cek('§6 outletnya ikut', barisMenu.outlet_nama, 'Sentul');

const barisSpoil = rekap.find((r) => r.jenis === 'spoil');
cek('§6 spoil: sumbernya bahan itu sendiri', barisSpoil.sumber_nama, 'Beras');
cek('§6 catatannya ikut', barisSpoil.notes, 'kena air');

// Tanggalnya WIB, bukan UTC. Waste yang dicatat pukul 23.00 WIB (16.00 UTC)
// harus tetap jatuh di tanggal hari itu, bukan mundur sehari.
const tglWib = (await satu(`select (now() at time zone 'Asia/Jakarta')::date d`)).d;
cek('§6 tanggalnya memakai WIB', String(rekap[0].tanggal).slice(0, 10), String(tglWib).slice(0, 10));

// =====================================================================
// §7 WEWENANG
// =====================================================================
await q(`select set_config('request.jwt.claim.sub', $1, false)`, [LUAR]);
const bukanHaknya = await gagalkan(() => q(`select catat_waste($1,'spoil',$2,1,'o/f4.jpg',null)`, [OUT, BERAS]));
benar('§7 outlet yang bukan haknya ditolak', !!bukanHaknya);
benar('§7 pesannya menyebut hak', /berhak/i.test(bukanHaknya ?? ''), bukanHaknya ?? '');

await q(`select set_config('request.jwt.claim.sub', $1, false)`, [STAFF]);
const nol = await gagalkan(() => q(`select catat_waste($1,'spoil',$2,0,'o/f5.jpg',null)`, [OUT, BERAS]));
benar('§7 jumlah 0 ditolak', !!nol);
benar('§7 pesannya menyebut "lebih dari 0"', /lebih dari 0/.test(nol ?? ''), nol ?? '');

const jenisAneh = await gagalkan(() => q(`select catat_waste($1,'entah',$2,1,'o/f6.jpg',null)`, [OUT, BERAS]));
benar('§7 jenis tak dikenal ditolak', !!jenisAneh);

// Bucket fotonya benar-benar ada, dan privat.
const bucket = await satu(`select public from storage.buckets where id = 'waste-photos'`);
benar('§7 bucket waste-photos ada', !!bucket);
cek('§7 bucketnya privat', bucket?.public, false);

if (gagal) {
  console.error(`\n${gagal} kasus gagal.`);
  process.exit(1);
}
console.log('0135 benar di Postgres sungguhan — foto wajib ditegakkan server, dan jalur lama tanpa foto tertutup. ✅');
