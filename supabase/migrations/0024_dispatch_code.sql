-- =========================================================
-- Berjaya Hub OMS — 0024
-- Nomor surat jalan (code) untuk pengiriman, dibuat otomatis saat create_dispatch.
-- Format: SJ-YYMMDD-XXXX (XXXX = 4 char awal id).
-- =========================================================

alter table dispatches add column if not exists code text;

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
  v_code text;
  it jsonb;
  v_pid uuid;
  v_qty numeric;
begin
  select business_unit_id into v_bu from outlets where id = p_from;
  if v_bu is null then raise exception 'Outlet asal tidak valid'; end if;
  if not has_bu_scope(v_uid, v_bu) then raise exception 'Tidak berhak mengirim dari outlet ini'; end if;
  if p_to is null or (select 1 from outlets where id = p_to) is null then raise exception 'Outlet tujuan tidak valid'; end if;
  if p_from = p_to then raise exception 'Outlet asal & tujuan tidak boleh sama'; end if;

  v_code := 'SJ-' || to_char((now() at time zone 'Asia/Jakarta'), 'YYMMDD') || '-' || upper(substr(v_did::text, 1, 4));

  insert into dispatches(id, business_unit_id, from_outlet_id, to_outlet_id, status, notes, created_by, code)
    values (v_did, v_bu, p_from, p_to, 'sent', p_notes, v_uid, v_code);

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
