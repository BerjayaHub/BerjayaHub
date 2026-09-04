/**
 * MIGRATION 0117 DI POSTGRES SUNGGUHAN (PGlite).
 *
 * ============ YANG DIUJI ============
 *
 * Bukan "apakah tanggalnya tersimpan" — itu selalu berhasil. Yang diuji adalah
 * hal-hal yang salahnya TIDAK KELIHATAN SALAH:
 *
 *   1. `day_count` dihitung ULANG. Kalau ia tertinggal di angka pengajuan,
 *      jatah cuti terpotong sebesar hari yang tidak dipakai — dan baris
 *      tanggalnya sendiri sudah benar, jadi tidak ada yang terlihat janggal.
 *   2. Memperluas rentang DITOLAK. Memberi cuti pada tanggal yang tidak pernah
 *      diminta adalah kerugian yang baru ketahuan pada hari-H.
 *   3. Jejak `*_awal` diisi HANYA saat benar-benar berubah, dan hanya SEKALI.
 *   4. Wewenangnya persis sama dengan kebijakan RLS-nya.
 *   5. `cuti_disetujui_rentang` (0113) ikut memakai tanggal yang DISETUJUI —
 *      kalau tidak, jadwal shift tetap memblokir hari yang tidak jadi cuti.
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
const sebagai = (uid) => q(`select set_config('request.jwt.claim.sub', $1, false)`, [uid]);
const gagalkan = async (fn) => {
  try {
    await fn();
    return null;
  } catch (e) {
    return String(e.message ?? e);
  }
};

await db.exec(`
  create schema if not exists auth;
  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
  $$;

  create table business_units (id uuid primary key default gen_random_uuid(), name text);
  create table outlets (id uuid primary key default gen_random_uuid(), business_unit_id uuid, name text);
  create table user_profiles (id uuid primary key, full_name text);
  create table leave_types (id uuid primary key default gen_random_uuid(), name text, deducts_quota boolean default true);
  create table membership_scopes (user_id uuid, business_unit_id uuid, outlet_id uuid, role text);

  create table leave_requests (
    id uuid primary key default gen_random_uuid(),
    user_id uuid, business_unit_id uuid, outlet_id uuid, leave_type_id uuid,
    start_date date not null, end_date date not null, day_count int not null,
    reason text, attachment_path text,
    status text not null default 'pending',
    reviewed_by uuid, reviewed_at timestamptz, review_note text,
    created_at timestamptz not null default now()
  );

  create role authenticated;

  create or replace function is_bu_admin(p_uid uuid, p_bu uuid) returns boolean language sql stable as $$
    select exists (select 1 from membership_scopes where user_id = p_uid and business_unit_id = p_bu and role in ('bu_admin','super_admin'));
  $$;
  create or replace function is_admin_of_outlet(p_uid uuid, p_outlet uuid) returns boolean language sql stable as $$
    select exists (
      select 1 from membership_scopes ms
       where ms.user_id = p_uid
         and ms.role in ('bu_admin','super_admin','outlet_admin')
         and (ms.outlet_id = p_outlet
              or (ms.outlet_id is null and ms.business_unit_id = (select business_unit_id from outlets where id = p_outlet)))
    );
  $$;
  create or replace function has_bu_scope(p_uid uuid, p_bu uuid) returns boolean language sql stable as $$
    select exists (select 1 from membership_scopes where user_id = p_uid and business_unit_id = p_bu);
  $$;
  create or replace function has_outlet_scope(p_uid uuid, p_outlet uuid) returns boolean language sql stable as $$
    select exists (
      select 1 from membership_scopes ms
       where ms.user_id = p_uid
         and (ms.outlet_id = p_outlet
              or (ms.outlet_id is null and ms.business_unit_id = (select business_unit_id from outlets where id = p_outlet)))
    );
  $$;
`);

const jalankan = async (b) =>
  db.exec(fs.readFileSync(path.join(AKAR, 'supabase/migrations', b), 'utf8').replace(/notify pgrst[^;]*;/g, ''));

await jalankan('0113_cuti_di_jadwal_shift.sql');
await jalankan('0117_admin_ubah_tanggal_cuti.sql');
console.log('  0113 -> 0117 terpasang.');
await jalankan('0117_admin_ubah_tanggal_cuti.sql');
console.log('  dijalankan ulang: aman.');

// =====================================================================
// DATA
// =====================================================================
const BU = (await satu(`insert into business_units (name) values ('Cafe') returning id`)).id;
const OUT = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Serpong') returning id`, [BU])).id;
const JENIS = (await satu(`insert into leave_types (name) values ('Cuti Tahunan') returning id`)).id;

const RIFKI = '11111111-1111-1111-1111-111111111111';
const ADMIN = '22222222-2222-2222-2222-222222222222';
const ORANG_LAIN = '33333333-3333-3333-3333-333333333333';
await q(`insert into user_profiles (id, full_name) values ($1,'Rifki'),($2,'Iko'),($3,'Bukan Admin')`, [
  RIFKI,
  ADMIN,
  ORANG_LAIN
]);
await q(`insert into membership_scopes (user_id, business_unit_id, outlet_id, role) values ($1,$2,$3,'staff')`, [RIFKI, BU, OUT]);
await q(`insert into membership_scopes (user_id, business_unit_id, role) values ($1,$2,'bu_admin')`, [ADMIN, BU]);
await q(`insert into membership_scopes (user_id, business_unit_id, outlet_id, role) values ($1,$2,$3,'staff')`, [ORANG_LAIN, BU, OUT]);

/** Pengajuan baru 4–8 Sep (5 hari). */
const ajukan = async (mulai = '2026-09-04', selesai = '2026-09-08') =>
  (
    await satu(
      `insert into leave_requests (user_id, business_unit_id, outlet_id, leave_type_id, start_date, end_date, day_count)
       values ($1,$2,$3,$4,$5,$6, ($6::date - $5::date) + 1) returning id`,
      [RIFKI, BU, OUT, JENIS, mulai, selesai]
    )
  ).id;

const baca = (id) =>
  satu(
    `select start_date::text, end_date::text, day_count, status, review_note,
            start_date_awal::text, end_date_awal::text, day_count_awal, reviewed_by
       from leave_requests where id = $1`,
    [id]
  );

// =====================================================================
// §1. Kasus yang diminta: diajukan 4–8, disetujui 6–8.
// =====================================================================
await sebagai(ADMIN);
const A = await ajukan();
await q(`select setujui_cuti($1,'approved','sebagian saja',$2::date,$3::date)`, [A, '2026-09-06', '2026-09-08']);
const a = await baca(A);

cek('§1 tanggal mulai jadi yang disetujui', a.start_date, '2026-09-06');
cek('§1 tanggal selesai tetap', a.end_date, '2026-09-08');
cek(
  '§1 INTI: day_count dihitung ULANG',
  a.day_count,
  3
);
cek('§1 jejak tanggal diajukan tersimpan', [a.start_date_awal, a.end_date_awal, a.day_count_awal], [
  '2026-09-04',
  '2026-09-08',
  5
]);
cek('§1 status & catatan', [a.status, a.review_note], ['approved', 'sebagian saja']);
cek('§1 pemutusnya tercatat', a.reviewed_by, ADMIN);

// =====================================================================
// §2. Persetujuan UTUH tidak meninggalkan jejak palsu.
// =====================================================================
const B = await ajukan();
await q(`select setujui_cuti($1,'approved',null,null,null)`, [B]);
const b = await baca(B);
cek('§2 tanggalnya tidak berubah', [b.start_date, b.end_date, b.day_count], ['2026-09-04', '2026-09-08', 5]);
cek(
  '§2 INTI: kolom *_awal tetap NULL',
  [b.start_date_awal, b.end_date_awal, b.day_count_awal],
  [null, null, null]
);

// Mengirim tanggal yang SAMA persis juga tidak dianggap perubahan.
const B2 = await ajukan();
await q(`select setujui_cuti($1,'approved',null,$2::date,$3::date)`, [B2, '2026-09-04', '2026-09-08']);
benar('§2 tanggal identik bukan "perubahan"', (await baca(B2)).start_date_awal === null);

// =====================================================================
// §3. MEMPERLUAS DITOLAK — ini penjaga yang paling penting.
// =====================================================================
const C = await ajukan();
const pesanLuas = await gagalkan(() =>
  q(`select setujui_cuti($1,'approved',null,$2::date,$3::date)`, [C, '2026-09-06', '2026-09-10'])
);
benar('§3 rentang di luar pengajuan ditolak', pesanLuas !== null);
benar(
  '§3 pesannya menyebut rentang yang diajukan',
  (pesanLuas ?? '').includes('04 Sep 2026') && (pesanLuas ?? '').includes('08 Sep 2026'),
  'admin perlu tahu batas yang berlaku, bukan sekadar bahwa ia salah'
);
cek('§3 dan pengajuannya tidak tersentuh', (await baca(C)).status, 'pending');

const pesanMundur = await gagalkan(() =>
  q(`select setujui_cuti($1,'approved',null,$2::date,$3::date)`, [C, '2026-09-02', '2026-09-08'])
);
benar('§3 mulai lebih awal dari yang diajukan juga ditolak', pesanMundur !== null);

const pesanTerbalik = await gagalkan(() =>
  q(`select setujui_cuti($1,'approved',null,$2::date,$3::date)`, [C, '2026-09-08', '2026-09-06'])
);
benar('§3 selesai sebelum mulai ditolak', pesanTerbalik !== null);

// =====================================================================
// §4. Menolak: tanggal yang dikirim diabaikan, bukan disimpan.
// =====================================================================
const D = await ajukan();
await q(`select setujui_cuti($1,'rejected','jadwal padat',$2::date,$3::date)`, [D, '2026-09-06', '2026-09-08']);
const d = await baca(D);
cek('§4 status ditolak', d.status, 'rejected');
cek(
  '§4 INTI: tanggalnya tetap apa adanya',
  [d.start_date, d.end_date, d.day_count],
  ['2026-09-04', '2026-09-08', 5]
);
cek('§4 tidak ada jejak perubahan', d.start_date_awal, null);

// =====================================================================
// §5. Wewenang.
// =====================================================================
const E = await ajukan();
await sebagai(ORANG_LAIN);
benar(
  '§5 staff biasa ditolak',
  (await gagalkan(() => q(`select setujui_cuti($1,'approved',null,null,null)`, [E]))) !== null
);
await sebagai(RIFKI);
benar(
  '§5 pemohon tidak bisa menyetujui dirinya sendiri',
  (await gagalkan(() => q(`select setujui_cuti($1,'approved',null,null,null)`, [E]))) !== null
);
cek('§5 pengajuannya tetap pending', (await baca(E)).status, 'pending');

// =====================================================================
// §6. Tidak bisa diproses dua kali.
// =====================================================================
await sebagai(ADMIN);
await q(`select setujui_cuti($1,'approved',null,null,null)`, [E]);
benar(
  '§6 pengajuan yang sudah diproses ditolak',
  (await gagalkan(() => q(`select setujui_cuti($1,'rejected',null,null,null)`, [E]))) !== null,
  'tanpa ini, persetujuan bisa dibalik diam-diam sesudah staff terlanjur mengatur harinya'
);

// Status ngawur juga ditolak.
const F = await ajukan();
benar(
  '§6 status selain approved/rejected ditolak',
  (await gagalkan(() => q(`select setujui_cuti($1,'pending',null,null,null)`, [F]))) !== null
);

// =====================================================================
// §7. Jadwal shift (0113) memakai tanggal yang DISETUJUI.
//
// Kalau ia masih memakai tanggal pengajuan, tanggal 4–5 tetap terkunci "cuti"
// di jadwal padahal orangnya justru diharapkan masuk.
//
// ORANG TERSENDIRI, dan itu bukan kerapian. Percobaan pertama memakai Rifki —
// yang di §2 dan §6 punya pengajuan LAIN yang disetujui utuh 4–8. Tanggal 4–5
// memang terkunci, oleh pengajuan yang berbeda, dan tesnya merah pada kode
// yang benar. Pemeriksaan yang datanya tercampur tidak menguji apa pun.
// =====================================================================
const DINA = '44444444-4444-4444-4444-444444444444';
await q(`insert into user_profiles (id, full_name) values ($1,'Dina')`, [DINA]);
await q(`insert into membership_scopes (user_id, business_unit_id, outlet_id, role) values ($1,$2,$3,'staff')`, [DINA, BU, OUT]);
const G = (
  await satu(
    `insert into leave_requests (user_id, business_unit_id, outlet_id, leave_type_id, start_date, end_date, day_count)
     values ($1,$2,$3,$4,'2026-09-04','2026-09-08',5) returning id`,
    [DINA, BU, OUT, JENIS]
  )
).id;
await sebagai(ADMIN);
await q(`select setujui_cuti($1,'approved',null,$2::date,$3::date)`, [G, '2026-09-06', '2026-09-08']);

const tanggalCuti = (
  await q(`select tanggal::text from cuti_disetujui_rentang($1, $2::date, $3::date) where user_id = $4 order by tanggal`, [
    OUT,
    '2026-09-01',
    '2026-09-30',
    DINA
  ])
).rows.map((r) => r.tanggal);

cek('§7 tepat 3 hari terkunci', tanggalCuti.length, 3);
benar('§7 tanggal 6–8 terkunci cuti', ['2026-09-06', '2026-09-07', '2026-09-08'].every((t) => tanggalCuti.includes(t)));
benar(
  '§7 INTI: tanggal 4–5 TIDAK terkunci',
  !tanggalCuti.includes('2026-09-04') && !tanggalCuti.includes('2026-09-05'),
  'hari yang tidak jadi cuti harus bisa dijadwalkan seperti biasa'
);

if (gagal === 0) console.log('Migration 0117: semua pemeriksaan lulus. ✅');
process.exit(gagal === 0 ? 0 : 1);
