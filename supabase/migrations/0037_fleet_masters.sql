-- =========================================================
-- Berjaya Hub OMS — 0037
-- Revisi modul Armada:
--   1. Master Merk & Tipe kendaraan (Tipe bertingkat: mengikuti Merk).
--   2. Kolom "Kepemilikan" -> "Nama STNK" (teks bebas, bukan pilihan hardcode).
--   3. Master Area Rental (menggantikan Outlet/Pool di form kendaraan).
-- Semua master diisi sendiri oleh user (tidak ada seed hardcode) dan bisa
-- ditambah langsung dari form Tambah/Edit Kendaraan.
-- Idempotent — aman dijalankan ulang.
-- =========================================================

-- ---------------------------------------------------------
-- (1) Master Merk kendaraan (per BU)
-- ---------------------------------------------------------
create table if not exists vehicle_brands (
  id uuid primary key default gen_random_uuid(),
  business_unit_id uuid not null references business_units(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (business_unit_id, name)
);
create index if not exists idx_vehicle_brands_bu on vehicle_brands(business_unit_id);

alter table vehicle_brands enable row level security;
drop policy if exists vehicle_brands_select on vehicle_brands;
create policy vehicle_brands_select on vehicle_brands
  for select using (has_bu_scope(auth.uid(), business_unit_id));
drop policy if exists vehicle_brands_modify on vehicle_brands;
create policy vehicle_brands_modify on vehicle_brands
  for all using (is_bu_admin(auth.uid(), business_unit_id))
  with check (is_bu_admin(auth.uid(), business_unit_id));

-- ---------------------------------------------------------
-- (2) Master Tipe kendaraan — selalu menempel pada satu Merk,
-- supaya dropdown Tipe hanya menampilkan tipe milik merk terpilih.
-- (mis. Toyota -> Avanza, Innova; Daihatsu -> Xenia, Gran Max)
-- ---------------------------------------------------------
create table if not exists vehicle_models (
  id uuid primary key default gen_random_uuid(),
  business_unit_id uuid not null references business_units(id) on delete cascade,
  brand_id uuid not null references vehicle_brands(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (brand_id, name)
);
create index if not exists idx_vehicle_models_bu on vehicle_models(business_unit_id);
create index if not exists idx_vehicle_models_brand on vehicle_models(brand_id);

alter table vehicle_models enable row level security;
drop policy if exists vehicle_models_select on vehicle_models;
create policy vehicle_models_select on vehicle_models
  for select using (has_bu_scope(auth.uid(), business_unit_id));
drop policy if exists vehicle_models_modify on vehicle_models;
create policy vehicle_models_modify on vehicle_models
  for all using (is_bu_admin(auth.uid(), business_unit_id))
  with check (is_bu_admin(auth.uid(), business_unit_id));

-- ---------------------------------------------------------
-- (3) Master Area Rental (per BU)
-- ---------------------------------------------------------
create table if not exists rental_areas (
  id uuid primary key default gen_random_uuid(),
  business_unit_id uuid not null references business_units(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (business_unit_id, name)
);
create index if not exists idx_rental_areas_bu on rental_areas(business_unit_id);

alter table rental_areas enable row level security;
drop policy if exists rental_areas_select on rental_areas;
create policy rental_areas_select on rental_areas
  for select using (has_bu_scope(auth.uid(), business_unit_id));
drop policy if exists rental_areas_modify on rental_areas;
create policy rental_areas_modify on rental_areas
  for all using (is_bu_admin(auth.uid(), business_unit_id))
  with check (is_bu_admin(auth.uid(), business_unit_id));

-- ---------------------------------------------------------
-- (4) Kepemilikan -> Nama STNK
-- Nilai lama ('Milik Sendiri'/'Leasing'/'Sewa') ikut terbawa; admin tinggal
-- menimpanya dengan nama asli yang tertera di STNK.
-- ---------------------------------------------------------
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'vehicles' and column_name = 'ownership')
     and not exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'vehicles' and column_name = 'stnk_owner_name')
  then
    alter table vehicles rename column ownership to stnk_owner_name;
  end if;
end $$;

alter table vehicles add column if not exists stnk_owner_name text;

-- ---------------------------------------------------------
-- (5) Seed master dari data kendaraan yang SUDAH ada
-- (bukan hardcode: murni hasil input user sebelumnya).
-- ---------------------------------------------------------
insert into vehicle_brands (business_unit_id, name)
select distinct v.business_unit_id, btrim(v.brand)
from vehicles v
where v.brand is not null and btrim(v.brand) <> ''
on conflict (business_unit_id, name) do nothing;

insert into vehicle_models (business_unit_id, brand_id, name)
select distinct v.business_unit_id, b.id, btrim(v.model)
from vehicles v
join vehicle_brands b
  on b.business_unit_id = v.business_unit_id and b.name = btrim(v.brand)
where v.model is not null and btrim(v.model) <> ''
on conflict (brand_id, name) do nothing;

insert into rental_areas (business_unit_id, name)
select distinct v.business_unit_id, btrim(v.rental_area)
from vehicles v
where v.rental_area is not null and btrim(v.rental_area) <> ''
on conflict (business_unit_id, name) do nothing;

-- Kendaraan yang belum punya area tapi sudah punya outlet/pool: pakai nama
-- outletnya sebagai area awal supaya data lama tidak kosong.
insert into rental_areas (business_unit_id, name)
select distinct v.business_unit_id, o.name
from vehicles v
join outlets o on o.id = v.outlet_id
where v.rental_area is null or btrim(v.rental_area) = ''
on conflict (business_unit_id, name) do nothing;

update vehicles v
set rental_area = o.name
from outlets o
where o.id = v.outlet_id
  and (v.rental_area is null or btrim(v.rental_area) = '');

-- ---------------------------------------------------------
-- CATATAN PERILAKU
-- vehicles.rental_area kini berarti **Area Rental kendaraan** (menetap),
-- bukan lagi area sesi rental yang sedang berjalan. Area sesi rental
-- disimpan di vehicle_rentals.rental_area. Karena itu `endRental` di sisi
-- aplikasi tidak lagi mengosongkan vehicles.rental_area.
-- vehicles.outlet_id dibiarkan ada untuk data lama, tapi tidak dipakai lagi
-- di form kendaraan.
-- ---------------------------------------------------------
