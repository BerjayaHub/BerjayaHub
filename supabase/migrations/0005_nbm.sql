-- =========================================================
-- Berjaya Hub OMS — Fase 2 (tambahan): NBM / Uang Hadir
-- =========================================================

-- Tandai sesi presensi sebagai "storing" (tugas di luar outlet).
-- Kalau true, validasi geofence dilewati (staff boleh absen dari luar radius outlet).
alter table attendance_records add column is_storing boolean not null default false;

-- ---------------------------------------------------------
-- OUTLET_NBM_CONFIG — 1 baris per outlet, nominal dasar
-- ---------------------------------------------------------
create table outlet_nbm_config (
  outlet_id uuid primary key references outlets(id) on delete cascade,
  base_amount numeric(12,2) not null default 0,
  holiday_amount numeric(12,2), -- null = hari libur pakai base_amount juga
  storing_bonus_amount numeric(12,2) not null default 0,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------
-- OUTLET_NBM_OVERTIME_TIERS — bonus lembur bertingkat, bebas
-- jumlah tingkatannya per outlet, tidak di-hardcode.
-- threshold_minutes: menit sejak tengah malam TANGGAL CLOCK-IN.
-- Contoh: 19:15 -> 1155, 21:15 -> 1275, lewat tengah malam (00:00
-- keesokan harinya) -> 1440. Nilai >=1440 otomatis berarti "besok".
-- ---------------------------------------------------------
create table outlet_nbm_overtime_tiers (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references outlets(id) on delete cascade,
  threshold_minutes integer not null,
  bonus_amount numeric(12,2) not null,
  label text, -- optional, misal "Lewat 19:15"
  created_at timestamptz not null default now()
);

create index idx_nbm_tiers_outlet on outlet_nbm_overtime_tiers(outlet_id);

-- ---------------------------------------------------------
-- HOLIDAYS — tanggal hari libur, bisa berlaku untuk 1 outlet
-- spesifik, 1 BU (semua outletnya), atau berlaku umum kalau
-- business_unit_id & outlet_id dua-duanya null.
-- ---------------------------------------------------------
create table holidays (
  id uuid primary key default gen_random_uuid(),
  holiday_date date not null,
  name text not null,
  business_unit_id uuid references business_units(id) on delete cascade,
  outlet_id uuid references outlets(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index idx_holidays_date on holidays(holiday_date);

-- =========================================================
-- RLS — semua tabel NBM ini data admin/payroll, jadi hanya
-- admin (bu_admin/outlet_admin/super_admin) yang bisa akses.
-- Staff tidak perlu baca ini langsung (checkbox storing di form
-- presensi tidak butuh baca tabel config).
-- =========================================================

alter table outlet_nbm_config enable row level security;
alter table outlet_nbm_overtime_tiers enable row level security;
alter table holidays enable row level security;

create policy nbm_config_select on outlet_nbm_config
  for select using (is_admin_of_outlet(auth.uid(), outlet_id));

create policy nbm_config_modify on outlet_nbm_config
  for all using (is_admin_of_outlet(auth.uid(), outlet_id))
  with check (is_admin_of_outlet(auth.uid(), outlet_id));

create policy nbm_tiers_select on outlet_nbm_overtime_tiers
  for select using (is_admin_of_outlet(auth.uid(), outlet_id));

create policy nbm_tiers_modify on outlet_nbm_overtime_tiers
  for all using (is_admin_of_outlet(auth.uid(), outlet_id))
  with check (is_admin_of_outlet(auth.uid(), outlet_id));

-- holidays: cek lewat business_unit_id (kalau outlet_id null tapi
-- business_unit_id ada) atau outlet_id langsung
create policy holidays_select on holidays
  for select using (
    (outlet_id is not null and is_admin_of_outlet(auth.uid(), outlet_id))
    or (outlet_id is null and business_unit_id is not null and is_bu_admin(auth.uid(), business_unit_id))
    or (outlet_id is null and business_unit_id is null and is_super_admin(auth.uid()))
  );

create policy holidays_modify on holidays
  for all using (
    (outlet_id is not null and is_admin_of_outlet(auth.uid(), outlet_id))
    or (outlet_id is null and business_unit_id is not null and is_bu_admin(auth.uid(), business_unit_id))
    or (outlet_id is null and business_unit_id is null and is_super_admin(auth.uid()))
  )
  with check (
    (outlet_id is not null and is_admin_of_outlet(auth.uid(), outlet_id))
    or (outlet_id is null and business_unit_id is not null and is_bu_admin(auth.uid(), business_unit_id))
    or (outlet_id is null and business_unit_id is null and is_super_admin(auth.uid()))
  );

-- ---------------------------------------------------------
-- Perbarui policy insert presensi: kalau is_storing = true,
-- validasi geofence dilewati sepenuhnya (staff sedang tugas
-- di luar outlet, jadi wajar lokasinya jauh).
-- ---------------------------------------------------------
drop policy attendance_insert_own on attendance_records;

create policy attendance_insert_own on attendance_records
  for insert with check (
    user_id = auth.uid()
    and exists (
      select 1 from membership_scopes ms
      where ms.user_id = auth.uid()
        and ms.business_unit_id = attendance_records.business_unit_id
        and (ms.outlet_id = attendance_records.outlet_id or ms.outlet_id is null)
    )
    and (
      is_storing = true
      or is_within_outlet_geofence(outlet_id, clock_in_lat, clock_in_lng)
    )
  );
