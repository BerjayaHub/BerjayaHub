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
    .select('id, name, deducts_quota, requires_attachment, business_unit_id, is_active')
    .or(`business_unit_id.is.null,business_unit_id.eq.${businessUnitId}`)
    .eq('is_active', true)
    .order('name');
  if (error) throw error;
  return data ?? [];
}

export async function createLeaveType({ businessUnitId, name, deducts_quota, requires_attachment }) {
  const { error } = await supabase.from('leave_types').insert({
    business_unit_id: businessUnitId,
    name,
    deducts_quota: !!deducts_quota,
    requires_attachment: !!requires_attachment
  });
  if (error) throw error;
}

export async function updateLeaveType(id, { name, deducts_quota, requires_attachment, is_active }) {
  const { error } = await supabase
    .from('leave_types')
    .update({ name, deducts_quota, requires_attachment, is_active })
    .eq('id', id);
  if (error) throw error;
}

export async function deleteLeaveType(id) {
  const { error } = await supabase.from('leave_types').delete().eq('id', id);
  if (error) throw error;
}

// ---- Jatah cuti ----

export async function getLeaveQuota(userId, year) {
  const { data, error } = await supabase
    .from('leave_quotas')
    .select('total_days')
    .eq('user_id', userId)
    .eq('year', year)
    .maybeSingle();
  if (error) throw error;
  return data ? Number(data.total_days) : null;
}

export async function upsertLeaveQuota(userId, year, totalDays) {
  const { error } = await supabase
    .from('leave_quotas')
    .upsert({ user_id: userId, year, total_days: totalDays }, { onConflict: 'user_id,year' });
  if (error) throw error;
}

/** Jumlah hari cuti TERPAKAI (approved, jenis yang memotong jatah) di satu tahun. */
export async function getLeaveUsedDays(userId, year) {
  const { data, error } = await supabase
    .from('leave_requests')
    .select('day_count, leave_types(deducts_quota)')
    .eq('user_id', userId)
    .eq('status', 'approved')
    .gte('start_date', `${year}-01-01`)
    .lte('start_date', `${year}-12-31`);
  if (error) throw error;
  return (data ?? [])
    .filter((r) => r.leave_types?.deducts_quota)
    .reduce((sum, r) => sum + (r.day_count ?? 0), 0);
}

/** Ringkasan jatah cuti staff yang login untuk satu tahun. */
export async function getMyLeaveBalance(year) {
  const uid = await currentUserId();
  if (!uid) return { total: 0, used: 0, remaining: 0, hasQuota: false };
  const [total, used] = await Promise.all([getLeaveQuota(uid, year), getLeaveUsedDays(uid, year)]);
  const t = total ?? 0;
  return { total: t, used, remaining: t - used, hasQuota: total != null };
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
      'id, start_date, end_date, day_count, reason, status, review_note, attachment_path, created_at, user_id, user_profiles(full_name), leave_types(name, deducts_quota), outlets(name)'
    )
    .eq('business_unit_id', businessUnitId)
    .order('created_at', { ascending: false })
    .limit(300);
  if (status) query = query.eq('status', status);
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
    .select('id, name, deducts_quota, requires_attachment, business_unit_id, is_active')
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
