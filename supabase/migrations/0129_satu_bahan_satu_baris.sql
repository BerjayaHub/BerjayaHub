-- =========================================================
-- Berjaya Hub OMS — 0129
-- Satu bahan, satu baris — di order, surat jalan, dan nota.
--
-- =========================================================
-- YANG DIMINTA
-- =========================================================
--
--   "didalam satu nomor order, jangan ada bahan dengan nama yang sama, jadi
--    jika staff a order bahan a, maka staff b tidak bisa pilih bahan a lagi
--    kecuali ia menambahkan jumlah order nya, contoh staff a order bahan a
--    100gr, jika staff b juga ingin order bahan a sebanyak 150gr, maka dia
--    harus menambahkan bahan a menjadi 250gr"
--
-- Sejak 0110 order milik OUTLET, bukan pembuatnya: bar mengisi sirup, kitchen
-- menambah daging, ke satu nomor order yang sama. Tidak ada apa pun yang
-- menahan orang kedua memilih barang yang sudah dipesan orang pertama.
--
-- Hasilnya dua baris untuk satu barang. Tidak ada error, tidak ada peringatan,
-- keduanya terlihat wajar — dan staff CK yang menyiapkan barangnya harus
-- menebak apakah 100 dan 150 berarti 250, atau salah satunya salah ketik.
--
-- =========================================================
-- KENAPA PENJAGAANNYA DI DATABASE, BUKAN CUKUP DI LAYAR
-- =========================================================
--
-- Aplikasi ini PWA yang terpasang di HP staff, dan versinya bisa tertinggal
-- berhari-hari. Penjagaan yang hanya ada di layar tidak berlaku untuk HP yang
-- belum memuat ulang kodenya — dan justru HP itulah yang paling sering dipakai
-- di lapangan.
--
-- Dua lapis:
--   TRIGGER  -> pesannya menyebut NAMA bahannya, bisa ditindaklanjuti orang.
--   UNIQUE   -> jaminannya. Ia yang tetap berlaku kalau triggernya suatu saat
--               dilewati (copy massal, perbaikan manual, migrasi lain).
--
-- Tanpa trigger, yang muncul di layar staff adalah
-- "duplicate key value violates unique constraint gri_produk_uk" — kalimat
-- yang tidak memberitahu bahan mana, dan tidak seorang pun di outlet bisa
-- menindaklanjutinya.
--
-- =========================================================
-- ⚠ DATA LAMA DIGABUNGKAN
-- =========================================================
--
-- Disetujui lebih dulu: baris kembar yang sudah tersimpan dijumlahkan jadi
-- satu. Tanpa itu, pemasangan unique index GAGAL dan seluruh migration
-- berhenti di tengah.
--
-- JUMLAH TOTALNYA TIDAK BERUBAH — 100 + 150 tetap 250, yang berubah cuma
-- jumlah barisnya. Kecuali satu hal, dan ini disengaja: kalau salah satu baris
-- nota belum berharga, harga gabungannya DIKOSONGKAN, bukan diambil dari baris
-- yang kebetulan berharga. 100gr@Rp5.000 + 150gr@(kosong) yang digabung jadi
-- 250gr@Rp5.000 menjatuhkan biaya per gram dari 50 ke 20, dan angka itu masuk
-- ke rata-rata biaya bahan seolah-olah pembelian sungguhan. Harga kosong
-- ditahan 0122 sebelum nota bisa dilunasi; harga yang salah tidak ditahan
-- siapa pun.
-- =========================================================

-- ---------------------------------------------------------
-- (1) GABUNGKAN YANG SUDAH TERSIMPAN.
--
-- Trigger penjaga dimatikan sementara. `trg_tolak_ubah_nota_lunas` (0122)
-- menolak perubahan pada nota yang sudah lunas, dan
-- `trg_tolak_ubah_kiriman_terekspor` (0128) menolak perubahan pada kiriman
-- yang sudah diekspor ke ESB. Keduanya benar untuk pemakaian sehari-hari dan
-- keduanya akan menghentikan migration ini di tengah jalan.
--
-- Dimatikan lewat DO block ber-`if exists`: repo ini pernah dijalankan dari
-- keadaan yang berbeda-beda, dan `alter table ... disable trigger` atas trigger
-- yang belum ada akan menggagalkan seluruh berkas.
-- ---------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_trigger where tgname = 'trg_tolak_ubah_nota_lunas') then
    alter table goods_receipt_items disable trigger trg_tolak_ubah_nota_lunas;
  end if;
  if exists (select 1 from pg_trigger where tgname = 'trg_tolak_ubah_kiriman_terekspor') then
    alter table dispatch_items disable trigger trg_tolak_ubah_kiriman_terekspor;
  end if;
end $$;

-- --- Order ke CK ---
with dup as (
  select order_id, product_id, min(id::text)::uuid as simpan, sum(qty) as total
    from stock_order_items
   group by order_id, product_id
  having count(*) > 1
)
update stock_order_items i
   set qty = d.total
  from dup d
 where i.id = d.simpan;

delete from stock_order_items i
 using (
   select order_id, product_id, min(id::text)::uuid as simpan
     from stock_order_items
    group by order_id, product_id
   having count(*) > 1
 ) d
 where i.order_id = d.order_id and i.product_id = d.product_id and i.id <> d.simpan;

-- --- Surat jalan / kiriman ---
--
-- `received_qty` dijumlahkan hanya dari baris yang SUDAH terisi. Kalau tidak
-- ada satu pun yang terisi, hasilnya tetap NULL — bukan 0. NULL berarti "belum
-- dicatat", 0 berarti "barangnya tidak sampai", dan 0128 memperlakukan keduanya
-- dengan cara yang berbeda saat mengekspor ke ESB.
with dup as (
  select dispatch_id, product_id, min(id::text)::uuid as simpan,
         sum(sent_qty) as total_kirim,
         sum(received_qty) filter (where received_qty is not null) as total_terima,
         count(received_qty) as ada_terima
    from dispatch_items
   group by dispatch_id, product_id
  having count(*) > 1
)
update dispatch_items i
   set sent_qty = d.total_kirim,
       received_qty = case when d.ada_terima > 0 then d.total_terima else null end
  from dup d
 where i.id = d.simpan;

delete from dispatch_items i
 using (
   select dispatch_id, product_id, min(id::text)::uuid as simpan
     from dispatch_items
    group by dispatch_id, product_id
   having count(*) > 1
 ) d
 where i.dispatch_id = d.dispatch_id and i.product_id = d.product_id and i.id <> d.simpan;

-- --- Nota terima dari supplier ---
--
-- `line_total` hanya dijumlahkan kalau SELURUH barisnya berharga; kalau ada
-- satu saja yang kosong, hasilnya NULL. Lihat catatan panjang di kepala berkas.
-- `unit_cost` dihitung ulang dari hasil gabungannya — itulah rata-rata
-- tertimbang yang benar, dan ia yang jadi sumber biaya bahan (0118/0123).
with dup as (
  select receipt_id, product_id, min(id::text)::uuid as simpan,
         sum(qty) as total_qty,
         sum(line_total) as total_harga,
         count(*) as n,
         count(line_total) as n_berharga
    from goods_receipt_items
   group by receipt_id, product_id
  having count(*) > 1
)
update goods_receipt_items i
   set qty = d.total_qty,
       line_total = case when d.n_berharga = d.n then d.total_harga else null end,
       unit_cost = case
         when d.n_berharga = d.n and d.total_qty > 0 then d.total_harga / d.total_qty
         else null
       end
  from dup d
 where i.id = d.simpan;

delete from goods_receipt_items i
 using (
   select receipt_id, product_id, min(id::text)::uuid as simpan
     from goods_receipt_items
    group by receipt_id, product_id
   having count(*) > 1
 ) d
 where i.receipt_id = d.receipt_id and i.product_id = d.product_id and i.id <> d.simpan;

-- Biaya di buku besar stok ikut disamakan dengan hasil gabungannya.
--
-- `stock_movements` adalah satu-satunya sumber biaya rata-rata bahan (0118).
-- Kalau ia tertinggal, layar nota menampilkan angka yang benar sementara
-- laporan biayanya tetap memakai yang lama — dua angka berbeda untuk satu
-- barang, dan tidak ada yang menunjukkan mana yang benar.
--
-- Jumlah stoknya TIDAK disentuh: pergerakannya memang sudah mencatat seluruh
-- barang yang masuk, cuma dalam dua baris.
update stock_movements sm
   set unit_cost = i.unit_cost
  from goods_receipt_items i
 where sm.receipt_id = i.receipt_id
   and sm.product_id = i.product_id
   and sm.qty_delta > 0
   and i.unit_cost is not null
   and sm.unit_cost is distinct from i.unit_cost;

do $$
begin
  if exists (select 1 from pg_trigger where tgname = 'trg_tolak_ubah_nota_lunas') then
    alter table goods_receipt_items enable trigger trg_tolak_ubah_nota_lunas;
  end if;
  if exists (select 1 from pg_trigger where tgname = 'trg_tolak_ubah_kiriman_terekspor') then
    alter table dispatch_items enable trigger trg_tolak_ubah_kiriman_terekspor;
  end if;
end $$;

-- ---------------------------------------------------------
-- (2) JAMINANNYA: satu produk sekali saja per dokumen.
-- ---------------------------------------------------------
create unique index if not exists stock_order_items_produk_uk on stock_order_items(order_id, product_id);
create unique index if not exists dispatch_items_produk_uk on dispatch_items(dispatch_id, product_id);
create unique index if not exists goods_receipt_items_produk_uk on goods_receipt_items(receipt_id, product_id);

-- ---------------------------------------------------------
-- (3) PESAN YANG BISA DITINDAKLANJUTI.
--
-- Trigger BEFORE INSERT, bukan penanganan galat di tiap RPC. Penulisnya ada
-- enam (`create_stock_order`, `update_stock_order`, `buat_draft_kiriman`,
-- `ubah_draft_kiriman`, `simpan_nota_terima`, `ubah_nota_terima`) dan akan
-- bertambah. Menaruh aturannya di enam tempat berarti yang ketujuh lahir tanpa
-- penjagaan, dan ketiadaan itu tidak terlihat sampai ada yang mengeluh.
--
-- Namanya diambil dari `products`, bukan dari id-nya: staff outlet tidak pernah
-- melihat uuid, dan pesan yang menyebut uuid sama tidak berartinya dengan pesan
-- unique constraint yang hendak digantikan.
-- ---------------------------------------------------------
create or replace function tolak_bahan_kembar_order()
returns trigger
language plpgsql
as $$
declare
  v_nama text;
begin
  if exists (select 1 from stock_order_items s
              where s.order_id = new.order_id and s.product_id = new.product_id
                and (tg_op = 'INSERT' or s.id <> new.id)) then
    select name into v_nama from products where id = new.product_id;
    raise exception '% sudah ada di order ini. Ubah jumlah di baris yang sudah ada, jangan tambah baris baru.',
      coalesce(v_nama, 'Bahan ini') using errcode = 'unique_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_bahan_kembar_order on stock_order_items;
create trigger trg_bahan_kembar_order
  before insert or update of product_id on stock_order_items
  for each row execute function tolak_bahan_kembar_order();

create or replace function tolak_bahan_kembar_kiriman()
returns trigger
language plpgsql
as $$
declare
  v_nama text;
begin
  if exists (select 1 from dispatch_items s
              where s.dispatch_id = new.dispatch_id and s.product_id = new.product_id
                and (tg_op = 'INSERT' or s.id <> new.id)) then
    select name into v_nama from products where id = new.product_id;
    raise exception '% sudah ada di surat jalan ini. Ubah jumlah di baris yang sudah ada, jangan tambah baris baru.',
      coalesce(v_nama, 'Bahan ini') using errcode = 'unique_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_bahan_kembar_kiriman on dispatch_items;
create trigger trg_bahan_kembar_kiriman
  before insert or update of product_id on dispatch_items
  for each row execute function tolak_bahan_kembar_kiriman();

create or replace function tolak_bahan_kembar_nota()
returns trigger
language plpgsql
as $$
declare
  v_nama text;
begin
  if exists (select 1 from goods_receipt_items s
              where s.receipt_id = new.receipt_id and s.product_id = new.product_id
                and (tg_op = 'INSERT' or s.id <> new.id)) then
    select name into v_nama from products where id = new.product_id;
    raise exception '% sudah ada di nota ini. Gabungkan jadi satu baris — jumlah dan harganya dijumlahkan.',
      coalesce(v_nama, 'Bahan ini') using errcode = 'unique_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_bahan_kembar_nota on goods_receipt_items;
create trigger trg_bahan_kembar_nota
  before insert or update of product_id on goods_receipt_items
  for each row execute function tolak_bahan_kembar_nota();

notify pgrst, 'reload schema';
