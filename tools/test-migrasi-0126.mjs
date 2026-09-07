/**
 * MIGRATION 0126 DI POSTGRES SUNGGUHAN (PGlite).
 *
 * ============ YANG DIMINTA ============
 *
 *   "setiap outlet bisa memakai kas dari outlet lain. contohnya, outlet sentul
 *    membeli ice batu, lalu memakai kas CK"
 *
 * ============ YANG DIUJI ============
 *
 *   1. Staff Sentul BISA membebani kantong Central Kitchen — dan sebelum 0126
 *      ia tidak bisa.
 *   2. Uangnya tetap keluar dari kas PEMEGANG kantong itu.
 *   3. Beban biayanya tetap ikut outlet yang menerima barangnya.
 *   4. Kantong TANPA outlet tetap pribadi sepenuhnya (janji 0120 tidak dicabut).
 *   5. BU LAIN tetap ditolak.
 *   6. Kantongnya benar-benar TERLIHAT — izin tanpa kebijakan baca berarti
 *      daftar kosong, dan itu sudah terjadi dua kali di repo ini.
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
const gagalkan = async (fn) => {
  try {
    await fn();
    return null;
  } catch (e) {
    return String(e.message ?? e);
  }
};

await db.exec(`
  -- Perannya dibuat PALING AWAL: kebijakan di bawah menyebut "to authenticated",
  -- dan Postgres menolak kebijakan yang menunjuk peran yang belum ada.
  --
  -- (Tanpa tanda kutip miring di komentar ini, dan itu disengaja: seluruh blok
  -- ini template literal JavaScript, jadi satu backtick di dalamnya menutup
  -- string-nya di tengah jalan. Ini kali KEEMPAT hal itu menggigit di repo ini.)
  create role authenticated;

  create schema if not exists auth;
  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
  $$;

  create table business_units (id uuid primary key default gen_random_uuid(), name text);
  create table outlets (id uuid primary key default gen_random_uuid(), business_unit_id uuid, name text);
  create table user_profiles (id uuid primary key, full_name text, cash_account_limit int not null default 1);
  create table membership_scopes (user_id uuid, business_unit_id uuid, outlet_id uuid, role text);
  create table cash_categories (id uuid primary key default gen_random_uuid(), business_unit_id uuid, name text);

  create table cash_accounts (
    id uuid primary key default gen_random_uuid(),
    holder_id uuid not null references user_profiles(id) on delete cascade,
    name text not null,
    sort_order int not null default 0,
    is_active boolean not null default true,
    created_at timestamptz not null default now(),
    unique (holder_id, name)
  );

  create table cash_entries (
    id uuid primary key default gen_random_uuid(),
    business_unit_id uuid, outlet_id uuid,
    holder_id uuid not null references user_profiles(id) on delete cascade,
    account_id uuid references cash_accounts(id) on delete restrict,
    entry_type text not null,
    amount numeric not null,
    category_id uuid, counterpart_id uuid, transfer_id uuid,
    notes text, proof_path text, qty numeric, unit text,
    entry_date date not null default (now() at time zone 'Asia/Jakarta')::date,
    created_by uuid references user_profiles(id) on delete set null,
    created_at timestamptz not null default now()
  );
  alter table cash_entries enable row level security;
  create policy cash_entries_select_own on cash_entries for select using (holder_id = auth.uid());

  -- Kebijakan 0063: kantong hanya terlihat pemiliknya.
  alter table cash_accounts enable row level security;
  create policy cash_accounts_own on cash_accounts for all to authenticated
    using (holder_id = auth.uid()) with check (holder_id = auth.uid());

  create view cash_balances with (security_invoker = true) as
    select holder_id, sum(amount) as balance from cash_entries group by holder_id;

  create or replace function has_outlet_scope(p_uid uuid, p_outlet uuid) returns boolean language sql stable as $$
    select exists (
      select 1 from membership_scopes ms
       where ms.user_id = p_uid
         and (ms.outlet_id = p_outlet
              or (ms.outlet_id is null and ms.business_unit_id = (select business_unit_id from outlets where id = p_outlet)))
    );
  $$;
  create or replace function has_bu_scope(p_uid uuid, p_bu uuid) returns boolean language sql stable as $$
    select exists (
      select 1 from membership_scopes
       where user_id = p_uid and (role = 'super_admin' or business_unit_id = p_bu)
    );
  $$;
  create or replace function is_super_admin(p_uid uuid) returns boolean language sql stable as $$
    select exists (select 1 from membership_scopes where user_id = p_uid and role = 'super_admin');
  $$;
`);

const jalankan = async (b) =>
  db.exec(fs.readFileSync(path.join(AKAR, 'supabase/migrations', b), 'utf8').replace(/notify pgrst[^;]*;/g, ''));

await jalankan('0120_kas_outlet_boleh_dibebani.sql');
console.log('  0120 terpasang.');

await db.exec(`
  grant usage on schema public to authenticated;
  grant select, insert, update, delete on all tables in schema public to authenticated;
  grant execute on all functions in schema public to authenticated;
`);
const sebagai2 = async (uid) => {
  await q(`reset role`);
  await q(`select set_config('request.jwt.claim.sub', $1, false)`, [uid]);
  await q(`set role authenticated`);
};
const pemilik = () => q(`reset role`);

// =====================================================================
// DATA — kasus yang dilaporkan.
// =====================================================================
const BU = (await satu(`insert into business_units (name) values ('Awal Bermula') returning id`)).id;
const BU2 = (await satu(`insert into business_units (name) values ('BU Lain') returning id`)).id;
const CK = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Central Kitchen') returning id`, [BU])).id;
const SENTUL = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Sentul') returning id`, [BU])).id;
const LUAR = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Outlet BU Lain') returning id`, [BU2])).id;

const IIS = '11111111-1111-1111-1111-111111111111'; // pegang Kas CK
const DINA = '22222222-2222-2222-2222-222222222222'; // staff Sentul
const ASING = '33333333-3333-3333-3333-333333333333'; // staff BU lain

await q(`insert into user_profiles (id, full_name) values ($1,'Iis'), ($2,'Dina'), ($3,'Asing')`, [IIS, DINA, ASING]);
await q(`insert into membership_scopes (user_id, business_unit_id, outlet_id, role) values
  ($1,$2,$3,'staff'), ($4,$2,$5,'staff'), ($6,$7,$8,'staff')`,
  [IIS, BU, CK, DINA, SENTUL, ASING, BU2, LUAR]);

const KAS_CK = (await satu(`insert into cash_accounts (holder_id, name, outlet_id) values ($1,'Kas CK iis',$2) returning id`, [IIS, CK])).id;
const KAS_PRIBADI = (await satu(`insert into cash_accounts (holder_id, name) values ($1,'Dompet Iis') returning id`, [IIS])).id;

// =====================================================================
// §1. SEBELUM 0126: staff Sentul TIDAK bisa memakai Kas CK.
//
// Kalau bagian ini tidak merah, seluruh 0126 tidak memperbaiki apa pun — dan
// tesnya di bawah akan hijau untuk keadaan yang sudah berlaku sejak 0120.
// =====================================================================
await sebagai2(DINA);
const sebelum = await satu(`select boleh_membebani_kas($1,$2) as boleh`, [DINA, KAS_CK]);
cek('§1 sebelum 0126: Sentul ditolak memakai Kas CK', sebelum.boleh, false);

await pemilik();
await jalankan('0126_kas_lintas_outlet_se_bu.sql');
console.log('  0126 terpasang.');
await jalankan('0126_kas_lintas_outlet_se_bu.sql');
console.log('  dijalankan ulang: aman.');

// =====================================================================
// §2. INTI: sesudah 0126, boleh.
// =====================================================================
await sebagai2(DINA);
cek('§2 INTI: Sentul boleh memakai Kas CK', (await satu(`select boleh_membebani_kas($1,$2) as b`, [DINA, KAS_CK])).b, true);

// Dan kantongnya BENAR-BENAR TERLIHAT. Izin tanpa kebijakan baca berarti
// daftarnya kosong — "tidak ada kas yang bisa kamu bebani" — dan itulah persis
// yang dilaporkan. Bentuk kegagalan yang sudah terjadi dua kali (0120, 0121).
const terlihat = await q(`select id, name from cash_accounts where id = $1`, [KAS_CK]);
cek('§2 Kas CK terlihat oleh staff Sentul', terlihat.rows.length, 1);

// =====================================================================
// §3. Uangnya keluar dari kas PEMEGANG, biayanya ikut outlet NOTA.
//
// Es batu masuk stok Sentul, jadi bebannya Sentul; yang berpindah cuma uangnya
// dari kantong Iis di CK.
// =====================================================================
const entri = await satu(
  `select catat_kas_di($1,'out',50000,null,$2,'es batu','foto/es.jpg',null,null,null) as id`,
  [KAS_CK, SENTUL]
);
await pemilik();
const e = await satu(`select holder_id, created_by, outlet_id, amount::text as a from cash_entries where id = $1`, [entri.id]);
cek('§3 uangnya keluar dari kas IIS, dicatat DINA', [e.holder_id, e.created_by], [IIS, DINA]);
cek('§3 outlet peruntukannya SENTUL, bukan CK', e.outlet_id, SENTUL);
cek('§3 nominalnya bertanda minus', e.a, '-50000');

// =====================================================================
// §4. Kantong TANPA outlet tetap pribadi — janji 0120 tidak dicabut.
// =====================================================================
await sebagai2(DINA);
cek('§4 dompet pribadi Iis tetap tertutup', (await satu(`select boleh_membebani_kas($1,$2) as b`, [DINA, KAS_PRIBADI])).b, false);
const pribadiTerlihat = await q(`select id from cash_accounts where id = $1`, [KAS_PRIBADI]);
cek('§4 dan tidak terlihat pun', pribadiTerlihat.rows.length, 0);

const ditolak = await gagalkan(() =>
  q(`select catat_kas_di($1,'out',1000,null,$2,'x','foto/x.jpg',null,null,null)`, [KAS_PRIBADI, SENTUL])
);
benar('§4 mencatatnya pun ditolak', /tidak berhak/i.test(ditolak ?? ''), `dapat: ${ditolak}`);

// =====================================================================
// §5. BU LAIN tetap ditolak.
//
// Batasnya SATU BU. Kas antar-BU menyangkut siapa menanggung biaya siapa
// antar badan usaha, dan jawabannya bukan "siapa saja yang punya cakupan".
// =====================================================================
await sebagai2(ASING);
cek('§5 staff BU lain ditolak', (await satu(`select boleh_membebani_kas($1,$2) as b`, [ASING, KAS_CK])).b, false);
cek('§5 dan Kas CK tidak terlihat olehnya', (await q(`select id from cash_accounts where id = $1`, [KAS_CK])).rows.length, 0);

// =====================================================================
// §6. Pemegangnya sendiri tetap boleh, dan kantong tertutup tetap tertutup.
// =====================================================================
await sebagai2(IIS);
cek('§6 pemegangnya tetap boleh', (await satu(`select boleh_membebani_kas($1,$2) as b`, [IIS, KAS_CK])).b, true);
cek('§6 dompet pribadinya juga', (await satu(`select boleh_membebani_kas($1,$2) as b`, [IIS, KAS_PRIBADI])).b, true);

await pemilik();
await q(`update cash_accounts set is_active = false where id = $1`, [KAS_CK]);
await sebagai2(DINA);
cek('§6 kantong yang ditutup tidak bisa dibebani siapa pun', (await satu(`select boleh_membebani_kas($1,$2) as b`, [DINA, KAS_CK])).b, false);
const tutup = await gagalkan(() =>
  q(`select catat_kas_di($1,'out',1000,null,$2,'x','foto/x.jpg',null,null,null)`, [KAS_CK, SENTUL])
);
benar('§6 pesannya menyebut kantongnya ditutup, bukan "tidak berhak"', /sudah ditutup/i.test(tutup ?? ''), `dapat: ${tutup}`);

await pemilik();
if (gagal === 0) console.log('Migration 0126 di Postgres sungguhan: 6 bagian LULUS. ✅');
process.exit(gagal === 0 ? 0 : 1);
