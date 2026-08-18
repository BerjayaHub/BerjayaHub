/**
 * Nota penerimaan barang dari supplier (0084).
 *
 * BENTUKNYA MENGIKUTI ORDER, bukan penerimaan lama: satu kali isi, banyak
 * barang, satu nomor. Penerimaan lama menuntut satu tombol per produk —
 * padahal barang datang dalam satu nota berisi belasan item, dan sesudahnya
 * tidak ada tempat yang bisa menjawab "nota nomor berapa isinya apa saja".
 *
 * FOTO NOTA OPSIONAL DAN BISA MENYUSUL. Nota fisik sering datang beberapa jam
 * setelah barangnya; mewajibkannya berarti stok tidak tercatat sampai kertasnya
 * ada. Menambahkan foto belakangan TIDAK menuntut mengirim ulang isi notanya.
 *
 * EDIT MENGOREKSI STOK LEWAT PERGERAKAN PENYEIMBANG, bukan mengubah pergerakan
 * lama — alasan panjangnya ada di 0084. Yang penting diketahui dari sisi sini:
 * memanggil `ubahNota` dengan `items: null` hanya menyentuh kepala notanya.
 */

import { supabase } from '../../config/supabase-client.js';
import { ambilSemua } from '../../core/ambil-semua.js';

const BUCKET = 'receipt-photos';

/** Simpan nota baru. Mengembalikan id-nya; nomornya dibuat server. */
export async function simpanNota({ outletId, receiptDate, supplier, invoiceNo, photoPath, notes, items }) {
  const { data, error } = await supabase.rpc('simpan_nota_terima', {
    p_outlet: outletId,
    p_receipt_date: receiptDate || null,
    p_supplier: supplier || null,
    p_invoice_no: invoiceNo || null,
    p_photo_path: photoPath || null,
    p_notes: notes || null,
    p_items: (items ?? []).map((i) => ({ product_id: i.product_id, qty: i.qty, unit_cost: i.unit_cost ?? null }))
  });
  if (error) throw new Error(error.message ?? String(error));
  return data;
}

/**
 * Ubah nota.
 *
 * `items` = `null` berarti JANGAN SENTUH barangnya — dipakai saat cuma
 * menambahkan foto nota yang menyusul, yang justru kasus paling sering.
 * `photoPath` = `null` berarti jangan sentuh fotonya; string kosong = hapus.
 */
export async function ubahNota(id, { receiptDate, supplier, invoiceNo, photoPath, notes, items = null }) {
  const { error } = await supabase.rpc('ubah_nota_terima', {
    p_id: id,
    p_receipt_date: receiptDate || null,
    p_supplier: supplier ?? '',
    p_invoice_no: invoiceNo ?? '',
    p_photo_path: photoPath,
    p_notes: notes ?? '',
    p_items: items === null ? null : items.map((i) => ({ product_id: i.product_id, qty: i.qty, unit_cost: i.unit_cost ?? null }))
  });
  if (error) throw new Error(error.message ?? String(error));
}

/** Riwayat nota; rentang tanggal memakai TANGGAL NOTA, bukan waktu input. */
export async function riwayatNota(businessUnitId, { outletId = null, dateFrom = null, dateTo = null } = {}) {
  return ambilSemua((dari, sampai) => {
    let q = supabase
      .from('goods_receipts')
      .select(
        'id, code, receipt_date, supplier, invoice_no, photo_path, notes, outlet_id, created_at, outlets!outlet_id(name), pembuat:user_profiles!created_by(full_name)',
        { count: 'exact' }
      )
      .eq('business_unit_id', businessUnitId)
      .order('receipt_date', { ascending: false })
      .order('created_at', { ascending: false });
    if (outletId) q = q.eq('outlet_id', outletId);
    if (dateFrom) q = q.gte('receipt_date', dateFrom);
    if (dateTo) q = q.lte('receipt_date', dateTo);
    return q.range(dari, sampai);
  });
}

/** Isi satu nota. */
export async function itemNota(receiptId) {
  if (!receiptId) return [];
  const { data, error } = await supabase
    // baris-terbatas: item SATU nota.
    .from('goods_receipt_items')
    .select('product_id, qty, unit_cost, notes, products(name, base_unit)')
    .eq('receipt_id', receiptId);
  if (error) throw error;
  return data ?? [];
}

/**
 * Unggah foto nota. Nama berkasnya memuat outlet & waktu supaya dua nota yang
 * diunggah bersamaan tidak saling menimpa.
 */
export async function unggahFotoNota(outletId, file) {
  if (!file) return null;
  const ext = (file.name?.split('.').pop() ?? 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  const path = `${outletId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false });
  if (error) throw new Error(`Foto nota gagal diunggah: ${error.message}`);
  return path;
}

/** URL sementara untuk melihat foto nota. */
export async function urlFotoNota(path, expiresIn = 600) {
  if (!path) return null;
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, expiresIn);
  if (error) return null;
  return data?.signedUrl ?? null;
}
