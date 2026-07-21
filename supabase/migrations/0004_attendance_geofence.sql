-- =========================================================
-- Berjaya Hub OMS — Fase 2 (tambahan): Geofencing Presensi
-- =========================================================

alter table outlets add column latitude double precision;
alter table outlets add column longitude double precision;
alter table outlets add column geofence_radius_m integer not null default 100;

-- Hitung jarak (meter) antara 2 titik koordinat pakai formula Haversine
create or replace function distance_meters(
  lat1 double precision, lng1 double precision,
  lat2 double precision, lng2 double precision
)
returns double precision
language sql
immutable
as $$
  select 6371000 * acos(
    least(1.0, greatest(-1.0,
      cos(radians(lat1)) * cos(radians(lat2)) * cos(radians(lng2) - radians(lng1))
      + sin(radians(lat1)) * sin(radians(lat2))
    ))
  );
$$;

-- Cek apakah titik (p_lat, p_lng) berada dalam radius outlet.
-- Kalau outlet belum di-set koordinatnya (lat/lng null), geofence dianggap
-- belum aktif untuk outlet itu -> selalu boleh (supaya outlet lama gak
-- mendadak error sebelum admin sempat isi lokasinya).
create or replace function is_within_outlet_geofence(
  p_outlet_id uuid, p_lat double precision, p_lng double precision
)
returns boolean
language plpgsql
stable
as $$
declare
  o_lat double precision;
  o_lng double precision;
  o_radius integer;
begin
  select latitude, longitude, geofence_radius_m into o_lat, o_lng, o_radius
  from outlets where id = p_outlet_id;

  if o_lat is null or o_lng is null then
    return true; -- geofence belum diaktifkan untuk outlet ini
  end if;

  if p_lat is null or p_lng is null then
    return false; -- outlet minta geofence tapi staff gak kirim lokasi
  end if;

  return distance_meters(p_lat, p_lng, o_lat, o_lng) <= o_radius;
end;
$$;

-- Perketat policy insert presensi: staff harus berada dalam radius outlet
-- (kalau outlet itu sudah di-set geofence-nya)
drop policy attendance_insert_own on attendance_records;

create policy attendance_insert_own on attendance_records
  for insert with check (
    user_id = auth.uid()
    and exists (
      select 1 from membership_scopes ms
      where ms.user_id = auth.uid()
        and ms.business_unit_id = attendance_records.business_unit_id
        and (ms.outlet_id = attendance_records.outlet_id or ms.outlet_id is null)
    )
    and is_within_outlet_geofence(outlet_id, clock_in_lat, clock_in_lng)
  );
