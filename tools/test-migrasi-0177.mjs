/**
 * MIGRATION 0177 — KANTONG UTAMA, DAN KANTONG YANG TERLIHAT ADMIN BU.
 *
 * ============ APA YANG DIBUKTIKAN ============
 *
 *   §1 Kantong PERTAMA seseorang otomatis jadi utama — lewat trigger, jadi
 *      jalur pembuat mana pun ikut terkena.
 *   §2 Hanya SATU kantong utama per orang, dijaga database.
 *   §3 Transfer mendarat di kantong UTAMA penerima, bukan Kas Utama.
 *   §4 Revisi transfer juga — kalau hanya `transfer_cash` yang diperbarui,
 *      transfer yang direvisi terlempar balik ke Kas Utama.
 *   §5 `atur_kantong_utama`: wewenangnya, dan kantong tutup ditolak.
 *   §6 `daftar_kantong_kas` terbaca ADMIN BU — sebelumnya super admin saja,
 *      jadi tabnya selamanya berbunyi "Belum ada kantong kas".
 *   §7 Kas Utama yang KOSONG tidak ikut terdaftar.
 *   §8 Dijalankan dua kali tetap aman.
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
const melempar = async (nama, fn, pola) => {
  try {
    await fn();
    gagal++;
    console.error(`❌ ${nama} — tidak melempar sama sekali.`);
  } catch (e) {
    if (pola && !pola.test(e.message ?? '')) {
      gagal++;
      console.error(`❌ ${nama} — pesannya tidak cocok: ${e.message}`);
    } else console.log(`  ✔ ${nama}`);
  }
};

const db = new PGlite();
const q = (sql, params) => db.query(sql, params);
const satu = async (sql, params) => (await q(sql, params)).rows[0];
const semua = async (sql, params) => (await q(sql, params)).rows;
const jadi = async (uid) => q(`select set_config('request.jwt.claim.sub', $1, false)`, [uid ?? '']);

await db.exec(`
  create role authenticated;
  create schema if not exists auth;
  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
  $$;

  create table membership_scopes (
    id uuid primary key default gen_random_uuid(),
    user_id uuid, business_unit_id uuid, outlet_id uuid, role text);
  create table business_units (id uuid primary key default gen_random_uuid(), name text);
  create table outlets (id uuid primary key default gen_random_uuid(), business_unit_id uuid, name text);
  create table user_profiles (
    id uuid primary key, full_name text, cash_account_limit int not null default 1);
  create table cash_categories (id uuid primary key default gen_random_uuid(), name text);
  create table products (id uuid primary key default gen_random_uuid(), name text, base_unit text);
  create table cash_accounts (
    id uuid primary key default gen_random_uuid(),
    holder_id uuid, name text, sort_order int not null default 0,
    is_active boolean not null default true,
    -- ADA DI TABEL SUNGGUHAN (0063) dan sempat tertinggal di sini. Backfill
    -- 0177 mengurutkan dengannya; tanpa kolomnya, migrationnya gagal di tes
    -- dengan galat yang tidak menyebut sebab sebenarnya ("column created_at
    -- does not exist") — dan kalau arah kesalahannya terbalik, ia justru
    -- membuat tes HIJAU untuk skema yang tidak pernah ada di produksi.
    created_at timestamptz not null default now(),
    outlet_id uuid references outlets(id) on delete set null);
  create table goods_receipts (
    id uuid primary key default gen_random_uuid(),
    code text, supplier text, payment_entry_id uuid, status text);
  create table goods_receipt_items (
    id uuid primary key default gen_random_uuid(),
    receipt_id uuid, product_id uuid, qty numeric, unit_cost numeric, line_total numeric);

  create table cash_entries (
    id uuid primary key default gen_random_uuid(),
    business_unit_id uuid,
    outlet_id uuid, holder_id uuid, entry_type text, amount numeric,
    category_id uuid, account_id uuid references cash_accounts(id) on delete set null,
    counterpart_id uuid, transfer_id uuid,
    notes text, qty numeric, unit text, proof_path text, supplier text,
    entry_date date not null default current_date,
    untuk_nota boolean not null default false,
    penyesuaian_nota uuid references goods_receipts(id) on delete set null,
    esb_exported_at timestamptz,
    dicoret_at timestamptz, dicoret_by uuid, alasan_coret text,
    diubah_at timestamptz, diubah_by uuid,
    created_at timestamptz not null default now(), created_by uuid);

  create or replace function is_super_admin(p_uid uuid) returns boolean
    language sql security definer stable as $$
      select exists (select 1 from membership_scopes ms
        where ms.user_id = p_uid and ms.role = 'super_admin') $$;
  create or replace function is_bu_admin(p_uid uuid, p_bu uuid) returns boolean
    language sql security definer stable as $$
      select exists (select 1 from membership_scopes ms
        where ms.user_id = p_uid
          and (ms.role = 'super_admin' or (ms.role = 'bu_admin' and ms.business_unit_id = p_bu))) $$;
  create or replace function is_admin_of_outlet(p_user_id uuid, p_outlet_id uuid) returns boolean
    language sql security definer stable as $$
      select exists (select 1 from membership_scopes ms join outlets o on o.id = p_outlet_id
        where ms.user_id = p_user_id
          and (ms.role = 'super_admin'
               or (ms.role = 'bu_admin' and ms.business_unit_id = o.business_unit_id))) $$;
  create or replace function has_outlet_scope(p_uid uuid, p_outlet uuid) returns boolean
    language sql security definer stable as $$
      select exists (select 1 from membership_scopes ms
        where ms.user_id = p_uid and ms.outlet_id = p_outlet) $$;
  create or replace function has_bu_scope(p_uid uuid, p_bu uuid) returns boolean
    language sql security definer stable as $$
      select exists (select 1 from membership_scopes ms
        where ms.user_id = p_uid and ms.business_unit_id = p_bu) $$;
  create or replace function boleh_lihat_kas(p_holder uuid, p_outlet uuid) returns boolean
    language sql security definer stable as $$
      select p_holder = auth.uid() or is_super_admin(auth.uid())
          or exists (select 1 from membership_scopes ms
                     where ms.user_id = p_holder and ms.business_unit_id is not null
                       and is_bu_admin(auth.uid(), ms.business_unit_id)) $$;
  create or replace function boleh_koreksi_kas(p_holder uuid) returns boolean
    language sql security definer stable as $$
      select coalesce(
        is_super_admin(auth.uid()) or p_holder = auth.uid()
        or exists (select 1 from membership_scopes ms
                   where ms.user_id = p_holder and ms.business_unit_id is not null
                     and is_bu_admin(auth.uid(), ms.business_unit_id)), false) $$;
  create or replace function alasan_tolak_koreksi_kas(p_entry uuid) returns text
  language plpgsql security definer stable as $$
  declare v cash_entries%rowtype;
  begin
    select * into v from cash_entries where id = p_entry;
    if v.id is null then return 'Entri kasnya tidak ditemukan.'; end if;
    if not boleh_koreksi_kas(v.holder_id) then return 'Kas ini bukan wewenangmu.'; end if;
    if v.dicoret_at is not null then return 'Entri ini sudah dihapus sebelumnya.'; end if;
    if v.esb_exported_at is not null then return 'Entri ini sudah diekspor ke ESB.'; end if;
    if v.entry_type not in ('in', 'out') then return 'Transfer tidak bisa dikoreksi sepotong.'; end if;
    return null;
  end $$;

  -- Penjaga 0126 APA ADANYA: kantong ber-outlet boleh dibebani siapa pun yang
  -- bertugas di BU outlet itu. Inilah izin yang sudah ada dan tidak pernah
  -- dipakai form Kas Keluar.
  create or replace function boleh_membebani_kas(p_uid uuid, p_account uuid) returns boolean
  language sql stable security definer as $$
    select exists (
      select 1 from cash_accounts a
        left join outlets o on o.id = a.outlet_id
       where a.id = p_account and a.is_active
         and (a.holder_id = p_uid
              or (a.outlet_id is not null and has_outlet_scope(p_uid, a.outlet_id))
              or (a.outlet_id is not null and has_bu_scope(p_uid, o.business_unit_id))
              or is_super_admin(p_uid))) $$;

  create or replace function ubah_kantong_kas(p_entries uuid[], p_account uuid)
    returns int language sql as $lama$ select 0 $lama$;
`);

const jalankan = async (b) =>
  db.exec(fs.readFileSync(path.join(AKAR, 'supabase/migrations', b), 'utf8').replace(/notify pgrst[^;]*;/g, ''));

const BU = (await satu(`insert into business_units (name) values ('Awal Bermula') returning id`)).id;
const SERPONG = (await satu(`insert into outlets (business_unit_id, name) values ($1,'AB Gading Serpong') returning id`, [BU])).id;
const CK = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Central Kitchen Tangerang') returning id`, [BU])).id;
const KAT = (await satu(`insert into cash_categories (name) values ('Transportasi') returning id`)).id;

const ADMIN = '11111111-1111-1111-1111-111111111111';
const RISMA = '22222222-2222-2222-2222-222222222222';
const IIS = '33333333-3333-3333-3333-333333333333';
await q(`insert into user_profiles (id, full_name) values ($1,'Admin'), ($2,'Risma'), ($3,'Iis')`, [ADMIN, RISMA, IIS]);
// Risma berbasis SERPONG, Iis berbasis CK — dua outlet, satu BU.
await q(
  `insert into membership_scopes (user_id, business_unit_id, outlet_id, role)
   values ($1,$2,null,'bu_admin'), ($3,$2,$4,'staff'), ($5,$2,$6,'staff')`,
  [ADMIN, BU, RISMA, SERPONG, IIS, CK]
);

const KAS_RISMA = (
  await satu(`insert into cash_accounts (holder_id, name, outlet_id) values ($1,'Kas Serpong',$2) returning id`, [RISMA, SERPONG])
).id;
const KAS_IIS = (
  await satu(`insert into cash_accounts (holder_id, name, outlet_id) values ($1,'Kas CK iis',$2) returning id`, [IIS, CK])
).id;
console.log('§0 Migrationnya jalan');

await jalankan('0153_bayar_dari_kantong_lain_dan_pusat.sql');
await jalankan('0175_saldo_berjalan_kas.sql');
await db.exec(`
  create or replace function transfer_cash(p_to_user uuid, p_amount numeric, p_notes text)
  returns void language plpgsql security definer set search_path = public as $lama$
  begin null; end $lama$;
`);
await jalankan('0176_transfer_kantong_dan_revisi.sql');
await jalankan('0177_kantong_utama.sql');
console.log('  0153 … 0177 terpasang.');

for (const fn of ['kantong_utama', 'atur_kantong_utama', 'tandai_kantong_utama_pertama']) {
  benar(`§0 \`${fn}\` ada`, (await satu(`select count(*)::int as n from pg_proc where proname = $1`, [fn])).n > 0);
}

const saldo = async (holder, akun = null) =>
  Number(
    (
      await satu(
        `select coalesce(sum(amount),0) as s from cash_entries
          where holder_id=$1 and account_id is not distinct from $2 and dicoret_at is null and not dibayar_pusat`,
        [holder, akun]
      )
    ).s
  );
const utama = async (holder) => (await satu(`select kantong_utama($1) as id`, [holder])).id;

// ===============================================================
console.log('\n§1 Kantong pertama otomatis utama');
// ===============================================================
// KAS_RISMA & KAS_IIS dibuat di prelude SEBELUM 0177 — backfill-nya yang
// menandai mereka.
cek('§1 backfill menandai kantong Risma', await utama(RISMA), KAS_RISMA);
cek('§1 backfill menandai kantong Iis', await utama(IIS), KAS_IIS);

// Kantong KEDUA tidak merebut penanda itu.
const KAS_RISMA2 = (
  await satu(`insert into cash_accounts (holder_id, name, outlet_id) values ($1,'Kas Cadangan',$2) returning id`, [RISMA, SERPONG])
).id;
cek('§1 kantong kedua tidak merebut penandanya', await utama(RISMA), KAS_RISMA);

// Orang yang BELUM punya kantong: yang pertama dibuat jadi utama sendiri —
// lewat trigger, jadi jalur pembuat mana pun ikut terkena.
await q(`insert into user_profiles (id, full_name) values ($1,'Elsha')`, ['44444444-4444-4444-4444-444444444444']);
const ELSHA = '44444444-4444-4444-4444-444444444444';
await q(`insert into membership_scopes (user_id, business_unit_id, outlet_id, role) values ($1,$2,$3,'staff')`, [ELSHA, BU, SERPONG]);
cek('§1 orang tanpa kantong: belum ada utama', await utama(ELSHA), null);
const KAS_ELSHA = (
  await satu(`insert into cash_accounts (holder_id, name, outlet_id) values ($1,'Kas Sentul',$2) returning id`, [ELSHA, SERPONG])
).id;
cek('§1 kantong pertamanya jadi utama sendiri', await utama(ELSHA), KAS_ELSHA);

// ===============================================================
console.log('\n§2 Hanya SATU kantong utama, dijaga database');
// ===============================================================

// ============ KENAPA DI DATABASE, BUKAN DI LAYAR ============
//
// Dua tab yang terbuka bersamaan bisa menandai dua kantong sekaligus, dan
// sejak itu "kantong utama" tidak berarti apa-apa — form mengisi yang mana
// saja yang kebetulan lebih dulu terbaca.
await melempar(
  '§2 dua kantong utama ditolak indeks unik',
  () => q(`update cash_accounts set is_primary = true where id = $1`, [KAS_RISMA2]),
  /idx_cash_accounts_satu_utama|unique/i
);

// ===============================================================
console.log('\n§3 Transfer mendarat di kantong UTAMA penerima');
// ===============================================================
await q(`insert into cash_entries (holder_id, account_id, entry_type, amount, created_by, notes)
         values ($1,$2,'in',1000000,$1,'modal')`, [RISMA, KAS_RISMA]);
await jadi(RISMA);
await q(`select transfer_cash($1,$2,$3,$4)`, [ELSHA, 300000, 'uang kembalian', KAS_RISMA]);

cek('§3 mendarat di kantong utama penerima', await saldo(ELSHA, KAS_ELSHA), 300000);
cek('§3 BUKAN di Kas Utama penerima', await saldo(ELSHA, null), 0);

// Penerima yang belum punya kantong tetap kebagian — Kas Utama memang
// satu-satunya tempat yang ada baginya.
await q(`insert into user_profiles (id, full_name) values ($1,'Tanpa Kantong')`, ['55555555-5555-5555-5555-555555555555']);
const TANPA = '55555555-5555-5555-5555-555555555555';
await q(`insert into membership_scopes (user_id, business_unit_id, outlet_id, role) values ($1,$2,$3,'staff')`, [TANPA, BU, SERPONG]);
await q(`select transfer_cash($1,$2,$3,$4)`, [TANPA, 50000, 'uang jalan', KAS_RISMA]);
cek('§3 yang belum punya kantong tetap kebagian di Kas Utama', await saldo(TANPA, null), 50000);

// ===============================================================
console.log('\n§4 Revisi transfer juga mendarat di kantong utama');
// ===============================================================

// ============ KENAPA INI DIUJI TERPISAH ============
//
// `transfer_cash` dan `ubah_transfer_kas` menulis kaki penerima di dua tempat
// berbeda. Memperbarui yang pertama saja membuat transfer yang DIREVISI
// terlempar kembali ke Kas Utama — justru saat orangnya sedang membetulkan.
const kakiOut = await satu(
  `select * from cash_entries where entry_type='transfer_out' and amount = -300000 order by created_at desc limit 1`
);
await satu(`select ubah_transfer_kas($1,$2,$3,$4,$5,$6) as h`, [
  kakiOut.id,
  250000,
  ELSHA,
  KAS_RISMA,
  'uang kembalian',
  'salah jumlah'
]);
cek('§4 revisi tetap di kantong utama penerima', await saldo(ELSHA, KAS_ELSHA), 250000);
cek('§4 dan tidak bocor ke Kas Utama', await saldo(ELSHA, null), 0);

// ===============================================================
console.log('\n§5 Mengganti kantong utama');
// ===============================================================
await jadi(RISMA);
await q(`select atur_kantong_utama($1)`, [KAS_RISMA2]);
cek('§5 penandanya berpindah', await utama(RISMA), KAS_RISMA2);
cek(
  '§5 dan yang lama dilepas — bukan dua-duanya',
  (await satu(`select count(*)::int as n from cash_accounts where holder_id=$1 and is_primary`, [RISMA])).n,
  1
);

await jadi(IIS);
await melempar('§5 kas orang lain bukan wewenangnya', () => q(`select atur_kantong_utama($1)`, [KAS_RISMA]), /bukan wewenangmu/i);
await jadi(ADMIN);
await q(`select atur_kantong_utama($1)`, [KAS_RISMA]);
cek('§5 admin BU boleh', await utama(RISMA), KAS_RISMA);

// Kantong yang sudah ditutup tidak boleh jadi bawaan: form akan mengisinya
// sendiri dan entrinya mendarat di kantong yang sudah tidak dipakai.
await q(`update cash_accounts set is_active = false where id = $1`, [KAS_RISMA2]);
await melempar('§5 kantong tutup ditolak', () => q(`select atur_kantong_utama($1)`, [KAS_RISMA2]), /sudah ditutup/i);

// ===============================================================
console.log('\n§6 Admin BU melihat daftar kantong');
// ===============================================================

// ============ TAB YANG SELAMANYA KOSONG ============
//
// `daftar_kantong_kas` (0153) berakhir `where is_super_admin(auth.uid())` pada
// kedua cabangnya, sementara tabnya sudah dibuka untuk admin BU sejak 0141.
// Yang terjadi: tab yang bisa dibuka, tombol tambah yang bisa ditekan, dan
// tabel yang selalu berbunyi "Belum ada kantong kas". Tanpa satu pun galat.
await jadi(ADMIN);
const barisAdmin = await semua(`select * from daftar_kantong_kas()`);
benar('§6 admin BU melihat isinya', barisAdmin.length > 0, String(barisAdmin.length));
benar(
  '§6 termasuk kantong anak buahnya',
  barisAdmin.some((r) => r.id === KAS_ELSHA),
  JSON.stringify(barisAdmin.map((r) => r.name))
);
benar('§6 penanda utama ikut terbawa', barisAdmin.some((r) => r.is_primary === true));

// Pemegangnya sendiri melihat kantongnya sendiri, bukan kantong orang lain.
await jadi(ELSHA);
const barisElsha = await semua(`select * from daftar_kantong_kas()`);
benar('§6 pemegang melihat kantongnya sendiri', barisElsha.some((r) => r.id === KAS_ELSHA));
benar(
  '§6 dan TIDAK melihat kantong orang di luar wewenangnya',
  !barisElsha.some((r) => r.id === KAS_RISMA),
  JSON.stringify(barisElsha.map((r) => r.name))
);

// ===============================================================
console.log('\n§7 Kas Utama yang kosong tidak terdaftar');
// ===============================================================
await jadi(ADMIN);
const semuaBaris = await semua(`select * from daftar_kantong_kas()`);
const kasUtamaElsha = semuaBaris.filter((r) => !r.kantong_nyata && r.holder_id === ELSHA);
cek('§7 Kas Utama kosong tidak muncul', kasUtamaElsha.length, 0);
const kasUtamaTanpa = semuaBaris.filter((r) => !r.kantong_nyata && r.holder_id === TANPA);
cek('§7 yang BERISI tetap muncul', kasUtamaTanpa.length, 1);
cek('§7 dengan saldonya', Number(kasUtamaTanpa[0]?.balance), 50000);

// ===============================================================
console.log('\n§8 Dijalankan dua kali tetap aman');
// ===============================================================
await jalankan('0177_kantong_utama.sql');
await jalankan('0177_kantong_utama.sql');
cek('§8 kantong utama tidak berubah', await utama(RISMA), KAS_RISMA);
cek(
  '§8 dan tetap satu per orang',
  (await satu(`select count(*)::int as n from cash_accounts where holder_id=$1 and is_primary`, [RISMA])).n,
  1
);

// ---------------------------------------------------------------
console.log(`\n${gagal === 0 ? '✅' : '❌'} test-migrasi-0177: ${gagal === 0 ? 'semua' : gagal + ' GAGAL'}`);
process.exit(gagal === 0 ? 0 : 1);
