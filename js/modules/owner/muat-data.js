import { computeCosts } from '../product/hpp.js';
import { todayWIB } from '../../core/dates.js';
import { listRecipesFull } from '../product/product.service.js';
import {
  listProductsOwner,
  listOutletsBu,
  listSales,
  listStockMovements,
  listStockBalances,
  listProductionRuns,
  listCashEntries,
  listCashCategories,
  listChecklist,
  listAttendance,
  hariAdaPenjualan
} from './owner.service.js';
import { bauranPenjualan, biayaTetapDariKas, hitungBep, posisiTerhadapBep, ringkasBiayaOutlet } from './bep.js';
import { listBiayaOutlet } from './biaya.service.js';
import { listHargaAktif } from '../menu/harga-outlet.service.js';
import { hitungActualOutlet, konsolidasiOutlet, ringkasBu } from './profit-outlet.js';
import { hitungHari, proyeksiOutlet, konsolidasiProyeksi, ringkasBuProyeksi } from './proyeksi.js';
import { kpiPenjualan, kpiOperasional, kpiKepatuhan, kpiKeuangan, ringkasanOwner } from './kpi.js';

/**
 * Satu pintu pengambilan data untuk Ringkasan DAN BEP.
 *
 * Kedua tab memakai bahan yang hampir sama: produk, resep, penjualan, kas. Kalau
 * masing-masing mengambil sendiri, keduanya akan menampilkan angka yang berbeda
 * begitu ada satu yang lupa ikut diperbarui — dan yang paling mungkin berbeda
 * justru omzet, angka pertama yang dilihat owner di dua tempat berbeda.
 *
 * Hasilnya di-cache per (BU, rentang, outlet) selama layarnya hidup, jadi
 * berpindah tab tidak mengunduh ulang belasan tabel.
 */

const simpanan = new Map();

function kunci({ businessUnitId, dari, sampai, outletIds }) {
  return `${businessUnitId}|${dari}|${sampai}|${(outletIds ?? []).slice().sort().join(',')}`;
}

/** Dipanggil kalau ada yang berubah di luar (mis. dokumen ditandatangani). */
export function lupakanData() {
  simpanan.clear();
}

export async function muatDataOwner({ businessUnitId, dari, sampai, outletIds = null, hariKerja = 30, targetLaba = 0 }) {
  const k = kunci({ businessUnitId, dari, sampai, outletIds });

  if (!simpanan.has(k)) {
    simpanan.set(k, ambilMentah({ businessUnitId, dari, sampai, outletIds }));
  }

  let mentah;
  try {
    mentah = await simpanan.get(k);
  } catch (error) {
    // Janji yang gagal TIDAK boleh tinggal di cache. Kalau dibiarkan, satu
    // kegagalan jaringan sesaat akan terus dikembalikan sebagai error yang
    // sama sampai halamannya dimuat ulang — dan tombol "coba lagi" jadi tidak
    // pernah bekerja, yang jauh lebih membingungkan daripada errornya sendiri.
    simpanan.delete(k);
    throw error;
  }

  // `dari`/`sampai` ikut masuk ke perhitungan, bukan cuma ke pengambilan data:
  // proyeksi butuh tahu panjang periodenya untuk membagi laju harian. Rentangnya
  // TIDAK diambil ulang dari layar supaya proyeksi tidak bisa memakai rentang
  // yang berbeda dari yang dipakai mengambil penjualannya.
  return hitung({ ...mentah, dari, sampai, hariKerja, targetLaba, outletIdsAktif: outletIds });
}

async function ambilMentah({ businessUnitId, dari, sampai, outletIds }) {
  const outlets = await listOutletsBu(businessUnitId);
  // Kas dicakup lewat OUTLET, bukan BU — lihat 0093 bagian (4). Kalau tidak ada
  // penyaringan outlet, dipakai seluruh outlet BU ini.
  const outletKas = outletIds?.length ? outletIds : outlets.map((o) => o.id);

  const [products, recipes, sales, gerakan, saldo, produksi, entriKas, kategoriKas, checklist, presensi, biayaOutlet, hargaOutlet] = await Promise.all([
    listProductsOwner(businessUnitId),
    listRecipesFull(businessUnitId),
    listSales({ businessUnitId, dari, sampai, outletIds }),
    listStockMovements({ businessUnitId, dari, sampai, outletIds }),
    listStockBalances({ businessUnitId, outletIds }),
    listProductionRuns({ businessUnitId, dari, sampai, outletIds }),
    listCashEntries({ outletIds: outletKas, dari, sampai }),
    listCashCategories(),
    listChecklist({ businessUnitId, dari, sampai, outletIds }),
    listAttendance({ businessUnitId, dari, sampai, outletIds }),
    // Biaya yang DIDAFTARKAN, bukan yang sudah dibayar. Dicakup ke outlet yang
    // sedang disaring; kalau tidak ada saringan, seluruh outlet BU ini.
    listBiayaOutlet({ businessUnitId, outletIds }),
    // Harga jual yang BERLAKU HARI INI per outlet. Dipakai tabel simulasi harga.
    // Harga historis TIDAK diambil dari sini — omzet & margin aktual dibaca dari
    // `sales.unit_price` yang sudah dibekukan saat transaksi dicatat.
    listHargaAktif(businessUnitId)
  ]);

  return { outlets, products, recipes, sales, gerakan, saldo, produksi, entriKas, kategoriKas, checklist, presensi, biayaOutlet, hargaOutlet };
}

function hitung({
  outlets,
  products,
  recipes,
  sales,
  gerakan,
  saldo,
  produksi,
  entriKas,
  kategoriKas,
  checklist,
  presensi,
  biayaOutlet,
  hargaOutlet,
  dari,
  sampai,
  hariKerja,
  targetLaba,
  outletIdsAktif
}) {
  const biaya = computeCosts(products, recipes);
  const bauran = bauranPenjualan({ sales, products, biaya });

  const penjualan = kpiPenjualan(bauran, hariAdaPenjualan(sales));
  const operasional = kpiOperasional({ gerakan, saldo, produksi, products });
  const kepatuhan = kpiKepatuhan({ runs: checklist.runs, items: checklist.items, presensi });

  const biayaTetap = biayaTetapDariKas(entriKas, kategoriKas);
  const keuangan = kpiKeuangan({ biayaTetap, entri: entriKas, omzet: penjualan.omzet });

  // DUA SUMBER BIAYA TETAP, DAN MANA YANG DIPAKAI HARUS TERLIHAT.
  //
  // `daftarBiaya` = yang direncanakan (tabel outlet_costs).
  // `biayaTetap`  = yang sudah dibayar, dari buku kas.
  //
  // BEP memakai yang DIRENCANAKAN kalau ada, karena itu yang menjawab "berapa
  // yang harus ditutup bulan ini". Buku kas hanya berisi yang sudah dibayar,
  // jadi BEP yang dihitung darinya akan terlihat sangat rendah di awal bulan
  // lalu melonjak di akhir — tanpa ada yang berubah di dunia nyata.
  //
  // Kalau daftarnya belum diisi, dipakai buku kas sebagai cadangan. Sumber
  // yang sedang dipakai dibawa keluar (`sumberBiayaTetap`) supaya layarnya
  // menyebutkan yang mana, bukan menampilkan satu angka tanpa asal-usul.
  const daftarBiaya = ringkasBiayaOutlet(biayaOutlet);
  const pakaiDaftar = daftarBiaya.tetapPerBulan > 0;
  const tetapDipakai = pakaiDaftar ? daftarBiaya.tetapPerBulan : biayaTetap.total;

  const bep = hitungBep({
    marginSatuan: bauran.marginTertimbang,
    hargaRata: bauran.hargaTertimbang,
    biayaTetap: tetapDipakai,
    targetLaba,
    hariKerja,
    variabelPerPorsi: daftarBiaya.variabelPerPorsi,
    variabelPersen: daftarBiaya.variabelPersen
  });

  // =====================================================================
  // ACTUAL — OUTLET-AWARE (Phase 8A/8B)
  //
  // Tiap outlet dihitung SENDIRI, lalu dijumlahkan. Inilah satu-satunya sumber
  // angka uang untuk layar Actual dan untuk kartu uang di Ringkasan.
  //
  // Mesin lama di bawah (`bauran`, `bep`, `posisi`) TIDAK dibuang, tapi ia
  // sekarang hanya melayani tab BEP & Simulasi. Kalau keduanya dipakai
  // bersamaan untuk angka yang sama, layar akan menampilkan dua laba yang
  // berbeda-tipis dan tidak ada yang tahu mana yang benar.
  // =====================================================================
  const outletDihitung = outletIdsAktif?.length ? outlets.filter((o) => outletIdsAktif.includes(o.id)) : outlets;

  const hasilOutlet = outletDihitung.map((o) =>
    hitungActualOutlet({
      outlet: o,
      sales,
      products,
      hpp: biaya,
      hargaOutlet,
      biaya: biayaOutlet
    })
  );

  const konsolidasiActual = konsolidasiOutlet(hasilOutlet);

  const actual = {
    konteks: 'actual',
    outlets: hasilOutlet,
    konsolidasi: konsolidasiActual,
    bu: ringkasBu({ konsolidasi: konsolidasiActual, biaya: biayaOutlet })
  };

  // =====================================================================
  // PROJECTED (Phase 9) — TURUNAN DARI ACTUAL, BUKAN HITUNGAN KEDUA.
  //
  // `proyeksiOutlet()` menerima objek hasil `hitungActualOutlet()` di atas,
  // jadi definisi "biaya variabel" dan "biaya tetap" di sini MUSTAHIL berbeda
  // dari yang di Actual: proyeksi hanya mengalikan yang sudah dihitung.
  //
  // Kalau ia membaca `sales`/`products` sendiri, cukup satu perubahan kecil di
  // salah satunya untuk membuat tab Actual dan tab Proyeksi menampilkan angka
  // yang berbeda tipis — persis kegagalan yang sudah dicegah di 8B.
  // =====================================================================
  const hari = hitungHari({ dari, sampai, hariIni: todayWIB() });
  const hasilProyeksi = hasilOutlet.map((a) => proyeksiOutlet({ actual: a, hari }));
  const konsolidasiProy = konsolidasiProyeksi(hasilProyeksi);

  const proyeksi = {
    konteks: 'projected',
    hari,
    outlets: hasilProyeksi,
    konsolidasi: konsolidasiProy,
    bu: ringkasBuProyeksi({ konsolidasi: konsolidasiProy, biaya: biayaOutlet })
  };

  const posisi = posisiTerhadapBep({ totalQty: bauran.totalQty, bepPorsi: bep.porsi });
  const ringkasan = ringkasanOwner({ penjualan, operasional, keuangan, bep });

  return {
    // SATU-SATUNYA sumber angka uang aktual.
    actual,
    // Estimasi akhir periode. Selalu berlabel `konteks: 'projected'` sampai ke
    // dalam objeknya, supaya angka proyeksi tidak bisa nyasar ke layar Actual
    // tanpa membawa labelnya sendiri.
    proyeksi,

    outlets,
    products,
    recipes,
    biaya,
    bauran,
    penjualan,
    operasional,
    kepatuhan,
    keuangan,
    biayaTetap,
    biayaOutlet,
    hargaOutlet,
    daftarBiaya,
    tetapDipakai,
    sumberBiayaTetap: pakaiDaftar ? 'daftar' : 'kas',
    bep,
    posisi,
    ringkasan
  };
}
