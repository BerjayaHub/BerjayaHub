import { supabase } from '../config/supabase-client.js';
import { listAttendanceOutlets } from '../modules/attendance/attendance.service.js';
import { saringPerBu } from './aturan-outlet.js';

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
  const scopes = await bacaScopeSaya();
  if (scopes === null) return []; // tidak tahu -> tutup
  return saringPerBu(semua, scopes, businessUnitId);
}

/**
 * Outlet yang boleh diakses akun ini di SELURUH BU, bukan hanya BU yang sedang
 * aktif di pemilih atas.
 *
 * Dipakai untuk pertanyaan yang menempel pada ORANG, bukan pada BU aktif —
 * mis. outlet PERUNTUKAN saat mencatat kas keluar. Kas melekat pada user dan
 * dibawa ke mana pun dia login; membatasi peruntukannya ke BU yang kebetulan
 * sedang dibuka berarti orang yang membelanjakan uangnya untuk outlet BU lain
 * harus berganti BU dulu — dan kalau lupa, dia akan memilih outlet yang salah
 * hanya karena itu satu-satunya yang tersedia.
 *
 * Aturan penyaringannya sama persis dengan `listMyOutlets()`, diterapkan per BU.
 * Hasilnya membawa `business_unit_name` supaya dropdown bisa dikelompokkan —
 * tanpa itu, dua outlet bernama mirip di BU berbeda tidak bisa dibedakan.
 *
 * Sama-sama GAGAL TERTUTUP.
 */
export async function listMyOutletsAllBu(semuaOutlet = null) {
  const semua = semuaOutlet ?? (await listAttendanceOutlets().catch(() => []));
  const scopes = await bacaScopeSaya();
  if (scopes === null) return [];

  const buIds = [...new Set(semua.map((o) => o.business_unit_id).filter(Boolean))];
  const hasil = [];
  for (const buId of buIds) hasil.push(...saringPerBu(semua, scopes, buId));

  return hasil.sort(
    (a, b) =>
      String(a.business_unit_name ?? '').localeCompare(String(b.business_unit_name ?? '')) ||
      String(a.name ?? '').localeCompare(String(b.name ?? ''))
  );
}

/**
 * Outlet yang benar-benar boleh DIATUR akun ini di sebuah BU.
 *
 * BEDA dengan `listMyOutlets()`, dan bedanya penting. `listMyOutlets()`
 * menjawab "mana yang boleh kulihat" — dan aturannya membuka seluruh outlet BU
 * untuk siapa pun yang punya scope tanpa `outlet_id`. Untuk MENULIS, yang
 * menentukan adalah `is_admin_of_outlet()` di database, yang untuk
 * `outlet_admin` mensyaratkan outletnya disebut persis.
 *
 * Selisih antara keduanya muncul ke user sebagai *"new row violates row-level
 * security policy"* setelah dia menekan sesuatu — pesan yang tidak bisa
 * ditindaklanjuti siapa pun. Karena itu layar ADMIN harus memakai fungsi ini,
 * bukan `listMyOutlets()`.
 *
 * Jawabannya datang dari RPC yang memanggil `is_admin_of_outlet()` yang sama
 * persis dipakai RLS (migration 0081). Menyalin aturannya ke JavaScript akan
 * menghasilkan dua sumber jawaban yang cepat atau lambat menyimpang — dan
 * penyimpangannya baru ketahuan sebagai tombol yang ditolak.
 *
 * GAGAL TERTUTUP: kalau RPC-nya gagal, hasilnya array kosong, bukan semua
 * outlet.
 */
export async function listOutletsSayaKelola(businessUnitId) {
  const { data, error } = await supabase.rpc('outlets_saya_kelola', { p_bu: businessUnitId ?? null });
  if (error) {
    console.warn('[outlet] daftar outlet yang dikelola tidak terbaca:', error.message);
    return [];
  }
  return data ?? [];
}

/**
 * Pesan saat seseorang bisa MELIHAT outlet tapi tidak boleh MENGATUR satu pun.
 *
 * Menyebut sebabnya, bukan cuma "tidak ada outlet". Penyebab tersering: perannya
 * `outlet_admin` tapi scope-nya dibuat di level BU (tanpa outlet), jadi tidak ada
 * satu outlet pun yang tercatat sebagai miliknya.
 */
export const PESAN_TANPA_OUTLET_KELOLA =
  'Kamu bisa melihat outlet di BU ini, tapi belum tercatat sebagai <strong>admin outlet</strong> di satu pun. ' +
  'Minta super admin membuka <strong>Master User</strong> lalu memastikan scope-mu menyebut <em>outlet</em>-nya — ' +
  'peran "Admin Outlet" yang scope-nya dibuat di level BU tidak memberi wewenang atas outlet mana pun.';

/**
 * Scope milik akun yang login.
 * @returns {Promise<Array|null>} null berarti TIDAK TAHU (belum login / query
 *   gagal) — pemanggil wajib menutup, bukan menampilkan semuanya.
 */
async function bacaScopeSaya() {
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return null;

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
    return null;
  }
  return data ?? [];
}


/**
 * Terjemahkan penolakan RLS jadi kalimat yang bisa ditindaklanjuti.
 *
 * *"new row violates row-level security policy for table shift_schedules"*
 * benar secara teknis dan tidak berguna bagi siapa pun yang membacanya di HP.
 * Ia juga menyesatkan: yang terdengar adalah "aplikasinya rusak", padahal yang
 * terjadi adalah izin bekerja persis seperti seharusnya.
 *
 * Dipakai sebagai lapis KEDUA. Lapis pertama tetap tidak menawarkan pilihan
 * yang pasti ditolak — pesan error yang bagus untuk sesuatu yang seharusnya
 * tidak pernah muncul bukan pengganti mencegahnya muncul.
 *
 * @param {unknown} error
 * @param {string} konteks apa yang sedang dicoba, mis. 'mengubah jadwal'
 */
export function pesanTolakan(error, konteks = 'melakukan perubahan') {
  const teks = String(error?.message ?? error ?? '');
  if (/row-level security|violates row-level|insufficient_privilege|42501/i.test(teks)) {
    return `Kamu tidak punya wewenang ${konteks} di outlet ini. Yang bisa hanya admin outlet yang bersangkutan — minta super admin memeriksa scope-mu di Master User.`;
  }
  return teks || `Gagal ${konteks}.`;
}

/**
 * Pesan seragam saat seseorang tidak punya outlet di BU ini.
 * Menyebut DI MANA hal itu diatur — tanpa itu, user hanya melihat layar kosong
 * dan tidak tahu harus minta apa ke siapa.
 */
export const PESAN_TANPA_OUTLET =
  'Belum ada outlet yang bisa kamu akses di BU ini. Minta super admin menambahkan outletmu di <strong>Master User</strong>.';
