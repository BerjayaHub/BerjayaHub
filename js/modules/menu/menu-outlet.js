/**
 * Aturan "menu ini aktif di outlet mana" — dipisah supaya BISA DIUJI.
 *
 * ============ SATU SISI TAJAM, DAN ADA DI SINI ============
 *
 * Di tingkat data, menu tanpa satu baris pun berarti aktif di SEMUA outlet
 * (lihat alasan panjangnya di `0115_menu_aktif_per_outlet.sql`). Bentuk itu
 * benar — ia yang membuat 162 menu lama dan setiap menu baru langsung
 * berperilaku wajar tanpa backfill.
 *
 * Tapi ia punya satu sisi tajam yang sepenuhnya soal LAYAR:
 *
 *     Mencabut centang TERAKHIR membalik artinya dari "hanya AB Sentul"
 *     menjadi "SEMUA outlet" — kebalikan persis dari yang dimaksud orang
 *     yang baru saja mencabutnya.
 *
 * Tidak ada error, dan layarnya bahkan terlihat wajar: nol centang. Baru
 * ketahuan saat staff di outlet lain melihat menu yang seharusnya tidak ada.
 *
 * Karena itu layar TIDAK PERNAH menyimpulkan maksud dari jumlah centang. Ia
 * menanyakan maksudnya secara terpisah — "Semua outlet" atau "Hanya outlet
 * terpilih" — dan menolak menyimpan pilihan kedua tanpa satu pun outlet.
 * Kosong sebagai HASIL yang sengaja dipilih ("Semua outlet") sah; kosong
 * sebagai SISA pencabutan tidak.
 *
 * Tidak ada impor di file ini, dan sebaiknya tetap begitu.
 */

/** Menu berlaku di semua outlet (tidak dibatasi). */
export const SEMUA = 'semua';
/** Menu hanya berlaku di outlet yang terpilih. */
export const TERPILIH = 'terpilih';

/**
 * Peta pembatasan: productId -> Set(outletId).
 *
 * Menu yang TIDAK ADA di peta ini berarti tidak dibatasi.
 *
 * @param {Array<{product_id:string, outlet_id:string}>} baris
 */
export function petaMenuOutlet(baris) {
  const peta = new Map();
  if (!Array.isArray(baris)) return peta;
  for (const b of baris) {
    if (!b?.product_id || !b?.outlet_id) continue;
    if (!peta.has(b.product_id)) peta.set(b.product_id, new Set());
    peta.get(b.product_id).add(b.outlet_id);
  }
  return peta;
}

/**
 * Apakah menu ini aktif di outlet ini?
 *
 * `peta.get(id)` yang berisi Set KOSONG diperlakukan sama dengan tidak ada —
 * keduanya berarti tidak dibatasi. Set kosong seharusnya tidak pernah lahir
 * (barisnya yang membuatnya), tapi memperlakukannya sebagai "dibatasi ke nol
 * outlet" akan MENYEMBUNYIKAN menu dari mana pun, dan menu yang lenyap tanpa
 * sebab jauh lebih mahal daripada menu yang terlalu banyak muncul.
 */
export function menuAktifDi(peta, productId, outletId) {
  if (!(peta instanceof Map)) return true;
  const set = peta.get(productId);
  if (!set || set.size === 0) return true;
  return set.has(outletId);
}

/**
 * Saring daftar menu untuk satu outlet.
 *
 * `outletId` kosong berarti belum ada outlet terpilih — daftarnya dikembalikan
 * UTUH, bukan dikosongkan. Layar yang tiba-tiba kosong terbaca sebagai "tidak
 * ada menu sama sekali", dan itu kebohongan yang jauh lebih membingungkan
 * daripada daftar yang belum tersaring.
 */
export function saringMenuOutlet(menus, peta, outletId) {
  const daftar = Array.isArray(menus) ? menus : [];
  if (!outletId) return daftar;
  return daftar.filter((m) => menuAktifDi(peta, m?.id, outletId));
}

/**
 * Keadaan kotak centang untuk SATU menu di layar admin.
 *
 * @returns {{mode:'semua'|'terpilih', outlets:string[]}}
 */
export function keadaanMenu(peta, productId) {
  const set = peta instanceof Map ? peta.get(productId) : null;
  if (!set || set.size === 0) return { mode: SEMUA, outlets: [] };
  return { mode: TERPILIH, outlets: [...set] };
}

/**
 * Boleh disimpan atau tidak — DAN kenapa.
 *
 * Mengembalikan alasan, bukan sekadar `false`. Tombol Simpan yang menolak
 * tanpa mengatakan apa-apa membuat orang menekannya berkali-kali, lalu
 * menyimpulkan aplikasinya rusak.
 *
 * @returns {{boleh:boolean, alasan?:string, outlets:string[]}}
 */
export function validasiSimpan({ mode, outlets }) {
  const daftar = Array.isArray(outlets) ? outlets.filter(Boolean) : [];

  if (mode === SEMUA) {
    // "Semua outlet" mengirim daftar KOSONG, dan itu memang benar: tidak ada
    // baris = tidak dibatasi. Centang yang mungkin masih tertinggal di layar
    // diabaikan, supaya yang tersimpan persis sama dengan yang tertulis di
    // tombol yang dipilih orangnya.
    return { boleh: true, outlets: [] };
  }

  if (!daftar.length) {
    return {
      boleh: false,
      outlets: [],
      alasan:
        'Pilih minimal satu outlet, atau pilih “Aktif di semua outlet”. ' +
        'Menyimpan “hanya outlet terpilih” tanpa satu pun outlet justru membuat menu ini aktif di SEMUA outlet.'
    };
  }

  return { boleh: true, outlets: [...new Set(daftar)] };
}

/**
 * Ringkasan sebaris untuk kolom di tabel menu.
 *
 * Menyebut ANGKA, bukan cuma "dibatasi": admin yang memindai 162 baris perlu
 * tahu seberapa jauh pembatasannya tanpa membuka satu per satu.
 */
export function ringkasMenu(peta, productId, totalOutlet) {
  const k = keadaanMenu(peta, productId);
  if (k.mode === SEMUA) return { teks: 'Semua outlet', dibatasi: false, jumlah: totalOutlet ?? null };
  return { teks: `${k.outlets.length} outlet`, dibatasi: true, jumlah: k.outlets.length };
}
