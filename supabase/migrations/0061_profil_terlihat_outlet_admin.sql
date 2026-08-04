-- =========================================================
-- Berjaya Hub OMS — 0061
-- BUG: admin outlet melihat "-" di kolom nama pada Rekap Presensi & Rekap NBM.
--
-- Gejalanya menyesatkan: BARISNYA MUNCUL, hanya namanya kosong. Itu petunjuk
-- bahwa data presensinya lolos RLS (memang benar — policy presensi memakai
-- `is_admin_of_outlet` yang mencakup outlet_admin), tapi embed
-- `user_profiles(full_name)` ditolak.
--
-- PENYEBAB — RLS BERLAKU JUGA DI DALAM EKSPRESI POLICY.
-- Policy `user_profiles_select_scoped` (0001) berbunyi:
--
--     exists (
--       select 1 from membership_scopes mine
--       join membership_scopes theirs on theirs.user_id = user_profiles.id
--       where mine.user_id = auth.uid()
--         and mine.role in ('bu_admin','outlet_admin')
--         and mine.business_unit_id = theirs.business_unit_id
--     )
--
-- Policy-nya SUDAH menyebut outlet_admin, jadi sekilas terlihat benar. Tapi
-- pembacaan `theirs` — scope ORANG LAIN — tunduk pada RLS `membership_scopes`,
-- dan di sana `membership_scopes_select_admin` memakai `is_bu_admin()` yang
-- TIDAK mencakup outlet_admin. Jadi bagi outlet_admin, `theirs` selalu kosong,
-- EXISTS-nya gagal, dan namanya tidak pernah terbaca.
--
-- Untuk bu_admin kebetulan jalan — itulah kenapa bug ini hanya muncul pada satu
-- peran dan lolos dari pengujian biasa.
--
-- PERBAIKAN: pindahkan pemeriksaannya ke fungsi SECURITY DEFINER, supaya
-- pembacaan scope di dalamnya tidak lagi disaring RLS. Pola yang sama sudah
-- dipakai `is_bu_admin()` dan `has_outlet_scope()` sejak awal — policy ini yang
-- tertinggal karena ditulis sebagai subquery inline.
-- =========================================================

create or replace function sesama_anggota_bu(p_viewer uuid, p_target uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from membership_scopes mine
    join membership_scopes theirs on theirs.user_id = p_target
    where mine.user_id = p_viewer
      and mine.role in ('bu_admin', 'outlet_admin')
      and mine.business_unit_id = theirs.business_unit_id
  );
$$;

revoke all on function sesama_anggota_bu(uuid, uuid) from public;
grant execute on function sesama_anggota_bu(uuid, uuid) to authenticated;

comment on function sesama_anggota_bu(uuid, uuid) is
  'Apakah p_viewer (admin BU/outlet) satu BU dengan p_target? SECURITY DEFINER — dipanggil dari policy user_profiles, yang subquery-nya tidak boleh tunduk RLS membership_scopes.';

drop policy if exists user_profiles_select_scoped on user_profiles;
create policy user_profiles_select_scoped on user_profiles
  for select to authenticated
  using (sesama_anggota_bu(auth.uid(), user_profiles.id));

-- CATATAN CAKUPAN: aturannya sengaja tetap "satu BU", bukan dipersempit ke
-- "satu outlet". Rekap presensi memang menampilkan staff yang absen di outlet
-- lain dalam BU yang sama (tugas luar/storing), dan mempersempit ke outlet akan
-- mengembalikan gejala yang sama persis — nama kosong — hanya pada baris yang
-- lebih jarang, sehingga jauh lebih sulit disadari.
