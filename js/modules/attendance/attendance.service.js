import { supabase } from '../../config/supabase-client.js';

function getGeolocation() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null), // staff tetap bisa absen walau lokasi ditolak/gagal
      { timeout: 5000 }
    );
  });
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

export async function clockIn({ userId, businessUnitId, outletId }) {
  const loc = await getGeolocation();
  const { data, error } = await supabase
    .from('attendance_records')
    .insert({
      user_id: userId,
      business_unit_id: businessUnitId,
      outlet_id: outletId,
      clock_in_lat: loc?.lat ?? null,
      clock_in_lng: loc?.lng ?? null
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
    .select('id, clock_in_at, clock_out_at, notes, user_profiles(full_name), outlets(id, name)')
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
