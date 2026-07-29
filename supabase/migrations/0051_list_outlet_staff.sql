-- 0051_list_outlet_staff.sql
--
-- BUG: tabel Jadwal Shift di Staff App hanya menampilkan diri sendiri.
--
-- PENYEBAB — bukan di logika filternya, tapi di RLS. Policy
-- `membership_scopes_select_own` hanya membuka baris MILIK SENDIRI, dan
-- `membership_scopes_select_admin` hanya berlaku untuk admin BU. Jadi
-- `listBuStaff()` yang dipanggil dari Staff App memang cuma mengembalikan satu
-- baris: si pemanggil. Filter di halamannya lalu terlihat seolah sengaja
-- membatasi, padahal datanya memang tidak pernah sampai.
--
-- Ini jenis kegagalan yang menipu: query-nya sukses, tidak ada error, hasilnya
-- cuma "kebetulan" berisi satu orang.
--
-- PERBAIKAN: RPC security-definer yang mengembalikan NAMA saja — tanpa email,
-- telepon, gaji, atau role — untuk staff yang terdaftar di satu outlet. Jadwal
-- shift memang dokumen bersama: seluruh tim perlu tahu siapa masuk kapan, dan
-- Admin Portal sudah menampilkannya. Yang tidak boleh bocor adalah data pribadi
-- lainnya, dan itu tetap tertutup.

create or replace function list_outlet_staff(p_outlet_id uuid)
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
    -- 'outlet' = ditugaskan langsung di outlet ini.
    -- 'bu'     = scope-nya level BU (mis. admin BU) sehingga mencakup semua
    --            outlet. Dibedakan supaya UI bisa menampilkan yang level BU
    --            HANYA kalau memang punya jadwal — kalau semuanya ditampilkan,
    --            tabel outlet kecil jadi penuh nama yang tidak pernah masuk.
    case when ms.outlet_id = p_outlet_id then 'outlet' else 'bu' end as tingkat
  from membership_scopes ms
  join user_profiles up on up.id = ms.user_id
  join outlet_bu ob on true
  where ms.business_unit_id = ob.business_unit_id
    and (ms.outlet_id = p_outlet_id or ms.outlet_id is null)
    -- Pemanggil harus anggota BU pemilik outlet ini. Tanpa syarat ini, siapa
    -- pun yang login bisa menebak uuid outlet organisasi lain dan memanen
    -- daftar nama karyawannya.
    and has_bu_scope(auth.uid(), ob.business_unit_id)
  -- distinct on butuh urutan yang pasti; 'outlet' didahulukan supaya orang yang
  -- punya scope outlet DAN scope BU tercatat sebagai 'outlet'.
  order by ms.user_id, (case when ms.outlet_id = p_outlet_id then 0 else 1 end);
$$;

revoke all on function list_outlet_staff(uuid) from public;
grant execute on function list_outlet_staff(uuid) to authenticated;

comment on function list_outlet_staff(uuid) is
  'Nama staff yang terdaftar di sebuah outlet, untuk tabel Jadwal Shift di Staff App. Sengaja hanya mengembalikan nama + status aktif.';
