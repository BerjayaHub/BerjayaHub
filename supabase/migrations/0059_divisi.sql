-- =========================================================
-- Berjaya Hub OMS — 0059
-- DIVISI (Kitchen, Bar, Mekanik, dst) untuk mengelompokkan staff.
--
-- MELEKAT DI SCOPE, BUKAN DI USER. Orang yang bekerja di Cafe DAN Bengkel bisa
-- jadi "Kitchen" di Cafe dan "Mekanik" di Bengkel. Kalau divisi ditaruh sebagai
-- satu kolom di `user_profiles`, nilainya pasti salah di salah satu tempat dan
-- tidak ada cara memperbaikinya selain membongkar desainnya.
--
-- DAFTAR MASTER, BUKAN TEKS BEBAS. "Kitchen", "kitchen", dan "Ktichen" akan jadi
-- tiga kelompok terpisah, dan pengelompokannya rusak tanpa ada yang sadar —
-- tabelnya tetap tampil rapi, cuma isinya salah.
--
-- Idempotent — aman dijalankan ulang.
-- =========================================================

create table if not exists divisions (
  id uuid primary key default gen_random_uuid(),
  business_unit_id uuid not null references business_units(id) on delete cascade,
  name text not null,
  -- Urutan tampil diatur admin, bukan abjad: "Kitchen" sebelum "Bar" adalah
  -- urutan operasional yang masuk akal, sedangkan abjad memaksa sebaliknya.
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (business_unit_id, name)
);
create index if not exists idx_divisions_bu on divisions(business_unit_id) where is_active;

alter table divisions enable row level security;

drop policy if exists divisions_select on divisions;
create policy divisions_select on divisions
  for select to authenticated
  using (has_bu_scope(auth.uid(), business_unit_id));

drop policy if exists divisions_modify on divisions;
create policy divisions_modify on divisions
  for all to authenticated
  using (is_bu_admin(auth.uid(), business_unit_id))
  with check (is_bu_admin(auth.uid(), business_unit_id));

-- ---------------------------------------------------------
-- Divisi pada scope. `on delete set null`: menghapus divisi TIDAK boleh
-- menghapus keanggotaan orangnya — dia cuma jadi "belum berdivisi".
-- ---------------------------------------------------------
alter table membership_scopes add column if not exists division_id uuid references divisions(id) on delete set null;
create index if not exists idx_membership_scopes_division on membership_scopes(division_id) where division_id is not null;

comment on column membership_scopes.division_id is
  'Divisi orang ini DI BU/OUTLET SCOPE INI. NULL = belum diatur; orangnya tidak muncul di roster Jadwal Shift.';

-- Divisi harus milik BU yang sama dengan scope-nya. Tanpa penjagaan ini,
-- panggilan API langsung bisa menempelkan divisi Cafe ke scope Bengkel — dan
-- itu tidak akan terlihat di UI mana pun karena dropdown-nya memang sudah benar.
create or replace function divisi_cocok_bu()
returns trigger
language plpgsql
as $$
begin
  if new.division_id is not null then
    if not exists (
      select 1 from divisions d
      where d.id = new.division_id and d.business_unit_id = new.business_unit_id
    ) then
      raise exception 'Divisi tidak berada di business unit yang sama dengan scope ini.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_divisi_cocok_bu on membership_scopes;
create trigger trg_divisi_cocok_bu
  before insert or update on membership_scopes
  for each row execute function divisi_cocok_bu();

-- ---------------------------------------------------------
-- RPC staff ikut membawa divisinya.
-- Didefinisikan ULANG UTUH supaya definisinya tetap satu tempat yang bisa
-- dibaca sekali jalan, bukan hasil tambal-sulam beberapa migration.
-- ---------------------------------------------------------

drop function if exists list_outlet_staff(uuid, boolean);
create or replace function list_outlet_staff(p_outlet_id uuid, p_include_inactive boolean default false)
returns table (
  user_id uuid,
  full_name text,
  is_active boolean,
  tingkat text,
  division_id uuid,
  division_name text,
  division_sort int
)
language sql
security definer
stable
set search_path = public
as $$
  with outlet_bu as (
    select business_unit_id from outlets where id = p_outlet_id
  )
  select distinct on (ms.user_id)
    ms.user_id,
    up.full_name,
    up.is_active,
    case when ms.outlet_id = p_outlet_id then 'outlet' else 'bu' end as tingkat,
    d.id,
    d.name,
    d.sort_order
  from membership_scopes ms
  join user_profiles up on up.id = ms.user_id
  join outlet_bu ob on true
  left join divisions d on d.id = ms.division_id and d.is_active
  where ms.business_unit_id = ob.business_unit_id
    and (ms.outlet_id = p_outlet_id or ms.outlet_id is null)
    and (p_include_inactive or up.is_active is not false)
    and has_bu_scope(auth.uid(), ob.business_unit_id)
  -- distinct on butuh urutan pasti. Scope tingkat OUTLET didahulukan supaya
  -- divisi yang terbaca adalah divisi di outlet ini, bukan divisi level BU.
  order by ms.user_id, (case when ms.outlet_id = p_outlet_id then 0 else 1 end);
$$;

revoke all on function list_outlet_staff(uuid, boolean) from public;
grant execute on function list_outlet_staff(uuid, boolean) to authenticated;

drop function if exists list_bu_staff_for_admin(uuid, boolean);
create or replace function list_bu_staff_for_admin(p_business_unit_id uuid, p_include_inactive boolean default false)
returns table (
  user_id uuid,
  full_name text,
  is_active boolean,
  division_id uuid,
  division_name text,
  division_sort int
)
language sql
security definer
stable
set search_path = public
as $$
  select distinct on (ms.user_id)
    ms.user_id,
    up.full_name,
    up.is_active,
    d.id,
    d.name,
    d.sort_order
  from membership_scopes ms
  join user_profiles up on up.id = ms.user_id
  left join divisions d on d.id = ms.division_id and d.is_active
  where ms.business_unit_id = p_business_unit_id
    and (p_include_inactive or up.is_active is not false)
    and (
      is_bu_admin(auth.uid(), p_business_unit_id)
      or exists (
        select 1
        from membership_scopes me
        where me.user_id = auth.uid()
          and me.role = 'outlet_admin'
          and me.business_unit_id = p_business_unit_id
          and (ms.outlet_id = me.outlet_id or ms.outlet_id is null)
      )
    )
  -- Scope yang PUNYA divisi didahulukan, supaya orang yang punya beberapa scope
  -- di BU ini terbaca divisinya — bukan kebetulan mengambil scope yang kosong.
  order by ms.user_id, (case when ms.division_id is null then 1 else 0 end);
$$;

revoke all on function list_bu_staff_for_admin(uuid, boolean) from public;
grant execute on function list_bu_staff_for_admin(uuid, boolean) to authenticated;
