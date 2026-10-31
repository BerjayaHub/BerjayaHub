/**
 * MIGRATION 0175 — SALDO BERJALAN PER KANTONG, DI POSTGRES SUNGGUHAN (PGlite).
 *
 * ============ APA YANG DIBUKTIKAN ============
 *
 *   §1 Saldo baris TERBARU sama persis dengan `cash_account_balances` —
 *      kolom baru ini dan saldo di kepala halaman tidak boleh berselisih.
 *   §2 Entri dicoret & "Dibayar Pusat" tidak menggerakkan saldo, dan barisnya
 *      tidak diberi angka sama sekali.
 *   §3 Kas Utama (account_id NULL) punya saldonya sendiri.
 *   §4 Saringan tidak mengubah angkanya: meminta SEPOTONG id menghasilkan
 *      saldo yang sama dengan meminta seluruhnya.
 *   §5 Urutannya tanggal entri, bukan waktu ketik.
 *   §6 Wewenang: pemegang lain tidak dapat angkanya, dan tidak dapat 0.
 *   §7 Dijalankan dua kali tetap aman.
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
console.log('  0153 + 0175 terpasang.');
for (const fn of ['saldo_berjalan_kas', 'boleh_lihat_saldo_kas']) {
  benar(`§0 \`${fn}\` ada sesudah migrationnya`, (await satu(`select count(*)::int as n from pg_proc where proname = $1`, [fn])).n > 0);
}

// ---------------------------------------------------------------
// Riwayat buatan: satu kantong Risma, beberapa entri bertanggal.
// Ditulis langsung ke tabel supaya tanggal & urutannya bisa diatur persis.
// ---------------------------------------------------------------
const buat = async ({ tgl, jumlah, akun = KAS_RISMA, holder = RISMA, pusat = false, dicoret = false }) =>
  (
    await satu(
      `insert into cash_entries (holder_id, account_id, entry_type, amount, entry_date, dibayar_pusat, dicoret_at, created_by, notes)
       values ($1,$2,$3,$4,$5::date,$6,$7,$1,'uji') returning id`,
      [holder, akun, jumlah >= 0 ? 'in' : 'out', jumlah, tgl, pusat, dicoret ? new Date().toISOString() : null]
    )
  ).id;

const E1 = await buat({ tgl: '2026-10-01', jumlah: 1000000 });
const E2 = await buat({ tgl: '2026-10-05', jumlah: -250000 });
const E3 = await buat({ tgl: '2026-10-09', jumlah: -100000 });

const saldoPeta = async (ids, sbg = RISMA) => {
  await jadi(sbg);
  const r = await semua(`select id, saldo from saldo_berjalan_kas($1::uuid[])`, [ids]);
  return new Map(r.map((x) => [x.id, Number(x.saldo)]));
};

// ===============================================================
console.log('\n§1 Baris terbaru = saldo kantong di kepala halaman');
// ===============================================================
await jadi(RISMA);
const semuaId = [E1, E2, E3];
let s = await saldoPeta(semuaId);
cek('§1 saldo berjalan menumpuk', [s.get(E1), s.get(E2), s.get(E3)], [1000000, 750000, 650000]);

// ============ INI PEMERIKSAAN INTINYA ============
//
// Kepala halaman menampilkan `cash_account_balances`. Kalau kolom baru ini
// memakai aturan yang sedikit berbeda, baris terbaru akan menampilkan angka
// LAIN daripada saldo di atasnya — dua angka untuk hal yang sama, di satu
// layar, dan tidak ada cara menebak mana yang benar.
const viewSaldo = async (akun = KAS_RISMA, holder = RISMA) =>
  Number(
    (
      await satu(`select balance from cash_account_balances where holder_id = $1 and account_id is not distinct from $2`, [
        holder,
        akun
      ])
    )?.balance ?? 0
  );
cek('§1 cocok dengan cash_account_balances', s.get(E3), await viewSaldo());

// ===============================================================
console.log('\n§2 Dicoret & Dibayar Pusat tidak menggerakkan saldo');
// ===============================================================
// `cash_entries_pusat_tanpa_kantong` (0153) mensyaratkan entri Pusat TIDAK
// berkantong — memang begitu artinya: uangnya tidak keluar dari kantong mana
// pun. Jadi ia duduk di Kas Utama dan tetap harus tidak diberi angka.
const E_PUSAT = await buat({ tgl: '2026-10-10', jumlah: -500000, akun: null, pusat: true });
const E_CORET = await buat({ tgl: '2026-10-11', jumlah: -400000, dicoret: true });
const E4 = await buat({ tgl: '2026-10-12', jumlah: -50000 });

s = await saldoPeta([E1, E2, E3, E_PUSAT, E_CORET, E4]);
benar('§2 entri Dibayar Pusat tidak diberi angka', !s.has(E_PUSAT), String(s.get(E_PUSAT)));
benar('§2 entri dicoret tidak diberi angka', !s.has(E_CORET), String(s.get(E_CORET)));
// Dan yang sesudahnya tidak ikut terpotong — kalau keduanya ikut dijumlahkan,
// angkanya jadi 650.000 - 500.000 - 400.000 - 50.000 = -300.000.
cek('§2 entri sesudahnya tidak ikut terpotong', s.get(E4), 600000);
cek('§2 tetap cocok dengan view saldo', s.get(E4), await viewSaldo());

// ===============================================================
console.log('\n§3 Kas Utama (account_id NULL) punya saldonya sendiri');
// ===============================================================
const U1 = await buat({ tgl: '2026-10-02', jumlah: 300000, akun: null });
const U2 = await buat({ tgl: '2026-10-06', jumlah: -120000, akun: null });
s = await saldoPeta([U1, U2, E4]);
// `=` tidak pernah cocok untuk NULL. Kalau partisinya memakai `=`, kedua baris
// ini kehilangan saldonya — tanpa galat, cuma dua strip di layar.
cek('§3 Kas Utama dapat angkanya', [s.get(U1), s.get(U2)], [300000, 180000]);
cek('§3 dan TIDAK tercampur dengan kantong lain', s.get(E4), 600000);
cek('§3 cocok dengan view saldo Kas Utama', s.get(U2), await viewSaldo(null));

// ===============================================================
console.log('\n§4 Saringan tidak mengubah angkanya');
// ===============================================================

// ============ SATU-SATUNYA ALASAN INI ADA DI DATABASE ============
//
// Layar menyaring: Staff App cuma 50 entri terakhir, Admin Portal menyaring
// pemegang/jenis/tanggal/bahan. Kalau saldonya dijumlahkan dari baris yang
// lolos saringan, angkanya berubah mengikuti saringan — dan tidak ada yang
// bisa membedakannya dari saldo sungguhan.
const sepotong = await saldoPeta([E4]);
cek('§4 meminta satu id saja memberi angka yang sama', sepotong.get(E4), 600000);
const tengah = await saldoPeta([E2]);
cek('§4 baris tengah pun angkanya utuh', tengah.get(E2), 750000);

// ===============================================================
console.log('\n§5 Urutannya tanggal entri, bukan waktu ketik');
// ===============================================================
// Diketik PALING AKHIR, tapi tanggalnya di antara E1 dan E2.
const MUNDUR = await buat({ tgl: '2026-10-03', jumlah: -200000 });
s = await saldoPeta([E1, MUNDUR, E2, E3, E4]);
cek('§5 entri mundur duduk di posisi tanggalnya', s.get(MUNDUR), 800000);
cek('§5 dan baris sesudahnya ikut bergeser', s.get(E2), 550000);
cek('§5 saldo akhir tetap cocok dengan view', s.get(E4), await viewSaldo());

// ===============================================================
console.log('\n§6 Wewenang');
// ===============================================================
// Iis bukan pemegang kantong Risma dan bukan admin BU.
const sIis = await saldoPeta([E1, E4], IIS);
benar('§6 pemegang lain tidak mendapat angkanya', sIis.size === 0, JSON.stringify([...sIis]));

// ============ TIDAK DIKETAHUI ≠ NOL ============
//
// Mengembalikan 0 akan terbaca "kantongnya kosong" — yang menuntut tindakan
// yang bertolak belakang dengan "angkanya tidak bisa dihitung".
benar('§6 dan TIDAK dikembalikan sebagai 0', sIis.get(E4) === undefined);

// 400.000, bukan 600.000: §5 menyisipkan entri mundur −200.000 yang
// tanggalnya mendahului E4. Angka di sini sengaja dicocokkan ke view, bukan
// ditulis sebagai konstanta kedua — konstanta yang disalin akan menyimpang
// diam-diam begitu bagian di atasnya berubah.
const sAdmin = await saldoPeta([E4], ADMIN);
await jadi(RISMA);
cek('§6 admin BU mendapat angka yang sama dengan pemegangnya', sAdmin.get(E4), await viewSaldo());

await jadi(null);
const sAnon = await semua(`select id, saldo from saldo_berjalan_kas($1::uuid[])`, [[E4]]);
cek('§6 tanpa login tidak mengembalikan apa pun', sAnon.length, 0);

// ===============================================================
console.log('\n§7 Dijalankan dua kali tetap aman');
// ===============================================================
await jalankan('0175_saldo_berjalan_kas.sql');
await jalankan('0175_saldo_berjalan_kas.sql');
s = await saldoPeta([E4]);
await jadi(RISMA);
cek('§7 hasilnya tidak berubah sesudah dipasang 3x', s.get(E4), await viewSaldo());
benar(
  '§7 indeksnya tidak digandakan',
  (await satu(`select count(*)::int as n from pg_indexes where indexname = 'idx_cash_entries_saldo_berjalan'`)).n === 1
);

// ---------------------------------------------------------------
console.log(`\n${gagal === 0 ? '✅' : '❌'} test-migrasi-0175: ${gagal === 0 ? 'semua' : gagal + ' GAGAL'}`);
process.exit(gagal === 0 ? 0 : 1);
