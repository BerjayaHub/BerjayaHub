-- =========================================================
-- 0080 — Batas pemesanan "H- sekian hari", bukan cuma H- sekian jam
--
-- `min_lead_hours` sudah ada sejak 0044, tapi satuannya jam. Untuk aturan yang
-- diucapkan sehari-hari sebagai "H-3", jam adalah satuan yang salah: orang
-- menghitung H-3 lewat TANGGAL di kalender, bukan lewat 72 jam. Memaksakannya
-- ke jam membuat tamu yang memesan tanggal 17 malam untuk tanggal 20 ditolak,
-- padahal menurut dia — dan menurut S&K yang dia baca — itu masih H-3.
--
-- Karena itu ada dua kolom baru:
--   min_lead_days      : H- berapa HARI, dihitung per tanggal kalender
--   booking_cutoff_time: batas jam di hari terakhir itu
--
-- Contoh: min_lead_days = 3, cutoff = 17:00, reservasi tanggal 20.
--   → pemesanan ditutup tanggal 17 pukul 17.00.
--   → memesan tanggal 17 pukul 16.59 masih diterima, 17.01 ditolak.
--   → memesan tanggal 16 (kapan pun) jelas diterima.
--
-- Cutoff hanya berlaku di HARI BATAS itu. Tanpa pembatasan ini, "sebelum jam
-- 17.00" akan ikut menolak pemesanan H-10 yang kebetulan dibuat jam 8 malam —
-- aturan yang tidak pernah dimaksudkan siapa pun.
--
-- CAKUPAN: hanya jalur WEBSITE, sama seperti `min_lead_hours` selama ini.
-- `create_reservation` (Staff App) memang tidak pernah memeriksa lead time, dan
-- itu dipertahankan dengan sadar: telepon "meja untuk besok" harus tetap bisa
-- dicatat di aplikasi. Aturan yang membuat staff mencatat di kertas bukan
-- aturan yang menang.
-- =========================================================

alter table reservation_settings
  add column if not exists min_lead_days int not null default 0 check (min_lead_days >= 0);
alter table reservation_settings
  add column if not exists booking_cutoff_time time;

comment on column reservation_settings.min_lead_days is
  'Reservasi paling lambat H- berapa HARI (kalender). 0 = boleh hari itu juga. Berlaku di jalur website; Staff App tidak dibatasi.';
comment on column reservation_settings.booking_cutoff_time is
  'Batas jam pemesanan pada hari batas (H-min_lead_days). NULL = sampai akhir hari. Tidak berlaku di hari-hari sebelumnya.';

-- ---------------------------------------------------------
-- (1) Satu sumber jawaban: boleh atau tidak, dan KENAPA
--
-- Alasannya ikut dikembalikan, bukan cuma boolean. Halaman publik yang hanya
-- tahu "tidak boleh" akan menampilkan daftar jam kosong — dan tamu menyimpulkan
-- restorannya penuh, lalu pergi. Yang sebenarnya terjadi adalah dia memesan
-- terlalu mepet, dan itu bisa diperbaiki hanya dengan mengganti tanggal.
-- ---------------------------------------------------------
create or replace function reservation_info_tanggal(p_outlet uuid, p_date date)
returns table (boleh boolean, alasan text, batas timestamptz)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  s reservation_settings%rowtype;
  v_sekarang timestamp;
  v_hari_ini date;
  v_selisih int;
  v_hari_batas date;
  v_cutoff time;
begin
  select * into s from reservation_settings where outlet_id = p_outlet;
  if not found then
    return query select false, 'Pengaturan reservasi outlet ini belum diisi.'::text, null::timestamptz;
    return;
  end if;

  -- Seluruh perbandingan dilakukan dalam waktu WIB. Memakai `now()` apa adanya
  -- (UTC) menggeser batas tujuh jam — dan pergeseran itu tidak terlihat sampai
  -- ada yang memesan lewat tengah malam.
  v_sekarang := now() at time zone 'Asia/Jakarta';
  v_hari_ini := v_sekarang::date;
  v_selisih := p_date - v_hari_ini;
  v_hari_batas := p_date - s.min_lead_days;
  v_cutoff := coalesce(s.booking_cutoff_time, '23:59:59'::time);
  batas := (v_hari_batas + v_cutoff) at time zone 'Asia/Jakarta';

  if p_date < v_hari_ini then
    return query select false, 'Tanggal itu sudah lewat.'::text, batas;
    return;
  end if;

  if v_selisih > s.max_days_ahead then
    return query select false,
      format('Reservasi hanya dibuka sampai %s hari ke depan.', s.max_days_ahead)::text, batas;
    return;
  end if;

  if v_selisih < s.min_lead_days then
    return query select false,
      format('Reservasi untuk tanggal ini sudah ditutup — pemesanan paling lambat H-%s (%s%s).',
             s.min_lead_days,
             to_char(v_hari_batas, 'DD-MM-YYYY'),
             case when s.booking_cutoff_time is null then '' else ' pukul ' || to_char(s.booking_cutoff_time, 'HH24:MI') end
      )::text, batas;
    return;
  end if;

  -- Hari batas: cutoff-nya baru berlaku di sini, bukan di hari-hari sebelumnya.
  if v_selisih = s.min_lead_days
     and s.booking_cutoff_time is not null
     and v_sekarang::time > s.booking_cutoff_time then
    return query select false,
      format('Pemesanan untuk tanggal ini ditutup pukul %s hari ini. Silakan pilih tanggal berikutnya.',
             to_char(s.booking_cutoff_time, 'HH24:MI'))::text, batas;
    return;
  end if;

  return query select true, null::text, batas;
end;
$$;

comment on function reservation_info_tanggal(uuid, date) is
  'Apakah tanggal ini masih boleh dipesan lewat website, beserta alasannya kalau tidak. Aturan H- hari + jam batas; aturan H- JAM tetap diperiksa per slot di reservation_availability.';

grant execute on function reservation_info_tanggal(uuid, date) to anon, authenticated;

-- ---------------------------------------------------------
-- (2) Ketersediaan slot ikut menghormati aturan baru
--
-- Bentuk kembaliannya sengaja TIDAK diubah. Mengubah tipe tabel yang
-- dikembalikan memaksa `drop function`, dan setiap halaman yang masih terbuka
-- di browser lain akan error sampai di-refresh — untuk perubahan yang
-- sebenarnya cukup di dalam badan fungsinya.
-- ---------------------------------------------------------
create or replace function reservation_availability(p_outlet uuid, p_date date)
returns table (slot_time time, used_pax int, max_pax int, is_open boolean)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  s reservation_settings%rowtype;
  t time;
  v_now timestamptz := now();
  v_min timestamptz;
  v_tanggal_boleh boolean;
begin
  select * into s from reservation_settings where outlet_id = p_outlet;
  if not found then return; end if;
  if p_date > (v_now at time zone 'Asia/Jakarta')::date + s.max_days_ahead then return; end if;

  select i.boleh into v_tanggal_boleh from reservation_info_tanggal(p_outlet, p_date) i;

  v_min := v_now + (s.min_lead_hours || ' hours')::interval;
  t := s.open_time;
  while t < s.close_time loop
    slot_time := t;
    max_pax := s.max_pax_per_slot;
    used_pax := reservation_slot_usage(p_outlet, p_date, t);
    -- Slot tertutup kalau kuota habis, lewat batas H- jam, ATAU tanggalnya
    -- sendiri sudah lewat batas H- hari.
    is_open := coalesce(v_tanggal_boleh, false)
      and used_pax < s.max_pax_per_slot
      and ((p_date + t) at time zone 'Asia/Jakarta') >= v_min;
    return next;
    t := t + (s.slot_minutes || ' minutes')::interval;
  end loop;
end;
$$;

grant execute on function reservation_availability(uuid, date) to authenticated, anon;
