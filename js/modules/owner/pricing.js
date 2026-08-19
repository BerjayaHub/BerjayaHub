/**
 * PRICING ENGINE — dari HPP ke harga jual.
 *
 * Tiga rumusnya diambil dari aplikasi Project Hub. Yang TIDAK diambil adalah
 * caranya menangani angka yang tidak masuk akal: di sana `margin 100%` menghasilkan
 * pembagian nol, dan `Infinity` itu diteruskan begitu saja ke layar sebagai
 * harga. Di sini setiap rumus mengembalikan `null` kalau masukannya membuat
 * hasilnya tidak bermakna, dan yang memanggil wajib menanganinya.
 *
 * Tidak ada impor di berkas ini, dan sebaiknya tetap begitu: ini yang menentukan
 * harga jual, dan angka yang menentukan harga jual harus bisa diuji tanpa
 * browser.
 *
 * ============ KENAPA TIGA METODE, BUKAN SATU ============
 *
 * Ketiganya menjawab pertanyaan yang berbeda, dan ketiganya dipakai di BU yang
 * berbeda dalam satu organisasi ini:
 *
 *   food_cost  "bahan boleh makan berapa persen dari harga?"  -> kafe
 *   markup     "berapa kali lipat dari modal?"                -> retail/bengkel
 *   margin     "berapa persen dari harga yang jadi laba?"     -> jasa
 *
 * food_cost dan margin sebenarnya rumus yang sama dilihat dari dua arah
 * (food_cost 35% = margin 65%). Keduanya tetap disediakan karena orang yang
 * memakainya berpikir dengan angka yang berbeda, dan memaksa mereka menerjemahkan
 * sendiri adalah cara termudah membuat salah ketik jadi salah harga.
 */

/** @typedef {'food_cost'|'markup'|'margin'} Metode */

export const METODE = /** @type {const} */ (['food_cost', 'markup', 'margin']);

export const LABEL_METODE = {
  food_cost: 'Food Cost',
  markup: 'Markup',
  margin: 'Margin'
};

/**
 * Angka, atau `null` — tanpa jalan tengah.
 *
 * Versi pertama berbunyi `Number.isFinite(Number(v)) ? Number(v) : null`, dan
 * itu SALAH dengan cara yang persis dijaga berkas ini: `Number(null)` adalah
 * `0`, dan `0` lolos `isFinite`. Jadi HPP yang belum bisa dihitung berubah
 * diam-diam menjadi nol, saran harganya menyusut jadi sebesar biaya kemasan,
 * dan angka itu tetap terlihat wajar di layar.
 *
 * `undefined`, string kosong, `true`, dan `[]` punya masalah yang sama —
 * `Number()` mengubah semuanya menjadi 0 atau 1. Maka jenisnya diperiksa lebih
 * dulu, bukan hasil konversinya.
 */
const angka = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

/**
 * Harga jual dari HPP.
 *
 * @param {Metode} metode
 * @param {number} hpp biaya per porsi, sudah termasuk kemasan
 * @param {number} persen 0–100 (markup boleh lebih)
 * @returns {number|null} null kalau masukannya membuat hasilnya tak bermakna
 */
export function hargaDariHpp(metode, hpp, persen) {
  const h = angka(hpp);
  const p = angka(persen);
  if (h == null || p == null || h < 0) return null;

  if (metode === 'food_cost') {
    // Bahan 0% dari harga berarti harganya tak terhingga. Bahan >100% berarti
    // dijual di bawah modal — itu boleh saja disengaja, jadi tidak ditolak.
    if (p <= 0) return null;
    return h / (p / 100);
  }
  if (metode === 'markup') {
    if (p < 0) return null;
    return h * (1 + p / 100);
  }
  if (metode === 'margin') {
    // Margin 100% = seluruh harga adalah laba = modalnya nol. Pembaginya nol.
    if (p < 0 || p >= 100) return null;
    return h / (1 - p / 100);
  }
  return null;
}

/**
 * Harga yang harus dipasang di marketplace supaya yang DITERIMA sama dengan
 * harga offline.
 *
 * Arahnya sering terbalik saat dikira-kira di kepala: menaikkan harga 20% tidak
 * menutup potongan 20%, karena potongannya dihitung dari harga yang sudah naik.
 * Harga 10.000 dengan fee 20% menghasilkan 8.000, bukan 10.000 — dan menutupnya
 * butuh 12.500, bukan 12.000.
 *
 * @param {number} hargaOffline
 * @param {{feePersen?: number, promoPersen?: number}} potongan
 * @returns {number|null}
 */
export function hargaOnline(hargaOffline, { feePersen = 0, promoPersen = 0 } = {}) {
  const h = angka(hargaOffline);
  const fee = angka(feePersen) ?? 0;
  const promo = angka(promoPersen) ?? 0;
  if (h == null || h < 0) return null;
  if (fee < 0 || fee >= 100 || promo < 0 || promo >= 100) return null;

  const sisa = (1 - promo / 100) * (1 - fee / 100);
  if (!(sisa > 0)) return null;
  return h / sisa;
}

/**
 * Berapa persen dari harga jual yang habis untuk bahan.
 *
 * Angka ini yang paling sering diminta owner kafe, dan ia jauh lebih berguna
 * daripada nominal HPP karena bisa dibandingkan antar menu yang harganya jauh
 * berbeda.
 *
 * @returns {number|null} persen, null kalau harganya belum ada atau nol
 */
export function foodCostAktual(hpp, harga) {
  const h = angka(hpp);
  const j = angka(harga);
  if (h == null || j == null || !(j > 0)) return null;
  return (h / j) * 100;
}

/**
 * Satu baris tabel Pricing: apa adanya sekarang, versus apa yang disarankan.
 *
 * `selisih` sengaja bertanda: positif berarti harga sekarang LEBIH TINGGI dari
 * saran (aman), negatif berarti lebih rendah (menggerus margin). Menyajikannya
 * sebagai nilai mutlak akan menyembunyikan mana yang perlu dinaikkan.
 *
 * @param {{hpp: number|null, kemasan?: number, metode: Metode, persen: number,
 *          hargaSekarang?: number|null, feePersen?: number, promoPersen?: number}} a
 */
export function ringkasHarga({
  hpp,
  kemasan = 0,
  metode,
  persen,
  hargaSekarang = null,
  feePersen = 0,
  promoPersen = 0
}) {
  const dasar = angka(hpp);
  const kem = angka(kemasan) ?? 0;

  // HPP yang belum bisa dihitung TIDAK diganti 0. Kalau diganti, saran harganya
  // akan menjadi 0 atau sama dengan biaya kemasan — angka yang terlihat wajar,
  // masuk ke tabel, dan dipakai orang menetapkan harga.
  const hppTotal = dasar == null ? null : dasar + kem;

  const saran = hppTotal == null ? null : hargaDariHpp(metode, hppTotal, persen);
  const sekarang = angka(hargaSekarang);

  return {
    hppTotal,
    hargaSaran: saran,
    hargaSekarang: sekarang,
    hargaOnlineSaran: saran == null ? null : hargaOnline(saran, { feePersen, promoPersen }),
    selisih: saran == null || sekarang == null ? null : sekarang - saran,
    foodCostSekarang: foodCostAktual(hppTotal, sekarang),
    // Alasan kosongnya dibawa serta, supaya layar tidak perlu menebak-nebak
    // kenapa satu baris tidak punya angka.
    sebab: hppTotal == null ? 'HPP belum bisa dihitung' : saran == null ? 'Persentase harga belum masuk akal' : null
  };
}
