-- 0057_user_email_on_insert.sql
--
-- BUG: email user yang BARU dibuat tidak muncul di Master User; user lama muncul.
--
-- PENYEBAB — urutan, lagi.
-- `create-staff-user` mengerjakan dua langkah berurutan:
--   1. auth.admin.createUser()  -> INSERT ke auth.users
--   2. insert ke user_profiles
--
-- Trigger `trg_sync_user_profile_email` (migration 0049) berjalan pada langkah 1
-- dan melakukan `update user_profiles ... where id = new.id`. Pada detik itu
-- baris profilnya BELUM ADA, jadi UPDATE mengenai NOL baris — dan UPDATE yang
-- tidak mengenai apa pun bukan error, jadi tidak ada satu pun tanda kegagalan.
--
-- User lama punya email bukan karena trigger itu bekerja, melainkan karena
-- diisi backfill saat 0049 dijalankan. Jadi trigger tersebut sebenarnya TIDAK
-- PERNAH berhasil untuk user baru sejak awal.
--
-- PERBAIKAN: isi emailnya dari sisi `user_profiles`, bukan menunggu dikirimi.
-- Trigger BEFORE INSERT mengambil email langsung dari auth.users — urutan
-- langkah di aplikasi jadi tidak lagi berpengaruh, dan jalur pembuatan lain
-- (dashboard Supabase, SQL manual) ikut tercakup tanpa perlu diingat.

create or replace function isi_email_profil()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- auth.users SELALU jadi sumber kebenaran, apa pun yang dikirim pemanggil.
  -- Kalau nilai dari pemanggil dipercaya, email di sini bisa berbeda dari email
  -- yang dipakai login — dan perbedaan itu tidak akan ketahuan sampai ada yang
  -- mencoba menghubungi orangnya.
  select u.email into new.email from auth.users u where u.id = new.id;
  return new;
end;
$$;

drop trigger if exists trg_isi_email_profil on user_profiles;
create trigger trg_isi_email_profil
  before insert on user_profiles
  for each row execute function isi_email_profil();

-- Trigger di auth.users (0049) tetap dipertahankan — itu yang menangani
-- PERUBAHAN email di kemudian hari. Yang satu mengisi saat lahir, yang satu
-- menjaga tetap sinkron; keduanya diperlukan.

-- Perbaiki data yang terlanjur kosong sejak 0049 dijalankan.
update user_profiles p
set email = u.email
from auth.users u
where u.id = p.id
  and p.email is distinct from u.email;
