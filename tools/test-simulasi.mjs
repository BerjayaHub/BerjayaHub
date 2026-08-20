/**
 * SIMULASI — 15 uji wajib.
 *
 * Tiga yang paling menentukan:
 *
 *   UJI 8–10 — simulasi tidak boleh menyentuh Actual, Projection, maupun Target.
 *              Diperiksa dengan membekukan JSON ketiganya SEBELUM simulasi dan
 *              membandingkannya sesudah. Kalau simulasi memutasi masukannya,
 *              angka bulan lalu berubah karena seseorang mengetik "bagaimana
 *              kalau" — dan penyebabnya nyaris mustahil dilacak.
 *
 *   UJI 15   — deterministik. Simulasi yang hasilnya bergeser tiap dijalankan
 *              membuat setiap perbandingan tidak bisa dipercaya.
 *
 *   DOUBLE COUNTING — Variable Cost % langsung TIDAK boleh ditambah komponennya.
 *                     Menambahkannya menghitung HPP dua kali dan membuat setiap
 *                     kenaikan harga terlihat tidak menolong apa pun.
 */
const { baselineSimulasi, simulasiOutlet, bandingkan, ringkasSimulasi, hargaSimulasi, MODE, SUSUNAN_VARIABEL } =
  await import('../js/modules/owner/simulasi.js');
const { hitungActualOutlet } = await import('../js/modules/owner/profit-outlet.js');
const { hitungHari, proyeksiOutlet } = await import('../js/modules/owner/proyeksi.js');
const { hitungTarget } = await import('../js/modules/owner/target.js');

let gagal = 0;
const cek = (nama, dapat, harap) => {
  if (JSON.stringify(dapat) !== JSON.stringify(harap)) {
    gagal++;
    console.error(`❌ ${nama}\n   dapat : ${JSON.stringify(dapat)}\n   harap : ${JSON.stringify(harap)}`);
  }
};
const dekat = (nama, dapat, harap, toleransi = 0.01) => {
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

function periksaAngka(nama, obj, jalur = '') {
  if (obj == null) return;
  if (typeof obj === 'number') {
    if (Number.isNaN(obj)) return void (gagal++, console.error(`❌ NaN di ${nama}${jalur}`));
    if (!Number.isFinite(obj)) return void (gagal++, console.error(`❌ Infinity di ${nama}${jalur}`));
    return;
  }
  if (Array.isArray(obj)) return obj.forEach((v, i) => periksaAngka(nama, v, `${jalur}[${i}]`));
  if (typeof obj === 'object') for (const [k, v] of Object.entries(obj)) periksaAngka(nama, v, `${jalur}.${k}`);
}

/** Outlet dengan transaksi: ASP 50.000, biaya variabel 40%, sewa Rp 50 juta. */
function outletBerjalan({ id = 'o-a', nama = 'Serpong', qty = 2000, asp = 50000, hpp = 20000, fixed = 50000000 } = {}) {
  return hitungActualOutlet({
    outlet: { id, name: nama },
    sales: [{ outlet_id: id, product_id: 'p1', qty, revenue: qty * asp }],
    products: [{ id: 'p1', name: 'Menu' }],
    hpp: new Map([['p1', hpp]]),
    hargaOutlet: [{ outlet_id: id, product_id: 'p1', packaging_cost: 0 }],
    biaya: [{ name: 'Sewa', jenis: 'tetap', satuan: 'per_bulan', amount: fixed, outlet_id: id, allocation_scope: 'direct_outlet' }]
  });
}

const aktualA = outletBerjalan();
const baseA = baselineSimulasi({ actual: aktualA });

dekat('baseline: ASP dari transaksi', baseA.asp.nilai, 50000, 1e-9);
dekat('baseline: variabel 40% dari CM aktual', baseA.variabelPersen.nilai, 40, 1e-9);
dekat('baseline: fixed dari outlet_costs', baseA.fixedBulanan.nilai, 50000000, 1e-9);
cek('baseline: berkonteks simulated', baseA.konteks, 'simulated');
cek('baseline: sumbernya aktual', baseA.asp.sumber, 'actual');

// =====================================================================
// UJI 1 — mode PORSI
// =====================================================================
const t1 = simulasiOutlet({
  baseline: baseA,
  input: { mode: MODE.UNIT, units: 3000, hariOperasional: 30, targetLaba: 20000000 }
});

dekat('1. omzet = 3.000 × 50.000 = 150 juta', t1.volume.revenue, 150000000, 0.5);
dekat('1. biaya variabel = 40% = 60 juta', t1.volume.variabelTotal, 60000000, 0.5);
dekat('1. CM = 90 juta', t1.volume.cm, 90000000, 0.5);
dekat('1. laba operasi = 40 juta', t1.volume.operatingProfit, 40000000, 0.5);
dekat('1. margin operasi = 26,67%', t1.volume.operatingMargin, 26.6667, 0.001);
cek('1. konteks simulated', t1.konteks, 'simulated');

// =====================================================================
// UJI 2 — mode OMZET (kebalikannya, hasil identik)
// =====================================================================
const t2 = simulasiOutlet({
  baseline: baseA,
  input: { mode: MODE.REVENUE, revenue: 150000000, hariOperasional: 30, targetLaba: 20000000 }
});

dekat('2. porsi = 150 juta ÷ 50.000 = 3.000', t2.volume.units, 3000, 1e-9);
dekat('2. laba operasi = 40 juta', t2.volume.operatingProfit, 40000000, 0.5);

// Dua arah pertanyaan yang sama HARUS bertemu di angka yang sama.
cek('2. dua mode menghasilkan volume identik', JSON.stringify({ ...t2.volume, mode: null }), JSON.stringify({ ...t1.volume, mode: null }));

// =====================================================================
// UJI 3 — biaya variabel turun 40% -> 35%
// =====================================================================
const t3 = simulasiOutlet({
  baseline: baseA,
  input: { mode: MODE.UNIT, units: 3000, hariOperasional: 30, targetLaba: 20000000, variabelPersen: 35 }
});

dekat('3. CM% naik jadi 65', t3.ekonomi.cmPersen, 65, 1e-9);
benar('3. laba naik', t3.volume.operatingProfit > t1.volume.operatingProfit);
dekat('3. laba = 150jt × 65% − 50jt', t3.volume.operatingProfit, 47500000, 0.5);
benar('3. BEP turun', t3.bep.revenueBulanan < t1.bep.revenueBulanan);
benar('3. target omzet turun', t3.target.revenueBulanan < t1.target.revenueBulanan);
dekat('3. target = 70jt / 65%', t3.target.revenueBulanan, 70000000 / 0.65, 0.5);

// =====================================================================
// UJI 4 — harga naik 50.000 -> 55.000
// =====================================================================
const t4 = simulasiOutlet({
  baseline: baseA,
  input: { mode: MODE.UNIT, units: 3000, hariOperasional: 30, targetLaba: 20000000, asp: 55000 }
});

// CM% tidak berubah (rasio dari baseline), jadi target OMZET tetap.
dekat('4. target omzet tetap', t4.target.revenueBulanan, t1.target.revenueBulanan, 0.5);
benar('4. target PORSI turun', t4.target.unitBulanan < t1.target.unitBulanan);
dekat('4. target porsi = target omzet ÷ 55.000', t4.target.unitBulanan, t1.target.revenueBulanan / 55000, 1e-6);
benar('4. BEP porsi ikut turun', t4.bep.unitBulanan < t1.bep.unitBulanan);

// Contoh §19 apa adanya.
const s19a = simulasiOutlet({ baseline: baseA, input: { hariOperasional: 30, variabelPersen: 40, asp: 50000, targetLaba: 0, fixedBulanan: 60000000 } });
const s19b = simulasiOutlet({ baseline: baseA, input: { hariOperasional: 30, variabelPersen: 40, asp: 55000, targetLaba: 0, fixedBulanan: 60000000 } });
dekat('4. §19 target omzet 100 juta', s19a.target.revenueBulanan, 100000000, 0.5);
dekat('4. §19   sama persis di harga baru', s19b.target.revenueBulanan, 100000000, 0.5);
dekat('4. §19 porsi @50.000 = 2.000', s19a.target.unitBulanan, 2000, 1e-6);
dekat('4. §19 porsi @55.000 ≈ 1.818', s19b.target.unitBulanan, 100000000 / 55000, 1e-6);
dekat('4. §19   yaitu ±1.818', s19b.target.unitBulanan, 1818.1818, 0.001);

// =====================================================================
// UJI 5 — biaya tetap naik 50 -> 60 juta
// =====================================================================
const t5 = simulasiOutlet({
  baseline: baseA,
  input: { mode: MODE.UNIT, units: 3000, hariOperasional: 30, targetLaba: 20000000, fixedBulanan: 60000000 }
});

benar('5. BEP naik', t5.bep.revenueBulanan > t1.bep.revenueBulanan);
dekat('5. BEP = 60jt / 60%', t5.bep.revenueBulanan, 100000000, 0.5);
benar('5. target omzet naik', t5.target.revenueBulanan > t1.target.revenueBulanan);
dekat('5. laba turun tepat 10 juta', t5.volume.operatingProfit, t1.volume.operatingProfit - 10000000, 0.5);

// =====================================================================
// UJI 6 — target laba 20 -> 30 juta
// =====================================================================
const t6 = simulasiOutlet({
  baseline: baseA,
  input: { mode: MODE.UNIT, units: 3000, hariOperasional: 30, targetLaba: 30000000 }
});

benar('6. target omzet naik', t6.target.revenueBulanan > t1.target.revenueBulanan);
dekat('6. target = 80jt / 60%', t6.target.revenueBulanan, 80000000 / 0.6, 0.5);
benar('6. target porsi naik', t6.target.unitBulanan > t1.target.unitBulanan);

// BEP tidak ikut bergeser — ia target dengan laba nol, bukan turunan target laba.
dekat('6. BEP tidak berubah', t6.bep.revenueBulanan, t1.bep.revenueBulanan, 1e-9);

// Target laba 0 == BEP, persis.
const tNol = simulasiOutlet({ baseline: baseA, input: { hariOperasional: 30, targetLaba: 0 } });
cek('6. target laba 0 = BEP', tNol.target.revenueBulanan, tNol.bep.revenueBulanan);
cek('6.   porsinya juga', tNol.target.unitBulanan, tNol.bep.unitBulanan);

// =====================================================================
// UJI 7 — baseline dari asumsi Target 10A saat belum ada transaksi
// =====================================================================
const outletBaru = hitungActualOutlet({
  outlet: { id: 'o-baru', name: 'AB Sentul' },
  sales: [],
  products: [],
  hpp: new Map(),
  hargaOutlet: [],
  biaya: [{ name: 'Sewa', jenis: 'tetap', satuan: 'per_bulan', amount: 40000000, outlet_id: 'o-baru', allocation_scope: 'direct_outlet' }]
});

const baseKosong = baselineSimulasi({ actual: outletBaru });
cek('7. tanpa rencana: ASP kosong', baseKosong.asp.nilai, null);
cek('7. tanpa rencana: variabel kosong', baseKosong.variabelPersen.nilai, null);
dekat('7. fixed tetap terbaca dari outlet_costs', baseKosong.fixedBulanan.nilai, 40000000, 1e-9);
cek('7. adaTransaksi false', baseKosong.adaTransaksi, false);

// Dengan asumsi perencanaan dari Target 10A -> baseline lengkap.
const baseRencana = baselineSimulasi({ actual: outletBaru, rencana: { asp: 45000, variabelPersen: 40 } });
dekat('7. ASP dari rencana', baseRencana.asp.nilai, 45000, 1e-9);
cek('7. sumbernya planning', baseRencana.asp.sumber, 'planning');
cek('7. variabel juga planning', baseRencana.variabelPersen.sumber, 'planning');
cek('7. fixed tetap actual', baseRencana.fixedBulanan.sumber, 'actual');

const t7 = simulasiOutlet({ baseline: baseRencana, input: { hariOperasional: 30, targetLaba: 30000000 } });
cek('7. bisa disimulasikan tanpa satu pun transaksi', t7.bisaDihitung, true);
dekat('7. BEP = 40jt / 60%', t7.bep.revenueBulanan, 66666666.67, 0.5);
dekat('7. target = 70jt / 60%', t7.target.revenueBulanan, 116666666.67, 0.5);
dekat('7. target porsi = ÷ 45.000', t7.target.unitBulanan, 116666666.67 / 45000, 0.001);

// Dan angkanya sama persis dengan Target 10A pada asumsi yang sama — dua modul
// berbeda, satu ekonomi. Kalau berbeda, salah satunya punya rumus sendiri.
const target10a = hitungTarget({
  actual: outletBaru,
  targetLabaBulanan: 30000000,
  hariOperasional: 30,
  asumsi: { variabelPersen: 40, asp: 45000 }
});
dekat('7. simulasi baseline = Target 10A (omzet)', t7.target.revenueBulanan, target10a.target.revenueBulanan, 0.01);
dekat('7. simulasi baseline = Target 10A (porsi)', t7.target.unitBulanan, target10a.target.unitBulanan, 1e-6);
dekat('7. simulasi baseline = Target 10A (BEP)', t7.bep.revenueBulanan, target10a.bep.revenueBulanan, 0.01);

// =====================================================================
// UJI 8, 9, 10 — ACTUAL, PROJECTION, dan TARGET tidak berubah
// =====================================================================
const aktualIso = outletBerjalan({ id: 'o-iso', nama: 'Isolasi' });
const hariIso = hitungHari({ dari: '2026-08-01', sampai: '2026-08-31', hariIni: '2026-08-20' });

const proySebelum = proyeksiOutlet({ actual: aktualIso, hari: hariIso });
const targetSebelum = hitungTarget({ actual: aktualIso, targetLabaBulanan: 20000000, hariOperasional: 30 });

const bekuAktual = JSON.stringify(aktualIso);
const bekuProy = JSON.stringify(proySebelum);
const bekuTarget = JSON.stringify(targetSebelum);

// Digempur dengan asumsi yang jauh berbeda, berkali-kali.
const baseIso = baselineSimulasi({ actual: aktualIso });
for (let i = 0; i < 50; i++) {
  const s = simulasiOutlet({
    baseline: baseIso,
    input: {
      mode: i % 2 ? MODE.UNIT : MODE.REVENUE,
      units: 1000 + i * 37,
      revenue: 90000000 + i * 1000000,
      asp: 40000 + i * 500,
      variabelPersen: 20 + (i % 60),
      fixedBulanan: 10000000 + i * 250000,
      hariOperasional: 20 + (i % 12),
      targetLaba: i * 500000,
      promoPersen: i % 30,
      feePersen: i % 25,
      hppSatuan: 15000 + i * 10,
      kemasanSatuan: 500
    }
  });
  bandingkan({ baseline: simulasiOutlet({ baseline: baseIso, input: { hariOperasional: 30 }, peran: 'baseline' }), simulasi: s });
  ringkasSimulasi([s]);
}

cek('8. ACTUAL tidak berubah setelah 50 simulasi', JSON.stringify(aktualIso), bekuAktual);
dekat('8.   omzet aktual tetap', aktualIso.revenue, 100000000, 1e-9);
dekat('8.   CM% aktual tetap 60', aktualIso.cmPersen, 60, 1e-9);

cek('9. PROJECTION tidak berubah', JSON.stringify(proyeksiOutlet({ actual: aktualIso, hari: hariIso })), bekuProy);
cek('9.   objek proyeksi lama pun utuh', JSON.stringify(proySebelum), bekuProy);

cek('10. TARGET tidak berubah', JSON.stringify(hitungTarget({ actual: aktualIso, targetLabaBulanan: 20000000, hariOperasional: 30 })), bekuTarget);
cek('10.   objek target lama pun utuh', JSON.stringify(targetSebelum), bekuTarget);

// Baseline sendiri juga tidak boleh dimutasi oleh simulasi yang memakainya.
const bekuBaseline = JSON.stringify(baseIso);
simulasiOutlet({ baseline: baseIso, input: { asp: 999999, variabelPersen: 5, fixedBulanan: 1 } });
cek('8–10. objek baseline tidak dimutasi', JSON.stringify(baseIso), bekuBaseline);

// =====================================================================
// UJI 11 — dua outlet tetap terpisah
// =====================================================================
const aktualB = outletBerjalan({ id: 'o-b', nama: 'Sentul', qty: 1000, asp: 45000, hpp: 20250, fixed: 40000000 });
const baseB = baselineSimulasi({ actual: aktualB });

dekat('11. B: ASP 45.000', baseB.asp.nilai, 45000, 1e-9);
dekat('11. B: variabel 45%', baseB.variabelPersen.nilai, 45, 1e-9);
benar('11. ekonomi A dan B berbeda', baseA.variabelPersen.nilai !== baseB.variabelPersen.nilai);

const simA = simulasiOutlet({ baseline: baseA, input: { hariOperasional: 30, targetLaba: 20000000 } });
const simB = simulasiOutlet({ baseline: baseB, input: { hariOperasional: 26, targetLaba: 20000000 } });

benar('11. BEP A ≠ BEP B', simA.bep.revenueBulanan !== simB.bep.revenueBulanan);
dekat('11. B pakai 26 hari, bukan 30', simB.target.revenueHarian, simB.target.revenueBulanan / 26, 1e-6);
dekat('11. B BEP = 40jt / 55%', simB.bep.revenueBulanan, 40000000 / 0.55, 0.5);

const simAvol = simulasiOutlet({ baseline: baseA, input: { hariOperasional: 30, mode: MODE.UNIT, units: 3000 } });
const simBvol = simulasiOutlet({ baseline: baseB, input: { hariOperasional: 26, mode: MODE.UNIT, units: 1000 } });
const ring = ringkasSimulasi([simAvol, simBvol]);

cek('11. labelnya eksplisit', ring.label, 'SUM OF OUTLET SIMULATIONS');
cek('11. dinyatakan bukan BEP gabungan', ring.bepGabungan, false);
benar('11. tidak ada BEP di ringkasan', ring.bep === undefined);
cek('11. konteks simulated', ring.konteks, 'simulated');
dekat('11. Σ omzet = A + B', ring.revenue, simAvol.volume.revenue + simBvol.volume.revenue, 1e-6);
dekat('11. Σ laba = A + B', ring.operatingProfit, simAvol.volume.operatingProfit + simBvol.volume.operatingProfit, 1e-6);

// Outlet yang CM-nya rusak TIDAK ikut dijumlahkan — dan itu bukan sekadar
// kerapian. Menjumlahkannya berarti menambahkan biaya tetapnya ke total sambil
// mengabaikan bahwa outlet itu tidak punya titik impas sama sekali; totalnya
// jadi angka yang tidak menjawab pertanyaan apa pun.
const simRusak = simulasiOutlet({
  baseline: baseB,
  input: { hariOperasional: 26, variabelPersen: 140, mode: MODE.UNIT, units: 500 }
});
cek('11. outlet rusak: tidak bisa dihitung', simRusak.bisaDihitung, false);

const ringCampur = ringkasSimulasi([simAvol, simBvol, simRusak]);
dekat('11. Σ tetap A + B saja', ringCampur.revenue, ring.revenue, 1e-6);
dekat('11.   labanya juga', ringCampur.operatingProfit, ring.operatingProfit, 1e-6);
cek('11.   yang dikeluarkan dilaporkan', ringCampur.tidakBisaDihitung.map((o) => o.outletName), ['Sentul']);
cek('11.   jumlah yang terhitung', ringCampur.jumlahDihitung, 2);
cek('11.   jumlah seluruhnya tetap 3', ringCampur.jumlahOutlet, 3);

// Tidak ada satu pun yang terhitung -> null, bukan 0.
const ringKosong = ringkasSimulasi([simRusak]);
cek('11. tanpa outlet terhitung: omzet null', ringKosong.revenue, null);
cek('11.   labanya null', ringKosong.operatingProfit, null);
cek('11.   marginnya null', ringKosong.operatingMargin, null);

// =====================================================================
// UJI 12 — kasus batas
// =====================================================================

// CM ≤ 0
const cmMinus = simulasiOutlet({ baseline: baseA, input: { hariOperasional: 30, variabelPersen: 130, units: 100, mode: MODE.UNIT } });
cek('12. CM negatif: tidak bisa dihitung', cmMinus.bisaDihitung, false);
cek('12.   BEP null', cmMinus.bep.revenueBulanan, null);
cek('12.   target null', cmMinus.target.revenueBulanan, null);
benar('12.   sebabnya dikatakan', /NEGATIF/.test(cmMinus.sebab ?? ''));
benar('12.   laba tetap dihitung apa adanya (rugi)', cmMinus.volume.operatingProfit < 0);

const cmNol = simulasiOutlet({ baseline: baseA, input: { hariOperasional: 30, variabelPersen: 100 } });
cek('12. CM nol: BEP null, bukan Infinity', cmNol.bep.revenueBulanan, null);

// ASP ≤ 0 -> mode omzet tetap jalan, porsi tidak
const aspNol = simulasiOutlet({ baseline: baseA, input: { hariOperasional: 30, asp: 0, mode: MODE.REVENUE, revenue: 100000000 } });
dekat('12. ASP 0: omzet tetap terpakai', aspNol.volume.revenue, 100000000, 0.5);
cek('12.   porsi null', aspNol.volume.units, null);
cek('12.   BEP porsi null', aspNol.bep.unitBulanan, null);
benar('12.   BEP omzet tetap ada', aspNol.bep.revenueBulanan > 0);

// ASP ≤ 0 + mode porsi -> tidak bisa
const aspNolUnit = simulasiOutlet({ baseline: baseA, input: { hariOperasional: 30, asp: 0, mode: MODE.UNIT, units: 100 } });
cek('12. ASP 0 + mode porsi: omzet null', aspNolUnit.volume.revenue, null);
benar('12.   sebabnya dikatakan', /tanpa harga jual/i.test(aspNolUnit.sebab ?? ''));

// Hari ≤ 0
const hariNol = simulasiOutlet({ baseline: baseA, input: { hariOperasional: 0, targetLaba: 20000000 } });
cek('12. hari 0: BEP harian null', hariNol.bep.revenueHarian, null);
benar('12.   bulanan tetap ada', hariNol.bep.revenueBulanan > 0);

// Biaya tetap 0 -> BEP 0
const fixedNol = simulasiOutlet({ baseline: baseA, input: { hariOperasional: 30, fixedBulanan: 0 } });
cek('12. fixed 0 -> BEP omzet 0', fixedNol.bep.revenueBulanan, 0);
cek('12.   BEP porsi 0', fixedNol.bep.unitBulanan, 0);

// Omzet 0 -> margin null
const revNol = simulasiOutlet({ baseline: baseA, input: { hariOperasional: 30, mode: MODE.REVENUE, revenue: 0 } });
cek('12. omzet 0: margin null', revNol.volume.operatingMargin, null);
cek('12.   porsi 0', revNol.volume.units, 0);
benar('12.   labanya = minus biaya tetap', revNol.volume.operatingProfit === -50000000);

// Porsi 0 -> omzet 0
const unitNol = simulasiOutlet({ baseline: baseA, input: { hariOperasional: 30, mode: MODE.UNIT, units: 0 } });
cek('12. porsi 0 -> omzet 0', unitNol.volume.revenue, 0);

// Porsi & omzet negatif ditolak
const unitMinus = simulasiOutlet({ baseline: baseA, input: { hariOperasional: 30, mode: MODE.UNIT, units: -100 } });
cek('12. porsi negatif ditolak', unitMinus.volume.units, null);
cek('12.   omzetnya juga null', unitMinus.volume.revenue, null);
benar('12.   sebabnya dikatakan', /tidak boleh negatif/i.test(unitMinus.sebab ?? ''));

const revMinus = simulasiOutlet({ baseline: baseA, input: { hariOperasional: 30, mode: MODE.REVENUE, revenue: -5000 } });
cek('12. omzet negatif ditolak', revMinus.volume.revenue, null);

// Tidak ada porsi negatif di mana pun.
for (const [nama, s] of Object.entries({ t1, t2, t3, t4, t5, t6, t7, simA, simB, fixedNol, revNol, unitNol })) {
  benar(`12. ${nama}: porsi tidak negatif`, (s.volume.units ?? 0) >= 0);
  benar(`12. ${nama}: BEP porsi tidak negatif`, (s.bep.unitBulanan ?? 0) >= 0);
  benar(`12. ${nama}: target porsi tidak negatif`, (s.target.unitBulanan ?? 0) >= 0);
}

for (const [nama, o] of Object.entries({
  t1, t2, t3, t4, t5, t6, t7, tNol, simA, simB, ring,
  cmMinus, cmNol, aspNol, aspNolUnit, hariNol, fixedNol, revNol, unitNol, unitMinus, revMinus
})) {
  periksaAngka(nama, o);
}

// =====================================================================
// UJI 13 — metode harga
// =====================================================================
const fc = hargaSimulasi({ metode: 'food_cost', persen: 35, hpp: 17500 });
dekat('13. food cost 35%: 17.500 ÷ 0,35 = 50.000', fc.harga, 50000, 0.01);

const mk = hargaSimulasi({ metode: 'markup', persen: 150, hpp: 20000 });
dekat('13. markup 150%: 20.000 × 2,5 = 50.000', mk.harga, 50000, 0.01);

const mg = hargaSimulasi({ metode: 'margin', persen: 60, hpp: 20000 });
dekat('13. margin 60%: 20.000 ÷ 0,4 = 50.000', mg.harga, 50000, 0.01);

// Kemasan ikut masuk ke dasar harga — dan ke margin.
const dgnKemasan = hargaSimulasi({ metode: 'food_cost', persen: 35, hpp: 17500, kemasan: 3500 });
dekat('13. kemasan menaikkan dasar harga', dgnKemasan.harga, 21000 / 0.35, 0.01);
dekat('13. CM/porsi dihitung dari HPP+kemasan', dgnKemasan.cmSatuan, 21000 / 0.35 - 21000, 0.01);
dekat('13. CM% = 65', dgnKemasan.cmPersen, 65, 1e-9);

// BIAYA TETAP TIDAK BOLEH MASUK KE HARGA.
//
// Membebankan sewa ke tiap porsi membuat harga NAIK ketika penjualan TURUN —
// persis kebalikan dari yang seharusnya. Diuji dengan membuktikan harga tidak
// bergeser sama sekali oleh biaya tetap.
const hargaTanpaFixed = hargaSimulasi({ metode: 'margin', persen: 60, hpp: 20000 });
cek('13. biaya tetap tidak memengaruhi harga', hargaTanpaFixed.harga, mg.harga);
benar('13. hargaSimulasi tidak menerima biaya tetap', !('fixedBulanan' in hargaTanpaFixed));

// Harga online menutup potongan — arahnya tidak intuitif dan itu yang diuji.
const online = hargaSimulasi({ metode: 'margin', persen: 60, hpp: 20000, feePersen: 20 });
dekat('13. harga online = 50.000 ÷ 0,8 = 62.500', online.hargaOnline, 62500, 0.01);
benar('13.   bukan 50.000 × 1,2 = 60.000', Math.abs(online.hargaOnline - 60000) > 1);

// HPP kosong -> harga null, BUKAN sebesar kemasan saja.
const tanpaHpp = hargaSimulasi({ metode: 'food_cost', persen: 35, hpp: null, kemasan: 3500 });
cek('13. HPP kosong -> harga null', tanpaHpp.harga, null);
benar('13.   sebabnya dikatakan', /HPP belum ada/i.test(tanpaHpp.sebab ?? ''));

// Persentase yang tidak bermakna -> null, bukan Infinity.
cek('13. food cost 0% -> null', hargaSimulasi({ metode: 'food_cost', persen: 0, hpp: 20000 }).harga, null);
cek('13. margin 100% -> null', hargaSimulasi({ metode: 'margin', persen: 100, hpp: 20000 }).harga, null);

for (const [nama, o] of Object.entries({ fc, mk, mg, dgnKemasan, online, tanpaHpp })) periksaAngka(nama, o);

// =====================================================================
// UJI 14 — perbandingan baseline vs simulasi
// =====================================================================
const dasar14 = simulasiOutlet({
  baseline: baseA,
  input: { hariOperasional: 30, targetLaba: 20000000, mode: MODE.UNIT, units: 3000 },
  peran: 'baseline'
});
const sim14 = simulasiOutlet({
  baseline: baseA,
  input: { hariOperasional: 30, targetLaba: 20000000, mode: MODE.UNIT, units: 3000, asp: 55000, variabelPersen: 35 }
});
const banding = bandingkan({ baseline: dasar14, simulasi: sim14 });

const ambil = (label) => banding.baris.find((b) => b.label === label);

cek('14. konteks simulated', banding.konteks, 'simulated');
dekat('14. ASP: 50.000 -> 55.000, delta +5.000', ambil('Harga jual efektif').delta, 5000, 1e-9);
dekat('14. Variable Cost %: delta −5 pp', ambil('Variable Cost %').delta, -5, 1e-9);
dekat('14. CM%: delta +5 pp', ambil('Contribution Margin %').delta, 5, 1e-9);

dekat('14. BEP baseline = 83,33 juta', ambil('BEP Omzet / bulan').baseline, 83333333.33, 0.5);
dekat('14. BEP simulasi = 76,92 juta', ambil('BEP Omzet / bulan').simulasi, 50000000 / 0.65, 0.5);
dekat('14. BEP delta ≈ −6,41 juta', ambil('BEP Omzet / bulan').delta, 50000000 / 0.65 - 83333333.33, 1);

dekat('14. target baseline = 116,67 juta', ambil('Target Omzet / bulan').baseline, 116666666.67, 0.5);
dekat('14. target simulasi = 107,69 juta', ambil('Target Omzet / bulan').simulasi, 70000000 / 0.65, 0.5);
dekat('14. target delta ≈ −8,97 juta', ambil('Target Omzet / bulan').delta, 70000000 / 0.65 - 116666666.67, 1);

// Delta selalu simulasi − baseline, di setiap baris tanpa kecuali.
for (const b of banding.baris) {
  if (b.baseline == null || b.simulasi == null) continue;
  dekat(`14. delta "${b.label}" = simulasi − baseline`, b.delta, b.simulasi - b.baseline, 1e-6);
}

// Arah "baik" dinyatakan per baris. BEP yang turun itu kabar baik; laba yang
// turun bukan. Layar yang mewarnai semuanya dengan satu aturan akan
// menghijaukan BEP yang membengkak.
cek('14. BEP: turun itu baik', ambil('BEP Omzet / bulan').naikBaik, false);
cek('14. laba: naik itu baik', ambil('Operating Profit').naikBaik, true);
cek('14. Variable Cost %: turun itu baik', ambil('Variable Cost %').naikBaik, false);
cek('14. CM%: naik itu baik', ambil('Contribution Margin %').naikBaik, true);

// Baris yang salah satu sisinya kosong -> delta null, bukan angka penuh.
const bandingKosong = bandingkan({
  baseline: simulasiOutlet({ baseline: baseKosong, input: { hariOperasional: 30 }, peran: 'baseline' }),
  simulasi: sim14
});
benar('14. sisi kosong -> delta null', bandingKosong.baris.some((b) => b.baseline == null && b.delta == null));
periksaAngka('banding', banding);
periksaAngka('bandingKosong', bandingKosong);

// =====================================================================
// UJI 15 — deterministik
// =====================================================================
const masukan = {
  mode: MODE.UNIT,
  units: 2750,
  asp: 52500,
  variabelPersen: 38,
  fixedBulanan: 47500000,
  hariOperasional: 27,
  targetLaba: 17500000,
  promoPersen: 5,
  feePersen: 18
};

const jalan = [];
for (let i = 0; i < 25; i++) jalan.push(JSON.stringify(simulasiOutlet({ baseline: baseA, input: masukan })));
benar('15. 25 kali dijalankan, hasilnya identik', new Set(jalan).size === 1);

const banding15 = [];
for (let i = 0; i < 25; i++) {
  banding15.push(JSON.stringify(bandingkan({ baseline: dasar14, simulasi: simulasiOutlet({ baseline: baseA, input: masukan }) })));
}
benar('15. perbandingannya juga identik', new Set(banding15).size === 1);

// =====================================================================
// DOUBLE COUNTING — potongan tidak boleh dihitung dua kali
// =====================================================================

// Promo memotong HARGA, bukan menambah biaya.
const promo = simulasiOutlet({
  baseline: baseA,
  input: { hariOperasional: 30, asp: 50000, promoPersen: 10, variabelPersen: 40, mode: MODE.UNIT, units: 1000 }
});
dekat('promo 10%: harga efektif 45.000', promo.ekonomi.aspEfektif, 45000, 1e-9);
dekat('promo: omzet 1.000 × 45.000', promo.volume.revenue, 45000000, 0.5);
dekat('promo: biaya variabel tetap 40% dari omzet', promo.volume.variabelTotal, 18000000, 0.5);
dekat('promo: CM% tetap 60', promo.ekonomi.cmPersen, 60, 1e-9);

// Variable Cost % LANGSUNG menang; komponennya tidak ditambahkan di atasnya.
const campur = simulasiOutlet({
  baseline: baseA,
  input: { hariOperasional: 30, asp: 50000, variabelPersen: 40, hppSatuan: 20000, kemasanSatuan: 2000, feePersen: 15 }
});
dekat('double count: variabel tetap 40%, bukan 40+44+15', campur.ekonomi.variabelPersen, 40, 1e-9);
cek('double count: susunannya "langsung"', campur.ekonomi.susunanVariabel, SUSUNAN_VARIABEL.LANGSUNG);
benar('double count: percampurannya DIKATAKAN', campur.peringatan.some((p) => /TIDAK ditambahkan lagi/i.test(p)));

// Tanpa angka langsung, komponennya yang menyusun — sekali saja.
const terurai = simulasiOutlet({
  baseline: baseA,
  input: { hariOperasional: 30, asp: 50000, hppSatuan: 20000, kemasanSatuan: 2000, feePersen: 15 }
});
dekat('terurai: (22.000/50.000) + 15% = 59%', terurai.ekonomi.variabelPersen, 59, 1e-9);
cek('terurai: susunannya "terurai"', terurai.ekonomi.susunanVariabel, SUSUNAN_VARIABEL.TERURAI);
dekat('terurai: CM% = 41', terurai.ekonomi.cmPersen, 41, 1e-9);

// Fee memotong omzet SEKALI, promo memotong harga SEKALI — tidak tumpang tindih.
const keduanya = simulasiOutlet({
  baseline: baseA,
  input: { hariOperasional: 30, asp: 50000, promoPersen: 10, hppSatuan: 18000, kemasanSatuan: 0, feePersen: 20, mode: MODE.UNIT, units: 1000 }
});
dekat('promo+fee: harga efektif 45.000', keduanya.ekonomi.aspEfektif, 45000, 1e-9);
dekat('promo+fee: variabel = 18.000/45.000 + 20% = 60%', keduanya.ekonomi.variabelPersen, 60, 1e-9);
dekat('promo+fee: omzet 45 juta', keduanya.volume.revenue, 45000000, 0.5);
dekat('promo+fee: CM 40% = 18 juta', keduanya.volume.cm, 18000000, 0.5);

// Tanpa asumsi apa pun, simulasi = baseline. Titik awal yang tidak bergeser.
const netral = simulasiOutlet({ baseline: baseA, input: { hariOperasional: 30, targetLaba: 20000000 } });
dekat('netral: CM% = CM aktual', netral.ekonomi.cmPersen, aktualA.cmPersen, 1e-9);
dekat('netral: ASP = ASP aktual', netral.ekonomi.aspEfektif, aktualA.asp, 1e-9);
dekat('netral: BEP = BEP aktual', netral.bep.revenueBulanan, aktualA.bep.revenue, 0.01);
cek('netral: susunannya dari baseline', netral.ekonomi.susunanVariabel, SUSUNAN_VARIABEL.BASELINE);

for (const [nama, o] of Object.entries({ promo, campur, terurai, keduanya, netral })) periksaAngka(nama, o);

console.log(gagal === 0 ? '✅ simulasi: semua lulus' : `❌ simulasi: ${gagal} gagal`);
process.exit(gagal === 0 ? 0 : 1);
