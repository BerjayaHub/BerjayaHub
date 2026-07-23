-- =========================================================
-- Berjaya Hub OMS — Fase 2 (tambahan): Face Recognition Presensi
-- =========================================================
-- Descriptor wajah (128 angka dari face-api.js) disimpan sebagai jsonb,
-- BUKAN foto wajah itu sendiri. Perbandingan wajah dilakukan di client
-- (browser) saat clock in/out; hasilnya (cocok/tidak) dikirim ke server
-- lewat kolom clock_in_face_match / clock_out_face_match di bawah.

-- ---------------------------------------------------------
-- USER_FACE_DESCRIPTORS
-- 1 user = 1 descriptor acuan (didaftarkan sendiri oleh staff saat
-- pertama kali mau clock in). Admin bisa reset (hapus) supaya staff
-- daftar ulang, misal karena ganti penampilan drastis.
-- ---------------------------------------------------------
create table user_face_descriptors (
  user_id uuid primary key references user_profiles(id) on delete cascade,
  descriptor jsonb not null,
  registered_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table user_face_descriptors enable row level security;

-- Staff boleh lihat & daftar/perbarui descriptor miliknya sendiri
create policy face_descriptor_select_own on user_face_descriptors
  for select using (user_id = auth.uid());

create policy face_descriptor_upsert_own on user_face_descriptors
  for insert with check (user_id = auth.uid());

create policy face_descriptor_update_own on user_face_descriptors
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Admin (bu_admin/outlet_admin/super_admin di scope manapun staff itu berada)
-- boleh lihat status registrasi & menghapusnya (reset) lewat Master User
create policy face_descriptor_select_admin on user_face_descriptors
  for select using (
    exists (
      select 1 from membership_scopes ms
      where ms.user_id = auth.uid()
        and ms.role in ('super_admin', 'bu_admin', 'outlet_admin')
    )
  );

create policy face_descriptor_delete_admin on user_face_descriptors
  for delete using (
    exists (
      select 1 from membership_scopes ms
      where ms.user_id = auth.uid()
        and ms.role in ('super_admin', 'bu_admin', 'outlet_admin')
    )
  );

-- ---------------------------------------------------------
-- Hasil pencocokan wajah per sesi presensi.
-- null   = tidak ada descriptor acuan untuk dibandingkan saat itu (belum daftar)
-- true   = wajah cocok dengan descriptor acuan
-- false  = wajah TIDAK cocok -> perlu review admin
-- ---------------------------------------------------------
alter table attendance_records add column clock_in_face_match boolean;
alter table attendance_records add column clock_out_face_match boolean;
