-- =========================================================
-- Berjaya Hub OMS — 0019
-- Revisi Fase 5:
--  (1) Master Satuan (global) — daftar satuan terkelola, dipakai dropdown produk.
--  (2) Toggle "staff boleh stok opname" per BU (hanya super_admin yang ubah).
-- =========================================================

-- ---- Master Satuan (global) ----
create table units (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

insert into units (name) values
  ('gram'), ('kg'), ('ml'), ('liter'), ('pcs'), ('porsi'),
  ('gelas'), ('botol'), ('pack'), ('sachet'), ('karung'), ('dus')
on conflict (name) do nothing;

alter table units enable row level security;

create policy units_select on units
  for select using (auth.uid() is not null);
create policy units_modify on units
  for all using (is_super_admin(auth.uid()))
  with check (is_super_admin(auth.uid()));

-- ---- Toggle opname staff per BU ----
alter table business_units add column if not exists allow_staff_opname boolean not null default false;

-- Hanya super_admin yang boleh mengubah toggle ini (bu_admin tidak).
create or replace function set_allow_staff_opname(p_bu uuid, p_allow boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_super_admin(auth.uid()) then
    raise exception 'Hanya Super Admin yang bisa mengubah izin opname';
  end if;
  update business_units set allow_staff_opname = p_allow where id = p_bu;
end;
$$;

grant execute on function set_allow_staff_opname(uuid, boolean) to authenticated;
