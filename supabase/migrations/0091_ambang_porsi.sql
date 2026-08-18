-- =========================================================
-- 0091 — Bahan menipis diukur dengan PORSI, bukan hari
--
-- ============ APA YANG BERUBAH ============
--
-- SEBELUMNYA (0087): pemakaian/hari dihitung dari penjualan 28 hari terakhir
-- × resep, lalu batas = pemakaian/hari × "hari aman".
--
-- SEKARANG: stok akhir dibagi takaran resep = **cukup berapa porsi lagi**.
-- Admin menetapkan satu angka porsi minimum per outlet, berlaku untuk semua
-- menu sekaligus.
--
-- ============ KENAPA INI LEBIH BAIK DI SINI ============
--
-- Cara lama menuntut penjualan diinput rajin setiap hari. Outlet yang belum
-- pernah mengisi penjualan mendapat pemakaian/hari nol untuk semua bahan —
-- artinya seluruh daftarnya kosong, dan layar yang selalu bilang "tidak ada
-- yang menipis" persis sama tidak bergunanya dengan layar yang tidak ada.
--
-- "Cukup berapa porsi lagi" hanya butuh dua hal yang memang selalu ada: stok
-- dan resep. Ia bekerja di hari pertama outlet dipakai.
--
-- ============ KOLOM LAMA DIHAPUS, BUKAN DIBIARKAN ============
--
-- `outlets.safety_days` dan `set_safety_days()` dibuang. Kolom mati yang
-- ditinggalkan "untuk jaga-jaga" akan dibaca lagi suatu hari oleh orang yang
-- mengira ia masih berarti — dan angkanya akan terlihat masuk akal, karena
-- memang pernah masuk akal. Nilainya sendiri tidak ada yang perlu diselamatkan:
-- satu angka yang diisi sekali.
--
-- `product_min_stock` (batas manual per bahan) TETAP dan makin penting: ia
-- satu-satunya cara mengawasi bahan yang tidak dipakai resep mana pun — gas,
-- tisu, sedotan, kemasan. Tanpa itu, barang seperti itu tidak akan pernah
-- muncul di daftar mana pun.
-- =========================================================

-- ---------------------------------------------------------
-- Porsi minimum per outlet.
--
-- Default 30: cukup besar untuk memberi waktu belanja, cukup kecil supaya
-- daftar hari pertama tidak langsung merah semua. Bukan angka ajaib — ia cuma
-- titik mulai yang tidak menyesatkan ke salah satu arah ekstrem.
--
-- `not null` supaya tidak ada cabang "kalau belum diatur" di UI. Cabang
-- seperti itu adalah tempat paling sering munculnya ambang 0, yang membuat
-- semua bahan terlihat aman.
-- ---------------------------------------------------------
alter table outlets add column if not exists min_porsi integer not null default 30;

alter table outlets drop constraint if exists outlets_min_porsi_wajar;
alter table outlets add constraint outlets_min_porsi_wajar
  check (min_porsi between 1 and 10000);

comment on column outlets.min_porsi is
  'Stok bahan minimal harus cukup untuk berapa porsi menu di outlet ini. Batas otomatis = takaran rata-rata per porsi x angka ini (0091).';

create or replace function set_min_porsi(p_outlet uuid, p_porsi integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bu uuid;
begin
  select business_unit_id into v_bu from outlets where id = p_outlet;
  if v_bu is null then raise exception 'Outlet tidak dikenal.'; end if;

  if not is_bu_admin(auth.uid(), v_bu) then
    raise exception 'Hanya Admin BU atau Super Admin yang bisa mengatur porsi minimum.';
  end if;

  -- Diperiksa di sini JUGA, bukan cuma mengandalkan constraint tabelnya:
  -- pesan constraint berbunyi "violates check constraint
  -- outlets_min_porsi_wajar", yang tidak berarti apa-apa bagi yang membaca.
  if p_porsi is null or p_porsi < 1 or p_porsi > 10000 then
    raise exception 'Porsi minimum harus antara 1 dan 10.000.';
  end if;

  update outlets set min_porsi = p_porsi where id = p_outlet;
end $$;

revoke all on function set_min_porsi(uuid, integer) from public;
grant execute on function set_min_porsi(uuid, integer) to authenticated;

-- ---------------------------------------------------------
-- Buang jalur lama.
-- ---------------------------------------------------------
drop function if exists set_safety_days(uuid, integer);
alter table outlets drop constraint if exists outlets_safety_days_wajar;
alter table outlets drop column if exists safety_days;

notify pgrst, 'reload schema';
