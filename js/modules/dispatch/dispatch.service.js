import { supabase } from '../../config/supabase-client.js';
import { ambilSemua } from '../../core/ambil-semua.js';
import { listMyOutlets } from '../../core/my-outlets.js';

export const DISPATCH_STATUS = { sent: 'Dikirim (belum diterima)', received: 'Diterima', cancelled: 'Dibatalkan' };

/**
 * Outlet milik AKUN yang login di sebuah BU.
 *
 * Kini hanya alias ke `listMyOutlets()` di core/my-outlets.js. Versi lama di
 * sini GAGAL TERBUKA di tiga tempat — scope kosong, query error, dan outlet
 * tidak ketemu di daftar — semuanya mengembalikan SELURUH outlet BU dengan
 * alasan "kalau ragu, tampilkan semua". Untuk pertanyaan hak akses, default itu
 * terbalik. Nama lama dipertahankan supaya pemanggil lama tidak perlu berubah.
 */
export async function getMyScopedOutlets(businessUnitId, allOutlets) {
  return listMyOutlets(businessUnitId, allOutlets);
}

export const ORDER_STATUS = { open: 'Menunggu diproses', fulfilled: 'Dikirim', rejected: 'Ditolak', cancelled: 'Dibatalkan' };

// ---- Order stok (Outlet -> Central Kitchen) ----

export async function createStockOrder({ fromOutlet, toOutlet, items, notes }) {
  const { data, error } = await supabase.rpc('create_stock_order', {
    p_from: fromOutlet,
    p_to: toOutlet,
    p_items: items.map((i) => ({ product_id: i.product_id, qty: i.qty })),
    p_notes: notes || null
  });
  if (error) throw error;
  return data;
}

export async function fulfillStockOrder({ orderId, items, notes }) {
  const { data, error } = await supabase.rpc('fulfill_stock_order', {
    p_order: orderId,
    p_items: items.map((i) => ({ product_id: i.product_id, qty: i.qty })),
    p_notes: notes || null
  });
  if (error) throw error;
  return data; // dispatch id
}

/** Outlet mengubah isi order yang masih menunggu (jejak edit ikut tercatat). */
export async function updateStockOrder({ orderId, items, notes }) {
  const { error } = await supabase.rpc('update_stock_order', {
    p_order: orderId,
    p_items: items.map((i) => ({ product_id: i.product_id, qty: i.qty })),
    p_notes: notes || null
  });
  if (error) throw error;
}

export async function rejectStockOrder(orderId, reason) {
  const { error } = await supabase.rpc('reject_stock_order', { p_order: orderId, p_reason: reason || null });
  if (error) throw error;
}

export async function cancelStockOrder(orderId) {
  const { error } = await supabase.rpc('cancel_stock_order', { p_order: orderId });
  if (error) throw error;
}

/** Order masuk yang menunggu diproses CK (tujuan = salah satu outlet CK milikku). */
export async function listIncomingOrders(outletIds) {
  if (!outletIds?.length) return [];
  const { data, error } = await supabase
    .from('stock_orders')
    .select('id, code, notes, created_at, from_outlet:outlets!from_outlet_id(name), to_outlet:outlets!to_outlet_id(name), user_profiles!created_by(full_name)')
    .eq('status', 'open')
    .in('to_outlet_id', outletIds)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/** Order yang dibuat outlet ini (untuk memantau statusnya). */
/**
 * Order milik OUTLET (bukan milik satu orang) — sengaja di-scope lewat
 * `from_outlet_id`, karena order stok adalah dokumen outlet yang boleh dilihat
 * seluruh staff outlet itu, bukan hanya pembuatnya.
 */
export async function listMyOrders(outletIds, { dateFrom, dateTo, limit = 300 } = {}) {
  if (!outletIds?.length) return [];
  let q = supabase
    .from('stock_orders')
    .select(
      'id, code, status, notes, reject_reason, created_at, handled_at, edited_at, editor:user_profiles!edited_by(full_name), from_outlet:outlets!from_outlet_id(name), to_outlet:outlets!to_outlet_id(name)'
    )
    .in('from_outlet_id', outletIds)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (dateFrom) q = q.gte('created_at', dateFrom);
  if (dateTo) q = q.lte('created_at', dateTo);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function getOrderItems(orderId) {
  const { data, error } = await supabase
    .from('stock_order_items')
    .select('id, qty, product_id, products(name, base_unit)')
    .eq('order_id', orderId);
  if (error) throw error;
  return data ?? [];
}

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
  // BERTAHAP, bukan dikecualikan. Ini satu-satunya daftar di modul ini yang
  // tidak punya batas alami: isinya kiriman yang BELUM dikonfirmasi, jadi ia
  // menumpuk persis selama orang lalai mengonfirmasi — keadaan yang paling
  // mungkin terjadi justru saat sedang sibuk. Dan kalau terpotong, yang hilang
  // adalah kiriman yang menunggu konfirmasi: barang yang sudah berangkat tapi
  // tidak pernah muncul untuk diterima.
  return ambilSemua((dari, sampai) =>
    supabase
      .from('dispatches')
      .select(
        'id, code, notes, created_at, from_outlet:outlets!from_outlet_id(name), to_outlet:outlets!to_outlet_id(name), to_outlet_id, user_profiles!created_by(full_name)',
        { count: 'exact' }
      )
      .eq('status', 'sent')
      .in('to_outlet_id', outletIds)
      .order('created_at', { ascending: false })
      .range(dari, sampai)
  );
}

export async function getDispatchItems(dispatchId) {
  const { data, error } = await supabase
    // baris-terbatas: item SATU dokumen kiriman.
    .from('dispatch_items')
    .select('id, sent_qty, received_qty, product_id, products(name, base_unit)')
    .eq('dispatch_id', dispatchId);
  if (error) throw error;
  return data ?? [];
}

/**
 * Riwayat PENGIRIMAN dari outlet-outlet saya (Staff App).
 *
 * Berpasangan dengan `listMyOrders`: yang satu dokumen permintaan, yang satu
 * dokumen barangnya berangkat. Keduanya disaring rentang tanggal supaya
 * penelusuran "kiriman bulan lalu ke mana saja" tidak perlu menggulir seluruh
 * riwayat.
 */
export async function listMyDispatches(outletIds, { dateFrom, dateTo } = {}) {
  if (!outletIds?.length) return [];
  let q = supabase
    .from('dispatches')
    .select(
      'id, code, status, notes, created_at, received_at, from_outlet:outlets!from_outlet_id(name), to_outlet:outlets!to_outlet_id(name), sender:user_profiles!created_by(full_name), receiver:user_profiles!received_by(full_name)'
    )
    // Kiriman KELUAR maupun MASUK: satu outlet ingin melihat keduanya di satu
    // tempat, karena pertanyaannya "dokumen nomor sekian ke mana", bukan
    // "dokumen yang saya buat sendiri".
    .or(`from_outlet_id.in.(${outletIds.join(',')}),to_outlet_id.in.(${outletIds.join(',')})`)
    .order('created_at', { ascending: false })
    .limit(300);
  if (dateFrom) q = q.gte('created_at', dateFrom);
  if (dateTo) q = q.lte('created_at', dateTo);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

/** Satu order beserta itemnya — untuk dilihat & diunduh per nomor. */
export async function getOrderForDoc(orderId) {
  const { data: header, error } = await supabase
    .from('stock_orders')
    .select(
      'id, code, status, notes, created_at, handled_at, reject_reason, from_outlet:outlets!from_outlet_id(name), to_outlet:outlets!to_outlet_id(name), pembuat:user_profiles!created_by(full_name)'
    )
    .eq('id', orderId)
    .single();
  if (error) throw error;
  const items = await getOrderItems(orderId);
  return { header: { ...header, statusLabel: ORDER_STATUS[header.status] ?? header.status }, items };
}

/** Satu pengiriman beserta itemnya — untuk dilihat & diunduh per nomor. */
export async function getDispatchForDoc(dispatchId) {
  const { data: header, error } = await supabase
    .from('dispatches')
    .select(
      'id, code, status, notes, created_at, received_at, from_outlet:outlets!from_outlet_id(name), to_outlet:outlets!to_outlet_id(name), pembuat:user_profiles!created_by(full_name), penerima:user_profiles!received_by(full_name)'
    )
    .eq('id', dispatchId)
    .single();
  if (error) throw error;
  const items = await getDispatchItems(dispatchId);
  return { header: { ...header, statusLabel: DISPATCH_STATUS[header.status] ?? header.status }, items };
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
    // `code` IKUT dibaca. Sebelumnya tidak, jadi nomor surat jalan — satu-satunya
    // pegangan untuk menelusuri sebuah kiriman — tidak pernah muncul di layar
    // admin sama sekali.
    .select('id, code, status, notes, created_at, received_at, from_outlet:outlets!from_outlet_id(name), to_outlet:outlets!to_outlet_id(name), sender:user_profiles!created_by(full_name), receiver:user_profiles!received_by(full_name)')
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
