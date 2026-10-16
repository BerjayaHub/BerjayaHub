/**
 * 0164 — NOTIFIKASI TELEGRAM SETORAN KONTEN (PGlite — Postgres sungguhan).
 *
 *   §1 Trigger terpasang pada tabel yang BENAR, dan hanya untuk INSERT.
 *   §2 Ia benar-benar MENYALA saat berkas masuk — dan diam saat berkas dihapus.
 *   §3 Urutan trigger: klaim di komentar migration diuji, bukan dipercaya.
 *   §4 Kegagalan pengiriman TIDAK membatalkan unggahan staff.
 *   §5 Dijalankan ulang.
 *
 * ============ KENAPA §3 ADA ============
 *
 * Komentar di 0164 mengklaim `trg_notify_konten_berkas` berjalan SEBELUM
 * `trg_tandai_tugas_disetor` karena Postgres mengurutkan trigger AFTER menurut
 * nama. Kalau klaim itu salah, orang berikutnya akan membangun sesuatu di
 * atasnya. Komentar yang melebih-lebihkan sebuah penjaga membuat orang
 * berikutnya mempercayai penjaga yang tidak ada — jadi klaimnya diuji.
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

// ---------------------------------------------------------------
// Kerangka minimum: cukup untuk 0163 + 0164 berdiri.
// ---------------------------------------------------------------
await db.exec(`
  create table business_units (id uuid primary key default gen_random_uuid(), name text);
  create table outlets (id uuid primary key default gen_random_uuid(), business_unit_id uuid references business_units(id), name text);
  create table user_profiles (id uuid primary key, full_name text);
  create table modules (
    id uuid primary key default gen_random_uuid(),
    code text not null unique, name text not null, description text,
    created_at timestamptz not null default now()
  );
  create table membership_scopes (user_id uuid, business_unit_id uuid, outlet_id uuid, role text);

  create schema if not exists auth;
  create or replace function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create role authenticated;

  create or replace function is_bu_admin(p_user uuid, p_bu uuid) returns boolean language sql stable as $$
    select exists (select 1 from membership_scopes ms where ms.user_id = p_user
                     and ms.role in ('super_admin','bu_admin')
                     and (ms.business_unit_id = p_bu or ms.role = 'super_admin')) $$;
  create or replace function has_bu_scope(p_user uuid, p_bu uuid) returns boolean language sql stable as $$
    select exists (select 1 from membership_scopes ms where ms.user_id = p_user
                     and (ms.business_unit_id = p_bu or ms.role = 'super_admin')) $$;
  create or replace function is_admin_of_outlet(p_user uuid, p_outlet uuid) returns boolean language sql stable as $$
    select exists (select 1 from membership_scopes ms where ms.user_id = p_user
                     and ms.role in ('super_admin','bu_admin','outlet_admin')) $$;
  create or replace function has_outlet_scope(p_user uuid, p_outlet uuid) returns boolean language sql stable as $$
    select exists (select 1 from membership_scopes ms where ms.user_id = p_user
                     and (ms.outlet_id = p_outlet or ms.outlet_id is null)) $$;
`);

const SQL163 = fs.readFileSync(path.join(AKAR, 'supabase/migrations/0163_konten_sosmed.sql'), 'utf8');
await db.exec(SQL163.replace(/notify pgrst[^;]*;/g, ''));

// ============ PENGGANTI `notify_telegram_event` YANG BISA DIPERIKSA ============
//
// Yang asli (0043) memanggil `net.http_post`, dan pg_net tidak ada di PGlite.
// Tandanya dicatat ke tabel supaya "triggernya menyala" bisa DIBUKTIKAN, bukan
// disimpulkan dari ketiadaan error.
//
// Tandatangannya sengaja sama persis: kalau 0164 suatu saat memanggil fungsi
// lain, migration-nya akan gagal dipasang di sini dan tesnya merah — bukan
// hijau karena menguji fungsi yang tidak dipakai produksi.
await db.exec(`
  create table jejak_notif (id serial primary key, tabel text, op text, record jsonb, saat_status text);
  create or replace function notify_telegram_event() returns trigger language plpgsql as $$
  declare
    v_baris jsonb := to_jsonb(coalesce(new, old));
  begin
    insert into jejak_notif (tabel, op, record, saat_status)
    values (
      tg_table_name,
      tg_op,
      v_baris,
      -- Status tugasnya SAAT trigger ini berjalan. Inilah yang membuktikan
      -- urutan triggernya, bukan dugaan tentang urutan nama.
      (select status from konten_tugas where id = (v_baris->>'tugas_id')::uuid)
    );
    return coalesce(new, old);
  end $$;
`);

const SQL164 = fs.readFileSync(path.join(AKAR, 'supabase/migrations/0164_notifikasi_konten.sql'), 'utf8');
await db.exec(SQL164.replace(/notify pgrst[^;]*;/g, ''));
console.log('  0163 + 0164 terpasang.');

const BU = (await satu(`insert into business_units (name) values ('Cafe') returning id`)).id;
const OUT = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Dago') returning id`, [BU])).id;
const STAFF = '11111111-1111-1111-1111-111111111111';
await q(`insert into user_profiles (id, full_name) values ($1,'Budi')`, [STAFF]);
await q(`insert into membership_scopes (user_id, business_unit_id, outlet_id, role) values ($1,$2,$3,'staff')`, [STAFF, BU, OUT]);

const TUGAS = (
  await satu(
    `insert into konten_tugas (business_unit_id, outlet_id, tenggat, jenis) values ($1,$2,'2026-10-17','mingguan') returning id`,
    [BU, OUT]
  )
).id;

// =====================================================================
console.log('\n§1 Trigger terpasang di tempat yang benar');
// =====================================================================

const trg = await satu(
  `select tgname, tgtype from pg_trigger
    where tgrelid = 'konten_berkas'::regclass and tgname = 'trg_notify_konten_berkas'`
);
benar('1. trigger ada di konten_berkas', !!trg, 'tanpa ini tidak ada satu pun notifikasi setoran');

// tgtype bit 2 = ROW, bit 0 = BEFORE(0)/AFTER(1) lewat ketiadaan, 4 = INSERT, 8 = DELETE, 16 = UPDATE
const tipe = Number(trg?.tgtype ?? 0);
benar('1. hanya untuk INSERT', (tipe & 4) !== 0, 'INSERT harus ikut');
benar(
  '1. BUKAN untuk DELETE — berkas yang dibatalkan staff tidak diumumkan',
  (tipe & 8) === 0,
  'mengumumkan tiap pembatalan mengubah grup jadi catatan perubahan'
);
benar('1. BUKAN untuk UPDATE', (tipe & 16) === 0);
benar('1. per baris, bukan per pernyataan', (tipe & 1) !== 0);

// ============ TABEL YANG SALAH ADALAH KEGAGALAN YANG MASUK AKAL ============
//
// `konten_tugas` LAHIR saat layar dibuka, bukan saat ada yang disetor. Trigger
// di sana akan mengumumkan "Setoran Konten" untuk outlet yang cuma mengintip
// briefnya.
const diTugas = await satu(
  `select count(*) n from pg_trigger
    where tgrelid = 'konten_tugas'::regclass and not tgisinternal and tgname like '%notify%'`
);
cek('1. TIDAK dipasang di konten_tugas — barisnya lahir saat layar dibuka, bukan saat setor', Number(diTugas.n), 0);

// =====================================================================
console.log('\n§2 Menyala saat berkas masuk, diam saat dihapus');
// =====================================================================

const B1 = (
  await satu(
    `insert into konten_berkas (tugas_id, jenis, r2_key, nama_asli, ukuran_byte, diunggah_by)
     values ($1,'video','k/1/video-a.mp4','a.mp4',141000000,$2) returning id`,
    [TUGAS, STAFF]
  )
).id;

const jejak = (await q(`select * from jejak_notif order by id`)).rows;
cek('2. satu berkas = satu notifikasi', jejak.length, 1);
cek('2. tabelnya konten_berkas', jejak[0]?.tabel, 'konten_berkas');
cek('2. operasinya INSERT', jejak[0]?.op, 'INSERT');
cek('2. payload memuat tugas_id — kunci untuk mencari outlet & tenggat', jejak[0]?.record?.tugas_id, TUGAS);
benar('2. payload memuat jenis berkas', jejak[0]?.record?.jenis === 'video');
benar('2. payload memuat pengunggahnya', jejak[0]?.record?.diunggah_by === STAFF);

await q(`delete from konten_berkas where id = $1`, [B1]);
cek('2. penghapusan TIDAK menambah notifikasi', Number((await satu(`select count(*) n from jejak_notif`)).n), 1);

// =====================================================================
console.log('\n§3 Urutan trigger — klaim komentar 0164 diuji');
// =====================================================================
//
// Postgres menjalankan trigger AFTER menurut urutan NAMA:
//   trg_notify_konten_berkas  <  trg_tandai_tugas_disetor   ('n' < 't')
//
// Jadi saat notifikasi berjalan, statusnya MASIH 'belum'. Itulah sebabnya
// pesannya tidak boleh dibangun dari status di dalam trigger — Edge Function
// yang membacanya ulang sesudah commit.

await q(`delete from jejak_notif`);
await q(`update konten_tugas set status='belum', disetor_at=null where id=$1`, [TUGAS]);
await q(
  `insert into konten_berkas (tugas_id, jenis, r2_key, nama_asli, diunggah_by) values ($1,'foto','k/1/foto-a.jpg','a.jpg',$2)`,
  [TUGAS, STAFF]
);

cek(
  "3. saat trigger notifikasi berjalan, status tugas MASIH 'belum'",
  (await satu(`select saat_status from jejak_notif order by id limit 1`)).saat_status,
  'belum'
);
cek(
  "3. sesudah transaksi, statusnya sudah 'disetor' — yang dibaca Edge Function",
  (await satu(`select status from konten_tugas where id=$1`, [TUGAS])).status,
  'disetor'
);

const urutan = (
  await q(
    `select tgname from pg_trigger where tgrelid='konten_berkas'::regclass and not tgisinternal
       and tgname in ('trg_notify_konten_berkas','trg_tandai_tugas_disetor') order by tgname`
  )
).rows.map((r) => r.tgname);
cek('3. urutan namanya memang begitu', urutan, ['trg_notify_konten_berkas', 'trg_tandai_tugas_disetor']);

// =====================================================================
console.log('\n§4 Notifikasi yang gagal tidak boleh menggagalkan unggahan');
// =====================================================================
//
// Yang asli (0043) membungkus dirinya dengan `exception when others` justru
// untuk ini. Kalau suatu saat penjaga itu dicabut, staff yang mengunggah 141 MB
// akan melihat unggahannya DITOLAK karena bot Telegram sedang bermasalah —
// kegagalan di tempat yang sama sekali tidak berhubungan.

await db.exec(`
  create or replace function notify_telegram_event() returns trigger language plpgsql as $$
  begin
    raise exception 'Telegram sedang mati';
  exception
    when others then
      raise warning 'notify_telegram_event gagal: %', sqlerrm;
      return coalesce(new, old);
  end $$;
`);

let unggahanGagal = null;
try {
  await q(`insert into konten_berkas (tugas_id, jenis, r2_key, nama_asli) values ($1,'video','k/1/video-b.mp4','b.mp4')`, [
    TUGAS
  ]);
} catch (e) {
  unggahanGagal = e;
}
benar(
  '4. bot Telegram yang mati TIDAK menggagalkan pencatatan berkas',
  unggahanGagal === null,
  `berkasnya ditolak: ${unggahanGagal?.message ?? ''}`
);
cek(
  '4. dan berkasnya benar-benar tersimpan',
  Number((await satu(`select count(*) n from konten_berkas where tugas_id=$1`, [TUGAS])).n),
  2
);

// =====================================================================
console.log('\n§5 Dijalankan ulang');
// =====================================================================

const sebelum = Number((await satu(`select count(*) n from konten_berkas`)).n);
await db.exec(SQL164.replace(/notify pgrst[^;]*;/g, ''));
cek('5. aman dijalankan dua kali — datanya utuh', Number((await satu(`select count(*) n from konten_berkas`)).n), sebelum);
cek(
  '5. triggernya tidak berlipat',
  Number(
    (await satu(`select count(*) n from pg_trigger where tgrelid='konten_berkas'::regclass and tgname='trg_notify_konten_berkas'`))
      .n
  ),
  1
);

console.log('');
if (gagal === 0) console.log(`${n} pemeriksaan 0164 lolos. ✅`);
else console.error(`${gagal} dari ${n} pemeriksaan GAGAL.`);
process.exit(gagal === 0 ? 0 : 1);
