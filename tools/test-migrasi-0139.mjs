/**
 * MIGRATION 0139 DI POSTGRES SUNGGUHAN (PGlite).
 *
 * ============ YANG DIUJI ============
 *
 *   1. `p_outlet_id` menyaring ke staff yang CAKUPANNYA di outlet itu.
 *   2. `null` mengembalikan seluruh BU — perilaku sebelum 0139 tidak berubah.
 *   3. Cakupan level BU (outlet_id null) TIDAK ikut saat outlet dipilih.
 *   4. HANYA ADA SATU bentuk fungsinya. Dua bentuk yang hidup berdampingan
 *      membuat panggilan dua argumen jadi AMBIGU dan ditolak PostgREST — yang
 *      mematikan setiap layar yang memakai daftar staff, bukan cuma laporannya.
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

await db.exec(`
  create role authenticated;
  create schema if not exists auth;
  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
  $$;

  create table business_units (id uuid primary key default gen_random_uuid(), name text);
  create table outlets (id uuid primary key default gen_random_uuid(), business_unit_id uuid, name text);
  create table user_profiles (id uuid primary key, full_name text, is_active boolean default true);
  create table membership_scopes (
    id uuid primary key default gen_random_uuid(),
    user_id uuid, business_unit_id uuid, outlet_id uuid, role text);

  create or replace function is_bu_admin(p_uid uuid, p_bu uuid) returns boolean
    language sql stable as $$ select p_uid is not null $$;

  -- Bentuk LAMA (dua argumen) sengaja dipasang dulu, supaya yang diuji adalah
  -- bahwa 0139 benar-benar MEMBUANGNYA.
  create or replace function list_bu_staff_for_admin(p_business_unit_id uuid, p_include_inactive boolean default false)
  returns table (user_id uuid, full_name text, is_active boolean)
  language sql security definer stable set search_path = public as $fn$
    select distinct ms.user_id, up.full_name, up.is_active
      from membership_scopes ms join user_profiles up on up.id = ms.user_id
     where ms.business_unit_id = p_business_unit_id;
  $fn$;
`);

const jalankan = async (b) =>
  db.exec(fs.readFileSync(path.join(AKAR, 'supabase/migrations', b), 'utf8').replace(/notify pgrst[^;]*;/g, ''));

await jalankan('0139_staff_per_outlet_basis.sql');
console.log('  0139 terpasang.');
await jalankan('0139_staff_per_outlet_basis.sql');
console.log('  dijalankan ulang: aman.');

const BU = (await satu(`insert into business_units (name) values ('Cafe') returning id`)).id;
const SERPONG = (await satu(`insert into outlets (business_unit_id, name) values ($1,'AB Gading Serpong') returning id`, [BU])).id;
const SENTUL = (await satu(`insert into outlets (business_unit_id, name) values ($1,'AB Sentul') returning id`, [BU])).id;

const ADHE = '11111111-1111-1111-1111-111111111111';
const RISMA = '22222222-2222-2222-2222-222222222222';
const IKO = '33333333-3333-3333-3333-333333333333';
const NONAKTIF = '44444444-4444-4444-4444-444444444444';
await q(
  `insert into user_profiles (id, full_name, is_active) values
     ($1,'Adhe',true), ($2,'Risma',true), ($3,'iko permadi',true), ($4,'Mantan',false)`,
  [ADHE, RISMA, IKO, NONAKTIF]
);
await q(
  `insert into membership_scopes (user_id, business_unit_id, outlet_id, role) values
     ($1,$5,$6,'staff'),   -- Adhe di Serpong
     ($2,$5,$7,'staff'),   -- Risma di Sentul
     ($3,$5,null,'admin'), -- iko: cakupan level BU
     ($4,$5,$6,'staff')`,  -- Mantan (nonaktif) di Serpong
  [ADHE, RISMA, IKO, NONAKTIF, BU, SERPONG, SENTUL]
);
await q(`select set_config('request.jwt.claim.sub', $1, false)`, [IKO]);

const nama = async (sql, params) => (await q(sql, params)).rows.map((r) => r.full_name).sort();

// =====================================================================
// §1 TANPA FILTER OUTLET — perilaku sebelum 0139 tidak berubah
// =====================================================================
cek('§1 tanpa outlet: seluruh staff aktif BU', await nama(`select * from list_bu_staff_for_admin($1)`, [BU]), [
  'Adhe',
  'Risma',
  'iko permadi'
]);
cek(
  '§1 includeInactive membawa yang nonaktif',
  await nama(`select * from list_bu_staff_for_admin($1, true)`, [BU]),
  ['Adhe', 'Mantan', 'Risma', 'iko permadi']
);
cek(
  '§1 p_outlet_id null sama dengan tidak mengirimnya',
  await nama(`select * from list_bu_staff_for_admin($1, false, null)`, [BU]),
  ['Adhe', 'Risma', 'iko permadi']
);

// =====================================================================
// §2 DENGAN FILTER OUTLET — inti perbaikannya
// =====================================================================
cek('§2 Serpong: hanya Adhe', await nama(`select * from list_bu_staff_for_admin($1, false, $2)`, [BU, SERPONG]), ['Adhe']);
cek('§2 Sentul: hanya Risma', await nama(`select * from list_bu_staff_for_admin($1, false, $2)`, [BU, SENTUL]), ['Risma']);

// Cakupan level BU TIDAK ikut: orang seperti ini bisa ditugaskan ke outlet mana
// pun, jadi memasukkannya mengembalikan daftar panjang yang sedang dipersempit.
// Yang benar-benar bekerja di sana tetap muncul karena layar menambahkan siapa
// pun yang punya presensi di outlet itu.
benar(
  '§2 cakupan level BU tidak ikut saat outlet dipilih',
  !(await nama(`select * from list_bu_staff_for_admin($1, false, $2)`, [BU, SERPONG])).includes('iko permadi')
);

cek(
  '§2 nonaktif tetap bisa diminta per outlet',
  await nama(`select * from list_bu_staff_for_admin($1, true, $2)`, [BU, SERPONG]),
  ['Adhe', 'Mantan']
);

// Outlet yang tidak punya siapa pun -> kosong, bukan seluruh BU.
const OUT_KOSONG = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Baru') returning id`, [BU])).id;
cek('§2 outlet tanpa staff: kosong', await nama(`select * from list_bu_staff_for_admin($1, false, $2)`, [BU, OUT_KOSONG]), []);

// =====================================================================
// §3 TEPAT SATU BENTUK FUNGSINYA
//
// Kalau bentuk dua-argumen dibiarkan hidup bersama bentuk tiga-argumen yang
// berdefault, panggilan dua argumen jadi ambigu dan ditolak — mematikan SETIAP
// layar yang memakai daftar staff, bukan cuma laporannya.
// =====================================================================
const bentuk = (
  await q(
    `select p.pronargs from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'list_bu_staff_for_admin'`
  )
).rows;
cek('§3 hanya ada satu bentuk', bentuk.length, 1);
cek('§3 dan ia berargumen tiga', Number(bentuk[0]?.pronargs), 3);

if (gagal) {
  console.error(`\n${gagal} kasus gagal.`);
  process.exit(1);
}
console.log('0139 benar — daftar staff bisa disaring per outlet basis, dan bentuk lamanya benar-benar dibuang. ✅');
