/**
 * Outlet mana yang sedang "saya tempati" di Staff App — aturan murni.
 *
 * ============ BUG YANG MELAHIRKAN BERKAS INI ============
 *
 * Staff App memilih cakupannya begini:
 *
 *     const scopesInBu = context.scopes.filter((s) => s.business_unit_id === activeBuId);
 *     const activeScope = scopesInBu.find((s) => s.is_primary) ?? scopesInBu[0] ?? context.scopes[0];
 *                                                                                 ^^^^^^^^^^^^^^^^^^
 *
 * Ekor itu yang jadi soal. Super admin melihat SELURUH BU di pemilih atas —
 * termasuk BU yang ia tidak punya baris cakupannya. Untuk BU seperti itu
 * `scopesInBu` kosong, dan sesinya jatuh ke `context.scopes[0]`: cakupan milik
 * **BU YANG LAIN**.
 *
 * Akun yang cuma punya satu cakupan "Admin Divisi / Admin" lalu membuka BU
 * "Awal Bermula Cafe" mendapat `outletId` = outlet **Admin Divisi**. Seluruh
 * sesinya salah tempat sesudah itu:
 *
 *   - modul Produksi hilang, karena outlet itu bukan central kitchen;
 *   - "tidak ada kas yang bisa kamu bebani", karena kantong kas dicari di
 *     outlet BU lain;
 *   - nota yang disimpan mendarat di outlet BU lain — dan tidak muncul di
 *     riwayat, karena riwayatnya menyaring BU yang sedang dibuka.
 *
 * Tidak satu pun dari itu menghasilkan error. Yang terlihat cuma modul yang
 * hilang dan daftar yang kosong.
 *
 * ============ ATURANNYA SEKARANG ============
 *
 * Outlet aktif HARUS milik BU yang sedang dibuka. Kalau tidak ada yang cocok,
 * jawabannya `null` — bukan meminjam outlet BU lain. `null` berarti "belum
 * dipilih", dan layarnya wajib mengatakan itu alih-alih diam.
 *
 * Tidak ada impor di berkas ini, supaya bisa diuji tanpa browser.
 */

/**
 * @typedef {{business_unit_id: string, outlet_id: string|null, is_primary?: boolean,
 *            outlets?: {name?: string, outlet_role?: string}|null}} Cakupan
 */

/**
 * Cakupan yang dipakai untuk BU yang sedang dibuka.
 *
 * Urutan pilihan: yang ditandai "tempat kerja utama", lalu yang mana saja DI BU
 * ITU. Tidak pernah mengambil cakupan BU lain.
 *
 * @param {Cakupan[]} scopes
 * @param {string} buId
 * @returns {Cakupan|null}
 */
export function cakupanUntukBu(scopes, buId) {
  if (!buId) return null;
  const diBu = (Array.isArray(scopes) ? scopes : []).filter((s) => s?.business_unit_id === buId);
  if (!diBu.length) return null;
  return diBu.find((s) => s.is_primary) ?? diBu[0];
}

/**
 * Outlet aktif untuk BU ini.
 *
 * @param {object} o
 * @param {Cakupan[]} o.scopes
 * @param {string} o.buId
 * @param {{id: string, name?: string, outlet_role?: string}[]} o.outletBoleh
 *   outlet yang boleh diakses akun ini DI BU INI (dari `listMyOutlets`, yang
 *   sudah gagal-tertutup). Untuk super admin: seluruh outlet BU itu.
 * @param {string|null} [o.tersimpan] pilihan terakhir yang diingat, per BU
 * @returns {{outletId: string|null, outletRole: string|null, sebab: 'tersimpan'|'cakupan'|'satu-satunya'|'tidak-ada'}}
 */
export function outletAktif({ scopes, buId, outletBoleh, tersimpan = null }) {
  const daftar = Array.isArray(outletBoleh) ? outletBoleh.filter((o) => o?.id) : [];
  const ambil = (id) => daftar.find((o) => o.id === id) ?? null;

  // 1. Pilihan yang diingat — tapi HANYA kalau masih boleh diakses. Outlet yang
  //    dicabut haknya tidak boleh tetap terpakai hanya karena tersimpan di
  //    localStorage; itu izin yang hidup lebih lama daripada pemberiannya.
  const dariIngatan = tersimpan ? ambil(tersimpan) : null;
  if (dariIngatan) return { outletId: dariIngatan.id, outletRole: dariIngatan.outlet_role ?? null, sebab: 'tersimpan' };

  // 2. Outlet dari cakupan di BU INI — dan hanya kalau outlet itu memang ada di
  //    daftar yang boleh. Cakupan bisa menunjuk outlet yang sudah nonaktif.
  const cakupan = cakupanUntukBu(scopes, buId);
  const dariCakupan = cakupan?.outlet_id ? ambil(cakupan.outlet_id) : null;
  if (dariCakupan) {
    return {
      outletId: dariCakupan.id,
      // Diambil dari daftar outlet, BUKAN dari `cakupan.outlets` — embed di
      // cakupan bisa null karena RLS `outlets_select` untuk outlet BU lain, dan
      // peran yang null diam-diam berarti "tampilkan semua modul".
      outletRole: dariCakupan.outlet_role ?? null,
      sebab: 'cakupan'
    };
  }

  // 3. Kalau cuma ada satu outlet yang boleh, tidak ada yang perlu dipilih.
  if (daftar.length === 1) {
    return { outletId: daftar[0].id, outletRole: daftar[0].outlet_role ?? null, sebab: 'satu-satunya' };
  }

  // 4. Tidak ada yang cocok -> BELUM DIPILIH. Bukan outlet BU lain.
  return { outletId: null, outletRole: null, sebab: 'tidak-ada' };
}

/**
 * Apakah modul ini ditampilkan untuk peran outlet tersebut?
 *
 * Dipisah ke sini supaya aturannya bisa diuji, dan supaya "outlet belum
 * dipilih" (`null`) punya jawaban yang DINYATAKAN, bukan kebetulan.
 *
 * `outletRole` null berarti belum ditentukan — mis. cakupan level BU, atau
 * super admin yang belum memilih outlet. Di situ SEMUA modul ditampilkan:
 * menyembunyikan modul untuk orang yang belum memilih outlet akan terbaca
 * sebagai fitur yang hilang, dan itu persis keluhan yang melahirkan berkas ini.
 *
 * @param {string} kode
 * @param {string|null} outletRole
 */
export function modulUntukPeran(kode, outletRole) {
  if (!outletRole) return true;
  // Produksi hanya di central kitchen.
  if (kode === 'production') return outletRole === 'central_kitchen';
  // Menu, penjualan, dan reservasi hanya untuk outlet yang melayani tamu.
  if (kode === 'menu' || kode === 'sales' || kode === 'reservation') return outletRole !== 'central_kitchen';
  return true;
}
