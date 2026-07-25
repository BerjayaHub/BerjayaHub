-- =========================================================
-- Berjaya Hub OMS — 0035
-- Order stok yang sudah bernomor masih bisa DIEDIT oleh outlet pemesan
-- selama statusnya masih 'open' (belum diproses/ditolak CK), lengkap dengan
-- jejak siapa yang mengedit & kapan.
-- =========================================================

alter table stock_orders add column if not exists edited_by uuid references user_profiles(id) on delete set null;
alter table stock_orders add column if not exists edited_at timestamptz;

-- ---------------------------------------------------------
-- RPC: ubah isi order (ganti seluruh item) + catat jejak edit.
-- p_items = jsonb [{product_id, qty}, ...]
-- Boleh: pembuat order, atau admin BU/outlet asal.
-- ---------------------------------------------------------
create or replace function update_stock_order(p_order uuid, p_items jsonb, p_notes text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_o stock_orders%rowtype;
  v_uid uuid := auth.uid();
  it jsonb;
  v_pid uuid;
  v_qty numeric;
  v_count int := 0;
begin
  select * into v_o from stock_orders where id = p_order;
  if v_o.id is null then raise exception 'Order tidak ditemukan'; end if;
  if v_o.status <> 'open' then raise exception 'Order sudah diproses, tidak bisa diubah'; end if;
  if v_o.created_by <> v_uid and not is_admin_of_outlet(v_uid, v_o.from_outlet_id) then
    raise exception 'Hanya pembuat order atau admin outlet asal yang bisa mengubah';
  end if;

  delete from stock_order_items where order_id = p_order;

  for it in select * from jsonb_array_elements(p_items) loop
    v_pid := (it->>'product_id')::uuid;
    v_qty := (it->>'qty')::numeric;
    if v_pid is null or v_qty is null or v_qty <= 0 then continue; end if;
    insert into stock_order_items(order_id, product_id, qty) values (p_order, v_pid, v_qty);
    v_count := v_count + 1;
  end loop;

  if v_count = 0 then raise exception 'Order harus berisi minimal satu produk'; end if;

  update stock_orders
    set notes = coalesce(p_notes, notes), edited_by = v_uid, edited_at = now()
    where id = p_order;
end;
$$;
grant execute on function update_stock_order(uuid, jsonb, text) to authenticated;
