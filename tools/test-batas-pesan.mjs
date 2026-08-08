/**
 * Batas pemesanan "H- sekian hari" + jam batas (migration 0080).
 *
 * Cermin dari `reservation_info_tanggal`. Yang benar-benar diuji di sini adalah
 * TEPI-nya: satu menit sebelum dan sesudah batas, hari batas itu sendiri, dan
 * hari-hari sebelumnya yang TIDAK boleh ikut kena jam batas. Kesalahan di tepi
 * seperti ini tidak pernah muncul sebagai error — ia muncul sebagai tamu yang
 * ditolak padahal masih boleh, dan tidak ada yang melaporkannya karena tamunya
 * cuma pergi.
 */

let gagal = 0;
const cek = (nama, dapat, harap) => {
  if (dapat !== harap) {
    gagal++;
    console.error(`❌ ${nama}\n   dapat : ${dapat}\n   harap : ${harap}`);
  }
};

const hari = (a, b) => Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000);

/**
 * @param {{minLeadDays:number, cutoff:string|null, maxDaysAhead:number}} s
 * @param {string} sekarangTgl 'YYYY-MM-DD' (WIB)
 * @param {string} sekarangJam 'HH:MM'
 * @param {string} tanggalReservasi
 * @returns {'boleh'|'lewat'|'terlalu_jauh'|'terlalu_mepet'|'lewat_cutoff'}
 */
function periksa(s, sekarangTgl, sekarangJam, tanggalReservasi) {
  const selisih = hari(sekarangTgl, tanggalReservasi);
  if (selisih < 0) return 'lewat';
  if (selisih > s.maxDaysAhead) return 'terlalu_jauh';
  if (selisih < s.minLeadDays) return 'terlalu_mepet';
  // Jam batas HANYA berlaku di hari batas. Kalau ikut berlaku di hari-hari
  // sebelumnya, "sebelum pukul 17.00" akan menolak pemesanan H-10 yang
  // kebetulan dibuat jam 8 malam — aturan yang tidak pernah dimaksudkan.
  if (selisih === s.minLeadDays && s.cutoff && sekarangJam > s.cutoff) return 'lewat_cutoff';
  return 'boleh';
}

// H-3, ditutup pukul 17.00 — contoh yang dipakai di README & layar admin.
const S = { minLeadDays: 3, cutoff: '17:00', maxDaysAhead: 60 };

cek('H-4 pagi', periksa(S, '2026-08-16', '09:00', '2026-08-20'), 'boleh');
cek('H-4 malam: jam batas belum berlaku', periksa(S, '2026-08-16', '20:00', '2026-08-20'), 'boleh');
cek('H-3 sebelum jam batas', periksa(S, '2026-08-17', '16:59', '2026-08-20'), 'boleh');
cek('H-3 tepat di jam batas masih diterima', periksa(S, '2026-08-17', '17:00', '2026-08-20'), 'boleh');
cek('H-3 semenit setelah jam batas', periksa(S, '2026-08-17', '17:01', '2026-08-20'), 'lewat_cutoff');
cek('H-2 kapan pun ditolak', periksa(S, '2026-08-18', '08:00', '2026-08-20'), 'terlalu_mepet');
cek('hari-H ditolak', periksa(S, '2026-08-20', '08:00', '2026-08-20'), 'terlalu_mepet');
cek('tanggal kemarin', periksa(S, '2026-08-21', '08:00', '2026-08-20'), 'lewat');
cek('terlalu jauh', periksa(S, '2026-08-01', '08:00', '2026-11-01'), 'terlalu_jauh');

// Tanpa jam batas: hari batas berlaku sampai tengah malam.
const T = { minLeadDays: 3, cutoff: null, maxDaysAhead: 60 };
cek('tanpa cutoff: H-3 jam 23.59 masih boleh', periksa(T, '2026-08-17', '23:59', '2026-08-20'), 'boleh');
cek('tanpa cutoff: H-2 tetap ditolak', periksa(T, '2026-08-18', '00:01', '2026-08-20'), 'terlalu_mepet');

// H-0: hari itu juga boleh, dan cutoff jadi jam tutup pemesanan hari yang sama.
const N = { minLeadDays: 0, cutoff: '17:00', maxDaysAhead: 60 };
cek('H-0 pagi untuk hari ini', periksa(N, '2026-08-20', '09:00', '2026-08-20'), 'boleh');
cek('H-0 setelah jam tutup untuk hari ini', periksa(N, '2026-08-20', '18:00', '2026-08-20'), 'lewat_cutoff');
cek('H-0 setelah jam tutup, tapi untuk BESOK, tetap boleh', periksa(N, '2026-08-20', '18:00', '2026-08-21'), 'boleh');

// Tanpa aturan sama sekali (bawaan lama): tidak ada yang berubah.
const L = { minLeadDays: 0, cutoff: null, maxDaysAhead: 60 };
cek('bawaan: hari ini boleh', periksa(L, '2026-08-20', '23:00', '2026-08-20'), 'boleh');
cek('bawaan: besok boleh', periksa(L, '2026-08-20', '23:00', '2026-08-21'), 'boleh');

// Pergantian bulan & tahun — hari batas dihitung mundur melewati batas kalender.
cek('hari batas jatuh di bulan sebelumnya', periksa(S, '2026-08-30', '09:00', '2026-09-02'), 'boleh');
cek('hari batas di bulan sebelumnya, lewat cutoff', periksa(S, '2026-08-30', '17:30', '2026-09-02'), 'lewat_cutoff');
cek('hari batas melewati pergantian tahun', periksa(S, '2026-12-30', '09:00', '2027-01-02'), 'boleh');

// H- besar: aturan "menu H-3 untuk >20 orang" bisa saja dinaikkan jadi H-7.
const W = { minLeadDays: 7, cutoff: '12:00', maxDaysAhead: 60 };
cek('H-7 sebelum siang', periksa(W, '2026-08-13', '11:00', '2026-08-20'), 'boleh');
cek('H-7 setelah siang', periksa(W, '2026-08-13', '12:30', '2026-08-20'), 'lewat_cutoff');
cek('H-6 ditolak', periksa(W, '2026-08-14', '08:00', '2026-08-20'), 'terlalu_mepet');

if (gagal) {
  console.error(`\n${gagal} kasus gagal.`);
  process.exit(1);
}
console.log('Batas pemesanan H- benar untuk 23 kasus, termasuk tepi jam batas & pergantian bulan. ✅');
