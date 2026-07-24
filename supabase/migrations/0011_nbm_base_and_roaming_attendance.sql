-- =========================================================
-- Berjaya Hub OMS — 0011
-- Presensi "roaming": staff boleh absen di outlet Berjaya mana pun,
-- tapi NBM tetap berlabuh ke BU+outlet tempat kerja utamanya (Master User).
-- Idempotent — aman dijalankan ulang.
-- =========================================================

-- ---------------------------------------------------------
-- (1) Penanda "tempat kerja utama" (basis NBM) di scope staff
-- Tepat satu scope per user boleh jadi primary (dijaga index unik parsial).
-- ---------------------------------------------------------
alter table membership_scopes add column if not exists is_primary boolean not null default false;

create unique index if not exists uniq_membership_one_primary
  on membership_scopes (user_id)
  where is_primary;

-- ---------------------------------------------------------
-- (2) Basis NBM di tiap baris presensi
-- outlet_id/business_unit_id = LOKASI FISIK saat absen (geofence + watermark).
-- nbm_* = BU/outlet basis staff, dipakai untuk perhitungan NBM.
-- Nullable: baris lama / fallback -> pakai lokasi fisik seperti perilaku lama.
-- ---------------------------------------------------------
alter table attendance_records
  add column if not exists nbm_business_unit_id uuid references business_units(id) on delete set null;
alter table attendance_records
  add column if not exists nbm_outlet_id uuid references outlets(id) on delete set null;

create index if not exists idx_attendance_nbm_bu on attendance_records(nbm_business_unit_id);

-- ---------------------------------------------------------
-- (3) Longgarkan RLS INSERT presensi
-- Staff aktif boleh mencatat presensi DIRINYA SENDIRI di outlet mana pun
-- (tetap tidak bisa atas nama user lain). Ini yang memungkinkan "absen di
-- outlet Berjaya mana pun".
-- ---------------------------------------------------------
drop policy if exists attendance_insert_own on attendance_records;
create policy attendance_insert_own on attendance_records
  for insert with check (
    user_id = auth.uid()
    and exists (select 1 from membership_scopes ms where ms.user_id = auth.uid())
  );

-- ---------------------------------------------------------
-- (4) Perluas akses admin: admin BU-BASIS (pengupah NBM) boleh lihat &
-- koreksi presensi staffnya, walau lokasi fisiknya di BU lain.
-- (Policy admin lama berbasis lokasi fisik tetap berlaku, di-OR dengan ini.)
-- ---------------------------------------------------------
drop policy if exists attendance_select_admin_nbm on attendance_records;
create policy attendance_select_admin_nbm on attendance_records
  for select using (
    nbm_business_unit_id is not null and is_bu_admin(auth.uid(), nbm_business_unit_id)
  );

drop policy if exists attendance_update_admin_nbm on attendance_records;
create policy attendance_update_admin_nbm on attendance_records
  for update using (
    nbm_business_unit_id is not null and is_bu_admin(auth.uid(), nbm_business_unit_id)
  )
  with check (
    nbm_business_unit_id is not null and is_bu_admin(auth.uid(), nbm_business_unit_id)
  );
