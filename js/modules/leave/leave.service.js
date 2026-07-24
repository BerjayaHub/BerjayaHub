import { supabase } from '../../config/supabase-client.js';

// ---- Util ----

/** Jumlah hari kalender inklusif antara dua tanggal 'YYYY-MM-DD'. */
export function countDaysInclusive(startDate, endDate) {
  const s = new Date(startDate + 'T00:00:00');
  const e = new Date(endDate + 'T00:00:00');
  return Math.floor((e - s) / 86400000) + 1;
}

async function currentUserId() {
  const {
    data: { user }
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

// ---- Jenis cuti ----

/** Jenis cuti aktif yang berlaku untuk BU ini (global + khusus BU). */
export async function listLeaveTypes(businessUnitId) {
  const { data, error } = await supabase
    .from('leave_types')
    .select('id, name, deducts_quota, requires_attachment, default_quota, business_unit_id, is_active')
    .or(`business_unit_id.is.null,business_unit_id.eq.${businessUnitId}`)
    .eq('is_active', true)
    .order('name');
  if (error) throw error;
  return data ?? [];
}

export async function createLeaveType({ businessUnitId, name, deducts_quota, requires_attachment, default_quota }) {
  const { error } = await supabase.from('leave_types').insert({
    business_unit_id: businessUnitId,
    name,
    deducts_quota: !!deducts_quota,
    requires_attachment: !!requires_attachment,
    default_quota: deducts_quota ? default_quota ?? null : null
  });
  if (error) throw error;
}

export async function updateLeaveType(id, { name, deducts_quota, requires_attachment, is_active, default_quota }) {
  const { error } = await supabase
    .from('leave_types')
    .update({ name, deducts_quota, requires_attachment, is_active, default_quota: deducts_quota ? default_quota ?? null : null })
    .eq('id', id);
  if (error) throw error;
}

export async function deleteLeaveType(id) {
  const { error } = await supabase.from('leave_types').delete().eq('id', id);
  if (error) throw error;
}

// ---- Hak & jatah cuti per jenis (entitlements) ----

/** Hari terpakai (approved) per jenis cuti untuk satu user, di satu tahun. */
async function usedDaysByType(userId, year) {
  const { data, error } = await supabase
    .from('leave_requests')
    .select('leave_type_id, day_count')
    .eq('user_id', userId)
    .eq('status', 'approved')
    .gte('start_date', `${year}-01-01`)
    .lte('start_date', `${year}-12-31`);
  if (error) throw error;
  const map = {};
  for (const r of data ?? []) map[r.leave_type_id] = (map[r.leave_type_id] ?? 0) + (r.day_count ?? 0);
  return map;
}

/** Ringkasan hak & sisa jatah per jenis untuk staff yang login (tahun berjalan). */
export async function getMyEntitlementSummary() {
  const uid = await currentUserId();
  if (!uid) return [];
  const year = new Date().getFullYear();
  const [{ data, error }, used] = await Promise.all([
    supabase.from('leave_entitlements').select('leave_type_id, quota_days, leave_types(name, deducts_quota)').eq('user_id', uid),
    usedDaysByType(uid, year)
  ]);
  if (error) throw error;
  return (data ?? [])
    .map((e) => ({
      leave_type_id: e.leave_type_id,
      name: e.leave_types?.name ?? '-',
      has_quota: !!e.leave_types?.deducts_quota,
      quota_days: e.quota_days == null ? null : Number(e.quota_days),
      used: used[e.leave_type_id] ?? 0
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Jenis cuti yang BOLEH diajukan staff yang login (dari entitlements). */
export async function listAllowedLeaveTypes() {
  const uid = await currentUserId();
  if (!uid) return [];
  const { data, error } = await supabase
    .from('leave_entitlements')
    .select('leave_types(id, name, requires_attachment, is_active)')
    .eq('user_id', uid);
  if (error) throw error;
  return (data ?? [])
    .map((e) => e.leave_types)
    .filter((t) => t && t.is_active)
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ---- Admin: kelola hak & jatah per staff ----

export async function listStaffEntitlements(userId) {
  const { data, error } = await supabase.from('leave_entitlements').select('leave_type_id, quota_days').eq('user_id', userId);
  if (error) throw error;
  return data ?? [];
}

export async function setStaffEntitlement(userId, leaveTypeId, quotaDays) {
  const { error } = await supabase
    .from('leave_entitlements')
    .upsert({ user_id: userId, leave_type_id: leaveTypeId, quota_days: quotaDays }, { onConflict: 'user_id,leave_type_id' });
  if (error) throw error;
}

export async function removeStaffEntitlement(userId, leaveTypeId) {
  const { error } = await supabase.from('leave_entitlements').delete().eq('user_id', userId).eq('leave_type_id', leaveTypeId);
  if (error) throw error;
}

// ---- Pengajuan (staff) ----

export async function listMyLeaveRequests() {
  const { data, error } = await supabase
    .from('leave_requests')
    .select('id, start_date, end_date, day_count, reason, status, review_note, attachment_path, created_at, leave_types(name)')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function submitLeaveRequest({ businessUnitId, outletId, leaveTypeId, startDate, endDate, reason, file }) {
  const uid = await currentUserId();
  if (!uid) throw new Error('Sesi tidak ditemukan, silakan login ulang.');
  const dayCount = countDaysInclusive(startDate, endDate);

  const { data: record, error } = await supabase
    .from('leave_requests')
    .insert({
      user_id: uid,
      business_unit_id: businessUnitId,
      outlet_id: outletId || null,
      leave_type_id: leaveTypeId,
      start_date: startDate,
      end_date: endDate,
      day_count: dayCount,
      reason: reason || null
    })
    .select()
    .single();
  if (error) throw error;

  if (file) {
    const ext = (file.name?.split('.').pop() || 'dat').toLowerCase();
    const path = `${uid}/${record.id}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from('leave-attachments')
      .upload(path, file, { upsert: true, contentType: file.type || 'application/octet-stream' });
    if (upErr) throw upErr;
    const { error: updErr } = await supabase.from('leave_requests').update({ attachment_path: path }).eq('id', record.id);
    if (updErr) throw updErr;
    record.attachment_path = path;
  }
  return record;
}

export async function cancelLeaveRequest(id) {
  const { error } = await supabase.from('leave_requests').update({ status: 'cancelled' }).eq('id', id);
  if (error) throw error;
}

export async function getAttachmentUrl(path) {
  if (!path) return null;
  const { data, error } = await supabase.storage.from('leave-attachments').createSignedUrl(path, 600);
  if (error) throw error;
  return data?.signedUrl ?? null;
}

// ---- Admin ----

export async function listLeaveRequestsForAdmin({ businessUnitId, status }) {
  let query = supabase
    .from('leave_requests')
    .select(
      'id, start_date, end_date, day_count, reason, status, review_note, attachment_path, created_at, user_id, user_profiles!user_id(full_name), leave_types(name, deducts_quota), outlets(name)'
    )
    .eq('business_unit_id', businessUnitId)
    .order('created_at', { ascending: false })
    .limit(300);
  if (status) query = query.eq('status', status);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

/**
 * Aktivitas cuti terbaru LINTAS-BU untuk dashboard admin (RLS yang membatasi).
 * Cursor waktu lewat `before` (created_at).
 */
export async function listRecentLeaveActivity({ limit = 25, before = null } = {}) {
  let query = supabase
    .from('leave_requests')
    .select('created_at, reviewed_at, status, start_date, end_date, user_profiles!user_id(full_name), leave_types(name), business_units!business_unit_id(name)')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (before) query = query.lt('created_at', before);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function reviewLeaveRequest(id, { status, reviewNote }) {
  const uid = await currentUserId();
  const { error } = await supabase
    .from('leave_requests')
    .update({
      status,
      review_note: reviewNote || null,
      reviewed_by: uid,
      reviewed_at: new Date().toISOString()
    })
    .eq('id', id);
  if (error) throw error;
}

/** Jenis cuti yang bisa dikelola admin (global + BU ini), termasuk yang nonaktif. */
export async function listLeaveTypesForAdmin(businessUnitId) {
  const { data, error } = await supabase
    .from('leave_types')
    .select('id, name, deducts_quota, requires_attachment, default_quota, business_unit_id, is_active')
    .or(`business_unit_id.is.null,business_unit_id.eq.${businessUnitId}`)
    .order('business_unit_id', { nullsFirst: true })
    .order('name');
  if (error) throw error;
  return data ?? [];
}

/** Daftar staff (distinct) yang punya scope di BU ini — untuk tab Jatah Cuti. */
export async function listBuStaff(businessUnitId) {
  const { data, error } = await supabase
    .from('membership_scopes')
    .select('user_id, user_profiles(full_name, is_active)')
    .eq('business_unit_id', businessUnitId);
  if (error) throw error;
  const seen = new Map();
  for (const row of data ?? []) {
    if (!row.user_profiles) continue;
    if (!seen.has(row.user_id)) {
      seen.set(row.user_id, { user_id: row.user_id, full_name: row.user_profiles.full_name, is_active: row.user_profiles.is_active });
    }
  }
  return Array.from(seen.values()).sort((a, b) => a.full_name.localeCompare(b.full_name));
}
