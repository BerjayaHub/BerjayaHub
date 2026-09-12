-- =========================================================
-- Berjaya Hub OMS — 0138
-- Istirahat di tengah jam kerja, dan clock out otomatis.
--
-- =========================================================
-- YANG DIMINTA
-- =========================================================
--
--   "tambahkan fitur istirahat, di tengah jam kerja ... di admin portal ada
--    pengaturan istirahat ini, per BU dan outlet apakah jam istirahat dan
--    kembali istirahat ditentukan atau tidak ... fitur ini tidak berpengaruh
--    terhadap nbm sama sekali ... lupa kembali dari istirahat otomatis akan
--    berstatus kembali setelah 2 jam"
--
--   "clock out otomatis, yaitu, saat staff clock in lalu 12 jam setelah clock
--    in staff belum clock out maka otomatis dia dianggap clock out di jam
--    sesuai shift nya, sedangkan yang tanpa shift dianggap clock out setelah
--    8 jam kerja ... jadi jika staff tidak clock out dia dianggap masuk
--    seperti biasa tanpa lembur"
--
-- =========================================================
-- ISTIRAHAT SENGAJA DIPISAH DARI PRESENSI
-- =========================================================
--
-- Tabel sendiri, BUKAN kolom di `attendance_records`. Alasannya bukan kerapian:
--
--   1. NBM membaca `attendance_records`. Menaruh jam istirahat di sana
--      mengundang perhitungan berikutnya memotongnya dari jam kerja — dan itu
--      persis yang DIMINTA TIDAK TERJADI. Data yang tidak boleh dipakai lebih
--      aman berada di tempat yang tidak dibaca.
--   2. Satu shift bisa punya lebih dari satu istirahat.
--
-- =========================================================
-- CLOCK OUT OTOMATIS ADALAH TEBAKAN, DAN HARUS TERLIHAT BEGITU
-- =========================================================
--
-- Baris yang ditutup otomatis membawa jam yang TIDAK PERNAH DITEKAN SIAPA PUN.
-- Kalau ia terlihat sama persis dengan presensi biasa, tidak ada cara
-- membedakan "pulang jam 5" dari "lupa clock out lalu ditebak jam 5" — dan
-- yang kedua adalah pertanyaan yang justru perlu ditanyakan ke orangnya.
--
-- Maka `auto_closed_at` + `auto_closed_reason` diisi, dan rekap admin
-- menampilkannya.
--
-- =========================================================
-- KENAPA JAMNYA DARI SHIFT, BUKAN 12 JAM SETELAH MASUK
-- =========================================================
--
-- "12 jam" adalah PEMICUNYA, bukan jam pulangnya. Kalau baris ditutup pada
-- jam pemicu, staff yang lupa clock out akan tercatat bekerja 12 jam — dan itu
-- lembur yang tidak pernah terjadi, di sistem yang membayar lembur bertingkat
-- (0037). Yang diminta jelas: "dianggap masuk seperti biasa TANPA LEMBUR".
-- =========================================================

-- ---------------------------------------------------------
-- (1) Setelan presensi: BU sebagai bawaan, outlet boleh menimpa.
--
-- Satu tabel dengan `outlet_id` yang boleh NULL:
--   outlet_id IS NULL      -> setelan BU (bawaan seluruh outletnya)
--   outlet_id ada isinya   -> penimpa untuk outlet itu
--
-- Dua indeks unik PARSIAL, bukan satu unique biasa: `unique(bu, outlet)` TIDAK
-- mencegah dua baris BU (NULL tidak pernah sama dengan NULL di Postgres), dan
-- dua baris bawaan yang berbeda isinya adalah setelan yang jawabannya
-- tergantung baris mana yang kebetulan terbaca lebih dulu.
-- ---------------------------------------------------------
create table if not exists attendance_settings (
  id uuid primary key default gen_random_uuid(),
  business_unit_id uuid not null references business_units(id) on delete cascade,
  outlet_id uuid references outlets(id) on delete cascade,

  -- SELURUH KOLOM SETELAN BOLEH NULL, dan itu yang membuat penimpaan
  -- PER KOLOM mungkin.
  --
  -- Versi pertama memakai `not null default`, dan itu diam-diam mematahkan
  -- seluruh gagasan "outlet menimpa BU": outlet yang dibuatkan baris hanya
  -- untuk mengubah jam istirahatnya tetap mendapat `standard_work_hours = 8`
  -- dari defaultnya, lalu 8 itu MENIMPA angka 7 milik BU-nya. Tidak ada error;
  -- jam kerja standar outlet itu cuma berubah tanpa ada yang memilihnya.
  --
  -- NULL di sini berarti "ikut yang di atas", dan bawaan aplikasinya ada di
  -- satu tempat saja: rantai `coalesce` di `setelan_presensi`.
  --
  -- Batasan `check` tetap aman dengan NULL: ekspresi yang bernilai NULL
  -- dianggap LULUS oleh Postgres.

  -- 'bebas'      -> staff boleh istirahat & kembali kapan pun
  -- 'ditentukan' -> tombolnya hanya hidup pada jendela jam di bawah
  break_mode text check (break_mode in ('bebas', 'ditentukan')),
  break_start time,
  break_end time,

  -- Dipakai clock out otomatis untuk staff TANPA shift terjadwal.
  standard_work_hours numeric check (standard_work_hours > 0 and standard_work_hours <= 24),
  -- Berapa lama sesi boleh menggantung sebelum ditutup otomatis.
  auto_close_after_hours numeric check (auto_close_after_hours > 0 and auto_close_after_hours <= 48),

  updated_by uuid references user_profiles(id) on delete set null,
  updated_at timestamptz not null default now(),

  -- Mode 'ditentukan' tanpa jamnya adalah setelan yang tidak bisa dijalankan:
  -- tombol istirahatnya tidak akan pernah hidup, dan tidak ada yang
  -- memberitahu kenapa.
  constraint break_window_lengkap check (
    break_mode <> 'ditentukan' or (break_start is not null and break_end is not null)
  )
);

-- `create table if not exists` TIDAK mengubah tabel yang sudah ada, jadi
-- pemasangan versi sebelumnya (yang kolomnya `not null default`) tidak akan
-- ikut terperbaiki olehnya. Ini yang memperbaikinya, dan aman dijalankan
-- berkali-kali.
alter table attendance_settings alter column break_mode drop not null;
alter table attendance_settings alter column break_mode drop default;
alter table attendance_settings alter column standard_work_hours drop not null;
alter table attendance_settings alter column standard_work_hours drop default;
alter table attendance_settings alter column auto_close_after_hours drop not null;
alter table attendance_settings alter column auto_close_after_hours drop default;

create unique index if not exists attendance_settings_bu_uk
  on attendance_settings(business_unit_id) where outlet_id is null;
create unique index if not exists attendance_settings_outlet_uk
  on attendance_settings(business_unit_id, outlet_id) where outlet_id is not null;

alter table attendance_settings enable row level security;

drop policy if exists attendance_settings_select on attendance_settings;
create policy attendance_settings_select on attendance_settings
  for select using (has_bu_scope(auth.uid(), business_unit_id));

drop policy if exists attendance_settings_modify on attendance_settings;
create policy attendance_settings_modify on attendance_settings
  for all using (is_bu_admin(auth.uid(), business_unit_id))
  with check (is_bu_admin(auth.uid(), business_unit_id));

comment on table attendance_settings is
  'Setelan presensi per BU, dengan penimpa opsional per outlet (outlet_id null = bawaan BU).';

-- ---------------------------------------------------------
-- (2) Setelan yang BERLAKU untuk sebuah outlet.
--
-- Satu fungsi supaya layar dan server memakai jawaban yang sama. Aturan yang
-- dihitung dua kali di dua tempat cepat atau lambat menyimpang, dan yang
-- menyimpang di sini adalah jam kerja orang.
-- ---------------------------------------------------------
create or replace function setelan_presensi(p_outlet uuid)
returns table (
  business_unit_id uuid,
  outlet_id uuid,
  break_mode text,
  break_start time,
  break_end time,
  standard_work_hours numeric,
  auto_close_after_hours numeric,
  dari text
)
language sql
stable
security invoker
set search_path = public
as $$
  with o as (select id, business_unit_id from outlets where id = p_outlet)
  select o.business_unit_id,
         o.id,
         coalesce(s_out.break_mode, s_bu.break_mode, 'bebas'),
         coalesce(s_out.break_start, s_bu.break_start),
         coalesce(s_out.break_end, s_bu.break_end),
         coalesce(s_out.standard_work_hours, s_bu.standard_work_hours, 8),
         coalesce(s_out.auto_close_after_hours, s_bu.auto_close_after_hours, 12),
         case when s_out.id is not null then 'outlet'
              when s_bu.id is not null then 'bu'
              else 'bawaan' end
    from o
    left join attendance_settings s_out
      on s_out.business_unit_id = o.business_unit_id and s_out.outlet_id = o.id
    left join attendance_settings s_bu
      on s_bu.business_unit_id = o.business_unit_id and s_bu.outlet_id is null;
$$;

revoke all on function setelan_presensi(uuid) from public;
grant execute on function setelan_presensi(uuid) to authenticated;

comment on function setelan_presensi(uuid) is
  'Setelan presensi yang BERLAKU untuk satu outlet: penimpa outlet, lalu bawaan BU, lalu bawaan aplikasi.';

-- ---------------------------------------------------------
-- (3) Istirahat.
-- ---------------------------------------------------------
create table if not exists attendance_breaks (
  id uuid primary key default gen_random_uuid(),
  attendance_id uuid not null references attendance_records(id) on delete cascade,
  mulai_at timestamptz not null default now(),
  selesai_at timestamptz,
  -- BUKTI YANG SAMA DENGAN CLOCK IN/OUT.
  --
  -- Tanpa ini, istirahat jadi satu-satunya tombol presensi yang bisa ditekan
  -- dari rumah dan atas nama orang lain — dan justru tombol itu yang paling
  -- sering ditekan dalam sehari. Fotonya WAJIB untuk yang mulai; yang kembali
  -- mengisi kolom keduanya.
  foto_mulai text,
  foto_selesai text,
  wajah_mulai boolean,
  wajah_selesai boolean,
  -- Ditutup otomatis karena lupa kembali. Dibedakan supaya rekapnya bisa
  -- berkata "2 jam (otomatis)" dan bukan berpura-pura orangnya menekan tombol.
  otomatis boolean not null default false,
  created_at timestamptz not null default now(),
  constraint istirahat_urut check (selesai_at is null or selesai_at >= mulai_at)
);
-- `create table if not exists` TIDAK MENYENTUH TABEL YANG SUDAH ADA.
--
-- Kolom bukti di atas ditambahkan sesudah sebagian orang menjalankan versi
-- pertama berkas ini, dan tabelnya sudah terlanjur ada di sana. Tanpa baris di
-- bawah, `create table` dilewati begitu saja dan kolomnya tidak pernah lahir —
-- migrationnya "berhasil", lalu tombol Kembali dari Istirahat gagal dengan
-- `column "foto_selesai" does not exist` di HP staff.
--
-- Kesalahan yang sama sudah ditangani untuk `attendance_settings` beberapa
-- puluh baris di atas, dan tetap terulang di tabel sebelahnya. Tiap kolom baru
-- pada tabel ber-`if not exists` WAJIB punya pasangan `add column` seperti ini.
alter table attendance_breaks add column if not exists foto_mulai text;
alter table attendance_breaks add column if not exists foto_selesai text;
alter table attendance_breaks add column if not exists wajah_mulai boolean;
alter table attendance_breaks add column if not exists wajah_selesai boolean;

create index if not exists idx_breaks_attendance on attendance_breaks(attendance_id);
-- SATU istirahat berjalan per presensi. Tanpa ini, dua ketukan tombol yang
-- beruntun di sinyal lemah menghasilkan dua istirahat terbuka, dan yang kedua
-- tidak akan pernah bisa ditutup dari layar.
create unique index if not exists attendance_breaks_satu_berjalan
  on attendance_breaks(attendance_id) where selesai_at is null;

alter table attendance_breaks enable row level security;

drop policy if exists attendance_breaks_select on attendance_breaks;
create policy attendance_breaks_select on attendance_breaks
  for select using (
    exists (
      select 1 from attendance_records a
       where a.id = attendance_breaks.attendance_id
         and (a.user_id = auth.uid() or has_bu_scope(auth.uid(), a.business_unit_id))
    )
  );

-- SENGAJA TANPA policy insert/update/delete: satu-satunya jalan masuk adalah
-- RPC di bawah, yang menegakkan jendela jamnya.

comment on table attendance_breaks is
  'Istirahat di tengah jam kerja. TIDAK dipakai perhitungan NBM sama sekali — hanya untuk rekap.';

-- ---------------------------------------------------------
-- (4) Batas kembali otomatis: 2 jam sejak mulai istirahat.
-- ---------------------------------------------------------
create or replace function batas_istirahat() returns interval
language sql immutable as $$ select interval '2 hours' $$;

comment on function batas_istirahat() is
  'Lupa kembali dari istirahat dianggap kembali 2 jam sesudah mulai. Ditulis sekali supaya layar & server tidak menyimpang.';

-- ---------------------------------------------------------
-- (5) MULAI ISTIRAHAT.
-- ---------------------------------------------------------
-- Bentuk lama (satu argumen) DIBUANG, bukan dibiarkan berdampingan.
--
-- PostgREST memilih fungsi berdasarkan HIMPUNAN NAMA argumen yang dikirim.
-- Dua bentuk yang hidup bersama berarti PWA lama tetap bisa memanggil yang
-- tanpa foto — dan seluruh gerbang buktinya jadi opsional tanpa ada yang tahu.
drop function if exists mulai_istirahat(uuid);
drop function if exists selesai_istirahat(uuid);

create or replace function mulai_istirahat(p_attendance uuid, p_photo text, p_face_match boolean)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_rec attendance_records%rowtype;
  v_set record;
  v_jam time;
  v_id uuid;
  v_foto text := nullif(btrim(coalesce(p_photo, '')), '');
begin
  if v_uid is null then raise exception 'Harus login'; end if;
  -- Fotonya diperiksa DI SINI, sebelum apa pun ditulis. Pesan constraint tidak
  -- memberi tahu staff apa yang harus ia lakukan.
  if v_foto is null then
    raise exception 'Ambil foto selfie dulu sebelum mulai istirahat.';
  end if;

  select * into v_rec from attendance_records where id = p_attendance;
  if v_rec.id is null then raise exception 'Presensi tidak ditemukan.'; end if;
  if v_rec.user_id <> v_uid then raise exception 'Itu presensi orang lain.'; end if;
  if v_rec.clock_out_at is not null then
    raise exception 'Kamu sudah clock out, jadi tidak bisa mulai istirahat.';
  end if;

  if exists (select 1 from attendance_breaks b where b.attendance_id = p_attendance and b.selesai_at is null) then
    raise exception 'Istirahatmu masih berjalan — tekan Kembali dulu.';
  end if;

  select * into v_set from setelan_presensi(v_rec.outlet_id);

  -- JENDELA JAMNYA DITEGAKKAN DI SINI, bukan cuma di layar.
  --
  -- Tombol yang disembunyikan layar tetap bisa ditembus PWA yang tertinggal
  -- versi. Dan kalau jendelanya cuma aturan tampilan, ia bukan aturan.
  if v_set.break_mode = 'ditentukan' then
    v_jam := (now() at time zone 'Asia/Jakarta')::time;
    -- Jendela yang melewati tengah malam (mis. 23:00–01:00) ditangani dengan
    -- membalik perbandingannya. Shift malam ada di aplikasi ini, jadi jendela
    -- seperti itu bukan kemungkinan teoretis.
    if v_set.break_start <= v_set.break_end then
      if v_jam < v_set.break_start or v_jam > v_set.break_end then
        raise exception 'Istirahat hanya bisa diambil antara % dan %.',
          to_char(v_set.break_start, 'HH24:MI'), to_char(v_set.break_end, 'HH24:MI');
      end if;
    else
      if v_jam < v_set.break_start and v_jam > v_set.break_end then
        raise exception 'Istirahat hanya bisa diambil antara % dan %.',
          to_char(v_set.break_start, 'HH24:MI'), to_char(v_set.break_end, 'HH24:MI');
      end if;
    end if;
  end if;

  insert into attendance_breaks (attendance_id, foto_mulai, wajah_mulai)
  values (p_attendance, v_foto, p_face_match)
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function mulai_istirahat(uuid, text, boolean) from public;
grant execute on function mulai_istirahat(uuid, text, boolean) to authenticated;

-- ---------------------------------------------------------
-- (6) KEMBALI DARI ISTIRAHAT.
--
-- Jendela jamnya SENGAJA TIDAK ditegakkan untuk kembali. Menolak orang yang
-- kembali di luar jam hanya menghasilkan istirahat yang menggantung, lalu
-- ditutup otomatis 2 jam — hukuman untuk orang yang justru kembali lebih awal.
-- ---------------------------------------------------------
create or replace function selesai_istirahat(p_attendance uuid, p_photo text, p_face_match boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_rec attendance_records%rowtype;
  v_foto text := nullif(btrim(coalesce(p_photo, '')), '');
begin
  if v_uid is null then raise exception 'Harus login'; end if;
  if v_foto is null then
    raise exception 'Ambil foto selfie dulu sebelum kembali dari istirahat.';
  end if;

  select * into v_rec from attendance_records where id = p_attendance;
  if v_rec.id is null then raise exception 'Presensi tidak ditemukan.'; end if;
  if v_rec.user_id <> v_uid then raise exception 'Itu presensi orang lain.'; end if;

  update attendance_breaks
     set selesai_at = now(), otomatis = false, foto_selesai = v_foto, wajah_selesai = p_face_match
   where attendance_id = p_attendance and selesai_at is null;

  if not found then raise exception 'Tidak ada istirahat yang sedang berjalan.'; end if;
end;
$$;

revoke all on function selesai_istirahat(uuid, text, boolean) from public;
grant execute on function selesai_istirahat(uuid, text, boolean) to authenticated;

-- ---------------------------------------------------------
-- (6b) CLOCK OUT MENUTUP ISTIRAHAT YANG MASIH BERJALAN.
--
-- Istirahat TIDAK PERNAH menghalangi orang pulang — itu disengaja. Tapi kalau
-- ia dibiarkan terbuka, penutup otomatis akan menutupnya di `mulai + 2 jam`,
-- yang bisa jatuh SESUDAH jam pulangnya. Rekapnya lalu berbunyi:
--
--     clock out 17:00 · istirahat 16:30 – 18:30
--
-- Istirahat yang berakhir sesudah shiftnya usai bukan cuma janggal dibaca; ia
-- membuat total menit istirahat lebih besar daripada jam kerjanya sendiri.
--
-- Diambil yang LEBIH AWAL antara jam pulang dan batas 2 jam:
--   - pulang 30 menit setelah mulai istirahat -> istirahatnya 30 menit
--   - pulang 5 jam setelah mulai istirahat    -> tetap 2 jam, sesuai janji
--     yang dibaca staff di layarnya sendiri
--
-- TRIGGER, bukan di dalam `clockOut()` di layar. Jam pulang bisa terisi dari
-- tiga jalan: tombol staff, penutup otomatis, dan koreksi admin. Aturan yang
-- ditulis di satu jalan saja akan terlewat di dua jalan lainnya, dan yang
-- terlihat cuma rekap yang kadang aneh.
-- ---------------------------------------------------------
create or replace function tutup_istirahat_saat_pulang()
returns trigger
language plpgsql
as $$
begin
  if new.clock_out_at is not null and old.clock_out_at is null then
    update attendance_breaks
       set selesai_at = least(new.clock_out_at, mulai_at + batas_istirahat()),
           otomatis = true
     where attendance_id = new.id
       and selesai_at is null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_tutup_istirahat_saat_pulang on attendance_records;
create trigger trg_tutup_istirahat_saat_pulang
  after update of clock_out_at on attendance_records
  for each row execute function tutup_istirahat_saat_pulang();

-- ---------------------------------------------------------
-- (7) Penanda pada presensinya.
--
-- Ditambahkan SEBELUM fungsi penutupnya dibuat, bukan sesudah: fungsi yang
-- menulis ke kolom yang belum ada memang lolos saat dibuat (plpgsql tidak
-- memeriksa katalog saat `create function`), tapi gagal saat DIJALANKAN — dan
-- yang menjalankannya adalah cron tengah malam, bukan orang yang sedang
-- memasang migration.
-- ---------------------------------------------------------
alter table attendance_records add column if not exists auto_closed_at timestamptz;
alter table attendance_records add column if not exists auto_closed_reason text;

comment on column attendance_records.auto_closed_at is
  'Diisi kalau jam pulangnya DITEBAK sistem, bukan ditekan orang. Rekap admin menampilkannya — "pulang jam 5" dan "lupa clock out lalu ditebak jam 5" adalah dua hal yang berbeda.';

-- ---------------------------------------------------------
-- (8) PENUTUP OTOMATIS — istirahat yang lupa ditutup, dan sesi yang menggantung.
--
-- Dipanggil pg_cron tiap jam (lihat bagian 8). Bisa juga dipanggil admin dari
-- layar untuk memeriksa hasilnya; ketika dipanggil orang, ia hanya menyentuh
-- BU yang memang haknya.
-- ---------------------------------------------------------
create or replace function tutup_presensi_tertinggal()
returns table (istirahat_ditutup int, presensi_ditutup int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_break int := 0;
  v_rec int := 0;
  r record;
  v_set record;
  v_shift record;
  v_tanggal date;
  v_keluar timestamptz;
begin
  -- (a) Istirahat yang lupa ditutup -> dianggap kembali 2 jam sesudah mulai.
  with sasaran as (
    select b.id
      from attendance_breaks b
      join attendance_records a on a.id = b.attendance_id
     where b.selesai_at is null
       and b.mulai_at + batas_istirahat() <= now()
       and (v_uid is null or has_bu_scope(v_uid, a.business_unit_id))
  )
  update attendance_breaks b
     set selesai_at = b.mulai_at + batas_istirahat(),
         otomatis = true
    from sasaran s
   where b.id = s.id;
  get diagnostics v_break = row_count;

  -- (b) Presensi yang menggantung.
  for r in
    select a.*
      from attendance_records a
     where a.clock_out_at is null
       and (v_uid is null or has_bu_scope(v_uid, a.business_unit_id))
  loop
    select * into v_set from setelan_presensi(r.outlet_id);
    -- Pemicunya: sudah lewat `auto_close_after_hours` sejak clock in.
    continue when r.clock_in_at + make_interval(hours => floor(v_set.auto_close_after_hours)::int,
                                                mins  => round((v_set.auto_close_after_hours - floor(v_set.auto_close_after_hours)) * 60)::int) > now();

    -- Tanggal kerjanya = tanggal CLOCK IN menurut WIB. Sesi 22:00–07:00 adalah
    -- SATU hari kerja milik tanggal masuknya — aturan yang sama dengan yang
    -- dipakai NBM (`toDateKey(clock_in_at)`).
    v_tanggal := (r.clock_in_at at time zone 'Asia/Jakarta')::date;

    select os.start_time, os.end_time into v_shift
      from shift_schedules ss
      join outlet_shifts os on os.id = ss.shift_id
     where ss.user_id = r.user_id
       and ss.outlet_id = r.outlet_id
       and ss.work_date = v_tanggal
       and not ss.is_off;

    if v_shift.end_time is not null then
      -- Jam pulang menurut shiftnya, pada tanggal kerjanya. Shift yang
      -- melewati tengah malam (end <= start) pulangnya di HARI BERIKUTNYA —
      -- tanpa ini, jam keluar jatuh SEBELUM jam masuk.
      v_keluar := ((v_tanggal + case when v_shift.end_time <= v_shift.start_time then 1 else 0 end)
                   + v_shift.end_time) at time zone 'Asia/Jakarta';
    else
      -- Tanpa shift terjadwal: jam kerja standar dari setelan.
      v_keluar := r.clock_in_at + make_interval(hours => floor(v_set.standard_work_hours)::int,
                                                mins  => round((v_set.standard_work_hours - floor(v_set.standard_work_hours)) * 60)::int);
    end if;

    -- JAM KELUAR TIDAK BOLEH MENDAHULUI JAM MASUK.
    --
    -- Bisa terjadi kalau jadwal shiftnya diubah sesudah orangnya masuk, atau
    -- ia masuk jauh sesudah shiftnya berakhir. Durasi negatif akan membuat
    -- NBM dan seluruh laporan jam kerja menghasilkan angka yang mustahil —
    -- dan tetap tercetak.
    if v_keluar <= r.clock_in_at then
      v_keluar := r.clock_in_at + make_interval(hours => floor(v_set.standard_work_hours)::int,
                                                mins  => round((v_set.standard_work_hours - floor(v_set.standard_work_hours)) * 60)::int);
    end if;

    update attendance_records
       set clock_out_at = v_keluar,
           auto_closed_at = now(),
           auto_closed_reason = case when v_shift.end_time is not null
                                     then 'Lupa clock out — ditutup di jam pulang shift'
                                     else 'Lupa clock out — ditutup setelah jam kerja standar' end
     where id = r.id;
    v_rec := v_rec + 1;
  end loop;

  istirahat_ditutup := v_break;
  presensi_ditutup := v_rec;
  return next;
end;
$$;

revoke all on function tutup_presensi_tertinggal() from public;
grant execute on function tutup_presensi_tertinggal() to authenticated;

comment on function tutup_presensi_tertinggal() is
  'Menutup istirahat yang lupa ditutup (2 jam) dan presensi yang menggantung (jam pulang shift, atau jam kerja standar). Dipanggil pg_cron; kalau dipanggil orang, hanya BU yang jadi haknya.';

-- ---------------------------------------------------------
-- (9) Jadwalkan penutupnya.
--
-- Lewat pg_cron LANGSUNG, bukan Edge Function. Reminder presensi (0008) harus
-- lewat HTTP karena ia mengirim Web Push ke luar; penutup ini murni SQL, jadi
-- ia tidak butuh URL project, service role key, maupun langkah manual apa pun.
--
-- `cron.schedule` dengan nama yang sama menimpa jadwal sebelumnya, jadi
-- menjalankan ulang migration ini aman.
-- ---------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('tutup-presensi-tertinggal', '7 * * * *', 'select tutup_presensi_tertinggal()');
    raise notice 'cron tutup-presensi-tertinggal dijadwalkan tiap jam.';
  else
    raise notice 'pg_cron tidak ada — jadwalkan tutup_presensi_tertinggal() secara manual.';
  end if;
exception when others then
  -- Gagal menjadwalkan TIDAK boleh menggagalkan seluruh migration: tabel &
  -- fungsinya sudah terpasang dan fiturnya sudah bisa dipakai. Yang hilang
  -- cuma otomatisasinya, dan itu dikatakan di sini.
  raise notice 'Gagal menjadwalkan cron (%). Jadwalkan tutup_presensi_tertinggal() manual dari SQL Editor.', sqlerrm;
end $$;

-- ---------------------------------------------------------
-- (10) Laporkan hasilnya.
-- ---------------------------------------------------------
do $$
declare
  v_tabel boolean;
  v_fn boolean;
begin
  select exists (select 1 from information_schema.tables where table_name = 'attendance_breaks') into v_tabel;
  select exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'tutup_presensi_tertinggal') into v_fn;
  raise notice 'tabel attendance_breaks: %', v_tabel;
  raise notice 'fungsi tutup_presensi_tertinggal: %', v_fn;
  if not v_tabel or not v_fn then
    raise exception 'Pemasangan 0138 tidak lengkap.';
  end if;
end $$;
