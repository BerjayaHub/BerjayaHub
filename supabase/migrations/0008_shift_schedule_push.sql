-- =========================================================
-- Berjaya Hub OMS — Fase 2 (tambahan): Jam Kerja Outlet & Push Notification Reminder
-- =========================================================

-- ---------------------------------------------------------
-- Jam kerja per outlet (dipakai buat reminder clock in).
-- Kalau clock_in_time null, reminder tidak aktif untuk outlet itu.
-- Timezone diasumsikan Asia/Jakarta (WIB) untuk semua outlet -- lihat
-- catatan di README kalau ada outlet di zona waktu lain.
-- ---------------------------------------------------------
alter table outlets add column clock_in_time time;
alter table outlets add column clock_out_time time;
alter table outlets add column reminder_enabled boolean not null default true;

-- ---------------------------------------------------------
-- PUSH_SUBSCRIPTIONS
-- Endpoint Web Push browser milik staff (1 user bisa punya lebih dari 1
-- device/browser terdaftar). Disimpan langsung dari client karena cuma
-- butuh anon key + RLS "punya sendiri", bukan data rahasia.
-- ---------------------------------------------------------
create table push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references user_profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth_key text not null,
  created_at timestamptz not null default now()
);

create index idx_push_subscriptions_user on push_subscriptions(user_id);

alter table push_subscriptions enable row level security;

create policy push_subscriptions_select_own on push_subscriptions
  for select using (user_id = auth.uid());

create policy push_subscriptions_insert_own on push_subscriptions
  for insert with check (user_id = auth.uid());

create policy push_subscriptions_delete_own on push_subscriptions
  for delete using (user_id = auth.uid());

-- ---------------------------------------------------------
-- Dedupe reminder: 1 baris = 1 reminder yang sudah terkirim ke staff
-- tertentu, di outlet tertentu, tanggal tertentu -- supaya reminder cuma
-- terkirim sekali per hari walau cron job jalan tiap beberapa menit.
-- Hanya diakses oleh Edge Function (service_role), jadi RLS default deny
-- untuk anon/staff sudah cukup (tidak perlu policy select/insert untuk role authenticated).
-- ---------------------------------------------------------
create table attendance_reminders_sent (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references user_profiles(id) on delete cascade,
  outlet_id uuid not null references outlets(id) on delete cascade,
  reminder_date date not null,
  sent_at timestamptz not null default now(),
  unique (user_id, outlet_id, reminder_date)
);

alter table attendance_reminders_sent enable row level security;
-- Sengaja tanpa policy untuk role authenticated/anon -> RLS default deny,
-- cuma service_role (dipakai Edge Function) yang bisa baca/tulis tabel ini.

-- ---------------------------------------------------------
-- pg_cron + pg_net: dipakai buat memanggil Edge Function pengirim reminder
-- setiap beberapa menit. Extension ini gratis tersedia di semua plan Supabase.
-- Penjadwalan cron job aktualnya ada di langkah manual (lihat README),
-- karena butuh URL project & service role key yang beda-beda per project
-- (disimpan aman lewat Vault, bukan di-hardcode di file migration ini).
-- ---------------------------------------------------------
create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;
