/**
 * 0161 — HAPUS SUPPLIER (PGlite — Postgres sungguhan).
 *
 *   §1 Supplier yang belum dipakai: terhapus.
 *   §2 Dipakai NOTA -> ditolak, dan kalimatnya menyebut jumlah + jalan keluar.
 *   §3 Disebut ENTRI KAS (teks, bukan FK) -> ditolak juga.
 *   §4 Ejaan berbeda tipis di kas tetap tertangkap (ternormalkan).
 *   §5 Wewenang: bukan Admin BU ditolak.
 *   §6 `delete` LANGSUNG tidak bisa melewati penjaganya.
 *   §7 Dijalankan ulang.
 *   §8 Dokumen yang DIBATALKAN tidak menahan (0162).
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
    return e.message ?? String(e);
  }
};

await db.exec(`
  create schema if not exists auth;
  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
  $$;
  create role authenticated;

  create table business_units (id uuid primary key default gen_random_uuid(), name text);
  create table outlets (id uuid primary key default gen_random_uuid(), business_unit_id uuid, name text);
  create table user_profiles (id uuid primary key, full_name text);
  create table membership_scopes (user_id uuid, business_unit_id uuid, outlet_id uuid, role text);
  create table esb_master (
    id uuid primary key default gen_random_uuid(),
    business_unit_id uuid, jenis text, kode text, nama text
  );
  create table goods_receipts (
    id uuid primary key default gen_random_uuid(),
    business_unit_id uuid, code text, supplier text, status text default 'aktif'
  );
  create table cash_entries (
    id uuid primary key default gen_random_uuid(),
    business_unit_id uuid, entry_type text, supplier text,
    -- Bentuk pembatalan sisi kas (0141). Seluruh pembaca kas menyaring
    -- dicoret_at is null; 0161 tidak, dan 0162 yang membetulkannya.
    --
    -- Ditulis TANPA backtick: ini di dalam template literal JS, dan satu
    -- backtick di sini mengakhirinya. Persis jebakan yang baru saja memakan
    -- layar Ekspor ESB.
    dicoret_at timestamptz
  );

  create or replace function has_bu_scope(p_uid uuid, p_bu uuid) returns boolean language sql stable as $$
    select exists (select 1 from membership_scopes where user_id = p_uid and business_unit_id = p_bu);
  $$;
  create or replace function is_bu_admin(p_uid uuid, p_bu uuid) returns boolean language sql stable as $$
    select exists (select 1 from membership_scopes where user_id = p_uid and business_unit_id = p_bu and role in ('bu_admin','super_admin'));
  $$;
`);

const BU = (await satu(`insert into business_units (name) values ('Cafe') returning id`)).id;
const STAFF = '11111111-1111-1111-1111-111111111111';
const ADMIN = '22222222-2222-2222-2222-222222222222';
await q(`insert into user_profiles (id, full_name) values ($1,'Staff'),($2,'Admin')`, [STAFF, ADMIN]);
await q(`insert into membership_scopes (user_id, business_unit_id, role) values ($1,$3,'staff'), ($2,$3,'bu_admin')`, [
  STAFF,
  ADMIN,
  BU
]);

const pasang = async (rel) => {
  const sql = fs.readFileSync(path.join(AKAR, `supabase/migrations/${rel}`), 'utf8');
  await db.exec(sql.replace(/notify pgrst[^;]*;/g, ''));
  return sql;
};
await pasang('0158_master_supplier.sql');
await pasang('0159_penerima_bukan_supplier.sql');
const SQL161 = await pasang('0161_hapus_supplier.sql');
// 0162 menulis ulang `hapus_supplier` supaya hanya menghitung dokumen AKTIF.
// Dipasang di sini supaya seluruh pemeriksaan di bawah menguji versi yang
// benar-benar berjalan di produksi — bukan versi perantara.
const SQL162 = await pasang('0162_hapus_supplier_hanya_hitung_yang_aktif.sql');
console.log('  0158 + 0159 + 0161 + 0162 terpasang.');

await sebagai(ADMIN);
const sup = (nama) =>
  satu(`select * from suppliers where business_unit_id=$1 and normal_nama_supplier(nama)=normal_nama_supplier($2)`, [BU, nama]);
const buat = async (nama) => (await satu(`select tambah_supplier($1,$2) id`, [BU, nama])).id;

// =====================================================================
// §1 YANG BELUM DIPAKAI
// =====================================================================
console.log('\n§1 Supplier yang belum dipakai');

const polos = await buat('Toko Sekali Pakai');
benar('1. (persiapan) terbuat', !!(await sup('Toko Sekali Pakai')));
const e1 = await galat(() => q(`select hapus_supplier($1)`, [polos]));
benar('1. INTI: yang belum dipakai boleh dihapus', !e1, e1);
cek('1. dan barisnya benar-benar hilang', await sup('Toko Sekali Pakai'), undefined);

// =====================================================================
// §2 DIPAKAI NOTA
// =====================================================================
console.log('\n§2 Dipakai nota');

await q(`insert into goods_receipts (business_unit_id, code, supplier) values ($1,'NT-1','Toko Berkah')`, [BU]);
await q(`insert into goods_receipts (business_unit_id, code, supplier) values ($1,'NT-2','Toko Berkah')`, [BU]);
const berkah = await sup('Toko Berkah');
cek('2. (persiapan) dua nota menunjuknya', Number((await satu(`select count(*) n from goods_receipts where supplier_id=$1`, [berkah.id])).n), 2);

const e2 = await galat(() => q(`select hapus_supplier($1)`, [berkah.id]));
benar('2. INTI: ditolak', !!e2, 'TERHAPUS, padahal dipakai nota');
benar('2. kalimatnya menyebut JUMLAH notanya', /2 nota/.test(e2 ?? ''), e2);
// Pesan yang cuma berbunyi "tidak bisa dihapus" meninggalkan orangnya di
// tempat yang sama persis. Jalan keluarnya harus disebut.
benar('2. INTI: dan menyebut jalan keluarnya (Gabungkan / nonaktifkan)', /Gabungkan/i.test(e2 ?? '') && /nonaktif/i.test(e2 ?? ''), e2);
cek('2. barisnya tetap ada', !!(await sup('Toko Berkah')), true);
cek(
  '2. dan notanya tidak kehilangan induknya',
  Number((await satu(`select count(*) n from goods_receipts where supplier_id=$1`, [berkah.id])).n),
  2
);

// =====================================================================
// §3 DISEBUT ENTRI KAS
// =====================================================================
console.log('\n§3 Disebut entri kas');

// ============ KENAPA INI JALUR YANG TERPISAH ============
//
// `cash_entries.supplier` adalah TEKS, bukan FK (0149). Database tidak tahu
// hubungannya sama sekali, jadi menghapus "Kas Operasional" tidak akan
// menyentuh satu pun baris kas — dan tidak ada galat di mana pun. Yang rusak
// baru terasa di form: nilai yang sudah tersimpan di entri lama jadi tidak sah,
// dan membetulkan satu huruf di keterangannya jadi mustahil.
const kasOp = await sup('Kas Operasional');
benar('3. (persiapan) penerima internal bawaan ada', !!kasOp);
await q(`insert into cash_entries (business_unit_id, entry_type, supplier) values ($1,'out','Kas Operasional')`, [BU]);

const e3 = await galat(() => q(`select hapus_supplier($1)`, [kasOp.id]));
benar('3. INTI: ditolak walau tidak ada satu pun nota', !!e3, 'TERHAPUS, padahal dipakai entri kas');
benar('3. kalimatnya menyebut jumlah entri kasnya', /1 entri kas/.test(e3 ?? ''), e3);
benar('3. dan menyebut nol notanya apa adanya', /0 nota/.test(e3 ?? ''), e3);

// =====================================================================
// §4 EJAAN BERBEDA TIPIS DI KAS
// =====================================================================
console.log('\n§4 Ejaan berbeda tipis');

// Entri kas lama ditulis sebelum daftarnya ada, jadi ejaannya bisa berbeda
// spasi/huruf. Perbandingan `=` biasa akan melewatkannya — dan penjaga ini
// lalu meloloskan penghapusan yang justru paling merusak.
const pasar = await buat('Pasar Induk');
await q(`insert into cash_entries (business_unit_id, entry_type, supplier) values ($1,'out','pasar  induk')`, [BU]);
const e4 = await galat(() => q(`select hapus_supplier($1)`, [pasar]));
benar('4. INTI: "pasar  induk" terhitung sebagai "Pasar Induk"', !!e4, 'TERHAPUS, padahal entri kasnya cuma beda spasi');
benar('4. dan jumlahnya benar', /1 entri kas/.test(e4 ?? ''), e4);

// Entri kas yang kosong TIDAK ikut terhitung — `normal_nama_supplier('')`
// sama dengan dirinya sendiri, jadi tanpa penjaga `btrim <> ''` setiap
// supplier akan terlihat "dipakai" oleh setiap entri kas tanpa supplier.
const sepi = await buat('Toko Sepi');
await q(`insert into cash_entries (business_unit_id, entry_type, supplier) values ($1,'out',null), ($1,'out','')`, [BU]);
const e4b = await galat(() => q(`select hapus_supplier($1)`, [sepi]));
benar('4. INTI: entri kas tanpa supplier tidak ikut menghalangi', !e4b, e4b);

// =====================================================================
// §5 WEWENANG
// =====================================================================
console.log('\n§5 Wewenang');

const polos2 = await buat('Toko Lain');
await sebagai(STAFF);
const e5 = await galat(() => q(`select hapus_supplier($1)`, [polos2]));
benar('5. INTI: staff tidak bisa menghapus', /Admin BU|Super Admin/i.test(e5 ?? ''), e5);
cek('5. barisnya tetap ada', !!(await satu(`select 1 x from suppliers where id=$1`, [polos2])), true);
await sebagai(ADMIN);

const e5b = await galat(() => q(`select hapus_supplier('00000000-0000-0000-0000-000000000000')`));
benar('5. supplier yang tidak ada ditolak dengan jelas', /tidak ditemukan/i.test(e5b ?? ''), e5b);

// =====================================================================
// §6 `delete` LANGSUNG TIDAK BISA MELEWATINYA
// =====================================================================
console.log('\n§6 Jalur pintas ditutup');

// ============ KENAPA INI PERLU DIUJI SENDIRI ============
//
// Seluruh pemeriksaan di atas cuma SARAN selama policy `for all` dari 0158
// masih memuat `delete`: satu panggilan `DELETE /suppliers?id=eq.…` dari admin
// yang sama melewatinya tanpa menyentuh `hapus_supplier` sama sekali.
//
// PGlite menjalankan semuanya sebagai SUPERUSER, yang melewati RLS — jadi
// `delete` di sini akan BERHASIL apa pun policynya, dan menguji lewat jalur itu
// akan menghasilkan tes yang hijau untuk alasan yang salah. Maka yang diperiksa
// adalah KEBERADAAN policynya di katalog: `for all` lama harus hilang, dan
// tidak boleh ada satu pun policy yang mengizinkan `delete`.
cek(
  '6. policy `for all` lama hilang',
  Number((await satu(`select count(*) n from pg_policies where tablename='suppliers' and policyname='suppliers_modify'`)).n),
  0
);
cek(
  '6. INTI: tidak ada policy yang mengizinkan DELETE',
  (await q(`select policyname, cmd from pg_policies where tablename='suppliers' and cmd in ('DELETE','ALL')`)).rows,
  []
);
cek(
  '6. insert & update tetap ada',
  (await q(`select cmd from pg_policies where tablename='suppliers' order by cmd`)).rows.map((r) => r.cmd),
  ['INSERT', 'SELECT', 'UPDATE']
);

// Dan jalur staff lewat nota TIDAK ikut tertutup — `cari_atau_buat_supplier`
// `security definer`, jadi ia tidak pernah melewati policy insert itu.
await q(`insert into goods_receipts (business_unit_id, code, supplier) values ($1,'NT-9','Supplier Dari Staff')`, [BU]);
benar('6. INTI: staff tetap bisa melahirkan supplier lewat nota', !!(await sup('Supplier Dari Staff')));

// =====================================================================
// §7 DIJALANKAN ULANG
// =====================================================================
console.log('\n§7 Dijalankan ulang');

await db.exec(SQL161.replace(/notify pgrst[^;]*;/g, ''));
await db.exec(SQL162.replace(/notify pgrst[^;]*;/g, ''));
cek(
  '7. policynya tidak berlipat',
  Number((await satu(`select count(*) n from pg_policies where tablename='suppliers'`)).n),
  3
);
const e7 = await galat(() => q(`select hapus_supplier($1)`, [berkah.id]));
benar('7. penjaganya masih bekerja sesudah dijalankan ulang', !!e7, e7);

// =====================================================================
// §8 DOKUMEN YANG DIBATALKAN TIDAK MENAHAN (0162)
// =====================================================================
console.log('\n§8 Dokumen yang dibatalkan');

// ============ KELUHAN YANG MELAHIRKAN 0162 ============
//
//   "nota dengan supplier sudah saya batalkan dari staff app, tetapi supplier
//    yang dimaksud masih belum bisa dihapus"
//
// `batalkan_nota` TIDAK menghapus notanya — ia menandai `status='dibatalkan'`.
// 0161 menghitung seluruh baris tanpa melihat status, sementara
// `nama_supplier_terpakai` (yang mengisi kolom "Nota" di layar) menyaring
// `status='aktif'`.
//
// Akibatnya: tombol Hapus MUNCUL karena layar melihat 0 nota, lalu ditekan,
// lalu ditolak. Dua aturan untuk satu pertanyaan.
const batal = await buat('Toko Sudah Batal');
await q(`insert into goods_receipts (business_unit_id, code, supplier) values ($1,'NT-B1','Toko Sudah Batal')`, [BU]);
cek(
  '8. (persiapan) notanya menunjuk suppliernya',
  Number((await satu(`select count(*) n from goods_receipts where supplier_id=$1`, [batal])).n),
  1
);

// Selama notanya AKTIF, penghapusan tetap ditolak.
const e8a = await galat(() => q(`select hapus_supplier($1)`, [batal]));
benar('8. selama notanya aktif, tetap ditolak', !!e8a, 'TERHAPUS padahal notanya aktif');

// Lalu notanya dibatalkan — persis yang dilakukan pemakainya.
await q(`update goods_receipts set status='dibatalkan' where code='NT-B1'`);
const e8b = await galat(() => q(`select hapus_supplier($1)`, [batal]));
benar('8. INTI: sesudah notanya dibatalkan, boleh dihapus', !e8b, e8b);
cek('8. barisnya yang itu hilang', await satu(`select 1 x from suppliers where id=$1`, [batal]), undefined);

// ============ DAN TIDAK HIDUP KEMBALI SEKETIKA ============
//
// Pemeriksaan ini yang menemukan rantai paling halus di seluruh fitur ini.
// Penghapusannya BERHASIL — lalu FK `on delete set null` melakukan UPDATE pada
// notanya, UPDATE itu memicu `tautkan_supplier_nota`, dan triggernya melihat
// `supplier_id is null` dengan teks nama masih terisi lalu MEMBUATNYA ULANG.
//
// Dicari lewat NAMA, bukan id — karena baris yang muncul kembali punya id yang
// berbeda. Mencari lewat id saja akan hijau untuk fitur yang, dari layar,
// terlihat seperti tombol Hapus yang tidak bekerja sama sekali.
cek('8. INTI: dan tidak lahir kembali dengan id baru', await sup('Toko Sudah Batal'), undefined);

// Notanya TIDAK ikut terhapus, dan namanya tetap tertulis di sana.
const notaBatal = await satu(`select supplier, supplier_id, status from goods_receipts where code='NT-B1'`);
cek('8. notanya tetap ada', notaBatal.status, 'dibatalkan');
cek('8. INTI: nama suppliernya tetap tertulis di dokumen itu', notaBatal.supplier, 'Toko Sudah Batal');
cek('8. hanya tautannya yang lepas', notaBatal.supplier_id, null);

// ============ HAL YANG SAMA DI SISI KAS ============
//
// `dicoret_at` (0141) adalah bentuk pembatalan entri kas, dan seluruh pembaca
// kas menyaringnya. 0161 tidak — jadi satu entri kas yang sudah dicoret pun
// menahan penghapusan selamanya. Gejalanya belum dilaporkan siapa pun; sebabnya
// sama persis.
const kasBatal = await buat('Toko Kas Dicoret');
await q(`insert into cash_entries (business_unit_id, entry_type, supplier) values ($1,'out','Toko Kas Dicoret')`, [BU]);
benar('8. entri kas AKTIF menahan', !!(await galat(() => q(`select hapus_supplier($1)`, [kasBatal]))));

await q(`update cash_entries set dicoret_at = now() where supplier='Toko Kas Dicoret'`);
const e8c = await galat(() => q(`select hapus_supplier($1)`, [kasBatal]));
benar('8. INTI: entri kas yang sudah dicoret tidak menahan', !e8c, e8c);

// Kalimat penolakannya menyebut "AKTIF" — supaya orang yang membacanya tahu
// bahwa membatalkan dokumennya adalah jalan keluar yang sah.
const masihAktif = await buat('Toko Masih Aktif');
await q(`insert into goods_receipts (business_unit_id, code, supplier) values ($1,'NT-A1','Toko Masih Aktif')`, [BU]);
const e8d = await galat(() => q(`select hapus_supplier($1)`, [masihAktif]));
benar('8. kalimatnya menyebut bahwa yang dihitung yang AKTIF', /AKTIF/.test(e8d ?? ''), e8d);
benar('8. dan menyebut membatalkan dokumen sebagai jalan keluar', /batalkan dulu/i.test(e8d ?? ''), e8d);

console.log('');
if (gagal === 0) console.log(`${n} pemeriksaan 0161 lolos. ✅`);
else console.error(`${gagal} dari ${n} pemeriksaan GAGAL.`);
process.exit(gagal === 0 ? 0 : 1);
