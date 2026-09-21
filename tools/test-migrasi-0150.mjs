/**
 * MIGRATION 0150 DI POSTGRES SUNGGUHAN (PGlite).
 *
 * ============ BUG YANG DIREPRODUKSI DULU, BARU DIPERBAIKI ============
 *
 * `0149` menyaring kas keluar dengan `business_unit_id` — kolom yang DEPRECATED
 * sejak 0040 dan selalu NULL untuk entri baru. Akibatnya nol baris, di dua
 * tempat sekaligus, tanpa satu pun galat:
 *
 *   * layar ekspor: "Tidak ada kas keluar baru di rentang itu";
 *   * `tandai_kas_esb`: mengembalikan 0 tanpa menyentuh apa pun.
 *
 * §0 membuktikan keadaan ITU dulu — dengan fungsi 0149 yang asli — supaya
 * sisanya tidak lolos hanya karena harness-nya kebetulan mengisi kolomnya.
 *
 * ============ SISANYA ============
 *
 *   §1 Sumbu barunya: outlet. Termasuk outlet BU LAIN yang tidak boleh ikut.
 *   §2 "Selain bahan" dijaga DI DATABASE juga, bukan cuma di layanan.
 *   §3 Wewenang lewat outlet: staff nol, admin BU-nya bisa.
 *   §4 Menandai & membukanya kembali.
 *   §5 Indeksnya pindah ke kolom yang sungguh dipakai.
 *   §6 Dijalankan dua kali tetap aman.
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
  create table user_profiles (id uuid primary key, full_name text);
  create table cash_categories (id uuid primary key default gen_random_uuid(), name text);
  create table cash_accounts (id uuid primary key default gen_random_uuid(), name text);
  create table goods_receipts (id uuid primary key default gen_random_uuid(), code text, payment_entry_id uuid);

  create table cash_entries (
    id uuid primary key default gen_random_uuid(),
    -- DEPRECATED sejak 0040: entri baru meninggalkannya NULL. Harness ini
    -- meniru keadaan itu apa adanya — mengisinya di sini akan menyembunyikan
    -- persis bug yang sedang diperbaiki.
    business_unit_id uuid,
    outlet_id uuid, holder_id uuid, entry_type text, amount numeric,
    category_id uuid, account_id uuid, counterpart_id uuid,
    notes text, qty numeric, unit text, proof_path text,
    entry_date date not null default current_date,
    untuk_nota boolean not null default false,
    penyesuaian_nota uuid references goods_receipts(id) on delete set null,
    dicoret_at timestamptz, dicoret_by uuid, alasan_coret text,
    diubah_at timestamptz, diubah_by uuid,
    created_at timestamptz not null default now());

  create or replace function is_bu_admin(p_uid uuid, p_bu uuid) returns boolean
    language sql security definer stable as $$
      select exists (select 1 from membership_scopes ms
        where ms.user_id = p_uid
          and (ms.role = 'super_admin' or (ms.role = 'bu_admin' and ms.business_unit_id = p_bu))) $$;

  -- Tiruan 0003.
  create or replace function is_admin_of_outlet(p_user_id uuid, p_outlet_id uuid) returns boolean
    language sql security definer stable as $$
      select exists (
        select 1 from membership_scopes ms
        join outlets o on o.id = p_outlet_id
        where ms.user_id = p_user_id
          and (ms.role = 'super_admin'
               or (ms.role = 'bu_admin' and ms.business_unit_id = o.business_unit_id))) $$;

  create or replace function boleh_koreksi_kas(p_holder uuid) returns boolean
    language sql security definer stable as $$ select p_holder = auth.uid() $$;
  create or replace function panjang_alasan_batal_esb() returns int language sql immutable as $$ select 10 $$;
  create or replace function alasan_batal_esb_sah(p_alasan text) returns text
  language plpgsql immutable as $$
  declare v text := btrim(coalesce(p_alasan, ''));
  begin
    if length(v) < panjang_alasan_batal_esb() then
      raise exception 'Alasan wajib diisi, minimal % huruf.', panjang_alasan_batal_esb();
    end if;
    return v;
  end $$;

  create or replace function alasan_tolak_koreksi_kas(p_entry uuid) returns text
    language sql stable as $$ select null::text $$;
  create or replace function ubah_kas(
    p_entry uuid, p_amount numeric, p_category uuid, p_outlet uuid,
    p_notes text, p_qty numeric, p_unit text, p_date date
  ) returns void language plpgsql as $lama$ begin return; end $lama$;
  create or replace function riwayat_kas_saya(p_limit int default 50)
  returns table (id uuid, entry_date date, entry_type text, amount numeric, notes text)
  language sql stable as $lama$
    select ce.id, ce.entry_date, ce.entry_type, ce.amount, ce.notes
      from cash_entries ce where ce.holder_id = auth.uid() limit coalesce(p_limit, 50)
  $lama$;
`);

const BU = (await satu(`insert into business_units (name) values ('Cafe') returning id`)).id;
const BU2 = (await satu(`insert into business_units (name) values ('Lain') returning id`)).id;
const OUT = (await satu(`insert into outlets (business_unit_id, name) values ($1,'AB Gading Serpong') returning id`, [BU])).id;
const OUT_B = (await satu(`insert into outlets (business_unit_id, name) values ($1,'AB Sentul') returning id`, [BU])).id;
const OUT_LAIN = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Outlet BU Lain') returning id`, [BU2])).id;
const KAT = (await satu(`insert into cash_categories (name) values ('Transportasi') returning id`)).id;

const ADMIN = '11111111-1111-1111-1111-111111111111';
const STAFF = '22222222-2222-2222-2222-222222222222';
await q(`insert into user_profiles (id, full_name) values ($1,'Admin'), ($2,'Risma')`, [ADMIN, STAFF]);
await q(`insert into membership_scopes (user_id, business_unit_id, role) values ($1,$2,'bu_admin'), ($3,$2,'staff')`, [
  ADMIN,
  BU,
  STAFF
]);

const buatKas = async (o = {}) =>
  (
    await satu(
      `insert into cash_entries (outlet_id, holder_id, entry_type, amount, category_id, notes, entry_date, untuk_nota, penyesuaian_nota, dicoret_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
      [
        o.outlet ?? OUT,
        o.holder ?? STAFF,
        o.type ?? 'out',
        o.amount ?? -30000,
        o.kat ?? KAT,
        o.notes ?? 'gojek makanan',
        o.tanggal ?? '2026-09-19',
        o.untukNota ?? false,
        o.penyesuaian ?? null,
        o.dicoret ?? null
      ]
    )
  ).id;

const jalankan = async (b) =>
  db.exec(fs.readFileSync(path.join(AKAR, 'supabase/migrations', b), 'utf8').replace(/notify pgrst[^;]*;/g, ''));

await jalankan('0149_disbursement_kas.sql');
const TRANSPORT = await buatKas();

console.log('§0 BUG-nya direproduksi dulu, dengan 0149 apa adanya');

await jadi(ADMIN);
// INILAH yang dilaporkan dari layar: entrinya ADA, dan penandaannya nol.
cek(
  '§0 INTI: 0149 menandai 0 baris — `business_unit_id` NULL membuat is_bu_admin false',
  (await satu(`select tandai_kas_esb($1) as n`, [[TRANSPORT]])).n,
  0
);
cek(
  '§0 dan entrinya memang ada di tabelnya',
  (await satu(`select count(*)::int as n from cash_entries where id = $1`, [TRANSPORT])).n,
  1
);
benar(
  '§0 sebabnya: kolomnya NULL, bukan salah nilai',
  (await satu(`select business_unit_id from cash_entries where id = $1`, [TRANSPORT])).business_unit_id === null
);

await jalankan('0150_disbursement_lewat_outlet.sql');
console.log('  0150 terpasang.');

console.log('\n§1 Sumbu barunya: outlet');

const ambil = async (bu = BU, outlet = null, dari = '2026-09-01', sampai = '2026-09-21') =>
  semua(`select * from kas_untuk_esb($1,$2,$3,$4)`, [bu, dari, sampai, outlet]);

let baris = await ambil();
cek('§1 INTI: entrinya sekarang ketemu', baris.length, 1);
cek('§1 nama outletnya ikut', baris[0].outlet_nama, 'AB Gading Serpong');
cek('§1 nama kategorinya ikut — jadi kunci pemetaan COA', baris[0].kategori_nama, 'Transportasi');
cek('§1 nominalnya apa adanya, masih bertanda', Number(baris[0].amount), -30000);

const DI_SENTUL = await buatKas({ outlet: OUT_B });
cek('§1 dua outlet BU ini ikut saat outlet tidak dipilih', (await ambil()).length, 2);
cek('§1 disaring per outlet', (await ambil(BU, OUT)).length, 1);

// Outlet BU LAIN tidak boleh ikut, walau admin ini kebetulan punya wewenang
// di sana atau tidak.
await buatKas({ outlet: OUT_LAIN });
cek('§1 outlet BU lain tidak ikut', (await ambil()).length, 2);

cek('§1 di luar rentang tanggal tidak ikut', (await ambil(BU, null, '2026-10-01', '2026-10-31')).length, 0);

console.log('\n§2 "Selain bahan" dijaga di database juga');

const BAYAR_NOTA = await buatKas({ untukNota: true });
const NOTA = (await satu(`insert into goods_receipts (code, payment_entry_id) values ('TRM-1', $1) returning id`, [BAYAR_NOTA])).id;
const PENYESUAIAN = await buatKas({ penyesuaian: NOTA });
const DICORET = await buatKas({ dicoret: new Date().toISOString() });
const MASUK = await buatKas({ type: 'in', amount: 158600 });

cek('§2 keempatnya tidak ikut ditawarkan', (await ambil()).length, 2);

// PENJAGA KEDUA, di `tandai_kas_esb`. Daftar yang disusun satu aturan dan
// ditandai dengan aturan lain akan menandai baris yang tidak pernah terunduh —
// dan baris itu berhenti ditawarkan selamanya.
for (const [nama, id] of [
  ['pembayaran nota', BAYAR_NOTA],
  ['penyesuaian nota', PENYESUAIAN],
  ['yang dicoret', DICORET],
  ['kas masuk', MASUK]
]) {
  cek(`§2 ${nama} tidak bisa ditandai`, (await satu(`select tandai_kas_esb($1) as n`, [[id]])).n, 0);
}

console.log('\n§3 Wewenang lewat outlet');

await jadi(STAFF);
cek('§3 staff tidak melihat apa pun', (await ambil()).length, 0);
cek('§3 staff tidak bisa menandai', (await satu(`select tandai_kas_esb($1) as n`, [[TRANSPORT]])).n, 0);

await jadi(null);
cek('§3 tanpa login: kosong', (await ambil()).length, 0);

await jadi(ADMIN);
cek('§3 admin BU melihatnya', (await ambil()).length, 2);

console.log('\n§4 Menandai & membukanya kembali');

cek('§4 INTI: dua entri ditandai', (await satu(`select tandai_kas_esb($1) as n`, [[TRANSPORT, DI_SENTUL]])).n, 2);
benar(
  '§4 penandanya tercatat',
  (await satu(`select esb_exported_by from cash_entries where id = $1`, [TRANSPORT])).esb_exported_by === ADMIN
);
cek('§4 yang sudah ditandai tidak ditawarkan lagi', (await ambil()).length, 0);
cek('§4 menandai ulang: 0', (await satu(`select tandai_kas_esb($1) as n`, [[TRANSPORT]])).n, 0);

const bertanda = await semua(`select * from kas_bertanda_esb($1,$2,$3,null)`, [BU, '2026-09-01', '2026-09-21']);
cek('§4 keduanya muncul di daftar bertanda', bertanda.length, 2);
cek('§4 nama outletnya ikut', bertanda.some((b) => b.outlet_nama === 'AB Gading Serpong'), true);

cek(
  '§4 tandanya dibuka',
  (await satu(`select batalkan_tanda_kas_esb($1,$2) as n`, [[TRANSPORT], 'berkasnya ditolak ESB, belum masuk'])).n,
  1
);
cek('§4 dan ia ditawarkan lagi', (await ambil()).length, 1);

await jadi(STAFF);
cek(
  '§4 staff tidak bisa membuka tanda',
  (await satu(`select batalkan_tanda_kas_esb($1,$2) as n`, [[DI_SENTUL], 'mencoba membukanya sendiri'])).n,
  0
);

console.log('\n§5 Indeksnya');

const idx = await satu(`select indexdef from pg_indexes where indexname = 'idx_kas_belum_esb'`);
benar('§5 indeksnya ada', idx !== undefined);
benar(
  '§5 INTI: atas outlet_id, bukan kolom yang selalu NULL',
  /outlet_id/.test(idx?.indexdef ?? '') && !/business_unit_id/.test(idx?.indexdef ?? ''),
  idx?.indexdef
);

console.log('\n§6 Dijalankan ulang');

await jalankan('0150_disbursement_lewat_outlet.sql');
await jadi(ADMIN);
cek('§6 aman dijalankan dua kali', (await ambil()).length, 1);

console.log('');
if (gagal === 0) console.log('Semua pemeriksaan 0150 lolos. ✅');
else console.error(`${gagal} pemeriksaan 0150 GAGAL.`);
process.exit(gagal === 0 ? 0 : 1);
