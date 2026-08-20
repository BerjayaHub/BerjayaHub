import { supabase } from '../../config/supabase-client.js';
import { ambilSemua } from '../../core/ambil-semua.js';

/**
 * Harga jual per OUTLET (migration 0096).
 *
 * ============ KENAPA DI FOLDER `menu`, BUKAN `owner` ============
 *
 * Harga adalah konfigurasi master, dan sumber kebenarannya Admin Portal →
 * Menu. Halaman Owner hanya MEMBACANYA. Menaruh berkas ini di `js/modules/owner/`
 * akan membuatnya kena `audit-owner-baca-saja.cjs` dan menuntut pengecualian
 * baru — pengecualian untuk sesuatu yang memang bukan milik halaman owner.
 *
 * ============ MENAIKKAN HARGA = MENAMBAH BARIS, BUKAN MENGUBAH ============
 *
 * `ubahHarga()` sengaja TIDAK ada. Yang ada `pasangHargaBaru()`, dan ia selalu
 * `insert`. Trigger di database yang menutup baris sebelumnya.
 *
 * Kalau harga diubah dengan `update`, harga lama lenyap — dan bersamanya lenyap
 * kemampuan menjawab "berapa harga menu ini bulan lalu". Yang tersisa cuma
 * `sales.unit_price` per transaksi, yang tidak bisa menjawab pertanyaan tentang
 * menu yang kebetulan tidak terjual hari itu.
 *
 * `perbaikiHarga()` ada untuk kasus yang berbeda: SALAH KETIK yang belum sempat
 * dipakai transaksi. Ia memang `update`, dan namanya sengaja berbeda supaya
 * tidak terpakai untuk kenaikan harga.
 */

const KOLOM =
  'id, business_unit_id, outlet_id, product_id, selling_price, packaging_cost, ' +
  'fee_online_percent, promo_percent, effective_from, effective_to, is_available, notes, created_at';

/** Harga yang BERLAKU HARI INI untuk seluruh outlet sebuah BU. */
export async function listHargaAktif(businessUnitId, { tanggal = null } = {}) {
  const hari = tanggal ?? new Date().toISOString().slice(0, 10);
  return ambilSemua((dari, sampai) =>
    supabase
      .from('outlet_menu_prices')
      .select(`${KOLOM}, outlets!outlet_id(name), products!product_id(name, category)`)
      .eq('business_unit_id', businessUnitId)
      .lte('effective_from', hari)
      .or(`effective_to.is.null,effective_to.gte.${hari}`)
      .order('outlet_id')
      .range(dari, sampai)
  );
}

/** Seluruh riwayat harga satu (outlet, produk) — termasuk yang sudah ditutup. */
export async function riwayatHarga({ outletId, productId }) {
  const { data, error } = await supabase
    .from('outlet_menu_prices')
    .select(KOLOM)
    .eq('outlet_id', outletId)
    .eq('product_id', productId)
    .order('effective_from', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/**
 * Pasang harga baru mulai tanggal tertentu.
 *
 * Selalu `insert`. Trigger `omp_jaga_rentang` yang menutup harga sebelumnya di
 * `effective_from - 1`, dan yang menolak kalau rentangnya bertabrakan.
 */
export async function pasangHargaBaru({
  businessUnitId,
  outletId,
  productId,
  sellingPrice,
  packagingCost = 0,
  feeOnlinePercent = 0,
  promoPercent = 0,
  effectiveFrom,
  notes = null
}) {
  const { data: sesi } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from('outlet_menu_prices')
    .insert({
      business_unit_id: businessUnitId,
      outlet_id: outletId,
      product_id: productId,
      selling_price: sellingPrice,
      packaging_cost: packagingCost,
      fee_online_percent: feeOnlinePercent,
      promo_percent: promoPercent,
      effective_from: effectiveFrom,
      notes: notes?.trim() || null,
      created_by: sesi?.user?.id ?? null
    })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

/**
 * Perbaiki baris harga yang SALAH KETIK.
 *
 * Bukan untuk menaikkan harga — untuk itu pakai `pasangHargaBaru()`. Dipisah
 * namanya supaya perbedaannya tidak hilang saat dibaca sekilas: yang satu
 * menambah babak baru, yang satu membetulkan babak yang sedang berjalan.
 */
export async function perbaikiHarga(id, { sellingPrice, packagingCost, feeOnlinePercent, promoPercent, notes = null }) {
  // `.select()` WAJIB — PostgREST tidak menganggap penolakan RLS sebagai error.
  // UPDATE yang ditolak pulang sukses dengan nol baris, dan layar berikutnya
  // menampilkan angka lama seolah penyimpanannya berhasil.
  const { data, error } = await supabase
    .from('outlet_menu_prices')
    .update({
      selling_price: sellingPrice,
      packaging_cost: packagingCost,
      fee_online_percent: feeOnlinePercent,
      promo_percent: promoPercent,
      notes: notes?.trim() || null
    })
    .eq('id', id)
    .select('id');
  if (error) throw error;
  if (!data?.length) throw new Error('Harga tidak jadi diubah — kemungkinan kamu tidak berhak mengubahnya.');
}

export async function setKetersediaan(id, tersedia) {
  const { data, error } = await supabase
    .from('outlet_menu_prices')
    .update({ is_available: tersedia })
    .eq('id', id)
    .select('id');
  if (error) throw error;
  if (!data?.length) throw new Error('Ketersediaan tidak jadi diubah — kemungkinan kamu tidak berhak mengubahnya.');
}

/**
 * Outlet × menu yang BELUM punya harga aktif.
 *
 * Ini bukan sekadar laporan. Sejak 0099, menjual menu tanpa harga outlet
 * DITOLAK seluruh transaksinya — jadi daftar ini adalah daftar hal yang akan
 * membuat staff gagal menyimpan penjualan. Ia harus terlihat sebelum staff
 * menemukannya sendiri di tengah jam sibuk.
 *
 * Dihitung di klien dari dua daftar yang memang sudah diunduh, bukan lewat
 * query terpisah: `not exists` lintas tabel tidak bisa dinyatakan lewat
 * PostgREST tanpa view atau RPC, dan menambah salah satunya untuk satu layar
 * peringatan tidak sepadan.
 */
export function menuTanpaHarga({ outlets, products, hargaAktif }) {
  const punya = new Set((hargaAktif ?? []).map((h) => `${h.outlet_id}|${h.product_id}`));
  const menu = (products ?? []).filter((p) => p.product_type === 'finished' && p.is_active !== false);

  const kurang = [];
  for (const o of outlets ?? []) {
    if (o.is_active === false) continue;
    for (const m of menu) {
      if (!punya.has(`${o.id}|${m.id}`)) {
        kurang.push({ outletId: o.id, outlet: o.name, productId: m.id, menu: m.name });
      }
    }
  }
  return kurang.sort((a, b) => a.outlet.localeCompare(b.outlet) || a.menu.localeCompare(b.menu));
}

/**
 * Berapa banyak harga yang masih persis hasil backfill.
 *
 * Sesudah `0097`, semua outlet menerima harga yang SAMA dari `products.sale_price`.
 * Selama belum disesuaikan, "profitabilitas per outlet" akan menampilkan margin
 * yang identik di semua outlet — bukan karena sistemnya salah, tapi karena
 * harganya memang belum dibedakan.
 *
 * Angka ini ditampilkan supaya keadaan itu terlihat dan tidak disalahartikan
 * sebagai kesimpulan.
 */
export function jumlahMasihBawaan(hargaAktif) {
  return (hargaAktif ?? []).filter((h) => (h.notes ?? '').includes('migration 0097')).length;
}
