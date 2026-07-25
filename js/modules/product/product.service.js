import { supabase } from '../../config/supabase-client.js';

export const PRODUCT_TYPES = [
  { value: 'raw', label: 'Bahan Baku' },
  { value: 'semi', label: 'Setengah Jadi' },
  { value: 'finished', label: 'Menu' }
];
export const TYPE_LABEL = { raw: 'Bahan Baku', semi: 'Setengah Jadi', finished: 'Menu' };

// ---- Master Satuan (global) ----

export async function listUnits() {
  const { data, error } = await supabase.from('units').select('id, name').order('name');
  if (error) throw error;
  return data ?? [];
}
export async function createUnit(name) {
  const { error } = await supabase.from('units').insert({ name });
  if (error) throw error;
}
export async function deleteUnit(id) {
  const { error } = await supabase.from('units').delete().eq('id', id);
  if (error) throw error;
}

// ---- Produk ----

export async function listProducts(businessUnitId) {
  const { data, error } = await supabase
    .from('products')
    .select('id, name, product_type, category, subcategory, base_unit, purchase_unit, purchase_qty, purchase_price, sale_price, is_active')
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
    category: p.category || null,
    subcategory: p.subcategory || null,
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
      category: p.category || null,
      subcategory: p.subcategory || null,
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

/** Daftar kategori & sub-kategori unik yang sudah dipakai (untuk dropdown). */
export function distinctCategories(products) {
  const cats = new Set();
  const subs = new Set();
  for (const p of products) {
    if (p.category) cats.add(p.category);
    if (p.subcategory) subs.add(p.subcategory);
  }
  return {
    categories: [...cats].sort((a, b) => a.localeCompare(b)),
    subcategories: [...subs].sort((a, b) => a.localeCompare(b))
  };
}

/** Harga jual saja (dipakai edit cepat di modul Menu). */
export async function updateSalePrice(id, salePrice) {
  const { error } = await supabase.from('products').update({ sale_price: salePrice }).eq('id', id);
  if (error) throw error;
}

export async function deleteProduct(id) {
  const { error } = await supabase.from('products').delete().eq('id', id);
  if (error) throw error;
}

// ---- Resep ----

export async function getRecipeForProduct(productId, mode) {
  const { data: recipe, error } = await supabase
    .from('recipes')
    .select('id, yield_qty, notes, mode')
    .eq('product_id', productId)
    .eq('mode', mode)
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

export async function saveRecipe({ productId, businessUnitId, mode, yield_qty, notes, items }) {
  let recipeId;
  const { data: existing, error: exErr } = await supabase
    .from('recipes')
    .select('id')
    .eq('product_id', productId)
    .eq('mode', mode)
    .maybeSingle();
  if (exErr) throw exErr;
  if (existing) {
    recipeId = existing.id;
    const { error } = await supabase.from('recipes').update({ yield_qty, notes: notes || null }).eq('id', recipeId);
    if (error) throw error;
  } else {
    const { data, error } = await supabase
      .from('recipes')
      .insert({ product_id: productId, business_unit_id: businessUnitId, mode, yield_qty, notes: notes || null })
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

/** Semua resep (semua mode) + itemnya di sebuah BU, untuk hitung HPP berjenjang. */
export async function listRecipesFull(businessUnitId) {
  const { data: recipes, error } = await supabase
    .from('recipes')
    .select('id, product_id, yield_qty, mode')
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
  for (const r of recipes ?? []) byRecipe.set(r.id, { product_id: r.product_id, mode: r.mode, yield_qty: Number(r.yield_qty), items: [] });
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
function buildCostFn(products, recipes) {
  const productById = new Map(products.map((p) => [p.id, p]));
  const recipeByKey = new Map(recipes.map((r) => [`${r.product_id}|${r.mode}`, r]));
  const memo = new Map();
  const visiting = new Set();

  // mode hanya relevan untuk produk 'finished'. semi -> 'production'; raw -> abaikan.
  function effMode(p, mode) {
    if (p.product_type === 'semi') return 'production';
    if (p.product_type === 'finished') return mode || 'standalone';
    return null;
  }

  function costOf(pid, mode) {
    const p = productById.get(pid);
    if (!p) return null;
    if (p.product_type === 'raw') {
      return p.purchase_price != null && Number(p.purchase_qty) > 0 ? Number(p.purchase_price) / Number(p.purchase_qty) : null;
    }
    const em = effMode(p, mode);
    const key = `${pid}|${em}`;
    if (memo.has(key)) return memo.get(key);
    const r = recipeByKey.get(key);
    if (!r || !r.items.length || !(Number(r.yield_qty) > 0)) {
      memo.set(key, null);
      return null;
    }
    if (visiting.has(key)) return null; // siklus
    visiting.add(key);
    let total = 0;
    let known = true;
    for (const it of r.items) {
      const c = costOf(it.ingredient_product_id, null); // bahan = raw/semi, mode tak relevan
      if (c == null) known = false;
      else total += Number(it.qty) * c;
    }
    visiting.delete(key);
    const result = known ? total / Number(r.yield_qty) : null;
    memo.set(key, result);
    return result;
  }
  return { costOf, productById };
}

/**
 * HPP per satuan tiap produk (Map productId -> number|null).
 *   raw -> harga beli; semi -> resep produksi; finished -> resep Standalone
 *   (kalau tak ada, pakai Dilayani CK). Untuk HPP per-varian pakai costForMode().
 */
export function computeCosts(products, recipes) {
  const { costOf } = buildCostFn(products, recipes);
  const out = new Map();
  for (const p of products) {
    if (p.product_type === 'finished') out.set(p.id, costOf(p.id, 'standalone') ?? costOf(p.id, 'served_by_ck'));
    else out.set(p.id, costOf(p.id, null));
  }
  return out;
}

/** HPP satu produk untuk mode tertentu (buat tampilan HPP per varian resep). */
export function costForMode(products, recipes, productId, mode) {
  const { costOf } = buildCostFn(products, recipes);
  return costOf(productId, mode);
}
