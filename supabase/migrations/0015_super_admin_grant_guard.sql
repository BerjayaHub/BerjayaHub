-- =========================================================
-- Berjaya Hub OMS — 0015
-- Pengaman: hanya Super Admin yang boleh MEMBUAT/mengubah scope ber-role
-- 'super_admin'. Tanpa ini, seorang bu_admin bisa menaikkan dirinya/orang lain
-- jadi super_admin lewat menu scope (escalation). bu_admin tetap boleh kelola
-- scope non-super_admin di BU-nya seperti biasa.
-- =========================================================

drop policy if exists membership_scopes_modify on membership_scopes;

create policy membership_scopes_modify on membership_scopes
  for all
  using (is_bu_admin(auth.uid(), business_unit_id))
  with check (
    is_bu_admin(auth.uid(), business_unit_id)
    and (role <> 'super_admin' or is_super_admin(auth.uid()))
  );
