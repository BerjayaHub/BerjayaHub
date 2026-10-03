-- ============================================================
-- 0156 — PRESENSI YANG TERJADI DI HARI CUTI, DITANDAI.
--
--   "apakah shift dan cuti sudah terkoneksi dengan presensi?"
--
-- ============ YANG SUDAH & YANG BELUM ============
--
--   shift ↔ presensi   TERHUBUNG. `late_status` dihitung saat clock in dari
--                      `shift_schedules` (0034), bisa dinilai ulang (0074),
--                      berjejak (0106), dan staff dikabari (0107).
--   shift ↔ cuti       TERHUBUNG. Sel jadwal menampilkan cuti dan menguncinya
--                      (0113) — cuti dibaca saat menggambar, tidak disalin.
--   cuti  ↔ presensi   HAMPIR TIDAK ADA. Dua titik saja, keduanya satu arah:
--                      reminder clock-in melewati yang sedang cuti, dan
--                      laporan rekap punya kolom "Cuti".
--
-- Sampai berkas ini, TIDAK ADA satu pun yang menghubungkan `leave_requests`
-- dengan `attendance_records`. Akibat yang paling mudah luput:
--
--   Staff yang cutinya disetujui lalu tetap masuk akan terhitung HADIR di
--   kolom Hadir (dari attendance_records) DAN terhitung CUTI di kolom Cuti
--   (dari leave_requests), untuk hari yang sama.
--
-- Dua kolom itu dihitung dari dua sumber yang tidak pernah saling melihat.
-- Angkanya wajar dibaca, tidak melempar apa pun, dan baru ketahuan kalau ada
-- yang menjumlahkan hari kerja seseorang dan hasilnya lebih banyak daripada
-- jumlah hari di bulan itu.
--
-- ============ YANG TIDAK DILAKUKAN BERKAS INI ============
--
-- Clock-in TIDAK ditolak. Ada kalanya orang yang sedang cuti memang dipanggil
-- masuk, dan menolaknya berarti memaksa dia absen lewat jalan lain — titip
-- akun, atau minta admin mengoreksi belakangan. Dua-duanya menghasilkan
-- catatan yang lebih tidak bisa dipercaya daripada presensi yang ditandai.
--
-- `late_status` juga TIDAK diberi nilai baru. Ia potret penilaian terhadap
-- JADWAL, dan menyelipkan 'cuti' ke sana akan membuat setiap pembacanya —
-- laporan, rekap, lencana — harus diperiksa ulang satu per satu. Cuti dicatat
-- di kolomnya sendiri.
-- ============================================================

-- ---------------------------------------------------------
-- Cuti mana yang sedang berlaku saat presensi ini dibuat.
--
-- `uuid`, bukan boolean: "sedang cuti" tidak cukup untuk menjawab pertanyaan
-- yang pasti muncul sesudahnya — cuti yang mana, jenisnya apa, siapa yang
-- menyetujui. Boolean memaksa orang menebaknya dari tanggal.
-- ---------------------------------------------------------
alter table attendance_records
  add column if not exists cuti_request_id uuid references leave_requests(id) on delete set null;

-- Indeks parsial: yang dicari selalu "siapa saja yang masuk saat cuti", bukan
-- "berapa yang tidak". Baris bernilai NULL adalah mayoritas mutlak dan tidak
-- perlu ikut diindeks.
create index if not exists idx_attendance_cuti
  on attendance_records(cuti_request_id)
  where cuti_request_id is not null;

comment on column attendance_records.cuti_request_id is
  'Pengajuan cuti yang SUDAH DISETUJUI dan mencakup tanggal clock-in ini. Diisi trigger saat baris dibuat, bukan oleh layar. NULL = tidak sedang cuti.';

-- ---------------------------------------------------------
-- PENANDANYA DIISI DATABASE, BUKAN LAYAR.
--
-- ============ KENAPA BUKAN DIKIRIM DARI APLIKASI ============
--
-- Staff App memang akan memperingatkan sebelum clock-in, tapi peringatan itu
-- hanya menjaga ORANGNYA — bukan DATANYA. Clock-in adalah `insert` langsung ke
-- `attendance_records`, dan ada beberapa jalan masuk yang tidak lewat layar
-- itu: koreksi presensi oleh admin, PWA versi lama yang masih di cache HP, dan
-- siapa pun yang memanggil PostgREST sendiri.
--
-- Kalau penandanya dikirim layar, setiap jalan itu menghasilkan baris
-- ber-`cuti_request_id` NULL — yang artinya "tidak sedang cuti", persis sama
-- dengan baris yang memang tidak sedang cuti. Tandanya jadi tidak bisa
-- dipercaya untuk hal yang justru menjadi alasannya ada.
--
-- Di trigger, satu-satunya cara menghindarinya adalah tidak membuat barisnya
-- sama sekali.
--
-- ============ TANGGALNYA WIB, BUKAN UTC ============
--
-- `clock_in_at` adalah `timestamptz`, dan `::date` atasnya memakai zona waktu
-- server — yaitu UTC. Clock-in pukul 06.30 WIB berarti 23.30 UTC HARI
-- SEBELUMNYA, jadi cuti yang berlaku hari itu tidak akan ketemu, dan shift
-- pagi — satu-satunya shift yang paling sering bertabrakan dengan cuti —
-- justru yang paling sering luput.
--
-- Kesalahannya senyap sempurna: barisnya tetap tersimpan, tandanya saja yang
-- kosong.
-- ---------------------------------------------------------
create or replace function tandai_presensi_saat_cuti()
returns trigger
language plpgsql
-- `security definer`: trigger ini membaca `leave_requests` milik orang yang
-- barisnya sedang dibuat. Untuk clock-in biasa itu dirinya sendiri dan RLS
-- mengizinkan — tapi untuk koreksi presensi oleh admin, pemanggilnya BUKAN
-- pemilik cutinya, dan tanpa definer tandanya diam-diam kosong di situ.
security definer
set search_path = public
as $$
declare
  v_tanggal date;
begin
  -- Nilai yang sudah diisi pemanggil TIDAK ditimpa — supaya koreksi manual
  -- oleh admin (mis. membetulkan tanda yang salah) tidak dikembalikan lagi
  -- oleh trigger pada setiap penulisan.
  if new.cuti_request_id is not null then
    return new;
  end if;

  v_tanggal := (coalesce(new.clock_in_at, now()) at time zone 'Asia/Jakarta')::date;

  select lr.id into new.cuti_request_id
    from leave_requests lr
   where lr.user_id = new.user_id
     and lr.status = 'approved'
     and lr.start_date <= v_tanggal
     and lr.end_date >= v_tanggal
   -- Kalau ada lebih dari satu (mis. dua pengajuan bersebelahan yang
   -- tanggalnya bersinggungan), yang diambil yang paling dulu mulai. Pilihan
   -- apa pun di sini sah; yang tidak sah adalah membiarkannya tidak
   -- ditentukan, karena baris yang sama bisa menunjuk cuti berbeda tiap kali.
   order by lr.start_date, lr.id
   limit 1;

  return new;
end;
$$;

revoke all on function tandai_presensi_saat_cuti() from public;

drop trigger if exists trg_tandai_presensi_saat_cuti on attendance_records;

create trigger trg_tandai_presensi_saat_cuti
  before insert on attendance_records
  for each row
  execute function tandai_presensi_saat_cuti();

comment on function tandai_presensi_saat_cuti() is
  'Mengisi attendance_records.cuti_request_id dari cuti yang disetujui pada tanggal WIB clock-in. Berjalan di DATABASE supaya tandanya tetap benar untuk clock-in yang tidak lewat Staff App. Tidak pernah menimpa nilai yang sudah diisi.';

notify pgrst, 'reload schema';
