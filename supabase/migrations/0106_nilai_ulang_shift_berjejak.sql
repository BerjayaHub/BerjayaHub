-- =========================================================
-- Berjaya Hub OMS — 0106
-- Menilai ULANG presensi yang SUDAH pernah dinilai — dengan jejak.
--
-- =========================================================
-- MASALAH YANG DILAPORKAN
-- =========================================================
--
--   Rabu  : dijadwalkan shift pagi, staff clock in -> tercatat TERLAMBAT 140 menit
--   Jumat : jadwal Rabu-nya dikoreksi (ternyata shift siang)
--   Hasil : keterangan terlambatnya TIDAK berubah
--
-- Itu bukan kerusakan. `late_status` memang potret, dan `hitung_ulang_status_shift`
-- (0074) SENGAJA melewati baris yang sudah pernah dinilai:
--
--     if not p_paksa and r.late_status is not null and r.late_status <> 'no_schedule'
--
-- Parameter `p_paksa` sudah ada sejak 0074, tapi tidak pernah dipasang ke layar.
-- Jadi jalan keluarnya ada; yang tidak ada adalah pintunya.
--
-- =========================================================
-- KENAPA TIDAK CUKUP "PASANG SAJA TOMBOLNYA"
-- =========================================================
--
-- Menilai ulang berarti MENGUBAH PENILAIAN MASA LALU. Angka 140 menit itu
-- mungkin sudah dipakai memotong tunjangan, sudah dibahas dengan orangnya, atau
-- sudah masuk laporan bulanan yang dicetak.
--
-- Kalau ia sekadar ditimpa, pertanyaan "kok bulan lalu beda?" tidak akan bisa
-- dijawab siapa pun — dan yang paling merugikan, tidak akan ada cara
-- membedakan koreksi yang sah dari kesalahan yang tidak sengaja.
--
-- Maka penilaian aslinya DISIMPAN, tidak dibuang:
--
--   late_status_awal / late_menit_awal   potret pertama, diisi SEKALI seumur
--                                        hidup baris itu dan tidak pernah
--                                        ditimpa lagi
--   late_dinilai_ulang_at / _by / _alasan  siapa, kapan, kenapa
--
-- Dengan begitu rekap bisa menampilkan "Terlambat 12 mnt (dulu 140 mnt — dinilai
-- ulang oleh Budi, 15 Agu: jadwal Rabu dikoreksi)". Riwayatnya bertambah, bukan
-- tergantikan — pola yang sama dengan pergerakan stok di 0084/0092/0101.
--
-- =========================================================
-- YANG SENGAJA TIDAK DIUBAH
-- =========================================================
--
-- Perilaku BAWAAN `hitung_ulang_status_shift(id)` tetap sama persis: hanya
-- menyentuh baris yang belum pernah dinilai. Tombol ↻ yang sudah dipakai
-- sehari-hari tidak berubah artinya sedikit pun.
--
-- Yang baru adalah jalur terpisah yang harus diminta dengan sengaja, dan
-- menuntut ALASAN. Alasan yang wajib membuat orang berhenti sejenak — dan
-- meninggalkan kalimat yang bisa dibaca enam bulan kemudian.
-- =========================================================

-- ---------------------------------------------------------
-- (1) Kolom jejak
-- ---------------------------------------------------------
alter table attendance_records add column if not exists late_status_awal text;
alter table attendance_records add column if not exists late_menit_awal int;
alter table attendance_records add column if not exists late_dinilai_ulang_at timestamptz;
alter table attendance_records add column if not exists late_dinilai_ulang_by uuid references user_profiles(id) on delete set null;
alter table attendance_records add column if not exists late_dinilai_ulang_alasan text;

create index if not exists idx_attendance_dinilai_ulang
  on attendance_records(outlet_id, late_dinilai_ulang_at)
  where late_dinilai_ulang_at is not null;

-- ---------------------------------------------------------
-- (2) NILAI ULANG SATU BARIS — memaksa, dan mencatat jejaknya.
--
-- Ditulis sebagai fungsi TERSENDIRI, bukan menambah parameter ke fungsi lama.
-- Menumpang di `hitung_ulang_status_shift(id, paksa)` berarti satu tombol yang
-- salah klik bisa menimpa penilaian tanpa alasan tercatat — dan pemanggil lama
-- yang mengirim `true` tidak akan pernah tahu ia melewatkan jejaknya.
-- ---------------------------------------------------------
create or replace function nilai_ulang_status_shift(p_record uuid, p_alasan text)
returns table (status text, menit int, nama_shift text, status_lama text, menit_lama int)
language plpgsql
security definer
set search_path = public
as $$
declare
  r attendance_records%rowtype;
  v_hasil record;
begin
  if auth.uid() is null then raise exception 'Harus login'; end if;

  if p_alasan is null or btrim(p_alasan) = '' then
    raise exception 'Alasan wajib diisi. Menilai ulang mengubah penilaian yang sudah terjadi, jadi harus ada keterangan yang bisa dibaca nanti.';
  end if;

  select * into r from attendance_records where id = p_record;
  if not found then raise exception 'Presensi tidak ditemukan.'; end if;

  -- Wewenangnya sama persis dengan `hitung_ulang_status_shift`. Kalau berbeda,
  -- salah satunya akan jadi pintu belakang bagi yang lain.
  if not is_admin_of_outlet(auth.uid(), r.outlet_id)
     and not is_admin_of_outlet(auth.uid(), coalesce(r.nbm_outlet_id, r.outlet_id)) then
    raise exception 'Hanya admin outlet terkait yang bisa menilai ulang presensi ini.';
  end if;

  -- POTRET PERTAMA DISIMPAN SEKALI SEUMUR HIDUP BARIS INI.
  --
  -- `is null` di sini penting: menilai ulang untuk kedua kalinya tidak boleh
  -- menimpa `late_status_awal` dengan hasil penilaian ulang yang pertama.
  -- Kalau ditimpa, penilaian ASLI hilang setelah dua kali koreksi — dan yang
  -- tersisa justru angka yang paling tidak berarti.
  if r.late_status_awal is null then
    update attendance_records
       set late_status_awal = r.late_status,
           late_menit_awal = r.late_minutes
     where id = p_record;
  end if;

  select * into v_hasil from hitung_ulang_status_shift(p_record, true);

  update attendance_records
     set late_dinilai_ulang_at = now(),
         late_dinilai_ulang_by = auth.uid(),
         late_dinilai_ulang_alasan = btrim(p_alasan)
   where id = p_record;

  return query
    select v_hasil.status, v_hasil.menit, v_hasil.nama_shift,
           coalesce(r.late_status_awal, r.late_status),
           coalesce(r.late_menit_awal, r.late_minutes);
end;
$$;

-- ---------------------------------------------------------
-- (3) NILAI ULANG SATU RENTANG — untuk koreksi jadwal seminggu penuh.
--
-- Mengembalikan tiga angka, bukan satu: yang diproses, yang benar-benar
-- BERUBAH, dan yang tetap sama. "20 diproses" saja akan terbaca sebagai
-- keberhasilan padahal bisa jadi tidak satu pun berubah.
-- ---------------------------------------------------------
create or replace function nilai_ulang_status_shift_massal(
  p_from date,
  p_to date,
  p_outlet uuid,
  p_alasan text
)
returns table (diproses int, berubah int, tetap int)
language plpgsql
security definer
set search_path = public
as $$
declare
  rec record;
  v_hasil record;
  v_diproses int := 0;
  v_berubah int := 0;
  v_tetap int := 0;
  v_lama text;
  v_lama_menit int;
begin
  if auth.uid() is null then raise exception 'Harus login'; end if;
  if p_alasan is null or btrim(p_alasan) = '' then
    raise exception 'Alasan wajib diisi.';
  end if;
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'Rentang tanggalnya belum benar.';
  end if;

  -- Rentang dibatasi. Tanpa batas, satu klik bisa menilai ulang setahun penuh —
  -- dan pembatalannya harus dikerjakan satu per satu.
  if p_to - p_from > 62 then
    raise exception 'Rentangnya terlalu lebar (maksimal 62 hari). Persempit dulu.';
  end if;

  for rec in
    select ar.id, ar.late_status, ar.late_minutes
      from attendance_records ar
     where (ar.clock_in_at at time zone 'Asia/Jakarta')::date between p_from and p_to
       and (p_outlet is null or coalesce(ar.nbm_outlet_id, ar.outlet_id) = p_outlet or ar.outlet_id = p_outlet)
       and (
         is_admin_of_outlet(auth.uid(), ar.outlet_id)
         or is_admin_of_outlet(auth.uid(), coalesce(ar.nbm_outlet_id, ar.outlet_id))
       )
  loop
    v_lama := rec.late_status;
    v_lama_menit := rec.late_minutes;

    select * into v_hasil from nilai_ulang_status_shift(rec.id, p_alasan);
    v_diproses := v_diproses + 1;

    if v_hasil.status is distinct from v_lama
       or coalesce(v_hasil.menit, -1) is distinct from coalesce(v_lama_menit, -1) then
      v_berubah := v_berubah + 1;
    else
      v_tetap := v_tetap + 1;
    end if;
  end loop;

  return query select v_diproses, v_berubah, v_tetap;
end;
$$;

revoke all on function nilai_ulang_status_shift(uuid, text) from public;
revoke all on function nilai_ulang_status_shift_massal(date, date, uuid, text) from public;
grant execute on function nilai_ulang_status_shift(uuid, text) to authenticated;
grant execute on function nilai_ulang_status_shift_massal(date, date, uuid, text) to authenticated;

comment on function nilai_ulang_status_shift(uuid, text) is
  'Nilai ULANG presensi yang sudah pernah dinilai, memakai jadwal shift yang berlaku sekarang. Penilaian aslinya disimpan di late_status_awal/late_menit_awal dan tidak pernah ditimpa. Alasan wajib.';

notify pgrst, 'reload schema';
