-- =========================================================
-- Berjaya Hub OMS — Fase 3: Pengajuan Cuti (Leave)
-- Jenis cuti + jatah tahunan + approval + lampiran.
-- Modul 'leave' sudah di-seed di 0001; aktifkan per BU lewat toggle modul.
-- =========================================================

-- ---------------------------------------------------------
-- JENIS CUTI
-- business_unit_id NULL = jenis default global (dipakai semua BU).
-- deducts_quota = apakah jenis ini memotong jatah cuti tahunan staff.
-- ---------------------------------------------------------
create table leave_types (
  id uuid primary key default gen_random_uuid(),
  business_unit_id uuid references business_units(id) on delete cascade,
  name text not null,
  deducts_quota boolean not null default true,
  requires_attachment boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into leave_types (business_unit_id, name, deducts_quota, requires_attachment) values
  (null, 'Cuti Tahunan', true, false),
  (null, 'Sakit', false, false),
  (null, 'Izin', false, false);

-- ---------------------------------------------------------
-- JATAH CUTI TAHUNAN per staff per tahun
-- ---------------------------------------------------------
create table leave_quotas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references user_profiles(id) on delete cascade,
  year int not null,
  total_days numeric not null default 12,
  created_at timestamptz not null default now(),
  unique (user_id, year)
);

-- ---------------------------------------------------------
-- PENGAJUAN CUTI
-- outlet_id = outlet basis staff (untuk menentukan admin mana yang boleh approve).
-- day_count = jumlah hari (kalender, inklusif) yang diajukan.
-- ---------------------------------------------------------
create table leave_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references user_profiles(id) on delete cascade,
  business_unit_id uuid not null references business_units(id) on delete cascade,
  outlet_id uuid references outlets(id) on delete set null,
  leave_type_id uuid not null references leave_types(id),
  start_date date not null,
  end_date date not null,
  day_count int not null,
  reason text,
  attachment_path text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  reviewed_by uuid references user_profiles(id),
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  constraint leave_valid_range check (end_date >= start_date)
);

create index idx_leave_requests_user on leave_requests(user_id);
create index idx_leave_requests_bu on leave_requests(business_unit_id);
create index idx_leave_requests_outlet on leave_requests(outlet_id);
create index idx_leave_requests_status on leave_requests(status);
create index idx_leave_requests_dates on leave_requests(start_date, end_date);

-- =========================================================
-- RLS
-- =========================================================
alter table leave_types enable row level security;
alter table leave_quotas enable row level security;
alter table leave_requests enable row level security;

-- leave_types: semua user login boleh baca (untuk isi dropdown).
create policy leave_types_select on leave_types
  for select using (auth.uid() is not null);
create policy leave_types_modify_bu on leave_types
  for all using (business_unit_id is not null and is_bu_admin(auth.uid(), business_unit_id))
  with check (business_unit_id is not null and is_bu_admin(auth.uid(), business_unit_id));
create policy leave_types_modify_global on leave_types
  for all using (business_unit_id is null and is_super_admin(auth.uid()))
  with check (business_unit_id is null and is_super_admin(auth.uid()));

-- leave_quotas: staff lihat jatah sendiri; admin BU staff itu boleh lihat & kelola.
create policy leave_quotas_select_own on leave_quotas
  for select using (user_id = auth.uid());
create policy leave_quotas_admin on leave_quotas
  for all using (
    exists (
      select 1 from membership_scopes ms
      where ms.user_id = leave_quotas.user_id and is_bu_admin(auth.uid(), ms.business_unit_id)
    )
  )
  with check (
    exists (
      select 1 from membership_scopes ms
      where ms.user_id = leave_quotas.user_id and is_bu_admin(auth.uid(), ms.business_unit_id)
    )
  );

-- leave_requests
create policy leave_requests_insert_own on leave_requests
  for insert with check (
    user_id = auth.uid()
    and exists (
      select 1 from membership_scopes ms
      where ms.user_id = auth.uid() and ms.business_unit_id = leave_requests.business_unit_id
    )
  );

create policy leave_requests_select_own on leave_requests
  for select using (user_id = auth.uid());

create policy leave_requests_select_admin on leave_requests
  for select using (
    (outlet_id is not null and is_admin_of_outlet(auth.uid(), outlet_id))
    or (outlet_id is null and is_bu_admin(auth.uid(), business_unit_id))
  );

-- Staff boleh ubah pengajuan sendiri hanya selagi masih 'pending' (untuk membatalkan).
create policy leave_requests_update_own on leave_requests
  for update using (user_id = auth.uid() and status = 'pending')
  with check (user_id = auth.uid());

-- Admin di scope boleh approve/tolak.
create policy leave_requests_update_admin on leave_requests
  for update using (
    (outlet_id is not null and is_admin_of_outlet(auth.uid(), outlet_id))
    or (outlet_id is null and is_bu_admin(auth.uid(), business_unit_id))
  )
  with check (
    (outlet_id is not null and is_admin_of_outlet(auth.uid(), outlet_id))
    or (outlet_id is null and is_bu_admin(auth.uid(), business_unit_id))
  );

-- =========================================================
-- STORAGE: lampiran cuti (privat)
-- Path konvensi: {user_id}/{request_id}.{ext}
-- =========================================================
insert into storage.buckets (id, name, public)
values ('leave-attachments', 'leave-attachments', false)
on conflict (id) do nothing;

create policy leave_attach_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'leave-attachments'
    and exists (select 1 from membership_scopes ms where ms.user_id = auth.uid())
  );

create policy leave_attach_select on storage.objects
  for select using (
    bucket_id = 'leave-attachments'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or exists (
        select 1 from leave_requests lr
        where lr.attachment_path = storage.objects.name
          and (
            (lr.outlet_id is not null and is_admin_of_outlet(auth.uid(), lr.outlet_id))
            or (lr.outlet_id is null and is_bu_admin(auth.uid(), lr.business_unit_id))
          )
      )
    )
  );
