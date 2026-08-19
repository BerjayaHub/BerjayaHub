import { computeCosts } from '../product/hpp.js';
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
import { bauranPenjualan, biayaTetapDariKas, hitungBep, posisiTerhadapBep } from './bep.js';
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

  return hitung({ ...mentah, hariKerja, targetLaba });
}

async function ambilMentah({ businessUnitId, dari, sampai, outletIds }) {
  const outlets = await listOutletsBu(businessUnitId);
  // Kas dicakup lewat OUTLET, bukan BU — lihat 0093 bagian (4). Kalau tidak ada
  // penyaringan outlet, dipakai seluruh outlet BU ini.
  const outletKas = outletIds?.length ? outletIds : outlets.map((o) => o.id);

  const [products, recipes, sales, gerakan, saldo, produksi, entriKas, kategoriKas, checklist, presensi] = await Promise.all([
    listProductsOwner(businessUnitId),
    listRecipesFull(businessUnitId),
    listSales({ businessUnitId, dari, sampai, outletIds }),
    listStockMovements({ businessUnitId, dari, sampai, outletIds }),
    listStockBalances({ businessUnitId, outletIds }),
    listProductionRuns({ businessUnitId, dari, sampai, outletIds }),
    listCashEntries({ outletIds: outletKas, dari, sampai }),
    listCashCategories(),
    listChecklist({ businessUnitId, dari, sampai, outletIds }),
    listAttendance({ businessUnitId, dari, sampai, outletIds })
  ]);

  return { outlets, products, recipes, sales, gerakan, saldo, produksi, entriKas, kategoriKas, checklist, presensi };
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
  hariKerja,
  targetLaba
}) {
  const biaya = computeCosts(products, recipes);
  const bauran = bauranPenjualan({ sales, products, biaya });

  const penjualan = kpiPenjualan(bauran, hariAdaPenjualan(sales));
  const operasional = kpiOperasional({ gerakan, saldo, produksi, products });
  const kepatuhan = kpiKepatuhan({ runs: checklist.runs, items: checklist.items, presensi });

  const biayaTetap = biayaTetapDariKas(entriKas, kategoriKas);
  const keuangan = kpiKeuangan({ biayaTetap, entri: entriKas, omzet: penjualan.omzet });

  const bep = hitungBep({
    marginSatuan: bauran.marginTertimbang,
    hargaRata: bauran.hargaTertimbang,
    biayaTetap: biayaTetap.total,
    targetLaba,
    hariKerja
  });

  const posisi = posisiTerhadapBep({ totalQty: bauran.totalQty, bepPorsi: bep.porsi });
  const ringkasan = ringkasanOwner({ penjualan, operasional, keuangan, bep });

  return {
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
    bep,
    posisi,
    ringkasan
  };
}
