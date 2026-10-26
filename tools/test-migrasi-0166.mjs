/**
 * 0166 — MASTER SPAREPART/JASA + PENJUALAN BENGKEL (PGlite — Postgres sungguhan).
 *
 *   §1 SKU unik per BU, dan dinormalkan.
 *   §2 Wewenang impor.
 *   §3 Impor: mana yang baru, mana yang ditimpa.
 *   §4 Impor TIDAK boleh merusak yang sudah benar.
 *   §5 Baris cacat dilewati, bukan menggagalkan seluruh berkas.
 *   §6 Omzet harian: satu baris per outlet per tanggal.
 *   §7 RLS: siapa boleh menulis apa.
 *   §8 Harga per outlet.
 *   §9 Dijalankan ulang.
 *
 * ============ YANG SEBENARNYA DIUJI DI SINI ============
 *
 * Bukan "apakah impor memasukkan 1.926 baris" — itu bagian yang mudah dan
 * terlihat. Yang diuji: apakah impor KEDUA merusak sesuatu yang sudah benar.
 * Berkas ESB dieskpor ulang tiap kali daftar harga berubah, jadi impor kedua,
 * ketiga, kesepuluh adalah keadaan NORMAL, bukan kasus pinggir.
 *
 * Tiga kerusakan yang tidak memunculkan galat apa pun dan baru ketahuan
 * berbulan-bulan kemudian saat seseorang menyebut harga yang salah ke
 * pelanggan:
 *
 *   - kolom harga yang kosong di berkas menimpa harga yang sudah benar
 *     dengan null ("tidak disebut" dibaca sebagai "gratis");
 *   - sparepart yang sengaja dinonaktifkan hidup lagi karena ikut terbawa;
 *   - jasa yang diketik admin sendiri hilang karena tidak ada di berkas.
 *
 * Ketiganya diuji di §4.
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
const q = (sql, params) => db.query(sql, params);
const satu = async (sql, params) => (await q(sql, params)).rows[0];
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
  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
  $$;

  create table business_units (id uuid primary key default gen_random_uuid(), name text, type text);
  create table outlets (id uuid primary key default gen_random_uuid(), business_unit_id uuid, name text);
  create table user_profiles (id uuid primary key, full_name text);
  create table membership_scopes (
    id uuid primary key default gen_random_uuid(),
    user_id uuid, business_unit_id uuid, outlet_id uuid, role text);
  create table modules (code text primary key, name text, description text);

  create or replace function is_bu_admin(p_uid uuid, p_bu uuid) returns boolean
    language sql security definer stable as $$
      select exists (select 1 from membership_scopes ms where ms.user_id = p_uid
        and (ms.role = 'super_admin' or (ms.business_unit_id = p_bu and ms.role = 'bu_admin'))) $$;

  create or replace function has_bu_scope(p_uid uuid, p_bu uuid) returns boolean
    language sql security definer stable as $$
      select exists (select 1 from membership_scopes ms where ms.user_id = p_uid
        and (ms.role = 'super_admin' or ms.business_unit_id = p_bu)) $$;

  create or replace function has_outlet_scope(p_uid uuid, p_outlet uuid) returns boolean
    language sql security definer stable as $$
      select exists (
        select 1 from membership_scopes ms join outlets o on o.id = p_outlet
         where ms.user_id = p_uid
           and (ms.role = 'super_admin'
                or (ms.business_unit_id = o.business_unit_id and ms.role = 'bu_admin')
                or ms.outlet_id = p_outlet)) $$;
`);

const SQL = fs.readFileSync(path.join(AKAR, 'supabase/migrations/0166_sparepart_dan_penjualan_bengkel.sql'), 'utf8');
await db.exec(SQL.replace(/notify pgrst[^;]*;/g, ''));

// 0167 DIPASANG DI ATAS 0166, bukan menggantikannya.
//
// Itu bentuk yang sebenarnya dijalankan di Supabase: 0166 sudah terlanjur
// jalan di database sungguhan. Menguji 0167 sendirian akan menguji migrasi
// yang tidak pernah ada — dan melewatkan satu-satunya bagian yang berisiko,
// yaitu perpindahan `harga_jual` jadi `harga_jual`.
const SQL167 = fs.readFileSync(path.join(AKAR, 'supabase/migrations/0167_sparepart_harga_beli_dan_jual.sql'), 'utf8');
await db.exec(SQL167.replace(/notify pgrst[^;]*;/g, ''));
console.log('  0166 + 0167 terpasang.');

// ---------------------------------------------------------------
const BENGKEL = (await satu(`insert into business_units (name, type) values ('Otonix Bengkel','workshop') returning id`)).id;
const BENGKEL2 = (await satu(`insert into business_units (name, type) values ('Otonix Bengkel Dua','workshop') returning id`)).id;
const DEPOK = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Otonix Depok') returning id`, [BENGKEL])).id;
const BOGOR = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Otonix Bogor') returning id`, [BENGKEL])).id;

const ADMIN = '11111111-1111-1111-1111-111111111111';
const STAFF_DEPOK = '22222222-2222-2222-2222-222222222222';
const STAFF_BOGOR = '33333333-3333-3333-3333-333333333333';
const ORANG_LUAR = '44444444-4444-4444-4444-444444444444';
await q(
  `insert into user_profiles (id, full_name) values ($1,'Admin Bengkel'),($2,'Staff Depok'),($3,'Staff Bogor'),($4,'Orang Luar')`,
  [ADMIN, STAFF_DEPOK, STAFF_BOGOR, ORANG_LUAR]
);
await q(
  `insert into membership_scopes (user_id, business_unit_id, outlet_id, role) values
     ($1,$5,null,'bu_admin'), ($2,$5,$6,'staff'), ($3,$5,$7,'staff'), ($4,$8,null,'bu_admin')`,
  [ADMIN, STAFF_DEPOK, STAFF_BOGOR, ORANG_LUAR, BENGKEL, DEPOK, BOGOR, BENGKEL2]
);

/**
 * jsonb MENGURUTKAN ULANG kunci objek, jadi membandingkan hasil impor sebagai
 * JSON apa adanya akan merah walaupun angkanya benar. Yang diuji angkanya.
 */
const hitungan = (h) => [Number(h.baru), Number(h.diperbarui), Number(h.dilewati)];

const impor = (bu, rows, uid = ADMIN) =>
  sebagai(uid).then(() => satu(`select impor_sparepart($1, $2::jsonb) as h`, [bu, JSON.stringify(rows)]));

const ambilSku = (bu, sku) =>
  satu(`select * from spareparts where business_unit_id = $1 and upper(btrim(sku)) = upper(btrim($2))`, [bu, sku]);

// ===============================================================
console.log('\n§1 SKU unik per BU, dan dinormalkan');
// ===============================================================
await q(
  `insert into spareparts (business_unit_id, sku, name, harga_jual) values ($1,'555.LTR.BZ120','RACK END 555',455000)`,
  [BENGKEL]
);

// Dua SKU yang di mata orang SAMA: beda huruf besar-kecil, dan ada spasi
// pinggir. Membiarkan keduanya masuk menghasilkan persis "double SKU" yang
// tabel ini ada untuk mencegah — dan dua harga berbeda untuk satu barang.
const eHuruf = await galat(() =>
  q(`insert into spareparts (business_unit_id, sku, name) values ($1,'555.ltr.bz120','RACK END lain')`, [BENGKEL])
);
benar('§1 SKU beda huruf besar-kecil ditolak', /unique|duplicate/i.test(eHuruf ?? ''), eHuruf ?? 'malah masuk');

const eSpasi = await galat(() =>
  q(`insert into spareparts (business_unit_id, sku, name) values ($1,'  555.LTR.BZ120  ','RACK END lain')`, [BENGKEL])
);
benar('§1 SKU dengan spasi pinggir ditolak', /unique|duplicate/i.test(eSpasi ?? ''), eSpasi ?? 'malah masuk');

// Tapi BU yang berbeda adalah daftar yang berbeda. Unik "global" akan membuat
// bengkel kedua tidak bisa memakai kode supplier yang sama.
const eBuLain = await galat(() =>
  q(`insert into spareparts (business_unit_id, sku, name) values ($1,'555.LTR.BZ120','RACK END 555')`, [BENGKEL2])
);
cek('§1 SKU sama di BU lain diizinkan', eBuLain, null);

const eJenis = await galat(() =>
  q(`insert into spareparts (business_unit_id, sku, name, jenis) values ($1,'X1','X','bahan')`, [BENGKEL])
);
benar('§1 jenis selain sparepart/jasa ditolak', /check|violat/i.test(eJenis ?? ''), eJenis ?? 'malah masuk');

const eHarga = await galat(() =>
  q(`insert into spareparts (business_unit_id, sku, name, harga_jual) values ($1,'X2','X',-1)`, [BENGKEL])
);
benar('§1 harga negatif ditolak', /check|violat/i.test(eHarga ?? ''), eHarga ?? 'malah masuk');

cek(
  '§1 modul terdaftar',
  (await q(`select code from modules where code in ('sparepart','penjualan_bengkel') order by code`)).rows.map((r) => r.code),
  ['penjualan_bengkel', 'sparepart']
);

await q(`delete from spareparts`);

// ===============================================================
console.log('\n§2 Wewenang impor');
// ===============================================================
// Kosongkan klaimnya sungguh-sungguh. UUID nol adalah UUID yang SAH, jadi
// memakainya di sini membuat `auth.uid() is null` tidak pernah tersentuh dan
// penjaga "harus login" lolos uji tanpa pernah diuji.
await q(`select set_config('request.jwt.claim.sub', '', false)`);
const eAnon = await galat(() => q(`select impor_sparepart($1, '[]'::jsonb)`, [BENGKEL]));
benar('§2 belum login ditolak', /harus login/i.test(eAnon ?? ''), eAnon ?? 'malah jalan');

const eStaff = await galat(() => impor(BENGKEL, [{ sku: 'A1', name: 'A' }], STAFF_DEPOK));
benar('§2 staff outlet ditolak', /admin bu/i.test(eStaff ?? ''), eStaff ?? 'malah jalan');

// Admin BU lain. Ini yang paling mudah terlewat: wewenangnya nyata, cuma di
// BU yang salah — dan kalau lolos, dia menimpa master BU orang lain.
const eLuar = await galat(() => impor(BENGKEL, [{ sku: 'A1', name: 'A' }], ORANG_LUAR));
benar('§2 admin BU lain ditolak', /admin bu/i.test(eLuar ?? ''), eLuar ?? 'malah jalan');

const eKosong = await galat(() => impor(BENGKEL, []));
benar('§2 berkas kosong ditolak', /tidak ada baris/i.test(eKosong ?? ''), eKosong ?? 'malah jalan');

// ===============================================================
console.log('\n§3 Impor: mana yang baru, mana yang ditimpa');
// ===============================================================
const h1 = (
  await impor(BENGKEL, [
    { sku: '555.LTR.BZ120', name: 'RACK END 555 45503-BZ120 L/R', kategori: 'PART RODA', merek: '555 JP', harga_jual: 455000, harga_beli: 350000 },
    { sku: 'OLI.SHELL.10W40', name: 'SHELL HELIX HX5 10W-40', kategori: 'OLI', merek: 'SHELL', harga_jual: 95000, harga_beli: 70000 }
  ])
).h;
cek('§3 impor pertama semuanya baru [baru,diperbarui,dilewati]', hitungan(h1), [2, 0, 0]);

// Impor kedua: SKU yang SAMA tapi ditulis huruf kecil dengan spasi — persis
// seperti yang keluar dari berkas yang diketik ulang orang. Kalau pencocokan
// tidak dinormalkan, ini jadi baris KEDUA, dan dua harga hidup bersamaan.
const h2 = (
  await impor(BENGKEL, [
    { sku: ' 555.ltr.bz120 ', name: 'RACK END 555 (NAMA BARU)', kategori: 'PART KAKI-KAKI', merek: '555 JP', harga_jual: 475000 },
    { sku: 'BAN.GT.18565', name: 'GT RADIAL 185/65 R15', kategori: 'BAN', merek: 'GT', harga_jual: 720000 }
  ])
).h;
cek('§3 impor kedua: satu ditimpa, satu baru', hitungan(h2), [1, 1, 0]);
cek('§3 total baris tetap 3, tidak ada double SKU', Number((await satu(`select count(*) c from spareparts`)).c), 3);

const rack = await ambilSku(BENGKEL, '555.LTR.BZ120');
cek('§3 nama lama tertimpa nama baru', rack.name, 'RACK END 555 (NAMA BARU)');
cek('§3 kategori ikut tertimpa', rack.kategori, 'PART KAKI-KAKI');
cek('§3 harga ikut tertimpa', Number(rack.harga_jual), 475000);
cek('§3 SKU disimpan sudah ternormalkan', rack.sku, '555.LTR.BZ120');
benar('§3 penanda asal impor terpasang', rack.dari_impor === true);
benar('§3 jejak siapa yang memperbarui tersimpan', rack.diperbarui_by === ADMIN, String(rack.diperbarui_by));

// ===============================================================
console.log('\n§4 Impor TIDAK boleh merusak yang sudah benar');
// ===============================================================

// (a) Kolom harga KOSONG di berkas. "Tidak disebut", bukan "gratis".
await impor(BENGKEL, [{ sku: 'OLI.SHELL.10W40', name: 'SHELL HELIX HX5 10W-40', kategori: 'OLI' }]);
const oli = await ambilSku(BENGKEL, 'OLI.SHELL.10W40');
cek('§4a harga kosong TIDAK menghapus harga lama', Number(oli.harga_jual), 95000);

await impor(BENGKEL, [{ sku: 'OLI.SHELL.10W40', name: 'SHELL HELIX HX5 10W-40', harga_jual: '' }]);
cek(
  '§4a harga string kosong juga TIDAK menghapus',
  Number((await ambilSku(BENGKEL, 'OLI.SHELL.10W40')).harga_jual),
  95000
);

// (b) Sparepart yang SENGAJA dinonaktifkan admin. Berkas ESB masih memuatnya
//     karena ESB tidak tahu keputusan itu.
await q(`update spareparts set is_active = false where business_unit_id = $1 and sku = 'BAN.GT.18565'`, [BENGKEL]);
await impor(BENGKEL, [{ sku: 'BAN.GT.18565', name: 'GT RADIAL 185/65 R15', harga_jual: 740000 }]);
const ban = await ambilSku(BENGKEL, 'BAN.GT.18565');
benar('§4b yang dinonaktifkan tetap nonaktif sesudah impor', ban.is_active === false);
cek('§4b tapi harganya tetap ikut diperbarui', Number(ban.harga_jual), 740000);

// (c) Jasa yang diketik admin sendiri. Berkas ESB TIDAK memuat satu pun jasa
//     (dibuktikan dari berkas sungguhan: 0 baris jasa), jadi impor yang
//     "membersihkan yang tidak ada di berkas" akan menghapus seluruh daftar
//     jasa tanpa ada yang menyadarinya.
await q(
  `insert into spareparts (business_unit_id, sku, name, jenis, harga_jual, dibuat_by)
   values ($1,'JASA.TUNE','Tune Up Mesin','jasa',350000,$2)`,
  [BENGKEL, ADMIN]
);
await impor(BENGKEL, [
  { sku: '555.LTR.BZ120', name: 'RACK END 555', harga_jual: 480000 },
  { sku: 'OLI.SHELL.10W40', name: 'SHELL HELIX HX5 10W-40', harga_jual: 99000 }
]);
const jasa = await ambilSku(BENGKEL, 'JASA.TUNE');
benar('§4c jasa manual TIDAK hilang sesudah impor', !!jasa, 'jasa terhapus oleh impor');
cek('§4c jasa manual tetap jenis jasa', jasa?.jenis, 'jasa');
cek('§4c harga jasa manual utuh', Number(jasa?.harga_jual), 350000);
benar('§4c jasa manual tidak dicap sebagai hasil impor', jasa?.dari_impor === false);

// (d) JENIS yang sudah dibetulkan admin tidak dikembalikan oleh impor.
//
// Berkas ESB tidak punya kolom "ini jasa atau barang", jadi jenisnya ditebak
// dari kata di namanya — tebakan yang salah ke dua arah. Admin membetulkan
// satu baris dengan tangan; impor berikutnya tidak boleh menebak ulang di
// atasnya, karena yang dibetulkan akan kembali salah tanpa galat dan tanpa
// jejak, dan orang yang membetulkannya tidak akan tahu.
await q(`update spareparts set jenis = 'jasa' where business_unit_id = $1 and sku = '555.LTR.BZ120'`, [BENGKEL]);
await impor(BENGKEL, [{ sku: '555.LTR.BZ120', name: 'RACK END 555', jenis: 'sparepart', harga_jual: 480000 }]);
cek('§4d jenis yang dibetulkan admin TIDAK ditimpa impor', (await ambilSku(BENGKEL, '555.LTR.BZ120')).jenis, 'jasa');
cek(
  '§4d tapi harga & nama tetap ikut diperbarui',
  Number((await ambilSku(BENGKEL, '555.LTR.BZ120')).harga_jual),
  480000
);
await q(`update spareparts set jenis = 'sparepart' where business_unit_id = $1 and sku = '555.LTR.BZ120'`, [BENGKEL]);

// (e) Impor tidak merembes ke BU lain.
await impor(BENGKEL2, [{ sku: '555.LTR.BZ120', name: 'PUNYA BENGKEL DUA', harga_jual: 1 }], ORANG_LUAR);
cek(
  '§4e impor BU lain tidak mengubah BU pertama',
  Number((await ambilSku(BENGKEL, '555.LTR.BZ120')).harga_jual),
  480000
);

// ===============================================================
console.log('\n§5 Baris cacat dilewati, bukan menggagalkan seluruh berkas');
// ===============================================================

// Berkas 1.926 baris yang gagal total gara-gara satu baris kosong di tengah
// memaksa orang membersihkan berkas dengan tangan. Yang cacat dilewati dan
// DILAPORKAN jumlahnya, supaya orang tahu ada yang tidak masuk.
const h5 = (
  await impor(BENGKEL, [
    { sku: 'BARU.1', name: 'Barang Baru Satu', harga_jual: 10000 },
    { sku: '', name: 'Tanpa SKU', harga_jual: 5000 },
    { sku: '   ', name: 'SKU cuma spasi', harga_jual: 5000 },
    { sku: 'BARU.2', name: '', harga_jual: 5000 },
    { sku: 'BARU.3', name: '   ', harga_jual: 5000 },
    { sku: 'BARU.4', name: 'Barang Baru Empat', harga_jual: -99 },
    { sku: 'BARU.5', name: 'Jenis ngawur', jenis: 'bahan', harga_jual: 1000 }
  ])
).h;
cek('§5 cacat dilewati dan dilaporkan', hitungan(h5), [3, 0, 4]);
benar('§5 baris tanpa SKU tidak masuk', !(await ambilSku(BENGKEL, 'BARU.2')));
cek('§5 harga negatif jadi kosong, bukan negatif', (await ambilSku(BENGKEL, 'BARU.4')).harga_jual, null);
cek('§5 jenis ngawur jadi sparepart, bukan gagal', (await ambilSku(BENGKEL, 'BARU.5')).jenis, 'sparepart');

// ===============================================================
console.log('\n§6 Omzet harian: satu baris per outlet per tanggal');
// ===============================================================
await sebagai(STAFF_DEPOK);
await q(
  `insert into bengkel_sales (business_unit_id, outlet_id, sale_date, omzet_sparepart, omzet_jasa, dilapor_by)
   values ($1,$2,'2026-10-26',4500000,1200000,$3)`,
  [BENGKEL, DEPOK, STAFF_DEPOK]
);

// Staff menekan Simpan dua kali, atau dua staff di satu outlet melapor. Tanpa
// penjaga ini, omzet hari itu terhitung DUA KALI — laporannya tetap tercetak
// rapi, dan selisihnya baru ketahuan saat dicocokkan dengan setoran kas.
const eGanda = await galat(() =>
  q(
    `insert into bengkel_sales (business_unit_id, outlet_id, sale_date, omzet_sparepart, dilapor_by) values ($1,$2,'2026-10-26',9000000,$3)`,
    [BENGKEL, DEPOK, STAFF_DEPOK]
  )
);
benar('§6 laporan ganda hari sama ditolak', /unique|duplicate/i.test(eGanda ?? ''), eGanda ?? 'malah masuk');

const eOutletLain = await galat(() =>
  q(
    `insert into bengkel_sales (business_unit_id, outlet_id, sale_date, omzet_sparepart, dilapor_by) values ($1,$2,'2026-10-26',1,$3)`,
    [BENGKEL, BOGOR, STAFF_BOGOR]
  )
);
cek('§6 outlet lain di tanggal sama boleh', eOutletLain, null);

const eNegatif = await galat(() =>
  q(`insert into bengkel_sales (business_unit_id, outlet_id, sale_date, omzet_jasa) values ($1,$2,'2026-10-27',-1)`, [
    BENGKEL,
    DEPOK
  ])
);
benar('§6 omzet negatif ditolak', /check|violat/i.test(eNegatif ?? ''), eNegatif ?? 'malah masuk');

// Hari tanpa penjualan sparepart tetap sah: bengkel bisa seharian cuma jasa.
const eNol = await galat(() =>
  q(
    `insert into bengkel_sales (business_unit_id, outlet_id, sale_date, omzet_sparepart, omzet_jasa) values ($1,$2,'2026-10-27',0,250000)`,
    [BENGKEL, DEPOK]
  )
);
cek('§6 hari tanpa sparepart (hanya jasa) sah', eNol, null);

// ===============================================================
console.log('\n§7 RLS: siapa boleh menulis apa');
// ===============================================================
await db.exec(`
  grant usage on schema public to authenticated;
  grant all on all tables in schema public to authenticated;
`);
/** Jalankan `fn` sebagai `uid` DENGAN RLS hidup; kembalikan pesan galat / null. */
const sbg = async (uid, fn) => {
  await db.exec(`set role authenticated`);
  await sebagai(uid);
  const r = await galat(fn);
  await db.exec(`reset role`);
  return r;
};

// `galat()` membuang nilai kembalian — berguna untuk menguji penolakan, tapi
// tidak bisa dipakai membaca. Pembaca butuh jalurnya sendiri, kalau tidak
// setiap hitungan terbaca `null` dan ujinya merah karena alasan yang salah.
const bacaSbg = async (uid, sql, params) => {
  await db.exec(`set role authenticated`);
  await sebagai(uid);
  try {
    return (await q(sql, params)).rows[0];
  } finally {
    await db.exec(`reset role`);
  }
};

const eStaffMaster = await sbg(STAFF_DEPOK, () =>
  q(`insert into spareparts (business_unit_id, sku, name) values ($1,'SELUNDUP','Diselundupkan staff')`, [BENGKEL])
);
benar('§7 staff tidak boleh menulis master sparepart', /policy|row-level/i.test(eStaffMaster ?? ''), eStaffMaster ?? 'malah masuk');

const bisaBaca = await bacaSbg(STAFF_DEPOK, `select count(*) c from spareparts where business_unit_id = $1`, [BENGKEL]);
benar('§7 staff tetap boleh MEMBACA master (untuk menyebut harga)', Number(bisaBaca?.c) > 0, JSON.stringify(bisaBaca));

const bacaBuLain = await bacaSbg(STAFF_DEPOK, `select count(*) c from spareparts where business_unit_id = $1`, [BENGKEL2]);
cek('§7 staff tidak melihat master BU lain', Number(bacaBuLain?.c), 0);

const eStaffOutletLain = await sbg(STAFF_DEPOK, () =>
  q(
    `insert into bengkel_sales (business_unit_id, outlet_id, sale_date, omzet_jasa) values ($1,$2,'2026-11-01',1000)`,
    [BENGKEL, BOGOR]
  )
);
benar(
  '§7 staff tidak boleh melapor omzet outlet lain',
  /policy|row-level/i.test(eStaffOutletLain ?? ''),
  eStaffOutletLain ?? 'malah masuk'
);

const eStaffSendiri = await sbg(STAFF_DEPOK, () =>
  q(
    `insert into bengkel_sales (business_unit_id, outlet_id, sale_date, omzet_jasa) values ($1,$2,'2026-11-01',1000)`,
    [BENGKEL, DEPOK]
  )
);
cek('§7 staff boleh melapor omzet outletnya sendiri', eStaffSendiri, null);

const eStaffHapus = await sbg(STAFF_DEPOK, () =>
  q(`delete from bengkel_sales where outlet_id = $1 and sale_date = '2026-11-01'`, [DEPOK])
);
cek(
  '§7 staff tidak bisa menghapus laporannya (hanya admin)',
  Number((await satu(`select count(*) c from bengkel_sales where outlet_id=$1 and sale_date='2026-11-01'`, [DEPOK])).c),
  1
);
benar('§7 hapus oleh staff tidak melempar galat palsu', eStaffHapus === null, String(eStaffHapus));

const eAdminHapus = await sbg(ADMIN, () =>
  q(`delete from bengkel_sales where outlet_id = $1 and sale_date = '2026-11-01'`, [DEPOK])
);
cek(
  '§7 admin BU bisa menghapus',
  Number((await satu(`select count(*) c from bengkel_sales where outlet_id=$1 and sale_date='2026-11-01'`, [DEPOK])).c),
  0
);
benar('§7 hapus oleh admin tanpa galat', eAdminHapus === null, String(eAdminHapus));

// ===============================================================
console.log('\n§8 Harga per outlet');
// ===============================================================
const idOli = (await ambilSku(BENGKEL, 'OLI.SHELL.10W40')).id;
await q(`insert into sparepart_outlet_prices (sparepart_id, outlet_id, harga_jual) values ($1,$2,110000)`, [idOli, DEPOK]);

const ePasangan = await galat(() =>
  q(`insert into sparepart_outlet_prices (sparepart_id, outlet_id, harga_jual) values ($1,$2,120000)`, [idOli, DEPOK])
);
benar('§8 dua harga untuk satu pasangan ditolak', /unique|duplicate/i.test(ePasangan ?? ''), ePasangan ?? 'malah masuk');

const eOutletKedua = await galat(() =>
  q(`insert into sparepart_outlet_prices (sparepart_id, outlet_id, harga_jual) values ($1,$2,105000)`, [idOli, BOGOR])
);
cek('§8 outlet kedua boleh harga sendiri', eOutletKedua, null);

// Impor memperbarui harga DASAR; harga outlet yang sudah ditetapkan tidak
// boleh ikut tergeser, karena itu keputusan outlet, bukan isi berkas.
await impor(BENGKEL, [{ sku: 'OLI.SHELL.10W40', name: 'SHELL HELIX HX5 10W-40', harga_jual: 130000 }]);
cek(
  '§8 impor tidak menggeser harga outlet',
  Number((await satu(`select harga_jual from sparepart_outlet_prices where sparepart_id=$1 and outlet_id=$2`, [idOli, DEPOK])).harga_jual),
  110000
);
cek('§8 tapi harga dasar ikut diperbarui', Number((await ambilSku(BENGKEL, 'OLI.SHELL.10W40')).harga_jual), 130000);

// Sparepart dihapus → harga outletnya ikut, tidak jadi baris menggantung.
await q(`delete from spareparts where id = $1`, [idOli]);
cek(
  '§8 harga outlet ikut terhapus bersama sparepartnya',
  Number((await satu(`select count(*) c from sparepart_outlet_prices where sparepart_id=$1`, [idOli])).c),
  0
);

// ===============================================================
console.log('\n§9 0167: DUA harga, sekali impor');
// ===============================================================

// ============ YANG DIPERBAIKI 0167 ============
//
// 0166 menyimpan SATU harga dan menyuruh orang memilih kolomnya. Salah pilih
// sekali menimpa seluruh harga jual dengan harga beli — 1.926 baris, tanpa
// galat, dan tidak ada apa pun di dalam datanya yang bisa dipakai membedakan
// mana yang benar sesudahnya.
const h9 = (
  await impor(BENGKEL, [
    { sku: 'DUA.HARGA', name: 'Kampas Rem Depan', kategori: 'PART REM', harga_beli: 120000, harga_jual: 185000 }
  ])
).h;
cek('§9 satu baris baru', hitungan(h9), [1, 0, 0]);
const dua = await ambilSku(BENGKEL, 'DUA.HARGA');
cek('§9 harga beli masuk', Number(dua.harga_beli), 120000);
cek('§9 harga jual masuk', Number(dua.harga_jual), 185000);
benar('§9 dan keduanya tidak tertukar', Number(dua.harga_beli) < Number(dua.harga_jual));

// Impor berikutnya menyebut harga jual saja. Harga BELI yang sudah benar
// tidak boleh ikut terhapus — sel yang tidak disebut berarti "tidak disebut".
await impor(BENGKEL, [{ sku: 'DUA.HARGA', name: 'Kampas Rem Depan', harga_jual: 195000 }]);
const dua2 = await ambilSku(BENGKEL, 'DUA.HARGA');
cek('§9 harga jual diperbarui', Number(dua2.harga_jual), 195000);
cek('§9 harga beli TIDAK ikut terhapus', Number(dua2.harga_beli), 120000);

// Dan sebaliknya.
await impor(BENGKEL, [{ sku: 'DUA.HARGA', name: 'Kampas Rem Depan', harga_beli: 125000 }]);
const dua3 = await ambilSku(BENGKEL, 'DUA.HARGA');
cek('§9 harga beli diperbarui', Number(dua3.harga_beli), 125000);
cek('§9 harga jual TIDAK ikut terhapus', Number(dua3.harga_jual), 195000);

// Harga negatif di salah satu kolom tidak boleh menjatuhkan kolom sebelahnya.
await impor(BENGKEL, [{ sku: 'DUA.HARGA', name: 'Kampas Rem Depan', harga_beli: -1, harga_jual: 200000 }]);
const dua4 = await ambilSku(BENGKEL, 'DUA.HARGA');
cek('§9 harga jual tetap masuk walau harga beli ngawur', Number(dua4.harga_jual), 200000);
cek('§9 harga beli ngawur tidak merusak yang lama', Number(dua4.harga_beli), 125000);

// Harga per outlet juga dua, dan boleh salah satu saja: outlet yang cuma
// berbeda harga jualnya tidak boleh dipaksa mengarang harga beli.
const idDua = dua4.id;
const eJualSaja = await galat(() =>
  q(`insert into sparepart_outlet_prices (sparepart_id, outlet_id, harga_jual) values ($1,$2,210000)`, [idDua, BOGOR])
);
cek('§9 harga outlet boleh berisi harga jual saja', eJualSaja, null);
cek(
  '§9 harga belinya null, bukan nol',
  (await satu(`select harga_beli from sparepart_outlet_prices where sparepart_id=$1 and outlet_id=$2`, [idDua, BOGOR]))
    .harga_beli,
  null
);

// ===============================================================
console.log('\n§10 Dijalankan ulang');
// ===============================================================
const sebelum = Number((await satu(`select count(*) c from spareparts`)).c);
const eUlang = await galat(async () => {
  await db.exec(SQL.replace(/notify pgrst[^;]*;/g, ''));
  // 0167 juga, berurutan — itu yang terjadi kalau seseorang menjalankan
  // ulang seluruh folder migrasi. Perpindahan `harga_dasar` -> `harga_jual`
  // harus tahan dijalankan dua kali; `rename column` tidak punya IF EXISTS.
  await db.exec(SQL167.replace(/notify pgrst[^;]*;/g, ''));
});
cek('§10 migrasi bisa dijalankan dua kali', eUlang, null);
cek('§10 data tidak hilang saat dijalankan ulang', Number((await satu(`select count(*) c from spareparts`)).c), sebelum);
cek(
  '§10 modul tidak terduplikasi',
  Number((await satu(`select count(*) c from modules where code = 'sparepart'`)).c),
  1
);

// ---------------------------------------------------------------
console.log(`\n${gagal === 0 ? '✅' : '❌'} test-migrasi-0166: ${n - gagal}/${n} lulus`);
process.exit(gagal === 0 ? 0 : 1);
