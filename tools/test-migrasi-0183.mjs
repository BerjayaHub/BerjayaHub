/**
 * MIGRATION 0183 — MASTER SATUAN UNTUK ADMIN BU & ADMIN OUTLET.
 *
 * ============ APA YANG DIBUKTIKAN ============
 *
 *   §1 Yang DITOLAK sebelum 0183 memang admin BU — bukan soal outlet basis.
 *   §2 Admin BU & admin outlet bisa menambah, di BU mana pun.
 *   §3 Staff biasa tetap tidak bisa.
 *   §4 Nama dirapikan, dan yang sudah ada tidak jadi baris kedua.
 *   §5 Menghapus: super admin bebas, pembuatnya terbatas, yang lain ditolak.
 *   §6 Satuan yang SUDAH DIPAKAI produk tidak bisa dihapus pembuatnya.
 *   §7 Satuan bawaan (tanpa pembuat) hanya super admin yang bisa membuang.
 *   §8 Policy tulis langsung TETAP tertutup untuk admin BU.
 *   §9 Dijalankan dua kali tetap aman.
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
    user_id uuid, business_unit_id uuid, outlet_id uuid, role text, is_primary boolean default false);
  create table products (id uuid primary key default gen_random_uuid(),
    business_unit_id uuid, name text, base_unit text, purchase_unit text);

  create or replace function is_super_admin(p_uid uuid) returns boolean
    language sql security definer stable as $x$
      select exists (select 1 from membership_scopes ms
        where ms.user_id = p_uid and ms.role = 'super_admin') $x$;
`);

// Tabel `units` + policy 0019 APA ADANYA — §1 & §8 menguji keadaan yang
// sebenarnya, bukan tiruan yang sudah dilonggarkan.
await db.exec(
  fs.readFileSync(path.join(AKAR, 'supabase/migrations/0019_units_and_opname_toggle.sql'), 'utf8')
    .replace(/notify pgrst[^;]*;/g, '')
    // Bagian toggle opname menyentuh `business_units` lewat fungsi yang tidak
    // ada di sini; yang diuji berkas ini cuma master satuannya.
    .replace(/-- ---- Toggle opname staff per BU ----[\s\S]*$/, '')
);
await db.exec(`
  alter table units force row level security;
  grant select, insert, update, delete on units to authenticated;
  grant usage on schema public to authenticated;
`);

const BU_ADMIN_BU = (await satu(`insert into business_units (name) values ('Admin') returning id`)).id;
const BU_CAFE = (await satu(`insert into business_units (name) values ('Awal Bermula') returning id`)).id;
const OUT_ADMIN = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Gudang Admin') returning id`, [BU_ADMIN_BU])).id;
const OUT_CAFE = (await satu(`insert into outlets (business_unit_id, name) values ($1,'AB Sentul') returning id`, [BU_CAFE])).id;

const SUPER = '11111111-1111-1111-1111-111111111111';
const DUA_BU = '22222222-2222-2222-2222-222222222222'; // kasus yang dilaporkan
const ADM_OUTLET = '33333333-3333-3333-3333-333333333333';
const STAFF = '44444444-4444-4444-4444-444444444444';
await q(
  `insert into user_profiles (id, full_name) values ($1,'Super'),($2,'Admin Dua BU'),($3,'Admin Outlet'),($4,'Budi')`,
  [SUPER, DUA_BU, ADM_OUTLET, STAFF]
);
await q(`insert into membership_scopes (user_id, business_unit_id, outlet_id, role) values ($1,null,null,'super_admin')`, [SUPER]);
// PERSIS kasus yang dilaporkan: admin BU di dua BU — yang satu outlet basisnya,
// yang satu bukan.
await q(
  `insert into membership_scopes (user_id, business_unit_id, outlet_id, role, is_primary) values
     ($1,$2,$3,'bu_admin',true), ($1,$4,null,'bu_admin',false)`,
  [DUA_BU, BU_ADMIN_BU, OUT_ADMIN, BU_CAFE]
);
await q(`insert into membership_scopes (user_id, business_unit_id, outlet_id, role) values ($1,$2,$3,'outlet_admin')`, [ADM_OUTLET, BU_CAFE, OUT_CAFE]);
await q(`insert into membership_scopes (user_id, business_unit_id, outlet_id, role) values ($1,$2,$3,'staff')`, [STAFF, BU_CAFE, OUT_CAFE]);

const jumlah = async (nama) =>
  Number((await satu(`select count(*)::int n from units where lower(btrim(name)) = lower($1)`, [nama])).n);

// ===============================================================
console.log('§1 Sebelum 0183: admin BU memang ditolak');
// ===============================================================
await jadi(DUA_BU);
// Dijalankan sebagai peran `authenticated`, bukan pemilik tabel: Postgres
// MELEWATI RLS untuk pemilik, dan tanpa ini §1 & §8 hijau untuk policy yang
// tidak pernah dijalankan.
await q(`set role authenticated`);
const tolakLama = await galat(`insert into units (name) values ('karung besar')`);
benar('§1 insert langsung ditolak RLS', tolakLama !== null, 'justru berhasil — policy 0019 tidak terpasang di tes ini');
await q(`reset role`);
cek('§1 dan satuannya memang tidak masuk', await jumlah('karung besar'), 0);

const jalankan = async (b) =>
  db.exec(fs.readFileSync(path.join(AKAR, 'supabase/migrations', b), 'utf8').replace(/notify pgrst[^;]*;/g, ''));
await jalankan('0183_master_satuan_untuk_admin.sql');

console.log('§0 Migrationnya jalan');
for (const fn of ['adalah_admin', 'tambah_satuan', 'hapus_satuan']) {
  benar(`§0 \`${fn}\` ada`, (await satu(`select count(*)::int n from pg_proc where proname=$1`, [fn])).n > 0);
}

// ===============================================================
console.log('§2 Admin BU & admin outlet bisa menambah');
// ===============================================================
await jadi(DUA_BU);
const h1 = (await satu(`select tambah_satuan('karung besar') as h`)).h;
cek('§2 admin BU berhasil menambah', h1.baru, true);
cek('§2 satuannya benar-benar masuk', await jumlah('karung besar'), 1);
// Inti permintaannya: BU kedua BUKAN outlet basisnya, dan itu tidak
// berpengaruh — `units` memang tidak punya BU sama sekali.
const basis = await satu(`select count(*)::int n from membership_scopes where user_id=$1 and is_primary`, [DUA_BU]);
cek('§2 (orangnya memang punya satu basis saja)', basis.n, 1);

await jadi(ADM_OUTLET);
cek('§2 admin outlet juga bisa', (await satu(`select tambah_satuan('jerigen') as h`)).h.baru, true);

// ===============================================================
console.log('§3 Staff biasa tetap tidak bisa');
// ===============================================================
await jadi(STAFF);
benar('§3 staff ditolak', /admin/i.test(await galat(`select tambah_satuan('ember')`) ?? ''));
cek('§3 dan tidak ada yang masuk', await jumlah('ember'), 0);
await jadi(null);
benar('§3 tanpa login ditolak', /login/i.test(await galat(`select tambah_satuan('ember')`) ?? ''));

// ===============================================================
console.log('§4 Nama dirapikan & tidak jadi baris kedua');
// ===============================================================
await jadi(DUA_BU);
cek('§4 spasi tepi dibuang', (await satu(`select tambah_satuan('  lusin  ') as h`)).h.nama, 'lusin');
cek('§4 spasi ganda dirapatkan', (await satu(`select tambah_satuan('karung   kecil') as h`)).h.nama, 'karung kecil');
// "Gram" vs "gram": yang mengetiknya memang ingin satuan gram. Menolaknya
// dengan "sudah ada" membuat orang mengetik variasi lain sampai lolos —
// persis cara daftar ini jadi berantakan.
const ulang = (await satu(`select tambah_satuan('Gram') as h`)).h;
cek('§4 huruf besar-kecil tidak membuat baris baru', ulang.baru, false);
cek('§4 dan yang dikembalikan nama aslinya', ulang.nama, 'gram');
cek('§4 jumlah barisnya tetap satu', await jumlah('gram'), 1);
benar('§4 nama kosong ditolak', /wajib/i.test(await galat(`select tambah_satuan('   ')`) ?? ''));
benar('§4 nama kepanjangan ditolak', /panjang/i.test(await galat(`select tambah_satuan(repeat('x', 40))`) ?? ''));

// ===============================================================
console.log('§5–§7 Menghapus');
// ===============================================================
const idDari = async (nama) => (await satu(`select id from units where lower(btrim(name)) = lower($1)`, [nama])).id;

// Pembuatnya boleh menghapus miliknya sendiri yang belum dipakai.
await jadi(DUA_BU);
cek('§5 pembuatnya boleh menghapus miliknya', await galat(`select hapus_satuan($1)`, [await idDari('karung kecil')]), null);
cek('§5 dan barisnya benar-benar hilang', await jumlah('karung kecil'), 0);

// Milik orang lain: ditolak, dengan kalimat yang menyebut jalan keluarnya.
const JERIGEN = await idDari('jerigen');
const tolakMilikLain = await galat(`select hapus_satuan($1)`, [JERIGEN]);
benar('§5 satuan buatan orang lain ditolak', /bukan kamu/i.test(tolakMilikLain ?? ''), tolakMilikLain);
benar('§5 penolakannya menyebut jalan keluarnya', /Super Admin/i.test(tolakMilikLain ?? ''));

// §6 dipakai produk -> ditolak. Produknya tidak ikut hilang kalau satuannya
// dibuang, ia cuma tidak bisa dipilih lagi — dan yang menyuntingnya akan
// mengira datanya rusak.
await q(`insert into products (business_unit_id, name, base_unit) values ($1,'Beras','karung besar')`, [BU_CAFE]);
const tolakDipakai = await galat(`select hapus_satuan($1)`, [await idDari('karung besar')]);
benar('§6 satuan yang sudah dipakai produk ditolak', /dipakai/i.test(tolakDipakai ?? ''), tolakDipakai);
benar('§6 penolakannya menyebut berapa produk', /1 produk/.test(tolakDipakai ?? ''), tolakDipakai);
cek('§6 dan satuannya masih ada', await jumlah('karung besar'), 1);

// §7 bawaan 0019 tidak punya pembuat.
await jadi(ADM_OUTLET);
benar('§7 satuan bawaan ditolak untuk admin biasa', /bukan kamu/i.test(await galat(`select hapus_satuan($1)`, [await idDari('pcs')]) ?? ''));
await jadi(STAFF);
benar('§7 staff ditolak menghapus', /admin/i.test(await galat(`select hapus_satuan($1)`, [JERIGEN]) ?? ''));

// Super admin: bebas, termasuk yang sudah dipakai produk.
await jadi(SUPER);
cek('§7 super admin boleh menghapus milik orang lain', await galat(`select hapus_satuan($1)`, [JERIGEN]), null);
cek('§7 super admin boleh menghapus yang sudah dipakai', await galat(`select hapus_satuan($1)`, [await idDari('karung besar')]), null);
benar('§7 satuan yang tidak ada ditolak', /tidak ditemukan/i.test(await galat(`select hapus_satuan(gen_random_uuid())`) ?? ''));

// ===============================================================
console.log('§8 Jalan masuk langsung tetap tertutup');
// ===============================================================
//
// Kalau policy-nya ikut dilonggarkan, PWA lama (yang memakai `.insert()`
// langsung) akan melewati perapian nama dan pemeriksaan pemakaian — dan
// justru PWA lama yang tidak tahu aturan barunya.
await jadi(DUA_BU);
await q(`set role authenticated`);
benar('§8 insert langsung masih ditolak untuk admin BU', (await galat(`insert into units (name) values ('Gram ')`)) !== null);
benar('§8 delete langsung tidak menghapus apa pun', (await galat(`delete from units where lower(name) = 'gram'`)) === null);
await q(`reset role`);
cek('§8 dan "gram" masih ada', await jumlah('gram'), 1);

// ===============================================================
console.log('§9 Dijalankan dua kali');
// ===============================================================
const sebelum = Number((await satu(`select count(*)::int n from units`)).n);
await jalankan('0183_master_satuan_untuk_admin.sql');
cek('§9 jumlah satuan tidak berubah', Number((await satu(`select count(*)::int n from units`)).n), sebelum);
await jadi(DUA_BU);
cek('§9 fungsinya masih jalan', (await satu(`select tambah_satuan('peti') as h`)).h.baru, true);

console.log(`\n${gagal === 0 ? '✅' : '❌'} test-migrasi-0183: ${n - gagal}/${n} lulus`);
process.exit(gagal === 0 ? 0 : 1);
