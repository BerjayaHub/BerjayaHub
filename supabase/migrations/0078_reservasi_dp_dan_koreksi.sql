-- =========================================================
-- 0078 — DP reservasi + koreksi/reschedule oleh admin
--
-- BAGIAN 1: DP
-- S&K menyebut "deposit 50% ... deposit tidak dapat dibatalkan". Kebijakan
-- sebesar itu tidak boleh hidup hanya di teks: kalau nominal dan buktinya tidak
-- tercatat, satu-satunya yang tahu berapa yang sudah masuk adalah orang yang
-- kebetulan menerima transfernya. Saat dia libur, tidak ada yang bisa menjawab.
--
-- BAGIAN 2: KOREKSI
-- Reschedule dan ralat nomor telepon adalah kejadian harian, bukan pengecualian.
-- Tanpa jalur koreksi, admin membatalkan lalu membuat ulang — dan itu memutus
-- kode reservasi yang sudah terlanjur dikirim ke tamu, sekaligus menghapus jejak
-- bahwa perubahannya pernah terjadi.
--
-- Koreksi lewat RPC, bukan UPDATE langsung, karena mengubah tanggal/jam/pax
-- berarti KUOTA HARUS DIHITUNG ULANG. UPDATE biasa akan memindahkan rombongan
-- 30 orang ke slot yang sudah penuh tanpa satu pun penolakan.
-- =========================================================

-- ---------------------------------------------------------
-- (1) Kolom DP
-- ---------------------------------------------------------
alter table reservations add column if not exists deposit_amount numeric(14, 2);
alter table reservations add column if not exists deposit_proof_path text;
alter table reservations add column if not exists deposit_at timestamptz;

comment on column reservations.deposit_amount is
  'Nominal DP yang sudah diterima, rupiah. NULL = belum ada DP.';
comment on column reservations.deposit_proof_path is
  'Path foto bukti transfer di bucket reservation-proofs.';
comment on column reservations.deposit_at is
  'Kapan DP dicatat. Bukan kapan transfernya terjadi — itu ada di fotonya.';

-- ---------------------------------------------------------
-- KEPUTUSAN: DP **TIDAK** masuk modul Kas.
--
-- Ditulis di sini supaya tidak ada yang membangun jembatannya belakangan dengan
-- niat baik. DP masuk ke rekening perusahaan (BCA a.n. CV Anugerah Berkat
-- Berjaya), bukan ke kantong kas seseorang — sementara `cash_entries` seluruhnya
-- dibangun di atas gagasan "uang yang dipegang seorang USER dan jadi tanggung
-- jawabnya".
--
-- Mencatatnya di kas berarti menambah saldo seseorang atas uang yang tidak
-- pernah ada di tangannya, dan saat rekonsiliasi kas dia harus menjelaskan
-- selisih yang bukan urusannya. Angka DP hidup di reservasinya saja.
-- ---------------------------------------------------------

-- ---------------------------------------------------------
-- (2) Bucket bukti transfer
--
-- PRIVAT. Bukti transfer memuat nama dan nomor rekening pengirim; bucket publik
-- berarti siapa pun yang menebak nama filenya bisa membacanya.
--
-- Policy berbasis PREFIX PATH ({outlet_id}/...), bukan berdasarkan kolom di
-- tabel reservasi. Pelajaran dari 0050: izin yang bergantung pada kolom yang
-- baru diisi SETELAH file diunggah membuat file yang baru ditulis tidak bisa
-- dibaca oleh pengunggahnya sendiri.
-- ---------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('reservation-proofs', 'reservation-proofs', false)
on conflict (id) do nothing;

create or replace function reservation_proof_outlet(p_name text)
returns uuid
language sql
immutable
as $$
  select nullif((storage.foldername(p_name))[1], '')::uuid;
$$;

drop policy if exists reservation_proof_insert on storage.objects;
create policy reservation_proof_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'reservation-proofs'
    and has_outlet_scope(auth.uid(), reservation_proof_outlet(name))
  );

drop policy if exists reservation_proof_select on storage.objects;
create policy reservation_proof_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'reservation-proofs'
    and has_outlet_scope(auth.uid(), reservation_proof_outlet(name))
  );

drop policy if exists reservation_proof_update on storage.objects;
create policy reservation_proof_update on storage.objects
  for update to authenticated
  using (bucket_id = 'reservation-proofs' and has_outlet_scope(auth.uid(), reservation_proof_outlet(name)))
  with check (bucket_id = 'reservation-proofs' and has_outlet_scope(auth.uid(), reservation_proof_outlet(name)));

drop policy if exists reservation_proof_delete on storage.objects;
create policy reservation_proof_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'reservation-proofs'
    and is_admin_of_outlet(auth.uid(), reservation_proof_outlet(name))
  );

-- ---------------------------------------------------------
-- (3) Koreksi reservasi — dengan kuota dihitung ulang
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

  -- NULL berarti "jangan diubah". Membedakannya dari "kosongkan" penting:
  -- form yang mengirim seluruh kolom apa adanya akan menghapus catatan hanya
  -- karena kolomnya tidak diisi ulang.
  v_date := coalesce(p_date, r.reserve_date);
  v_time := coalesce(p_time, r.reserve_time);
  v_pax := coalesce(p_pax, r.pax);

  select * into s from reservation_settings where outlet_id = r.outlet_id;
  if found then
    if v_time < s.open_time or v_time >= s.close_time then
      raise exception 'Jam % di luar jam operasional (% - %)',
        to_char(v_time, 'HH24:MI'), to_char(s.open_time, 'HH24:MI'), to_char(s.close_time, 'HH24:MI');
    end if;

    -- Kuota dihitung ulang HANYA kalau slot/tanggal/jumlahnya benar-benar
    -- berubah. Kalau admin cuma membetulkan ejaan nama, memaksa pemeriksaan
    -- kuota bisa menolak reservasi yang sudah sah — slotnya memang penuh, oleh
    -- reservasi ini sendiri.
    if v_date is distinct from r.reserve_date
       or reservation_slot_of(r.outlet_id, v_time) is distinct from reservation_slot_of(r.outlet_id, r.reserve_time)
       or v_pax > r.pax then
      perform 1 from reservation_settings where outlet_id = r.outlet_id for update;
      v_used := reservation_slot_usage(r.outlet_id, v_date, v_time);
      -- Baris ini sendiri dikurangkan kalau ia memang sudah menghuni slot yang
      -- dituju; kalau tidak, ia akan bersaing melawan dirinya sendiri.
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

  update reservations set
    customer_name = coalesce(nullif(btrim(p_name), ''), customer_name),
    phone = coalesce(nullif(btrim(p_phone), ''), phone),
    email = case when p_email is null then email else nullif(btrim(p_email), '') end,
    reserve_date = v_date,
    reserve_time = v_time,
    pax = v_pax,
    area_id = case when p_area is null then area_id else p_area end,
    notes = case when p_notes is null then notes else nullif(btrim(p_notes), '') end,
    deposit_amount = case when p_deposit is null then deposit_amount else p_deposit end,
    deposit_proof_path = coalesce(p_deposit_proof, deposit_proof_path),
    deposit_at = case
                   when p_deposit is not null or p_deposit_proof is not null then now()
                   else deposit_at
                 end
  where id = p_id
  returning * into v_row;

  return v_row;
end;
$$;

comment on function update_reservation(uuid, text, text, text, date, time, int, uuid, text, numeric, text) is
  'Koreksi/reschedule reservasi oleh admin outlet. Kuota dihitung ulang saat tanggal/slot/jumlah tamu berubah. Argumen NULL berarti tidak diubah.';

revoke all on function update_reservation(uuid, text, text, text, date, time, int, uuid, text, numeric, text) from public;
grant execute on function update_reservation(uuid, text, text, text, date, time, int, uuid, text, numeric, text) to authenticated;
