/**
 * MIGRATION 0128 DI POSTGRES SUNGGUHAN (PGlite).
 *
 * ============ YANG DIUJI ============
 *
 *   1. Penanda ekspor terpasang di `dispatches`, dan pelakunya tercatat.
 *   2. Kiriman yang BELUM diterima tidak bisa ditandai berangkat — aturannya
 *      di database, bukan cuma di layar.
 *   3. Kiriman tanpa `received_at` juga tidak bisa, karena sel Date kosong
 *      akan diisi ESB dengan tanggal unggah.
 *   4. Menandai ulang dilewati, bukan menimpa stempel lama.
 *   5. Kiriman BU lain tidak ikut tertandai.
 *   6. Pembatalan tanda tersedia.
 *   7. Isi kiriman yang sudah diekspor tidak bisa diubah diam-diam, tapi bisa
 *      diperbaiki SETELAH tandanya dibatalkan.
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

await db.exec(`
  create role authenticated;
  create schema if not exists auth;
  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
  $$;
  create table business_units (id uuid primary key default gen_random_uuid(), name text);
  create table outlets (id uuid primary key default gen_random_uuid(), business_unit_id uuid, name text);
  create table user_profiles (id uuid primary key, full_name text);
  create table membership_scopes (user_id uuid, business_unit_id uuid, outlet_id uuid, role text);
  create table products (id uuid primary key default gen_random_uuid(), name text, base_unit text);
  create table dispatches (
    id uuid primary key default gen_random_uuid(),
    business_unit_id uuid, from_outlet_id uuid, to_outlet_id uuid, code text,
    status text not null default 'sent' check (status in ('draft','sent','received','cancelled')),
    received_at timestamptz);
  create table dispatch_items (
    id uuid primary key default gen_random_uuid(),
    dispatch_id uuid not null, product_id uuid, sent_qty numeric, received_qty numeric);
  create or replace function is_bu_admin(p_uid uuid, p_bu uuid) returns boolean language sql stable as $$
    select exists (select 1 from membership_scopes
      where user_id = p_uid and role in ('super_admin','bu_admin')
        and (role = 'super_admin' or business_unit_id = p_bu));
  $$;
`);

const jalankan = async (b) =>
  db.exec(fs.readFileSync(path.join(AKAR, 'supabase/migrations', b), 'utf8').replace(/notify pgrst[^;]*;/g, ''));
await jalankan('0128_ekspor_esb_transfer.sql');
console.log('  0128 terpasang.');
await jalankan('0128_ekspor_esb_transfer.sql');
console.log('  dijalankan ulang: aman.');

const BU = (await satu(`insert into business_units (name) values ('Cafe') returning id`)).id;
const BU2 = (await satu(`insert into business_units (name) values ('BU Lain') returning id`)).id;
const CK = (await satu(`insert into outlets (business_unit_id, name) values ($1,'CK') returning id`, [BU])).id;
const SENTUL = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Sentul') returning id`, [BU])).id;
const PROD = (await satu(`insert into products (name, base_unit) values ('Wortel','GR') returning id`)).id;
const ADMIN = '11111111-1111-1111-1111-111111111111';
await q(`insert into user_profiles (id, full_name) values ($1,'Admin')`, [ADMIN]);
await q(`insert into membership_scopes (user_id, business_unit_id, role) values ($1,$2,'bu_admin')`, [ADMIN, BU]);
await q(`select set_config('request.jwt.claim.sub', $1, false)`, [ADMIN]);

const buatKiriman = async (kode, status, terima, bu = BU) =>
  (
    await satu(
      `insert into dispatches (business_unit_id, from_outlet_id, to_outlet_id, code, status, received_at)
       values ($1,$2,$3,$4,$5,$6) returning id`,
      [bu, CK, SENTUL, kode, status, terima]
    )
  ).id;

// =====================================================================
// §1. Penanda terpasang.
// =====================================================================
const A = await buatKiriman('KRM-A', 'received', '2026-09-05T06:00:00Z');
const n1 = await satu(`select tandai_kiriman_esb(array[$1]::uuid[]) as n`, [A]);
cek('§1 kiriman yang sudah diterima bisa ditandai', Number(n1.n), 1);
const stempel = await satu(`select esb_exported_at, esb_exported_by from dispatches where id = $1`, [A]);
benar('§1 stempelnya terisi berikut pelakunya', !!stempel.esb_exported_at && stempel.esb_exported_by === ADMIN);

// =====================================================================
// §2. Yang belum diterima TIDAK boleh berangkat.
//
// Aturan ini ditegakkan di database, bukan cuma di query layar. Penyaringan
// di layar hanya menyembunyikan barisnya; kalau suatu saat query itu berubah,
// stok tujuan di ESB akan bertambah sebelum barangnya sampai.
// =====================================================================
for (const st of ['draft', 'sent', 'cancelled']) {
  const id = await buatKiriman(`KRM-${st}`, st, '2026-09-05T06:00:00Z');
  const n = await satu(`select tandai_kiriman_esb(array[$1]::uuid[]) as n`, [id]);
  cek(`§2 status '${st}' tidak bisa ditandai`, Number(n.n), 0);
  benar(`§2 stempel '${st}' tetap kosong`, (await satu(`select esb_exported_at from dispatches where id = $1`, [id])).esb_exported_at === null);
}

// =====================================================================
// §3. Diterima tapi tanpa tanggal terima juga ditolak.
// =====================================================================
const TANPA_TGL = await buatKiriman('KRM-NULLTGL', 'received', null);
cek('§3 received tanpa received_at tidak bisa ditandai', Number((await satu(`select tandai_kiriman_esb(array[$1]::uuid[]) as n`, [TANPA_TGL])).n), 0);

// =====================================================================
// §4. Menandai ulang dilewati.
// =====================================================================
const n4 = await satu(`select tandai_kiriman_esb(array[$1]::uuid[]) as n`, [A]);
cek('§4 kiriman yang sudah bertanda dilewati', Number(n4.n), 0);
cek(
  '§4 dan stempelnya tidak bergeser',
  String((await satu(`select esb_exported_at from dispatches where id = $1`, [A])).esb_exported_at),
  String(stempel.esb_exported_at)
);

// =====================================================================
// §5. Kiriman BU lain.
// =====================================================================
const LUAR = await buatKiriman('KRM-LUAR', 'received', '2026-09-05T06:00:00Z', BU2);
cek('§5 kiriman BU lain tidak tertandai', Number((await satu(`select tandai_kiriman_esb(array[$1]::uuid[]) as n`, [LUAR])).n), 0);
benar('§5 stempelnya tetap kosong', (await satu(`select esb_exported_at from dispatches where id = $1`, [LUAR])).esb_exported_at === null);

// Campuran: yang boleh tetap tertandai, yang tidak boleh tidak.
const C = await buatKiriman('KRM-C', 'received', '2026-09-06T06:00:00Z');
const nCampur = await satu(`select tandai_kiriman_esb(array[$1,$2]::uuid[]) as n`, [C, LUAR]);
cek('§5 dari daftar campuran hanya yang berhak tertandai', Number(nCampur.n), 1);

// =====================================================================
// §6. Pembatalan tanda.
// =====================================================================
cek('§6 tanda bisa dibatalkan', Number((await satu(`select batalkan_tanda_kiriman_esb(array[$1]::uuid[]) as n`, [C])).n), 1);
benar('§6 stempelnya kosong lagi', (await satu(`select esb_exported_at from dispatches where id = $1`, [C])).esb_exported_at === null);
cek('§6 yang tanpa tanda tidak terhitung dibatalkan', Number((await satu(`select batalkan_tanda_kiriman_esb(array[$1]::uuid[]) as n`, [C])).n), 0);
cek('§6 daftar kosong tidak melempar', Number((await satu(`select batalkan_tanda_kiriman_esb(null) as n`)).n), 0);
cek('§6 tandai dengan daftar kosong tidak melempar', Number((await satu(`select tandai_kiriman_esb(array[]::uuid[]) as n`)).n), 0);

// =====================================================================
// §7. Isi kiriman terekspor tidak bisa diubah diam-diam.
//
// Kalau qty terima dikoreksi sesudah berkasnya diunggah, ESB menyimpan angka
// yang berbeda dari Berjaya Hub selamanya — dan tidak ada baris yang terlihat
// aneh di kedua sistem.
// =====================================================================
const D = await buatKiriman('KRM-D', 'received', '2026-09-07T06:00:00Z');
await q(`insert into dispatch_items (dispatch_id, product_id, sent_qty, received_qty) values ($1,$2,100,95)`, [D, PROD]);
await q(`select tandai_kiriman_esb(array[$1]::uuid[])`, [D]);

const ubah = await gagalkan(() => q(`update dispatch_items set received_qty = 50 where dispatch_id = $1`, [D]));
benar('§7 mengubah qty kiriman terekspor ditolak', /sudah diekspor/i.test(ubah ?? ''), `dapat: ${ubah}`);
cek('§7 angkanya tidak berubah', Number((await satu(`select received_qty from dispatch_items where dispatch_id = $1`, [D])).received_qty), 95);

const hapus = await gagalkan(() => q(`delete from dispatch_items where dispatch_id = $1`, [D]));
benar('§7 menghapus barisnya juga ditolak', /sudah diekspor/i.test(hapus ?? ''), `dapat: ${hapus}`);

const tambah = await gagalkan(() => q(`insert into dispatch_items (dispatch_id, product_id, sent_qty, received_qty) values ($1,$2,1,1)`, [D, PROD]));
benar('§7 menambah baris baru juga ditolak', /sudah diekspor/i.test(tambah ?? ''), `dapat: ${tambah}`);

// Dan jalan keluarnya ADA: batalkan tandanya, perbaiki, tandai lagi.
await q(`select batalkan_tanda_kiriman_esb(array[$1]::uuid[])`, [D]);
const ubahLagi = await gagalkan(() => q(`update dispatch_items set received_qty = 50 where dispatch_id = $1`, [D]));
benar('§7 setelah tanda dibatalkan, koreksi bisa dilakukan', ubahLagi === null, `dapat: ${ubahLagi}`);
cek('§7 koreksinya masuk', Number((await satu(`select received_qty from dispatch_items where dispatch_id = $1`, [D])).received_qty), 50);

// Kiriman yang belum pernah diekspor tidak terganggu sama sekali.
const E = await buatKiriman('KRM-E', 'sent', null);
const bebas = await gagalkan(() => q(`insert into dispatch_items (dispatch_id, product_id, sent_qty) values ($1,$2,10)`, [E, PROD]));
benar('§7 kiriman biasa tidak terhalang trigger', bebas === null, `dapat: ${bebas}`);

if (gagal === 0) console.log('Migration 0128 di Postgres sungguhan: 7 bagian LULUS. ✅');
process.exit(gagal === 0 ? 0 : 1);
