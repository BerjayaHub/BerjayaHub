import { supabase } from '../../config/supabase-client.js';

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

/** Jumlah menu rencana per (produk) untuk sebuah outlet & tanggal -> Map productId->qty. */
export async function getMenuPlans(outletId, date) {
  const { data, error } = await supabase
    .from('menu_plans')
    .select('product_id, qty')
    .eq('outlet_id', outletId)
    .eq('plan_date', date);
  if (error) throw error;
  const map = new Map();
  for (const r of data ?? []) map.set(r.product_id, Number(r.qty));
  return map;
}

export async function upsertMenuPlan({ businessUnitId, outletId, productId, date, qty }) {
  const uid = await currentUserId();
  const { error } = await supabase.from('menu_plans').upsert(
    {
      business_unit_id: businessUnitId,
      outlet_id: outletId,
      product_id: productId,
      plan_date: date,
      qty,
      updated_by: uid,
      updated_at: new Date().toISOString()
    },
    { onConflict: 'outlet_id,product_id,plan_date' }
  );
  if (error) throw error;
}
