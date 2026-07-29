-- 0049_user_email.sql
--
-- Tampilkan email user di Master User.
--
-- MASALAHNYA: email hanya ada di `auth.users`, dan skema `auth` TIDAK bisa
-- dibaca dari klien lewat PostgREST — sengaja begitu, karena tabel itu juga
-- memuat hash password dan token. Jadi email harus disalin ke tempat yang boleh
-- dibaca, yaitu `user_profiles`.
--
-- KENAPA PAKAI TRIGGER, BUKAN DIISI DARI APLIKASI: kalau pengisiannya
-- diserahkan ke Edge Function `create-staff-user`, maka user yang dibuat lewat
-- dashboard Supabase (atau yang mengganti emailnya sendiri lewat Auth) akan
-- punya email kosong/basi di sini — dan yang paling menyesatkan, tabelnya tetap
-- terlihat "normal", cuma isinya salah. Trigger membuat sumber kebenarannya
-- tetap satu: auth.users.

alter table user_profiles add column email text;

-- Isi data yang sudah ada.
update user_profiles p
set email = u.email
from auth.users u
where u.id = p.id;

-- Jaga tetap sinkron: saat user dibuat, dan saat emailnya diubah.
create or replace function sync_user_profile_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update user_profiles set email = new.email where id = new.id;
  return new;
end;
$$;

drop trigger if exists trg_sync_user_profile_email on auth.users;
create trigger trg_sync_user_profile_email
  after insert or update of email on auth.users
  for each row execute function sync_user_profile_email();

-- Kolomnya ikut RLS `user_profiles` yang sudah ada, jadi tidak ada policy baru:
-- admin melihat email staff dalam cakupannya, staff melihat emailnya sendiri.
-- Email BUKAN rahasia seperti password, tapi tetap data pribadi — jadi tidak
-- dibuka lebih luas daripada nama yang sudah tampil di tabel yang sama.

comment on column user_profiles.email is
  'Salinan auth.users.email, dijaga trigger trg_sync_user_profile_email. Jangan diubah manual — sumber kebenarannya auth.users.';
