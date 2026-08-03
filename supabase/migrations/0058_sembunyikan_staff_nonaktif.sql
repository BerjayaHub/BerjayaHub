-- 0058_sembunyikan_staff_nonaktif.sql
--
-- Staff yang dinonaktifkan tidak boleh muncul lagi di daftar pilihan modul mana pun.
--
-- TAPI TIDAK BOLEH DISEMBUNYIKAN DI MANA-MANA. Ada dua jenis daftar yang
-- kebetulan memakai fungsi yang sama, dan aturannya berlawanan:
--
--   DAFTAR PILIHAN (roster shift, Jatah Cuti, pemilih penerima)
--     -> nonaktif HARUS hilang. Orang yang sudah keluar tidak boleh bisa
--        dijadwalkan, diberi jatah cuti, atau dipilih.
--
--   CATATAN RIWAYAT (laporan payroll, rekap disiplin periode lalu)
--     -> nonaktif HARUS tetap ada. Orang yang bekerja bulan lalu lalu keluar
--        tetap harus terhitung di laporan bulan lalu. Menyembunyikannya berarti
--        menulis ulang sejarah: total jam dan gaji jadi tidak cocok dengan
--        kenyataan, dan tidak ada penjelasan kenapa.
--
-- Karena itu parameternya dibuat EKSPLISIT, dengan default `false` — yang aman.
-- Pemanggil yang memang butuh riwayat harus menyatakannya sendiri, sehingga
-- setiap tempat yang menampilkan orang nonaktif bisa ditelusuri dari kodenya.

-- ---------------------------------------------------------
-- (1) Staff per outlet — dipakai roster Jadwal Shift
-- ---------------------------------------------------------
drop function if exists list_outlet_staff(uuid);
create or replace function list_outlet_staff(p_outlet_id uuid, p_include_inactive boolean default false)
returns table (user_id uuid, full_name text, is_active boolean, tingkat text)
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
    case when ms.outlet_id = p_outlet_id then 'outlet' else 'bu' end as tingkat
  from membership_scopes ms
  join user_profiles up on up.id = ms.user_id
  join outlet_bu ob on true
  where ms.business_unit_id = ob.business_unit_id
    and (ms.outlet_id = p_outlet_id or ms.outlet_id is null)
    and (p_include_inactive or up.is_active is not false)
    and has_bu_scope(auth.uid(), ob.business_unit_id)
  order by ms.user_id, (case when ms.outlet_id = p_outlet_id then 0 else 1 end);
$$;

revoke all on function list_outlet_staff(uuid, boolean) from public;
grant execute on function list_outlet_staff(uuid, boolean) to authenticated;

comment on function list_outlet_staff(uuid, boolean) is
  'Staff sebuah outlet untuk roster Jadwal Shift. Nonaktif disembunyikan kecuali p_include_inactive = true (dipakai Admin Portal, agar jadwal milik orang yang sudah keluar masih bisa dilihat & dibatalkan).';

-- ---------------------------------------------------------
-- (2) Staff per BU — dipakai Jatah Cuti & Laporan
-- ---------------------------------------------------------
drop function if exists list_bu_staff_for_admin(uuid);
create or replace function list_bu_staff_for_admin(p_business_unit_id uuid, p_include_inactive boolean default false)
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
  order by up.full_name;
$$;

revoke all on function list_bu_staff_for_admin(uuid, boolean) from public;
grant execute on function list_bu_staff_for_admin(uuid, boolean) to authenticated;

comment on function list_bu_staff_for_admin(uuid, boolean) is
  'Staff sebuah BU untuk layar admin. Nonaktif disembunyikan kecuali p_include_inactive = true (dipakai LAPORAN, agar orang yang keluar tetap terhitung di periode saat dia masih bekerja).';
