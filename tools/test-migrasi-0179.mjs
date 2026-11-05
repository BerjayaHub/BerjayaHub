/**
 * MIGRATION 0179 — FOTO IKUT BERPINDAH SAAT ASET DITRANSFER ANTAR BU.
 *
 * ============ APA YANG DIBUKTIKAN ============
 *
 *   §1 Transfer lintas BU membuat item baru di BU tujuan yang mewarisi
 *      PENUNJUK fotonya — bukan salinan berkasnya.
 *   §2 BU tujuan yang sudah punya fotonya sendiri TIDAK ditimpa.
 *   §3 Transfer berantai (A -> B -> C) meneruskan berkas yang SAMA.
 *   §4 Transfer DALAM satu BU tidak mewariskan apa pun.
 *   §5 Trigger 0171 tidak menghapus warisan.
 *   §6 Revisi transfer juga mewariskan fotonya.
 *   §7 Backfill membereskan transfer yang sudah terlanjur.
 *   §8 Dijalankan dua kali tetap aman, dan jejak `asset_log` transfer tidak
 *      hilang saat fungsinya ditulis ulang.
 */
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AKAR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let gagal = 0;
let n = 0;
const cek = (nama, dapat, harap) => {
  n++;
  if (JSON.stringify(dapat) !== JSON.stringify(harap)) {
    gagal++;
    console.error(`❌ ${nama}\n   dapat : ${JSON.stringify(dapat)}\n   harap : ${JSON.stringify(harap)}`);
  }
};
const benar = (nama, syarat, ket = '') => {
  n++;
  if (!syarat) {
    gagal++;
    console.error(`❌ ${nama}${ket ? ' — ' + ket : ''}`);
  }
};

const db = new PGlite();
const q = (sql, p) => db.query(sql, p);
const satu = async (sql, p) => (await q(sql, p)).rows[0];
const semua = async (sql, p) => (await q(sql, p)).rows;
const sebagai = (uid) => q(`select set_config('request.jwt.claim.sub', $1, false)`, [uid]);
const galat = async (fn) => {
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
  create schema if not exists storage;
  create or replace function auth.uid() returns uuid language sql stable as $x$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $x$;

  create table business_units (id uuid primary key default gen_random_uuid(), name text);
  create table outlets (id uuid primary key default gen_random_uuid(), business_unit_id uuid, name text);
  create table user_profiles (id uuid primary key, full_name text);
  create table membership_scopes (
    id uuid primary key default gen_random_uuid(),
    user_id uuid, business_unit_id uuid, outlet_id uuid, role text);
  create table assets (
    id uuid primary key default gen_random_uuid(),
    business_unit_id uuid references business_units(id) on delete cascade,
    outlet_id uuid references outlets(id) on delete cascade,
    name text, category text, qty numeric default 1, size text, photo_path text,
    condition text default 'normal', condition_note text, notes text,
    created_by uuid references user_profiles(id) on delete set null,
    updated_by uuid references user_profiles(id) on delete set null,
    created_at timestamptz default now(), updated_at timestamptz default now());

  create or replace function is_bu_admin(p_uid uuid, p_bu uuid) returns boolean
    language sql security definer stable as $x$
      select exists (select 1 from membership_scopes ms where ms.user_id = p_uid
        and (ms.role = 'super_admin' or (ms.business_unit_id = p_bu and ms.role = 'bu_admin'))) $x$;
  -- ============ TIRUAN storage.objects SEPERLUNYA ============
  --
  -- 0179 mengubah policy BACA foto, dan setengah perbaikannya ada di situ:
  -- penunjuknya boleh benar, tapi kalau izinnya tidak dibuka, gambarnya tetap
  -- gagal dimuat — dan di layar itu terbaca persis seperti "belum difoto".
  -- Jadi policy-nya ikut dijalankan di sini, bukan cuma fungsinya.
  --
  -- (Tanda kutip di komentar ini, BUKAN backtick: satu backtick mengakhiri
  --  template literal JS di tengah SQL.)
  create table storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text,
    name text);

  create or replace function asset_photo_outlet(p_name text) returns uuid
    language sql security definer stable as $$
      select nullif(split_part(p_name, '/', 1), '')::uuid $$;
  create or replace function asset_photo_bu(p_name text) returns uuid
    language sql security definer stable as $$
      select o.business_unit_id from outlets o where o.id = asset_photo_outlet(p_name) $$;

  create or replace function has_bu_scope(p_uid uuid, p_bu uuid) returns boolean
    language sql security definer stable as $x$
      select exists (select 1 from membership_scopes ms where ms.user_id = p_uid
        and (ms.role = 'super_admin' or ms.business_unit_id = p_bu)) $x$;
  create or replace function has_outlet_scope(p_uid uuid, p_outlet uuid) returns boolean
    language sql security definer stable as $x$
      select exists (
        select 1 from membership_scopes ms join outlets o on o.id = p_outlet
         where ms.user_id = p_uid
           and (ms.role = 'super_admin'
                or (ms.business_unit_id = o.business_unit_id and ms.role = 'bu_admin')
                or ms.outlet_id = p_outlet)) $x$;
  create or replace function is_admin_of_outlet(p_uid uuid, p_outlet uuid) returns boolean
    language sql security definer stable as $x$
      select exists (
        select 1 from membership_scopes ms join outlets o on o.id = p_outlet
         where ms.user_id = p_uid
           and (ms.role = 'super_admin'
                or (ms.business_unit_id = o.business_unit_id and ms.role = 'bu_admin'))) $x$;
`);

const CAFE = (await satu(`insert into business_units (name) values ('Cafe') returning id`)).id;
const BENGKEL = (await satu(`insert into business_units (name) values ('Bengkel') returning id`)).id;
const A = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Serpong') returning id`, [CAFE])).id;
const B = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Sentul') returning id`, [CAFE])).id;
const C = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Otonix Depok') returning id`, [BENGKEL])).id;

const ADMIN = '11111111-1111-1111-1111-111111111111';
const STAFF = '22222222-2222-2222-2222-222222222222';
const STAFF_LAIN = '33333333-3333-3333-3333-333333333333';
await q(`insert into user_profiles (id, full_name) values ($1,'Pak Admin'),($2,'Budi'),($3,'Siti')`, [ADMIN, STAFF, STAFF_LAIN]);
await q(
  `insert into membership_scopes (user_id, business_unit_id, outlet_id, role) values
     ($1,$4,null,'bu_admin'), ($2,$4,$5,'staff'), ($3,$6,$7,'staff')`,
  [ADMIN, STAFF, STAFF_LAIN, CAFE, A, BENGKEL, C]
);

await q(
  `insert into assets (business_unit_id, outlet_id, name, category, qty) values
     ($1,$2,'Kursi Bar','Bar',20), ($1,$2,'Meja Lipat','Bar',6), ($1,$3,'Kursi Bar','Bar',4)`,
  [CAFE, A, B]
);

for (const f of [
  '0168_aset_master_bu_dan_kode.sql',
  '0169_aset_pindah_dan_izin_hapus.sql',
  '0170_kerusakan_aset_dan_riwayat.sql',
  '0171_foto_acuan_item_aset.sql',
  '0172_kategori_wajib_dan_hapus_item_aset.sql',
  '0173_transfer_aset.sql',
  '0174_revisi_transfer_aset.sql'
]) {
  await db.exec(fs.readFileSync(path.join(AKAR, 'supabase/migrations', f), 'utf8').replace(/notify pgrst[^;]*;/g, ''));
}

// ============ DIJALANKAN DUA KALI DENGAN SENGAJA ============
//
// iko menjalankan migrasi dengan menempelkannya ke SQL editor, dan pertanyaan
// "apakah ini perlu di-run ulang?" muncul tiap kali ada perubahan. Jawabannya
// hanya bisa dipercaya kalau menjalankannya ulang memang aman — jadi dua yang
// terbaru dipasang sekali lagi di sini, di atas skema yang sudah ada.
for (const f of ['0173_transfer_aset.sql', '0174_revisi_transfer_aset.sql']) {
  await db.exec(fs.readFileSync(path.join(AKAR, 'supabase/migrations', f), 'utf8').replace(/notify pgrst[^;]*;/g, ''));
}
console.log('  0168 … 0174 terpasang (0173 & 0174 dua kali — idempoten).');

const KURSI = (await satu(`select id from asset_items where name='Kursi Bar' and business_unit_id=$1`, [CAFE])).id;
const MEJA = (await satu(`select id from asset_items where name='Meja Lipat' and business_unit_id=$1`, [CAFE])).id;
const qtyDi = async (item, outlet) => {
  const r = await satu(`select qty from asset_stock where asset_item_id=$1 and outlet_id=$2`, [item, outlet]);
  return r ? Number(r.qty) : null;
};
const totalSemua = async () => Number((await satu(`select coalesce(sum(qty),0) s from asset_stock`)).s);

const kirim = (o = {}) =>
  satu(`select kirim_transfer_aset($1,$2,$3,$4,$5::jsonb,$6,$7) as h`, [
    o.dari ?? A,
    o.ke === undefined ? B : o.ke,
    o.lain ?? null,
    o.pembawa ?? 'Pak Joko',
    JSON.stringify(o.items ?? [{ item_id: KURSI, qty: 5 }]),
    o.catatan ?? null,
    o.foto ?? null
  ]);

await db.exec(`
  alter table storage.objects enable row level security;
  -- FORCE: Postgres MELEWATI RLS untuk pemilik tabel, dan di PGlite semua
  -- perintah berjalan sebagai pemiliknya. Tanpa ini, tesnya hijau untuk
  -- kebijakan yang tidak ada sama sekali.
  alter table storage.objects force row level security;
  grant usage on schema storage to authenticated;
  grant select, insert on storage.objects to authenticated;
`);

console.log('§0 Migrationnya jalan');

/** Pasang satu migration — `notify pgrst` dibuang, PGlite tidak mengenalnya. */
const jalankan = async (b) =>
  db.exec(fs.readFileSync(path.join(AKAR, 'supabase/migrations', b), 'utf8').replace(/notify pgrst[^;]*;/g, ''));

await jalankan('0179_foto_aset_ikut_transfer.sql');
for (const fn of ['wariskan_foto_item_aset', 'foto_berlaku_item_aset']) {
  benar(`§0 \`${fn}\` ada`, (await satu(`select count(*)::int as n from pg_proc where proname = $1`, [fn])).n > 0);
}

const itemDi = async (bu, nama) =>
  (await satu(`select id from asset_items where business_unit_id=$1 and name=$2`, [bu, nama]))?.id ?? null;
const bacaItem = (id) =>
  satu(`select photo_path, photo_outlet_id, foto_asal_path, foto_asal_outlet_id from asset_items where id=$1`, [id]);
const berlaku = async (id) => (await satu(`select foto_berlaku_item_aset($1) as f`, [id])).f;

// Serpong (BU Cafe) memotret kursinya.
await sebagai(ADMIN);
await q(`update asset_stock set photo_path = $1 where asset_item_id=$2 and outlet_id=$3`, [`${A}/kursi.jpg`, KURSI, A]);
cek('§0 foto acuan BU asal terpasang (0171)', (await bacaItem(KURSI)).photo_path, `${A}/kursi.jpg`);

// ===============================================================
console.log('\n§1 Transfer lintas BU mewariskan penunjuk fotonya');
// ===============================================================
await sebagai(ADMIN);
await q(`update asset_stock set qty = 30 where asset_item_id=$1 and outlet_id=$2`, [KURSI, A]);
await sebagai(STAFF);
await kirim({ ke: C, items: [{ item_id: KURSI, qty: 3 }] });

const KURSI_BENGKEL = await itemDi(BENGKEL, 'Kursi Bar');
benar('§1 item padanannya terbentuk di BU tujuan', Boolean(KURSI_BENGKEL));
let b = await bacaItem(KURSI_BENGKEL);
cek('§1 penunjuk foto diwarisi', b.foto_asal_path, `${A}/kursi.jpg`);
cek('§1 outlet pemilik fotonya ikut dicatat', b.foto_asal_outlet_id, A);

// MENUNJUK, BUKAN MENYALIN: `photo_path` BU tujuan tetap kosong — kolom itu
// milik trigger 0171 dan hanya diisi dari stok BU-nya sendiri.
cek('§1 photo_path BU tujuan tetap kosong', b.photo_path, null);
cek('§1 foto yang BERLAKU jadi foto warisannya', await berlaku(KURSI_BENGKEL), `${A}/kursi.jpg`);

// ===============================================================
console.log('\n§2 Foto sendiri tidak ditimpa warisan');
// ===============================================================
await sebagai(ADMIN);
await q(`update asset_stock set photo_path = $1 where asset_item_id=$2 and outlet_id=$3`, [
  `${C}/kursi-bengkel.jpg`,
  KURSI_BENGKEL,
  C
]);
cek('§2 BU tujuan punya fotonya sendiri', (await bacaItem(KURSI_BENGKEL)).photo_path, `${C}/kursi-bengkel.jpg`);
cek('§2 dan itu yang BERLAKU, bukan warisannya', await berlaku(KURSI_BENGKEL), `${C}/kursi-bengkel.jpg`);

await sebagai(STAFF);
await kirim({ ke: C, items: [{ item_id: KURSI, qty: 1 }] });
cek('§2 transfer berikutnya tidak menimpa fotonya sendiri', (await bacaItem(KURSI_BENGKEL)).photo_path, `${C}/kursi-bengkel.jpg`);

// ===============================================================
console.log('\n§3 Transfer berantai meneruskan berkas yang SAMA');
// ===============================================================
await sebagai(ADMIN);
const BU3 = (await satu(`insert into business_units (name) values ('Armada') returning id`)).id;
const OUT3 = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Pool Armada') returning id`, [BU3])).id;
await q(`insert into membership_scopes (user_id, business_unit_id, outlet_id, role) values ($1,$2,$3,'staff')`, [STAFF, BU3, OUT3]);
// Pengirim lompatan kedua bertugas di outlet BENGKEL — `kirim_transfer_aset`
// menuntut `has_outlet_scope` pada outlet ASAL, bukan sekadar wewenang di
// outlet tujuan.
await q(`insert into membership_scopes (user_id, business_unit_id, outlet_id, role) values ($1,$2,$3,'staff')`, [STAFF, BENGKEL, C]);

await q(`update asset_stock set photo_path = $1, qty = 10 where asset_item_id=$2 and outlet_id=$3`, [`${A}/meja.jpg`, MEJA, A]);
await sebagai(STAFF);
await kirim({ ke: C, items: [{ item_id: MEJA, qty: 4 }] });
const MEJA_BENGKEL = await itemDi(BENGKEL, 'Meja Lipat');
cek('§3 lompatan pertama mewarisi', (await bacaItem(MEJA_BENGKEL)).foto_asal_path, `${A}/meja.jpg`);

await satu(`select kirim_transfer_aset($1,$2,null,'Pak Nurjen',$3::jsonb,null,null) as h`, [
  C,
  OUT3,
  JSON.stringify([{ item_id: MEJA_BENGKEL, qty: 2 }])
]);
const MEJA_ARMADA = await itemDi(BU3, 'Meja Lipat');

// ============ BERKAS YANG SAMA, BUKAN RANTAI PENUNJUK ============
//
// Kalau yang diwariskan adalah "penunjuk ke item sebelumnya", membacanya
// menuntut penelusuran rantai — dan rantai itu putus begitu satu item di
// tengahnya dihapus.
cek('§3 lompatan kedua menunjuk berkas ASLI', (await bacaItem(MEJA_ARMADA)).foto_asal_path, `${A}/meja.jpg`);
cek('§3 outletnya pun outlet asli', (await bacaItem(MEJA_ARMADA)).foto_asal_outlet_id, A);

// ===============================================================
console.log('\n§4 Dalam satu BU tidak mewariskan apa pun');
// ===============================================================
await sebagai(STAFF);
await kirim({ ke: B, items: [{ item_id: KURSI, qty: 1 }] });
cek('§4 item asalnya tidak jadi mewarisi dirinya sendiri', (await bacaItem(KURSI)).foto_asal_path, null);

// ===============================================================
console.log('\n§5 Trigger 0171 tidak menghapus warisan');
// ===============================================================

// ============ KENAPA KOLOMNYA DIPISAH ============
//
// `segarkan_foto_item_aset` MENGOSONGKAN `photo_path` kalau tidak ada satu pun
// foto di stok BU-nya. Kalau warisan menumpang kolom itu, ia terhapus sendiri
// pada perubahan foto berikutnya — tanpa meninggalkan jejak apa pun.
await sebagai(ADMIN);
await q(`update asset_stock set photo_path = null where asset_item_id=$1 and outlet_id=$2`, [MEJA_BENGKEL, C]);
await satu(`select segarkan_foto_item_aset($1) as x`, [MEJA_BENGKEL]);
cek('§5 warisannya selamat', (await bacaItem(MEJA_BENGKEL)).foto_asal_path, `${A}/meja.jpg`);
cek('§5 dan tetap jadi foto yang berlaku', await berlaku(MEJA_BENGKEL), `${A}/meja.jpg`);

// ===============================================================
console.log('\n§6 Revisi transfer ikut mewariskan');
// ===============================================================
await sebagai(ADMIN);
const BOTOL = (
  await satu(
    `insert into asset_items (business_unit_id, kode, name, category, created_by) values ($1,'B900','Botol Kaca','Bar',$2) returning id`,
    [CAFE, ADMIN]
  )
).id;
await q(`insert into asset_stock (asset_item_id, outlet_id, qty, photo_path, created_by, updated_by) values ($1,$2,9,$3,$4,$4)`, [
  BOTOL,
  A,
  `${A}/botol.jpg`,
  ADMIN
]);
await sebagai(STAFF);
const sjBotol = (await kirim({ ke: B, items: [{ item_id: BOTOL, qty: 2 }] })).h;
const idBotol = (await satu(`select id from asset_transfer where kode=$1`, [sjBotol.kode])).id;

await sebagai(ADMIN);
await satu(`select ubah_transfer_aset($1,$2,null,'Pak Nurjen',$3::jsonb,'salah tujuan',null) as h`, [
  idBotol,
  C,
  JSON.stringify([{ item_id: BOTOL, qty: 2 }])
]);
const BOTOL_BENGKEL = await itemDi(BENGKEL, 'Botol Kaca');
benar('§6 revisi membuat item di BU tujuan', Boolean(BOTOL_BENGKEL));
cek('§6 dan fotonya ikut diwariskan', (await bacaItem(BOTOL_BENGKEL)).foto_asal_path, `${A}/botol.jpg`);

// ===============================================================
console.log('\n§7 Backfill membereskan yang sudah terlanjur');
// ===============================================================
await q(`update asset_items set foto_asal_path = null, foto_asal_outlet_id = null where id = $1`, [KURSI_BENGKEL]);
await q(`update asset_stock set photo_path = null where asset_item_id=$1`, [KURSI_BENGKEL]);
await satu(`select segarkan_foto_item_aset($1) as x`, [KURSI_BENGKEL]);
cek('§7 keadaan sebelum backfill: tidak ada foto sama sekali', await berlaku(KURSI_BENGKEL), null);

await jalankan('0179_foto_aset_ikut_transfer.sql');
cek('§7 backfill memulihkannya dari jejak transfernya', (await bacaItem(KURSI_BENGKEL)).foto_asal_path, `${A}/kursi.jpg`);

// ===============================================================
console.log('\n§8 Dijalankan dua kali & jejak transfer tetap utuh');
// ===============================================================
await jalankan('0179_foto_aset_ikut_transfer.sql');
cek('§8 warisannya tidak berubah', (await bacaItem(KURSI_BENGKEL)).foto_asal_path, `${A}/kursi.jpg`);

// ============ FUNGSINYA DITULIS ULANG — JEJAKNYA HARUS SELAMAT ============
//
// 0179 menulis ulang `kirim_transfer_aset` UTUH hanya untuk menyisipkan satu
// baris. Percobaan pertama kehilangan DUA insert `asset_log` di dalamnya —
// riwayat aset berhenti menyebutkan transfer sama sekali, dan tidak ada satu
// pun galat yang menandainya. Ketahuan hanya karena hasilnya dibandingkan
// baris demi baris dengan aslinya.
await sebagai(ADMIN);
await q(`update asset_stock set qty = 30 where asset_item_id=$1 and outlet_id=$2`, [KURSI, A]);
const logSebelum = (await satu(`select count(*)::int as n from asset_log where aksi in ('transfer-keluar','transfer-masuk')`)).n;
await sebagai(STAFF);
await kirim({ ke: C, items: [{ item_id: KURSI, qty: 1 }] });
const logSesudah = (await satu(`select count(*)::int as n from asset_log where aksi in ('transfer-keluar','transfer-masuk')`)).n;
benar('§8 transfer tetap menulis jejak keluar & masuk', logSesudah - logSebelum === 2, `${logSebelum} -> ${logSesudah}`);

// ===============================================================
console.log('\n§9 Izin BACA fotonya ikut dibuka');
// ===============================================================

// ============ SETENGAH PERBAIKANNYA ADA DI SINI ============
//
// Penunjuk yang benar tidak ada gunanya kalau berkasnya ditolak: gambar yang
// selalu gagal dimuat terbaca persis seperti "barangnya belum difoto". Jadi
// policy-nya DIJALANKAN, bukan cuma fungsinya diperiksa ada.
//
// Harness-nya sudah disiapkan sejak awal berkas ini; percobaan pertama
// membangunnya lalu tidak pernah memakainya — bentuk "verifikasi yang
// kelihatan seperti verifikasi" yang paling mudah terjadi.
await q(`insert into storage.objects (bucket_id, name) values ('asset-photos', $1)`, [`${A}/kursi.jpg`]);

// ============ `set role` WAJIB, BUKAN KERAPIAN ============
//
// `sebagai()` hanya memasang klaim JWT; sambungannya tetap berjalan sebagai
// PEMILIK tabel, dan pemilik MELEWATI RLS — bahkan dengan FORCE sekalipun,
// karena peran di PGlite adalah superuser. Tanpa `set role authenticated`,
// seluruh pemeriksaan di bawah mengembalikan "boleh" untuk siapa pun, dan
// dua di antaranya memang sempat lulus begitu.
//
// Policy-nya sendiri bertuliskan `to authenticated`: dijalankan sebagai peran
// lain, ia bahkan tidak ikut dipertimbangkan.
const bisaBaca = async (uid, nama) => {
  await sebagai(uid);
  await db.exec('set role authenticated;');
  try {
    const r = await satu(`select count(*)::int as n from storage.objects where bucket_id='asset-photos' and name=$1`, [nama]);
    return r.n > 0;
  } finally {
    await db.exec('reset role;');
  }
};

// Siti cuma punya scope di BU Bengkel. Berkasnya ada di folder outlet BU
// Cafe, jadi jalur lama (prefix path) menolaknya — yang mengizinkan hanya
// warisan transfernya.
benar('§9 BU penerima boleh membaca foto warisannya', await bisaBaca(STAFF_LAIN, `${A}/kursi.jpg`), 'ditolak');

// Pemilik aslinya tetap boleh, lewat jalur lama.
benar('§9 BU pemilik berkasnya tetap boleh', await bisaBaca(ADMIN, `${A}/kursi.jpg`));

// Yang tidak punya hubungan apa pun tetap ditolak — kalau tidak, policy ini
// bukan memperluas izin melainkan membuka seluruh bucket.
await sebagai(ADMIN);
const ORANG_LUAR = '99999999-9999-9999-9999-999999999999';
await q(`insert into user_profiles (id, full_name) values ($1,'Orang Luar')`, [ORANG_LUAR]);
await q(`insert into storage.objects (bucket_id, name) values ('asset-photos', $1)`, [`${A}/rahasia.jpg`]);
benar('§9 orang di luar kedua BU tetap ditolak', !(await bisaBaca(ORANG_LUAR, `${A}/kursi.jpg`)));
benar(
  '§9 dan berkas yang TIDAK diwariskan tidak ikut terbuka',
  !(await bisaBaca(STAFF_LAIN, `${A}/rahasia.jpg`)),
  'satu warisan membuka seluruh folder'
);

// ---------------------------------------------------------------
console.log(`\n${gagal === 0 ? '✅' : '❌'} test-migrasi-0179: ${gagal === 0 ? 'semua' : gagal + ' GAGAL'}`);
process.exit(gagal === 0 ? 0 : 1);
