-- =========================================================
-- Berjaya Hub OMS — 0021 (Revisi Fase 5 & 6)
--  (1) Resep ber-MODE: satu produk bisa punya resep berbeda tergantung mode
--      outlet. Semi/jadi:
--        'production'   -> resep produksi setengah jadi (di Central Kitchen)
--        'standalone'   -> resep produk jadi dari bahan baku (outlet standalone)
--        'served_by_ck' -> resep produk jadi dari setengah jadi (outlet dilayani CK)
--  (2) Toggle penjualan per outlet (allow_sales) — disiapkan untuk Fase 8.
--  (3) RPC list_attendance_outlets menyertakan outlet_role (untuk batasi
--      produksi hanya di Central Kitchen).
--  (4) record_production memakai resep mode 'production'.
-- =========================================================

-- ---- (1) Resep ber-mode ----
alter table recipes add column if not exists mode text;
update recipes
  set mode = case when (select product_type from products p where p.id = recipes.product_id) = 'semi' then 'production' else 'standalone' end
  where mode is null;
alter table recipes alter column mode set not null;

alter table recipes drop constraint if exists recipes_product_id_key;
alter table recipes drop constraint if exists recipes_mode_check;
alter table recipes add constraint recipes_mode_check check (mode in ('production', 'standalone', 'served_by_ck'));
create unique index if not exists recipes_product_mode_uk on recipes(product_id, mode);

-- ---- (2) Toggle penjualan per outlet ----
alter table outlets add column if not exists allow_sales boolean not null default true;

-- ---- (3) RPC outlet menyertakan outlet_role ----
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
  allow_sales boolean
)
language sql
security definer
stable
set search_path = public
as $$
  select o.id, o.name, o.business_unit_id, bu.name, o.latitude, o.longitude, o.geofence_radius_m, o.outlet_role, o.allow_sales
  from outlets o
  join business_units bu on bu.id = o.business_unit_id
  where o.is_active
  order by bu.name, o.name;
$$;
grant execute on function list_attendance_outlets() to authenticated;

-- ---- (4) record_production memakai resep mode 'production' ----
create or replace function record_production(p_bu uuid, p_outlet uuid, p_product uuid, p_output_qty numeric, p_notes text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_recipe recipes%rowtype;
  v_factor numeric;
  v_pid uuid := gen_random_uuid();
  r record;
begin
  if p_output_qty is null or p_output_qty <= 0 then raise exception 'Jumlah output harus lebih dari 0'; end if;
  if not has_bu_scope(v_uid, p_bu) then raise exception 'Tidak berhak produksi di BU ini'; end if;

  select * into v_recipe from recipes where product_id = p_product and mode = 'production';
  if v_recipe.id is null then raise exception 'Produk belum punya resep produksi'; end if;
  if v_recipe.yield_qty is null or v_recipe.yield_qty <= 0 then raise exception 'Yield resep tidak valid'; end if;

  v_factor := p_output_qty / v_recipe.yield_qty;

  insert into production_runs(id, business_unit_id, outlet_id, product_id, output_qty, notes, created_by)
    values (v_pid, p_bu, p_outlet, p_product, p_output_qty, p_notes, v_uid);

  insert into stock_movements(business_unit_id, outlet_id, product_id, movement_type, qty_delta, production_id, notes, created_by)
    values (p_bu, p_outlet, p_product, 'production', p_output_qty, v_pid, p_notes, v_uid);

  for r in select ingredient_product_id, qty from recipe_items where recipe_id = v_recipe.id loop
    insert into stock_movements(business_unit_id, outlet_id, product_id, movement_type, qty_delta, production_id, notes, created_by)
      values (p_bu, p_outlet, r.ingredient_product_id, 'usage', -(r.qty * v_factor), v_pid, 'Produksi', v_uid);
  end loop;
end;
$$;
