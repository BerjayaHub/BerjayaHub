import { supabase } from '../../config/supabase-client.js';

export function todayWIB() {
  const now = new Date();
  const wib = new Date(now.getTime() + 7 * 3600000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${wib.getUTCFullYear()}-${pad(wib.getUTCMonth() + 1)}-${pad(wib.getUTCDate())}`;
}

export async function recordSales({ businessUnitId, outletId, date, items }) {
  const { error } = await supabase.rpc('record_sales', {
    p_bu: businessUnitId,
    p_outlet: outletId,
    p_date: date,
    p_items: items.map((i) => ({ product_id: i.product_id, qty: i.qty }))
  });
  if (error) throw error;
}

/** Rekap penjualan hari ini untuk sebuah outlet -> Map productId -> {qty, revenue}. */
export async function getSalesSummary(outletId, date) {
  const { data, error } = await supabase
    .from('sales')
    .select('product_id, qty, revenue')
    .eq('outlet_id', outletId)
    .eq('sale_date', date);
  if (error) throw error;
  const map = new Map();
  for (const r of data ?? []) {
    const cur = map.get(r.product_id) ?? { qty: 0, revenue: 0 };
    cur.qty += Number(r.qty) || 0;
    cur.revenue += Number(r.revenue) || 0;
    map.set(r.product_id, cur);
  }
  return map;
}

/** Laporan penjualan admin: agregat per produk (qty & omzet) dalam rentang. */
export async function listSalesReport({ businessUnitId, outletId, dateFrom, dateTo }) {
  let query = supabase
    .from('sales')
    .select('product_id, qty, revenue, sale_date, products(name, category), outlets(name)')
    .eq('business_unit_id', businessUnitId)
    .order('sale_date', { ascending: false })
    .limit(2000);
  if (outletId) query = query.eq('outlet_id', outletId);
  if (dateFrom) query = query.gte('sale_date', dateFrom);
  if (dateTo) query = query.lte('sale_date', dateTo);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function listRecentSalesActivity({ limit = 25, before = null } = {}) {
  let query = supabase
    .from('sales')
    .select('created_at, qty, revenue, products(name), outlets(name), business_units(name), user_profiles(full_name)')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (before) query = query.lt('created_at', before);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}
