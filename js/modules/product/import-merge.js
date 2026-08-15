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
 * @param {object} [opsi]
 * @param {boolean} [opsi.timpa=false] izinkan mengganti nilai yang SUDAH terisi
 * @returns {{patch: object, terisi: string[], diubah: string[], konflik: string[]}}
 *   `patch` kosong berarti tidak ada yang perlu disimpan.
 *
 * MODE TIMPA sengaja dipisahkan dari mode bawaan, bukan menggantikannya.
 * Melengkapi yang kosong aman dilakukan siapa saja kapan saja; menimpa yang
 * sudah terisi adalah tindakan yang bisa menghapus koreksi manual orang lain,
 * jadi ia harus diminta dengan sadar dan diperlihatkan dulu daftar
 * perubahannya. Yang membedakan keduanya di sini cuma satu percabangan —
 * tapi memisahkannya di API membuat pemanggil tidak bisa "kebetulan" menimpa.
 *
 * `diubah` terpisah dari `terisi` karena keduanya beda arti bagi yang membaca
 * laporannya: yang satu mengisi tempat kosong, yang satu MENGGANTI angka yang
 * sudah dipakai. Menggabungkannya jadi satu hitungan akan menyembunyikan
 * justru yang perlu diperiksa.
 */
export function rencanaLengkapi(lama, baru, { timpa = false } = {}) {
  const patch = {};
  const terisi = [];
  const diubah = [];
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
    if (samaAngka || samaTeks) continue;
    if (timpa) {
      patch[kolom] = nilaiBaru;
      // Nilai LAMA ikut ditulis. Daftar yang cuma berbunyi "Harga Beli diubah"
      // tidak bisa diperiksa siapa pun sebelum menekan Simpan — dan pratinjau
      // yang tidak bisa diperiksa hanya menambah satu ketukan, bukan keamanan.
      diubah.push(`${label}: "${lama[kolom]}" -> "${nilaiBaru}"`);
    } else {
      konflik.push(`${label}: sistem "${lama[kolom]}" vs file "${nilaiBaru}"`);
    }
  }

  for (const [kolom, label] of Object.entries(STRUKTURAL)) {
    const nilaiBaru = baru?.[kolom];
    if (kosong(nilaiBaru) || kosong(lama?.[kolom])) continue;
    if (String(lama[kolom]).trim().toLowerCase() !== String(nilaiBaru).trim().toLowerCase()) {
      // TETAP tidak diubah, bahkan saat `timpa`. Satuan pakai adalah satuan
      // seluruh resep dan stok yang sudah tercatat; menggantinya membuat semua
      // angka lama berpindah arti tanpa satu pun ikut dikonversi. Tidak ada
      // kotak centang yang pantas membuka pintu itu.
      konflik.push(`${label}: sistem "${lama[kolom]}" vs file "${nilaiBaru}" — tidak diubah lewat impor`);
    }
  }

  return { patch, terisi, diubah, konflik };
}

/**
 * Kolom mana yang BERLAKU untuk sebuah tipe produk.
 *
 * MASALAH YANG DIPERBAIKI: dua jalur impor memperlakukan ini berbeda. Jalur
 * "buat baru" membuang `purchase_*` untuk produk non-bahan-baku (`type === 'raw'
 * ? ... : null`), sedangkan jalur "lengkapi produk yang sudah ada" menulisnya
 * apa adanya. Jadi mengisi Harga Beli untuk sebuah SETENGAH JADI:
 *   - diabaikan kalau produknya baru;
 *   - tersimpan kalau produknya sudah ada.
 *
 * Nilai yang tersimpan itu tidak pernah dipakai — HPP setengah jadi dihitung
 * dari resep Produksi-nya, bukan dari harga beli — dan tidak ditampilkan di
 * tabel mana pun. Jadi ia tidak salah hari ini. Yang membuatnya berbahaya
 * adalah nanti: begitu tipe produknya diubah jadi "Bahan Baku", harga basi itu
 * langsung hidup dan ikut menghitung HPP, tanpa seorang pun pernah mengetiknya
 * untuk produk itu.
 *
 * Aturannya sekarang satu, dipakai KEDUA jalur:
 *   - `purchase_unit` / `purchase_qty` / `purchase_price` hanya untuk `raw`
 *   - `sale_price` hanya untuk `finished`
 *
 * @param {string} type tipe produk yang berlaku (dari file atau dari sistem)
 * @param {object} nilai kolom hasil pembacaan file
 * @returns {object} salinan tanpa kolom yang tidak berlaku
 */
export function saringMenurutTipe(type, nilai) {
  const keluar = { ...(nilai ?? {}) };
  if (type !== 'raw') {
    delete keluar.purchase_unit;
    delete keluar.purchase_qty;
    delete keluar.purchase_price;
  }
  if (type !== 'finished') delete keluar.sale_price;
  return keluar;
}
