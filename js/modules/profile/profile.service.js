import { supabase } from '../../config/supabase-client.js';
import { compressImage } from '../../core/image-compress.js';

export const GENDER_OPTIONS = [
  { value: '', label: '-- pilih --' },
  { value: 'L', label: 'Laki-laki' },
  { value: 'P', label: 'Perempuan' }
];
export const MARITAL_OPTIONS = [
  { value: '', label: '-- pilih --' },
  { value: 'kawin', label: 'Kawin' },
  { value: 'belum_kawin', label: 'Belum Kawin' }
];
export const GENDER_LABEL = { L: 'Laki-laki', P: 'Perempuan' };
export const MARITAL_LABEL = { kawin: 'Kawin', belum_kawin: 'Belum Kawin' };

/** Kolom data staff (dipakai select & form). */
export const PROFILE_FIELDS = [
  'id',
  'full_name',
  'phone',
  'is_active',
  'ktp_name',
  'ktp_number',
  'gender',
  'ktp_address',
  'postal_code',
  'mother_name',
  'emergency_contact',
  'shirt_size',
  'pants_size',
  'shoe_size',
  'marital_status',
  'npwp',
  'photo_path'
].join(', ');

async function currentUserId() {
  const {
    data: { user }
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

export async function getMyProfile() {
  const uid = await currentUserId();
  if (!uid) return null;
  const { data, error } = await supabase.from('user_profiles').select(PROFILE_FIELDS).eq('id', uid).single();
  if (error) throw error;
  return data;
}

export async function getProfile(userId) {
  const { data, error } = await supabase.from('user_profiles').select(PROFILE_FIELDS).eq('id', userId).single();
  if (error) throw error;
  return data;
}

/** Data yang boleh diubah staff sendiri maupun admin (scope/role/BU diatur terpisah). */
export async function updateProfileData(userId, values) {
  const payload = {
    full_name: values.full_name,
    phone: values.phone || null,
    ktp_name: values.ktp_name || null,
    ktp_number: values.ktp_number || null,
    gender: values.gender || null,
    ktp_address: values.ktp_address || null,
    postal_code: values.postal_code || null,
    mother_name: values.mother_name || null,
    emergency_contact: values.emergency_contact || null,
    shirt_size: values.shirt_size || null,
    pants_size: values.pants_size || null,
    shoe_size: values.shoe_size || null,
    marital_status: values.marital_status || null,
    npwp: values.npwp || null
  };
  const { error } = await supabase.from('user_profiles').update(payload).eq('id', userId);
  if (error) throw error;
}

/** Upload foto staff (bucket privat 'staff-photos'), simpan path-nya. */
export async function uploadStaffPhoto(userId, file) {
  // Avatar selalu ditampilkan kecil, jadi 512px sudah lebih dari cukup.
  const kecil = await compressImage(file, { preset: 'avatar' });
  const ext = kecil.type === 'image/webp' ? 'webp' : kecil.type === 'image/png' ? 'png' : 'jpg';
  const path = `${userId}/photo.${ext}`;
  const { error: upErr } = await supabase.storage.from('staff-photos').upload(path, kecil, {
    upsert: true,
    contentType: kecil.type || 'image/jpeg'
  });
  if (upErr) throw upErr;
  const { error } = await supabase.from('user_profiles').update({ photo_path: path }).eq('id', userId);
  if (error) throw error;

  // `upsert` hanya menimpa path yang PERSIS sama. Kalau ekstensinya berubah
  // (foto lama .jpg, foto baru .webp), file lama jadi yatim dan tetap memakan
  // kuota. Kegagalan dibiarkan diam — fotonya sendiri sudah tersimpan benar.
  try {
    const sisa = ['jpg', 'jpeg', 'png', 'webp'].map((e) => `${userId}/photo.${e}`).filter((p) => p !== path);
    await supabase.storage.from('staff-photos').remove(sisa);
  } catch (err) {
    console.warn('[profil] sisa foto lama tidak terhapus:', err?.message ?? err);
  }
  return path;
}

export async function getStaffPhotoUrl(path) {
  if (!path) return null;
  const { data, error } = await supabase.storage.from('staff-photos').createSignedUrl(path, 3600);
  if (error) return null;
  return data?.signedUrl ?? null;
}

/** Semua data staff dalam satu BU (admin) — untuk tab Data Staff. */
export async function listStaffData(businessUnitId, outletId) {
  let query = supabase
    .from('membership_scopes')
    .select(`user_id, outlet_id, role, outlets!outlet_id(name), user_profiles!user_id(${PROFILE_FIELDS})`)
    .eq('business_unit_id', businessUnitId);
  if (outletId) query = query.eq('outlet_id', outletId);
  const { data, error } = await query;
  if (error) throw error;

  const byUser = new Map();
  for (const row of data ?? []) {
    if (!row.user_profiles) continue;
    const id = row.user_profiles.id;
    if (!byUser.has(id)) {
      byUser.set(id, { profile: row.user_profiles, outlets: new Set(), roles: new Set() });
    }
    if (row.outlets?.name) byUser.get(id).outlets.add(row.outlets.name);
    if (row.role) byUser.get(id).roles.add(row.role);
  }
  return [...byUser.values()]
    .map((v) => ({ ...v, outlets: [...v.outlets], roles: [...v.roles] }))
    .sort((a, b) => (a.profile.full_name ?? '').localeCompare(b.profile.full_name ?? ''));
}
