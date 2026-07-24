-- =========================================================
-- Berjaya Hub OMS — 0012
-- RPC untuk auto-deteksi lokasi presensi lintas-outlet.
-- Staff biasa hanya bisa SELECT outlet dalam scope-nya (RLS), padahal deteksi
-- lokasi butuh koordinat SEMUA outlet Berjaya. Function security-definer ini
-- mengembalikan info geofence semua outlet aktif untuk keperluan deteksi saja
-- (id, nama, BU, koordinat, radius) — tanpa data sensitif lain.
-- Idempotent.
-- =========================================================

create or replace function list_attendance_outlets()
returns table (
  id uuid,
  name text,
  business_unit_id uuid,
  business_unit_name text,
  latitude double precision,
  longitude double precision,
  geofence_radius_m integer
)
language sql
security definer
stable
set search_path = public
as $$
  select o.id, o.name, o.business_unit_id, bu.name, o.latitude, o.longitude, o.geofence_radius_m
  from outlets o
  join business_units bu on bu.id = o.business_unit_id
  where o.is_active
  order by bu.name, o.name;
$$;

grant execute on function list_attendance_outlets() to authenticated;

-- ---------------------------------------------------------
-- Selfie presensi: karena staff kini boleh absen di outlet mana pun,
-- longgarkan juga INSERT foto selfie -> cukup member aktif (upload atas
-- record miliknya sendiri tetap dijaga oleh RLS attendance_records).
-- Policy SELECT foto tidak diubah (admin outlet fisik / pemilik record).
-- ---------------------------------------------------------
drop policy if exists attendance_selfie_insert on storage.objects;
create policy attendance_selfie_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'attendance-selfies'
    and exists (select 1 from membership_scopes ms where ms.user_id = auth.uid())
  );
