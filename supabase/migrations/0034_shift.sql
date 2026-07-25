-- =========================================================
-- Berjaya Hub OMS — Fase tambahan: Modul Shift (jadwal kerja staff)
--
-- Struktur:
--   shift_settings   : per BU  -> jumlah shift (2-4) + toleransi terlambat (menit)
--   outlet_shifts    : per outlet -> nama & jam tiap slot shift (boleh lintas tengah malam)
--   shift_schedules  : jadwal staff per tanggal (shift tertentu / LIBUR)
--   outlets.shift_enabled : aktif/nonaktif modul shift PER OUTLET (super admin)
--
-- Integrasi presensi: attendance_records menyimpan snapshot status keterlambatan.
-- =========================================================

insert into modules (code, name, description)
values ('shift', 'Shift', 'Jadwal kerja staff per outlet')
on conflict (code) do nothing;

-- ---- Aktivasi modul shift per outlet (hanya super admin yang boleh ubah) ----
alter table outlets add column if not exists shift_enabled boolean not null default false;

create or replace function set_outlet_shift_enabled(p_outlet uuid, p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_super_admin(auth.uid()) then
    raise exception 'Hanya Super Admin yang bisa mengaktifkan modul Shift per outlet';
  end if;
  update outlets set shift_enabled = p_enabled where id = p_outlet;
end;
$$;
grant execute on function set_outlet_shift_enabled(uuid, boolean) to authenticated;

-- Daftar outlet untuk app perlu tahu status modul shift tiap outlet.
drop function if exists list_attendance_outlets();
create function list_attendance_outlets()
returns table (
  id uuid,
  name text,
  business_unit_id uuid,
  business_unit_name text,
  latitude double precision,
  longitude double precision,
  geofence_radius_m integer,
  outlet_role text,
  allow_sales boolean,
  served_by_outlet_id uuid,
  shift_enabled boolean
)
language sql
security definer
stable
set search_path = public
as $$
  select o.id, o.name, o.business_unit_id, bu.name, o.latitude, o.longitude, o.geofence_radius_m,
         o.outlet_role, o.allow_sales, o.served_by_outlet_id, o.shift_enabled
  from outlets o
  join business_units bu on bu.id = o.business_unit_id
  where o.is_active
  order by bu.name, o.name;
$$;
grant execute on function list_attendance_outlets() to authenticated;

-- ---- Pengaturan shift per BU (admin BU) ----
create table shift_settings (
  business_unit_id uuid primary key references business_units(id) on delete cascade,
  shift_count int not null default 2 check (shift_count between 2 and 4),
  late_tolerance_minutes int not null default 10 check (late_tolerance_minutes >= 0),
  updated_at timestamptz not null default now()
);

alter table shift_settings enable row level security;
create policy shift_settings_select on shift_settings
  for select using (has_bu_scope(auth.uid(), business_unit_id));
create policy shift_settings_modify on shift_settings
  for all using (is_bu_admin(auth.uid(), business_unit_id))
  with check (is_bu_admin(auth.uid(), business_unit_id));

-- ---- Jam shift per outlet (admin BU & admin outlet) ----
-- crosses_midnight: true bila end_time < start_time (mis. 22:00 -> 06:00)
create table outlet_shifts (
  id uuid primary key default gen_random_uuid(),
  business_unit_id uuid not null references business_units(id) on delete cascade,
  outlet_id uuid not null references outlets(id) on delete cascade,
  slot int not null check (slot between 1 and 4),
  name text not null,
  start_time time not null,
  end_time time not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (outlet_id, slot)
);
create index idx_outlet_shifts_outlet on outlet_shifts(outlet_id);

alter table outlet_shifts enable row level security;
create policy outlet_shifts_select on outlet_shifts
  for select using (has_bu_scope(auth.uid(), business_unit_id));
create policy outlet_shifts_modify on outlet_shifts
  for all using (is_admin_of_outlet(auth.uid(), outlet_id))
  with check (is_admin_of_outlet(auth.uid(), outlet_id));

-- ---- Jadwal staff per tanggal ----
-- shift_id null + is_off true  -> LIBUR (eksplisit)
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
create index idx_shift_schedules_lookup on shift_schedules(outlet_id, work_date);
create index idx_shift_schedules_user on shift_schedules(user_id, work_date);

alter table shift_schedules enable row level security;

-- Staff melihat jadwal di outlet/BU tempat dia terdaftar (agar tabel mingguan
-- satu tim bisa dilihat bersama), admin outlet/BU yang mengelola.
create policy shift_schedules_select on shift_schedules
  for select using (has_bu_scope(auth.uid(), business_unit_id));
create policy shift_schedules_modify on shift_schedules
  for all using (is_admin_of_outlet(auth.uid(), outlet_id))
  with check (is_admin_of_outlet(auth.uid(), outlet_id));

-- ---- Snapshot keterlambatan di presensi ----
-- late_status: ontime | tolerance | late | no_schedule | off_day
alter table attendance_records add column if not exists shift_id uuid references outlet_shifts(id) on delete set null;
alter table attendance_records add column if not exists shift_name text;
alter table attendance_records add column if not exists late_minutes int;
alter table attendance_records add column if not exists late_status text
  check (late_status in ('ontime', 'tolerance', 'late', 'no_schedule', 'off_day'));
