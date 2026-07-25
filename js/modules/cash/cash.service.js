import { supabase } from '../../config/supabase-client.js';

export const ENTRY_LABEL = {
  in: 'Kas Masuk',
  out: 'Kas Keluar',
  transfer_out: 'Transfer Keluar',
  transfer_in: 'Transfer Masuk'
};

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

// ---- Kategori ----

export async function listCashCategories(businessUnitId, onlyActive = true) {
  let q = supabase
    .from('cash_categories')
    .select('id, name, direction, is_active')
    .eq('business_unit_id', businessUnitId)
    .order('name');
  if (onlyActive) q = q.eq('is_active', true);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function createCashCategory({ businessUnitId, name, direction }) {
  const { error } = await supabase.from('cash_categories').insert({ business_unit_id: businessUnitId, name, direction: direction || 'both' });
  if (error) throw error;
}
export async function updateCashCategory(id, { name, direction, is_active }) {
  const { error } = await supabase.from('cash_categories').update({ name, direction, is_active }).eq('id', id);
  if (error) throw error;
}
export async function deleteCashCategory(id) {
  const { error } = await supabase.from('cash_categories').delete().eq('id', id);
  if (error) throw error;
}

// ---- Entri kas ----

export async function recordCashEntry({ businessUnitId, outletId, type, amount, categoryId, notes, date, file }) {
  const uid = await currentUserId();
  if (!uid) throw new Error('Sesi tidak ditemukan, silakan login ulang.');
  const signed = type === 'out' ? -Math.abs(amount) : Math.abs(amount);
  const { data, error } = await supabase
    .from('cash_entries')
    .insert({
      business_unit_id: businessUnitId,
      outlet_id: outletId || null,
      holder_id: uid,
      entry_type: type,
      amount: signed,
      category_id: categoryId || null,
      notes: notes || null,
      entry_date: date || todayWIB(),
      created_by: uid
    })
    .select()
    .single();
  if (error) throw error;

  if (file) {
    const ext = (file.name?.split('.').pop() || 'jpg').toLowerCase();
    const path = `${uid}/${data.id}.${ext}`;
    const { error: upErr } = await supabase.storage.from('cash-proofs').upload(path, file, { upsert: true, contentType: file.type || 'image/jpeg' });
    if (upErr) throw upErr;
    const { error: updErr } = await supabase.from('cash_entries').update({ proof_path: path }).eq('id', data.id);
    if (updErr) throw updErr;
  }
  return data;
}

export async function transferCash({ businessUnitId, outletId, toUserId, amount, notes }) {
  const { error } = await supabase.rpc('transfer_cash', {
    p_bu: businessUnitId,
    p_outlet: outletId || null,
    p_to_user: toUserId,
    p_amount: amount,
    p_notes: notes || null
  });
  if (error) throw error;
}

export async function getMyCashBalance(businessUnitId) {
  const uid = await currentUserId();
  if (!uid) return 0;
  const { data, error } = await supabase
    .from('cash_balances')
    .select('balance')
    .eq('business_unit_id', businessUnitId)
    .eq('holder_id', uid)
    .maybeSingle();
  if (error) throw error;
  return Number(data?.balance ?? 0);
}

export async function listMyCashEntries(businessUnitId, limit = 50) {
  const uid = await currentUserId();
  if (!uid) return [];
  const { data, error } = await supabase
    .from('cash_entries')
    .select('id, entry_type, amount, notes, entry_date, proof_path, created_at, cash_categories(name), counterpart:user_profiles!counterpart_id(full_name)')
    .eq('business_unit_id', businessUnitId)
    .eq('holder_id', uid)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

export async function getCashProofUrl(path) {
  if (!path) return null;
  const { data, error } = await supabase.storage.from('cash-proofs').createSignedUrl(path, 600);
  if (error) throw error;
  return data?.signedUrl ?? null;
}

// ---- Admin ----

export async function listCashBalances(businessUnitId) {
  const { data, error } = await supabase
    .from('cash_balances')
    .select('holder_id, balance')
    .eq('business_unit_id', businessUnitId);
  if (error) throw error;
  return data ?? [];
}

export async function listCashEntriesAdmin({ businessUnitId, holderId, entryType, dateFrom, dateTo }) {
  let query = supabase
    .from('cash_entries')
    .select('id, entry_type, amount, notes, entry_date, proof_path, created_at, holder:user_profiles!holder_id(full_name), counterpart:user_profiles!counterpart_id(full_name), cash_categories(name), outlets(name)')
    .eq('business_unit_id', businessUnitId)
    .order('entry_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(500);
  if (holderId) query = query.eq('holder_id', holderId);
  if (entryType) query = query.eq('entry_type', entryType);
  if (dateFrom) query = query.gte('entry_date', dateFrom);
  if (dateTo) query = query.lte('entry_date', dateTo);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function listRecentCashActivity({ limit = 25, before = null } = {}) {
  let query = supabase
    .from('cash_entries')
    .select('created_at, entry_type, amount, holder:user_profiles!holder_id(full_name), business_units(name), outlets(name), cash_categories(name)')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (before) query = query.lt('created_at', before);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}
