-- =========================================================
-- Berjaya Hub OMS — Fase 5: Inventory (Cafe)
-- Ledger pergerakan stok (append-only) + view saldo + RPC transfer antar-outlet.
-- Jenis: receive (masuk), waste (keluar), adjustment (opname), transfer_out/in.
-- Modul 'inventory' sudah di-seed di 0001; aktifkan per BU lewat toggle.
-- =========================================================

create table stock_movements (
  id uuid primary key default gen_random_uuid(),
  business_unit_id uuid not null references business_units(id) on delete cascade,
  outlet_id uuid not null references outlets(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  movement_type text not null check (movement_type in ('receive', 'waste', 'adjustment', 'transfer_out', 'transfer_in')),
  qty_delta numeric not null,           -- bertanda, dalam satuan pakai (base_unit)
  unit_cost numeric,                     -- HPP per satuan saat itu (untuk valuasi/riwayat)
  ref_outlet_id uuid references outlets(id) on delete set null,  -- outlet lawan (transfer)
  transfer_id uuid,                      -- pengait pasangan transfer_out/in
  notes text,
  created_by uuid references user_profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index idx_stock_mov_outlet_product on stock_movements(outlet_id, product_id);
create index idx_stock_mov_bu on stock_movements(business_unit_id);
create index idx_stock_mov_created on stock_movements(created_at);

alter table stock_movements enable row level security;

-- Baca: anggota BU boleh lihat stok BU-nya.
create policy stock_mov_select on stock_movements
  for select using (has_bu_scope(auth.uid(), business_unit_id));

-- Catat: anggota BU, atas nama sendiri. Ledger append-only (tanpa update/delete).
create policy stock_mov_insert on stock_movements
  for insert with check (
    created_by = auth.uid() and has_bu_scope(auth.uid(), business_unit_id)
  );

-- ---------------------------------------------------------
-- VIEW saldo stok = jumlah qty_delta per (outlet, produk).
-- security_invoker: view mewarisi RLS pemanggil pada stock_movements.
-- ---------------------------------------------------------
create view stock_balances with (security_invoker = true) as
  select business_unit_id, outlet_id, product_id, sum(qty_delta) as qty
  from stock_movements
  group by business_unit_id, outlet_id, product_id;

-- ---------------------------------------------------------
-- RPC transfer antar-outlet: buat pasangan transfer_out + transfer_in atomik.
-- security definer supaya sisi tujuan tetap tercatat walau pemanggil bukan
-- anggota BU tujuan; validasi: pemanggil harus anggota BU outlet sumber.
-- ---------------------------------------------------------
create or replace function transfer_stock(
  p_from_outlet uuid,
  p_to_outlet uuid,
  p_product_id uuid,
  p_qty numeric,
  p_unit_cost numeric,
  p_notes text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from_bu uuid;
  v_to_bu uuid;
  v_tid uuid := gen_random_uuid();
  v_uid uuid := auth.uid();
begin
  if p_qty is null or p_qty <= 0 then raise exception 'Jumlah harus lebih dari 0'; end if;
  select business_unit_id into v_from_bu from outlets where id = p_from_outlet;
  select business_unit_id into v_to_bu from outlets where id = p_to_outlet;
  if v_from_bu is null or v_to_bu is null then raise exception 'Outlet tidak valid'; end if;
  if not has_bu_scope(v_uid, v_from_bu) then raise exception 'Tidak berhak transfer dari outlet ini'; end if;

  insert into stock_movements(business_unit_id, outlet_id, product_id, movement_type, qty_delta, unit_cost, ref_outlet_id, transfer_id, notes, created_by)
    values (v_from_bu, p_from_outlet, p_product_id, 'transfer_out', -p_qty, p_unit_cost, p_to_outlet, v_tid, p_notes, v_uid);
  insert into stock_movements(business_unit_id, outlet_id, product_id, movement_type, qty_delta, unit_cost, ref_outlet_id, transfer_id, notes, created_by)
    values (v_to_bu, p_to_outlet, p_product_id, 'transfer_in', p_qty, p_unit_cost, p_from_outlet, v_tid, p_notes, v_uid);
end;
$$;

grant execute on function transfer_stock(uuid, uuid, uuid, numeric, numeric, text) to authenticated;
