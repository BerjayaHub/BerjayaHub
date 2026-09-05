import { supabase } from '../../config/supabase-client.js';
import { ambilSemua } from '../../core/ambil-semua.js';

export const MOVEMENT_LABEL = {
  receive: 'Penerimaan',
  waste: 'Waste',
  adjustment: 'Opname',
  transfer_out: 'Transfer Keluar',
  transfer_in: 'Transfer Masuk',
  usage: 'Pemakaian',
  production: 'Produksi'
};

async function currentUserId() {
  const {
    data: { user }
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

/** Apakah staff boleh stok opname di BU ini (diatur super_admin). */
export async function getAllowStaffOpname(businessUnitId) {
  const { data, error } = await supabase.from('business_units').select('allow_staff_opname').eq('id', businessUnitId).single();
  if (error) throw error;
  return !!data?.allow_staff_opname;
}

export async function setAllowStaffOpname(businessUnitId, allow) {
  const { error } = await supabase.rpc('set_allow_staff_opname', { p_bu: businessUnitId, p_allow: allow });
  if (error) throw error;
}

/** Cek apakah user yang login punya scope super_admin (untuk gating kontrol). */
export async function amISuperAdmin() {
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return false;
  const { data, error } = await supabase.from('membership_scopes').select('role').eq('user_id', user.id).eq('role', 'super_admin').limit(1);
  if (error) return false;
  return (data?.length ?? 0) > 0;
}

/**
 * Saldo stok per (outlet, produk). Optional filter outlet.
 *
 * DIAMBIL BERTAHAP. Tabel ini punya satu baris untuk tiap pasangan
 * (outlet, produk): dengan 785 produk dan beberapa outlet, saldo satu BU sudah
 * melewati batas 1.000 baris yang dikirim PostgREST tanpa diminta. Potongannya
 * bukan error — stok yang tidak terkirim cuma tampil sebagai 0, dan nol adalah
 * angka yang paling mudah dipercaya karena tidak terlihat seperti kesalahan.
 *
 * Tanpa filter outlet (dipakai layar admin lintas outlet) risikonya paling
 * besar, karena barisnya dikalikan jumlah outlet.
 */
export async function listStockBalances(businessUnitId, outletId) {
  return ambilSemua((dari, sampai) => {
    let query = supabase
      .from('stock_balances')
      .select('outlet_id, product_id, qty', { count: 'exact' })
      .eq('business_unit_id', businessUnitId);
    if (outletId) query = query.eq('outlet_id', outletId);
    return query.range(dari, sampai);
  });
}

/** Map productId -> qty untuk satu outlet. */
export async function getOutletStockMap(businessUnitId, outletId) {
  const rows = await listStockBalances(businessUnitId, outletId);
  const map = new Map();
  for (const r of rows) map.set(r.product_id, Number(r.qty));
  return map;
}

export async function recordMovement({ businessUnitId, outletId, productId, movementType, qtyDelta, unitCost, notes }) {
  const uid = await currentUserId();
  if (!uid) throw new Error('Sesi tidak ditemukan, silakan login ulang.');
  const { error } = await supabase.from('stock_movements').insert({
    business_unit_id: businessUnitId,
    outlet_id: outletId,
    product_id: productId,
    movement_type: movementType,
    qty_delta: qtyDelta,
    unit_cost: unitCost ?? null,
    notes: notes || null,
    created_by: uid
  });
  if (error) throw error;
}

/** Waste MENU: bahan terpotong sesuai resep menu (lewat RPC). */
export async function recordMenuWaste({ businessUnitId, outletId, productId, qty, notes }) {
  const { error } = await supabase.rpc('record_menu_waste', {
    p_bu: businessUnitId,
    p_outlet: outletId,
    p_product: productId,
    p_qty: qty,
    p_notes: notes || null
  });
  if (error) throw error;
}

/*
 * `transferStock()` DIHAPUS bersama tombol Transfer di Staff App.
 *
 * Setelah tombolnya hilang, tidak ada satu layar pun yang memanggilnya — dan
 * fungsi pengirim data yang menganggur akan dipanggil lagi suatu hari oleh
 * orang yang mengira ia masih jalur yang benar. Jalur yang benar adalah modul
 * **Pengiriman**, yang punya surat jalan, nomor, dan penerimaan di sisi tujuan.
 *
 * RPC `transfer_stock` di database TIDAK dihapus: ia masih bisa dipanggil dari
 * SQL Editor untuk koreksi darurat, dan menghapusnya berarti membuang jalan
 * keluar yang suatu saat dibutuhkan tanpa ada penggantinya.
 */

export async function listMovements({ businessUnitId, outletId, movementType, dateFrom, dateTo }) {
  let query = supabase
    .from('stock_movements')
    // `product_id` (skalar) ikut diambil supaya baris ini bisa dicocokkan dengan
    // master produk lewat ID. Mencocokkan lewat NAMA terlihat bekerja sampai ada
    // dua produk bernama sama — dan repo ini sudah punya sejarahnya.
    .select('id, product_id, movement_type, qty_delta, unit_cost, notes, created_at, products(name, base_unit), outlets!outlet_id(name), ref:outlets!ref_outlet_id(name), user_profiles!created_by(full_name)')
    .eq('business_unit_id', businessUnitId)
    .order('created_at', { ascending: false })
    .limit(300);
  if (outletId) query = query.eq('outlet_id', outletId);
  if (movementType) query = query.eq('movement_type', movementType);
  if (dateFrom) query = query.gte('created_at', dateFrom);
  if (dateTo) query = query.lte('created_at', dateTo);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function listRecentInventoryActivity({ limit = 25, before = null } = {}) {
  let query = supabase
    .from('stock_movements')
    .select('created_at, movement_type, qty_delta, products(name, base_unit), outlets!outlet_id(name), business_units(name), user_profiles!created_by(full_name)')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (before) query = query.lt('created_at', before);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

/**
 * Biaya rata-rata bahan menurut nota, untuk satu outlet (0118).
 *
 * PEMBANDING saja — tidak pernah dipakai menghitung HPP. Lihat alasan
 * panjangnya di `biaya-rata.js` dan di migration `0118`.
 *
 * Mengembalikan Map produkId -> { rata, qtyDasar, notaTerakhir }. Produk yang
 * belum pernah punya nota berharga TIDAK ADA di peta — sengaja tidak diwakili
 * angka nol, karena nol berarti "bahannya gratis" dan itu pernyataan yang
 * berbeda.
 */
export async function getBiayaRataOutlet(outletId) {
  if (!outletId) return new Map();
  const { data, error } = await supabase
    .from('biaya_rata_bahan')
    .select('product_id, rata, qty_dasar, nota_terakhir')
    .eq('outlet_id', outletId);
  if (error) throw error;
  return new Map((data ?? []).map((r) => [r.product_id, { rata: Number(r.rata), qtyDasar: Number(r.qty_dasar), notaTerakhir: r.nota_terakhir }]));
}
