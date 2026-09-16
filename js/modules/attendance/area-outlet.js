/**
 * "APAKAH TITIK INI DI DALAM AREA OUTLET" — satu aturan, semua gerbang presensi.
 *
 * ============ KENAPA INI PERLU BERDIRI SENDIRI ============
 *
 * Aturannya dulu ditulis DUA KALI di `attendance.page.js`:
 *
 *   `runDetection()`         — mencari outlet terdekat yang cocok, dengan
 *                              kelonggaran ketelitian GPS. Dipakai CLOCK IN.
 *   `pastikanDiAreaOutlet()` — memeriksa jarak ke SATU outlet, tanpa
 *                              kelonggaran ketelitian yang sama. Dipakai CLOCK
 *                              OUT, Istirahat, dan Kembali.
 *
 * Keduanya sudah menyimpang: yang kedua memakai
 * `radius + min(accuracy, 50)` sementara yang pertama memakai
 * `d - accuracy <= radius` dengan batas 250 m. Staff yang BISA clock in di
 * sebuah outlet karena kelonggaran ketelitian, belum tentu bisa clock out di
 * outlet yang sama — dan tidak ada apa pun di layar yang menjelaskan kenapa.
 *
 * ============ CLOCK OUT TIDAK TERIKAT OUTLET CLOCK IN ============
 *
 *   "staff seharusnya bisa clock in CK dan clock out di Sentul ... karena staff
 *    bisa clock in dan clock out dimanapun lokasi outlet yang sudah saya
 *    daftarkan geofencing nya, perkara nbm seharusnya sudah mengikuti outlet
 *    basis"
 *
 * Itu benar, dan NBM-nya memang sudah begitu: `clockIn` menyimpan `outlet_id`
 * (tempat fisik) TERPISAH dari `nbm_outlet_id` (outlet basis ★), dan seluruh
 * laporan SDM membaca `nbm_outlet_id ?? outlet_id`. Yang salah cuma gerbangnya
 * — ia mengunci ke outlet tempat orangnya clock in.
 *
 * Maka fungsi di bawah menerima DAFTAR outlet, bukan satu outlet.
 *
 * Tidak ada impor di berkas ini, supaya bisa diuji tanpa browser.
 */

/**
 * Ambang ketelitian yang masih boleh dipakai MENERIMA presensi lewat lingkaran
 * ketelitian.
 *
 * KONSEKUENSINYA HARUS DISADARI: radius efektif jadi `radius + akurasi`, paling
 * jauh `radius + 250 m`. Itu kelonggaran yang nyata, dan dipilih sadar — fix
 * berbasis wifi/menara di dalam gedung memang jatuh di kisaran 50-250 m, dan
 * itulah kasus orang jujur yang selama ini tertolak.
 *
 * Yang di atas 250 m (mis. "Lokasi Presisi" mati, yang memberi 1-3 km) TIDAK
 * dilonggarkan. HP yang bilang "saya di suatu tempat dalam radius 1 km" tidak
 * sedang membuktikan dia ada di outlet; menerimanya hanya memindahkan kesalahan
 * ke tempat yang lebih sulit dilihat.
 */
export const AKURASI_MAKS_TOLERANSI = 250;

/** Radius bawaan kalau outletnya belum menyetel sendiri. */
export const RADIUS_BAWAAN_M = 100;

/**
 * `null`/`undefined`/`''` berarti KOSONG; `0` tidak.
 *
 * `Number(null)` adalah **0**, bukan NaN. Tanpa penyaringan di baris pertama,
 * outlet yang koordinatnya belum diisi terbaca sebagai berada di titik (0, 0)
 * di Teluk Guinea, radius geofence yang kosong terbaca sebagai **0 meter**, dan
 * jarak yang tidak terhitung terbaca sebagai "tepat di titik outlet".
 *
 * Ketiganya salah ke arah yang berbeda, dan tidak satu pun melempar error.
 */
const angka = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Outlet yang geofence-nya BENAR-BENAR aktif (titiknya sudah diisi). */
export function berkoordinat(outlets) {
  return (Array.isArray(outlets) ? outlets : []).filter((o) => angka(o?.latitude) !== null && angka(o?.longitude) !== null);
}

/**
 * Apakah satu jarak diterima untuk satu outlet?
 *
 * @param {number} jarak     meter dari titik outlet
 * @param {number} radius    radius geofence outlet
 * @param {number|null} akurasi ketelitian fix GPS (meter)
 * @returns {{cocok: boolean, lewatToleransi: boolean}}
 *   `lewatToleransi` = diterima HANYA karena lingkaran ketelitiannya menyentuh
 *   area. Dibedakan supaya bisa ditulis di layar dan disimpan — kelonggaran
 *   yang tidak disebut adalah kelonggaran diam-diam.
 */
export function diterimaDiArea(jarak, radius, akurasi) {
  const d = angka(jarak);
  if (d === null) return { cocok: false, lewatToleransi: false };
  const r = angka(radius) ?? RADIUS_BAWAAN_M;
  if (d <= r) return { cocok: true, lewatToleransi: false };

  const a = angka(akurasi);
  // Akurasi yang TIDAK terbaca bukan alasan untuk melonggarkan. Kalau ia
  // diperlakukan sebagai 0 saja itu tidak apa-apa (tidak melonggarkan), tapi
  // memperlakukannya sebagai "sangat kabur" akan membuka gerbangnya lebar-lebar
  // justru saat datanya paling tidak bisa dipertanggungjawabkan.
  if (a === null || a > AKURASI_MAKS_TOLERANSI) return { cocok: false, lewatToleransi: false };
  return { cocok: d - a <= r, lewatToleransi: d - a <= r };
}

/**
 * Cari outlet terdaftar yang titik ini berada di dalamnya.
 *
 * @param {object} o
 * @param {{lat: number, lng: number, accuracy?: number}} o.loc
 * @param {object[]} o.outlets  daftar outlet (yang tanpa koordinat diabaikan)
 * @param {(aLat:number,aLng:number,bLat:number,bLng:number)=>number} o.jarak
 *   penghitung jarak — DISUNTIKKAN, bukan ditulis ulang di sini. Satu haversine
 *   untuk seluruh aplikasi; dua salinan pasti menyimpang di angka desimalnya.
 * @returns {{outlet: object|null, jarak: number|null, lewatToleransi: boolean,
 *            terdekat: object|null, jarakTerdekat: number|null, adaGeofence: boolean}}
 */
export function cariOutletArea({ loc, outlets, jarak } = {}) {
  const daftar = berkoordinat(outlets);
  const kosong = { outlet: null, jarak: null, lewatToleransi: false, terdekat: null, jarakTerdekat: null, adaGeofence: daftar.length > 0 };
  if (!daftar.length || typeof jarak !== 'function') return kosong;

  const lat = angka(loc?.lat);
  const lng = angka(loc?.lng);
  if (lat === null || lng === null) return kosong;
  const akurasi = angka(loc?.accuracy);

  let pilih = null;
  let pilihJarak = Infinity;
  let pilihLonggar = false;
  let terdekat = null;
  let jarakTerdekat = Infinity;

  for (const o of daftar) {
    const d = angka(jarak(lat, lng, Number(o.latitude), Number(o.longitude)));
    if (d === null) continue;
    if (d < jarakTerdekat) {
      jarakTerdekat = d;
      terdekat = o;
    }
    const { cocok, lewatToleransi } = diterimaDiArea(d, o.geofence_radius_m, akurasi);
    // YANG PALING DEKAT yang menang, bukan yang pertama ketemu. Dua outlet yang
    // areanya bersinggungan (mis. CK dan gudang di satu kompleks) akan sama-sama
    // cocok, dan memilih yang kebetulan lebih dulu di daftar membuat presensi
    // tercatat di outlet yang salah tanpa ada yang menyadarinya.
    if (cocok && d < pilihJarak) {
      pilih = o;
      pilihJarak = d;
      pilihLonggar = lewatToleransi;
    }
  }

  return {
    outlet: pilih,
    jarak: pilih ? pilihJarak : null,
    lewatToleransi: pilihLonggar,
    terdekat,
    jarakTerdekat: terdekat ? jarakTerdekat : null,
    adaGeofence: true
  };
}

/**
 * Boleh tidaknya sebuah aksi presensi dilakukan dari titik ini — beserta
 * SEBABNYA kalau tidak.
 *
 * Tiga hal yang sengaja TIDAK menolak:
 *
 *   - sesi Tugas Luar/Storing  -> orangnya memang sedang tidak di outlet;
 *   - tidak ada satu pun outlet ber-geofence -> fiturnya memang belum
 *     dinyalakan, aturan yang sama dengan clock in;
 *   - outlet sesi ini sendiri belum ber-geofence -> sebelum perubahan ini,
 *     staffnya memang bebas clock out dari mana saja. Mempersempitnya
 *     diam-diam akan mengunci orang yang selama ini baik-baik saja di luar
 *     jam kerja admin.
 *
 * Yang TETAP menolak: GPS yang gagal dibaca. Kalau kegagalan GPS diloloskan,
 * seluruh gerbang ini bisa dilewati cukup dengan mematikan izin lokasi.
 *
 * @returns {{boleh: boolean, alasan: string, outlet: object|null, lewatToleransi: boolean}}
 */
export function bolehAksiPresensi({ sesi, outlets, loc, jarak, aksi = 'Aksi ini', outletSesi = null } = {}) {
  if (sesi?.is_storing) return { boleh: true, alasan: '', outlet: null, lewatToleransi: false };

  const daftar = berkoordinat(outlets);
  if (!daftar.length) return { boleh: true, alasan: '', outlet: null, lewatToleransi: false };

  if (outletSesi && angka(outletSesi.latitude) === null) {
    return { boleh: true, alasan: '', outlet: null, lewatToleransi: false };
  }

  if (!loc) {
    return {
      boleh: false,
      alasan: `Lokasi tidak terbaca, jadi ${aksi} belum bisa dicatat. Nyalakan GPS lalu coba lagi.`,
      outlet: null,
      lewatToleransi: false
    };
  }

  const hasil = cariOutletArea({ loc, outlets: daftar, jarak });
  if (hasil.outlet) return { boleh: true, alasan: '', outlet: hasil.outlet, lewatToleransi: hasil.lewatToleransi };

  // Pesannya menyebut outlet TERDEKAT, bukan outlet tempat ia clock in — sebab
  // sejak sekarang yang menentukan memang outlet mana pun yang terdaftar, dan
  // menyebut outlet yang salah akan mengirim orangnya kembali ke tempat yang
  // tidak perlu.
  const dekat = hasil.terdekat;
  return {
    boleh: false,
    alasan: dekat
      ? `Kamu ${Math.round(hasil.jarakTerdekat)} m dari ${dekat.name} (radius ${angka(dekat.geofence_radius_m) ?? RADIUS_BAWAAN_M} m), ` +
        `dan tidak berada di area outlet terdaftar lainnya — jadi ${aksi} belum bisa dicatat. ` +
        `${aksi} boleh dilakukan di outlet mana pun yang geofence-nya sudah didaftarkan, tidak harus tempat kamu clock in.`
      : `Kamu tidak berada di area outlet terdaftar mana pun, jadi ${aksi} belum bisa dicatat.`,
    outlet: null,
    lewatToleransi: false
  };
}
