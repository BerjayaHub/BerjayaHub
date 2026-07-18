import { supabase } from '../config/supabase-client.js';

/**
 * Login dengan email & password.
 * Melempar error kalau gagal, biar UI yang panggil bisa tampilkan pesannya.
 */
export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

/**
 * Ambil session yang sedang aktif (kalau ada), dipakai saat halaman pertama kali load
 * untuk cek apakah user masih login dari sesi sebelumnya.
 */
export async function getSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}

/**
 * Subscribe ke perubahan status auth (login/logout/token refresh).
 * callback menerima (event, session).
 */
export function onAuthStateChange(callback) {
  const { data } = supabase.auth.onAuthStateChange(callback);
  return data.subscription;
}

/**
 * Ambil profil + seluruh membership_scopes user yang sedang login.
 * Ini dipakai module-loader untuk tahu BU/outlet mana saja yang bisa diakses user,
 * dan modul apa saja yang aktif di situ.
 */
export async function getCurrentUserContext() {
  const session = await getSession();
  if (!session?.user) return null;

  const { data: profile, error: profileError } = await supabase
    .from('user_profiles')
    .select('id, full_name, phone, is_active')
    .eq('id', session.user.id)
    .single();
  if (profileError) throw profileError;

  const { data: scopes, error: scopeError } = await supabase
    .from('membership_scopes')
    .select('id, role, business_unit_id, outlet_id, business_units(name, type), outlets(name, outlet_role)')
    .eq('user_id', session.user.id);
  if (scopeError) throw scopeError;

  return { session, profile, scopes: scopes ?? [] };
}
