-- =========================================================
-- 0160 — TUGAS LUAR BISA DIJADWALKAN DI MODUL SHIFT
--
--   "selain shift dan libur saya ingin ada pengaturan tugas luar di shift,
--    jadi bisa atur tugas luar di modul shift"
--
-- ============ YANG SUDAH ADA, DAN TIDAK DIUBAH ============
--
-- Tugas Luar sudah berfungsi utuh di sisi PRESENSI sejak 0006/0064:
--
--   `attendance_records.is_storing`      sesinya ditandai tugas luar
--   `attendance_records.exit_method`     'storing' atau 'otp'
--   `exit_task_otp_codes` + `redeem_exit_otp`  kode dari admin
--   `business_units.exit_task_mode`      BU ini menuntut OTP atau tidak
--   `nbm_settings.storing_bonus_amount`  uang hadirnya ikut
--
-- Dan perilakunya sudah persis seperti yang diminta: `list_attendance_outlets()`
-- adalah `security definer` TANPA saringan scope, jadi ia memulangkan seluruh
-- outlet aktif di SELURUH BU. Staff yang berada di dalam geofence outlet mana
-- pun — BU mana pun — lolos clock in tanpa OTP; prompt Tugas Luar baru muncul
-- kalau geofence tidak menemukan satu pun outlet.
--
-- Jadi migration ini TIDAK menyentuh satu pun dari itu. Yang belum ada cuma
-- kemampuan MERENCANAKANNYA: hari tugas luar yang ditetapkan admin di jadwal,
-- lengkap dengan jenis dan outlet tujuannya.
--
-- ============ KEADAAN KETIGA, DAN KENAPA SEKARANG BOLEH ============
--
-- 0113 pernah menolak menambah keadaan ketiga ke `shift_schedules`, dan
-- alasannya masih benar untuk cuti:
--
--   1. constraint `shift_or_off` cuma mengenal dua keadaan;
--   2. menyalin cuti ke jadwal berarti menduplikasi kebenaran — cuti yang
--      dibatalkan meninggalkan "cuti hantu";
--   3. jadwal aslinya hilang saat cutinya disetujui.
--
-- Alasan 2 dan 3 TIDAK berlaku untuk tugas luar, dan itu seluruh bedanya: tugas
-- luar tidak punya sumber kebenaran di tabel lain. Ia tidak diajukan, tidak
-- disetujui, dan tidak bisa dibatalkan dari tempat lain — admin yang
-- menetapkannya langsung di sel jadwal, dan sel itulah satu-satunya tempat ia
-- pernah ada. Tidak ada yang perlu disinkronkan, jadi tidak ada yang bisa jadi
-- hantu.
--
-- Yang tersisa alasan 1, dan itu memang pekerjaan migration ini: constraintnya
-- diganti dengan yang menyebut KETIGA keadaan secara eksplisit, bukan
-- dilonggarkan. Sel "tanpa shift dan tanpa keterangan" tetap mustahil ada.
--
-- ============ PEMBACA `is_off` YANG SUDAH KEBAL ============
--
-- Keadaan ketiga di kolom lama adalah cara paling mudah membuat kode yang
-- sudah ada salah baca tanpa bersuara. Seluruh pembaca di database sudah
-- disisir, dan hampir semuanya aman BUKAN karena kebetulan:
--
--   `jadwal_belum_clock_in` (0105, 0107, 0109)
--     memakai `is_off = false AND shift_id is not null`. Komentar di 0109
--     menuliskan alasannya dengan tepat: "Kalau suatu saat constraint-nya
--     dilonggarkan, yang tersisa di sini tetap menahan." Hari ini constraintnya
--     dilonggarkan, dan yang tersisa itu memang menahan — tugas luar ber-
--     shift_id null, jadi ia tidak dilencanai "belum clock in".
--
--   tutup otomatis (0138)
--     `join outlet_shifts os on os.id = ss.shift_id` — inner join, jadi baris
--     tugas luar gugur dengan sendirinya. Benar: tidak ada jam pulang yang
--     bisa dipakai menutupnya.
--
-- Yang TIDAK aman cuma satu, dan diperbaiki di bawah: `hitung_ulang_status_shift`.
-- =========================================================

-- ---------------------------------------------------------
-- (1) JENIS TUGAS LUAR — per BU, diatur admin.
--
-- Tabelnya sendiri, bukan teks bebas di sel jadwal. Alasannya sama dengan
-- `leave_types` dan Purpose ESB (0147): teks bebas tidak bisa direkap, dan
-- "berapa hari staff saya habis di jalan bulan ini" adalah justru pertanyaan
-- yang membuat fitur ini layak ada.
-- ---------------------------------------------------------
create table if not exists tugas_luar_types (
  id uuid primary key default gen_random_uuid(),
  business_unit_id uuid not null references business_units(id) on delete cascade,
  nama text not null,
  catatan text,
  urutan int not null default 0,
  aktif boolean not null default true,
  dibuat_at timestamptz not null default now(),
  dibuat_by uuid references user_profiles(id) on delete set null
);

-- Ternormalkan, dengan alasan yang sama dengan `suppliers_nama_uk` (0158):
-- "Antar Barang" dan "antar  barang" adalah satu jenis, dan daftar yang
-- beranak tiap kali ada yang menekan spasi dua kali tidak ada gunanya direkap.
create unique index if not exists tugas_luar_types_nama_uk
  on tugas_luar_types(business_unit_id, lower(btrim(regexp_replace(nama, '\s+', ' ', 'g'))));

create index if not exists idx_tugas_luar_types_bu on tugas_luar_types(business_unit_id, aktif);

alter table tugas_luar_types enable row level security;

-- `drop policy if exists` dulu: `create policy` tidak punya `if not exists`,
-- jadi tanpa ini menjalankan berkasnya dua kali berhenti di tengah dengan
-- "policy already exists" — dan yang menjalankannya tidak tahu bagian mana yang
-- sudah terpasang. Pelajaran dari 0158.
drop policy if exists tugas_luar_types_select on tugas_luar_types;
drop policy if exists tugas_luar_types_modify on tugas_luar_types;

-- Staff ikut MEMBACA: sel jadwalnya menyebut nama jenisnya, dan tanpa izin
-- baca namanya muncul kosong di HP staff — bukan error, cuma sel yang bilang
-- "Tugas Luar" tanpa mengatakan tugas apa.
create policy tugas_luar_types_select on tugas_luar_types
  for select using (has_bu_scope(auth.uid(), business_unit_id));

create policy tugas_luar_types_modify on tugas_luar_types
  for all using (is_bu_admin(auth.uid(), business_unit_id))
  with check (is_bu_admin(auth.uid(), business_unit_id));

-- ---------------------------------------------------------
-- (2) ISI AWALNYA, UNTUK BU YANG SUDAH ADA.
-- ---------------------------------------------------------
insert into tugas_luar_types (business_unit_id, nama, urutan)
select b.id, j.nama, j.urutan
  from business_units b
 cross join (values
   ('Antar Barang', 1),
   ('Belanja', 2),
   ('Training', 3),
   ('Dinas Luar', 4)
 ) as j(nama, urutan)
on conflict do nothing;

-- ============ DAN UNTUK BU YANG LAHIR SESUDAH INI ============
--
-- `insert` di atas cuma mengurus BU yang ADA saat migration dijalankan. Tanpa
-- trigger, BU berikutnya lahir tanpa satu pun jenis tugas luar — dan admin di
-- sana membuka dropdownnya, menemukannya kosong, dan tidak ada satu pun
-- kalimat di layar yang bisa ia kerjakan.
--
-- Lubang yang sama persis ditemukan tesnya sendiri di 0159, sehari sebelum ini.
-- Ditulis dari awal kali ini.
create or replace function seed_tugas_luar_types()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into tugas_luar_types (business_unit_id, nama, urutan)
  select new.id, j.nama, j.urutan
    from (values ('Antar Barang', 1), ('Belanja', 2), ('Training', 3), ('Dinas Luar', 4)) as j(nama, urutan)
  on conflict do nothing;
  return new;
end;
$$;

revoke all on function seed_tugas_luar_types() from public;

drop trigger if exists trg_seed_tugas_luar_types on business_units;
create trigger trg_seed_tugas_luar_types
  after insert on business_units
  for each row
  execute function seed_tugas_luar_types();

-- ---------------------------------------------------------
-- (3) SEL JADWAL DAPAT KEADAAN KETIGA.
-- ---------------------------------------------------------
alter table shift_schedules
  add column if not exists is_tugas_luar boolean not null default false;

-- `on delete restrict`: jenis yang sedang dipakai jadwal TIDAK boleh dihapus.
--
-- `set null` akan meninggalkan baris tugas luar tanpa jenis — yang constraint
-- di bawah justru melarang, jadi penghapusannya gagal belakangan dengan pesan
-- tentang constraint, bukan tentang apa yang sebenarnya dilakukan orangnya.
-- `cascade` lebih buruk lagi: ia menghapus HARI KERJANYA. Jenis yang tidak
-- dipakai lagi dinonaktifkan (`aktif = false`), tidak dihapus.
alter table shift_schedules
  add column if not exists tugas_luar_type_id uuid references tugas_luar_types(id) on delete restrict;

-- Outlet tujuan, OPSIONAL — "Belanja ke pasar" tidak punya outlet tujuan.
--
-- `set null` di sini benar: outlet yang dihapus tidak boleh menghapus hari
-- kerja orang, dan tugas luar tanpa tujuan tetap sel yang sah.
alter table shift_schedules
  add column if not exists tugas_luar_outlet_id uuid references outlets(id) on delete set null;

create index if not exists idx_shift_schedules_tugas_luar
  on shift_schedules(tugas_luar_outlet_id) where tugas_luar_outlet_id is not null;

-- ============ CONSTRAINT: TIGA KEADAAN, DISEBUT SATU-SATU ============
--
-- Ditulis sebagai tiga cabang eksplisit, bukan sebagai hitungan "paling banyak
-- satu yang true". Hitungan terlihat lebih ringkas dan menerima lebih banyak
-- daripada yang dimaksud: ia meloloskan shift yang membawa `tugas_luar_type_id`,
-- dan libur yang membawa outlet tujuan. Keduanya tidak akan pernah terlihat
-- salah di layar — datanya cuma jadi tidak bisa dipercaya saat direkap.
alter table shift_schedules drop constraint if exists shift_or_off;
alter table shift_schedules drop constraint if exists shift_libur_atau_tugas_luar;
alter table shift_schedules
  add constraint shift_libur_atau_tugas_luar check (
    -- SHIFT: punya jam, tanpa keterangan tugas luar.
    (not is_off and not is_tugas_luar and shift_id is not null
       and tugas_luar_type_id is null and tugas_luar_outlet_id is null)
    -- LIBUR: tanpa jam, tanpa keterangan tugas luar.
    or (is_off and not is_tugas_luar and shift_id is null
       and tugas_luar_type_id is null and tugas_luar_outlet_id is null)
    -- TUGAS LUAR: tanpa jam, WAJIB berjenis. Outlet tujuan opsional.
    or (is_tugas_luar and not is_off and shift_id is null
       and tugas_luar_type_id is not null)
  );

-- ============ JENISNYA HARUS MILIK BU YANG SAMA ============
--
-- Tidak bisa jadi `check` constraint — ia menyentuh tabel lain. Dan tanpa
-- penjaga ini, admin BU A bisa menunjuk jenis milik BU B: selnya tersimpan,
-- layarnya menggambarnya, dan rekap BU B diam-diam memuat hari kerja orang
-- yang bukan stafnya.
--
-- `security definer` karena ia membaca `tugas_luar_types` milik BU lain, yang
-- RLS-nya justru menutup — pemeriksaan yang disaring RLS akan selalu bernilai
-- "tidak ada", yaitu kegagalan sunyi yang paling sering muncul di proyek ini.
create or replace function jaga_jenis_tugas_luar()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bu uuid;
begin
  if new.tugas_luar_type_id is null then return new; end if;

  select business_unit_id into v_bu from tugas_luar_types where id = new.tugas_luar_type_id;
  if v_bu is null then
    raise exception 'Jenis tugas luar tidak ditemukan.';
  end if;
  if v_bu <> new.business_unit_id then
    raise exception 'Jenis tugas luar itu milik BU lain.';
  end if;

  -- Outlet tujuan boleh di BU mana pun: tugas luar ke outlet BU lain adalah
  -- kejadian yang nyata di sini, dan itu seluruh guna kolomnya.
  return new;
end;
$$;

revoke all on function jaga_jenis_tugas_luar() from public;

drop trigger if exists trg_jaga_jenis_tugas_luar on shift_schedules;
create trigger trg_jaga_jenis_tugas_luar
  before insert or update on shift_schedules
  for each row
  execute function jaga_jenis_tugas_luar();

-- ---------------------------------------------------------
-- (4) STATUS PRESENSI: HARI TUGAS LUAR PUNYA NAMANYA SENDIRI.
-- ---------------------------------------------------------
alter table attendance_records drop constraint if exists attendance_records_late_status_check;
alter table attendance_records
  add constraint attendance_records_late_status_check
  check (late_status in ('ontime', 'tolerance', 'late', 'no_schedule', 'off_day', 'tugas_luar'));

-- ============ KENAPA BUKAN DIBIARKAN SAJA ============
--
-- Tanpa cabang baru di bawah, hari tugas luar jatuh ke penjaga yang sudah ada
-- di 0074 — "baris jadwal ada tapi tidak menunjuk shift mana pun" — dan dicatat
-- `no_schedule`. Itu TIDAK mencap orangnya terlambat (penjaga itu memang
-- ditulis untuk mencegah hal itu, dan ia bekerja), tapi tetap keterangan yang
-- salah: orangnya DIJADWALKAN, dan yang menjadwalkannya adalah adminnya
-- sendiri. `no_schedule` lalu muncul di rekap sebagai kelalaian menyusun
-- jadwal, dan admin mencari jadwal yang hilang yang sebenarnya tidak hilang.
--
-- Fungsinya ditulis ulang UTUH, bukan ditambal — satu nama fungsi, satu
-- definisi. Isinya sama dengan 0074 kecuali tiga hal yang ditandai.
create or replace function hitung_ulang_status_shift(
  p_record uuid,
  p_paksa boolean default false
)
returns table (status text, menit int, nama_shift text)
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_tanggal date;
  v_jadwal record;
  v_toleransi int;
  v_mulai int;
  v_masuk int;
  v_selisih int;
  v_status text;
begin
  select ar.id, ar.user_id, ar.clock_in_at, ar.late_status, ar.late_minutes, ar.shift_name,
         coalesce(ar.nbm_outlet_id, ar.outlet_id) as outlet_efektif,
         o.business_unit_id as bu_efektif
    into r
  from attendance_records ar
  join outlets o on o.id = coalesce(ar.nbm_outlet_id, ar.outlet_id)
  where ar.id = p_record;

  if not found or r.clock_in_at is null then
    return;
  end if;

  if not p_paksa and r.late_status is not null and r.late_status <> 'no_schedule' then
    return query select r.late_status, r.late_minutes, r.shift_name;
    return;
  end if;

  v_tanggal := (r.clock_in_at at time zone 'Asia/Jakarta')::date;

  -- (1) `is_tugas_luar` ikut dibaca. Kolom yang TIDAK diminta terbaca sebagai
  --     "tidak ada" — bukan galat — jadi melewatkannya di sini akan membuat
  --     seluruh cabang di bawahnya tidak pernah menyala, dan hari tugas luar
  --     diam-diam kembali jadi `no_schedule`.
  select ss.is_off, ss.is_tugas_luar, os.name as shift_name, os.start_time
    into v_jadwal
  from shift_schedules ss
  left join outlet_shifts os on os.id = ss.shift_id
  where ss.user_id = r.user_id
    and ss.work_date = v_tanggal
  order by (ss.outlet_id = r.outlet_efektif) desc, ss.updated_at
  limit 1;

  if not found then
    update attendance_records
       set late_status = 'no_schedule', late_minutes = null
     where id = p_record;
    return query select 'no_schedule'::text, null::int, null::text;
    return;
  end if;

  -- (2) DIPERIKSA SEBELUM penjaga "tanpa jam mulai" di bawahnya.
  --
  --     Urutannya menentukan hasilnya: tugas luar memang ber-shift_id null,
  --     jadi kalau cabang ini ditaruh SESUDAH penjaga itu, ia tidak akan pernah
  --     tercapai — dan auditnya tetap hijau, karena kodenya ada.
  if v_jadwal.is_tugas_luar then
    update attendance_records
       set late_status = 'tugas_luar', late_minutes = null, shift_name = null
     where id = p_record;
    return query select 'tugas_luar'::text, null::int, null::text;
    return;
  end if;

  if not v_jadwal.is_off and v_jadwal.start_time is null then
    update attendance_records
       set late_status = 'no_schedule', late_minutes = null
     where id = p_record;
    return query select 'no_schedule'::text, null::int, null::text;
    return;
  end if;

  if v_jadwal.is_off then
    update attendance_records
       set late_status = 'off_day', late_minutes = null, shift_name = null
     where id = p_record;
    return query select 'off_day'::text, null::int, null::text;
    return;
  end if;

  select coalesce(late_tolerance_minutes, 10) into v_toleransi
  from shift_settings where business_unit_id = r.bu_efektif;
  v_toleransi := coalesce(v_toleransi, 10);

  v_mulai := extract(hour from v_jadwal.start_time) * 60 + extract(minute from v_jadwal.start_time);
  v_masuk := extract(hour from (r.clock_in_at at time zone 'Asia/Jakarta')) * 60
           + extract(minute from (r.clock_in_at at time zone 'Asia/Jakarta'));
  v_selisih := v_masuk - v_mulai;
  if v_selisih > 720 then v_selisih := v_selisih - 1440; end if;
  if v_selisih < -720 then v_selisih := v_selisih + 1440; end if;

  if v_selisih <= 0 then
    v_status := 'ontime'; v_selisih := 0;
  elsif v_selisih <= v_toleransi then
    v_status := 'tolerance';
  else
    v_status := 'late';
  end if;

  update attendance_records
     set late_status = v_status,
         late_minutes = v_selisih,
         shift_name = v_jadwal.shift_name
   where id = p_record;

  return query select v_status, v_selisih, v_jadwal.shift_name;
end;
$$;

revoke all on function hitung_ulang_status_shift(uuid, boolean) from public;
grant execute on function hitung_ulang_status_shift(uuid, boolean) to authenticated;

-- ---------------------------------------------------------
-- (5) REKAP: BERAPA HARI TUGAS LUAR, PER JENIS.
--
-- Inilah yang membuat jenisnya layak jadi tabel dan bukan teks bebas. Tanpa
-- satu tempat yang bisa menjawabnya, daftar jenis cuma kolom yang diisi dan
-- tidak pernah dibaca.
-- ---------------------------------------------------------
create or replace function rekap_tugas_luar(
  p_bu uuid,
  p_from date,
  p_to date,
  p_outlet uuid default null
)
returns table (
  user_id uuid,
  nama_staff text,
  jenis text,
  jumlah_hari bigint
)
language sql
security definer
stable
set search_path = public
as $$
  select ss.user_id,
         up.full_name,
         t.nama,
         count(*)
    from shift_schedules ss
    join tugas_luar_types t on t.id = ss.tugas_luar_type_id
    left join user_profiles up on up.id = ss.user_id
   where ss.is_tugas_luar
     and ss.business_unit_id = p_bu
     and ss.work_date between p_from and p_to
     and (p_outlet is null or ss.outlet_id = p_outlet)
     -- Penjaganya DI DALAM fungsi, bukan diserahkan RLS: fungsi ini
     -- `security definer`, jadi RLS tidak berlaku di sini sama sekali.
     -- Menghilangkan baris ini membuat siapa pun yang login bisa membaca rekap
     -- BU mana pun dengan menebak satu uuid.
     and has_bu_scope(auth.uid(), p_bu)
   group by ss.user_id, up.full_name, t.nama
   order by up.full_name, t.nama;
$$;

revoke all on function rekap_tugas_luar(uuid, date, date, uuid) from public;
grant execute on function rekap_tugas_luar(uuid, date, date, uuid) to authenticated;

notify pgrst, 'reload schema';
