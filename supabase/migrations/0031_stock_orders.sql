-- =========================================================
-- Berjaya Hub OMS — 0031
-- Order stok dari Outlet ke Central Kitchen (langkah awal sebelum dispatch).
--
-- Alur lengkap:
--   Outlet BUAT ORDER  -> CK lihat nomor order -> isi jumlah dikirim
--   -> jadi SURAT JALAN (dispatch, stok CK berkurang) -> outlet KONFIRMASI TERIMA
--
-- Aturan yang disepakati:
--   - sekali kirim, order langsung selesai (status 'fulfilled')
--   - CK boleh menolak order dengan alasan (status 'rejected')
-- =========================================================

-- Daftar outlet untuk app perlu tahu CK mana yang melayani tiap outlet,
-- supaya tujuan order bisa terisi otomatis.
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
  allow_sales boolean,
  served_by_outlet_id uuid
)
language sql
security definer
stable
set search_path = public
as $$
  select o.id, o.name, o.business_unit_id, bu.name, o.latitude, o.longitude, o.geofence_radius_m,
         o.outlet_role, o.allow_sales, o.served_by_outlet_id
  from outlets o
  join business_units bu on bu.id = o.business_unit_id
  where o.is_active
  order by bu.name, o.name;
$$;
grant execute on function list_attendance_outlets() to authenticated;

create table stock_orders (
  id uuid primary key default gen_random_uuid(),
  code text,
  business_unit_id uuid not null references business_units(id) on delete cascade,
  from_outlet_id uuid not null references outlets(id) on delete cascade,   -- outlet pemesan
  to_outlet_id uuid not null references outlets(id) on delete cascade,     -- CK tujuan
  status text not null default 'open' check (status in ('open', 'fulfilled', 'rejected', 'cancelled')),
  notes text,
  created_by uuid references user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  handled_by uuid references user_profiles(id) on delete set null,
  handled_at timestamptz,
  reject_reason text,
  dispatch_id uuid references dispatches(id) on delete set null
);
create index idx_stock_orders_to on stock_orders(to_outlet_id, status);
create index idx_stock_orders_from on stock_orders(from_outlet_id, status);

create table stock_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references stock_orders(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  qty numeric not null
);
create index idx_stock_order_items_order on stock_order_items(order_id);

alter table stock_orders enable row level security;
alter table stock_order_items enable row level security;

create policy stock_orders_select on stock_orders
  for select using (has_bu_scope(auth.uid(), business_unit_id));
create policy stock_order_items_select on stock_order_items
  for select using (
    exists (select 1 from stock_orders o where o.id = stock_order_items.order_id and has_bu_scope(auth.uid(), o.business_unit_id))
  );

-- ---------------------------------------------------------
-- RPC: outlet membuat order. p_items = jsonb [{product_id, qty}, ...]
-- Nomor order: OR-YYMMDD-XXXX
-- ---------------------------------------------------------
create or replace function create_stock_order(p_from uuid, p_to uuid, p_items jsonb, p_notes text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bu uuid;
  v_uid uuid := auth.uid();
  v_oid uuid := gen_random_uuid();
  it jsonb;
  v_pid uuid;
  v_qty numeric;
  v_count int := 0;
begin
  select business_unit_id into v_bu from outlets where id = p_from;
  if v_bu is null then raise exception 'Outlet pemesan tidak valid'; end if;
  if not has_bu_scope(v_uid, v_bu) then raise exception 'Tidak berhak membuat order dari outlet ini'; end if;
  if p_to is null or not exists (select 1 from outlets where id = p_to) then raise exception 'Central Kitchen tujuan tidak valid'; end if;
  if p_from = p_to then raise exception 'Outlet pemesan & tujuan tidak boleh sama'; end if;

  insert into stock_orders(id, code, business_unit_id, from_outlet_id, to_outlet_id, notes, created_by)
    values (v_oid,
            'OR-' || to_char((now() at time zone 'Asia/Jakarta'), 'YYMMDD') || '-' || upper(substr(v_oid::text, 1, 4)),
            v_bu, p_from, p_to, p_notes, v_uid);

  for it in select * from jsonb_array_elements(p_items) loop
    v_pid := (it->>'product_id')::uuid;
    v_qty := (it->>'qty')::numeric;
    if v_pid is null or v_qty is null or v_qty <= 0 then continue; end if;
    insert into stock_order_items(order_id, product_id, qty) values (v_oid, v_pid, v_qty);
    v_count := v_count + 1;
  end loop;

  if v_count = 0 then raise exception 'Order harus berisi minimal satu produk'; end if;
  return v_oid;
end;
$$;
grant execute on function create_stock_order(uuid, uuid, jsonb, text) to authenticated;

-- ---------------------------------------------------------
-- RPC: CK memenuhi order -> buat dispatch (surat jalan) + tutup order.
-- p_items = jsonb [{product_id, qty}, ...] (jumlah yang benar-benar dikirim)
-- ---------------------------------------------------------
create or replace function fulfill_stock_order(p_order uuid, p_items jsonb, p_notes text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_o stock_orders%rowtype;
  v_uid uuid := auth.uid();
  v_did uuid;
begin
  select * into v_o from stock_orders where id = p_order;
  if v_o.id is null then raise exception 'Order tidak ditemukan'; end if;
  if v_o.status <> 'open' then raise exception 'Order sudah diproses'; end if;
  if not has_bu_scope(v_uid, v_o.business_unit_id) then raise exception 'Tidak berhak'; end if;

  -- Buat surat jalan dari CK ke outlet pemesan (stok CK berkurang di sini).
  v_did := create_dispatch(v_o.to_outlet_id, v_o.from_outlet_id, p_items,
                           coalesce(p_notes, '') || ' (Order ' || coalesce(v_o.code, '') || ')');

  update stock_orders
    set status = 'fulfilled', handled_by = v_uid, handled_at = now(), dispatch_id = v_did
    where id = p_order;

  return v_did;
end;
$$;
grant execute on function fulfill_stock_order(uuid, jsonb, text) to authenticated;

-- ---------------------------------------------------------
-- RPC: CK menolak order (dengan alasan).
-- ---------------------------------------------------------
create or replace function reject_stock_order(p_order uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_o stock_orders%rowtype;
  v_uid uuid := auth.uid();
begin
  select * into v_o from stock_orders where id = p_order;
  if v_o.id is null then raise exception 'Order tidak ditemukan'; end if;
  if v_o.status <> 'open' then raise exception 'Order sudah diproses'; end if;
  if not has_bu_scope(v_uid, v_o.business_unit_id) then raise exception 'Tidak berhak'; end if;

  update stock_orders
    set status = 'rejected', handled_by = v_uid, handled_at = now(), reject_reason = p_reason
    where id = p_order;
end;
$$;
grant execute on function reject_stock_order(uuid, text) to authenticated;

-- ---------------------------------------------------------
-- RPC: outlet membatalkan ordernya sendiri (selama masih 'open').
-- ---------------------------------------------------------
create or replace function cancel_stock_order(p_order uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_o stock_orders%rowtype;
  v_uid uuid := auth.uid();
begin
  select * into v_o from stock_orders where id = p_order;
  if v_o.id is null then raise exception 'Order tidak ditemukan'; end if;
  if v_o.status <> 'open' then raise exception 'Order sudah diproses'; end if;
  if v_o.created_by <> v_uid and not is_bu_admin(v_uid, v_o.business_unit_id) then
    raise exception 'Hanya pembuat order atau admin BU yang bisa membatalkan';
  end if;

  update stock_orders set status = 'cancelled', handled_by = v_uid, handled_at = now() where id = p_order;
end;
$$;
grant execute on function cancel_stock_order(uuid) to authenticated;
