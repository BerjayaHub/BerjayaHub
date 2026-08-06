-- =========================================================
-- 0072 — Sesi lama juga harus bisa dilanjutkan
--
-- MASALAHNYA APA
-- `0071` membuat sesi bisa dilanjutkan dengan aturan sederhana: "ada baris di
-- checklist_run_items = item itu sudah dikerjakan". Aturan itu benar untuk data
-- BARU, karena sejak 0071 hanya item yang dikerjakan yang dicatat.
--
-- Tapi data LAMA tidak begitu. Versi sebelumnya menyimpan baris untuk SEMUA
-- item, termasuk yang tidak dicentang (`checked = false`, tanpa foto). Jadi
-- sesi yang benar-benar baru terisi 1 dari 6 item punya 6 baris — dan menurut
-- aturan 0071 ia terbaca "6 dari 6", tuntas, kartunya mati lagi.
--
-- Perbaikan 0071 benar; yang salah adalah asumsinya bahwa semua data mengikuti
-- bentuk baru. Persis jenis kesalahan yang paling mudah lolos: diuji dengan
-- data yang dibuat setelah perbaikannya.
--
-- YANG DIUBAH DI SINI
-- Untuk baris lama yang masih `checked = false`, melanjutkan berarti MEMPERBARUI
-- baris itu, bukan menyisipkan yang baru (`uq_checklist_run_item` akan menolak).
-- Policy ini mengizinkannya — dengan satu syarat keras: hanya baris yang BELUM
-- selesai. Bukti yang sudah ada tidak boleh ditimpa oleh siapa pun lewat jalur
-- ini.
-- =========================================================

-- ---------------------------------------------------------
-- Perbaikan untuk yang sempat menjalankan versi awal 0071
--
-- Versi awal file itu membuat `done_at` sebagai `not null default now()`,
-- sehingga SELURUH baris lama terisi jam migration dijalankan. Jam yang salah
-- tapi terlihat pasti lebih menyesatkan daripada jam yang kosong: tidak ada
-- yang akan curiga pada angka yang tampil rapi.
--
-- Baris yang `done_at`-nya justru LEBIH AWAL dari saat run-nya dibuat mustahil
-- benar, begitu pula yang terpaut lebih dari sehari — keduanya dikosongkan.
-- Baris yang dicatat aplikasi (selalu setelah run dibuat, di hari yang sama)
-- tidak tersentuh.
-- ---------------------------------------------------------
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_name = 'checklist_run_items' and column_name = 'done_at' and is_nullable = 'NO'
  ) then
    alter table checklist_run_items alter column done_at drop not null;
    alter table checklist_run_items alter column done_at drop default;
  end if;
end $$;

update checklist_run_items ri
set done_at = null
from checklist_runs cr
where cr.id = ri.run_id
  and ri.done_at is not null
  and (ri.done_at < cr.created_at or ri.done_at > cr.created_at + interval '1 day');

drop policy if exists checklist_run_items_update_belum_selesai on checklist_run_items;
create policy checklist_run_items_update_belum_selesai on checklist_run_items
  for update
  using (
    -- `checked = false` dievaluasi terhadap baris LAMA: hanya item yang belum
    -- dikerjakan yang boleh disentuh. Item yang sudah berbukti tidak akan
    -- pernah cocok dengan policy ini, jadi buktinya aman.
    checked = false
    and exists (
      select 1 from checklist_runs cr
      where cr.id = checklist_run_items.run_id
        and has_outlet_scope(auth.uid(), cr.outlet_id)
    )
  )
  with check (
    -- Dan hasilnya harus atas nama pengerjanya sendiri.
    done_by = auth.uid()
    and exists (
      select 1 from checklist_runs cr
      where cr.id = checklist_run_items.run_id
        and has_outlet_scope(auth.uid(), cr.outlet_id)
    )
  );

comment on column checklist_run_items.checked is
  'true = dikerjakan & wajib berfoto (0070). Baris false hanya berasal dari data sebelum 0071, dan boleh dilanjutkan (0072).';
