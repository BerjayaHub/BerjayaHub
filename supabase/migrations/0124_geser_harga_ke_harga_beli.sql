-- =========================================================
-- Berjaya Hub OMS — 0124
-- Menggeser harga yang terlanjur diinput sebagai "harga/satuan"
-- menjadi HARGA BELI baris.
--
-- =========================================================
-- KENAPA INI ADA
-- =========================================================
--
-- `0123` memperbaiki artinya untuk ke depan, dan sengaja TIDAK menebak data
-- lama: tidak ada apa pun di dalam baris `unit_cost = 9000` yang bisa
-- membedakan "Rp9.000 per gram" dari "Rp9.000 untuk seluruh barisnya".
--
-- Sekarang orang yang menginputnya sendiri yang menyatakannya:
--
--   "wortel itu harga beli 9000 diinput oleh user, lalu setelah di push kode
--    dia tetap jadi harga per satuan, apakah ini semua bisa digeser ke
--    harga beli?"
--
-- Akibat belum digeser terlihat di layar: satu nota berisi tiga sayur
-- berjumlah **Rp84.260.000**, dan angka itu sudah masuk ke `stock_movements`
-- yang jadi satu-satunya sumber biaya rata-rata bahan.
--
-- =========================================================
-- YANG DIKERJAKAN
-- =========================================================
--
--   line_total := unit_cost lama   (angka yang DIKETIK orang)
--   unit_cost  := unit_cost lama / qty
--
-- Keduanya di SATU pernyataan `update`. Di SQL seluruh sisi kanan memakai
-- nilai LAMA barisnya, jadi tidak ada urutan yang bisa salah — sementara dua
-- pernyataan terpisah akan membaca `unit_cost` yang sudah berubah dan
-- menghasilkan pembagian ganda.
--
-- =========================================================
-- YANG SENGAJA TIDAK DIKERJAKAN
-- =========================================================
--
-- TIDAK ADA konversi massal otomatis. Fungsi ini hanya menyentuh nota yang
-- DISEBUT pemanggilnya, karena nota yang harganya sudah benar akan RUSAK kalau
-- ikut digeser — `line_total` yang benar jadi dibagi jumlahnya. Layarnya
-- menampilkan total sekarang vs total sesudahnya untuk tiap nota sebelum ada
-- yang ditekan.
--
-- `harga_digeser_at` menjaga supaya satu nota tidak bisa digeser dua kali.
-- Tanpa penanda itu, menekan tombolnya untuk kedua kalinya membagi harganya
-- lagi — dan hasilnya tetap terlihat seperti angka.
-- =========================================================

alter table goods_receipts add column if not exists harga_digeser_at timestamptz;
alter table goods_receipts add column if not exists harga_digeser_by uuid references user_profiles(id) on delete set null;

comment on column goods_receipts.harga_digeser_at is
  'Kapan harga nota ini digeser dari arti lama (per satuan) ke harga beli baris (0124). Terisi = tidak boleh digeser lagi.';

-- ---------------------------------------------------------
-- GESER HARGA beberapa nota sekaligus.
--
-- Mengembalikan jumlah BARIS yang benar-benar berubah, bukan jumlah notanya:
-- nota yang seluruh barisnya belum berharga akan terhitung sebagai nota yang
-- "berhasil" padahal tidak ada yang berubah, dan itu terbaca sebagai pekerjaan
-- yang sudah selesai.
-- ---------------------------------------------------------
create or replace function geser_harga_nota(p_notas uuid[])
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_nota record;
  v_baris int := 0;
  v_n int;
begin
  if p_notas is null or array_length(p_notas, 1) is null then
    raise exception 'Tidak ada nota yang dipilih.';
  end if;

  -- Diperiksa sebagai satu himpunan lebih dulu: kalau satu saja tidak boleh,
  -- TIDAK ADA yang digeser. Konversi sebagian yang diam-diam berhasil jauh
  -- lebih sulit ditelusuri daripada penolakan yang jelas — apalagi karena
  -- hasilnya sama-sama "angka yang terlihat wajar".
  for v_nota in
    select id, code, payment_status, harga_digeser_at, outlet_id
      from goods_receipts where id = any(p_notas)
  loop
    if not has_outlet_scope(v_uid, v_nota.outlet_id) then
      raise exception 'Nota % bukan wewenangmu.', v_nota.code;
    end if;
    if v_nota.payment_status = 'lunas' then
      raise exception 'Nota % sudah dibayar. Batalkan pembayarannya dulu, karena nominal kasnya dihitung dari harga yang lama.', v_nota.code;
    end if;
    if v_nota.harga_digeser_at is not null then
      raise exception 'Nota % sudah pernah digeser. Menggesernya lagi akan membagi harganya untuk kedua kalinya.', v_nota.code;
    end if;
  end loop;

  select count(*) into v_n from goods_receipts where id = any(p_notas);
  if v_n <> array_length(p_notas, 1) then
    raise exception 'Ada nota yang tidak ditemukan. Muat ulang daftarnya.';
  end if;

  -- SATU pernyataan. Seluruh sisi kanan memakai nilai LAMA barisnya.
  update goods_receipt_items
     set line_total = unit_cost,
         unit_cost = unit_cost / qty
   where receipt_id = any(p_notas)
     and unit_cost is not null
     and qty > 0;
  get diagnostics v_baris = row_count;

  -- HARGANYA HARUS SAMPAI KE `stock_movements`.
  --
  -- Itulah satu-satunya sumber yang dibaca `biaya_rata_bahan` (0118). Tanpa
  -- baris ini, layar nota menampilkan harga yang sudah dibetulkan sementara
  -- biaya rata-rata bahannya masih memakai angka Rp84 juta — dua angka yang
  -- bercerita berbeda, tanpa satu pun error.
  update stock_movements sm
     set unit_cost = i.unit_cost
    from goods_receipt_items i
   where sm.receipt_id = any(p_notas)
     and i.receipt_id = sm.receipt_id
     and i.product_id = sm.product_id
     and sm.qty_delta > 0;

  update goods_receipts
     set harga_digeser_at = now(), harga_digeser_by = v_uid
   where id = any(p_notas);

  return v_baris;
end;
$$;

revoke all on function geser_harga_nota(uuid[]) from public;
grant execute on function geser_harga_nota(uuid[]) to authenticated;

comment on function geser_harga_nota(uuid[]) is
  'Menggeser harga nota dari arti lama (per satuan) ke harga beli baris. line_total := unit_cost lama; unit_cost := lama/qty. Hanya nota yang disebut, sekali saja, dan tidak untuk nota yang sudah lunas.';

-- ---------------------------------------------------------
-- Penanda ikut ditampilkan, supaya layarnya bisa menyembunyikan nota yang
-- sudah selesai dan tidak menawarkan pekerjaan yang sama dua kali.
-- ---------------------------------------------------------
drop view if exists nota_ringkas;
create view nota_ringkas with (security_invoker = true) as
  select g.id,
         g.business_unit_id,
         g.outlet_id,
         g.code,
         g.receipt_date,
         g.supplier,
         g.invoice_no,
         g.payment_status,
         g.due_date,
         g.paid_at,
         g.payment_entry_id,
         g.harga_digeser_at,
         coalesce(sum(coalesce(i.line_total, i.qty * i.unit_cost)), 0) as total,
         -- Total SEANDAINYA digeser: jumlah angka yang dulu diketik orang.
         -- Dihitung di sini supaya layar pratinjau dan servernya memakai satu
         -- rumus yang sama; kalau klien menghitungnya sendiri, yang dilihat
         -- orang sebelum menekan tombol bisa berbeda dari yang terjadi.
         coalesce(sum(i.unit_cost) filter (where i.unit_cost is not null), 0) as total_jika_digeser,
         count(i.id) filter (where i.unit_cost is null and i.line_total is null) as baris_tanpa_harga,
         count(i.id) filter (where i.unit_cost is not null) as baris_berharga,
         count(i.id) as baris
    from goods_receipts g
    left join goods_receipt_items i on i.receipt_id = g.id
   group by g.id;

comment on view nota_ringkas is
  'Nota + totalnya + berapa barisnya yang belum berharga + total seandainya harganya digeser (0124).';

notify pgrst, 'reload schema';
