/**
 * Proyeksi akhir periode — 13 uji wajib.
 *
 * Dua yang paling menentukan:
 *
 *   UJI 6  — outlet tanpa penjualan TIDAK boleh memakai rata-rata BU.
 *            Mengisinya dengan rata-rata menghasilkan omzet karangan yang
 *            terlihat wajar dan menaikkan total BU tanpa satu pun tanda.
 *
 *   UJI 9  — proyeksi tidak boleh menyentuh objek aktual. Kalau ia memutasi
 *            masukannya, tab Actual akan berubah hanya karena tab Proyeksi
 *            pernah dibuka — dan penyebabnya nyaris mustahil dilacak.
 */
const { hitungHari, proyeksiOutlet, konsolidasiProyeksi, ringkasBuProyeksi } = await import(
  '../js/modules/owner/proyeksi.js'
);
const { hitungActualOutlet, konsolidasiOutlet, STATUS_BEP } = await import('../js/modules/owner/profit-outlet.js');

let gagal = 0;
const cek = (nama, dapat, harap) => {
  if (JSON.stringify(dapat) !== JSON.stringify(harap)) {
    gagal++;
    console.error(`❌ ${nama}\n   dapat : ${JSON.stringify(dapat)}\n   harap : ${JSON.stringify(harap)}`);
  }
};
const dekat = (nama, dapat, harap, toleransi = 1e-6) => {
  if (dapat == null || Math.abs(dapat - harap) > toleransi) {
    gagal++;
    console.error(`❌ ${nama}\n   dapat : ${dapat}\n   harap : ${harap}`);
  }
};
const benar = (nama, syarat, ket = '') => {
  if (!syarat) {
    gagal++;
    console.error(`❌ ${nama}${ket ? ' — ' + ket : ''}`);
  }
};

// =====================================================================
// HARI — penyebut run-rate. Salah satu hari menggeser seluruh proyeksi.
// =====================================================================
const h = hitungHari({ dari: '2026-08-01', sampai: '2026-08-31', hariIni: '2026-08-20' });
cek('hari periode Agustus', h.hariPeriode, 31);
cek('hari berjalan sampai 20 Agu', h.hariBerjalan, 20);
cek('sisa hari', h.sisaHari, 11);
cek('actual sampai', h.actualSampai, '2026-08-20');

// Periode sudah lewat -> seluruh hari berjalan, sisa 0.
const lewat = hitungHari({ dari: '2026-08-01', sampai: '2026-08-20', hariIni: '2026-09-05' });
cek('periode lewat: berjalan penuh', lewat.hariBerjalan, 20);
cek('periode lewat: sisa nol', lewat.sisaHari, 0);
cek('  actual berhenti di akhir periode, bukan hari ini', lewat.actualSampai, '2026-08-20');

// Periode belum mulai.
const belum = hitungHari({ dari: '2026-09-01', sampai: '2026-09-30', hariIni: '2026-08-20' });
cek('periode belum mulai: berjalan nol', belum.hariBerjalan, 0);
cek('  actualSampai null', belum.actualSampai, null);

// Hari pertama periode = 1 hari berjalan, bukan 0.
cek('hari pertama = 1', hitungHari({ dari: '2026-08-01', sampai: '2026-08-31', hariIni: '2026-08-01' }).hariBerjalan, 1);

// Februari kabisat & bulan 30 hari.
cek('Februari 2028 (kabisat)', hitungHari({ dari: '2028-02-01', sampai: '2028-02-29', hariIni: '2028-02-10' }).hariPeriode, 29);
cek('April 30 hari', hitungHari({ dari: '2026-04-01', sampai: '2026-04-30', hariIni: '2026-04-10' }).hariPeriode, 30);

// Masukan rusak.
benar('tanggal terbalik ditolak', hitungHari({ dari: '2026-08-31', sampai: '2026-08-01', hariIni: '2026-08-20' }).sebab != null);
benar('tanggal kosong ditolak', hitungHari({ dari: null, sampai: '2026-08-31' }).sebab != null);

// =====================================================================
// FIXTURE — angka §23 permintaan
// =====================================================================
const OUT = { id: 'o-a', name: 'Outlet A' };
const products = [{ id: 'p1', name: 'Menu' }];
const hpp = new Map([['p1', 4000]]); // 40% dari harga 10.000 -> rasio variabel 40%
const hargaOutlet = [{ outlet_id: 'o-a', product_id: 'p1', packaging_cost: 0 }];

const sales = [{ outlet_id: 'o-a', product_id: 'p1', qty: 8000, revenue: 80000000 }];
const biaya = [
  { name: 'Sewa A', jenis: 'tetap', satuan: 'per_bulan', amount: 15000000, outlet_id: 'o-a', allocation_scope: 'direct_outlet' },
  { name: 'Software', jenis: 'tetap', satuan: 'per_bulan', amount: 5000000, outlet_id: null, allocation_scope: 'shared_bu' },
  { name: 'Kantor pusat', jenis: 'tetap', satuan: 'per_bulan', amount: 30000000, outlet_id: null, allocation_scope: 'corporate' }
];

const actualA = hitungActualOutlet({ outlet: OUT, sales, products, hpp, hargaOutlet, biaya });
dekat('fixture: revenue aktual 80 juta', actualA.revenue, 80000000);
dekat('fixture: variabel 32 juta (40%)', actualA.variabel.total, 32000000);
dekat('fixture: CM 48 juta', actualA.cm, 48000000);

const proyA = proyeksiOutlet({ actual: actualA, hari: h });

// =====================================================================
// UJI 1 — Projected Revenue = 124 juta
// =====================================================================
dekat('1. laju harian 4 juta', proyA.rincian.lajuRevenueHarian, 4000000);
dekat('1. revenue sisa 11 hari = 44 juta', proyA.rincian.revenueSisa, 44000000);
dekat('1. PROJECTED REVENUE = 124 juta', proyA.revenue, 124000000);
cek('1. konteks projected', proyA.konteks, 'projected');

// Dua rumus §6 harus sama: actual + sisa == laju x total hari.
dekat('1. dua rumus §6 identik', proyA.revenue, (80000000 / 20) * 31, 1e-6);

// =====================================================================
// UJI 2 — Projected Variable Cost = 49,6 juta
// =====================================================================
dekat('2. rasio variabel dari AKTUAL', proyA.variabel.rasio, 0.4);
dekat('2. PROJECTED VARIABLE = 49,6 juta', proyA.variabel.total, 49600000);

// =====================================================================
// UJI 3 — Projected CM = 74,4 juta
// =====================================================================
dekat('3. PROJECTED CM = 74,4 juta', proyA.cm, 74400000);
dekat('3. CM% tetap 60%', proyA.cmPersen, 60);
dekat('3. CM = revenue − variabel', proyA.cm, proyA.revenue - proyA.variabel.total, 1e-6);

// =====================================================================
// UJI 4 — Projected Operating Profit = 59,4 juta
// =====================================================================
dekat('4. fixed TIDAK diskalakan (tetap 15 juta)', proyA.fixedLangsung, 15000000);
dekat('4. PROJECTED OP = 59,4 juta', proyA.operatingProfit, 59400000);

// Kalau fixed ikut dikalikan 31/20, OP-nya jadi 51,15 juta — angka yang tetap
// wajar dan tetap salah. Sewa tidak bertambah karena omzet bertambah.
benar('4. fixed tidak ikut run-rate', Math.abs(proyA.operatingProfit - (74400000 - 15000000 * (31 / 20))) > 1);

// Peringatan soal fixed harus DIKATAKAN, bukan cuma benar diam-diam.
benar('4. selisih actual/proyeksi dari fixed dijelaskan', proyA.peringatan.some((p) => /tidak ikut dikalikan/i.test(p)));

// =====================================================================
// UJI 5 — dua outlet, kinerja berbeda, dihitung masing-masing
// =====================================================================
const OUT_B = { id: 'o-b', name: 'Outlet B' };
const salesB = [{ outlet_id: 'o-b', product_id: 'p1', qty: 2000, revenue: 20000000 }];
const biayaB = [
  ...biaya,
  // Sewanya lebih mahal daripada A meski omzetnya seperempat — inilah outlet
  // yang tenggelam di dalam angka konsolidasi kalau BU hanya dilihat totalnya.
  { name: 'Sewa B', jenis: 'tetap', satuan: 'per_bulan', amount: 25000000, outlet_id: 'o-b', allocation_scope: 'direct_outlet' }
];
const actualB = hitungActualOutlet({ outlet: OUT_B, sales: salesB, products, hpp, hargaOutlet, biaya: biayaB });
const proyB = proyeksiOutlet({ actual: actualB, hari: h });

dekat('5. B: revenue proyeksi 31 juta', proyB.revenue, (20000000 / 20) * 31);
benar('5. A dan B beda proyeksi', proyA.revenue !== proyB.revenue);
benar('5. B rugi walau A untung', proyB.operatingProfit < 0 && proyA.operatingProfit > 0);

// =====================================================================
// UJI 6 — outlet tanpa penjualan: null, BUKAN rata-rata BU
// =====================================================================
const actualKosong = hitungActualOutlet({
  outlet: { id: 'o-c', name: 'Outlet C' },
  sales: [],
  products,
  hpp,
  hargaOutlet,
  biaya: []
});
const proyKosong = proyeksiOutlet({ actual: actualKosong, hari: h });

cek('6. tidak bisa diproyeksi', proyKosong.bisaDiproyeksi, false);
cek('6. revenue null, BUKAN 0', proyKosong.revenue, null);
cek('6. OP null', proyKosong.operatingProfit, null);
benar('6. sebabnya dikatakan', /belum ada penjualan/i.test(proyKosong.sebab));
cek('6. konteks tetap projected', proyKosong.konteks, 'projected');

// Dan yang paling penting: ia TIDAK menyumbang apa pun ke konsolidasi.
const konsTiga = konsolidasiProyeksi([proyA, proyB, proyKosong]);
dekat('6. konsolidasi = A + B saja', konsTiga.revenue, proyA.revenue + proyB.revenue, 1e-6);
cek('6. outlet tak terproyeksi dilaporkan', konsTiga.tidakBisaDiproyeksi.map((x) => x.outletName), ['Outlet C']);
cek('6. jumlah yang diproyeksi', konsTiga.jumlahDiproyeksi, 2);

// =====================================================================
// UJI 7 — hari berjalan < 7: tetap dihitung, TAPI diperingatkan
// =====================================================================
const hPendek = hitungHari({ dari: '2026-08-01', sampai: '2026-08-31', hariIni: '2026-08-03' });
const proyPendek = proyeksiOutlet({ actual: actualA, hari: hPendek });

cek('7. tetap bisa diproyeksi', proyPendek.bisaDiproyeksi, true);
benar('7. angkanya TIDAK diubah oleh peringatan', proyPendek.revenue === (80000000 / 3) * 31);
benar('7. peringatan keyakinan rendah muncul', proyPendek.peringatan.some((p) => /keyakinannya rendah/i.test(p)));
benar('7. peringatan menyebut jumlah harinya', proyPendek.peringatan.some((p) => /3 hari/.test(p)));

// 7 hari tepat: TIDAK diperingatkan (ambangnya `< 7`, bukan `<= 7`).
const hTujuh = hitungHari({ dari: '2026-08-01', sampai: '2026-08-31', hariIni: '2026-08-07' });
benar(
  '7. tepat 7 hari tidak diperingatkan',
  !proyeksiOutlet({ actual: actualA, hari: hTujuh }).peringatan.some((p) => /keyakinannya rendah/i.test(p))
);

// =====================================================================
// UJI 8 — hari berjalan = 0: proyeksi null
// =====================================================================
const proyBelum = proyeksiOutlet({ actual: actualA, hari: belum });
cek('8. belum mulai: tidak bisa diproyeksi', proyBelum.bisaDiproyeksi, false);
cek('8. revenue null', proyBelum.revenue, null);
benar('8. sebabnya dikatakan', /belum berjalan/i.test(proyBelum.sebab));

// =====================================================================
// UJI 9 — proyeksi TIDAK mengubah aktual
// =====================================================================
const salinanActual = JSON.stringify(actualA);
const salinanSales = JSON.stringify(sales);
const salinanBiaya = JSON.stringify(biaya);

proyeksiOutlet({ actual: actualA, hari: h });
konsolidasiProyeksi([proyA, proyB]);
ringkasBuProyeksi({ konsolidasi: konsTiga, biaya });

cek('9. objek aktual tidak dimutasi', JSON.stringify(actualA), salinanActual);
cek('9. sales tidak dimutasi', JSON.stringify(sales), salinanSales);
cek('9. outlet_costs tidak dimutasi', JSON.stringify(biaya), salinanBiaya);
dekat('9. aktual tetap 80 juta sesudah diproyeksi', actualA.revenue, 80000000);

// =====================================================================
// UJI 10 — konsolidasi = Σ proyeksi outlet
// =====================================================================
const kons = konsolidasiProyeksi([proyA, proyB]);
dekat('10. Σ revenue', kons.revenue, proyA.revenue + proyB.revenue, 1e-9);
dekat('10. Σ variabel', kons.variabel.total, proyA.variabel.total + proyB.variabel.total, 1e-9);
dekat('10. Σ CM', kons.cm, proyA.cm + proyB.cm, 1e-9);
dekat('10. Σ fixed', kons.fixedLangsung, proyA.fixedLangsung + proyB.fixedLangsung, 1e-9);
dekat('10. Σ OP', kons.operatingProfit, proyA.operatingProfit + proyB.operatingProfit, 1e-9);
dekat('10. OP = CM − fixed', kons.operatingProfit, kons.cm - kons.fixedLangsung, 1e-6);
cek('10. konteks projected', kons.konteks, 'projected');
benar('10. tidak ada BEP gabungan', kons.bep === undefined);

// =====================================================================
// UJI 11 — shared BU tidak masuk proyeksi outlet
// =====================================================================
dekat('11. fixed A hanya sewanya sendiri', proyA.fixedLangsung, 15000000);
benar('11. software (shared) tidak masuk outlet', proyA.fixedLangsung !== 15000000 + 5000000);

const buProy = ringkasBuProyeksi({ konsolidasi: kons, biaya });
dekat('11. shared muncul di BU', buProy.sharedBu, 5000000);
dekat('11. BU sebelum shared = Σ OP outlet', buProy.buProfitSebelumShared, kons.operatingProfit, 1e-9);
dekat('11. BU setelah shared', buProy.buProfitSetelahShared, kons.operatingProfit - 5000000, 1e-9);

// =====================================================================
// UJI 12 — corporate tetap terpisah
// =====================================================================
dekat('12. corporate muncul', buProy.corporate, 30000000);
benar('12. corporate TIDAK dikurangkan dari BU', buProy.buProfitSetelahShared === buProy.buProfitSebelumShared - buProy.sharedBu);
cek('12. konteks BU projected', buProy.konteks, 'projected');

// =====================================================================
// UJI 13 — tidak ada NaN / Infinity di mana pun
// =====================================================================
function periksaAngka(nama, obj, jalur = '') {
  if (obj == null) return;
  if (typeof obj === 'number') {
    if (Number.isNaN(obj)) return void (gagal++, console.error(`❌ 13. NaN di ${nama}${jalur}`));
    if (!Number.isFinite(obj)) return void (gagal++, console.error(`❌ 13. Infinity di ${nama}${jalur}`));
    return;
  }
  if (Array.isArray(obj)) return obj.forEach((v, i) => periksaAngka(nama, v, `${jalur}[${i}]`));
  if (typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) periksaAngka(nama, v, `${jalur}.${k}`);
  }
}

periksaAngka('proyA', proyA);
periksaAngka('proyB', proyB);
periksaAngka('proyKosong', proyKosong);
periksaAngka('proyBelum', proyBelum);
periksaAngka('konsolidasi', kons);
periksaAngka('ringkasBu', buProy);

// CM <= 0 -> BEP null, bukan angka palsu.
const actualRugi = hitungActualOutlet({
  outlet: { id: 'o-d', name: 'D' },
  sales: [{ outlet_id: 'o-d', product_id: 'p1', qty: 100, revenue: 300000 }],
  products,
  hpp: new Map([['p1', 5000]]), // HPP 5.000 > harga 3.000
  hargaOutlet: [{ outlet_id: 'o-d', product_id: 'p1', packaging_cost: 0 }],
  biaya: []
});
const proyRugi = proyeksiOutlet({ actual: actualRugi, hari: h });
benar('13. CM proyeksi negatif', proyRugi.cm < 0);
cek('13. BEP proyeksi null saat CM negatif', proyRugi.bep.revenue, null);
cek('13. status gap tidak mengarang', proyRugi.gap.status, STATUS_BEP.TIDAK_BISA);
periksaAngka('proyRugi', proyRugi);

// Konsolidasi kosong: null, bukan 0.
const konsKosong = konsolidasiProyeksi([proyKosong]);
cek('13. konsolidasi tanpa satu pun proyeksi: revenue null', konsKosong.revenue, null);
cek('13.   OP null', konsKosong.operatingProfit, null);
periksaAngka('konsKosong', konsKosong);

// =====================================================================
// PERIODE SELESAI -> PROYEKSI = AKTUAL
// =====================================================================
const actualLewat = hitungActualOutlet({ outlet: OUT, sales, products, hpp, hargaOutlet, biaya });
const proyLewat = proyeksiOutlet({ actual: actualLewat, hari: lewat });
dekat('periode selesai: proyeksi = aktual', proyLewat.revenue, actualLewat.revenue, 1e-9);
dekat('  OP proyeksi = OP aktual', proyLewat.operatingProfit, actualLewat.operatingProfit, 1e-6);
benar('  dikatakan bahwa periodenya sudah selesai', proyLewat.peringatan.some((p) => /sudah selesai/i.test(p)));

console.log(gagal === 0 ? '✅ proyeksi: semua lulus' : `❌ proyeksi: ${gagal} gagal`);
process.exit(gagal === 0 ? 0 : 1);
