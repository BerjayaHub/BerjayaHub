import { supabase } from '../../config/supabase-client.js';
import { listProducts, listRecipesFull } from '../product/product.service.js';

/**
 * Produk yang bisa diproduksi = semi/finished yang PUNYA resep.
 * Return array produk + resepnya (yield + items) untuk preview kebutuhan.
 */
export async function listManufacturable(businessUnitId) {
  const [products, recipes] = await Promise.all([listProducts(businessUnitId), listRecipesFull(businessUnitId)]);
  const productById = new Map(products.map((p) => [p.id, p]));
  // Produksi (di CK) hanya untuk produk SETENGAH JADI dengan resep 'production'.
  const recipeByProduct = new Map(recipes.filter((r) => r.mode === 'production').map((r) => [r.product_id, r]));
  return products
    .filter((p) => p.product_type === 'semi' && recipeByProduct.get(p.id)?.items.length)
    .map((p) => {
      const r = recipeByProduct.get(p.id);
      return {
        ...p,
        yield_qty: r.yield_qty,
        items: r.items.map((it) => ({
          ingredient_product_id: it.ingredient_product_id,
          qty: it.qty,
          name: productById.get(it.ingredient_product_id)?.name ?? '-',
          base_unit: productById.get(it.ingredient_product_id)?.base_unit ?? ''
        }))
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Kebutuhan bahan untuk memproduksi outputQty dari sebuah produk termanufaktur. */
export function computeNeeds(product, outputQty) {
  const factor = product.yield_qty > 0 ? outputQty / product.yield_qty : 0;
  return product.items.map((it) => ({ ...it, need: it.qty * factor }));
}

export async function recordProduction({ businessUnitId, outletId, productId, outputQty, notes }) {
  const { error } = await supabase.rpc('record_production', {
    p_bu: businessUnitId,
    p_outlet: outletId,
    p_product: productId,
    p_output_qty: outputQty,
    p_notes: notes || null
  });
  if (error) throw error;
}

/**
 * @param {boolean} [o.denganDibatalkan] ikut menampilkan produksi yang dibatalkan
 */
export async function listProductionRuns({ businessUnitId, outletId, dateFrom, dateTo, denganDibatalkan = false }) {
  let query = supabase
    .from('production_runs')
    .select(
      'id, output_qty, notes, created_at, product_id, created_by, cancelled_at, cancel_reason, products(name, base_unit), outlets(name), user_profiles(full_name)'
    )
    .eq('business_unit_id', businessUnitId)
    .order('created_at', { ascending: false })
    .limit(300);
  if (outletId) query = query.eq('outlet_id', outletId);
  if (dateFrom) query = query.gte('created_at', dateFrom);
  if (dateTo) query = query.lte('created_at', dateTo);
  // Yang dibatalkan disembunyikan secara default: dari sisi orangnya ia memang
  // "sudah dihapus". Barisnya tetap ada di database supaya pergerakan stok
  // penyeimbangnya punya asal-usul yang bisa ditelusuri (0092).
  if (!denganDibatalkan) query = query.is('cancelled_at', null);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function listRecentProductionActivity({ limit = 25, before = null } = {}) {
  let query = supabase
    .from('production_runs')
    .select('created_at, output_qty, products(name, base_unit), outlets(name), business_units(name), user_profiles(full_name)')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (before) query = query.lt('created_at', before);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

/**
 * Perbaiki jumlah hasil / catatan sebuah produksi.
 *
 * Stoknya dikoreksi lewat pergerakan PENYEIMBANG di `ubah_produksi()` (0092) —
 * pergerakan lama tidak pernah disentuh. Produk tidak bisa diganti di sini;
 * untuk itu batalkan lalu catat ulang, supaya riwayatnya jujur bahwa dua hal
 * berbeda pernah terjadi.
 */
export async function ubahProduksi({ runId, outputQty, notes }) {
  const { error } = await supabase.rpc('ubah_produksi', {
    p_run: runId,
    p_output_qty: outputQty,
    p_notes: notes || null
  });
  if (error) throw new Error(error.message ?? String(error));
}

/** Batalkan produksi: seluruh stoknya dibalik, barisnya ditandai dibatalkan. */
export async function hapusProduksi({ runId, alasan }) {
  const { error } = await supabase.rpc('hapus_produksi', { p_run: runId, p_alasan: alasan || null });
  if (error) throw new Error(error.message ?? String(error));
}
