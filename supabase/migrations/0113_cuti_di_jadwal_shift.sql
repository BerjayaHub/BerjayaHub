-- =========================================================
-- Berjaya Hub OMS — 0113
-- Cuti yang DISETUJUI terbaca di jadwal shift.
--
-- =========================================================
-- YANG DIMINTA
-- =========================================================
--
--   "staff yang mengajukan dan sudah disetujui, maka di shift otomatis tanggal
--    yang disetujui cuti nya akan berstatus cuti / PH / sakit, tergantung yang
--    diajukan"
--
-- =========================================================
-- CUTI TIDAK DISALIN KE `shift_schedules`. DIBACA SAAT DIGAMBAR.
-- =========================================================
--
-- Godaan pertamanya adalah menulis baris `shift_schedules` bertanda cuti saat
-- pengajuan disetujui. Itu ditolak, dan alasannya bukan selera:
--
--   1. `shift_schedules` cuma mengenal DUA keadaan. Constraint `shift_or_off`
--      (0034) menuntut "ada shift_id" ATAU "is_off". Menambahkan keadaan
--      ketiga berarti melonggarkan constraint yang menjaga seluruh modul shift
--      sejak awal — dan constraint itu yang membuat "jadwal tanpa shift dan
--      tanpa keterangan" mustahil ada.
--
--   2. MENYALIN BERARTI MENDUPLIKASI KEBENARAN. Kalau cutinya dibatalkan atau
--      ditolak belakangan, baris shiftnya HARUS ikut dibersihkan. Itu menuntut
--      trigger, dan satu kegagalan trigger meninggalkan "cuti hantu" yang tidak
--      pernah hilang — tanpa error, tanpa satu pun tanda.
--
--   3. Jadwal aslinya hilang. Orang yang sudah dijadwalkan shift pagi lalu
--      cutinya disetujui akan kehilangan baris shiftnya; saat cutinya batal,
--      tidak ada yang tahu shift apa yang tadinya ada di situ.
--
-- Jadi `shift_schedules` TIDAK DISENTUH sama sekali oleh migration ini.
-- Pengajuan cuti tetap satu-satunya sumber kebenaran, dan layar shift
-- MEMBACANYA saat menggambar. Cuti yang dibatalkan langsung hilang dari
-- jadwal dengan sendirinya — tidak ada yang perlu disinkronkan.
--
-- =========================================================
-- KENAPA PERLU RPC, BUKAN QUERY BIASA
-- =========================================================
--
-- `leave_requests` menyimpan RENTANG (`start_date`..`end_date`), sedangkan
-- jadwal shift butuh SATU BARIS PER TANGGAL. Menguraikannya di sisi layar
-- berarti mengunduh seluruh pengajuan yang rentangnya bersinggungan lalu
-- menghitung sendiri — dan bug perhitungan tanggal seperti itu tidak pernah
-- menghasilkan error, hanya satu hari yang meleset di ujung rentang.
--
-- `generate_series` mengerjakannya di database, tepat sekali.
--
-- =========================================================
-- YANG SENGAJA TIDAK DILAKUKAN
-- =========================================================
--
-- Tidak ada perubahan pada `leave_requests`, `leave_types`, `shift_schedules`,
-- maupun policy mana pun. Ini murni fungsi BACA baru.
-- =========================================================

-- ---------------------------------------------------------
-- (1) Indeks pendukung
--
-- Pertanyaannya selalu berbentuk "cuti disetujui yang bersinggungan dengan
-- rentang tanggal ini". Tanpa indeks, tiap pembukaan layar jadwal memindai
-- seluruh riwayat pengajuan.
-- ---------------------------------------------------------
create index if not exists idx_leave_disetujui_rentang
  on leave_requests(business_unit_id, start_date, end_date)
  where status = 'approved';

-- ---------------------------------------------------------
-- (2) CUTI DISETUJUI, DIURAI PER TANGGAL
--
-- Dipakai layar jadwal shift (admin & staff) untuk menandai sel.
-- ---------------------------------------------------------
create or replace function cuti_disetujui_rentang(
  p_outlet uuid,
  p_from date,
  p_to date
)
returns table (
  user_id uuid,
  tanggal date,
  jenis text,
  leave_request_id uuid
)
language sql
stable
security definer
set search_path = public
as $$
  select lr.user_id,
         d::date as tanggal,
         lt.name as jenis,
         lr.id   as leave_request_id
    from leave_requests lr
    join leave_types lt on lt.id = lr.leave_type_id
    -- Setiap tanggal di dalam rentang pengajuan, DIPOTONG pada rentang yang
    -- diminta. `greatest`/`least` yang membuat pengajuan 25 Des - 5 Jan tetap
    -- benar saat layar hanya menampilkan Januari — tanpa itu, generate_series
    -- akan menghasilkan tanggal Desember yang tidak dipakai siapa pun, dan
    -- pengajuan lintas bulan akan tampak hilang separuh.
    cross join lateral generate_series(
      greatest(lr.start_date, p_from),
      least(lr.end_date, p_to),
      interval '1 day'
    ) d
   where lr.status = 'approved'
     -- Rentangnya BERSINGGUNGAN, bukan "termuat di dalam". Pengajuan yang
     -- mulai sebelum p_from dan berakhir sesudah p_to tetap harus terjaring;
     -- kalau syaratnya `start_date >= p_from`, cuti panjang justru hilang dari
     -- minggu-minggu tengahnya.
     and lr.start_date <= p_to
     and lr.end_date   >= p_from
     -- OUTLET-NYA COCOK, ATAU PENGAJUANNYA MEMANG TIDAK BEROUTLET.
     --
     -- `leave_requests.outlet_id` boleh null (0013: `on delete set null`, dan
     -- pengajuan lama bisa saja tidak mengisinya). Menyaring ketat dengan
     -- `= p_outlet` akan membuang pengajuan tanpa outlet sepenuhnya — dan
     -- cutinya tidak akan pernah muncul di jadwal mana pun.
     --
     -- Untuk yang null, dipakai penyaring BU lewat keanggotaan orangnya di
     -- outlet ini, supaya cuti orang dari outlet lain tidak ikut nyasar.
     and (
       lr.outlet_id = p_outlet
       or (
         lr.outlet_id is null
         and exists (
           select 1 from membership_scopes ms
            where ms.user_id = lr.user_id
              and ms.outlet_id = p_outlet
         )
       )
     )
     -- Yang bertanya harus punya hak di outlet ini. `security definer`
     -- mematikan RLS, jadi tanpa baris ini siapa pun bisa membaca cuti seluruh
     -- outlet sekadar dengan menebak id-nya.
     and has_outlet_scope(auth.uid(), p_outlet);
$$;

-- ---------------------------------------------------------
-- (3) CUTI SAYA SENDIRI, diurai per tanggal
--
-- Dipakai layar "Jadwal Saya" di Staff App. Dipisah dari yang di atas karena
-- pertanyaannya berbeda: yang ini TIDAK bergantung outlet sama sekali —
-- staff yang dijadwalkan di dua outlet tetap punya satu cuti yang sama.
-- ---------------------------------------------------------
create or replace function cuti_saya_rentang(p_from date, p_to date)
returns table (
  tanggal date,
  jenis text,
  leave_request_id uuid
)
language sql
stable
security definer
set search_path = public
as $$
  select d::date as tanggal,
         lt.name as jenis,
         lr.id   as leave_request_id
    from leave_requests lr
    join leave_types lt on lt.id = lr.leave_type_id
    cross join lateral generate_series(
      greatest(lr.start_date, p_from),
      least(lr.end_date, p_to),
      interval '1 day'
    ) d
   where lr.status = 'approved'
     and lr.user_id = auth.uid()
     and lr.start_date <= p_to
     and lr.end_date   >= p_from;
$$;

revoke all on function cuti_disetujui_rentang(uuid, date, date) from public;
revoke all on function cuti_saya_rentang(date, date) from public;
grant execute on function cuti_disetujui_rentang(uuid, date, date) to authenticated;
grant execute on function cuti_saya_rentang(date, date) to authenticated;

comment on function cuti_disetujui_rentang(uuid, date, date) is
  'Cuti berstatus approved di sebuah outlet, DIURAI menjadi satu baris per tanggal. Dipakai layar jadwal shift untuk menandai sel. TIDAK menulis apa pun ke shift_schedules — cuti tetap satu-satunya sumber kebenaran.';

notify pgrst, 'reload schema';
