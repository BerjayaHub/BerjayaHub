/**
 * MIGRATION 0138 DI POSTGRES SUNGGUHAN (PGlite).
 *
 * ============ YANG DIUJI ============
 *
 *   1. Setelan berlaku: penimpa outlet -> bawaan BU -> bawaan aplikasi,
 *      dan penimpaannya PER KOLOM.
 *   2. Jendela jam istirahat ditegakkan SERVER, termasuk jendela yang melewati
 *      tengah malam. Kalau cuma aturan tampilan, ia bukan aturan.
 *   3. Kembali dari istirahat TIDAK dibatasi jendela — menolaknya cuma
 *      menghukum orang yang kembali lebih awal.
 *   4. Lupa kembali -> ditutup di mulai + 2 jam, dan ditandai otomatis.
 *   5. Clock out otomatis memakai JAM PULANG SHIFT, bukan jam pemicunya.
 *      Kalau tertukar, staff yang lupa clock out tercatat lembur 4 jam yang
 *      tidak pernah terjadi — di sistem yang membayar lembur bertingkat.
 *   6. Shift lintas tengah malam pulang HARI BERIKUTNYA, dan jam keluar tidak
 *      pernah mendahului jam masuk.
 *   7. Yang belum lewat batas TIDAK disentuh.
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
const gagalkan = async (fn) => {
  try {
    await fn();
    return null;
  } catch (e) {
    return String(e.message ?? e);
  }
};

await db.exec(`
  create role authenticated;
  create schema if not exists auth;
  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
  $$;

  create table business_units (id uuid primary key default gen_random_uuid(), name text);
  create table outlets (id uuid primary key default gen_random_uuid(), business_unit_id uuid, name text);
  create table user_profiles (id uuid primary key, full_name text);
  create table attendance_records (
    id uuid primary key default gen_random_uuid(),
    user_id uuid, business_unit_id uuid, outlet_id uuid,
    clock_in_at timestamptz not null default now(), clock_out_at timestamptz,
    created_at timestamptz not null default now());
  create table outlet_shifts (
    id uuid primary key default gen_random_uuid(),
    business_unit_id uuid, outlet_id uuid, slot int, name text,
    start_time time not null, end_time time not null, is_active boolean default true);
  create table shift_schedules (
    id uuid primary key default gen_random_uuid(),
    business_unit_id uuid, outlet_id uuid, user_id uuid,
    work_date date not null, shift_id uuid, is_off boolean not null default false);

  create or replace function has_bu_scope(p_uid uuid, p_bu uuid) returns boolean
    language sql stable as $$ select p_uid is not null $$;
  create or replace function is_bu_admin(p_uid uuid, p_bu uuid) returns boolean
    language sql stable as $$ select p_uid is not null $$;
`);

const jalankan = async (b) =>
  db.exec(fs.readFileSync(path.join(AKAR, 'supabase/migrations', b), 'utf8').replace(/notify pgrst[^;]*;/g, ''));

await jalankan('0138_istirahat_dan_tutup_otomatis.sql');
console.log('  0138 terpasang.');
await jalankan('0138_istirahat_dan_tutup_otomatis.sql');
console.log('  dijalankan ulang: aman.');

const BU = (await satu(`insert into business_units (name) values ('Cafe') returning id`)).id;
const OUT = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Sentul') returning id`, [BU])).id;
const OUT2 = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Serpong') returning id`, [BU])).id;
const STAFF = '11111111-1111-1111-1111-111111111111';
const LAIN = '22222222-2222-2222-2222-222222222222';
await q(`insert into user_profiles (id, full_name) values ($1,'Risma'), ($2,'Adhe')`, [STAFF, LAIN]);
await q(`select set_config('request.jwt.claim.sub', $1, false)`, [STAFF]);

// =====================================================================
// §1 SETELAN BERLAKU — outlet menimpa BU, PER KOLOM
// =====================================================================
let s = await satu(`select * from setelan_presensi($1)`, [OUT]);
cek('§1 tanpa setelan: bawaan bebas', s.break_mode, 'bebas');
cek('§1 bawaan jam kerja 8', Number(s.standard_work_hours), 8);
cek('§1 bawaan batas tutup 12', Number(s.auto_close_after_hours), 12);
cek('§1 sumbernya bawaan', s.dari, 'bawaan');

await q(
  `insert into attendance_settings (business_unit_id, outlet_id, break_mode, break_start, break_end, standard_work_hours, auto_close_after_hours)
   values ($1, null, 'ditentukan', '12:00', '13:00', 7, 10)`,
  [BU]
);
s = await satu(`select * from setelan_presensi($1)`, [OUT]);
cek('§1 setelan BU dipakai', [s.break_mode, Number(s.standard_work_hours)], ['ditentukan', 7]);
cek('§1 sumbernya bu', s.dari, 'bu');

// Outlet menimpa HANYA jam istirahatnya; jam kerja BU harus tetap terpakai.
await q(
  `insert into attendance_settings (business_unit_id, outlet_id, break_mode, break_start, break_end)
   values ($1, $2, 'ditentukan', '14:00', '15:00')`,
  [BU, OUT]
);
s = await satu(`select * from setelan_presensi($1)`, [OUT]);
cek('§1 outlet menimpa jam istirahatnya', [String(s.break_start).slice(0, 5), String(s.break_end).slice(0, 5)], ['14:00', '15:00']);
cek('§1 tapi jam kerja BU tetap terpakai', Number(s.standard_work_hours), 7);
cek('§1 sumbernya outlet', s.dari, 'outlet');

// Outlet lain tidak ikut terpengaruh.
cek('§1 outlet lain tetap ikut BU', String((await satu(`select * from setelan_presensi($1)`, [OUT2])).break_start).slice(0, 5), '12:00');

// Dua baris bawaan BU MUSTAHIL — `unique(bu, outlet)` biasa tidak mencegahnya
// karena NULL tidak pernah sama dengan NULL.
const duaBu = await gagalkan(() =>
  q(`insert into attendance_settings (business_unit_id, outlet_id) values ($1, null)`, [BU])
);
benar('§1 dua baris bawaan BU ditolak', !!duaBu);

// Mode 'ditentukan' tanpa jamnya adalah setelan yang tidak bisa dijalankan.
const pincang = await gagalkan(() =>
  q(`insert into attendance_settings (business_unit_id, outlet_id, break_mode) values ($1, $2, 'ditentukan')`, [BU, OUT2])
);
benar('§1 mode ditentukan tanpa jam ditolak', !!pincang);

// =====================================================================
// §2 JENDELA JAM DITEGAKKAN SERVER
// =====================================================================
const REC = (await satu(
  `insert into attendance_records (user_id, business_unit_id, outlet_id, clock_in_at)
   values ($1,$2,$3, now() - interval '2 hours') returning id`,
  [STAFF, BU, OUT]
)).id;

// JENDELANYA DIHITUNG RELATIF TERHADAP "SEKARANG", bukan dipatok 14:00–15:00.
//
// Percobaan pertama memakai jendela tetap lalu bercabang: "kalau jam nyatanya
// kebetulan di dalam, harap diterima; kalau di luar, harap ditolak". Artinya
// berubah menurut kapan tesnya dijalankan — dan saat ia jatuh di cabang
// "diterima", ia lolos BAIK DENGAN MAUPUN TANPA penjaganya. Sabotase yang
// mematikan penegakan jendela di server lolos persis begitu.
//
// Sekarang keduanya diuji tanpa syarat, dengan jendela yang pasti.

// (a) Jendela yang PASTI TIDAK memuat sekarang: dua sampai tiga jam lagi.
await q(
  `update attendance_settings
      set break_mode = 'ditentukan',
          break_start = ((now() at time zone 'Asia/Jakarta') + interval '2 hours')::time,
          break_end   = ((now() at time zone 'Asia/Jakarta') + interval '3 hours')::time
    where outlet_id = $1`,
  [OUT]
);
const diLuar = await gagalkan(() => q(`select mulai_istirahat($1, 'o/selfie.jpg', true)`, [REC]));
benar('§2 di luar jendela: ditolak SERVER', !!diLuar);
benar('§2 pesannya menyebut jam jendelanya', /\d{2}:\d{2}.*\d{2}:\d{2}/.test(diLuar ?? ''), diLuar ?? '');

// (b) Jendela yang PASTI memuat sekarang: satu jam lalu sampai satu jam lagi.
//     Keduanya tetap benar walau jendelanya melewati tengah malam.
await q(
  `update attendance_settings
      set break_start = ((now() at time zone 'Asia/Jakarta') - interval '1 hour')::time,
          break_end   = ((now() at time zone 'Asia/Jakarta') + interval '1 hour')::time
    where outlet_id = $1`,
  [OUT]
);
const diDalam = await gagalkan(() => q(`select mulai_istirahat($1, 'o/selfie.jpg', true)`, [REC]));
benar('§2 di dalam jendela: diterima', !diDalam, diDalam ?? '');
await q(`delete from attendance_breaks where attendance_id = $1`, [REC]);

// Mode bebas: kapan pun boleh.
await q(`update attendance_settings set break_mode = 'bebas' where outlet_id = $1`, [OUT]);
await q(`delete from attendance_breaks where attendance_id = $1`, [REC]);
const bebas = await gagalkan(() => q(`select mulai_istirahat($1, 'o/selfie.jpg', true)`, [REC]));
benar('§2 mode bebas: diterima kapan pun', !bebas, bebas ?? '');

// Satu istirahat berjalan saja.
const kembar = await gagalkan(() => q(`select mulai_istirahat($1, 'o/selfie.jpg', true)`, [REC]));
benar('§2 istirahat kedua saat yang pertama berjalan: ditolak', !!kembar);

// INDEKS UNIKNYA DIPERIKSA SENDIRI, bukan disandarkan pada penolakan di atas.
//
// `mulai_istirahat` sudah memeriksanya lebih dulu, jadi penolakan itu tetap
// terjadi walau indeksnya dicabut — dan sabotase yang mencabut indeksnya lolos
// persis begitu. Yang dijaga indeks ini adalah hal yang TIDAK BISA diuji dari
// satu koneksi: dua ketukan tombol beruntun di sinyal lemah, yang keduanya
// lolos pemeriksaan sebelum salah satunya menulis. Istirahat kedua yang
// terlanjur masuk tidak akan pernah bisa ditutup dari layar.
const indeksSatu = await satu(
  `select indexdef from pg_indexes where indexname = 'attendance_breaks_satu_berjalan'`
);
benar('§2 indeks unik "satu istirahat berjalan" ada', !!indeksSatu);
benar(
  '§2 dan ia PARSIAL (hanya yang belum selesai)',
  /where \(selesai_at is null\)/i.test(indeksSatu?.indexdef ?? ''),
  indeksSatu?.indexdef ?? ''
);

// FOTO WAJIB — gerbang yang sama dengan clock in/out.
//
// Tanpa ini, istirahat jadi satu-satunya tombol presensi yang bisa ditekan
// dari rumah dan atas nama orang lain — dan justru tombol itu yang paling
// sering ditekan dalam sehari.
await q(`delete from attendance_breaks where attendance_id = $1`, [REC]);
const mulaiTanpaFoto = await gagalkan(() => q(`select mulai_istirahat($1, null, true)`, [REC]));
benar('§2 mulai istirahat tanpa foto: ditolak', !!mulaiTanpaFoto);
benar('§2 pesannya menyuruh ambil selfie', /selfie/i.test(mulaiTanpaFoto ?? ''), mulaiTanpaFoto ?? '');
const mulaiFotoKosong = await gagalkan(() => q(`select mulai_istirahat($1, '   ', true)`, [REC]));
benar('§2 foto berisi spasi saja: ditolak', !!mulaiFotoKosong);

await q(`select mulai_istirahat($1, 'o/selfie.jpg', true)`, [REC]);
const selesaiTanpaFoto = await gagalkan(() => q(`select selesai_istirahat($1, null, true)`, [REC]));
benar('§2 kembali tanpa foto: ditolak', !!selesaiTanpaFoto);
cek(
  '§2 dan istirahatnya MASIH berjalan',
  Number((await satu(`select count(*)::int c from attendance_breaks where attendance_id = $1 and selesai_at is null`, [REC])).c),
  1
);

// Bentuk LAMA (satu argumen) harus benar-benar hilang. Kalau ia hidup
// berdampingan, PWA lama tetap bisa memanggilnya tanpa foto — dan seluruh
// gerbang buktinya jadi opsional tanpa ada yang tahu.
const bentukLama = await gagalkan(() => q(`select mulai_istirahat($1)`, [REC]));
benar('§2 bentuk lama tanpa foto sudah tidak ada', !!bentukLama);

// Presensi orang lain.
await q(`select set_config('request.jwt.claim.sub', $1, false)`, [LAIN]);
const bukanMilikku = await gagalkan(() => q(`select mulai_istirahat($1, 'o/selfie.jpg', true)`, [REC]));
benar('§2 presensi orang lain ditolak', !!bukanMilikku);
await q(`select set_config('request.jwt.claim.sub', $1, false)`, [STAFF]);

// =====================================================================
// §3 KEMBALI TIDAK DIBATASI JENDELA
// =====================================================================
await q(`update attendance_settings set break_mode = 'ditentukan', break_start = '03:00', break_end = '03:30' where outlet_id = $1`, [OUT]);
const kembali = await gagalkan(() => q(`select selesai_istirahat($1, 'o/selfie2.jpg', true)`, [REC]));
benar('§3 kembali di luar jendela tetap boleh', !kembali, kembali ?? '');
const b1 = await satu(`select selesai_at, otomatis from attendance_breaks where attendance_id = $1`, [REC]);
benar('§3 istirahatnya tertutup', !!b1.selesai_at);
cek('§3 dan TIDAK ditandai otomatis', b1.otomatis, false);

const tanpaBerjalan = await gagalkan(() => q(`select selesai_istirahat($1, 'o/selfie2.jpg', true)`, [REC]));
benar('§3 kembali tanpa istirahat berjalan: ditolak', !!tanpaBerjalan);

// =====================================================================
// §4 LUPA KEMBALI -> DITUTUP DI MULAI + 2 JAM
// =====================================================================
await q(`update attendance_settings set break_mode = 'bebas' where outlet_id = $1`, [OUT]);
await q(
  `insert into attendance_breaks (attendance_id, mulai_at) values ($1, now() - interval '5 hours')`,
  [REC]
);
let hasil = await satu(`select * from tutup_presensi_tertinggal()`);
cek('§4 satu istirahat ditutup', Number(hasil.istirahat_ditutup), 1);
const b2 = await satu(
  `select mulai_at, selesai_at, otomatis from attendance_breaks where attendance_id = $1 and otomatis order by mulai_at desc limit 1`,
  [REC]
);
cek('§4 tepat 2 jam sesudah mulai', (new Date(b2.selesai_at) - new Date(b2.mulai_at)) / 3600000, 2);
cek('§4 ditandai otomatis', b2.otomatis, true);
// BUKAN ditutup di "sekarang" — itu 5 jam, dan rekapnya jadi berbeda dari
// batas yang dijanjikan ke staff di layar.
benar('§4 bukan ditutup di waktu sekarang', new Date(b2.selesai_at) < new Date(), '');

// =====================================================================
// §4b LUPA KEMBALI LALU CLOCK OUT — istirahat ikut tertutup
//
// Istirahat TIDAK PERNAH menghalangi orang pulang. Tapi kalau ia dibiarkan
// terbuka, penutup otomatis akan menutupnya di `mulai + 2 jam` — yang bisa
// jatuh SESUDAH jam pulangnya, dan rekapnya berbunyi
// "clock out 17:00 · istirahat 16:30–18:30".
// =====================================================================
const RECX = (await satu(
  `insert into attendance_records (user_id, business_unit_id, outlet_id, clock_in_at)
   values ($1,$2,$3, now() - interval '3 hours') returning id`,
  [STAFF, BU, OUT]
)).id;
// Istirahat mulai 30 menit lalu, lupa ditekan Kembali.
await q(`insert into attendance_breaks (attendance_id, mulai_at) values ($1, now() - interval '30 minutes')`, [RECX]);
await q(`update attendance_records set clock_out_at = now() where id = $1`, [RECX]);

const bx = await satu(`select mulai_at, selesai_at, otomatis from attendance_breaks where attendance_id = $1`, [RECX]);
benar('§4b istirahat ikut tertutup saat clock out', !!bx.selesai_at);
cek('§4b ditandai otomatis (orangnya tidak menekan Kembali)', bx.otomatis, true);
const rx = await satu(`select clock_out_at from attendance_records where id = $1`, [RECX]);
benar(
  '§4b istirahatnya TIDAK berakhir sesudah jam pulang',
  new Date(bx.selesai_at) <= new Date(rx.clock_out_at),
  `${bx.selesai_at} vs ${rx.clock_out_at}`
);
cek('§4b durasinya 30 menit, bukan 2 jam', Math.round((new Date(bx.selesai_at) - new Date(bx.mulai_at)) / 60000), 30);

// Pulang jauh SESUDAH batas 2 jam -> tetap 2 jam, sesuai janji di layar staff.
const RECY = (await satu(
  `insert into attendance_records (user_id, business_unit_id, outlet_id, clock_in_at)
   values ($1,$2,$3, now() - interval '6 hours') returning id`,
  [LAIN, BU, OUT]
)).id;
await q(`insert into attendance_breaks (attendance_id, mulai_at) values ($1, now() - interval '5 hours')`, [RECY]);
await q(`update attendance_records set clock_out_at = now() where id = $1`, [RECY]);
const by = await satu(`select mulai_at, selesai_at from attendance_breaks where attendance_id = $1`, [RECY]);
cek('§4b pulang jauh kemudian: tetap dijepit 2 jam', (new Date(by.selesai_at) - new Date(by.mulai_at)) / 3600000, 2);

// =====================================================================
// §5 CLOCK OUT OTOMATIS — JAM PULANG SHIFT, BUKAN JAM PEMICU
// =====================================================================
const SHIFT = (await satu(
  `insert into outlet_shifts (business_unit_id, outlet_id, slot, name, start_time, end_time)
   values ($1,$2,1,'Pagi','08:00','17:00') returning id`,
  [BU, OUT]
)).id;

// Masuk kemarin 08:00 WIB, belum clock out — sudah lewat batas (10 jam).
const kemarin = (await satu(`select ((now() at time zone 'Asia/Jakarta')::date - 1) as d`)).d;
const REC2 = (await satu(
  `insert into attendance_records (user_id, business_unit_id, outlet_id, clock_in_at)
   values ($1,$2,$3, ($4::date + time '08:00') at time zone 'Asia/Jakarta') returning id`,
  [STAFF, BU, OUT, kemarin]
)).id;
await q(
  `insert into shift_schedules (business_unit_id, outlet_id, user_id, work_date, shift_id)
   values ($1,$2,$3,$4,$5)`,
  [BU, OUT, STAFF, kemarin, SHIFT]
);

hasil = await satu(`select * from tutup_presensi_tertinggal()`);
benar('§5 ada presensi yang ditutup', Number(hasil.presensi_ditutup) >= 1);

const r2 = await satu(`select clock_in_at, clock_out_at, auto_closed_at, auto_closed_reason from attendance_records where id = $1`, [REC2]);
cek(
  '§5 jam keluarnya 17:00 WIB',
  (await satu(`select to_char($1::timestamptz at time zone 'Asia/Jakarta', 'HH24:MI') t`, [r2.clock_out_at])).t,
  '17:00'
);
cek('§5 durasinya 9 jam, bukan 10 (jam pemicu)', (new Date(r2.clock_out_at) - new Date(r2.clock_in_at)) / 3600000, 9);
benar('§5 ditandai ditutup otomatis', !!r2.auto_closed_at);
benar('§5 alasannya menyebut shift', /shift/i.test(r2.auto_closed_reason ?? ''), r2.auto_closed_reason ?? '');

// Tanpa shift terjadwal -> jam kerja standar (BU: 7 jam).
const REC3 = (await satu(
  `insert into attendance_records (user_id, business_unit_id, outlet_id, clock_in_at)
   values ($1,$2,$3, ($4::date + time '09:00') at time zone 'Asia/Jakarta') returning id`,
  [LAIN, BU, OUT, kemarin]
)).id;
await q(`select * from tutup_presensi_tertinggal()`);
const r3 = await satu(`select clock_in_at, clock_out_at, auto_closed_reason from attendance_records where id = $1`, [REC3]);
cek('§5 tanpa shift: 7 jam (setelan BU)', (new Date(r3.clock_out_at) - new Date(r3.clock_in_at)) / 3600000, 7);
benar('§5 alasannya menyebut jam kerja standar', /standar/i.test(r3.auto_closed_reason ?? ''), r3.auto_closed_reason ?? '');

// =====================================================================
// §6 SHIFT LINTAS TENGAH MALAM, DAN JAM KELUAR TIDAK MENDAHULUI MASUK
// =====================================================================
const MALAM = (await satu(
  `insert into outlet_shifts (business_unit_id, outlet_id, slot, name, start_time, end_time)
   values ($1,$2,2,'Malam','22:00','07:00') returning id`,
  [BU, OUT]
)).id;
const duaHariLalu = (await satu(`select ((now() at time zone 'Asia/Jakarta')::date - 2) as d`)).d;
const REC4 = (await satu(
  `insert into attendance_records (user_id, business_unit_id, outlet_id, clock_in_at)
   values ($1,$2,$3, ($4::date + time '22:00') at time zone 'Asia/Jakarta') returning id`,
  [STAFF, BU, OUT, duaHariLalu]
)).id;
await q(
  `insert into shift_schedules (business_unit_id, outlet_id, user_id, work_date, shift_id)
   values ($1,$2,$3,$4,$5)`,
  [BU, OUT, STAFF, duaHariLalu, MALAM]
);
await q(`select * from tutup_presensi_tertinggal()`);
const r4 = await satu(`select clock_in_at, clock_out_at from attendance_records where id = $1`, [REC4]);
cek('§6 shift malam: durasinya 9 jam', (new Date(r4.clock_out_at) - new Date(r4.clock_in_at)) / 3600000, 9);
benar('§6 jam keluar SESUDAH jam masuk', new Date(r4.clock_out_at) > new Date(r4.clock_in_at));

// Masuk jauh SESUDAH shiftnya usai -> jam shift akan jatuh sebelum masuk.
const REC5 = (await satu(
  `insert into attendance_records (user_id, business_unit_id, outlet_id, clock_in_at)
   values ($1,$2,$3, ($4::date + time '19:00') at time zone 'Asia/Jakarta') returning id`,
  [LAIN, BU, OUT, duaHariLalu]
)).id;
await q(
  `insert into shift_schedules (business_unit_id, outlet_id, user_id, work_date, shift_id)
   values ($1,$2,$3,$4,$5)`,
  [BU, OUT, LAIN, duaHariLalu, SHIFT]
);
await q(`select * from tutup_presensi_tertinggal()`);
const r5 = await satu(`select clock_in_at, clock_out_at from attendance_records where id = $1`, [REC5]);
benar('§6 jam keluar tidak mendahului masuk', new Date(r5.clock_out_at) > new Date(r5.clock_in_at));
cek('§6 jatuh ke jam kerja standar', (new Date(r5.clock_out_at) - new Date(r5.clock_in_at)) / 3600000, 7);

// =====================================================================
// §7 YANG BELUM LEWAT BATAS TIDAK DISENTUH
// =====================================================================
const REC6 = (await satu(
  `insert into attendance_records (user_id, business_unit_id, outlet_id, clock_in_at)
   values ($1,$2,$3, now() - interval '1 hour') returning id`,
  [STAFF, BU, OUT]
)).id;
await q(`select * from tutup_presensi_tertinggal()`);
const r6 = await satu(`select clock_out_at, auto_closed_at from attendance_records where id = $1`, [REC6]);
cek('§7 sesi baru 1 jam TIDAK ditutup', r6.clock_out_at, null);
cek('§7 dan tidak ditandai', r6.auto_closed_at, null);

// Yang sudah clock out tidak disentuh lagi.
const sebelum = await satu(`select clock_out_at from attendance_records where id = $1`, [REC2]);
await q(`select * from tutup_presensi_tertinggal()`);
const sesudah = await satu(`select clock_out_at from attendance_records where id = $1`, [REC2]);
cek('§7 yang sudah tertutup tidak berubah', String(sesudah.clock_out_at), String(sebelum.clock_out_at));

if (gagal) {
  console.error(`\n${gagal} kasus gagal.`);
  process.exit(1);
}
console.log('0138 benar di Postgres sungguhan — jendela istirahat ditegakkan server, dan clock out otomatis memakai jam pulang shift. ✅');
