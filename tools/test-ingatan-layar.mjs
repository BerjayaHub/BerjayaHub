/**
 * Ingatan layar — diuji terhadap KODE ASLINYA (js/core/ingatan-layar.js).
 *
 * KENAPA ADA. Aplikasi ini halaman web: saat orangnya membuka Excel atau
 * kamera, Android/iOS boleh membuang halaman ini dari memori, dan begitu
 * kembali halamannya dimuat ULANG. Yang dipulihkan dulu hanya kode modulnya —
 * orangnya mendarat di layar depan modul, kehilangan posisi gulir dan sesi yang
 * sedang dia isi. Untuk sesuatu yang terjadi tiap kali orang menyalin angka
 * dari Excel, itu terasa seperti aplikasi yang membatalkan pekerjaannya sendiri.
 *
 * Yang paling penting diuji di sini adalah BATAS USIA-nya. Ingatan yang tidak
 * pernah kedaluwarsa lebih buruk daripada tidak ada ingatan: membuka aplikasi
 * besok pagi lalu mendarat di layar sesi kemarin bukan "melanjutkan" — itu
 * membingungkan, dan orangnya harus mencari jalan keluar dulu sebelum bisa
 * bekerja.
 */

let gagal = 0;
const cek = (nama, dapat, harap) => {
  if (JSON.stringify(dapat) !== JSON.stringify(harap)) {
    gagal++;
    console.error(`❌ ${nama}\n   dapat : ${JSON.stringify(dapat)}\n   harap : ${JSON.stringify(harap)}`);
  }
};

// ---------- Tiruan sessionStorage ----------
const simpanan = new Map();
globalThis.sessionStorage = {
  getItem: (k) => (simpanan.has(k) ? simpanan.get(k) : null),
  setItem: (k, v) => simpanan.set(k, String(v)),
  removeItem: (k) => simpanan.delete(k)
};

const M = await import('../js/core/ingatan-layar.js');

// ---------- Alur biasa ----------
M.ingatModul('cleaning');
cek('modul terakhir tercatat', M.modulTerakhir(), 'cleaning');
cek('layar dalamnya kosong dulu', M.layarTerakhir('cleaning'), null);
cek('gulir mulai dari 0', M.gulirTerakhir('cleaning'), 0);

M.ingatLayar('sesi:abc');
M.ingatGulir(640);
cek('layar sesi tercatat', M.layarTerakhir('cleaning'), 'sesi:abc');
cek('gulir tercatat', M.gulirTerakhir('cleaning'), 640);

// ---------- Tidak boleh salah kamar ----------
cek('layar modul lain tidak ikut terbaca', M.layarTerakhir('kas'), null);
cek('gulir modul lain juga tidak', M.gulirTerakhir('kas'), 0);

// ---------- Berpindah modul menyetel ulang isi dalamnya ----------
M.ingatModul('kas');
cek('modul berganti', M.modulTerakhir(), 'kas');
cek('layar sesi lama tidak terbawa', M.layarTerakhir('kas'), null);
cek('gulir lama tidak terbawa', M.gulirTerakhir('kas'), 0);

// ---------- Kembali ke layar utama modul ----------
M.ingatModul('cleaning');
M.ingatLayar('sesi:abc');
M.ingatLayar(null);
cek('kembali ke daftar -> layar dalamnya kosong', M.layarTerakhir('cleaning'), null);
cek('tapi modulnya tetap diingat', M.modulTerakhir(), 'cleaning');

// ---------- Beranda: ingatannya dibuang ----------
M.ingatModul(null);
cek('di Beranda tidak ada modul yang diingat', M.modulTerakhir(), null);
cek('dan tidak ada layar yang diingat', M.layarTerakhir('cleaning'), null);

// ---------- BATAS USIA ----------
M.ingatModul('cleaning');
M.ingatLayar('sesi:abc');
M.ingatGulir(500);

const majukanJam = (menit) => {
  const data = JSON.parse(simpanan.get('berjaya_ingatan_layar'));
  data.ts -= menit * 60 * 1000;
  simpanan.set('berjaya_ingatan_layar', JSON.stringify(data));
};

majukanJam(29);
cek('29 menit: masih dianggap melanjutkan', M.modulTerakhir(), 'cleaning');
cek('29 menit: layarnya ikut pulih', M.layarTerakhir('cleaning'), 'sesi:abc');

majukanJam(2); // total 31 menit
cek('31 menit: ingatannya sudah basi', M.modulTerakhir(), null);
cek('31 menit: layarnya tidak dipulihkan', M.layarTerakhir('cleaning'), null);
cek('31 menit: gulirnya juga tidak', M.gulirTerakhir('cleaning'), 0);

// Menulis di atas ingatan basi tidak boleh "menghidupkannya" separuh.
M.ingatLayar('sesi:zzz');
cek('menulis layar di atas ingatan basi tidak menghidupkannya', M.layarTerakhir('cleaning'), null);
M.ingatGulir(900);
cek('menulis gulir di atas ingatan basi juga tidak', M.gulirTerakhir('cleaning'), 0);

// ---------- Penyimpanan diblokir (mode privat) ----------
const asli = globalThis.sessionStorage;
globalThis.sessionStorage = {
  getItem() {
    throw new Error('diblokir');
  },
  setItem() {
    throw new Error('diblokir');
  },
  removeItem() {
    throw new Error('diblokir');
  }
};
// Yang penting: TIDAK melempar. Fitur kenyamanan tidak boleh menjatuhkan
// aplikasi hanya karena penyimpanannya diblokir.
M.ingatModul('cleaning');
M.ingatLayar('sesi:abc');
M.ingatGulir(100);
cek('penyimpanan diblokir: dianggap tidak ada ingatan', M.modulTerakhir(), null);
cek('penyimpanan diblokir: layar juga kosong', M.layarTerakhir('cleaning'), null);
globalThis.sessionStorage = asli;

// ---------- Isi yang rusak ----------
simpanan.set('berjaya_ingatan_layar', '{bukan json');
cek('isi rusak dianggap tidak ada ingatan', M.modulTerakhir(), null);
simpanan.set('berjaya_ingatan_layar', 'null');
cek('isi null aman', M.modulTerakhir(), null);
simpanan.set('berjaya_ingatan_layar', '{"modul":"kas"}'); // tanpa ts
cek('tanpa cap waktu dianggap basi, bukan abadi', M.modulTerakhir(), null);

if (gagal) {
  console.error(`\n${gagal} kasus gagal.`);
  process.exit(1);
}
console.log('Ingatan layar benar untuk 26 kasus, termasuk batas usia & penyimpanan yang diblokir. ✅');
