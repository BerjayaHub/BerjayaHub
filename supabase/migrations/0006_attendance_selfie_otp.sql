-- =========================================================
-- Berjaya Hub OMS — Fase 2 (tambahan): Selfie Presensi & Tugas Keluar (OTP)
-- =========================================================

-- ---------------------------------------------------------
-- Storage bucket buat foto selfie presensi (privat, akses lewat RLS)
-- ---------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('attendance-selfies', 'attendance-selfies', false)
on conflict (id) do nothing;

-- Path konvensi: {outlet_id}/{record_id}_{in|out}.jpg
-- Staff cuma boleh upload ke folder outlet tempat dia terdaftar
create policy attendance_selfie_insert on storage.objects
  for insert with check (
    bucket_id = 'attendance-selfies'
    and exists (
      select 1 from membership_scopes ms
      where ms.user_id = auth.uid()
        and (ms.outlet_id::text = (storage.foldername(name))[1] or ms.outlet_id is null)
    )
  );

-- Admin outlet terkait, atau staff pemilik record, boleh lihat fotonya
create policy attendance_selfie_select on storage.objects
  for select using (
    bucket_id = 'attendance-selfies'
    and (
      is_admin_of_outlet(auth.uid(), (storage.foldername(name))[1]::uuid)
      or exists (
        select 1 from attendance_records ar
        where ar.id::text = split_part((storage.foldername(name))[2], '_', 1)
          and ar.user_id = auth.uid()
      )
    )
  );

-- ---------------------------------------------------------
-- Kolom foto & tugas keluar di attendance_records
-- ---------------------------------------------------------
alter table attendance_records add column clock_in_photo_path text;
alter table attendance_records add column clock_out_photo_path text;
alter table attendance_records add column exit_method text check (exit_method in ('storing', 'otp'));
alter table attendance_records add column exit_reason text;
alter table attendance_records add column exit_otp_code_id uuid;

-- ---------------------------------------------------------
-- Mode tugas keluar per Business Unit
-- ---------------------------------------------------------
alter table business_units add column exit_task_mode text not null default 'storing'
  check (exit_task_mode in ('storing', 'otp'));

-- ---------------------------------------------------------
-- Kode OTP tugas keluar (mode manual: admin generate, staff input)
-- ---------------------------------------------------------
create table exit_task_otp_codes (
  id uuid primary key default gen_random_uuid(),
  business_unit_id uuid not null references business_units(id) on delete cascade,
  code text not null,
  created_by uuid references user_profiles(id),
  expires_at timestamptz not null,
  used_at timestamptz,
  used_by uuid references user_profiles(id),
  created_at timestamptz not null default now()
);

create index idx_exit_otp_bu on exit_task_otp_codes(business_unit_id);

alter table exit_task_otp_codes enable row level security;

-- Hanya admin yang boleh lihat & generate kode (staff akses lewat RPC di bawah, bukan tabel langsung)
create policy exit_otp_admin_select on exit_task_otp_codes
  for select using (is_bu_admin(auth.uid(), business_unit_id));

create policy exit_otp_admin_insert on exit_task_otp_codes
  for insert with check (is_bu_admin(auth.uid(), business_unit_id));

-- ---------------------------------------------------------
-- RPC: staff redeem kode OTP tugas keluar. security definer supaya
-- staff (yang gak punya akses tabel exit_task_otp_codes langsung)
-- tetap bisa validasi & pakai kodenya lewat 1 pintu terkontrol ini.
-- ---------------------------------------------------------
create or replace function redeem_exit_otp(p_code text, p_business_unit_id uuid)
returns uuid
language plpgsql
security definer
as $$
declare
  matched_id uuid;
begin
  select id into matched_id
  from exit_task_otp_codes
  where business_unit_id = p_business_unit_id
    and code = p_code
    and used_at is null
    and expires_at > now()
  limit 1;

  if matched_id is null then
    return null;
  end if;

  update exit_task_otp_codes
  set used_at = now(), used_by = auth.uid()
  where id = matched_id;

  return matched_id;
end;
$$;

-- ---------------------------------------------------------
-- Perketat insert presensi: kalau exit_method = 'otp', wajib ada
-- exit_otp_code_id yang valid (dipakai oleh user ini, di BU yang sama,
-- baru saja diredeem dalam 30 menit terakhir) — bukan cuma klaim sepihak dari client.
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
      (
        is_storing = true
        and (
          exit_method = 'storing'
          or (
            exit_method = 'otp'
            and exists (
              select 1 from exit_task_otp_codes c
              where c.id = exit_otp_code_id
                and c.business_unit_id = attendance_records.business_unit_id
                and c.used_by = auth.uid()
                and c.used_at is not null
                and c.used_at > now() - interval '30 minutes'
            )
          )
        )
      )
      or (
        is_storing = false
        and is_within_outlet_geofence(outlet_id, clock_in_lat, clock_in_lng)
      )
    )
  );
