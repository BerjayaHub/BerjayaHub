import { supabase } from '../config/supabase-client.js';

/**
 * Panggil Edge Function dengan sesi yang DIPASTIKAN masih hidup.
 *
 * MASALAH YANG DIPERBAIKI: `supabase.functions.invoke()` mengirim token apa pun
 * yang sedang dipegang klien saat itu — tanpa memeriksa apakah token itu masih
 * berlaku. Access token Supabase berumur pendek (±1 jam) dan diperbarui otomatis
 * di latar belakang, TAPI perpanjangan itu bisa terlewat kalau tab dibiarkan
 * terbuka lama, HP tertidur, atau koneksi sempat putus.
 *
 * Akibatnya token basi tetap dikirim, server menolaknya, dan yang dilihat admin
 * adalah "Invalid session" — terdengar seperti aplikasi rusak, padahal artinya
 * cuma "login kamu sudah kedaluwarsa".
 *
 * Kasus kedua yang menghasilkan pesan sama: kalau TIDAK ADA sesi sama sekali,
 * `invoke` mengirim publishable key sebagai Bearer. Itu bukan JWT, jadi server
 * menolaknya dengan keluhan yang persis sama — padahal sebabnya berbeda jauh.
 *
 * Fungsi ini menutup keduanya: sesi diambil (dan diperbarui kalau perlu)
 * SEBELUM memanggil, dan kalau memang tidak ada, yang muncul adalah kalimat
 * yang bisa ditindaklanjuti orangnya.
 */
export async function invokeFunction(nama, body = {}) {
  const token = await tokenSegar();

  const { data, error } = await supabase.functions.invoke(nama, {
    body,
    // Header dipasang eksplisit, bukan mengandalkan token internal klien —
    // supaya yang terkirim benar-benar token yang barusan diverifikasi di atas.
    headers: { Authorization: `Bearer ${token}` }
  });

  if (error) throw new Error(await pesanError(error));
  return data;
}

/** Access token yang dipastikan belum kedaluwarsa. */
async function tokenSegar() {
  const { data } = await supabase.auth.getSession();
  let sesi = data?.session;

  // `expires_at` dalam detik epoch. Diberi jeda 60 detik supaya token yang
  // "hampir" mati tidak sempat kedaluwarsa di tengah perjalanan permintaan.
  const hampirMati = sesi?.expires_at && sesi.expires_at * 1000 - Date.now() < 60_000;

  if (!sesi || hampirMati) {
    const { data: baru, error } = await supabase.auth.refreshSession();
    if (error || !baru?.session) {
      throw new Error('Sesi kamu sudah berakhir. Silakan keluar lalu login ulang, kemudian coba lagi.');
    }
    sesi = baru.session;
  }

  return sesi.access_token;
}

/**
 * Ambil pesan asli dari Edge Function.
 *
 * supabase-js TIDAK membaca body respons non-2xx — `error.message` hanya berisi
 * "Edge Function returned a non-2xx status code", yang tidak memberi tahu apa
 * pun. Pesan sebenarnya ada di `error.context`, dan harus dibaca sendiri.
 */
async function pesanError(error) {
  try {
    if (error?.context && typeof error.context.json === 'function') {
      const body = await error.context.json();
      if (body?.error) return body.error;
    }
  } catch {
    // body bukan JSON — jatuh ke pesan default di bawah
  }
  return error?.message ?? 'Terjadi kesalahan.';
}
