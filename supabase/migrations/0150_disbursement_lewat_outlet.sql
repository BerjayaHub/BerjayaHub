-- ============================================================
-- 0150 — DISBURSEMENT DICARI LEWAT OUTLET, BUKAN business_unit_id.
--
-- ============ KESALAHAN YANG DIPERBAIKI ============
--
-- `0149` menyaring kas keluar dengan `business_unit_id`, dan menaruh
-- `is_bu_admin(v_uid, c.business_unit_id)` sebagai penjaga wewenangnya.
--
-- Kolom itu **DEPRECATED sejak 0040**, dan komentarnya di sana mengatakannya
-- dengan jelas:
--
--     'DEPRECATED sejak 0040 (kas ikut user). Hanya terisi pada baris lama,
--      untuk audit riwayat.'
--
-- Entri kas yang dibuat sejak itu meninggalkannya NULL. Akibatnya:
--
--   * layar ekspor selalu berbunyi "Tidak ada kas keluar baru di rentang itu",
--     padahal Mutasi Kas di sebelahnya menampilkan entrinya dengan jelas;
--   * `is_bu_admin(v_uid, NULL)` bernilai false, jadi `tandai_kas_esb` dan
--     `batalkan_tanda_kas_esb` mengembalikan 0 tanpa menyentuh apa pun.
--
-- Tidak satu pun dari keduanya melempar galat. Yang pertama terlihat seperti
-- "memang belum ada datanya"; yang kedua akan terlihat seperti "berkasnya
-- terunduh tapi penandaannya gagal" — di kemudian hari, setelah dokumen yang
-- sama terunggah dua kali.
--
-- ============ SUMBU YANG BENAR ============
--
-- `outlet_id`. Sejak `0063` ia bukan lagi peninggalan: ia **outlet peruntukan**
-- kas keluar ("uang ini dibelanjakan untuk outlet mana"), dan constraint
-- `cash_entries_outlet_wajib_saat_keluar` mewajibkannya. Kas keluar tanpa
-- outlet tidak bisa dicatat sama sekali.
--
-- Dari outlet, BU-nya diturunkan lewat `is_admin_of_outlet` (0003) — fungsi
-- yang memang sudah dipakai `rincian_mutasi_kas` (0063) untuk pertanyaan yang
-- persis sama. Satu aturan wewenang untuk outlet, bukan dua.
-- ============================================================

-- ---------------------------------------------------------
-- (1) Indeksnya menyaring kolom yang selalu NULL.
--
-- `idx_kas_belum_esb` dibuat atas `(business_unit_id, entry_date)` — untuk
-- kolom yang tidak pernah terisi, itu indeks yang tidak pernah menolong siapa
-- pun. Diganti ke sumbu yang sungguh dipakai layarnya.
-- ---------------------------------------------------------
drop index if exists idx_kas_belum_esb;

create index if not exists idx_kas_belum_esb on cash_entries(outlet_id, entry_date)
  where esb_exported_at is null and entry_type = 'out';

-- ---------------------------------------------------------
-- (2) Menandai yang ikut terunduh — wewenangnya lewat OUTLET.
--
-- `untuk_nota` & `penyesuaian_nota` ikut disaring DI SINI, bukan cuma di
-- layanan yang menyusun daftarnya. Penjaga yang hanya ada di satu sisi adalah
-- penjaga yang hilang begitu ada jalan lain ke fungsi ini — dan yang ditandai
-- keliru di sini berhenti ditawarkan ekspor selamanya, tanpa satu pun pesan.
-- ---------------------------------------------------------
create or replace function tandai_kas_esb(p_entries uuid[])
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_n int;
begin
  if p_entries is null or array_length(p_entries, 1) is null then
    return 0;
  end if;

  update cash_entries c
     set esb_exported_at = now(),
         esb_exported_by = v_uid
   where c.id = any(p_entries)
     and c.esb_exported_at is null
     and c.entry_type = 'out'
     and c.dicoret_at is null
     and c.untuk_nota = false
     and c.penyesuaian_nota is null
     and is_admin_of_outlet(v_uid, c.outlet_id);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function tandai_kas_esb(uuid[]) from public;
grant execute on function tandai_kas_esb(uuid[]) to authenticated;

comment on function tandai_kas_esb(uuid[]) is
  'Menandai kas keluar yang ikut terunduh ke berkas ESB Disbursement. Wewenangnya lewat OUTLET peruntukan — `business_unit_id` tidak pernah diisi sejak 0040.';

-- ---------------------------------------------------------
-- (3) Membuka tandanya — wewenang yang sama.
-- ---------------------------------------------------------
create or replace function batalkan_tanda_kas_esb(p_entries uuid[], p_alasan text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_alasan text := alasan_batal_esb_sah(p_alasan);
  v_n int;
begin
  if p_entries is null or array_length(p_entries, 1) is null then
    return 0;
  end if;

  update cash_entries c
     set esb_exported_at = null,
         esb_exported_by = null,
         esb_dibatalkan_at = now(),
         esb_dibatalkan_by = v_uid,
         esb_alasan_batal = v_alasan
   where c.id = any(p_entries)
     -- Yang TIDAK bertanda dilewati, bukan ditulisi jejak pembatalan yang
     -- tidak pernah terjadi.
     and c.esb_exported_at is not null
     and is_admin_of_outlet(v_uid, c.outlet_id);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function batalkan_tanda_kas_esb(uuid[], text) from public;
grant execute on function batalkan_tanda_kas_esb(uuid[], text) to authenticated;

comment on function batalkan_tanda_kas_esb(uuid[], text) is
  'Membuka tanda ekspor ESB beberapa kas keluar. Menuntut alasan, mencatat pelakunya, dan berwenang lewat OUTLET peruntukan.';

-- ---------------------------------------------------------
-- (4) Kas keluar untuk diekspor — DARI DATABASE, bukan dari klien.
--
-- ============ KENAPA JADI RPC ============
--
-- RLS `cash_entries` membuka baris milik SENDIRI, ditambah baris pemegang kas
-- yang bernaung di BU yang dikelola pemanggilnya (0141). Admin BU memang
-- melihatnya — tapi jalur klien tetap harus menyusun daftar outletnya sendiri
-- lalu mengirimkannya sebagai `in (...)`, dan daftar itu bisa salah tanpa satu
-- pun yang menyadarinya: outlet yang baru dibuat, outlet yang aksesnya dicabut,
-- atau BU yang outletnya nol.
--
-- Di sini pertanyaannya ditanyakan sekali, di tempat yang tahu jawabannya:
-- "kas keluar non-bahan, di outlet mana pun milik BU ini, yang boleh kulihat".
--
-- Saringan "selain bahan" ditulis di SATU tempat — di sini — dan `tandai_kas_esb`
-- di atas memakai aturan yang sama persis. Dua daftar yang disusun dengan
-- aturan berbeda akan menandai baris yang tidak pernah ikut terunduh.
-- ---------------------------------------------------------
create or replace function kas_untuk_esb(
  p_bu uuid,
  p_from date,
  p_to date,
  p_outlet uuid default null,
  p_termasuk_sudah_ekspor boolean default false
)
returns table (
  id uuid,
  entry_date date,
  amount numeric,
  notes text,
  supplier text,
  outlet_id uuid,
  outlet_nama text,
  kategori_nama text,
  esb_exported_at timestamptz
)
language sql
security definer
stable
set search_path = public
as $$
  select
    ce.id,
    ce.entry_date,
    ce.amount,
    ce.notes,
    ce.supplier,
    ce.outlet_id,
    o.name,
    cc.name,
    ce.esb_exported_at
  from cash_entries ce
  join outlets o on o.id = ce.outlet_id
  left join cash_categories cc on cc.id = ce.category_id
  where ce.entry_type = 'out'
    -- HANYA PENGELUARAN SELAIN BAHAN. Keduanya dijaga constraint trigger
    -- (0122/0131), jadi flag-nya tidak bisa dikarang dari klien.
    and ce.untuk_nota = false
    and ce.penyesuaian_nota is null
    and ce.dicoret_at is null
    and o.business_unit_id = p_bu
    and (p_outlet is null or ce.outlet_id = p_outlet)
    and ce.entry_date between p_from and p_to
    and (p_termasuk_sudah_ekspor or ce.esb_exported_at is null)
    -- Wewenangnya lewat outlet, sama dengan `tandai_kas_esb`.
    and is_admin_of_outlet(auth.uid(), ce.outlet_id)
  order by ce.entry_date, ce.id;
$$;

revoke all on function kas_untuk_esb(uuid, date, date, uuid, boolean) from public;
grant execute on function kas_untuk_esb(uuid, date, date, uuid, boolean) to authenticated;

comment on function kas_untuk_esb(uuid, date, date, uuid, boolean) is
  'Kas keluar SELAIN pembelian bahan, untuk berkas ESB Disbursement. Disaring lewat outlet peruntukan — `business_unit_id` tidak pernah diisi sejak 0040.';

-- ---------------------------------------------------------
-- (5) Yang SUDAH bertanda, untuk layar "Batalkan tanda ekspor".
--
-- Pembayaran nota TIDAK disaring di sini, dan itu disengaja: kalau sebuah
-- entri terlanjur bertanda — mis. dari berkas yang dibuat sebelum saringannya
-- benar — ia harus tetap bisa ditemukan dan dibuka. Daftar yang menyembunyikan
-- baris yang perlu dibereskan adalah daftar yang membuat pekerjaan itu mustahil.
-- ---------------------------------------------------------
create or replace function kas_bertanda_esb(
  p_bu uuid,
  p_from date,
  p_to date,
  p_outlet uuid default null
)
returns table (
  id uuid,
  entry_date date,
  amount numeric,
  notes text,
  supplier text,
  outlet_nama text,
  esb_exported_at timestamptz,
  esb_dibatalkan_at timestamptz,
  esb_alasan_batal text,
  pembatal text
)
language sql
security definer
stable
set search_path = public
as $$
  select
    ce.id,
    ce.entry_date,
    ce.amount,
    ce.notes,
    ce.supplier,
    o.name,
    ce.esb_exported_at,
    ce.esb_dibatalkan_at,
    ce.esb_alasan_batal,
    u.full_name
  from cash_entries ce
  join outlets o on o.id = ce.outlet_id
  left join user_profiles u on u.id = ce.esb_dibatalkan_by
  where ce.entry_type = 'out'
    and ce.esb_exported_at is not null
    and o.business_unit_id = p_bu
    and (p_outlet is null or ce.outlet_id = p_outlet)
    and ce.entry_date between p_from and p_to
    and is_admin_of_outlet(auth.uid(), ce.outlet_id)
  order by ce.esb_exported_at desc;
$$;

revoke all on function kas_bertanda_esb(uuid, date, date, uuid) from public;
grant execute on function kas_bertanda_esb(uuid, date, date, uuid) to authenticated;

notify pgrst, 'reload schema';
