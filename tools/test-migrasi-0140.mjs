/**
 * MIGRATION 0140 DI POSTGRES SUNGGUHAN (PGlite).
 *
 * ============ YANG DIUJI ============
 *
 *   §1 Pembayaran nota PECAH jadi baris per bahan, dan jumlah nilainya sama
 *      dengan nominal entri kasnya.
 *   §2 Nilai baris memakai `line_total` dulu; baris tanpa harga bernilai NULL,
 *      bukan 0.
 *   §3 Entri kas non-nota tampil dengan MAPPING kategorinya.
 *   §4 Entri PENYESUAIAN (untuk_nota = true tapi tidak ada nota yang
 *      menunjuknya) TIDAK hilang — inilah sebab pembedanya bukan `untuk_nota`.
 *   §5 Filter kantong: id tertentu, "Kas Utama" (tanpa kantong), dan kosong.
 *   §6 Keterlihatan: orang yang tidak berhak tidak dapat satu baris pun.
 *   §7 `kantong_kas_terlihat` memuat Kas Utama.
 *   §8 Tepat satu bentuk tiap fungsi.
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
  create table user_profiles (id uuid primary key, full_name text);
  create table membership_scopes (
    id uuid primary key default gen_random_uuid(),
    user_id uuid, business_unit_id uuid, outlet_id uuid, role text);
  create table products (id uuid primary key default gen_random_uuid(), name text, base_unit text);
  create table cash_accounts (id uuid primary key default gen_random_uuid(), holder_id uuid, name text, outlet_id uuid);
  create table cash_categories (id uuid primary key default gen_random_uuid(), name text);
  create table cash_entries (
    id uuid primary key default gen_random_uuid(),
    business_unit_id uuid, outlet_id uuid, holder_id uuid, account_id uuid,
    entry_type text, amount numeric, category_id uuid, counterpart_id uuid,
    notes text, qty numeric, unit text, entry_date date,
    untuk_nota boolean default false, penyesuaian_nota uuid,
    created_at timestamptz default now());
  create table goods_receipts (
    id uuid primary key default gen_random_uuid(),
    business_unit_id uuid, outlet_id uuid, code text, supplier text,
    status text default 'aktif', payment_entry_id uuid);
  create table goods_receipt_items (
    id uuid primary key default gen_random_uuid(),
    receipt_id uuid, product_id uuid, qty numeric, unit_cost numeric, line_total numeric);

  -- Tiruan fungsi izin yang SUDAH ADA di 0001. Sengaja berperilaku seperti
  -- aslinya (dibaca dari membership_scopes), bukan selalu true: kalau
  -- tiruannya selalu mengizinkan, §6 lulus tanpa pernah menguji apa pun.
  create or replace function is_super_admin(p_uid uuid) returns boolean
    language sql stable as $$
      select exists (select 1 from membership_scopes where user_id = p_uid and role = 'super_admin') $$;
  create or replace function is_bu_admin(p_uid uuid, p_bu uuid) returns boolean
    language sql stable as $$
      select exists (select 1 from membership_scopes
                      where user_id = p_uid and role in ('super_admin','bu_admin') and business_unit_id = p_bu) $$;
  create or replace function is_admin_of_outlet(p_uid uuid, p_outlet uuid) returns boolean
    language sql stable as $$
      select exists (select 1 from membership_scopes
                      where user_id = p_uid and role in ('super_admin','bu_admin','outlet_admin')
                        and outlet_id = p_outlet) $$;
`);

const jalankan = async (b) =>
  db.exec(fs.readFileSync(path.join(AKAR, 'supabase/migrations', b), 'utf8').replace(/notify pgrst[^;]*;/g, ''));

await jalankan('0140_rincian_mutasi_kas.sql');
console.log('  0140 terpasang.');
await jalankan('0140_rincian_mutasi_kas.sql');
console.log('  dijalankan ulang: aman.');

// =====================================================================
// DATA
// =====================================================================
const BU = (await satu(`insert into business_units (name) values ('Cafe') returning id`)).id;
const CK = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Central Kitchen') returning id`, [BU])).id;
const SENTUL = (await satu(`insert into outlets (business_unit_id, name) values ($1,'AB Sentul') returning id`, [BU])).id;

const IIS = '11111111-1111-1111-1111-111111111111';
const ADHE = '22222222-2222-2222-2222-222222222222';
const BOS = '33333333-3333-3333-3333-333333333333';
const ORANG_LUAR = '44444444-4444-4444-4444-444444444444';
await q(`insert into user_profiles (id, full_name) values ($1,'Iis Nurlailah'), ($2,'Adhe'), ($3,'iko permadi'), ($4,'Orang Luar')`, [
  IIS,
  ADHE,
  BOS,
  ORANG_LUAR
]);
await q(
  `insert into membership_scopes (user_id, business_unit_id, outlet_id, role) values
     ($1,$5,$6,'staff'), ($2,$5,$7,'staff'), ($3,$5,null,'bu_admin'), ($4,null,null,'staff')`,
  [IIS, ADHE, BOS, ORANG_LUAR, BU, CK, SENTUL]
);

const KANTONG_CK = (await satu(`insert into cash_accounts (holder_id, name, outlet_id) values ($1,'Kas Iis CK',$2) returning id`, [IIS, CK])).id;
const KAT_PARKIR = (await satu(`insert into cash_categories (name) values ('Transportasi & Parkir') returning id`)).id;

const LOMBOK = (await satu(`insert into products (name, base_unit) values ('Lombok','kg') returning id`)).id;
const BERAS = (await satu(`insert into products (name, base_unit) values ('Beras','kg') returning id`)).id;
const GULA = (await satu(`insert into products (name, base_unit) values ('Gula','kg') returning id`)).id;

const HARI = '2026-09-10';

// (a) Pembayaran nota: lombok 1 kg 10.000 + beras 12,5 kg 175.000 = 185.000
const BAYAR = (
  await satu(
    `insert into cash_entries (business_unit_id, outlet_id, holder_id, account_id, entry_type, amount, entry_date, untuk_nota, notes)
     values ($1,$2,$3,$4,'out',-185000,$5,true,'Pembayaran nota NT-0001') returning id`,
    [BU, CK, IIS, KANTONG_CK, HARI]
  )
).id;
const NOTA = (
  await satu(
    `insert into goods_receipts (business_unit_id, outlet_id, code, supplier, payment_entry_id)
     values ($1,$2,'NT-0001','Toko Sayur Pagi',$3) returning id`,
    [BU, CK, BAYAR]
  )
).id;
await q(
  `insert into goods_receipt_items (receipt_id, product_id, qty, unit_cost, line_total) values
     ($1,$2,1,10000,10000),
     ($1,$3,12.5,14000,175000)`,
  [NOTA, LOMBOK, BERAS]
);

// (b) Kas keluar non-nota, berkategori — "karcis parkir 1 5000"
await q(
  `insert into cash_entries (business_unit_id, outlet_id, holder_id, account_id, entry_type, amount, category_id, notes, qty, unit, entry_date)
   values ($1,$2,$3,$4,'out',-5000,$5,'Karcis parkir',1,'lembar',$6)`,
  [BU, CK, IIS, KANTONG_CK, KAT_PARKIR, HARI]
);

// (c) Kas masuk tanpa kantong (Kas Utama), tanpa kategori
await q(
  `insert into cash_entries (business_unit_id, outlet_id, holder_id, entry_type, amount, notes, entry_date)
   values ($1,null,$2,'in',500000,'Setoran modal awal',$3)`,
  [BU, IIS, HARI]
);

// (d) Entri PENYESUAIAN: untuk_nota true, tapi TIDAK ada nota yang menunjuknya.
await q(
  `insert into cash_entries (business_unit_id, outlet_id, holder_id, account_id, entry_type, amount, notes, entry_date, untuk_nota, penyesuaian_nota)
   values ($1,$2,$3,$4,'out',-15000,'Penyesuaian nota NT-0001 — koreksi isi nota',$5,true,$6)`,
  [BU, CK, IIS, KANTONG_CK, HARI, NOTA]
);

// (e) Nota kedua, satu barisnya BELUM BERHARGA, dan notanya dibatalkan.
const BAYAR2 = (
  await satu(
    `insert into cash_entries (business_unit_id, outlet_id, holder_id, account_id, entry_type, amount, entry_date, untuk_nota, notes)
     values ($1,$2,$3,$4,'out',-20000,$5,true,'Pembayaran nota NT-0002') returning id`,
    [BU, CK, IIS, KANTONG_CK, HARI]
  )
).id;
const NOTA2 = (
  await satu(
    `insert into goods_receipts (business_unit_id, outlet_id, code, supplier, payment_entry_id, status)
     values ($1,$2,'NT-0002','Toko Manis',$3,'dibatalkan') returning id`,
    [BU, CK, BAYAR2]
  )
).id;
await q(
  `insert into goods_receipt_items (receipt_id, product_id, qty, unit_cost, line_total) values
     ($1,$2,2,10000,20000),
     ($1,$3,3,null,null)`,
  [NOTA2, GULA, LOMBOK]
);

// (f) Kas milik ORANG LAIN di outlet lain — untuk menguji penyaringan, bukan izin.
await q(
  `insert into cash_entries (business_unit_id, outlet_id, holder_id, entry_type, amount, notes, entry_date)
   values ($1,$2,$3,'out',-30000,'Bensin motor',$4)`,
  [BU, SENTUL, ADHE, HARI]
);

const sebagai = (uid) => q(`select set_config('request.jwt.claim.sub', $1, false)`, [uid]);
const laporan = async (args = {}) => {
  const {
    from = '2026-09-01',
    to = '2026-09-30',
    user = null,
    account = null,
    tanpaKantong = false,
    outlet = null,
    kategori = null
  } = args;
  return (
    await q(`select * from rincian_mutasi_kas($1,$2,$3,$4,$5,$6,$7)`, [from, to, user, account, tanpaKantong, outlet, kategori])
  ).rows;
};

await sebagai(BOS); // bu_admin -> boleh melihat kas seluruh anggota BU

// =====================================================================
// §1 PEMBAYARAN NOTA PECAH PER BAHAN
// =====================================================================
const semua = await laporan();
const bahanNota1 = semua.filter((r) => r.nota_code === 'NT-0001');
cek(
  '§1 nota dipecah per bahan',
  bahanNota1.map((r) => `${r.item} ${r.qty} ${r.satuan} ${r.nominal}`).sort(),
  ['Beras 12.5 kg -175000', 'Lombok 1 kg -10000']
);
cek('§1 semuanya bersumber bahan', [...new Set(bahanNota1.map((r) => r.sumber))], ['bahan']);
cek('§1 mapping bahan tanpa kategori kas', [...new Set(bahanNota1.map((r) => r.kategori))], ['Pembelian bahan']);
cek('§1 supplier ikut', [...new Set(bahanNota1.map((r) => r.pihak))], ['Toko Sayur Pagi']);
cek(
  '§1 jumlah baris = nominal entri kasnya',
  bahanNota1.reduce((t, r) => t + Number(r.nominal), 0),
  Number(bahanNota1[0].entry_amount)
);
cek('§1 entri induk ikut dikembalikan', Number(bahanNota1[0].entry_amount), -185000);

// Tanda entrinya tetap satu walau barisnya banyak — inilah yang dipakai layar
// untuk mengelompokkan dan merekonsiliasi.
cek('§1 satu entry_id untuk semua barisnya', [...new Set(bahanNota1.map((r) => r.entry_id))].length, 1);
cek('§1 baris_id berbeda tiap baris', new Set(bahanNota1.map((r) => r.baris_id)).size, 2);

// =====================================================================
// §2 HARGA BARIS & BARIS TANPA HARGA
// =====================================================================
const bahanNota2 = semua.filter((r) => r.nota_code === 'NT-0002');
const gulaBaris = bahanNota2.find((r) => r.item === 'Gula');
const lombokBaris = bahanNota2.find((r) => r.item === 'Lombok');
cek('§2 baris berharga memakai line_total', Number(gulaBaris.nominal), -20000);
// NULL, BUKAN 0. Nol membuat total terlihat sah padahal ada barang yang belum
// bernilai — dan tidak ada satu pun tanda di layar bahwa angkanya kurang.
cek('§2 baris tanpa harga bernilai NULL, bukan 0', lombokBaris.nominal, null);
benar('§2 status batal notanya ikut', bahanNota2.every((r) => r.nota_batal === true));

// `line_total` menang atas `unit_cost * qty`: baris beras 175.000 sedangkan
// 14.000 x 12,5 juga 175.000 — jadi diuji dengan baris yang keduanya BERBEDA.
const NOTA3 = (
  await satu(
    `insert into goods_receipts (business_unit_id, outlet_id, code, supplier, payment_entry_id)
     values ($1,$2,'NT-0003','Toko Beda',$3) returning id`,
    [BU, CK, BAYAR]
  )
).id;
await q(`insert into goods_receipt_items (receipt_id, product_id, qty, unit_cost, line_total) values ($1,$2,3,33333,100000)`, [
  NOTA3,
  LOMBOK
]);
const beda = (await laporan()).find((r) => r.nota_code === 'NT-0003');
cek('§2 line_total menang atas unit_cost x qty', Number(beda.nominal), -100000);
await q(`delete from goods_receipt_items where receipt_id = $1`, [NOTA3]);
await q(`delete from goods_receipts where id = $1`, [NOTA3]);

// =====================================================================
// §3 KAS LEDGER TAMPIL DENGAN MAPPING KATEGORINYA
// =====================================================================
const parkir = semua.find((r) => r.item === 'Karcis parkir');
cek('§3 parkir bersumber kas', parkir.sumber, 'kas');
cek('§3 mapping = kategori kasnya', parkir.kategori, 'Transportasi & Parkir');
cek('§3 jumlah & satuannya ikut', `${Number(parkir.qty)} ${parkir.satuan}`, '1 lembar');
cek('§3 nominalnya apa adanya', Number(parkir.nominal), -5000);
cek('§3 tidak bernomor nota', parkir.nota_code, null);

const setoran = semua.find((r) => r.item === 'Setoran modal awal');
cek('§3 kas masuk ikut, bertanda positif', Number(setoran.nominal), 500000);
cek('§3 tanpa kategori diberi label, bukan dikosongkan', setoran.kategori, 'Tanpa kategori');
cek('§3 kas masuk tanpa kantong disebut Kas Utama', setoran.account_name, 'Kas Utama');

// =====================================================================
// §4 ENTRI PENYESUAIAN TIDAK HILANG
//
// Ia ber-`untuk_nota` true tapi tidak ada nota yang menunjuknya. Kalau
// pembedanya `untuk_nota`, baris ini lenyap — dan yang lenyap justru KOREKSI,
// bagian yang paling perlu terlihat.
// =====================================================================
const penyesuaian = semua.find((r) => String(r.item).startsWith('Penyesuaian nota'));
benar('§4 entri penyesuaian muncul', !!penyesuaian);
cek('§4 dan ia bersumber kas', penyesuaian?.sumber, 'kas');
cek('§4 mapping penyesuaian', penyesuaian?.kategori, 'Penyesuaian nota');

// =====================================================================
// §5 FILTER KANTONG
// =====================================================================
const diKantong = await laporan({ account: KANTONG_CK });
benar('§5 filter kantong menyisihkan Kas Utama', !diKantong.some((r) => r.account_id === null));
benar('§5 dan semuanya kantong itu', diKantong.every((r) => r.account_id === KANTONG_CK));

const utama = await laporan({ tanpaKantong: true });
benar('§5 Kas Utama hanya baris tanpa kantong', utama.length > 0 && utama.every((r) => r.account_id === null));
benar('§5 Kas Utama BUKAN sama dengan semua kantong', utama.length < semua.length);

// Bendera tanpa-kantong MENANG atas id kantong. Kalau tidak, layar yang keliru
// mengirim keduanya akan diam-diam menjawab pertanyaan yang lain.
cek('§5 tanpa_kantong menang atas p_account', (await laporan({ account: KANTONG_CK, tanpaKantong: true })).length, utama.length);

cek('§5 filter pemegang', [...new Set((await laporan({ user: ADHE })).map((r) => r.holder_name))], ['Adhe']);
cek('§5 filter outlet peruntukan', [...new Set((await laporan({ outlet: SENTUL })).map((r) => r.item))], ['Bensin motor']);
cek('§5 filter kategori', [...new Set((await laporan({ kategori: KAT_PARKIR })).map((r) => r.item))], ['Karcis parkir']);
cek('§5 di luar rentang tanggal: kosong', (await laporan({ from: '2026-08-01', to: '2026-08-31' })).length, 0);

// =====================================================================
// §6 KETERLIHATAN
// =====================================================================
await sebagai(ORANG_LUAR);
cek('§6 orang tanpa wewenang tidak dapat baris apa pun', (await laporan()).length, 0);

await sebagai(IIS);
const punyaIis = await laporan();
benar('§6 pemegang melihat kasnya sendiri', punyaIis.length > 0);
benar('§6 dan tidak melihat kas orang lain', !punyaIis.some((r) => r.holder_name === 'Adhe'));

await sebagai(BOS);
benar('§6 admin BU melihat keduanya', (await laporan()).some((r) => r.holder_name === 'Adhe'));

// =====================================================================
// §7 DAFTAR KANTONG
// =====================================================================
const kantong = (await q(`select * from kantong_kas_terlihat()`)).rows;
benar('§7 kantong nyata ada', kantong.some((k) => k.account_id === KANTONG_CK && k.account_name === 'Kas Iis CK'));
benar('§7 Kas Utama ikut terdaftar', kantong.some((k) => k.account_id === null && k.account_name === 'Kas Utama'));
benar('§7 outlet kantongnya ikut', kantong.some((k) => k.account_id === KANTONG_CK && k.outlet_name === 'Central Kitchen'));

await sebagai(ORANG_LUAR);
cek('§7 orang tanpa wewenang: daftar kosong', (await q(`select * from kantong_kas_terlihat()`)).rows.length, 0);

// =====================================================================
// §8 TEPAT SATU BENTUK
// =====================================================================
for (const fn of ['rincian_mutasi_kas', 'kantong_kas_terlihat', 'boleh_lihat_kas']) {
  const n = (
    await q(
      `select count(*)::int as n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
        where ns.nspname = 'public' and p.proname = $1`,
      [fn]
    )
  ).rows[0].n;
  cek(`§8 ${fn} hanya satu bentuk`, n, 1);
}

if (gagal) {
  console.error(`\n${gagal} kasus gagal.`);
  process.exit(1);
}
console.log('0140 benar — mutasi kas terinci per item, entri penyesuaian tidak hilang, dan izinnya tidak bocor. ✅');
