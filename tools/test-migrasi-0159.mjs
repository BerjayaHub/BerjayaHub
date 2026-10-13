/**
 * 0159 — PENERIMA YANG BUKAN SUPPLIER (PGlite).
 *
 *   "untuk pembayaran uang hadir staff di cash ledger yang memakai kas/kantong
 *    outlet baiknya bagaimana? karena ada pewajiban memasukkan supplier di kas
 *    keluar"
 *
 *   §1 Seed "Kas Operasional" ada di tiap BU, dan tidak menggandakan diri.
 *   §2 INTI: baris yang lahir dari NOTA selalu `supplier`, tidak pernah internal.
 *   §3 INTI: nota yang menyebut penerima internal TETAP tertaut — tidak NULL.
 *   §4 `tambah_supplier`: wewenang, jenis yang sah, dan nama kembar.
 *   §5 `ubah_supplier` mengurus jenis, dan `null` berarti "jangan ubah".
 *   §6 Tanda tangan lama `ubah_supplier` sudah dibuang.
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

const sql158 = fs.readFileSync(path.join(AKAR, 'supabase/migrations/0158_master_supplier.sql'), 'utf8');
await db.exec(sql158.replace(/notify pgrst[^;]*;/g, ''));
const sql = fs.readFileSync(path.join(AKAR, 'supabase/migrations/0159_penerima_bukan_supplier.sql'), 'utf8');
await db.exec(sql.replace(/notify pgrst[^;]*;/g, ''));
console.log('  0158 + 0159 terpasang.');

const BU2 = (await satu(`insert into business_units (name) values ('Hotel') returning id`)).id;
// BU kedua dibuat SESUDAH migration — seed-nya tidak akan ada di sana, dan itu
// memang keadaan yang perlu diketahui (lihat §1).

const sup = (nama, bu = BU) =>
  satu(`select * from suppliers where business_unit_id=$1 and normal_nama_supplier(nama)=normal_nama_supplier($2)`, [bu, nama]);
const notaSup = async (code) => await satu(`select supplier, supplier_id from goods_receipts where code=$1`, [code]);

// =====================================================================
// §1 SEED
// =====================================================================
console.log('\n§1 Penerima internal bawaan');

const kasOp = await sup('Kas Operasional');
cek('1. INTI: "Kas Operasional" tersedia tanpa admin mengerjakan apa pun', !!kasOp, true);
cek('1. jenisnya internal', kasOp.jenis, 'internal');
cek('1. dan dianggap sudah diperiksa — ia dibuat sistem, bukan diketik siapa pun', kasOp.terverifikasi, true);
cek('1. kode ESB-nya KOSONG — itu yang tersisa buat admin', kasOp.esb_kode, null);

cek('1. supplier lama tetap berjenis supplier', (await sup('PT Sumber Pangan')).jenis, 'supplier');
cek('1. ejaan dari nota pun supplier', (await sup('Toko Berkah')).jenis, 'supplier');

// Dijalankan ulang tidak menggandakan seed-nya.
await db.exec(sql.replace(/notify pgrst[^;]*;/g, ''));
cek(
  '1. INTI: dijalankan ulang tidak menggandakan seed-nya',
  Number((await satu(`select count(*) n from suppliers where business_unit_id=$1 and jenis='internal'`, [BU])).n),
  1
);

// =====================================================================
// §2 YANG LAHIR DARI NOTA
// =====================================================================
console.log('\n§2 Nota melahirkan supplier, bukan internal');

await sebagai(STAFF);
await q(`insert into goods_receipts (business_unit_id, code, supplier) values ($1,'NT-9','UD Baru Sekali')`, [BU]);
cek('2. INTI: baris baru dari nota berjenis supplier', (await sup('UD Baru Sekali')).jenis, 'supplier');

// =====================================================================
// §3 NOTA YANG MENYEBUT PENERIMA INTERNAL
// =====================================================================
console.log('\n§3 Nota menyebut penerima internal');

await q(`insert into goods_receipts (business_unit_id, code, supplier) values ($1,'NT-10','Kas Operasional')`, [BU]);
// Godaan yang ditolak di 0159: menyaring pencarian per jenis. Kalau disaring,
// baris ini tidak ketemu, insert-nya ditolak indeks unik, dan `supplier_id`
// jadi NULL — nota tersimpan tanpa tertaut ke mana pun, tanpa galat.
cek('3. INTI: notanya TETAP tertaut, bukan NULL', (await notaSup('NT-10')).supplier_id, kasOp.id);
cek('3. dan tidak melahirkan baris kedua bernama sama', Number((await satu(`select count(*) n from suppliers where business_unit_id=$1 and normal_nama_supplier(nama)='kas operasional'`, [BU])).n), 1);
cek('3. jenisnya tidak berubah jadi supplier', (await sup('Kas Operasional')).jenis, 'internal');

// =====================================================================
// §4 TAMBAH PENERIMA
// =====================================================================
console.log('\n§4 tambah_supplier');

const tolakStaff = await galat(() => q(`select tambah_supplier($1,'Uang Hadir','internal')`, [BU]));
benar('4. staff ditolak', /admin bu|super admin/i.test(tolakStaff ?? ''), tolakStaff);

await sebagai(ADMIN);
const uangHadir = (await satu(`select tambah_supplier($1,'Uang Hadir Staff','internal') id`, [BU])).id;
benar('4. admin bisa menambah penerima internal', !!uangHadir);
cek('4. jenisnya terbawa', (await sup('Uang Hadir Staff')).jenis, 'internal');
cek('4. dan langsung terverifikasi — ia dibuat admin sendiri', (await sup('Uang Hadir Staff')).terverifikasi, true);

// Dipanggil dua langkah, bukan sub-select: `tambah_supplier` adalah fungsi
// yang MENULIS, dan memanggilnya di dalam `where` membuat urutan eksekusinya
// bergantung pada perencana query — baris yang baru dibuat belum tentu
// terlihat oleh `select` yang sama.
await q(`select tambah_supplier($1,'Vendor Baru')`, [BU]);
cek('4. bawaannya supplier kalau jenisnya tidak disebut', (await sup('Vendor Baru')).jenis, 'supplier');

const jenisAneh = await galat(() => q(`select tambah_supplier($1,'Apa Saja','karyawan')`, [BU]));
benar('4. jenis yang tidak dikenal ditolak', /tidak dikenal/i.test(jenisAneh ?? ''), jenisAneh);

const kembar = await galat(() => q(`select tambah_supplier($1,'kas  operasional','internal')`, [BU]));
benar('4. INTI: nama kembar (beda spasi/huruf) ditolak', /sudah ada penerima/i.test(kembar ?? ''), kembar);

const kosongNama = await galat(() => q(`select tambah_supplier($1,'   ','internal')`, [BU]));
benar('4. nama kosong ditolak', /tidak boleh kosong/i.test(kosongNama ?? ''), kosongNama);

// ============ BU YANG LAHIR SESUDAH MIGRATION ============
//
// `insert` seed-nya cuma mengurus BU yang ADA saat migration jalan. Tanpa
// trigger di `business_units`, BU berikutnya lahir tanpa penerima internal —
// dan tidak ada yang tahu sampai ada staff di sana yang tertahan oleh form,
// yaitu keluhan yang sama persis di tempat yang tidak dicurigai siapa pun.
//
// Pemeriksaan ini yang menemukannya; versi pertama justru menegaskan keadaan
// yang salah itu sebagai "memang begitu".
benar('4. INTI: BU yang dibuat SESUDAH migration ikut dapat penerima internal', !!(await sup('Kas Operasional', BU2)));
cek('4. dan jenisnya benar', (await sup('Kas Operasional', BU2)).jenis, 'internal');

const BU3 = (await satu(`insert into business_units (name) values ('Rental') returning id`)).id;
benar('4. begitu pula BU yang dibuat setelahnya lagi', !!(await sup('Kas Operasional', BU3)));

// =====================================================================
// §5 UBAH JENIS
// =====================================================================
console.log('\n§5 ubah_supplier & jenis');

await q(`select ubah_supplier($1, 'Uang Hadir Staff', 'COA-99', null, null, null, null)`, [uangHadir]);
cek('5. INTI: `p_jenis` null berarti JANGAN UBAH — bukan "jadikan supplier"', (await sup('Uang Hadir Staff')).jenis, 'internal');
cek('5. kolom lain tetap tersimpan', (await sup('Uang Hadir Staff')).esb_kode, 'COA-99');

await q(`select ubah_supplier($1, 'Uang Hadir Staff', 'COA-99', null, null, null, 'supplier')`, [uangHadir]);
cek('5. jenisnya bisa diubah kalau memang diminta', (await sup('Uang Hadir Staff')).jenis, 'supplier');

const jenisSalah = await galat(() => q(`select ubah_supplier($1, 'Uang Hadir Staff', null, null, null, null, 'karyawan')`, [uangHadir]));
benar('5. jenis yang tidak dikenal ditolak di sini juga', /tidak dikenal/i.test(jenisSalah ?? ''), jenisSalah);

// =====================================================================
// §6 TANDA TANGAN LAMA
// =====================================================================
console.log('\n§6 Satu nama fungsi, satu tanda tangan');

cek(
  '6. INTI: `ubah_supplier` hanya punya SATU tanda tangan',
  Number((await satu(`select count(*) n from pg_proc where proname = 'ubah_supplier'`)).n),
  1
);
cek(
  '6. dan ia yang menerima 7 argumen',
  Number((await satu(`select pronargs n from pg_proc where proname = 'ubah_supplier'`)).n),
  7
);

console.log('');
if (gagal === 0) console.log(`${n} pemeriksaan 0159 lolos. ✅`);
else console.error(`${gagal} dari ${n} pemeriksaan GAGAL.`);
process.exit(gagal === 0 ? 0 : 1);
