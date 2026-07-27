-- =========================================================
-- Berjaya Hub OMS — 0043
-- Pemicu notifikasi Telegram lewat SQL, menggantikan setup Database Webhook
-- manual di dashboard.
--
-- KENAPA LEWAT SQL:
-- Database Webhook Supabase sebenarnya cuma pembungkus trigger + pg_net.
-- Membuatnya lewat migration lebih baik karena: masuk kontrol versi, otomatis
-- ikut kalau project di-restore/di-clone, dan tidak bergantung letak menu
-- dashboard yang bisa berpindah.
--
-- URL & secret TIDAK ditulis di file ini (repo publik). Keduanya dibaca dari
-- tabel `integration_settings` yang kamu isi sekali lewat SQL Editor —
-- lihat SETUP.md langkah 5.
--
-- Idempotent — aman dijalankan ulang.
-- =========================================================

create extension if not exists pg_net;

-- ---------------------------------------------------------
-- (1) Tempat menyimpan URL & secret (JANGAN di-commit isinya)
-- ---------------------------------------------------------
create table if not exists integration_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

alter table integration_settings enable row level security;

-- Hanya super admin. Trigger membacanya lewat SECURITY DEFINER, jadi tetap
-- jalan untuk staff biasa yang mengajukan cuti.
drop policy if exists integration_settings_all on integration_settings;
create policy integration_settings_all on integration_settings
  for all using (is_super_admin(auth.uid()))
  with check (is_super_admin(auth.uid()));

comment on table integration_settings is
  'Isi lewat SQL Editor: notify_telegram_url (URL Edge Function) & notify_secret (NOTIFY_SECRET).';

-- ---------------------------------------------------------
-- (2) Trigger function: kirim payload ke Edge Function notify-telegram
-- Bentuk payload dibuat sama persis dengan Database Webhook bawaan Supabase
-- (type / table / schema / record / old_record), supaya Edge Function tidak
-- perlu tahu ia dipanggil lewat jalur mana.
-- ---------------------------------------------------------
create or replace function notify_telegram_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text;
  v_secret text;
begin
  select value into v_url from integration_settings where key = 'notify_telegram_url';
  -- Belum dikonfigurasi -> diam saja. Notifikasi tidak boleh menggagalkan
  -- transaksi bisnis (pengajuan cuti tetap harus tersimpan).
  if v_url is null or v_url = '' then
    return coalesce(new, old);
  end if;
  select value into v_secret from integration_settings where key = 'notify_secret';

  -- pg_net bersifat ASINKRON: request diantrikan, transaksi tidak menunggu
  -- jaringan. Jadi lambatnya Telegram tidak memperlambat app.
  perform net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-notify-secret', coalesce(v_secret, '')
               ),
    body    := jsonb_build_object(
                 'type', tg_op,
                 'table', tg_table_name,
                 'schema', tg_table_schema,
                 'record', to_jsonb(new),
                 'old_record', case when tg_op = 'UPDATE' then to_jsonb(old) else null end
               )
  );

  return coalesce(new, old);
exception
  when others then
    -- Sengaja ditelan: gagal kirim notifikasi TIDAK boleh membatalkan
    -- pengajuan cuti / order stok.
    raise warning 'notify_telegram_event gagal: %', sqlerrm;
    return coalesce(new, old);
end;
$$;

-- ---------------------------------------------------------
-- (3) Pasang trigger
-- ---------------------------------------------------------
drop trigger if exists trg_notify_leave_requests on leave_requests;
create trigger trg_notify_leave_requests
  after insert or update of status on leave_requests
  for each row execute function notify_telegram_event();

drop trigger if exists trg_notify_stock_orders on stock_orders;
create trigger trg_notify_stock_orders
  after insert on stock_orders
  for each row execute function notify_telegram_event();

-- ---------------------------------------------------------
-- CARA CEK
-- Riwayat panggilan pg_net (status & body balasan Edge Function):
--   select id, status_code, content, created
--   from net._http_response
--   order by created desc
--   limit 10;
-- ---------------------------------------------------------
