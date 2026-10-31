/**
 * TAMPILAN STATUS PRESENSI — satu sumber untuk Beranda dan layar modulnya.
 *
 * Murni: tidak menyentuh DOM, tidak menyentuh Supabase.
 *
 * ============ KENAPA MODUL SENDIRI UNTUK WARNA ============
 *
 * Keadaan presensi digambar di DUA tempat: kartu ringkas di Beranda dan layar
 * modulnya. Keduanya sudah pernah menyimpang — kartu Beranda menulis "✓
 * Selesai hari ini" sementara modulnya menulis "Presensi hari ini sudah
 * lengkap", dengan warna yang sama untuk keadaan yang berbeda.
 *
 * Warna di sini BUKAN hiasan. Biru = masih bekerja, kuning = sedang berhenti
 * (istirahat atau sudah pulang). Orang membaca warnanya dari ujung ruangan,
 * lebih dulu daripada tulisannya — jadi dua layar yang mewarnai keadaan yang
 * sama dengan warna berbeda bukan soal rapi-tidak rapi, melainkan dua jawaban
 * untuk satu pertanyaan.
 */

/** Keadaan yang mungkin, dan hanya ini. */
export const KEADAAN = ['belum', 'bekerja', 'istirahat', 'selesai'];

/**
 * Keadaan presensi hari ini.
 *
 * @param {object|null} sesi baris presensi hari ini (`clock_in_at`, `clock_out_at`)
 * @param {object|null} istirahatBerjalan istirahat yang belum ditutup
 */
export function keadaanPresensi(sesi, istirahatBerjalan = null) {
  if (!sesi || !sesi.clock_in_at) return 'belum';
  if (sesi.clock_out_at) return 'selesai';
  // ISTIRAHAT DIPERIKSA SESUDAH clock out, bukan sebelum.
  //
  // Istirahat yang menggantung ditutup otomatis saat pulang (0138), tapi
  // barisnya bisa masih terbaca sesaat. Mendahulukannya membuat orang yang
  // sudah pulang terlihat "sedang istirahat" — dan warnanya kebetulan sama,
  // jadi kekeliruan itu tidak akan terlihat sebagai kekeliruan.
  if (istirahatBerjalan) return 'istirahat';
  return 'bekerja';
}

/**
 * Rupa tiap keadaan: kelas CSS, lencana, dan kalimat pendeknya.
 *
 * `kelas` dipakai KEDUA layar. Warnanya sendiri tinggal di CSS — menaruh kode
 * warna di sini membuat tema gelap dan cetak PDF harus menambalnya lagi.
 */
export const TAMPILAN = {
  belum: {
    kelas: 'att-state-belum',
    lencana: '⏰',
    judul: 'Belum clock in',
    ajakan: 'Ketuk untuk absen'
  },
  bekerja: {
    kelas: 'att-state-bekerja',
    lencana: '💼',
    judul: 'Sedang bekerja',
    ajakan: 'Ketuk untuk clock out'
  },
  istirahat: {
    kelas: 'att-state-istirahat',
    lencana: '☕',
    judul: 'Sedang istirahat',
    ajakan: 'Ketuk untuk kembali bekerja'
  },
  selesai: {
    kelas: 'att-state-selesai',
    lencana: '✅',
    judul: 'Selesai hari ini',
    ajakan: 'Sampai jumpa besok'
  }
};

/**
 * Rupa untuk satu keadaan, dengan cadangan yang AMAN.
 *
 * Keadaan tak dikenal jatuh ke `belum` — bukan ke `bekerja`. Arah cadangannya
 * penting: "belum absen" yang keliru akan langsung diperbaiki orangnya sendiri
 * dengan menekan tombol, sedangkan "sedang bekerja" yang keliru membuatnya
 * pulang tanpa merasa perlu melakukan apa pun.
 */
export function tampilanPresensi(keadaan) {
  return TAMPILAN[keadaan] ?? TAMPILAN.belum;
}

/** Jenis bunyi yang pantas untuk satu peralihan keadaan. */
export function bunyiUntuk(aksi) {
  if (aksi === 'clock_in') return 'masuk';
  if (aksi === 'clock_out') return 'pulang';
  if (aksi === 'istirahat_mulai' || aksi === 'istirahat_selesai') return 'istirahat';
  return '';
}
