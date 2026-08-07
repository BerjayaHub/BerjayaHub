-- =========================================================
-- 0074 — Hitung ulang status shift pada presensi yang terlanjur "Tanpa jadwal"
--
-- MASALAHNYA APA
-- `late_status` adalah POTRET: dihitung sekali saat clock in, lalu disimpan.
-- Itu keputusan yang benar — penilaian kehadiran harus memakai aturan yang
-- berlaku SAAT ITU, bukan aturan yang diubah belakangan.
--
-- Tapi ia punya satu akibat yang tidak pernah disebut di mana pun: kalau admin
-- baru menyusun jadwal SETELAH orangnya clock in, baris presensi itu tetap
-- "Tanpa jadwal" selamanya. Admin lalu membuka Jadwal Shift, melihat jadwalnya
-- ada, dan menyimpulkan aplikasinya salah. Yang salah bukan aplikasinya —
-- yang tidak ada adalah caranya memperbaiki.
--
-- Fungsi ini menyediakan cara itu, dengan batas yang membuatnya tidak berubah
-- jadi alat mengubah riwayat:
--   * Bawaannya HANYA menyentuh baris yang `late_status`-nya NULL atau
--     'no_schedule' — yaitu baris yang memang belum pernah dinilai.
--     Yang sudah berstatus 'late' / 'ontime' / 'tolerance' / 'off_day' tidak
--     disentuh, karena itu penilaian yang sudah terjadi.
--   * `p_paksa` ada untuk kasus luar biasa, dan sengaja tidak dijadikan bawaan.
-- =========================================================

create or replace function hitung_ulang_status_shift(
  p_record uuid,
  p_paksa boolean default false
)
returns table (status text, menit int, nama_shift text)
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_tanggal date;
  v_jadwal record;
  v_toleransi int;
  v_mulai int;      -- menit sejak tengah malam
  v_masuk int;
  v_selisih int;
  v_status text;
begin
  select ar.*, coalesce(ar.nbm_outlet_id, ar.outlet_id) as outlet_efektif,
         coalesce(ar.nbm_business_unit_id, ar.business_unit_id) as bu_efektif
    into r
  from attendance_records ar
  where ar.id = p_record;
  if not found then
    raise exception 'Presensi tidak ditemukan.';
  end if;

  if not is_admin_of_outlet(auth.uid(), r.outlet_id)
     and not is_admin_of_outlet(auth.uid(), r.outlet_efektif) then
    raise exception 'Hanya admin outlet terkait yang bisa menghitung ulang status shift.';
  end if;

  if not p_paksa and r.late_status is not null and r.late_status <> 'no_schedule' then
    return query select r.late_status, r.late_minutes, r.shift_name;
    return;
  end if;

  v_tanggal := (r.clock_in_at at time zone 'Asia/Jakarta')::date;

  -- Jadwal diutamakan dari OUTLET BASIS, tapi kalau tidak ada, baris jadwal di
  -- outlet mana pun pada tanggal itu tetap dipakai. Orang yang dijadwalkan
  -- membantu di outlet lain tetap punya jadwal — menolaknya hanya karena
  -- outletnya berbeda akan mengulang persis bug yang sedang diperbaiki.
  select ss.is_off, os.name as shift_name, os.start_time
    into v_jadwal
  from shift_schedules ss
  left join outlet_shifts os on os.id = ss.shift_id
  where ss.user_id = r.user_id
    and ss.work_date = v_tanggal
  order by (ss.outlet_id = r.outlet_efektif) desc, ss.created_at
  limit 1;

  if not found then
    update attendance_records
       set late_status = 'no_schedule', late_minutes = null
     where id = p_record;
    return query select 'no_schedule'::text, null::int, null::text;
    return;
  end if;

  -- Baris jadwal ADA tapi tidak menunjuk shift mana pun (shift_id kosong, dan
  -- bukan Libur). Tanpa jam mulai tidak ada yang bisa dibandingkan — dan
  -- membiarkannya lewat akan menghasilkan `v_selisih` NULL yang jatuh ke cabang
  -- terakhir dan mencap orangnya "Terlambat" tanpa satu pun angka.
  if not v_jadwal.is_off and v_jadwal.start_time is null then
    update attendance_records
       set late_status = 'no_schedule', late_minutes = null
     where id = p_record;
    return query select 'no_schedule'::text, null::int, null::text;
    return;
  end if;

  if v_jadwal.is_off then
    update attendance_records
       set late_status = 'off_day', late_minutes = null, shift_name = null
     where id = p_record;
    return query select 'off_day'::text, null::int, null::text;
    return;
  end if;

  select coalesce(late_tolerance_minutes, 10) into v_toleransi
  from shift_settings where business_unit_id = r.bu_efektif;
  v_toleransi := coalesce(v_toleransi, 10);

  v_mulai := extract(hour from v_jadwal.start_time) * 60 + extract(minute from v_jadwal.start_time);
  v_masuk := extract(hour from (r.clock_in_at at time zone 'Asia/Jakarta')) * 60
           + extract(minute from (r.clock_in_at at time zone 'Asia/Jakarta'));
  v_selisih := v_masuk - v_mulai;
  -- Normalisasi ±12 jam, sama persis dengan `evaluateLateness()` di JS: clock in
  -- 00:05 untuk shift 23:00 berarti telat 65 menit, bukan lebih awal 1375 menit.
  if v_selisih > 720 then v_selisih := v_selisih - 1440; end if;
  if v_selisih < -720 then v_selisih := v_selisih + 1440; end if;

  if v_selisih <= 0 then
    v_status := 'ontime'; v_selisih := 0;
  elsif v_selisih <= v_toleransi then
    v_status := 'tolerance';
  else
    v_status := 'late';
  end if;

  update attendance_records
     set late_status = v_status,
         late_minutes = v_selisih,
         shift_name = v_jadwal.shift_name
   where id = p_record;

  return query select v_status, v_selisih, v_jadwal.shift_name;
end;
$$;

comment on function hitung_ulang_status_shift(uuid, boolean) is
  'Hitung ulang status terlambat satu presensi dari jadwal shift yang berlaku. Bawaannya hanya menyentuh baris yang belum pernah dinilai (NULL / no_schedule).';

revoke all on function hitung_ulang_status_shift(uuid, boolean) from public;
grant execute on function hitung_ulang_status_shift(uuid, boolean) to authenticated;


-- ---------------------------------------------------------
-- Versi MASSAL — untuk kasus yang paling sering terjadi: jadwal seminggu penuh
-- baru disusun setelah beberapa hari presensi berjalan.
--
-- Menekan ↻ satu per satu untuk dua puluh baris bukan perbaikan, itu hukuman.
-- Sama seperti versi satuan, bawaannya HANYA menyentuh baris yang belum pernah
-- dinilai.
-- ---------------------------------------------------------
create or replace function hitung_ulang_status_shift_massal(
  p_from date,
  p_to date,
  p_outlet uuid default null,
  p_paksa boolean default false
)
returns table (diproses int, jadi_dinilai int)
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_proses int := 0;
  v_ok int := 0;
  v_hasil record;
begin
  for r in
    select ar.id
    from attendance_records ar
    where (ar.clock_in_at at time zone 'Asia/Jakarta')::date between p_from and p_to
      and (p_outlet is null or coalesce(ar.nbm_outlet_id, ar.outlet_id) = p_outlet or ar.outlet_id = p_outlet)
      and (p_paksa or ar.late_status is null or ar.late_status = 'no_schedule')
      and is_admin_of_outlet(auth.uid(), ar.outlet_id)
    order by ar.clock_in_at
  loop
    v_proses := v_proses + 1;
    select * into v_hasil from hitung_ulang_status_shift(r.id, p_paksa);
    if v_hasil.status is distinct from 'no_schedule' then
      v_ok := v_ok + 1;
    end if;
  end loop;
  return query select v_proses, v_ok;
end;
$$;

comment on function hitung_ulang_status_shift_massal(date, date, uuid, boolean) is
  'Hitung ulang status shift untuk satu rentang tanggal. Hanya baris yang belum pernah dinilai, kecuali p_paksa.';

revoke all on function hitung_ulang_status_shift_massal(date, date, uuid, boolean) from public;
grant execute on function hitung_ulang_status_shift_massal(date, date, uuid, boolean) to authenticated;
