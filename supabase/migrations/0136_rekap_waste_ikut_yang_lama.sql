-- =========================================================
-- Berjaya Hub OMS — 0136
-- Rekap waste ikut menampilkan catatan SEBELUM foto diwajibkan.
--
-- =========================================================
-- BUG YANG DIPERBAIKI, DAN SAYA YANG MEMBUATNYA
-- =========================================================
--
-- `0135` menulis, di kepala berkasnya sendiri:
--
--   "Baris waste LAMA tidak disentuh: triggernya hanya berlaku untuk insert
--    baru. Menyembunyikan sejarah yang sudah ada akan terbaca sebagai data
--    yang hilang."
--
-- lalu membangun `waste_rekap` yang HANYA membaca `waste_runs`. Waste yang
-- dicatat sebelum 0135 hidup di `stock_movements` dengan `waste_run_id` kosong,
-- dan tidak punya satu pun jalan masuk ke view itu.
--
-- Laporannya:
--
--   "di riwayat saya cek ada waste, sedangkan di tab spoil/waste yang baru
--    kamu buat tidak ada ... admin tetap perlu data ini walaupun tidak ada foto"
--
-- Bentuk kegagalan yang paling sering berulang di repo ini, dan kali ini
-- lengkap dengan komentar yang memperingatkannya di berkas yang sama.
--
-- =========================================================
-- DIGABUNG DI VIEW, BUKAN DIPINDAHKAN DATANYA
-- =========================================================
--
-- Godaan pertamanya adalah membuat `waste_runs` untuk tiap baris lama
-- (backfill). Itu menuntut `photo_path` boleh kosong — dan `photo_path not
-- null` adalah lapis pertama dari tiga lapis yang membuat "foto wajib" berarti
-- sesuatu. Melonggarkannya demi data lama berarti membuka kembali pintu untuk
-- data BARU tanpa foto, selamanya, demi kenyamanan sekali.
--
-- Jadi datanya tidak disentuh sama sekali. Yang diperluas cuma viewnya.
--
-- =========================================================
-- KETERANGANNYA DIBACA DARI CATATANNYA
-- =========================================================
--
-- Baris lama tidak menyimpan "ini spoil atau waste menu" di kolom mana pun.
-- Yang ada cuma `notes`, dan untungnya bentuknya konsisten karena ditulis
-- kode — bukan diketik orang:
--
--   0032 record_menu_waste : 'Waste menu: ' || nama || ' x' || qty [|| ' — ' || catatan]
--   layar spoil lama       : 'Spoil: ' || catatan   (atau 'Spoil' saja)
--
-- Jadi jenisnya bisa dipulihkan, dan nama menunya ikut. Yang TIDAK bisa
-- dipulihkan cuma fotonya — dan memang tidak pernah ada.
--
-- =========================================================
-- MENGELOMPOKKAN KEMBALI SATU KEJADIAN
-- =========================================================
--
-- Satu waste menu lama melahirkan beberapa baris `stock_movements` tanpa apa
-- pun yang menyatakan mereka satu kejadian — itu persis alasan 0135 dibuat.
--
-- Tapi `now()` di Postgres adalah waktu MULAI TRANSAKSI, jadi seluruh baris
-- yang lahir dari satu perulangan `record_menu_waste` punya `created_at` yang
-- identik sampai mikrodetik, dan `notes` yang identik pula. Ketiganya
-- (outlet + waktu + catatan) cukup untuk menyusun ulang kelompoknya.
--
-- Itu tebakan yang JUJUR, bukan tebakan yang beruntung: kalau dua kejadian
-- berbeda kebetulan punya ketiganya sama persis, keduanya memang tidak bisa
-- dibedakan oleh data yang tersimpan.
-- =========================================================

create or replace view waste_rekap as
  -- ---- (a) Kejadian ber-dokumen (0135 dan sesudahnya) ----
  select w.id              as waste_id,
         w.business_unit_id,
         w.outlet_id,
         o.name            as outlet_nama,
         w.code,
         w.jenis,
         w.created_at,
         (w.created_at at time zone 'Asia/Jakarta')::date as tanggal,
         w.qty             as qty_kejadian,
         w.photo_path,
         w.notes,
         p.name            as sumber_nama,
         wi.product_id,
         b.name            as bahan_nama,
         b.base_unit       as bahan_satuan,
         wi.qty            as bahan_qty,
         u.full_name       as dicatat_oleh,
         false             as lama
    from waste_runs w
    join waste_items wi on wi.waste_id = w.id
    join outlets o      on o.id = w.outlet_id
    join products p     on p.id = w.product_id
    join products b     on b.id = wi.product_id
    left join user_profiles u on u.id = w.created_by

  union all

  -- ---- (b) Catatan lama, sebelum foto diwajibkan ----
  select
         -- Kunci kelompok yang deterministik. Baris-baris dari satu waste menu
         -- lama berbagi outlet + waktu + catatan, jadi mereka kembali jadi satu
         -- kejadian di hitungan rekapnya.
         md5(sm.outlet_id::text || sm.created_at::text || coalesce(sm.notes, ''))::uuid as waste_id,
         sm.business_unit_id,
         sm.outlet_id,
         o.name as outlet_nama,
         null::text as code,
         case when sm.notes like 'Waste menu: %' then 'menu' else 'spoil' end as jenis,
         sm.created_at,
         (sm.created_at at time zone 'Asia/Jakarta')::date as tanggal,
         -- Jumlah porsi menunya, dipulihkan dari catatannya. `.+` yang rakus
         -- menyisakan " x<angka>" yang TERAKHIR, jadi nama menu yang kebetulan
         -- memuat " x2" tidak memotong namanya di tempat yang salah.
         case
           when sm.notes like 'Waste menu: %'
             then nullif(substring(sm.notes from '^Waste menu: .+ x([0-9]+(?:[.,][0-9]+)?)'), '')::numeric
           else abs(sm.qty_delta)
         end as qty_kejadian,
         null::text as photo_path,
         -- Catatan yang DIKETIK ORANG saja; awalan yang ditulis kode dibuang
         -- supaya kolomnya tidak mengulang isi kolom Keterangan.
         case
           when sm.notes like 'Waste menu: %' then nullif(substring(sm.notes from ' — (.*)$'), '')
           when sm.notes like 'Spoil: %'      then nullif(substring(sm.notes from '^Spoil: (.*)$'), '')
           else nullif(sm.notes, 'Spoil')
         end as notes,
         case
           when sm.notes like 'Waste menu: %'
             then coalesce(nullif(substring(sm.notes from '^Waste menu: (.+) x[0-9]'), ''), '(menu tidak tercatat)')
           else b.name
         end as sumber_nama,
         sm.product_id,
         b.name      as bahan_nama,
         b.base_unit as bahan_satuan,
         abs(sm.qty_delta) as bahan_qty,
         u.full_name as dicatat_oleh,
         true        as lama
    from stock_movements sm
    join outlets o  on o.id = sm.outlet_id
    join products b on b.id = sm.product_id
    left join user_profiles u on u.id = sm.created_by
   where sm.movement_type = 'waste'
     and sm.waste_run_id is null;

comment on view waste_rekap is
  'Satu baris per BAHAN yang berkurang, dari dokumen waste (0135) DAN dari catatan lama sebelum foto diwajibkan. Kolom `lama` menandai yang kedua — fotonya memang tidak pernah ada, bukan hilang.';

alter view waste_rekap set (security_invoker = true);
grant select on waste_rekap to authenticated;

-- ---------------------------------------------------------
-- Laporkan hasilnya, beserta berapa baris lama yang tadinya tidak terlihat.
-- ---------------------------------------------------------
do $$
declare
  v_lama int;
  v_baru int;
begin
  select count(*) into v_lama from waste_rekap where lama;
  select count(*) into v_baru from waste_rekap where not lama;
  raise notice 'baris waste lama yang sekarang ikut terlihat: %', v_lama;
  raise notice 'baris waste berdokumen (berfoto): %', v_baru;
end $$;
