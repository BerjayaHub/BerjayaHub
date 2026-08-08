/**
 * Pengambilan lokasi untuk presensi.
 *
 * KENAPA TIDAK CUKUP `getCurrentPosition(ok, gagal, { timeout: 5000 })`:
 *
 * 1. **Fix pertama sering lebih lama dari 5 detik.** Di dalam ruangan, GPS
 *    butuh waktu mengunci satelit. Timeout 5 detik memotongnya tepat sebelum
 *    berhasil, lalu hasilnya dilaporkan sebagai "lokasi tidak terdeteksi" —
 *    seolah izinnya bermasalah, padahal cuma kurang sabar.
 *
 * 2. **Akurasi tidak pernah dilihat.** Android 12+ dan iOS punya saklar
 *    "Lokasi Presisi". Kalau dimatikan, HP tetap MENJAWAB dengan koordinat —
 *    hanya saja melesetnya bisa 1-3 km. Orangnya berdiri di depan outlet,
 *    aplikasinya yakin dia di luar area, dan tidak ada satu pun pesan yang
 *    menyebut kenapa. Ini penyebab paling sering dari "izin sudah diberikan
 *    tapi tetap gagal".
 *
 * 3. **Semua kegagalan terlihat sama.** Izin ditolak, GPS mati, dan timeout
 *    menghasilkan pesan yang sama persis, padahal jalan keluarnya berbeda.
 *
 * Yang dilakukan di sini: `watchPosition` dengan akurasi tinggi, menyimpan fix
 * TERBAIK yang datang, berhenti lebih awal begitu cukup teliti, dan
 * mengembalikan `accuracy` supaya pemanggil bisa berkata jujur tentang seberapa
 * bisa dipercaya angkanya.
 */

/** Kode kegagalan yang bisa dibedakan pemanggil. */
export const LOKASI_ERROR = {
  TIDAK_DIDUKUNG: 'tidak_didukung',
  DITOLAK: 'ditolak',
  TIDAK_TERSEDIA: 'tidak_tersedia',
  TIMEOUT: 'timeout'
};

/** Pesan + langkah konkret per jenis kegagalan. Disesuaikan dengan sistemnya. */
export function pesanLokasi(kode) {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
  switch (kode) {
    case LOKASI_ERROR.DITOLAK:
      return ios
        ? 'Izin lokasi ditolak. Buka Pengaturan → Privasi & Keamanan → Layanan Lokasi → Safari, pilih "Saat Menggunakan App", lalu muat ulang halaman ini.'
        : 'Izin lokasi ditolak. Ketuk ikon 🔒 di kiri alamat → Izin situs → Lokasi → Izinkan, lalu muat ulang halaman ini.';
    case LOKASI_ERROR.TIDAK_TERSEDIA:
      return 'HP tidak bisa menentukan lokasi. Nyalakan GPS/Layanan Lokasi, lalu coba lagi. Kalau di dalam ruangan, coba mendekat ke pintu atau jendela.';
    case LOKASI_ERROR.TIMEOUT:
      return 'Pencarian lokasi kelamaan. Pastikan GPS menyala, lalu coba lagi — di dalam gedung kadang butuh 15-30 detik untuk fix pertama.';
    case LOKASI_ERROR.TIDAK_DIDUKUNG:
      return 'Perangkat atau browser ini tidak mendukung lokasi. Pakai Chrome atau Safari versi terbaru.';
    default:
      return 'Lokasi tidak bisa diambil.';
  }
}

/**
 * Saran saat koordinatnya DAPAT tapi ketelitiannya buruk.
 * Ini bagian yang paling sering menyelamatkan orang, karena gejalanya paling
 * membingungkan: semuanya tampak normal, hanya hasilnya yang salah.
 */
export function pesanAkurasiBuruk(akurasi) {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
  return (
    `Lokasi dari HP kamu hanya teliti sekitar ±${Math.round(akurasi)} m, jadi belum cukup untuk memastikan kamu di area outlet. ` +
    (ios
      ? 'Nyalakan Pengaturan → Privasi & Keamanan → Layanan Lokasi → Safari → <strong>Lokasi Tepat</strong>.'
      : 'Nyalakan <strong>Lokasi Presisi</strong> di Pengaturan → Lokasi → Izin aplikasi → Chrome, dan pastikan mode lokasi "Akurasi Tinggi".')
  );
}

/**
 * Ambil lokasi seakurat mungkin dalam batas waktu.
 *
 * @param {object} [opsi]
 * @param {number} [opsi.akurasiTarget] berhenti lebih awal kalau sudah seteliti ini (meter)
 * @param {number} [opsi.timeoutMs] batas waktu total
 * @param {(info: {accuracy: number, detik: number}) => void} [opsi.onProgress]
 * @returns {Promise<{lat: number, lng: number, accuracy: number}>}
 * @throws {{kode: string, pesan: string}}
 */
export function dapatkanLokasi({ akurasiTarget = 50, timeoutMs = 20000, onProgress } = {}) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      return reject({ kode: LOKASI_ERROR.TIDAK_DIDUKUNG, pesan: pesanLokasi(LOKASI_ERROR.TIDAK_DIDUKUNG) });
    }

    let terbaik = null;
    let selesai = false;
    const mulai = Date.now();

    const tutup = () => {
      selesai = true;
      clearTimeout(jamPasir);
      try {
        navigator.geolocation.clearWatch(watchId);
      } catch {
        /* sudah berhenti */
      }
    };

    const jamPasir = setTimeout(() => {
      if (selesai) return;
      tutup();
      // Fix yang kurang teliti TETAP dikembalikan, tidak dibuang. Pemanggil
      // yang memutuskan apakah cukup — dan ia bisa menjelaskan kenapa tidak,
      // yang jauh lebih berguna daripada "lokasi tidak terdeteksi".
      if (terbaik) resolve(terbaik);
      else reject({ kode: LOKASI_ERROR.TIMEOUT, pesan: pesanLokasi(LOKASI_ERROR.TIMEOUT) });
    }, timeoutMs);

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        if (selesai) return;
        const kandidat = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : 9999
        };
        // Akurasi biasanya MEMBAIK seiring waktu (jaringan dulu, lalu GPS).
        // Karena itu fix disimpan yang terbaik, bukan yang terakhir.
        if (!terbaik || kandidat.accuracy < terbaik.accuracy) terbaik = kandidat;
        onProgress?.({ accuracy: terbaik.accuracy, detik: Math.round((Date.now() - mulai) / 1000) });
        if (terbaik.accuracy <= akurasiTarget) {
          tutup();
          resolve(terbaik);
        }
      },
      (err) => {
        if (selesai) return;
        // Izin ditolak tidak akan membaik dengan menunggu — hentikan sekarang.
        if (err.code === 1) {
          tutup();
          return reject({ kode: LOKASI_ERROR.DITOLAK, pesan: pesanLokasi(LOKASI_ERROR.DITOLAK) });
        }
        // POSITION_UNAVAILABLE / TIMEOUT dari satu percobaan belum tentu final:
        // watchPosition masih bisa mengirim fix berikutnya. Dibiarkan sampai
        // jam pasir habis, kecuali memang tidak ada yang datang sama sekali.
        if (Date.now() - mulai >= timeoutMs - 100) {
          tutup();
          const kode = err.code === 3 ? LOKASI_ERROR.TIMEOUT : LOKASI_ERROR.TIDAK_TERSEDIA;
          if (terbaik) resolve(terbaik);
          else reject({ kode, pesan: pesanLokasi(kode) });
        }
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 }
    );
  });
}
