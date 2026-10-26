-- =========================================================
-- 0171 — FOTO ACUAN ITEM: OUTLET YANG BELUM MENDATA IKUT MELIHAT BARANGNYA
--
-- Daftar aset satu outlet sekarang memuat SELURUH item BU, termasuk yang
-- outlet itu belum pernah mendatanya. Untuk item seperti itu yang terlihat
-- cuma kode dan nama — dan "Botol kris" tidak memberi tahu siapa pun botol
-- yang mana. Dua outlet lalu mendata dua barang berbeda dengan nama yang sama,
-- yaitu persis masalah yang master se-BU ini ada untuk menyelesaikan.
--
-- Sesudah ini, foto dari outlet yang SUDAH mendatanya dipakai sebagai acuan,
-- sampai outlet itu memotret barangnya sendiri.
--
-- ============ MENUNJUK, BUKAN MENYALIN ============
--
-- Yang disimpan di `asset_items.photo_path` adalah PENUNJUK ke berkas milik
-- satu outlet — bukan salinan berkasnya.
--
-- Menyalin berarti satu foto jadi lima berkas di storage, dan lima berkas itu
-- menyimpang begitu yang aslinya diganti: outlet yang belum mendata akan
-- melihat barang yang sudah tidak ada lagi bentuknya. Penunjuk selalu
-- menampilkan yang terbaru, dan tidak memakan kuota.
--
-- Bisa dibaca lintas outlet karena 0154 sudah membuka foto aset se-BU
-- (`asset_photo_bu`). Tanpa 0154 berkas ini tidak akan berguna: penunjuknya
-- benar, tapi outlet lain tetap ditolak saat membukanya.
--
-- ============ PENUNJUK YANG MENGGANTUNG HARUS DIBERESKAN ============
--
-- Kalau baris stok yang memiliki fotonya dihapus — atau fotonya diganti —
-- penunjuknya berhenti menunjuk apa pun. Yang terlihat bukan galat, melainkan
-- gambar yang gagal dimuat: terbaca seperti "barangnya belum difoto", padahal
-- fotonya ada dan sedang dilihat outlet sebelah.
--
-- Karena itu penunjuknya DIHITUNG ULANG oleh trigger setiap kali foto mana pun
-- berubah, bukan ditulis sekali lalu dipercaya.
-- =========================================================

alter table asset_items add column if not exists photo_path text;
alter table asset_items add column if not exists photo_outlet_id uuid references outlets(id) on delete set null;

comment on column asset_items.photo_path is
  'PENUNJUK ke foto milik salah satu outlet, dipakai sebagai acuan oleh outlet yang belum mendata item ini. Bukan salinan; dihitung ulang oleh trigger.';
comment on column asset_items.photo_outlet_id is
  'Outlet pemilik foto acuan. Ditampilkan supaya yang melihat tahu itu foto outlet lain, bukan barangnya sendiri.';

-- ---------------------------------------------------------
-- Hitung ulang penunjuk foto sebuah item.
--
-- Dipilih foto TERTUA yang masih ada. Bukan terbaru: outlet yang baru memotret
-- tidak otomatis "lebih benar", dan acuan yang berganti-ganti tiap ada outlet
-- memotret membuat barang yang sama terlihat berbeda tiap minggu.
-- ---------------------------------------------------------
create or replace function segarkan_foto_item_aset(p_item uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update asset_items i
     set photo_path = s.photo_path,
         photo_outlet_id = s.outlet_id
    from (
      select photo_path, outlet_id
        from asset_stock
       where asset_item_id = p_item
         and btrim(coalesce(photo_path, '')) <> ''
       order by created_at, id
       limit 1
    ) s
   where i.id = p_item
     and (i.photo_path is distinct from s.photo_path or i.photo_outlet_id is distinct from s.outlet_id);

  -- Tidak ada satu pun foto yang tersisa: penunjuknya DIKOSONGKAN.
  --
  -- Membiarkannya menunjuk berkas yang sudah tidak ada menghasilkan gambar
  -- yang selalu gagal dimuat — dan itu terbaca sebagai "belum difoto", bukan
  -- sebagai tautan rusak. "-" yang jujur mengalahkan gambar yang pasti gagal.
  update asset_items i
     set photo_path = null, photo_outlet_id = null
   where i.id = p_item
     and i.photo_path is not null
     and not exists (
       select 1 from asset_stock s
        where s.asset_item_id = p_item and btrim(coalesce(s.photo_path, '')) <> ''
     );
$$;

create or replace function trg_segarkan_foto_item()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform segarkan_foto_item_aset(old.asset_item_id);
    return old;
  end if;
  perform segarkan_foto_item_aset(new.asset_item_id);
  -- Baris lama bisa menjadi milik item LAIN sesudah digabung/dipindah; itemnya
  -- yang ditinggalkan juga perlu dihitung ulang, kalau tidak ia tetap menunjuk
  -- foto yang sekarang milik orang lain.
  if tg_op = 'UPDATE' and new.asset_item_id is distinct from old.asset_item_id then
    perform segarkan_foto_item_aset(old.asset_item_id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_foto_item_aset on asset_stock;
create trigger trg_foto_item_aset
  after insert or delete or update of photo_path, asset_item_id on asset_stock
  for each row execute function trg_segarkan_foto_item();

-- ---------------------------------------------------------
-- Backfill: item yang sudah punya foto di salah satu outlet.
-- ---------------------------------------------------------
do $$
declare r record;
begin
  for r in select distinct asset_item_id from asset_stock where btrim(coalesce(photo_path, '')) <> '' loop
    perform segarkan_foto_item_aset(r.asset_item_id);
  end loop;
end $$;

notify pgrst, 'reload schema';
