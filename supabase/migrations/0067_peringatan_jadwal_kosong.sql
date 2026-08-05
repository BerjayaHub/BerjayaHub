-- =========================================================
-- 0067 — Peringatan jadwal shift kosong
--
-- KENAPA ADA
-- Sejak reminder clock in mengikuti jadwal shift, "tidak dijadwalkan" berarti
-- "tidak diingatkan". Itu memindahkan satu titik kegagalan dari staff ke admin:
-- kalau jadwal besok belum dibuat, seisi outlet tidak akan diingatkan — dan
-- tidak ada satu pun tanda bahwa itu sedang terjadi. Yang paling berbahaya dari
-- kegagalan seperti ini bukan besarnya, tapi diamnya.
--
-- Tabel ini hanya untuk DEDUPE: satu peringatan per outlet per tanggal yang
-- diperiksa. Tanpa itu, cron yang berjalan tiap sore akan mengirim peringatan
-- yang sama berulang kali, dan admin akan mematikan notifikasinya — persis
-- kebalikan dari yang kita inginkan.
-- =========================================================

create table if not exists shift_gap_alerts_sent (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references outlets(id) on delete cascade,
  -- Tanggal JADWAL yang kosong (biasanya besok), bukan tanggal pengirimannya.
  gap_date date not null,
  penerima int not null default 0,
  sent_at timestamptz not null default now(),
  unique (outlet_id, gap_date)
);

alter table shift_gap_alerts_sent enable row level security;
-- Sengaja TANPA policy untuk authenticated/anon: RLS default deny, hanya
-- service_role (Edge Function) yang membaca/menulis. Pola yang sama dengan
-- attendance_reminders_sent (0008).

comment on table shift_gap_alerts_sent is
  'Dedupe peringatan "jadwal shift kosong" — satu kali per outlet per tanggal jadwal.';
