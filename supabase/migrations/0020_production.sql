-- =========================================================
-- Berjaya Hub OMS — Fase 6: Produksi di Outlet (Cafe)
-- Produksi 1 produk (semi/jadi) sesuai resep: kurangi stok bahan, tambah
-- stok produk hasil. Jenis gerakan baru: 'production' (+) & 'usage' (-).
-- Modul 'production' sudah di-seed di 0001; aktifkan per BU lewat toggle.
-- =========================================================

alter table stock_movements add column if not exists production_id uuid;

-- Perluas jenis gerakan stok
alter table stock_movements drop constraint if exists stock_movements_movement_type_check;
alter table stock_movements add constraint stock_movements_movement_type_check
  check (movement_type in ('receive', 'waste', 'adjustment', 'transfer_out', 'transfer_in', 'usage', 'production'));

-- Catatan tiap kejadian produksi
create table production_runs (
  id uuid primary key default gen_random_uuid(),
  business_unit_id uuid not null references business_units(id) on delete cascade,
  outlet_id uuid not null references outlets(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  output_qty numeric not null,
  notes text,
  created_by uuid references user_profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index idx_production_runs_bu on production_runs(business_unit_id);
create index idx_production_runs_outlet on production_runs(outlet_id);

alter table production_runs enable row level security;
create policy production_runs_select on production_runs
  for select using (has_bu_scope(auth.uid(), business_unit_id));

-- ---------------------------------------------------------
-- RPC produksi (atomik): buat production_runs + gerakan stok:
--   +output produk, -konsumsi tiap bahan (qty resep × faktor).
-- faktor = output diminta / yield resep. Stok BOLEH minus (tidak diblokir).
-- security definer: konsisten & bypass RLS insert; validasi keanggotaan BU.
-- ---------------------------------------------------------
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

  select * into v_recipe from recipes where product_id = p_product;
  if v_recipe.id is null then raise exception 'Produk belum punya resep'; end if;
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

grant execute on function record_production(uuid, uuid, uuid, numeric, text) to authenticated;
