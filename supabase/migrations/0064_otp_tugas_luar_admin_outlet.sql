-- =========================================================
-- 0064 — OTP Tugas Luar: admin outlet ikut bisa menerbitkan kode
--
-- MASALAHNYA APA
-- Mode 'otp' sudah berfungsi utuh dari ujung ke ujung (admin terbitkan kode →
-- staff masukkan → RPC redeem_exit_otp → dipakai saat clock in). Yang tidak
-- berfungsi adalah SIAPA yang boleh menerbitkan: policy 0006 hanya mengizinkan
-- is_bu_admin(), padahal orang yang benar-benar berada di lokasi dan tahu bahwa
-- si staff memang sedang keluar adalah admin OUTLET-nya.
--
-- Gejalanya menyesatkan: tombol "Terbitkan Kode" tetap ada, tetapi insert-nya
-- ditolak RLS. Bagi admin outlet, fitur ini tampak "tidak aktif" — persis
-- keluhan yang muncul — padahal yang kurang cuma satu baris izin.
--
-- Sekalian: created_by tidak pernah diisi sejak 0006, jadi kolom "diterbitkan
-- oleh" selalu kosong. Sekarang diisi default dari auth.uid().
-- =========================================================

-- ---------------------------------------------------------
-- Helper: apakah user ini admin di SALAH SATU outlet milik BU tersebut?
--
-- Harus SECURITY DEFINER. Subquery di dalam ekspresi policy ikut disaring RLS,
-- jadi versi inline-nya akan selalu bernilai false untuk orang yang justru
-- ingin kita izinkan — kegagalan sunyi yang paling sering muncul di proyek ini.
-- ---------------------------------------------------------
create or replace function is_outlet_admin_in_bu(p_user_id uuid, p_business_unit_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from membership_scopes ms
    where ms.user_id = p_user_id
      and ms.role in ('super_admin', 'bu_admin', 'outlet_admin')
      and (ms.role = 'super_admin' or ms.business_unit_id = p_business_unit_id)
  );
$$;

comment on function is_outlet_admin_in_bu(uuid, uuid) is
  'True kalau user adalah super admin, admin BU tersebut, atau admin outlet mana pun di dalam BU tersebut.';

revoke all on function is_outlet_admin_in_bu(uuid, uuid) from public;
grant execute on function is_outlet_admin_in_bu(uuid, uuid) to authenticated;

-- ---------------------------------------------------------
-- Policy diganti: admin outlet ikut boleh melihat & menerbitkan kode
-- ---------------------------------------------------------
drop policy if exists exit_otp_admin_select on exit_task_otp_codes;
drop policy if exists exit_otp_admin_insert on exit_task_otp_codes;

create policy exit_otp_admin_select on exit_task_otp_codes
  for select using (is_outlet_admin_in_bu(auth.uid(), business_unit_id));

create policy exit_otp_admin_insert on exit_task_otp_codes
  for insert with check (is_outlet_admin_in_bu(auth.uid(), business_unit_id));

-- ---------------------------------------------------------
-- Jejak penerbit kode
--
-- Diisi lewat DEFAULT, bukan dititipkan ke client. Kalau client yang mengirim,
-- kolomnya bisa diisi apa saja, dan yang tercatat justru bukan penerbit
-- sebenarnya — jejak audit yang tidak bisa dipercaya lebih buruk daripada
-- kolom kosong.
-- ---------------------------------------------------------
alter table exit_task_otp_codes alter column created_by set default auth.uid();

comment on column exit_task_otp_codes.created_by is
  'Diisi otomatis dari auth.uid() saat insert (0064). Baris sebelum 0064 memang kosong.';
