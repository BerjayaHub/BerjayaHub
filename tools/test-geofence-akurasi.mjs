// Uji keputusan geofence yang sadar KETELITIAN.
//
// Kasus nyata: staff berdiri di depan outlet, izin lokasi sudah diberikan, tapi
// "Lokasi Presisi" HP-nya mati sehingga koordinatnya meleset ratusan meter.
// Sebelum ini ia ditolak tanpa satu pun petunjuk kenapa.
const AKURASI_MAKS = 250;

function putuskan({ jarak, akurasi, radius = 100 }) {
  if (akurasi == null) return 'tidak_ada_lokasi';
  const cocok = jarak <= radius;
  const longgar = !cocok && akurasi <= AKURASI_MAKS && jarak - akurasi <= radius;
  if (cocok) return 'diterima';
  if (longgar) return 'diterima_toleransi';
  if (akurasi > AKURASI_MAKS) return 'akurasi_buruk';
  return 'di_luar';
}

const kasus = [
  [{ jarak: 20, akurasi: 15 }, 'diterima', 'di dalam radius, GPS bagus'],
  [{ jarak: 100, akurasi: 20 }, 'diterima', 'tepat di batas radius'],
  [{ jarak: 260, akurasi: 200 }, 'diterima_toleransi', 'di luar titik, tapi lingkaran ketelitian menyentuh area'],
  [{ jarak: 900, akurasi: 200 }, 'di_luar', 'benar-benar jauh walau GPS-nya cukup baik'],
  [{ jarak: 150, akurasi: 1200 }, 'akurasi_buruk', 'Lokasi Presisi mati -> beri tahu, jangan tuduh di luar'],
  [{ jarak: 3000, akurasi: 2500 }, 'akurasi_buruk', 'kabur total -> tetap tidak diterima, tapi pesannya benar'],
  // Konsekuensi yang disengaja: radius efektif = radius + akurasi. Dengan GPS
  // presisi (akurasi 1 m) slack-nya cuma 1 m, jadi ini memang diterima — dan
  // itu benar secara logika: orangnya BISA berada tepat di batas.
  [{ jarak: 101, akurasi: 1, radius: 100 }, 'diterima_toleransi', 'lewat 1 m dengan akurasi 1 m -> masih mungkin di dalam'],
  [{ jarak: 351, akurasi: 250, radius: 100 }, 'di_luar', 'lewat batas slack maksimum (100+250) -> ditolak'],
  [{ jarak: 0, akurasi: null }, 'tidak_ada_lokasi', 'lokasi gagal diambil']
];

let gagal = 0;
for (const [inp, harap, ket] of kasus) {
  const h = putuskan(inp);
  const ok = h === harap;
  if (!ok) gagal++;
  console.log(`${ok ? '✓' : '✗'} ${String(h).padEnd(18)} · ${ket}`);
}

// Toleransi TIDAK boleh jadi pintu belakang: seseorang 5 km jauhnya dengan
// akurasi yang dilaporkan besar tetap harus ditolak.
const jauh = putuskan({ jarak: 5000, akurasi: 249 });
const okJauh = jauh !== 'diterima_toleransi' && jauh !== 'diterima';
console.log(`${okJauh ? '✓' : '✗'} 5 km dengan akurasi 249 m -> ${jauh} (tidak boleh diterima)`);
if (!okJauh) gagal++;

if (gagal) { console.error(`\n${gagal} keputusan geofence salah.`); process.exit(1); }
console.log('\nKeputusan geofence sadar-ketelitian benar untuk 10 kasus, termasuk batas slack maksimum. ✅');
