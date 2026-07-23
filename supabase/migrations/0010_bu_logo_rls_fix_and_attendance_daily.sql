-- =========================================================
-- Berjaya Hub OMS — 0010
-- (1) Perbaikan RLS upload logo BU (error: "new row violates row-level security policy")
-- (2) Batasi presensi: 1 clock-in per staff per hari (biar NBM tidak kacau)
-- Migration ini idempotent — aman dijalankan ulang.
-- =========================================================

-- ---------------------------------------------------------
-- (1) BUCKET & RLS LOGO BU
-- Penyebab umum error upload logo: migration 0009 belum jalan,
-- atau policy-nya tidak lengkap (misal tidak ada policy DELETE untuk
-- upsert file yang sudah ada). Di sini kita bikin ulang dengan lengkap.
-- ---------------------------------------------------------

-- Pastikan bucket ada & publik
insert into storage.buckets (id, name, public)
values ('bu-logos', 'bu-logos', true)
on conflict (id) do update set public = true;

-- Bersihkan policy lama biar tidak dobel / konflik
drop policy if exists bu_logo_insert on storage.objects;
drop policy if exists bu_logo_update on storage.objects;
drop policy if exists bu_logo_delete on storage.objects;
drop policy if exists bu_logo_select on storage.objects;

-- Konvensi path: {business_unit_id}/logo.jpg — hanya admin BU terkait (atau
-- super_admin) yang boleh menulis. Folder pertama dari path = business_unit_id.
create policy bu_logo_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'bu-logos'
    and is_bu_admin(auth.uid(), (storage.foldername(name))[1]::uuid)
  );

create policy bu_logo_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'bu-logos'
    and is_bu_admin(auth.uid(), (storage.foldername(name))[1]::uuid)
  )
  with check (
    bucket_id = 'bu-logos'
    and is_bu_admin(auth.uid(), (storage.foldername(name))[1]::uuid)
  );

create policy bu_logo_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'bu-logos'
    and is_bu_admin(auth.uid(), (storage.foldername(name))[1]::uuid)
  );

-- Read publik (bucket sudah public, tapi policy select eksplisit ini menjaga
-- kalau suatu saat bucket diubah jadi privat, admin tetap bisa lihat).
create policy bu_logo_select on storage.objects
  for select to public
  using (bucket_id = 'bu-logos');

-- ---------------------------------------------------------
-- (2) PRESENSI 1x PER HARI
-- Helper immutable untuk ambil tanggal lokal (WIB) dari timestamptz,
-- supaya bisa dipakai di index unik.
-- ---------------------------------------------------------
create or replace function jkt_date(ts timestamptz)
returns date
language sql
immutable
as $$
  select (ts at time zone 'Asia/Jakarta')::date;
$$;

-- 1 baris presensi per user per tanggal (WIB). Kalau sudah pernah clock-in
-- hari itu, insert baru akan ditolak database — pertahanan lapis kedua
-- selain validasi di aplikasi.
--
-- CATATAN: kalau tabel attendance_records sudah punya >1 baris untuk user
-- yang sama di hari yang sama, pembuatan index ini akan gagal. Bersihkan
-- data duplikat dulu, lalu jalankan ulang migration ini.
create unique index if not exists uniq_attendance_one_per_day
  on attendance_records (user_id, jkt_date(clock_in_at));
