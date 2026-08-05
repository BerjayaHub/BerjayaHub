-- =========================================================
-- 0065 — Jumlah kantong kas hanya boleh diubah admin
--
-- MASALAHNYA APA
-- `0063` menaruh `cash_account_limit` di `user_profiles` dan menyebutnya
-- "diatur admin BU / super admin". Tapi policy `user_profiles_update_own`
-- (dari 0001) mengizinkan setiap orang memperbarui BARISNYA SENDIRI — dan
-- policy bekerja per BARIS, bukan per KOLOM. Artinya siapa pun bisa menaikkan
-- jatah kantongnya sendiri lewat API, tanpa menyentuh UI sama sekali.
--
-- Dampaknya memang tidak besar (dia hanya menambah kantong miliknya sendiri,
-- saldo tidak bertambah sepeser pun). Yang berbahaya adalah kalimat di
-- dokumentasi yang menjanjikan kontrol yang tidak pernah ada. Batas yang
-- diyakini ada padahal tidak, lebih buruk daripada tidak punya batas.
--
-- Postgres tidak punya "column-level RLS" pada policy, jadi penjaganya berupa
-- trigger: kolom lain tetap bisa diperbarui pemiliknya seperti biasa, hanya
-- kolom ini yang dijaga.
-- =========================================================

create or replace function jaga_batas_kantong_kas()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.cash_account_limit is distinct from old.cash_account_limit then
    if not (
      is_super_admin(auth.uid())
      or exists (
        select 1
        from membership_scopes ms
        where ms.user_id = new.id
          and ms.business_unit_id is not null
          and is_bu_admin(auth.uid(), ms.business_unit_id)
      )
    ) then
      raise exception 'Jumlah kantong kas hanya bisa diubah oleh admin BU atau super admin.'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

comment on function jaga_batas_kantong_kas() is
  'Penjaga kolom cash_account_limit: pemilik baris boleh memperbarui profilnya sendiri, tapi tidak jatah kantong kasnya.';

drop trigger if exists trg_jaga_batas_kantong_kas on user_profiles;
create trigger trg_jaga_batas_kantong_kas
  before update on user_profiles
  for each row
  execute function jaga_batas_kantong_kas();

-- CATATAN: penurunan batas TIDAK menghapus kantong yang terlanjur dibuat.
-- Menghapus kantong berarti menghapus riwayat kas di dalamnya — dan riwayat kas
-- justru yang paling tidak boleh hilang karena satu perubahan pengaturan.
-- Yang terjadi: user tidak bisa menambah kantong baru sampai jumlahnya turun
-- sendiri. Trigger `cek_batas_kantong_kas()` dari 0063 yang menegakkannya.
