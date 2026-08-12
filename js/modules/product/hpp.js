/**
 * Mesin HPP — dipisah dari `product.service.js` supaya BISA DIUJI.
 *
 * Perhitungannya murni: masuk daftar produk + daftar resep, keluar angka. Tapi
 * selama ia tinggal di file yang mengimpor klien Supabase (yang mengimpor CDN),
 * ia tidak bisa dijalankan di luar browser sama sekali — dan angka yang tidak
 * bisa diuji adalah angka yang dipakai menentukan harga jual.
 *
 * Di file ini juga tinggal PENJELASAN kenapa sebuah HPP tidak bisa dihitung.
 * Sengaja bersebelahan dengan perhitungannya: kalau penjelasannya ditulis
 * terpisah, ia akan menyimpang dari aturan sebenarnya, dan penjelasan yang
 * salah lebih buruk daripada tidak ada penjelasan — ia mengirim orang
 * membetulkan hal yang tidak rusak.
 *
 * Tidak ada impor di file ini, dan sebaiknya tetap begitu.
 */

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

/**
 * KENAPA sebuah HPP tidak bisa dihitung — dalam kalimat yang bisa ditindaklanjuti.
 *
 * Label "resep belum lengkap" selama ini menyesatkan: resepnya bisa saja
 * lengkap sempurna. Yang membuat HPP-nya kosong hampir selalu ada di BAHANNYA,
 * bukan di resep yang sedang dilihat — bahan baku yang harga belinya belum
 * diisi, atau setengah jadi yang resep Produksi-nya belum dibuat. Orang lalu
 * membongkar resep yang sudah benar, tidak menemukan apa-apa, dan menyimpulkan
 * aplikasinya yang salah.
 *
 * Yang TIDAK dilakukan di sini: menyebut stok. Stok tidak pernah ikut
 * menentukan HPP — HPP adalah biaya per satuan, bukan ketersediaan barang.
 *
 * @returns {string[]} daftar sebab; kosong berarti HPP-nya memang bisa dihitung
 */
export function sebabHppKosong(products, recipes, productId, mode) {
  const { productById } = buildCostFn(products, recipes);
  const recipeByKey = new Map((recipes ?? []).map((r) => [`${r.product_id}|${r.mode}`, r]));
  const sebab = [];
  const sudah = new Set();

  const telusuri = (pid, m, jalur) => {
    const kunci = `${pid}|${m}`;
    if (sudah.has(kunci)) return; // sudah dilaporkan / sedang ditelusuri (siklus)
    sudah.add(kunci);
    const p = productById.get(pid);
    if (!p) return;

    if (p.product_type === 'raw') {
      // Dua kolom, dua sebab yang berbeda — dan keduanya harus disebut
      // terpisah, karena yang satu diisi di kolom "Harga Beli" dan yang lain di
      // "Isi per Satuan Beli".
      if (p.purchase_price == null) sebab.push(`${p.name}: harga belinya belum diisi${jalur}`);
      else if (!(Number(p.purchase_qty) > 0)) sebab.push(`${p.name}: "isi per satuan beli" belum diisi, jadi harga per ${p.base_unit} tidak bisa dihitung${jalur}`);
      return;
    }

    const em = p.product_type === 'semi' ? 'production' : m || 'standalone';
    const r = recipeByKey.get(`${pid}|${em}`);
    if (!r) {
      sebab.push(`${p.name}: belum punya resep ${em === 'production' ? 'Produksi' : em === 'standalone' ? 'Standalone' : 'Dilayani CK'}${jalur}`);
      return;
    }
    if (!r.items?.length) {
      sebab.push(`${p.name}: resepnya ada tapi belum berisi bahan${jalur}`);
      return;
    }
    if (!(Number(r.yield_qty) > 0)) {
      sebab.push(`${p.name}: hasil/yield-nya 0 — tidak bisa dibagi${jalur}`);
      return;
    }
    for (const it of r.items) {
      telusuri(it.ingredient_product_id, null, ` (dipakai ${p.name})`);
    }
  };

  // Produk yang ditanyakan tidak diberi keterangan "dipakai …" — ia yang sedang
  // dilihat, bukan bahan milik sesuatu yang lain.
  telusuri(productId, mode, '');
  return sebab;
}
