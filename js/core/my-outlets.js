import { supabase } from '../config/supabase-client.js';
import { listAttendanceOutlets } from '../modules/attendance/attendance.service.js';

/**
 * Outlet yang boleh diakses AKUN YANG LOGIN di sebuah BU.
 *
 * Sumber kebenarannya: `membership_scopes` — yang diatur super admin di Master
 * User. Semua dropdown outlet di seluruh modul harus memakai fungsi ini, supaya
 * "outlet siapa" dijawab di SATU tempat. Sebelumnya tiap modul memanggil
 * `listAttendanceOutlets()` (yang mengembalikan SELURUH outlet aktif lintas BU)
 * lalu menyaring sendiri hanya berdasarkan BU — sehingga staf satu outlet tetap
 * melihat, dan bisa memilih, outlet tetangganya.
 *
 * ATURANNYA:
 *   super_admin                      -> semua outlet BU
 *   bu_admin di BU ini               -> semua outlet BU
 *   scope level BU (outlet_id null)  -> semua outlet BU (memang tidak terikat satu outlet)
 *   scope per outlet                 -> hanya outlet itu (bisa lebih dari satu)
 *   tidak punya scope di BU ini      -> KOSONG
 *
 * GAGAL TERTUTUP, bukan terbuka. Versi lama fungsi ini (`getMyScopedOutlets`)
 * mengembalikan SEMUA outlet ketika scope-nya kosong atau ketika outletnya tidak
 * ketemu di daftar — "kalau ragu, tampilkan semua". Untuk pertanyaan tentang hak
 * akses, default itu terbalik: keraguan harus menutup, bukan membuka. Daftar
 * kosong yang jelas jauh lebih mudah dilaporkan user daripada kebocoran diam-diam.
 */
export async function listMyOutlets(businessUnitId, semuaOutlet = null) {
  if (!businessUnitId) return [];

  const semua = semuaOutlet ?? (await listAttendanceOutlets().catch(() => []));
  const diBu = semua.filter((o) => o.business_unit_id === businessUnitId);

  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return [];

  // RLS `membership_scopes_select_own` selalu membuka baris milik sendiri, jadi
  // query ini aman untuk peran apa pun — termasuk outlet_admin, yang TIDAK
  // tercakup `membership_scopes_select_admin`.
  const { data, error } = await supabase
    .from('membership_scopes')
    .select('role, business_unit_id, outlet_id')
    .eq('user_id', user.id);

  // Error dibaca sebagai "tidak tahu" -> kosong. Menampilkan semua outlet saat
  // query izin gagal adalah kegagalan yang paling tidak boleh terjadi.
  if (error) {
    console.warn('[outlet] scope tidak terbaca:', error.message);
    return [];
  }

  const scopes = data ?? [];
  if (scopes.some((s) => s.role === 'super_admin')) return diBu;

  const diBuIni = scopes.filter((s) => s.business_unit_id === businessUnitId);
  if (!diBuIni.length) return [];

  if (diBuIni.some((s) => s.role === 'bu_admin' || s.outlet_id == null)) return diBu;

  const ids = new Set(diBuIni.map((s) => s.outlet_id).filter(Boolean));
  return diBu.filter((o) => ids.has(o.id));
}

/**
 * Pesan seragam saat seseorang tidak punya outlet di BU ini.
 * Menyebut DI MANA hal itu diatur — tanpa itu, user hanya melihat layar kosong
 * dan tidak tahu harus minta apa ke siapa.
 */
export const PESAN_TANPA_OUTLET =
  'Belum ada outlet yang bisa kamu akses di BU ini. Minta super admin menambahkan outletmu di <strong>Master User</strong>.';
