-- =========================================================
-- 0178 — REVISI CUTI YANG SUDAH DIPUTUSKAN
--
--   "di sisi admin portal cuti yang sudah disetujui masih bisa direvisi oleh
--    admin, perihal tanggal dan lain lain"
--
-- `setujui_cuti` (0117) sengaja menolak pengajuan yang sudah diproses, dan
-- membatasi tanggalnya supaya hanya bisa DIPERSEMPIT ke dalam rentang yang
-- diajukan. Dua pembatasan itu benar untuk KEPUTUSAN pertama: admin sedang
-- menjawab permintaan staff, dan jawaban yang melebar keluar permintaannya
-- berarti staff dicatatkan cuti pada hari yang tidak pernah ia minta.
--
-- Revisi lain soalnya. Yang terjadi di lapangan: acaranya digeser, staff
-- ternyata masuk, atau cutinya diperpanjang — dan keadaan itu baru diketahui
-- SESUDAH keputusannya keluar. Tanpa jalur revisi, satu-satunya cara adalah
-- membiarkan catatan yang salah atau menyuruh staff mengajukan ulang cuti
-- untuk hari yang sudah lewat.
--
-- ============ JADI PEMBATASANNYA DILEPAS, DAN JEJAKNYA DIPERKETAT ============
--
-- Ketiganya diminta terbuka:
--
--   tanggal   -> BOLEH keluar dari rentang yang diajukan
--   keputusan -> BOLEH diubah, termasuk membatalkan persetujuan
--   cuti lampau -> BOLEH direvisi
--
-- Yang menyeimbangkannya: alasan WAJIB, dan tiap revisi menyimpan siapa,
-- kapan, dan revisi ke berapa. Hari yang tidak pernah diminta staff bisa
-- tercatat atas namanya — jadi harus selalu ada kalimat yang menjelaskan
-- kenapa, dan nama yang bisa ditanya.
--
-- ============ YANG TIDAK DISENTUH ============
--
-- Kolom `*_awal` TETAP berisi apa yang DIAJUKAN STAFF. Ia bukan "nilai
-- sebelum perubahan terakhir" — ia permintaan aslinya, dan itulah yang perlu
-- dibandingkan orang saat bertanya "kok jadi beda?". Menimpanya dengan nilai
-- sebelum revisi akan menghapus satu-satunya jejak permintaan staff.
-- =========================================================

alter table leave_requests add column if not exists revisi_ke int not null default 0;
alter table leave_requests add column if not exists direvisi_at timestamptz;
alter table leave_requests add column if not exists direvisi_by uuid references user_profiles(id) on delete set null;
alter table leave_requests add column if not exists direvisi_by_nama text;
alter table leave_requests add column if not exists alasan_revisi text;

comment on column leave_requests.revisi_ke is
  'Naik tiap kali direvisi sesudah diputuskan. Dicetak di pesan WhatsApp/Telegram supaya versi lama yang sudah beredar bisa dikenali.';
comment on column leave_requests.direvisi_by_nama is
  'Nama perevisi sebagai TEKS. `direvisi_by` di-set null saat akunnya dihapus; tanpa nama tekstual, jejaknya hilang persis saat orangnya keluar.';

create or replace function revisi_cuti(
  p_id uuid,
  p_status text,
  p_start date,
  p_end date,
  p_type uuid,
  p_note text,
  p_alasan text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_r leave_requests%rowtype;
  v_uid uuid := auth.uid();
  v_type uuid;
  v_bu_type uuid;
  v_nama text;
begin
  if v_uid is null then raise exception 'Harus login'; end if;
  if btrim(coalesce(p_alasan, '')) = '' then
    raise exception 'Alasan revisi wajib diisi — cuti yang sudah diputuskan sedang diubah.';
  end if;

  select * into v_r from leave_requests where id = p_id;
  if v_r.id is null then raise exception 'Pengajuan cuti tidak ditemukan.'; end if;

  -- Wewenangnya PERSIS sama dengan `setujui_cuti` (0117), bukan versi yang
  -- mirip. Dua definisi "siapa admin di sini" akan menyimpang, dan yang
  -- menyimpang di jalur `security definer` berarti seseorang bisa mengubah
  -- cuti di outlet yang bukan wewenangnya.
  if not (
    (v_r.outlet_id is not null and is_admin_of_outlet(v_uid, v_r.outlet_id))
    or (v_r.outlet_id is null and is_bu_admin(v_uid, v_r.business_unit_id))
  ) then
    raise exception 'Kamu tidak berwenang memproses pengajuan cuti ini.';
  end if;

  -- Yang MASIH menunggu keputusan bukan urusan jalur ini: ia belum pernah
  -- diputuskan, jadi tidak ada yang perlu direvisi. Memakai jalur ini untuk
  -- pengajuan pending akan melewati batas "hanya boleh dipersempit" yang
  -- justru menjaga keputusan pertama.
  --
  -- Yang sudah DIBATALKAN tetap boleh direvisi. Versi pertama fungsi ini
  -- menolaknya — dan akibatnya cuti yang salah dibatalkan terkunci selamanya,
  -- tanpa satu pun jalan keluar di layar. Pembatalan adalah keputusan seperti
  -- yang lain, dan keputusan yang keliru harus bisa dibetulkan.
  if v_r.status = 'pending' then
    raise exception 'Pengajuan ini belum diputuskan. Pakai Setujui/Tolak.';
  end if;

  if p_status not in ('approved', 'rejected', 'cancelled') then
    raise exception 'Status hanya boleh approved, rejected, atau cancelled.';
  end if;

  if p_start is null or p_end is null then
    raise exception 'Tanggal mulai & selesai wajib diisi.';
  end if;
  if p_end < p_start then
    raise exception 'Tanggal selesai tidak boleh sebelum tanggal mulai.';
  end if;

  -- Jenis cuti boleh diganti, tapi harus jenis yang memang berlaku di BU ini
  -- (global atau milik BU-nya). Tanpa pemeriksaan ini, satu id yang ditebak
  -- bisa memindahkan pemotongan jatah ke jenis cuti BU lain.
  v_type := coalesce(p_type, v_r.leave_type_id);
  select business_unit_id into v_bu_type from leave_types where id = v_type;
  if not found then
    raise exception 'Jenis cuti tidak dikenal.';
  end if;
  if v_bu_type is not null and v_bu_type <> v_r.business_unit_id then
    raise exception 'Jenis cuti itu milik BU lain.';
  end if;

  select full_name into v_nama from user_profiles where id = v_uid;

  update leave_requests
     set status = p_status,
         leave_type_id = v_type,
         start_date = p_start,
         end_date = p_end,
         -- Dihitung ULANG, tidak pernah dibawa dari nilai lama. Angka hari
         -- yang tertinggal akan memotong jatah cuti sebesar yang tidak
         -- dipakai — dan salahnya tidak kelihatan karena baris tanggalnya
         -- sendiri sudah benar.
         day_count = (p_end - p_start) + 1,
         review_note = nullif(btrim(coalesce(p_note, '')), ''),
         -- Perevisi menjadi pemutus terakhir: dialah yang bisa ditanya soal
         -- isi barisnya sekarang.
         reviewed_by = v_uid,
         reviewed_at = now(),
         revisi_ke = v_r.revisi_ke + 1,
         direvisi_at = now(),
         direvisi_by = v_uid,
         direvisi_by_nama = v_nama,
         alasan_revisi = btrim(p_alasan)
   where id = p_id;

  return jsonb_build_object(
    'revisi_ke', v_r.revisi_ke + 1,
    'status_lama', v_r.status,
    'hari_lama', v_r.day_count,
    'hari_baru', (p_end - p_start) + 1,
    -- Dipakai layar untuk memperingatkan bahwa yang diubah adalah hari yang
    -- sudah berlalu — jatah cutinya ikut berubah surut.
    'sudah_lewat', v_r.end_date < (now() at time zone 'Asia/Jakarta')::date
  );
end;
$$;

revoke all on function revisi_cuti(uuid, text, date, date, uuid, text, text) from public;
grant execute on function revisi_cuti(uuid, text, date, date, uuid, text, text) to authenticated;

comment on function revisi_cuti(uuid, text, date, date, uuid, text, text) is
  'Revisi cuti yang SUDAH diputuskan: tanggal bebas (tidak dibatasi rentang pengajuan), status boleh diubah termasuk cancelled, alasan wajib, dan jejaknya disimpan di revisi_ke/direvisi_*.';

notify pgrst, 'reload schema';
