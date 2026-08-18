/**
 * Pengaturan & data untuk tabel "Bahan Menipis" (0087).
 *
 * Yang diambil dari server cuma tiga hal: penjualan pada rentangnya, batas
 * manual, dan hari aman outlet. Pembentangan resepnya dikerjakan di
 * `bahan-menipis.js` memakai data resep yang MEMANG SUDAH dimuat layar itu —
 * bukan lewat query baru.
 */

import { supabase } from '../../config/supabase-client.js';
import { ambilSemua } from '../../core/ambil-semua.js';

/** Berapa hari penjualan yang dipakai menghitung rata-rata. */
export const HARI_RIWAYAT = 28;

/**
 * Penjualan satu outlet pada rentang tanggal.
 *
 * Hanya `product_id` dan `qty` — nama & harga tidak dipakai menghitung
 * pemakaian bahan, dan mengambilnya berarti embed tambahan yang bisa
 * menggagalkan seluruh permintaan (lihat 0086).
 */
export async function penjualanRentang(outletId, dari, sampai) {
  if (!outletId) return [];
  return ambilSemua((a, b) =>
    supabase
      .from('sales')
      .select('product_id, qty', { count: 'exact' })
      .eq('outlet_id', outletId)
      .gte('sale_date', dari)
      .lte('sale_date', sampai)
      .range(a, b)
  );
}

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

/** Hari aman outlet. */
export async function hariAmanOutlet(outletId) {
  if (!outletId) return 7;
  const { data, error } = await supabase.from('outlets').select('safety_days').eq('id', outletId).maybeSingle();
  if (error) throw error;
  return Number(data?.safety_days ?? 7);
}

/** Ubah hari aman (admin saja — dijaga RPC-nya). */
export async function setHariAman(outletId, hari) {
  const { error } = await supabase.rpc('set_safety_days', { p_outlet: outletId, p_days: Number(hari) });
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
