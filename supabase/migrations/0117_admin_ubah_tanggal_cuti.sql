-- =========================================================
-- Berjaya Hub OMS — 0117
-- Admin boleh MEMPERSEMPIT tanggal cuti saat menyetujuinya.
--
-- =========================================================
-- YANG DIMINTA
-- =========================================================
--
--   "admin bisa mengubah tanggal pengajuan staff, contoh rifki mengajukan
--    tanggal 4 sampai 8, lalu yang di acc 6 sampai 8"
--
-- Sebelum ini persetujuan hanya punya dua jawaban: setuju seluruhnya, atau
-- tolak seluruhnya. Kenyataannya sering di antara keduanya — dan tanpa jalan
-- tengah, yang terjadi adalah admin menyetujui 4–8 lalu memberi tahu lisan
-- "tapi tanggal 4 sama 5 kamu masuk ya". Kesepakatan itu tidak ada di mana
-- pun: jadwal shift (0113) tetap memblokir tanggal 4–5, dan jatah cutinya
-- terpotong 5 hari padahal yang dipakai 3.
--
-- =========================================================
-- HANYA BOLEH DIPERSEMPIT
-- =========================================================
--
-- Rentang yang disetujui WAJIB berada di dalam rentang yang diajukan. 4–8 boleh
-- jadi 6–8, 4–5, atau 5–7 — tapi tidak boleh 6–10.
--
-- Alasannya bukan kerapian: memperluas berarti memberi seseorang cuti pada
-- tanggal yang tidak pernah ia minta. Ia akan mengetahuinya dari pesan
-- keputusan, bukan dari kesepakatan — dan pada tanggal itu ia mungkin sudah
-- terjadwal, sudah berjanji, atau justru berencana masuk.
--
-- Kalau tanggalnya memang harus digeser keluar, jalannya: tolak, lalu staff
-- mengajukan ulang. Lebih lambat, tapi persetujuannya tetap milik orang yang
-- mengajukan.
--
-- =========================================================
-- JEJAKNYA DISIMPAN, BUKAN DITIMPA
-- =========================================================
--
-- `start_date` / `end_date` diubah menjadi yang DISETUJUI — itu yang harus
-- dibaca semua pembaca lain (jadwal shift 0113, jatah cuti, laporan), dan
-- membuat mereka masing-masing menalar "yang mana yang berlaku" adalah cara
-- paling pasti untuk mendapat tiga jawaban berbeda.
--
-- Yang DIAJUKAN disalin ke `*_awal` sebelum ditimpa. Tanpa itu, staff yang
-- mengajukan 4–8 lalu melihat 6–8 akan mengira ia salah mengetik pengajuannya
-- sendiri — dan tidak ada satu pun tempat untuk memastikan.
-- =========================================================

alter table leave_requests add column if not exists start_date_awal date;
alter table leave_requests add column if not exists end_date_awal date;
alter table leave_requests add column if not exists day_count_awal int;

comment on column leave_requests.start_date_awal is
  'Tanggal mulai yang DIAJUKAN staff, disalin saat admin mempersempitnya. NULL = tidak pernah diubah.';

-- ---------------------------------------------------------
-- SATU-SATUNYA PINTU PERSETUJUAN.
--
-- Kebijakan RLS `leave_requests_update_admin` (0013) SENGAJA TIDAK DICABUT:
-- PWA lama yang masih ter-cache di HP admin memakai `.update()` langsung, dan
-- mencabutnya akan membuat tombol Setujui berhenti bekerja tanpa pesan apa pun
-- (PostgREST tidak menganggap penolakan RLS sebagai error pada UPDATE — ia
-- mengembalikan sukses dengan nol baris).
--
-- Jadi jalur lama tetap hidup dan tetap benar; ia hanya tidak bisa mengubah
-- tanggal. Yang baru lewat sini.
-- ---------------------------------------------------------
create or replace function setujui_cuti(
  p_id uuid,
  p_status text,
  p_note text default null,
  p_start date default null,
  p_end date default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_r leave_requests%rowtype;
  v_uid uuid := auth.uid();
  v_start date;
  v_end date;
begin
  select * into v_r from leave_requests where id = p_id;
  if v_r.id is null then raise exception 'Pengajuan cuti tidak ditemukan.'; end if;

  if p_status not in ('approved', 'rejected') then
    raise exception 'Status hanya boleh approved atau rejected.';
  end if;

  -- Wewenangnya persis sama dengan kebijakan RLS-nya (0013), bukan versi yang
  -- mirip. Dua definisi "siapa admin di sini" akan menyimpang, dan yang
  -- menyimpang di jalur `security definer` berarti seseorang bisa menyetujui
  -- cuti di outlet yang bukan wewenangnya.
  if not (
    (v_r.outlet_id is not null and is_admin_of_outlet(v_uid, v_r.outlet_id))
    or (v_r.outlet_id is null and is_bu_admin(v_uid, v_r.business_unit_id))
  ) then
    raise exception 'Kamu tidak berwenang memproses pengajuan cuti ini.';
  end if;

  if v_r.status <> 'pending' then
    raise exception 'Pengajuan ini sudah diproses (status: %).', v_r.status;
  end if;

  -- ------------------------------------------------------
  -- Tanggal hanya berarti saat MENYETUJUI.
  --
  -- "Ditolak, tapi tanggalnya 6–8" bukan keadaan yang punya arti. Diabaikan
  -- diam-diam justru berbahaya kalau suatu saat layar mengirimnya karena
  -- kotaknya kebetulan terisi, jadi dinolkan terang-terangan di sini.
  -- ------------------------------------------------------
  if p_status = 'rejected' then
    v_start := v_r.start_date;
    v_end := v_r.end_date;
  else
    v_start := coalesce(p_start, v_r.start_date);
    v_end := coalesce(p_end, v_r.end_date);

    if v_end < v_start then
      raise exception 'Tanggal selesai tidak boleh sebelum tanggal mulai.';
    end if;

    -- HANYA BOLEH DIPERSEMPIT — lihat alasan panjangnya di kepala berkas.
    if v_start < v_r.start_date or v_end > v_r.end_date then
      raise exception
        'Tanggal yang disetujui harus di dalam rentang yang diajukan (% s/d %). Kalau tanggalnya harus digeser keluar, tolak pengajuannya dan minta staff mengajukan ulang.',
        to_char(v_r.start_date, 'DD Mon YYYY'), to_char(v_r.end_date, 'DD Mon YYYY');
    end if;
  end if;

  update leave_requests
     set status = p_status,
         review_note = nullif(p_note, ''),
         reviewed_by = v_uid,
         reviewed_at = now(),
         start_date = v_start,
         end_date = v_end,
         -- Hari dihitung ULANG dari tanggal yang berlaku, tidak pernah dibawa
         -- dari pengajuannya. Angka hari yang tertinggal di nilai lama akan
         -- memotong jatah cuti sebesar yang TIDAK dipakai — dan salahnya tidak
         -- kelihatan karena baris tanggalnya sendiri sudah benar.
         day_count = (v_end - v_start) + 1,
         -- Jejaknya disalin HANYA kalau memang berubah, dan hanya sekali.
         -- Menyalin selalu akan mengisi kolom "diajukan" untuk pengajuan yang
         -- tidak pernah disentuh siapa pun, dan layar akan menulis
         -- "dipersempit oleh admin" pada persetujuan yang utuh.
         start_date_awal = case
           when v_start <> v_r.start_date or v_end <> v_r.end_date
           then coalesce(v_r.start_date_awal, v_r.start_date) else v_r.start_date_awal end,
         end_date_awal = case
           when v_start <> v_r.start_date or v_end <> v_r.end_date
           then coalesce(v_r.end_date_awal, v_r.end_date) else v_r.end_date_awal end,
         day_count_awal = case
           when v_start <> v_r.start_date or v_end <> v_r.end_date
           then coalesce(v_r.day_count_awal, v_r.day_count) else v_r.day_count_awal end
   where id = p_id;
end;
$$;

revoke all on function setujui_cuti(uuid, text, text, date, date) from public;
grant execute on function setujui_cuti(uuid, text, text, date, date) to authenticated;

comment on function setujui_cuti(uuid, text, text, date, date) is
  'Setujui/tolak cuti. Saat menyetujui, tanggalnya boleh DIPERSEMPIT (wajib di dalam rentang yang diajukan); day_count dihitung ulang dan tanggal aslinya disalin ke kolom *_awal.';

notify pgrst, 'reload schema';
