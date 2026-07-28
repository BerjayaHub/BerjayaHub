-- =========================================================
-- Berjaya Hub OMS — 0046
-- Notifikasi Telegram untuk PENGIRIMAN: barang dikirim & kiriman diterima.
--
-- Memakai kembali trigger function `notify_telegram_event()` dari 0043, jadi
-- URL & secret tetap dibaca dari `integration_settings` — tidak ada nilai
-- rahasia di file migration ini (repo publik).
--
-- Idempotent — aman dijalankan ulang.
-- =========================================================

-- INSERT  -> event 'dispatch_sent'
-- UPDATE OF status -> 'dispatch_received' (disaring di Edge Function: hanya
--                     saat status benar-benar berubah menjadi 'received')
drop trigger if exists trg_notify_dispatches on dispatches;
create trigger trg_notify_dispatches
  after insert or update of status on dispatches
  for each row execute function notify_telegram_event();
