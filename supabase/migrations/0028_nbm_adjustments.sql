-- =========================================================
-- Berjaya Hub OMS — 0028
-- Penyesuaian manual nominal NBM oleh admin (override) per baris presensi.
-- NBM dihitung otomatis dari presensi + pengaturan; tabel ini menyimpan
-- nominal hasil koreksi admin beserta jejak siapa yang mengedit.
-- =========================================================

create table nbm_adjustments (
  attendance_record_id uuid primary key references attendance_records(id) on delete cascade,
  business_unit_id uuid not null references business_units(id) on delete cascade,
  amount numeric not null,
  note text,
  edited_by uuid references user_profiles(id) on delete set null,
  edited_at timestamptz not null default now()
);
create index idx_nbm_adjustments_bu on nbm_adjustments(business_unit_id);

alter table nbm_adjustments enable row level security;

-- Anggota BU boleh baca (staff hanya melihat lewat rekap admin), admin BU kelola.
create policy nbm_adjustments_select on nbm_adjustments
  for select using (has_bu_scope(auth.uid(), business_unit_id));

create policy nbm_adjustments_modify on nbm_adjustments
  for all using (is_bu_admin(auth.uid(), business_unit_id))
  with check (is_bu_admin(auth.uid(), business_unit_id));
