-- =========================================================
-- 0083 — Item Daily Activities yang dikerjakan beberapa hari sekali
--
-- KEBUTUHANNYA: sebagian pekerjaan tidak harian. Ganti minyak penggorengan tiap
-- 2 hari, kuras tandon tiap 7 hari. Selama semuanya harian, dua hal buruk
-- terjadi sekaligus: daftar staff penuh item yang hari ini memang tidak perlu
-- dikerjakan, dan rekap menghitungnya sebagai "tidak dikerjakan" setiap hari —
-- sehingga angka kepatuhan tidak berarti apa-apa lagi.
--
-- DASAR HITUNGANNYA: DARI TERAKHIR DIKERJAKAN, bukan dari tanggal tetap.
-- Untuk pekerjaan seperti ini yang penting adalah JARAK antar pengerjaan
-- ("minyak tidak boleh lebih dari 2 hari"), bukan jatuh pada tanggal ganjil.
-- Kalau kemarin libur dan baru dikerjakan hari ini, hitungan berikutnya
-- dimulai dari hari ini.
--
-- Kelemahan yang lazim dari cara ini — "kalau tidak pernah dikerjakan, ia tidak
-- pernah muncul lagi" — TIDAK berlaku di sini, dan itu bukan kebetulan: item
-- yang belum pernah dikerjakan dianggap jatuh tempo, dan item yang lewat
-- jadwalnya tetap jatuh tempo setiap hari sampai benar-benar dicentang. Jadi
-- pekerjaan yang diabaikan justru makin menonjol, bukan menghilang.
--
-- PER OUTLET, BUKAN PER ITEM. Satu item bisa berlaku untuk beberapa outlet
-- (0054). Gading Serpong mengganti minyak hari ini tidak boleh membuat item
-- itu hilang dari layar Sentul — pekerjaannya belum dikerjakan di sana.
-- =========================================================

alter table checklist_items
  add column if not exists interval_days int;

-- NULL = harian (perilaku lama, dan bawaan untuk seluruh item yang sudah ada).
-- Sengaja NULL, bukan 1: keduanya berperilaku sama, tapi NULL berarti "tidak
-- pernah diatur" sementara 1 berarti "diatur harian dengan sadar". Bedanya
-- terasa saat suatu hari bawaannya perlu diubah.
alter table checklist_items
  drop constraint if exists checklist_items_interval_check;
alter table checklist_items
  add constraint checklist_items_interval_check
  check (interval_days is null or (interval_days >= 1 and interval_days <= 365));

comment on column checklist_items.interval_days is
  'Jarak hari antar pengerjaan, dihitung dari terakhir dikerjakan. NULL = harian.';

-- =========================================================
-- Kapan tiap item TERAKHIR dikerjakan di sebuah outlet.
--
-- Dibuat sebagai fungsi, bukan dihitung di aplikasi, karena jawabannya butuh
-- menggabungkan `checklist_run_items` dengan `checklist_runs` lalu mengambil
-- tanggal terbesar per item. Melakukannya di aplikasi berarti menarik seluruh
-- riwayat pengerjaan outlet itu ke browser hanya untuk mencari satu tanggal per
-- item — dan riwayat itu tumbuh setiap hari tanpa batas.
--
-- SECURITY INVOKER (bawaan): RLS tetap berlaku, jadi fungsi ini tidak membuka
-- data outlet yang memang tidak boleh dilihat pemanggilnya.
--
-- Hanya yang `checked` yang dihitung. Item yang dibuka tapi tidak dicentang
-- BUKAN pekerjaan yang selesai, dan menghitungnya akan menunda kemunculan
-- berikutnya untuk pekerjaan yang justru belum dilakukan.
-- =========================================================
create or replace function item_terakhir_dikerjakan(p_outlet uuid)
returns table (item_id uuid, terakhir date)
language sql
stable
as $$
  select ri.item_id, max(r.run_date) as terakhir
  from checklist_run_items ri
  join checklist_runs r on r.id = ri.run_id
  where r.outlet_id = p_outlet
    and ri.checked = true
  group by ri.item_id;
$$;

revoke all on function item_terakhir_dikerjakan(uuid) from public;
grant execute on function item_terakhir_dikerjakan(uuid) to authenticated;

-- Tanpa indeks ini, tiap pembukaan modul Daily Activities memindai seluruh
-- riwayat pengerjaan outlet tersebut.
create index if not exists idx_checklist_runs_outlet_date on checklist_runs(outlet_id, run_date);
create index if not exists idx_checklist_run_items_item on checklist_run_items(item_id) where checked;
