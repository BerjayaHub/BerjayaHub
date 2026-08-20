import { hargaDariHpp, hargaOnline } from './pricing.js';

/**
 * SIMULASI — kotak pasir hitung. "Bagaimana kalau…"
 *
 * ============ EMPAT KATA, DAN INI YANG KEEMPAT ============
 *
 *   ACTUAL     apa yang sudah terjadi        profit-outlet.js
 *   PROJECTED  perkiraan akhir periode       proyeksi.js
 *   TARGET     apa yang harus dicapai        target.js
 *   SIMULATED  apa yang TERJADI SEANDAINYA   berkas ini
 *
 * Yang keempat paling berbahaya dari semuanya. Tiga yang pertama masih terikat
 * pada sesuatu yang nyata — transaksi, laju, biaya terdaftar. Yang ini tidak
 * terikat apa pun: angkanya seluruhnya karangan yang disengaja, dan justru
 * karena itu ia paling meyakinkan. "Laba Rp 40 juta" yang lahir dari asumsi
 * yang diketik lima menit lalu terlihat persis seperti laba yang sudah masuk
 * rekening.
 *
 * Maka `konteks: 'simulated'` melekat pada SETIAP hasil di sini, termasuk pada
 * baseline, dan layar menandainya di setiap panel.
 *
 * ============ TIDAK MENYENTUH APA PUN ============
 *
 * Tanpa jaringan, tanpa penyimpanan, tanpa mutasi. `simulasiOutlet()` menerima
 * objek dan MEMBUAT objek baru — ia tidak pernah menulis ke dalam masukannya.
 * Menjalankannya seribu kali menghasilkan angka yang sama dan meninggalkan
 * Actual, Proyeksi, dan Target persis seperti semula.
 *
 * ============ BASELINE DIHITUNG FUNGSI YANG SAMA ============
 *
 * Godaan terbesar di modul ini adalah menghitung baseline dengan jalan pintas —
 * mengambil angka yang sudah ada di layar Actual dan menaruhnya di kolom kiri.
 *
 * Itu membuat seluruh kolom Delta tidak bermakna. Kalau kedua sisi lahir dari
 * jalur kode yang berbeda, selisihnya mengukur perbedaan KODE, bukan perbedaan
 * ASUMSI — dan itu persis kebalikan dari yang mau dijawab. Selisih Rp 6 juta
 * yang sebenarnya berasal dari cara membulatkan akan terbaca sebagai dampak
 * menaikkan harga.
 *
 * Jadi `simulasiOutlet()` dipanggil DUA KALI: sekali dengan ekonomi baseline,
 * sekali dengan ekonomi yang diubah. Keduanya melewati baris kode yang sama.
 *
 * ============ POTONGAN TIDAK DIHITUNG DUA KALI ============
 *
 * `promo` dan `fee` sama-sama bisa mewakili "uang yang tidak sampai ke kita",
 * dan menerapkan keduanya sebagai biaya variabel akan memotong dua kali.
 * Pembagiannya di sini disengaja dan konsisten dengan §17:
 *
 *   promo -> menurunkan HARGA EFEKTIF   (Rp 50.000 promo 10% = Rp 45.000)
 *   fee   -> memotong OMZET             (komponen biaya variabel)
 *
 * Omzet dihitung dari harga efektif; fee dipotong dari omzet itu. Tidak ada
 * satu pun rupiah yang lewat dua kali.
 *
 * Dan kalau pengguna mengisi Variable Cost % LANGSUNG, komponennya (HPP,
 * kemasan, fee) TIDAK ditambahkan lagi di atasnya — angka langsung dianggap
 * sudah memuat semuanya. Pencampuran keduanya dilaporkan sebagai peringatan,
 * bukan dibereskan diam-diam.
 */

const angka = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

function persen(atas, bawah) {
  const a = angka(atas);
  const b = angka(bawah);
  if (a == null || b == null || b === 0) return null;
  return (a / b) * 100;
}

/** Mode simulasi: yang mana yang ditentukan pengguna, yang mana yang dihitung. */
export const MODE = {
  REVENUE: 'revenue',
  UNIT: 'unit'
};

/** Dari mana sebuah besaran datang. */
export const SUMBER_SIM = {
  AKTUAL: 'actual',
  RENCANA: 'planning',
  SIMULASI: 'simulated'
};

/** Bagaimana rasio biaya variabel disusun — dan ini menentukan double counting. */
export const SUSUNAN_VARIABEL = {
  LANGSUNG: 'langsung',
  TERURAI: 'terurai',
  BASELINE: 'baseline'
};

// =====================================================================
// BASELINE — potret ekonomi yang berlaku sekarang
// =====================================================================

/**
 * Ekonomi awal untuk simulasi, beserta asal-usulnya.
 *
 * Urutannya: ekonomi aktual kalau ada transaksinya; kalau tidak, asumsi
 * perencanaan dari Target 10A; kalau keduanya tidak ada, kosong.
 *
 * Yang TIDAK pernah dipakai: `products.sale_price`. Harga master adalah satu
 * angka untuk seluruh BU, yaitu persis yang dihapus di Phase 1–7 — memakainya
 * di sini akan mengembalikannya lewat pintu belakang.
 *
 * @param {{actual?: object, rencana?: {asp?: number|null, variabelPersen?: number|null, fixedBulanan?: number|null}}} a
 */
export function baselineSimulasi({ actual = null, rencana = {} } = {}) {
  const revenueAktual = angka(actual?.revenue) ?? 0;
  const adaTransaksi = revenueAktual > 0 && (angka(actual?.units) ?? 0) > 0;

  const aspAktual = adaTransaksi ? angka(actual?.asp) : null;
  const cmAktual = adaTransaksi ? angka(actual?.cmPersen) : null;
  const variabelAktual = cmAktual == null ? null : 100 - cmAktual;

  const adaBarisFixed = (actual?.rincianFixed ?? []).length > 0;
  const fixedAktual = adaBarisFixed ? (angka(actual?.fixedLangsung) ?? 0) : null;

  const pilih = (dariAktual, dariRencana) =>
    dariAktual != null
      ? { nilai: dariAktual, sumber: SUMBER_SIM.AKTUAL }
      : dariRencana != null
        ? { nilai: dariRencana, sumber: SUMBER_SIM.RENCANA }
        : { nilai: null, sumber: null };

  return {
    konteks: 'simulated',
    peran: 'baseline',
    outletId: actual?.outletId ?? null,
    outletName: actual?.outletName ?? '',

    asp: pilih(aspAktual, angka(rencana.asp)),
    variabelPersen: pilih(variabelAktual, angka(rencana.variabelPersen)),
    fixedBulanan: pilih(fixedAktual, angka(rencana.fixedBulanan)),

    // Dibawa untuk perbandingan volume, bukan untuk dihitung ulang.
    revenueAktual: adaTransaksi ? revenueAktual : null,
    unitsAktual: adaTransaksi ? (angka(actual?.units) ?? null) : null,
    adaTransaksi
  };
}

// =====================================================================
// HARGA SIMULASI — dari HPP ke harga jual
// =====================================================================

/**
 * Harga jual hasil simulasi, dari tiga metode yang sudah dipakai di tab Pricing.
 *
 * Rumusnya dipinjam dari `pricing.js` — TIDAK ditulis ulang. Menulis ulang
 * berarti dua definisi "markup" yang bisa menyimpang, dan yang satu sudah
 * dipakai menetapkan harga sungguhan.
 *
 * BIAYA TETAP TIDAK MASUK KE SINI, dan itu bukan kelalaian. Membebankan sewa
 * ke setiap porsi supaya "marginnya kelihatan sehat" menghasilkan harga yang
 * naik ketika penjualan turun — persis kebalikan dari yang seharusnya terjadi.
 * Biaya tetap ditutup oleh VOLUME, dan itulah gunanya BEP di bawah.
 *
 * @param {{metode: 'food_cost'|'markup'|'margin', persen: number,
 *          hpp: number|null, kemasan?: number, feePersen?: number, promoPersen?: number}} a
 */
export function hargaSimulasi({ metode, persen: p, hpp, kemasan = 0, feePersen = 0, promoPersen = 0 }) {
  const h = angka(hpp);
  const kem = angka(kemasan) ?? 0;

  // HPP kosong TIDAK diganti nol. Kalau diganti, harga sarannya menyusut jadi
  // sebesar biaya kemasan — angka yang tetap terlihat wajar dan tetap salah.
  const hppTotal = h == null ? null : h + kem;
  const dasar = hppTotal == null ? null : hargaDariHpp(metode, hppTotal, p);

  // Harga yang harus dipasang di marketplace supaya yang DITERIMA sama dengan
  // harga offline. Arahnya sering terbalik saat dikira di kepala — penjelasannya
  // di `pricing.js`.
  const online = dasar == null ? null : hargaOnline(dasar, { feePersen, promoPersen });

  return {
    konteks: 'simulated',
    metode,
    persen: angka(p),
    hppSatuan: h,
    kemasanSatuan: kem,
    hppTotal,
    harga: dasar,
    hargaOnline: online,
    // Margin dihitung terhadap SELURUH biaya variabel per porsi (HPP + kemasan),
    // bukan terhadap HPP saja. Kemasan yang dilupakan membuat margin terlihat
    // lebih tebal beberapa persen di setiap menu sekaligus.
    cmSatuan: dasar == null || hppTotal == null ? null : dasar - hppTotal,
    cmPersen: dasar == null || hppTotal == null ? null : persen(dasar - hppTotal, dasar),
    sebab: hppTotal == null ? 'HPP belum ada — isi HPP simulasi.' : dasar == null ? 'Persentasenya membuat harga tidak bermakna.' : null
  };
}

// =====================================================================
// SIMULASI SATU OUTLET
// =====================================================================

/**
 * Susun rasio biaya variabel, dan katakan dari mana ia disusun.
 *
 * Inilah tempat double counting paling mungkin terjadi, jadi ketiga jalannya
 * dipisah tegas dan yang dipakai selalu dilaporkan.
 */
function susunVariabel({ variabelPersen, hppSatuan, kemasanSatuan, feePersen, aspEfektif, baseline, peringatan }) {
  const langsung = angka(variabelPersen);
  const hpp = angka(hppSatuan);
  const kem = angka(kemasanSatuan);
  const fee = angka(feePersen);

  const adaKomponen = hpp != null || kem != null || (fee != null && fee !== 0);

  if (langsung != null) {
    // Angka langsung MENANG, dan komponennya tidak ditambahkan di atasnya.
    // Menambahkannya berarti HPP dihitung dua kali: sekali di dalam persentase
    // yang diketik, sekali lagi dari komponennya.
    if (adaKomponen) {
      peringatan.push(
        'Variable Cost % diisi langsung, jadi HPP, kemasan, dan fee di bawah TIDAK ditambahkan lagi di atasnya — angka yang kamu isi dianggap sudah memuat semuanya. Kosongkan Variable Cost % kalau ingin dihitung dari komponennya.'
      );
    }
    return { nilai: langsung, susunan: SUSUNAN_VARIABEL.LANGSUNG, sumber: SUMBER_SIM.SIMULASI };
  }

  if (adaKomponen) {
    const perUnit = (hpp ?? 0) + (kem ?? 0);
    const dariUnit = aspEfektif != null && aspEfektif > 0 ? (perUnit / aspEfektif) * 100 : null;
    if (dariUnit == null) {
      peringatan.push('HPP dan kemasan tidak bisa diubah jadi persentase tanpa harga jual. Isi harga jual, atau isi Variable Cost % langsung.');
      return { nilai: null, susunan: SUSUNAN_VARIABEL.TERURAI, sumber: SUMBER_SIM.SIMULASI };
    }
    return { nilai: dariUnit + (fee ?? 0), susunan: SUSUNAN_VARIABEL.TERURAI, sumber: SUMBER_SIM.SIMULASI };
  }

  return {
    nilai: baseline?.variabelPersen?.nilai ?? null,
    susunan: SUSUNAN_VARIABEL.BASELINE,
    sumber: baseline?.variabelPersen?.sumber ?? null
  };
}

/**
 * Satu simulasi lengkap untuk satu outlet.
 *
 * Dipakai untuk BASELINE maupun untuk SIMULASI — dengan sengaja. Lihat kepala
 * berkas: kalau keduanya lewat jalur berbeda, kolom Delta mengukur perbedaan
 * kode, bukan perbedaan asumsi.
 *
 * @param {{
 *   baseline: ReturnType<baselineSimulasi>,
 *   input?: {
 *     asp?: number|null, promoPersen?: number|null, feePersen?: number|null,
 *     hppSatuan?: number|null, kemasanSatuan?: number|null, variabelPersen?: number|null,
 *     fixedBulanan?: number|null, hariOperasional?: number|null, targetLaba?: number|null,
 *     mode?: 'revenue'|'unit', revenue?: number|null, units?: number|null
 *   },
 *   peran?: 'baseline'|'simulasi'
 * }} a
 */
export function simulasiOutlet({ baseline, input = {}, peran = 'simulasi' }) {
  const peringatan = [];
  const sebab = [];

  // --- Harga efektif: promo memotong harga, BUKAN menambah biaya.
  const aspDasar = angka(input.asp) ?? baseline?.asp?.nilai ?? null;
  const promo = angka(input.promoPersen) ?? 0;
  const promoSah = promo >= 0 && promo < 100;
  if (!promoSah) peringatan.push('Promo di luar 0–99% diabaikan — promo 100% berarti gratis, dan tidak ada omzet yang bisa dihitung darinya.');

  const aspEfektif = aspDasar == null ? null : promoSah ? aspDasar * (1 - promo / 100) : aspDasar;

  const fee = angka(input.feePersen) ?? 0;

  // --- Rasio biaya variabel
  const variabel = susunVariabel({
    variabelPersen: input.variabelPersen,
    hppSatuan: input.hppSatuan,
    kemasanSatuan: input.kemasanSatuan,
    feePersen: input.feePersen,
    aspEfektif,
    baseline,
    peringatan
  });

  const variabelPersen = variabel.nilai;
  const cmPersen = variabelPersen == null ? null : 100 - variabelPersen;
  const cmRasio = cmPersen == null ? null : cmPersen / 100;
  const cmSehat = cmRasio != null && cmRasio > 0;

  if (variabelPersen == null) {
    sebab.push('Biaya variabel belum bisa ditentukan — isi Variable Cost %, atau isi HPP beserta harga jualnya.');
  } else if (!cmSehat) {
    sebab.push(
      cmRasio === 0
        ? 'Contribution margin persis NOL — berapa pun yang terjual, biaya tetap tidak akan tertutup.'
        : 'Contribution margin NEGATIF — setiap porsi yang terjual menambah rugi. Tidak ada titik impas.'
    );
  }

  // --- Biaya tetap.
  //
  // Di sini nol diperlakukan sebagai angka yang sah, berbeda dengan Target 10A.
  // Alasannya: di layar ini kotaknya SELALU terlihat dan terisi, jadi nol yang
  // muncul adalah nol yang dilihat dan bisa langsung diubah — bukan kekosongan
  // yang ditafsirkan diam-diam.
  const fixedBaseline = baseline?.fixedBulanan?.nilai;
  const fixedInput = angka(input.fixedBulanan);
  const fixed = fixedInput != null ? fixedInput : (fixedBaseline ?? 0);
  if (fixedInput == null && fixedBaseline == null) {
    peringatan.push('Biaya tetap belum terdaftar di outlet ini dan belum diisi di sini, jadi dianggap Rp 0. Titik impas Rp 0 berarti "impas sebelum menjual apa pun" — isi angkanya supaya simulasinya bermakna.');
  }

  const hari = angka(input.hariOperasional);
  const bisaHarian = hari != null && hari > 0;
  if (!bisaHarian) peringatan.push('Hari operasional belum diisi, jadi angka harian belum bisa dihitung.');
  const perHari = (n) => (n == null || !bisaHarian ? null : n / hari);

  const bisaPorsi = aspEfektif != null && aspEfektif > 0;
  const keUnit = (n) => (n == null || !bisaPorsi ? null : n / aspEfektif);

  // --- VOLUME: mana yang ditentukan, mana yang dihitung.
  const mode = input.mode === MODE.UNIT ? MODE.UNIT : MODE.REVENUE;

  let revenue = null;
  let units = null;

  if (mode === MODE.UNIT) {
    const u = angka(input.units);
    if (u == null) {
      sebab.push('Mode porsi dipilih tapi jumlah porsinya belum diisi.');
    } else if (u < 0) {
      // Porsi negatif bukan "penjualan terbalik". Ia salah ketik, dan
      // meneruskannya menghasilkan omzet negatif yang terlihat seperti kerugian
      // besar padahal tidak ada apa-apa di baliknya.
      sebab.push('Jumlah porsi tidak boleh negatif.');
    } else if (!bisaPorsi) {
      sebab.push('Porsi tidak bisa diubah jadi omzet tanpa harga jual. Isi harga jual simulasi.');
    } else {
      units = u;
      revenue = u * aspEfektif;
    }
  } else {
    const r = angka(input.revenue);
    if (r == null) {
      // Bukan kesalahan: omzet boleh dikosongkan kalau yang dicari hanya BEP
      // dan target. Bagian profitabilitasnya saja yang kosong.
      peringatan.push('Omzet simulasi belum diisi, jadi laba simulasi belum dihitung. Titik impas dan target di bawah tetap berlaku.');
    } else if (r < 0) {
      sebab.push('Omzet tidak boleh negatif.');
    } else {
      revenue = r;
      units = keUnit(r);
      if (units == null) {
        peringatan.push('Omzet sudah diisi, tapi porsinya belum bisa dihitung karena harga jual belum ada.');
      }
    }
  }

  // --- Profitabilitas pada volume itu
  const variabelTotal = revenue == null || variabelPersen == null ? null : (revenue * variabelPersen) / 100;
  const cm = revenue == null || variabelTotal == null ? null : revenue - variabelTotal;
  const operatingProfit = cm == null ? null : cm - fixed;

  // --- Titik impas & target
  const bepRevenue = cmSehat ? fixed / cmRasio : null;
  const targetLaba = angka(input.targetLaba) ?? 0;
  const kebutuhanTarget = fixed + targetLaba;
  const bolehTarget = cmSehat && kebutuhanTarget >= 0;
  if (cmSehat && kebutuhanTarget < 0) {
    sebab.push('Target laba yang diisi lebih rugi daripada seluruh biaya tetapnya, jadi tidak ada omzet yang menjawabnya.');
  }
  const targetRevenue = bolehTarget ? kebutuhanTarget / cmRasio : null;

  const bepUnit = keUnit(bepRevenue);
  const targetUnit = keUnit(targetRevenue);

  if (!bisaPorsi && (bepRevenue != null || targetRevenue != null)) {
    peringatan.push('Harga jual belum ada, jadi omzetnya tetap berlaku tapi jumlah porsinya belum bisa dihitung.');
  }

  return {
    // Melekat pada hasil, bukan hanya di layar. Angka yang dioper ke unduhan
    // atau ke ringkasan akan tetap membawa keterangannya sendiri.
    konteks: 'simulated',
    peran,
    outletId: baseline?.outletId ?? null,
    outletName: baseline?.outletName ?? '',

    bisaDihitung: cmSehat,
    sebab: sebab.length ? sebab.join(' ') : null,

    ekonomi: {
      aspDasar,
      promoPersen: promoSah ? promo : 0,
      aspEfektif,
      feePersen: fee,
      hppSatuan: angka(input.hppSatuan),
      kemasanSatuan: angka(input.kemasanSatuan),
      variabelPersen,
      susunanVariabel: variabel.susunan,
      sumberVariabel: variabel.sumber,
      cmPersen,
      cmSatuan: aspEfektif == null || cmRasio == null ? null : aspEfektif * cmRasio,
      fixedBulanan: fixed,
      hariOperasional: hari,
      targetLaba
    },

    volume: {
      mode,
      revenue,
      units,
      variabelTotal,
      cm,
      cmPersenTerhitung: persen(cm, revenue),
      fixedBulanan: fixed,
      operatingProfit,
      operatingMargin: persen(operatingProfit, revenue)
    },

    bep: {
      revenueBulanan: bepRevenue,
      revenueHarian: perHari(bepRevenue),
      unitBulanan: bepUnit,
      unitHarian: perHari(bepUnit)
    },

    target: {
      revenueBulanan: targetRevenue,
      revenueHarian: perHari(targetRevenue),
      unitBulanan: targetUnit,
      unitHarian: perHari(targetUnit)
    },

    peringatan
  };
}

// =====================================================================
// PERBANDINGAN
// =====================================================================

/** Satu baris tabel banding. Arah "baik"-nya dinyatakan, bukan ditebak layar. */
function baris(label, satuan, dasar, sim, { naikBaik = true } = {}) {
  const a = angka(dasar);
  const b = angka(sim);
  return {
    label,
    satuan,
    baseline: a,
    simulasi: b,
    delta: a == null || b == null ? null : b - a,
    deltaPersen: a == null || b == null || a === 0 ? null : ((b - a) / Math.abs(a)) * 100,
    naikBaik
  };
}

/**
 * Baseline vs simulasi, selisihnya, dan ARAH selisihnya.
 *
 * `delta` selalu `simulasi − baseline`. Arah "lebih baik" tidak sama untuk semua
 * baris — BEP yang TURUN itu kabar baik, laba yang turun itu bukan — jadi tiap
 * baris membawa `naikBaik` sendiri. Layar yang mewarnai semuanya dengan satu
 * aturan akan menghijaukan BEP yang membengkak.
 */
export function bandingkan({ baseline, simulasi }) {
  const b = baseline;
  const s = simulasi;

  return {
    konteks: 'simulated',
    outletId: s?.outletId ?? null,
    outletName: s?.outletName ?? '',
    baris: [
      baris('Harga jual efektif', 'rp', b?.ekonomi.aspEfektif, s?.ekonomi.aspEfektif),
      baris('Variable Cost %', 'pp', b?.ekonomi.variabelPersen, s?.ekonomi.variabelPersen, { naikBaik: false }),
      baris('Contribution Margin %', 'pp', b?.ekonomi.cmPersen, s?.ekonomi.cmPersen),
      baris('Biaya tetap / bulan', 'rp', b?.ekonomi.fixedBulanan, s?.ekonomi.fixedBulanan, { naikBaik: false }),
      baris('BEP Omzet / bulan', 'rp', b?.bep.revenueBulanan, s?.bep.revenueBulanan, { naikBaik: false }),
      baris('BEP Porsi / bulan', 'unit', b?.bep.unitBulanan, s?.bep.unitBulanan, { naikBaik: false }),
      baris('BEP Porsi / hari', 'unit', b?.bep.unitHarian, s?.bep.unitHarian, { naikBaik: false }),
      baris('Target Omzet / bulan', 'rp', b?.target.revenueBulanan, s?.target.revenueBulanan, { naikBaik: false }),
      baris('Target Porsi / bulan', 'unit', b?.target.unitBulanan, s?.target.unitBulanan, { naikBaik: false }),
      baris('Target Porsi / hari', 'unit', b?.target.unitHarian, s?.target.unitHarian, { naikBaik: false }),
      baris('Omzet simulasi', 'rp', b?.volume.revenue, s?.volume.revenue),
      baris('Porsi simulasi', 'unit', b?.volume.units, s?.volume.units),
      baris('Operating Profit', 'rp', b?.volume.operatingProfit, s?.volume.operatingProfit),
      baris('Operating Margin', 'pp', b?.volume.operatingMargin, s?.volume.operatingMargin)
    ],
    catatan: 'Delta = simulasi − baseline. Keduanya dihitung fungsi yang sama, jadi selisihnya murni akibat asumsi yang diubah — bukan akibat cara menghitungnya berbeda.'
  };
}

// =====================================================================
// BANYAK OUTLET
// =====================================================================

/**
 * Daftar simulasi beberapa outlet.
 *
 * TIDAK ada BEP gabungan, dan alasannya sama seperti di Actual dan Target: satu
 * BEP dari biaya tetap total dibagi CM rata-rata menyembunyikan outlet bermargin
 * tipis di balik yang tebal, dan arah kesalahannya tidak bisa ditebak.
 *
 * Yang dijumlahkan hanya omzet, porsi, dan laba — besaran yang penjumlahannya
 * memang bermakna.
 */
export function ringkasSimulasi(daftar) {
  const semua = (daftar ?? []).filter(Boolean);
  const bisa = semua.filter((s) => s.bisaDihitung);

  const jumlah = (ambil) => {
    const nilai = bisa.map((s) => angka(ambil(s))).filter((n) => n != null);
    return nilai.length ? nilai.reduce((a, b) => a + b, 0) : null;
  };

  const revenue = jumlah((s) => s.volume.revenue);
  const laba = jumlah((s) => s.volume.operatingProfit);

  return {
    konteks: 'simulated',
    label: 'SUM OF OUTLET SIMULATIONS',
    bepGabungan: false,
    jumlahOutlet: semua.length,
    jumlahDihitung: bisa.length,
    tidakBisaDihitung: semua.filter((s) => !s.bisaDihitung).map((s) => ({ outletId: s.outletId, outletName: s.outletName, sebab: s.sebab })),

    revenue,
    units: jumlah((s) => s.volume.units),
    operatingProfit: laba,
    operatingMargin: persen(laba, revenue),

    catatan:
      'Penjumlahan simulasi tiap outlet. TIDAK ada satu BEP gabungan — biaya tetap total dibagi CM rata-rata akan menyembunyikan outlet bermargin tipis di balik yang tebal.'
  };
}
