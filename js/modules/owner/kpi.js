/**
 * KPI OWNER — empat kelompok, semuanya hasil hitungan, bukan hasil ketikan.
 *
 * Aturan yang berlaku di seluruh berkas ini:
 *
 *   **Pembilang tanpa penyebut tidak pernah ditampilkan sebagai persen.**
 *
 * "Kepatuhan aktivitas 100%" yang lahir dari 1 item selesai dari 1 item yang
 * pernah dibuat adalah angka yang benar secara aritmetika dan menyesatkan
 * secara total. Maka setiap KPI berbentuk persen di sini SELALU membawa serta
 * pembilang dan penyebutnya, dan mengembalikan `null` — bukan 0, bukan 100 —
 * saat penyebutnya nol. Layar yang menampilkannya wajib menampilkan "belum ada
 * data", bukan angka.
 *
 * Tidak ada impor di berkas ini.
 */

/** Sama persis dengan `pricing.js` — dan alasannya ditulis di sana. */
const angka = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

/** Persen yang jujur: null kalau tidak ada yang bisa dibagi. */
function persen(atas, bawah) {
  const a = angka(atas);
  const b = angka(bawah);
  if (a == null || b == null || b <= 0) return null;
  return (a / b) * 100;
}

// =====================================================================
// 1. PENJUALAN & MARGIN
// =====================================================================

/**
 * @param {ReturnType<import('./bep.js').bauranPenjualan>} bauran
 * @param {number} hariAktif berapa hari dalam rentang ini yang ada penjualannya
 */
export function kpiPenjualan(bauran, hariAktif = 0) {
  const omzet = angka(bauran?.totalOmzet) ?? 0;
  const qty = angka(bauran?.totalQty) ?? 0;
  const hari = angka(hariAktif) ?? 0;

  const laba = (bauran?.baris ?? []).reduce((t, b) => t + (angka(b.kontribusi) ?? 0), 0);

  return {
    omzet,
    porsi: qty,
    labaKotor: laba,
    marginPersen: persen(laba, omzet),
    omzetPerHari: hari > 0 ? omzet / hari : null,
    // Menu penyumbang laba terbesar & terkecil. Yang terkecil sering lebih
    // berguna: ia yang memakan tempat di menu tanpa membayar sewanya.
    terbaik: (bauran?.baris ?? []).slice(0, 5),
    terlemah: [...(bauran?.baris ?? [])].sort((a, b) => a.kontribusi - b.kontribusi).slice(0, 5),
    // Dibawa naik supaya kartu KPI bisa memberi peringatan, bukan hanya
    // halaman BEP.
    persenTerlewat: angka(bauran?.persenTerlewat) ?? 0
  };
}

// =====================================================================
// 2. OPERASIONAL
// =====================================================================

/**
 * @param {Array<{movement_type: string, qty_delta: number, unit_cost?: number|null,
 *                product_id: string, outlet_id: string}>} gerakan
 * @param {Array<{id: string, outlet_id: string, product_id: string, qty: number}>} saldo
 *        baris `stock_balances`
 * @param {Array<{id: string, cancelled_at?: string|null}>} produksi
 */
export function kpiOperasional({ gerakan = [], saldo = [], produksi = [], products = [] }) {
  const namaProduk = new Map((products ?? []).map((p) => [p.id, p.name]));

  let nilaiSusut = 0;
  let qtySusut = 0;
  for (const g of gerakan) {
    if (g?.movement_type !== 'waste') continue;
    const q = Math.abs(angka(g.qty_delta) ?? 0);
    qtySusut += q;
    nilaiSusut += q * (angka(g.unit_cost) ?? 0);
  }

  // Stok minus. Ini bukan sekadar angka janggal: sejak awal sistem memang
  // MENGIZINKAN produksi & penjualan menembus stok, jadi minus adalah tanda
  // bahwa yang tercatat masuk lebih sedikit daripada yang benar-benar dipakai —
  // hampir selalu karena opname atau penerimaan barang belum diisi.
  const minus = saldo
    .filter((s) => (angka(s.qty) ?? 0) < 0)
    .map((s) => ({ ...s, nama: namaProduk.get(s.product_id) ?? '(produk tidak dikenal)' }))
    .sort((a, b) => (angka(a.qty) ?? 0) - (angka(b.qty) ?? 0));

  const produksiAktif = produksi.filter((p) => !p?.cancelled_at);

  return {
    nilaiSusut,
    qtySusut,
    jumlahProduksi: produksiAktif.length,
    produksiDibatalkan: produksi.length - produksiAktif.length,
    stokMinus: minus,
    jumlahStokMinus: minus.length
  };
}

// =====================================================================
// 3. KEPATUHAN
// =====================================================================

/**
 * Aktivitas harian & kehadiran.
 *
 * Penyebut kepatuhan aktivitas sengaja "item yang benar-benar tercatat", bukan
 * "item yang seharusnya dikerjakan". Menghitung yang seharusnya menuntut
 * mengetahui jadwal tiap item di tiap outlet di tiap hari — dan tebakan yang
 * salah di penyebut menghasilkan persen yang salah tanpa satu pun tanda.
 * Batas ini disebutkan lewat `catatan` supaya ikut sampai ke layar.
 *
 * @param {Array<{id: string, run_date: string, outlet_id: string}>} runs
 * @param {Array<{run_id: string, checked: boolean}>} items
 * @param {Array<{user_id: string, clock_in_at: string, clock_out_at: string|null}>} presensi
 */
export function kpiKepatuhan({ runs = [], items = [], presensi = [] }) {
  const selesai = items.filter((i) => i?.checked).length;

  const hariUnik = new Set(runs.map((r) => r?.run_date).filter(Boolean));
  const outletUnik = new Set(runs.map((r) => r?.outlet_id).filter(Boolean));

  const belumPulang = presensi.filter((p) => p?.clock_in_at && !p.clock_out_at).length;

  return {
    itemSelesai: selesai,
    itemTercatat: items.length,
    kepatuhanPersen: persen(selesai, items.length),
    hariAdaAktivitas: hariUnik.size,
    outletAdaAktivitas: outletUnik.size,

    kehadiran: presensi.length,
    belumClockOut: belumPulang,
    persenBelumClockOut: persen(belumPulang, presensi.length),

    catatan:
      'Penyebutnya adalah item yang tercatat, bukan yang seharusnya dikerjakan. Outlet yang sama sekali tidak mengisi aktivitas tidak muncul sebagai 0% — ia tidak muncul sama sekali.'
  };
}

// =====================================================================
// 4. KEUANGAN
// =====================================================================

/**
 * @param {ReturnType<import('./bep.js').biayaTetapDariKas>} biayaTetap
 * @param {Array<{entry_type: string, amount: number}>} entri semua entri kas pada rentang
 */
export function kpiKeuangan({ biayaTetap, entri = [], omzet = 0 }) {
  let semuaKeluar = 0;
  for (const e of entri) {
    if (e?.entry_type !== 'out') continue;
    semuaKeluar += Math.abs(angka(e.amount) ?? 0);
  }

  const tetap = angka(biayaTetap?.total) ?? 0;
  const tanpaKategori = angka(biayaTetap?.tanpaKategori) ?? 0;

  return {
    kasKeluar: semuaKeluar,
    biayaTetap: tetap,
    biayaVariabel: Math.max(0, semuaKeluar - tetap),
    tanpaKategori,
    // Seberapa besar bagian pengeluaran yang belum bisa digolongkan. Kalau
    // besar, seluruh pemisahan tetap/variabel — dan karenanya BEP — belum
    // layak dipercaya.
    persenTanpaKategori: persen(tanpaKategori, semuaKeluar),
    rasioBiayaTetap: persen(tetap, angka(omzet) ?? 0),
    // Rasio KAS KELUAR terhadap omzet — bukan rasio biaya tetap.
    //
    // Dibedakan karena keduanya menjawab pertanyaan berbeda: yang satu "berapa
    // uang yang keluar", yang satu "berapa beban tetap yang harus ditutup".
    // Layar Ringkasan memakai yang ini supaya tidak ada dua angka bernama
    // "biaya tetap" yang datang dari dua rute berbeda.
    rasioKasKeluar: persen(semuaKeluar, angka(omzet) ?? 0),
    perKategori: biayaTetap?.perKategori ?? []
  };
}

/**
 * Satu ringkasan untuk kartu paling atas halaman owner.
 *
 * `layakDipercaya` sengaja ada di sini, bukan di layar: keputusan "angka ini
 * boleh dibaca apa adanya atau tidak" adalah bagian dari perhitungannya, dan
 * kalau ia tinggal di layar, layar berikutnya yang memakai data yang sama akan
 * lupa memasangnya.
 */
export function ringkasanOwner({ penjualan, operasional, keuangan, bep }) {
  const alasan = [];

  // TIDAK ADA DATA BUKAN DATA YANG BERSIH.
  //
  // Versi pertama fungsi ini mengembalikan `layakDipercaya: true` untuk rentang
  // yang sama sekali tidak punya penjualan — karena tidak ada satu pun ambang
  // yang terlampaui. Hasilnya: kartu paling atas halaman owner menampilkan
  // omzet 0 dan laba 0 tanpa satu pun tanda, dan angka nol yang tenang jauh
  // lebih meyakinkan daripada angka nol yang bertanda tanya.
  if (!((penjualan?.porsi ?? 0) > 0)) {
    alasan.push('Belum ada penjualan yang tercatat pada rentang ini — seluruh angka di halaman ini masih kosong, bukan nol.');
  }

  // Sebab BEP tidak bisa dihitung sama sekali (margin minus, tidak ada
  // penjualan). Kalau hanya `peringatan` yang dibaca, kegagalan TOTAL justru
  // lolos sementara masalah kecil tertangkap — kebalikan dari yang diinginkan.
  if (bep?.sebab) alasan.push(bep.sebab);

  if ((penjualan?.persenTerlewat ?? 0) > 10) {
    alasan.push(`${Math.round(penjualan.persenTerlewat)}% penjualan tidak ikut dihitung (HPP atau harganya belum ada).`);
  }
  if ((operasional?.jumlahStokMinus ?? 0) > 0) {
    alasan.push(`${operasional.jumlahStokMinus} bahan bersaldo minus — nilai stok dan HPP belum bisa dipercaya sampai opname dijalankan.`);
  }
  if ((keuangan?.persenTanpaKategori ?? 0) > 20) {
    alasan.push(`${Math.round(keuangan.persenTanpaKategori)}% kas keluar belum berkategori, jadi pemisahan biaya tetap belum lengkap.`);
  }
  for (const p of bep?.peringatan ?? []) alasan.push(p);

  return {
    omzet: penjualan?.omzet ?? 0,
    labaKotor: penjualan?.labaKotor ?? 0,
    biayaTetap: keuangan?.biayaTetap ?? 0,
    // Laba kotor dikurangi biaya tetap. BUKAN laba bersih — pajak, penyusutan,
    // dan biaya yang tidak pernah lewat kas tidak ada di sini. Dinamai apa
    // adanya supaya tidak ada yang memakainya sebagai laba bersih.
    sisaSetelahBiayaTetap: (penjualan?.labaKotor ?? 0) - (keuangan?.biayaTetap ?? 0),
    bepPorsi: bep?.porsi ?? null,
    bepOmzet: bep?.omzet ?? null,
    layakDipercaya: alasan.length === 0,
    alasan
  };
}
