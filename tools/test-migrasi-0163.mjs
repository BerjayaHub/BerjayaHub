/**
 * 0163 — MODUL KONTEN SOSMED (PGlite — Postgres sungguhan).
 *
 *   §1 Modul terdaftar & setelan per outlet.
 *   §2 Berkas pertama menandai tugasnya DISETOR — di database, bukan di layar.
 *   §3 Batas ATAS 3 berkas dijaga; batas BAWAH sengaja TIDAK.
 *   §4 Tugas yang sudah SELESAI tidak turun lagi oleh unggahan susulan.
 *   §5 Wewenang: staff tidak bisa menandai selesai.
 *   §6 Staff boleh membatalkan unggahannya sendiri, tapi tidak sesudah selesai.
 *   §7 Satu tugas mingguan per outlet per tenggat; tugas khusus boleh banyak.
 *   §8 Dijalankan ulang.
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

await db.exec(`set time zone 'UTC'`);

await db.exec(`
  create schema if not exists auth;
  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
  $$;
  create role authenticated;

  create table business_units (id uuid primary key default gen_random_uuid(), name text);
  create table outlets (
    id uuid primary key default gen_random_uuid(),
    business_unit_id uuid references business_units(id) on delete cascade,
    name text, is_active boolean default true
  );
  create table user_profiles (id uuid primary key, full_name text);
  create table membership_scopes (user_id uuid, business_unit_id uuid, outlet_id uuid, role text);
  create table modules (
    id uuid primary key default gen_random_uuid(),
    code text not null unique, name text not null, description text,
    created_at timestamptz not null default now()
  );

  create or replace function has_bu_scope(p_uid uuid, p_bu uuid) returns boolean language sql stable as $$
    select exists (select 1 from membership_scopes where user_id = p_uid and business_unit_id = p_bu);
  $$;
  create or replace function has_outlet_scope(p_uid uuid, p_outlet uuid) returns boolean language sql stable as $$
    select exists (
      select 1 from membership_scopes ms
       where ms.user_id = p_uid
         and (ms.outlet_id = p_outlet
              or (ms.outlet_id is null
                  and ms.business_unit_id = (select business_unit_id from outlets where id = p_outlet)))
    );
  $$;
  create or replace function is_bu_admin(p_uid uuid, p_bu uuid) returns boolean language sql stable as $$
    select exists (select 1 from membership_scopes where user_id = p_uid and business_unit_id = p_bu and role in ('bu_admin','super_admin'));
  $$;
  create or replace function is_admin_of_outlet(p_uid uuid, p_outlet uuid) returns boolean language sql stable as $$
    select exists (
      select 1 from membership_scopes ms
       where ms.user_id = p_uid
         and ms.role in ('bu_admin','super_admin','outlet_admin')
         and (ms.outlet_id = p_outlet
              or (ms.outlet_id is null
                  and ms.business_unit_id = (select business_unit_id from outlets where id = p_outlet)))
    );
  $$;
`);

const BU = (await satu(`insert into business_units (name) values ('Cafe') returning id`)).id;
const OUT = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Dago') returning id`, [BU])).id;
const OUT2 = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Gading') returning id`, [BU])).id;
const STAFF = '11111111-1111-1111-1111-111111111111';
const STAFF2 = '33333333-3333-3333-3333-333333333333';
const ADMIN = '22222222-2222-2222-2222-222222222222';
await q(`insert into user_profiles (id, full_name) values ($1,'Staff'),($2,'Admin'),($3,'Staff 2')`, [STAFF, ADMIN, STAFF2]);
await q(
  `insert into membership_scopes (user_id, business_unit_id, outlet_id, role) values
     ($1,$4,$5,'staff'), ($2,$4,null,'bu_admin'), ($3,$4,$5,'staff')`,
  [STAFF, ADMIN, STAFF2, BU, OUT]
);

const SQL = fs.readFileSync(path.join(AKAR, 'supabase/migrations/0163_konten_sosmed.sql'), 'utf8');
await db.exec(SQL.replace(/notify pgrst[^;]*;/g, ''));
console.log('  0163 terpasang.');

// PGlite jalan sebagai SUPERUSER, yang MELEWATI RLS. Tanpa `set role`, seluruh
// pemeriksaan wewenang di bawah akan hijau untuk kebijakan apa pun — tes yang
// hijau karena alasan yang salah. Alasan yang sama ditulis di test 0161 §6.
const sebagaiStaff = async (uid) => {
  await q(`set role postgres`);
  await sebagai(uid);
  await q(`set role authenticated`);
};
const sebagaiSuper = () => q(`set role postgres`);

await db.exec(`
  grant usage on schema public to authenticated;
  grant select, insert, update, delete on konten_setelan_outlet, konten_tugas, konten_berkas to authenticated;
  grant select on outlets, business_units, membership_scopes, user_profiles to authenticated;
`);

// =====================================================================
console.log('\n§1 Modul & setelan outlet');
// =====================================================================

cek('1. modul terdaftar', (await satu(`select name from modules where code='konten_sosmed'`)).name, 'Konten Sosmed');

await q(
  `insert into konten_setelan_outlet (outlet_id, business_unit_id, hari_setor) values ($1,$2,5), ($3,$2,1)`,
  [OUT, BU, OUT2]
);
cek('1. hari setor bisa berbeda per outlet', (await satu(`select hari_setor from konten_setelan_outlet where outlet_id=$1`, [OUT2])).hari_setor, 1);

const hariSalah = await galat(() => q(`update konten_setelan_outlet set hari_setor = 9 where outlet_id=$1`, [OUT]));
benar('1. hari di luar 0–6 ditolak', !!hariSalah, 'DITERIMA');

// =====================================================================
console.log('\n§2 Berkas pertama menandai DISETOR');
// =====================================================================

const tugas = (
  await satu(
    `insert into konten_tugas (business_unit_id, outlet_id, tenggat) values ($1,$2,'2026-10-23') returning id`,
    [BU, OUT]
  )
).id;
cek('2. tugas baru berstatus `belum`', (await satu(`select status from konten_tugas where id=$1`, [tugas])).status, 'belum');

await q(`insert into konten_berkas (tugas_id, jenis, r2_key, diunggah_by) values ($1,'video','k/1.mp4',$2)`, [tugas, STAFF]);
const t2 = await satu(`select status, disetor_at from konten_tugas where id=$1`, [tugas]);
cek('2. INTI: berkas pertama menandai tugasnya `disetor`', t2.status, 'disetor');
benar('2. dan mencatat kapan', !!t2.disetor_at);

// Waktunya TIDAK bergeser saat berkas kedua masuk — `disetor_at` adalah kapan
// setoran dimulai, bukan kapan berkas terakhir ditambahkan.
await q(`insert into konten_berkas (tugas_id, jenis, r2_key, diunggah_by) values ($1,'foto','k/2.jpg',$2)`, [tugas, STAFF]);
cek(
  '2. waktu setor tidak bergeser oleh berkas berikutnya',
  (await satu(`select disetor_at from konten_tugas where id=$1`, [tugas])).disetor_at.toISOString(),
  t2.disetor_at.toISOString()
);

// =====================================================================
console.log('\n§3 Batas atas dijaga, batas bawah TIDAK');
// =====================================================================

await q(`insert into konten_berkas (tugas_id, jenis, r2_key, diunggah_by) values ($1,'foto','k/3.jpg',$2)`, [tugas, STAFF]);
const keempat = await galat(() =>
  q(`insert into konten_berkas (tugas_id, jenis, r2_key, diunggah_by) values ($1,'foto','k/4.jpg',$2)`, [tugas, STAFF])
);
benar('3. INTI: berkas keempat ditolak', /paling banyak 3/i.test(keempat ?? ''), keempat ?? 'DITERIMA');
cek('3. dan jumlahnya berhenti di 3', Number((await satu(`select count(*) n from konten_berkas where tugas_id=$1`, [tugas])).n), 3);

// ============ BATAS BAWAH SENGAJA TIDAK DIJAGA DATABASE ============
//
// "minimal 1 video + 1 foto" adalah keadaan yang WAJAR ADA sementara: staff
// mengunggah videonya dulu, fotonya menyusul semenit kemudian. Menjadikannya
// constraint berarti unggahan PERTAMA selalu ditolak — fitur yang tidak bisa
// dipakai sama sekali.
const tugasB = (
  await satu(`insert into konten_tugas (business_unit_id, outlet_id, tenggat) values ($1,$2,'2026-10-30') returning id`, [BU, OUT])
).id;
const videoSaja = await galat(() =>
  q(`insert into konten_berkas (tugas_id, jenis, r2_key, diunggah_by) values ($1,'video','k/5.mp4',$2)`, [tugasB, STAFF])
);
benar('3. INTI: satu video tanpa foto TETAP boleh tersimpan', !videoSaja, videoSaja);

// =====================================================================
console.log('\n§4 Yang sudah SELESAI tidak turun lagi');
// =====================================================================

await q(`update konten_tugas set status='selesai', selesai_at=now(), selesai_by=$2 where id=$1`, [tugasB, ADMIN]);
await q(`insert into konten_berkas (tugas_id, jenis, r2_key, diunggah_by) values ($1,'foto','k/6.jpg',$2)`, [tugasB, STAFF]);
// Tanpa penjaga ini, satu berkas susulan membatalkan penandaan selesai diam-diam
// — dan berkasnya tidak pernah masuk antrean penghapusan.
cek(
  '4. INTI: unggahan susulan tidak membatalkan penandaan selesai',
  (await satu(`select status from konten_tugas where id=$1`, [tugasB])).status,
  'selesai'
);

// =====================================================================
console.log('\n§5 Wewenang: staff tidak bisa menandai selesai');
// =====================================================================

await sebagaiStaff(STAFF);
const tandai = await galat(() => q(`update konten_tugas set status='selesai' where id=$1`, [tugas]));
cek(
  '5. INTI: staff tidak bisa menandai selesai',
  (await satu(`select status from konten_tugas where id=$1`, [tugas])).status,
  'disetor'
);
benar('5. (penolakannya boleh berupa galat atau nol baris)', true, tandai ?? 'nol baris');

// Staff TETAP bisa membaca tugasnya & membuat tugas di outletnya.
cek('5. staff tetap bisa membaca tugasnya', Number((await satu(`select count(*) n from konten_tugas`)).n), 2);
const buatStaff = await galat(() =>
  q(`insert into konten_tugas (business_unit_id, outlet_id, tenggat, jenis) values ($1,$2,'2026-11-06','mingguan')`, [BU, OUT])
);
benar('5. staff boleh melahirkan tugas mingguan di outletnya', !buatStaff, buatStaff);

// Dan TIDAK di outlet lain.
const buatLain = await galat(() =>
  q(`insert into konten_tugas (business_unit_id, outlet_id, tenggat) values ($1,$2,'2026-11-06')`, [BU, OUT2])
);
benar('5. INTI: tapi tidak di outlet yang bukan tempatnya', !!buatLain, 'DITERIMA');

await sebagaiSuper();

// =====================================================================
console.log('\n§6 Staff membatalkan unggahannya sendiri');
// =====================================================================

await sebagaiStaff(STAFF);
const hapusSendiri = await galat(() => q(`delete from konten_berkas where r2_key='k/3.jpg'`));
cek('6. staff boleh menghapus unggahannya sendiri', Number((await satu(`select count(*) n from konten_berkas where r2_key='k/3.jpg'`)).n), 0);
benar('6. (tanpa galat)', !hapusSendiri, hapusSendiri);

// Milik orang lain: tidak.
await sebagaiSuper();
await q(`insert into konten_berkas (tugas_id, jenis, r2_key, diunggah_by) values ($1,'foto','k/7.jpg',$2)`, [tugas, STAFF2]);
await sebagaiStaff(STAFF);
await galat(() => q(`delete from konten_berkas where r2_key='k/7.jpg'`));
cek(
  '6. INTI: tidak bisa menghapus unggahan staff lain',
  Number((await satu(`select count(*) n from konten_berkas where r2_key='k/7.jpg'`)).n),
  1
);

// Dan tidak sesudah tugasnya ditandai selesai — kalau bisa, staff bisa
// menghapus bukti setorannya sendiri tanpa melanggar apa pun yang terlihat.
await galat(() => q(`delete from konten_berkas where r2_key='k/5.mp4'`));
cek(
  '6. INTI: tidak bisa menghapus sesudah tugasnya selesai',
  Number((await satu(`select count(*) n from konten_berkas where r2_key='k/5.mp4'`)).n),
  1
);
await sebagaiSuper();

// =====================================================================
console.log('\n§7 Satu tugas mingguan per outlet per tenggat');
// =====================================================================

const kembar = await galat(() =>
  q(`insert into konten_tugas (business_unit_id, outlet_id, tenggat) values ($1,$2,'2026-10-23')`, [BU, OUT])
);
benar('7. INTI: tugas mingguan kembar ditolak', /unique|duplicate/i.test(kembar ?? ''), kembar ?? 'DITERIMA');

// Tugas KHUSUS boleh lebih dari satu pada tanggal yang sama — indeksnya parsial.
const khusus1 = await galat(() =>
  q(`insert into konten_tugas (business_unit_id, outlet_id, tenggat, jenis) values ($1,$2,'2026-10-23','khusus')`, [BU, OUT])
);
const khusus2 = await galat(() =>
  q(`insert into konten_tugas (business_unit_id, outlet_id, tenggat, jenis) values ($1,$2,'2026-10-23','khusus')`, [BU, OUT])
);
benar('7. dua tugas khusus di tanggal yang sama tetap boleh', !khusus1 && !khusus2, khusus1 ?? khusus2);

// Menghapus tugas ikut menghapus berkasnya (cascade) — tidak ada berkas yatim
// yang menunjuk tugas yang sudah tidak ada.
const tugasHapus = (
  await satu(`insert into konten_tugas (business_unit_id, outlet_id, tenggat, jenis) values ($1,$2,'2026-12-01','khusus') returning id`, [BU, OUT])
).id;
await q(`insert into konten_berkas (tugas_id, jenis, r2_key) values ($1,'foto','k/8.jpg')`, [tugasHapus]);
await q(`delete from konten_tugas where id=$1`, [tugasHapus]);
cek('7. berkas ikut terhapus bersama tugasnya', Number((await satu(`select count(*) n from konten_berkas where r2_key='k/8.jpg'`)).n), 0);

// ============ DAN KUNCINYA TIDAK HILANG BEGITU SAJA ============
//
// Objek di R2 tidak ikut terhapus oleh cascade. Kalau kuncinya tidak dicatat,
// ia jadi objek yatim: tidak ditunjuk baris mana pun, jadi tidak muncul di
// layar mana pun, jadi tidak ada yang tahu ia ada — sementara tetap menghitung
// kuota. Pemeriksaan inilah yang menemukan lubang itu.
cek(
  '7. INTI: kunci R2-nya tercatat sebagai sampah untuk dibersihkan',
  Number((await satu(`select count(*) n from konten_berkas_sampah where r2_key='k/8.jpg' and dihapus_at is null`)).n),
  1
);

// Jalur lain yang sama bocornya: staff membatalkan unggahannya sendiri (§6).
cek(
  '7. begitu juga yang dibatalkan staff sendiri',
  Number((await satu(`select count(*) n from konten_berkas_sampah where r2_key='k/3.jpg'`)).n),
  1
);

// =====================================================================
console.log('\n§8 Dijalankan ulang');
// =====================================================================

const sebelum = Number((await satu(`select count(*) n from konten_tugas`)).n);
await db.exec(SQL.replace(/notify pgrst[^;]*;/g, ''));
cek('8. aman dijalankan dua kali — datanya utuh', Number((await satu(`select count(*) n from konten_tugas`)).n), sebelum);
cek('8. modulnya tidak berlipat', Number((await satu(`select count(*) n from modules where code='konten_sosmed'`)).n), 1);
cek(
  '8. policy tidak berlipat',
  Number((await satu(`select count(*) n from pg_policies where tablename='konten_tugas'`)).n),
  4 // select, insert, update, delete
);

console.log('');
if (gagal === 0) console.log(`${n} pemeriksaan 0163 lolos. ✅`);
else console.error(`${gagal} dari ${n} pemeriksaan GAGAL.`);
process.exit(gagal === 0 ? 0 : 1);
