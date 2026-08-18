/**
 * Pengaturan untuk tabel "Bahan Menipis" (0087, diubah 0091).
 *
 * Sejak 0091 dasarnya bukan lagi penjualan × hari, melainkan **stok akhir
 * dibagi takaran resep = cukup berapa porsi**. Jadi yang diambil dari server
 * tinggal dua: porsi minimum outlet, dan batas manual per bahan.
 *
 * `penjualanRentang()` DIHAPUS bersama modelnya. Ia tidak disimpan
 * "untuk jaga-jaga": fungsi pengambil data yang tidak dipakai siapa pun akan
 * dipanggil lagi suatu hari oleh orang yang mengira ia masih bagian dari
 * perhitungannya.
 */

import { supabase } from '../../config/supabase-client.js';
import { ambilSemua } from '../../core/ambil-semua.js';

/** Batas manual per bahan di satu outlet → Map<product_id, min_qty>. */
export async function batasManual(outletId) {
  if (!outletId) return new Map();
  const baris = await ambilSemua((a, b) =>
    // baris-terbatas: hanya bahan yang PUNYA batas manual di satu outlet —
    // biasanya belasan, bukan seluruh master produk.
    supabase.from('product_min_stock').select('product_id, min_qty, notes', { count: 'exact' }).eq('outlet_id', outletId).range(a, b)
  );
  return new Map(baris.map((r) => [r.product_id, Number(r.min_qty)]));
}

/** Porsi minimum outlet — stok harus cukup untuk sekian porsi menu. */
export async function porsiMinimumOutlet(outletId) {
  if (!outletId) return 30;
  const { data, error } = await supabase.from('outlets').select('min_porsi').eq('id', outletId).maybeSingle();
  if (error) throw error;
  return Number(data?.min_porsi ?? 30);
}

/** Ubah porsi minimum (admin saja — dijaga RPC-nya). */
export async function setPorsiMinimum(outletId, porsi) {
  const { error } = await supabase.rpc('set_min_porsi', { p_outlet: outletId, p_porsi: Number(porsi) });
  if (error) throw new Error(error.message ?? String(error));
}

/**
 * Simpan / hapus batas manual satu bahan.
 *
 * `minQty === null` berarti HAPUS barisnya — kembali ke hitungan otomatis.
 * Itu berbeda dari menyimpan 0, yang berarti "sengaja tidak diawasi". Dua
 * niat berbeda yang harus punya dua jalan berbeda; kalau disatukan, salah
 * satunya jadi tidak bisa dinyatakan sama sekali.
 */
export async function simpanBatasManual(outletId, productId, minQty, notes = null) {
  if (minQty === null || minQty === undefined || minQty === '') {
    const { data, error } = await supabase
      .from('product_min_stock')
      .delete()
      .eq('outlet_id', outletId)
      .eq('product_id', productId)
      .select('product_id');
    if (error) throw new Error(error.message ?? String(error));
    // Tidak diperiksa `data.length`: menghapus yang memang belum ada bukan
    // kegagalan — hasil akhirnya persis yang diminta.
    return data ?? [];
  }

  const nilai = Number(minQty);
  if (!Number.isFinite(nilai) || nilai < 0) throw new Error('Batas minimum harus angka 0 atau lebih.');

  const { data, error } = await supabase
    .from('product_min_stock')
    .upsert({ outlet_id: outletId, product_id: productId, min_qty: nilai, notes: notes || null, updated_at: new Date().toISOString() })
    .select('product_id');
  if (error) throw new Error(error.message ?? String(error));

  // PostgREST tidak menganggap penolakan RLS sebagai error — ia mengembalikan
  // sukses dengan nol baris. Tanpa pemeriksaan ini, staff yang bukan admin
  // akan melihat "tersimpan" untuk perubahan yang tidak pernah terjadi.
  if (!data?.length) throw new Error('Batas tidak tersimpan — kemungkinan hanya Admin BU yang boleh mengaturnya.');
  return data;
}
