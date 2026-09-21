/**
 * BAHAN vs SELAIN BAHAN — satu aturan, dipakai layar DAN ekspor.
 *
 *   "di mutasi kas ini saya juga ingin ada filter pengeluaran untuk bahan dan
 *    selain bahan (disbursement)"
 *
 * ============ KENAPA MODUL SENDIRI ============
 *
 * Aturan yang sama sudah hidup di dua tempat: `kas_untuk_esb` (0150) yang
 * menyusun berkas Disbursement, dan sekarang saringan di layar Mutasi Kas.
 *
 * Kalau keduanya ditulis terpisah, mereka akan menyimpang — dan menyimpangnya
 * tidak terlihat seperti kesalahan. Yang terlihat: layar berkata "3 pengeluaran
 * selain bahan", ekspornya mengirim 2, dan tidak ada satu pun yang bisa
 * menjelaskan yang ketiga ke mana. Pertanyaan itu tidak bisa dijawab dari
 * layar mana pun — ia cuma bisa dijawab dengan membaca dua potong kode dan
 * membandingkannya.
 *
 * Jadi aturannya ditulis di sini sekali, layar memakainya, dan auditnya
 * memaksa `kas_untuk_esb` memuat saringan yang sama.
 *
 * ============ APA YANG MEMBUAT SEBUAH PENGELUARAN "UNTUK BAHAN" ============
 *
 * Dua penanda, keduanya dijaga CONSTRAINT TRIGGER di database — jadi bukan
 * tebakan dari teks keterangannya:
 *
 *   `untuk_nota`        (0122) entri ini MEMBAYAR nota penerimaan barang
 *   `penyesuaian_nota`  (0131) entri ini KOREKSI dari nota
 *
 * Bahan berangkat ke ESB lewat Simple Purchase. Yang selain bahan lewat
 * Disbursement. Keduanya tidak pernah bertemu di satu berkas.
 *
 * Tidak ada impor di berkas ini, supaya bisa diuji tanpa browser.
 */

/** Nilai saringan. Dipakai `<select>` dan pemeriksanya. */
export const SARING_PENGELUARAN = {
  SEMUA: '',
  BAHAN: 'bahan',
  NON_BAHAN: 'non-bahan'
};

export const LABEL_PENGELUARAN = {
  [SARING_PENGELUARAN.SEMUA]: 'Semua jenis',
  [SARING_PENGELUARAN.BAHAN]: 'Kas keluar untuk BAHAN (nota)',
  [SARING_PENGELUARAN.NON_BAHAN]: 'Kas keluar SELAIN bahan (Disbursement)'
};

/**
 * Apakah entri ini pengeluaran untuk BAHAN?
 *
 * Kas MASUK dan transfer bukan pengeluaran sama sekali — keduanya menjawab
 * `false` di sini, dan itu sengaja: pertanyaannya "apakah ini pembelian
 * bahan", bukan "apakah ini bukan-selain-bahan".
 */
export function untukBahan(entri) {
  if (!entri || entri.entry_type !== 'out') return false;
  return entri.untuk_nota === true || (entri.penyesuaian_nota !== null && entri.penyesuaian_nota !== undefined);
}

/**
 * Apakah entri ini pengeluaran SELAIN bahan — yang jadi Disbursement?
 *
 * Bukan sekadar `!untukBahan`: kas masuk dan transfer juga bukan bahan, tapi
 * mereka bukan pengeluaran. Yang dicari di sini persis yang berangkat ke ESB.
 *
 * `dicoret_at` TIDAK ikut disaring di sini — layar Mutasi Kas memang
 * menampilkan yang dicoret (dengan coretan), dan menyembunyikannya di balik
 * saringan jenis akan membuat entri yang dihapus lenyap tanpa sebab yang
 * terlihat. Ekspornya yang menyaringnya; itu pertanyaan yang berbeda.
 */
export function selainBahan(entri) {
  if (!entri || entri.entry_type !== 'out') return false;
  return !untukBahan(entri);
}

/**
 * Saring daftar mutasi menurut pilihan di layar.
 *
 * @param {Array} baris baris mutasi kas
 * @param {string} saring salah satu `SARING_PENGELUARAN`
 */
export function saringPengeluaran(baris, saring) {
  const daftar = Array.isArray(baris) ? baris : [];
  if (saring === SARING_PENGELUARAN.BAHAN) return daftar.filter(untukBahan);
  if (saring === SARING_PENGELUARAN.NON_BAHAN) return daftar.filter(selainBahan);
  // Nilai yang tidak dikenal TIDAK menyaring apa pun.
  //
  // Kebalikannya — mengembalikan daftar kosong — membuat salah ketik nilai
  // saringan terlihat persis seperti "memang tidak ada datanya", dan itu
  // bentuk kegagalan yang paling sering dikejar di repo ini.
  return daftar;
}

/**
 * Hitungan per jenis, untuk ditampilkan di sebelah saringannya.
 *
 * Angka yang terlihat SEBELUM memilih adalah yang membuat saringannya berguna:
 * tanpa itu, orang harus memilih satu per satu untuk tahu ada isinya atau
 * tidak.
 */
export function ringkasPengeluaran(baris) {
  const daftar = Array.isArray(baris) ? baris : [];
  let bahan = 0;
  let nonBahan = 0;
  let totalBahan = 0;
  let totalNonBahan = 0;
  for (const b of daftar) {
    const nilai = Math.abs(Number(b?.amount) || 0);
    // Yang DICORET tidak ikut dijumlahkan — uangnya sudah dinyatakan tidak
    // pernah keluar, dan menjumlahkannya membuat totalnya tidak cocok dengan
    // saldo mana pun.
    const hidup = !b?.dicoret_at;
    if (untukBahan(b)) {
      bahan += 1;
      if (hidup) totalBahan += nilai;
    } else if (selainBahan(b)) {
      nonBahan += 1;
      if (hidup) totalNonBahan += nilai;
    }
  }
  return { bahan, nonBahan, totalBahan, totalNonBahan };
}
