import { supabase } from '../config/supabase-client.js';

/**
 * "Tempat kerja utama" (basis) seorang user — scope yang ditandai ★ di Master User.
 *
 * KENAPA ADA KONSEP INI: satu orang bisa punya scope di banyak BU/outlet, dan
 * shell aplikasi punya pemilih BU di pojok atas. Untuk sebagian modul, BU yang
 * SEDANG dipilih memang yang benar (mis. melihat stok outlet mana). Tapi untuk
 * modul yang menempel pada orangnya — presensi, cuti, jadwal shift — yang benar
 * selalu tempat kerja utamanya, apa pun BU yang kebetulan sedang dibuka.
 *
 * Kalau tidak dibedakan, akibatnya halus dan merepotkan: staff yang sedang
 * melihat BU lain lalu mengajukan cuti akan mengirim pengajuannya ke admin BU
 * yang salah — dan atasannya sendiri tidak pernah melihatnya, tanpa ada pesan
 * error apa pun.
 *
 * Fungsi ini adalah sumber tunggal jawaban itu. `getMyNbmBase` di
 * attendance.service.js kini hanya alias, dipertahankan supaya kode lama tidak
 * perlu diubah serentak.
 */
export async function getMyBaseScope(fallback = {}) {
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return fallback;

  const { data, error } = await supabase
    .from('membership_scopes')
    .select('business_unit_id, outlet_id, is_primary')
    .eq('user_id', user.id);
  if (error) throw error;

  const primary = (data ?? []).find((s) => s.is_primary);
  if (primary) return { business_unit_id: primary.business_unit_id, outlet_id: primary.outlet_id };

  // Belum ada yang ditandai ★. Jangan menebak-nebak: pakai konteks yang sedang
  // aktif. Menebak scope pertama yang kebetulan terbaca akan membuat perilaku
  // aplikasi berubah-ubah tanpa sebab yang bisa dijelaskan ke user.
  return fallback;
}

/** Apakah basisnya benar-benar dari ★, bukan sekadar fallback konteks aktif. */
export async function punyaBasisTertandai() {
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return false;
  const { data } = await supabase
    .from('membership_scopes')
    .select('id')
    .eq('user_id', user.id)
    .eq('is_primary', true)
    .limit(1);
  return !!data?.length;
}
