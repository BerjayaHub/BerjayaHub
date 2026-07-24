-- =========================================================
-- Berjaya Hub OMS — Fase 4: Ceklis Kebersihan
-- Item template per BU (daftar rata) + sesi per hari (mis. Buka/Tutup) +
-- run (sesi selesai) per outlet/sesi/tanggal dengan 1 foto bukti wajib.
-- Modul 'cleaning_checklist' sudah di-seed di 0001; aktifkan per BU lewat toggle.
-- =========================================================

-- ---------------------------------------------------------
-- ITEM TEMPLATE (per BU, dipakai semua outletnya)
-- ---------------------------------------------------------
create table checklist_items (
  id uuid primary key default gen_random_uuid(),
  business_unit_id uuid not null references business_units(id) on delete cascade,
  label text not null,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index idx_checklist_items_bu on checklist_items(business_unit_id);

-- ---------------------------------------------------------
-- SESI (per BU): mis. "Buka", "Tutup", atau nama shift
-- ---------------------------------------------------------
create table checklist_sessions (
  id uuid primary key default gen_random_uuid(),
  business_unit_id uuid not null references business_units(id) on delete cascade,
  name text not null,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index idx_checklist_sessions_bu on checklist_sessions(business_unit_id);

-- ---------------------------------------------------------
-- RUN: satu sesi ceklis yang sudah dikerjakan di outlet tertentu, tanggal tertentu.
-- 1 run per (outlet, sesi, tanggal). Foto bukti wajib (diisi setelah insert).
-- ---------------------------------------------------------
create table checklist_runs (
  id uuid primary key default gen_random_uuid(),
  business_unit_id uuid not null references business_units(id) on delete cascade,
  outlet_id uuid not null references outlets(id) on delete cascade,
  session_id uuid not null references checklist_sessions(id) on delete cascade,
  run_date date not null,
  user_id uuid not null references user_profiles(id) on delete cascade,
  photo_path text,
  notes text,
  created_at timestamptz not null default now(),
  unique (outlet_id, session_id, run_date)
);
create index idx_checklist_runs_outlet on checklist_runs(outlet_id);
create index idx_checklist_runs_date on checklist_runs(run_date);

-- ---------------------------------------------------------
-- STATE tiap item dalam sebuah run
-- ---------------------------------------------------------
create table checklist_run_items (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references checklist_runs(id) on delete cascade,
  item_id uuid not null references checklist_items(id) on delete cascade,
  checked boolean not null default false,
  note text
);
create index idx_checklist_run_items_run on checklist_run_items(run_id);

-- =========================================================
-- RLS
-- =========================================================
alter table checklist_items enable row level security;
alter table checklist_sessions enable row level security;
alter table checklist_runs enable row level security;
alter table checklist_run_items enable row level security;

-- Item & sesi: anggota BU boleh baca; admin BU kelola.
create policy checklist_items_select on checklist_items
  for select using (has_bu_scope(auth.uid(), business_unit_id));
create policy checklist_items_modify on checklist_items
  for all using (is_bu_admin(auth.uid(), business_unit_id))
  with check (is_bu_admin(auth.uid(), business_unit_id));

create policy checklist_sessions_select on checklist_sessions
  for select using (has_bu_scope(auth.uid(), business_unit_id));
create policy checklist_sessions_modify on checklist_sessions
  for all using (is_bu_admin(auth.uid(), business_unit_id))
  with check (is_bu_admin(auth.uid(), business_unit_id));

-- Runs: staff catat run sendiri di BU tempat dia terdaftar; lihat sendiri;
-- admin outlet/BU lihat & koreksi.
create policy checklist_runs_insert_own on checklist_runs
  for insert with check (
    user_id = auth.uid()
    and exists (
      select 1 from membership_scopes ms
      where ms.user_id = auth.uid() and ms.business_unit_id = checklist_runs.business_unit_id
    )
  );
create policy checklist_runs_select_own on checklist_runs
  for select using (user_id = auth.uid());
create policy checklist_runs_select_admin on checklist_runs
  for select using (is_admin_of_outlet(auth.uid(), outlet_id));
create policy checklist_runs_update_own on checklist_runs
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy checklist_runs_update_admin on checklist_runs
  for update using (is_admin_of_outlet(auth.uid(), outlet_id))
  with check (is_admin_of_outlet(auth.uid(), outlet_id));

-- Run items: mengikuti akses ke run induknya.
create policy checklist_run_items_all_own on checklist_run_items
  for all using (
    exists (select 1 from checklist_runs cr where cr.id = checklist_run_items.run_id and cr.user_id = auth.uid())
  )
  with check (
    exists (select 1 from checklist_runs cr where cr.id = checklist_run_items.run_id and cr.user_id = auth.uid())
  );
create policy checklist_run_items_select_admin on checklist_run_items
  for select using (
    exists (select 1 from checklist_runs cr where cr.id = checklist_run_items.run_id and is_admin_of_outlet(auth.uid(), cr.outlet_id))
  );

-- =========================================================
-- STORAGE: foto bukti ceklis (privat). Path: {outlet_id}/{run_id}.jpg
-- =========================================================
insert into storage.buckets (id, name, public)
values ('checklist-photos', 'checklist-photos', false)
on conflict (id) do nothing;

create policy checklist_photo_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'checklist-photos'
    and exists (select 1 from membership_scopes ms where ms.user_id = auth.uid())
  );

create policy checklist_photo_select on storage.objects
  for select using (
    bucket_id = 'checklist-photos'
    and (
      is_admin_of_outlet(auth.uid(), (storage.foldername(name))[1]::uuid)
      or exists (select 1 from checklist_runs cr where cr.photo_path = storage.objects.name and cr.user_id = auth.uid())
    )
  );
