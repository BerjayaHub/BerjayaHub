-- =========================================================
-- 0069 — Item aktivitas bisa berbeda per SESI
--
-- SEBELUMNYA: setiap sesi (Pagi, Siang, Malam) menampilkan SELURUH item aktif
-- outlet itu. Padahal ceklis buka toko dan ceklis tutup toko memang beda
-- pekerjaannya — memaksa keduanya memakai daftar yang sama membuat staff
-- mencentang seadanya, dan ceklis yang dicentang seadanya tidak membuktikan
-- apa pun.
--
-- BENTUK RELASINYA: banyak-ke-banyak, bukan kolom `session_id` di
-- `checklist_items`. Item seperti "Cek stok" wajar muncul di sesi pagi DAN
-- malam; dengan satu kolom, item itu harus digandakan — dan dua item kembar
-- berarti dua riwayat terpisah untuk satu pekerjaan yang sama.
--
-- ATURAN YANG PENTING — "tanpa baris = berlaku di semua sesi":
-- Item yang TIDAK punya satu pun baris di tabel ini dianggap berlaku untuk
-- semua sesi. Itu persis perilaku hari ini, jadi seluruh data lama tetap
-- bekerja tanpa satu baris pun dipindahkan. Penugasan bersifat menambah
-- kejelasan, bukan syarat baru yang mendadak mengosongkan ceklis orang.
--
-- Konsekuensinya harus disebut di layar: begitu sebuah item ditugaskan ke satu
-- sesi, ia BERHENTI muncul di sesi lain. Aturan implisit yang tidak dijelaskan
-- adalah cara tercepat membuat admin mengira itemnya hilang.
-- =========================================================

create table if not exists checklist_session_items (
  session_id uuid not null references checklist_sessions(id) on delete cascade,
  item_id uuid not null references checklist_items(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (session_id, item_id)
);

create index if not exists idx_csi_item on checklist_session_items(item_id);

alter table checklist_session_items enable row level security;

-- Baca: siapa pun yang boleh melihat sesinya. Tanpa ini staff tidak bisa tahu
-- item mana yang berlaku, dan ceklisnya akan tampil kosong — gagal senyap.
drop policy if exists csi_select on checklist_session_items;
create policy csi_select on checklist_session_items
  for select using (
    exists (
      select 1 from checklist_sessions cs
      where cs.id = checklist_session_items.session_id
        and has_bu_scope(auth.uid(), cs.business_unit_id)
    )
  );

-- Tulis: admin BU-nya, atau admin outlet kalau sesinya milik outlet itu.
-- `is_bu_admin` & `is_admin_of_outlet` keduanya SECURITY DEFINER — subquery
-- biasa di dalam policy ikut disaring RLS dan akan selalu bernilai false untuk
-- orang yang justru ingin diizinkan.
drop policy if exists csi_write on checklist_session_items;
create policy csi_write on checklist_session_items
  for all using (
    exists (
      select 1 from checklist_sessions cs
      where cs.id = checklist_session_items.session_id
        and (
          is_bu_admin(auth.uid(), cs.business_unit_id)
          or (cs.outlet_id is not null and is_admin_of_outlet(auth.uid(), cs.outlet_id))
        )
    )
  )
  with check (
    exists (
      select 1 from checklist_sessions cs
      where cs.id = checklist_session_items.session_id
        and (
          is_bu_admin(auth.uid(), cs.business_unit_id)
          or (cs.outlet_id is not null and is_admin_of_outlet(auth.uid(), cs.outlet_id))
        )
    )
  );

comment on table checklist_session_items is
  'Item mana berlaku di sesi mana. Item TANPA baris di sini berlaku di SEMUA sesi (perilaku sebelum 0069).';
