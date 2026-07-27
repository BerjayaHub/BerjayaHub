-- =========================================================
-- Berjaya Hub OMS — 0045
--   1. "Ceklis Kebersihan" -> "Daily Activities" (label modul di database)
--   2. Modul baru: Inventaris Aset
--
-- Idempotent — aman dijalankan ulang.
-- =========================================================

-- ---------------------------------------------------------
-- (1) Ganti nama modul. Nama ini yang tampil sebagai kartu di Staff App dan
-- menu di Admin Portal, jadi harus ikut diubah — bukan cuma teks di kode.
-- ---------------------------------------------------------
update modules
set name = 'Daily Activities', description = 'Ceklis aktivitas harian outlet'
where code = 'cleaning_checklist';

-- ---------------------------------------------------------
-- (2) Modul Inventaris Aset
-- Diaktifkan per BU lewat toggle modul (Master BU & Outlet -> Modul),
-- sama seperti modul operasional lain.
-- ---------------------------------------------------------
insert into modules (code, name, description)
values ('asset', 'Inventaris Aset', 'Pendataan aset & inventaris outlet')
on conflict (code) do nothing;

-- kondisi: normal | rusak | lainnya (dengan catatan bebas)
create table if not exists assets (
  id uuid primary key default gen_random_uuid(),
  business_unit_id uuid not null references business_units(id) on delete cascade,
  outlet_id uuid not null references outlets(id) on delete cascade,
  name text not null,
  qty numeric not null default 1 check (qty >= 0),
  size text,                       -- ukuran barang, teks bebas (mis. "120x60 cm", "3/4 inci")
  photo_path text,
  condition text not null default 'normal' check (condition in ('normal', 'rusak', 'lainnya')),
  condition_note text,             -- wajib diisi aplikasi kalau condition = 'lainnya'
  notes text,
  created_by uuid references user_profiles(id) on delete set null,
  updated_by uuid references user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_assets_outlet on assets(outlet_id);
create index if not exists idx_assets_bu on assets(business_unit_id, condition);

alter table assets enable row level security;

-- Anggota BU boleh melihat; pencatatan & perubahan oleh siapa pun yang punya
-- scope di outlet itu (pendataan aset biasanya dikerjakan staff, bukan admin).
drop policy if exists assets_select on assets;
create policy assets_select on assets
  for select using (has_bu_scope(auth.uid(), business_unit_id));

drop policy if exists assets_insert on assets;
create policy assets_insert on assets
  for insert with check (has_outlet_scope(auth.uid(), outlet_id) and created_by = auth.uid());

drop policy if exists assets_update on assets;
create policy assets_update on assets
  for update using (has_outlet_scope(auth.uid(), outlet_id))
  with check (has_outlet_scope(auth.uid(), outlet_id));

-- Hapus tetap dibatasi admin outlet supaya data aset tidak mudah hilang.
drop policy if exists assets_delete on assets;
create policy assets_delete on assets
  for delete using (is_admin_of_outlet(auth.uid(), outlet_id));

-- ---------------------------------------------------------
-- (3) Storage foto aset (privat)
-- Pola sama dengan bucket lain: hanya anggota aktif yang boleh unggah,
-- dan yang bisa melihat cukup anggota BU pemilik asetnya.
-- ---------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('asset-photos', 'asset-photos', false)
on conflict (id) do nothing;

drop policy if exists asset_photo_insert on storage.objects;
create policy asset_photo_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'asset-photos'
    and exists (select 1 from membership_scopes ms where ms.user_id = auth.uid())
  );

-- UPDATE dibutuhkan karena unggah memakai upsert (menimpa foto lama aset yang sama).
drop policy if exists asset_photo_update on storage.objects;
create policy asset_photo_update on storage.objects
  for update to authenticated
  using (bucket_id = 'asset-photos' and exists (select 1 from membership_scopes ms where ms.user_id = auth.uid()))
  with check (bucket_id = 'asset-photos' and exists (select 1 from membership_scopes ms where ms.user_id = auth.uid()));

drop policy if exists asset_photo_select on storage.objects;
create policy asset_photo_select on storage.objects
  for select using (
    bucket_id = 'asset-photos'
    and exists (
      select 1 from assets a
      where a.photo_path = storage.objects.name and has_bu_scope(auth.uid(), a.business_unit_id)
    )
  );

drop policy if exists asset_photo_delete on storage.objects;
create policy asset_photo_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'asset-photos'
    and exists (
      select 1 from assets a
      where a.photo_path = storage.objects.name and is_admin_of_outlet(auth.uid(), a.outlet_id)
    )
  );
