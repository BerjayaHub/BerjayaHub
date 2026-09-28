-- ============================================================
-- 0154 — FOTO ASET TERLIHAT SEJAUH BARISNYA TERLIHAT.
--
-- ============ DUA ATURAN UNTUK SATU LAYAR ============
--
-- Layar Inventaris Aset menggambar satu baris per barang, berikut fotonya.
-- Sampai sekarang keduanya dijaga aturan yang BERBEDA:
--
--     baris aset   assets_select        (0045)  has_bu_scope
--     foto aset    asset_photo_select   (0050)  has_outlet_scope
--
-- Jadi staff yang cakupannya hanya di AB Gading Serpong MELIHAT baris aset
-- Central Kitchen — satu BU — dan tidak bisa membuka fotonya. Bukan karena
-- ada yang memutuskan begitu: `0050` menyamakan keempat policy-nya ke prefix
-- path sekaligus, dan SELECT ikut terbawa tanpa pertanyaan tersendiri.
--
-- ============ YANG MEMBUATNYA SULIT DILIHAT ============
--
-- `createSignedUrls` menolak per objek, bukan per permintaan. Path yang tidak
-- berizin cuma HILANG dari hasilnya — tidak ada galat, tidak ada peringatan.
-- Layarnya lalu menggambar tombol "Lihat" untuk baris itu, persis seperti
-- baris yang tautannya memang gagal dibuat karena jaringan.
--
-- Yang membacanya menyimpulkan "fotonya belum diunggah", dan memfoto ulang
-- barang yang fotonya sudah ada sejak setahun lalu.
--
-- ============ YANG DILONGGARKAN HANYA MELIHAT ============
--
-- INSERT, UPDATE, dan DELETE tetap menuntut `has_outlet_scope` — mengunggah,
-- menimpa, dan menghapus foto outlet lain bukan hal yang sedang diminta, dan
-- melonggarkannya sekalian "karena kebetulan sedang menyentuh berkas yang
-- sama" adalah cara paling sering sebuah izin melebar tanpa ada yang memutuskan.
--
-- DELETE bahkan lebih ketat lagi (`is_admin_of_outlet`), dan itu dipertahankan
-- apa adanya.
-- ============================================================

-- ---------------------------------------------------------
-- Hanya SELECT yang diganti. Ketiga policy lain TIDAK disentuh sama sekali —
-- menulis ulang policy yang tidak berubah berarti mengetik ulang isinya, dan
-- yang terlupa di sana tidak melempar apa pun: ia cuma membuka pintu.
-- ---------------------------------------------------------
-- ---------------------------------------------------------
-- BU pemilik sebuah objek foto aset — LEWAT FUNGSI `security definer`.
--
-- ============ POLICY TIDAK BOLEH MEMBACA TABEL LANGSUNG ============
--
-- Ekspresi di dalam policy dinilai dengan hak PEMANGGILNYA, bukan hak pemilik
-- policy. Menulis `exists (select 1 from outlets …)` di sana berarti setiap
-- pembacaan foto ikut menuntut hak SELECT atas `outlets` — dan yang tidak
-- punya mendapat `42501 permission denied`, bukan "foto tidak ada".
--
-- Galat itu jatuh pada query FOTONYA, tanpa menyebut `outlets` sama sekali,
-- jadi yang membacanya akan mencari sebabnya di tempat yang salah.
--
-- `0050` sudah memakai bentuk ini untuk `asset_photo_outlet`; berkas ini cuma
-- meneruskannya satu langkah lagi ke BU-nya.
-- ---------------------------------------------------------
create or replace function asset_photo_bu(p_name text)
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select o.business_unit_id
  from outlets o
  where o.id = asset_photo_outlet(p_name);
$$;

revoke all on function asset_photo_bu(text) from public;
grant execute on function asset_photo_bu(text) to authenticated;

comment on function asset_photo_bu(text) is
  'BU pemilik sebuah objek asset-photos, diturunkan dari prefix path lewat `asset_photo_outlet`. NULL kalau outletnya tidak ada — dan NULL membuat `has_bu_scope` menolak.';

drop policy if exists asset_photo_select on storage.objects;

create policy asset_photo_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'asset-photos'
    -- Sejauh BARISNYA terlihat, tidak lebih.
    --
    -- Prefix path tetap jadi sumbernya — `0050` sudah menjelaskan kenapa
    -- policy ini tidak boleh bergantung pada `assets.photo_path`: pada detik
    -- berkasnya diunggah, kolom itu masih NULL, dan objek yang baru ditulis
    -- jadi tidak bisa dibaca pengunggahnya sendiri. Yang berubah cuma
    -- pertanyaannya: BU outlet itu, bukan outlet itu sendiri.
    and has_bu_scope(auth.uid(), asset_photo_bu(name))
  );

comment on function asset_photo_outlet(text) is
  'Outlet pemilik sebuah objek asset-photos, dibaca dari prefix path `{outlet_id}/…`. NULL kalau bentuk namanya bukan itu — dan NULL membuat seluruh policy yang memakainya menolak, bukan gagal.';
