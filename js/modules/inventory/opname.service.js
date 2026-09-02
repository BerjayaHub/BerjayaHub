/**
 * Sesi Stok Opname bernomor (0085).
 *
 * PEMBAGIAN WEWENANGNYA, karena inilah yang paling mudah salah dipahami saat
 * membaca layarnya:
 *
 *   - MEMBUKA / MENUTUP / MEMBATALKAN sesi  -> Admin BU & Super Admin saja.
 *   - MENGISI hitungan                      -> siapa pun yang berwenang di outlet.
 *
 * Penjaganya ada di DATABASE (`is_bu_admin` di dalam RPC-nya), bukan di sini.
 * Yang di sisi aplikasi cuma menyembunyikan tombol supaya orang tidak menekan
 * sesuatu yang pasti ditolak — bukan pengaman. Menyembunyikan tombol tidak
 * menghentikan siapa pun yang memanggil RPC-nya langsung.
 *
 * STOK TIDAK BERGERAK SAMA SEKALI sampai `tutupOpname()`. Staff boleh mengubah
 * hitungannya berapa kali pun; yang tersimpan cuma catatan hitungan.
 */

import { supabase } from '../../config/supabase-client.js';
import { ambilSemua } from '../../core/ambil-semua.js';

/** Sesi yang sedang terbuka di sebuah outlet, atau null. */
export async function sesiTerbuka(outletId) {
  if (!outletId) return null;
  const { data, error } = await supabase
    .from('stock_counts')
    .select('id, code, count_date, status, notes, opened_at, pembuka:user_profiles!opened_by(full_name)')
    .eq('outlet_id', outletId)
    .eq('status', 'open')
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

/** ADMIN SAJA. Membuka sesi baru, atau mengembalikan yang sudah terbuka. */
export async function bukaOpname(outletId, notes = null) {
  const { data, error } = await supabase.rpc('buka_opname', { p_outlet: outletId, p_notes: notes });
  if (error) throw new Error(error.message ?? String(error));
  return data;
}

/**
 * Catat satu hitungan fisik.
 *
 * `systemQty` SENGAJA TIDAK LAGI DIKIRIM — sejak 0114, stok sistem dibaca
 * server pada detik hitungannya disimpan.
 *
 * Ini menutup bug yang bentuknya begini: peta stok dimuat saat halaman DIBUKA,
 * lalu orangnya menghitung isi rak selama satu jam. Kalau stoknya berubah di
 * sela itu — opname sebelumnya ditutup, nota masuk — peta di HP sudah basi.
 * Untuk bahan yang saat halaman dibuka belum punya pergerakan, yang terkirim
 * adalah NOL, dan penutupan sesi menuliskan `dihitung - 0` sebagai penyesuaian
 * POSITIF di atas stok yang sudah ada.
 *
 * Kasus nyatanya: nanas 6.400, dihitung 4.600, hasilnya 11.000.
 *
 * Perbaikan sebelumnya menolak menyimpan saat peta stoknya HILANG. Itu tidak
 * cukup — peta yang BASI tidak hilang, ia berisi angka yang salah dan tidak
 * bisa dibedakan dari yang segar. Satu-satunya perbaikan yang menutup seluruh
 * kelasnya adalah mencabut suara layar dalam angka itu.
 *
 * Parameternya tetap dikirim sebagai `null` — bukan dihilangkan — supaya
 * bentuk panggilannya cocok dengan tanda tangan fungsinya dan tidak bergantung
 * pada resolusi default PostgREST.
 */
export async function catatHitungan({ countId, productId, counted, notes = null }) {
  const { error } = await supabase.rpc('catat_hitungan_opname', {
    p_count: countId,
    p_product: productId,
    p_counted: counted,
    p_system: null,
    p_notes: notes
  });
  if (error) throw new Error(error.message ?? String(error));
}

/** ADMIN SAJA. Menutup sesi — DI SINI stok berubah. Mengembalikan jumlah penyesuaian. */
export async function tutupOpname(countId) {
  const { data, error } = await supabase.rpc('tutup_opname', { p_count: countId });
  if (error) throw new Error(error.message ?? String(error));
  return data ?? 0;
}

/** ADMIN SAJA. Menutup sesi TANPA menyentuh stok. Alasan wajib. */
export async function batalkanOpname(countId, alasan) {
  const { error } = await supabase.rpc('batalkan_opname', { p_count: countId, p_alasan: alasan });
  if (error) throw new Error(error.message ?? String(error));
}

/** Isi satu sesi, lengkap dengan nama produk & penghitungnya. */
export async function itemOpname(countId) {
  if (!countId) return [];
  return ambilSemua((dari, sampai) =>
    supabase
      .from('stock_count_items')
      .select(
        'product_id, system_qty, counted_qty, counted_at, sebelumnya, notes, products(name, base_unit, category), penghitung:user_profiles!counted_by(full_name)',
        { count: 'exact' }
      )
      .eq('count_id', countId)
      .range(dari, sampai)
  );
}

/** Riwayat sesi opname sebuah BU, terbaru dulu. */
export async function riwayatOpname(businessUnitId, { outletId = null, dateFrom = null, dateTo = null } = {}) {
  return ambilSemua((dari, sampai) => {
    let q = supabase
      .from('stock_counts')
      .select(
        'id, code, count_date, status, notes, outlet_id, opened_at, closed_at, outlets!outlet_id(name), pembuka:user_profiles!opened_by(full_name), penutup:user_profiles!closed_by(full_name)',
        { count: 'exact' }
      )
      .eq('business_unit_id', businessUnitId)
      .order('count_date', { ascending: false })
      .order('opened_at', { ascending: false });
    if (outletId) q = q.eq('outlet_id', outletId);
    if (dateFrom) q = q.gte('count_date', dateFrom);
    if (dateTo) q = q.lte('count_date', dateTo);
    return q.range(dari, sampai);
  });
}
