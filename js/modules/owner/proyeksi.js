import { hitungBepOutlet, gapKeBep, biayaCakupanLuas, STATUS_BEP } from './profit-outlet.js';

/**
 * PROYEKSI AKHIR PERIODE — estimasi, bukan kenyataan.
 *
 * ============ MASUKANNYA HASIL ACTUAL, BUKAN DATA MENTAH ============
 *
 * `proyeksiOutlet()` menerima objek keluaran `hitungActualOutlet()` — bukan
 * `sales`, bukan `products`, bukan `outlet_costs`.
 *
 * Itu bukan sekadar kerapian. Kalau proyeksi membaca data mentah, ia akan punya
 * definisi sendiri tentang "biaya variabel" dan "biaya tetap", dan definisi itu
 * akan menyimpang dari Actual begitu salah satunya diubah. Dua angka yang
 * berbeda tipis di dua tab, sama-sama masuk akal, tanpa cara menentukan mana
 * yang benar — kegagalan yang persis sama dengan yang sudah dicegah di 8B.
 *
 * Dengan menerima hasil actual, ekonominya TIDAK MUNGKIN berbeda: proyeksi
 * hanya mengalikan apa yang sudah dihitung.
 *
 * ============ BIAYA TETAP TIDAK DISKALAKAN ============
 *
 * `outlet_costs` bersatuan `per_bulan`, dan `hitungActualOutlet()`
 * menjumlahkannya APA ADANYA — tidak dipotong menurut rentang tanggal yang
 * sedang dilihat.
 *
 * Akibatnya, yang perlu diketahui dan TIDAK disembunyikan: melihat 1–20 Agustus
 * membebankan sewa SEBULAN PENUH pada omzet 20 hari. Operating Profit di tengah
 * bulan karena itu tampak lebih buruk daripada kenyataannya, dan membaik dengan
 * sendirinya menjelang akhir bulan.
 *
 * Untuk proyeksi, perlakuan yang benar justru sederhana: biaya tetap TIDAK
 * ikut dikalikan. Sewa tidak bertambah karena penjualan bertambah. Jadi
 * proyeksi memakai angka bulanan yang sama, dan selisih antara Actual OP dan
 * Projected OP di tengah bulan sebagian besar berasal dari sini — bukan dari
 * perbaikan kinerja. Layar mengatakannya.
 *
 * ============ LINEAR, DAN ITU DISEBUTKAN ============
 *
 * Metodenya run-rate lurus: rata-rata harian dikalikan sisa hari. Ia
 * mengasumsikan sisa bulan sama dengan yang sudah lewat — dan itu SALAH untuk
 * usaha yang ramai di akhir pekan bila periodenya baru berjalan di hari kerja.
 *
 * Asumsi itu tidak bisa dihilangkan tanpa data musiman yang belum ada. Yang
 * bisa dilakukan: menyebutkannya, menampilkan angka antaranya supaya bisa
 * diperiksa sendiri, dan memberi peringatan saat datanya masih terlalu sedikit.
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

const HARI_MS = 86400000;

/** `YYYY-MM-DD` -> epoch UTC. Null kalau bukan tanggal yang sah. */
function tanggal(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const t = Date.parse(`${s}T00:00:00Z`);
  return Number.isFinite(t) ? t : null;
}

/**
 * Hitung hari periode, hari berjalan, dan sisa hari.
 *
 * Semuanya dihitung di UTC dari string `YYYY-MM-DD`. Memakai `new Date()` lokal
 * akan menggeser hasilnya satu hari di zona waktu tertentu — dan pergeseran
 * satu hari pada penyebut run-rate menggeser seluruh proyeksi tanpa terlihat.
 *
 * @param {{dari: string, sampai: string, hariIni?: string}} a
 */
export function hitungHari({ dari, sampai, hariIni }) {
  const d = tanggal(dari);
  const s = tanggal(sampai);
  const kini = tanggal(hariIni ?? new Date().toISOString().slice(0, 10));

  const kosong = { hariPeriode: null, hariBerjalan: null, sisaHari: null, actualSampai: null };

  if (d == null || s == null || kini == null) return { ...kosong, sebab: 'Tanggal periodenya belum lengkap.' };
  if (s < d) return { ...kosong, sebab: 'Tanggal akhir lebih awal daripada tanggal mulai.' };

  const hariPeriode = Math.round((s - d) / HARI_MS) + 1;

  // Actual berhenti di hari ini ATAU di akhir periode — mana yang lebih dulu.
  // Kalau periodenya sudah lewat, seluruh hari sudah berjalan dan proyeksinya
  // sama dengan actual. Itu bukan kasus khusus yang perlu cabang tersendiri;
  // `sisaHari` cukup jadi 0 dan rumusnya tetap benar.
  const efektif = Math.min(kini, s);

  // Periode belum mulai: tidak ada hari berjalan sama sekali.
  const hariBerjalan = efektif < d ? 0 : Math.round((efektif - d) / HARI_MS) + 1;
  const sisaHari = Math.max(0, hariPeriode - hariBerjalan);

  return {
    hariPeriode,
    hariBerjalan,
    sisaHari,
    actualSampai: efektif < d ? null : new Date(efektif).toISOString().slice(0, 10),
    sebab: null
  };
}

/** Bentuk hasil kosong — tetap membawa konteks & sebab, tidak pernah angka palsu. */
function proyeksiKosong({ outlet, hari, sebab }) {
  return {
    konteks: 'projected',
    outletId: outlet?.outletId ?? null,
    outletName: outlet?.outletName ?? '',
    bisaDiproyeksi: false,
    sebab,
    hari,
    revenue: null,
    units: null,
    variabel: null,
    cm: null,
    cmPersen: null,
    fixedLangsung: angka(outlet?.fixedLangsung) ?? 0,
    operatingProfit: null,
    operatingMargin: null,
    bep: { revenue: null, unit: null, sebab },
    gap: { nilai: null, persen: null, status: STATUS_BEP.TIDAK_BISA },
    rincian: null,
    peringatan: []
  };
}

/**
 * Proyeksi satu outlet.
 *
 * @param {{actual: object, hari: ReturnType<hitungHari>}} a
 */
export function proyeksiOutlet({ actual, hari }) {
  if (!actual) return proyeksiKosong({ outlet: null, hari, sebab: 'Tidak ada data aktual outlet ini.' });
  if (hari?.sebab) return proyeksiKosong({ outlet: actual, hari, sebab: hari.sebab });

  const berjalan = angka(hari?.hariBerjalan);
  const sisa = angka(hari?.sisaHari) ?? 0;

  // BELUM ADA HARI BERJALAN -> tidak ada run-rate.
  //
  // Mengembalikan Rp 0 di sini akan terbaca sebagai "diproyeksi nol", yaitu
  // pernyataan yang jauh lebih kuat daripada "belum bisa diproyeksi".
  if (berjalan == null || berjalan <= 0) {
    return proyeksiKosong({ outlet: actual, hari, sebab: 'Periode ini belum berjalan, jadi belum ada laju harian untuk diproyeksikan.' });
  }

  const revenueActual = angka(actual.revenue) ?? 0;
  const unitsActual = angka(actual.units) ?? 0;

  if (revenueActual === 0 && unitsActual === 0) {
    return proyeksiKosong({ outlet: actual, hari, sebab: 'Belum ada penjualan tercatat, jadi belum ada yang bisa diproyeksikan.' });
  }

  // --- Revenue: actual + (laju harian x sisa hari)
  const lajuRevenue = revenueActual / berjalan;
  const revenueSisa = lajuRevenue * sisa;
  const revenue = revenueActual + revenueSisa;

  const lajuUnits = unitsActual / berjalan;
  const units = unitsActual + lajuUnits * sisa;

  // --- Variabel: MENGIKUTI RASIO AKTUAL, bukan rumus baru.
  //
  // Rasio ini sudah memuat HPP, kemasan, biaya per porsi, dan persen omzet
  // persis seperti Actual menghitungnya. Menyusun ulang komponennya di sini
  // akan membuat definisi kedua yang bisa menyimpang.
  const variabelActual = angka(actual.variabel?.total);
  const rasioVariabel = revenueActual > 0 && variabelActual != null ? variabelActual / revenueActual : null;
  const variabel = rasioVariabel == null ? null : revenue * rasioVariabel;

  const cm = variabel == null ? null : revenue - variabel;

  // --- Tetap: TIDAK diskalakan. Sewa tidak bertambah karena omzet bertambah.
  const fixedLangsung = angka(actual.fixedLangsung) ?? 0;

  const operatingProfit = cm == null ? null : cm - fixedLangsung;

  const bep = hitungBepOutlet({ cm, revenue, units, fixedLangsung });
  const gap = gapKeBep({ revenue, bepRevenue: bep.revenue });

  const peringatan = [];
  if (berjalan < 7) {
    peringatan.push(
      `Proyeksi ini keyakinannya rendah — data aktual baru ${berjalan} hari, belum mencapai 7 hari. Angkanya tetap dihitung apa adanya.`
    );
  }
  if (sisa === 0) {
    peringatan.push('Periode sudah selesai, jadi proyeksinya sama dengan aktual.');
  }
  if (fixedLangsung > 0) {
    peringatan.push(
      'Biaya tetap TIDAK ikut dikalikan — sewa tidak bertambah karena penjualan bertambah. Sebagian besar selisih antara laba aktual dan laba proyeksi di tengah periode berasal dari sini, bukan dari perbaikan kinerja.'
    );
  }

  return {
    konteks: 'projected',
    outletId: actual.outletId,
    outletName: actual.outletName,
    bisaDiproyeksi: true,
    sebab: null,
    hari,

    revenue,
    units,
    variabel: { total: variabel, rasio: rasioVariabel },
    cm,
    cmPersen: persen(cm, revenue),
    fixedLangsung,
    operatingProfit,
    operatingMargin: persen(operatingProfit, revenue),
    bep,
    gap,

    // Angka antara, supaya proyeksinya bisa diperiksa sendiri dan tidak
    // terlihat seperti hasil kotak hitam.
    rincian: {
      metode: 'Linear run-rate berdasarkan aktual',
      revenueActual,
      unitsActual,
      lajuRevenueHarian: lajuRevenue,
      lajuUnitsHarian: lajuUnits,
      sisaHari: sisa,
      revenueSisa,
      rasioVariabel
    },
    peringatan
  };
}

/**
 * Konsolidasi proyeksi — PENJUMLAHAN, sama seperti Actual.
 *
 * Outlet yang tidak bisa diproyeksi TIDAK dianggap nol dan tidak diisi
 * rata-rata BU. Ia dikeluarkan dan jumlahnya dilaporkan — outlet baru yang
 * belum berjualan sehari pun tidak boleh menyumbang omzet karangan ke total BU.
 */
export function konsolidasiProyeksi(daftarProyeksi) {
  const semua = (daftarProyeksi ?? []).filter(Boolean);
  const bisa = semua.filter((p) => p.bisaDiproyeksi);
  const tidakBisa = semua.filter((p) => !p.bisaDiproyeksi);

  const jumlah = (ambil) => bisa.reduce((t, o) => t + (angka(ambil(o)) ?? 0), 0);

  const revenue = jumlah((o) => o.revenue);
  const variabel = jumlah((o) => o.variabel?.total);
  const cm = jumlah((o) => o.cm);
  const fixedLangsung = jumlah((o) => o.fixedLangsung);
  const operatingProfit = jumlah((o) => o.operatingProfit);
  const units = jumlah((o) => o.units);

  return {
    konteks: 'projected',
    outlets: semua,
    jumlahOutlet: semua.length,
    jumlahDiproyeksi: bisa.length,
    tidakBisaDiproyeksi: tidakBisa.map((o) => ({ outletId: o.outletId, outletName: o.outletName, sebab: o.sebab })),

    revenue: bisa.length ? revenue : null,
    units: bisa.length ? units : null,
    variabel: { total: bisa.length ? variabel : null },
    cm: bisa.length ? cm : null,
    cmPersen: bisa.length ? persen(cm, revenue) : null,
    fixedLangsung,
    operatingProfit: bisa.length ? operatingProfit : null,
    operatingMargin: bisa.length ? persen(operatingProfit, revenue) : null,

    // INFORMASI SAJA — sama seperti di Actual, tidak pernah jadi masukan.
    aspTertimbang: bisa.length && units > 0 ? revenue / units : null,
    aspHanyaInformasi: true,

    // Tidak ada BEP proyeksi gabungan, alasannya sama dengan di Actual.
    ringkasBep: {
      diAtas: bisa.filter((o) => o.gap?.status === STATUS_BEP.DI_ATAS).length,
      diBawah: bisa.filter((o) => o.gap?.status === STATUS_BEP.DI_BAWAH).length,
      pas: bisa.filter((o) => o.gap?.status === STATUS_BEP.PAS).length,
      tidakBisa: semua.length - bisa.filter((o) => o.gap?.status !== STATUS_BEP.TIDAK_BISA).length
    }
  };
}

/**
 * Ringkasan BU untuk proyeksi.
 *
 * Biaya bersama & korporat DIPERLAKUKAN SAMA seperti di Actual: tidak
 * dialokasikan ke outlet, dan tidak diskalakan menurut hari — keduanya
 * bulanan.
 */
export function ringkasBuProyeksi({ konsolidasi, biaya = [] }) {
  const shared = biayaCakupanLuas(biaya, 'shared_bu');
  const corporate = biayaCakupanLuas(biaya, 'corporate');

  const sebelum = angka(konsolidasi?.operatingProfit);
  const setelah = sebelum == null ? null : sebelum - shared.total;

  return {
    konteks: 'projected',
    revenue: konsolidasi?.revenue ?? null,
    variabelTotal: konsolidasi?.variabel?.total ?? null,
    cm: konsolidasi?.cm ?? null,
    cmPersen: konsolidasi?.cmPersen ?? null,
    fixedLangsungOutlet: angka(konsolidasi?.fixedLangsung) ?? 0,

    buProfitSebelumShared: sebelum,
    sharedBu: shared.total,
    rincianShared: shared.rincian,
    buProfitSetelahShared: setelah,
    marginSetelahShared: persen(setelah, konsolidasi?.revenue),

    corporate: corporate.total,
    rincianCorporate: corporate.rincian,

    catatan:
      'Proyeksi. Biaya bersama BU dan korporat tidak dialokasikan ke outlet, dan tidak ikut dikalikan menurut hari — keduanya biaya bulanan.'
  };
}
