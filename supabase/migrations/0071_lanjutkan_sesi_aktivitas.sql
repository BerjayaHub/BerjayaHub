-- =========================================================
-- 0071 — Sesi aktivitas bisa DILANJUTKAN, bukan terkunci oleh satu item
--
-- MASALAHNYA APA
-- `checklist_runs` punya `unique (outlet_id, session_id, run_date)`: satu sesi
-- hanya boleh punya SATU run per hari. Sementara halaman staff hanya menuntut
-- "centang minimal satu item".
--
-- Gabungan keduanya melahirkan jebakan: staff yang mengerjakan 1 dari 15 item
-- lalu menekan Kirim akan menutup sesi itu untuk SEHARIAN PENUH. Kartunya
-- berubah jadi "✅ Selesai", 14 item sisanya tidak bisa diisi oleh siapa pun,
-- dan rekapnya menyatakan sesi itu beres. Tidak ada error, tidak ada peringatan
-- — justru itu yang membuatnya berbahaya: laporan yang salah terlihat rapi.
--
-- YANG DIUBAH DI SINI
-- `checklist_runs` berhenti berarti "sekali kerja" dan menjadi WADAH untuk satu
-- sesi pada satu hari. Yang mencatat pekerjaan adalah barisnya di
-- `checklist_run_items`, dan tiap baris kini membawa SIAPA dan KAPAN sendiri.
--
-- Konsekuensi yang disengaja: rekan satu outlet boleh melanjutkan sesi yang
-- ditinggalkan (pergantian shift adalah hal biasa), dan tiap item tetap
-- tercatat atas nama pengerjanya masing-masing — bukan atas nama orang pertama
-- yang kebetulan menekan Kirim.
-- =========================================================

-- ---------------------------------------------------------
-- (1) Siapa mengerjakan item ini, dan kapan
-- ---------------------------------------------------------
alter table checklist_run_items add column if not exists done_by uuid references user_profiles(id);
alter table checklist_run_items add column if not exists done_at timestamptz not null default now();

comment on column checklist_run_items.done_by is
  'Pengerja item INI. Bisa berbeda dari checklist_runs.user_id sejak 0071 — sesi boleh dilanjutkan rekan satu outlet.';

-- Baris lama belum punya pengerja per item; diisi dari pembuat run-nya, yang
-- memang orang yang mengerjakannya waktu itu.
update checklist_run_items ri
set done_by = cr.user_id
from checklist_runs cr
where cr.id = ri.run_id and ri.done_by is null;

-- ---------------------------------------------------------
-- (2) Satu item hanya boleh dicatat sekali per run
--
-- Ini yang membuat "lanjutkan" aman: item yang sudah punya bukti tidak bisa
-- ditimpa diam-diam oleh pengiriman berikutnya. Penolakannya berupa error yang
-- terlihat, bukan bukti yang tergantikan tanpa jejak.
-- ---------------------------------------------------------
create unique index if not exists uq_checklist_run_item on checklist_run_items(run_id, item_id);

-- ---------------------------------------------------------
-- (3) Rekan satu outlet boleh MENAMBAH item ke run yang sudah ada
--
-- Hanya INSERT. Mengubah & menghapus tetap milik pembuatnya dan admin outlet
-- (policy 0016 tidak disentuh): melanjutkan pekerjaan orang lain itu wajar,
-- menyunting buktinya sama sekali bukan hal yang sama.
-- ---------------------------------------------------------
drop policy if exists checklist_run_items_insert_outlet on checklist_run_items;
create policy checklist_run_items_insert_outlet on checklist_run_items
  for insert with check (
    done_by = auth.uid()
    and exists (
      select 1 from checklist_runs cr
      where cr.id = checklist_run_items.run_id
        and has_outlet_scope(auth.uid(), cr.outlet_id)
    )
  );

comment on table checklist_runs is
  'Wadah satu sesi Daily Activities pada satu hari (sejak 0071). Pekerjaannya dicatat per baris di checklist_run_items, masing-masing dengan pengerjanya sendiri.';
