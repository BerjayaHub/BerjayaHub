/**
 * MIGRATION 0127 DI POSTGRES SUNGGUHAN (PGlite).
 *
 * ============ YANG DIUJI ============
 *
 *   1. Pemetaan unik TANPA membedakan huruf besar-kecil — dua baris untuk nama
 *      yang sama membuat hasilnya bergantung pada baris mana yang kebetulan
 *      terbaca lebih dulu.
 *   2. `tandai_nota_esb` melewati nota yang SUDAH bertanda, bukan menimpanya.
 *   3. Nota BU lain tidak ikut tertandai.
 *   4. Pembatalan tanda tersedia — berkas yang ditolak ESB tidak boleh membuat
 *      notanya tertahan selamanya.
 *   5. Impor master tidak menghapus pemetaan yang sudah dikerjakan manusia.
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
  create table goods_receipts (id uuid primary key default gen_random_uuid(),
    business_unit_id uuid, outlet_id uuid, code text, receipt_date date default current_date);
  create or replace function is_bu_admin(p_uid uuid, p_bu uuid) returns boolean language sql stable as $$
    select exists (select 1 from membership_scopes
      where user_id = p_uid and role in ('super_admin','bu_admin')
        and (role = 'super_admin' or business_unit_id = p_bu));
  $$;
`);

const jalankan = async (b) =>
  db.exec(fs.readFileSync(path.join(AKAR, 'supabase/migrations', b), 'utf8').replace(/notify pgrst[^;]*;/g, ''));
await jalankan('0127_ekspor_esb.sql');
console.log('  0127 terpasang.');
await jalankan('0127_ekspor_esb.sql');
console.log('  dijalankan ulang: aman.');

const BU = (await satu(`insert into business_units (name) values ('Cafe') returning id`)).id;
const BU2 = (await satu(`insert into business_units (name) values ('BU Lain') returning id`)).id;
const OUT = (await satu(`insert into outlets (business_unit_id, name) values ($1,'CK') returning id`, [BU])).id;
const ADMIN = '11111111-1111-1111-1111-111111111111';
await q(`insert into user_profiles (id, full_name) values ($1,'Admin')`, [ADMIN]);
await q(`insert into membership_scopes (user_id, business_unit_id, role) values ($1,$2,'bu_admin')`, [ADMIN, BU]);
await q(`select set_config('request.jwt.claim.sub', $1, false)`, [ADMIN]);

// =====================================================================
// §1. Pemetaan unik tanpa membedakan huruf besar-kecil.
// =====================================================================
await q(`insert into esb_map (business_unit_id, jenis, kunci, nilai) values ($1,'item','Telur','Telur Ayam')`, [BU]);
const dobel = await gagalkan(() =>
  q(`insert into esb_map (business_unit_id, jenis, kunci, nilai) values ($1,'item',' telur ','Telur Lain')`, [BU])
);
benar('§1 "Telur" dan " telur " ditolak sebagai duplikat', /duplicate|unique/i.test(dobel ?? ''), `dapat: ${dobel}`);

// Jenis berbeda boleh memakai kunci yang sama.
const bedaJenis = await gagalkan(() =>
  q(`insert into esb_map (business_unit_id, jenis, kunci, nilai) values ($1,'unit','Telur','PCS')`, [BU])
);
benar('§1 jenis berbeda boleh berbagi kunci', bedaJenis === null, `dapat: ${bedaJenis}`);

// =====================================================================
// §2. Penanda ekspor.
// =====================================================================
const A = (await satu(`insert into goods_receipts (business_unit_id, outlet_id, code) values ($1,$2,'TRM-A') returning id`, [BU, OUT])).id;
const B = (await satu(`insert into goods_receipts (business_unit_id, outlet_id, code) values ($1,$2,'TRM-B') returning id`, [BU, OUT])).id;

const n1 = await satu(`select tandai_nota_esb(array[$1,$2]::uuid[]) as n`, [A, B]);
cek('§2 dua nota tertandai', Number(n1.n), 2);

const stempel = await satu(`select esb_exported_at, esb_exported_by from goods_receipts where id = $1`, [A]);
benar('§2 stempelnya terisi berikut pelakunya', !!stempel.esb_exported_at && stempel.esb_exported_by === ADMIN);

// Menandai ulang TIDAK menggeser tanggalnya.
const n2 = await satu(`select tandai_nota_esb(array[$1]::uuid[]) as n`, [A]);
cek('§2 nota yang sudah bertanda dilewati, bukan ditimpa', Number(n2.n), 0);
const stempel2 = await satu(`select esb_exported_at from goods_receipts where id = $1`, [A]);
cek('§2 dan tanggalnya tidak bergeser', String(stempel2.esb_exported_at), String(stempel.esb_exported_at));

// =====================================================================
// §3. Nota BU lain tidak ikut tertandai.
// =====================================================================
const LUAR = (await satu(`insert into goods_receipts (business_unit_id, code) values ($1,'TRM-LUAR') returning id`, [BU2])).id;
const n3 = await satu(`select tandai_nota_esb(array[$1]::uuid[]) as n`, [LUAR]);
cek('§3 nota BU lain tidak tertandai', Number(n3.n), 0);
benar('§3 stempelnya tetap kosong', (await satu(`select esb_exported_at from goods_receipts where id = $1`, [LUAR])).esb_exported_at === null);

// =====================================================================
// §4. Pembatalan tanda — untuk unggahan yang ditolak ESB.
// =====================================================================
const n4 = await satu(`select batalkan_tanda_esb(array[$1]::uuid[]) as n`, [A]);
cek('§4 tanda bisa dibatalkan', Number(n4.n), 1);
benar('§4 stempelnya kosong lagi', (await satu(`select esb_exported_at from goods_receipts where id = $1`, [A])).esb_exported_at === null);
cek('§4 nota tanpa tanda tidak terhitung dibatalkan', Number((await satu(`select batalkan_tanda_esb(array[$1]::uuid[]) as n`, [A])).n), 0);

// =====================================================================
// §5. Impor master tidak menghapus pemetaan.
//
// Master ikut berubah tiap kali ESB memperbarui datanya; pemetaan adalah
// keputusan manusia yang harus bertahan melewatinya. Digabung jadi satu tabel,
// satu impor akan menghapus pekerjaan berhari-hari.
// =====================================================================
await q(`insert into esb_master (business_unit_id, jenis, nama) values ($1,'item','Telur Ayam'), ($1,'item','Beras')`, [BU]);
await q(`delete from esb_master where business_unit_id = $1 and jenis = 'item'`, [BU]);
await q(`insert into esb_master (business_unit_id, jenis, nama) values ($1,'item','Telur Ayam')`, [BU]);
cek(
  '§5 pemetaan selamat melewati impor ulang master',
  (await satu(`select nilai from esb_map where business_unit_id = $1 and jenis = 'item'`, [BU])).nilai,
  'Telur Ayam'
);

// Master unik per (BU, jenis, nama).
const masterDobel = await gagalkan(() =>
  q(`insert into esb_master (business_unit_id, jenis, nama) values ($1,'item','Telur Ayam')`, [BU])
);
benar('§5 master tidak boleh berisi nama kembar', masterDobel !== null);

if (gagal === 0) console.log('Migration 0127 di Postgres sungguhan: 5 bagian LULUS. ✅');
process.exit(gagal === 0 ? 0 : 1);
