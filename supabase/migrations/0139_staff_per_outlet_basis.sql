-- =========================================================
-- Berjaya Hub OMS — 0139
-- Daftar staff bisa disaring per OUTLET BASIS.
--
-- =========================================================
-- BUG YANG MELAHIRKANNYA
-- =========================================================
--
--   "di fitur laporan rekap presensi & disiplin, apabila saya filter outlet
--    nya, tetap semua staff di BU tersebut akan tampil tetapi nilainya 0
--    semua, saya ingin yang tampil di tabel hanyalah staff yang sedang ada di
--    basis outlet dari filter outlet yang dipilih saja"
--
-- Laporannya menyaring PRESENSI per outlet, tapi daftar staffnya diambil
-- per-BU. Hasilnya: satu outlet berisi 5 orang menampilkan 30 baris, 25 di
-- antaranya nol semua — dan baris nol itu punya arti yang PENTING di laporan
-- disiplin ("orang ini tidak pernah masuk"), jadi pembacanya tidak bisa
-- membedakan mana yang benar-benar bolos dari mana yang memang bertugas di
-- outlet lain.
--
-- =========================================================
-- BENTUK LAMA DIBUANG, BUKAN DIBIARKAN BERDAMPINGAN
-- =========================================================
--
-- PostgREST memilih fungsi berdasarkan HIMPUNAN NAMA argumen yang dikirim.
-- Kalau bentuk dua-argumen dibiarkan hidup bersama bentuk tiga-argumen yang
-- berdefault, panggilan dua argumen jadi AMBIGU dan ditolak 300 — mematikan
-- setiap layar yang memakai daftar staff, bukan cuma laporannya.
-- =========================================================

drop function if exists list_bu_staff_for_admin(uuid, boolean);

create or replace function list_bu_staff_for_admin(
  p_business_unit_id uuid,
  p_include_inactive boolean default false,
  p_outlet_id uuid default null
)
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
    -- SARINGAN BARU. `null` = seluruh BU, persis seperti sebelumnya.
    --
    -- Cakupan level BU (`outlet_id is null`) SENGAJA TIDAK ikut saat sebuah
    -- outlet dipilih: orang ber-cakupan BU memang bisa ditugaskan ke outlet
    -- mana pun, jadi memasukkannya berarti mengembalikan daftar panjang yang
    -- justru sedang dipersempit. Yang benar-benar bekerja di sana tetap
    -- muncul, karena layar menambahkan siapa pun yang punya presensi di outlet
    -- itu pada periode laporannya.
    and (p_outlet_id is null or ms.outlet_id = p_outlet_id)
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

revoke all on function list_bu_staff_for_admin(uuid, boolean, uuid) from public;
grant execute on function list_bu_staff_for_admin(uuid, boolean, uuid) to authenticated;

comment on function list_bu_staff_for_admin(uuid, boolean, uuid) is
  'Staff sebuah BU. `p_outlet_id` menyaring ke cakupan outlet itu saja; null = seluruh BU (perilaku sebelum 0139).';

-- ---------------------------------------------------------
-- Laporkan hasilnya.
-- ---------------------------------------------------------
do $$
declare
  v_jml int;
begin
  select count(*) into v_jml
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'list_bu_staff_for_admin';
  raise notice 'jumlah bentuk list_bu_staff_for_admin: %', v_jml;
  if v_jml <> 1 then
    raise exception 'Harus TEPAT satu bentuk list_bu_staff_for_admin. Lebih dari satu membuat panggilan dua argumen jadi ambigu dan ditolak PostgREST.';
  end if;
end $$;
