import { supabase } from '../../config/supabase-client.js';

export function getGeolocation() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null), // staff tetap bisa absen walau lokasi ditolak/gagal
      { timeout: 5000 }
    );
  });
}

/** Jarak dalam meter antara 2 titik koordinat (Haversine), dipakai untuk cek geofence di sisi client. */
export function distanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export async function getOutletGeofence(outletId) {
  const { data, error } = await supabase
    .from('outlets')
    .select('id, name, latitude, longitude, geofence_radius_m')
    .eq('id', outletId)
    .single();
  if (error) throw error;
  return data;
}

export async function setOutletLocation(outletId, { latitude, longitude, geofence_radius_m }) {
  const { error } = await supabase
    .from('outlets')
    .update({ latitude, longitude, geofence_radius_m })
    .eq('id', outletId);
  if (error) throw error;
}

export async function listOutletsWithGeofence(businessUnitId) {
  const { data, error } = await supabase
    .from('outlets')
    .select('id, name, latitude, longitude, geofence_radius_m')
    .eq('business_unit_id', businessUnitId)
    .order('name');
  if (error) throw error;
  return data ?? [];
}

/** Sesi presensi yang masih terbuka (belum clock out) milik user yang login, kalau ada. */
export async function getMyOpenSession() {
  const { data, error } = await supabase
    .from('attendance_records')
    .select('*')
    .is('clock_out_at', null)
    .order('clock_in_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getMyRecentAttendance(limit = 10) {
  const { data, error } = await supabase
    .from('attendance_records')
    .select('id, clock_in_at, clock_out_at, outlets(name)')
    .order('clock_in_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

export async function clockIn({ userId, businessUnitId, outletId, location, isStoring }) {
  const loc = location !== undefined ? location : await getGeolocation();
  const { data, error } = await supabase
    .from('attendance_records')
    .insert({
      user_id: userId,
      business_unit_id: businessUnitId,
      outlet_id: outletId,
      clock_in_lat: loc?.lat ?? null,
      clock_in_lng: loc?.lng ?? null,
      is_storing: !!isStoring
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function clockOut(recordId) {
  const loc = await getGeolocation();
  const { error } = await supabase
    .from('attendance_records')
    .update({
      clock_out_at: new Date().toISOString(),
      clock_out_lat: loc?.lat ?? null,
      clock_out_lng: loc?.lng ?? null
    })
    .eq('id', recordId);
  if (error) throw error;
}

// ---- Admin ----

export async function listAttendanceForAdmin({ businessUnitId, outletId, dateFrom, dateTo }) {
  let query = supabase
    .from('attendance_records')
    .select('id, clock_in_at, clock_out_at, clock_in_lat, clock_in_lng, clock_out_lat, clock_out_lng, notes, is_storing, user_profiles(full_name), outlets(id, name)')
    .eq('business_unit_id', businessUnitId)
    .order('clock_in_at', { ascending: false })
    .limit(200);

  if (outletId) query = query.eq('outlet_id', outletId);
  if (dateFrom) query = query.gte('clock_in_at', dateFrom);
  if (dateTo) query = query.lte('clock_in_at', dateTo);

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function correctAttendanceRecord(id, { clock_in_at, clock_out_at, notes }) {
  const { error } = await supabase
    .from('attendance_records')
    .update({ clock_in_at, clock_out_at, notes })
    .eq('id', id);
  if (error) throw error;
}
