-- =========================================================
-- 0088 — Daily Activities: super admin tidak bisa MEMULAI sesi
--
-- ============ GEJALANYA ============
--
-- "Sepertinya hanya staff yang bisa mengisi Daily Activities."
--
-- Yang sebenarnya terjadi lebih sempit dan lebih membingungkan daripada itu:
-- **super_admin tidak bisa menjadi ORANG PERTAMA** yang mengisi sebuah sesi
-- pada hari itu. Kalau staff sudah memulainya, super_admin BISA menambahkan
-- item — karena penambahan item dijaga policy lain (`0071`) yang memakai
-- `has_outlet_scope()`.
--
-- Jadi gejalanya berubah-ubah tergantung siapa yang kebetulan mengisi lebih
-- dulu. Itu sebabnya ia terbaca sebagai "role lain tidak bisa isi".
--
-- ============ SEBABNYA ============
--
-- `checklist_runs_insert_own` dari `0016` menuliskan syaratnya sendiri, bukan
-- memakai tangga wewenang yang sudah ada:
--
--     and exists (
--       select 1 from membership_scopes ms
--       where ms.user_id = auth.uid()
--         and ms.business_unit_id = checklist_runs.business_unit_id
--     )
--
-- Itu menuntut baris keanggotaan DI BU ITU PERSIS. Untuk staff, bu_admin, dan
-- outlet_admin syarat itu terpenuhi dengan sendirinya. Untuk **super_admin
-- tidak**: wewenangnya berlaku lintas BU, tapi baris `membership_scopes`-nya
-- tetap menunjuk satu BU tertentu. Mengisi aktivitas di BU lain langsung
-- ditolak.
--
-- `has_bu_scope()` (0001) sudah menangani ini dengan benar sejak awal —
-- ia memang memberi super_admin akses ke BU mana pun. Policy ini hanya tidak
-- memakainya.
--
-- ============ PELAJARANNYA ============
--
-- Policy yang menyalin logika keanggotaan alih-alih memanggil helper-nya akan
-- selalu ketinggalan. Ada 55+ policy yang memakai `has_bu_scope`/`is_bu_admin`;
-- yang ini salah satu dari sedikit yang menulis `exists (...)` sendiri, dan
-- justru itu yang menyimpang.
--
-- `has_bu_scope()` DIPAKAI APA ADANYA — fungsinya tidak disentuh sama sekali.
--
-- Aman dijalankan ulang.
-- =========================================================

drop policy if exists checklist_runs_insert_own on checklist_runs;

create policy checklist_runs_insert_own on checklist_runs
  for insert with check (
    -- Tetap wajib atas nama sendiri: yang dilonggarkan wewenang BU-nya, bukan
    -- kepemilikan barisnya. Tanpa syarat ini, siapa pun bisa membuat run atas
    -- nama orang lain, dan rekap "siapa mengerjakan apa" kehilangan artinya.
    user_id = auth.uid()
    and has_bu_scope(auth.uid(), business_unit_id)
  );

comment on policy checklist_runs_insert_own on checklist_runs is
  'Siapa pun yang punya akses ke BU ini boleh MEMULAI sesi atas namanya sendiri — termasuk super_admin lintas BU (diperbaiki di 0088). Menambahkan item ke sesi yang sudah ada diatur checklist_run_items_insert_outlet (0071).';

-- ---------------------------------------------------------
-- YANG SUDAH BENAR DAN TIDAK PERLU DISENTUH — dicatat supaya tidak
-- "diperbaiki" lagi oleh yang berikutnya:
--
--   - MELIHAT run rekan satu outlet  -> `checklist_runs_select_outlet` (0068)
--   - MENAMBAH item ke run orang lain -> `checklist_run_items_insert_outlet` (0071)
--   - Foto bukti per item             -> policy storage berbasis
--                                        `has_outlet_scope` (0052)
--
-- Ketiganya sudah memakai tangga wewenang yang benar, jadi super_admin dan
-- admin mana pun sudah lolos di situ. Satu-satunya yang tertinggal adalah
-- INSERT run baru di atas.
--
-- Saya sempat menulis di migration ini bahwa sisi `select` juga rusak. Itu
-- keliru — `0068` sudah menanganinya, dengan definisi yang persis sama.
-- Dibiarkan tercatat di sini karena penjelasan yang salah mengirim orang
-- membetulkan hal yang tidak rusak.
-- ---------------------------------------------------------

notify pgrst, 'reload schema';
