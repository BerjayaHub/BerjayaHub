/**
 * Aturan memindahkan resep antar varian (Standalone ⇄ Dilayani CK).
 *
 * Dipisah dan tanpa impor supaya BISA DIUJI. Yang dijaga di sini bukan
 * kenyamanan, tapi satu tabrakan yang diam-diam merusak data: tabel `recipes`
 * punya unique index `(product_id, mode)` (0021_recipe_modes.sql). Kalau varian
 * tujuan SUDAH punya resep, UPDATE-nya akan ditolak database — dan pesan
 * Postgres soal "duplicate key" tidak berarti apa pun bagi orang yang cuma mau
 * memindahkan resepnya.
 *
 * Yang lebih berbahaya lagi kalau ini tidak dicegat: godaan untuk "menimpa saja"
 * resep tujuan. Memindahkan tidak boleh menghapus pekerjaan orang lain tanpa
 * diminta. Jadi kalau tujuan sudah terisi, jawabannya TIDAK — hapus dulu
 * dengan sadar, lewat tombol hapus yang sudah punya dialog dampaknya sendiri.
 */

/** Varian yang sah untuk tiap tipe produk. Harus sama dengan `modesForType()`. */
export const VARIAN_PINDAH = { finished: ['standalone', 'served_by_ck'] };

const LABEL = { production: 'Produksi (CK)', standalone: 'Standalone', served_by_ck: 'Dilayani CK' };

/**
 * @param {object} o
 * @param {'raw'|'semi'|'finished'} o.productType
 * @param {string} o.dari       mode sekarang
 * @param {string} o.ke         mode tujuan
 * @param {boolean} o.adaDari   resep asal benar-benar ada
 * @param {boolean} o.adaKe     varian tujuan sudah terisi
 * @returns {{boleh: boolean, alasan?: string}}
 */
export function periksaPindah({ productType, dari, ke, adaDari, adaKe }) {
  const sah = VARIAN_PINDAH[productType];
  if (!sah) {
    // Setengah jadi hanya punya satu varian ("Produksi"), jadi tidak ada tujuan
    // untuk dipindahi. Ini bukan kekurangan fitur — memindahkan resep produksi
    // ke "Dilayani CK" tidak punya arti apa pun.
    return {
      boleh: false,
      alasan:
        productType === 'semi'
          ? 'Produk setengah jadi hanya punya satu varian resep (Produksi), jadi tidak ada tujuan pemindahan.'
          : 'Hanya produk jadi (menu) yang punya dua varian resep.'
    };
  }
  if (!sah.includes(dari) || !sah.includes(ke)) return { boleh: false, alasan: 'Varian tidak dikenal.' };
  if (dari === ke) return { boleh: false, alasan: 'Varian asal dan tujuan sama.' };
  if (!adaDari) return { boleh: false, alasan: `Varian ${LABEL[dari]} belum punya resep untuk dipindahkan.` };
  if (adaKe) {
    return {
      boleh: false,
      alasan: `Varian ${LABEL[ke]} sudah punya resep sendiri. Pemindahan tidak menimpa resep yang sudah ada — hapus dulu resep ${LABEL[ke]} kalau memang mau diganti.`
    };
  }
  return { boleh: true };
}

/** Varian pasangan dari sebuah mode; null kalau tidak punya pasangan. */
export function pasanganVarian(productType, mode) {
  const sah = VARIAN_PINDAH[productType];
  if (!sah || !sah.includes(mode)) return null;
  return sah.find((m) => m !== mode) ?? null;
}

export { LABEL as LABEL_VARIAN };
