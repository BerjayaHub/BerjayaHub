-- =========================================================
-- Berjaya Hub OMS — Fase 6 (revisi): Fitur "Menu" untuk outlet
-- Outlet TIDAK produksi. Fitur Menu = panduan jumlah menu yang bisa dijual
-- hari ini (target/ketersediaan), TIDAK mengubah stok. Stok berkurang hanya
-- saat input penjualan (Fase 8). + kategori produk untuk memudahkan input.
-- Modul baru 'menu'.
-- =========================================================

insert into modules (code, name, description)
values ('menu', 'Menu', 'Panduan jumlah menu tersedia per hari (tanpa efek stok)')
on conflict (code) do nothing;

-- Kategori produk (untuk filter menu)
alter table products add column if not exists category text;

-- Rencana/target jumlah menu per outlet per hari (panduan POS, tanpa efek stok)
create table menu_plans (
  id uuid primary key default gen_random_uuid(),
  business_unit_id uuid not null references business_units(id) on delete cascade,
  outlet_id uuid not null references outlets(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  plan_date date not null,
  qty numeric not null default 0,
  updated_by uuid references user_profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (outlet_id, product_id, plan_date)
);
create index idx_menu_plans_outlet_date on menu_plans(outlet_id, plan_date);

alter table menu_plans enable row level security;
create policy menu_plans_select on menu_plans
  for select using (has_bu_scope(auth.uid(), business_unit_id));
create policy menu_plans_modify on menu_plans
  for all using (has_bu_scope(auth.uid(), business_unit_id))
  with check (has_bu_scope(auth.uid(), business_unit_id));
