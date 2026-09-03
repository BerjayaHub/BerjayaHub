/**
 * MIGRATION 0115 DI POSTGRES SUNGGUHAN (PGlite).
 *
 * ============ YANG DIUJI ============
 *
 * Bukan "apakah barisnya tersimpan" — itu selalu berhasil. Yang diuji adalah
 * ARTI dari ketiadaan baris, dan apa yang terjadi di perbatasannya:
 *
 *   1. Menu tanpa satu baris pun aktif di SEMUA outlet (tanpa backfill).
 *   2. Menu BARU dan outlet BARU langsung ikut wajar.
 *   3. `set_menu_outlet_massal` tidak boleh mengubah menu yang tidak dicentang
 *      menjadi "hanya outlet ini" — kesalahan yang akan mematikan menu itu di
 *      seluruh outlet lain sekaligus.
 *   4. Baris terakhir yang terhapus tidak boleh diam-diam membalik arti jadi
 *      "aktif di semua outlet".
 *   5. Staff tidak bisa mengubah apa pun, baik lewat RPC maupun lewat tabelnya.
 *
 * TIGA OUTLET, bukan dua. Dengan dua outlet, "didaftarkan ke seluruh outlet
 * lain" dan "didaftarkan ke satu outlet tertentu" menghasilkan keadaan yang
 * sama persis — dan sabotase apa pun di antara keduanya akan lolos.
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
const sebagai = (uid) => q(`select set_config('request.jwt.claim.sub', $1, false)`, [uid]);

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
    business_unit_id uuid, name text,
    product_type text default 'finished',
    is_active boolean default true
  );
  create table membership_scopes (user_id uuid, business_unit_id uuid, outlet_id uuid, role text);
  create table menu_plans (
    id uuid primary key default gen_random_uuid(),
    business_unit_id uuid, outlet_id uuid, product_id uuid,
    plan_date date not null, qty numeric not null default 0,
    unique (outlet_id, product_id, plan_date)
  );

  create role authenticated;

  create or replace function has_bu_scope(p_uid uuid, p_bu uuid) returns boolean language sql stable as $$
    select exists (select 1 from membership_scopes where user_id = p_uid and business_unit_id = p_bu);
  $$;
  create or replace function is_bu_admin(p_uid uuid, p_bu uuid) returns boolean language sql stable as $$
    select exists (select 1 from membership_scopes where user_id = p_uid and business_unit_id = p_bu and role in ('bu_admin','super_admin'));
  $$;
`);

const jalankan = async (b) =>
  db.exec(fs.readFileSync(path.join(AKAR, 'supabase/migrations', b), 'utf8').replace(/notify pgrst[^;]*;/g, ''));

await jalankan('0115_menu_aktif_per_outlet.sql');
await jalankan('0116_bersihkan_rencana_menu_nonaktif.sql');
console.log('  0115 -> 0116 terpasang.');
await jalankan('0116_bersihkan_rencana_menu_nonaktif.sql');
console.log('  dijalankan ulang: aman.');

// =====================================================================
// DATA
// =====================================================================
const BU = (await satu(`insert into business_units (name) values ('Cafe') returning id`)).id;
const BU2 = (await satu(`insert into business_units (name) values ('BU Lain') returning id`)).id;

const SERPONG = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Serpong') returning id`, [BU])).id;
const SENTUL = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Sentul') returning id`, [BU])).id;
const HAMPTON = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Hampton') returning id`, [BU])).id;
const LUAR = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Outlet BU Lain') returning id`, [BU2])).id;

const STAFF = '11111111-1111-1111-1111-111111111111';
const ADMIN = '22222222-2222-2222-2222-222222222222';
await q(`insert into user_profiles (id, full_name) values ($1,'Staff'),($2,'Admin')`, [STAFF, ADMIN]);
await q(`insert into membership_scopes (user_id, business_unit_id, outlet_id, role) values ($1,$2,$3,'staff')`, [STAFF, BU, SERPONG]);
await q(`insert into membership_scopes (user_id, business_unit_id, role) values ($1,$2,'bu_admin')`, [ADMIN, BU]);

const mkMenu = async (nama) =>
  (await satu(`insert into products (business_unit_id, name) values ($1,$2) returning id`, [BU, nama])).id;

const KOPI = await mkMenu('Kopi Susu');
const NASGOR = await mkMenu('Nasi Goreng');
const SPESIAL = await mkMenu('Menu Spesial');

const aktifDi = async (outlet) =>
  (await q(`select product_id from menu_aktif_outlet($1)`, [outlet])).rows.map((r) => r.product_id).sort();
const semuaMenu = [KOPI, NASGOR, SPESIAL].sort();

// =====================================================================
// §1. TANPA SATU BARIS PUN: semua menu aktif di semua outlet.
// =====================================================================
cek('§1 Serpong tanpa pengaturan', await aktifDi(SERPONG), semuaMenu);
cek('§1 Sentul tanpa pengaturan', await aktifDi(SENTUL), semuaMenu);
cek('§1 Hampton tanpa pengaturan', await aktifDi(HAMPTON), semuaMenu);

// =====================================================================
// §2. Dibatasi ke Sentul saja.
// =====================================================================
await sebagai(ADMIN);
await q(`select set_menu_outlet($1, $2::uuid[])`, [SPESIAL, [SENTUL]]);

cek('§2 Sentul tetap punya semua', await aktifDi(SENTUL), semuaMenu);
cek('§2 Serpong kehilangan yang dibatasi', await aktifDi(SERPONG), [KOPI, NASGOR].sort());
cek('§2 Hampton juga kehilangan', await aktifDi(HAMPTON), [KOPI, NASGOR].sort());

// =====================================================================
// §3. Menu BARU & outlet BARU langsung wajar — tanpa backfill.
// =====================================================================
const MENU_BARU = await mkMenu('Menu Baru');
benar('§3 menu baru muncul di semua outlet', (await aktifDi(SERPONG)).includes(MENU_BARU));
benar('§3 menu baru muncul di outlet lain juga', (await aktifDi(HAMPTON)).includes(MENU_BARU));

const OUTLET_BARU = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Cibubur') returning id`, [BU])).id;
const diBaru = await aktifDi(OUTLET_BARU);
benar('§3 outlet baru dapat menu yang tidak dibatasi', diBaru.includes(KOPI) && diBaru.includes(MENU_BARU));
benar(
  '§3 outlet baru TIDAK dapat menu yang dibatasi ke Sentul',
  !diBaru.includes(SPESIAL),
  'outlet baru tidak boleh mewarisi izin yang tidak pernah ditujukan kepadanya'
);

// =====================================================================
// §4. Kembali ke "semua outlet" — array kosong.
// =====================================================================
await q(`select set_menu_outlet($1, $2::uuid[])`, [SPESIAL, []]);
cek('§4 Serpong dapat lagi', await aktifDi(SERPONG), [KOPI, NASGOR, SPESIAL, MENU_BARU].sort());
cek(
  '§4 tidak ada baris tersisa',
  Number((await satu(`select count(*)::int n from menu_outlet_aktif where product_id = $1`, [SPESIAL])).n),
  0
);

// =====================================================================
// §5. Outlet dari BU LAIN ditolak — tidak diabaikan diam-diam.
// =====================================================================
let ditolakLuar = false;
try {
  await q(`select set_menu_outlet($1, $2::uuid[])`, [KOPI, [LUAR]]);
} catch {
  ditolakLuar = true;
}
benar(
  '§5 outlet BU lain ditolak',
  ditolakLuar,
  'menyimpannya membuat menu lenyap dari SEMUA outlet BU ini tanpa sebab yang terlihat'
);
cek('§5 dan tidak meninggalkan jejak', await aktifDi(SERPONG), [KOPI, NASGOR, SPESIAL, MENU_BARU].sort());

// =====================================================================
// §6. MASSAL — inilah bagian yang paling mudah salah.
//
// Di layar Serpong, semua dicentang KECUALI Nasi Goreng.
// =====================================================================
await q(`select set_menu_outlet_massal($1, $2::uuid[])`, [SERPONG, [KOPI, SPESIAL, MENU_BARU]]);

benar('§6 Nasi Goreng hilang dari Serpong', !(await aktifDi(SERPONG)).includes(NASGOR));
benar(
  '§6 Nasi Goreng TETAP ada di Sentul',
  (await aktifDi(SENTUL)).includes(NASGOR),
  'mencabut centang di layar Serpong hanya berarti "tidak dijual di Serpong"'
);
benar('§6 Nasi Goreng tetap ada di Hampton', (await aktifDi(HAMPTON)).includes(NASGOR));
benar('§6 Nasi Goreng tetap ada di outlet baru', (await aktifDi(OUTLET_BARU)).includes(NASGOR));

// Yang DICENTANG dan sebelumnya tidak dibatasi harus TETAP tidak dibatasi.
cek(
  '§6 INTI: menu dicentang yang belum dibatasi tidak jadi terkunci ke Serpong',
  Number((await satu(`select count(*)::int n from menu_outlet_aktif where product_id = $1`, [KOPI])).n),
  0
);
benar('§6 …sehingga Kopi tetap ada di Hampton', (await aktifDi(HAMPTON)).includes(KOPI));

// =====================================================================
// §7. Mencabut outlet TERAKHIR lewat massal: DITOLAK, bukan ditebak.
//
// Spesial dibatasi ke Sentul saja, lalu di layar Sentul ia tidak dicentang.
// Artinya "tidak dijual di mana pun" — dan model ini tidak punya bentuk untuk
// itu (tidak ada baris = di semua outlet).
//
// Percobaan pertama saya mendaftarkannya ke seluruh outlet LAIN. Hasilnya
// terbalik total: menu yang seharusnya berhenti dijual justru muncul di semua
// outlet yang tidak pernah menjualnya. Tes inilah yang menemukannya.
// =====================================================================
await q(`select set_menu_outlet($1, $2::uuid[])`, [SPESIAL, [SENTUL]]);
const menuSentul = (await aktifDi(SENTUL)).filter((m) => m !== SPESIAL);

let ditolakBuntu = false;
let pesanBuntu = '';
try {
  await q(`select set_menu_outlet_massal($1, $2::uuid[])`, [SENTUL, menuSentul]);
} catch (e) {
  ditolakBuntu = true;
  pesanBuntu = String(e.message ?? e);
}
benar('§7 INTI: mencabut outlet terakhir DITOLAK', ditolakBuntu);
benar(
  '§7 pesannya menyebut nama menunya',
  pesanBuntu.includes('Menu Spesial'),
  'daftar yang tidak menyebut menu mana memaksa admin menebak di antara 162 baris'
);
benar(
  '§7 penolakannya terjadi SEBELUM ada yang berubah',
  (await aktifDi(SENTUL)).includes(SPESIAL),
  'kalau sebagian sudah tersimpan, keadaannya jadi separuh jalan yang tidak pernah dimaksudkan siapa pun'
);
benar('§7 dan tidak bocor ke outlet lain', !(await aktifDi(SERPONG)).includes(SPESIAL));

// Jalan keluarnya: centang dulu outlet lain yang menjualnya.
await q(`select set_menu_outlet($1, $2::uuid[])`, [SPESIAL, [SENTUL, HAMPTON]]);
await q(`select set_menu_outlet_massal($1, $2::uuid[])`, [SENTUL, (await aktifDi(SENTUL)).filter((m) => m !== SPESIAL)]);
benar('§7 sesudah ada outlet lain, pencabutan berhasil', !(await aktifDi(SENTUL)).includes(SPESIAL));
benar('§7 dan Hampton tetap menjualnya', (await aktifDi(HAMPTON)).includes(SPESIAL));
benar('§7 Serpong tetap tidak', !(await aktifDi(SERPONG)).includes(SPESIAL));

// =====================================================================
// §8. Staff tidak bisa mengubah apa pun.
// =====================================================================
await sebagai(STAFF);
let ditolakRpc = false;
try {
  await q(`select set_menu_outlet($1, $2::uuid[])`, [KOPI, [SERPONG]]);
} catch {
  ditolakRpc = true;
}
benar('§8 staff ditolak RPC', ditolakRpc);

let ditolakMassal = false;
try {
  await q(`select set_menu_outlet_massal($1, $2::uuid[])`, [SERPONG, []]);
} catch {
  ditolakMassal = true;
}
benar('§8 staff ditolak RPC massal', ditolakMassal);

// Tabelnya sendiri tidak punya kebijakan tulis sama sekali.
const kebijakanTulis = Number(
  (
    await satu(
      `select count(*)::int n from pg_policies
        where tablename = 'menu_outlet_aktif' and cmd in ('INSERT','UPDATE','DELETE','ALL')`
    )
  ).n
);
cek(
  '§8 tidak ada kebijakan tulis di tabelnya',
  kebijakanTulis,
  0
);
benar(
  '§8 kebijakan baca ada',
  Number((await satu(`select count(*)::int n from pg_policies where tablename = 'menu_outlet_aktif' and cmd = 'SELECT'`)).n) >
    0,
  'Staff App harus bisa MEMBACA untuk menyaring layarnya sendiri'
);

// =====================================================================
// §9. Menu non-aktif / bukan menu tidak ikut terbawa.
// =====================================================================
await sebagai(ADMIN);
const BAHAN = (
  await satu(`insert into products (business_unit_id, name, product_type) values ($1,'Gula','raw') returning id`, [BU])
).id;
const MATI = (
  await satu(`insert into products (business_unit_id, name, is_active) values ($1,'Menu Lama', false) returning id`, [BU])
).id;
const diSerpong = await aktifDi(SERPONG);
benar('§9 bahan tidak ikut terdaftar sebagai menu', !diSerpong.includes(BAHAN));
benar('§9 menu non-aktif tidak ikut', !diSerpong.includes(MATI));

// =====================================================================
// §10. Menu BU lain tidak bocor.
// =====================================================================
const MENU_BU_LAIN = (
  await satu(`insert into products (business_unit_id, name) values ($1,'Menu BU Lain') returning id`, [BU2])
).id;
benar('§10 menu BU lain tidak muncul', !(await aktifDi(SERPONG)).includes(MENU_BU_LAIN));


// =====================================================================
// §11. 0116 — RENCANA MENU YANG SUDAH TIDAK DIJUAL IKUT DIBERSIHKAN.
//
// Ini akar keluhan "beras 17.280 gr tapi bahan habis": rencana untuk menu yang
// outletnya tidak jual tetap memotong stok, dan sesudah 0115 barisnya bahkan
// tidak tampil lagi — jadi penyebabnya tidak ada di layar mana pun.
// =====================================================================
await sebagai(ADMIN);
// Kembalikan semuanya ke "semua outlet" supaya §11 berdiri sendiri.
for (const m of [KOPI, NASGOR, SPESIAL, MENU_BARU]) {
  await q(`select set_menu_outlet($1, $2::uuid[])`, [m, []]);
}

const HARI_INI = `(now() at time zone 'Asia/Jakarta')::date`;
const isiRencana = (outlet, menu, hari, qty) =>
  q(
    `insert into menu_plans (business_unit_id, outlet_id, product_id, plan_date, qty)
     values ($1,$2,$3, ${HARI_INI} + $4::int, $5)
     on conflict (outlet_id, product_id, plan_date) do update set qty = excluded.qty`,
    [BU, outlet, menu, hari, qty]
  );
const rencanaAda = async (outlet, menu, hari) =>
  Number(
    (
      await satu(
        `select count(*)::int n from menu_plans
          where outlet_id = $1 and product_id = $2 and plan_date = ${HARI_INI} + $3::int`,
        [outlet, menu, hari]
      )
    ).n
  ) > 0;

await isiRencana(SERPONG, NASGOR, -3, 40); // KEMARIN — catatan, tidak boleh disentuh
await isiRencana(SERPONG, NASGOR, 0, 40); // hari ini
await isiRencana(SERPONG, NASGOR, 2, 25); // lusa
await isiRencana(SERPONG, KOPI, 0, 10); // menu yang TETAP dijual di Serpong
await isiRencana(SENTUL, NASGOR, 0, 15); // outlet LAIN, tidak boleh ikut terhapus

// Nasi Goreng dibatasi ke Sentul saja -> tidak lagi dijual di Serpong.
await q(`select set_menu_outlet($1, $2::uuid[])`, [NASGOR, [SENTUL]]);

benar('§11 rencana hari ini di Serpong terhapus', !(await rencanaAda(SERPONG, NASGOR, 0)));
benar('§11 rencana lusa di Serpong terhapus', !(await rencanaAda(SERPONG, NASGOR, 2)));
benar(
  '§11 INTI: rencana tanggal LAMPAU tidak disentuh',
  await rencanaAda(SERPONG, NASGOR, -3),
  'itu catatan tentang apa yang direncanakan hari itu, dan sudah tidak memengaruhi perhitungan mana pun'
);
benar(
  '§11 menu yang tetap dijual rencananya utuh',
  await rencanaAda(SERPONG, KOPI, 0),
  'pembersihan yang terlalu rakus menghapus pekerjaan orang yang tidak salah apa-apa'
);
benar(
  '§11 rencana di outlet LAIN tidak ikut terhapus',
  await rencanaAda(SENTUL, NASGOR, 0),
  'Sentul justru outlet yang masih menjualnya'
);

// Melonggarkan pembatasan TIDAK boleh menghapus apa pun.
await isiRencana(SERPONG, SPESIAL, 0, 7);
await q(`select set_menu_outlet($1, $2::uuid[])`, [SPESIAL, []]); // kembali ke semua outlet
benar(
  '§11 melonggarkan pembatasan tidak menghapus rencana',
  await rencanaAda(SERPONG, SPESIAL, 0),
  'kalau pembersihannya dijalankan SEBELUM pembatasan tersimpan, ia memakai aturan lama dan menghapus yang seharusnya tetap berlaku'
);

// Jalur MASSAL juga membersihkan.
await isiRencana(HAMPTON, KOPI, 0, 12);
const menuHampton = (await aktifDi(HAMPTON)).filter((m) => m !== KOPI);
await q(`select set_menu_outlet_massal($1, $2::uuid[])`, [HAMPTON, menuHampton]);
benar('§11 jalur massal ikut membersihkan', !(await rencanaAda(HAMPTON, KOPI, 0)));
benar(
  '§11 …tanpa menyentuh outlet lain',
  await rencanaAda(SERPONG, KOPI, 0),
  'Serpong tidak disebut sama sekali dalam pemanggilan itu'
);

if (gagal === 0) console.log('Migration 0115 + 0116: semua pemeriksaan lulus. ✅');
process.exit(gagal === 0 ? 0 : 1);
