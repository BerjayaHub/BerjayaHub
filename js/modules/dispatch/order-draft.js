/**
 * Mana order masuk yang SUDAH punya draft surat jalan — dipisah supaya BISA DIUJI.
 *
 * ============ KENAPA ORDERNYA MASIH ADA DI SANA ============
 *
 * `siapkan_order_jadi_draft` (0103) SENGAJA tidak menutup ordernya saat draft
 * dibuat. Alasannya benar: draft belum berangkat, dan menutup order untuk
 * barang yang masih di rak membuat outlet pemesan mengira pesanannya beres.
 *
 * Akibatnya ordernya tetap muncul di tab "Order Masuk", lengkap dengan kotak
 * isian jumlah kirimnya. Staff CK bisa mengisi seluruh barisnya, menekan
 * "Siapkan & Buat Draft SJ", dan baru DI DETIK ITU ditolak server:
 *
 *     "Order ini sudah punya draft surat jalan. Buka draftnya, jangan buat baru."
 *
 * Penolakannya benar dan memang harus ada — ia yang mencegah dua nomor SJ untuk
 * satu order. Tapi ia datang di ujung: pekerjaannya sudah terlanjur dikerjakan.
 * Yang kurang bukan penjagaannya, melainkan LAYARNYA — tidak ada satu pun tanda
 * bahwa order itu sudah disiapkan orang lain.
 *
 * ============ SATU HAL YANG MUDAH SALAH ============
 *
 * `stock_order_id` boleh NULL: draft yang lahir dari tab "Kirim ke Outlet"
 * tidak berasal dari order mana pun. Memasukkannya ke peta akan membuat kunci
 * `null` yang menampung draft-draft yang tidak berhubungan satu sama lain —
 * dan draft terakhir menimpa yang sebelumnya. Selama tidak ada order ber-id
 * `null` hal itu tidak terlihat, jadi barisnya dibuang di sini secara terang
 * daripada dibiarkan bergantung pada kebetulan.
 *
 * Tidak ada impor di file ini, dan sebaiknya tetap begitu.
 */

/**
 * Peta `stock_order_id` -> draft, dari hasil `listDraftKiriman()`.
 *
 * @param {Array<{id:string, code?:string, stock_order_id?:string|null}>} drafts
 * @returns {Map<string, object>}
 */
export function petaDraftPerOrder(drafts) {
  const peta = new Map();
  if (!Array.isArray(drafts)) return peta;
  for (const d of drafts) {
    if (!d?.stock_order_id) continue; // draft yang bukan dari order
    // Kalau entah bagaimana ada dua draft untuk satu order, yang PERTAMA yang
    // dipertahankan — daftarnya diurutkan terbaru dulu, jadi yang pertama itu
    // yang paling baru. Server melarang keadaan ini, tapi layar tidak boleh
    // ikut ambruk kalau larangannya pernah bocor.
    if (!peta.has(d.stock_order_id)) peta.set(d.stock_order_id, d);
  }
  return peta;
}

/**
 * Keadaan satu order masuk di mata staff CK.
 *
 * `gagalMemuatDraft` BUKAN sekadar penghias. Kalau daftar draft gagal dimuat,
 * peta kosong — dan peta kosong tidak bisa dibedakan dari "belum ada satu pun
 * draft". Menampilkan semua order sebagai siap-dikerjakan dalam keadaan itu
 * berarti layar berbohong dengan yakin, dan tepat mengulang pekerjaan sia-sia
 * yang hendak dicegah. Jadi keadaannya dinyatakan sendiri: 'tidak-tahu'.
 *
 * @returns {{mode:'sudah-draft'|'belum'|'tidak-tahu', draft?:object}}
 */
export function keadaanOrder(order, peta, { gagalMemuatDraft = false } = {}) {
  if (gagalMemuatDraft) return { mode: 'tidak-tahu' };
  const draft = peta instanceof Map ? peta.get(order?.id) : null;
  return draft ? { mode: 'sudah-draft', draft } : { mode: 'belum' };
}

/**
 * Ringkasan untuk kalimat di atas daftar.
 *
 * Angkanya disebut supaya staff tahu ada berapa yang benar-benar perlu
 * dikerjakan — daftar sepuluh order yang sembilan di antaranya sudah disiapkan
 * terbaca sebagai pekerjaan menumpuk, padahal tinggal satu.
 */
export function ringkasOrder(orders, peta, { gagalMemuatDraft = false } = {}) {
  const daftar = Array.isArray(orders) ? orders : [];
  if (gagalMemuatDraft) return { total: daftar.length, sudah: 0, belum: daftar.length, tidakTahu: true };
  const sudah = daftar.filter((o) => keadaanOrder(o, peta).mode === 'sudah-draft').length;
  return { total: daftar.length, sudah, belum: daftar.length - sudah, tidakTahu: false };
}
