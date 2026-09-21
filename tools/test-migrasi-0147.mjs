/**
 * MIGRATION 0147 DI POSTGRES SUNGGUHAN (PGlite).
 *
 * ============ YANG DIUJI ============
 *
 *   §1 Kolom purpose & jejak pengisinya terpasang.
 *   §2 `purpose_esb_sah` — tiga keadaannya, termasuk yang paling mudah salah:
 *      daftar induk yang BELUM diimpor tidak boleh mengunci pencatatan waste.
 *   §3 `catat_waste` menyimpan Purpose, mencatat pengisinya, dan MENOLAK nilai
 *      di luar daftar — sebelum fotonya terlanjur dipakai dan stok bergerak.
 *   §4 Tanda tangan 6-argumen BENAR-BENAR hilang. Kalau ia masih ada,
 *      permintaan yang kehilangan `p_purpose` tersimpan diam-diam tanpa Purpose.
 *   §5 `ubah_purpose_waste` — admin saja, menolak yang sudah diekspor, menolak
 *      pengosongan, dan memakai daftar induk BU-nya sendiri.
 *   §6 `waste_rekap` memuat purpose, dan baris LAMA tetap ikut dengan null.
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
  create table outlets (id uuid primary key default gen_random_uuid(),
    business_unit_id uuid, name text, outlet_role text default 'standalone');
  create table user_profiles (id uuid primary key, full_name text);
  create table products (id uuid primary key default gen_random_uuid(),
    business_unit_id uuid, name text, base_unit text);
  create table recipes (id uuid primary key default gen_random_uuid(),
    product_id uuid, mode text, yield_qty numeric);
  create table recipe_items (recipe_id uuid, ingredient_product_id uuid, qty numeric);
  create table stock_movements (id uuid primary key default gen_random_uuid(),
    business_unit_id uuid, outlet_id uuid, product_id uuid, movement_type text,
    qty_delta numeric, notes text, created_by uuid, waste_run_id uuid,
    created_at timestamptz not null default now());

  -- waste_runs APA ADANYA sebelum 0147: penanda ESB dari 0146 sudah ada,
  -- kolom purpose belum. Kalau 0147 tidak menambahkannya, §1 gagal.
  create table waste_runs (
    id uuid primary key default gen_random_uuid(),
    business_unit_id uuid, outlet_id uuid, jenis text, product_id uuid,
    qty numeric, photo_path text, code text, notes text, created_by uuid,
    created_at timestamptz not null default now(),
    esb_exported_at timestamptz);
  create table waste_items (waste_id uuid, product_id uuid, qty numeric,
    primary key (waste_id, product_id));

  -- TANDA TANGAN LAMA (0135) DIPASANG SUNGGUHAN.
  --
  -- Tanpa ini, "drop function if exists catat_waste(6 argumen)" di 0147 tidak
  -- menghapus apa pun — dan §4 lolos karena yang dicarinya memang tidak pernah
  -- ada, bukan karena 0147 membuangnya. Sabotase yang menghapus baris "drop
  -- function" itu pun tidak tertangkap. Isinya sengaja sekadar penanda: yang
  -- diuji keberadaannya, bukan perilakunya.
  --
  -- (Tanda petik biasa, BUKAN backtick: blok ini ada di dalam template literal
  -- JavaScript, dan satu backtick di sini menutupnya lebih awal. Berkasnya lalu
  -- gagal di-parse — persis yang barusan terjadi, dan persis yang sudah dua
  -- kali dicatat di README.)
  create or replace function catat_waste(
    p_outlet uuid, p_jenis text, p_product uuid, p_qty numeric, p_photo text, p_notes text
  ) returns uuid language sql as $lama$ select gen_random_uuid() $lama$;

  create table esb_master (
    id uuid primary key default gen_random_uuid(),
    business_unit_id uuid not null references business_units(id) on delete cascade,
    jenis text not null, kode text, nama text not null, keterangan text,
    unique (business_unit_id, jenis, nama));

  create or replace function is_bu_admin(p_uid uuid, p_bu uuid) returns boolean
    language sql security definer stable as $$
      select exists (select 1 from membership_scopes ms
        where ms.user_id = p_uid
          and (ms.role = 'super_admin' or (ms.role = 'bu_admin' and ms.business_unit_id = p_bu))) $$;
  create or replace function has_outlet_scope(p_uid uuid, p_outlet uuid) returns boolean
    language sql security definer stable as $$
      select exists (select 1 from membership_scopes ms
        where ms.user_id = p_uid
          and (ms.role = 'super_admin'
               or ms.outlet_id = p_outlet
               or ms.business_unit_id = (select business_unit_id from outlets where id = p_outlet))) $$;
`);

// View 0136 APA ADANYA. §6 menguji `create or replace` di 0147 sungguh bisa
// menggantikannya — aturan Postgres menuntut kolom lama tetap di posisi & tipe
// yang sama, jadi menyisipkan kolom di tengah akan menggagalkan migrationnya
// DI TENGAH JALAN. Menyiapkan view kosong di sini tidak akan menguji itu.
await db.exec(
  fs
    .readFileSync(path.join(AKAR, 'supabase/migrations/0136_rekap_waste_ikut_yang_lama.sql'), 'utf8')
    .replace(/notify pgrst[^;]*;/g, '')
    // Blok pelapor di ujungnya membaca `waste_rekap` lewat raise notice — tidak
    // ada gunanya di sini dan memperberat keluarannya.
    .replace(/do \$\$[\s\S]*?raise notice[\s\S]*?end \$\$;/g, '')
);

const BU = (await satu(`insert into business_units (name) values ('Cafe') returning id`)).id;
const BU2 = (await satu(`insert into business_units (name) values ('Lain') returning id`)).id;
const OUT = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Sentul') returning id`, [BU])).id;
const OUT2 = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Serpong') returning id`, [BU2])).id;

const ADMIN = '11111111-1111-1111-1111-111111111111';
const STAFF = '22222222-2222-2222-2222-222222222222';
await q(`insert into user_profiles (id, full_name) values ($1,'Admin'), ($2,'Staff')`, [ADMIN, STAFF]);
await q(
  `insert into membership_scopes (user_id, business_unit_id, outlet_id, role)
   values ($1,$2,null,'bu_admin'), ($3,$2,$4,'staff')`,
  [ADMIN, BU, STAFF, OUT]
);

const BERAS = (await satu(`insert into products (business_unit_id, name, base_unit) values ($1,'Beras','gr') returning id`, [BU])).id;

// Satu catatan LAMA (tanpa waste_run) supaya §6 bisa membuktikan cabang kedua
// view-nya tetap ikut sesudah kolomnya bertambah.
await q(
  `insert into stock_movements (business_unit_id, outlet_id, product_id, movement_type, qty_delta, notes, created_by)
   values ($1,$2,$3,'waste',-500,'Spoil',$4)`,
  [BU, OUT, BERAS, STAFF]
);

const jalankan = async (b) =>
  db.exec(fs.readFileSync(path.join(AKAR, 'supabase/migrations', b), 'utf8').replace(/notify pgrst[^;]*;/g, ''));

await jalankan('0147_purpose_waste.sql');
console.log('  0147 terpasang.');

console.log('\n§1 Kolom & jejaknya');

const kolom = (
  await q(
    `select column_name from information_schema.columns
      where table_name = 'waste_runs' and column_name like 'purpose%' order by column_name`
  )
).rows.map((r) => r.column_name);
cek('§1 tiga kolom purpose terpasang', kolom, ['purpose', 'purpose_diisi_at', 'purpose_diisi_by']);
benar(
  '§1 indeks parsial untuk yang belum ber-purpose ada',
  (await satu(`select 1 from pg_indexes where indexname = 'idx_waste_tanpa_purpose'`)) !== undefined
);

console.log('\n§2 purpose_esb_sah');

cek('§2 kosong -> null', (await satu(`select purpose_esb_sah($1, null) as v`, [BU])).v, null);
cek('§2 spasi saja -> null', (await satu(`select purpose_esb_sah($1, '   ') as v`, [BU])).v, null);

// DAFTAR INDUK BELUM DIIMPOR: nilainya diterima apa adanya. Kalau ini salah,
// BU yang belum sempat mengimpor daftarnya kehilangan kemampuan mencatat waste
// sama sekali — aturan baru yang mematikan pekerjaan yang selama ini jalan.
cek(
  '§2 belum ada daftar induk -> diterima apa adanya',
  (await satu(`select purpose_esb_sah($1, ' Waste Bar ') as v`, [BU])).v,
  'Waste Bar'
);

await q(
  `insert into esb_master (business_unit_id, jenis, nama, kode, keterangan) values
     ($1,'purpose','Waste Kitchen','3','COGS - Food'),
     ($1,'purpose','Waste Bar','4','COGS - Beverage'),
     ($1,'purpose','Packaging Spoil','5','COGS - Other')`,
  [BU]
);

// Yang dikembalikan ejaan DARI DAFTARNYA, bukan yang diketik. Mengirim
// "waste kitchen" huruf kecil ke ESB akan ditolak di sana, di layar yang
// berbeda dan berminggu-minggu kemudian.
cek(
  '§2 ada daftar induk -> ejaan KANONIK yang dikembalikan, bukan yang diketik',
  (await satu(`select purpose_esb_sah($1, 'waste kitchen') as v`, [BU])).v,
  'Waste Kitchen'
);
cek(
  '§2 beda huruf besar-kecil & spasi tepi tetap cocok',
  (await satu(`select purpose_esb_sah($1, '  wASTE bAR ') as v`, [BU])).v,
  'Waste Bar'
);
benar(
  '§2 nilai di luar daftar DITOLAK',
  (await galat(`select purpose_esb_sah($1, 'Waste Gudang')`, [BU])) !== null,
  'nama karangan akan ditolak ESB berbulan-bulan kemudian, di layar yang berbeda'
);
// Daftar induk berlaku PER BU. BU2 belum mengimpor apa pun, jadi ia masih di
// keadaan "belum diimpor" — daftar milik BU lain TIDAK ikut menjaganya, dan
// tidak ikut mengunci pencatatannya.
benar(
  '§2 daftar induk berlaku per BU, tidak bocor antar-BU',
  (await galat(`select purpose_esb_sah($1, 'Apa Saja')`, [BU2])) === null
);

console.log('\n§3 catat_waste menyimpan Purpose');

await jadi(STAFF);
const W1 = (
  await satu(`select catat_waste($1,'spoil',$2,100,'foto/a.jpg','basah','Waste Kitchen') as id`, [OUT, BERAS])
).id;
const r1 = await satu(`select purpose, purpose_diisi_by, purpose_diisi_at from waste_runs where id = $1`, [W1]);
cek('§3 purpose tersimpan', r1.purpose, 'Waste Kitchen');
benar('§3 pengisinya tercatat', r1.purpose_diisi_by === STAFF && r1.purpose_diisi_at !== null);

// Boleh kosong: daftar induk yang gagal dimuat di HP tidak boleh membuat staff
// berdiri di dapur dengan barang rusak dan tombol Simpan yang menolak.
const W2 = (await satu(`select catat_waste($1,'spoil',$2,50,'foto/b.jpg',null,null) as id`, [OUT, BERAS])).id;
const r2 = await satu(`select purpose, purpose_diisi_by from waste_runs where id = $1`, [W2]);
cek('§3 purpose kosong tetap boleh disimpan', r2.purpose, null);
benar('§3 purpose kosong tidak mengarang pengisinya', r2.purpose_diisi_by === null);

benar(
  '§3 nilai di luar daftar ditolak saat mencatat',
  (await galat(`select catat_waste($1,'spoil',$2,10,'foto/c.jpg',null,'Waste Gudang')`, [OUT, BERAS])) !== null
);
cek(
  '§3 dan yang ditolak TIDAK meninggalkan baris apa pun',
  (await satu(`select count(*)::int as n from waste_runs where photo_path = 'foto/c.jpg'`)).n,
  0
);

console.log('\n§4 Tanda tangan lama benar-benar hilang');

const nArg = (
  await q(
    `select pronargs from pg_proc where proname = 'catat_waste' order by pronargs`
  )
).rows.map((r) => r.pronargs);
cek('§4 hanya ada SATU catat_waste, berargumen 7', nArg, [7]);
benar(
  '§4 memanggilnya dengan 6 argumen gagal',
  (await galat(`select catat_waste($1,'spoil',$2,1,'foto/d.jpg',null)`, [OUT, BERAS])) !== null,
  'dua overload berarti permintaan yang kehilangan p_purpose tersimpan diam-diam tanpa Purpose'
);

console.log('\n§5 ubah_purpose_waste');

await jadi(STAFF);
cek('§5 staff tidak bisa mengubah', (await satu(`select ubah_purpose_waste($1,'Waste Bar') as n`, [[W2]])).n, 0);

await jadi(ADMIN);
cek('§5 admin mengisi yang kosong', (await satu(`select ubah_purpose_waste($1,'waste bar') as n`, [[W2]])).n, 1);
const r3 = await satu(`select purpose, purpose_diisi_by from waste_runs where id = $1`, [W2]);
cek('§5 yang tersimpan ejaan kanoniknya', r3.purpose, 'Waste Bar');
benar('§5 pengisinya berganti ke admin', r3.purpose_diisi_by === ADMIN);

benar(
  '§5 mengosongkannya DITOLAK',
  (await galat(`select ubah_purpose_waste($1,'  ')`, [[W2]])) !== null,
  'mengosongkan tidak memperbaiki apa pun — kejadiannya tetap tertahan, tanpa jejak kenapa'
);
benar('§5 nilai di luar daftar ditolak', (await galat(`select ubah_purpose_waste($1,'Waste Gudang')`, [[W2]])) !== null);

// YANG SUDAH DIEKSPOR TERKUNCI. Berkasnya sudah berangkat membawa nilai lama;
// mengubahnya di sini membuat catatan berbeda di dua tempat, selamanya.
await q(`update waste_runs set esb_exported_at = now() where id = $1`, [W1]);
const pesan = await galat(`select ubah_purpose_waste($1,'Waste Bar')`, [[W1]]);
benar('§5 yang sudah diekspor ditolak', pesan !== null);
benar(
  '§5 dan pesannya menyebut jalan keluarnya',
  /Batalkan tanda ekspor/.test(pesan ?? ''),
  'penolakan tanpa jalan keluar membuat admin membuka SQL Editor'
);
cek(
  '§5 purpose-nya memang tidak berubah',
  (await satu(`select purpose from waste_runs where id = $1`, [W1])).purpose,
  'Waste Kitchen'
);

cek('§5 daftar kosong: 0 tanpa melempar', (await satu(`select ubah_purpose_waste(null,'Waste Bar') as n`)).n, 0);
// Waste milik BU lain: bukan galat, melainkan 0 baris. Melempar akan membuat
// satu id nyasar menggagalkan seluruh pengisian sekaligus.
const WLAIN = (
  await satu(
    `insert into waste_runs (business_unit_id, outlet_id, jenis, product_id, qty, photo_path, code)
     values ($1,$2,'spoil',$3,1,'x','WST-X') returning id`,
    [BU2, OUT2, BERAS]
  )
).id;
cek('§5 waste BU lain: 0', (await satu(`select ubah_purpose_waste($1,'Waste Bar') as n`, [[WLAIN]])).n, 0);

// DAFTAR YANG DIPAKAI MEMERIKSA HARUS MILIK BU YANG DIPEGANG PEMANGGILNYA.
//
// Daftar arisan: kalau BU-nya diambil dari baris mana pun tanpa memeriksa
// wewenang, `limit 1` tanpa urutan bisa memilih waste milik BU2 — yang daftar
// Purpose-nya KOSONG. Keadaan "belum diimpor" lalu berlaku, nilai apa pun
// diterima, dan nilai yang tidak pernah divalidasi itu ditulis ke baris milik
// BU1. Tidak ada galat; ESB yang menolaknya berminggu-minggu kemudian.
const W4 = (await satu(`select catat_waste($1,'spoil',$2,7,'foto/e.jpg',null,null) as id`, [OUT, BERAS])).id;
benar(
  '§5 daftar pemeriksanya milik BU pemanggil, bukan BU baris mana pun',
  (await galat(`select ubah_purpose_waste($1,'Purpose Karangan')`, [[WLAIN, W4]])) !== null,
  'BU2 belum punya daftar Purpose — memakai daftarnya berarti nilai apa pun lolos ke baris milik BU1'
);
cek(
  '§5 dan barisnya memang tidak tersentuh',
  (await satu(`select purpose from waste_runs where id = $1`, [W4])).purpose,
  null
);

console.log('\n§6 waste_rekap');

const kolomView = (
  await q(`select column_name from information_schema.columns where table_name = 'waste_rekap' order by ordinal_position`)
).rows.map((r) => r.column_name);
benar('§6 view memuat kolom purpose', kolomView.includes('purpose'));
benar('§6 view memuat penanda terkunci', kolomView.includes('esb_terkunci'));
// Kolom LAMA tetap di posisinya. `create or replace view` menolak kalau tidak —
// tapi kalau suatu saat view-nya di-drop lalu dibuat ulang, urutan yang bergeser
// tidak akan melempar apa pun dan seluruh layar rekap membaca kolom yang salah.
cek('§6 sebelas kolom pertama tidak bergeser', kolomView.slice(0, 11), [
  'waste_id',
  'business_unit_id',
  'outlet_id',
  'outlet_nama',
  'code',
  'jenis',
  'created_at',
  'tanggal',
  'qty_kejadian',
  'photo_path',
  'notes'
]);

const rekap = (await q(`select waste_id, lama, purpose, esb_terkunci from waste_rekap order by lama, purpose nulls last`)).rows;
// Jumlahnya TIDAK dipatok angka tetap: menambah satu kejadian di §5 akan
// membuat §6 merah tanpa ada yang rusak, dan yang membetulkannya cenderung
// menurunkan tuntutannya alih-alih memahami sebabnya.
cek('§6 catatan lama ikut, dan yang berdokumen juga', {
  lama: rekap.filter((r) => r.lama).length,
  berdokumen: rekap.filter((r) => !r.lama).length > 0
}, { lama: 1, berdokumen: true });
cek(
  '§6 purpose ikut terbaca di baris berdokumen',
  [...new Set(rekap.filter((r) => !r.lama && r.purpose).map((r) => r.purpose))].sort(),
  ['Waste Bar', 'Waste Kitchen']
);
cek(
  '§6 catatan lama tetap ikut, dengan purpose null',
  rekap.filter((r) => r.lama).map((r) => r.purpose),
  [null]
);
cek(
  '§6 yang sudah diekspor ditandai terkunci',
  rekap.filter((r) => r.esb_terkunci).length,
  1
);

console.log('\n§7 Dijalankan ulang');

await jalankan('0147_purpose_waste.sql');
cek(
  '§7 aman dijalankan dua kali — purpose tetap',
  (await satu(`select count(*)::int as n from waste_runs where purpose is not null`)).n,
  2
);

console.log('');
if (gagal === 0) console.log('Semua pemeriksaan 0147 lolos. ✅');
else console.error(`${gagal} pemeriksaan 0147 GAGAL.`);
process.exit(gagal === 0 ? 0 : 1);
