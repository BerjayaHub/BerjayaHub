/**
 * Buang komentar JS — DENGAN menghormati string.
 *
 * ============ KENAPA INI PERLU BERKAS SENDIRI ============
 *
 * Beberapa audit menyalin versi dua-baris yang sama: satu regex untuk komentar
 * blok, satu untuk komentar baris.
 *
 * (Regexnya sengaja TIDAK ditulis di sini. Percobaan pertama menuliskannya apa
 * adanya, dan urutan bintang-garis-miring di dalamnya menutup blok JSDoc ini
 * lebih awal — berkasnya lalu gagal di-parse Node. Cocok sekali: penjelasan
 * tentang pemotong komentar yang rusak, dirusak oleh pemotong komentar.)
 *
 * Versi itu SALAH, dan salahnya baru ketahuan pada berkas yang berisi:
 *
 *     <input type="file" accept="image/*" />
 *
 * `/*` di dalam string itu memulai "komentar blok" palsu, yang lalu ditutup
 * oleh `*` + `/` milik JSDoc puluhan baris kemudian — dan 37 baris kode di
 * antaranya lenyap.
 *
 * ============ KENAPA ITU BERBAHAYA, BUKAN SEKADAR MENJENGKELKAN ============
 *
 * Arah kegagalannya bergantung pada bentuk pemeriksaannya:
 *
 *   `if (!/harus-ada/.test(kode))`  -> audit MERAH pada kode yang benar.
 *                                      Menjengkelkan, tapi terlihat.
 *   `if (/dilarang/.test(kode))`    -> audit HIJAU karena kodenya sudah
 *                                      terlanjur terhapus. Larangannya berhenti
 *                                      berlaku, dan tidak ada yang tahu.
 *
 * Yang kedua persis bentuk kegagalan yang paling sering dikejar di repo ini:
 * pemeriksaan yang hijau karena sasarannya tidak ada.
 *
 * ============ BATASNYA, DITULIS TERUS TERANG ============
 *
 * Ini pemindai karakter sederhana yang mengenali `'`, `"`, dan `` ` `` — bukan
 * parser JavaScript. Ia TIDAK mengenali regex literal, jadi sebuah regex yang
 * di dalamnya memuat urutan garis-miring-bintang masih bisa mengelabuinya.
 * (Urutannya sengaja tidak ditulis di sini — untuk KEDUA kalinya di berkas ini,
 * menuliskannya apa adanya menutup blok JSDoc-nya sendiri.) Sejauh ini pola
 * seperti itu tidak ada di repo ini, dan `periksaKewarasan()` di bawah yang
 * akan meneriakkannya kalau suatu saat muncul.
 *
 * Panjang berkasnya DIPERTAHANKAN (komentar diganti spasi, baris baru
 * dibiarkan) supaya nomor baris dan urutan posisi tetap sepadan dengan aslinya.
 */

/**
 * @param {string} teks isi berkas JS
 * @returns {string} isi yang sama panjang, komentarnya jadi spasi
 */
function tanpaKomentar(teks) {
  const n = teks.length;
  const keluar = new Array(n);
  let i = 0;
  /** null | "'" | '"' | '`' | 'baris' | 'blok' */
  let mode = null;

  const tulis = (idx, c) => {
    keluar[idx] = c;
  };

  while (i < n) {
    const c = teks[i];
    const d = teks[i + 1];

    if (mode === null) {
      if (c === '/' && d === '*') {
        mode = 'blok';
        tulis(i++, ' ');
        tulis(i++, ' ');
        continue;
      }
      if (c === '/' && d === '/') {
        mode = 'baris';
        tulis(i++, ' ');
        tulis(i++, ' ');
        continue;
      }
      if (c === "'" || c === '"' || c === '`') {
        mode = c;
        tulis(i++, c);
        continue;
      }
      tulis(i++, c);
      continue;
    }

    if (mode === 'baris') {
      if (c === '\n') {
        mode = null;
        tulis(i++, '\n');
        continue;
      }
      tulis(i++, ' ');
      continue;
    }

    if (mode === 'blok') {
      if (c === '*' && d === '/') {
        mode = null;
        tulis(i++, ' ');
        tulis(i++, ' ');
        continue;
      }
      tulis(i++, c === '\n' ? '\n' : ' ');
      continue;
    }

    // Di dalam string: isinya dipertahankan apa adanya.
    if (c === '\\') {
      tulis(i++, c);
      if (i < n) tulis(i++, teks[i]);
      continue;
    }
    if (c === mode) {
      mode = null;
      tulis(i++, c);
      continue;
    }
    // String berkutip tunggal/ganda tidak boleh melewati baris. Kalau toh
    // terjadi (berkas rusak, atau tanda kutip di dalam regex), lebih baik
    // menutupnya di sini daripada menelan sisa berkasnya sebagai "string".
    if (c === '\n' && mode !== '`') {
      mode = null;
      tulis(i++, '\n');
      continue;
    }
    tulis(i++, c);
  }

  return keluar.join('');
}

/**
 * Penjaga: hasil pemotongan tidak boleh kehilangan potongan yang seharusnya ada.
 *
 * Dipanggil audit yang memakai pola LARANGAN, tempat over-stripping berarti
 * lolos diam-diam. Diberi beberapa potongan yang PASTI ada di berkasnya; kalau
 * salah satunya hilang sesudah dipotong, pemotongnya sedang memakan kode.
 *
 * @param {string} asli
 * @param {string} dipotong
 * @param {string[]} penanda potongan yang harus tetap ada
 * @returns {string|null} pesan kesalahan, atau null kalau waras
 */
function periksaKewarasan(asli, dipotong, penanda) {
  for (const p of penanda) {
    if (asli.includes(p) && !dipotong.includes(p)) {
      return `pemotong komentar memakan kode: "${p}" ada di berkas aslinya tapi hilang sesudah dipotong`;
    }
  }
  return null;
}

module.exports = { tanpaKomentar, periksaKewarasan };
