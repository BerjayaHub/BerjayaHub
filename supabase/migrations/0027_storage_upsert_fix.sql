-- =========================================================
-- Berjaya Hub OMS — 0027
-- Perbaikan upload foto (selfie presensi, lampiran cuti, foto ceklis, bukti kas).
--
-- Masalah: upload memakai `upsert: true`, sehingga Storage juga memeriksa izin
-- UPDATE pada storage.objects — padahal policy yang dibuat sebelumnya hanya
-- INSERT + SELECT. Akibatnya muncul error "new row violates row-level security
-- policy" walau barisnya baru, dan (di presensi) record sempat tersimpan tanpa foto.
--
-- Sekalian memperbaiki policy SELECT selfie presensi yang tidak pernah cocok:
-- storage.foldername() hanya mengembalikan bagian FOLDER (tanpa nama file),
-- jadi (storage.foldername(name))[2] selalu null untuk path "{outlet}/{file}".
-- =========================================================

-- ---- Selfie presensi ----
drop policy if exists attendance_selfie_update on storage.objects;
create policy attendance_selfie_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'attendance-selfies'
    and exists (select 1 from membership_scopes ms where ms.user_id = auth.uid())
  )
  with check (
    bucket_id = 'attendance-selfies'
    and exists (select 1 from membership_scopes ms where ms.user_id = auth.uid())
  );

drop policy if exists attendance_selfie_select on storage.objects;
create policy attendance_selfie_select on storage.objects
  for select using (
    bucket_id = 'attendance-selfies'
    and (
      is_admin_of_outlet(auth.uid(), (storage.foldername(name))[1]::uuid)
      or exists (
        select 1 from attendance_records ar
        where ar.user_id = auth.uid()
          and (ar.clock_in_photo_path = storage.objects.name or ar.clock_out_photo_path = storage.objects.name)
      )
    )
  );

-- ---- Lampiran cuti ----
drop policy if exists leave_attach_update on storage.objects;
create policy leave_attach_update on storage.objects
  for update to authenticated
  using (bucket_id = 'leave-attachments' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'leave-attachments' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---- Foto ceklis kebersihan ----
drop policy if exists checklist_photo_update on storage.objects;
create policy checklist_photo_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'checklist-photos'
    and exists (select 1 from membership_scopes ms where ms.user_id = auth.uid())
  )
  with check (
    bucket_id = 'checklist-photos'
    and exists (select 1 from membership_scopes ms where ms.user_id = auth.uid())
  );

-- ---- Bukti kas ----
drop policy if exists cash_proof_update on storage.objects;
create policy cash_proof_update on storage.objects
  for update to authenticated
  using (bucket_id = 'cash-proofs' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'cash-proofs' and (storage.foldername(name))[1] = auth.uid()::text);
