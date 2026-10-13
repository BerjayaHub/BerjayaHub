/**
 * 0160 — TUGAS LUAR DI JADWAL SHIFT (PGlite — Postgres sungguhan).
 *
 *   §1 Jenis bawaan untuk BU yang ada, DAN untuk BU yang lahir sesudahnya.
 *   §2 Constraint tiga keadaan: tiap keadaan sah, tiap campuran ditolak.
 *   §3 Jenis milik BU lain ditolak trigger.
 *   §4 Status presensi hari tugas luar = 'tugas_luar', bukan 'no_schedule'.
 *   §5 Pembaca lama (`is_off = false AND shift_id is not null`) tetap kebal.
 *   §6 Jenis yang dipakai jadwal tidak bisa dihapus.
 *   §7 Rekap per jenis.
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

// Zona sesinya dipaksa UTC, sama dengan Supabase. Alasan panjangnya di
// `test-migrasi-0156.mjs`: PGlite tidak memakai UTC secara bawaan, dan §4 di
// bawah bergantung pada `at time zone 'Asia/Jakarta'` yang hanya bisa salah
// kalau zona sesinya memang UTC.
await db.exec(`set time zone 'UTC'`);

const BOOTSTRAP = `
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

  create table outlet_shifts (
    id uuid primary key default gen_random_uuid(),
    outlet_id uuid references outlets(id) on delete cascade,
    name text, start_time time, end_time time
  );
  create table shift_settings (business_unit_id uuid, late_tolerance_minutes int);

  -- Bentuknya SAMA dengan 0034, termasuk constraint lamanya: migration 0160
  -- harus benar-benar men-drop shift_or_off, dan kalau tes ini membuat
  -- tabelnya tanpa constraint itu, bagian terpenting 0160 tidak diuji.
  --
  -- Nama constraintnya sengaja ditulis TANPA backtick. Berkas ini menaruh
  -- skemanya di dalam template literal JS, dan satu backtick di dalamnya
  -- mengakhiri literalnya — galatnya muncul sebagai SyntaxError di baris
  -- komentar, yang tidak menyebut sebab sesungguhnya sama sekali.
  create table shift_schedules (
    id uuid primary key default gen_random_uuid(),
    business_unit_id uuid not null references business_units(id) on delete cascade,
    outlet_id uuid not null references outlets(id) on delete cascade,
    user_id uuid not null references user_profiles(id) on delete cascade,
    work_date date not null,
    shift_id uuid references outlet_shifts(id) on delete cascade,
    is_off boolean not null default false,
    note text,
    updated_by uuid references user_profiles(id) on delete set null,
    updated_at timestamptz not null default now(),
    unique (outlet_id, user_id, work_date),
    constraint shift_or_off check ((is_off and shift_id is null) or (not is_off and shift_id is not null))
  );

  create table attendance_records (
    id uuid primary key default gen_random_uuid(),
    user_id uuid references user_profiles(id) on delete cascade,
    outlet_id uuid references outlets(id) on delete set null,
    nbm_outlet_id uuid references outlets(id) on delete set null,
    clock_in_at timestamptz,
    clock_out_at timestamptz,
    is_storing boolean default false,
    late_status text,
    late_minutes int,
    shift_name text,
    constraint attendance_records_late_status_check
      check (late_status in ('ontime', 'tolerance', 'late', 'no_schedule', 'off_day'))
  );

  create or replace function has_bu_scope(p_uid uuid, p_bu uuid) returns boolean language sql stable as $$
    select exists (select 1 from membership_scopes where user_id = p_uid and business_unit_id = p_bu);
  $$;
  create or replace function is_bu_admin(p_uid uuid, p_bu uuid) returns boolean language sql stable as $$
    select exists (select 1 from membership_scopes where user_id = p_uid and business_unit_id = p_bu and role in ('bu_admin','super_admin'));
  $$;
`;
await db.exec(BOOTSTRAP);

// ============ DATA SEBELUM MIGRATION ============
const BU = (await satu(`insert into business_units (name) values ('Cafe') returning id`)).id;
const LAIN = (await satu(`insert into business_units (name) values ('Resto') returning id`)).id;
const OUT = (await satu(`insert into outlets (business_unit_id, name) values ($1,'CK') returning id`, [BU])).id;
const OUT2 = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Dago') returning id`, [BU])).id;
const STAFF = '11111111-1111-1111-1111-111111111111';
const ADMIN = '22222222-2222-2222-2222-222222222222';
await q(`insert into user_profiles (id, full_name) values ($1,'Staff'),($2,'Admin')`, [STAFF, ADMIN]);
await q(`insert into membership_scopes (user_id, business_unit_id, role) values ($1,$3,'staff'), ($2,$3,'bu_admin')`, [
  STAFF,
  ADMIN,
  BU
]);
const SHIFT_PAGI = (
  await satu(`insert into outlet_shifts (outlet_id, name, start_time, end_time) values ($1,'Pagi','08:00','16:00') returning id`, [
    OUT
  ])
).id;
await q(`insert into shift_settings (business_unit_id, late_tolerance_minutes) values ($1, 10)`, [BU]);

const sql = fs.readFileSync(path.join(AKAR, 'supabase/migrations/0160_tugas_luar_di_jadwal.sql'), 'utf8');
await db.exec(sql.replace(/notify pgrst[^;]*;/g, ''));
console.log('  0160 terpasang.');

const jenis = (nama, bu = BU) =>
  satu(`select * from tugas_luar_types where business_unit_id=$1 and nama=$2`, [bu, nama]);

// =====================================================================
// §1 JENIS BAWAAN
// =====================================================================
console.log('\n§1 Jenis bawaan');

cek('1. empat jenis untuk BU yang sudah ada', Number((await satu(`select count(*) n from tugas_luar_types where business_unit_id=$1`, [BU])).n), 4);
benar('1. "Antar Barang" ada', !!(await jenis('Antar Barang')));
cek('1. BU kedua juga dapat', Number((await satu(`select count(*) n from tugas_luar_types where business_unit_id=$1`, [LAIN])).n), 4);

// ============ BU YANG LAHIR SESUDAH MIGRATION ============
//
// Pelajaran dari 0159, yang tesnya sendiri yang menemukannya di sana: `insert`
// seed hanya mengurus BU yang ADA saat migration jalan. Tanpa trigger, admin
// di BU berikutnya membuka dropdown jenis dan menemukannya kosong — dan tidak
// ada satu pun kalimat di layar yang bisa ia kerjakan.
const BARU = (await satu(`insert into business_units (name) values ('Katering') returning id`)).id;
cek('1. INTI: BU yang dibuat SESUDAH migration ikut dapat jenis bawaan', Number((await satu(`select count(*) n from tugas_luar_types where business_unit_id=$1`, [BARU])).n), 4);

// Ternormalkan: "antar  barang" bukan jenis kedua.
const kembar = await galat(() => q(`insert into tugas_luar_types (business_unit_id, nama) values ($1,'antar  barang')`, [BU]));
benar('1. ejaan beda spasi/huruf ditolak indeks unik', /unique|duplicate/i.test(kembar ?? ''), kembar);

// =====================================================================
// §2 TIGA KEADAAN
// =====================================================================
console.log('\n§2 Constraint tiga keadaan');

const TL = (await jenis('Antar Barang')).id;
const sel = (kol, nilai, tgl) =>
  q(
    `insert into shift_schedules (business_unit_id, outlet_id, user_id, work_date, ${kol}) values ($1,$2,$3,$4,${nilai})`,
    [BU, OUT, STAFF, tgl]
  );

// Ketiga keadaan yang SAH.
benar('2. shift biasa diterima', !(await galat(() => sel('shift_id', `'${SHIFT_PAGI}'`, '2026-10-01'))));
benar('2. libur diterima', !(await galat(() => sel('is_off', 'true', '2026-10-02'))));
benar(
  '2. INTI: tugas luar diterima',
  !(await galat(() => sel('is_tugas_luar, tugas_luar_type_id', `true, '${TL}'`, '2026-10-03')))
);
benar(
  '2. tugas luar dengan outlet tujuan diterima',
  !(await galat(() => sel('is_tugas_luar, tugas_luar_type_id, tugas_luar_outlet_id', `true, '${TL}', '${OUT2}'`, '2026-10-04')))
);

// ============ DAN SETIAP CAMPURANNYA DITOLAK ============
//
// Ini bagian yang paling mudah dilonggarkan tanpa terlihat: constraint yang
// ditulis sebagai "paling banyak satu yang true" meloloskan SHIFT yang membawa
// jenis tugas luar, dan LIBUR yang membawa outlet tujuan. Keduanya tidak akan
// pernah terlihat salah di layar — datanya cuma jadi tidak bisa dipercaya saat
// direkap, berbulan-bulan kemudian.
const tolak = async (nama, kol, nilai, tgl) => {
  const e = await galat(() => sel(kol, nilai, tgl));
  benar(nama, /shift_libur_atau_tugas_luar|constraint/i.test(e ?? ''), e ?? 'DITERIMA, padahal harus ditolak');
};
await tolak('2. tugas luar TANPA jenis ditolak', 'is_tugas_luar', 'true', '2026-10-05');
await tolak('2. tugas luar + shift sekaligus ditolak', 'is_tugas_luar, tugas_luar_type_id, shift_id', `true, '${TL}', '${SHIFT_PAGI}'`, '2026-10-06');
await tolak('2. tugas luar + libur sekaligus ditolak', 'is_tugas_luar, tugas_luar_type_id, is_off', `true, '${TL}', true`, '2026-10-07');
await tolak('2. INTI: SHIFT yang membawa jenis tugas luar ditolak', 'shift_id, tugas_luar_type_id', `'${SHIFT_PAGI}', '${TL}'`, '2026-10-08');
await tolak('2. INTI: LIBUR yang membawa outlet tujuan ditolak', 'is_off, tugas_luar_outlet_id', `true, '${OUT2}'`, '2026-10-09');
await tolak('2. sel tanpa keterangan apa pun tetap mustahil', 'note', `'kosong'`, '2026-10-10');

// `shift_or_off` lama benar-benar hilang — kalau masih ada, §2 di atas lolos
// karena constraint LAIN, dan 0160 belum tentu mengerjakan apa pun.
cek(
  '2. constraint lama `shift_or_off` di-drop',
  Number((await satu(`select count(*) n from pg_constraint where conname='shift_or_off'`)).n),
  0
);

// =====================================================================
// §3 JENIS MILIK BU LAIN
// =====================================================================
console.log('\n§3 Jenis milik BU lain');

const TL_LAIN = (await jenis('Belanja', LAIN)).id;
const silang = await galat(() => sel('is_tugas_luar, tugas_luar_type_id', `true, '${TL_LAIN}'`, '2026-10-11'));
benar('3. INTI: jenis milik BU lain ditolak trigger', /BU lain/i.test(silang ?? ''), silang ?? 'DITERIMA');

const hantu = await galat(() =>
  sel('is_tugas_luar, tugas_luar_type_id', `true, '00000000-0000-0000-0000-000000000000'`, '2026-10-12')
);
benar('3. jenis yang tidak ada ditolak', !!hantu, hantu);

// =====================================================================
// §4 STATUS PRESENSI
// =====================================================================
console.log('\n§4 Status presensi hari tugas luar');

const presensi = async (jam, tgl) =>
  (
    await satu(
      `insert into attendance_records (user_id, outlet_id, nbm_outlet_id, clock_in_at) values ($1,$2,$2,$3) returning id`,
      [STAFF, OUT, `${tgl} ${jam}+07`]
    )
  ).id;

// 3 Okt = tugas luar (dijadwalkan di §2).
const recTL = await presensi('09:30', '2026-10-03');
const hasilTL = await satu(`select * from hitung_ulang_status_shift($1)`, [recTL]);
cek('4. INTI: hari tugas luar berstatus `tugas_luar`, bukan `no_schedule`', hasilTL.status, 'tugas_luar');
cek('4. tanpa menit terlambat', hasilTL.menit, null);
cek('4. dan tanpa nama shift', hasilTL.nama_shift, null);
cek(
  '4. tersimpan ke barisnya, bukan cuma dipulangkan',
  (await satu(`select late_status from attendance_records where id=$1`, [recTL])).late_status,
  'tugas_luar'
);

// 2 Okt = libur. Harus TETAP `off_day` — cabang baru tidak boleh menelannya.
const recOff = await presensi('09:30', '2026-10-02');
cek('4. hari libur tetap `off_day`', (await satu(`select * from hitung_ulang_status_shift($1)`, [recOff])).status, 'off_day');

// 1 Okt = shift Pagi 08:00, masuk 09:30 -> terlambat 90 menit. Jalur normalnya
// tidak boleh tergeser oleh cabang baru di atasnya.
const recLate = await presensi('09:30', '2026-10-01');
const hasilLate = await satu(`select * from hitung_ulang_status_shift($1)`, [recLate]);
cek('4. shift biasa tetap dinilai terlambat', hasilLate.status, 'late');
cek('4. menitnya tetap benar', Number(hasilLate.menit), 90);

// Tanpa jadwal sama sekali -> tetap `no_schedule`.
const recNo = await presensi('09:30', '2026-11-20');
cek('4. tanpa jadwal tetap `no_schedule`', (await satu(`select * from hitung_ulang_status_shift($1)`, [recNo])).status, 'no_schedule');

// =====================================================================
// §5 PEMBACA LAMA TETAP KEBAL
// =====================================================================
console.log('\n§5 Pembaca lama');

// ============ KENAPA INI DIUJI DI SINI ============
//
// Bentuk `is_off = false AND shift_id is not null` dipakai `jadwal_belum_clock_in`
// di 0105, 0107, dan 0109. Komentar di 0109 menuliskan alasannya: "Kalau suatu
// saat constraint-nya dilonggarkan, yang tersisa di sini tetap menahan."
//
// Hari ini constraintnya dilonggarkan. Pemeriksaan ini membuktikan kalimat itu
// benar — bukan mempercayainya. Kalau suatu saat seseorang menyederhanakan
// salah satu kueri itu menjadi `is_off = false` saja, staff yang sedang tugas
// luar akan dilencanai "belum clock in" di seluruh dashboard admin.
cek(
  '5. INTI: bentuk lama mengecualikan tugas luar dengan sendirinya',
  Number(
    (
      await satu(
        `select count(*) n from shift_schedules
          where user_id=$1 and work_date='2026-10-03' and is_off = false and shift_id is not null`,
        [STAFF]
      )
    ).n
  ),
  0
);
cek(
  '5. tapi `is_off = false` SENDIRIAN akan memuatnya — itu sebabnya dua baris itu dipertahankan',
  Number(
    (await satu(`select count(*) n from shift_schedules where user_id=$1 and work_date='2026-10-03' and is_off = false`, [STAFF])).n
  ),
  1
);
// Tutup otomatis (0138) memakai inner join ke outlet_shifts — baris tugas luar
// gugur sendiri, dan itu benar: tidak ada jam pulang yang bisa dipakai.
cek(
  '5. inner join ke outlet_shifts menggugurkan tugas luar',
  Number(
    (
      await satu(
        `select count(*) n from shift_schedules ss join outlet_shifts os on os.id = ss.shift_id
          where ss.user_id=$1 and ss.work_date='2026-10-03'`,
        [STAFF]
      )
    ).n
  ),
  0
);

// =====================================================================
// §6 JENIS YANG DIPAKAI
// =====================================================================
console.log('\n§6 Jenis yang dipakai jadwal');

const hapus = await galat(() => q(`delete from tugas_luar_types where id=$1`, [TL]));
benar('6. INTI: jenis yang dipakai jadwal tidak bisa dihapus', /violates foreign key|restrict/i.test(hapus ?? ''), hapus ?? 'TERHAPUS');
// Jalan keluarnya: dinonaktifkan, bukan dihapus. Hari kerja orang tidak ikut hilang.
benar('6. tapi bisa dinonaktifkan', !(await galat(() => q(`update tugas_luar_types set aktif=false where id=$1`, [TL]))));
cek(
  '6. dan jadwal lamanya utuh',
  Number((await satu(`select count(*) n from shift_schedules where tugas_luar_type_id=$1`, [TL])).n),
  2
);
await q(`update tugas_luar_types set aktif=true where id=$1`, [TL]);

// =====================================================================
// §7 REKAP
// =====================================================================
console.log('\n§7 Rekap per jenis');

await sebagai(ADMIN);
const rekap = (await q(`select * from rekap_tugas_luar($1,'2026-10-01','2026-10-31')`, [BU])).rows;
cek('7. satu baris per staff per jenis', rekap.length, 1);
cek('7. jenisnya disebut', rekap[0].jenis, 'Antar Barang');
cek('7. jumlah harinya benar', Number(rekap[0].jumlah_hari), 2);

// Orang luar BU tidak boleh membacanya dengan menebak satu uuid.
const LUAR = '33333333-3333-3333-3333-333333333333';
await q(`insert into user_profiles (id, full_name) values ($1,'Orang Luar')`, [LUAR]);
await sebagai(LUAR);
cek(
  '7. INTI: orang di luar BU dapat nol baris, bukan isinya',
  (await q(`select * from rekap_tugas_luar($1,'2026-10-01','2026-10-31')`, [BU])).rows.length,
  0
);
await sebagai(ADMIN);

// =====================================================================
// §8 DIJALANKAN ULANG
// =====================================================================
console.log('\n§8 Dijalankan ulang');

const sebelum = Number((await satu(`select count(*) n from tugas_luar_types`)).n);
await db.exec(sql.replace(/notify pgrst[^;]*;/g, ''));
cek('8. aman dijalankan dua kali — jenisnya tidak berlipat', Number((await satu(`select count(*) n from tugas_luar_types`)).n), sebelum);
cek(
  '8. constraintnya tidak digandakan',
  Number((await satu(`select count(*) n from pg_constraint where conname='shift_libur_atau_tugas_luar'`)).n),
  1
);
cek(
  '8. jadwal tugas luar yang sudah ada tetap sah sesudah migration diulang',
  Number((await satu(`select count(*) n from shift_schedules where is_tugas_luar`)).n),
  2
);

console.log('');
if (gagal === 0) console.log(`${n} pemeriksaan 0160 lolos. ✅`);
else console.error(`${gagal} dari ${n} pemeriksaan GAGAL.`);
process.exit(gagal === 0 ? 0 : 1);
