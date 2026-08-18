/**
 * Ingatan layar: mengembalikan orang ke TEMPAT terakhirnya, bukan cuma ke modulnya.
 *
 * MASALAHNYA. Aplikasi ini halaman web. Saat orangnya berpindah ke aplikasi
 * lain — Excel, WhatsApp, kamera — Android/iOS boleh saja MEMBUANG halaman ini
 * dari memori kalau RAM sedang sempit. Begitu kembali, halamannya dimuat ULANG
 * dari nol. Tidak ada yang bisa mencegahnya dari sisi kode; yang bisa diperbaiki
 * adalah seberapa banyak yang hilang.
 *
 * Sebelumnya yang diingat hanya KODE MODUL. Orangnya kembali ke Daily
 * Activities, tapi ke layar depannya — bukan ke sesi yang sedang dia isi, dan
 * bukan ke posisi gulir daftar panjang yang sedang dia baca. Untuk sesuatu yang
 * terjadi setiap kali orang menyalin angka dari Excel, itu terasa seperti
 * aplikasi yang membatalkan pekerjaannya sendiri.
 *
 * ADA BATAS WAKTUNYA, dan itu disengaja. Ingatan yang berumur lebih dari
 * `UMUR_MAKS_MS` diabaikan. Membuka aplikasi besok pagi lalu mendarat di layar
 * sesi kemarin bukan "melanjutkan", itu membingungkan: konteksnya sudah lain,
 * tanggalnya sudah lain, dan orangnya justru harus mencari jalan keluar dulu.
 * Kembali dalam hitungan menit = melanjutkan; kembali besok = mulai baru.
 *
 * sessionStorage, bukan localStorage: ingatan ini milik sesi yang sedang
 * berjalan. Kalau dipakai localStorage, staff yang besok membuka aplikasi akan
 * langsung mendarat di layar kemarin tanpa pernah melihat Beranda.
 */

const KUNCI = 'berjaya_ingatan_layar';

/**
 * 30 menit. Cukup panjang untuk "buka Excel, salin angka, kembali" —
 * termasuk kalau tersela telepon — tapi tidak sampai menyeberangi pergantian
 * shift.
 */
const UMUR_MAKS_MS = 30 * 60 * 1000;

function baca() {
  try {
    const mentah = sessionStorage.getItem(KUNCI);
    if (!mentah) return null;
    const data = JSON.parse(mentah);
    if (!data || typeof data !== 'object') return null;
    if (!(Date.now() - (data.ts ?? 0) < UMUR_MAKS_MS)) return null; // basi -> mulai bersih
    return data;
  } catch {
    // sessionStorage bisa diblokir (mode privat), JSON bisa rusak.
    // Keduanya berarti hal yang sama: tidak ada ingatan. Bukan error.
    return null;
  }
}

function tulis(data) {
  try {
    sessionStorage.setItem(KUNCI, JSON.stringify({ ...data, ts: Date.now() }));
  } catch {
    /* fitur ini sekadar tidak aktif */
  }
}

/** Catat modul yang sedang dibuka. Mengosongkan ingatan layar dalamnya. */
export function ingatModul(kode) {
  if (!kode) {
    try {
      sessionStorage.removeItem(KUNCI);
    } catch {
      /* diabaikan */
    }
    return;
  }
  tulis({ modul: kode, gulir: 0, layar: null, konteks: null });
}

/** Modul terakhir, atau null kalau tidak ada / sudah basi. */
export function modulTerakhir() {
  return baca()?.modul ?? null;
}

/**
 * Catat sub-layar yang sedang dibuka di dalam modul (mis. sesi yang sedang
 * diisi). `null` berarti kembali ke layar utama modulnya.
 */
export function ingatLayar(layar) {
  const data = baca();
  if (!data) return;
  tulis({ ...data, layar: layar ?? null });
}

/** Sub-layar terakhir DI MODUL INI. Dicocokkan supaya tidak salah kamar. */
export function layarTerakhir(kodeModul) {
  const data = baca();
  if (!data || data.modul !== kodeModul) return null;
  return data.layar ?? null;
}

/**
 * Konteks penyaring yang sedang aktif — outlet mana, tanggal berapa.
 *
 * ============ KENAPA INI ADA, DAN KENAPA IA PENTING ============
 *
 * Sebelumnya yang diingat hanya KODE MODUL dan SUB-LAYAR. Rekaman layar dari
 * lapangan menunjukkan akibatnya, dan akibatnya lebih buruk daripada sekadar
 * "harus mengulang":
 *
 *   Staff membuka Daily Activities di **Central Kitchen Tangerang**, sesi
 *   Opening, 0 dari 3 item. Ia memotret satu item. Android membuang halaman
 *   itu. Halamannya dimuat ulang, sub-layarnya DIPULIHKAN dengan benar —
 *   `sesi:<id>` — tapi outletnya kembali ke pilihan default, **AB Gading
 *   Serpong**. Yang muncul di layar: sesi Opening milik outlet lain, 4 dari 7
 *   item, sudah diisi orang lain.
 *
 * Tidak ada satu pun tanda bahwa outletnya berpindah. Kalau diteruskan
 * mengisi, pekerjaannya masuk ke outlet yang salah.
 *
 * Jadi memulihkan sub-layar TANPA memulihkan konteksnya bukan setengah
 * perbaikan — ia lebih berbahaya daripada tidak memulihkan sama sekali.
 * Pemulihan yang tidak setia mengantar orang ke kamar yang salah sambil
 * meyakinkannya bahwa ia di kamar yang benar.
 *
 * Sengaja disimpan sebagai objek bebas: tiap modul tahu sendiri apa yang
 * membentuk "tempat"-nya. Untuk Daily Activities itu outlet + tanggal.
 */
export function ingatKonteks(konteks) {
  const data = baca();
  if (!data) return;
  tulis({ ...data, konteks: konteks ?? null });
}

/** Konteks terakhir DI MODUL INI, atau null. */
export function konteksTerakhir(kodeModul) {
  const data = baca();
  if (!data || data.modul !== kodeModul) return null;
  return data.konteks ?? null;
}

/** Catat posisi gulir. Dipanggil sering, jadi sengaja murah. */
export function ingatGulir(y) {
  const data = baca();
  if (!data) return;
  tulis({ ...data, gulir: Math.max(0, Math.round(y)) });
}

export function gulirTerakhir(kodeModul) {
  const data = baca();
  if (!data || data.modul !== kodeModul) return 0;
  return data.gulir ?? 0;
}

/**
 * Kembalikan posisi gulir setelah layarnya digambar.
 *
 * Dua `requestAnimationFrame` bertingkat: yang pertama menunggu gambar
 * berikutnya, yang kedua menunggu tata letaknya selesai. Tanpa itu, tingginya
 * halaman belum final dan gulirannya berhenti di tempat yang salah — biasanya
 * di paling atas, yang persis sama dengan tidak melakukan apa-apa.
 *
 * Dibatasi `scrollHeight` yang sekarang: kalau isinya jadi lebih pendek
 * (mis. datanya berkurang), memaksa posisi lama hanya menghasilkan layar kosong.
 */
export function pulihkanGulir(y) {
  if (!(y > 0)) return;
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const maks = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      window.scrollTo({ top: Math.min(y, maks), behavior: 'auto' });
    })
  );
}

/**
 * Pasang pencatat gulir. Dipanggil sekali saat aplikasi dimulai.
 *
 * Ditulis saat halaman DISEMBUNYIKAN dan saat gulirannya berhenti, bukan pada
 * setiap piksel: menulis ke sessionStorage puluhan kali per detik membuat
 * gulirannya tersendat di HP kelas bawah — yang justru dipakai kebanyakan orang
 * di sini.
 */
export function pasangPencatatGulir() {
  let timer = null;
  const catat = () => {
    clearTimeout(timer);
    timer = setTimeout(() => ingatGulir(window.scrollY), 200);
  };
  window.addEventListener('scroll', catat, { passive: true });
  // `visibilitychange` adalah satu-satunya isyarat yang bisa diandalkan sebelum
  // halaman dibuang: `beforeunload` tidak dijalankan saat OS membunuh halaman
  // di latar belakang.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') ingatGulir(window.scrollY);
  });
}
