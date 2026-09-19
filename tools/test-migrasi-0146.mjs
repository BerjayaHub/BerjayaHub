/**
 * MIGRATION 0146 DI POSTGRES SUNGGUHAN (PGlite).
 *
 * ============ YANG DIUJI ============
 *
 *   §1 Kolom penanda & jejak pembatalan terpasang di `waste_runs`.
 *   §2 `esb_master` / `esb_map` menerima jenis 'purpose' — dan TUJUH jenis lama
 *      tidak ada yang hilang. Memperlebar `check` dengan mengetik ulang
 *      daftarnya adalah cara paling mudah menghapus satu jenis tanpa sadar.
 *   §3 `tandai_waste_esb` hanya menandai milik BU yang dipegang, hanya yang
 *      belum bertanda, dan melaporkan jumlah SEBENARNYA.
 *   §4 `batalkan_tanda_waste_esb` menuntut alasan, mencatat pelakunya, dan
 *      melewati yang tidak bertanda tanpa menulis jejak palsu.
 *   §5 Bukan admin tidak bisa apa-apa — dan itu terbaca sebagai 0, bukan galat
 *      yang menyesatkan.
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
const galat = async (sql, params) => {
  try {
    await q(sql, params);
    return null;
  } catch (e) {
    return String(e.message ?? e);
  }
};
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

  -- Tiruan tabel waste (0030/0118) TANPA satu pun kolom ESB. Kalau 0146 tidak
  -- menambahkannya, §1 gagal — bukan lolos karena kolomnya kebetulan sudah ada.
  create table waste_runs (
    id uuid primary key default gen_random_uuid(),
    business_unit_id uuid not null references business_units(id) on delete cascade,
    outlet_id uuid, code text, jenis text, notes text,
    created_at timestamptz not null default now());

  create table esb_master (
    id uuid primary key default gen_random_uuid(),
    business_unit_id uuid not null references business_units(id) on delete cascade,
    jenis text not null check (jenis in ('branch','location','unit','item','payment_method','coa','supplier')),
    kode text, nama text not null, keterangan text,
    unique (business_unit_id, jenis, nama));
  create table esb_map (
    id uuid primary key default gen_random_uuid(),
    business_unit_id uuid not null references business_units(id) on delete cascade,
    jenis text not null check (jenis in ('branch','location','unit','item','payment_method','coa','supplier')),
    kunci text not null, nilai text not null);

  create or replace function is_bu_admin(p_uid uuid, p_bu uuid) returns boolean
    language sql security definer stable as $$
      select exists (select 1 from membership_scopes ms
        where ms.user_id = p_uid
          and (ms.role = 'super_admin' or (ms.role = 'bu_admin' and ms.business_unit_id = p_bu))) $$;

  -- Tiruan 0143: panjang alasan & penjaganya. Angkanya diambil dari sana, bukan
  -- ditulis ulang, supaya tes ini ikut bergeser kalau aturannya berubah.
  create or replace function panjang_alasan_batal_esb() returns int
    language sql immutable as $$ select 10 $$;
  create or replace function alasan_batal_esb_sah(p_alasan text) returns text
  language plpgsql immutable as $$
  declare v text := btrim(coalesce(p_alasan, ''));
  begin
    if length(v) < panjang_alasan_batal_esb() then
      raise exception 'Alasan membatalkan tanda ekspor wajib diisi, minimal % huruf.', panjang_alasan_batal_esb();
    end if;
    return v;
  end $$;
`);

const BU = (await satu(`insert into business_units (name) values ('Cafe') returning id`)).id;
const BU2 = (await satu(`insert into business_units (name) values ('Lain') returning id`)).id;
const OUT = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Sentul') returning id`, [BU])).id;

const ADMIN = '11111111-1111-1111-1111-111111111111';
const STAFF = '22222222-2222-2222-2222-222222222222';
await q(`insert into user_profiles (id, full_name) values ($1,'Admin'), ($2,'Staff')`, [ADMIN, STAFF]);
await q(`insert into membership_scopes (user_id, business_unit_id, role) values ($1,$2,'bu_admin'), ($3,$2,'staff')`, [
  ADMIN,
  BU,
  STAFF
]);

const jalankan = async (b) =>
  db.exec(fs.readFileSync(path.join(AKAR, 'supabase/migrations', b), 'utf8').replace(/notify pgrst[^;]*;/g, ''));

await jalankan('0146_ekspor_waste_esb.sql');
console.log('  0146 terpasang.');

console.log('\n§1 Kolom penanda & jejaknya');

const kolom = (
  await q(
    `select column_name from information_schema.columns
      where table_name = 'waste_runs' and column_name like 'esb%' order by column_name`
  )
).rows.map((r) => r.column_name);
cek('§1 lima kolom ESB terpasang di waste_runs', kolom, [
  'esb_alasan_batal',
  'esb_dibatalkan_at',
  'esb_dibatalkan_by',
  'esb_exported_at',
  'esb_exported_by'
]);

// Indeks parsial "belum diekspor". Tanpa itu daftar waste yang belum diekspor
// memindai seluruh tabel tiap kali layar ekspor dibuka.
benar(
  '§1 indeks parsial untuk yang belum diekspor ada',
  (await satu(`select 1 from pg_indexes where indexname = 'idx_waste_belum_esb'`)) !== undefined
);

console.log('\n§2 Jenis purpose — dan tujuh yang lama');

cek(
  "§2 esb_master menerima 'purpose'",
  await galat(`insert into esb_master (business_unit_id, jenis, nama) values ($1,'purpose','Spoil')`, [BU]),
  null
);
cek(
  "§2 esb_map menerima 'purpose'",
  await galat(`insert into esb_map (business_unit_id, jenis, kunci, nilai) values ($1,'purpose','spoil','Spoil')`, [BU]),
  null
);
for (const j of ['branch', 'location', 'unit', 'item', 'payment_method', 'coa', 'supplier']) {
  cek(
    `§2 esb_master masih menerima '${j}'`,
    await galat(`insert into esb_master (business_unit_id, jenis, nama) values ($1,$2,$3)`, [BU2, j, `c ${j}`]),
    null
  );
  cek(
    `§2 esb_map masih menerima '${j}'`,
    await galat(`insert into esb_map (business_unit_id, jenis, kunci, nilai) values ($1,$2,$3,'x')`, [BU2, j, `k ${j}`]),
    null
  );
}
benar(
  '§2 jenis yang dikarang tetap DITOLAK',
  (await galat(`insert into esb_master (business_unit_id, jenis, nama) values ($1,'ngawur','X')`, [BU])) !== null,
  'check yang terlalu longgar membuat salah ketik jenis tersimpan diam-diam'
);

console.log('\n§3 tandai_waste_esb');

const buatWaste = async (bu = BU) =>
  (
    await satu(`insert into waste_runs (business_unit_id, outlet_id, code, jenis) values ($1,$2,'WS-1','spoil') returning id`, [
      bu,
      OUT
    ])
  ).id;

const W1 = await buatWaste();
const W2 = await buatWaste();
const WLAIN = await buatWaste(BU2);

await jadi(ADMIN);
cek('§3 dua waste ditandai', (await satu(`select tandai_waste_esb($1) as n`, [[W1, W2]])).n, 2);
benar(
  '§3 penandanya tercatat',
  (await satu(`select esb_exported_by from waste_runs where id = $1`, [W1])).esb_exported_by === ADMIN
);

// Menandai ulang harus 0, bukan 2. Angka yang menghitung ulang yang sudah
// bertanda membuat "3 waste ditandai" muncul untuk 0 waste yang sungguh baru.
cek('§3 menandai ulang: 0', (await satu(`select tandai_waste_esb($1) as n`, [[W1, W2]])).n, 0);

cek('§3 waste milik BU lain tidak tertandai', (await satu(`select tandai_waste_esb($1) as n`, [[WLAIN]])).n, 0);
benar(
  '§3 dan waste BU lain memang tidak tersentuh',
  (await satu(`select esb_exported_at from waste_runs where id = $1`, [WLAIN])).esb_exported_at === null
);

cek('§3 daftar kosong: 0, tanpa melempar', (await satu(`select tandai_waste_esb(null) as n`)).n, 0);
cek('§3 array kosong: 0', (await satu(`select tandai_waste_esb(array[]::uuid[]) as n`)).n, 0);

console.log('\n§4 batalkan_tanda_waste_esb');

benar(
  '§4 alasan kosong DITOLAK',
  (await galat(`select batalkan_tanda_waste_esb($1, '')`, [[W1]])) !== null,
  'tanpa alasan, jejaknya tidak menjawab pertanyaan apa pun nanti'
);
benar('§4 alasan terlalu pendek DITOLAK', (await galat(`select batalkan_tanda_waste_esb($1, 'salah')`, [[W1]])) !== null);

cek(
  '§4 satu tanda dibuka',
  (await satu(`select batalkan_tanda_waste_esb($1, $2) as n`, [[W1], 'berkasnya ditolak ESB, belum masuk ke sana'])).n,
  1
);
const jejak = await satu(
  `select esb_exported_at, esb_exported_by, esb_dibatalkan_at, esb_dibatalkan_by, esb_alasan_batal
     from waste_runs where id = $1`,
  [W1]
);
benar('§4 tandanya benar-benar terbuka', jejak.esb_exported_at === null && jejak.esb_exported_by === null);
benar(
  '§4 jejaknya lengkap: siapa, kapan, kenapa',
  jejak.esb_dibatalkan_by === ADMIN && jejak.esb_dibatalkan_at !== null && /ditolak ESB/.test(jejak.esb_alasan_batal),
  'jejak yang tidak menyebut pelakunya tidak bisa ditelusuri siapa pun'
);

// Yang TIDAK bertanda dilewati — bukan ditulisi jejak pembatalan yang tidak
// pernah terjadi. Kalau ini lepas, penelusuran nanti menemukan pembatalan yang
// tidak ada, dan tidak ada cara membedakannya dari yang sungguhan.
const W3 = await buatWaste();
cek(
  '§4 waste yang tidak bertanda dilewati',
  (await satu(`select batalkan_tanda_waste_esb($1, $2) as n`, [[W3], 'coba-coba membukanya padahal belum'])).n,
  0
);
benar(
  '§4 dan ia TIDAK ditulisi jejak palsu',
  (await satu(`select esb_dibatalkan_at from waste_runs where id = $1`, [W3])).esb_dibatalkan_at === null
);

// Waste yang pernah dibuka lalu ditandai lagi: jejak lamanya tetap ada.
cek('§4 ditandai lagi', (await satu(`select tandai_waste_esb($1) as n`, [[W1]])).n, 1);
benar(
  '§4 jejak pembatalan lama tidak terhapus saat ditandai ulang',
  (await satu(`select esb_alasan_batal from waste_runs where id = $1`, [W1])).esb_alasan_batal !== null,
  'jejak yang hilang membuat riwayatnya tidak bisa dibaca'
);

console.log('\n§5 Bukan admin');

await jadi(STAFF);
cek('§5 staff tidak bisa menandai', (await satu(`select tandai_waste_esb($1) as n`, [[W2]])).n, 0);
cek(
  '§5 staff tidak bisa membuka tanda',
  (await satu(`select batalkan_tanda_waste_esb($1, $2) as n`, [[W2], 'saya mau memperbaiki notanya'])).n,
  0
);
benar(
  '§5 dan waste-nya memang tidak berubah',
  (await satu(`select esb_exported_at from waste_runs where id = $1`, [W2])).esb_exported_at !== null
);

await jadi(null);
cek('§5 tanpa login: 0', (await satu(`select tandai_waste_esb($1) as n`, [[W2]])).n, 0);

console.log('\n§6 Dijalankan ulang');

await jalankan('0146_ekspor_waste_esb.sql');
cek(
  '§6 aman dijalankan dua kali — datanya tetap',
  (await satu(`select count(*)::int as n from waste_runs where esb_exported_at is not null`)).n,
  2
);

console.log('');
if (gagal === 0) console.log('Semua pemeriksaan 0146 lolos. ✅');
else console.error(`${gagal} pemeriksaan 0146 GAGAL.`);
process.exit(gagal === 0 ? 0 : 1);
