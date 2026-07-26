-- =========================================================
-- Berjaya Hub OMS — 0039
-- Kebijakan hari libur turun ke level OUTLET.
--
-- Kasus nyata: satu BU bisa punya dua outlet dengan hari libur rutin berbeda
-- (mis. Central Kitchen libur Senin, outlet cafe libur Selasa). Sebaliknya, BU
-- yang tidak punya outlet sama sekali (mis. Divisi Admin) tetap butuh
-- pengaturan di level BU.
--
-- POLA: kolom di outlet bersifat NULLABLE.
--   NULL  -> "ikut BU" (warisi dari business_units)
--   terisi -> menimpa kebijakan BU khusus outlet itu
-- Sengaja nullable (bukan default '{}') supaya "belum diatur" bisa dibedakan
-- dari "sengaja diatur tanpa libur mingguan".
--
-- Idempotent — aman dijalankan ulang.
-- =========================================================

alter table outlets add column if not exists holiday_policy text;
alter table outlets add column if not exists weekly_off_days smallint[];

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'outlets_holiday_policy_check') then
    alter table outlets
      add constraint outlets_holiday_policy_check
      check (holiday_policy is null or holiday_policy in ('operational', 'follow_calendar'));
  end if;
end $$;

comment on column outlets.holiday_policy is
  'NULL = ikut kebijakan BU. Kalau diisi, menimpa business_units.holiday_policy untuk outlet ini.';
comment on column outlets.weekly_off_days is
  'Hari libur rutin outlet ini (0=Minggu..6=Sabtu). NULL = ikut BU.';

-- BU tetap menyimpan kebijakan sebagai default & satu-satunya sumber untuk BU
-- yang belum punya outlet — kolomnya sudah dibuat di 0038, tidak diubah.
