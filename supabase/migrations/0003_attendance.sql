-- =========================================================
-- Berjaya Hub OMS — Fase 2: Presensi
-- =========================================================

-- Helper generik: cek apakah user adalah admin (bu_admin/outlet_admin/super_admin)
-- untuk outlet tertentu. Dipakai attendance, dan bisa dipakai ulang oleh
-- modul lain nanti (ceklis, inventory, dst) untuk pola akses yang sama.
create or replace function is_admin_of_outlet(p_user_id uuid, p_outlet_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from membership_scopes ms
    join outlets o on o.id = p_outlet_id
    where ms.user_id = p_user_id
      and (
        ms.role = 'super_admin'
        or (ms.role = 'bu_admin' and ms.business_unit_id = o.business_unit_id)
        or (ms.role = 'outlet_admin' and ms.outlet_id = p_outlet_id)
      )
  );
$$;

-- ---------------------------------------------------------
-- ATTENDANCE_RECORDS
-- 1 baris = 1 sesi kerja (clock in -> clock out).
-- clock_out_at null berarti staff masih "sedang bekerja" / belum clock out.
-- ---------------------------------------------------------
create table attendance_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references user_profiles(id) on delete cascade,
  business_unit_id uuid not null references business_units(id) on delete cascade,
  outlet_id uuid not null references outlets(id) on delete cascade,
  clock_in_at timestamptz not null default now(),
  clock_in_lat double precision,
  clock_in_lng double precision,
  clock_out_at timestamptz,
  clock_out_lat double precision,
  clock_out_lng double precision,
  notes text,
  created_at timestamptz not null default now()
);

create index idx_attendance_user on attendance_records(user_id);
create index idx_attendance_outlet on attendance_records(outlet_id);
create index idx_attendance_clock_in on attendance_records(clock_in_at);

alter table attendance_records enable row level security;

-- Staff bisa lihat riwayat presensi sendiri
create policy attendance_select_own on attendance_records
  for select using (user_id = auth.uid());

-- Admin (bu_admin/outlet_admin/super_admin) bisa lihat semua presensi di outlet scope-nya
create policy attendance_select_admin on attendance_records
  for select using (is_admin_of_outlet(auth.uid(), outlet_id));

-- Staff cuma boleh insert presensi untuk dirinya sendiri, di outlet tempat
-- dia terdaftar (langsung di outlet itu, atau di level BU-nya)
create policy attendance_insert_own on attendance_records
  for insert with check (
    user_id = auth.uid()
    and exists (
      select 1 from membership_scopes ms
      where ms.user_id = auth.uid()
        and ms.business_unit_id = attendance_records.business_unit_id
        and (ms.outlet_id = attendance_records.outlet_id or ms.outlet_id is null)
    )
  );

-- Staff boleh update record sendiri (buat clock out); admin boleh koreksi
-- record siapapun di outlet scope-nya
create policy attendance_update_own on attendance_records
  for update using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy attendance_update_admin on attendance_records
  for update using (is_admin_of_outlet(auth.uid(), outlet_id))
  with check (is_admin_of_outlet(auth.uid(), outlet_id));
