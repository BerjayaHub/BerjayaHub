-- 0053_bu_staff_for_admin.sql
--
-- BUG: Jatah Cuti dan seluruh Laporan hanya berisi SATU orang kalau dibuka oleh
-- admin outlet.
--
-- PENYEBAB: keduanya memakai `listBuStaff()` yang membaca `membership_scopes`
-- langsung. Policy `membership_scopes_select_admin` memakai `is_bu_admin()`,
-- yang HANYA mencakup super_admin dan bu_admin. Seorang outlet_admin jatuh ke
-- `membership_scopes_select_own` dan cuma membaca baris scope-nya sendiri.
--
-- Yang membuat ini berbahaya: query-nya sukses, tidak ada error, dan hasilnya
-- BUKAN daftar kosong yang mencurigakan melainkan daftar berisi satu nama yang
-- terlihat masuk akal. Laporan penggajian yang diam-diam hanya memuat satu
-- orang tetap terlihat seperti laporan yang sah — tidak ada tanda apa pun bahwa
-- datanya terpotong. Ini kesalahan yang bisa dibawa ke perhitungan gaji.
--
-- PERBAIKAN: satu RPC security-definer yang menentukan cakupan sesuai peran
-- pemanggilnya, bukan bergantung pada RLS tabel yang aturannya dibuat untuk
-- tujuan berbeda.

create or replace function list_bu_staff_for_admin(p_business_unit_id uuid)
returns table (user_id uuid, full_name text, is_active boolean)
language sql
security definer
stable
set search_path = public
as $$
  select distinct ms.user_id, up.full_name, up.is_active
  from membership_scopes ms
  join user_profiles up on up.id = ms.user_id
  where ms.business_unit_id = p_business_unit_id
    and (
      -- Super admin & admin BU: seluruh staff BU ini.
      is_bu_admin(auth.uid(), p_business_unit_id)

      -- Admin outlet: hanya staff di outlet yang DIA adminkan. Termasuk staff
      -- ber-scope level BU (outlet_id null), karena mereka memang bisa
      -- ditugaskan di outlet mana pun — termasuk outletnya.
      or exists (
        select 1
        from membership_scopes me
        where me.user_id = auth.uid()
          and me.role = 'outlet_admin'
          and me.business_unit_id = p_business_unit_id
          and (ms.outlet_id = me.outlet_id or ms.outlet_id is null)
      )
    )
  order by up.full_name;
$$;

revoke all on function list_bu_staff_for_admin(uuid) from public;
grant execute on function list_bu_staff_for_admin(uuid) to authenticated;

comment on function list_bu_staff_for_admin(uuid) is
  'Daftar staff untuk layar admin (Jatah Cuti, Laporan). Cakupan mengikuti peran pemanggil: super/bu_admin = seluruh BU, outlet_admin = outlet yang diadminkan saja. Staff biasa dapat hasil kosong.';
