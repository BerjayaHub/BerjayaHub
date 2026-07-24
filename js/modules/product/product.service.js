import { supabase } from '../../config/supabase-client.js';

export const PRODUCT_TYPES = [
  { value: 'raw', label: 'Bahan Baku' },
  { value: 'semi', label: 'Setengah Jadi' },
  { value: 'finished', label: 'Produk Jadi' }
];
export const TYPE_LABEL = { raw: 'Bahan Baku', semi: 'Setengah Jadi', finished: 'Produk Jadi' };

// ---- Produk ----

export async function listProducts(businessUnitId) {
  const { data, error } = await supabase
    .from('products')
    .select('id, name, product_type, base_unit, purchase_unit, purchase_qty, purchase_price, sale_price, is_active')
    .eq('business_unit_id', businessUnitId)
    .order('product_type')
    .order('name');
  if (error) throw error;
  return data ?? [];
}

export async function createProduct(p) {
  const { error } = await supabase.from('products').insert({
    business_unit_id: p.businessUnitId,
    name: p.name,
    product_type: p.product_type,
    base_unit: p.base_unit,
    purchase_unit: p.purchase_unit || null,
    purchase_qty: p.purchase_qty ?? null,
    purchase_price: p.purchase_price ?? null,
    sale_price: p.sale_price ?? null
  });
  if (error) throw error;
}

export async function updateProduct(id, p) {
  const { error } = await supabase
    .from('products')
    .update({
      name: p.name,
      product_type: p.product_type,
      base_unit: p.base_unit,
      purchase_unit: p.purchase_unit || null,
      purchase_qty: p.purchase_qty ?? null,
      purchase_price: p.purchase_price ?? null,
      sale_price: p.sale_price ?? null,
      is_active: p.is_active
    })
    .eq('id', id);
  if (error) throw error;
}

export async function deleteProduct(id) {
  const { error } = await supabase.from('products').delete().eq('id', id);
  if (error) throw error;
}

// ---- Resep ----

export async function getRecipeForProduct(productId) {
  const { data: recipe, error } = await supabase
    .from('recipes')
    .select('id, yield_qty, notes')
    .eq('product_id', productId)
    .maybeSingle();
  if (error) throw error;
  if (!recipe) return { recipe: null, items: [] };
  const { data: items, error: e2 } = await supabase
    .from('recipe_items')
    .select('id, ingredient_product_id, qty, products(name, base_unit, product_type)')
    .eq('recipe_id', recipe.id);
  if (e2) throw e2;
  return { recipe, items: items ?? [] };
}

export async function saveRecipe({ productId, businessUnitId, yield_qty, notes, items }) {
  let recipeId;
  const { data: existing, error: exErr } = await supabase.from('recipes').select('id').eq('product_id', productId).maybeSingle();
  if (exErr) throw exErr;
  if (existing) {
    recipeId = existing.id;
    const { error } = await supabase.from('recipes').update({ yield_qty, notes: notes || null }).eq('id', recipeId);
    if (error) throw error;
  } else {
    const { data, error } = await supabase
      .from('recipes')
      .insert({ product_id: productId, business_unit_id: businessUnitId, yield_qty, notes: notes || null })
      .select('id')
      .single();
    if (error) throw error;
    recipeId = data.id;
  }
  await supabase.from('recipe_items').delete().eq('recipe_id', recipeId);
  if (items?.length) {
    const rows = items.map((i) => ({ recipe_id: recipeId, ingredient_product_id: i.ingredient_product_id, qty: i.qty }));
    const { error } = await supabase.from('recipe_items').insert(rows);
    if (error) throw error;
  }
  return recipeId;
}

/** Semua resep + itemnya di sebuah BU, untuk hitung HPP berjenjang. */
export async function listRecipesFull(businessUnitId) {
  const { data: recipes, error } = await supabase
    .from('recipes')
    .select('id, product_id, yield_qty')
    .eq('business_unit_id', businessUnitId);
  if (error) throw error;
  const ids = (recipes ?? []).map((r) => r.id);
  let items = [];
  if (ids.length) {
    const { data: it, error: e2 } = await supabase
      .from('recipe_items')
      .select('recipe_id, ingredient_product_id, qty')
      .in('recipe_id', ids);
    if (e2) throw e2;
    items = it ?? [];
  }
  const byRecipe = new Map();
  for (const r of recipes ?? []) byRecipe.set(r.id, { product_id: r.product_id, yield_qty: Number(r.yield_qty), items: [] });
  for (const i of items) byRecipe.get(i.recipe_id)?.items.push({ ingredient_product_id: i.ingredient_product_id, qty: Number(i.qty) });
  return [...byRecipe.values()];
}

/**
 * Hitung biaya (HPP) per satuan-pakai tiap produk.
 *   raw      -> purchase_price / purchase_qty
 *   semi/jadi-> Σ(qty item × biaya bahan) / yield_qty
 * Rekursif dengan memo + penjaga siklus (siklus dianggap biaya 0).
 * Return Map<productId, number|null> (null = belum bisa dihitung / belum ada resep).
 */
export function computeCosts(products, recipes) {
  const productById = new Map(products.map((p) => [p.id, p]));
  const recipeByProduct = new Map(recipes.map((r) => [r.product_id, r]));
  const memo = new Map();
  const visiting = new Set();

  function costOf(pid) {
    if (memo.has(pid)) return memo.get(pid);
    const p = productById.get(pid);
    if (!p) return null;

    if (p.product_type === 'raw') {
      const c = p.purchase_price != null && Number(p.purchase_qty) > 0 ? Number(p.purchase_price) / Number(p.purchase_qty) : null;
      memo.set(pid, c);
      return c;
    }

    const r = recipeByProduct.get(pid);
    if (!r || !r.items.length || !(Number(r.yield_qty) > 0)) {
      memo.set(pid, null);
      return null;
    }
    if (visiting.has(pid)) return null; // siklus
    visiting.add(pid);
    let total = 0;
    let known = true;
    for (const it of r.items) {
      const c = costOf(it.ingredient_product_id);
      if (c == null) known = false;
      else total += Number(it.qty) * c;
    }
    visiting.delete(pid);
    const result = known ? total / Number(r.yield_qty) : null;
    memo.set(pid, result);
    return result;
  }

  const out = new Map();
  for (const p of products) out.set(p.id, costOf(p.id));
  return out;
}
