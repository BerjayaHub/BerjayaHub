-- =========================================================
-- Berjaya Hub OMS — Fase 9: Cash Ledger
-- Kas dipegang PER USER (pemegang kas), outlet sebagai konteks.
-- Jenis: in (masuk), out (keluar), transfer_out / transfer_in (antar user).
-- Kategori dikelola admin per BU; bukti foto opsional. Kas dicatat manual
-- (tidak otomatis dari omzet penjualan).
-- =========================================================

insert into modules (code, name, description)
values ('cash_ledger', 'Kas', 'Kas masuk/keluar/transfer antar pemegang kas')
on conflict (code) do nothing;

-- ---- Kategori kas (per BU, dikelola admin) ----
create table cash_categories (
  id uuid primary key default gen_random_uuid(),
  business_unit_id uuid not null references business_units(id) on delete cascade,
  name text not null,
  direction text not null default 'both' check (direction in ('in', 'out', 'both')),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index idx_cash_categories_bu on cash_categories(business_unit_id);

alter table cash_categories enable row level security;
create policy cash_categories_select on cash_categories
  for select using (has_bu_scope(auth.uid(), business_unit_id));
create policy cash_categories_modify on cash_categories
  for all using (is_bu_admin(auth.uid(), business_unit_id))
  with check (is_bu_admin(auth.uid(), business_unit_id));

-- ---- Buku kas (append-only) ----
create table cash_entries (
  id uuid primary key default gen_random_uuid(),
  business_unit_id uuid not null references business_units(id) on delete cascade,
  outlet_id uuid references outlets(id) on delete set null,
  holder_id uuid not null references user_profiles(id) on delete cascade,  -- pemegang kas
  entry_type text not null check (entry_type in ('in', 'out', 'transfer_out', 'transfer_in')),
  amount numeric not null,               -- bertanda: + menambah saldo holder, - mengurangi
  category_id uuid references cash_categories(id) on delete set null,
  counterpart_id uuid references user_profiles(id) on delete set null,     -- lawan transfer
  transfer_id uuid,                       -- pengait pasangan transfer
  notes text,
  proof_path text,
  entry_date date not null default (now() at time zone 'Asia/Jakarta')::date,
  created_by uuid references user_profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index idx_cash_entries_holder on cash_entries(holder_id);
create index idx_cash_entries_bu on cash_entries(business_unit_id);
create index idx_cash_entries_date on cash_entries(entry_date);

alter table cash_entries enable row level security;

-- Lihat: kas sendiri, atau admin BU melihat semua di BU-nya.
create policy cash_entries_select_own on cash_entries
  for select using (holder_id = auth.uid());
create policy cash_entries_select_admin on cash_entries
  for select using (is_bu_admin(auth.uid(), business_unit_id));

-- Catat: hanya untuk kas sendiri (transfer lewat RPC).
create policy cash_entries_insert_own on cash_entries
  for insert with check (
    holder_id = auth.uid() and created_by = auth.uid()
    and entry_type in ('in', 'out')
    and has_bu_scope(auth.uid(), business_unit_id)
  );

-- Boleh lengkapi bukti pada entri sendiri.
create policy cash_entries_update_own on cash_entries
  for update using (holder_id = auth.uid()) with check (holder_id = auth.uid());

-- ---- Saldo kas per pemegang (view) ----
create view cash_balances with (security_invoker = true) as
  select business_unit_id, holder_id, sum(amount) as balance
  from cash_entries
  group by business_unit_id, holder_id;

-- ---- RPC transfer kas antar user (atomik) ----
create or replace function transfer_cash(p_bu uuid, p_outlet uuid, p_to_user uuid, p_amount numeric, p_notes text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_tid uuid := gen_random_uuid();
begin
  if p_amount is null or p_amount <= 0 then raise exception 'Jumlah harus lebih dari 0'; end if;
  if p_to_user = v_uid then raise exception 'Tidak bisa transfer ke diri sendiri'; end if;
  if not has_bu_scope(v_uid, p_bu) then raise exception 'Tidak berhak'; end if;
  if not exists (select 1 from membership_scopes where user_id = p_to_user and business_unit_id = p_bu) then
    raise exception 'Penerima bukan anggota BU ini';
  end if;

  insert into cash_entries(business_unit_id, outlet_id, holder_id, entry_type, amount, counterpart_id, transfer_id, notes, created_by)
    values (p_bu, p_outlet, v_uid, 'transfer_out', -p_amount, p_to_user, v_tid, p_notes, v_uid);
  insert into cash_entries(business_unit_id, outlet_id, holder_id, entry_type, amount, counterpart_id, transfer_id, notes, created_by)
    values (p_bu, p_outlet, p_to_user, 'transfer_in', p_amount, v_uid, v_tid, p_notes, v_uid);
end;
$$;
grant execute on function transfer_cash(uuid, uuid, uuid, numeric, text) to authenticated;

-- ---- Storage bukti kas (privat) ----
insert into storage.buckets (id, name, public)
values ('cash-proofs', 'cash-proofs', false)
on conflict (id) do nothing;

create policy cash_proof_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'cash-proofs'
    and exists (select 1 from membership_scopes ms where ms.user_id = auth.uid())
  );

create policy cash_proof_select on storage.objects
  for select using (
    bucket_id = 'cash-proofs'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or exists (
        select 1 from cash_entries ce
        where ce.proof_path = storage.objects.name and is_bu_admin(auth.uid(), ce.business_unit_id)
      )
    )
  );
