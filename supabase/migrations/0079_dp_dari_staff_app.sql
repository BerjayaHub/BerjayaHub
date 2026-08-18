-- =========================================================
-- 0079 — DP bisa dicatat dari Staff App
--
-- 0078 hanya memberi jalur DP lewat Admin Portal. Tapi yang menerima bukti
-- transfer di WhatsApp adalah staff yang mengangkat teleponnya, bukan admin.
-- Selama jalurnya cuma di admin, buktinya berhenti di galeri HP staff — dan
-- itu persis keadaan yang mau dihindari 0078.
--
-- KENAPA RPC TERPISAH, BUKAN MENAMBAH ARGUMEN DI `create_reservation`:
-- path foto memuat ID reservasinya, jadi fotonya baru bisa diunggah SETELAH
-- barisnya ada. Menaruh nominal di create_reservation dan path di tempat lain
-- membuat keduanya bisa tersimpan setengah-setengah. Satu RPC untuk nominal +
-- bukti sekaligus membuat "DP tercatat" berarti satu hal saja.
--
-- PEMBAGIAN WEWENANG: staff MENCATAT, admin MENGOREKSI.
-- Staff hanya boleh mengisi DP yang masih kosong, dan hanya di reservasi yang
-- dia buat sendiri (atau yang datang dari website — itu tidak punya pembuat).
-- Membiarkan staff menimpa nominal yang sudah tercatat
-- berarti angka DP bisa turun tanpa jejak — dan yang menanggung selisihnya
-- adalah orang yang menerima uangnya.
-- =========================================================

-- ---------------------------------------------------------
-- (1) Siapa yang mencatat DP-nya
--
-- `deposit_at` menjawab "kapan", tapi pertanyaan yang benar-benar muncul saat
-- angkanya diragukan adalah "siapa". Tanpa kolom ini jawabannya harus dicari
-- lewat ingatan orang.
-- ---------------------------------------------------------
-- user_profiles, BUKAN auth.users — lihat catatan di 0086.
alter table reservations add column if not exists deposit_by uuid references user_profiles(id) on delete set null;

comment on column reservations.deposit_by is
  'Siapa yang mencatat DP-nya. NULL = dicatat sebelum kolom ini ada (migration 0079).';

-- ---------------------------------------------------------
-- (2) RPC: catat DP
-- ---------------------------------------------------------
create or replace function catat_dp_reservasi(
  p_id uuid,
  p_deposit numeric default null,
  p_proof text default null
)
returns reservations
language plpgsql
security definer
set search_path = public
as $$
declare
  r reservations;
  v_admin boolean;
  v_row reservations;
begin
  select * into r from reservations where id = p_id;
  if not found then raise exception 'Reservasi tidak ditemukan.'; end if;

  if p_deposit is null and coalesce(btrim(p_proof), '') = '' then
    raise exception 'Tidak ada yang dicatat — isi nominal DP atau lampirkan buktinya.';
  end if;
  -- Menghapus DP bukan pekerjaan RPC ini; itu koreksi, dan koreksi lewat
  -- `update_reservation` yang hanya bisa dipanggil admin.
  if p_deposit is not null and p_deposit <= 0 then
    raise exception 'Nominal DP harus lebih dari 0.';
  end if;

  v_admin := is_admin_of_outlet(auth.uid(), r.outlet_id);

  if not v_admin then
    -- `created_by IS NULL` = reservasi dari WEBSITE. Tidak ada pembuatnya, jadi
    -- "hanya pembuatnya" tidak bisa jadi pagar di sini — kalau dipaksakan, DP
    -- dari tamu yang memesan lewat website tidak akan pernah bisa dicatat siapa
    -- pun kecuali admin, padahal yang menerima transfernya tetap staff.
    if r.created_by is not null and r.created_by is distinct from auth.uid() then
      raise exception 'DP hanya bisa dicatat oleh yang membuat reservasinya, atau oleh admin outlet.';
    end if;
    if not has_outlet_scope(auth.uid(), r.outlet_id) then
      raise exception 'Outlet ini di luar jangkauanmu.';
    end if;
    -- Sengaja: mengisi yang kosong itu MENCATAT, mengubah yang sudah terisi itu
    -- MENGOREKSI. Yang kedua meninggalkan pertanyaan "kenapa berubah", dan
    -- pertanyaan itu harus berhenti di admin.
    if r.deposit_amount is not null or r.deposit_proof_path is not null then
      raise exception 'DP reservasi ini sudah tercatat. Perubahan DP dilakukan admin lewat Admin Portal.';
    end if;
  end if;

  update reservations set
    deposit_amount = case when p_deposit is null then deposit_amount else p_deposit end,
    deposit_proof_path = coalesce(p_proof, deposit_proof_path),
    deposit_at = now(),
    deposit_by = auth.uid()
  where id = p_id
  returning * into v_row;

  return v_row;
end;
$$;

comment on function catat_dp_reservasi(uuid, numeric, text) is
  'Catat DP + path bukti transfer. Staff hanya boleh mengisi yang masih kosong, di reservasi buatannya sendiri atau yang datang dari website; admin outlet bebas mengoreksi.';

revoke all on function catat_dp_reservasi(uuid, numeric, text) from public;
grant execute on function catat_dp_reservasi(uuid, numeric, text) to authenticated;

-- ---------------------------------------------------------
-- (3) update_reservation ikut mencatat pencatatnya
--
-- Tanda tangannya tidak berubah, jadi tidak ada pemanggil yang perlu diubah.
-- ---------------------------------------------------------
create or replace function update_reservation(
  p_id uuid,
  p_name text default null,
  p_phone text default null,
  p_email text default null,
  p_date date default null,
  p_time time default null,
  p_pax int default null,
  p_area uuid default null,
  p_notes text default null,
  p_deposit numeric default null,
  p_deposit_proof text default null
)
returns reservations
language plpgsql
security definer
set search_path = public
as $$
declare
  r reservations;
  s reservation_settings%rowtype;
  v_date date;
  v_time time;
  v_pax int;
  v_used int;
  v_row reservations;
begin
  select * into r from reservations where id = p_id;
  if not found then raise exception 'Reservasi tidak ditemukan.'; end if;

  if not is_admin_of_outlet(auth.uid(), r.outlet_id) then
    raise exception 'Hanya admin outlet ini yang bisa mengoreksi reservasi.';
  end if;

  v_date := coalesce(p_date, r.reserve_date);
  v_time := coalesce(p_time, r.reserve_time);
  v_pax := coalesce(p_pax, r.pax);

  select * into s from reservation_settings where outlet_id = r.outlet_id;
  if found then
    if v_time < s.open_time or v_time >= s.close_time then
      raise exception 'Jam % di luar jam operasional (% - %)',
        to_char(v_time, 'HH24:MI'), to_char(s.open_time, 'HH24:MI'), to_char(s.close_time, 'HH24:MI');
    end if;

    if v_date is distinct from r.reserve_date
       or reservation_slot_of(r.outlet_id, v_time) is distinct from reservation_slot_of(r.outlet_id, r.reserve_time)
       or v_pax > r.pax then
      perform 1 from reservation_settings where outlet_id = r.outlet_id for update;
      v_used := reservation_slot_usage(r.outlet_id, v_date, v_time);
      if v_date = r.reserve_date
         and reservation_slot_of(r.outlet_id, v_time) = reservation_slot_of(r.outlet_id, r.reserve_time)
         and r.status in ('pending', 'confirmed') then
        v_used := v_used - r.pax;
      end if;
      if v_used + v_pax > s.max_pax_per_slot then
        raise exception 'Slot % penuh — tersisa % kursi',
          to_char(reservation_slot_of(r.outlet_id, v_time), 'HH24:MI'),
          greatest(s.max_pax_per_slot - v_used, 0);
      end if;
    end if;
  end if;

  -- p_deposit: NULL = jangan diubah, 0 = HAPUS, > 0 = nominalnya.
  --
  -- Tanpa arti "hapus", DP yang tercatat di reservasi yang keliru tidak akan
  -- pernah bisa dicabut — hanya bisa diganti angka lain, dan angka apa pun di
  -- situ tetap salah. Di form koreksi kolomnya sudah terisi nilai lama, jadi
  -- mengosongkannya memang niat menghapus, bukan sekadar tidak mengisi.
  update reservations set
    customer_name = coalesce(nullif(btrim(p_name), ''), customer_name),
    phone = coalesce(nullif(btrim(p_phone), ''), phone),
    email = case when p_email is null then email else nullif(btrim(p_email), '') end,
    reserve_date = v_date,
    reserve_time = v_time,
    pax = v_pax,
    area_id = case when p_area is null then area_id else p_area end,
    notes = case when p_notes is null then notes else nullif(btrim(p_notes), '') end,
    deposit_amount = case
                       when p_deposit is null then deposit_amount
                       when p_deposit <= 0 then null
                       else p_deposit
                     end,
    -- Bukti ikut dilepas saat DP dihapus: bukti transfer yang menempel pada
    -- reservasi yang tidak punya DP hanya akan membingungkan yang membacanya
    -- nanti. Filenya sendiri tertimpa sendiri kalau DP dicatat ulang, karena
    -- path-nya {outlet}/{reservation_id} dan selalu sama.
    deposit_proof_path = case
                           when p_deposit_proof is not null then p_deposit_proof
                           when p_deposit is not null and p_deposit <= 0 then null
                           else deposit_proof_path
                         end,
    deposit_at = case
                   when p_deposit is not null and p_deposit <= 0 and p_deposit_proof is null then null
                   when p_deposit is not null or p_deposit_proof is not null then now()
                   else deposit_at
                 end,
    deposit_by = case
                   when p_deposit is not null and p_deposit <= 0 and p_deposit_proof is null then null
                   when p_deposit is not null or p_deposit_proof is not null then auth.uid()
                   else deposit_by
                 end
  where id = p_id
  returning * into v_row;

  return v_row;
end;
$$;

-- ---------------------------------------------------------
-- (4) Menimpa bukti transfer: hanya pengunggahnya sendiri, atau admin
--
-- Policy 0078 mengizinkan siapa pun yang punya jangkauan outlet untuk MENIMPA
-- file yang sudah ada. Nama filenya bisa ditebak ({outlet_id}/{reservation_id}),
-- jadi bukti yang sudah diperiksa admin bisa diganti oleh siapa saja di outlet
-- itu tanpa satu pun jejak.
--
-- Pengunggahnya sendiri tetap boleh menimpa — foto buram atau salah ambil itu
-- lumrah, dan tanpa jalur perbaikan orang akan berhenti mengunggah sama sekali.
-- ---------------------------------------------------------
drop policy if exists reservation_proof_update on storage.objects;
create policy reservation_proof_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'reservation-proofs'
    and (owner = auth.uid() or is_admin_of_outlet(auth.uid(), reservation_proof_outlet(name)))
  )
  with check (
    bucket_id = 'reservation-proofs'
    and (owner = auth.uid() or is_admin_of_outlet(auth.uid(), reservation_proof_outlet(name)))
  );
