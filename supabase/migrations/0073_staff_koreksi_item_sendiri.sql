-- =========================================================
-- 0073 — Staff boleh memperbaiki & menghapus ITEM YANG DIA KERJAKAN SENDIRI
--
-- KENAPA
-- Salah foto, salah item, foto buram — semuanya terjadi, dan sebelum ini
-- satu-satunya jalan keluar adalah membiarkannya. Bukti yang salah yang tidak
-- bisa dibetulkan bukan bukti yang lebih kuat; ia hanya membuat orang berhenti
-- menganggap serius seluruh ceklisnya.
--
-- BATASNYA — dan batas ini yang membuatnya tetap layak disebut bukti:
--   1. Hanya item yang DIA SENDIRI kerjakan (`done_by = auth.uid()`).
--      Memperbaiki pekerjaan orang lain bukan koreksi, itu penyuntingan.
--   2. Hanya pada HARI YANG SAMA (`run_date = hari ini WIB`).
--      Bukti kemarin yang masih bisa diubah hari ini sama saja dengan tidak
--      ada bukti — dan justru periode lampau itulah yang dibaca saat audit.
--
-- YANG DICABUT
-- Policy `checklist_run_items_all_own` (0016) memberi pemilik RUN kuasa penuh
-- atas SEMUA baris di dalamnya. Sejak 0071 satu run bisa berisi pekerjaan
-- beberapa orang, jadi policy itu kini berarti: siapa pun yang kebetulan
-- memulai sesi boleh menyunting dan menghapus bukti rekan-rekannya. Diganti
-- dengan izin per-baris yang lebih sempit.
-- =========================================================

drop policy if exists checklist_run_items_all_own on checklist_run_items;

-- INSERT sudah ditangani `checklist_run_items_insert_outlet` (0071):
-- siapa pun yang punya scope di outlet itu boleh menambahkan, atas namanya
-- sendiri. Tidak perlu policy insert lain.

-- UPDATE untuk memperbaiki pekerjaan SENDIRI, hari ini saja.
drop policy if exists checklist_run_items_update_own_item on checklist_run_items;
create policy checklist_run_items_update_own_item on checklist_run_items
  for update
  using (
    done_by = auth.uid()
    and exists (
      select 1 from checklist_runs cr
      where cr.id = checklist_run_items.run_id
        and cr.run_date = (now() at time zone 'Asia/Jakarta')::date
    )
  )
  with check (done_by = auth.uid());

-- DELETE dengan syarat yang sama. Menghapus mengembalikan item itu ke keadaan
-- "belum dikerjakan", sehingga bisa diulang dengan bukti yang benar.
drop policy if exists checklist_run_items_delete_own_item on checklist_run_items;
create policy checklist_run_items_delete_own_item on checklist_run_items
  for delete
  using (
    done_by = auth.uid()
    and exists (
      select 1 from checklist_runs cr
      where cr.id = checklist_run_items.run_id
        and cr.run_date = (now() at time zone 'Asia/Jakarta')::date
    )
  );

-- Admin outlet tetap bisa membereskan apa pun di outletnya, kapan pun —
-- termasuk setelah hari berganti. Ini yang membuat batas "hari ini" di atas
-- aman: kesalahan yang ketahuan terlambat tetap ada yang bisa membetulkan,
-- hanya saja lewat orang yang memang bertanggung jawab.
drop policy if exists checklist_run_items_write_admin on checklist_run_items;
create policy checklist_run_items_write_admin on checklist_run_items
  for all
  using (
    exists (
      select 1 from checklist_runs cr
      where cr.id = checklist_run_items.run_id and is_admin_of_outlet(auth.uid(), cr.outlet_id)
    )
  )
  with check (
    exists (
      select 1 from checklist_runs cr
      where cr.id = checklist_run_items.run_id and is_admin_of_outlet(auth.uid(), cr.outlet_id)
    )
  );

-- ---------------------------------------------------------
-- STORAGE: pemilik file boleh menghapus fotonya sendiri
--
-- Tanpa ini, menghapus barisnya meninggalkan file yatim yang memakan kuota
-- tanpa membuktikan apa pun — dan tidak ada satu pun jalan untuk
-- membersihkannya selain lewat admin.
-- ---------------------------------------------------------
drop policy if exists checklist_photo_delete_own on storage.objects;
create policy checklist_photo_delete_own on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'checklist-photos'
    and owner = auth.uid()
    and has_outlet_scope(auth.uid(), checklist_photo_outlet(name))
  );
