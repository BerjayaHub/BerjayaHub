-- =========================================================
-- Berjaya Hub OMS — 0033
-- Izin akses menu/tab Admin Portal per user (per BU).
--
-- Semantik "whitelist opsional" (sama seperti user_module_access):
--   - tidak punya baris di BU ini -> boleh SEMUA tab (default, kompatibel lama)
--   - punya baris                 -> hanya tab yang terdaftar
--
-- Catatan: tab "Master User" (pengatur role & scope) TIDAK diatur lewat tabel ini
-- karena dikunci khusus super_admin di aplikasi.
-- =========================================================

create table admin_tab_access (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references user_profiles(id) on delete cascade,
  business_unit_id uuid not null references business_units(id) on delete cascade,
  tab_code text not null,
  created_at timestamptz not null default now(),
  unique (user_id, business_unit_id, tab_code)
);
create index idx_admin_tab_access_user on admin_tab_access(user_id, business_unit_id);

alter table admin_tab_access enable row level security;

create policy admin_tab_access_select_own on admin_tab_access
  for select using (user_id = auth.uid());

create policy admin_tab_access_select_admin on admin_tab_access
  for select using (is_bu_admin(auth.uid(), business_unit_id));

-- Hanya super_admin yang boleh mengatur izin akses admin (sejalan dengan
-- aturan bahwa pengaturan role/scope hanya milik super_admin).
create policy admin_tab_access_modify_super on admin_tab_access
  for all using (is_super_admin(auth.uid()))
  with check (is_super_admin(auth.uid()));
