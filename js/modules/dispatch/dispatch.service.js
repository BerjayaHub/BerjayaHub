import { supabase } from '../../config/supabase-client.js';

export const DISPATCH_STATUS = { sent: 'Dikirim (belum diterima)', received: 'Diterima', cancelled: 'Dibatalkan' };

export async function createDispatch({ fromOutlet, toOutlet, items, notes }) {
  const { data, error } = await supabase.rpc('create_dispatch', {
    p_from: fromOutlet,
    p_to: toOutlet,
    p_items: items.map((i) => ({ product_id: i.product_id, qty: i.qty })),
    p_notes: notes || null
  });
  if (error) throw error;
  return data;
}

export async function receiveDispatch(dispatchId, items) {
  const { error } = await supabase.rpc('receive_dispatch', {
    p_dispatch: dispatchId,
    p_items: items.map((i) => ({ item_id: i.item_id, received_qty: i.received_qty }))
  });
  if (error) throw error;
}

/** Kiriman berstatus 'sent' yang tujuannya salah satu dari outletIds (untuk dikonfirmasi). */
export async function listIncomingDispatches(outletIds) {
  if (!outletIds?.length) return [];
  const { data, error } = await supabase
    .from('dispatches')
    .select('id, notes, created_at, from_outlet:outlets!from_outlet_id(name), to_outlet:outlets!to_outlet_id(name), to_outlet_id, user_profiles!created_by(full_name)')
    .eq('status', 'sent')
    .in('to_outlet_id', outletIds)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function getDispatchItems(dispatchId) {
  const { data, error } = await supabase
    .from('dispatch_items')
    .select('id, sent_qty, received_qty, product_id, products(name, base_unit)')
    .eq('dispatch_id', dispatchId);
  if (error) throw error;
  return data ?? [];
}

/** Header + item sebuah pengiriman untuk membuat PDF surat jalan. */
export async function getDispatchForPdf(dispatchId) {
  const { data: header, error } = await supabase
    .from('dispatches')
    .select('code, notes, status, created_at, from_outlet:outlets!from_outlet_id(name), to_outlet:outlets!to_outlet_id(name)')
    .eq('id', dispatchId)
    .single();
  if (error) throw error;
  const items = await getDispatchItems(dispatchId);
  return { header, items };
}

export async function listDispatchesAdmin({ businessUnitId, status, dateFrom, dateTo }) {
  let query = supabase
    .from('dispatches')
    .select('id, status, notes, created_at, received_at, from_outlet:outlets!from_outlet_id(name), to_outlet:outlets!to_outlet_id(name), sender:user_profiles!created_by(full_name), receiver:user_profiles!received_by(full_name)')
    .eq('business_unit_id', businessUnitId)
    .order('created_at', { ascending: false })
    .limit(300);
  if (status) query = query.eq('status', status);
  if (dateFrom) query = query.gte('created_at', dateFrom);
  if (dateTo) query = query.lte('created_at', dateTo);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function listRecentDispatchActivity({ limit = 25, before = null } = {}) {
  let query = supabase
    .from('dispatches')
    .select('created_at, received_at, status, from_outlet:outlets!from_outlet_id(name), to_outlet:outlets!to_outlet_id(name), business_units(name), sender:user_profiles!created_by(full_name)')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (before) query = query.lt('created_at', before);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}
