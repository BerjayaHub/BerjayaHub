import { supabase } from '../../config/supabase-client.js';
export { computeCosts, costForMode, sebabHppKosong } from './hpp.js';

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
  const { data, error } = await supabase
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
    .eq('id', id)
    .select('id');
  if (error) throw error;
  if (!data?.length) throw new Error('Tidak tersimpan — produk hanya bisa diubah Admin BU atau Super Admin.');
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
/**
 * Ubah harga jual dari tabel Menu.
 *
 * `.select()` WAJIB. Policy `products_modify` mensyaratkan **admin BU**, dan
 * penolakan RLS pada UPDATE bukan error — PostgREST membalas sukses dengan 0
 * baris. Tanpa pemeriksaan ini, admin outlet mengetik harga baru, melihat
 * "Harga jual diperbarui", dan harganya tidak berubah sama sekali. Harga jual
 * adalah angka yang dipakai kasir; salah di sini berarti salah tagih ke tamu.
 */
export async function updateSalePrice(id, salePrice) {
  const { data, error } = await supabase.from('products').update({ sale_price: salePrice }).eq('id', id).select('id');
  if (error) throw error;
  if (!data?.length) throw new Error('Tidak tersimpan — harga jual hanya bisa diubah Admin BU atau Super Admin.');
}

/**
 * Ubah kategori/sub-kategori satu produk. Dipakai edit cepat di tabel Menu.
 *
 * Terpisah dari `updateProduct` yang menulis SELURUH kolom: edit cepat hanya
 * boleh menyentuh yang diketik. Mengirim seluruh kolom dari baris tabel berarti
 * kolom yang tidak ditampilkan di tabel itu ikut ditulis ulang dari salinan
 * lama yang bisa saja sudah basi — mis. harga beli yang baru diubah orang lain
 * semenit sebelumnya.
 */
export async function updateProductCategory(id, { category, subcategory }) {
  const patch = {};
  if (category !== undefined) patch.category = String(category ?? '').trim() || null;
  if (subcategory !== undefined) patch.subcategory = String(subcategory ?? '').trim() || null;
  if (!Object.keys(patch).length) return;
  const { data, error } = await supabase.from('products').update(patch).eq('id', id).select('id');
  if (error) throw error;
  if (!data?.length) throw new Error('Tidak tersimpan — kategori hanya bisa diubah Admin BU atau Super Admin.');
}

export async function deleteProduct(id) {
  const { data, error } = await supabase.from('products').delete().eq('id', id).select('id');
  if (error) throw error;
  if (!data?.length) throw new Error('Tidak terhapus — produk hanya bisa dihapus Admin BU atau Super Admin.');
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

/**
 * Simpan (atau perbarui) satu varian resep.
 *
 * PENOLAKAN IZIN DI SINI PERNAH TIDAK TERLIHAT SAMA SEKALI. Policy
 * `recipes_modify` mensyaratkan **admin BU** — admin outlet tidak termasuk. Dan
 * penolakan RLS pada UPDATE/DELETE bukan error: PostgREST membalas sukses
 * dengan 0 baris. Jalur "resep sudah ada lalu diubah" karena itu berakhir
 * dengan notifikasi hijau dan tidak ada satu pun perubahan tersimpan —
 * sementara jalur "resep baru" (INSERT) gagal dengan pesan. Perilaku yang
 * berbeda untuk sebab yang sama itulah yang membuatnya terasa seperti
 * "kadang bisa, kadang tidak".
 */
const PESAN_BUKAN_ADMIN_BU = 'Resep hanya bisa diubah Admin BU atau Super Admin. Minta mereka yang menyimpannya.';

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
    const { data, error } = await supabase
      .from('recipes')
      .update({ yield_qty, notes: notes || null })
      .eq('id', recipeId)
      .select('id');
    if (error) throw error;
    if (!data?.length) throw new Error(PESAN_BUKAN_ADMIN_BU);
  } else {
    const { data, error } = await supabase
      .from('recipes')
      .insert({ product_id: productId, business_unit_id: businessUnitId, mode, yield_qty, notes: notes || null })
      .select('id')
      .single();
    if (error) throw error;
    recipeId = data.id;
  }
  // Bahan lama dibuang lalu ditulis ulang. Kalau penghapusannya ditolak diam-
  // diam, bahan lama akan BERGABUNG dengan bahan baru — HPP-nya jadi hasil
  // penjumlahan dua resep, dan angka itu dipakai untuk menentukan harga jual.
  const { error: errHapus } = await supabase.from('recipe_items').delete().eq('recipe_id', recipeId).select('id');
  if (errHapus) throw errHapus;
  if (items?.length) {
    const rows = items.map((i) => ({ recipe_id: recipeId, ingredient_product_id: i.ingredient_product_id, qty: i.qty }));
    const { data, error } = await supabase.from('recipe_items').insert(rows).select('id');
    if (error) throw error;
    if ((data ?? []).length !== rows.length) throw new Error(PESAN_BUKAN_ADMIN_BU);
  }
  return recipeId;
}

/**
 * Hapus SATU varian resep beserta seluruh bahannya.
 *
 * `recipe_items` ikut terhapus otomatis (FK `on delete cascade` di 0017), jadi
 * tidak ada baris bahan yang tertinggal menggantung.
 *
 * Yang dihapus hanya varian yang disebut. Menu bisa punya dua varian yang
 * berdiri sendiri — menghapus "Standalone" tidak boleh menyentuh "Dilayani CK",
 * karena keduanya menjawab cara produksi yang berbeda dan dipakai outlet yang
 * berbeda.
 *
 * `.select()` wajib: `recipes_modify` mensyaratkan admin BU, dan DELETE yang
 * ditolak RLS membalas sukses dengan 0 baris — resepnya akan terlihat "sudah
 * dihapus" sampai halamannya dimuat ulang, lalu muncul lagi.
 */
export async function deleteRecipe(productId, mode) {
  const { data, error } = await supabase.from('recipes').delete().eq('product_id', productId).eq('mode', mode).select('id');
  if (error) throw error;
  if (!data?.length) {
    throw new Error('Tidak terhapus — resep hanya bisa dihapus Admin BU atau Super Admin, atau resepnya memang sudah tidak ada.');
  }
}

/**
 * Pindahkan satu resep ke varian lain (Standalone ⇄ Dilayani CK).
 *
 * Isi resepnya tidak disentuh sama sekali — yang berubah cuma `mode`, jadi
 * `recipe_items` ikut pindah tanpa perlu disalin. Menyalin lalu menghapus akan
 * membuka celah kehilangan data kalau langkah keduanya gagal.
 *
 * `.eq('mode', dari)` bukan sekadar penyaring: ia yang membuat operasi ini aman
 * dijalankan dua kali. Panggilan kedua tidak menemukan baris dan berhenti dengan
 * pesan, bukan diam-diam memindahkan resep tujuan ke tempat lain.
 */
export async function pindahVarianResep(productId, dari, ke) {
  const { data, error } = await supabase
    .from('recipes')
    .update({ mode: ke })
    .eq('product_id', productId)
    .eq('mode', dari)
    .select('id');
  if (error) {
    // 23505 = unique_violation di `recipes_product_mode_uk`. UI sudah mencegat
    // ini lewat periksaPindah(), tapi dua tab yang terbuka bersamaan bisa lolos.
    if (error.code === '23505') {
      throw new Error('Varian tujuan sudah punya resep. Muat ulang halaman — mungkin baru saja dibuat di tempat lain.');
    }
    throw error;
  }
  if (!data?.length) throw new Error(PESAN_BUKAN_ADMIN_BU);
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

