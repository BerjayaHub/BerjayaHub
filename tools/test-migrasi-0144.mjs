/**
 * MIGRATION 0144 DI POSTGRES SUNGGUHAN (PGlite).
 *
 * ============ YANG DIUJI ============
 *
 *   §1 `esb_master` & `esb_map` menerima jenis 'supplier', dan tetap MENOLAK
 *      jenis yang dikarang.
 *   §2 Enam jenis lama tidak ada yang hilang — memperlebar `check` dengan
 *      mengetik ulang daftarnya adalah cara paling mudah menghapus satu jenis
 *      tanpa sadar.
 *   §3 Baris yang sudah ada tidak terganggu.
 *   §4 `nama_supplier_terpakai` menghitung dengan benar: dirapikan spasinya,
 *      nota batal tidak ikut, dan yang belum diekspor dihitung terpisah.
 *   §5 Urutannya mendahulukan yang benar-benar menghambat.
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
const semua = async (sql, params) => (await q(sql, params)).rows;
const galat = async (sql, params) => {
  try {
    await q(sql, params);
    return null;
  } catch (e) {
    return String(e.message ?? e);
  }
};

await db.exec(`
  create role authenticated;
  create table business_units (id uuid primary key default gen_random_uuid(), name text);
  create table outlets (id uuid primary key default gen_random_uuid(), business_unit_id uuid, name text);
  create table user_profiles (id uuid primary key, full_name text);

  -- Tiruan 0127, dengan check ASLI-nya (enam jenis, tanpa supplier).
  create table esb_master (
    id uuid primary key default gen_random_uuid(),
    business_unit_id uuid not null references business_units(id) on delete cascade,
    jenis text not null check (jenis in ('branch', 'location', 'unit', 'item', 'payment_method', 'coa')),
    kode text, nama text not null, keterangan text,
    diperbarui_at timestamptz not null default now(),
    unique (business_unit_id, jenis, nama));
  create table esb_map (
    id uuid primary key default gen_random_uuid(),
    business_unit_id uuid not null references business_units(id) on delete cascade,
    jenis text not null check (jenis in ('branch', 'location', 'unit', 'item', 'payment_method', 'coa')),
    kunci text not null, nilai text not null,
    diperbarui_at timestamptz not null default now());

  create table goods_receipts (
    id uuid primary key default gen_random_uuid(),
    business_unit_id uuid, outlet_id uuid, code text, receipt_date date,
    supplier text, status text default 'aktif', esb_exported_at timestamptz);
`);

const BU = (await satu(`insert into business_units (name) values ('Cafe') returning id`)).id;
const BU2 = (await satu(`insert into business_units (name) values ('Lain') returning id`)).id;

// Baris LAMA dipasang SEBELUM migration, supaya §3 menguji data yang sungguh
// sudah ada — bukan data yang baru dibuat sesudah aturannya berubah.
await q(`insert into esb_master (business_unit_id, jenis, nama, kode) values ($1,'branch','HEAD OFFICE','B1')`, [BU]);
await q(`insert into esb_map (business_unit_id, jenis, kunci, nilai) values ($1,'item','Beras','BERAS PREMIUM')`, [BU]);

const jalankan = async (b) =>
  db.exec(fs.readFileSync(path.join(AKAR, 'supabase/migrations', b), 'utf8').replace(/notify pgrst[^;]*;/g, ''));

await jalankan('0144_master_supplier_esb.sql');
console.log('  0144 terpasang.');
await jalankan('0144_master_supplier_esb.sql');
console.log('  dijalankan ulang: aman.');

// =====================================================================
// §1 Jenis supplier diterima, yang dikarang tetap ditolak
// =====================================================================
cek(
  '§1 esb_master menerima jenis supplier',
  await galat(`insert into esb_master (business_unit_id, jenis, nama, kode) values ($1,'supplier','Pasar','CK01')`, [BU]),
  null
);
cek(
  '§1 esb_map menerima jenis supplier',
  await galat(`insert into esb_map (business_unit_id, jenis, kunci, nilai) values ($1,'supplier','pasar','Pasar')`, [BU]),
  null
);
benar(
  '§1 jenis yang dikarang tetap DITOLAK esb_master',
  (await galat(`insert into esb_master (business_unit_id, jenis, nama) values ($1,'ngawur','X')`, [BU])) !== null,
  'check yang terlalu longgar membuat salah ketik jenis tersimpan diam-diam'
);
benar(
  '§1 jenis yang dikarang tetap DITOLAK esb_map',
  (await galat(`insert into esb_map (business_unit_id, jenis, kunci, nilai) values ($1,'ngawur','a','b')`, [BU])) !== null
);

// =====================================================================
// §2 Enam jenis lama tidak ada yang hilang
// =====================================================================
for (const j of ['branch', 'location', 'unit', 'item', 'payment_method', 'coa']) {
  cek(
    `§2 esb_master masih menerima '${j}'`,
    await galat(`insert into esb_master (business_unit_id, jenis, nama) values ($1,$2,$3)`, [BU2, j, `contoh ${j}`]),
    null
  );
  cek(
    `§2 esb_map masih menerima '${j}'`,
    await galat(`insert into esb_map (business_unit_id, jenis, kunci, nilai) values ($1,$2,$3,'x')`, [BU2, j, `k ${j}`]),
    null
  );
}

// =====================================================================
// §3 Baris lama tidak terganggu
// =====================================================================
cek(
  '§3 baris esb_master lama masih ada',
  (await satu(`select nama from esb_master where business_unit_id = $1 and jenis = 'branch'`, [BU])).nama,
  'HEAD OFFICE'
);
cek(
  '§3 baris esb_map lama masih ada',
  (await satu(`select nilai from esb_map where business_unit_id = $1 and jenis = 'item'`, [BU])).nilai,
  'BERAS PREMIUM'
);
// Indeks unik (business_unit_id, jenis, nama) harus tetap berdiri: tanpa itu
// satu impor ulang bisa menggandakan seluruh daftar tanpa satu pun error.
benar(
  '§3 unique (bu, jenis, nama) masih menjaga',
  (await galat(`insert into esb_master (business_unit_id, jenis, nama) values ($1,'supplier','Pasar')`, [BU])) !== null
);

// =====================================================================
// §4 nama_supplier_terpakai
// =====================================================================
const nota = async (sup, { batal = false, diekspor = false, bu = BU } = {}) =>
  q(
    `insert into goods_receipts (business_unit_id, code, receipt_date, supplier, status, esb_exported_at)
     values ($1, 'X', '2026-09-01', $2, $3, case when $4 then now() else null end)`,
    [bu, sup, batal ? 'dibatalkan' : 'aktif', diekspor]
  );

await nota('Pasar');
await nota('Pasar', { diekspor: true });
await nota('  Pasar  '); // spasi tepi -> nama yang SAMA
await nota('Toko Sebelah');
await nota('Nota Batal', { batal: true });
await nota('', {});
await nota(null, {});
await nota('Punya BU Lain', { bu: BU2 });

const dipakai = await semua(`select nama, jumlah::int, belum_ekspor::int from nama_supplier_terpakai($1)`, [BU]);
const petaDipakai = new Map(dipakai.map((r) => [r.nama, r]));

cek('§4 spasi tepi dirapikan jadi satu nama', petaDipakai.get('Pasar')?.jumlah, 3);
cek('§4 yang belum diekspor dihitung terpisah', petaDipakai.get('Pasar')?.belum_ekspor, 2);
benar('§4 nota yang dibatalkan TIDAK ikut', !petaDipakai.has('Nota Batal'), 'ejaannya tidak perlu dibereskan siapa pun');
benar('§4 supplier kosong tidak jadi baris', !petaDipakai.has(''));
benar('§4 BU lain tidak bocor', !petaDipakai.has('Punya BU Lain'));
cek('§4 jumlah nama berbeda', dipakai.length, 2);

// =====================================================================
// §5 Urutannya mendahulukan yang menghambat
// =====================================================================
await nota('Warung Ujung', { diekspor: true });
await nota('Warung Ujung', { diekspor: true });
await nota('Warung Ujung', { diekspor: true });
await nota('Warung Ujung', { diekspor: true });

const urut = await semua(`select nama from nama_supplier_terpakai($1)`, [BU]);
// "Warung Ujung" punya 4 nota — lebih banyak dari "Toko Sebelah" yang cuma 1 —
// tapi semuanya sudah diekspor, jadi ia tidak menghambat apa pun.
benar(
  '§5 yang punya nota belum-ekspor didahulukan, bukan yang notanya terbanyak',
  urut.findIndex((r) => r.nama === 'Toko Sebelah') < urut.findIndex((r) => r.nama === 'Warung Ujung'),
  `urutannya: ${urut.map((r) => r.nama).join(', ')}`
);

console.log('');
if (gagal === 0) console.log('MIGRATION 0144: semua pemeriksaan lolos. ✅');
else console.error(`${gagal} pemeriksaan GAGAL.`);
await db.close();
process.exit(gagal === 0 ? 0 : 1);
