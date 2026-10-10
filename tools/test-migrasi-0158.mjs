/**
 * 0158 — MASTER SUPPLIER (PGlite — Postgres sungguhan).
 *
 *   "staff menambahkan supplier baru di staff app saat input nota … tetapi
 *    saat akan input lagi, supplier baru tersebut tidak muncul lagi di
 *    dropdown"
 *
 * ============ YANG DIUJI ============
 *
 *   §1 Isi awalnya: daftar ESB jadi terverifikasi, ejaan nota jadi belum.
 *   §2 INTI: nota yang menyebut nama BARU membuat barisnya sendiri —
 *      tanpa bantuan layar, lewat trigger.
 *   §3 Ejaan beda huruf besar/spasi TIDAK beranak jadi baris kedua.
 *   §4 INTI: admin membetulkan nama -> nota LAMA ikut berubah.
 *   §5 Gabung memindahkan seluruh nota, lalu yang asal hilang.
 *   §6 Bentrok nama dikatakan, dan jalan keluarnya disebut.
 *   §7 Bukan Admin BU ditolak.
 *   §8 Teks basi dari klien ditimpa induknya.
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
  create table user_profiles (id uuid primary key, full_name text);
  create table membership_scopes (user_id uuid, business_unit_id uuid, outlet_id uuid, role text);

  create table esb_master (
    id uuid primary key default gen_random_uuid(),
    business_unit_id uuid, jenis text, kode text, nama text
  );
  create table goods_receipts (
    id uuid primary key default gen_random_uuid(),
    business_unit_id uuid,
    code text,
    supplier text,
    status text default 'aktif'
  );

  create or replace function has_bu_scope(p_uid uuid, p_bu uuid) returns boolean language sql stable as $$
    select exists (select 1 from membership_scopes where user_id = p_uid and business_unit_id = p_bu);
  $$;
  create or replace function is_bu_admin(p_uid uuid, p_bu uuid) returns boolean language sql stable as $$
    select exists (select 1 from membership_scopes where user_id = p_uid and business_unit_id = p_bu and role in ('bu_admin','super_admin'));
  $$;
`);

// ============ DATA SEBELUM MIGRATION ============
//
// Sengaja diisi DULU, supaya bagian backfill-nya benar-benar punya pekerjaan.
// Migration yang diuji di atas tabel kosong tidak pernah membuktikan
// backfill-nya jalan.
const BU = (await satu(`insert into business_units (name) values ('Cafe') returning id`)).id;
const STAFF = '11111111-1111-1111-1111-111111111111';
const ADMIN = '22222222-2222-2222-2222-222222222222';
await q(`insert into user_profiles (id, full_name) values ($1,'Staff'),($2,'Admin')`, [STAFF, ADMIN]);
await q(`insert into membership_scopes (user_id, business_unit_id, role) values ($1,$3,'staff'), ($2,$3,'bu_admin')`, [
  STAFF,
  ADMIN,
  BU
]);

await q(`insert into esb_master (business_unit_id, jenis, kode, nama) values ($1,'supplier','SUP-001','PT Sumber Pangan')`, [BU]);
await q(`insert into esb_master (business_unit_id, jenis, kode, nama) values ($1,'item','ITM-9','Beras')`, [BU]);
await q(
  `insert into goods_receipts (business_unit_id, code, supplier) values
     ($1,'NT-1','Toko Berkah'), ($1,'NT-2','toko  berkah'), ($1,'NT-3','PT Sumber Pangan'), ($1,'NT-4',null)`,
  [BU]
);

const sql = fs.readFileSync(path.join(AKAR, 'supabase/migrations/0158_master_supplier.sql'), 'utf8');
await db.exec(sql.replace(/notify pgrst[^;]*;/g, ''));
console.log('  0158 terpasang.');

const sup = (nama) =>
  satu(`select * from suppliers where business_unit_id=$1 and normal_nama_supplier(nama)=normal_nama_supplier($2)`, [BU, nama]);
const notaSup = async (code) => (await satu(`select supplier, supplier_id from goods_receipts where code=$1`, [code]));

// =====================================================================
// §1 ISI AWAL
// =====================================================================
console.log('\n§1 Isi awal');

cek('1. jumlah supplier = ESB + ejaan nota (yang kembar dilebur)', Number((await satu(`select count(*) n from suppliers`)).n), 2);

const esb = await sup('PT Sumber Pangan');
cek('1. dari daftar ESB: terverifikasi', esb.terverifikasi, true);
cek('1. dan kodenya terbawa', esb.esb_kode, 'SUP-001');

const berkah = await sup('Toko Berkah');
cek('1. INTI: ejaan yang dipakai nota ikut masuk', !!berkah, true);
cek('1. tapi belum terverifikasi', berkah.terverifikasi, false);
cek('1. dan belum punya kode ESB', berkah.esb_kode, null);

cek('1. jenis selain supplier TIDAK ikut', await sup('Beras'), undefined);

// 'Toko Berkah' & 'toko  berkah' adalah SATU baris.
cek('1. INTI: dua ejaan beda spasi/huruf jadi satu baris', Number((await satu(`select count(*) n from suppliers where normal_nama_supplier(nama)='toko berkah'`)).n), 1);
cek('1. nota pertama tertaut', (await notaSup('NT-1')).supplier_id, berkah.id);
cek('1. nota berejaan lain tertaut ke baris yang SAMA', (await notaSup('NT-2')).supplier_id, berkah.id);
cek('1. nota tanpa supplier tetap kosong', (await notaSup('NT-4')).supplier_id, null);

// =====================================================================
// §2 KETIKAN STAFF JADI BARIS MASTER — TANPA LAYAR
// =====================================================================
console.log('\n§2 Nota baru membuat masternya sendiri');

await sebagai(STAFF);
// Persis bentuk yang dikirim RPC `simpan_nota` lama: teks saja.
await q(`insert into goods_receipts (business_unit_id, code, supplier) values ($1,'NT-5','CV Mitra Tani')`, [BU]);

const mitra = await sup('CV Mitra Tani');
cek('2. INTI: barisnya dibuat trigger, bukan layar', !!mitra, true);
cek('2. belum terverifikasi', mitra.terverifikasi, false);
cek('2. tapi langsung aktif — bisa dipakai semua orang', mitra.aktif, true);
cek('2. notanya tertaut', (await notaSup('NT-5')).supplier_id, mitra.id);
cek('2. pembuatnya tercatat', mitra.dibuat_by, STAFF);

// =====================================================================
// §3 EJAAN LAIN TIDAK BERANAK
// =====================================================================
console.log('\n§3 Tidak beranak');

await q(`insert into goods_receipts (business_unit_id, code, supplier) values ($1,'NT-6','cv   mitra tani ')`, [BU]);
cek('3. INTI: ejaan beda tidak membuat baris kedua', Number((await satu(`select count(*) n from suppliers where normal_nama_supplier(nama)='cv mitra tani'`)).n), 1);
cek('3. notanya tertaut ke baris yang sama', (await notaSup('NT-6')).supplier_id, mitra.id);
// Dan teksnya DIRAPIKAN mengikuti induknya, bukan disimpan apa adanya.
cek('3. INTI: teks notanya ikut ejaan induknya', (await notaSup('NT-6')).supplier, 'CV Mitra Tani');

// =====================================================================
// §4 ADMIN MEMBETULKAN NAMA -> NOTA LAMA IKUT
// =====================================================================
console.log('\n§4 Dibetulkan admin');

await sebagai(ADMIN);
await q(`select ubah_supplier($1, 'CV Mitra Tani Sejahtera', 'SUP-077', null, true, null)`, [mitra.id]);

const mitra2 = await satu(`select * from suppliers where id=$1`, [mitra.id]);
cek('4. namanya berubah', mitra2.nama, 'CV Mitra Tani Sejahtera');
cek('4. kode ESB terisi', mitra2.esb_kode, 'SUP-077');
cek('4. jadi terverifikasi', mitra2.terverifikasi, true);

// ============ INI YANG DIMINTA ============
cek('4. INTI: nota LAMA ikut menyebut nama yang benar', (await notaSup('NT-5')).supplier, 'CV Mitra Tani Sejahtera');
cek('4. nota kedua juga', (await notaSup('NT-6')).supplier, 'CV Mitra Tani Sejahtera');
cek('4. nota supplier LAIN tidak ikut berubah', (await notaSup('NT-1')).supplier, 'Toko Berkah');

// `esb_nama` kosong berarti "ejaannya sama", bukan "belum diisi".
cek('4. esb_nama kosong tetap null, bukan string kosong', mitra2.esb_nama, null);

// =====================================================================
// §5 GABUNG
// =====================================================================
console.log('\n§5 Gabung supplier kembar');

await q(`insert into goods_receipts (business_unit_id, code, supplier) values ($1,'NT-7','Tk Berkah')`, [BU]);
const tk = await sup('Tk Berkah');
benar('5. (persiapan) lahir sebagai baris tersendiri', !!tk);

const pindah = Number((await satu(`select gabung_supplier($1,$2) n`, [tk.id, berkah.id])).n);
cek('5. jumlah nota yang berpindah dilaporkan', pindah, 1);
cek('5. INTI: notanya menunjuk induk yang benar', (await notaSup('NT-7')).supplier_id, berkah.id);
cek('5. INTI: dan teksnya ikut berubah', (await notaSup('NT-7')).supplier, 'Toko Berkah');
cek('5. yang digabung dihapus', await sup('Tk Berkah'), undefined);
cek('5. nota lama milik tujuan tidak terganggu', (await notaSup('NT-1')).supplier_id, berkah.id);

const sama = await galat(() => q(`select gabung_supplier($1,$1)`, [berkah.id]));
benar('5. menggabungkan ke dirinya sendiri ditolak', /berbeda/i.test(sama ?? ''), sama);

// =====================================================================
// §6 BENTROK NAMA
// =====================================================================
console.log('\n§6 Bentrok nama');

const bentrok = await galat(() => q(`select ubah_supplier($1, 'toko berkah', null, null, null, null)`, [mitra.id]));
benar('6. bentrok dikatakan', /sudah ada supplier lain/i.test(bentrok ?? ''), bentrok);
// INTI: jalan keluarnya disebut sekalian. Galat yang cuma bilang "tidak bisa"
// mengirim orangnya mencari sendiri fitur yang sudah ada di layar yang sama.
benar('6. INTI: dan jalan keluarnya disebut', /gabungkan/i.test(bentrok ?? ''), bentrok);

const kosong = await galat(() => q(`select ubah_supplier($1, '   ', null, null, null, null)`, [mitra.id]));
benar('6. nama kosong ditolak', /tidak boleh kosong/i.test(kosong ?? ''), kosong);

// =====================================================================
// §7 WEWENANG
// =====================================================================
console.log('\n§7 Wewenang');

await sebagai(STAFF);
const tolakUbah = await galat(() => q(`select ubah_supplier($1, 'Apa Saja', null, null, null, null)`, [berkah.id]));
benar('7. staff ditolak mengubah master', /admin bu|super admin/i.test(tolakUbah ?? ''), tolakUbah);

const tolakGabung = await galat(() => q(`select gabung_supplier($1,$2)`, [berkah.id, mitra.id]));
benar('7. staff ditolak menggabungkan', /admin bu|super admin/i.test(tolakGabung ?? ''), tolakGabung);

// Tapi staff TETAP bisa membuat supplier lewat notanya — itu memang jalannya.
await q(`insert into goods_receipts (business_unit_id, code, supplier) values ($1,'NT-8','UD Sinar')`, [BU]);
cek('7. INTI: staff tetap bisa melahirkan supplier lewat nota', !!(await sup('UD Sinar')), true);

// =====================================================================
// §8 TEKS BASI DARI KLIEN
// =====================================================================
console.log('\n§8 Teks basi dari klien');

// PWA lama mengirim `supplier` teks yang sudah tidak sesuai induknya.
await q(`update goods_receipts set supplier = 'Nama Karangan' where code = 'NT-5'`);
cek('8. INTI: teksnya ditimpa dari induknya, bukan dipercaya', (await notaSup('NT-5')).supplier, 'CV Mitra Tani Sejahtera');

// =====================================================================
// §9 DIJALANKAN ULANG
// =====================================================================
console.log('\n§9 Dijalankan ulang');

const sebelum = Number((await satu(`select count(*) n from suppliers`)).n);
await db.exec(sql.replace(/notify pgrst[^;]*;/g, ''));
cek('9. aman dijalankan dua kali — tidak ada baris ganda', Number((await satu(`select count(*) n from suppliers`)).n), sebelum);
cek(
  '9. indeks uniknya tidak digandakan',
  Number((await satu(`select count(*) n from pg_indexes where indexname='suppliers_nama_uk'`)).n),
  1
);

console.log('');
if (gagal === 0) console.log(`${n} pemeriksaan 0158 lolos. ✅`);
else console.error(`${gagal} dari ${n} pemeriksaan GAGAL.`);
process.exit(gagal === 0 ? 0 : 1);
