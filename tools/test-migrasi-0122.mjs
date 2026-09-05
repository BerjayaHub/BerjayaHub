/**
 * MIGRATION 0122 DI POSTGRES SUNGGUHAN (PGlite).
 *
 * ============ KASUSNYA ============
 *
 *   "ada pembelian yang mengurangi kas dan tidak mengurangi karena jatuh tempo"
 *
 * ============ YANG DIUJI ============
 *
 *   1. Nota lahir 'belum' — termasuk nota lama sebelum 0122.
 *   2. Nota berbaris tanpa harga TIDAK BISA dibayar (harga 0 tetap sah).
 *   3. Beberapa nota dibayar dengan SATU entri kas, uangnya keluar dari
 *      kantong yang dipilih, bukan dari kas pencatatnya.
 *   4. `untuk_nota` tidak bisa dipakai melewati kewajiban foto bukti —
 *      dijaga pemeriksa yang DITUNDA sampai commit.
 *   5. Nota lunas tidak bisa diubah isinya.
 *   6. Pembatalan membuat entri BALIK, bukan menghapus, dan berlaku untuk
 *      seluruh pembayaran.
 *   7. Kewajiban foto untuk kas keluar BIASA tidak ikut longgar.
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
const gagalkan = async (fn) => {
  try {
    await fn();
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
  create table user_profiles (id uuid primary key, full_name text, cash_account_limit int not null default 1);
  create table membership_scopes (user_id uuid, business_unit_id uuid, outlet_id uuid, role text);
  create table products (id uuid primary key default gen_random_uuid(), business_unit_id uuid, name text,
    base_unit text default 'gr', product_type text default 'raw', purchase_price numeric, purchase_qty numeric);
  create table cash_categories (id uuid primary key default gen_random_uuid(), business_unit_id uuid, name text);
  create table stock_movements (id uuid primary key default gen_random_uuid(),
    business_unit_id uuid, outlet_id uuid, product_id uuid, movement_type text,
    qty_delta numeric, unit_cost numeric, notes text, receipt_id uuid, created_by uuid,
    created_at timestamptz not null default now());

  create table cash_accounts (
    id uuid primary key default gen_random_uuid(),
    holder_id uuid not null references user_profiles(id) on delete cascade,
    name text not null, sort_order int not null default 0,
    is_active boolean not null default true,
    created_at timestamptz not null default now(),
    unique (holder_id, name)
  );

  create table cash_entries (
    id uuid primary key default gen_random_uuid(),
    business_unit_id uuid, outlet_id uuid,
    holder_id uuid not null references user_profiles(id) on delete cascade,
    account_id uuid references cash_accounts(id) on delete restrict,
    entry_type text not null check (entry_type in ('in','out','transfer_in','transfer_out')),
    amount numeric not null,
    category_id uuid, counterpart_id uuid, transfer_id uuid,
    notes text, proof_path text, qty numeric, unit text,
    entry_date date not null default (now() at time zone 'Asia/Jakarta')::date,
    created_by uuid references user_profiles(id) on delete set null,
    created_at timestamptz not null default now()
  );

  -- Batasan 0063 apa adanya. 0122 menggantinya; tes ini memastikan
  -- penggantinya tidak lebih longgar untuk kas keluar biasa.
  alter table cash_entries add constraint cash_entries_nota_wajib
    check (entry_type <> 'out' or proof_path is not null);

  create or replace function has_bu_scope(p_uid uuid, p_bu uuid) returns boolean language sql stable as $$
    select exists (select 1 from membership_scopes where user_id = p_uid and business_unit_id = p_bu);
  $$;
  create or replace function has_outlet_scope(p_uid uuid, p_outlet uuid) returns boolean language sql stable as $$
    select exists (select 1 from membership_scopes ms where ms.user_id = p_uid
      and (ms.outlet_id = p_outlet or (ms.outlet_id is null and ms.business_unit_id = (select business_unit_id from outlets where id = p_outlet))));
  $$;
  create or replace function is_super_admin(p_uid uuid) returns boolean language sql stable as $$
    select exists (select 1 from membership_scopes where user_id = p_uid and role = 'super_admin');
  $$;

  create schema if not exists storage;
  create table storage.buckets (id text primary key, name text, public boolean);
  create table storage.objects (id uuid default gen_random_uuid(), bucket_id text, name text, owner uuid);
  alter table storage.objects enable row level security;
  create or replace function storage.foldername(p text) returns text[] language sql immutable as $$
    select string_to_array(p, '/');
  $$;
`);

const jalankan = async (b) =>
  db.exec(fs.readFileSync(path.join(AKAR, 'supabase/migrations', b), 'utf8').replace(/notify pgrst[^;]*;/g, ''));

await jalankan('0084_nota_penerimaan.sql');
await jalankan('0118_biaya_rata_bahan.sql');
await jalankan('0119_ubah_nota_tanpa_menghapus.sql');
await jalankan('0120_kas_outlet_boleh_dibebani.sql');
await jalankan('0122_nota_status_bayar.sql');
console.log('  0084 -> 0118 -> 0119 -> 0120 -> 0122 terpasang.');
await jalankan('0122_nota_status_bayar.sql');
console.log('  dijalankan ulang: aman.');

// =====================================================================
// DATA
// =====================================================================
const BU = (await satu(`insert into business_units (name) values ('Cafe') returning id`)).id;
const SERPONG = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Serpong') returning id`, [BU])).id;
const SENTUL = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Sentul') returning id`, [BU])).id;

const RISMA = '11111111-1111-1111-1111-111111111111'; // pegang kas
const SHENDA = '22222222-2222-2222-2222-222222222222'; // input nota di Serpong
const DINA = '33333333-3333-3333-3333-333333333333'; // Sentul saja
const BUDI = '44444444-4444-4444-4444-444444444444'; // cakupan se-BU: kedua outlet

await q(`insert into user_profiles (id, full_name) values ($1,'Risma'), ($2,'Shenda'), ($3,'Dina'), ($4,'Budi')`, [RISMA, SHENDA, DINA, BUDI]);
await q(`insert into membership_scopes (user_id, business_unit_id, outlet_id, role) values
  ($1,$2,$3,'staff'), ($4,$2,$3,'staff'), ($5,$2,$6,'staff'), ($7,$2,null,'staff')`,
  [RISMA, BU, SERPONG, SHENDA, DINA, SENTUL, BUDI]);

const TELUR = (await satu(`insert into products (business_unit_id, name) values ($1,'Telur') returning id`, [BU])).id;
const BERAS = (await satu(`insert into products (business_unit_id, name) values ($1,'Beras') returning id`, [BU])).id;

// Kantong kas Risma yang menyebut Serpong (bentuk 0120/0121).
const KAS = (
  await satu(`insert into cash_accounts (holder_id, name, outlet_id) values ($1,'Kas Operasional Serpong',$2) returning id`, [
    RISMA,
    SERPONG
  ])
).id;

const jadi = (uid) => q(`select set_config('request.jwt.claim.sub', $1, false)`, [uid]);
await jadi(SHENDA);

const buatNota = async (outlet, items, tanggal = '2026-08-20') =>
  (
    await satu(`select simpan_nota_terima($1,$2,'Gerobak Telur',null,null,null,$3::jsonb) as id`, [
      outlet,
      tanggal,
      JSON.stringify(items)
    ])
  ).id;

// =====================================================================
// §1. Nota lahir 'belum'.
// =====================================================================
const A = await buatNota(SERPONG, [{ product_id: TELUR, qty: 100, unit_cost: 3000 }]);
const a = await satu(`select payment_status, due_date, paid_at, payment_entry_id from goods_receipts where id = $1`, [A]);
cek('§1 nota baru berstatus belum', [a.payment_status, a.due_date, a.paid_at, a.payment_entry_id], ['belum', null, null, null]);

// =====================================================================
// §2. Baris tanpa harga menghalangi pembayaran; harga 0 TIDAK.
// =====================================================================
const B = await buatNota(SERPONG, [
  { product_id: TELUR, qty: 10, unit_cost: 5000 },
  { product_id: BERAS, qty: 20 } // harganya belum diisi
]);
const belumLengkap = await gagalkan(() => q(`select bayar_nota(array[$1]::uuid[], $2, '2026-09-05', null)`, [B, KAS]));
benar('§2 nota berbaris tanpa harga tidak bisa dibayar', /tanpa harga/i.test(belumLengkap ?? ''), `dapat: ${belumLengkap}`);

const ringkasB = await satu(`select total, baris_tanpa_harga, baris from nota_ringkas where id = $1`, [B]);
cek('§2 view menghitung baris tanpa harga', [Number(ringkasB.total), Number(ringkasB.baris_tanpa_harga), Number(ringkasB.baris)], [50000, 1, 2]);

// Harga 0 SAH — barang sampel/bonus.
const GRATIS = await buatNota(SERPONG, [{ product_id: BERAS, qty: 5, unit_cost: 0 }]);
const entriGratis = await satu(`select bayar_nota(array[$1]::uuid[], $2, '2026-09-05', null) as id`, [GRATIS, KAS]);
cek('§2 nota bertotal 0 lunas TANPA entri kas', entriGratis.id, null);
cek(
  '§2 statusnya tetap lunas',
  (await satu(`select payment_status from goods_receipts where id = $1`, [GRATIS])).payment_status,
  'lunas'
);

// =====================================================================
// §3. INTI: dua nota, satu entri kas, uang keluar dari kas RISMA.
// =====================================================================
const C = await buatNota(SERPONG, [{ product_id: BERAS, qty: 50, unit_cost: 12000 }]);
const bayar = await satu(`select bayar_nota(array[$1,$2]::uuid[], $3, '2026-09-05', null) as id`, [A, C, KAS]);
benar('§3 INTI: pembayaran menghasilkan entri kas', !!bayar.id);

const entri = await satu(`select holder_id, created_by, amount, entry_type, outlet_id, entry_date::text, proof_path, untuk_nota, account_id from cash_entries where id = $1`, [bayar.id]);
cek(
  '§3 uangnya keluar dari kas RISMA, dicatat SHENDA',
  [entri.holder_id, entri.created_by, entri.account_id],
  [RISMA, SHENDA, KAS]
);
cek('§3 nominalnya 100*3000 + 50*12000, bertanda minus', Number(entri.amount), -(100 * 3000 + 50 * 12000));
cek('§3 jenisnya out dan tanpa foto bukti', [entri.entry_type, entri.proof_path, entri.untuk_nota], ['out', null, true]);

// KAS IKUT TANGGAL BAYAR, BIAYA IKUT TANGGAL NOTA. Keduanya benar sekaligus.
cek('§3 kas memakai tanggal BAYAR (September)', entri.entry_date, '2026-09-05');
cek(
  '§3 nota tetap memakai tanggal NOTA (Agustus)',
  (await satu(`select receipt_date::text from goods_receipts where id = $1`, [A])).receipt_date,
  '2026-08-20'
);

const keduanya = await q(`select payment_status, payment_entry_id, paid_by from goods_receipts where id = any($1)`, [[A, C]]);
benar(
  '§3 kedua nota lunas dan menunjuk entri yang SAMA',
  keduanya.rows.every((r) => r.payment_status === 'lunas' && r.payment_entry_id === bayar.id && r.paid_by === SHENDA)
);

// Sekali bayar, tidak bisa dibayar lagi.
const dobel = await gagalkan(() => q(`select bayar_nota(array[$1]::uuid[], $2, '2026-09-06', null)`, [A, KAS]));
benar('§3 nota lunas tidak bisa dibayar dua kali', /sudah lunas|tidak ditemukan/i.test(dobel ?? ''), `dapat: ${dobel}`);

// =====================================================================
// §4. `untuk_nota` tidak bisa dipakai melewati kewajiban foto.
//
// Diperiksa saat COMMIT, bukan saat insert: notanya baru menunjuk entri ini
// beberapa pernyataan kemudian di dalam transaksi yang sama. Kalau pemeriksanya
// tidak ditunda, `bayar_nota` sendiri yang akan gagal.
// =====================================================================
const selundup = await gagalkan(async () => {
  await q(`begin`);
  await q(
    `insert into cash_entries (business_unit_id, outlet_id, holder_id, entry_type, amount, untuk_nota, created_by)
     values ($1,$2,$3,'out',-99999,true,$3)`,
    [BU, SERPONG, SHENDA]
  );
  await q(`commit`);
});
if (selundup) await q(`rollback`).catch(() => {});
benar(
  '§4 entri ber-untuk_nota tanpa nota DITOLAK saat commit',
  /tidak ada nota yang menunjuknya/i.test(selundup ?? ''),
  `dapat: ${selundup}`
);

// =====================================================================
// §5. Kewajiban foto untuk kas keluar BIASA tidak ikut longgar.
// =====================================================================
const tanpaFoto = await gagalkan(() =>
  q(
    `insert into cash_entries (business_unit_id, outlet_id, holder_id, entry_type, amount, created_by)
     values ($1,$2,$3,'out',-50000,$3)`,
    [BU, SERPONG, SHENDA]
  )
);
benar('§5 kas keluar biasa tetap wajib foto bukti', /nota_wajib|check constraint/i.test(tanpaFoto ?? ''), `dapat: ${tanpaFoto}`);

// =====================================================================
// §6. Nota lunas tidak bisa diubah isinya — tapi fotonya boleh.
// =====================================================================
const ubahLunas = await gagalkan(() =>
  q(`select ubah_nota_terima($1, null, null, null, null, null, $2::jsonb)`, [
    A,
    JSON.stringify([{ product_id: TELUR, qty: 100, unit_cost: 9999 }])
  ])
);
benar('§6 isi nota lunas tidak bisa diubah', /sudah dibayar/i.test(ubahLunas ?? ''), `dapat: ${ubahLunas}`);

const tambahFoto = await gagalkan(() => q(`select ubah_nota_terima($1, null, null, null, $2, null, null)`, [A, 'foto/a.jpg']));
benar('§6 menambah FOTO ke nota lunas tetap boleh', tambahFoto === null, `dapat: ${tambahFoto}`);

// Nota yang belum lunas tetap bisa diedit seperti biasa (regresi 0119).
const ubahBelum = await gagalkan(() =>
  q(`select ubah_nota_terima($1, null, null, null, null, null, $2::jsonb)`, [
    B,
    JSON.stringify([
      { product_id: TELUR, qty: 10, unit_cost: 5000 },
      { product_id: BERAS, qty: 20, unit_cost: 15000 }
    ])
  ])
);
benar('§6 nota belum lunas tetap bisa diedit', ubahBelum === null, `dapat: ${ubahBelum}`);
cek(
  '§6 harganya benar-benar tersimpan',
  Number((await satu(`select baris_tanpa_harga from nota_ringkas where id = $1`, [B])).baris_tanpa_harga),
  0
);

// =====================================================================
// §7. Pembatalan: entri BALIK, seluruh pembayaran, entri asli tetap ada.
// =====================================================================
const jml = await satu(`select batalkan_pembayaran_nota($1) as n`, [A]);
cek('§7 pembatalan mencakup KEDUA nota dalam pembayaran itu', Number(jml.n), 2);

const setelah = await q(`select payment_status, payment_entry_id, paid_at from goods_receipts where id = any($1)`, [[A, C]]);
benar(
  '§7 keduanya kembali belum, penunjuknya dilepas',
  setelah.rows.every((r) => r.payment_status === 'belum' && r.payment_entry_id === null && r.paid_at === null)
);

benar('§7 entri kas ASLI tidak dihapus', !!(await satu(`select id from cash_entries where id = $1`, [bayar.id])));

const balik = await satu(
  `select entry_type, amount, untuk_nota, notes from cash_entries
    where notes like 'Pembatalan:%' order by created_at desc limit 1`
);
cek('§7 entri baliknya masuk, sebesar nominal yang sama', [balik.entry_type, Number(balik.amount)], ['in', 100 * 3000 + 50 * 12000]);
cek('§7 entri balik tidak ber-untuk_nota (kalau tidak, pemeriksa commit menolaknya)', balik.untuk_nota, false);

const saldo = await satu(`select coalesce(sum(amount),0) as s from cash_entries where holder_id = $1`, [RISMA]);
cek('§7 saldo Risma kembali seperti semula', Number(saldo.s), 0);

// Setelah dibatalkan, notanya bisa diedit lagi.
const ubahLagi = await gagalkan(() =>
  q(`select ubah_nota_terima($1, null, null, null, null, null, $2::jsonb)`, [
    A,
    JSON.stringify([{ product_id: TELUR, qty: 100, unit_cost: 3100 }])
  ])
);
benar('§7 setelah dibatalkan, nota bisa diedit lagi', ubahLagi === null, `dapat: ${ubahLagi}`);

// =====================================================================
// §8. Lintas outlet ditolak; wewenang outlet ditegakkan.
// =====================================================================
// Notanya dibuat DINA di Sentul, lalu dibayar BUDI yang cakupannya se-BU.
//
// Percobaan pertama memakai Shenda, yang tidak punya cakupan di Sentul — jadi
// penolakannya datang dari pemeriksaan WEWENANG, bukan dari pemeriksaan outlet,
// dan sabotase yang membuang pemeriksaan lintas-outlet lolos utuh. Budi berhak
// di kedua outlet, jadi hanya satu hal yang bisa menolaknya.
await jadi(DINA);
const D = await buatNota(SENTUL, [{ product_id: TELUR, qty: 1, unit_cost: 1000 }]);

await jadi(BUDI);
const lintas = await gagalkan(() => q(`select bayar_nota(array[$1,$2]::uuid[], $3, '2026-09-05', null)`, [C, D, KAS]));
benar('§8 pembayaran lintas outlet ditolak', /outlet berbeda/i.test(lintas ?? ''), `dapat: ${lintas}`);

// Dan Budi memang BISA membayar keduanya kalau dipisah — kalau tidak, §8 di
// atas hijau hanya karena Budi ternyata tidak berhak atas apa pun.
const budiBisa = await gagalkan(() => q(`select bayar_nota(array[$1]::uuid[], $2, '2026-09-05', null)`, [D, KAS]));
benar('§8 sekali bayar per outlet, Budi berhasil', budiBisa === null, `dapat: ${budiBisa}`);
await q(`select batalkan_pembayaran_nota($1)`, [D]);

await jadi(DINA);
const bukanWewenang = await gagalkan(() => q(`select bayar_nota(array[$1]::uuid[], $2, '2026-09-05', null)`, [C, KAS]));
benar('§8 staff outlet lain tidak bisa membayar nota Serpong', bukanWewenang !== null, `dapat: ${bukanWewenang}`);

// =====================================================================
// §9. Jatuh tempo.
// =====================================================================
await jadi(SHENDA);
await q(`select set_jatuh_tempo_nota($1, '2026-09-30')`, [C]);
cek(
  '§9 jatuh tempo tersimpan',
  (await satu(`select due_date::text from goods_receipts where id = $1`, [C])).due_date,
  '2026-09-30'
);

await q(`select bayar_nota(array[$1]::uuid[], $2, '2026-09-10', null)`, [C, KAS]);
const tempoLunas = await gagalkan(() => q(`select set_jatuh_tempo_nota($1, '2026-10-01')`, [C]));
benar('§9 nota lunas tidak menerima jatuh tempo baru', /sudah lunas/i.test(tempoLunas ?? ''), `dapat: ${tempoLunas}`);

if (gagal === 0) console.log('Migration 0122 di Postgres sungguhan: 9 bagian LULUS. ✅');
process.exit(gagal === 0 ? 0 : 1);
