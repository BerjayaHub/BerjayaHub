-- =========================================================
-- Berjaya Hub OMS — Fase 1: Master User (tambahan RLS)
-- =========================================================

-- bu_admin/outlet_admin perlu bisa update profil staff yang berada
-- dalam scope BU yang sama (misal: ubah nama, telp, atau nonaktifkan).
-- Sebelumnya (Fase 0) hanya ada policy "update profil milik sendiri".
create policy user_profiles_update_admin on user_profiles
  for update using (
    is_super_admin(auth.uid())
    or exists (
      select 1 from membership_scopes mine
      join membership_scopes theirs on theirs.user_id = user_profiles.id
      where mine.user_id = auth.uid()
        and mine.role in ('bu_admin', 'outlet_admin')
        and mine.business_unit_id = theirs.business_unit_id
    )
  )
  with check (
    is_super_admin(auth.uid())
    or exists (
      select 1 from membership_scopes mine
      join membership_scopes theirs on theirs.user_id = user_profiles.id
      where mine.user_id = auth.uid()
        and mine.role in ('bu_admin', 'outlet_admin')
        and mine.business_unit_id = theirs.business_unit_id
    )
  );
