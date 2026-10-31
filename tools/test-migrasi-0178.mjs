/**
 * MIGRATION 0178 — REVISI CUTI YANG SUDAH DIPUTUSKAN (PGlite).
 *
 * ============ APA YANG DIBUKTIKAN ============
 *
 *   §1 Yang MASIH menunggu ditolak jalur ini — ia punya jalur Setujui/Tolak
 *      sendiri, dan jalur itulah yang menjaga batas "hanya boleh dipersempit".
 *   §2 Alasan WAJIB. Itu satu-satunya ganti rugi atas pembatasan yang dilepas.
 *   §3 Tanggal BOLEH keluar dari rentang yang diajukan, dan `day_count`
 *      dihitung ulang — bukan dibawa dari nilai lama.
 *   §4 Kolom `*_awal` TIDAK tertimpa: ia permintaan asli staff, bukan "nilai
 *      sebelum perubahan terakhir".
 *   §5 Status boleh diubah, termasuk dibatalkan.
 *   §6 Jenis cuti boleh diganti, tapi tidak ke jenis milik BU lain.
 *   §7 Wewenangnya sama persis dengan `setujui_cuti`.
 *   §8 Jejaknya: revisi_ke naik, perevisi & alasannya tersimpan.
 *   §9 Dijalankan dua kali tetap aman.
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
// ============ VERSI YANG BENAR-BENAR MEMERIKSA ============
//
// Bentuk warisan dari test-migrasi-0117 mengembalikan pesan galatnya dan
// MEMBIARKAN pemanggilnya memeriksa. Berkas ini memanggilnya dengan pola &
// nama sebagai argumen ke-2 dan ke-3 — yang pada versi lama DIABAIKAN, jadi
// seluruh pemeriksaan "harus ditolak" di sini lulus tanpa memeriksa apa pun.
// Sabotasenya yang menunjukkan itu: empat penjaga dicabut, tesnya tetap hijau.
const gagalkan = async (fn, pola, nama) => {
  let pesan = null;
  try {
    await fn();
  } catch (e) {
    pesan = String(e.message ?? e);
  }
  if (pesan === null) {
    gagal++;
    console.error(`❌ ${nama} — TIDAK melempar sama sekali.`);
    return null;
  }
  if (pola && !pola.test(pesan)) {
    gagal++;
    console.error(`❌ ${nama} — pesannya tidak cocok: ${pesan}`);
    return pesan;
  }
  console.log(`  ✔ ${nama}`);
  return pesan;
};

await db.exec(`
  create schema if not exists auth;
  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
  $$;

  create table business_units (id uuid primary key default gen_random_uuid(), name text);
  create table outlets (id uuid primary key default gen_random_uuid(), business_unit_id uuid, name text);
  create table user_profiles (id uuid primary key, full_name text);
  -- Kolom business_unit_id ADA di tabel sungguhan (0013): jenis cuti boleh global
  -- (null) atau milik satu BU. Tanpa kolomnya di sini, pemeriksaan "jenis itu
  -- milik BU lain" tidak pernah bisa dijalankan — dan yang paling berbahaya
  -- bukan tesnya gagal, melainkan tesnya HIJAU untuk skema yang tidak pernah
  -- ada di produksi.
  create table leave_types (
    id uuid primary key default gen_random_uuid(), name text,
    business_unit_id uuid, is_active boolean not null default true,
    deducts_quota boolean default true);
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
await jalankan('0178_revisi_cuti.sql');
console.log('  0113 + 0117 + 0178 terpasang.');

const BU = (await satu(`insert into business_units (name) values ('Cafe') returning id`)).id;
const BU_LAIN = (await satu(`insert into business_units (name) values ('Bengkel') returning id`)).id;
const OUT = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Serpong') returning id`, [BU])).id;
const JENIS = (await satu(`insert into leave_types (name) values ('Cuti Tahunan') returning id`)).id;
const JENIS_SAKIT = (
  await satu(`insert into leave_types (name, business_unit_id) values ('Sakit', $1) returning id`, [BU])
).id;
const JENIS_BU_LAIN = (
  await satu(`insert into leave_types (name, business_unit_id) values ('Cuti Bengkel', $1) returning id`, [BU_LAIN])
).id;

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

const ajukan = async (mulai = '2026-09-04', selesai = '2026-09-08') => {
  await sebagai(RIFKI);
  return (
    await satu(
      `insert into leave_requests (user_id, business_unit_id, outlet_id, leave_type_id, start_date, end_date, day_count, reason)
       values ($1,$2,$3,$4,$5::date,$6::date,($6::date - $5::date) + 1,'acara keluarga') returning id`,
      [RIFKI, BU, OUT, JENIS, mulai, selesai]
    )
  ).id;
};
// Tanggal dibaca sebagai TEKS. PGlite mengembalikan objek Date, dan
// `String(date).slice(0, 10)` menghasilkan "Thu Jan 01" — perbandingan yang
// gagal karena bentuknya, bukan karena nilainya. Pola yang sama dipakai
// test-migrasi-0117.
const baca = (id) =>
  satu(
    `select start_date::text, end_date::text, day_count, status, leave_type_id, reviewed_by,
            start_date_awal::text, end_date_awal::text, day_count_awal,
            revisi_ke, direvisi_at, direvisi_by_nama, alasan_revisi
       from leave_requests where id = $1`,
    [id]
  );

const revisi = (id, o = {}) =>
  satu(`select revisi_cuti($1,$2,$3::date,$4::date,$5,$6,$7) as h`, [
    id,
    o.status ?? 'approved',
    o.mulai ?? '2026-09-06',
    o.selesai ?? '2026-09-12',
    o.jenis === undefined ? null : o.jenis,
    o.note ?? null,
    o.alasan ?? 'acara digeser'
  ]);

// ===============================================================
console.log('\n§1 Yang masih menunggu ditolak jalur ini');
// ===============================================================
const PENDING = await ajukan();
await sebagai(ADMIN);
await gagalkan(() => revisi(PENDING), /belum diputuskan/i, '§1 pengajuan pending ditolak');

// ===============================================================
console.log('\n§2 Alasan wajib');
// ===============================================================
const A = await ajukan();
await sebagai(ADMIN);
await q(`select setujui_cuti($1,'approved',null,null,null)`, [A]);
await gagalkan(() => revisi(A, { alasan: '   ' }), /Alasan revisi wajib/i, '§2 alasan kosong ditolak');

// ===============================================================
console.log('\n§3 Tanggal boleh KELUAR dari rentang pengajuan');
// ===============================================================

// ============ INI YANG MEMBEDAKANNYA DARI `setujui_cuti` ============
//
// Jalur persetujuan menolak 4–8 menjadi 6–12 ("harus di dalam rentang yang
// diajukan"). Revisi melepasnya: yang terjadi di lapangan adalah acaranya
// digeser, dan itu baru diketahui SESUDAH keputusannya keluar.
await revisi(A, { mulai: '2026-09-06', selesai: '2026-09-12' });
let a = await baca(A);
cek('§3 tanggal mulai berubah', a.start_date, '2026-09-06');
cek('§3 tanggal selesai keluar dari rentang pengajuan', a.end_date, '2026-09-12');
// Dihitung ULANG. Angka hari yang tertinggal akan memotong jatah cuti sebesar
// yang tidak dipakai — dan salahnya tidak kelihatan karena baris tanggalnya
// sendiri sudah benar.
cek('§3 jumlah hari dihitung ulang', a.day_count, 7);

await gagalkan(
  () => revisi(A, { mulai: '2026-09-10', selesai: '2026-09-02' }),
  /tidak boleh sebelum/i,
  '§3 selesai sebelum mulai tetap ditolak'
);

// ===============================================================
console.log('\n§4 Kolom *_awal tidak tertimpa');
// ===============================================================

// `*_awal` adalah PERMINTAAN ASLI staff, bukan "nilai sebelum perubahan
// terakhir". Menimpanya dengan nilai sebelum revisi menghapus satu-satunya
// jejak apa yang sebenarnya diminta orangnya.
const B = await ajukan('2026-10-01', '2026-10-05');
await sebagai(ADMIN);
await q(`select setujui_cuti($1,'approved',null,'2026-10-02','2026-10-04')`, [B]);
let b = await baca(B);
cek('§4 persetujuan menyalin pengajuan ke *_awal', b.start_date_awal, '2026-10-01');

await revisi(B, { mulai: '2026-10-06', selesai: '2026-10-09' });
b = await baca(B);
cek('§4 *_awal TETAP tanggal yang diajukan staff', b.start_date_awal, '2026-10-01');
cek('§4 dan ujungnya juga', b.end_date_awal, '2026-10-05');
cek('§4 tanggal berlakunya yang berubah', b.start_date, '2026-10-06');

// ===============================================================
console.log('\n§5 Status boleh diubah, termasuk dibatalkan');
// ===============================================================
await revisi(B, { status: 'cancelled', mulai: '2026-10-06', selesai: '2026-10-09', alasan: 'tidak jadi cuti' });
b = await baca(B);
cek('§5 jadi dibatalkan', b.status, 'cancelled');
await gagalkan(() => revisi(B, { status: 'pending' }), /hanya boleh approved/i, '§5 status asing ditolak');

// ============ YANG SUDAH DIBATALKAN TETAP BISA DIBETULKAN ============
//
// Versi pertama fungsi ini menolak status selain approved/rejected, sehingga
// cuti yang SALAH dibatalkan terkunci selamanya — tanpa satu pun jalan keluar
// di layar. Ketahuan hanya karena `gagalkan` diperbaiki supaya benar-benar
// memeriksa; sebelum itu pemeriksaannya lulus tanpa menjalankan apa pun.
await revisi(B, { status: 'approved', mulai: '2026-10-06', selesai: '2026-10-09', alasan: 'ternyata jadi cuti' });
b = await baca(B);
cek('§5 pembatalan yang keliru bisa dikembalikan', b.status, 'approved');

// ===============================================================
console.log('\n§6 Jenis cuti boleh diganti — tapi tidak milik BU lain');
// ===============================================================
await revisi(A, { jenis: JENIS_SAKIT, mulai: '2026-09-06', selesai: '2026-09-12' });
a = await baca(A);
cek('§6 jenis berubah', a.leave_type_id, JENIS_SAKIT);

// Satu id yang ditebak tidak boleh memindahkan pemotongan jatah ke jenis cuti
// BU lain.
await gagalkan(
  () => revisi(A, { jenis: JENIS_BU_LAIN, mulai: '2026-09-06', selesai: '2026-09-12' }),
  /milik BU lain/i,
  '§6 jenis milik BU lain ditolak'
);
await gagalkan(
  () => revisi(A, { jenis: '99999999-9999-9999-9999-999999999999', mulai: '2026-09-06', selesai: '2026-09-12' }),
  /tidak dikenal/i,
  '§6 jenis yang tidak ada ditolak'
);

// ===============================================================
console.log('\n§7 Wewenang');
// ===============================================================
await sebagai(ORANG_LAIN);
await gagalkan(() => revisi(A), /tidak berwenang/i, '§7 bukan admin ditolak');
await sebagai(RIFKI);
await gagalkan(() => revisi(A), /tidak berwenang/i, '§7 pemohonnya sendiri pun ditolak');

// ===============================================================
console.log('\n§8 Jejak revisinya');
// ===============================================================
await sebagai(ADMIN);
const sebelum = (await baca(A)).revisi_ke;
const h = (await revisi(A, { mulai: '2026-09-07', selesai: '2026-09-08', alasan: 'dipersingkat, staff masuk 2 hari' })).h;
a = await baca(A);
cek('§8 revisi_ke naik', a.revisi_ke, sebelum + 1);
cek('§8 jawabannya menyebut nomor revisinya', Number(h.revisi_ke), sebelum + 1);
cek('§8 alasannya tersimpan', a.alasan_revisi, 'dipersingkat, staff masuk 2 hari');
cek('§8 nama perevisi tersimpan sebagai teks', a.direvisi_by_nama, 'Iko');
cek('§8 perevisi jadi pemutus terakhir', a.reviewed_by, ADMIN);
benar('§8 waktu revisinya terisi', a.direvisi_at !== null);
cek('§8 jawabannya membawa jumlah hari baru', Number(h.hari_baru), 2);

// Cuti yang tanggalnya sudah lewat ditandai, supaya layar bisa memperingatkan
// bahwa jatah cutinya berubah SURUT.
const LAMPAU = await ajukan('2020-01-01', '2020-01-03');
await sebagai(ADMIN);
await q(`select setujui_cuti($1,'approved',null,null,null)`, [LAMPAU]);
const hLampau = (await revisi(LAMPAU, { mulai: '2020-01-01', selesai: '2020-01-05' })).h;
benar('§8 cuti lampau ditandai sudah_lewat', hLampau.sudah_lewat === true, JSON.stringify(hLampau));
// `sudah_lewat` menggambarkan keadaan SEBELUM revisi — itu memang gunanya:
// memperingatkan bahwa yang sedang diubah adalah hari yang sudah berlalu.
// Cuti yang BELUM selesai tidak ditandai.
const MENDATANG = await ajukan('2099-01-01', '2099-01-03');
await sebagai(ADMIN);
await q(`select setujui_cuti($1,'approved',null,null,null)`, [MENDATANG]);
benar(
  '§8 cuti yang belum lewat tidak ditandai',
  (await revisi(MENDATANG, { mulai: '2099-01-01', selesai: '2099-01-05' })).h.sudah_lewat === false
);

// ===============================================================
console.log('\n§9 Dijalankan dua kali tetap aman');
// ===============================================================
await jalankan('0178_revisi_cuti.sql');
await jalankan('0178_revisi_cuti.sql');
a = await baca(A);
cek('§9 datanya tidak berubah', a.start_date, '2026-09-07');
cek(
  '§9 kolomnya tidak digandakan',
  (await satu(`select count(*)::int as n from information_schema.columns where table_name='leave_requests' and column_name='revisi_ke'`)).n,
  1
);

// ---------------------------------------------------------------
console.log(`\n${gagal === 0 ? '✅' : '❌'} test-migrasi-0178: ${gagal === 0 ? 'semua' : gagal + ' GAGAL'}`);
process.exit(gagal === 0 ? 0 : 1);
