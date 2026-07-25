-- =========================================================
-- Berjaya Hub OMS — Fase 8: Sales (Cafe)
-- Rekap penjualan per menu per hari -> potong stok bahan sesuai resep menu
-- (mode outlet: standalone/served_by_ck) + catat omzet. Modul baru 'sales'.
-- =========================================================

insert into modules (code, name, description)
values ('sales', 'Penjualan', 'Input penjualan menu -> potong stok & catat omzet')
on conflict (code) do nothing;

create table sales (
  id uuid primary key default gen_random_uuid(),
  business_unit_id uuid not null references business_units(id) on delete cascade,
  outlet_id uuid not null references outlets(id) on delete cascade,
  sale_date date not null,
  product_id uuid not null references products(id) on delete cascade,
  qty numeric not null,
  unit_price numeric,
  revenue numeric,
  created_by uuid references user_profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index idx_sales_outlet_date on sales(outlet_id, sale_date);
create index idx_sales_bu on sales(business_unit_id);

alter table sales enable row level security;
create policy sales_select on sales
  for select using (has_bu_scope(auth.uid(), business_unit_id));
-- Insert lewat RPC record_sales (security definer). Tanpa policy insert langsung.

-- ---------------------------------------------------------
-- RPC: catat penjualan (atomik). p_items = jsonb [{product_id, qty}, ...]
-- Untuk tiap menu: simpan penjualan (+omzet) & potong stok bahan sesuai resep
-- mode outlet (fallback 'standalone'). Stok BOLEH minus.
-- ---------------------------------------------------------
create or replace function record_sales(p_bu uuid, p_outlet uuid, p_date date, p_items jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_allow boolean;
  v_mode text;
  it jsonb;
  v_pid uuid;
  v_qty numeric;
  v_price numeric;
  v_recipe recipes%rowtype;
  r record;
begin
  if not has_bu_scope(v_uid, p_bu) then raise exception 'Tidak berhak'; end if;
  select outlet_role, allow_sales into v_role, v_allow from outlets where id = p_outlet;
  if v_role is null then raise exception 'Outlet tidak valid'; end if;
  if not coalesce(v_allow, false) then raise exception 'Penjualan tidak diaktifkan untuk outlet ini'; end if;
  v_mode := case when v_role = 'served_by_ck' then 'served_by_ck' else 'standalone' end;

  for it in select * from jsonb_array_elements(p_items) loop
    v_pid := (it->>'product_id')::uuid;
    v_qty := (it->>'qty')::numeric;
    if v_pid is null or v_qty is null or v_qty <= 0 then continue; end if;

    select sale_price into v_price from products where id = v_pid;
    insert into sales(business_unit_id, outlet_id, sale_date, product_id, qty, unit_price, revenue, created_by)
      values (p_bu, p_outlet, p_date, v_pid, v_qty, v_price, coalesce(v_price, 0) * v_qty, v_uid);

    select * into v_recipe from recipes where product_id = v_pid and mode = v_mode;
    if v_recipe.id is null and v_mode <> 'standalone' then
      select * into v_recipe from recipes where product_id = v_pid and mode = 'standalone';
    end if;

    if v_recipe.id is not null and v_recipe.yield_qty > 0 then
      for r in select ingredient_product_id, qty from recipe_items where recipe_id = v_recipe.id loop
        insert into stock_movements(business_unit_id, outlet_id, product_id, movement_type, qty_delta, notes, created_by)
          values (p_bu, p_outlet, r.ingredient_product_id, 'usage', -(r.qty * v_qty / v_recipe.yield_qty), 'Penjualan', v_uid);
      end loop;
    end if;
  end loop;
end;
$$;
grant execute on function record_sales(uuid, uuid, date, jsonb) to authenticated;
