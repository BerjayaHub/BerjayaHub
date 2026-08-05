import { supabase } from '../../config/supabase-client.js';
import { invokeFunction } from '../../core/invoke.js';

/**
 * Ambil daftar staff beserta seluruh membership scope-nya, dalam batas
 * akses admin yang login (RLS otomatis filter: bu_admin cuma lihat BU-nya,
 * super_admin lihat semua).
 */
export async function listStaffWithScopes() {
  const { data, error } = await supabase
    .from('membership_scopes')
    .select(`
      id, role, business_unit_id, outlet_id, is_primary, division_id,
      business_units(name),
      divisions(name),
      outlets(name),
      user_profiles(id, full_name, phone, email, is_active, cash_account_limit)
    `)
    .order('business_unit_id');

  if (error) throw error;

  // Kelompokkan per user, karena 1 user bisa punya banyak baris scope
  const byUser = new Map();
  for (const row of data ?? []) {
    const profile = row.user_profiles;
    if (!profile) continue;
    if (!byUser.has(profile.id)) {
      byUser.set(profile.id, { profile, scopes: [] });
    }
    byUser.get(profile.id).scopes.push(row);
  }
  return Array.from(byUser.values());
}

export async function listBusinessUnits() {
  const { data, error } = await supabase.from('business_units').select('id, name, type').order('name');
  if (error) throw error;
  return data ?? [];
}

// ---- Divisi (Kitchen, Bar, Mekanik, dst) ----
//
// Melekat pada SCOPE, bukan user: orang yang bekerja di Cafe dan Bengkel bisa
// berbeda divisinya di masing-masing tempat.

export async function listDivisions(businessUnitId, onlyActive = true) {
  let q = supabase
    .from('divisions')
    .select('id, name, sort_order, is_active')
    .eq('business_unit_id', businessUnitId)
    .order('sort_order')
    .order('name');
  if (onlyActive) q = q.eq('is_active', true);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function saveDivision({ id, businessUnitId, name, sort_order, is_active }) {
  const baris = {
    business_unit_id: businessUnitId,
    name: String(name ?? '').trim(),
    sort_order: Number(sort_order) || 0,
    is_active: is_active !== false
  };
  if (id) {
    const { data, error } = await supabase.from('divisions').update(baris).eq('id', id).select('id');
    if (error) throw error;
    if (!data?.length) throw new Error('Tidak bisa mengubah divisi ini — kamu bukan admin BU-nya.');
    return;
  }
  const { error } = await supabase.from('divisions').insert(baris);
  if (error) throw error;
}

/**
 * Hapus divisi. Scope yang memakainya TIDAK ikut terhapus — kolomnya jadi NULL
 * (`on delete set null`), jadi orangnya cuma kembali "belum berdivisi".
 * Menghapus keanggotaan orang hanya karena divisinya dihapus jelas berlebihan.
 */
export async function deleteDivision(id) {
  const { data, error } = await supabase.from('divisions').delete().eq('id', id).select('id');
  if (error) throw error;
  if (!data?.length) throw new Error('Tidak bisa menghapus divisi ini — kamu bukan admin BU-nya.');
}

export async function listOutlets(businessUnitId) {
  const { data, error } = await supabase
    .from('outlets')
    .select('id, name, outlet_role')
    .eq('business_unit_id', businessUnitId)
    .order('name');
  if (error) throw error;
  return data ?? [];
}

export async function updateProfile(userId, { full_name, phone, is_active, cash_account_limit }) {
  // .select() WAJIB. PostgREST tidak menganggap penolakan RLS sebagai error:
  // UPDATE yang tidak menyentuh baris apa pun tetap balik "sukses", dan admin
  // melihat toast "Data staff diperbarui" untuk perubahan yang tidak terjadi.
  const { data, error } = await supabase
    .from('user_profiles')
    .update({ full_name, phone, is_active, cash_account_limit })
    .eq('id', userId)
    .select('id');
  if (error) throw error;
  if (!data?.length) throw new Error('Tidak tersimpan — kamu tidak punya izin mengubah data staff ini.');
}

export async function addMembershipScope({ user_id, business_unit_id, outlet_id, role, division_id }) {
  const { error } = await supabase
    .from('membership_scopes')
    .insert({ user_id, business_unit_id, outlet_id: outlet_id || null, role, division_id: division_id || null });
  if (error) throw error;
}

export async function updateMembershipScope(scopeId, { business_unit_id, outlet_id, role, division_id }) {
  const { error } = await supabase
    .from('membership_scopes')
    .update({ business_unit_id, outlet_id: outlet_id || null, role, division_id: division_id || null })
    .eq('id', scopeId);
  if (error) throw error;
}

export async function removeMembershipScope(scopeId) {
  const { error } = await supabase.from('membership_scopes').delete().eq('id', scopeId);
  if (error) throw error;
}

// ---- Akses modul per user (dalam satu BU) ----

/** Modul aktif di sebuah BU (id, code, name) untuk pilihan akses. */
export async function listBuActiveModules(businessUnitId) {
  const { data, error } = await supabase
    .from('bu_modules')
    .select('is_active, modules(id, code, name)')
    .eq('business_unit_id', businessUnitId)
    .eq('is_active', true);
  if (error) throw error;
  return (data ?? []).map((r) => r.modules).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
}

/** Set module_id yang di-whitelist untuk user di BU ini (kosong = semua modul). */
export async function getUserModuleAccess(userId, businessUnitId) {
  const { data, error } = await supabase
    .from('user_module_access')
    .select('module_id')
    .eq('user_id', userId)
    .eq('business_unit_id', businessUnitId);
  if (error) throw error;
  return new Set((data ?? []).map((r) => r.module_id));
}

/**
 * Simpan akses modul user. Kalau `moduleIds` mencakup SEMUA modul aktif BU,
 * baris dihapus semua supaya kembali ke default "semua modul" (lebih bersih,
 * dan otomatis ikut kalau nanti ada modul baru diaktifkan untuk BU).
 */
export async function setUserModuleAccess(userId, businessUnitId, moduleIds, allModuleIds) {
  const { error: delError } = await supabase
    .from('user_module_access')
    .delete()
    .eq('user_id', userId)
    .eq('business_unit_id', businessUnitId);
  if (delError) throw delError;

  const isAll = allModuleIds.length > 0 && moduleIds.length === allModuleIds.length;
  if (isAll || moduleIds.length === 0) return; // default: semua modul BU
  const rows = moduleIds.map((mid) => ({ user_id: userId, business_unit_id: businessUnitId, module_id: mid }));
  const { error } = await supabase.from('user_module_access').insert(rows);
  if (error) throw error;
}

// ---- Izin akses menu/tab Admin Portal per user ----

/** Set kode tab yang di-whitelist untuk user di BU ini (kosong = semua boleh). */
export async function getAdminTabAccess(userId, businessUnitId) {
  const { data, error } = await supabase
    .from('admin_tab_access')
    .select('tab_code')
    .eq('user_id', userId)
    .eq('business_unit_id', businessUnitId);
  if (error) throw error;
  return new Set((data ?? []).map((r) => r.tab_code));
}

/** Izin tab milik user yang sedang login (dipakai menyaring menu admin). */
export async function getMyAdminTabAccess(businessUnitId) {
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return new Set();
  try {
    return await getAdminTabAccess(user.id, businessUnitId);
  } catch {
    return new Set(); // gagal baca -> jangan kunci user
  }
}

/**
 * Simpan izin tab. Kalau `codes` mencakup semua tab yang bisa diberikan,
 * baris dihapus semua supaya kembali ke default "semua boleh".
 */
export async function setAdminTabAccess(userId, businessUnitId, codes, allCodes) {
  const { error: delError } = await supabase
    .from('admin_tab_access')
    .delete()
    .eq('user_id', userId)
    .eq('business_unit_id', businessUnitId);
  if (delError) throw delError;

  const isAll = allCodes.length > 0 && codes.length === allCodes.length;
  if (isAll || codes.length === 0) return;
  const rows = codes.map((c) => ({ user_id: userId, business_unit_id: businessUnitId, tab_code: c }));
  const { error } = await supabase.from('admin_tab_access').insert(rows);
  if (error) throw error;
}

/**
 * Tetapkan satu scope sebagai "tempat kerja utama" (basis NBM) staff.
 * Scope lain milik user yang sama otomatis di-nonaktifkan primary-nya dulu,
 * supaya cuma ada satu primary per user.
 */
export async function setPrimaryScope(userId, scopeId) {
  const { error: clearError } = await supabase
    .from('membership_scopes')
    .update({ is_primary: false })
    .eq('user_id', userId)
    .eq('is_primary', true);
  if (clearError) throw clearError;

  const { error } = await supabase.from('membership_scopes').update({ is_primary: true }).eq('id', scopeId);
  if (error) throw error;
}

/**
 * Panggil Edge Function untuk bikin staff baru (auth user + profile + scope awal).
 *
 * Lewat `invokeFunction()`, bukan `supabase.functions.invoke()` langsung:
 * helper itu memastikan access token belum kedaluwarsa sebelum dikirim. Tanpa
 * itu, tab yang dibiarkan terbuka lama akan mengirim token basi dan Edge
 * Function membalas "Invalid session" — terdengar seperti aplikasi rusak,
 * padahal artinya cuma login-nya sudah lewat waktu.
 */
export async function createStaffUser(payload) {
  return invokeFunction('create-staff-user', payload);
}

export async function resetStaffPassword(targetUserId, newPassword) {
  return invokeFunction('reset-staff-password', { target_user_id: targetUserId, new_password: newPassword });
}
