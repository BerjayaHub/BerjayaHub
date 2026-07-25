-- =========================================================
-- Berjaya Hub OMS — Modul Armada (Fleet)
-- Fokus: data kendaraan lengkap, status & area rental, dokumen STNK/KIR,
-- serta reminder perpanjangan. Dikelola dari Admin Portal (admin BU/outlet).
-- Modul 'fleet' sudah di-seed sejak 0001; aktifkan per BU lewat toggle modul.
-- =========================================================

-- ---- Pengaturan reminder per BU ----
create table fleet_settings (
  business_unit_id uuid primary key references business_units(id) on delete cascade,
  reminder_lead_days int not null default 30 check (reminder_lead_days >= 1),
  updated_at timestamptz not null default now()
);

alter table fleet_settings enable row level security;
create policy fleet_settings_select on fleet_settings
  for select using (has_bu_scope(auth.uid(), business_unit_id));
create policy fleet_settings_modify on fleet_settings
  for all using (is_bu_admin(auth.uid(), business_unit_id))
  with check (is_bu_admin(auth.uid(), business_unit_id));

-- ---- Kendaraan ----
-- status: idle (tersedia) | rented (sedang direntalkan) | maintenance | inactive
create table vehicles (
  id uuid primary key default gen_random_uuid(),
  business_unit_id uuid not null references business_units(id) on delete cascade,
  outlet_id uuid references outlets(id) on delete set null,      -- outlet/pool basis
  plate_number text not null,
  brand text,
  model text,
  vehicle_type text,                                             -- mobil / motor / pickup / truk
  year int,
  color text,
  chassis_number text,                                           -- no. rangka
  engine_number text,                                            -- no. mesin
  ownership text,                                                -- milik sendiri / leasing / sewa
  status text not null default 'idle' check (status in ('idle', 'rented', 'maintenance', 'inactive')),

  -- Info rental yang sedang berjalan
  renter_name text,
  rental_area text,                                              -- area kendaraan sedang direntalkan
  rental_start date,
  rental_end date,
  rental_notes text,

  -- Dokumen
  stnk_number text,
  stnk_tax_expiry date,                                          -- pajak tahunan STNK
  stnk_expiry date,                                              -- STNK 5 tahunan / plat
  kir_number text,
  kir_expiry date,

  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (business_unit_id, plate_number)
);
create index idx_vehicles_bu on vehicles(business_unit_id);
create index idx_vehicles_status on vehicles(business_unit_id, status);

alter table vehicles enable row level security;
create policy vehicles_select on vehicles
  for select using (has_bu_scope(auth.uid(), business_unit_id));
create policy vehicles_modify on vehicles
  for all using (is_bu_admin(auth.uid(), business_unit_id))
  with check (is_bu_admin(auth.uid(), business_unit_id));

-- ---- Riwayat rental ----
create table vehicle_rentals (
  id uuid primary key default gen_random_uuid(),
  business_unit_id uuid not null references business_units(id) on delete cascade,
  vehicle_id uuid not null references vehicles(id) on delete cascade,
  renter_name text not null,
  rental_area text,
  start_date date not null,
  end_date date,
  notes text,
  created_by uuid references user_profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index idx_vehicle_rentals_vehicle on vehicle_rentals(vehicle_id);

alter table vehicle_rentals enable row level security;
create policy vehicle_rentals_select on vehicle_rentals
  for select using (has_bu_scope(auth.uid(), business_unit_id));
create policy vehicle_rentals_modify on vehicle_rentals
  for all using (is_bu_admin(auth.uid(), business_unit_id))
  with check (is_bu_admin(auth.uid(), business_unit_id));
