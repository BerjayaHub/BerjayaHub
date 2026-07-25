-- =========================================================
-- Berjaya Hub OMS — 0029
-- Akses modul PER USER (di dalam sebuah BU), melengkapi toggle per BU.
--
-- Semantik sengaja "whitelist opsional":
--   - user TIDAK punya baris di BU ini  -> boleh SEMUA modul aktif BU (default,
--     kompatibel dengan data lama)
--   - user punya baris                  -> hanya modul yang terdaftar itu
-- =========================================================

create table user_module_access (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references user_profiles(id) on delete cascade,
  business_unit_id uuid not null references business_units(id) on delete cascade,
  module_id uuid not null references modules(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, business_unit_id, module_id)
);
create index idx_user_module_access_user on user_module_access(user_id, business_unit_id);

alter table user_module_access enable row level security;

-- Staff boleh baca aksesnya sendiri (dipakai Staff App untuk menyaring menu).
create policy user_module_access_select_own on user_module_access
  for select using (user_id = auth.uid());

-- Admin BU boleh baca & mengatur akses staff di BU-nya.
create policy user_module_access_select_admin on user_module_access
  for select using (is_bu_admin(auth.uid(), business_unit_id));

create policy user_module_access_modify_admin on user_module_access
  for all using (is_bu_admin(auth.uid(), business_unit_id))
  with check (is_bu_admin(auth.uid(), business_unit_id));
