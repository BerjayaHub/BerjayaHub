/**
 * Apa yang terjadi saat impor menemukan nama yang SUDAH ADA.
 *
 * PERTANYAAN YANG MELAHIRKAN FILE INI: "minyak goreng saya impor pertama kali
 * dengan kolom lain kosong; impor kedua kolomnya sudah terisi — apakah ini
 * menumpuk, atau mengedit yang tadi?"
 *
 * Jawaban lamanya: TIDAK KEDUANYA. Barisnya dilewati begitu saja, dan kolom
 * yang kosong tetap kosong selamanya kecuali dibuka satu per satu di form.
 * Untuk daftar bahan yang panjang, itu berarti impor kedua terasa "berhasil"
 * padahal tidak mengubah apa pun.
 *
 * ATURAN BARUNYA, dan alasannya:
 *
 *   1. Kolom yang di sistem masih KOSONG -> DIISI dari file.
 *      Ini yang sebenarnya diinginkan orang saat mengimpor ulang: melengkapi.
 *
 *   2. Kolom yang di sistem SUDAH TERISI dan file-nya BERBEDA -> TIDAK DIUBAH,
 *      tapi dilaporkan.
 *      Menimpa diam-diam adalah cara termudah kehilangan harga beli yang sudah
 *      dikoreksi manual: seseorang membetulkannya di aplikasi, lalu tiga hari
 *      kemudian file lama diimpor ulang dan koreksinya lenyap tanpa jejak.
 *      Melaporkannya membuat orangnya yang memutuskan.
 *
 *   3. TIPE dan SATUAN PAKAI tidak pernah diubah, bahkan kalau kosong di file.
 *      Keduanya struktural: satuan pakai adalah satuan seluruh resep dan stok
 *      yang sudah tercatat, dan mengubahnya berarti semua angka lama berpindah
 *      arti tanpa satu pun yang ikut dikonversi.
 *
 * Tidak ada impor di file ini, supaya bisa diuji tanpa browser.
 */

/** Kolom yang boleh dilengkapi lewat impor ulang, beserta namanya untuk manusia. */
const BISA_DILENGKAPI = {
  category: 'Kategori',
  subcategory: 'Sub Kategori',
  purchase_unit: 'Satuan Beli',
  purchase_qty: 'Isi per Satuan Beli',
  purchase_price: 'Harga Beli',
  sale_price: 'Harga Jual'
};

/** Kolom struktural — dilaporkan kalau berbeda, tapi tidak pernah diubah. */
const STRUKTURAL = { product_type: 'Tipe', base_unit: 'Satuan Pakai' };

const kosong = (v) => v == null || (typeof v === 'string' && v.trim() === '');

/**
 * @param {object} lama produk yang sudah ada di database
 * @param {object} baru nilai dari file (boleh sebagian; `undefined` = tidak disebut)
 * @returns {{patch: object, terisi: string[], konflik: string[]}}
 *   `patch` kosong berarti tidak ada yang perlu disimpan.
 */
export function rencanaLengkapi(lama, baru) {
  const patch = {};
  const terisi = [];
  const konflik = [];

  for (const [kolom, label] of Object.entries(BISA_DILENGKAPI)) {
    const nilaiBaru = baru?.[kolom];
    if (kosong(nilaiBaru)) continue; // file tidak menyebutkan apa-apa

    if (kosong(lama?.[kolom])) {
      patch[kolom] = nilaiBaru;
      terisi.push(label);
      continue;
    }
    // Angka dibandingkan sebagai ANGKA: "18000" dan 18000 dari sel Excel
    // bertipe berbeda adalah nilai yang sama, dan melaporkannya sebagai
    // konflik hanya melatih orang mengabaikan daftar konflik.
    const samaAngka = Number(lama[kolom]) === Number(nilaiBaru) && !Number.isNaN(Number(nilaiBaru));
    const samaTeks = String(lama[kolom]).trim().toLowerCase() === String(nilaiBaru).trim().toLowerCase();
    if (!samaAngka && !samaTeks) konflik.push(`${label}: sistem "${lama[kolom]}" vs file "${nilaiBaru}"`);
  }

  for (const [kolom, label] of Object.entries(STRUKTURAL)) {
    const nilaiBaru = baru?.[kolom];
    if (kosong(nilaiBaru) || kosong(lama?.[kolom])) continue;
    if (String(lama[kolom]).trim().toLowerCase() !== String(nilaiBaru).trim().toLowerCase()) {
      konflik.push(`${label}: sistem "${lama[kolom]}" vs file "${nilaiBaru}" — tidak diubah lewat impor`);
    }
  }

  return { patch, terisi, konflik };
}
