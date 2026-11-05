/**
 * MIGRATION 0180 — SATU KODE UNTUK SATU BARANG, DI SELURUH BU.
 *
 * ============ APA YANG DIBUKTIKAN ============
 *
 *   §1 Penyelarasan sekali jalan: barang yang sama berkode sama di semua BU,
 *      dan yang menang adalah BU yang DULUAN mendata barangnya.
 *   §2 Kode yang diperebutkan dua barang berbeda: yang kalah mendapat kode
 *      baru, bukan ikut memakai kode yang sudah berarti barang lain.
 *   §3 Jejaknya: `kode_lama` + `asset_kode_perubahan`.
 *   §4 Transfer lintas BU membawa kodenya.
 *   §5 Item baru di BU mana pun memakai kode yang sudah ada untuk nama itu.
 *   §6 Nomor baru bebas di SELURUH BU, bukan cuma di BU-nya sendiri.
 *   §7 Ganti nama: kodenya ikut, tidak lahir kode baru.
 *   §8 Bentrok di BU tujuan tidak merampas kode item yang sudah ada.
 *   §9 Dijalankan dua kali tetap aman.
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
const CAFE = (await satu(`insert into business_units (name) values ('Awal Bermula') returning id`)).id;
const ADMINBU = (await satu(`insert into business_units (name) values ('Admin') returning id`)).id;
const A = (await satu(`insert into outlets (business_unit_id, name) values ($1,'AB Gading') returning id`, [CAFE])).id;
const B = (await satu(`insert into outlets (business_unit_id, name) values ($1,'AB Sentul') returning id`, [CAFE])).id;
const C = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Gudang Admin') returning id`, [ADMINBU])).id;

const SUPER = '11111111-1111-1111-1111-111111111111';
await q(`insert into user_profiles (id, full_name) values ($1,'iko permadi')`, [SUPER]);
await q(`insert into membership_scopes (user_id, business_unit_id, outlet_id, role) values ($1,null,null,'super_admin')`, [SUPER]);
await sebagai(SUPER);

// ============ KEADAAN SEBELUM 0180, DIBUAT SEPERTI ADANYA ============
//
// `created_at` ditulis eksplisit dan berbeda-beda: pemilik kode ditentukan
// oleh siapa yang DULUAN mendata barangnya, jadi tes yang membiarkan seluruh
// barisnya lahir di milidetik yang sama sedang menguji urutan yang tidak
// dijanjikan siapa pun — dan hasilnya akan berbeda tiap kali dijalankan.
await q(
  `insert into assets (business_unit_id, outlet_id, name, category, qty, created_at) values
     ($1,$2,'Piring Coklat Besar','Kitchen',35,'2026-01-01'),
     ($1,$2,'Mangkok Hitam Sup Kecil','Kitchen',70,'2026-01-02'),
     ($1,$3,'Lepek Hitam','Kitchen',6,'2026-01-03'),
     ($4,$5,'Mangkok Hitam Sup Kecil','Kitchen',10,'2026-02-01'),
     ($4,$5,'Rak Besi Admin','Kitchen',2,'2026-02-02')`,
  [CAFE, A, B, ADMINBU, C]
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

const kodeDi = async (bu, nama) =>
  (await satu(`select kode from asset_items where business_unit_id=$1 and name=$2`, [bu, nama]))?.kode ?? null;

// ============ BENTROKNYA HARUS SUNGGUHAN DULU ============
//
// Kalau keadaan awalnya ternyata TIDAK bentrok, seluruh §1–§3 di bawah akan
// hijau tanpa 0180 mengerjakan apa pun. Jadi bentroknya dipastikan ada
// sebelum migrationnya dipasang.
const sebelum = {
  cafeMangkok: await kodeDi(CAFE, 'Mangkok Hitam Sup Kecil'),
  adminMangkok: await kodeDi(ADMINBU, 'Mangkok Hitam Sup Kecil'),
  cafePiring: await kodeDi(CAFE, 'Piring Coklat Besar'),
  adminRak: await kodeDi(ADMINBU, 'Rak Besi Admin')
};
benar(
  '§0 sebelum 0180: barang yang sama berkode BERBEDA di dua BU',
  sebelum.cafeMangkok !== sebelum.adminMangkok,
  `keduanya ${sebelum.cafeMangkok} — keadaan awalnya tidak bentrok, §1 tidak membuktikan apa pun`
);
benar(
  '§0 sebelum 0180: satu kode dipakai dua barang berbeda',
  sebelum.adminMangkok === sebelum.cafePiring,
  `${sebelum.adminMangkok} vs ${sebelum.cafePiring}`
);

/** Pasang satu migration — `notify pgrst` dibuang, PGlite tidak mengenalnya. */
const jalankan = async (b) =>
  db.exec(fs.readFileSync(path.join(AKAR, 'supabase/migrations', b), 'utf8').replace(/notify pgrst[^;]*;/g, ''));

await jalankan('0179_foto_aset_ikut_transfer.sql');
await jalankan('0180_kode_aset_global.sql');

console.log('§0 Migrationnya jalan');
for (const fn of ['kunci_item_aset', 'kode_global_berikutnya', 'kode_global_item_aset']) {
  benar(`§0 \`${fn}\` ada`, (await satu(`select count(*)::int as n from pg_proc where proname = $1`, [fn])).n > 0);
}
benar(
  '§0 triggernya terpasang di asset_items',
  (await satu(`select count(*)::int as n from pg_trigger where tgname = 'trg_kode_global_item_aset'`)).n === 1
);

// ===============================================================
console.log('§1 Penyelarasan: barang yang sama, kode yang sama');
// ===============================================================
const sesudah = {
  cafeMangkok: await kodeDi(CAFE, 'Mangkok Hitam Sup Kecil'),
  adminMangkok: await kodeDi(ADMINBU, 'Mangkok Hitam Sup Kecil'),
  cafePiring: await kodeDi(CAFE, 'Piring Coklat Besar'),
  adminRak: await kodeDi(ADMINBU, 'Rak Besi Admin')
};

cek('§1 barang yang sama berkode sama di dua BU', sesudah.adminMangkok, sesudah.cafeMangkok);
// Yang MENANG adalah yang duluan didata — BU Admin yang menyesuaikan, bukan
// sebaliknya. Kalau terbalik, kode di catatan owner yang berubah.
cek('§1 kode BU yang duluan mendata TIDAK berubah', sesudah.cafeMangkok, sebelum.cafeMangkok);
cek('§1 kode barang lain di BU itu juga tidak berubah', sesudah.cafePiring, sebelum.cafePiring);

// ===============================================================
console.log('§2 Kode yang diperebutkan dua barang');
// ===============================================================
//
// `Rak Besi Admin` memegang kode yang di BU lain sudah berarti barang lain.
// Ia tidak boleh tetap memegangnya — kalau tidak, satu kode tetap berarti dua
// barang, cuma sekarang dengan tabel pusat yang mengaku sebaliknya.
benar(
  '§2 barang yang kodenya diperebutkan mendapat kode baru',
  sesudah.adminRak !== sebelum.adminRak,
  `masih ${sesudah.adminRak}`
);
const ganda = await semua(
  `select upper(btrim(kode)) k, count(distinct kunci_item_aset(name, category)) n
     from asset_items group by 1 having count(distinct kunci_item_aset(name, category)) > 1`
);
cek('§2 tidak ada lagi satu kode untuk dua barang', ganda, []);

const daftarGanda = await semua(
  `select upper(btrim(kode)) k, count(*) n from asset_kode_global where utama group by 1 having count(*) > 1`
);
cek('§2 daftar pusat juga tidak memuat kode kembar', daftarGanda, []);

// ===============================================================
console.log('§3 Jejaknya');
// ===============================================================
const rakLama = await satu(`select kode_lama from asset_items where business_unit_id=$1 and name='Rak Besi Admin'`, [ADMINBU]);
cek('§3 kode lama disimpan', rakLama.kode_lama, sebelum.adminRak);
const jejak = await semua(
  `select nama, kode_lama, kode_baru from asset_kode_perubahan order by nama`
);
benar('§3 setiap perubahan tercatat', jejak.length >= 2, `cuma ${jejak.length} baris`);
benar(
  '§3 jejaknya menyebut kode lama DAN kode barunya',
  jejak.every((j) => j.kode_lama && j.kode_baru && j.kode_lama !== j.kode_baru)
);
// Yang TIDAK berubah tidak boleh ikut tercatat — laporan yang memuat barang
// yang kodenya tetap membuat orang mencari perubahan yang tidak pernah ada.
cek(
  '§3 yang kodenya tidak berubah tidak ikut dicatat',
  jejak.filter((j) => j.nama === 'Piring Coklat Besar').length,
  0
);
const sisaSementara = await semua(`select kode from asset_items where kode like '~%'`);
cek('§3 tidak ada kode sementara yang tersangkut', sisaSementara, []);

// ===============================================================
console.log('§4 Transfer lintas BU membawa kodenya');
// ===============================================================
const LEPEK = (await satu(`select id, kode from asset_items where business_unit_id=$1 and name='Lepek Hitam'`, [CAFE]));
await satu(`select kirim_transfer_aset($1,$2,$3,$4,$5::jsonb,$6,$7) as h`, [
  B,
  C,
  null,
  'Pak Ahmad',
  JSON.stringify([{ item_id: LEPEK.id, qty: 4 }]),
  null,
  null
]);
const lepekAdmin = await satu(`select kode, kode_lama from asset_items where business_unit_id=$1 and name='Lepek Hitam'`, [ADMINBU]);
benar('§4 itemnya terbentuk di BU tujuan', Boolean(lepekAdmin));
cek('§4 kodenya SAMA dengan BU asal', lepekAdmin?.kode, LEPEK.kode);
// Item yang lahir langsung dengan kode yang benar tidak pernah "berubah kode",
// jadi tidak boleh meninggalkan jejak perubahan apa pun.
cek('§4 item baru tidak punya kode lama', lepekAdmin?.kode_lama, null);

// ===============================================================
console.log('§5 Barang yang sama didata sendiri di BU lain');
// ===============================================================
//
// Bukan lewat transfer: staff BU Admin mengetik nama yang kebetulan sama
// dengan barang yang sudah didata BU lain. Itu barang yang sama, jadi kodenya
// harus sama — kalau tidak, kode pusatnya cuma berlaku untuk barang yang
// pernah ditransfer.
const hasilTambah = await satu(`select tambah_item_aset($1,'Piring Coklat Besar','Kitchen',null) as h`, [ADMINBU]);
const adminPiring = await satu(`select kode from asset_items where business_unit_id=$1 and name='Piring Coklat Besar'`, [ADMINBU]);
cek('§5 kodenya mengikuti BU yang sudah punya barangnya', adminPiring.kode, sesudah.cafePiring);
// ============ YANG DIKEMBALIKAN HARUS YANG TERSIMPAN ============
//
// Layar menampilkan kode dari jawaban RPC ini, dan kode yang salah di layar
// adalah kode yang terlanjur ditulis orang di bukunya. Sejak ada trigger,
// kode yang dihitung SEBELUM insert bukan lagi kode yang tersimpan.
cek('§5 `tambah_item_aset` mengembalikan kode yang benar-benar tersimpan', hasilTambah.h.kode, adminPiring.kode);

// ===============================================================
console.log('§6 Nomor baru bebas di SELURUH BU');
// ===============================================================
const baru = await satu(`select tambah_item_aset($1,'Teko Kuningan','Kitchen',null) as h`, [ADMINBU]);
const kodeBaru = baru.h.kode;
const dipakaiLain = await satu(
  `select count(*)::int n from asset_items
    where upper(btrim(kode)) = upper(btrim($1))
      and kunci_item_aset(name, category) <> kunci_item_aset('Teko Kuningan','Kitchen')`,
  [kodeBaru]
);
cek('§6 kode baru tidak dipakai barang lain di BU mana pun', dipakaiLain.n, 0);
benar('§6 kodenya tetap berprefix kategori', /^K\d+$/.test(kodeBaru), kodeBaru);

// ===============================================================
console.log('§7 Ganti nama: kodenya ikut');
// ===============================================================
const teko = await satu(`select id, kode from asset_items where business_unit_id=$1 and name='Teko Kuningan'`, [ADMINBU]);
await q(`update asset_items set name='Teko Kuningan Besar' where id=$1`, [teko.id]);
const kodePusat = await satu(`select kode from asset_kode_global where kunci = kunci_item_aset('Teko Kuningan Besar','Kitchen')`);
cek('§7 nama barunya menunjuk kode yang sama', kodePusat?.kode, teko.kode);
// Nama lamanya TIDAK dilepas: catatan yang memakai nama lama masih menunjuk
// ke kode yang sama, bukan ke tempat kosong.
const kodeLamaPusat = await satu(`select kode from asset_kode_global where kunci = kunci_item_aset('Teko Kuningan','Kitchen')`);
cek('§7 nama lamanya masih menunjuk kode yang sama', kodeLamaPusat?.kode, teko.kode);
// Nama tambahan tidak boleh ikut mengklaim kodenya sebagai miliknya — kalau
// ikut, indeks unik kode akan menolak nama tambahan kedua, dan penolakan itu
// terjadi di dalam trigger: ganti nama GAGAL tanpa sebab yang terbaca.
const utamaBerapa = await satu(`select count(*)::int n from asset_kode_global where upper(btrim(kode))=upper(btrim($1)) and utama`, [teko.kode]);
cek('§7 hanya satu nama yang memegang kode itu sebagai utama', utamaBerapa.n, 1);

// Diganti nama DUA kali: kalau nama tambahan ikut mengklaim kodenya, yang
// kedua ditolak indeks unik — dan penolakannya terjadi di dalam trigger, jadi
// yang terlihat orang cuma "gagal menyimpan nama".
const galatGanti = await galat(() => q(`update asset_items set name='Teko Kuningan Besar Sekali' where id=$1`, [teko.id]));
cek('§7 ganti nama kedua kalinya tidak gagal', galatGanti, null);
const kodeKetiga = await satu(`select kode from asset_kode_global where kunci = kunci_item_aset('Teko Kuningan Besar Sekali','Kitchen')`);
cek('§7 nama ketiga juga menunjuk kode yang sama', kodeKetiga?.kode, teko.kode);

// ===============================================================
console.log('§8 Bentrok di BU tujuan tidak merampas kode yang sudah ada');
// ===============================================================
//
// Keadaan yang tidak bisa dicegah selamanya: kode pusat sebuah barang ternyata
// SUDAH dipakai barang lain di BU tujuan (mis. karena kode itu disetel tangan,
// atau diwarisi dari sebelum 0180). Yang baru harus mengalah — merampas kode
// item yang sudah ada berarti mengubah kode yang mungkin sudah tertempel di
// barangnya.
const UJI = await satu(`select tambah_item_aset($1,'Panci Uji Bentrok','Kitchen',null) as h`, [CAFE]);
const kodeUji = UJI.h.kode;
const rakId = (await satu(`select id from asset_items where business_unit_id=$1 and name='Rak Besi Admin'`, [ADMINBU])).id;
// Disetel langsung ke tabel: triggernya ada di INSERT, jadi ini meniru kode
// yang sudah terlanjur begitu, bukan jalur yang dipakai aplikasi.
await q(`update asset_items set kode=$2 where id=$1`, [rakId, kodeUji]);

const ujiItem = (await satu(`select id from asset_items where business_unit_id=$1 and name='Panci Uji Bentrok'`, [CAFE])).id;
await q(`insert into asset_stock (asset_item_id, outlet_id, qty) values ($1,$2,9)`, [ujiItem, A]);
await satu(`select kirim_transfer_aset($1,$2,$3,$4,$5::jsonb,$6,$7) as h`, [
  A,
  C,
  null,
  'Pak Ahmad',
  JSON.stringify([{ item_id: ujiItem, qty: 9 }]),
  null,
  null
]);
const rakSesudah = await satu(`select kode from asset_items where id=$1`, [rakId]);
cek('§8 item yang sudah ada TIDAK kehilangan kodenya', rakSesudah.kode, kodeUji);
const panciAdmin = await satu(`select kode from asset_items where business_unit_id=$1 and name='Panci Uji Bentrok'`, [ADMINBU]);
benar('§8 item barunya tetap terbentuk', Boolean(panciAdmin), 'transfernya gagal diam-diam');
benar('§8 item barunya memakai kode lain', panciAdmin?.kode !== kodeUji, `dua barang kini berkode ${kodeUji}`);
const laporanBentrok = await satu(
  `select count(*)::int n from asset_kode_perubahan where nama='Panci Uji Bentrok' and bu_id=$1`,
  [ADMINBU]
);
// Tanpa laporan, satu-satunya tanda bahwa kodenya menyimpang adalah
// membandingkan dua layar BU secara manual.
cek('§8 penyimpangannya dilaporkan', laporanBentrok.n, 1);

// ===============================================================
console.log('§9 Dijalankan dua kali tetap aman');
// ===============================================================
const sebelumUlang = await semua(`select id, kode from asset_items order by id`);
const jejakSebelum = Number((await satu(`select count(*)::int n from asset_kode_perubahan`)).n);
await jalankan('0180_kode_aset_global.sql');
const sesudahUlang = await semua(`select id, kode from asset_items order by id`);
cek('§9 tidak ada kode yang berubah saat dijalankan ulang', sesudahUlang, sebelumUlang);
cek(
  '§9 tidak ada jejak palsu yang ditambahkan',
  Number((await satu(`select count(*)::int n from asset_kode_perubahan`)).n),
  jejakSebelum
);

// ---------------------------------------------------------------
console.log(`\n${gagal === 0 ? '✅' : '❌'} test-migrasi-0180: ${n - gagal}/${n} lulus`);
process.exit(gagal === 0 ? 0 : 1);
