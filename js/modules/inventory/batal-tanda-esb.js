/**
 * MEMBATALKAN TANDA EKSPOR ESB — aturannya, terpisah dari layarnya.
 *
 * ============ KENAPA INI BUKAN SEKADAR TOMBOL ============
 *
 * Membatalkan tanda di Berjaya Hub TIDAK menghapus dokumennya di ESB.
 *
 * Kalau notanya memang sudah masuk ESB (bukan ditolak), lalu tandanya dibuka,
 * isinya diperbaiki, dan berkasnya diunggah ulang — ESB punya DUA pembelian
 * untuk barang yang sama. Keduanya terlihat wajar. Selisihnya baru muncul
 * berminggu-minggu kemudian sebagai stok yang tidak cocok.
 *
 * Maka dua hal di berkas ini bukan hiasan: peringatan yang harus terbaca
 * sebelum tombolnya ditekan, dan alasan yang wajib diisi.
 *
 * Tidak ada impor di berkas ini, supaya bisa diuji tanpa browser.
 */

/**
 * Panjang alasan minimum.
 *
 * Angka yang sama ada di `panjang_alasan_batal_esb()` pada migration 0143.
 * Ditulis dua kali dengan sengaja: yang di sini supaya orangnya tahu SEBELUM
 * menekan tombol, yang di database supaya aturannya tetap berlaku walau
 * layarnya dilewati. Auditnya memeriksa keduanya masih sama.
 */
export const PANJANG_ALASAN_MIN = 10;

/** Kalimat yang harus terbaca sebelum tombolnya ditekan. */
export const PERINGATAN_ESB =
  'Membatalkan tanda di sini TIDAK menghapus dokumennya di ESB. Kalau notanya sudah benar-benar masuk ESB, ' +
  'hapus dulu dokumennya di sana — kalau tidak, unggahan berikutnya membuat pembelian ganda yang keduanya terlihat wajar.';

const teks = (v) => (v === null || v === undefined ? '' : String(v));

/**
 * Apakah alasannya cukup?
 *
 * @returns {{boleh: boolean, alasan: string, sebab: string}} `sebab` kosong = boleh
 */
export function alasanSah(alasan) {
  const v = teks(alasan).trim();
  if (!v) {
    return { boleh: false, alasan: '', sebab: 'Tulis dulu alasannya.' };
  }
  if (v.length < PANJANG_ALASAN_MIN) {
    return {
      boleh: false,
      alasan: v,
      // Sebabnya menyebut apa yang perlu ditulis, bukan cuma berapa hurufnya.
      // "Minimal 10 huruf" hanya memancing orang mengetik "aaaaaaaaaa".
      sebab: `Alasannya terlalu pendek (minimal ${PANJANG_ALASAN_MIN} huruf). Tulis apakah berkasnya ditolak ESB, atau sudah masuk ESB dan akan kamu hapus manual di sana.`
    };
  }
  return { boleh: true, alasan: v, sebab: '' };
}

const waktu = (v) => {
  if (!v) return null;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
};

/**
 * Keadaan sebuah baris terhadap ESB.
 *
 * Tiga keadaan, dan yang ketiga itulah jebakannya:
 *
 *   'bertanda'     — sedang tercatat sudah diekspor; inilah yang mengunci isinya
 *   'terbuka'      — tandanya sedang dibuka, isinya bisa diperbaiki
 *   'pernah-dibuka'— tandanya PERNAH dibuka, lalu diekspor lagi
 *
 * Kolom jejak sengaja tidak dikosongkan saat notanya diekspor ulang (lihat
 * 0143), jadi `esb_dibatalkan_at is not null` TIDAK berarti "sedang terbuka".
 * Layar yang cuma melihat kolom itu akan melaporkan nota yang sehat sebagai
 * nota yang tandanya sedang terbuka — dan orangnya akan membukanya lagi.
 */
export function keadaanTanda(baris) {
  const ekspor = waktu(baris?.esb_exported_at);
  const batal = waktu(baris?.esb_dibatalkan_at);
  // `esb_exported_at` adalah satu-satunya yang menentukan terkunci atau tidak.
  // Kolom jejak hanya membedakan dua rasa dari "bertanda".
  if (ekspor === null) return 'terbuka';
  if (batal === null) return 'bertanda';
  // Waktunya dibandingkan, bukan sekadar ada-tidaknya: jejak yang lebih TUA
  // dari tanda ekspornya berarti notanya sudah diekspor ulang sesudah dibuka.
  return batal > ekspor ? 'terbuka' : 'pernah-dibuka';
}

/** Sedang bertanda? Hanya inilah yang boleh muncul di daftar untuk dibatalkan. */
export function sedangBertanda(baris) {
  return keadaanTanda(baris) !== 'terbuka';
}

/**
 * Jejak pembatalan siap-tampil, atau `null` kalau tidak ada.
 *
 * @param {object} baris
 * @param {(v: any) => string} [fmt] pemformat waktu
 */
export function jejakBatal(baris, fmt = (v) => teks(v)) {
  if (waktu(baris?.esb_dibatalkan_at) === null) return null;
  return {
    oleh: teks(baris?.pembatal?.full_name) || 'tidak diketahui',
    waktu: fmt(baris.esb_dibatalkan_at),
    alasan: teks(baris?.esb_alasan_batal),
    // Sudah diekspor lagi sesudah dibuka? Kalimat yang menyebut pembatalan
    // tanpa menyebut ini akan dibaca sebagai "tandanya sedang terbuka".
    sudahDieksporLagi: keadaanTanda(baris) === 'pernah-dibuka'
  };
}

/**
 * Susun daftar yang ditampilkan: hanya yang sedang bertanda, urut terbaru dulu.
 *
 * Terbaru dulu, bukan alfabetis: yang dicari orang hampir selalu nota yang baru
 * saja diekspor — berkas yang baru ditolak ESB, atau nota yang staff-nya baru
 * saja mengeluh tidak bisa diedit.
 */
export function susunDaftarBertanda(baris) {
  // `filter` sudah mengembalikan larik BARU, jadi `sort` di bawah tidak pernah
  // menyentuh larik yang diberikan layar. Tidak ada `.slice()` tambahan di sini
  // — ia cuma akan terlihat seperti penjaga padahal tidak menjaga apa pun, dan
  // tidak ada sabotase yang bisa membuktikannya berguna.
  //
  // Tesnya tetap memeriksa larik aslinya utuh: yang dijaga sifatnya, bukan
  // caranya. Kalau suatu saat `filter` di sini hilang, tes itu yang menangkap.
  return (Array.isArray(baris) ? baris : [])
    .filter(sedangBertanda)
    .sort((a, b) => (waktu(b?.esb_exported_at) ?? 0) - (waktu(a?.esb_exported_at) ?? 0) || teks(a?.code).localeCompare(teks(b?.code), 'id'));
}

/**
 * Kalimat hasil — dan ini yang menjaga "berhasil" tidak berbohong.
 *
 * `batalkan_tanda_esb` mengembalikan berapa baris yang BENAR-BENAR terbuka.
 * Angka itu bisa lebih kecil dari yang dicentang: baris milik BU lain, atau
 * baris yang tandanya sudah dibuka orang lain sejak halaman ini dimuat, akan
 * dilewati tanpa melempar galat apa pun.
 *
 * Melaporkan "berhasil" begitu saja membuat admin mengira semuanya terbuka,
 * lalu staff menabrak dinding yang sama besok.
 *
 * @param {number} diminta banyaknya yang dicentang
 * @param {number} berhasil angka dari database
 * @returns {{nada: 'success'|'warning'|'error', pesan: string}}
 */
export function hasilPembatalan(diminta, berhasil) {
  const d = Number(diminta) || 0;
  const b = Number(berhasil) || 0;
  if (b === 0) {
    return {
      nada: 'error',
      pesan:
        'Tidak ada satu pun yang terbuka. Kemungkinan tandanya sudah dibuka orang lain, atau baris itu bukan wewenangmu. Muat ulang daftarnya.'
    };
  }
  if (b < d) {
    return {
      nada: 'warning',
      pesan: `Hanya ${b} dari ${d} yang terbuka. Sisanya dilewati — mungkin tandanya sudah dibuka orang lain, atau bukan wewenangmu. Muat ulang daftarnya dan periksa lagi.`
    };
  }
  return { nada: 'success', pesan: `${b} tanda ekspor dibuka. Isinya bisa diperbaiki sekarang.` };
}
