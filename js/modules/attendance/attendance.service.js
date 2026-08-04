import { supabase } from '../../config/supabase-client.js';
import { compressImage } from '../../core/image-compress.js';
import { getMyBaseScope } from '../../core/base-scope.js';

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
    .select('id, name, latitude, longitude, geofence_radius_m, clock_in_time, clock_out_time, reminder_enabled')
    .eq('business_unit_id', businessUnitId)
    .order('name');
  if (error) throw error;
  return data ?? [];
}

/** Atur jam kerja outlet (dipakai buat reminder clock in) + on/off reminder-nya. */
export async function setOutletWorkHours(outletId, { clock_in_time, clock_out_time, reminder_enabled }) {
  const { error } = await supabase
    .from('outlets')
    .update({ clock_in_time: clock_in_time || null, clock_out_time: clock_out_time || null, reminder_enabled })
    .eq('id', outletId);
  if (error) throw error;
}

/**
 * ID user yang sedang login.
 *
 * PENTING: query "milik saya" WAJIB menyaring user_id secara eksplisit dan
 * TIDAK boleh menggantungkan diri pada RLS. RLS presensi sengaja mengizinkan
 * ADMIN membaca baris staff lain (untuk rekap & koreksi), jadi query tanpa
 * filter akan mengembalikan baris ORANG LAIN untuk akun ber-role admin —
 * persis penyebab bug "admin terlihat sudah clock in padahal belum".
 */
async function currentUserId() {
  const {
    data: { user }
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

/** Sesi presensi yang masih terbuka (belum clock out) milik user yang login, kalau ada. */
export async function getMyOpenSession() {
  const uid = await currentUserId();
  if (!uid) return null;
  const { data, error } = await supabase
    .from('attendance_records')
    .select('*')
    .eq('user_id', uid)
    .is('clock_out_at', null)
    .order('clock_in_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * Sesi presensi milik user HARI INI (WIB), terbuka maupun sudah clock out.
 * Dipakai untuk memastikan clock-in cuma sekali sehari: kalau hari ini sudah
 * ada baris (walau sudah clock out), staff tidak boleh clock-in lagi.
 */
export async function getMyTodaySession() {
  const uid = await currentUserId();
  if (!uid) return null;
  // Awal hari waktu Jakarta (WIB, UTC+7), dihitung tanpa bergantung timezone device.
  const now = new Date();
  const wib = new Date(now.getTime() + 7 * 3600 * 1000);
  const startWibUtc = new Date(Date.UTC(wib.getUTCFullYear(), wib.getUTCMonth(), wib.getUTCDate(), 0, 0, 0) - 7 * 3600 * 1000);
  const { data, error } = await supabase
    .from('attendance_records')
    .select('*')
    .eq('user_id', uid)
    .gte('clock_in_at', startWibUtc.toISOString())
    .order('clock_in_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getMyRecentAttendance(limit = 10) {
  const uid = await currentUserId();
  if (!uid) return [];
  const { data, error } = await supabase
    .from('attendance_records')
    // Nama outlet diresolusi di UI (list_attendance_outlets), karena outlet BU lain
    // tidak terbaca lewat RLS `outlets_select`.
    .select('id, clock_in_at, clock_out_at, outlet_id')
    .eq('user_id', uid)
    .order('clock_in_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

/** Daftar semua outlet aktif (lintas BU) beserta koordinat geofence, untuk auto-deteksi lokasi. */
export async function listAttendanceOutlets() {
  const { data, error } = await supabase.rpc('list_attendance_outlets');
  if (error) throw error;
  return data ?? [];
}

/**
 * Basis NBM staff = scope yang ditandai "tempat kerja utama" di Master User.
 * Kalau belum ada yang ditandai, pakai fallback (BU/outlet aktif dari shell).
 */
export async function getMyNbmBase(fallback = {}) {
  // Alias. Logikanya pindah ke core/base-scope.js karena kini dipakai tiga
  // modul (presensi, cuti, shift) — bukan lagi khusus NBM. Nama lama
  // dipertahankan supaya pemanggil lama tidak perlu diubah serentak.
  return getMyBaseScope(fallback);
}

export async function clockIn({
  userId,
  businessUnitId,
  outletId,
  nbmBusinessUnitId,
  nbmOutletId,
  location,
  isStoring,
  exitMethod,
  exitReason,
  exitOtpCodeId,
  faceMatch,
  photoPath,
  shiftId,
  shiftName,
  lateMinutes,
  lateStatus
}) {
  const loc = location !== undefined ? location : await getGeolocation();
  const { data, error } = await supabase
    .from('attendance_records')
    .insert({
      user_id: userId,
      business_unit_id: businessUnitId,
      outlet_id: outletId,
      clock_in_photo_path: photoPath ?? null,
      shift_id: shiftId ?? null,
      shift_name: shiftName ?? null,
      late_minutes: lateMinutes ?? null,
      late_status: lateStatus ?? null,
      nbm_business_unit_id: nbmBusinessUnitId ?? businessUnitId,
      nbm_outlet_id: nbmOutletId ?? null,
      clock_in_lat: loc?.lat ?? null,
      clock_in_lng: loc?.lng ?? null,
      is_storing: !!isStoring,
      exit_method: isStoring ? exitMethod ?? null : null,
      exit_reason: isStoring ? exitReason ?? null : null,
      exit_otp_code_id: isStoring ? exitOtpCodeId ?? null : null,
      clock_in_face_match: faceMatch === undefined ? null : faceMatch
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function clockOut(recordId, { photoPath, faceMatch } = {}) {
  const loc = await getGeolocation();
  const { error } = await supabase
    .from('attendance_records')
    .update({
      clock_out_at: new Date().toISOString(),
      clock_out_lat: loc?.lat ?? null,
      clock_out_lng: loc?.lng ?? null,
      ...(photoPath ? { clock_out_photo_path: photoPath } : {}),
      clock_out_face_match: faceMatch === undefined ? null : faceMatch
    })
    .eq('id', recordId);
  if (error) throw error;
}

// ---- Face recognition ----

/** Descriptor wajah acuan milik staff yang login, null kalau belum daftar. */
export async function getMyFaceDescriptor() {
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from('user_face_descriptors')
    .select('descriptor')
    .eq('user_id', user.id)
    .maybeSingle();
  if (error) throw error;
  return data?.descriptor ?? null;
}

/** Simpan/perbarui descriptor wajah acuan milik staff yang login. */
export async function saveMyFaceDescriptor(descriptor) {
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Sesi tidak ditemukan, silakan login ulang.');
  const { error } = await supabase
    .from('user_face_descriptors')
    .upsert({ user_id: user.id, descriptor, updated_at: new Date().toISOString() });
  if (error) throw error;
}

/** Admin: cek apakah staff tertentu sudah daftar wajah (dipakai di Master User). */
export async function listRegisteredFaceUserIds() {
  const { data, error } = await supabase.from('user_face_descriptors').select('user_id');
  if (error) throw error;
  return new Set((data ?? []).map((r) => r.user_id));
}

/** Admin: reset (hapus) descriptor wajah staff, supaya staff daftar ulang. */
export async function resetFaceDescriptor(userId) {
  const { error } = await supabase.from('user_face_descriptors').delete().eq('user_id', userId);
  if (error) throw error;
}

// ---- Selfie (Supabase Storage) ----

/**
 * Upload foto selfie ke bucket privat. Path: {outlet_id}/{key}_{in|out}.jpg
 * `key` boleh berupa record id (lama) atau id acak (dipakai saat foto diunggah
 * SEBELUM record dibuat, supaya tidak ada presensi tersimpan tanpa foto).
 */
export async function uploadAttendanceSelfie({ outletId, recordId, key, kind, file }) {
  const id = key ?? recordId ?? (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()));
  // Selfie presensi adalah penyumbang storage TERBESAR: 2 foto/orang/hari, dan
  // tumbuh setiap hari selamanya. Tanpa kompresi, 20 staff sudah menghabiskan
  // free tier 1 GB dalam hitungan hari.
  const kecil = await compressImage(file, { preset: 'selfie' });
  const ext = kecil.type === 'image/webp' ? 'webp' : 'jpg';
  // Bagian `{id}_{kind}` HARUS dipertahankan — policy RLS bucket ini membaca
  // id record lewat split_part(..., '_', 1). Ekstensinya bebas.
  const path = `${outletId}/${id}_${kind}.${ext}`;
  const { error } = await supabase.storage.from('attendance-selfies').upload(path, kecil, {
    upsert: false,
    contentType: kecil.type || 'image/jpeg'
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

/**
 * Riwayat presensi untuk Admin Portal.
 *
 * Disaring berdasarkan **BU BASIS** staff (nbm_business_unit_id), bukan BU lokasi
 * absen. Jadi staff BU Admin yang absen di outlet Central Kitchen (BU Cafe) tetap
 * masuk rekap BU Admin, sementara kolom Outlet tetap menampilkan lokasi fisiknya.
 * Baris lama yang belum punya basis di-fallback ke business_unit_id.
 */
export async function listAttendanceForAdmin({ businessUnitId, outletId, dateFrom, dateTo }) {
  let query = supabase
    .from('attendance_records')
    // CATATAN: nama outlet/BU lokasi TIDAK di-embed di sini. RLS `outlets_select`
    // & `business_units_select` hanya mengizinkan baris dalam scope user, jadi
    // untuk presensi di outlet BU lain embed-nya akan balik null ("-").
    // Nama outlet diresolusi di UI lewat RPC `list_attendance_outlets` (security definer).
    // `user_id` WAJIB ikut: dipakai UI untuk mencocokkan penanda 🔕 (status
    // langganan push). Tanpa kolom ini pencocokannya meleset diam-diam dan
    // SEMUA staff ditandai belum mengaktifkan notifikasi.
    .select('id, user_id, clock_in_at, clock_out_at, clock_in_lat, clock_in_lng, clock_out_lat, clock_out_lng, notes, is_storing, exit_method, exit_reason, clock_in_photo_path, clock_out_photo_path, clock_in_face_match, clock_out_face_match, shift_name, late_minutes, late_status, business_unit_id, nbm_business_unit_id, nbm_outlet_id, nbm_outlet_note, outlet_id, user_profiles(full_name)')
    .or(`nbm_business_unit_id.eq.${businessUnitId},and(nbm_business_unit_id.is.null,business_unit_id.eq.${businessUnitId})`)
    .order('clock_in_at', { ascending: false })
    .limit(200);

  if (outletId) query = query.eq('outlet_id', outletId);
  if (dateFrom) query = query.gte('clock_in_at', dateFrom);
  if (dateTo) query = query.lte('clock_in_at', dateTo);

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

/**
 * Data presensi untuk perhitungan NBM — difilter & dikelompokkan berdasarkan
 * BU/outlet BASIS (tempat kerja utama), bukan lokasi absen fisik. Membawa
 * kedua info outlet: nbm_outlet (basis, untuk config NBM) & outlets (lokasi absen).
 */
export async function listAttendanceForNbm({ businessUnitId, outletId, dateFrom, dateTo }) {
  let query = supabase
    .from('attendance_records')
    .select(
      // outlets!outlet_id (lokasi absen) bisa null kalau outletnya milik BU lain
      // (RLS outlets_select). Nama lokasi diresolusi di UI via list_attendance_outlets.
      'id, clock_in_at, clock_out_at, is_storing, business_unit_id, nbm_business_unit_id, outlet_id, nbm_outlet_id, nbm_outlet_note, user_profiles(full_name), nbm_outlet:outlets!nbm_outlet_id(id, name)'
    )
    .eq('nbm_business_unit_id', businessUnitId)
    .order('clock_in_at', { ascending: false })
    .limit(500);

  if (outletId) query = query.eq('nbm_outlet_id', outletId);
  if (dateFrom) query = query.gte('clock_in_at', dateFrom);
  if (dateTo) query = query.lte('clock_in_at', dateTo);

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

/**
 * Aktivitas presensi terbaru LINTAS-BU untuk dashboard admin. Tidak difilter
 * per BU — RLS otomatis membatasi ke yang boleh dilihat admin (super_admin: semua).
 * Paginasi lewat offset/limit.
 */
export async function listRecentAttendanceActivity({ limit = 25, before = null } = {}) {
  let query = supabase
    .from('attendance_records')
    .select('clock_in_at, clock_out_at, is_storing, user_profiles(full_name), outlets!outlet_id(name), business_units!business_unit_id(name)')
    .order('clock_in_at', { ascending: false })
    .limit(limit);
  if (before) query = query.lt('clock_in_at', before);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

/**
 * Koreksi OUTLET BASIS satu baris presensi.
 *
 * Lewat RPC, bukan update langsung: pemeriksaan izinnya GANDA — admin di outlet
 * tempat absen DAN di outlet basis tujuan. Kalau hanya salah satu, admin outlet
 * A bisa memindahkan beban gaji seseorang ke outlet B yang bukan tanggung
 * jawabnya, dan admin B tidak akan pernah tahu angkanya bertambah dari mana.
 * Aturan sekompleks itu tidak bisa diungkapkan lewat policy RLS biasa.
 */
export async function koreksiOutletBasis(recordId, outletId, note) {
  const { error } = await supabase.rpc('koreksi_outlet_basis', {
    p_record: recordId,
    p_outlet: outletId,
    p_note: note
  });
  if (error) throw error;
}

/**
 * Koreksi massal untuk satu orang dalam rentang tanggal.
 * `dryRun: true` hanya MENGHITUNG, tidak mengubah apa pun — dipakai untuk
 * memperlihatkan akibatnya sebelum admin menekan lanjut.
 */
export async function koreksiOutletBasisMassal({ userId, from, to, outletId, note, dryRun = true }) {
  const { data, error } = await supabase.rpc('koreksi_outlet_basis_massal', {
    p_user: userId,
    p_from: from,
    p_to: to,
    p_outlet: outletId,
    p_note: note ?? '',
    p_dry_run: dryRun
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return { terpengaruh: Number(row?.terpengaruh ?? 0), dilewati: Number(row?.dilewati ?? 0) };
}

export async function correctAttendanceRecord(id, { clock_in_at, clock_out_at, notes }) {
  const { error } = await supabase
    .from('attendance_records')
    .update({ clock_in_at, clock_out_at, notes })
    .eq('id', id);
  if (error) throw error;
}

// ---- Push notification subscriptions (reminder clock in) ----

export async function getMyPushSubscriptionEndpoints() {
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await supabase.from('push_subscriptions').select('endpoint').eq('user_id', user.id);
  if (error) throw error;
  return (data ?? []).map((r) => r.endpoint);
}

/**
 * Admin: siapa saja yang sudah punya langganan push (untuk penanda 🔕 di rekap).
 *
 * Lewat RPC security-definer, bukan select langsung: RLS `push_subscriptions`
 * sengaja hanya membuka baris milik sendiri, karena endpoint push itu rahasia.
 * RPC-nya hanya mengembalikan id + jumlah, tidak pernah endpoint-nya.
 *
 * Gagal = kembalikan `null`, BUKAN Map kosong. Bedanya penting: Map kosong
 * berarti "sudah dicek, memang belum ada yang mengaktifkan" — dan UI akan
 * menandai semua orang 🔕. Kalau RPC-nya sendiri yang gagal (misal migration
 * 0047 belum dijalankan), menampilkan 🔕 untuk semua orang adalah alarm palsu.
 * `null` menyuruh UI diam saja. Rekap presensi juga tidak boleh ikut gagal
 * tampil hanya karena penanda pelengkap ini bermasalah.
 */
export async function listPushEnabledUserIds() {
  const { data, error } = await supabase.rpc('list_push_enabled_user_ids');
  if (error) {
    console.warn('[presensi] status langganan push tidak bisa dibaca:', error.message);
    return null;
  }
  return new Map((data ?? []).map((r) => [r.user_id, r.subscription_count]));
}

export async function savePushSubscription(userId, subscription) {
  const json = subscription.toJSON();
  const { error } = await supabase.from('push_subscriptions').upsert(
    {
      user_id: userId,
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth_key: json.keys.auth
    },
    { onConflict: 'endpoint' }
  );
  if (error) throw error;
}

export async function deletePushSubscription(endpoint) {
  const { error } = await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint);
  if (error) throw error;
}
