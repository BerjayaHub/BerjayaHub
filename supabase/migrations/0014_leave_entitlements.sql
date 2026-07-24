-- =========================================================
-- Berjaya Hub OMS — 0014
-- Revamp jatah cuti: jatah PER-JENIS cuti, dan tiap staff punya daftar jenis
-- cuti yang boleh diajukan (masing-masing dengan jatahnya sendiri).
--   - leave_types.deducts_quota dipakai sebagai "jenis ini punya jatah".
--   - leave_types.default_quota: jatah default saat jenis diberikan ke staff.
--   - leave_entitlements: baris = staff BOLEH jenis ini (+ jatahnya).
-- Menggantikan tabel leave_quotas (jatah tahunan tunggal) yang lama.
-- =========================================================

alter table leave_types add column if not exists default_quota numeric;
update leave_types set default_quota = 12 where name = 'Cuti Tahunan' and default_quota is null;

-- Hak (allowed) + jatah per jenis, per staff. Jatah dihitung tahunan lewat
-- pemakaian di tahun berjalan; quota_days null = tanpa batas (jenis non-jatah).
create table if not exists leave_entitlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references user_profiles(id) on delete cascade,
  leave_type_id uuid not null references leave_types(id) on delete cascade,
  quota_days numeric,
  created_at timestamptz not null default now(),
  unique (user_id, leave_type_id)
);
create index if not exists idx_leave_entitlements_user on leave_entitlements(user_id);

alter table leave_entitlements enable row level security;

create policy leave_entitlements_select_own on leave_entitlements
  for select using (user_id = auth.uid());

create policy leave_entitlements_admin on leave_entitlements
  for all using (
    exists (
      select 1 from membership_scopes ms
      where ms.user_id = leave_entitlements.user_id and is_bu_admin(auth.uid(), ms.business_unit_id)
    )
  )
  with check (
    exists (
      select 1 from membership_scopes ms
      where ms.user_id = leave_entitlements.user_id and is_bu_admin(auth.uid(), ms.business_unit_id)
    )
  );

-- Staff hanya boleh mengajukan jenis cuti yang sudah diberikan ke dia.
drop policy if exists leave_requests_insert_own on leave_requests;
create policy leave_requests_insert_own on leave_requests
  for insert with check (
    user_id = auth.uid()
    and exists (
      select 1 from membership_scopes ms
      where ms.user_id = auth.uid() and ms.business_unit_id = leave_requests.business_unit_id
    )
    and exists (
      select 1 from leave_entitlements le
      where le.user_id = auth.uid() and le.leave_type_id = leave_requests.leave_type_id
    )
  );

-- Tabel jatah tahunan tunggal yang lama tidak dipakai lagi.
drop table if exists leave_quotas;
