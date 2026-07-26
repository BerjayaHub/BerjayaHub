-- =========================================================
-- Berjaya Hub OMS — 0038
-- Kebijakan hari libur per BU + kompensasi Public Holiday (PH).
--
-- Dua "libur" di sistem ini SENGAJA tetap terpisah:
--   * holidays              -> hari libur nasional/perusahaan. Efeknya ke NBM
--                              (tarif libur + bonus PH) dan hak cuti pengganti.
--   * shift_schedules.is_off -> libur PRIBADI staff. Efeknya ke penilaian
--                              keterlambatan.
-- Staff cafe yang masuk saat Idul Fitri = dapat tarif libur, TAPI tidak libur.
--
-- Idempotent — aman dijalankan ulang.
-- =========================================================

-- ---------------------------------------------------------
-- (1) Kebijakan hari libur per BU
--   'operational'     -> BU tetap beroperasi. Minggu & hari besar TETAP hari
--                        kerja; staff yang masuk dapat kompensasi PH.
--                        (Cafe, Bengkel, Armada)
--   'follow_calendar' -> BU ikut kalender libur. Hari libur nasional & hari
--                        libur mingguan otomatis dianggap libur.
--                        (Admin Divisi)
-- weekly_off_days: 0=Minggu, 1=Senin, ... 6=Sabtu. Kosong = tidak ada libur
-- mingguan tetap. Hanya berlaku saat policy = 'follow_calendar'.
-- ---------------------------------------------------------
alter table business_units
  add column if not exists holiday_policy text not null default 'operational';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'business_units_holiday_policy_check') then
    alter table business_units
      add constraint business_units_holiday_policy_check
      check (holiday_policy in ('operational', 'follow_calendar'));
  end if;
end $$;

alter table business_units
  add column if not exists weekly_off_days smallint[] not null default '{}';

comment on column business_units.holiday_policy is
  'operational = tetap buka saat Minggu/hari besar (staff dapat kompensasi PH); follow_calendar = ikut kalender libur nasional';
comment on column business_units.weekly_off_days is
  'Hari libur mingguan tetap (0=Minggu..6=Sabtu). Hanya dipakai saat holiday_policy = follow_calendar';

-- ---------------------------------------------------------
-- (2) Metadata hari libur
-- is_joint_leave: cuti bersama (SKB 3 Menteri) vs libur nasional murni.
-- source: 'manual' | 'api' — supaya admin tahu mana yang hasil tarik otomatis.
-- ---------------------------------------------------------
alter table holidays add column if not exists is_joint_leave boolean not null default false;
alter table holidays add column if not exists source text not null default 'manual';

-- Buang duplikat lama dulu (sisakan baris terlama) supaya index unik di bawah
-- tidak gagal dibuat.
delete from holidays h
using holidays k
where h.id > k.id
  and h.holiday_date = k.holiday_date
  and h.outlet_id is not distinct from k.outlet_id
  and h.business_unit_id is not distinct from k.business_unit_id;

create unique index if not exists uniq_holiday_bu_date
  on holidays (business_unit_id, holiday_date)
  where outlet_id is null;

create unique index if not exists uniq_holiday_outlet_date
  on holidays (outlet_id, holiday_date)
  where outlet_id is not null;

-- ---------------------------------------------------------
-- (2b) Staff App kini perlu tahu tanggal mana yang libur (untuk catatan di
-- halaman Presensi & Jadwal Shift). Policy lama hanya mengizinkan ADMIN.
-- TANGGAL libur bukan data sensitif — yang tetap admin-only adalah nominalnya
-- (outlet_nbm_config & overtime tiers, tidak diubah di sini).
-- ---------------------------------------------------------
drop policy if exists holidays_select_member on holidays;
create policy holidays_select_member on holidays
  for select using (
    (outlet_id is not null and has_outlet_scope(auth.uid(), outlet_id))
    or (outlet_id is null and business_unit_id is not null and has_bu_scope(auth.uid(), business_unit_id))
  );

-- ---------------------------------------------------------
-- (3) Kompensasi Public Holiday — DINAMIS, diatur admin per outlet di
-- Pengaturan NBM & Lembur. Default 0 supaya perhitungan NBM yang sudah
-- berjalan tidak berubah sampai admin mengisinya.
--
--   holiday_amount      (sudah ada) -> MENGGANTIKAN NBM normal di hari libur
--   ph_bonus_amount     (baru)      -> bonus TAMBAHAN untuk yang tetap masuk
--   ph_replacement_days (baru)      -> hak cuti pengganti per hari kerja
--                                       yang jatuh di hari libur nasional
-- ---------------------------------------------------------
alter table outlet_nbm_config add column if not exists ph_bonus_amount numeric not null default 0;
alter table outlet_nbm_config add column if not exists ph_replacement_days numeric(4, 2) not null default 0;

comment on column outlet_nbm_config.ph_bonus_amount is
  'Bonus tambahan (Rp) untuk staff yang tetap masuk di hari libur nasional';
comment on column outlet_nbm_config.ph_replacement_days is
  'Hak cuti pengganti (hari) per hari kerja yang jatuh di hari libur nasional';
