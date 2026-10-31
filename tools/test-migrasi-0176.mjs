/**
 * MIGRATION 0176 — TRANSFER KAS DARI KANTONG PILIHAN, DAN REVISINYA.
 *
 * ============ APA YANG DIBUKTIKAN ============
 *
 *   §1 Transfer memotong KANTONG yang dipilih, bukan selalu Kas Utama —
 *      dan kaki penerimanya tetap Kas Utama penerima.
 *   §2 Kantong orang lain tidak bisa dipakai sebagai asal, dan kantong yang
 *      saldonya kurang ditolak sebelum uangnya bergerak.
 *   §3 Tanda tangan lama `transfer_cash` SUDAH TIDAK ADA — kalau ia hidup,
 *      pemanggilan yang lupa mengirim kantong akan diam-diam memotong Kas
 *      Utama, persis bug yang diperbaiki di sini.
 *   §4 Revisi memindahkan KEDUA kaki sekaligus: jumlah, kantong, penerima.
 *   §5 Penerima lama kehilangan barisnya, dan saldonya BOLEH minus.
 *   §6 Wewenang: pengirim & admin BU boleh, penerima dan orang lain tidak.
 *   §7 `ubah_kas` TETAP menolak transfer — jalur satu-baris tidak boleh
 *      menyentuh transaksi berpasangan.
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
// `transfer_cash` lama & `boleh_koreksi_kas` sudah disiapkan prelude; 0176
// menimpanya.
await db.exec(`
  create or replace function transfer_cash(p_to_user uuid, p_amount numeric, p_notes text)
  returns void language plpgsql security definer set search_path = public as $lama$
  declare v_uid uuid := auth.uid(); v_tid uuid := gen_random_uuid();
  begin
    insert into cash_entries(holder_id, entry_type, amount, counterpart_id, transfer_id, notes, created_by)
      values (v_uid, 'transfer_out', -p_amount, p_to_user, v_tid, p_notes, v_uid);
    insert into cash_entries(holder_id, entry_type, amount, counterpart_id, transfer_id, notes, created_by)
      values (p_to_user, 'transfer_in', p_amount, v_uid, v_tid, p_notes, v_uid);
  end $lama$;
  create or replace function ubah_kas(
    p_entry uuid, p_amount numeric, p_category uuid, p_outlet uuid, p_notes text,
    p_qty numeric, p_unit text, p_date date, p_supplier text)
  returns void language plpgsql security definer set search_path = public as $uk$
  declare v_tolak text;
  begin
    v_tolak := alasan_tolak_koreksi_kas(p_entry);
    if v_tolak is not null then raise exception '%', v_tolak; end if;
    update cash_entries set amount = p_amount where id = p_entry;
  end $uk$;
`);
await jalankan('0176_transfer_kantong_dan_revisi.sql');
console.log('  0153 + 0175 + 0176 terpasang.');

for (const fn of ['ubah_transfer_kas', 'alasan_tolak_revisi_transfer']) {
  benar(`§0 \`${fn}\` ada sesudah migrationnya`, (await satu(`select count(*)::int as n from pg_proc where proname = $1`, [fn])).n > 0);
}

const isiKantong = async (holder, akun, jumlah) =>
  q(
    `insert into cash_entries (holder_id, account_id, entry_type, amount, created_by, notes)
     values ($1,$2,'in',$3,$1,'modal awal')`,
    [holder, akun, jumlah]
  );

const saldo = async (holder, akun = null) =>
  Number(
    (
      await satu(
        `select coalesce(sum(amount),0) as s from cash_entries
          where holder_id = $1 and account_id is not distinct from $2
            and dicoret_at is null and not dibayar_pusat`,
        [holder, akun]
      )
    ).s
  );

await isiKantong(RISMA, KAS_RISMA, 1000000);
await isiKantong(RISMA, null, 50000);

// ===============================================================
console.log('\n§1 Transfer memotong kantong yang DIPILIH');
// ===============================================================
await jadi(RISMA);
await q(`select transfer_cash($1, $2, $3, $4)`, [IIS, 300000, 'bayar bahan', KAS_RISMA]);

cek('§1 kantong yang dipilih berkurang', await saldo(RISMA, KAS_RISMA), 700000);
cek('§1 Kas Utama pengirim TIDAK tersentuh', await saldo(RISMA, null), 50000);
// Kaki penerima selalu Kas Utama penerima: kantong adalah urusan pemiliknya.
cek('§1 penerima bertambah di Kas Utama-nya', await saldo(IIS, null), 300000);

const kakiOut = await satu(`select * from cash_entries where entry_type='transfer_out' order by created_at desc limit 1`);
const kakiIn = await satu(`select * from cash_entries where entry_type='transfer_in' order by created_at desc limit 1`);
cek('§1 kedua kakinya satu transfer_id', kakiOut.transfer_id, kakiIn.transfer_id);
cek('§1 kaki penerima tidak berkantong', kakiIn.account_id, null);

// ===============================================================
console.log('\n§2 Kantong asal dijaga');
// ===============================================================
await melempar(
  '§2 kantong milik orang lain ditolak',
  () => q(`select transfer_cash($1,$2,$3,$4)`, [IIS, 1000, 'coba', KAS_IIS]),
  /bukan milikmu/i
);
await melempar(
  '§2 kirim melebihi isi kantong ditolak',
  () => q(`select transfer_cash($1,$2,$3,$4)`, [IIS, 999999999, 'coba', KAS_RISMA]),
  /tidak cukup/i
);
cek('§2 dan tidak ada yang bergerak', await saldo(RISMA, KAS_RISMA), 700000);

// ===============================================================
console.log('\n§3 Tanda tangan lama sudah dibuang');
// ===============================================================

// ============ KENAPA INI DIUJI ============
//
// PostgREST memilih overload lewat HIMPUNAN NAMA ARGUMEN. Kalau yang lama
// dibiarkan hidup, pemanggilan yang lupa mengirim `p_from_account` akan
// memilih jalur lama dan memotong Kas Utama — persis bug yang diperbaiki di
// sini, tapi tanpa satu pun tanda di layar.
cek(
  '§3 cuma ada SATU transfer_cash',
  (await satu(`select count(*)::int as n from pg_proc where proname = 'transfer_cash'`)).n,
  1
);
cek(
  '§3 dan ia berargumen empat',
  (await satu(`select pronargs::int as n from pg_proc where proname = 'transfer_cash'`)).n,
  4
);

// ===============================================================
console.log('\n§4 Revisi memindahkan KEDUA kaki');
// ===============================================================
const revisi = (o = {}) =>
  satu(`select ubah_transfer_kas($1,$2,$3,$4,$5,$6) as h`, [
    o.entry ?? kakiOut.id,
    o.amount ?? 250000,
    o.to === undefined ? IIS : o.to,
    o.akun === undefined ? null : o.akun,
    o.notes ?? 'bayar bahan',
    o.alasan ?? 'salah kantong'
  ]);

await melempar('§4 alasan wajib', () => revisi({ alasan: '  ' }), /Alasan revisi wajib/i);
await melempar('§4 jumlah harus di atas nol', () => revisi({ amount: 0 }), /lebih dari 0/i);

// ============ KANTONG TUJUAN REVISI PUN TIDAK BOLEH MINUS ============
//
// Memindahkan transfer ke Kas Utama berarti Kas Utama yang membayarnya, dan
// isinya cuma 50rb. Yang BOLEH minus hanya kantong PENERIMA (§5) — uangnya
// memang sudah terlanjur berpindah di sana. Di sisi pengirim tidak ada yang
// terlanjur, jadi ia cuma salah pilih yang masih bisa ditolak.
await melempar('§4 revisi ke kantong yang isinya kurang ditolak', () => revisi({ amount: 250000, akun: null }), /tidak cukup/i);
cek('§4 dan tidak ada yang bergerak', await saldo(RISMA, KAS_RISMA), 700000);

// Jumlah 300rb -> 250rb DAN kantong KAS_RISMA -> Kas Utama, sesudah Kas
// Utamanya cukup.
await isiKantong(RISMA, null, 400000);
await revisi({ amount: 250000, akun: null });
cek('§4 kantong lama dikembalikan utuh', await saldo(RISMA, KAS_RISMA), 1000000);
cek('§4 kantong baru yang dipotong', await saldo(RISMA, null), 50000 + 400000 - 250000);
cek('§4 penerima ikut menyesuaikan', await saldo(IIS, null), 250000);

const sesudah = await satu(`select * from cash_entries where id = $1`, [kakiOut.id]);
cek('§4 jejak alasannya tersimpan', sesudah.alasan_ubah, 'salah kantong');
benar('§4 dan waktu ubahnya terisi', sesudah.diubah_at !== null);
cek(
  '§4 transfer_id-nya TIDAK berubah — satu kekeliruan tetap satu transaksi',
  sesudah.transfer_id,
  kakiOut.transfer_id
);

// ===============================================================
console.log('\n§5 Tujuan diganti: baris penerima lama ikut pindah');
// ===============================================================
await q(`insert into user_profiles (id, full_name) values ($1,'Elsha')`, ['44444444-4444-4444-4444-444444444444']);
const ELSHA = '44444444-4444-4444-4444-444444444444';
await q(`insert into membership_scopes (user_id, business_unit_id, outlet_id, role) values ($1,$2,$3,'staff')`, [ELSHA, BU, CK]);

// Iis sudah memakai sebagian uangnya — inilah keadaan yang membuat saldonya
// minus saat ditarik kembali, dan itu DITERIMA dengan sadar: salah alamat
// yang uangnya sudah terpakai harus tetap punya jalan keluar.
await q(`insert into cash_entries (holder_id, account_id, entry_type, amount, created_by, notes)
         values ($1,null,'out',-200000,$1,'beli galon')`, [IIS]);
cek('§5 saldo Iis sebelum revisi', await saldo(IIS, null), 50000);

await jadi(RISMA);
const h5 = (await revisi({ to: ELSHA, amount: 250000, akun: null, alasan: 'salah orang' })).h;
cek('§5 Elsha menerima', await saldo(ELSHA, null), 250000);
cek('§5 saldo Iis jadi MINUS, dan itu memang diterima', await saldo(IIS, null), -200000);
benar('§5 jawabannya menyebut penerimanya berubah', h5.penerima_berubah === true);
cek('§5 dan membawa saldo penerima LAMA untuk diberitahukan', Number(h5.saldo_penerima_lama), -200000);
cek(
  '§5 barisnya hilang dari riwayat Iis',
  (await satu(`select count(*)::int as n from cash_entries where holder_id=$1 and transfer_id=$2`, [IIS, kakiOut.transfer_id])).n,
  0
);

// ===============================================================
console.log('\n§6 Wewenang');
// ===============================================================
// ============ PENERIMA MENGKLIK KAKINYA SENDIRI ============
//
// Inilah satu-satunya bentuk yang membedakan "wewenang diukur ke PENGIRIM"
// dari "diukur ke baris yang diklik". Penerima yang mengklik kaki PENGIRIM
// tetap ditolak oleh aturan mana pun — jadi mengujinya lewat kaki itu tidak
// membuktikan apa-apa. Sabotasenya yang menunjukkan lubang ini.
const kakiElsha = await satu(
  `select id from cash_entries where holder_id = $1 and transfer_id = $2 and entry_type = 'transfer_in'`,
  [ELSHA, kakiOut.transfer_id]
);
benar('§6 kaki penerima memang ada untuk diklik', Boolean(kakiElsha?.id));

await jadi(ELSHA);
await melempar(
  '§6 penerima mengklik KAKINYA SENDIRI pun ditolak',
  () => revisi({ entry: kakiElsha.id, to: IIS }),
  /Hanya pengirimnya atau admin BU/i
);
await melempar('§6 penerima tidak boleh merevisi lewat kaki pengirim', () => revisi({ to: IIS }), /Hanya pengirimnya atau admin BU/i);
await jadi(IIS);
await melempar('§6 orang lain tidak boleh merevisi', () => revisi({ to: IIS }), /Hanya pengirimnya atau admin BU/i);

await jadi(ADMIN);
await revisi({ to: IIS, amount: 100000, akun: null, alasan: 'dibetulkan admin' });
cek('§6 admin BU boleh', await saldo(IIS, null), -200000 + 100000);

// Admin tidak boleh memindahkan asalnya ke kantong MILIKNYA sendiri.
await melempar(
  '§6 kantong asal harus milik PENGIRIM, bukan milik yang merevisi',
  () => revisi({ to: IIS, akun: KAS_IIS, alasan: 'coba' }),
  /bukan milik pengirim/i
);

// ===============================================================
console.log('\n§7 `ubah_kas` TETAP menolak transfer');
// ===============================================================
await jadi(RISMA);
await melempar(
  '§7 jalur satu-baris tidak boleh menyentuh transaksi berpasangan',
  () => q(`select ubah_kas($1,$2,null,null,'x',null,null,null,null)`, [kakiOut.id, -1]),
  /tidak bisa dikoreksi sepotong/i
);

// ===============================================================
console.log('\n§8 Dijalankan dua kali tetap aman');
// ===============================================================
await jalankan('0176_transfer_kantong_dan_revisi.sql');
await jalankan('0176_transfer_kantong_dan_revisi.sql');
cek('§8 saldonya tidak berubah sesudah dipasang 3x', await saldo(IIS, null), -100000);
cek(
  '§8 dan transfer_cash tetap satu',
  (await satu(`select count(*)::int as n from pg_proc where proname = 'transfer_cash'`)).n,
  1
);

// ---------------------------------------------------------------
console.log(`\n${gagal === 0 ? '✅' : '❌'} test-migrasi-0176: ${gagal === 0 ? 'semua' : gagal + ' GAGAL'}`);
process.exit(gagal === 0 ? 0 : 1);
