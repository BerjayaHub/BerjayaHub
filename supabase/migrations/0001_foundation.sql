-- =========================================================
-- Berjaya Hub OMS — Fase 0: Fondasi
-- Struktur: Organization -> Business Unit -> Outlet
-- Modul aktif per BU, membership staff many-to-many, RLS dasar
-- =========================================================

-- ---------------------------------------------------------
-- 1. ORGANIZATIONS
-- ---------------------------------------------------------
create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------
-- 2. BUSINESS UNITS
-- type dipakai untuk menentukan karakteristik default modul
-- (contoh: 'cafe', 'workshop', 'armada') — bebas ditambah nanti
-- ---------------------------------------------------------
create table business_units (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  type text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------
-- 3. OUTLETS
-- outlet_role menentukan peran outlet dalam alur central kitchen:
--   'standalone'    -> outlet olah semua sendiri dari raw material
--   'central_kitchen' -> outlet ini adalah dapur pusat, produksi semi-finished
--   'served_by_ck'  -> outlet ini menerima semi-finished dari CK tertentu
-- served_by_outlet_id menunjuk ke outlet ber-role 'central_kitchen'
-- (1 CK bisa melayani banyak outlet -> relasi one-to-many alami lewat FK ini)
-- ---------------------------------------------------------
create table outlets (
  id uuid primary key default gen_random_uuid(),
  business_unit_id uuid not null references business_units(id) on delete cascade,
  name text not null,
  address text,
  outlet_role text not null default 'standalone'
    check (outlet_role in ('standalone', 'central_kitchen', 'served_by_ck')),
  served_by_outlet_id uuid references outlets(id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint served_by_must_be_ck check (
    served_by_outlet_id is null or outlet_role = 'served_by_ck'
  )
);

create index idx_outlets_business_unit on outlets(business_unit_id);
create index idx_outlets_served_by on outlets(served_by_outlet_id);

-- ---------------------------------------------------------
-- 4. MODULES (master daftar modul yang ada di sistem)
-- Ditambah manual lewat migration setiap kali modul baru selesai dibangun
-- ---------------------------------------------------------
create table modules (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  created_at timestamptz not null default now()
);

-- Seed modul yang sudah disepakati (bisa nambah row baru kapan saja)
insert into modules (code, name, description) values
  ('attendance', 'Presensi', 'Absensi clock-in/clock-out staff'),
  ('leave', 'Pengajuan Cuti', 'Pengajuan dan approval cuti staff'),
  ('cleaning_checklist', 'Ceklis Kebersihan', 'Checklist kebersihan outlet'),
  ('inventory', 'Inventory', 'Saldo stok raw material & produk jadi per outlet'),
  ('production', 'Production', 'Proses racik/produksi berbasis formula/resep'),
  ('cash_ledger', 'Cash Ledger', 'Kas masuk/keluar/transfer per outlet'),
  ('fleet', 'Armada', 'Data kendaraan dan penugasannya');

-- ---------------------------------------------------------
-- 5. BU_MODULES (toggle modul aktif per business unit)
-- ---------------------------------------------------------
create table bu_modules (
  id uuid primary key default gen_random_uuid(),
  business_unit_id uuid not null references business_units(id) on delete cascade,
  module_id uuid not null references modules(id) on delete cascade,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (business_unit_id, module_id)
);

-- ---------------------------------------------------------
-- 6. USER PROFILES (1-1 dengan auth.users)
-- ---------------------------------------------------------
create table user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  phone text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------
-- 7. MEMBERSHIP_SCOPES
-- Staff bisa terdaftar di banyak BU/outlet sekaligus, dengan role
-- berbeda di tiap scope. outlet_id nullable -> berarti role berlaku
-- di level BU (contoh: admin BU tanpa terikat 1 outlet spesifik)
-- ---------------------------------------------------------
create table membership_scopes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references user_profiles(id) on delete cascade,
  business_unit_id uuid not null references business_units(id) on delete cascade,
  outlet_id uuid references outlets(id) on delete cascade,
  role text not null check (role in ('super_admin', 'bu_admin', 'outlet_admin', 'staff')),
  created_at timestamptz not null default now(),
  unique (user_id, business_unit_id, outlet_id, role)
);

create index idx_membership_user on membership_scopes(user_id);
create index idx_membership_bu on membership_scopes(business_unit_id);
create index idx_membership_outlet on membership_scopes(outlet_id);

-- =========================================================
-- HELPER FUNCTIONS (dipakai oleh RLS policy)
-- =========================================================

-- Cek apakah user adalah super_admin (lintas semua BU)
create or replace function is_super_admin(p_user_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from membership_scopes
    where user_id = p_user_id and role = 'super_admin'
  );
$$;

-- Cek apakah user adalah admin (super_admin atau bu_admin) untuk BU tertentu
create or replace function is_bu_admin(p_user_id uuid, p_business_unit_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from membership_scopes
    where user_id = p_user_id
      and (
        role = 'super_admin'
        or (business_unit_id = p_business_unit_id and role = 'bu_admin')
      )
  );
$$;

-- Cek apakah user punya scope apapun (member) di suatu BU
create or replace function has_bu_scope(p_user_id uuid, p_business_unit_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from membership_scopes
    where user_id = p_user_id
      and (role = 'super_admin' or business_unit_id = p_business_unit_id)
  );
$$;

-- Cek apakah user punya scope di outlet tertentu (langsung, atau via bu_admin/super_admin)
create or replace function has_outlet_scope(p_user_id uuid, p_outlet_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from membership_scopes ms
    join outlets o on o.id = p_outlet_id
    where ms.user_id = p_user_id
      and (
        ms.role = 'super_admin'
        or (ms.business_unit_id = o.business_unit_id and ms.role in ('bu_admin'))
        or ms.outlet_id = p_outlet_id
      )
  );
$$;

-- =========================================================
-- ROW LEVEL SECURITY
-- =========================================================

alter table organizations enable row level security;
alter table business_units enable row level security;
alter table outlets enable row level security;
alter table modules enable row level security;
alter table bu_modules enable row level security;
alter table user_profiles enable row level security;
alter table membership_scopes enable row level security;

-- organizations: bisa dilihat kalau user punya scope di salah satu BU-nya
create policy organizations_select on organizations
  for select using (
    is_super_admin(auth.uid())
    or exists (
      select 1 from business_units bu
      where bu.organization_id = organizations.id
        and has_bu_scope(auth.uid(), bu.id)
    )
  );

create policy organizations_modify on organizations
  for all using (is_super_admin(auth.uid()))
  with check (is_super_admin(auth.uid()));

-- business_units: bisa dilihat kalau user punya scope di BU itu
create policy business_units_select on business_units
  for select using (has_bu_scope(auth.uid(), id));

create policy business_units_insert on business_units
  for insert with check (is_super_admin(auth.uid()));

create policy business_units_update on business_units
  for update using (is_bu_admin(auth.uid(), id))
  with check (is_bu_admin(auth.uid(), id));

create policy business_units_delete on business_units
  for delete using (is_super_admin(auth.uid()));

-- outlets: bisa dilihat kalau user punya scope di outlet itu atau BU induknya
create policy outlets_select on outlets
  for select using (has_outlet_scope(auth.uid(), id));

create policy outlets_insert on outlets
  for insert with check (is_bu_admin(auth.uid(), business_unit_id));

create policy outlets_update on outlets
  for update using (is_bu_admin(auth.uid(), business_unit_id))
  with check (is_bu_admin(auth.uid(), business_unit_id));

create policy outlets_delete on outlets
  for delete using (is_bu_admin(auth.uid(), business_unit_id));

-- modules: tabel referensi, semua user yang login boleh baca
create policy modules_select on modules
  for select using (auth.uid() is not null);

create policy modules_modify on modules
  for all using (is_super_admin(auth.uid()))
  with check (is_super_admin(auth.uid()));

-- bu_modules: bisa dilihat kalau user punya scope di BU tersebut
create policy bu_modules_select on bu_modules
  for select using (has_bu_scope(auth.uid(), business_unit_id));

create policy bu_modules_modify on bu_modules
  for all using (is_bu_admin(auth.uid(), business_unit_id))
  with check (is_bu_admin(auth.uid(), business_unit_id));

-- user_profiles: user bisa lihat/update profil sendiri; admin bisa lihat semua
-- yang terdaftar dalam scope BU yang sama (disederhanakan: super_admin lihat semua)
create policy user_profiles_select_own on user_profiles
  for select using (id = auth.uid() or is_super_admin(auth.uid()));

create policy user_profiles_select_scoped on user_profiles
  for select using (
    exists (
      select 1 from membership_scopes mine
      join membership_scopes theirs on theirs.user_id = user_profiles.id
      where mine.user_id = auth.uid()
        and mine.role in ('bu_admin', 'outlet_admin')
        and mine.business_unit_id = theirs.business_unit_id
    )
  );

create policy user_profiles_update_own on user_profiles
  for update using (id = auth.uid())
  with check (id = auth.uid());

-- membership_scopes: user bisa lihat scope milik sendiri; admin BU bisa
-- lihat & kelola scope staff dalam BU yang dia adminkan
create policy membership_scopes_select_own on membership_scopes
  for select using (user_id = auth.uid());

create policy membership_scopes_select_admin on membership_scopes
  for select using (is_bu_admin(auth.uid(), business_unit_id));

create policy membership_scopes_modify on membership_scopes
  for all using (is_bu_admin(auth.uid(), business_unit_id))
  with check (is_bu_admin(auth.uid(), business_unit_id));
