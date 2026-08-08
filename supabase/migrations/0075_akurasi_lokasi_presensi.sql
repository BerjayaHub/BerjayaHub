-- =========================================================
-- 0075 — Simpan KETELITIAN lokasi saat presensi
--
-- KENAPA
-- Selama ini yang disimpan hanya koordinatnya. Padahal koordinat tanpa angka
-- ketelitian adalah setengah informasi: "-6.5, 106.8" bisa berarti "tepat di
-- pintu outlet" atau "di suatu tempat dalam radius 3 km", dan tidak ada cara
-- membedakannya setelah kejadian.
--
-- Itu yang membuat keluhan "saya di outlet tapi ditolak" mustahil ditelusuri.
-- Android 12+ dan iOS punya saklar "Lokasi Presisi"; kalau mati, HP tetap
-- menjawab dengan koordinat — hanya melesetnya bisa kilometer. Semua tampak
-- normal kecuali hasilnya.
--
-- Dengan kolom ini, admin bisa melihat sendiri: ditolak karena orangnya memang
-- jauh, atau karena HP-nya menjawab "±2 km".
--
-- Kolomnya juga yang membuat kelonggaran di aplikasi bisa dipertanggungjawabkan:
-- presensi yang diterima karena lingkaran ketelitiannya menyentuh area outlet
-- TIDAK diam-diam dianggap sama dengan yang benar-benar presisi — angkanya
-- tercatat dan terlihat di rekap.
-- =========================================================

alter table attendance_records add column if not exists clock_in_accuracy_m int;
alter table attendance_records add column if not exists clock_out_accuracy_m int;

comment on column attendance_records.clock_in_accuracy_m is
  'Ketelitian lokasi saat clock in, dalam meter (dari Geolocation API). NULL = tidak tercatat (presensi sebelum 0075).';
comment on column attendance_records.clock_out_accuracy_m is
  'Ketelitian lokasi saat clock out, dalam meter. NULL = tidak tercatat.';
