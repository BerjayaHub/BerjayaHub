/**
 * Terjemahan galat unggah foto nota jadi kalimat yang bisa ditindaklanjuti.
 *
 * ============ KENAPA INI BERKAS SENDIRI ============
 *
 * `nota.service.js` mengimpor klien Supabase dari CDN, jadi ia tidak bisa
 * dimuat Node — dan aturan yang tidak bisa diuji adalah aturan yang perlahan
 * berhenti benar. Sama seperti `hutang-nota.js` dan `biaya-rata.js`, berkas ini
 * sengaja tanpa impor.
 *
 * ============ MASALAH YANG DIJAWABNYA ============
 *
 *   "masih tidak bisa upload foto nota, keterangan no bucket"
 *
 * "Bucket not found" adalah jawaban yang benar dan sama sekali tidak berguna
 * bagi staff outlet yang sedang memegang nota kertas di depan supplier. Ia
 * tidak menyebut apa yang hilang, siapa yang bisa memperbaikinya, atau apakah
 * pekerjaannya barusan ikut hilang — dan tiga hal itulah yang ingin diketahui
 * orangnya saat itu juga.
 *
 * Yang sama pentingnya: sebab yang BERBEDA harus terdengar berbeda. Menyuruh
 * orang "hubungi admin untuk menjalankan migration" padahal masalahnya foto
 * kebesaran akan membuat admin mencari sesuatu yang tidak pernah rusak.
 */

/** Penanda yang dibaca layar untuk menawarkan "Simpan tanpa foto". */
export const PENANDA_BUCKET_HILANG = 'belum disiapkan di server';

export function pesanGagalUnggah(error) {
  const pesan = String(error?.message ?? error ?? '');

  // (1) Wadah penyimpanannya sendiri belum ada.
  //
  // Bukan salah orang yang mengunggah, dan tidak ada satu pun tindakan di layar
  // yang bisa memperbaikinya. Jadi kalimatnya harus mengatakan dua hal
  // sekaligus: ini urusan server, DAN notanya tidak ikut hilang.
  if (/bucket not found|no such bucket|bucket.*not.*exist/i.test(pesan)) {
    return (
      `Penyimpanan foto nota ${PENANDA_BUCKET_HILANG}, jadi fotonya tidak bisa diunggah. ` +
      'Notanya tetap bisa disimpan tanpa foto — fotonya ditambahkan lewat tombol "+ Foto" setelah admin ' +
      'menjalankan migration 0130.'
    );
  }

  // (2) Wadahnya ada, izinnya yang menolak — biasanya outlet yang aktif bukan
  // outlet orang itu. Ini BISA dibetulkan sendiri, jadi arahnya ke layar,
  // bukan ke admin.
  if (/row-level security|violates.*policy|not authorized|unauthorized|403/i.test(pesan)) {
    return 'Kamu tidak berhak mengunggah foto untuk outlet ini. Periksa outlet yang sedang aktif di atas layar.';
  }

  if (/payload too large|413|exceeded the maximum/i.test(pesan)) {
    return 'Fotonya terlalu besar. Ambil ulang dengan resolusi lebih rendah, atau simpan notanya dulu tanpa foto.';
  }

  if (/failed to fetch|network|offline/i.test(pesan)) {
    return 'Fotonya gagal diunggah karena jaringan terputus. Notanya bisa disimpan dulu tanpa foto, fotonya menyusul.';
  }

  // Galat yang tidak dikenali ditampilkan APA ADANYA.
  //
  // Menelannya di balik kalimat ramah akan membuat sebab yang baru mustahil
  // dilacak — dan sebab yang baru pasti akan ada.
  return `Foto nota gagal diunggah: ${pesan}`;
}

/** Apakah galat ini yang jenisnya "server belum siap", bukan salah pemakainya? */
export function karenaBucketHilang(pesan) {
  return new RegExp(PENANDA_BUCKET_HILANG, 'i').test(String(pesan ?? ''));
}
