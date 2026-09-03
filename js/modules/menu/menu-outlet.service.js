/**
 * Layanan "menu aktif di outlet mana" (0115).
 *
 * SELURUH PENULISAN LEWAT RPC, tidak ada satu pun `.insert()`/`.delete()` ke
 * `menu_outlet_aktif` di sini. Bukan karena rapi, tapi karena PostgREST TIDAK
 * menganggap penolakan RLS sebagai error pada UPDATE/DELETE — ia mengembalikan
 * sukses dengan nol baris. Staff yang mencoba mengubah pengaturan lewat jalur
 * tabel akan melihat toast hijau dan pengaturan yang tidak berubah.
 *
 * RPC melempar exception, jadi penolakannya sampai ke layar apa adanya.
 */
import { supabase } from '../../config/supabase-client.js';

/**
 * Seluruh pembatasan di satu BU: [{ product_id, outlet_id }].
 *
 * Diambil sekaligus, bukan per menu. Tabel ini kecil menurut bentuknya —
 * hanya berisi menu yang DIBATASI, dan menu yang dibatasi selalu minoritas.
 * Mengambilnya per menu berarti 162 permintaan untuk menggambar satu tabel.
 */
export async function listMenuOutlet(businessUnitId) {
  const { data, error } = await supabase
    .from('menu_outlet_aktif')
    .select('product_id, outlet_id')
    .eq('business_unit_id', businessUnitId);
  if (error) throw error;
  return data ?? [];
}

/**
 * Ganti seluruh daftar outlet untuk SATU menu.
 *
 * `outletIds` kosong = menu aktif di semua outlet. Itu keadaan yang sah, dan
 * satu-satunya cara menyatakan "tidak dibatasi" — tapi layar tidak boleh
 * sampai ke sini karena centang terakhir kebetulan tercabut. Lihat
 * `validasiSimpan()` di `menu-outlet.js`.
 */
export async function setMenuOutlet(productId, outletIds) {
  const { error } = await supabase.rpc('set_menu_outlet', {
    p_product: productId,
    p_outlets: outletIds ?? []
  });
  if (error) throw error;
}

/**
 * Tetapkan daftar menu yang dijual di SATU outlet (layar massal).
 *
 * Servernya bisa MENOLAK dengan menyebut nama menu yang buntu — menu yang
 * hanya dijual di outlet ini, sehingga mencabutnya berarti tidak dijual di
 * mana pun. Pesannya diteruskan apa adanya ke layar; ia sudah menyebut menu
 * mana dan apa jalan keluarnya.
 */
export async function setMenuOutletMassal(outletId, productIds) {
  const { error } = await supabase.rpc('set_menu_outlet_massal', {
    p_outlet: outletId,
    p_menus: productIds ?? []
  });
  if (error) throw error;
}

/**
 * Menu yang aktif di satu outlet, langsung dari server.
 *
 * Dipakai Staff App. Sengaja TIDAK menghitung sendiri dari `listMenuOutlet` di
 * sisi klien: kalau layar staff dan server memakai definisi yang berbeda,
 * bedanya baru terlihat pada menu yang dibatasi — kasus yang paling jarang
 * dilihat saat menguji, dan paling merepotkan saat salah.
 */
export async function listMenuAktifOutlet(outletId) {
  if (!outletId) return null;
  const { data, error } = await supabase.rpc('menu_aktif_outlet', { p_outlet: outletId });
  if (error) throw error;
  return new Set((data ?? []).map((r) => r.product_id));
}
