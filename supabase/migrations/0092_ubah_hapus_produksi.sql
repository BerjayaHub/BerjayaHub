-- =========================================================
-- 0092 — Produksi bisa diperbaiki & dibatalkan, stoknya ikut terkoreksi
--
-- ============ KENAPA PERLU ============
--
-- Produksi salah ketik adalah kejadian sehari-hari: 1.800 jadi 18.000, atau
-- produk yang dipilih keliru. Sebelum ini satu-satunya jalan keluar adalah
-- membiarkannya, lalu menutupi selisihnya lewat opname — yang berarti
-- kesalahan ketik terserap sebagai "penyesuaian stok" tanpa pernah tercatat
-- sebagai apa yang sebenarnya terjadi.
--
-- ============ CARANYA: PERGERAKAN PENYEIMBANG ============
--
-- Pergerakan stok yang lama TIDAK PERNAH diubah atau dihapus. Yang ditulis
-- adalah pergerakan BARU sebesar selisihnya. Alasannya sama seperti pada nota
-- penerimaan (0084):
--
--   1. `stock_movements` adalah buku besar. Memperbaiki masa lalu membuat
--      angka yang pernah dilihat, dicetak, dan dipakai berdebat berubah tanpa
--      jejak — dan pertanyaan "kok kemarin beda?" jadi tidak bisa dijawab.
--   2. Kalau ada penerimaan atau penjualan DI ANTARA produksi dan koreksinya,
--      menimpa angka lama akan menghasilkan urutan yang tidak pernah terjadi.
--      Selisih yang ditambahkan sekarang selalu benar, apa pun yang terjadi
--      di antaranya.
--
-- ============ MENGHAPUS = MEMBATALKAN, BUKAN MELENYAPKAN ============
--
-- `hapus_produksi()` membalik seluruh stoknya lalu menandai barisnya
-- `cancelled_at`. Barisnya TIDAK dihapus dari tabel.
--
-- Ini pilihan sadar, dan sejalan dengan `batalkan_opname()` (0085): yang
-- dibatalkan adalah AKIBATNYA pada stok, bukan catatan bahwa pernah ada orang
-- mencatat produksi. Baris yang benar-benar lenyap akan meninggalkan
-- pergerakan stok yang menunjuk produksi yang tidak ada — dan tidak ada
-- seorang pun yang bisa menjelaskan asal angkanya enam bulan kemudian.
--
-- Dari sisi layar ia tetap terasa "terhapus": daftar produksi menyaring yang
-- dibatalkan, kecuali kalau sengaja diminta.
--
-- ============ SIAPA YANG BOLEH ============
--
-- Pembuatnya sendiri, HARI ITU JUGA — atau Admin BU kapan saja. Bentuk yang
-- sama dipakai koreksi Daily Activities (0073).
--
-- Batas "hari ini" ada karena koreksi yang datang berhari-hari kemudian
-- hampir selalu menyentuh periode yang laporannya sudah dibaca orang. Itu
-- keputusan admin, bukan keputusan yang diambil sendiri di dapur.
-- =========================================================

alter table production_runs add column if not exists cancelled_at timestamptz;
alter table production_runs add column if not exists cancelled_by uuid references user_profiles(id) on delete set null;
alter table production_runs add column if not exists cancel_reason text;

create index if not exists idx_production_runs_aktif on production_runs(outlet_id, created_at desc) where cancelled_at is null;

-- ---------------------------------------------------------
-- Penjaga wewenang bersama — ditulis sekali supaya `ubah` dan `hapus` tidak
-- bisa menyimpang satu sama lain. Dua salinan aturan yang sama selalu
-- berakhir berbeda, dan yang berbeda adalah yang jarang dibaca.
-- ---------------------------------------------------------
create or replace function boleh_ubah_produksi(p_run uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from production_runs r
    where r.id = p_run
      and (
        is_bu_admin(auth.uid(), r.business_unit_id)
        or (
          r.created_by = auth.uid()
          and (r.created_at at time zone 'Asia/Jakarta')::date = (now() at time zone 'Asia/Jakarta')::date
        )
      )
  );
$$;

-- ---------------------------------------------------------
-- UBAH JUMLAH HASIL
--
-- Yang bisa diubah HANYA jumlah hasil & catatannya. Produknya tidak.
--
-- Mengganti produk berarti membatalkan seluruh pemakaian bahan resep lama lalu
-- menerapkan resep baru — hasilnya persis sama dengan "batalkan lalu catat
-- ulang", tapi dengan satu baris riwayat yang menyamarkan bahwa dua hal
-- berbeda pernah terjadi. Lebih jujur menyuruh orangnya membatalkan dan
-- mencatat lagi.
-- ---------------------------------------------------------
create or replace function ubah_produksi(p_run uuid, p_output_qty numeric, p_notes text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r_run production_runs%rowtype;
  v_recipe recipes%rowtype;
  v_selisih numeric;
  v_faktor numeric;
  r record;
begin
  select * into r_run from production_runs where id = p_run;
  if r_run.id is null then raise exception 'Produksi tidak ditemukan.'; end if;
  if r_run.cancelled_at is not null then raise exception 'Produksi ini sudah dibatalkan, tidak bisa diubah lagi.'; end if;
  if not boleh_ubah_produksi(p_run) then
    raise exception 'Kamu hanya boleh memperbaiki produksi yang kamu catat sendiri hari ini. Selebihnya lewat Admin BU.';
  end if;
  if p_output_qty is null or p_output_qty <= 0 then raise exception 'Jumlah hasil harus lebih dari 0.'; end if;

  v_selisih := p_output_qty - r_run.output_qty;

  -- Catatan boleh diperbaiki walau jumlahnya tidak berubah.
  update production_runs set output_qty = p_output_qty, notes = p_notes where id = p_run;

  if v_selisih = 0 then return; end if;

  select * into v_recipe from recipes where product_id = r_run.product_id and mode = 'production';
  if v_recipe.id is null then raise exception 'Produk ini sudah tidak punya resep produksi — koreksinya harus lewat Opname.'; end if;
  if v_recipe.yield_qty is null or v_recipe.yield_qty <= 0 then raise exception 'Yield resep tidak valid.'; end if;

  v_faktor := v_selisih / v_recipe.yield_qty;

  -- Hasilnya: selisihnya saja.
  insert into stock_movements (business_unit_id, outlet_id, product_id, movement_type, qty_delta, production_id, notes, created_by)
  values (r_run.business_unit_id, r_run.outlet_id, r_run.product_id, 'production', v_selisih, p_run,
          'Koreksi produksi', auth.uid());

  -- Bahannya: selisih pemakaiannya, dengan tanda yang berlawanan.
  --
  -- CATATAN PENTING: resep yang dipakai adalah resep YANG BERLAKU SEKARANG,
  -- bukan yang berlaku saat produksinya dicatat — resepnya tidak diarsipkan
  -- per produksi. Kalau resepnya sempat diubah di antara keduanya, koreksinya
  -- memakai takaran baru dan hasilnya tidak akan cocok. Itu batas yang
  -- diketahui, dan alasan kenapa koreksi paling baik dilakukan pada hari yang
  -- sama.
  for r in select ingredient_product_id, qty from recipe_items where recipe_id = v_recipe.id loop
    insert into stock_movements (business_unit_id, outlet_id, product_id, movement_type, qty_delta, production_id, notes, created_by)
    values (r_run.business_unit_id, r_run.outlet_id, r.ingredient_product_id, 'usage', -(r.qty * v_faktor), p_run,
            'Koreksi produksi', auth.uid());
  end loop;
end $$;

-- ---------------------------------------------------------
-- BATALKAN — balik seluruh stoknya.
-- ---------------------------------------------------------
create or replace function hapus_produksi(p_run uuid, p_alasan text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r_run production_runs%rowtype;
  v_recipe recipes%rowtype;
  v_faktor numeric;
  r record;
begin
  select * into r_run from production_runs where id = p_run;
  if r_run.id is null then raise exception 'Produksi tidak ditemukan.'; end if;
  if r_run.cancelled_at is not null then raise exception 'Produksi ini sudah dibatalkan.'; end if;
  if not boleh_ubah_produksi(p_run) then
    raise exception 'Kamu hanya boleh menghapus produksi yang kamu catat sendiri hari ini. Selebihnya lewat Admin BU.';
  end if;

  select * into v_recipe from recipes where product_id = r_run.product_id and mode = 'production';
  if v_recipe.id is null then raise exception 'Produk ini sudah tidak punya resep produksi — pembatalannya harus lewat Opname.'; end if;
  if v_recipe.yield_qty is null or v_recipe.yield_qty <= 0 then raise exception 'Yield resep tidak valid.'; end if;

  v_faktor := r_run.output_qty / v_recipe.yield_qty;

  -- Hasil produksinya dikembalikan (negatif).
  insert into stock_movements (business_unit_id, outlet_id, product_id, movement_type, qty_delta, production_id, notes, created_by)
  values (r_run.business_unit_id, r_run.outlet_id, r_run.product_id, 'production', -r_run.output_qty, p_run,
          'Batal produksi' || coalesce(' — ' || nullif(p_alasan, ''), ''), auth.uid());

  -- Bahannya dikembalikan (positif).
  for r in select ingredient_product_id, qty from recipe_items where recipe_id = v_recipe.id loop
    insert into stock_movements (business_unit_id, outlet_id, product_id, movement_type, qty_delta, production_id, notes, created_by)
    values (r_run.business_unit_id, r_run.outlet_id, r.ingredient_product_id, 'usage', r.qty * v_faktor, p_run,
            'Batal produksi' || coalesce(' — ' || nullif(p_alasan, ''), ''), auth.uid());
  end loop;

  update production_runs
  set cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = nullif(p_alasan, '')
  where id = p_run;
end $$;

revoke all on function boleh_ubah_produksi(uuid) from public;
revoke all on function ubah_produksi(uuid, numeric, text) from public;
revoke all on function hapus_produksi(uuid, text) from public;
grant execute on function boleh_ubah_produksi(uuid) to authenticated;
grant execute on function ubah_produksi(uuid, numeric, text) to authenticated;
grant execute on function hapus_produksi(uuid, text) to authenticated;

notify pgrst, 'reload schema';
