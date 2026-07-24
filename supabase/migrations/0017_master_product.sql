-- =========================================================
-- Berjaya Hub OMS — Fase 4: Master Produk & Resep/Formula (Cafe)
-- 3 tipe produk (bahan baku/setengah jadi/jadi), konversi beli->pakai,
-- harga beli & jual, resep berjenjang (BOM) + yield/hasil.
-- Modul baru 'master_product' (di-toggle per BU).
-- =========================================================

insert into modules (code, name, description)
values ('master_product', 'Master Produk', 'Master produk & resep/formula (Cafe)')
on conflict (code) do nothing;

-- ---------------------------------------------------------
-- PRODUCTS
--   product_type: raw (bahan baku) | semi (setengah jadi) | finished (produk jadi)
--   base_unit    : satuan PAKAI (dipakai di resep & stok), mis. gram/ml/pcs
--   purchase_unit / purchase_qty / purchase_price : konversi & harga BELI
--     (purchase_qty = jumlah base_unit dalam 1 purchase_unit; cost/base = price/qty)
--   sale_price   : harga jual (produk jadi)
-- ---------------------------------------------------------
create table products (
  id uuid primary key default gen_random_uuid(),
  business_unit_id uuid not null references business_units(id) on delete cascade,
  name text not null,
  product_type text not null check (product_type in ('raw', 'semi', 'finished')),
  base_unit text not null,
  purchase_unit text,
  purchase_qty numeric,
  purchase_price numeric,
  sale_price numeric,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index idx_products_bu on products(business_unit_id);

-- ---------------------------------------------------------
-- RECIPES (1 produk = 1 resep). yield_qty = hasil 1 batch dalam base_unit produk.
-- ---------------------------------------------------------
create table recipes (
  id uuid primary key default gen_random_uuid(),
  business_unit_id uuid not null references business_units(id) on delete cascade,
  product_id uuid not null unique references products(id) on delete cascade,
  yield_qty numeric not null default 1,
  notes text,
  created_at timestamptz not null default now()
);
create index idx_recipes_bu on recipes(business_unit_id);

create table recipe_items (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references recipes(id) on delete cascade,
  ingredient_product_id uuid not null references products(id) on delete restrict,
  qty numeric not null
);
create index idx_recipe_items_recipe on recipe_items(recipe_id);

-- =========================================================
-- RLS: anggota BU boleh baca; admin BU kelola.
-- =========================================================
alter table products enable row level security;
alter table recipes enable row level security;
alter table recipe_items enable row level security;

create policy products_select on products
  for select using (has_bu_scope(auth.uid(), business_unit_id));
create policy products_modify on products
  for all using (is_bu_admin(auth.uid(), business_unit_id))
  with check (is_bu_admin(auth.uid(), business_unit_id));

create policy recipes_select on recipes
  for select using (has_bu_scope(auth.uid(), business_unit_id));
create policy recipes_modify on recipes
  for all using (is_bu_admin(auth.uid(), business_unit_id))
  with check (is_bu_admin(auth.uid(), business_unit_id));

create policy recipe_items_select on recipe_items
  for select using (
    exists (select 1 from recipes r where r.id = recipe_items.recipe_id and has_bu_scope(auth.uid(), r.business_unit_id))
  );
create policy recipe_items_modify on recipe_items
  for all using (
    exists (select 1 from recipes r where r.id = recipe_items.recipe_id and is_bu_admin(auth.uid(), r.business_unit_id))
  )
  with check (
    exists (select 1 from recipes r where r.id = recipe_items.recipe_id and is_bu_admin(auth.uid(), r.business_unit_id))
  );
