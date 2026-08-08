-- =========================================================
-- 0077 — Jam reservasi fleksibel + Syarat & Ketentuan per outlet
--
-- BAGIAN 1: JAM BEBAS, KUOTA TETAP BERARTI
--
-- Kolomnya sudah `time`, jadi 18:15 sebenarnya selalu bisa disimpan. Yang
-- membatasi cuma daftar pilihan di layar. Tapi melepas begitu saja akan
-- MEMATAHKAN kuota tanpa satu pun error:
--
--   `reservation_slot_usage()` menghitung dengan `reserve_time = p_time`.
--   Kalau jamnya bebas, 18:00 dan 18:05 terhitung slot yang BERBEDA — dua
--   rombongan 20 orang bisa masuk berbarengan di ruangan yang cuma muat 20,
--   dan sistemnya melaporkan semuanya baik-baik saja sampai tamunya datang.
--
-- Karena itu jamnya dibebaskan, tapi hitungannya dipindah ke EMBER: setiap
-- jam dipetakan ke slot tempat ia jatuh. 18:00 dan 18:05 masuk ember yang
-- sama, jadi kuotanya kembali berarti.
--
-- BAGIAN 2: SYARAT & KETENTUAN
--
-- Disimpan PER OUTLET, bukan ditulis di dalam kode. Minimal purchase, nomor
-- rekening deposit, dan lama pemakaian ruangan adalah hal yang berubah tanpa
-- memerlukan programmer — dan begitu ia ada di kode, setiap perubahan kecil
-- jadi antre menunggu deploy.
--
-- `terms_accepted_at` di reservasi mencatat KAPAN tamu menyetujuinya. Untuk
-- kebijakan yang menyebut "deposit tidak dapat dibatalkan", persetujuan yang
-- tidak tercatat sama saja dengan tidak ada — dan yang menanggung akibatnya
-- adalah kasir di depan tamu yang merasa tidak pernah diberi tahu.
-- =========================================================

-- ---------------------------------------------------------
-- (1) Ember slot: jam mana pun dipetakan ke awal slotnya
-- ---------------------------------------------------------
create or replace function reservation_slot_of(p_outlet uuid, p_time time)
returns time
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  s reservation_settings%rowtype;
begin
  select * into s from reservation_settings where outlet_id = p_outlet;
  -- Outlet tanpa pengaturan: jamnya dikembalikan apa adanya. Menebak slot dari
  -- pengaturan yang tidak ada hanya akan menghasilkan angka yang terlihat pasti
  -- padahal tidak berdasar apa pun.
  if not found then return p_time; end if;
  if p_time < s.open_time then return s.open_time; end if;
  return (
    s.open_time
    + (floor(extract(epoch from (p_time - s.open_time)) / (s.slot_minutes * 60))
       * (s.slot_minutes || ' minutes')::interval)
  )::time;
end;
$$;

comment on function reservation_slot_of(uuid, time) is
  'Awal slot tempat sebuah jam jatuh. 18:05 dengan slot 60 menit dari jam 10:00 -> 18:00.';

grant execute on function reservation_slot_of(uuid, time) to authenticated, anon;

-- ---------------------------------------------------------
-- (2) Pemakaian kuota dihitung per EMBER, bukan per jam persis
-- ---------------------------------------------------------
create or replace function reservation_slot_usage(p_outlet uuid, p_date date, p_time time)
returns int
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(sum(r.pax), 0)::int
  from reservations r
  where r.outlet_id = p_outlet
    and r.reserve_date = p_date
    -- Dibandingkan sebagai EMBER di kedua sisi. Membandingkan jam persis
    -- membuat 18:00 dan 18:05 dianggap slot berbeda, dan kuotanya bocor.
    and reservation_slot_of(p_outlet, r.reserve_time) = reservation_slot_of(p_outlet, p_time)
    and r.status in ('pending', 'confirmed');
$$;

-- ---------------------------------------------------------
-- (3) Syarat & Ketentuan per outlet
-- ---------------------------------------------------------
alter table reservation_settings add column if not exists terms text;

comment on column reservation_settings.terms is
  'Syarat & Ketentuan reservasi outlet ini. Ditampilkan di halaman publik, form staff, dan IKUT di pesan WhatsApp konfirmasi. NULL = tidak ada syarat khusus.';

alter table reservations add column if not exists terms_accepted_at timestamptz;

comment on column reservations.terms_accepted_at is
  'Kapan tamu menyetujui S&K. NULL = belum/tidak tercatat (mis. reservasi lewat telepon yang diinput staff).';

-- ---------------------------------------------------------
-- (4) create_reservation ikut mencatat persetujuan
--
-- Parameter baru diberi DEFAULT supaya pemanggil lama tidak perlu diubah
-- serentak — halaman yang belum di-deploy ulang tetap bekerja, hanya tanpa
-- mencatat persetujuan.
-- ---------------------------------------------------------
-- Versi 10 argumen di-DROP, bukan dibiarkan berdampingan. Dua fungsi dengan
-- nama sama dan jumlah argumen berbeda membuat PostgREST memilih berdasarkan
-- parameter yang kebetulan dikirim klien — halaman yang belum di-deploy ulang
-- akan diam-diam memakai versi lama, dan persetujuan S&K-nya tidak tercatat
-- tanpa satu pun tanda.
drop function if exists create_reservation(uuid, text, text, date, time, int, uuid, text, text, text);

create or replace function create_reservation(
  p_outlet uuid,
  p_name text,
  p_phone text,
  p_date date,
  p_time time,
  p_pax int,
  p_area uuid,
  p_notes text,
  p_referral text,
  p_email text,
  p_terms_accepted boolean default false
)
returns reservations
language plpgsql
security definer
set search_path = public
as $$
declare
  s reservation_settings%rowtype;
  v_bu uuid;
  v_used int;
  v_row reservations;
begin
  if not has_outlet_scope(auth.uid(), p_outlet) then
    raise exception 'Tidak berhak membuat reservasi di outlet ini';
  end if;
  if p_pax is null or p_pax <= 0 then raise exception 'Jumlah tamu harus lebih dari 0'; end if;

  select business_unit_id into v_bu from outlets where id = p_outlet;
  select * into s from reservation_settings where outlet_id = p_outlet;
  if not found then raise exception 'Pengaturan reservasi outlet ini belum diisi'; end if;

  -- Jam bebas, tapi tetap harus di dalam jam operasional. Menerima 03:00 hanya
  -- akan melahirkan reservasi yang mustahil dilayani, dan yang menanggungnya
  -- staff di lapangan.
  if p_time < s.open_time or p_time >= s.close_time then
    raise exception 'Jam % di luar jam operasional (% - %)',
      to_char(p_time, 'HH24:MI'), to_char(s.open_time, 'HH24:MI'), to_char(s.close_time, 'HH24:MI');
  end if;

  perform 1 from reservation_settings where outlet_id = p_outlet for update;

  v_used := reservation_slot_usage(p_outlet, p_date, p_time);
  if v_used + p_pax > s.max_pax_per_slot then
    raise exception 'Slot % penuh — tersisa % kursi',
      to_char(reservation_slot_of(p_outlet, p_time), 'HH24:MI'),
      greatest(s.max_pax_per_slot - v_used, 0);
  end if;

  insert into reservations (
    business_unit_id, outlet_id, customer_name, phone, email,
    reserve_date, reserve_time, pax, area_id, notes, referral_source,
    source, status, created_by, terms_accepted_at
  ) values (
    v_bu, p_outlet, p_name, p_phone, nullif(p_email, ''),
    p_date, p_time, p_pax, p_area, nullif(p_notes, ''), nullif(p_referral, ''),
    'staff',
    case when s.staff_input_auto_confirm then 'confirmed' else 'pending' end,
    auth.uid(),
    case when p_terms_accepted then now() else null end
  )
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function create_reservation(uuid, text, text, date, time, int, uuid, text, text, text, boolean) to authenticated;
