-- =========================================================
-- Berjaya Hub OMS — 0042
-- Rute notifikasi Telegram: EVENT -> GRUP.
--
-- Kondisi nyata: ada dua grup dengan pembagian per JENIS EVENT, bukan per BU.
--   * Grup "Awal Bermula"  -> order stok (nanti juga reservasi)
--   * Grup "Berjaya"       -> pengajuan cuti & jatuh tempo dokumen armada
-- Satu TELEGRAM_CHAT_ID tunggal tidak cukup.
--
-- Chat ID disimpan di DATABASE, bukan secret, supaya bisa diubah/ditambah dari
-- Admin Portal tanpa redeploy. Aman: chat ID hanyalah pengenal — tanpa
-- TELEGRAM_BOT_TOKEN (yang tetap jadi secret) ia tidak bisa dipakai mengirim
-- apa pun. Aksesnya tetap dikunci super admin.
--
-- business_unit_id nullable:
--   NULL   -> berlaku untuk semua BU (jalur normal saat ini)
--   terisi -> menimpa khusus BU itu (mis. nanti order Bengkel ke grup lain)
--
-- Idempotent — aman dijalankan ulang.
-- =========================================================

create table if not exists telegram_routes (
  id uuid primary key default gen_random_uuid(),
  event_key text not null,
  business_unit_id uuid references business_units(id) on delete cascade,
  chat_id text not null,
  label text,                       -- nama grup, sekadar pengingat untuk admin
  is_active boolean not null default true,
  updated_at timestamptz not null default now()
);

-- Index unik dipisah (partial) karena NULL di Postgres tidak dianggap sama.
-- CATATAN: index partial TIDAK bisa dipakai ON CONFLICT lewat PostgREST —
-- sisi aplikasi memakai pola baca-dulu lalu UPDATE/INSERT.
create unique index if not exists uniq_tg_route_global
  on telegram_routes (event_key)
  where business_unit_id is null;

create unique index if not exists uniq_tg_route_bu
  on telegram_routes (event_key, business_unit_id)
  where business_unit_id is not null;

alter table telegram_routes enable row level security;

drop policy if exists telegram_routes_select on telegram_routes;
create policy telegram_routes_select on telegram_routes
  for select using (is_super_admin(auth.uid()));

drop policy if exists telegram_routes_modify on telegram_routes;
create policy telegram_routes_modify on telegram_routes
  for all using (is_super_admin(auth.uid()))
  with check (is_super_admin(auth.uid()));

comment on column telegram_routes.event_key is
  'leave_submitted | leave_reviewed | stock_order | fleet_docs (menyusul: reservation)';
comment on column telegram_routes.business_unit_id is
  'NULL = berlaku untuk semua BU. Terisi = menimpa khusus BU tersebut.';
