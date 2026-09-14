/**
 * MIGRATION 0141 DI POSTGRES SUNGGUHAN (PGlite).
 *
 * ============ YANG DIUJI ============
 *
 *   §1 `riwayat_kas_saya` MENYELESAIKAN nama outlet yang RLS-nya tidak membuka
 *      untuk pemegangnya. Inilah kolom kosong yang dilaporkan — dan satu-satunya
 *      cara membuktikannya adalah menyalakan RLS `outlets` sungguhan lalu
 *      menunjukkan bahwa select langsung memang kosong sementara RPC-nya tidak.
 *   §2 Coret = ditandai, bukan dibuang; saldo berhenti menghitungnya.
 *   §3 Yang TIDAK boleh dikoreksi, beserta sebabnya: pembayaran nota, transfer,
 *      entri penyesuaian, entri yang sudah dicoret, dan kas orang lain.
 *   §4 `ubah_kas` menjaga tanda nominal mengikuti jenisnya, dan mencatat siapa.
 *   §5 Admin BU boleh — TANPA melihat outlet basis (kasus Seruni).
 *   §6 Laporan kas & rincian mutasi kas berhenti menghitung yang dicoret.
 *   §7 Tepat satu bentuk tiap fungsi.
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
/** Jalankan dan tangkap galatnya sebagai teks (null = berhasil). */
const galat = async (sql, params) => {
  try {
    await q(sql, params);
    return null;
  } catch (e) {
    return String(e.message ?? e);
  }
};

await db.exec(`
  create role authenticated;
  create schema if not exists auth;
  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
  $$;

  create table business_units (id uuid primary key default gen_random_uuid(), name text);
  create table outlets (id uuid primary key default gen_random_uuid(), business_unit_id uuid, name text);
  create table user_profiles (id uuid primary key, full_name text, cash_account_limit int default 1);
  create table membership_scopes (
    id uuid primary key default gen_random_uuid(),
    user_id uuid, business_unit_id uuid, outlet_id uuid, role text);
  create table products (id uuid primary key default gen_random_uuid(), name text, base_unit text);
  create table cash_accounts (id uuid primary key default gen_random_uuid(), holder_id uuid, name text, outlet_id uuid,
    sort_order int default 0, is_active boolean default true);
  create table cash_categories (id uuid primary key default gen_random_uuid(), name text);
  create table cash_entries (
    id uuid primary key default gen_random_uuid(),
    business_unit_id uuid, outlet_id uuid, holder_id uuid, account_id uuid,
    entry_type text, amount numeric, category_id uuid, counterpart_id uuid, transfer_id uuid,
    notes text, qty numeric, unit text, entry_date date, proof_path text,
    untuk_nota boolean default false, penyesuaian_nota uuid,
    created_by uuid, created_at timestamptz default now());
  create table goods_receipts (
    id uuid primary key default gen_random_uuid(),
    business_unit_id uuid, outlet_id uuid, code text, supplier text,
    status text default 'aktif', payment_entry_id uuid);
  create table goods_receipt_items (
    id uuid primary key default gen_random_uuid(),
    receipt_id uuid, product_id uuid, qty numeric, unit_cost numeric, line_total numeric);

  -- "security definer" WAJIB, persis seperti aslinya di 0001.
  --
  -- Tanpa itu, kebijakan outlets_select memanggil has_outlet_scope sebagai role
  -- "authenticated", badannya membaca membership_scopes langsung, dan tesnya
  -- mati dengan "permission denied for table membership_scopes" — galat yang
  -- sama sekali tidak menyebut kebijakan outlet maupun kolom yang sedang diuji.
  --
  -- TANPA TANDA KUTIP MIRING di komentar ini: seluruh blok ini berada di dalam
  -- template literal JS, dan satu backtick saja menutupnya lebih awal. Sudah
  -- menggigit enam kali di repo ini.
  create or replace function is_super_admin(p_uid uuid) returns boolean
    language sql security definer stable as $$
      select exists (select 1 from membership_scopes where user_id = p_uid and role = 'super_admin') $$;
  create or replace function is_bu_admin(p_uid uuid, p_bu uuid) returns boolean
    language sql security definer stable as $$
      select exists (select 1 from membership_scopes
                      where user_id = p_uid and role in ('super_admin','bu_admin') and business_unit_id = p_bu) $$;
  create or replace function is_admin_of_outlet(p_uid uuid, p_outlet uuid) returns boolean
    language sql security definer stable as $$
      select exists (select 1 from membership_scopes
                      where user_id = p_uid and role in ('super_admin','bu_admin','outlet_admin')
                        and outlet_id = p_outlet) $$;
  -- Tiruan 0001, apa adanya: cakupan BU hanya lewat peran bu_admin.
  create or replace function has_outlet_scope(p_uid uuid, p_outlet uuid) returns boolean
    language sql security definer stable as $$
      select exists (
        select 1 from membership_scopes ms join outlets o on o.id = p_outlet
         where ms.user_id = p_uid
           and (ms.role = 'super_admin'
                or (ms.business_unit_id = o.business_unit_id and ms.role = 'bu_admin')
                or ms.outlet_id = p_outlet)) $$;

  -- RLS SUNGGUHAN pada outlets — inilah yang membuat kolom Outlet kosong.
  alter table outlets enable row level security;
  create policy outlets_select on outlets for select using (has_outlet_scope(auth.uid(), id));
  grant select on outlets, cash_entries, user_profiles, cash_accounts, cash_categories to authenticated;
`);

const jalankan = async (b) =>
  db.exec(fs.readFileSync(path.join(AKAR, 'supabase/migrations', b), 'utf8').replace(/notify pgrst[^;]*;/g, ''));

// 0140 lebih dulu: `boleh_lihat_kas` dipakai laporan yang ditulis ulang 0141.
await jalankan('0140_rincian_mutasi_kas.sql');
await jalankan('0141_koreksi_kas_dan_akses_admin_bu.sql');
console.log('  0140 + 0141 terpasang.');
await jalankan('0141_koreksi_kas_dan_akses_admin_bu.sql');
console.log('  0141 dijalankan ulang: aman.');

// =====================================================================
// DATA — kasus yang dilaporkan, apa adanya.
// =====================================================================
const BU = (await satu(`insert into business_units (name) values ('Awal Bermula Cafe') returning id`)).id;
const BU_ADM = (await satu(`insert into business_units (name) values ('Admin Divisi') returning id`)).id;
const CK = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Central Kitchen') returning id`, [BU])).id;
const SERPONG = (await satu(`insert into outlets (business_unit_id, name) values ($1,'AB Gading Serpong') returning id`, [BU])).id;
const OUT_ADM = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Admin') returning id`, [BU_ADM])).id;

const IIS = '11111111-1111-1111-1111-111111111111';
const RISMA = '22222222-2222-2222-2222-222222222222';
const SERUNI = '33333333-3333-3333-3333-333333333333';
const LUAR = '44444444-4444-4444-4444-444444444444';
await q(
  `insert into user_profiles (id, full_name) values ($1,'Iis Nurlailah'), ($2,'Risma'), ($3,'Seruni'), ($4,'Orang Luar')`,
  [IIS, RISMA, SERUNI, LUAR]
);
await q(
  `insert into membership_scopes (user_id, business_unit_id, outlet_id, role) values
     ($1,$5,$6,'outlet_admin'),  -- Iis: basis Central Kitchen
     ($2,$5,$7,'staff'),         -- Risma: basis Serpong
     ($3,$8,$9,'outlet_admin'),  -- Seruni: BASIS-nya di BU Admin Divisi
     ($3,$5,null,'bu_admin'),    -- ...tapi ia bu_admin di Awal Bermula Cafe
     ($4,null,null,'staff')`,
  [IIS, RISMA, SERUNI, LUAR, BU, CK, SERPONG, BU_ADM, OUT_ADM]
);

const KANTONG = (await satu(
  `insert into cash_accounts (holder_id, name, outlet_id) values ($1,'Kas Iis CK',$2) returning id`,
  [IIS, CK]
)).id;
const KAT = (await satu(`insert into cash_categories (name) values ('Transportasi') returning id`)).id;
const HARI = '2026-09-11';

/** Entri kas keluar biasa milik Iis. */
const buatEntri = async (o = {}) =>
  (await satu(
    `insert into cash_entries (business_unit_id, outlet_id, holder_id, account_id, entry_type, amount, category_id, notes, qty, unit, entry_date, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$3) returning id`,
    [
      BU,
      o.outlet ?? CK,
      IIS,
      KANTONG,
      o.type ?? 'out',
      o.amount ?? -50000,
      o.category ?? KAT,
      o.notes ?? 'Karcis parkir',
      o.qty ?? 1,
      o.unit ?? 'lembar',
      HARI
    ]
  )).id;

const sebagai = (uid) => q(`select set_config('request.jwt.claim.sub', $1, false)`, [uid]);

// =====================================================================
// §1 KOLOM OUTLET YANG KOSONG
//
// Risma (Serpong) membayar notanya dari Kas Iis CK, jadi entri itu
// berperuntukan SERPONG. Iis tidak bercakupan di sana.
// =====================================================================
const ENTRI_SERPONG = await buatEntri({ outlet: SERPONG, notes: 'Pembayaran nota TRM-260911-0A1B' });
await sebagai(IIS);

{
  // Buktinya dulu: select langsung memang tidak mengembalikan outletnya.
  const hasil = await db.exec(`
    set role authenticated;
    select set_config('request.jwt.claim.sub', '${IIS}', false);
    select name from outlets where id = '${SERPONG}';
    reset role;
  `);
  cek('§1 select langsung memang tidak melihat outlet Serpong (inilah sebab kolom kosong)', hasil[2].rows.length, 0);
}
{
  const hasil = await db.exec(`
    set role authenticated;
    select set_config('request.jwt.claim.sub', '${IIS}', false);
    select outlet_name from riwayat_kas_saya(50) where id = '${ENTRI_SERPONG}';
    reset role;
  `);
  cek('§1 riwayat_kas_saya TETAP menyebut nama outletnya', hasil[2].rows[0]?.outlet_name, 'AB Gading Serpong');
}
{
  const r = (await q(`select * from riwayat_kas_saya(50)`)).rows;
  cek('§1 hanya entri milik pemanggil yang terbawa', r.length, 1);
  cek('§1 kantongnya ikut', r[0]?.account_name, 'Kas Iis CK');
  cek('§1 kategorinya ikut', r.find((x) => x.id === ENTRI_SERPONG)?.category_name, 'Transportasi');
}
await sebagai(RISMA);
cek('§1 orang lain tidak melihat kas Iis', (await q(`select * from riwayat_kas_saya(50)`)).rows.length, 0);

// =====================================================================
// §2 CORET = DITANDAI, BUKAN DIBUANG
// =====================================================================
await sebagai(IIS);
const ENTRI_CORET = await buatEntri({ amount: -90000, notes: 'Bensin dobel' });

const saldoIis = async () => Number((await satu(`select balance from cash_balances where holder_id = $1`, [IIS]))?.balance ?? 0);
const sebelum = await saldoIis();

benar('§2 alasan wajib', (await galat(`select coret_kas($1, '')`, [ENTRI_CORET]) ?? '').includes('Sebutkan alasan'));
cek('§2 coret berhasil', await galat(`select coret_kas($1, 'salah input')`, [ENTRI_CORET]), null);

{
  const e = await satu(`select dicoret_at, dicoret_by, alasan_coret from cash_entries where id = $1`, [ENTRI_CORET]);
  benar('§2 barisnya TETAP ADA', !!e);
  benar('§2 ditandai waktunya', !!e.dicoret_at);
  cek('§2 dan siapa yang menghapusnya', e.dicoret_by, IIS);
  cek('§2 beserta alasannya', e.alasan_coret, 'salah input');
}
cek('§2 saldo berhenti menghitungnya', await saldoIis(), sebelum + 90000);
cek(
  '§2 saldo per kantong juga',
  Number((await satu(`select balance from cash_account_balances where account_id = $1`, [KANTONG]))?.balance ?? 0),
  sebelum + 90000
);
// Yang sudah dicoret tidak bisa dicoret/diubah lagi.
benar('§2 tidak bisa dicoret dua kali', (await galat(`select coret_kas($1, 'lagi')`, [ENTRI_CORET]) ?? '').includes('sudah dihapus'));
benar(
  '§2 dan tidak bisa diubah lagi',
  (await galat(`select ubah_kas($1, 1000, null, $2, 'x', null, null, null)`, [ENTRI_CORET, CK]) ?? '').includes('sudah dihapus')
);
// Tetap terlihat di riwayat — modul Kas satu-satunya tempat koreksinya bisa dibaca.
{
  const r = (await q(`select * from riwayat_kas_saya(50) where id = $1`, [ENTRI_CORET])).rows[0];
  benar('§2 tetap muncul di riwayat, ditandai', !!r?.dicoret_at);
  cek('§2 lengkap dengan nama penghapusnya', r.dicoret_oleh, 'Iis Nurlailah');
}

// =====================================================================
// §3 YANG TIDAK BOLEH DIKOREKSI — DAN SEBABNYA
// =====================================================================
// (a) Pembayaran nota.
const ENTRI_NOTA = await buatEntri({ amount: -185000, notes: 'Pembayaran nota TRM-0001' });
await q(`update cash_entries set untuk_nota = true where id = $1`, [ENTRI_NOTA]);
await q(
  `insert into goods_receipts (business_unit_id, outlet_id, code, supplier, payment_entry_id) values ($1,$2,'TRM-0001','Toko',$3)`,
  [BU, CK, ENTRI_NOTA]
);
{
  const a = await satu(`select alasan_tolak_koreksi_kas($1) as a`, [ENTRI_NOTA]);
  benar('§3 pembayaran nota ditolak', !!a.a);
  benar('§3 sebabnya menyebut nomor notanya', a.a.includes('TRM-0001'), a.a);
  // Penolakan yang tidak menunjukkan jalan keluar akan terbaca sebagai aplikasi
  // yang rusak, bukan sebagai aturan.
  benar('§3 dan menunjuk jalan keluarnya', a.a.includes('Batalkan Pembayaran'), a.a);
  benar('§3 RPC-nya ikut menolak', (await galat(`select coret_kas($1, 'apa pun')`, [ENTRI_NOTA]) ?? '').includes('TRM-0001'));
}

// (b) Transfer & pindah antar kantong: berpasangan.
const ENTRI_TRANSFER = await buatEntri({ type: 'transfer_out', amount: -10000, notes: 'Kirim ke Risma' });
{
  const a = (await satu(`select alasan_tolak_koreksi_kas($1) as a`, [ENTRI_TRANSFER])).a;
  benar('§3 transfer ditolak', !!a);
  benar('§3 sebabnya menyebut pasangannya', /berpasangan/i.test(a), a);
}

// (c) Entri penyesuaian nota (0131).
const ENTRI_SESUAI = await buatEntri({ amount: -15000, notes: 'Penyesuaian nota TRM-0001' });
await q(`update cash_entries set penyesuaian_nota = (select id from goods_receipts limit 1) where id = $1`, [ENTRI_SESUAI]);
benar('§3 entri penyesuaian ditolak', !!(await satu(`select alasan_tolak_koreksi_kas($1) as a`, [ENTRI_SESUAI])).a);

// (d) Kas orang lain.
await sebagai(RISMA);
{
  const a = (await satu(`select alasan_tolak_koreksi_kas($1) as a`, [ENTRI_SERPONG])).a;
  benar('§3 staff lain ditolak', !!a);
  benar('§3 sebabnya soal wewenang', /wewenang/i.test(a), a);
}
await sebagai(LUAR);
benar('§3 orang tanpa scope ditolak', !!(await satu(`select alasan_tolak_koreksi_kas($1) as a`, [ENTRI_SERPONG])).a);

// (e) Entri yang tidak ada.
await sebagai(IIS);
benar(
  '§3 entri yang tidak ada dijawab kalimat, bukan galat',
  !!(await satu(`select alasan_tolak_koreksi_kas('00000000-0000-0000-0000-000000000000') as a`)).a
);

// =====================================================================
// §4 UBAH
// =====================================================================
const ENTRI_UBAH = await buatEntri({ amount: -20000, notes: 'Salah ketik' });
cek(
  '§4 berhasil',
  await galat(`select ubah_kas($1, 35000, $2, $3, 'Parkir motor', 2, 'lembar', '2026-09-12')`, [ENTRI_UBAH, KAT, CK]),
  null
);
{
  // `entry_date::text`: PGlite bisa mengembalikan kolom `date` sebagai objek
  // Date, dan membandingkannya sebagai string menghasilkan "Sat Sep 12 2026…".
  const e = await satu(`select *, entry_date::text as tgl from cash_entries where id = $1`, [ENTRI_UBAH]);
  // TANDA NOMINAL MENGIKUTI JENISNYA, bukan apa yang dikirim layar. Layar yang
  // keliru mengirim angka positif untuk kas keluar akan MENAMBAH saldo, dan
  // angkanya tetap terlihat wajar di tabel.
  cek('§4 kas keluar tetap bertanda minus', Number(e.amount), -35000);
  cek('§4 keterangannya ikut', e.notes, 'Parkir motor');
  cek('§4 jumlah barangnya ikut', Number(e.qty), 2);
  cek('§4 tanggalnya ikut', e.tgl, '2026-09-12');
  cek('§4 tercatat siapa yang mengubah', e.diubah_by, IIS);
  benar('§4 beserta waktunya', !!e.diubah_at);
}
benar(
  '§4 nominal nol ditolak',
  (await galat(`select ubah_kas($1, 0, null, $2, 'x', null, null, null)`, [ENTRI_UBAH, CK]) ?? '').includes('lebih dari 0')
);
benar(
  '§4 keterangan kosong ditolak',
  (await galat(`select ubah_kas($1, 1000, null, $2, '   ', null, null, null)`, [ENTRI_UBAH, CK]) ?? '').includes('Keterangan wajib')
);
benar(
  '§4 kas keluar tanpa outlet ditolak',
  (await galat(`select ubah_kas($1, 1000, null, null, 'x', null, null, null)`, [ENTRI_UBAH]) ?? '').includes('outlet peruntukan')
);
// Kas MASUK tidak punya peruntukan (0063) — outlet yang dikirim layar
// diabaikan, bukan disimpan diam-diam.
const MASUK = await buatEntri({ type: 'in', amount: 100000, outlet: null, notes: 'Setoran' });
{
  await q(`select ubah_kas($1, 250000, null, $2, 'Setoran owner', null, null, null)`, [MASUK, CK]);
  const e = await satu(`select amount, outlet_id from cash_entries where id = $1`, [MASUK]);
  cek('§4 kas masuk tetap bertanda plus', Number(e.amount), 250000);
  cek('§4 dan outletnya tetap kosong', e.outlet_id, null);
}

// =====================================================================
// §5 ADMIN BU — TANPA MELIHAT OUTLET BASIS (kasus Seruni)
// =====================================================================
await sebagai(SERUNI);
cek('§5 Seruni boleh mengoreksi kas Iis', (await satu(`select boleh_koreksi_kas($1) as b`, [IIS])).b, true);
benar('§5 dan entri biasanya memang boleh', !(await satu(`select alasan_tolak_koreksi_kas($1) as a`, [ENTRI_UBAH])).a);
{
  cek('§5 Seruni bisa mencoretnya', await galat(`select coret_kas($1, 'dobel, dicek admin')`, [ENTRI_UBAH]), null);
  const e = await satu(`select dicoret_by from cash_entries where id = $1`, [ENTRI_UBAH]);
  cek('§5 dan namanya yang tercatat', e.dicoret_by, SERUNI);
}
// Seruni tidak punya SATU PUN baris cakupan yang menyebut Central Kitchen —
// basisnya di outlet Admin, BU yang lain. Haknya murni datang dari peran
// bu_admin-nya di Awal Bermula Cafe.
cek(
  '§5 Seruni tidak punya cakupan outlet di Central Kitchen',
  (await satu(`select count(*)::int as n from membership_scopes where user_id = $1 and outlet_id = $2`, [SERUNI, CK])).n,
  0
);

// INI yang membuat aturan berbasis outlet mustahil dipakai: KAS MASUK tidak
// punya peruntukan sama sekali (0063), jadi `has_outlet_scope(x, NULL)` selalu
// false. Aturan apa pun yang menyebut outlet akan diam-diam menutup SELURUH
// baris kas masuk — bug yang persis sama sudah pernah terjadi di
// `laporan_kas_user` dan diperbaiki di 0063.
cek('§5 entri kas MASUK memang tanpa outlet', (await satu(`select outlet_id from cash_entries where id = $1`, [MASUK])).outlet_id, null);
benar('§5 dan Seruni tetap boleh mengoreksinya', !(await satu(`select alasan_tolak_koreksi_kas($1) as a`, [MASUK])).a);

await sebagai(LUAR);
cek('§5 orang tanpa peran admin tidak boleh', (await satu(`select boleh_koreksi_kas($1) as b`, [IIS])).b, false);

// =====================================================================
// §6 LAPORAN BERHENTI MENGHITUNG YANG DICORET
// =====================================================================
await sebagai(SERUNI);
{
  const baris = (await q(`select * from laporan_kas_user('2026-09-01','2026-09-30',$1,null,null)`, [IIS])).rows;
  benar('§6 laporan kas tidak memuat entri yang dicoret', !baris.some((r) => r.notes === 'Bensin dobel'));
  benar('§6 tapi tetap memuat yang biasa', baris.some((r) => r.notes === 'Setoran owner'));
}
{
  const baris = (await q(`select * from rincian_mutasi_kas('2026-09-01','2026-09-30',$1,null,false,null,null)`, [IIS])).rows;
  benar('§6 rincian mutasi kas juga tidak memuatnya', !baris.some((r) => r.item === 'Bensin dobel'));
  benar('§6 dan tetap memuat yang biasa', baris.some((r) => r.item === 'Setoran owner'));
}

// =====================================================================
// §7 BENTUK BANYAK & PENJAGA
// =====================================================================
{
  const baris = (await q(`select * from alasan_tolak_koreksi_kas_banyak(array[$1,$2]::uuid[])`, [ENTRI_NOTA, ENTRI_SERPONG])).rows;
  cek('§7 menjawab satu baris per entri', baris.length, 2);
  benar('§7 yang terlarang punya alasan', !!baris.find((r) => r.entry_id === ENTRI_NOTA)?.alasan);
  benar('§7 yang boleh alasannya null', baris.find((r) => r.entry_id === ENTRI_SERPONG)?.alasan == null);
}
cek('§7 daftar kosong aman', (await q(`select * from alasan_tolak_koreksi_kas_banyak(array[]::uuid[])`)).rows.length, 0);
cek('§7 null aman', (await q(`select * from alasan_tolak_koreksi_kas_banyak(null)`)).rows.length, 0);

for (const fn of ['ubah_kas', 'coret_kas', 'riwayat_kas_saya', 'boleh_koreksi_kas', 'alasan_tolak_koreksi_kas', 'alasan_tolak_koreksi_kas_banyak']) {
  const n = (
    await q(
      `select count(*)::int as n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
        where ns.nspname = 'public' and p.proname = $1`,
      [fn]
    )
  ).rows[0].n;
  cek(`§7 ${fn} hanya satu bentuk`, n, 1);
}

if (gagal) {
  console.error(`\n${gagal} kasus gagal.`);
  process.exit(1);
}
console.log('0141 benar — kolom outlet terisi, coretan meninggalkan jejak, saldo berhenti menghitungnya, dan admin BU boleh lintas outlet. ✅');
