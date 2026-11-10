/**
 * MIGRATION 0182 — OPNAME MENYELURUH: YANG TIDAK DIISI DIANGGAP HABIS.
 *
 * ============ APA YANG DIBUKTIKAN ============
 *
 *   §1 Bahan yang DIHITUNG tetap disesuaikan seperti dulu (0085 tidak hilang).
 *   §2 Bahan yang TIDAK dihitung jadi nol — termasuk yang stoknya minus.
 *   §3 Yang stoknya memang sudah nol tidak menghasilkan pergerakan apa pun.
 *   §4 Yang TIDAK ikut dinolkan: menu (`finished`), produk nonaktif, dan
 *      bahan milik outlet/BU lain.
 *   §5 Jejaknya: baris `stock_count_items` bertanda `otomatis` + catatan di
 *      pergerakan stoknya.
 *   §6 Stok sistem dibaca SAAT MENUTUP, bukan saat sesi dibuka.
 *   §7 `batalkan_opname` tetap tidak menyentuh stok sama sekali.
 *   §8 `pratinjau_tutup_opname` menyebut angka yang SAMA dengan yang terjadi.
 *   §9 Wewenang & idempotensi.
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
  create table products (id uuid primary key default gen_random_uuid(),
    business_unit_id uuid, name text, product_type text, base_unit text, is_active boolean default true);
  create table stock_movements (id uuid primary key default gen_random_uuid(),
    business_unit_id uuid, outlet_id uuid, product_id uuid, movement_type text,
    qty_delta numeric, notes text, created_by uuid, created_at timestamptz default now());

  create or replace function is_bu_admin(p_uid uuid, p_bu uuid) returns boolean
    language sql security definer stable as $x$
      select exists (select 1 from membership_scopes ms where ms.user_id = p_uid
        and (ms.role = 'super_admin' or (ms.role = 'bu_admin' and ms.business_unit_id = p_bu))) $x$;
  create or replace function has_outlet_scope(p_uid uuid, p_outlet uuid) returns boolean
    language sql security definer stable as $x$
      select exists (select 1 from membership_scopes ms
        where ms.user_id = p_uid
          and (ms.role = 'super_admin'
               or ms.outlet_id = p_outlet
               or ms.business_unit_id = (select business_unit_id from outlets where id = p_outlet))) $x$;
  create or replace function has_bu_scope(p_uid uuid, p_bu uuid) returns boolean
    language sql security definer stable as $x$
      select exists (select 1 from membership_scopes ms where ms.user_id = p_uid
        and (ms.role = 'super_admin' or ms.business_unit_id = p_bu)) $x$;
  create or replace function is_admin_of_outlet(p_uid uuid, p_outlet uuid) returns boolean
    language sql security definer stable as $x$
      select exists (select 1 from membership_scopes ms join outlets o on o.id = p_outlet
        where ms.user_id = p_uid
          and (ms.role = 'super_admin'
               or (ms.role = 'bu_admin' and ms.business_unit_id = o.business_unit_id)
               or (ms.role = 'outlet_admin' and ms.outlet_id = p_outlet))) $x$;
`);

const jalankan = async (b) =>
  db.exec(fs.readFileSync(path.join(AKAR, 'supabase/migrations', b), 'utf8').replace(/notify pgrst[^;]*;/g, ''));

await jalankan('0085_opname_bernomor.sql');
await jalankan('0114_opname_stok_sistem_dari_server.sql');

const BU = (await satu(`insert into business_units (name) values ('Cafe') returning id`)).id;
const BU2 = (await satu(`insert into business_units (name) values ('Bengkel') returning id`)).id;
const OUT = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Sentul') returning id`, [BU])).id;
const OUT2 = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Serpong') returning id`, [BU])).id;
const OUT3 = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Depok') returning id`, [BU2])).id;

const ADMIN = '11111111-1111-1111-1111-111111111111';
const STAFF = '22222222-2222-2222-2222-222222222222';
await q(`insert into user_profiles (id, full_name) values ($1,'Admin'),($2,'Budi')`, [ADMIN, STAFF]);
await q(
  `insert into membership_scopes (user_id, business_unit_id, outlet_id, role)
   values ($1,$2,null,'bu_admin'), ($3,$2,$4,'staff')`,
  [ADMIN, BU, STAFF, OUT]
);

const produk = async (nama, tipe = 'raw', bu = BU, aktif = true) =>
  (await satu(`insert into products (business_unit_id, name, product_type, base_unit, is_active) values ($1,$2,$3,'gr',$4) returning id`, [bu, nama, tipe, aktif])).id;

const BERAS = await produk('Beras');
const GULA = await produk('Gula');
const TOMAT = await produk('Tomat');          // stoknya MINUS
const KOPI = await produk('Kopi');            // stok sudah 0
const WIP = await produk('Adonan', 'semi');   // setengah jadi: ikut dinolkan
const LATTE = await produk('Latte', 'finished'); // menu: TIDAK ikut
const ARSIP = await produk('Teh Lama', 'raw', BU, false); // nonaktif: TIDAK ikut
const LAIN = await produk('Oli', 'raw', BU2); // BU lain: TIDAK ikut
// Bahan BU lain yang pergerakannya TERCATAT di outlet ini. Terdengar mustahil,
// dan justru itu gunanya: tanpa saringan `business_unit_id`, baris semacam
// inilah yang ikut dinolkan — dan tidak ada laporan di BU mana pun yang
// menunjukkan hubungannya.
const LAIN2 = await produk('Gemuk', 'raw', BU2);
// Bahan yang stoknya hanya ada di OUTLET LAIN. Tanpa saringan `outlet_id` pada
// pembacaan stoknya, ia dibaca 5000 lalu "dinolkan" di outlet ini — menghasilkan
// stok MINUS 5000 untuk barang yang tidak pernah ada di sini.
const MINYAK = await produk('Minyak');

const gerak = (pid, qty, outlet = OUT, bu = BU) =>
  q(
    `insert into stock_movements (business_unit_id, outlet_id, product_id, movement_type, qty_delta, notes, created_by)
     values ($1,$2,$3,'in',$4,'awal',$5)`,
    [bu, outlet, pid, qty, ADMIN]
  );

await gerak(BERAS, 10000);
await gerak(GULA, 5000);
await gerak(TOMAT, -300); // minus: dipakai lebih banyak daripada yang pernah masuk
await gerak(WIP, 800);
await gerak(ARSIP, 400);
await gerak(LAIN, 900, OUT3, BU2);
// Bahan yang sama di OUTLET LAIN — tidak boleh ikut tersentuh.
await gerak(BERAS, 7000, OUT2);
await gerak(MINYAK, 5000, OUT2);
await gerak(LAIN2, 600, OUT, BU2);
// Menu yang KEBETULAN punya stok (mis. produk jadi yang pernah diterima).
// Tanpa saringan `finished`, stok inilah yang lenyap.
await gerak(LATTE, 20);

const stok = async (pid, outlet = OUT) =>
  Number(
    (await satu(`select coalesce(sum(qty_delta),0) s from stock_movements where product_id=$1 and outlet_id=$2`, [pid, outlet])).s
  );

await jadi(ADMIN);
await jalankan('0182_opname_menyeluruh.sql');

console.log('§0 Migrationnya jalan');
benar(
  '§0 kolom `otomatis` ada',
  (await satu(`select count(*)::int n from information_schema.columns where table_name='stock_count_items' and column_name='otomatis'`)).n === 1
);
benar('§0 `pratinjau_tutup_opname` ada', (await satu(`select count(*)::int n from pg_proc where proname='pratinjau_tutup_opname'`)).n > 0);

// ===============================================================
console.log('§1–§5 Satu sesi: dihitung, tidak dihitung, dan yang tidak ikut');
// ===============================================================
const SESI = (await satu(`select buka_opname($1,null) as id`, [OUT])).id;
await q(`select catat_hitungan_opname($1,$2,$3,null,null)`, [SESI, BERAS, 9500]);

// ============ PRATINJAUNYA DULU, SEBELUM TERJADI ============
const pra = (await satu(`select pratinjau_tutup_opname($1) as h`, [SESI])).h;
cek('§8 pratinjau: yang dihitung', pra.dihitung, 1);
// Gula (5000), Tomat (-300), Adonan (800) = 3. Kopi 0 tidak dihitung sebagai
// "akan dinolkan" karena tidak ada yang akan bergerak.
cek('§8 pratinjau: yang akan dianggap habis', pra.akan_dinolkan, 3);

const nTutup = (await satu(`select tutup_opname($1) as n`, [SESI])).n;

cek('§1 bahan yang dihitung disesuaikan ke angka hitungannya', await stok(BERAS), 9500);
cek('§2 bahan yang tidak dihitung jadi nol', await stok(GULA), 0);
// Yang MINUS ikut dibereskan — ini yang memicu permintaannya.
cek('§2 bahan berstok minus ikut jadi nol', await stok(TOMAT), 0);
cek('§2 bahan setengah jadi ikut dinolkan', await stok(WIP), 0);
cek('§3 yang sudah nol tidak disentuh', await stok(KOPI), 0);
cek(
  '§3 yang sudah nol tidak membuat pergerakan kosong',
  Number((await satu(`select count(*)::int n from stock_movements where product_id=$1`, [KOPI])).n),
  0
);
cek('§4 menu (finished) tidak ikut dinolkan', await stok(LATTE), 20);
cek('§4 produk nonaktif tidak ikut dinolkan', await stok(ARSIP), 400);
cek('§4 bahan BU lain tidak ikut dinolkan', await stok(LAIN, OUT3), 900);
// Outlet lain adalah gudang yang berbeda; opname di Sentul tidak boleh
// mengosongkan rak Serpong.
cek('§4 outlet lain tidak ikut dinolkan', await stok(BERAS, OUT2), 7000);
cek('§4 bahan BU lain yang tercatat di outlet ini tidak disentuh', await stok(LAIN2), 600);
// Stoknya dibaca PER OUTLET: bahan yang hanya ada di gudang sebelah tidak
// boleh "dinolkan" di sini — hasilnya akan minus untuk barang yang memang
// tidak pernah ada di outlet ini.
cek('§4 stok outlet lain tidak dibaca sebagai stok outlet ini', await stok(MINYAK), 0);
cek('§4 dan stok di outlet aslinya utuh', await stok(MINYAK, OUT2), 5000);
cek('§8 pratinjau cocok dengan yang benar-benar terjadi', Number(nTutup), 4);

// ============ JEJAKNYA ============
const otomatis = (await q(`select product_id, counted_qty, system_qty, otomatis, notes from stock_count_items where count_id=$1 and otomatis`, [SESI])).rows;
cek('§5 tiga baris lahir otomatis', otomatis.length, 3);
benar('§5 semuanya tercatat 0', otomatis.every((x) => Number(x.counted_qty) === 0));
benar('§5 dan menyebut sebabnya', otomatis.every((x) => /dianggap habis/.test(x.notes ?? '')));
// Dibedakan dari 0 yang benar-benar diketik orang di depan rak: keduanya nol,
// dan hanya satu yang berarti "sudah dilihat, memang habis".
const diketik = await satu(`select otomatis from stock_count_items where count_id=$1 and product_id=$2`, [SESI, BERAS]);
cek('§5 yang diketik orang tidak ikut bertanda otomatis', diketik.otomatis, false);
const catatan = await satu(`select notes from stock_movements where count_id=$1 and product_id=$2`, [SESI, GULA]);
benar('§5 pergerakannya menjelaskan dirinya', /tidak dihitung, dianggap habis/.test(catatan.notes ?? ''), catatan.notes);

// ===============================================================
console.log('§6 Stok sistem dibaca SAAT MENUTUP');
// ===============================================================
//
// Antara sesi dibuka dan ditutup bisa ada nota masuk. Yang dinolkan harus
// keadaan TERAKHIR — kalau dibaca dari potret saat sesi dibuka, sisa nota itu
// tertinggal di stok dan "dianggap habis" jadi bohong.
const SESI2 = (await satu(`select buka_opname($1,null) as id`, [OUT])).id;
await gerak(GULA, 2500); // nota masuk sesudah sesi dibuka
await q(`select catat_hitungan_opname($1,$2,$3,null,null)`, [SESI2, BERAS, 9500]);
await q(`select tutup_opname($1)`, [SESI2]);
cek('§6 sisa yang masuk di tengah sesi ikut dinolkan', await stok(GULA), 0);

// ===============================================================
console.log('§7 Sesi yang DIBATALKAN tidak menyentuh stok');
// ===============================================================
await gerak(GULA, 4000);
const SESI3 = (await satu(`select buka_opname($1,null) as id`, [OUT])).id;
await q(`select batalkan_opname($1,'tidak jadi dikerjakan')`, [SESI3]);
cek('§7 stok tidak berubah sama sekali', await stok(GULA), 4000);
cek(
  '§7 tidak ada baris otomatis yang lahir',
  Number((await satu(`select count(*)::int n from stock_count_items where count_id=$1`, [SESI3])).n),
  0
);

// ===============================================================
console.log('§9 Wewenang & dijalankan dua kali');
// ===============================================================
const SESI4 = (await satu(`select buka_opname($1,null) as id`, [OUT])).id;
await jadi(STAFF);
benar(
  '§9 staff tidak bisa menutup sesi',
  /Admin BU/.test(await galat(`select tutup_opname($1)`, [SESI4]) ?? '')
);
await jadi(ADMIN);
await q(`select tutup_opname($1)`, [SESI4]);
benar(
  '§9 menutup dua kali ditolak',
  /sudah ditutup/.test(await galat(`select tutup_opname($1)`, [SESI4]) ?? '')
);

const sebelum = await stok(GULA);
await jalankan('0182_opname_menyeluruh.sql');
cek('§9 migrationnya aman dijalankan ulang', await stok(GULA), sebelum);

console.log(`\n${gagal === 0 ? '✅' : '❌'} test-migrasi-0182: ${n - gagal}/${n} lulus`);
process.exit(gagal === 0 ? 0 : 1);
