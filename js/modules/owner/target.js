/**
 * TARGET / PLANNING — berapa yang HARUS dicapai, bukan berapa yang terjadi.
 *
 * ============ TIGA KATA YANG BERBEDA DAN SERING TERTUKAR ============
 *
 *   ACTUAL     apa yang sudah terjadi        (profit-outlet.js)
 *   PROJECTED  perkiraan akhir periode       (proyeksi.js)
 *   TARGET     apa yang harus dicapai        (berkas ini)
 *
 * Ketiganya angka omzet dalam rupiah, ketiganya untuk outlet yang sama, dan
 * ketiganya akan disebut "omzet" oleh orang yang berbeda. Satu-satunya yang
 * membedakan adalah labelnya — maka setiap hasil di sini membawa
 * `konteks: 'target'` sampai ke dalam objeknya, bukan hanya di layar.
 *
 * Kegagalan yang dicegah bukan hipotetis: "omzet Rp116 juta" yang dibaca sebagai
 * pencapaian padahal ia tuntutan, atau proyeksi Rp124 juta yang dibaca sebagai
 * target yang sudah aman. Keduanya menghasilkan keputusan yang berlawanan dengan
 * keadaan sebenarnya.
 *
 * ============ TIDAK MENULIS APA PUN ============
 *
 * Berkas ini murni: tanpa jaringan, tanpa penyimpanan, dan satu-satunya
 * impornya adalah pemisah biaya milik mesin Actual. Ia tidak menyentuh `sales`,
 * `outlet_costs`, maupun `outlet_menu_prices`. Asumsi
 * perencanaan yang diketik pengguna hidup di memori layar saja dan hilang
 * bersama layarnya — itu disengaja. Asumsi yang tersimpan diam-diam akan
 * dipakai bulan depan oleh orang yang tidak tahu siapa yang mengetiknya.
 *
 * ============ EKONOMINYA DIPINJAM, BUKAN DIHITUNG ULANG ============
 *
 * `hitungTarget()` menerima objek hasil `hitungActualOutlet()`. Rasio biaya
 * variabel, biaya tetap bulanan, dan ASP semuanya diambil dari sana.
 *
 * Alasannya sama dengan di `proyeksi.js`: mesin HPP kedua akan menyimpang dari
 * yang pertama begitu salah satunya diubah, dan yang muncul adalah dua BEP
 * berbeda tipis untuk outlet yang sama — sama-sama masuk akal, tanpa cara
 * menentukan mana yang benar.
 *
 * ============ BIAYA TETAP DIPAKAI PENUH SEBULAN ============
 *
 * Ini perbedaan penting dengan layar Actual. `outlet_costs` bersatuan
 * `per_bulan`, dan `hitungActualOutlet()` menjumlahkannya apa adanya — jadi
 * angka yang sama juga BENAR sebagai biaya tetap bulanan untuk perencanaan.
 *
 * Target memang HARUS memakai sebulan penuh: pertanyaannya "berapa yang harus
 * dicapai bulan ini", bukan "berapa yang harus dicapai sampai tanggal 20".
 * Memprorata biaya tetap menurut tanggal laporan menghasilkan target yang naik
 * setiap hari — dan target yang berubah sendiri bukan target.
 */

// Pemisah biaya dipinjam dari mesin Actual, TIDAK ditulis ulang. Menulis ulang
// aturan `direct_outlet` / `shared_bu` / `corporate` di sini berarti dua tempat
// yang harus diubah bersamaan setiap kali cakupan biaya bertambah — dan yang
// terlupakan tidak akan menghasilkan error, hanya target yang terlalu ringan.
import { biayaCakupanLuas } from './profit-outlet.js';

/** Angka, atau `null`. Jenisnya diperiksa lebih dulu. Alasannya di `pricing.js`. */
const angka = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

export const SUMBER = {
  AKTUAL: 'actual',
  ASUMSI: 'planning'
};

/**
 * Kenapa target belum bisa dihitung — dan APA yang harus diisi.
 *
 * "Belum bisa dihitung" tanpa menyebut yang mana adalah jalan buntu: pengguna
 * melihat deretan kotak isian dan tidak tahu mana yang menahan. Layar memakai
 * status ini untuk membuka kotak yang tepat dan menyorotnya.
 */
export const STATUS_HITUNG = {
  BISA: 'TARGET BISA DIHITUNG',
  LENGKAPI_VARIABEL: 'LENGKAPI VARIABLE COST %',
  LENGKAPI_FIXED: 'FIXED COST BELUM TERSEDIA',
  TIDAK_BISA: 'NOT_CALCULABLE'
};

export const STATUS_TARGET = {
  TERCAPAI: 'MENCAPAI TARGET',
  MENDEKATI: 'MENDEKATI TARGET',
  BELUM: 'BELUM MENCAPAI',
  TIDAK_BISA: 'NOT_CALCULABLE'
};

/** Ambang "mendekati". 90% bukan angka ajaib — ia sekadar dinyatakan, bukan disembunyikan. */
export const AMBANG_MENDEKATI = 90;

/** Berapa hari outlet buka dalam sebulan kalau tidak disetel. */
export const HARI_OPERASIONAL_BAKU = 30;

// =====================================================================
// EKONOMI YANG DIPAKAI TARGET — beserta ASAL-USUL tiap angkanya
// =====================================================================

/**
 * Kumpulkan tiga besaran yang menentukan seluruh target, lengkap dengan
 * sumbernya.
 *
 * Sumber dibawa serta, bukan disimpulkan belakangan oleh layar. Angka Rp50.000
 * yang datang dari transaksi nyata dan angka Rp50.000 yang diketik seseorang
 * sebagai asumsi terlihat persis sama — dan keputusan yang dibangun di atas
 * keduanya sangat berbeda bobotnya.
 *
 * @param {{actual: object, asumsi?: {asp?: number|null, fixedBulanan?: number|null, variabelPersen?: number|null}}} a
 */
export function ekonomiTarget({ actual, asumsi = {} }) {
  const aspAktual = angka(actual?.asp);
  const aspAsumsi = angka(asumsi.asp);

  const fixedAktual = angka(actual?.fixedLangsung) ?? 0;
  const fixedAsumsi = angka(asumsi.fixedBulanan);

  // "BELUM ADA BIAYA TETAP" TIDAK SAMA DENGAN "BIAYA TETAPNYA NOL".
  //
  // `hitungActualOutlet()` menjumlahkan baris `outlet_costs`; kalau tidak ada
  // satu pun baris, hasilnya 0 — angka yang sah secara aritmetika dan
  // menyesatkan secara total. BEP Rp 0 berarti "outlet ini sudah impas sebelum
  // menjual apa pun", yaitu kesimpulan terbaik yang bisa dibayangkan, diberikan
  // justru kepada outlet yang datanya paling kosong.
  //
  // Dibedakan lewat ADA-TIDAKNYA baris biaya, bukan lewat nilainya. Kalau
  // biaya tetapnya memang benar-benar nol, itu dinyatakan dengan mengisi asumsi
  // perencanaan 0 — pernyataan yang disengaja, bukan kekosongan yang ditafsirkan.
  const adaBarisFixed = (actual?.rincianFixed ?? []).length > 0;
  const fixedTersedia = fixedAsumsi != null || adaBarisFixed;

  // Rasio biaya variabel diambil dari CM% aktual, bukan dihitung ulang dari
  // komponennya. CM% itu sudah memuat HPP, kemasan, biaya per porsi, dan persen
  // omzet persis seperti layar Actual menghitungnya.
  const cmPersenAktual = angka(actual?.cmPersen);
  const variabelPersenAktual = cmPersenAktual == null ? null : 100 - cmPersenAktual;
  const variabelPersenAsumsi = angka(asumsi.variabelPersen);

  const variabelPersen = variabelPersenAsumsi != null ? variabelPersenAsumsi : variabelPersenAktual;
  const cmPersen = variabelPersen == null ? null : 100 - variabelPersen;

  return {
    asp: {
      nilai: aspAsumsi != null ? aspAsumsi : aspAktual,
      sumber: aspAsumsi != null ? SUMBER.ASUMSI : SUMBER.AKTUAL,
      nilaiAktual: aspAktual,
      // Dikatakan apa adanya: kalau belum ada transaksi, satu-satunya ASP yang
      // ada adalah tebakan seseorang.
      catatan:
        aspAsumsi != null
          ? 'Asumsi perencanaan — diketik pengguna, tidak mengubah harga jual mana pun.'
          : aspAktual == null
            ? 'Belum ada transaksi, jadi harga rata-rata belum bisa dihitung. Isi ASP perencanaan untuk mendapat target porsi.'
            : 'Rata-rata tertimbang dari transaksi outlet ini (Σ omzet ÷ Σ porsi).'
    },

    fixedBulanan: {
      nilai: fixedTersedia ? (fixedAsumsi != null ? fixedAsumsi : fixedAktual) : null,
      tersedia: fixedTersedia,
      sumber: fixedAsumsi != null ? SUMBER.ASUMSI : SUMBER.AKTUAL,
      nilaiAktual: adaBarisFixed ? fixedAktual : null,
      rincian: actual?.rincianFixed ?? [],
      catatan:
        fixedAsumsi != null
          ? 'Asumsi perencanaan — tidak mengubah `outlet_costs`.'
          : adaBarisFixed
            ? 'Biaya tetap langsung outlet ini per BULAN PENUH, dari daftar biaya. Biaya bersama BU & korporat tidak termasuk.'
            : 'Outlet ini belum punya satu pun biaya tetap langsung yang terdaftar. Belum ada biaya BUKAN berarti biayanya nol.'
    },

    cmPersen: {
      nilai: cmPersen,
      variabelPersen,
      sumber: variabelPersenAsumsi != null ? SUMBER.ASUMSI : SUMBER.AKTUAL,
      nilaiAktual: cmPersenAktual,
      catatan:
        variabelPersenAsumsi != null
          ? 'Asumsi perencanaan — dipakai hanya untuk menghitung target.'
          : cmPersenAktual == null
            ? 'Belum ada transaksi, jadi rasio biaya variabel belum bisa dihitung. Isi Variable Cost % perencanaan.'
            : 'Dari ekonomi aktual outlet ini — HPP, kemasan, biaya per porsi, dan persen omzet, persis seperti layar Profitabilitas menghitungnya.'
    },

    // Benar kalau ADA satu saja asumsi yang menimpa angka aktual.
    adaAsumsi: aspAsumsi != null || fixedAsumsi != null || variabelPersenAsumsi != null
  };
}

// =====================================================================
// TARGET SATU OUTLET
// =====================================================================

/**
 * BEP dan target laba satu outlet.
 *
 * BEP di sini BUKAN cabang tersendiri — ia target dengan laba nol. Menuliskannya
 * dua kali berarti dua rumus yang bisa menyimpang, dan penyimpangan sekecil
 * apa pun akan tampak sebagai "BEP ≠ target laba 0" yang mustahil dijelaskan.
 *
 * @param {{
 *   actual: object,
 *   targetLabaBulanan?: number,
 *   hariOperasional?: number,
 *   asumsi?: {asp?: number|null, fixedBulanan?: number|null, variabelPersen?: number|null}
 * }} a
 */
export function hitungTarget({ actual, targetLabaBulanan = 0, hariOperasional = HARI_OPERASIONAL_BAKU, asumsi = {} }) {
  const ek = ekonomiTarget({ actual, asumsi });

  const hari = angka(hariOperasional);
  const laba = angka(targetLabaBulanan) ?? 0;
  const cmPersen = ek.cmPersen.nilai;
  const fixed = ek.fixedBulanan.nilai;
  const asp = ek.asp.nilai;

  const peringatan = [];
  const sebab = [];

  // --- CM ≤ 0: tidak ada target yang bisa dihitung.
  //
  // Membagi biaya tetap dengan CM negatif menghasilkan omzet target NEGATIF, dan
  // angka negatif terbaca seolah targetnya sudah terlampaui — kebalikan persis
  // dari keadaannya. CM nol menghasilkan pembagian dengan nol.
  const cmRasio = cmPersen == null ? null : cmPersen / 100;
  const cmSehat = cmRasio != null && cmRasio > 0;

  // Dua kekurangan yang berbeda, dan pesannya harus berbeda pula.
  //
  // "Belum bisa dihitung" tanpa menyebut YANG MANA yang kurang adalah jalan
  // buntu: pengguna melihat kotak-kotak isian dan tidak tahu mana yang menahan.
  // Itu persis yang terjadi pada AB Sentul — targetnya menolak dihitung, dan
  // tidak ada satu pun petunjuk bahwa Variable Cost % yang belum ada.
  let status;
  if (!ek.fixedBulanan.tersedia) {
    status = STATUS_HITUNG.LENGKAPI_FIXED;
    sebab.push(
      'FIXED COST BELUM TERSEDIA — outlet ini belum punya biaya tetap langsung yang terdaftar. Isi di Admin Portal → Biaya Outlet, atau isi asumsi perencanaan di bawah. Belum ada biaya BUKAN berarti biayanya nol.'
    );
  } else if (cmRasio == null) {
    status = STATUS_HITUNG.LENGKAPI_VARIABEL;
    sebab.push(
      'LENGKAPI VARIABLE COST % — outlet ini belum punya transaksi, jadi rasio biaya variabelnya belum bisa dihitung sendiri. Isi Variable Cost % perencanaan di bawah dan target langsung muncul.'
    );
  } else if (cmRasio <= 0) {
    status = STATUS_HITUNG.TIDAK_BISA;
    sebab.push(
      cmRasio === 0
        ? 'Contribution margin persis NOL — berapa pun yang terjual, biaya tetap tidak akan tertutup. Tidak ada target yang bisa dicapai tanpa mengubah harga atau biaya.'
        : 'Contribution margin NEGATIF — setiap porsi yang terjual menambah rugi. Tidak ada omzet yang bisa membuat outlet ini impas.'
    );
  } else {
    status = STATUS_HITUNG.BISA;
  }

  const bisaHitung = status === STATUS_HITUNG.BISA;

  // --- Laba target yang membuat kebutuhan omzet jadi negatif ditolak.
  //
  // Ini hanya terjadi kalau seseorang mengetik target laba negatif yang lebih
  // besar daripada biaya tetapnya — artinya "rugi sebesar ini pun tidak apa".
  // Omzet negatif bukan jawaban untuk itu; jawabannya "pertanyaannya keliru".
  const kebutuhanBep = bisaHitung ? fixed : null;
  const kebutuhanTarget = bisaHitung ? fixed + laba : null;
  if (bisaHitung && kebutuhanTarget < 0) {
    sebab.push('Target laba yang diisi lebih rugi daripada seluruh biaya tetap outlet ini, jadi tidak ada omzet yang menjawabnya.');
  }

  const bolehTarget = bisaHitung && kebutuhanTarget >= 0;

  const bepRevenue = bisaHitung ? kebutuhanBep / cmRasio : null;
  const targetRevenue = bolehTarget ? kebutuhanTarget / cmRasio : null;

  // --- Harian. Hari operasional nol/kosong -> null, bukan pembagian diam-diam
  // dengan 30. Outlet yang buka 26 hari punya beban harian yang berbeda nyata.
  const bisaHarian = hari != null && hari > 0;
  if (!bisaHarian) peringatan.push('Hari operasional belum diisi, jadi target harian belum bisa dihitung.');

  const perHari = (n) => (n == null || !bisaHarian ? null : n / hari);

  // --- Porsi. Butuh ASP; tanpa ASP omzetnya tetap sah, porsinya yang tidak ada.
  const bisaPorsi = asp != null && asp > 0;
  if (!bisaPorsi && (bepRevenue != null || targetRevenue != null)) {
    peringatan.push('Harga jual rata-rata belum ada, jadi target OMZET tetap berlaku tapi target PORSI belum bisa dihitung.');
  }

  const keUnit = (n) => (n == null || !bisaPorsi ? null : n / asp);

  if (ek.adaAsumsi) {
    peringatan.push('Sebagian angka di bawah memakai ASUMSI PERENCANAAN, bukan ekonomi aktual. Asumsi ini tidak tersimpan dan tidak mengubah data mana pun.');
  }
  if (bisaHitung && (angka(actual?.revenue) ?? 0) === 0 && !ek.adaAsumsi) {
    peringatan.push('Belum ada transaksi pada rentang ini — ekonominya diambil dari data yang masih kosong.');
  }

  const bepUnit = keUnit(bepRevenue);
  const targetUnit = keUnit(targetRevenue);

  return {
    konteks: 'target',
    outletId: actual?.outletId ?? null,
    outletName: actual?.outletName ?? '',

    bisaDihitung: bisaHitung,
    // Yang KURANG, bukan sekadar "tidak bisa". Layar memakainya untuk membuka
    // kotak isian yang tepat, bukan menyuruh pengguna menebak.
    status,
    // Target OMZET berlaku walau ASP belum ada — hanya target PORSI yang tidak.
    // Dipisahkan supaya layar tidak mengosongkan seluruh kartu hanya karena
    // harga rata-ratanya belum diketahui.
    bisaPorsi,
    sebab: sebab.length ? sebab.join(' ') : null,

    // Masukan, dibawa serta supaya hasilnya bisa ditelusuri ulang tanpa menebak
    // apa yang sedang disetel di layar saat angkanya dibuat.
    masukan: {
      targetLabaBulanan: laba,
      hariOperasional: hari,
      ekonomi: ek
    },

    // Titik impas = target dengan laba nol. Rumusnya satu, dipakai dua kali.
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

    // Langkah demi langkah, dengan angka antaranya. Layar menampilkannya apa
    // adanya — target yang tidak bisa diperiksa ulang akan dipercaya bulat-bulat
    // atau ditolak bulat-bulat.
    rincian: {
      fixedBulanan: fixed,
      variabelPersen: ek.cmPersen.variabelPersen,
      cmPersen,
      cmRasio,
      asp,
      hariOperasional: hari,
      targetLabaBulanan: laba,
      kebutuhanBep,
      kebutuhanTarget: bolehTarget ? kebutuhanTarget : null
    },

    peringatan
  };
}

// =====================================================================
// PERBANDINGAN DENGAN AKTUAL — monitoring, bukan bagian dari perencanaan
// =====================================================================

/**
 * Seberapa jauh omzet aktual dari targetnya.
 *
 * Ini SATU-SATUNYA tempat di berkas ini yang menyentuh angka aktual sebagai
 * pembanding, dan hasilnya sengaja dinamai `pencapaian` — bukan dimasukkan ke
 * dalam objek target itu sendiri. Target tetap perencanaan; ini pengawasan.
 */
export function pencapaianTarget({ revenueActual, targetRevenue }) {
  const a = angka(revenueActual);
  const t = angka(targetRevenue);

  if (t == null || t <= 0 || a == null) {
    return { gap: null, persen: null, status: STATUS_TARGET.TIDAK_BISA };
  }

  const persen = (a / t) * 100;
  const status =
    persen >= 100 ? STATUS_TARGET.TERCAPAI : persen >= AMBANG_MENDEKATI ? STATUS_TARGET.MENDEKATI : STATUS_TARGET.BELUM;

  return { gap: a - t, persen, status };
}

// =====================================================================
// KONSOLIDASI — PENJUMLAHAN TARGET OUTLET, BUKAN SATU BEP GABUNGAN
// =====================================================================

/**
 * Jumlahkan target tiap outlet.
 *
 * Yang SENGAJA tidak dilakukan: menjumlahkan biaya tetap seluruh outlet lalu
 * membaginya dengan CM% rata-rata tertimbang. Hasilnya berbeda dari penjumlahan
 * ini setiap kali ekonomi outletnya berbeda.
 *
 * Dan yang membuatnya berbahaya bukan besarnya selisih, melainkan ARAHNYA yang
 * tidak bisa ditebak — bergantung pada apakah outlet bermargin tipis kebetulan
 * juga yang biaya tetapnya besar. Dua outlet yang mirip menghasilkan selisih
 * kecil ke arah "lebih berat"; satu outlet tebal-murah bersama satu outlet
 * tipis-mahal menghasilkan gabungan yang KURANG DARI SEPARUH penjumlahan
 * sebenarnya. Bias yang konsisten masih bisa dikoreksi; bias yang berubah arah
 * tidak bisa.
 *
 * Namanya pun dijaga: `SUM OF OUTLET TARGETS`, bukan "BEP BU".
 */
export function konsolidasiTarget(daftarTarget) {
  const semua = (daftarTarget ?? []).filter(Boolean);
  const bisa = semua.filter((t) => t.bisaDihitung);
  const tidakBisa = semua.filter((t) => !t.bisaDihitung);

  // Outlet yang targetnya tidak bisa dihitung TIDAK dianggap nol. Nol di sini
  // berarti "outlet ini tidak perlu menghasilkan apa-apa untuk impas", yaitu
  // pernyataan yang justru terbalik dari keadaannya.
  const jumlah = (ambil) => {
    const nilai = bisa.map((t) => angka(ambil(t))).filter((n) => n != null);
    return nilai.length ? nilai.reduce((a, b) => a + b, 0) : null;
  };

  return {
    konteks: 'target',
    label: 'SUM OF OUTLET TARGETS',
    // Ditegaskan di dalam datanya, bukan hanya di layar: ini bukan BEP tunggal.
    bepGabungan: false,
    catatan:
      'Penjumlahan target masing-masing outlet. BUKAN satu BEP gabungan — biaya tetap total dibagi CM rata-rata akan menyembunyikan outlet bermargin tipis di balik yang tebal.',

    outlets: semua,
    jumlahOutlet: semua.length,
    jumlahDihitung: bisa.length,
    tidakBisaDihitung: tidakBisa.map((t) => ({ outletId: t.outletId, outletName: t.outletName, sebab: t.sebab })),

    bep: {
      revenueBulanan: jumlah((t) => t.bep.revenueBulanan),
      revenueHarian: jumlah((t) => t.bep.revenueHarian),
      unitBulanan: jumlah((t) => t.bep.unitBulanan),
      unitHarian: jumlah((t) => t.bep.unitHarian)
    },
    target: {
      revenueBulanan: jumlah((t) => t.target.revenueBulanan),
      revenueHarian: jumlah((t) => t.target.revenueHarian),
      unitBulanan: jumlah((t) => t.target.unitBulanan),
      unitHarian: jumlah((t) => t.target.unitHarian)
    },
    targetLabaBulanan: jumlah((t) => t.masukan.targetLabaBulanan)
  };
}

// =====================================================================
// RINGKASAN BU
// =====================================================================

/**
 * Biaya bersama & korporat: ditampilkan TERPISAH, tidak dialokasikan.
 *
 * Satu angka di sini penting dan mudah terlewat: kalau SETIAP outlet persis
 * mencapai targetnya, BU masih rugi sebesar biaya bersamanya. Target outlet
 * hanya menutup biaya outlet — dan tanpa angka itu tertulis, "semua outlet
 * hijau" akan dibaca sebagai "BU untung".
 */
export function ringkasBuTarget({ konsolidasi, biaya = [] }) {
  const shared = biayaCakupanLuas(biaya, 'shared_bu');
  const corporate = biayaCakupanLuas(biaya, 'corporate');

  const labaOutlet = angka(konsolidasi?.targetLabaBulanan);
  const labaBuJikaTercapai = labaOutlet == null ? null : labaOutlet - shared.total;

  return {
    konteks: 'target',
    bepRevenueBulanan: konsolidasi?.bep?.revenueBulanan ?? null,
    targetRevenueBulanan: konsolidasi?.target?.revenueBulanan ?? null,

    sharedBu: shared.total,
    rincianShared: shared.rincian,
    corporate: corporate.total,
    rincianCorporate: corporate.rincian,

    // Laba BU seandainya setiap outlet PERSIS mencapai targetnya.
    targetLabaSeluruhOutlet: labaOutlet,
    labaBuJikaTercapai,

    catatan:
      'Biaya bersama BU dan korporat TIDAK dimasukkan ke target outlet mana pun. Target tiap outlet hanya menutup biaya tetap langsungnya sendiri — jadi seluruh outlet mencapai target belum tentu berarti BU untung.'
  };
}
