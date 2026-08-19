-- =========================================================
-- Berjaya Hub OMS — 0093
-- Kolom yang dipakai halaman Owner: penanda biaya tetap & angka penetapan harga.
--
-- =========================================================
-- BERKAS INI DITULIS ULANG. YANG DIBATALKAN, DAN KENAPA.
-- =========================================================
--
-- Versi pertama membuat role `owner`: tabel `owner_scopes`, empat fungsi
-- cakupan, dan lima belas policy SELECT tambahan. Keputusannya diubah — yang
-- membuka `owner.html` cukup SUPER ADMIN.
--
-- Penyederhanaannya besar dan bukan sekadar "kode lebih sedikit":
--
--   - `has_bu_scope()`, `is_bu_admin()`, dan `has_outlet_scope()` SEMUANYA
--     sudah meloloskan super_admin lewat cabang `role = 'super_admin'` yang
--     ada sejak 0001. Jadi seluruh hak baca yang dulu ditulis satu per satu
--     memang sudah ada — lima belas policy itu tidak pernah menambah apa pun
--     untuk super admin.
--   - Tidak ada lagi peran keempat yang harus diingat setiap kali policy baru
--     ditulis. Peran yang jarang dipakai adalah peran yang paling mudah
--     terlupakan saat modul berikutnya dibangun, dan yang terlupakan di sini
--     berarti halaman owner diam-diam kosong.
--
-- Yang HILANG dengan keputusan ini, dan sebaiknya diketahui: super admin bisa
-- menulis apa pun. Dulu owner tidak bisa menulis karena ia bukan anggota BU,
-- dan itu sifat bawaan yang tidak bisa lupa dipasang. Sekarang yang menahan
-- owner dari mengubah stok atau penjualan hanyalah `owner.html` yang memang
-- tidak punya tombolnya. Itu penjagaan di LAYAR, bukan di database — lebih
-- lemah, dan `tools/audit-owner-baca-saja.cjs` sekarang menjaga justru hal itu.
--
-- Bagian (0) di bawah membersihkan sisa versi pertama. Aman dijalankan baik
-- oleh yang sudah terlanjur menjalankan versi lamanya maupun yang belum.
-- =========================================================

-- ---------------------------------------------------------
-- (0) BERSIHKAN SISA ROLE OWNER
--
-- ============ KENAPA DISAPU, BUKAN DIDAFTAR ============
--
-- Versi pertama bagian ini berupa daftar nama policy yang ditulis tangan —
-- semua yang berakhiran `_owner`, ditambah `dokumen_insert_owner`.
--
-- Daftar itu SALAH saat dijalankan di produksi:
--
--     ERROR: cannot drop function owner_punya_bu(uuid,uuid) because other
--     objects depend on it
--     DETAIL: policy documents_select on table documents depends on it
--             policy dokumen_select on table storage.objects depends on it
--
-- Dua policy itu dibuat 0094, memanggil `owner_punya_bu()` di salah satu
-- cabangnya, dan NAMANYA TIDAK BERAKHIRAN `_owner`. Saya menyaring menurut pola
-- nama alih-alih menurut apa yang benar-benar dirujuk — kesalahan yang persis
-- sama dengan `audit-embed-ambigu` yang dulu hijau berbulan-bulan karena
-- pengecualian tulisan tangannya menyebut tabel yang tidak pernah ada.
--
-- Sekarang daftarnya DIBACA DARI DATABASE. `pg_policies` memuat ekspresi tiap
-- policy, jadi yang disapu adalah setiap policy yang benar-benar memanggil
-- salah satu fungsi owner — di skema mana pun, dengan nama apa pun, termasuk
-- yang tidak pernah saya ketahui.
--
-- CATATAN URUTAN: `documents_select` dan `dokumen_select` ikut terhapus di
-- sini, dan 0094 yang membuatnya kembali dalam bentuk tanpa owner. Jadi 0094
-- HARUS dijalankan sesudah berkas ini — di antara keduanya, tabel `documents`
-- tidak bisa dibaca siapa pun.
-- ---------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select schemaname, tablename, policyname
    from pg_policies
    where coalesce(qual, '') || ' ' || coalesce(with_check, '') ~
          '(owner_punya_bu|owner_punya_outlet|orang_di_bu_owner|is_owner)\s*\('
  loop
    execute format('drop policy if exists %I on %I.%I', r.policyname, r.schemaname, r.tablename);
    raise notice 'Policy owner dibuang: %.% -> %', r.schemaname, r.tablename, r.policyname;
  end loop;
end $$;

-- Fungsinya baru bisa dibuang SESUDAH semua policy yang memakainya hilang —
-- itulah yang gagal di percobaan pertama. Sengaja TANPA `cascade`: kalau masih
-- ada yang bergantung, lebih baik berhenti dengan pesan yang menyebutkan
-- namanya daripada diam-diam ikut menghapus sesuatu yang tidak diniatkan.
drop function if exists owner_punya_bu(uuid, uuid);
drop function if exists owner_punya_outlet(uuid, uuid);
drop function if exists orang_di_bu_owner(uuid, uuid);
drop function if exists is_owner(uuid);

-- Policy milik tabelnya sendiri ikut terhapus bersama tabelnya.
drop table if exists owner_scopes;

-- ---------------------------------------------------------
-- (1) PENANDA BIAYA TETAP
--
-- BEP menuntut pemisahan biaya TETAP (sewa, gaji pokok, langganan) dari biaya
-- VARIABEL (belanja bahan). Sampai sekarang `cash_categories` tidak menyimpan
-- bedanya, jadi satu-satunya cara memisahkan adalah menebak dari namanya —
-- dan tebakan dari nama akan salah diam-diam begitu ada kategori baru bernama
-- "Perbaikan Mesin" yang tidak jelas masuk mana.
--
-- Default FALSE: kategori yang ada sekarang dianggap variabel sampai seseorang
-- menandainya. Lebih baik BEP terlihat terlalu rendah dan janggal (sehingga
-- ditanyakan) daripada terlalu tinggi karena belanja bahan ikut dihitung tetap.
-- ---------------------------------------------------------
alter table cash_categories add column if not exists is_fixed_cost boolean not null default false;

comment on column cash_categories.is_fixed_cost is
  'TRUE = biaya tetap (sewa, gaji, langganan) yang dipakai penyebut BEP. FALSE = variabel. Default false; ditandai manual oleh super admin di halaman Kas.';

-- ---------------------------------------------------------
-- (2) ANGKA YANG DIPAKAI PRICING ENGINE
--
-- Diambil dari aplikasi Project Hub, tapi dipasang di tempat yang sudah punya
-- pemiliknya masing-masing.
--
-- Per BU (metode & persentasenya), karena metode penetapan harga adalah
-- keputusan tingkat usaha: kafe wajar memakai Food Cost, bengkel memakai
-- Margin. Menyimpannya per produk akan membuat 200 produk bisa memakai 200
-- metode berbeda tanpa ada yang berniat begitu.
--
-- Per produk (biaya kemasan & potongan), karena angkanya memang berbeda tiap
-- barang: gelas plastik hanya melekat pada minuman, dan fee marketplace hanya
-- kena pada yang dijual online.
-- ---------------------------------------------------------
alter table business_units add column if not exists pricing_method text not null default 'food_cost';
alter table business_units add column if not exists food_cost_percent numeric not null default 35;
alter table business_units add column if not exists markup_percent numeric not null default 100;
alter table business_units add column if not exists margin_percent numeric not null default 60;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'business_units_pricing_method_sah') then
    alter table business_units add constraint business_units_pricing_method_sah
      check (pricing_method in ('food_cost', 'markup', 'margin'));
  end if;

  -- Margin 100% berarti harga jual dibagi nol. Dijaga di sini supaya
  -- pembagian nolnya tidak pernah sampai ke perhitungan.
  if not exists (select 1 from pg_constraint where conname = 'business_units_persen_wajar') then
    alter table business_units add constraint business_units_persen_wajar
      check (
        food_cost_percent > 0 and food_cost_percent <= 100
        and markup_percent >= 0 and markup_percent <= 1000
        and margin_percent >= 0 and margin_percent < 100
      );
  end if;
end $$;

comment on column business_units.pricing_method is
  'food_cost: harga = HPP / persen. markup: harga = HPP x (1 + persen). margin: harga = HPP / (1 - persen). Rumusnya di js/modules/owner/pricing.js.';

alter table products add column if not exists packaging_cost numeric not null default 0;
alter table products add column if not exists fee_online_percent numeric not null default 0;
alter table products add column if not exists promo_percent numeric not null default 0;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'products_biaya_tambahan_wajar') then
    alter table products add constraint products_biaya_tambahan_wajar
      check (
        packaging_cost >= 0
        -- Batas < 100 dua-duanya: fee 100% berarti seluruh uangnya hilang, dan
        -- rumus harga online membaginya, jadi 100 akan membagi nol.
        and fee_online_percent >= 0 and fee_online_percent < 100
        and promo_percent >= 0 and promo_percent < 100
      );
  end if;
end $$;

comment on column products.packaging_cost is
  'Biaya kemasan per porsi, dalam rupiah. Ikut dijumlahkan ke HPP saat menghitung harga jual & BEP.';
comment on column products.fee_online_percent is
  'Potongan marketplace (%). Dipakai menghitung harga online dari harga offline.';
comment on column products.promo_percent is
  'Diskon promo yang biasa dipasang (%). Sama gunanya dengan fee_online_percent.';

-- ---------------------------------------------------------
-- (3) Tanpa baris ini, semua kolom di atas ada di database tapi PostgREST
-- masih memakai skema lamanya — dan error yang muncul di aplikasi akan
-- berbunyi "column does not exist" untuk kolom yang jelas-jelas ada.
-- ---------------------------------------------------------
notify pgrst, 'reload schema';
