-- =========================================================
-- Berjaya Hub OMS — Bagian 2: Tema & Logo per Business Unit
-- =========================================================

alter table business_units add column theme_color text not null default '#1f7a5c';
alter table business_units add column logo_url text;

-- Bucket publik buat logo BU (logo bukan data sensitif, jadi cukup public
-- read supaya gampang ditampilkan di <img> tanpa perlu signed URL)
insert into storage.buckets (id, name, public)
values ('bu-logos', 'bu-logos', true)
on conflict (id) do nothing;

-- Path konvensi: {business_unit_id}/logo.jpg — hanya admin BU terkait yang boleh upload
create policy bu_logo_insert on storage.objects
  for insert with check (
    bucket_id = 'bu-logos'
    and is_bu_admin(auth.uid(), (storage.foldername(name))[1]::uuid)
  );

create policy bu_logo_update on storage.objects
  for update using (
    bucket_id = 'bu-logos'
    and is_bu_admin(auth.uid(), (storage.foldername(name))[1]::uuid)
  );
