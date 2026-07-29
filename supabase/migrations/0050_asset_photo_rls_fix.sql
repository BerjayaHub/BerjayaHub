-- 0050_asset_photo_rls_fix.sql
--
-- BUG: mengunggah foto aset selalu gagal.
--
-- PENYEBAB — ketergantungan melingkar. Policy SELECT di 0045 berbunyi
-- "boleh dibaca kalau ada baris `assets` yang photo_path-nya sama dengan nama
-- objek ini". Tapi urutan penyimpanannya adalah: simpan baris aset -> unggah
-- foto -> BARU isi photo_path. Jadi pada detik file diunggah, `photo_path`
-- masih NULL dan tidak ada satu baris pun yang cocok — objek yang baru saja
-- ditulis tidak bisa dibaca oleh pengunggahnya sendiri, dan Storage
-- menggagalkan operasinya.
--
-- Membalik urutan (isi photo_path dulu, unggah belakangan) BUKAN perbaikan yang
-- benar: kalau unggahannya gagal, database menyimpan path ke file yang tidak
-- pernah ada, dan tabelnya akan terlihat wajar sampai ada yang menekan "Lihat".
--
-- PERBAIKAN: samakan dengan seluruh bucket lain di repo ini (`attendance-selfies`,
-- `bu-logos`) — izinnya ditentukan oleh PREFIX PATH, bukan oleh kolom yang baru
-- ditulis kemudian. Path foto aset adalah `{outlet_id}/{asset_id}.{ext}`, jadi
-- folder pertamanya persis outlet pemiliknya dan izinnya bisa dinilai sebelum
-- baris apa pun diperbarui.

drop policy if exists asset_photo_insert on storage.objects;
drop policy if exists asset_photo_update on storage.objects;
drop policy if exists asset_photo_select on storage.objects;
drop policy if exists asset_photo_delete on storage.objects;

-- Penjaga bentuk path. Tanpa ini, objek dengan nama folder yang bukan UUID
-- membuat cast di bawah GAGAL TOTAL — dan errornya menjatuhkan seluruh query,
-- bukan sekadar menolak satu baris.
create or replace function asset_photo_outlet(p_name text)
returns uuid
language sql
immutable
as $$
  select case
    when p_name ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/'
      then split_part(p_name, '/', 1)::uuid
    else null
  end;
$$;

create policy asset_photo_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'asset-photos'
    and has_outlet_scope(auth.uid(), asset_photo_outlet(name))
  );

-- UPDATE dibutuhkan karena unggahnya memakai upsert (menimpa foto lama aset yang sama).
create policy asset_photo_update on storage.objects
  for update to authenticated
  using (bucket_id = 'asset-photos' and has_outlet_scope(auth.uid(), asset_photo_outlet(name)))
  with check (bucket_id = 'asset-photos' and has_outlet_scope(auth.uid(), asset_photo_outlet(name)));

create policy asset_photo_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'asset-photos'
    and has_outlet_scope(auth.uid(), asset_photo_outlet(name))
  );

create policy asset_photo_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'asset-photos'
    and is_admin_of_outlet(auth.uid(), asset_photo_outlet(name))
  );
