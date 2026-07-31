-- =========================================================
-- Berjaya Hub OMS — 0056
-- Staff (bukan admin) boleh MENANDAI tamu sudah check-in.
--
-- MASALAHNYA: `reservations_update_admin` hanya mengizinkan admin outlet, jadi
-- staff resepsionis tidak bisa menandai apa pun. Tapi melonggarkan policy UPDATE
-- untuk staff SALAH — RLS bekerja per BARIS, bukan per KOLOM. Sekali staff boleh
-- meng-update baris booking, dia juga boleh mengubah tanggal menginap, tipe
-- kamar, nama tamu, bahkan membatalkan booking. Tidak ada cara menahannya di
-- policy tanpa trigger pembanding OLD/NEW yang rumit dan mudah salah.
--
-- PERBAIKAN: satu RPC security-definer yang HANYA bisa melakukan satu hal —
-- memindahkan status `confirmed` -> `checked_in`, mengisi nomor kamar, waktu,
-- dan siapa yang menandainya. Tidak ada kolom lain yang bisa disentuh, karena
-- memang tidak ditulis di dalamnya. Izinnya jadi sempit dan bisa dibaca sekali
-- lihat, bukan disimpulkan dari gabungan beberapa policy.
--
-- Check-OUT sengaja TIDAK diberikan ke staff. Check-out melepas kamar sehingga
-- bisa dipesan orang lain; kalau salah tekan, tamu yang masih menginap
-- kamarnya bisa terjual. Itu keputusan yang pantas ditahan di admin.
--
-- Idempotent — aman dijalankan ulang.
-- =========================================================

alter table reservations add column if not exists checked_in_by uuid references user_profiles(id) on delete set null;
alter table reservations add column if not exists checked_out_by uuid references user_profiles(id) on delete set null;

comment on column reservations.checked_in_by is
  'Siapa yang menandai tamu check-in. Diisi RPC staff_check_in_booking / update admin.';

create or replace function staff_check_in_booking(p_reservation uuid, p_room_no text default null)
returns table (id uuid, status text, room_no text, checked_in_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  r reservations%rowtype;
begin
  select * into r from reservations where reservations.id = p_reservation;
  if not found then
    raise exception 'Booking tidak ditemukan.';
  end if;

  if r.mode <> 'hotel' then
    raise exception 'Hanya booking hotel yang punya check-in.';
  end if;

  -- Staff cukup punya scope di outletnya — tidak perlu jadi admin.
  if not has_outlet_scope(auth.uid(), r.outlet_id) then
    raise exception 'Kamu tidak terdaftar di outlet booking ini.';
  end if;

  -- Hanya satu arah: confirmed -> checked_in.
  --
  -- Kalau sudah checked_in, JANGAN lempar error — staff yang menekan dua kali
  -- (atau dua staff bersamaan) tidak sedang melakukan kesalahan, dan pesan
  -- merah untuk hal yang sebenarnya sudah beres cuma membuat orang ragu.
  -- Kembalikan saja keadaannya apa adanya.
  if r.status = 'checked_in' then
    return query select r.id, r.status, r.room_no, r.checked_in_at;
    return;
  end if;

  if r.status <> 'confirmed' then
    raise exception 'Booking berstatus "%" tidak bisa di-check-in.', r.status;
  end if;

  update reservations
  set status = 'checked_in',
      room_no = coalesce(nullif(btrim(p_room_no), ''), reservations.room_no),
      checked_in_at = now(),
      checked_in_by = auth.uid()
  where reservations.id = p_reservation;

  return query
  select reservations.id, reservations.status, reservations.room_no, reservations.checked_in_at
  from reservations where reservations.id = p_reservation;
end;
$$;

revoke all on function staff_check_in_booking(uuid, text) from public;
grant execute on function staff_check_in_booking(uuid, text) to authenticated;

comment on function staff_check_in_booking(uuid, text) is
  'Staff outlet menandai tamu check-in. HANYA memindahkan confirmed -> checked_in + nomor kamar. Sengaja tidak bisa mengubah tanggal/tipe/nama, dan tidak bisa check-out.';
