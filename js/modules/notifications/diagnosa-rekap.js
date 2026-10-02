/**
 * DIAGNOSA REKAP RESERVASI HARIAN — mengubah jawaban Edge Function jadi vonis.
 *
 *   "notifikasi rekap reservasi setiap pagi … masih belum saya terima selama
 *    ini, apa yang salah?"
 *
 * ============ KENAPA INI PERLU ADA SAMA SEKALI ============
 *
 * Rekap harian berjalan lewat CRON, bukan trigger. Artinya ia punya satu sifat
 * yang tidak dimiliki notifikasi lain di aplikasi ini: **kalau tidak ada yang
 * memanggilnya, tidak ada apa pun yang terjadi — termasuk tidak ada galat.**
 *
 * Dan tombol "Tes" yang sudah ada tidak bisa membedakannya. Tes itu memanggil
 * `notify-telegram` langsung dari browser; ia membuktikan bot, chat_id, dan
 * rutenya benar, lalu pesan tesnya masuk ke grup dengan rapi. Yang TIDAK
 * dibuktikannya: apakah ada yang menjalankan rekapnya tiap pagi.
 *
 * Jadi empat keadaan yang sangat berbeda terlihat persis sama dari luar:
 *
 *   1. cron belum pernah dipasang
 *   2. cron terpasang tapi balasannya 401 (header Authorization hilang) —
 *      dan `cron.job_run_details` tetap melaporkan `succeeded`, karena bagi
 *      pg_net permintaannya memang terkirim
 *   3. BU-nya belum mengaktifkan modul Reservasi, jadi function berhenti di
 *      awal — sementara reservasi masuk tetap normal, karena itu trigger yang
 *      tidak memeriksanya
 *   4. semuanya jalan, grupnya saja yang belum diatur untuk event ini
 *
 * Keempatnya: senyap. Berkas ini yang memberi nama pada senyapnya.
 *
 * Tidak ada impor di berkas ini, supaya bisa diuji tanpa browser.
 */

export const VONIS = {
  SIAP: 'siap',
  MODUL_MATI: 'modul_mati',
  TANPA_RUTE: 'tanpa_rute',
  RUTE_CADANGAN: 'rute_cadangan',
  SUDAH_DIKIRIM: 'sudah_dikirim',
  GAGAL: 'gagal',
  TIDAK_DIKENALI: 'tidak_dikenali'
};

const teks = (v) => (v === null || v === undefined ? '' : String(v));

/**
 * Apakah baris ini memakai rute cadangan — yaitu bukan `reservation_digest`.
 *
 * Jatuh ke rute "Reservasi baru" memang SAH (itu perilaku yang disengaja), tapi
 * ia harus terlihat: begitu orangnya memisahkan grup rekap dari grup reservasi
 * baru, rekapnya akan tetap masuk ke grup lama dan tidak ada yang menduga
 * sebabnya.
 */
export function pakaiRuteCadangan(baris) {
  const s = teks(baris?.sumber_rute);
  return !!s && !s.startsWith('reservation_digest');
}

/**
 * Vonis untuk SATU outlet.
 *
 * @param {{outlet?: string, chat_id?: string|null, sumber_rute?: string, jumlah?: number}} baris
 */
export function vonisOutlet(baris) {
  if (!baris?.chat_id) {
    return {
      outlet: teks(baris?.outlet),
      vonis: VONIS.TANPA_RUTE,
      pesan: 'Grup tujuannya belum diatur — rekap outlet ini tidak akan terkirim ke mana pun.'
    };
  }
  if (pakaiRuteCadangan(baris)) {
    return {
      outlet: teks(baris.outlet),
      vonis: VONIS.RUTE_CADANGAN,
      pesan: `Jatuh ke ${teks(baris.sumber_rute)} — bukan rute "Rekap reservasi harian". Masih terkirim, tapi ke grup yang sama dengan reservasi baru.`
    };
  }
  return {
    outlet: teks(baris.outlet),
    vonis: VONIS.SIAP,
    pesan: `Siap — ${Number(baris.jumlah) || 0} reservasi, lewat ${teks(baris.sumber_rute)}.`
  };
}

/**
 * Vonis untuk SELURUH jawaban function.
 *
 * @param {object|null} jawaban hasil `jalankanRekapReservasi`
 * @param {Error|null} [galat] kalau pemanggilannya sendiri gagal
 * @returns {{vonis: string, ringkas: string, saran: string, baris: object[]}}
 */
export function diagnosaRekap(jawaban, galat = null) {
  if (galat) {
    return {
      vonis: VONIS.GAGAL,
      ringkas: 'Rekapnya tidak bisa dipanggil sama sekali.',
      // Pesan Edge Function dibawa apa adanya: "Unauthorized" dan "Failed to
      // fetch" menunjuk ke dua hal yang berbeda jauh, dan merangkumnya jadi
      // "gagal" menghapus satu-satunya petunjuk yang ada.
      saran: teks(galat.message ?? galat),
      baris: []
    };
  }

  if (!jawaban || typeof jawaban !== 'object') {
    return {
      vonis: VONIS.TIDAK_DIKENALI,
      ringkas: 'Jawabannya tidak bisa dibaca.',
      saran: 'Edge Function membalas sesuatu yang bukan JSON. Periksa log function-nya di Supabase.',
      baris: []
    };
  }

  if (jawaban.error) {
    return { vonis: VONIS.GAGAL, ringkas: 'Rekapnya menolak dijalankan.', saran: teks(jawaban.error), baris: [] };
  }

  // ============ URUTANNYA PENTING ============
  //
  // `skipped` DIDAHULUKAN, dan itu bukan selera. Jawaban yang dilewati karena
  // penanda anti-kirim-ganda tidak membawa daftar `telegram` sama sekali —
  // jadi kalau pemeriksaan "daftarnya kosong" jalan lebih dulu, dedupe
  // terbaca sebagai "modul Reservasi mati", dan orangnya dikirim memeriksa
  // pengaturan modul yang sebenarnya tidak apa-apa.
  //
  // Tes untuk ini yang menemukannya; tidak ada galat apa pun di jalurnya.
  if (jawaban.skipped) {
    return {
      vonis: VONIS.SUDAH_DIKIRIM,
      ringkas: teks(jawaban.reason) || 'Sudah dikirim hari ini.',
      saran: 'Penanda anti-kirim-ganda sudah ada untuk tanggal ini. Pakai "Kirim ulang paksa" kalau memang perlu.',
      baris: []
    };
  }

  // Berhenti di awal: tidak ada BU yang mengaktifkan modul Reservasi. Ini
  // sebab yang paling mudah salah dibaca, karena reservasi MASUK tetap normal
  // — jalurnya trigger, dan trigger tidak memeriksa `bu_modules`.
  const daftar = Array.isArray(jawaban.telegram) ? jawaban.telegram : [];
  if (!daftar.length) {
    return {
      vonis: VONIS.MODUL_MATI,
      ringkas: teks(jawaban.reason) || 'Tidak ada outlet yang direkap.',
      saran:
        'Tidak satu pun outlet masuk rekap. Paling sering: modul Reservasi belum aktif untuk BU-nya ' +
        '(Admin Portal → Organisasi → Modul), atau semua outletnya nonaktif / ber-peran Central Kitchen.',
      baris: []
    };
  }

  const baris = daftar.map(vonisOutlet);
  const tanpaRute = baris.filter((b) => b.vonis === VONIS.TANPA_RUTE);
  const cadangan = baris.filter((b) => b.vonis === VONIS.RUTE_CADANGAN);

  if (tanpaRute.length) {
    return {
      vonis: VONIS.TANPA_RUTE,
      ringkas: `${tanpaRute.length} dari ${baris.length} outlet belum punya grup tujuan.`,
      saran: 'Atur rute "Rekap reservasi harian" di halaman ini — tanpa itu rekap outlet tersebut tidak dikirim ke mana pun.',
      baris
    };
  }

  if (cadangan.length) {
    return {
      vonis: VONIS.RUTE_CADANGAN,
      ringkas: `${cadangan.length} outlet jatuh ke rute "Reservasi baru".`,
      saran:
        'Masih terkirim, tapi ke grup yang sama dengan notifikasi reservasi baru. Kalau suatu saat grupnya dipisah, ' +
        'rekapnya akan tetap ke grup lama tanpa ada yang menduga sebabnya.',
      baris
    };
  }

  return {
    vonis: VONIS.SIAP,
    ringkas: `${baris.length} outlet siap dikirim.`,
    // ============ INI YANG PALING PENTING DI SELURUH BERKAS ============
    //
    // "Semuanya siap" di sini berarti: kalau ADA yang memanggil, pesannya
    // masuk. Ia tidak mengatakan apa pun tentang apakah ada yang memanggil —
    // dan justru itu keadaan yang sedang dicari orangnya. Menulis "semuanya
    // beres" di sini akan menutup satu-satunya sebab yang tersisa.
    saran:
      'Isi & tujuannya sudah benar. Kalau rekap paginya tetap tidak datang, yang kurang bukan di sini melainkan ' +
      'CRON-nya: periksa `select jobname, active from cron.job` dan pastikan header Authorization ikut terkirim — ' +
      'tanpa header itu balasannya 401 sementara cron tetap melaporkan "succeeded".',
    baris
  };
}

/** Warna/ikon untuk badge di layar. Dipisah supaya layarnya tidak menebak. */
export function ikonVonis(vonis) {
  if (vonis === VONIS.SIAP) return '✅';
  if (vonis === VONIS.RUTE_CADANGAN) return '⚠️';
  if (vonis === VONIS.SUDAH_DIKIRIM) return 'ℹ️';
  return '❌';
}
