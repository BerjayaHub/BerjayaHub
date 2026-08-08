// Supabase client — diimpor langsung dari CDN, tanpa build step.
// Ganti SUPABASE_URL & SUPABASE_ANON_KEY sesuai project Supabase kamu.
// JANGAN taruh service_role key di sini — hanya anon key yang aman untuk frontend.

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { tandaiOffline, tandaiOnline } from '../core/koneksi.js';

const SUPABASE_URL = 'https://vhehyggwdwkbwekedksa.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_Cv7qG3hgRLziaUYG2K_6GQ_uJ63pNaE';

/**
 * Setiap permintaan ke Supabase lewat sini, jadi di sinilah keadaan jaringan
 * paling jujur terlihat.
 *
 * `fetch` melempar `TypeError` saat permintaannya tidak pernah sampai — beda
 * dari respons 4xx/5xx, yang justru BUKTI bahwa jaringannya hidup. Membedakan
 * keduanya penting: menandai offline hanya karena server membalas 403 akan
 * membuat penandanya menyala saat masalahnya sama sekali bukan koneksi.
 */
async function fetchTerpantau(...args) {
  try {
    const res = await fetch(...args);
    tandaiOnline(); // sampai ke server = jaringan hidup, apa pun status-nya
    return res;
  } catch (e) {
    tandaiOffline();
    throw e;
  }
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  },
  global: { fetch: fetchTerpantau }
});
