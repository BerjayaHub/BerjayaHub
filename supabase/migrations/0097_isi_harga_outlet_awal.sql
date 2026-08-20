-- =========================================================
-- Berjaya Hub OMS — 0097
-- Isi harga outlet awal dari `products.sale_price`.
--
-- =========================================================
-- `effective_from` = HARI INI, BUKAN TANGGAL TRANSAKSI PALING AWAL
-- =========================================================
--
-- Godaan yang wajar: menyetel `effective_from` ke tanggal penjualan paling awal
-- supaya tabel harga bisa menjawab "berapa harga Nasi Goreng di Sentul pada 10
-- Agustus".
--
-- Itu akan MENGARANG. Sistem tidak pernah membedakan harga antar outlet sebelum
-- migration ini; menuliskan bahwa harga Rp35.000 berlaku di Sentul sejak Januari
-- adalah pernyataan yang tidak pernah benar-benar diketahui siapa pun. Dan
-- karena bentuknya data, bukan tebakan, tidak akan ada yang meragukannya
-- setahun lagi.
--
-- Jadi harga outlet berlaku KE DEPAN. Konsekuensinya jelas dan diterima:
-- bertanya tentang harga outlet pada tanggal sebelum hari ini akan menjawab
-- "tidak diketahui".
--
-- Omzet historis TIDAK terpengaruh sama sekali — ia dibaca dari
-- `sales.unit_price` yang sudah dibekukan sejak awal, bukan dari tabel ini.
--
-- =========================================================
-- MENU TANPA HARGA TIDAK DIBUATKAN BARIS
-- =========================================================
--
-- Produk `finished` yang `sale_price`-nya NULL sengaja dilewati. Akibatnya
-- outlet BELUM BISA menjualnya sampai admin mengisi harganya — dan itu memang
-- yang diinginkan (lihat 0099): lebih baik transaksinya ditolak dengan pesan
-- yang jelas daripada tercatat beromzet Rp 0.
--
-- Berapa banyak yang terlewat bisa dilihat setelah migration ini:
--
--     select o.name outlet, p.name menu
--       from outlets o
--       join products p on p.business_unit_id = o.business_unit_id
--      where o.is_active and p.is_active and p.product_type = 'finished'
--        and not exists (select 1 from outlet_menu_prices m
--                         where m.outlet_id = o.id and m.product_id = p.id)
--      order by 1, 2;
--
-- Layar Admin Portal menampilkan daftar yang sama, supaya tidak perlu SQL.
-- =========================================================

insert into outlet_menu_prices (
  business_unit_id, outlet_id, product_id,
  selling_price, packaging_cost, fee_online_percent, promo_percent,
  effective_from, notes
)
select
  o.business_unit_id,
  o.id,
  p.id,
  p.sale_price,
  coalesce(p.packaging_cost, 0),
  coalesce(p.fee_online_percent, 0),
  coalesce(p.promo_percent, 0),
  current_date,
  'Diisi otomatis dari harga acuan BU (migration 0097). Sesuaikan bila harga outlet ini berbeda.'
from outlets o
join products p
  on p.business_unit_id = o.business_unit_id
where o.is_active
  and p.is_active
  and p.product_type = 'finished'
  and p.sale_price is not null
  -- Aman dijalankan ulang: yang sudah punya harga tidak diisi lagi. Tanpa ini,
  -- menjalankan migration dua kali akan ditolak trigger tumpang-tindih — dan
  -- migration yang gagal di jalan kedua membuat urutan deploy jadi rapuh.
  and not exists (
    select 1 from outlet_menu_prices m
     where m.outlet_id = o.id and m.product_id = p.id
  );

notify pgrst, 'reload schema';
