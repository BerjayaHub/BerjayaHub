-- =========================================================
-- 0076 — Item aktivitas bisa berlaku di BEBERAPA outlet
--
-- SEBELUMNYA hanya ada dua kemungkinan: seluruh outlet BU, atau satu outlet.
-- Kenyataannya di antara keduanya: "Serpong dan Sentul, tapi Central Kitchen
-- tidak". Satu-satunya jalan sebelum ini adalah menggandakan itemnya — dan dua
-- item bernama sama dengan riwayat terpisah membuat rekapnya tidak bisa
-- dijumlahkan tanpa tahu sejarah penggandaannya.
--
-- BENTUKNYA
-- `checklist_items.outlet_id` TETAP berarti "dikelola siapa", bukan sekadar
-- "berlaku di mana". Itu yang dipakai policy `checklist_items_modify` (0054)
-- untuk memutuskan apakah admin outlet boleh menyuntingnya, dan mengubah
-- artinya akan diam-diam melepas kendali itu.
--
-- Jadi:
--   * 1 outlet   -> `outlet_id = X`, tabel ini KOSONG untuk item itu.
--                   Perilaku lama, dan admin outlet X tetap bisa mengelolanya.
--   * >1 outlet  -> `outlet_id = NULL` + satu baris di sini per outlet.
--                   Dikelola admin BU — item yang menyentuh beberapa outlet
--                   bukan lagi urusan satu outlet saja.
--   * semua      -> `outlet_id = NULL`, tabel ini kosong. Perilaku lama.
--
-- Data lama tidak perlu dipindahkan sama sekali: tanpa baris di sini, aturannya
-- persis seperti sebelum migration ini.
-- =========================================================

create table if not exists checklist_item_outlets (
  item_id uuid not null references checklist_items(id) on delete cascade,
  outlet_id uuid not null references outlets(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (item_id, outlet_id)
);

create index if not exists idx_cio_outlet on checklist_item_outlets(outlet_id);

alter table checklist_item_outlets enable row level security;

-- Baca: siapa pun yang boleh melihat itemnya. Tanpa ini staff tidak tahu item
-- mana yang berlaku di outletnya, dan ceklisnya tampil kosong — gagal senyap.
drop policy if exists cio_select on checklist_item_outlets;
create policy cio_select on checklist_item_outlets
  for select using (
    exists (
      select 1 from checklist_items ci
      where ci.id = checklist_item_outlets.item_id
        and has_bu_scope(auth.uid(), ci.business_unit_id)
    )
  );

-- Tulis: HANYA admin BU pemilik itemnya.
--
-- Sengaja tidak diberikan ke admin outlet. Kalau diberikan, admin outlet Sentul
-- bisa menambahkan itemnya sendiri ke ceklis Serpong — mengubah pekerjaan orang
-- lain tanpa mereka tahu, dari layar yang sama sekali tidak menyebut Serpong.
drop policy if exists cio_write on checklist_item_outlets;
create policy cio_write on checklist_item_outlets
  for all using (
    exists (
      select 1 from checklist_items ci
      where ci.id = checklist_item_outlets.item_id
        and is_bu_admin(auth.uid(), ci.business_unit_id)
    )
  )
  with check (
    exists (
      select 1 from checklist_items ci
      join outlets o on o.id = checklist_item_outlets.outlet_id
      where ci.id = checklist_item_outlets.item_id
        and is_bu_admin(auth.uid(), ci.business_unit_id)
        -- Outlet tujuan harus BU yang sama. Tanpa syarat ini, admin BU bisa
        -- menyelipkan itemnya ke outlet BU lain — bukan sesuatu yang pernah
        -- dimaksudkan, dan tidak akan terlihat di layar mana pun.
        and o.business_unit_id = ci.business_unit_id
    )
  );

comment on table checklist_item_outlets is
  'Outlet mana saja yang memakai item ini. KOSONG = mengikuti checklist_items.outlet_id (satu outlet, atau semua outlet BU kalau NULL).';
