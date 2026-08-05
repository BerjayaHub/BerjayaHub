-- =========================================================
-- 0068 — Daily Activities: satu outlet melihat pekerjaan satu sama lain
--
-- MASALAH YANG DITEMUKAN
-- `checklist_runs_select_own` (0016) hanya membuka baris MILIK SENDIRI untuk
-- staff biasa. Akibatnya bukan sekadar "tidak bisa lihat teman":
--
--   `getTodayDoneSessions()` menghitung sesi yang sudah selesai dengan membaca
--   checklist_runs untuk outlet itu — tapi RLS memotongnya jadi "punya saya
--   saja". Jadi sesi yang SUDAH dikerjakan rekannya tetap tampil **"Belum"**
--   bagi staff lain, dan dia mengerjakannya lagi. Dua run untuk sesi yang sama,
--   dua set foto, dan tidak ada satu pun pesan yang menjelaskan.
--
-- Yang aneh, foto buktinya SUDAH boleh dilihat satu outlet sejak 0052
-- (`checklist_photo_select` memakai `has_outlet_scope`). Jadi selama ini
-- fotonya terbuka tapi catatan pekerjaannya tidak — dua policy untuk satu hal
-- yang sama, dan yang lebih ketat justru yang menentukan.
--
-- Daily Activities adalah pekerjaan BERSAMA satu outlet, bukan catatan pribadi
-- seperti pengajuan cuti. Yang bekerja di outlet itu berhak tahu apa yang sudah
-- dikerjakan, oleh siapa, dan jam berapa.
-- =========================================================

-- `has_outlet_scope()` (0001) sudah SECURITY DEFINER, jadi aman dipakai di
-- dalam ekspresi policy: subquery biasa di sini akan ikut disaring RLS
-- membership_scopes dan selalu bernilai false untuk orang yang justru ingin
-- kita izinkan.
drop policy if exists checklist_runs_select_outlet on checklist_runs;
create policy checklist_runs_select_outlet on checklist_runs
  for select using (has_outlet_scope(auth.uid(), outlet_id));

drop policy if exists checklist_run_items_select_outlet on checklist_run_items;
create policy checklist_run_items_select_outlet on checklist_run_items
  for select using (
    exists (
      select 1 from checklist_runs cr
      where cr.id = checklist_run_items.run_id
        and has_outlet_scope(auth.uid(), cr.outlet_id)
    )
  );

-- CATATAN: hanya SELECT yang dibuka. Mengubah/menghapus tetap milik pembuatnya
-- dan admin outlet (policy 0016 tidak disentuh) — melihat pekerjaan orang lain
-- adalah transparansi, menyuntingnya adalah hal yang sama sekali berbeda.

comment on table checklist_runs is
  'Satu pengerjaan sesi Daily Activities. Sejak 0068 terbaca oleh semua staff outlet itu, bukan hanya pembuatnya.';
