-- 0052_checklist_photo_per_item.sql
--
-- Daily Activities: foto bukti kini PER ITEM AKTIVITAS, bukan satu foto untuk
-- seluruh sesi. Satu foto tidak bisa membuktikan sepuluh pekerjaan berbeda —
-- yang terjadi selama ini, foto itu praktis hanya membuktikan "seseorang hadir".
--
-- `checklist_runs.photo_path` SENGAJA TIDAK DIHAPUS. Kolomnya tidak dipakai
-- lagi untuk pengisian baru, tapi data lama tetap harus bisa dibuka di rekap.
-- Menghapus kolomnya berarti membuang riwayat yang mungkin masih diperlukan
-- untuk audit, demi kerapian yang tidak seberapa.

alter table checklist_run_items add column photo_path text;

comment on column checklist_run_items.photo_path is
  'Foto bukti untuk item ini. Path: {outlet_id}/{run_id}/{item_id}.{ext}';
comment on column checklist_runs.photo_path is
  'USANG sejak 0052 — foto kini per item di checklist_run_items.photo_path. Dipertahankan agar data lama tetap terbaca.';

-- ---------------------------------------------------------
-- STORAGE
--
-- Policy SELECT lama berbunyi "boleh dibaca kalau ada checklist_runs yang
-- photo_path-nya sama dengan nama objek ini". Itu masalah yang PERSIS sama
-- dengan bug foto aset di 0050: izinnya bergantung pada kolom yang baru diisi
-- SETELAH file diunggah, sehingga objek yang baru ditulis tidak bisa dibaca
-- oleh pengunggahnya sendiri. Sekarang dengan foto per item, path-nya juga
-- bertambah satu tingkat ({outlet}/{run}/{item}) dan pola lama makin tidak
-- memadai.
--
-- Diganti ke pola yang dipakai seluruh bucket lain: izin dinilai dari PREFIX
-- PATH, yaitu outlet_id di folder pertama — yang sudah pasti sebelum baris apa
-- pun diperbarui.
-- ---------------------------------------------------------

drop policy if exists checklist_photo_insert on storage.objects;
drop policy if exists checklist_photo_select on storage.objects;
drop policy if exists checklist_photo_update on storage.objects;
drop policy if exists checklist_photo_delete on storage.objects;

-- Penjaga bentuk path: folder pertama harus UUID. Tanpa ini, satu objek
-- bernama aneh membuat cast GAGAL dan errornya menjatuhkan seluruh query,
-- bukan sekadar menolak baris itu.
create or replace function checklist_photo_outlet(p_name text)
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

create policy checklist_photo_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'checklist-photos'
    and has_outlet_scope(auth.uid(), checklist_photo_outlet(name))
  );

create policy checklist_photo_update on storage.objects
  for update to authenticated
  using (bucket_id = 'checklist-photos' and has_outlet_scope(auth.uid(), checklist_photo_outlet(name)))
  with check (bucket_id = 'checklist-photos' and has_outlet_scope(auth.uid(), checklist_photo_outlet(name)));

create policy checklist_photo_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'checklist-photos'
    and has_outlet_scope(auth.uid(), checklist_photo_outlet(name))
  );

create policy checklist_photo_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'checklist-photos'
    and is_admin_of_outlet(auth.uid(), checklist_photo_outlet(name))
  );
