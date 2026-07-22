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

export async function clockIn({ userId, businessUnitId, outletId, location, isStoring, exitMethod, exitReason, exitOtpCodeId }) {
  const loc = location !== undefined ? location : await getGeolocation();
  const { data, error } = await supabase
    .from('attendance_records')
    .insert({
      user_id: userId,
      business_unit_id: businessUnitId,
      outlet_id: outletId,
      clock_in_lat: loc?.lat ?? null,
      clock_in_lng: loc?.lng ?? null,
      is_storing: !!isStoring,
      exit_method: isStoring ? exitMethod ?? null : null,
      exit_reason: isStoring ? exitReason ?? null : null,
      exit_otp_code_id: isStoring ? exitOtpCodeId ?? null : null
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function clockOut(recordId, { photoPath } = {}) {
  const loc = await getGeolocation();
  const { error } = await supabase
    .from('attendance_records')
    .update({
      clock_out_at: new Date().toISOString(),
      clock_out_lat: loc?.lat ?? null,
      clock_out_lng: loc?.lng ?? null,
      ...(photoPath ? { clock_out_photo_path: photoPath } : {})
    })
    .eq('id', recordId);
  if (error) throw error;
}

// ---- Selfie (Supabase Storage) ----

/** Upload foto selfie, path: {outlet_id}/{record_id}_{in|out}.jpg */
export async function uploadAttendanceSelfie({ outletId, recordId, kind, file }) {
  const path = `${outletId}/${recordId}_${kind}.jpg`;
  const { error } = await supabase.storage.from('attendance-selfies').upload(path, file, {
    upsert: true,
    contentType: file.type || 'image/jpeg'
  });
  if (error) throw error;
  return path;
}

export async function setClockInPhoto(recordId, path) {
  const { error } = await supabase.from('attendance_records').update({ clock_in_photo_path: path }).eq('id', recordId);
  if (error) throw error;
}

export async function getSignedPhotoUrl(path) {
  if (!path) return null;
  const { data, error } = await supabase.storage.from('attendance-selfies').createSignedUrl(path, 600);
  if (error) throw error;
  return data?.signedUrl ?? null;
}

// ---- Tugas keluar: mode & OTP ----

export async function getExitTaskMode(businessUnitId) {
  const { data, error } = await supabase
    .from('business_units')
    .select('exit_task_mode')
    .eq('id', businessUnitId)
    .single();
  if (error) throw error;
  return data?.exit_task_mode ?? 'storing';
}

export async function setExitTaskMode(businessUnitId, mode) {
  const { error } = await supabase.from('business_units').update({ exit_task_mode: mode }).eq('id', businessUnitId);
  if (error) throw error;
}

/** Staff coba pakai kode OTP. Return id kode kalau valid, null kalau salah/expired/sudah dipakai. */
export async function redeemExitOtp(code, businessUnitId) {
  const { data, error } = await supabase.rpc('redeem_exit_otp', {
    p_code: code,
    p_business_unit_id: businessUnitId
  });
  if (error) throw error;
  return data; // uuid | null
}

/** Admin generate kode OTP baru (default berlaku 15 menit). */
export async function generateExitOtp(businessUnitId, validMinutes = 15) {
  const code = String(Math.floor(100000 + Math.random() * 900000)); // 6 digit
  const expiresAt = new Date(Date.now() + validMinutes * 60000).toISOString();
  const { data, error } = await supabase
    .from('exit_task_otp_codes')
    .insert({ business_unit_id: businessUnitId, code, expires_at: expiresAt })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function listRecentExitOtp(businessUnitId, limit = 10) {
  const { data, error } = await supabase
    .from('exit_task_otp_codes')
    .select('id, code, expires_at, used_at, created_at, used_by, user_profiles!exit_task_otp_codes_used_by_fkey(full_name)')
    .eq('business_unit_id', businessUnitId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

// ---- Reverse geocoding (OpenStreetMap Nominatim, gratis) ----

const geocodeCache = new Map();

export async function reverseGeocode(lat, lng) {
  const key = `${lat.toFixed(5)},${lng.toFixed(5)}`;
  if (geocodeCache.has(key)) return geocodeCache.get(key);

  const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=0`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error('Gagal mengambil alamat.');
  const json = await res.json();
  const address = json.display_name ?? 'Alamat tidak ditemukan';
  geocodeCache.set(key, address);
  return address;
}

export async function listAttendanceForAdmin({ businessUnitId, outletId, dateFrom, dateTo }) {
  let query = supabase
    .from('attendance_records')
    .select('id, clock_in_at, clock_out_at, clock_in_lat, clock_in_lng, clock_out_lat, clock_out_lng, notes, is_storing, exit_method, exit_reason, clock_in_photo_path, clock_out_photo_path, user_profiles(full_name), outlets(id, name)')
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
