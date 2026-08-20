/**
 * Profitabilitas per outlet — 12 uji wajib.
 *
 * Yang paling menentukan: UJI 11 (konsolidasi = Σ per outlet) dan UJI 3
 * (outlet rugi tidak boleh tersembunyi). Keduanya menjaga hal yang sama dari
 * dua arah, dan keduanya adalah kesalahan yang TIDAK AKAN TERLIHAT SALAH:
 * angka gabungan selalu wajar, hanya kebetulan menyembunyikan yang penting.
 */
const {
  hitungActualOutlet,
  konsolidasiOutlet,
  ringkasBu,
  biayaLangsungOutlet,
  biayaCakupanLuas,
  hitungBepOutlet,
  gapKeBep,
  STATUS_BEP
} = await import('../js/modules/owner/profit-outlet.js');

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
// FIXTURE — skenario §21 permintaan
// =====================================================================
const SER = { id: 'o-ser', name: 'Serpong' };
const SEN = { id: 'o-sen', name: 'Sentul' };

const products = [
  { id: 'p-ng', name: 'Nasi Goreng' },
  { id: 'p-teh', name: 'Es Teh' }
];
const hpp = new Map([
  ['p-ng', 15000],
  ['p-teh', 2000]
]);

// Harga BERBEDA per outlet, dan itu tercermin di `sales.revenue`.
const sales = [
  { outlet_id: 'o-ser', product_id: 'p-ng', qty: 100, unit_price: 35000, revenue: 3500000 },
  { outlet_id: 'o-sen', product_id: 'p-ng', qty: 100, unit_price: 32000, revenue: 3200000 }
];

const hargaOutlet = [
  { outlet_id: 'o-ser', product_id: 'p-ng', packaging_cost: 1000 },
  { outlet_id: 'o-sen', product_id: 'p-ng', packaging_cost: 1000 }
];

const biaya = [
  { name: 'Sewa Serpong', jenis: 'tetap', satuan: 'per_bulan', amount: 15000000, outlet_id: 'o-ser', allocation_scope: 'direct_outlet' },
  { name: 'Sewa Sentul', jenis: 'tetap', satuan: 'per_bulan', amount: 12000000, outlet_id: 'o-sen', allocation_scope: 'direct_outlet' },
  { name: 'Software akuntansi', jenis: 'tetap', satuan: 'per_bulan', amount: 5000000, outlet_id: null, allocation_scope: 'shared_bu' },
  { name: 'Gaji kantor pusat', jenis: 'tetap', satuan: 'per_bulan', amount: 30000000, outlet_id: null, allocation_scope: 'corporate' }
];

const ser = hitungActualOutlet({ outlet: SER, sales, products, hpp, hargaOutlet, biaya });
const sen = hitungActualOutlet({ outlet: SEN, sales, products, hpp, hargaOutlet, biaya });

// =====================================================================
// UJI 1 — dua outlet, harga berbeda
// =====================================================================
dekat('1. revenue Serpong', ser.revenue, 3500000);
dekat('1. revenue Sentul', sen.revenue, 3200000);
dekat('1. total konsolidasi', konsolidasiOutlet([ser, sen]).revenue, 6700000);
cek('1. konteks selalu ditandai', [ser.konteks, sen.konteks], ['actual', 'actual']);

// ASP hanya informasi — dan HARUS berbeda per outlet, bukan satu angka BU.
dekat('1. ASP Serpong', ser.asp, 35000);
dekat('1. ASP Sentul', sen.asp, 32000);

// =====================================================================
// UJI 2 — biaya variabel sama, margin harus berbeda
// =====================================================================
// Variabel/porsi = HPP 15.000 + kemasan 1.000 = 16.000 di KEDUA outlet.
dekat('2. variabel Serpong', ser.variabel.total, 1600000);
dekat('2. variabel Sentul', sen.variabel.total, 1600000);
dekat('2. CM Serpong', ser.cm, 3500000 - 1600000);
dekat('2. CM Sentul', sen.cm, 3200000 - 1600000);
benar('2. CM Serpong > CM Sentul', ser.cm > sen.cm, `${ser.cm} vs ${sen.cm}`);
benar('2. CM% Serpong > CM% Sentul', ser.cmPersen > sen.cmPersen);

// =====================================================================
// UJI 3 — satu untung, satu rugi: konsolidasi TIDAK BOLEH menyembunyikan
// =====================================================================
const untung = hitungActualOutlet({
  outlet: { id: 'o-a', name: 'A' },
  sales: [{ outlet_id: 'o-a', product_id: 'p-ng', qty: 1000, revenue: 35000000 }],
  products,
  hpp,
  hargaOutlet: [{ outlet_id: 'o-a', product_id: 'p-ng', packaging_cost: 0 }],
  biaya: [{ name: 'Sewa A', jenis: 'tetap', satuan: 'per_bulan', amount: 5000000, outlet_id: 'o-a', allocation_scope: 'direct_outlet' }]
});
const rugi = hitungActualOutlet({
  outlet: { id: 'o-b', name: 'B' },
  sales: [{ outlet_id: 'o-b', product_id: 'p-ng', qty: 50, revenue: 1600000 }],
  products,
  hpp,
  hargaOutlet: [{ outlet_id: 'o-b', product_id: 'p-ng', packaging_cost: 0 }],
  biaya: [{ name: 'Sewa B', jenis: 'tetap', satuan: 'per_bulan', amount: 9000000, outlet_id: 'o-b', allocation_scope: 'direct_outlet' }]
});

benar('3. A untung', untung.operatingProfit > 0, String(untung.operatingProfit));
benar('3. B RUGI', rugi.operatingProfit < 0, String(rugi.operatingProfit));

const gab = konsolidasiOutlet([untung, rugi]);
benar('3. gabungan untung (dan itu memang benar)', gab.operatingProfit > 0);
// Yang dijaga: B tetap bisa dilihat rugi dari hasil konsolidasi.
benar('3. B tetap terlihat rugi di dalam konsolidasi', gab.outlets.find((o) => o.outletId === 'o-b').operatingProfit < 0);
cek('3. status BEP dilaporkan per outlet', gab.ringkasBep.diBawah, 1);
benar('3. konsolidasi TIDAK punya BEP tunggal', gab.bep === undefined, 'BEP gabungan menyembunyikan outlet yang rugi');

// =====================================================================
// UJI 4 — shared BU cost tidak masuk Actual Outlet Profit
// =====================================================================
dekat('4. fixed Serpong hanya sewanya sendiri', ser.fixedLangsung, 15000000);
dekat('4. fixed Sentul hanya sewanya sendiri', sen.fixedLangsung, 12000000);
benar('4. software (shared_bu) TIDAK masuk outlet', !ser.rincianFixed.some((r) => r.nama.includes('Software')));
benar('4. gaji pusat (corporate) TIDAK masuk outlet', !ser.rincianFixed.some((r) => r.nama.includes('kantor pusat')));

const bu = ringkasBu({ konsolidasi: konsolidasiOutlet([ser, sen]), biaya });
dekat('4. shared_bu muncul di ringkasan BU', bu.sharedBu, 5000000);
dekat('4. corporate muncul TERPISAH', bu.corporate, 30000000);
dekat('4. BU profit sebelum shared', bu.buProfitSebelumShared, ser.operatingProfit + sen.operatingProfit);
dekat('4. BU profit setelah shared', bu.buProfitSetelahShared, bu.buProfitSebelumShared - 5000000);
benar('4. corporate TIDAK dikurangkan dari BU', bu.buProfitSetelahShared === bu.buProfitSebelumShared - bu.sharedBu);

// =====================================================================
// UJI 5 — tidak ada double counting
// =====================================================================
// HPP dari resep TIDAK memuat kemasan (diperiksa di hpp.js). Jadi keduanya
// dijumlahkan sekali masing-masing, dan totalnya harus persis.
dekat('5. variabel = hpp + kemasan + perPorsi + persen', ser.variabel.total,
  ser.variabel.hpp + ser.variabel.kemasan + ser.variabel.perPorsi + ser.variabel.persenOmzet);
dekat('5. hpp 100 x 15.000', ser.variabel.hpp, 1500000);
dekat('5. kemasan 100 x 1.000', ser.variabel.kemasan, 100000);

// Biaya variabel dari `outlet_costs` ditambahkan SEKALI, tidak dua kali.
const denganFee = hitungActualOutlet({
  outlet: SER,
  sales,
  products,
  hpp,
  hargaOutlet,
  biaya: [
    ...biaya,
    { name: 'Fee marketplace', jenis: 'variabel', satuan: 'persen_omzet', amount: 20, outlet_id: 'o-ser', allocation_scope: 'direct_outlet' },
    { name: 'Sedotan', jenis: 'variabel', satuan: 'per_porsi', amount: 200, outlet_id: 'o-ser', allocation_scope: 'direct_outlet' }
  ]
});
dekat('5. fee 20% dari omzet, sekali', denganFee.variabel.persenOmzet, 700000);
dekat('5. per porsi 100 x 200, sekali', denganFee.variabel.perPorsi, 20000);
dekat('5. total variabel bertambah persis sebesar keduanya', denganFee.variabel.total, ser.variabel.total + 700000 + 20000);

// POTONGAN MARKETPLACE TIDAK BOLEH DIAMBIL DARI `fee_online_percent`.
//
// Kolom itu ada di `outlet_menu_prices` dan mewakili hal yang sama. Memakai
// keduanya = memotong dua kali. Dan `sales` tidak punya kolom kanal, jadi
// menerapkannya ke SELURUH penjualan berarti menganggap semuanya online.
const adaFeeDiHarga = hitungActualOutlet({
  outlet: SER,
  sales,
  products,
  hpp,
  hargaOutlet: [{ outlet_id: 'o-ser', product_id: 'p-ng', packaging_cost: 1000, fee_online_percent: 20, promo_percent: 10 }],
  biaya
});
// Diperiksa SAMPAI KE HILIR, bukan cuma di `variabel.total`.
//
// Versi pertama uji ini hanya membandingkan `variabel.total`, dan sabotase yang
// mengurangkan fee langsung dari `cm` LOLOS — angkanya masuk lewat pintu lain.
// Potongan yang dihitung dua kali bisa menyelinap di mana saja hilirnya, jadi
// yang dibandingkan seluruh rantainya.
dekat('5. fee_online_percent tidak masuk variabel', adaFeeDiHarga.variabel.total, ser.variabel.total);
dekat('5.   tidak masuk CM', adaFeeDiHarga.cm, ser.cm);
dekat('5.   tidak masuk operating profit', adaFeeDiHarga.operatingProfit, ser.operatingProfit);
dekat('5.   tidak menggeser BEP', adaFeeDiHarga.bep.revenue, ser.bep.revenue);

// =====================================================================
// UJI 6 — revenue nol: tidak ada pembagian nol
// =====================================================================
const kosong = hitungActualOutlet({ outlet: { id: 'o-x', name: 'X' }, sales: [], products, hpp, hargaOutlet, biaya: [] });
cek('6. revenue nol', kosong.revenue, 0);
cek('6. ASP null, bukan NaN', kosong.asp, null);
cek('6. CM% null, bukan 0', kosong.cmPersen, null);
cek('6. operating margin null', kosong.operatingMargin, null);
cek('6. BEP null', kosong.bep.revenue, null);
benar('6. sebab BEP dijelaskan', /belum ada omzet/i.test(kosong.bep.sebab ?? ''));
cek('6. status gap tidak mengarang', kosong.gap.status, STATUS_BEP.TIDAK_BISA);
benar('6. diperingatkan', kosong.peringatan.some((p) => /kosong, bukan nol/.test(p)));

// =====================================================================
// UJI 7 — CM nol / negatif: BEP & target tidak boleh mengarang
// =====================================================================
const cmNol = hitungBepOutlet({ cm: 0, revenue: 1000000, units: 100, fixedLangsung: 5000000 });
cek('7. CM nol: BEP null', cmNol.revenue, null);
benar('7. CM nol: sebabnya jelas', /persis nol/i.test(cmNol.sebab));

const cmMinus = hitungBepOutlet({ cm: -500000, revenue: 1000000, units: 100, fixedLangsung: 5000000 });
cek('7. CM minus: BEP null, BUKAN angka negatif', cmMinus.revenue, null);
benar('7. CM minus: sebabnya jelas', /NEGATIF/.test(cmMinus.sebab));

// Kalau ini pernah menghasilkan angka, ia akan terbaca seolah target terlampaui.
benar('7. BEP tidak pernah negatif', !(cmMinus.revenue < 0));

// =====================================================================
// UJI 8 — perubahan harga tidak mengubah revenue historis
// =====================================================================
// Harga outlet naik jadi 50.000, tapi `sales.revenue` tetap snapshot lama.
const hargaNaik = [{ outlet_id: 'o-ser', product_id: 'p-ng', packaging_cost: 1000, selling_price: 50000 }];
const setelahNaik = hitungActualOutlet({ outlet: SER, sales, products, hpp, hargaOutlet: hargaNaik, biaya });
dekat('8. revenue TIDAK ikut naik', setelahNaik.revenue, 3500000);
dekat('8. ASP tetap harga transaksi', setelahNaik.asp, 35000);

// =====================================================================
// UJI 9 — actual tidak berubah oleh apa pun di luar transaksi
// =====================================================================
const salinan = JSON.stringify(sales);
hitungActualOutlet({ outlet: SER, sales, products, hpp, hargaOutlet, biaya });
cek('9. array sales tidak dimutasi', JSON.stringify(sales), salinan);
dekat('9. hasil actual tetap sama walau dihitung ulang', hitungActualOutlet({ outlet: SER, sales, products, hpp, hargaOutlet, biaya }).revenue, ser.revenue);

// =====================================================================
// UJI 10 — hasil actual tidak memuat apa pun bernama proyeksi/simulasi
// =====================================================================
cek('10. konteks actual', ser.konteks, 'actual');
benar('10. tidak ada field proyeksi di hasil actual', !('proyeksi' in ser) && !('simulasi' in ser));
benar('10. tidak ada field target di hasil actual', !('target' in ser));

// =====================================================================
// UJI 11 — Σ per outlet PERSIS SAMA dengan konsolidasi
//
// Ini uji yang paling menentukan. Kalau konsolidasi pernah memakai rata-rata,
// selisihnya kecil dan angkanya tetap wajar — jadi tidak ada yang curiga.
// =====================================================================
const kons = konsolidasiOutlet([ser, sen]);
dekat('11. Σ revenue', kons.revenue, ser.revenue + sen.revenue, 1e-9);
dekat('11. Σ units', kons.units, ser.units + sen.units, 1e-9);
dekat('11. Σ variabel', kons.variabel.total, ser.variabel.total + sen.variabel.total, 1e-9);
dekat('11. Σ CM', kons.cm, ser.cm + sen.cm, 1e-9);
dekat('11. Σ fixed', kons.fixedLangsung, ser.fixedLangsung + sen.fixedLangsung, 1e-9);
dekat('11. Σ operating profit', kons.operatingProfit, ser.operatingProfit + sen.operatingProfit, 1e-9);

// Identitas yang harus selalu berlaku di tiap tingkat.
dekat('11. CM = revenue − variabel (outlet)', ser.cm, ser.revenue - ser.variabel.total, 1e-9);
dekat('11. CM = revenue − variabel (konsolidasi)', kons.cm, kons.revenue - kons.variabel.total, 1e-9);
dekat('11. OP = CM − fixed (konsolidasi)', kons.operatingProfit, kons.cm - kons.fixedLangsung, 1e-9);

// =====================================================================
// UJI 12 — weighted average hanya informasi
// =====================================================================
dekat('12. ASP tertimbang dihitung', kons.aspTertimbang, 6700000 / 200);
cek('12. ditandai sebagai informasi', kons.aspHanyaInformasi, true);

// Dan yang paling penting: ia TIDAK dipakai. Kalau BEP outlet pernah dihitung
// dari ASP gabungan (Rp33.500), angkanya akan berbeda dari yang benar.
const bepSerBenar = 15000000 / (ser.cm / ser.revenue);
dekat('12. BEP Serpong dari ekonominya sendiri', ser.bep.revenue, bepSerBenar, 1e-6);
const bepKalauPakaiGabungan = 15000000 / ((33500 - 16000) / 33500);
benar('12. BEP outlet BUKAN dari ASP gabungan', Math.abs(ser.bep.revenue - bepKalauPakaiGabungan) > 1);

// =====================================================================
// TAMBAHAN — pemisahan biaya & status gap
// =====================================================================
const bl = biayaLangsungOutlet(biaya, 'o-ser');
cek('biaya langsung hanya outlet ini', bl.rincianTetap.map((r) => r.nama), ['Sewa Serpong']);
cek('shared_bu tidak ikut', biayaCakupanLuas(biaya, 'shared_bu').rincian.map((r) => r.nama), ['Software akuntansi']);
cek('corporate tidak ikut', biayaCakupanLuas(biaya, 'corporate').rincian.map((r) => r.nama), ['Gaji kantor pusat']);
cek('biaya nonaktif diabaikan', biayaLangsungOutlet([{ name: 'X', jenis: 'tetap', satuan: 'per_bulan', amount: 1, outlet_id: 'o-ser', allocation_scope: 'direct_outlet', is_active: false }], 'o-ser').tetap, 0);
cek('satuan tak cocok jenisnya diabaikan', biayaLangsungOutlet([{ name: 'X', jenis: 'variabel', satuan: 'per_bulan', amount: 999, outlet_id: 'o-ser', allocation_scope: 'direct_outlet' }], 'o-ser').tetap, 0);

cek('gap: di atas BEP', gapKeBep({ revenue: 120, bepRevenue: 100 }).status, STATUS_BEP.DI_ATAS);
cek('gap: di bawah BEP', gapKeBep({ revenue: 80, bepRevenue: 100 }).status, STATUS_BEP.DI_BAWAH);
cek('gap: pas di BEP', gapKeBep({ revenue: 100, bepRevenue: 100 }).status, STATUS_BEP.PAS);
cek('gap: BEP null', gapKeBep({ revenue: 100, bepRevenue: null }).status, STATUS_BEP.TIDAK_BISA);
dekat('gap: selisih bertanda', gapKeBep({ revenue: 80, bepRevenue: 100 }).nilai, -20);

// Penyaringan outlet dikerjakan DI DALAM, bukan diserahkan ke pemanggil.
const salahOutlet = hitungActualOutlet({ outlet: SEN, sales, products, hpp, hargaOutlet, biaya });
dekat('sales outlet lain tidak ikut terhitung', salahOutlet.revenue, 3200000);

// HPP kosong dikeluarkan & dilaporkan, tidak dianggap nol.
const adaKosong = hitungActualOutlet({
  outlet: SER,
  sales: [
    { outlet_id: 'o-ser', product_id: 'p-ng', qty: 10, revenue: 350000 },
    { outlet_id: 'o-ser', product_id: 'p-misteri', qty: 10, revenue: 100000 }
  ],
  products: [...products, { id: 'p-misteri', name: 'Menu Tanpa Resep' }],
  hpp,
  hargaOutlet,
  biaya: []
});
cek('menu tanpa HPP dikeluarkan', adaKosong.menu.length, 1);
cek('  dan dilaporkan', adaKosong.terlewat[0].sebab, 'HPP belum bisa dihitung');
dekat('  omzetnya tidak ikut', adaKosong.revenue, 350000);

console.log(gagal === 0 ? '✅ profit outlet: semua lulus' : `❌ profit outlet: ${gagal} gagal`);
process.exit(gagal === 0 ? 0 : 1);
