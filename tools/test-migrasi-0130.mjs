/**
 * MIGRATION 0130 DI POSTGRES SUNGGUHAN (PGlite).
 *
 * ============ KEGAGALAN ASLINYA DIREPRODUKSI DULU ============
 *
 * Bagian terpenting tes ini bukan "0130 membuat bucket" — itu sepele. Yang
 * dibuktikan adalah SEBABNYA:
 *
 *   `0084` dijalankan sekali  -> bucket ADA
 *   `0084` dijalankan lagi    -> berhenti di `create policy` baris 71
 *
 * Kalau percobaan kedua itulah yang benar-benar terjadi di server (dan bukti di
 * lapangan mengatakan begitu: tabelnya ada, bucketnya tidak), maka bucket yang
 * pembuatannya berada SESUDAH kebijakan itu tidak pernah lahir.
 *
 * Tanpa mereproduksinya, "0130 memperbaiki masalah" cuma klaim.
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
  if (!syarat) { gagal++; console.error(`❌ ${nama}${ket ? ' — ' + ket : ''}`); }
};

const db = new PGlite();
const q = (sql, params) => db.query(sql, params);
const satu = async (sql, params) => (await q(sql, params)).rows[0];
const gagalkan = async (fn) => { try { await fn(); return null; } catch (e) { return String(e.message ?? e); } };

// Tiruan schema storage secukupnya.
await db.exec(`
  create role authenticated;
  create schema if not exists auth;
  create schema if not exists storage;
  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
  $$;
  create table storage.buckets (id text primary key, name text, public boolean default false);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
  alter table storage.objects enable row level security;
  create or replace function storage.foldername(p text) returns text[] language sql immutable as $$
    select (string_to_array(p, '/'))[1:array_length(string_to_array(p, '/'), 1) - 1];
  $$;
  create table user_profiles (id uuid primary key, full_name text);
  create table outlets (id uuid primary key default gen_random_uuid(), name text);
  create or replace function has_outlet_scope(p_uid uuid, p_outlet uuid) returns boolean
    language sql stable as $$ select p_uid is not null and p_outlet is not null $$;
`);

const adaBucket = async (id) =>
  (await satu(`select exists (select 1 from storage.buckets where id = $1) as ada`, [id])).ada;

// =====================================================================
// §1. Reproduksi: 0084 tidak bisa dijalankan ulang, dan bucketnya korban.
// =====================================================================
//
// Bagian 0084 yang relevan ditiru apa adanya: kebijakan tabel DULU (tanpa
// `drop`), bucket BELAKANGAN.
const POTONGAN_0084 = `
  create table if not exists goods_receipts (id uuid primary key default gen_random_uuid(), outlet_id uuid);
  alter table goods_receipts enable row level security;
  create policy gr_select on goods_receipts for select using (true);
  insert into storage.buckets (id, name, public)
  values ('receipt-photos', 'receipt-photos', false)
  on conflict (id) do nothing;
`;

await db.exec(POTONGAN_0084);
benar('§1 dijalankan sekali: bucketnya ada', await adaBucket('receipt-photos'));

// Bersihkan bucketnya, lalu jalankan ULANG seperti yang terjadi di server.
await q(`delete from storage.buckets where id = 'receipt-photos'`);
const ulang = await gagalkan(() => db.exec(POTONGAN_0084));
benar('§1 dijalankan ulang: BERHENTI di create policy', ulang !== null, `dapat: ${ulang}`);
benar('§1 dan pesannya soal kebijakan yang sudah ada', /already exists/i.test(ulang ?? ''), `dapat: ${ulang}`);
benar(
  '§1 akibatnya: bucketnya TIDAK pernah lahir — persis yang dilaporkan staff',
  (await adaBucket('receipt-photos')) === false
);

// =====================================================================
// §2. 0130 memperbaikinya.
// =====================================================================
const jalankan = async (b) =>
  db.exec(fs.readFileSync(path.join(AKAR, 'supabase/migrations', b), 'utf8').replace(/notify pgrst[^;]*;/g, ''));

await jalankan('0130_bucket_foto_nota.sql');
console.log('  0130 terpasang.');
benar('§2 bucket receipt-photos ada sesudah 0130', await adaBucket('receipt-photos'));
cek(
  '§2 dan TIDAK publik — foto nota memuat harga beli & nama supplier',
  (await satu(`select public from storage.buckets where id = 'receipt-photos'`)).public,
  false
);

// =====================================================================
// §3. Bucket lain yang bisa hilang karena sebab yang sama ikut dipastikan.
// =====================================================================
for (const b of [
  'attendance-selfies',
  'cash-proofs',
  'checklist-photos',
  'leave-attachments',
  'asset-photos',
  'staff-photos',
  'reservation-proofs',
  'owner-signature',
  'documents'
]) {
  benar(`§3 bucket ${b} dipastikan ada`, await adaBucket(b));
  cek(`§3 ${b} tetap privat`, (await satu(`select public from storage.buckets where id = $1`, [b])).public, false);
}

// Satu-satunya yang publik, dan memang harus: logo & tema BU dimuat halaman
// reservasi sebelum siapa pun login.
cek('§3 bu-logos publik, sesuai aslinya', (await satu(`select public from storage.buckets where id = 'bu-logos'`)).public, true);

// =====================================================================
// §4. Kebijakan foto nota terpasang.
// =====================================================================
const kebijakan = (await q(`select policyname from pg_policies where tablename = 'objects' and schemaname = 'storage'`)).rows.map(
  (r) => r.policyname
);
for (const p of ['receipt_photo_insert', 'receipt_photo_select', 'receipt_photo_delete']) {
  benar(`§4 kebijakan ${p} ada`, kebijakan.includes(p), `dapat: ${kebijakan.join(', ')}`);
}

// =====================================================================
// §5. 0130 SENDIRI aman dijalankan berulang — itu inti pelajarannya.
// =====================================================================
const ulang130 = await gagalkan(() => jalankan('0130_bucket_foto_nota.sql'));
benar('§5 dijalankan dua kali tidak melempar', ulang130 === null, `dapat: ${ulang130}`);
const ulang130b = await gagalkan(() => jalankan('0130_bucket_foto_nota.sql'));
benar('§5 tiga kali pun aman', ulang130b === null, `dapat: ${ulang130b}`);
benar('§5 dan bucketnya tetap ada', await adaBucket('receipt-photos'));
cek(
  '§5 kebijakannya tidak berlipat ganda',
  (await q(`select policyname from pg_policies where tablename = 'objects' and policyname like 'receipt_photo%'`)).rows.length,
  3
);

// =====================================================================
// §6. Bucket yang sudah ada TIDAK berubah sifatnya.
//
// Kalau 0130 menimpa `public`, satu berkas yang seharusnya privat bisa jadi
// terbuka bagi siapa pun yang menebak URL-nya — kerusakan yang jauh lebih
// besar daripada masalah yang diperbaikinya.
// =====================================================================
// Diperiksa pada KEDUA daftar sisipan yang ada di 0130.
//
// Versi pertama tes ini cuma memeriksa `bu-logos`, yang punya `insert`
// sendiri di ujung berkas — jadi sabotase terhadap `on conflict` pada daftar
// UTAMA lolos tanpa satu pun tanda. Satu pemeriksaan yang menyentuh satu dari
// dua jalur menghasilkan rasa aman untuk jalur yang tidak diperiksa.
await q(`update storage.buckets set public = true where id = 'documents'`); // daftar utama
await q(`update storage.buckets set public = false where id = 'bu-logos'`); // sisipan terpisah
await jalankan('0130_bucket_foto_nota.sql');
cek(
  '§6 daftar utama: sifat bucket yang sudah ada tidak ditimpa',
  (await satu(`select public from storage.buckets where id = 'documents'`)).public,
  true
);
cek(
  '§6 sisipan bu-logos: juga tidak ditimpa',
  (await satu(`select public from storage.buckets where id = 'bu-logos'`)).public,
  false
);

if (gagal === 0) console.log('Migration 0130 di Postgres sungguhan: 6 bagian LULUS. ✅');
process.exit(gagal === 0 ? 0 : 1);
