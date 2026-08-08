/**
 * Aturan MURNI tentang outlet mana yang boleh dilihat siapa.
 *
 * Dipisah dari `my-outlets.js` semata-mata supaya BISA DIUJI: my-outlets.js
 * mengimpor klien Supabase, yang mengimpor dari CDN, sehingga tidak bisa
 * dijalankan di luar browser. Aturan yang tidak bisa diuji hanya diperiksa
 * dengan cara membacanya ulang — dan aturan inilah yang dulu diam-diam
 * menyimpang dari aturan izin di database.
 *
 * Tidak ada impor di file ini, dan sebaiknya tetap begitu.
 */

/**
 * Outlet yang boleh DILIHAT di satu BU.
 *
 * ATURANNYA:
 *   super_admin                      -> semua outlet BU
 *   bu_admin di BU ini               -> semua outlet BU
 *   scope level BU (outlet_id null)  -> semua outlet BU (memang tidak terikat satu outlet)
 *   scope per outlet                 -> hanya outlet itu (bisa lebih dari satu)
 *   tidak punya scope di BU ini      -> KOSONG
 *
 * PERHATIKAN: ini pertanyaan MELIHAT, bukan MENGATUR. Yang menentukan boleh
 * tidaknya menulis adalah `is_admin_of_outlet()` di database, dan untuk
 * `outlet_admin` ia mensyaratkan outletnya disebut persis. Baris `outlet_id ==
 * null` di bawah membuat keduanya berbeda — sengaja, tapi berarti layar yang
 * MENULIS tidak boleh memakai fungsi ini. Pakai `listOutletsSayaKelola()`.
 */
export function saringPerBu(semua, scopes, businessUnitId) {
  const diBu = semua.filter((o) => o.business_unit_id === businessUnitId);
  if (scopes.some((s) => s.role === 'super_admin')) return diBu;

  const diBuIni = scopes.filter((s) => s.business_unit_id === businessUnitId);
  if (!diBuIni.length) return [];

  if (diBuIni.some((s) => s.role === 'bu_admin' || s.outlet_id == null)) return diBu;

  const ids = new Set(diBuIni.map((s) => s.outlet_id).filter(Boolean));
  return diBu.filter((o) => ids.has(o.id));
}
