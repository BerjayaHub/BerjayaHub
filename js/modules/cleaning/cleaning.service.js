import { supabase } from '../../config/supabase-client.js';
import { listAttendanceOutlets } from '../attendance/attendance.service.js';

export function todayWIB() {
  const now = new Date();
  const wib = new Date(now.getTime() + 7 * 3600000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${wib.getUTCFullYear()}-${pad(wib.getUTCMonth() + 1)}-${pad(wib.getUTCDate())}`;
}

async function currentUserId() {
  const {
    data: { user }
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

/** Outlet aktif di sebuah BU (lewat RPC security-definer, agar staff level-BU pun bisa lihat). */
export async function listBuOutlets(businessUnitId) {
  const all = await listAttendanceOutlets();
  return all.filter((o) => o.business_unit_id === businessUnitId).map((o) => ({ id: o.id, name: o.name }));
}

// ---- Item & sesi (template per BU) ----

export async function listActiveItems(businessUnitId) {
  const { data, error } = await supabase
    .from('checklist_items')
    .select('id, label, sort_order')
    .eq('business_unit_id', businessUnitId)
    .eq('is_active', true)
    .order('sort_order')
    .order('created_at');
  if (error) throw error;
  return data ?? [];
}

export async function listActiveSessions(businessUnitId) {
  const { data, error } = await supabase
    .from('checklist_sessions')
    .select('id, name, sort_order')
    .eq('business_unit_id', businessUnitId)
    .eq('is_active', true)
    .order('sort_order')
    .order('created_at');
  if (error) throw error;
  return data ?? [];
}

// ---- Admin CRUD item ----

export async function listItems(businessUnitId) {
  const { data, error } = await supabase
    .from('checklist_items')
    .select('id, label, sort_order, is_active')
    .eq('business_unit_id', businessUnitId)
    .order('sort_order')
    .order('created_at');
  if (error) throw error;
  return data ?? [];
}
export async function createItem({ businessUnitId, label, sort_order }) {
  const { error } = await supabase.from('checklist_items').insert({ business_unit_id: businessUnitId, label, sort_order: sort_order ?? 0 });
  if (error) throw error;
}
export async function updateItem(id, { label, sort_order, is_active }) {
  const { error } = await supabase.from('checklist_items').update({ label, sort_order, is_active }).eq('id', id);
  if (error) throw error;
}
export async function deleteItem(id) {
  const { error } = await supabase.from('checklist_items').delete().eq('id', id);
  if (error) throw error;
}

// ---- Admin CRUD sesi ----

export async function listSessions(businessUnitId) {
  const { data, error } = await supabase
    .from('checklist_sessions')
    .select('id, name, sort_order, is_active')
    .eq('business_unit_id', businessUnitId)
    .order('sort_order')
    .order('created_at');
  if (error) throw error;
  return data ?? [];
}
export async function createSession({ businessUnitId, name, sort_order }) {
  const { error } = await supabase.from('checklist_sessions').insert({ business_unit_id: businessUnitId, name, sort_order: sort_order ?? 0 });
  if (error) throw error;
}
export async function updateSession(id, { name, sort_order, is_active }) {
  const { error } = await supabase.from('checklist_sessions').update({ name, sort_order, is_active }).eq('id', id);
  if (error) throw error;
}
export async function deleteSession(id) {
  const { error } = await supabase.from('checklist_sessions').delete().eq('id', id);
  if (error) throw error;
}

// ---- Staff: run ----

/** Sesi yang SUDAH dikerjakan hari ini untuk sebuah outlet (set of session_id). */
export async function getTodayDoneSessions(outletId) {
  const { data, error } = await supabase
    .from('checklist_runs')
    .select('session_id')
    .eq('outlet_id', outletId)
    .eq('run_date', todayWIB());
  if (error) throw error;
  return new Set((data ?? []).map((r) => r.session_id));
}

export async function submitChecklistRun({ businessUnitId, outletId, sessionId, itemStates, notes, file }) {
  const uid = await currentUserId();
  if (!uid) throw new Error('Sesi tidak ditemukan, silakan login ulang.');

  const { data: run, error } = await supabase
    .from('checklist_runs')
    .insert({
      business_unit_id: businessUnitId,
      outlet_id: outletId,
      session_id: sessionId,
      run_date: todayWIB(),
      user_id: uid,
      notes: notes || null
    })
    .select()
    .single();
  if (error) throw error;

  if (itemStates?.length) {
    const rows = itemStates.map((s) => ({ run_id: run.id, item_id: s.item_id, checked: !!s.checked, note: s.note || null }));
    const { error: itemErr } = await supabase.from('checklist_run_items').insert(rows);
    if (itemErr) throw itemErr;
  }

  if (file) {
    const path = `${outletId}/${run.id}.jpg`;
    const { error: upErr } = await supabase.storage
      .from('checklist-photos')
      .upload(path, file, { upsert: true, contentType: file.type || 'image/jpeg' });
    if (upErr) throw upErr;
    const { error: updErr } = await supabase.from('checklist_runs').update({ photo_path: path }).eq('id', run.id);
    if (updErr) throw updErr;
  }
  return run;
}

// ---- Admin: rekap ----

export async function listRunsForAdmin({ businessUnitId, outletId, date }) {
  let query = supabase
    .from('checklist_runs')
    .select('id, run_date, notes, photo_path, created_at, user_profiles(full_name), checklist_sessions(name), outlets(name)')
    .eq('business_unit_id', businessUnitId)
    .order('run_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(300);
  if (outletId) query = query.eq('outlet_id', outletId);
  if (date) query = query.eq('run_date', date);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function getRunItems(runId) {
  const { data, error } = await supabase
    .from('checklist_run_items')
    .select('checked, note, item_id, checklist_items(label)')
    .eq('run_id', runId);
  if (error) throw error;
  return data ?? [];
}

export async function getChecklistPhotoUrl(path) {
  if (!path) return null;
  const { data, error } = await supabase.storage.from('checklist-photos').createSignedUrl(path, 600);
  if (error) throw error;
  return data?.signedUrl ?? null;
}

// ---- Dashboard ----

export async function listRecentChecklistActivity({ limit = 25, before = null } = {}) {
  let query = supabase
    .from('checklist_runs')
    .select('created_at, user_profiles(full_name), checklist_sessions(name), outlets(name), business_units(name)')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (before) query = query.lt('created_at', before);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}
