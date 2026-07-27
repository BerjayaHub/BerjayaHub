-- =========================================================
-- Berjaya Hub OMS — 0041
-- Penanda notifikasi Telegram yang sudah terkirim.
--
-- Dipakai reminder terjadwal (dokumen armada) supaya cron yang kebetulan
-- jalan dua kali tidak mengirim pesan dobel ke grup. Pola yang sama dengan
-- `attendance_reminders_sent`.
--
-- Notifikasi berbasis event (pengajuan cuti, order stok) TIDAK memakai tabel
-- ini — Database Webhook sudah menjamin satu pesan per baris.
--
-- Idempotent — aman dijalankan ulang.
-- =========================================================

create table if not exists telegram_notifications_sent (
  id uuid primary key default gen_random_uuid(),
  kind text not null,             -- mis. 'fleet_docs'
  ref text not null,              -- pembeda unik, mis. tanggal 'YYYY-MM-DD'
  sent_at timestamptz not null default now(),
  unique (kind, ref)
);

create index if not exists idx_telegram_sent_kind on telegram_notifications_sent(kind, sent_at desc);

alter table telegram_notifications_sent enable row level security;

-- Hanya super admin yang perlu melihatnya (untuk audit). Penulisan dilakukan
-- Edge Function dengan service_role, yang memang melewati RLS.
drop policy if exists telegram_sent_select on telegram_notifications_sent;
create policy telegram_sent_select on telegram_notifications_sent
  for select using (is_super_admin(auth.uid()));
