-- =========================================================
-- Berjaya Hub OMS — 0102
-- Aset punya KATEGORI, dan bisa DIPINDAH massal ke outlet / BU lain.
--
-- =========================================================
-- KATEGORI: KOLOM TEKS, BUKAN TABEL TERSENDIRI
-- =========================================================
--
-- Sama persis dengan `products.category`. Alasannya bukan malas:
--
--   - Kategori aset tidak punya atribut apa pun selain namanya. Tabel referensi
--     yang isinya cuma id dan nama menambah satu embed di setiap query dan satu
--     layar pengelolaan, tanpa menambah satu pun jaminan.
--   - Daftar pilihannya dibangun dari nilai yang SUDAH ADA (`select distinct`),
--     jadi "tambah kategori" cukup dengan mengetik nama baru — persis seperti
--     Master Produk. Tidak ada langkah "buat kategori dulu".
--
-- Yang HILANG dari pilihan ini, dan diterima: salah ketik menghasilkan kategori
-- baru ("Elektronik" vs "elektronik"). Master Produk sudah hidup dengan itu
-- sejak awal, dan menyeragamkannya di sini saja akan membuat dua modul berbeda
-- perilakunya.
--
-- =========================================================
-- PINDAH ASET: KENAPA LEWAT RPC, BUKAN UPDATE BIASA
-- =========================================================
--
-- Policy `assets_update` memeriksa `has_outlet_scope(auth.uid(), outlet_id)`
-- pada baris LAMA (using) dan baris BARU (with check). Sekilas itu sudah cukup.
--
-- Tapi ada dua hal yang tidak bisa dijamin dari sana:
--
--   (1) `business_unit_id` tidak diperiksa sama sekali. Seseorang yang punya
--       scope di outlet A dan outlet B bisa memindahkan aset ke outlet B sambil
--       menuliskan `business_unit_id` milik BU ketiga. Barisnya lalu berada di
--       BU yang outletnya bukan miliknya — dan setiap laporan yang menyaring
--       per BU akan memuat atau kehilangan aset itu tanpa alasan yang terlihat.
--
--   (2) PostgREST membalas SUKSES DENGAN NOL BARIS saat RLS menolak. Pemindahan
--       massal 40 aset yang seluruhnya ditolak akan terlihat berhasil. Itu
--       kegagalan yang paling mahal di modul ini: aset dianggap sudah pindah,
--       dan yang mencarinya di outlet tujuan tidak akan menemukannya.
--
-- RPC ini memeriksa keduanya, dan MENGEMBALIKAN JUMLAH yang benar-benar
-- berpindah supaya layar bisa mengatakan apa adanya.
--
-- =========================================================
-- FOTONYA TIDAK IKUT DIPINDAH DI SINI — DISENGAJA
-- =========================================================
--
-- Foto tersimpan di `asset-photos` dengan path `<outlet_id>/<asset_id>.<ext>`,
-- dan izin bacanya memakai `has_outlet_scope(auth.uid(), asset_photo_outlet(name))`
-- (lihat 0050). Jadi aset yang pindah outlet akan kehilangan aksesnya ke foto
-- lama bagi staff outlet tujuan.
--
-- Memindahkan berkas storage TIDAK bisa dilakukan dari dalam SQL. Ia dikerjakan
-- oleh klien (`asset.service.js#pindahAsetMassal`) SESUDAH RPC ini berhasil,
-- lalu `photo_path`-nya diperbarui. Fungsi ini karena itu MENGOSONGKAN
-- `photo_path` bagi baris yang berpindah outlet: lebih baik kolomnya kosong dan
-- klien mengisinya kembali, daripada menunjuk berkas yang tidak akan pernah
-- bisa dibuka lagi — "-" yang jujur mengalahkan tautan yang selalu gagal.
-- =========================================================

-- ---------------------------------------------------------
-- (1) Kolom kategori
-- ---------------------------------------------------------
alter table assets add column if not exists category text;

-- Dipakai dua tempat: menyaring per kategori, dan membangun daftar pilihannya
-- (`select distinct category`). Keduanya per BU.
create index if not exists idx_assets_kategori on assets(business_unit_id, category);

-- ---------------------------------------------------------
-- (2) Pindah massal
--
-- @param p_ids     aset yang dicentang
-- @param p_bu      BU tujuan
-- @param p_outlet  outlet tujuan (harus milik BU tujuan)
-- ---------------------------------------------------------
create or replace function pindah_aset(p_ids uuid[], p_bu uuid, p_outlet uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_bu_outlet uuid;
  v_pindah int := 0;
  v_ditolak int := 0;
  v_beda_outlet int := 0;
  r record;
begin
  if v_uid is null then raise exception 'Harus login'; end if;
  if p_ids is null or array_length(p_ids, 1) is null then
    raise exception 'Belum ada aset yang dipilih.';
  end if;
  if p_bu is null or p_outlet is null then
    raise exception 'BU dan outlet tujuan harus diisi.';
  end if;

  -- Outlet tujuan HARUS milik BU tujuan. Tanpa pemeriksaan ini, aset bisa
  -- mendarat di BU yang outletnya bukan miliknya — lihat catatan (1) di kepala.
  select business_unit_id into v_bu_outlet from outlets where id = p_outlet;
  if v_bu_outlet is null then
    raise exception 'Outlet tujuan tidak ditemukan.';
  end if;
  if v_bu_outlet <> p_bu then
    raise exception 'Outlet tujuan bukan milik BU tujuan. Pilih ulang outletnya.';
  end if;

  -- Wewenang di TUJUAN diperiksa sekali di depan: kalau tidak berhak, tidak ada
  -- gunanya memproses satu baris pun, dan pesannya jauh lebih jelas daripada
  -- "0 dari 40 berpindah".
  if not has_outlet_scope(v_uid, p_outlet) then
    raise exception 'Kamu tidak punya akses ke outlet tujuan, jadi aset tidak bisa dipindahkan ke sana.';
  end if;

  for r in select * from assets where id = any(p_ids) loop
    -- Wewenang di ASAL diperiksa per baris. Pemilihan massal gampang sekali
    -- ikut menyeret aset outlet lain — terutama saat filternya "Semua outlet".
    if not has_outlet_scope(v_uid, r.outlet_id) then
      v_ditolak := v_ditolak + 1;
      continue;
    end if;

    if r.outlet_id = p_outlet and r.business_unit_id = p_bu then
      continue; -- sudah di sana; bukan kegagalan, bukan pula perpindahan
    end if;

    if r.outlet_id <> p_outlet then v_beda_outlet := v_beda_outlet + 1; end if;

    update assets
       set business_unit_id = p_bu,
           outlet_id = p_outlet,
           -- Foto ditinggalkan di folder outlet lama dan TIDAK bisa dibaca lagi
           -- dari outlet tujuan. Kolomnya dikosongkan supaya tidak menunjuk
           -- berkas yang selalu gagal; kliennya yang memindahkan berkasnya lalu
           -- mengisi ulang kolom ini. Lihat catatan di kepala berkas.
           photo_path = case when r.outlet_id <> p_outlet then null else r.photo_path end,
           updated_by = v_uid,
           updated_at = now()
     where id = r.id;

    v_pindah := v_pindah + 1;
  end loop;

  return jsonb_build_object(
    'pindah', v_pindah,
    'ditolak', v_ditolak,
    'ganti_outlet', v_beda_outlet
  );
end $$;

revoke all on function pindah_aset(uuid[], uuid, uuid) from public;
grant execute on function pindah_aset(uuid[], uuid, uuid) to authenticated;

comment on function pindah_aset(uuid[], uuid, uuid) is
  'Pindahkan aset ke outlet/BU lain secara massal. Memeriksa wewenang di outlet ASAL maupun TUJUAN, dan memastikan outlet tujuan memang milik BU tujuan. Mengembalikan jumlah yang berpindah & yang ditolak.';

notify pgrst, 'reload schema';
