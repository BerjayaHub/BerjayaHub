-- 0048_module_tutorials.sql
--
-- Video tutorial per modul. Yang disimpan adalah ID video YouTube (11 karakter),
-- BUKAN URL mentah -- lihat catatan panjang di tutorial.service.js. Alasannya:
-- admin akan menempel bentuk apa saja (youtu.be/, watch?v=, /embed/, /shorts/),
-- dan menyimpan URL apa adanya berarti bentuk embed-nya harus ditebak ulang tiap
-- kali dirender. Diurai sekali saat menyimpan = link salah ketahuan saat itu
-- juga, bukan saat staff kebingungan membuka video kosong.
--
-- business_unit_id NULL = berlaku untuk SEMUA BU (global).
-- business_unit_id terisi = khusus BU itu, dan MENIMPA yang global untuk modul
-- yang sama. Pola pewarisan yang sama sudah dipakai kebijakan hari libur
-- (outlet mewarisi BU) -- sengaja dibuat konsisten supaya tidak ada aturan baru
-- yang harus diingat.

create table module_tutorials (
  id uuid primary key default gen_random_uuid(),
  module_code text not null references modules(code) on update cascade on delete cascade,
  business_unit_id uuid references business_units(id) on delete cascade,
  title text not null,
  youtube_id text not null,
  description text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_by uuid references user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- 11 karakter, alfanumerik + '-' + '_'. Dijaga di database juga, bukan hanya
  -- di JS: baris yang lolos lewat SQL Editor tetap harus valid.
  constraint module_tutorials_youtube_id_valid check (youtube_id ~ '^[A-Za-z0-9_-]{11}$'),
  constraint module_tutorials_title_isi check (length(btrim(title)) > 0)
);

create index idx_module_tutorials_lookup
  on module_tutorials (module_code, business_unit_id)
  where is_active;

alter table module_tutorials enable row level security;

-- BACA: siapa pun yang sudah login boleh melihat video global, plus video
-- khusus BU tempat dia punya scope. Tutorial bukan data rahasia -- justru
-- gunanya untuk dibaca sebanyak mungkin orang -- tapi video khusus BU lain
-- tetap tidak perlu bocor ke BU sebelah karena isinya bisa menyebut nama
-- outlet, harga, atau prosedur internal.
create policy module_tutorials_select_member on module_tutorials
  for select to authenticated
  using (
    business_unit_id is null
    or has_bu_scope(auth.uid(), business_unit_id)
  );

-- TULIS: super admin saja, sesuai keputusan. Ditulis sebagai tiga policy
-- terpisah (bukan `for all`) supaya jelas terbaca saat diaudit.
create policy module_tutorials_insert_super on module_tutorials
  for insert to authenticated
  with check (is_super_admin(auth.uid()));

create policy module_tutorials_update_super on module_tutorials
  for update to authenticated
  using (is_super_admin(auth.uid()))
  with check (is_super_admin(auth.uid()));

create policy module_tutorials_delete_super on module_tutorials
  for delete to authenticated
  using (is_super_admin(auth.uid()));

-- Modul "Tutorial" sendiri tidak didaftarkan di tabel `modules`: ia bukan modul
-- yang bisa diaktif/nonaktifkan per BU, melainkan menu tetap Admin Portal yang
-- hanya terlihat super admin -- sejajar dengan menu User, BU-Outlet, dan
-- Notifikasi Telegram.

comment on table module_tutorials is
  'Video tutorial per modul. business_unit_id NULL = global; terisi = override khusus BU itu.';
