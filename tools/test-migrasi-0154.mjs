/**
 * MIGRATION 0154 DI POSTGRES SUNGGUHAN (PGlite).
 *
 * ============ KEADAAN YANG DIBUKTIKAN DULU ============
 *
 * §0 menjalankan `0050` apa adanya dan memperlihatkan bugnya: staff Serpong
 * BISA membaca baris aset Central Kitchen (satu BU) dan TIDAK BISA membaca
 * objek fotonya. Dua aturan untuk satu layar.
 *
 * Tanpa §0, "sesudahnya bisa" tidak membuktikan apa-apa — bisa saja ia memang
 * sudah bisa sejak awal dan migration ini tidak mengubah apa pun.
 *
 * ============ SISANYA ============
 *
 *   §1 Sesudah 0154: fotonya terbaca sejauh barisnya terbaca.
 *   §2 Yang DILONGGARKAN hanya MELIHAT — tulis & hapus tetap per outlet.
 *   §3 BU lain tetap tertutup. Ini bukan "semua orang boleh lihat semua".
 *   §4 Nama objek yang bentuknya bukan `{uuid}/…` menolak, bukan menggagalkan
 *      seluruh query.
 *   §5 Dijalankan dua kali tetap aman.
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
const jadi = async (uid) => q(`select set_config('request.jwt.claim.sub', $1, false)`, [uid ?? '']);

/**
 * BERPERAN SEBAGAI `authenticated`, bukan sebagai pemilik tabel.
 *
 * ============ SUPERUSER MELEWATI RLS, TITIK ============
 *
 * PGlite menjalankan semuanya sebagai `postgres` — dan superuser melewati Row
 * Level Security SELURUHNYA, bahkan dengan `force row level security`. FORCE
 * cuma mengikat PEMILIK tabel; ia tidak berlaku untuk superuser.
 *
 * Tanpa `set role`, setiap SELECT di bawah mengembalikan semuanya dan setiap
 * INSERT diterima — dan seluruh berkas ini akan hijau untuk kebijakan yang
 * tidak ada sama sekali. Percobaan pertama memang begitu: §0 melaporkan
 * "Risma bisa membaca foto Central Kitchen" SEBELUM 0154 dipasang, yang
 * mustahil kalau 0050 sungguh berlaku.
 *
 * Migration dijalankan sebagai PEMILIK (butuh hak DDL), pemeriksaannya sebagai
 * `authenticated`.
 */
const sebagaiStaff = () => db.exec('set role authenticated;');
const sebagaiPemilik = () => db.exec('reset role;');

await db.exec(`
  create role authenticated;
  create schema if not exists auth;
  create schema if not exists storage;
  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
  $$;

  create table membership_scopes (
    id uuid primary key default gen_random_uuid(),
    user_id uuid, business_unit_id uuid, outlet_id uuid, role text);
  create table business_units (id uuid primary key default gen_random_uuid(), name text);
  create table outlets (id uuid primary key default gen_random_uuid(), business_unit_id uuid, name text);
  create table user_profiles (id uuid primary key, full_name text);

  create table assets (
    id uuid primary key default gen_random_uuid(),
    business_unit_id uuid, outlet_id uuid, name text, photo_path text);

  -- Tiruan "storage.objects" seperlunya: yang diuji kebijakannya, bukan
  -- Storage-nya.
  --
  -- (Tanda kutip, BUKAN backtick. Satu backtick di dalam template literal JS
  --  mengakhirinya di tengah SQL — ini kelima kalinya di repo ini.)
  create table storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text,
    name text);

  create or replace function has_bu_scope(p_user_id uuid, p_business_unit_id uuid) returns boolean
    language sql security definer stable as $$
      select exists (select 1 from membership_scopes
        where user_id = p_user_id
          and (role = 'super_admin' or business_unit_id = p_business_unit_id)) $$;
  create or replace function has_outlet_scope(p_user_id uuid, p_outlet_id uuid) returns boolean
    language sql security definer stable as $$
      select exists (select 1 from membership_scopes ms
        left join outlets o on o.id = p_outlet_id
        where ms.user_id = p_user_id
          and (ms.role = 'super_admin'
               or ms.outlet_id = p_outlet_id
               or (ms.role = 'bu_admin' and ms.business_unit_id = o.business_unit_id))) $$;
  create or replace function is_admin_of_outlet(p_user_id uuid, p_outlet_id uuid) returns boolean
    language sql security definer stable as $$
      select exists (select 1 from membership_scopes ms
        left join outlets o on o.id = p_outlet_id
        where ms.user_id = p_user_id
          and (ms.role = 'super_admin'
               or (ms.role = 'bu_admin' and ms.business_unit_id = o.business_unit_id))) $$;

  alter table assets enable row level security;
  alter table storage.objects enable row level security;

  -- "FORCE", DAN INI BUKAN KERAPIAN.
  --
  -- Postgres MELEWATI RLS untuk PEMILIK tabel, dan di PGlite seluruh perintah
  -- berjalan sebagai pemiliknya. Tanpa dua baris ini, setiap SELECT di bawah
  -- mengembalikan SEMUANYA dan setiap INSERT diterima — jadi tesnya akan
  -- hijau untuk kebijakan yang tidak ada sama sekali.
  --
  -- Percobaan pertama memang begitu: §0 melaporkan "Risma bisa membaca foto
  -- Central Kitchen" SEBELUM 0154 dipasang, yang mustahil kalau 0050 sungguh
  -- berlaku. Kegagalan itulah yang menunjukkan harness-nya yang kurang.
  --
  -- (Tanda kutip di komentar ini, bukan backtick — lihat catatan di atas.)
  alter table assets force row level security;
  alter table storage.objects force row level security;

  -- Kebijakan baris aset, APA ADANYA dari 0045. Inilah pembandingnya: foto
  -- seharusnya terlihat sejauh baris ini terlihat.
  create policy assets_select on assets
    for select to authenticated using (has_bu_scope(auth.uid(), business_unit_id));

  grant usage on schema storage to authenticated;
  grant select, insert, update, delete on storage.objects to authenticated;
  grant select on assets to authenticated;
  grant usage on schema public to authenticated;
`);

const jalankan = async (b) => {
  await sebagaiPemilik();
  await db.exec(fs.readFileSync(path.join(AKAR, 'supabase/migrations', b), 'utf8').replace(/notify pgrst[^;]*;/g, ''));
};

const BU = (await satu(`insert into business_units (name) values ('Awal Bermula') returning id`)).id;
const BU2 = (await satu(`insert into business_units (name) values ('BU Lain') returning id`)).id;
const SERPONG = (await satu(`insert into outlets (business_unit_id, name) values ($1,'AB Gading Serpong') returning id`, [BU])).id;
const CK = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Central Kitchen') returning id`, [BU])).id;
const LUAR = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Outlet BU Lain') returning id`, [BU2])).id;

const RISMA = '22222222-2222-2222-2222-222222222222';
const ORANG_LUAR = '44444444-4444-4444-4444-444444444444';
await q(`insert into user_profiles (id, full_name) values ($1,'Risma'), ($2,'Orang Luar')`, [RISMA, ORANG_LUAR]);
// Risma: staff di SERPONG saja — cakupan outletnya satu, cakupan BU-nya penuh.
await q(`insert into membership_scopes (user_id, business_unit_id, outlet_id, role) values ($1,$2,$3,'staff')`, [RISMA, BU, SERPONG]);
await q(`insert into membership_scopes (user_id, business_unit_id, outlet_id, role) values ($1,$2,$3,'staff')`, [ORANG_LUAR, BU2, LUAR]);

const ASET_CK = (
  await satu(`insert into assets (business_unit_id, outlet_id, name, photo_path) values ($1,$2,'Kompor CK',$3) returning id`, [
    BU,
    CK,
    `${CK}/aset-ck.jpg`
  ])
).id;
await q(`insert into storage.objects (bucket_id, name) values ('asset-photos', $1)`, [`${CK}/aset-ck.jpg`]);
await q(`insert into storage.objects (bucket_id, name) values ('asset-photos', $1)`, [`${SERPONG}/aset-serpong.jpg`]);
await q(`insert into storage.objects (bucket_id, name) values ('asset-photos', $1)`, [`${LUAR}/aset-luar.jpg`]);
// Nama yang bentuknya BUKAN `{uuid}/…` — `0050` menulis penjaga khusus untuk
// ini, dan penjaganya harus tetap hidup.
await q(`insert into storage.objects (bucket_id, name) values ('asset-photos', 'sampah.jpg')`);

const bisaBaca = async (nama) =>
  Number((await satu(`select count(*)::int as n from storage.objects where bucket_id = 'asset-photos' and name = $1`, [nama])).n) > 0;

console.log('§0 Bugnya dibuktikan dulu, dengan 0050 apa adanya');

await jalankan('0050_asset_photo_rls_fix.sql');
await sebagaiStaff();
await jadi(RISMA);

cek(
  '§0 Risma MELIHAT baris aset Central Kitchen — satu BU',
  Number((await satu(`select count(*)::int as n from assets where id = $1`, [ASET_CK])).n),
  1
);
benar(
  '§0 INTI: …dan TIDAK bisa membaca objek fotonya. Dua aturan untuk satu layar.',
  (await bisaBaca(`${CK}/aset-ck.jpg`)) === false
);
benar('§0 foto outlet sendiri memang bisa', (await bisaBaca(`${SERPONG}/aset-serpong.jpg`)) === true);

await jalankan('0154_foto_aset_terlihat_se_bu.sql');
await sebagaiStaff();
console.log('  0154 terpasang.');

console.log('\n§1 Foto terbaca sejauh barisnya terbaca');

benar('§1 INTI: Risma sekarang bisa membaca foto aset Central Kitchen', (await bisaBaca(`${CK}/aset-ck.jpg`)) === true);
benar('§1 foto outlet sendiri tetap bisa', (await bisaBaca(`${SERPONG}/aset-serpong.jpg`)) === true);

console.log('\n§2 Yang dilonggarkan HANYA melihat');

// Mengunggah ke folder outlet LAIN tetap ditolak. Melonggarkannya sekalian
// "karena kebetulan sedang menyentuh berkas yang sama" adalah cara paling
// sering sebuah izin melebar tanpa ada yang memutuskan.
let tulisDitolak = false;
try {
  await q(`insert into storage.objects (bucket_id, name) values ('asset-photos', $1)`, [`${CK}/baru.jpg`]);
} catch {
  tulisDitolak = true;
}
benar('§2 INTI: Risma tetap TIDAK bisa mengunggah foto ke folder Central Kitchen', tulisDitolak);

const nUbah = (await q(`update storage.objects set name = name where bucket_id = 'asset-photos' and name = $1`, [`${CK}/aset-ck.jpg`]))
  .affectedRows;
cek('§2 …dan tidak bisa menimpanya', nUbah, 0);

const nHapus = (await q(`delete from storage.objects where bucket_id = 'asset-photos' and name = $1`, [`${CK}/aset-ck.jpg`])).affectedRows;
cek('§2 …dan tidak bisa menghapusnya', nHapus, 0);
// Dipastikan barisnya MEMANG masih ada. `affectedRows` 0 bisa juga berarti
// barisnya sudah tidak ada sejak awal — dan pemeriksaan yang lolos karena
// sasarannya lenyap tidak membuktikan apa pun.
benar('§2 …dan barisnya memang masih ada', (await bisaBaca(`${CK}/aset-ck.jpg`)) === true);

// Yang di outletnya sendiri tetap boleh ditulis — kalau tidak, staff berhenti
// bisa memfoto barang di tempatnya sendiri.
await q(`insert into storage.objects (bucket_id, name) values ('asset-photos', $1)`, [`${SERPONG}/baru.jpg`]);
benar('§2 foto di outletnya sendiri tetap bisa diunggah', (await bisaBaca(`${SERPONG}/baru.jpg`)) === true);

console.log('\n§3 BU lain tetap tertutup');

benar('§3 INTI: Risma tidak bisa membaca foto BU lain', (await bisaBaca(`${LUAR}/aset-luar.jpg`)) === false);

await jadi(ORANG_LUAR);
benar('§3 orang BU lain tidak bisa membaca foto BU ini', (await bisaBaca(`${CK}/aset-ck.jpg`)) === false);
benar('§3 …tapi bisa membaca fotonya sendiri', (await bisaBaca(`${LUAR}/aset-luar.jpg`)) === true);

await jadi(null);
benar('§3 tanpa sesi: tidak ada yang terbaca', (await bisaBaca(`${CK}/aset-ck.jpg`)) === false);

console.log('\n§4 Nama objek yang bentuknya salah');

await jadi(RISMA);
// Penjaga bentuk path dari 0050. Tanpa `asset_photo_outlet`, cast `::uuid`
// atas 'sampah.jpg' menjatuhkan SELURUH query — bukan sekadar menolak satu
// baris, jadi tabel foto siapa pun ikut kosong.
let jatuh = false;
let jumlahTerlihat = 0;
try {
  jumlahTerlihat = Number((await satu(`select count(*)::int as n from storage.objects where bucket_id = 'asset-photos'`)).n);
} catch {
  jatuh = true;
}
benar('§4 INTI: objek bernama tanpa prefix uuid tidak menjatuhkan query-nya', jatuh === false);
benar('§4 …dan ia sendiri tidak terbaca', (await bisaBaca('sampah.jpg')) === false);
benar('§4 yang boleh dibaca tetap terbaca', jumlahTerlihat >= 2, `terlihat ${jumlahTerlihat}`);

console.log('\n§5 Dijalankan ulang');

await jalankan('0154_foto_aset_terlihat_se_bu.sql');
await sebagaiStaff();
benar('§5 aman dijalankan dua kali', (await bisaBaca(`${CK}/aset-ck.jpg`)) === true);
cek(
  '§5 policy SELECT-nya tetap satu, tidak digandakan',
  Number((await satu(`select count(*)::int as n from pg_policies where policyname = 'asset_photo_select'`)).n),
  1
);
cek(
  '§5 ketiga policy lain tidak tersentuh',
  Number(
    (
      await satu(
        `select count(*)::int as n from pg_policies where policyname in ('asset_photo_insert','asset_photo_update','asset_photo_delete')`
      )
    ).n
  ),
  3
);

console.log('');
if (gagal === 0) console.log('Semua pemeriksaan 0154 lolos. ✅');
else console.error(`${gagal} pemeriksaan 0154 GAGAL.`);
process.exit(gagal === 0 ? 0 : 1);
