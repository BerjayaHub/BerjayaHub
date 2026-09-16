/**
 * TES `js/modules/attendance/area-outlet.js`.
 *
 * ============ YANG PALING PERLU DIJAGA ============
 *
 * 1. CLOCK OUT TIDAK TERIKAT OUTLET CLOCK IN. Staff yang clock in di Central
 *    Kitchen lalu pulang lewat Sentul harus bisa clock out di Sentul — karena
 *    NBM-nya mengikuti outlet BASIS (`nbm_outlet_id`), bukan tempat fisiknya.
 *    Versi lama menolak dengan "Kamu 47501 m dari Central Kitchen Tangerang",
 *    padahal orangnya sedang BERDIRI di dalam outlet terdaftar.
 *
 * 2. SATU ATURAN UNTUK CLOCK IN & CLOCK OUT. Keduanya dulu punya rumus
 *    kelonggaran sendiri, dan sudah menyimpang: `radius + min(akurasi, 50)`
 *    versus `d - akurasi <= radius` berbatas 250 m. Staff yang bisa clock in
 *    lewat kelonggaran ketelitian belum tentu bisa clock out di outlet yang
 *    sama — tanpa satu pun keterangan di layar.
 *
 * 3. GPS YANG GAGAL TETAP DITOLAK. Kalau kegagalan GPS diloloskan, seluruh
 *    gerbang ini bisa dilewati cukup dengan mematikan izin lokasi.
 */
import {
  diterimaDiArea,
  cariOutletArea,
  bolehAksiPresensi,
  berkoordinat,
  AKURASI_MAKS_TOLERANSI,
  RADIUS_BAWAAN_M
} from '../js/modules/attendance/area-outlet.js';

let gagal = 0;
const cek = (nama, dapat, harap) => {
  if (JSON.stringify(dapat) !== JSON.stringify(harap)) {
    gagal++;
    console.error(`❌ ${nama}\n   dapat : ${JSON.stringify(dapat)}\n   harap : ${JSON.stringify(harap)}`);
  }
};
const benar = (nama, syarat, ket = '') => {
  if (!syarat) {
    gagal++;
    console.error(`❌ ${nama}${ket ? ' — ' + ket : ''}`);
  }
};

/**
 * Jarak PALSU yang bisa diatur, supaya tesnya tidak bergantung pada haversine
 * maupun pada koordinat sungguhan. Yang diuji adalah ATURANNYA, bukan
 * trigonometrinya.
 */
const peta = new Map();
const jarak = (lat, lng, oLat, oLng) => peta.get(`${oLat},${oLng}`) ?? Infinity;
const O = (nama, key, radius = 100) => ({ id: nama, name: nama, latitude: key, longitude: key, geofence_radius_m: radius });

const CK = O('Central Kitchen', 1);
const SENTUL = O('AB Sentul', 2);
const TANPA_GEO = { id: 'baru', name: 'Outlet Baru', latitude: null, longitude: null };
const LOC = { lat: -6.2, lng: 106.8, accuracy: 20 };

// =====================================================================
// §1 ATURAN SATU OUTLET
// =====================================================================
cek('§1 di dalam radius', diterimaDiArea(50, 100, 10), { cocok: true, lewatToleransi: false });
cek('§1 tepat di batas radius', diterimaDiArea(100, 100, 10), { cocok: true, lewatToleransi: false });
cek('§1 di luar radius, ketelitian tidak menolong', diterimaDiArea(500, 100, 10), { cocok: false, lewatToleransi: false });
// Lingkaran ketelitian menyentuh area -> diterima, TAPI ditandai.
cek('§1 diterima lewat kelonggaran ketelitian', diterimaDiArea(150, 100, 80), { cocok: true, lewatToleransi: true });
// Batasnya nyata: ±1 km tidak membuktikan apa pun.
cek('§1 ketelitian di atas ambang tidak melonggarkan', diterimaDiArea(150, 100, AKURASI_MAKS_TOLERANSI + 1), {
  cocok: false,
  lewatToleransi: false
});
cek('§1 tepat di ambang masih melonggarkan', diterimaDiArea(300, 100, AKURASI_MAKS_TOLERANSI), { cocok: true, lewatToleransi: true });
// Akurasi yang TIDAK terbaca bukan alasan melonggarkan.
cek('§1 akurasi null tidak melonggarkan', diterimaDiArea(150, 100, null), { cocok: false, lewatToleransi: false });
cek('§1 radius kosong pakai bawaan', diterimaDiArea(RADIUS_BAWAAN_M, null, 0), { cocok: true, lewatToleransi: false });
cek('§1 jarak tak terbaca ditolak', diterimaDiArea(null, 100, 10), { cocok: false, lewatToleransi: false });

// =====================================================================
// §2 CARI OUTLET — INTI PERUBAHANNYA
// =====================================================================
{
  // Clock in di CK, sekarang berdiri di Sentul.
  peta.clear();
  peta.set('1,1', 47501);
  peta.set('2,2', 15);
  const h = cariOutletArea({ loc: LOC, outlets: [CK, SENTUL], jarak });
  cek('§2 diterima di outlet lain yang terdaftar', h.outlet?.name, 'AB Sentul');
  cek('§2 jaraknya ikut', Math.round(h.jarak), 15);
  cek('§2 bukan lewat kelonggaran', h.lewatToleransi, false);
}
{
  // Dua outlet sama-sama cocok -> yang PALING DEKAT menang, bukan yang pertama
  // di daftar. Kalau tidak, presensi tercatat di outlet yang salah.
  peta.clear();
  peta.set('1,1', 80);
  peta.set('2,2', 20);
  cek('§2 yang paling dekat menang', cariOutletArea({ loc: LOC, outlets: [CK, SENTUL], jarak }).outlet?.name, 'AB Sentul');
  cek('§2 tidak bergantung urutan daftar', cariOutletArea({ loc: LOC, outlets: [SENTUL, CK], jarak }).outlet?.name, 'AB Sentul');
}
{
  peta.clear();
  peta.set('1,1', 47501);
  peta.set('2,2', 900);
  const h = cariOutletArea({ loc: LOC, outlets: [CK, SENTUL], jarak });
  cek('§2 tidak di mana pun: outlet null', h.outlet, null);
  // Yang terdekat tetap dilaporkan — pesannya harus menyebut tempat yang
  // relevan, bukan outlet tempat ia clock in yang jauhnya 47 km.
  cek('§2 tapi yang terdekat tetap disebut', h.terdekat?.name, 'AB Sentul');
  cek('§2 beserta jaraknya', Math.round(h.jarakTerdekat), 900);
}
{
  peta.clear();
  cek('§2 outlet tanpa koordinat diabaikan', cariOutletArea({ loc: LOC, outlets: [TANPA_GEO], jarak }).adaGeofence, false);
  cek('§2 daftar kosong aman', cariOutletArea({ loc: LOC, outlets: [], jarak }).outlet, null);
  cek('§2 tanpa argumen aman', cariOutletArea().outlet, null);
  cek('§2 lokasi tanpa koordinat aman', cariOutletArea({ loc: { lat: null, lng: null }, outlets: [CK], jarak }).outlet, null);
}
cek('§2 berkoordinat menyaring yang belum diisi', berkoordinat([CK, TANPA_GEO, SENTUL]).length, 2);
cek('§2 berkoordinat: bukan array aman', berkoordinat('x').length, 0);

// =====================================================================
// §3 GERBANG AKSI PRESENSI
// =====================================================================
const SESI = { id: 's1', outlet_id: 'Central Kitchen', is_storing: false };

{
  // KASUS YANG DILAPORKAN: clock in CK, clock out di Sentul.
  peta.clear();
  peta.set('1,1', 47501);
  peta.set('2,2', 15);
  const h = bolehAksiPresensi({ sesi: SESI, outlets: [CK, SENTUL], loc: LOC, jarak, aksi: 'Clock Out', outletSesi: CK });
  cek('§3 clock out di outlet lain DITERIMA', h.boleh, true);
  cek('§3 dan outletnya disebut', h.outlet?.name, 'AB Sentul');
}
{
  peta.clear();
  peta.set('1,1', 47501);
  peta.set('2,2', 900);
  const h = bolehAksiPresensi({ sesi: SESI, outlets: [CK, SENTUL], loc: LOC, jarak, aksi: 'Clock Out', outletSesi: CK });
  cek('§3 di luar semua outlet: ditolak', h.boleh, false);
  benar('§3 pesannya menyebut outlet TERDEKAT', h.alasan.includes('AB Sentul'), h.alasan);
  // Pesan yang menyebut outlet clock in (47 km) akan mengirim orangnya balik ke
  // tempat yang tidak perlu.
  benar('§3 bukan outlet clock in yang jauh', !h.alasan.includes('47501'), h.alasan);
  benar('§3 dan menjelaskan aturannya', /outlet mana pun/i.test(h.alasan), h.alasan);
}
{
  // Tugas Luar/Storing: orangnya memang tidak di outlet.
  peta.clear();
  peta.set('1,1', 47501);
  peta.set('2,2', 90000);
  const h = bolehAksiPresensi({ sesi: { ...SESI, is_storing: true }, outlets: [CK, SENTUL], loc: LOC, jarak, aksi: 'Clock Out' });
  cek('§3 mode Tugas Luar dikecualikan', h.boleh, true);
}
{
  // GPS gagal -> DITOLAK. Kalau diloloskan, gerbangnya bisa dilewati cukup
  // dengan mematikan izin lokasi.
  const h = bolehAksiPresensi({ sesi: SESI, outlets: [CK, SENTUL], loc: null, jarak, aksi: 'Clock Out', outletSesi: CK });
  cek('§3 GPS gagal ditolak', h.boleh, false);
  benar('§3 dan pesannya menyebut GPS', /GPS/i.test(h.alasan), h.alasan);
}
{
  // Tapi GPS gagal saat mode Tugas Luar tetap lolos — urutan pemeriksaannya
  // tidak boleh terbalik.
  const h = bolehAksiPresensi({ sesi: { ...SESI, is_storing: true }, outlets: [CK], loc: null, jarak, aksi: 'Clock Out' });
  cek('§3 Tugas Luar diperiksa sebelum GPS', h.boleh, true);
}
{
  // Belum ada satu pun outlet ber-geofence -> fiturnya memang belum menyala.
  const h = bolehAksiPresensi({ sesi: SESI, outlets: [TANPA_GEO], loc: null, jarak, aksi: 'Clock Out' });
  cek('§3 tanpa geofence di mana pun: bebas', h.boleh, true);
}
{
  // Outlet sesi ini sendiri belum ber-geofence -> perilaku lama dipertahankan.
  // Mempersempitnya diam-diam akan mengunci orang yang selama ini baik-baik
  // saja, di luar jam kerja admin.
  peta.clear();
  peta.set('1,1', 99999);
  const h = bolehAksiPresensi({ sesi: SESI, outlets: [CK, TANPA_GEO], loc: LOC, jarak, aksi: 'Clock Out', outletSesi: TANPA_GEO });
  cek('§3 outlet sesi tanpa geofence: bebas', h.boleh, true);
}
{
  // Kelonggaran ketelitian berlaku juga di gerbang ini — inilah yang dulu
  // berbeda antara clock in dan clock out.
  peta.clear();
  peta.set('1,1', 150);
  const longgar = bolehAksiPresensi({
    sesi: SESI,
    outlets: [CK],
    loc: { ...LOC, accuracy: 80 },
    jarak,
    aksi: 'Clock Out',
    outletSesi: CK
  });
  cek('§3 diterima lewat kelonggaran ketelitian', longgar.boleh, true);
  cek('§3 dan ditandai', longgar.lewatToleransi, true);
  // Rumus LAMA gerbang clock out: radius + min(akurasi, 50) = 150 -> jarak 150
  // lolos juga. Maka dipakai jarak yang membedakan keduanya dengan jelas.
  peta.set('1,1', 175);
  const bedanya = bolehAksiPresensi({
    sesi: SESI,
    outlets: [CK],
    loc: { ...LOC, accuracy: 80 },
    jarak,
    aksi: 'Clock Out',
    outletSesi: CK
  });
  benar('§3 aturan barunya benar-benar lebih longgar dari rumus lama', bedanya.boleh, 'jarak 175 m, radius 100, akurasi 80');
}
cek('§3 tanpa argumen aman', bolehAksiPresensi().boleh, true);

if (gagal) {
  console.error(`\n${gagal} kasus gagal.`);
  process.exit(1);
}
console.log('area-outlet.js benar — clock out boleh di outlet terdaftar mana pun, aturannya satu untuk clock in & clock out, dan GPS gagal tetap ditolak. ✅');
