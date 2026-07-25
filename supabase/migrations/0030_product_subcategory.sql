-- =========================================================
-- Berjaya Hub OMS — 0030
-- Sub-kategori produk (melengkapi kategori) untuk pengelompokan & filter
-- di Master Produk, Menu, dan Stok Opname.
-- =========================================================

alter table products add column if not exists subcategory text;

create index if not exists idx_products_category on products(business_unit_id, category);
