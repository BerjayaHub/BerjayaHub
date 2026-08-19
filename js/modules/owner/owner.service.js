import { supabase } from '../../config/supabase-client.js';
import { ambilSemua } from '../../core/ambil-semua.js';

/**
 * Pengambilan data untuk halaman owner.
 *
 * ============ SEMUA YANG BERUPA DAFTAR PANJANG LEWAT `ambilSemua` ============
 *
 * PostgREST memotong hasil di sekitar 1000 baris TANPA memberi tahu — tidak ada
 * error, tidak ada penanda, hanya array yang lebih pendek. Untuk halaman owner
 * akibatnya khusus buruk: penjualan sebulan di tiga outlet dengan mudah melewati
 * 1000 baris, dan yang terpotong akan menurunkan omzet serta MENGGESER bauran
 * penjualan. BEP-nya lalu dihitung dari bauran yang salah, dan hasilnya tetap
 * berupa angka yang wajar.
 *
 * Maka `sales`, `stock_movements`, dan `cash_entries` selalu diambil bertahap.
 *
 * ============ TIDAK ADA SATU PUN FUNGSI TULIS DI BERKAS INI ============
 *
 * Disengaja. Owner memang tidak punya hak tulis di database (lihat 0093), jadi
 * fungsi tulis di sini hanya akan gagal saat dijalankan — dan gagalnya pada RLS
 * berupa "sukses dengan 0 baris", yaitu kegagalan yang paling sulit disadari.
 * Satu-satunya tulisan owner ada di `dokumen.service.js`, lewat RPC.
 */

/** BU yang diawasi orang yang sedang login. Kosong = dia bukan owner. */
export async function listBuOwner() {
  const { data, error } = await supabase
    .from('owner_scopes')
    .select('business_unit_id, business_units(id, name, type, theme_color, logo_url, pricing_method, food_cost_percent, markup_percent, margin_percent)')
    .order('created_at');
  if (error) throw error;

  return (data ?? [])
    .map((r) => r.business_units)
    .filter(Boolean)
    .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
}

/**
 * Produk BESERTA kolom harga yang baru (0093).
 *
 * Sengaja tidak menumpang `product.service.js#listProducts`: menambah tiga
 * kolom di sana berarti setiap layar Staff App ikut mengunduhnya pada tiap
 * permintaan, padahal hanya halaman owner yang memakainya. Bentuk hasilnya
 * dibuat sama persis supaya `computeCosts()` bisa menerima keduanya tanpa
 * perbedaan.
 */
export async function listProductsOwner(businessUnitId) {
  return ambilSemua((from, to) =>
    supabase
      .from('products')
      .select(
        'id, name, product_type, category, subcategory, base_unit, purchase_unit, purchase_qty, purchase_price, sale_price, is_active, packaging_cost, fee_online_percent, promo_percent'
      )
      .eq('business_unit_id', businessUnitId)
      .order('product_type')
      .order('name')
      .range(from, to)
  );
}

export async function listOutletsBu(businessUnitId) {
  const { data, error } = await supabase
    .from('outlets')
    .select('id, name, outlet_role, is_active')
    .eq('business_unit_id', businessUnitId)
    .order('name');
  if (error) throw error;
  return data ?? [];
}

/**
 * Penjualan pada rentang tanggal.
 *
 * `outletIds` kosong berarti SELURUH BU — bukan "tidak ada". Dibedakan dengan
 * sengaja: `.in('outlet_id', [])` menghasilkan nol baris, dan halaman akan
 * menampilkan "belum ada penjualan" untuk BU yang sebenarnya ramai.
 */
export async function listSales({ businessUnitId, dari, sampai, outletIds = null }) {
  return ambilSemua((from, to) => {
    let q = supabase
      .from('sales')
      .select('product_id, outlet_id, sale_date, qty, unit_price, revenue')
      .eq('business_unit_id', businessUnitId)
      .gte('sale_date', dari)
      .lte('sale_date', sampai)
      .order('sale_date')
      .range(from, to);
    if (outletIds?.length) q = q.in('outlet_id', outletIds);
    return q;
  });
}

export async function listStockMovements({ businessUnitId, dari, sampai, outletIds = null }) {
  return ambilSemua((from, to) => {
    let q = supabase
      .from('stock_movements')
      .select('movement_type, qty_delta, unit_cost, product_id, outlet_id, created_at')
      .eq('business_unit_id', businessUnitId)
      .gte('created_at', `${dari}T00:00:00+07:00`)
      .lte('created_at', `${sampai}T23:59:59+07:00`)
      .order('created_at')
      .range(from, to);
    if (outletIds?.length) q = q.in('outlet_id', outletIds);
    return q;
  });
}

/**
 * Saldo stok saat ini.
 *
 * Tidak difilter tanggal: saldo adalah keadaan SEKARANG, bukan keadaan pada
 * rentang yang sedang dilihat. Memfilternya dengan rentang akan menghasilkan
 * "saldo" yang sebenarnya mutasi periode itu saja — angka yang selalu lebih
 * kecil dan tidak pernah terlihat salah.
 */
export async function listStockBalances({ businessUnitId, outletIds = null }) {
  return ambilSemua((from, to) => {
    let q = supabase
      .from('stock_balances')
      .select('outlet_id, product_id, qty')
      .eq('business_unit_id', businessUnitId)
      .range(from, to);
    if (outletIds?.length) q = q.in('outlet_id', outletIds);
    return q;
  });
}

export async function listProductionRuns({ businessUnitId, dari, sampai, outletIds = null }) {
  let q = supabase
    .from('production_runs')
    .select('id, product_id, outlet_id, output_qty, created_at, cancelled_at')
    .eq('business_unit_id', businessUnitId)
    .gte('created_at', `${dari}T00:00:00+07:00`)
    .lte('created_at', `${sampai}T23:59:59+07:00`)
    .order('created_at', { ascending: false });
  if (outletIds?.length) q = q.in('outlet_id', outletIds);

  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

/**
 * Kas keluar untuk outlet-outlet BU ini.
 *
 * Perhatikan sumber cakupannya: `outlet_id`, BUKAN `business_unit_id`. Sejak
 * 0040 kolom BU di `cash_entries` ditandai deprecated dan baris baru
 * membiarkannya NULL — menyaring dengan kolom itu akan mengembalikan hampir
 * nol baris, dan halaman BEP akan menampilkan biaya tetap Rp 0 tanpa satu pun
 * error. Penjelasan lengkapnya di 0093 bagian (4).
 */
export async function listCashEntries({ outletIds, dari, sampai }) {
  if (!outletIds?.length) return [];
  return ambilSemua((from, to) =>
    supabase
      .from('cash_entries')
      .select('id, entry_type, amount, category_id, outlet_id, entry_date, notes')
      .in('outlet_id', outletIds)
      .gte('entry_date', dari)
      .lte('entry_date', sampai)
      .order('entry_date')
      .range(from, to)
  );
}

export async function listCashCategories() {
  const { data, error } = await supabase.from('cash_categories').select('id, name, direction, is_fixed_cost, is_active').order('name');
  if (error) throw error;
  return data ?? [];
}

/** Aktivitas harian + itemnya, untuk KPI kepatuhan. */
export async function listChecklist({ businessUnitId, dari, sampai, outletIds = null }) {
  let q = supabase
    .from('checklist_runs')
    .select('id, run_date, outlet_id, session_id, user_id')
    .eq('business_unit_id', businessUnitId)
    .gte('run_date', dari)
    .lte('run_date', sampai);
  if (outletIds?.length) q = q.in('outlet_id', outletIds);

  const { data: runs, error } = await q;
  if (error) throw error;
  if (!runs?.length) return { runs: [], items: [] };

  const items = await ambilSemua((from, to) =>
    supabase
      .from('checklist_run_items')
      .select('run_id, item_id, checked')
      .in(
        'run_id',
        runs.map((r) => r.id)
      )
      .range(from, to)
  );

  return { runs, items };
}

export async function listAttendance({ businessUnitId, dari, sampai, outletIds = null }) {
  let q = supabase
    .from('attendance_records')
    .select('user_id, outlet_id, clock_in_at, clock_out_at')
    .eq('business_unit_id', businessUnitId)
    .gte('clock_in_at', `${dari}T00:00:00+07:00`)
    .lte('clock_in_at', `${sampai}T23:59:59+07:00`);
  if (outletIds?.length) q = q.in('outlet_id', outletIds);

  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

/**
 * Berapa hari dalam rentang ini yang BENAR-BENAR ada penjualannya.
 *
 * Dipakai sebagai penyebut "omzet per hari". Memakai jumlah hari kalender akan
 * membagi dengan hari-hari libur dan hari sebelum outletnya buka, sehingga
 * rata-rata hariannya lebih rendah daripada kenyataan — dan lebih rendah selalu
 * terlihat lebih masuk akal, jadi tidak akan ditanyakan.
 */
export function hariAdaPenjualan(sales) {
  return new Set((sales ?? []).map((s) => s.sale_date).filter(Boolean)).size;
}
