import { supabase } from '../../config/supabase-client.js';

/**
 * Ambil daftar staff beserta seluruh membership scope-nya, dalam batas
 * akses admin yang login (RLS otomatis filter: bu_admin cuma lihat BU-nya,
 * super_admin lihat semua).
 */
export async function listStaffWithScopes() {
  const { data, error } = await supabase
    .from('membership_scopes')
    .select(`
      id, role, business_unit_id, outlet_id,
      business_units(name),
      outlets(name),
      user_profiles(id, full_name, phone, is_active)
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

export async function listOutlets(businessUnitId) {
  const { data, error } = await supabase
    .from('outlets')
    .select('id, name, outlet_role')
    .eq('business_unit_id', businessUnitId)
    .order('name');
  if (error) throw error;
  return data ?? [];
}

export async function updateProfile(userId, { full_name, phone, is_active }) {
  const { error } = await supabase
    .from('user_profiles')
    .update({ full_name, phone, is_active })
    .eq('id', userId);
  if (error) throw error;
}

export async function addMembershipScope({ user_id, business_unit_id, outlet_id, role }) {
  const { error } = await supabase
    .from('membership_scopes')
    .insert({ user_id, business_unit_id, outlet_id: outlet_id || null, role });
  if (error) throw error;
}

export async function removeMembershipScope(scopeId) {
  const { error } = await supabase.from('membership_scopes').delete().eq('id', scopeId);
  if (error) throw error;
}

/**
 * Panggil Edge Function untuk bikin staff baru (auth user + profile + scope awal).
 * Sesi admin yang sedang login otomatis disertakan sebagai Bearer token oleh
 * supabase.functions.invoke, jadi Edge Function bisa validasi siapa yang manggil.
 */
async function extractFunctionErrorMessage(error) {
  try {
    if (error?.context && typeof error.context.json === 'function') {
      const body = await error.context.json();
      if (body?.error) return body.error;
    }
  } catch {
    // body bukan JSON atau gagal dibaca, fallback ke pesan default di bawah
  }
  return error?.message ?? 'Terjadi kesalahan.';
}

export async function createStaffUser(payload) {
  const { data, error } = await supabase.functions.invoke('create-staff-user', {
    body: payload
  });
  if (error) throw new Error(await extractFunctionErrorMessage(error));
  return data;
}

export async function resetStaffPassword(targetUserId, newPassword) {
  const { data, error } = await supabase.functions.invoke('reset-staff-password', {
    body: { target_user_id: targetUserId, new_password: newPassword }
  });
  if (error) throw new Error(await extractFunctionErrorMessage(error));
  return data;
}
