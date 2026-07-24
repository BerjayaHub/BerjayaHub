-- =========================================================
-- Berjaya Hub OMS — Fase 7: Transfer/Dispatch CK -> Outlet
-- Alur dua langkah: CK KIRIM (stok CK berkurang) -> Outlet KONFIRMASI TERIMA
-- (isi jumlah aktual diterima -> stok outlet bertambah). Surat jalan multi-produk.
-- Modul baru 'dispatch'.
-- =========================================================

insert into modules (code, name, description)
values ('dispatch', 'Pengiriman', 'Kirim/terima stok antar outlet (CK -> outlet)')
on conflict (code) do nothing;

alter table stock_movements add column if not exists dispatch_id uuid;

-- Header surat jalan
create table dispatches (
  id uuid primary key default gen_random_uuid(),
  business_unit_id uuid not null references business_units(id) on delete cascade,
  from_outlet_id uuid not null references outlets(id) on delete cascade,
  to_outlet_id uuid not null references outlets(id) on delete cascade,
  status text not null default 'sent' check (status in ('sent', 'received', 'cancelled')),
  notes text,
  created_by uuid references user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  received_by uuid references user_profiles(id) on delete set null,
  received_at timestamptz
);
create index idx_dispatches_bu on dispatches(business_unit_id);
create index idx_dispatches_to on dispatches(to_outlet_id, status);

create table dispatch_items (
  id uuid primary key default gen_random_uuid(),
  dispatch_id uuid not null references dispatches(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  sent_qty numeric not null,
  received_qty numeric
);
create index idx_dispatch_items_dispatch on dispatch_items(dispatch_id);

alter table dispatches enable row level security;
alter table dispatch_items enable row level security;

create policy dispatches_select on dispatches
  for select using (has_bu_scope(auth.uid(), business_unit_id));
create policy dispatch_items_select on dispatch_items
  for select using (
    exists (select 1 from dispatches d where d.id = dispatch_items.dispatch_id and has_bu_scope(auth.uid(), d.business_unit_id))
  );

-- ---------------------------------------------------------
-- RPC: buat pengiriman (status 'sent') + kurangi stok CK (transfer_out).
-- p_items = jsonb array [{product_id, qty}, ...]
-- ---------------------------------------------------------
create or replace function create_dispatch(p_from uuid, p_to uuid, p_items jsonb, p_notes text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bu uuid;
  v_uid uuid := auth.uid();
  v_did uuid := gen_random_uuid();
  it jsonb;
  v_pid uuid;
  v_qty numeric;
begin
  select business_unit_id into v_bu from outlets where id = p_from;
  if v_bu is null then raise exception 'Outlet asal tidak valid'; end if;
  if not has_bu_scope(v_uid, v_bu) then raise exception 'Tidak berhak mengirim dari outlet ini'; end if;
  if p_to is null or (select 1 from outlets where id = p_to) is null then raise exception 'Outlet tujuan tidak valid'; end if;
  if p_from = p_to then raise exception 'Outlet asal & tujuan tidak boleh sama'; end if;

  insert into dispatches(id, business_unit_id, from_outlet_id, to_outlet_id, status, notes, created_by)
    values (v_did, v_bu, p_from, p_to, 'sent', p_notes, v_uid);

  for it in select * from jsonb_array_elements(p_items) loop
    v_pid := (it->>'product_id')::uuid;
    v_qty := (it->>'qty')::numeric;
    if v_pid is null or v_qty is null or v_qty <= 0 then continue; end if;
    insert into dispatch_items(dispatch_id, product_id, sent_qty) values (v_did, v_pid, v_qty);
    insert into stock_movements(business_unit_id, outlet_id, product_id, movement_type, qty_delta, ref_outlet_id, dispatch_id, notes, created_by)
      values (v_bu, p_from, v_pid, 'transfer_out', -v_qty, p_to, v_did, 'Dispatch', v_uid);
  end loop;

  return v_did;
end;
$$;
grant execute on function create_dispatch(uuid, uuid, jsonb, text) to authenticated;

-- ---------------------------------------------------------
-- RPC: konfirmasi terima. p_items = jsonb array [{item_id, received_qty}, ...]
-- Tambah stok outlet tujuan sebesar yang diterima (selisih vs dikirim = susut).
-- ---------------------------------------------------------
create or replace function receive_dispatch(p_dispatch uuid, p_items jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_d dispatches%rowtype;
  v_uid uuid := auth.uid();
  it jsonb;
  v_item_id uuid;
  v_recv numeric;
  v_prod uuid;
begin
  select * into v_d from dispatches where id = p_dispatch;
  if v_d.id is null then raise exception 'Pengiriman tidak ditemukan'; end if;
  if v_d.status <> 'sent' then raise exception 'Pengiriman sudah diproses'; end if;
  if not has_bu_scope(v_uid, v_d.business_unit_id) then raise exception 'Tidak berhak'; end if;

  for it in select * from jsonb_array_elements(p_items) loop
    v_item_id := (it->>'item_id')::uuid;
    v_recv := (it->>'received_qty')::numeric;
    if v_item_id is null then continue; end if;
    if v_recv is null or v_recv < 0 then v_recv := 0; end if;
    select product_id into v_prod from dispatch_items where id = v_item_id and dispatch_id = p_dispatch;
    if v_prod is null then continue; end if;
    update dispatch_items set received_qty = v_recv where id = v_item_id;
    if v_recv > 0 then
      insert into stock_movements(business_unit_id, outlet_id, product_id, movement_type, qty_delta, ref_outlet_id, dispatch_id, notes, created_by)
        values (v_d.business_unit_id, v_d.to_outlet_id, v_prod, 'transfer_in', v_recv, v_d.from_outlet_id, p_dispatch, 'Terima dispatch', v_uid);
    end if;
  end loop;

  update dispatches set status = 'received', received_by = v_uid, received_at = now() where id = p_dispatch;
end;
$$;
grant execute on function receive_dispatch(uuid, jsonb) to authenticated;
