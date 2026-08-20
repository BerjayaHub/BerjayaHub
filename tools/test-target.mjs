/**
 * TARGET / PLANNING — 12 uji wajib.
 *
 * Tiga yang paling menentukan:
 *
 *   UJI 5  — Target laba 0 HARUS sama persis dengan BEP. Kalau keduanya lahir
 *            dari rumus berbeda, selisih sekecil apa pun akan tampak sebagai
 *            "BEP ≠ target laba nol" yang mustahil dijelaskan ke siapa pun.
 *
 *   UJI 9  — mengubah asumsi perencanaan tidak boleh menyentuh Actual maupun
 *            Projection. Kalau ia menyentuh, angka bulan lalu berubah karena
 *            seseorang mengetik di kotak target.
 *
 *   UJI 11 — konsolidasi wajib penjumlahan. Biaya tetap total dibagi CM
 *            rata-rata menghasilkan target yang selalu lebih ringan, dan
 *            selisihnya persis sebesar yang disembunyikan outlet bermargin tipis.
 */
const { hitungTarget, konsolidasiTarget, ringkasBuTarget, pencapaianTarget, ekonomiTarget, STATUS_TARGET, STATUS_HITUNG } =
  await import('../js/modules/owner/target.js');
const { hitungActualOutlet } = await import('../js/modules/owner/profit-outlet.js');
const { hitungHari, proyeksiOutlet } = await import('../js/modules/owner/proyeksi.js');

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

/**
 * Objek ekonomi outlet berbentuk keluaran `hitungActualOutlet()`.
 *
 * Dipakai untuk uji angka murni §29 supaya rasio & ASP-nya persis seperti yang
 * ditulis di spesifikasi. Integrasi dengan mesin Actual yang sungguhan diuji
 * terpisah di bagian INTEGRASI di bawah.
 */
function ekonomi({ nama = 'O', revenue = 100000000, rasioVariabel = 0.4, fixed = 50000000, asp = 50000 }) {
  const units = asp ? revenue / asp : 0;
  const variabel = revenue * rasioVariabel;
  const cm = revenue - variabel;
  return {
    konteks: 'actual',
    outletId: `id-${nama}`,
    outletName: nama,
    revenue,
    units,
    asp: revenue > 0 && units > 0 ? revenue / units : null,
    variabel: { total: variabel },
    cm,
    cmPersen: revenue > 0 ? (cm / revenue) * 100 : null,
    fixedLangsung: fixed,
    // Tanpa biaya -> tanpa baris. Baris "Sewa Rp 0" adalah fixture yang tidak
    // pernah lahir dari data sungguhan, dan ia menyamarkan justru perbedaan yang
    // sedang diuji: belum ada biaya vs biayanya nol.
    rincianFixed: fixed === 0 ? [] : [{ nama: 'Sewa', jumlah: fixed, sifat: 'fixed' }],
    operatingProfit: cm - fixed
  };
}

// =====================================================================
// UJI 1 — BEP omzet
// =====================================================================
const t1 = hitungTarget({ actual: ekonomi({}), hariOperasional: 30 });

dekat('1. CM% = 60', t1.rincian.cmPersen, 60, 1e-9);
dekat('1. rasio variabel = 40%', t1.rincian.variabelPersen, 40, 1e-9);
dekat('1. BEP omzet/bulan = 83.333.333', t1.bep.revenueBulanan, 83333333.33, 0.5);
dekat('1. BEP omzet/hari = 2.777.778', t1.bep.revenueHarian, 2777777.78, 0.5);
cek('1. konteks target', t1.konteks, 'target');

// =====================================================================
// UJI 2 — BEP porsi
// =====================================================================
dekat('2. ASP dipakai = 50.000', t1.rincian.asp, 50000, 1e-9);
dekat('2. BEP porsi/bulan ≈ 1.667', t1.bep.unitBulanan, 1666.6667, 0.001);
dekat('2. BEP porsi/hari ≈ 55,56', t1.bep.unitHarian, 55.5556, 0.001);

// Presisi TIDAK dibulatkan di mesin. Membulatkan di sini membuat pembulatan
// merambat ke setiap turunannya, dan selisihnya menumpuk di konsolidasi.
benar('2. porsi disimpan sebagai desimal, bukan bulat', t1.bep.unitBulanan % 1 !== 0);

// =====================================================================
// UJI 3 — target laba
// =====================================================================
const t3 = hitungTarget({ actual: ekonomi({}), targetLabaBulanan: 20000000, hariOperasional: 30 });

dekat('3. target omzet/bulan = 116.666.667', t3.target.revenueBulanan, 116666666.67, 0.5);
dekat('3. target omzet/hari = 3.888.889', t3.target.revenueHarian, 3888888.89, 0.5);
dekat('3. kebutuhan = fixed + laba', t3.rincian.kebutuhanTarget, 70000000, 1e-9);

// =====================================================================
// UJI 4 — target porsi
// =====================================================================
dekat('4. target porsi/bulan ≈ 2.333', t3.target.unitBulanan, 2333.3333, 0.001);
dekat('4. target porsi/hari ≈ 77,78', t3.target.unitHarian, 77.7778, 0.001);

// =====================================================================
// UJI 5 — target laba 0 == BEP, PERSIS
// =====================================================================
const t5 = hitungTarget({ actual: ekonomi({}), targetLabaBulanan: 0, hariOperasional: 30 });

cek('5. omzet bulanan identik', t5.target.revenueBulanan, t5.bep.revenueBulanan);
cek('5. omzet harian identik', t5.target.revenueHarian, t5.bep.revenueHarian);
cek('5. porsi bulanan identik', t5.target.unitBulanan, t5.bep.unitBulanan);
cek('5. porsi harian identik', t5.target.unitHarian, t5.bep.unitHarian);

// Dan identik pula dengan BEP dari pemanggilan yang targetnya tidak diisi.
cek('5. sama dengan BEP tanpa target laba', t5.bep.revenueBulanan, t1.bep.revenueBulanan);

// =====================================================================
// UJI 6 — dua outlet, ekonomi berbeda, target berbeda
// =====================================================================
const serpong = hitungTarget({
  actual: ekonomi({ nama: 'Serpong', rasioVariabel: 0.4, fixed: 50000000, asp: 50000 }),
  targetLabaBulanan: 20000000,
  hariOperasional: 30
});
const sentul = hitungTarget({
  actual: ekonomi({ nama: 'Sentul', rasioVariabel: 0.45, fixed: 40000000, asp: 45000 }),
  targetLabaBulanan: 20000000,
  hariOperasional: 26
});

dekat('6. Serpong CM% 60', serpong.rincian.cmPersen, 60, 1e-9);
dekat('6. Sentul CM% 55', sentul.rincian.cmPersen, 55, 1e-9);
dekat('6. Sentul BEP omzet = 40jt / 55%', sentul.bep.revenueBulanan, 40000000 / 0.55, 0.5);
dekat('6. Sentul target = 60jt / 55%', sentul.target.revenueBulanan, 60000000 / 0.55, 0.5);

benar('6. BEP kedua outlet berbeda', serpong.bep.revenueBulanan !== sentul.bep.revenueBulanan);
benar('6. target kedua outlet berbeda', serpong.target.revenueBulanan !== sentul.target.revenueBulanan);
benar('6. ASP kedua outlet berbeda', serpong.rincian.asp !== sentul.rincian.asp);

// Hari operasional berbeda -> beban harian berbeda, bukan dibagi 30 dua-duanya.
dekat('6. Sentul dibagi 26 hari, bukan 30', sentul.target.revenueHarian, sentul.target.revenueBulanan / 26, 1e-6);
dekat('6. Serpong dibagi 30 hari', serpong.target.revenueHarian, serpong.target.revenueBulanan / 30, 1e-6);

// =====================================================================
// UJI 7 — outlet belum punya transaksi
// =====================================================================
const kosong = hitungActualOutlet({
  outlet: { id: 'o-baru', name: 'Outlet Baru' },
  sales: [],
  products: [],
  hpp: new Map(),
  hargaOutlet: [],
  biaya: [{ name: 'Sewa', jenis: 'tetap', satuan: 'per_bulan', amount: 30000000, outlet_id: 'o-baru', allocation_scope: 'direct_outlet' }]
});

// Tanpa asumsi apa pun: CM% belum ada, jadi belum ada target.
const t7a = hitungTarget({ actual: kosong, hariOperasional: 30 });
cek('7a. belum bisa dihitung tanpa asumsi', t7a.bisaDihitung, false);
cek('7a. BEP omzet null', t7a.bep.revenueBulanan, null);
// Sebabnya menyebut YANG MANA yang kurang, bukan "belum bisa dihitung" saja.
cek('7a. status menunjuk Variable Cost %', t7a.status, STATUS_HITUNG.LENGKAPI_VARIABEL);
benar('7a. sebabnya menyebut Variable Cost %', /VARIABLE COST %/i.test(t7a.sebab ?? ''));
benar('7a. dan menyebut apa yang harus dilakukan', /Isi Variable Cost % perencanaan/i.test(t7a.sebab ?? ''));

// Dengan asumsi biaya variabel: omzet target ADA, porsi belum (ASP belum ada).
const t7b = hitungTarget({ actual: kosong, hariOperasional: 30, asumsi: { variabelPersen: 40 } });
cek('7b. bisa dihitung', t7b.bisaDihitung, true);
dekat('7b. BEP omzet = 30jt / 60%', t7b.bep.revenueBulanan, 50000000, 0.5);
cek('7b. BEP porsi null tanpa ASP', t7b.bep.unitBulanan, null);
cek('7b. target porsi null tanpa ASP', t7b.target.unitBulanan, null);
benar('7b. dikatakan kenapa porsinya kosong', t7b.peringatan.some((p) => /target PORSI belum bisa dihitung/i.test(p)));

// Dengan ASP perencanaan: porsi ikut ada.
const t7c = hitungTarget({ actual: kosong, hariOperasional: 30, asumsi: { variabelPersen: 40, asp: 40000 } });
dekat('7c. BEP porsi dari ASP perencanaan', t7c.bep.unitBulanan, 50000000 / 40000, 1e-9);
cek('7c. ASP ditandai asumsi', t7c.masukan.ekonomi.asp.sumber, 'planning');

// =====================================================================
// UJI 8 — ASP baku = ASP tertimbang aktual
// =====================================================================
const adaJualan = ekonomi({ revenue: 90000000, asp: 45000 });
const t8 = hitungTarget({ actual: adaJualan, hariOperasional: 30 });

cek('8. sumber ASP = aktual', t8.masukan.ekonomi.asp.sumber, 'actual');
dekat('8. ASP = Σomzet ÷ Σporsi', t8.rincian.asp, 45000, 1e-9);
cek('8. tidak ada asumsi yang aktif', t8.masukan.ekonomi.adaAsumsi, false);

// Dan ia BUKAN harga master. `products.sale_price` tidak pernah masuk ke sini.
const src = await import('node:fs').then((fs) => fs.readFileSync('js/modules/owner/target.js', 'utf8'));
benar('8. target.js tidak menyebut sale_price', !/sale_price/.test(src));

// =====================================================================
// UJI 9 — override ASP: target berubah, Actual & Projection TIDAK
// =====================================================================
const dasar = ekonomi({ revenue: 80000000, rasioVariabel: 0.4, fixed: 15000000, asp: 10000 });
const salinanDasar = JSON.stringify(dasar);

const hari = hitungHari({ dari: '2026-08-01', sampai: '2026-08-31', hariIni: '2026-08-20' });
const proySebelum = proyeksiOutlet({ actual: dasar, hari });

const t9a = hitungTarget({ actual: dasar, targetLabaBulanan: 10000000, hariOperasional: 30 });
const t9b = hitungTarget({ actual: dasar, targetLabaBulanan: 10000000, hariOperasional: 30, asumsi: { asp: 20000 } });

const proySesudah = proyeksiOutlet({ actual: dasar, hari });

benar('9. target porsi berubah saat ASP diubah', t9a.target.unitBulanan !== t9b.target.unitBulanan);
dekat('9. ASP dua kali lipat -> porsi separuh', t9b.target.unitBulanan, t9a.target.unitBulanan / 2, 1e-9);
cek('9. target OMZET tidak berubah (ASP tidak memengaruhi omzet)', t9b.target.revenueBulanan, t9a.target.revenueBulanan);

cek('9. objek aktual tidak dimutasi', JSON.stringify(dasar), salinanDasar);
dekat('9. omzet aktual tetap', dasar.revenue, 80000000, 1e-9);
cek('9. proyeksi tidak berubah', JSON.stringify(proySesudah), JSON.stringify(proySebelum));
benar('9. asumsi ditandai di hasilnya', t9b.masukan.ekonomi.adaAsumsi === true);
benar('9. peringatan asumsi muncul', t9b.peringatan.some((p) => /ASUMSI PERENCANAAN/i.test(p)));

// Override biaya tetap & variabel juga hanya berlaku di target.
const t9c = hitungTarget({ actual: dasar, hariOperasional: 30, asumsi: { fixedBulanan: 30000000, variabelPersen: 50 } });
dekat('9. BEP pakai asumsi = 30jt / 50%', t9c.bep.revenueBulanan, 60000000, 0.5);
cek('9. aktual tetap utuh sesudah override biaya', JSON.stringify(dasar), salinanDasar);
cek('9. sumber biaya tetap = asumsi', t9c.masukan.ekonomi.fixedBulanan.sumber, 'planning');
dekat('9. nilai aktualnya tetap dibawa untuk pembanding', t9c.masukan.ekonomi.fixedBulanan.nilaiAktual, 15000000, 1e-9);

// =====================================================================
// UJI 10 — biaya bersama BU tidak masuk target outlet
// =====================================================================
const biaya = [
  { name: 'Sewa A', jenis: 'tetap', satuan: 'per_bulan', amount: 50000000, outlet_id: 'o-a', allocation_scope: 'direct_outlet' },
  { name: 'Software', jenis: 'tetap', satuan: 'per_bulan', amount: 5000000, outlet_id: null, allocation_scope: 'shared_bu' },
  { name: 'Kantor pusat', jenis: 'tetap', satuan: 'per_bulan', amount: 30000000, outlet_id: null, allocation_scope: 'corporate' }
];

const actualA = hitungActualOutlet({
  outlet: { id: 'o-a', name: 'Outlet A' },
  sales: [{ outlet_id: 'o-a', product_id: 'p1', qty: 10000, revenue: 100000000 }],
  products: [{ id: 'p1', name: 'Menu' }],
  hpp: new Map([['p1', 4000]]),
  hargaOutlet: [{ outlet_id: 'o-a', product_id: 'p1', packaging_cost: 0 }],
  biaya
});
const tA = hitungTarget({ actual: actualA, targetLabaBulanan: 20000000, hariOperasional: 30 });

dekat('10. biaya tetap target = sewa outlet saja', tA.rincian.fixedBulanan, 50000000, 1e-9);
benar('10. software tidak ikut', tA.rincian.fixedBulanan !== 55000000);
benar('10. korporat tidak ikut', tA.rincian.fixedBulanan !== 80000000);
dekat('10. BEP = 50jt / 60%', tA.bep.revenueBulanan, 83333333.33, 0.5);

// Di ringkasan BU keduanya muncul, terpisah.
const konsA = konsolidasiTarget([tA]);
const buA = ringkasBuTarget({ konsolidasi: konsA, biaya });
dekat('10. shared muncul di BU', buA.sharedBu, 5000000, 1e-9);
dekat('10. corporate muncul di BU', buA.corporate, 30000000, 1e-9);

// Dan yang paling mudah terlewat: semua outlet mencapai target ≠ BU untung.
dekat('10. laba BU jika target tercapai = 20jt − 5jt', buA.labaBuJikaTercapai, 15000000, 1e-9);
benar('10. korporat tidak dikurangkan dari BU', buA.labaBuJikaTercapai !== 20000000 - 5000000 - 30000000);
cek('10. konteks BU target', buA.konteks, 'target');

// =====================================================================
// UJI 11 — All Outlets = PENJUMLAHAN, bukan BEP gabungan tersembunyi
// =====================================================================
const kons = konsolidasiTarget([serpong, sentul]);

dekat('11. Σ BEP omzet', kons.bep.revenueBulanan, serpong.bep.revenueBulanan + sentul.bep.revenueBulanan, 1e-6);
dekat('11. Σ target omzet', kons.target.revenueBulanan, serpong.target.revenueBulanan + sentul.target.revenueBulanan, 1e-6);
dekat('11. Σ target porsi', kons.target.unitBulanan, serpong.target.unitBulanan + sentul.target.unitBulanan, 1e-6);
cek('11. labelnya eksplisit', kons.label, 'SUM OF OUTLET TARGETS');
cek('11. dinyatakan bukan BEP gabungan', kons.bepGabungan, false);
cek('11. konteks target', kons.konteks, 'target');

// BEP gabungan (Σfixed ÷ CM% tertimbang) menghasilkan angka yang BERBEDA — dan
// yang membuatnya berbahaya bukan besarnya selisih melainkan ARAHNYA yang tidak
// bisa ditebak. Kedua arah dibuktikan di bawah, supaya tidak ada yang menganggap
// BEP gabungan "aman asal diingat biasnya".
const bepTertimbang = (o) => {
  const fixedTotal = o.reduce((t, x) => t + x.fixed, 0);
  const revTotal = o.reduce((t, x) => t + x.rev, 0);
  const cmTotal = o.reduce((t, x) => t + x.rev * x.cm, 0);
  return fixedTotal / (cmTotal / revTotal);
};

// Kasus A — Serpong & Sentul. Gabungan terlihat LEBIH BERAT.
const gabunganA = bepTertimbang([
  { fixed: 50000000, rev: 100000000, cm: 0.6 },
  { fixed: 40000000, rev: 100000000, cm: 0.55 }
]);
benar('11. Σ BEP ≠ BEP gabungan tertimbang', Math.abs(kons.bep.revenueBulanan - gabunganA) > 1);
benar('11. kasus A: gabungan lebih berat', gabunganA > kons.bep.revenueBulanan);

// Kasus B — satu outlet bermargin tebal & murah, satu tipis & mahal.
// Di sini gabungan terlihat LEBIH RINGAN, dan selisihnya lebih dari dua kali
// lipat: outlet yang butuh Rp450 juta untuk impas lenyap di balik rata-rata.
const tebal = hitungTarget({ actual: ekonomi({ nama: 'Tebal', revenue: 100000000, rasioVariabel: 0.2, fixed: 10000000, asp: 50000 }), hariOperasional: 30 });
const tipis = hitungTarget({ actual: ekonomi({ nama: 'Tipis', revenue: 100000000, rasioVariabel: 0.8, fixed: 90000000, asp: 50000 }), hariOperasional: 30 });
const konsB = konsolidasiTarget([tebal, tipis]);
const gabunganB = bepTertimbang([
  { fixed: 10000000, rev: 100000000, cm: 0.8 },
  { fixed: 90000000, rev: 100000000, cm: 0.2 }
]);

dekat('11. kasus B: Σ BEP = 12,5jt + 450jt', konsB.bep.revenueBulanan, 462500000, 0.5);
dekat('11. kasus B: BEP gabungan palsu = 200jt', gabunganB, 200000000, 0.5);
benar('11. kasus B: gabungan lebih ringan dari separuhnya', gabunganB < konsB.bep.revenueBulanan / 2);
benar('11. outlet tipis tetap terlihat sendiri', tipis.bep.revenueBulanan === 450000000);

// Outlet yang targetnya tak terhitung dikeluarkan & dilaporkan, bukan dinolkan.
const konsCampur = konsolidasiTarget([serpong, t7a]);
dekat('11. Σ hanya outlet yang terhitung', konsCampur.bep.revenueBulanan, serpong.bep.revenueBulanan, 1e-6);
cek('11. yang tak terhitung dilaporkan', konsCampur.tidakBisaDihitung.map((o) => o.outletName), ['Outlet Baru']);
cek('11. jumlah yang terhitung', konsCampur.jumlahDihitung, 1);

// Tidak ada satu pun outlet -> null, bukan 0.
const konsKosong = konsolidasiTarget([t7a]);
cek('11. konsolidasi tanpa hasil: null', konsKosong.bep.revenueBulanan, null);
cek('11.   target null juga', konsKosong.target.revenueBulanan, null);

// =====================================================================
// UJI 12 — kasus batas: tidak ada NaN, Infinity, atau target negatif
// =====================================================================

// CM negatif
const cmMinus = ekonomi({ revenue: 100000000, rasioVariabel: 1.3, fixed: 20000000, asp: 20000 });
const tMinus = hitungTarget({ actual: cmMinus, targetLabaBulanan: 10000000, hariOperasional: 30 });
cek('12. CM negatif: tidak bisa dihitung', tMinus.bisaDihitung, false);
cek('12.   BEP omzet null', tMinus.bep.revenueBulanan, null);
cek('12.   target omzet null', tMinus.target.revenueBulanan, null);
benar('12.   sebabnya dikatakan', /NEGATIF/.test(tMinus.sebab ?? ''));

// CM persis nol
const cmNol = ekonomi({ revenue: 100000000, rasioVariabel: 1, fixed: 20000000, asp: 20000 });
const tNol = hitungTarget({ actual: cmNol, hariOperasional: 30 });
cek('12. CM nol: tidak bisa dihitung', tNol.bisaDihitung, false);
cek('12.   tidak menghasilkan Infinity', tNol.bep.revenueBulanan, null);

// Biaya tetap NOL YANG DINYATAKAN -> BEP nol (sah, bukan null).
const tanpaFixed = hitungTarget({ actual: ekonomi({ fixed: 0 }), hariOperasional: 30, asumsi: { fixedBulanan: 0 } });
cek('12. fixed 0 dinyatakan -> BEP omzet 0', tanpaFixed.bep.revenueBulanan, 0);
cek('12.   BEP porsi 0', tanpaFixed.bep.unitBulanan, 0);
cek('12.   bisa dihitung', tanpaFixed.bisaDihitung, true);

// Biaya tetap TIDAK ADA DATANYA -> BUKAN nol. Ini beda, dan bedanya menentukan:
// BEP Rp 0 berarti "sudah impas sebelum menjual apa pun" — kesimpulan terbaik
// yang bisa dibayangkan, diberikan justru ke outlet yang datanya paling kosong.
const fixedHilang = hitungTarget({ actual: ekonomi({ fixed: 0 }), hariOperasional: 30 });
cek('12. fixed tanpa data -> tidak bisa dihitung', fixedHilang.bisaDihitung, false);
cek('12.   BEP null, BUKAN 0', fixedHilang.bep.revenueBulanan, null);
cek('12.   statusnya menunjuk fixed cost', fixedHilang.status, STATUS_HITUNG.LENGKAPI_FIXED);
benar('12.   sebabnya dikatakan', /FIXED COST BELUM TERSEDIA/.test(fixedHilang.sebab ?? ''));
benar('12.   dan ditegaskan nol ≠ kosong', /BUKAN berarti biayanya nol/i.test(fixedHilang.sebab ?? ''));

// Hari operasional 0 -> harian null, bulanan tetap ada
const tHariNol = hitungTarget({ actual: ekonomi({}), hariOperasional: 0 });
cek('12. hari 0: harian null', tHariNol.bep.revenueHarian, null);
benar('12.   bulanan tetap ada', tHariNol.bep.revenueBulanan > 0);
benar('12.   sebabnya dikatakan', tHariNol.peringatan.some((p) => /Hari operasional belum diisi/i.test(p)));

// ASP nol / negatif -> porsi null, omzet tetap
const tAspNol = hitungTarget({ actual: ekonomi({}), hariOperasional: 30, asumsi: { asp: 0 } });
cek('12. ASP 0: porsi null', tAspNol.bep.unitBulanan, null);
benar('12.   omzet tetap ada', tAspNol.bep.revenueBulanan > 0);

// Target laba negatif yang melebihi seluruh biaya tetap -> ditolak, bukan negatif
const tRugiBerlebih = hitungTarget({ actual: ekonomi({ fixed: 50000000 }), targetLabaBulanan: -60000000, hariOperasional: 30 });
cek('12. target mustahil: omzet null', tRugiBerlebih.target.revenueBulanan, null);
benar('12.   BEP-nya tetap ada', tRugiBerlebih.bep.revenueBulanan > 0);
benar('12.   sebabnya dikatakan', /lebih rugi daripada/i.test(tRugiBerlebih.sebab ?? ''));

// Target laba negatif yang wajar -> omzet di BAWAH BEP, tapi tetap positif
const tRugiWajar = hitungTarget({ actual: ekonomi({ fixed: 50000000 }), targetLabaBulanan: -20000000, hariOperasional: 30 });
dekat('12. rugi terkendali: 30jt / 60%', tRugiWajar.target.revenueBulanan, 50000000, 0.5);
benar('12.   di bawah BEP', tRugiWajar.target.revenueBulanan < tRugiWajar.bep.revenueBulanan);
benar('12.   tetap positif', tRugiWajar.target.revenueBulanan > 0);

function periksaAngka(nama, obj, jalur = '') {
  if (obj == null) return;
  if (typeof obj === 'number') {
    if (Number.isNaN(obj)) return void (gagal++, console.error(`❌ 12. NaN di ${nama}${jalur}`));
    if (!Number.isFinite(obj)) return void (gagal++, console.error(`❌ 12. Infinity di ${nama}${jalur}`));
    return;
  }
  if (Array.isArray(obj)) return obj.forEach((v, i) => periksaAngka(nama, v, `${jalur}[${i}]`));
  if (typeof obj === 'object') for (const [k, v] of Object.entries(obj)) periksaAngka(nama, v, `${jalur}.${k}`);
}

for (const [nama, o] of Object.entries({
  t1, t3, t5, serpong, sentul, t7a, t7b, t7c, t8, t9a, t9b, t9c, tA,
  kons, konsCampur, konsKosong, buA, tMinus, tNol, tanpaFixed, tHariNol, tAspNol, tRugiBerlebih, tRugiWajar
})) {
  periksaAngka(nama, o);
}

// Omzet target tidak boleh negatif di mana pun.
for (const [nama, o] of Object.entries({ t1, t3, serpong, sentul, tRugiWajar, tanpaFixed })) {
  benar(`12. ${nama}: BEP tidak negatif`, (o.bep.revenueBulanan ?? 0) >= 0);
  benar(`12. ${nama}: target tidak negatif`, (o.target.revenueBulanan ?? 0) >= 0);
}

// =====================================================================
// PENCAPAIAN — monitoring aktual terhadap target
// =====================================================================
const p1 = pencapaianTarget({ revenueActual: 80000000, targetRevenue: 116666666.67 });
dekat('pencapaian: gap negatif', p1.gap, 80000000 - 116666666.67, 0.5);
dekat('pencapaian: ≈68,6%', p1.persen, 68.571, 0.01);
cek('pencapaian: belum mencapai', p1.status, STATUS_TARGET.BELUM);

cek('pencapaian: 100% -> tercapai', pencapaianTarget({ revenueActual: 100, targetRevenue: 100 }).status, STATUS_TARGET.TERCAPAI);
cek('pencapaian: 95% -> mendekati', pencapaianTarget({ revenueActual: 95, targetRevenue: 100 }).status, STATUS_TARGET.MENDEKATI);
cek('pencapaian: 89,9% -> belum', pencapaianTarget({ revenueActual: 89.9, targetRevenue: 100 }).status, STATUS_TARGET.BELUM);

// Omzet nol dengan target yang ada -> 0%, bukan null.
const pNol = pencapaianTarget({ revenueActual: 0, targetRevenue: 100 });
cek('pencapaian: omzet 0 -> 0%', pNol.persen, 0);
cek('pencapaian:   statusnya belum', pNol.status, STATUS_TARGET.BELUM);

// Tanpa target -> tidak bisa dinilai, BUKAN 0%.
cek('pencapaian: tanpa target -> null', pencapaianTarget({ revenueActual: 100, targetRevenue: null }).persen, null);
cek('pencapaian:   statusnya tidak bisa', pencapaianTarget({ revenueActual: 100, targetRevenue: null }).status, STATUS_TARGET.TIDAK_BISA);
cek('pencapaian: target 0 -> null', pencapaianTarget({ revenueActual: 100, targetRevenue: 0 }).persen, null);

// =====================================================================
// INTEGRASI — ekonominya benar-benar datang dari mesin Actual
// =====================================================================
const aktualIntegrasi = hitungActualOutlet({
  outlet: { id: 'o-i', name: 'Integrasi' },
  sales: [{ outlet_id: 'o-i', product_id: 'p1', qty: 2000, revenue: 20000000 }],
  products: [{ id: 'p1', name: 'Menu' }],
  hpp: new Map([['p1', 4000]]),
  hargaOutlet: [{ outlet_id: 'o-i', product_id: 'p1', packaging_cost: 0 }],
  biaya: [{ name: 'Sewa', jenis: 'tetap', satuan: 'per_bulan', amount: 6000000, outlet_id: 'o-i', allocation_scope: 'direct_outlet' }]
});
const tInt = hitungTarget({ actual: aktualIntegrasi, hariOperasional: 30 });

// CM% target HARUS sama persis dengan CM% Actual — kalau berbeda, ada mesin kedua.
dekat('integrasi: CM% target = CM% actual', tInt.rincian.cmPersen, aktualIntegrasi.cmPersen, 1e-12);
dekat('integrasi: ASP target = ASP actual', tInt.rincian.asp, aktualIntegrasi.asp, 1e-12);
dekat('integrasi: fixed target = fixed actual', tInt.rincian.fixedBulanan, aktualIntegrasi.fixedLangsung, 1e-12);

// Dan BEP-nya sama dengan BEP yang sudah dihitung mesin Actual.
dekat('integrasi: BEP target = BEP actual', tInt.bep.revenueBulanan, aktualIntegrasi.bep.revenue, 0.01);

const ek = ekonomiTarget({ actual: aktualIntegrasi });
cek('integrasi: semua sumber aktual', [ek.asp.sumber, ek.fixedBulanan.sumber, ek.cmPersen.sumber], ['actual', 'actual', 'actual']);

// =====================================================================
// REVISI 10A — OUTLET TANPA TRANSAKSI HARUS TETAP BISA DITARGETKAN
//
// Inilah gap yang ditemukan di lapangan: AB Sentul, biaya tetap sudah terdaftar,
// tapi belum ada satu pun transaksi. Layar menolak menghitung target dan tidak
// memberi satu pun petunjuk bahwa Variable Cost % yang menahan.
//
// Perencanaan justru PALING dibutuhkan sebelum outlet buka. Menolak menghitung
// tepat pada saat itu membuat modulnya berguna hanya untuk outlet yang sudah
// tidak lagi membutuhkannya.
// =====================================================================

/** Outlet baru: biaya tetap terdaftar, transaksi belum ada sama sekali. */
const belumJualan = (fixed = 40000000) =>
  hitungActualOutlet({
    outlet: { id: 'o-sentul', name: 'AB Sentul' },
    sales: [],
    products: [],
    hpp: new Map(),
    hargaOutlet: [],
    biaya: [{ name: 'Sewa', jenis: 'tetap', satuan: 'per_bulan', amount: fixed, outlet_id: 'o-sentul', allocation_scope: 'direct_outlet' }]
  });

// --- UJI A: tanpa transaksi + Planning Variable Cost + Planning ASP
const A = hitungTarget({
  actual: belumJualan(),
  targetLabaBulanan: 30000000,
  hariOperasional: 30,
  asumsi: { variabelPersen: 40, asp: 45000 }
});

cek('A. bisa dihitung tanpa satu pun transaksi', A.bisaDihitung, true);
cek('A. status: bisa dihitung', A.status, STATUS_HITUNG.BISA);
dekat('A. CM% = 60', A.rincian.cmPersen, 60, 1e-9);

// Angka wajib §6 — BEP
dekat('A. BEP omzet/bulan = 66.666.667', A.bep.revenueBulanan, 66666666.67, 0.5);
dekat('A. BEP omzet/hari = 2.222.222', A.bep.revenueHarian, 2222222.22, 0.5);
dekat('A. BEP porsi/bulan ≈ 1.481,48', A.bep.unitBulanan, 1481.4815, 0.001);
dekat('A. BEP porsi/hari ≈ 49,38', A.bep.unitHarian, 49.3827, 0.001);

// Angka wajib §6 — target laba Rp 30 juta
dekat('A. target omzet/bulan = 116.666.667', A.target.revenueBulanan, 116666666.67, 0.5);
dekat('A. target omzet/hari = 3.888.889', A.target.revenueHarian, 3888888.89, 0.5);
dekat('A. target porsi/bulan ≈ 2.592,59', A.target.unitBulanan, 2592.5926, 0.001);
dekat('A. target porsi/hari ≈ 86,42', A.target.unitHarian, 86.4198, 0.001);

// Keduanya ASUMSI, dan itu dinyatakan — bukan disamarkan jadi angka aktual.
cek('A. sumber variabel = planning', A.masukan.ekonomi.cmPersen.sumber, 'planning');
cek('A. sumber ASP = planning', A.masukan.ekonomi.asp.sumber, 'planning');
cek('A. sumber fixed = actual (dari outlet_costs)', A.masukan.ekonomi.fixedBulanan.sumber, 'actual');
benar('A. peringatan asumsi muncul', A.peringatan.some((p) => /ASUMSI PERENCANAAN/i.test(p)));

// --- UJI B: tanpa transaksi + Variable Cost ada + ASP kosong
const B = hitungTarget({
  actual: belumJualan(),
  targetLabaBulanan: 30000000,
  hariOperasional: 30,
  asumsi: { variabelPersen: 40 }
});

cek('B. tetap bisa dihitung', B.bisaDihitung, true);
dekat('B. BEP omzet tetap ada', B.bep.revenueBulanan, 66666666.67, 0.5);
dekat('B. target omzet tetap ada', B.target.revenueBulanan, 116666666.67, 0.5);
dekat('B. omzet harian tetap ada', B.target.revenueHarian, 3888888.89, 0.5);
cek('B. BEP porsi null', B.bep.unitBulanan, null);
cek('B. target porsi null', B.target.unitBulanan, null);
cek('B. target porsi/hari null', B.target.unitHarian, null);
cek('B. bisaPorsi false', B.bisaPorsi, false);
benar('B. sebab porsinya kosong dikatakan', B.peringatan.some((p) => /target PORSI belum bisa dihitung/i.test(p)));

// --- UJI C: tanpa transaksi + ASP ada + Variable Cost kosong
const C = hitungTarget({
  actual: belumJualan(),
  targetLabaBulanan: 30000000,
  hariOperasional: 30,
  asumsi: { asp: 45000 }
});

cek('C. tidak bisa dihitung', C.bisaDihitung, false);
cek('C. status menunjuk Variable Cost %', C.status, STATUS_HITUNG.LENGKAPI_VARIABEL);
cek('C. BEP omzet null', C.bep.revenueBulanan, null);
cek('C. target omzet null', C.target.revenueBulanan, null);
benar('C. sebabnya menunjuk yang kurang', /LENGKAPI VARIABLE COST %/.test(C.sebab ?? ''));

// ASP saja tidak cukup, dan itu masuk akal: tanpa margin, harga tidak
// memberitahu apa pun tentang berapa yang harus terjual.
benar('C. tidak mengarang CM dari ASP', C.rincian.cmPersen == null);

// --- UJI D: ada transaksi -> ekonomi aktual jadi baku
const sudahJualan = hitungActualOutlet({
  outlet: { id: 'o-d', name: 'Sudah Jualan' },
  sales: [{ outlet_id: 'o-d', product_id: 'p1', qty: 2000, revenue: 95000000 }],
  products: [{ id: 'p1', name: 'Menu' }],
  hpp: new Map([['p1', 18050]]), // 38% dari ASP 47.500
  hargaOutlet: [{ outlet_id: 'o-d', product_id: 'p1', packaging_cost: 0 }],
  biaya: [{ name: 'Sewa', jenis: 'tetap', satuan: 'per_bulan', amount: 40000000, outlet_id: 'o-d', allocation_scope: 'direct_outlet' }]
});
const D = hitungTarget({ actual: sudahJualan, targetLabaBulanan: 30000000, hariOperasional: 30 });

dekat('D. variabel% baku = 38 (aktual)', D.rincian.variabelPersen, 38, 1e-9);
dekat('D. ASP baku = 47.500 (aktual)', D.rincian.asp, 47500, 1e-9);
cek('D. sumber variabel = actual', D.masukan.ekonomi.cmPersen.sumber, 'actual');
cek('D. sumber ASP = actual', D.masukan.ekonomi.asp.sumber, 'actual');
cek('D. tidak ada asumsi aktif', D.masukan.ekonomi.adaAsumsi, false);
dekat('D. BEP = 40jt / 62%', D.bep.revenueBulanan, 40000000 / 0.62, 0.5);

// --- UJI E: ada transaksi TAPI di-override -> target berubah, yang lain tidak
const salinanD = JSON.stringify(sudahJualan);
const hariE = hitungHari({ dari: '2026-08-01', sampai: '2026-08-31', hariIni: '2026-08-20' });
const proyE1 = proyeksiOutlet({ actual: sudahJualan, hari: hariE });

const E = hitungTarget({
  actual: sudahJualan,
  targetLabaBulanan: 30000000,
  hariOperasional: 30,
  asumsi: { variabelPersen: 40, asp: 50000 }
});

const proyE2 = proyeksiOutlet({ actual: sudahJualan, hari: hariE });

benar('E. target berubah', E.target.revenueBulanan !== D.target.revenueBulanan);
dekat('E. pakai CM 60%, bukan 62%', E.target.revenueBulanan, 70000000 / 0.6, 0.5);
dekat('E. pakai ASP 50.000', E.target.unitBulanan, 70000000 / 0.6 / 50000, 1e-6);
cek('E. sumber keduanya planning', [E.masukan.ekonomi.cmPersen.sumber, E.masukan.ekonomi.asp.sumber], ['planning', 'planning']);

// Nilai aktualnya tetap dibawa serta supaya layar bisa menampilkan keduanya.
dekat('E. CM aktual tetap terbaca 62%', E.masukan.ekonomi.cmPersen.nilaiAktual, 62, 1e-9);
dekat('E. ASP aktual tetap terbaca 47.500', E.masukan.ekonomi.asp.nilaiAktual, 47500, 1e-9);

cek('E. ACTUAL tidak berubah', JSON.stringify(sudahJualan), salinanD);
dekat('E.   omzet aktual tetap', sudahJualan.revenue, 95000000, 1e-9);
dekat('E.   CM% aktual tetap 62', sudahJualan.cmPersen, 62, 1e-9);
cek('E. PROJECTION tidak berubah', JSON.stringify(proyE2), JSON.stringify(proyE1));

// --- UJI F: asumsi dihapus -> kembali ke ekonomi aktual
const F = hitungTarget({
  actual: sudahJualan,
  targetLabaBulanan: 30000000,
  hariOperasional: 30,
  // Persis yang dikirim layar saat kotaknya dikosongkan.
  asumsi: { variabelPersen: null, asp: null, fixedBulanan: null }
});

cek('F. kembali ke ekonomi aktual', JSON.stringify(F.rincian), JSON.stringify(D.rincian));
cek('F. target identik dengan D', JSON.stringify(F.target), JSON.stringify(D.target));
cek('F. tidak ada asumsi aktif', F.masukan.ekonomi.adaAsumsi, false);
cek('F. sumber kembali actual', [F.masukan.ekonomi.cmPersen.sumber, F.masukan.ekonomi.asp.sumber], ['actual', 'actual']);

// Kotak kosong TIDAK boleh diperlakukan sebagai nol. Variable Cost % nol berarti
// CM 100% — target yang jauh lebih ringan, dari kotak yang tidak diisi siapa pun.
benar('F. kotak kosong ≠ variabel 0%', F.rincian.variabelPersen !== 0);
benar('F. kotak kosong ≠ ASP 0', F.rincian.asp !== 0);

// Tapi nol yang DIKETIK memang berlaku — pernyataan, bukan kekosongan.
const nolDiketik = hitungTarget({ actual: sudahJualan, hariOperasional: 30, asumsi: { variabelPersen: 0 } });
dekat('F. variabel 0% diketik -> CM 100%', nolDiketik.rincian.cmPersen, 100, 1e-9);
dekat('F.   BEP = biaya tetap itu sendiri', nolDiketik.bep.revenueBulanan, 40000000, 0.5);

for (const [nama, o] of Object.entries({ A, B, C, D, E, F, nolDiketik, fixedHilang })) periksaAngka(nama, o);

console.log(gagal === 0 ? '✅ target: semua lulus' : `❌ target: ${gagal} gagal`);
process.exit(gagal === 0 ? 0 : 1);
