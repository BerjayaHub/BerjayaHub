/**
 * PROFITABILITAS PER OUTLET — dihitung sendiri-sendiri, dijumlahkan belakangan.
 *
 * ============ ATURAN YANG MENENTUKAN SELURUH BERKAS INI ============
 *
 * **Hitung tiap outlet dulu. Konsolidasi adalah PENJUMLAHAN, bukan rata-rata.**
 *
 * Mesin lama (`bep.js#bauranPenjualan`) melebur seluruh outlet lebih dulu, lalu
 * menghitung satu margin dan satu BEP. Untuk omzet itu tidak salah — Σ(qty ×
 * harga masing-masing) tetap benar karena harganya diambil per baris transaksi.
 *
 * Yang salah dua hal:
 *
 *   1. Ia menampilkan satu "harga jual rata-rata" seolah berlaku — padahal
 *      Rp33.667 tidak berlaku di Serpong maupun di Sentul.
 *   2. Ia membagi SATU biaya tetap gabungan dengan SATU margin gabungan. Outlet
 *      yang sudah untung menutupi yang masih rugi, dan keduanya tidak terlihat.
 *
 * Di sini setiap outlet punya angkanya sendiri sampai akhir. Rata-rata
 * tertimbang tetap dihitung, tapi ia keluaran INFORMASI — dan tidak pernah jadi
 * masukan perhitungan mana pun.
 *
 * ============ HANYA REVENUE YANG BENAR-BENAR HISTORIS ============
 *
 * `sales.revenue` adalah snapshot saat transaksi dicatat. Ia tidak pernah
 * dibaca ulang dari master, jadi mengubah harga hari ini tidak mengubah omzet
 * bulan lalu.
 *
 * HPP dan kemasan TIDAK begitu: keduanya dihitung dari master SEKARANG. Mengubah
 * harga beli bahan hari ini akan menggeser CM bulan lalu. Itu sudah begitu
 * sejak sebelum revisi ini, jadi bukan kemunduran — tapi ia batas yang harus
 * diketahui, dan `peringatan` pada hasilnya menyebutkannya.
 *
 * ============ POTONGAN MARKETPLACE TIDAK DIHITUNG DUA KALI ============
 *
 * `outlet_menu_prices.fee_online_percent` dan `outlet_costs` (variabel,
 * persen_omzet) sama-sama bisa mewakili potongan marketplace.
 *
 * Di sini yang dipakai HANYA `outlet_costs`. Dua alasan:
 *
 *   - Memakai keduanya berarti memotong dua kali.
 *   - `sales` tidak punya kolom kanal (dine-in vs online). Menerapkan
 *     `fee_online_percent` ke seluruh penjualan berarti menganggap semuanya
 *     online — salah untuk kafe yang sebagian besar dine-in.
 *
 * `fee_online_percent` dan `promo_percent` tetap milik SIMULASI, yang memang
 * menghitung harga seandainya. Tesnya menjaga pemisahan ini.
 *
 * Tidak ada impor di berkas ini.
 */

/**
 * Angka, atau `null`. Jenisnya diperiksa lebih dulu, BUKAN hasil konversinya —
 * `Number(null)` adalah 0 dan lolos `isFinite`. Penjelasan panjangnya di
 * `pricing.js`.
 */
const angka = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

/** Persen yang jujur: `null` kalau penyebutnya nol, bukan 0 dan bukan 100. */
function persen(atas, bawah) {
  const a = angka(atas);
  const b = angka(bawah);
  if (a == null || b == null || b === 0) return null;
  return (a / b) * 100;
}

export const STATUS_BEP = {
  DI_ATAS: 'ABOVE_BEP',
  DI_BAWAH: 'BELOW_BEP',
  PAS: 'AT_BEP',
  TIDAK_BISA: 'NOT_CALCULABLE'
};

// =====================================================================
// BIAYA SEBUAH OUTLET
// =====================================================================

/**
 * Pisahkan biaya menurut cakupan & jenisnya.
 *
 * Yang bercakupan `shared_bu` / `corporate` TIDAK PERNAH masuk ke outlet mana
 * pun — bukan karena sulit dibagi, tapi karena membaginya mengubah arti
 * angkanya. Lihat header migration 0100.
 */
export function biayaLangsungOutlet(daftar, outletId) {
  let tetap = 0;
  let variabelPerPorsi = 0;
  let variabelPersen = 0;
  const rincianTetap = [];

  for (const b of daftar ?? []) {
    if (b?.is_active === false) continue;
    if ((b.allocation_scope ?? 'direct_outlet') !== 'direct_outlet') continue;
    if (b.outlet_id !== outletId) continue;

    const n = angka(b.amount);
    if (n == null || n < 0) continue;

    if (b.jenis === 'tetap' && b.satuan === 'per_bulan') {
      tetap += n;
      rincianTetap.push({ nama: b.name, jumlah: n, sifat: b.cost_behavior ?? 'fixed' });
    } else if (b.jenis === 'variabel' && b.satuan === 'per_porsi') {
      variabelPerPorsi += n;
    } else if (b.jenis === 'variabel' && b.satuan === 'persen_omzet') {
      variabelPersen += n;
    }
    // Kombinasi lain diabaikan, BUKAN ditebak — baris seperti itu hanya bisa
    // lahir dari data yang menembus constraint database.
  }

  rincianTetap.sort((a, b) => b.jumlah - a.jumlah);
  return { tetap, variabelPerPorsi, variabelPersen, rincianTetap };
}

/** Biaya yang berhenti di tingkat BU / korporat — tidak pernah turun ke outlet. */
export function biayaCakupanLuas(daftar, cakupan) {
  let total = 0;
  const rincian = [];
  for (const b of daftar ?? []) {
    if (b?.is_active === false) continue;
    if ((b.allocation_scope ?? 'direct_outlet') !== cakupan) continue;
    const n = angka(b.amount);
    if (n == null || n < 0) continue;
    total += n;
    rincian.push({ nama: b.name, jumlah: n });
  }
  rincian.sort((a, b) => b.jumlah - a.jumlah);
  return { total, rincian };
}

// =====================================================================
// ACTUAL — SATU OUTLET
// =====================================================================

/**
 * Profitabilitas AKTUAL satu outlet.
 *
 * `sales` boleh berisi seluruh BU — penyaringan outletnya dikerjakan DI SINI,
 * bukan diserahkan ke pemanggil. Pemanggil yang lupa menyaring akan menghasilkan
 * angka yang terlihat wajar untuk outlet yang salah, dan tidak ada yang bisa
 * menyadarinya dari layar.
 *
 * @param {{
 *   outlet: {id: string, name?: string},
 *   sales: Array<{outlet_id: string, product_id: string, qty: number, revenue?: number|null, unit_price?: number|null}>,
 *   products: Array<{id: string, name: string}>,
 *   hpp: Map<string, number|null>,
 *   hargaOutlet?: Array<{outlet_id: string, product_id: string, packaging_cost?: number}>,
 *   biaya?: Array<object>
 * }} a
 */
export function hitungActualOutlet({ outlet, sales, products, hpp, hargaOutlet = [], biaya = [] }) {
  const outletId = outlet?.id ?? null;
  const namaProduk = new Map((products ?? []).map((p) => [p.id, p.name]));
  const biayaHpp = hpp instanceof Map ? hpp : new Map(Object.entries(hpp ?? {}));

  // Kemasan diambil dari harga OUTLET ini, bukan dari master BU.
  const kemasanPer = new Map();
  for (const h of hargaOutlet) {
    if (h.outlet_id !== outletId) continue;
    kemasanPer.set(h.product_id, angka(h.packaging_cost) ?? 0);
  }

  // --- Kumpulkan per produk
  const per = new Map();
  for (const s of sales ?? []) {
    if (s?.outlet_id !== outletId) continue;
    const q = angka(s.qty);
    if (q == null || q <= 0) continue;

    // Omzet AKTUAL. `revenue` menang; `unit_price × qty` hanya cadangan untuk
    // baris lama yang revenue-nya belum terisi. Harga master TIDAK pernah
    // dipakai di sini — itu yang membuat omzet historis tetap historis.
    const rev = angka(s.revenue);
    const sat = angka(s.unit_price);
    const omzet = rev != null ? rev : sat != null ? sat * q : null;

    const cur = per.get(s.product_id) ?? { qty: 0, omzet: 0, adaHarga: true };
    cur.qty += q;
    if (omzet == null) cur.adaHarga = false;
    else cur.omzet += omzet;
    per.set(s.product_id, cur);
  }

  const menu = [];
  const terlewat = [];
  let revenue = 0;
  let units = 0;
  let biayaHppTotal = 0;
  let biayaKemasanTotal = 0;
  let unitTerlewat = 0;

  for (const [pid, { qty, omzet, adaHarga }] of per) {
    const nama = namaProduk.get(pid) ?? '(produk tidak dikenal)';
    const c = angka(biayaHpp.get(pid));

    // Yang tidak bisa dihitung DIKELUARKAN dan DILAPORKAN — tidak dianggap nol.
    // HPP kosong yang dihitung nol menghasilkan margin 100%, BEP anjlok, dan
    // semuanya tetap terlihat masuk akal.
    if (!adaHarga) {
      terlewat.push({ productId: pid, nama, units: qty, sebab: 'Penjualannya tidak mencatat harga' });
      unitTerlewat += qty;
      continue;
    }
    if (c == null) {
      terlewat.push({ productId: pid, nama, units: qty, sebab: 'HPP belum bisa dihitung' });
      unitTerlewat += qty;
      continue;
    }

    const kemasan = kemasanPer.get(pid) ?? 0;
    const hppTotalMenu = c * qty;
    const kemasanTotalMenu = kemasan * qty;
    const variabelMenu = hppTotalMenu + kemasanTotalMenu;

    menu.push({
      productId: pid,
      nama,
      units: qty,
      revenue: omzet,
      asp: omzet / qty,
      hppSatuan: c,
      kemasanSatuan: kemasan,
      variabelSatuan: c + kemasan,
      cm: omzet - variabelMenu,
      cmPersen: persen(omzet - variabelMenu, omzet),
      cmSatuan: omzet / qty - (c + kemasan)
    });

    revenue += omzet;
    units += qty;
    biayaHppTotal += hppTotalMenu;
    biayaKemasanTotal += kemasanTotalMenu;
  }

  menu.sort((a, b) => b.cm - a.cm);

  // --- Biaya outlet
  const bo = biayaLangsungOutlet(biaya, outletId);
  const variabelPerPorsiTotal = bo.variabelPerPorsi * units;
  const variabelPersenTotal = (revenue * bo.variabelPersen) / 100;

  const variabelTotal = biayaHppTotal + biayaKemasanTotal + variabelPerPorsiTotal + variabelPersenTotal;
  const cm = revenue - variabelTotal;
  const cmPersen = persen(cm, revenue);

  const fixedLangsung = bo.tetap;
  const operatingProfit = cm - fixedLangsung;

  // --- BEP
  const bep = hitungBepOutlet({ cm, revenue, units, fixedLangsung });
  const gap = gapKeBep({ revenue, bepRevenue: bep.revenue });

  const peringatan = [];
  if (units === 0) peringatan.push('Belum ada penjualan tercatat pada rentang ini — seluruh angka di bawah masih kosong, bukan nol.');
  if (unitTerlewat > 0) {
    peringatan.push(
      `${terlewat.length} menu terjual (${unitTerlewat} porsi) tidak ikut dihitung karena HPP atau harganya belum lengkap.`
    );
  }
  if (revenue > 0) {
    peringatan.push('HPP & kemasan dihitung dari master SEKARANG, bukan dari nilai saat transaksi. Hanya omzet yang benar-benar historis.');
  }

  return {
    konteks: 'actual',
    outletId,
    outletName: outlet?.name ?? '',

    revenue,
    units,
    // Informasi saja. TIDAK dipakai menghitung apa pun di berkas ini.
    asp: units > 0 ? revenue / units : null,

    variabel: {
      hpp: biayaHppTotal,
      kemasan: biayaKemasanTotal,
      perPorsi: variabelPerPorsiTotal,
      persenOmzet: variabelPersenTotal,
      total: variabelTotal
    },

    cm,
    cmPersen,

    fixedLangsung,
    rincianFixed: bo.rincianTetap,

    operatingProfit,
    operatingMargin: persen(operatingProfit, revenue),

    bep,
    gap,

    menu,
    terlewat,
    unitTerlewat,
    peringatan
  };
}

/**
 * BEP satu outlet, dari ekonomi outlet itu sendiri.
 *
 * CM ≤ 0 menghasilkan `null`, BUKAN angka. Membagi dengan CM negatif
 * menghasilkan BEP NEGATIF — dan angka negatif terbaca seolah targetnya sudah
 * terlampaui, yaitu kebalikan persis dari keadaannya.
 */
export function hitungBepOutlet({ cm, revenue, units, fixedLangsung }) {
  const c = angka(cm);
  const r = angka(revenue);
  const u = angka(units);
  const f = angka(fixedLangsung) ?? 0;

  const kosong = { revenue: null, unit: null, cmPersen: null, cmPerUnit: null };

  if (c == null || r == null || r === 0) {
    return { ...kosong, sebab: 'Belum ada omzet pada rentang ini, jadi titik impas belum bisa dihitung.' };
  }
  if (c <= 0) {
    return {
      ...kosong,
      sebab:
        c === 0
          ? 'Contribution margin persis nol — berapa pun yang terjual, biaya tetap tidak akan tertutup.'
          : 'Contribution margin NEGATIF — setiap penjualan menambah rugi, jadi tidak ada titik impas.'
    };
  }

  const cmRasio = c / r;
  const cmPerUnit = u && u > 0 ? c / u : null;

  return {
    revenue: f / cmRasio,
    unit: cmPerUnit && cmPerUnit > 0 ? f / cmPerUnit : null,
    cmPersen: cmRasio * 100,
    cmPerUnit,
    sebab: null
  };
}

export function gapKeBep({ revenue, bepRevenue }) {
  const r = angka(revenue);
  const b = angka(bepRevenue);
  if (r == null || b == null) return { nilai: null, persen: null, status: STATUS_BEP.TIDAK_BISA };

  const selisih = r - b;
  // Toleransi setengah rupiah: pembulatan pecahan tidak boleh membuat outlet
  // yang persis di titik impas dilaporkan "masih di bawah".
  const status = Math.abs(selisih) < 0.5 ? STATUS_BEP.PAS : selisih > 0 ? STATUS_BEP.DI_ATAS : STATUS_BEP.DI_BAWAH;

  return { nilai: selisih, persen: persen(r, b), status };
}

// =====================================================================
// KONSOLIDASI — PENJUMLAHAN, BUKAN RATA-RATA
// =====================================================================

/**
 * Gabungkan hasil per outlet.
 *
 * Setiap kolom DIJUMLAHKAN dari hasil yang sudah dihitung sendiri-sendiri.
 * Tidak ada satu pun angka di sini yang lahir dari rata-rata harga atau
 * rata-rata biaya.
 *
 * `aspTertimbang` memang dihitung — tapi ia keluaran, bukan masukan, dan
 * diberi penanda supaya layar tidak memakainya sebagai harga.
 */
export function konsolidasiOutlet(hasilOutlet) {
  const daftar = (hasilOutlet ?? []).filter(Boolean);

  const jumlah = (ambil) => daftar.reduce((t, o) => t + (angka(ambil(o)) ?? 0), 0);

  const revenue = jumlah((o) => o.revenue);
  const units = jumlah((o) => o.units);
  const variabelTotal = jumlah((o) => o.variabel?.total);
  const cm = jumlah((o) => o.cm);
  const fixedLangsung = jumlah((o) => o.fixedLangsung);
  const operatingProfit = jumlah((o) => o.operatingProfit);

  return {
    konteks: 'actual',
    outlets: daftar,
    jumlahOutlet: daftar.length,

    revenue,
    units,
    variabel: {
      hpp: jumlah((o) => o.variabel?.hpp),
      kemasan: jumlah((o) => o.variabel?.kemasan),
      perPorsi: jumlah((o) => o.variabel?.perPorsi),
      persenOmzet: jumlah((o) => o.variabel?.persenOmzet),
      total: variabelTotal
    },
    cm,
    cmPersen: persen(cm, revenue),
    fixedLangsung,
    operatingProfit,
    operatingMargin: persen(operatingProfit, revenue),

    // INFORMASI SAJA — lihat header berkas ini. Tidak pernah jadi masukan.
    aspTertimbang: units > 0 ? revenue / units : null,
    aspHanyaInformasi: true,

    // Konsolidasi TIDAK punya BEP tunggal, dan itu disengaja.
    //
    // BEP gabungan hanya bermakna kalau bauran outletnya tetap — dan ia justru
    // menyembunyikan yang mau dilihat: outlet yang sudah untung menutupi yang
    // masih rugi. Yang ditampilkan berapa outlet yang sudah lewat titik impas.
    ringkasBep: {
      diAtas: daftar.filter((o) => o.gap?.status === STATUS_BEP.DI_ATAS).length,
      diBawah: daftar.filter((o) => o.gap?.status === STATUS_BEP.DI_BAWAH).length,
      pas: daftar.filter((o) => o.gap?.status === STATUS_BEP.PAS).length,
      tidakBisa: daftar.filter((o) => o.gap?.status === STATUS_BEP.TIDAK_BISA).length
    }
  };
}

// =====================================================================
// RINGKASAN TINGKAT BU
// =====================================================================

/**
 * Tiga angka laba yang SENGAJA dibedakan namanya.
 *
 * "Profit" tanpa keterangan adalah kata yang paling mudah disalahpahami di
 * seluruh aplikasi ini. Tiga angka di bawah semuanya sah, semuanya berbeda, dan
 * ketiganya akan disebut "profit" oleh orang yang berbeda:
 *
 *   operatingProfitOutlet   -> hanya biaya yang jadi tanggung jawab outlet
 *   buProfitSebelumShared   -> jumlah seluruh outlet, belum kena biaya bersama
 *   buProfitSetelahShared   -> sesudah biaya bersama BU
 *
 * Biaya korporat ditampilkan TERPISAH dan tidak dikurangkan ke BU mana pun —
 * ia milik organisasi, bukan milik salah satu BU.
 */
export function ringkasBu({ konsolidasi, biaya = [] }) {
  const shared = biayaCakupanLuas(biaya, 'shared_bu');
  const corporate = biayaCakupanLuas(biaya, 'corporate');

  const sebelum = angka(konsolidasi?.operatingProfit) ?? 0;
  const setelah = sebelum - shared.total;

  return {
    konteks: 'actual',
    revenue: angka(konsolidasi?.revenue) ?? 0,
    variabelTotal: angka(konsolidasi?.variabel?.total) ?? 0,
    cm: angka(konsolidasi?.cm) ?? 0,
    cmPersen: konsolidasi?.cmPersen ?? null,
    fixedLangsungOutlet: angka(konsolidasi?.fixedLangsung) ?? 0,

    buProfitSebelumShared: sebelum,
    sharedBu: shared.total,
    rincianShared: shared.rincian,
    buProfitSetelahShared: setelah,
    marginSetelahShared: persen(setelah, konsolidasi?.revenue),

    // Tidak dikurangkan dari BU mana pun. Ditampilkan supaya terlihat, bukan
    // supaya dibagi.
    corporate: corporate.total,
    rincianCorporate: corporate.rincian,

    catatan:
      'Biaya bersama BU dan korporat TIDAK dialokasikan ke outlet. Operating Profit tiap outlet hanya memuat biaya yang benar-benar jadi tanggung jawabnya.'
  };
}
