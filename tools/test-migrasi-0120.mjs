/**
 * MIGRATION 0120 DI POSTGRES SUNGGUHAN (PGlite).
 *
 * ============ KASUS YANG DILAPORKAN ============
 *
 * Risma pegang kas. Shenda yang menginput terima-dari-supplier. Sebelum ini,
 * apa pun yang Shenda catat mendarat di kas SHENDA — satu-satunya kas yang
 * boleh ia tulis — jadi kas Shenda minus sementara kas Risma tidak bergerak.
 *
 * ============ YANG DIUJI ============
 *
 *   1. Kantong TANPA outlet tetap tertutup rapat (perilaku lama tidak berubah).
 *   2. Kantong BER-OUTLET boleh dibebani staff outlet itu — dan HANYA outlet itu.
 *   3. Uangnya mendarat di saldo PEMEGANG, bukan pencatatnya.
 *   4. Tanda nominal ditentukan servernya, bukan pemanggil.
 *   5. Pencatat bisa MELIHAT entri yang ia buat, tapi tidak isi kas lainnya.
 *
 * DUA OUTLET dan TIGA orang, karena dengan satu outlet "boleh karena outletnya
 * cocok" dan "boleh karena apa pun" memberi hasil yang sama.
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
  create or replace function is_super_admin(p_uid uuid) returns boolean language sql stable as $$
    select exists (select 1 from membership_scopes where user_id = p_uid and role = 'super_admin');
  $$;
`);

const jalankan = async (b) =>
  db.exec(fs.readFileSync(path.join(AKAR, 'supabase/migrations', b), 'utf8').replace(/notify pgrst[^;]*;/g, ''));

await jalankan('0120_kas_outlet_boleh_dibebani.sql');
console.log('  0120 terpasang.');
await jalankan('0120_kas_outlet_boleh_dibebani.sql');
console.log('  dijalankan ulang: aman.');

// ============ PERAN NON-PEMILIK, SUPAYA RLS BENAR-BENAR HIDUP ============
//
// PGlite menjalankan query sebagai PEMILIK tabel, dan Postgres TIDAK
// menerapkan RLS pada pemilik. Percobaan pertama tes ini memeriksa "Shenda
// tidak melihat entri Risma" sambil berjalan sebagai pemilik — jadi ia
// melihat segalanya, dan pemeriksaannya merah pada kebijakan yang sebenarnya
// benar.
//
// Yang lebih berbahaya: pemeriksaan sebaliknya ("Shenda MELIHAT entri
// buatannya") akan HIJAU tanpa menguji apa pun, karena pemilik memang melihat
// semuanya.
//
// Peran `app_user` menirukan `authenticated` di Supabase. Fungsi
// `security definer` tetap berjalan sebagai pemiliknya dan tetap melewati RLS
// — persis seperti di produksi.
// PERANNYA HARUS `authenticated`, bukan peran karangan.
//
// Kebijakan barunya ditulis `for select to authenticated`. Percobaan pertama
// memakai peran `app_user`, dan kebijakan itu TIDAK BERLAKU untuknya — jadi
// Shenda tidak melihat apa pun, dan tesnya merah pada kebijakan yang benar.
//
// Peran yang dipakai tes harus sama dengan yang dipakai produksi, kalau tidak
// yang diuji bukan sistem yang sama.
await db.exec(`
  grant usage on schema public to authenticated;
  grant select, insert, update, delete on all tables in schema public to authenticated;
  grant execute on all functions in schema public to authenticated;
`);
const sebagaiApp = async (uid) => {
  await sebagai(uid);
  await q(`set role authenticated`);
};
const kembaliPemilik = () => q(`reset role`);

// =====================================================================
// DATA — persis kasus yang dilaporkan.
// =====================================================================
const BU = (await satu(`insert into business_units (name) values ('Cafe') returning id`)).id;
const SERPONG = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Serpong') returning id`, [BU])).id;
const SENTUL = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Sentul') returning id`, [BU])).id;

const RISMA = '11111111-1111-1111-1111-111111111111';
const SHENDA = '22222222-2222-2222-2222-222222222222';
const ORANG_SENTUL = '33333333-3333-3333-3333-333333333333';
const IKO = '44444444-4444-4444-4444-444444444444';
await q(`insert into user_profiles (id, full_name) values ($1,'Risma'),($2,'Shenda'),($3,'Orang Sentul'),($4,'Iko')`, [
  RISMA,
  SHENDA,
  ORANG_SENTUL,
  IKO
]);
await q(
  `insert into membership_scopes (user_id, business_unit_id, outlet_id, role) values
     ($1,$4,$5,'staff'), ($2,$4,$5,'staff'), ($3,$4,$6,'staff')`,
  [RISMA, SHENDA, ORANG_SENTUL, BU, SERPONG, SENTUL]
);
await q(`insert into membership_scopes (user_id, business_unit_id, role) values ($1,$2,'super_admin')`, [IKO, BU]);

/** Kas pribadi Risma — tanpa outlet. */
const KAS_PRIBADI = (
  await satu(`insert into cash_accounts (holder_id, name) values ($1,'Kas Pribadi') returning id`, [RISMA])
).id;
/** Kas operasional Serpong — dipegang Risma, tapi melayani outlet Serpong. */
const KAS_SERPONG = (
  await satu(`insert into cash_accounts (holder_id, name, outlet_id) values ($1,'Kas Serpong',$2) returning id`, [
    RISMA,
    SERPONG
  ])
).id;

const saldo = async (uid) =>
  Number((await satu(`select coalesce(sum(amount),0) s from cash_entries where holder_id = $1`, [uid])).s);

// =====================================================================
// §1. Kantong TANPA outlet tetap tertutup.
// =====================================================================
await sebagai(SHENDA);
benar(
  '§1 Shenda ditolak pada kas pribadi Risma',
  (await gagalkan(() => q(`select catat_kas_di($1,'out',50000,null,$2,'beli','foto/a.jpg')`, [KAS_PRIBADI, SERPONG]))) !== null,
  'perilaku lama tidak boleh berubah untuk kantong yang tidak menyebut outlet'
);

// =====================================================================
// §2. INTI: kantong BER-OUTLET boleh dibebani staff outlet itu.
// =====================================================================
const idEntri = (
  await satu(`select catat_kas_di($1,'out',50000,null,$2,'Nota telur','foto/a.jpg') as id`, [KAS_SERPONG, SERPONG])
).id;
benar('§2 Shenda berhasil mencatat di kas Serpong', !!idEntri);

// =====================================================================
// §3. INTI: uangnya mendarat di saldo RISMA, bukan Shenda.
// =====================================================================
cek('§3 saldo Risma berkurang', await saldo(RISMA), -50000);
cek('§3 saldo Shenda TIDAK tersentuh', await saldo(SHENDA), 0);
cek(
  '§3 pemegang & pencatat tercatat terpisah',
  await satu(`select holder_id, created_by from cash_entries where id = $1`, [idEntri]),
  { holder_id: RISMA, created_by: SHENDA }
);

// =====================================================================
// §4. Staff outlet LAIN tetap ditolak.
// =====================================================================
await sebagai(ORANG_SENTUL);
benar(
  '§4 staff Sentul ditolak di kas Serpong',
  (await gagalkan(() => q(`select catat_kas_di($1,'out',10000,null,$2,'x','foto/b.jpg')`, [KAS_SERPONG, SERPONG]))) !== null,
  'kalau ini lolos, "boleh karena outletnya cocok" sebenarnya berarti "boleh karena apa pun"'
);

// =====================================================================
// §5. Tanda nominal ditentukan SERVER.
// =====================================================================
await sebagai(SHENDA);
await q(`select catat_kas_di($1,'in',20000,null,null,'setoran')`, [KAS_SERPONG]);
cek('§5 kas masuk menambah', await saldo(RISMA), -30000);

// Nominal negatif untuk 'out' tetap menghasilkan pengurangan, bukan penambahan.
benar(
  '§5 nominal <= 0 ditolak',
  (await gagalkan(() => q(`select catat_kas_di($1,'out',-5000,null,$2,'x','foto/c.jpg')`, [KAS_SERPONG, SERPONG]))) !== null
);
cek('§5 saldo tidak bergeser oleh percobaan yang ditolak', await saldo(RISMA), -30000);

// =====================================================================
// §6. Batasan kas keluar diterjemahkan jadi pesan yang berarti.
// =====================================================================
const tanpaOutlet = await gagalkan(() => q(`select catat_kas_di($1,'out',10000,null,null,'x','foto/d.jpg')`, [KAS_SERPONG]));
benar('§6 kas keluar tanpa outlet ditolak', tanpaOutlet !== null);
benar('§6 pesannya menyebut outlet peruntukan', (tanpaOutlet ?? '').toLowerCase().includes('outlet'));

const tanpaBukti = await gagalkan(() => q(`select catat_kas_di($1,'out',10000,null,$2,'x',null)`, [KAS_SERPONG, SERPONG]));
benar('§6 kas keluar tanpa bukti ditolak', tanpaBukti !== null);
benar('§6 pesannya menyebut bukti/nota', (tanpaBukti ?? '').toLowerCase().includes('bukti'));

// Kas MASUK tidak menuntut keduanya — itu jalur yang sah.
benar(
  '§6 kas masuk tanpa outlet & bukti tetap boleh',
  (await gagalkan(() => q(`select catat_kas_di($1,'in',1000,null,null,'receh')`, [KAS_SERPONG]))) === null
);

// =====================================================================
// §7. INTI: pencatat bisa MELIHAT entri yang ia buat.
//
// Tanpa ini, Shenda mencatat, penyimpanannya berhasil, lalu entrinya tidak
// muncul di layar mana pun yang bisa ia buka — dan ia mencatatnya lagi.
// =====================================================================
await sebagai(RISMA);
const idMilikRisma = (
  await satu(`select catat_kas_di($1,'out',7000,null,$2,'belanja sendiri','foto/e.jpg') as id`, [KAS_PRIBADI, SERPONG])
).id;

await sebagaiApp(SHENDA);
cek(
  '§7 Shenda melihat entri buatannya sendiri',
  Number((await satu(`select count(*)::int n from cash_entries where id = $1`, [idEntri])).n),
  1
);
cek(
  '§7 INTI: Shenda TIDAK melihat entri Risma yang bukan buatannya',
  Number((await satu(`select count(*)::int n from cash_entries where id = $1`, [idMilikRisma])).n),
  0
);

// Dan pemegangnya tetap melihat seluruh isinya, termasuk yang dicatat Shenda.
await sebagaiApp(RISMA);
cek(
  '§7 Risma melihat keduanya',
  Number((await satu(`select count(*)::int n from cash_entries where id in ($1,$2)`, [idEntri, idMilikRisma])).n),
  2
);
await kembaliPemilik();

// =====================================================================
// §8. Kantong nonaktif tidak bisa dibebani.
// =====================================================================
await sebagai(RISMA);
await q(`update cash_accounts set is_active = false where id = $1`, [KAS_SERPONG]);
await sebagai(SHENDA);
benar(
  '§8 kantong nonaktif ditolak',
  (await gagalkan(() => q(`select catat_kas_di($1,'out',1000,null,$2,'x','foto/f.jpg')`, [KAS_SERPONG, SERPONG]))) !== null,
  'kantong yang sudah ditutup masih bisa dibebani berarti saldonya hidup lagi tanpa ada yang membukanya'
);
// KONTRAK `boleh_membebani_kas` DIUJI LANGSUNG, bukan hanya lewat pemanggil.
//
// Sabotase yang membuang `and a.is_active` dari fungsi izin LOLOS dari
// pemeriksaan di atas — karena `catat_kas_di` menyaring `is_active` sendiri.
// Itu jujur: di jalur itu barisnya memang bukan penjaga.
//
// Tapi fungsi izinnya dipakai pemanggil lain yang tidak menulis apa pun (layar
// yang memutuskan tombol mana digambar, dan pembayaran hutang nanti). Kontrak
// yang hanya diuji lewat satu pintu adalah kontrak yang separuh diuji.
cek(
  '§8 INTI: fungsi izin sendiri menolak kantong nonaktif',
  (await satu(`select boleh_membebani_kas($1,$2) b`, [RISMA, KAS_SERPONG])).b,
  false
);

await sebagai(RISMA);
await q(`update cash_accounts set is_active = true where id = $1`, [KAS_SERPONG]);
cek(
  '§8 …dan mengizinkannya lagi sesudah diaktifkan',
  (await satu(`select boleh_membebani_kas($1,$2) b`, [RISMA, KAS_SERPONG])).b,
  true
);

// =====================================================================
// §8c. Kantong ber-outlet TERLIHAT oleh staff outlet itu.
//
// Tanpa ini seluruh fiturnya tidak pernah muncul di layar: daftar "kas mana
// yang boleh kubebani" milik Shenda akan selalu kosong, sementara tombolnya
// ada, RPC-nya ada, dan izinnya ada.
// =====================================================================
await sebagaiApp(SHENDA);
cek(
  '§8c Shenda melihat kantong ber-outlet milik Risma',
  Number((await satu(`select count(*)::int n from cash_accounts where id = $1`, [KAS_SERPONG])).n),
  1
);
cek(
  '§8c INTI: kantong PRIBADI Risma tetap tak terlihat',
  Number((await satu(`select count(*)::int n from cash_accounts where id = $1`, [KAS_PRIBADI])).n),
  0
);
await sebagaiApp(ORANG_SENTUL);
cek(
  '§8c staff outlet lain tidak melihat kantong Serpong',
  Number((await satu(`select count(*)::int n from cash_accounts where id = $1`, [KAS_SERPONG])).n),
  0
);
await kembaliPemilik();

// =====================================================================
// §9. Super admin boleh, untuk koreksi.
// =====================================================================
await sebagai(IKO);
benar(
  '§9 super admin boleh mencatat di kas orang lain',
  (await gagalkan(() => q(`select catat_kas_di($1,'in',1,null,null,'koreksi')`, [KAS_PRIBADI]))) === null
);

if (gagal === 0) console.log('Migration 0120: semua pemeriksaan lulus. ✅');
process.exit(gagal === 0 ? 0 : 1);
