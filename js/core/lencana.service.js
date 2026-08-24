import { supabase } from '../config/supabase-client.js';

/**
 * Jumlah pekerjaan TERTUNDA per modul, untuk lencana merah di Beranda.
 *
 * SATU perjalanan untuk seluruh kartu. Sebelas query terpisah akan tiba pada
 * waktu yang berbeda-beda di sinyal seadanya, dan berandanya terlihat
 * berkedip-kedip. Alasan lengkapnya di kepala migration 0104.
 *
 * Gagal = objek kosong, BUKAN lempar error. Lencana adalah pelengkap; beranda
 * harus tetap tergambar walau hitungannya tidak bisa diambil. Yang hilang
 * cuma tandanya.
 */
export async function ambilLencana(businessUnitId, outletId) {
  if (!businessUnitId || !outletId) return {};
  try {
    const { data, error } = await supabase.rpc('lencana_beranda', { p_bu: businessUnitId, p_outlet: outletId });
    if (error) throw error;
    return data ?? {};
  } catch (error) {
    console.warn('[lencana] gagal dihitung:', error?.message ?? error);
    return {};
  }
}
