/**
 * MIGRATION 0153 DI POSTGRES SUNGGUHAN (PGlite).
 *
 * ============ APA YANG DIBUKTIKAN ============
 *
 *   §0 Migrationnya jalan — lima fungsi yang DISALIN dari migration lain
 *      masih bisa dibuat. Salinan yang rusak gagal di sini, bukan di produksi.
 *   §1 Kas keluar bisa dibebankan ke kantong outlet LAIN, dan holder-nya jadi
 *      pemilik kantong itu.
 *   §2 Supplier ikut tersimpan lewat jalur itu — sebelum 0153 ia lenyap.
 *   §3 DIBAYAR PUSAT: tercatat, tapi TIDAK mengubah saldo di KEEMPAT tempat.
 *   §4 Dua constraint yang menjaga bentuknya.
 *   §5 Nama kantong yang ditampilkan: "Pusat", bukan "Kas Utama".
 *   §6 Penjaga lama `catat_kas_di` selamat dari penulisan ulang.
 *   §7 Ekspor membawa tandanya; `ubah_kantong_kas` menolaknya.
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
console.log('  0153 terpasang.');
for (const fn of ['label_kantong_kas', 'catat_kas_di', 'pindah_kas', 'daftar_kantong_kas', 'riwayat_kas_saya', 'laporan_kas_user', 'rincian_mutasi_kas', 'kas_untuk_esb', 'ubah_kantong_kas']) {
  benar(`§0 \`${fn}\` ada sesudah migrationnya`, (await satu(`select count(*)::int as n from pg_proc where proname = $1`, [fn])).n > 0);
}

console.log('\n§1 Kas keluar dari kantong outlet LAIN');

await jadi(RISMA);
// Risma (basis Serpong) membebani Kas CK milik Iis. Izinnya sudah ada sejak
// 0126; yang baru cuma jalannya di layar.
const DARI_CK = (
  await satu(
    `select catat_kas_di($1,'out',30000,$2,$3,'gojek makanan','bukti/a.jpg','2026-09-19',null,null,'GOJEK',false) as id`,
    [KAS_IIS, KAT, SERPONG]
  )
).id;
const b1 = await satu(`select * from cash_entries where id = $1`, [DARI_CK]);
benar('§1 INTI: entrinya jadi, walau kantongnya milik Iis', b1 !== undefined);
benar('§1 holder-nya PEMILIK KANTONG, bukan yang mencatat', b1.holder_id === IIS);
benar('§1 pencatatnya tetap tercatat di created_by', b1.created_by === RISMA);
cek('§1 outlet peruntukannya yang dipilih Risma', b1.outlet_id, SERPONG);
cek('§1 nominalnya negatif — tandanya ditentukan fungsinya', Number(b1.amount), -30000);

console.log('\n§2 Supplier ikut lewat jalur itu');

// SEBELUM 0153 `catat_kas_di` tidak punya `p_supplier` sama sekali — Payment
// To lenyap diam-diam, dan entrinya tertahan saat diekspor dengan alasan yang
// terlihat datang entah dari mana.
cek('§2 INTI: suppliernya tersimpan', b1.supplier, 'GOJEK');
const MASUK_TANPA_SUP = (
  await satu(`select catat_kas_di($1,'in',50000,null,null,'setoran',null,'2026-09-19',null,null,'GOJEK',false) as id`, [KAS_RISMA])
).id;
benar(
  '§2 kas MASUK tidak menyimpan supplier — hanya kas keluar yang jadi Disbursement',
  (await satu(`select supplier from cash_entries where id = $1`, [MASUK_TANPA_SUP])).supplier === null
);

console.log('\n§3 DIBAYAR PUSAT tidak mengubah saldo, di keempat tempat');

const saldoPemegang = async (u) => Number((await satu(`select balance from cash_balances where holder_id = $1`, [u]))?.balance ?? 0);
const saldoKantong = async (u) =>
  (await semua(`select account_name, balance::int from cash_account_balances where holder_id = $1 order by account_name`, [u])).map(
    (r) => `${r.account_name}=${r.balance}`
  );

await jadi(ADMIN);
const sebelumRisma = await saldoPemegang(RISMA);
const sebelumIis = await saldoPemegang(IIS);
const sebelumKantongRisma = await saldoKantong(RISMA);

await jadi(RISMA);
const PUSAT = (
  await satu(
    `select catat_kas_di(null,'out',500000,$1,$2,'sewa genset','bukti/b.jpg','2026-09-20',null,null,'GOJEK',true) as id`,
    [KAT, SERPONG]
  )
).id;
const bp = await satu(`select * from cash_entries where id = $1`, [PUSAT]);
benar('§3 barisnya ADA — pengeluarannya tercatat', bp !== undefined);
benar('§3 ditandai dibayar_pusat', bp.dibayar_pusat === true);
benar('§3 tanpa kantong', bp.account_id === null);
benar('§3 holder-nya yang mencatat', bp.holder_id === RISMA);
cek('§3 nominalnya tetap negatif', Number(bp.amount), -500000);

await jadi(ADMIN);
cek('§3 INTI: saldo pemegang TIDAK berubah (cash_balances)', await saldoPemegang(RISMA), sebelumRisma);
cek('§3 INTI: saldo per kantong TIDAK berubah (cash_account_balances)', await saldoKantong(RISMA), sebelumKantongRisma);
cek('§3 saldo Iis juga tidak tersenggol', await saldoPemegang(IIS), sebelumIis);

// Tempat ketiga: `daftar_kantong_kas` (layar admin Kantong Kas).
await q(`insert into membership_scopes (user_id, business_unit_id, role) values ($1,$2,'super_admin')`, [ADMIN, BU]);
const barisKantong = await semua(`select holder_name, name, balance::int as saldo from daftar_kantong_kas() order by holder_name, name`);
const kantongRisma = barisKantong.filter((r) => r.holder_name === 'Risma');
benar(
  '§3 INTI: layar Kantong Kas tidak memuat Rp500.000 itu di mana pun',
  !kantongRisma.some((r) => Math.abs(Number(r.saldo)) >= 500000),
  JSON.stringify(kantongRisma)
);

// Tempat keempat: pemeriksaan saldo di `pindah_kas`.
//
// Baris Pusat ber-`account_id` NULL, jadi tanpa pengecualian ia akan mengurangi
// "Kas Utama" — dan Risma tidak bisa memindahkan uang yang sungguh ada di sana.
await jadi(RISMA);
const KAS_KEDUA = (
  await satu(`insert into cash_accounts (holder_id, name, outlet_id) values ($1,'Kas Cadangan',null) returning id`, [RISMA])
).id;
await q(`insert into cash_entries (holder_id, account_id, entry_type, amount, notes, created_by) values ($1,null,'in',100000,'setoran awal',$1)`, [
  RISMA
]);
await melempar(
  '§3 pindah dari Kas Utama melebihi isinya tetap ditolak',
  () => q(`select pindah_kas(null,$1,999999,'coba')`, [KAS_KEDUA]),
  /tidak cukup/
);
await q(`select pindah_kas(null,$1,100000,'pindah semua')`, [KAS_KEDUA]);
cek(
  '§3 INTI: Rp100.000 di Kas Utama bisa dipindahkan penuh — baris Pusat tidak ikut dihitung',
  Number((await satu(`select balance from cash_account_balances where holder_id = $1 and account_id = $2`, [RISMA, KAS_KEDUA])).balance),
  100000
);

console.log('\n§4 Dua constraint yang menjaga bentuknya');

await melempar(
  '§4 Pusat + kantong sekaligus ditolak database',
  () => q(`insert into cash_entries (holder_id, account_id, entry_type, amount, dibayar_pusat) values ($1,$2,'out',-1,true)`, [RISMA, KAS_RISMA]),
  /cash_entries_pusat_tanpa_kantong/
);
await melempar(
  '§4 kas MASUK bertanda Pusat ditolak database',
  () => q(`insert into cash_entries (holder_id, entry_type, amount, dibayar_pusat) values ($1,'in',1,true)`, [RISMA]),
  /cash_entries_pusat_hanya_keluar/
);
await melempar(
  '§4 …dan fungsinya menolaknya lebih dulu, dengan kalimat yang bisa dibaca',
  () => q(`select catat_kas_di(null,'in',1000,null,null,'x',null,null,null,null,null,true)`),
  /kas keluar/
);
await melempar(
  '§4 Pusat + kantong lewat fungsinya juga ditolak',
  () => q(`select catat_kas_di($1,'out',1000,null,$2,'x','bukti/c.jpg',null,null,null,null,true)`, [KAS_RISMA, SERPONG]),
  /bukan keduanya/
);

console.log('\n§5 Namanya "Pusat", bukan "Kas Utama"');

cek('§5 label_kantong_kas: bertanda', (await satu(`select label_kantong_kas('Kas Serpong', true) as n`)).n, 'Pusat');
cek('§5 label_kantong_kas: tanpa kantong', (await satu(`select label_kantong_kas(null, false) as n`)).n, 'Kas Utama');
cek('§5 label_kantong_kas: null pusat = false', (await satu(`select label_kantong_kas(null, null) as n`)).n, 'Kas Utama');
cek('§5 label_kantong_kas: bernama', (await satu(`select label_kantong_kas('Kas Serpong', false) as n`)).n, 'Kas Serpong');

await jadi(RISMA);
const riw = await semua(`select notes, account_name from riwayat_kas_saya(50)`);
cek(
  '§5 INTI: riwayat Staff App menyebutnya Pusat',
  riw.find((r) => r.notes === 'sewa genset')?.account_name,
  'Pusat'
);
await jadi(ADMIN);
const lap = await semua(`select notes, account_name from laporan_kas_user('2026-09-01','2026-09-30',null,null,null)`);
cek('§5 laporan kas juga', lap.find((r) => r.notes === 'sewa genset')?.account_name, 'Pusat');
const rinc = await semua(`select item, account_name from rincian_mutasi_kas('2026-09-01','2026-09-30',null,null,false,null,null)`);
cek('§5 rincian mutasi kas juga', rinc.find((r) => r.item === 'sewa genset')?.account_name, 'Pusat');
// Dan baris biasa tetap bernama benar — bukan semuanya jadi "Pusat".
cek('§5 baris biasa tetap memakai nama kantongnya', rinc.find((r) => r.item === 'gojek makanan')?.account_name, 'Kas CK iis');

console.log('\n§6 Penjaga lama catat_kas_di selamat');

await melempar('§6 jenis selain in/out ditolak', () => q(`select catat_kas_di($1,'move_out',1000,null,$2,'x','b.jpg',null,null,null,null,false)`, [KAS_RISMA, SERPONG]), /in atau out/);
await melempar('§6 nominal nol ditolak', () => q(`select catat_kas_di($1,'out',0,null,$2,'x','b.jpg',null,null,null,null,false)`, [KAS_RISMA, SERPONG]), /lebih besar dari 0/);
await melempar('§6 kas keluar tanpa outlet ditolak', () => q(`select catat_kas_di($1,'out',1000,null,null,'x','b.jpg',null,null,null,null,false)`, [KAS_RISMA]), /outlet peruntukan/);
await melempar('§6 kas keluar tanpa bukti ditolak', () => q(`select catat_kas_di($1,'out',1000,null,$2,'x',null,null,null,null,null,false)`, [KAS_RISMA, SERPONG]), /foto bukti/);
await melempar('§6 kantong yang tidak ada ditolak', () => q(`select catat_kas_di($1,'out',1000,null,$2,'x','b.jpg',null,null,null,null,false)`, [BU, SERPONG]), /tidak ditemukan/);
await q(`update cash_accounts set is_active = false where id = $1`, [KAS_IIS]);
await melempar('§6 kantong yang ditutup ditolak, dengan pesannya sendiri', () => q(`select catat_kas_di($1,'out',1000,null,$2,'x','b.jpg',null,null,null,null,false)`, [KAS_IIS, SERPONG]), /sudah ditutup/);
await q(`update cash_accounts set is_active = true where id = $1`, [KAS_IIS]);
await melempar('§6 tanpa kantong DAN tanpa Pusat ditolak', () => q(`select catat_kas_di(null,'out',1000,null,$1,'x','b.jpg',null,null,null,null,false)`, [SERPONG]), /Pilih dulu kantong/);

// Wewenang: orang di luar BU tidak boleh membebani kantongnya.
const LUAR = '44444444-4444-4444-4444-444444444444';
await q(`insert into user_profiles (id, full_name) values ($1,'Orang Luar')`, [LUAR]);
await jadi(LUAR);
await melempar(
  '§6 INTI: orang di luar BU tidak berhak membebani kantong itu',
  () => q(`select catat_kas_di($1,'out',1000,null,$2,'x','b.jpg',null,null,null,null,false)`, [KAS_IIS, SERPONG]),
  /tidak berhak/
);

console.log('\n§7 Ekspor & pemindahan kantong');

await jadi(ADMIN);
const ekspor = await semua(`select notes, kantong_nama, kantong_outlet_nama, dibayar_pusat from kas_untuk_esb($1,'2026-09-01','2026-09-30',null)`, [BU]);
const barisPusat = ekspor.find((r) => r.notes === 'sewa genset');
benar('§7 INTI: baris Pusat ikut ditawarkan ekspor', barisPusat !== undefined);
benar('§7 …dan membawa tandanya', barisPusat?.dibayar_pusat === true);
cek('§7 …dengan nama kantong "Pusat"', barisPusat?.kantong_nama, 'Pusat');
benar('§7 …dan tanpa outlet kantong', barisPusat?.kantong_outlet_nama === null);
const barisBiasa = ekspor.find((r) => r.notes === 'gojek makanan');
benar('§7 baris biasa tidak bertanda', barisBiasa?.dibayar_pusat === false);
cek('§7 …dan outlet kantongnya terbaca', barisBiasa?.kantong_outlet_nama, 'Central Kitchen Tangerang');

cek(
  '§7 INTI: baris Pusat tidak bisa diberi kantong — itu pernyataan yang salah',
  (await satu(`select ubah_kantong_kas($1,$2) as n`, [[PUSAT], KAS_RISMA])).n,
  0
);

console.log('\n§8 Dijalankan ulang');

// Dibandingkan dengan keadaan TEPAT SEBELUM dijalankan ulang, bukan dengan
// angka dari awal berkas: §3 menambahkan setoran, dan angka tetap yang lupa
// diperbarui membuat tes ini merah karena alasan yang tidak ada hubungannya
// dengan idempotensi.
const sebelumUlang = await saldoPemegang(RISMA);
await jalankan('0153_bayar_dari_kantong_lain_dan_pusat.sql');
cek('§8 aman dijalankan dua kali', await saldoPemegang(RISMA), sebelumUlang);
// Dan kolom/constraint-nya tidak digandakan.
cek(
  '§8 constraint-nya tidak digandakan',
  (await satu(`select count(*)::int as n from pg_constraint where conname like 'cash_entries_pusat_%'`)).n,
  2
);

console.log('');
if (gagal === 0) console.log('Semua pemeriksaan 0153 lolos. ✅');
else console.error(`${gagal} pemeriksaan 0153 GAGAL.`);
process.exit(gagal === 0 ? 0 : 1);
