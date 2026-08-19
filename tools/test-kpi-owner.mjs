/**
 * KPI owner.
 *
 * Satu aturan yang diuji berulang-ulang di sini: PERSEN TANPA PENYEBUT TIDAK
 * PERNAH JADI ANGKA.
 *
 * "Kepatuhan 100%" dari nol item adalah kalimat yang akan dipercaya owner, dan
 * ia satu-satunya jenis kesalahan di halaman ini yang membuat orang berhenti
 * memeriksa. Maka setiap persen wajib `null` saat penyebutnya nol — bukan 0,
 * bukan 100.
 */
const { kpiPenjualan, kpiOperasional, kpiKepatuhan, kpiKeuangan, ringkasanOwner } = await import(
  '../js/modules/owner/kpi.js'
);
const { bauranPenjualan, biayaTetapDariKas, hitungBep } = await import('../js/modules/owner/bep.js');

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

// =====================================================================
// PENJUALAN
// =====================================================================
const bauran = bauranPenjualan({
  sales: [
    { product_id: 'p1', qty: 100, unit_price: 10000 },
    { product_id: 'p2', qty: 50, unit_price: 20000 }
  ],
  products: [
    { id: 'p1', name: 'Kopi' },
    { id: 'p2', name: 'Nasi Goreng' }
  ],
  biaya: new Map([
    ['p1', 3000],
    ['p2', 8000]
  ])
});

const jual = kpiPenjualan(bauran, 30);
cek('omzet', jual.omzet, 2000000);
cek('porsi', jual.porsi, 150);
cek('laba kotor', jual.labaKotor, 700000 + 600000);
dekat('margin persen', jual.marginPersen, (1300000 / 2000000) * 100);
dekat('omzet per hari', jual.omzetPerHari, 2000000 / 30);
cek('menu terbaik lebih dulu', jual.terbaik[0].nama, 'Kopi');
cek('menu terlemah dari ujung lain', jual.terlemah[0].nama, 'Nasi Goreng');

const jualKosong = kpiPenjualan(bauranPenjualan({}), 0);
cek('tanpa penjualan: omzet 0', jualKosong.omzet, 0);
cek('tanpa penjualan: margin persen NULL, bukan 0', jualKosong.marginPersen, null);
cek('tanpa hari: omzet per hari NULL, bukan Infinity', jualKosong.omzetPerHari, null);

// =====================================================================
// OPERASIONAL
// =====================================================================
const ops = kpiOperasional({
  gerakan: [
    { movement_type: 'waste', qty_delta: -5, unit_cost: 20000, product_id: 'p1' },
    { movement_type: 'waste', qty_delta: -2, unit_cost: 10000, product_id: 'p2' },
    { movement_type: 'usage', qty_delta: -100, unit_cost: 3000, product_id: 'p1' },
    { movement_type: 'receive', qty_delta: 50, unit_cost: 20000, product_id: 'p1' }
  ],
  saldo: [
    { outlet_id: 'o1', product_id: 'p1', qty: 20 },
    { outlet_id: 'o1', product_id: 'p2', qty: -7 },
    { outlet_id: 'o1', product_id: 'p3', qty: -40 }
  ],
  produksi: [{ id: 'r1' }, { id: 'r2' }, { id: 'r3', cancelled_at: '2026-08-01T00:00:00Z' }],
  products: [
    { id: 'p1', name: 'Kopi' },
    { id: 'p2', name: 'Beras' },
    { id: 'p3', name: 'Tepung' }
  ]
});

cek('hanya waste yang dihitung susut', ops.qtySusut, 7);
cek('nilai susut pakai unit_cost', ops.nilaiSusut, 5 * 20000 + 2 * 10000);
cek('produksi dibatalkan tidak dihitung aktif', ops.jumlahProduksi, 2);
cek('  tapi jumlahnya dilaporkan', ops.produksiDibatalkan, 1);
cek('stok minus terdeteksi', ops.jumlahStokMinus, 2);
cek('  diurutkan dari yang paling minus', ops.stokMinus.map((s) => s.nama), ['Tepung', 'Beras']);
cek('  namanya ikut, bukan cuma id', ops.stokMinus[0].nama, 'Tepung');

cek('semua kosong aman', kpiOperasional({}).jumlahStokMinus, 0);

// =====================================================================
// KEPATUHAN — di sinilah aturan "persen tanpa penyebut" paling berbahaya
// =====================================================================
const patuh = kpiKepatuhan({
  runs: [
    { id: 'r1', run_date: '2026-08-01', outlet_id: 'o1' },
    { id: 'r2', run_date: '2026-08-01', outlet_id: 'o2' },
    { id: 'r3', run_date: '2026-08-02', outlet_id: 'o1' }
  ],
  items: [
    { run_id: 'r1', checked: true },
    { run_id: 'r1', checked: true },
    { run_id: 'r1', checked: false },
    { run_id: 'r2', checked: true }
  ],
  presensi: [
    { user_id: 'u1', clock_in_at: 'x', clock_out_at: 'y' },
    { user_id: 'u2', clock_in_at: 'x', clock_out_at: null },
    { user_id: 'u3', clock_in_at: 'x', clock_out_at: 'y' }
  ]
});

dekat('kepatuhan 3 dari 4', patuh.kepatuhanPersen, 75);
cek('hari unik dihitung sekali', patuh.hariAdaAktivitas, 2);
cek('outlet unik dihitung sekali', patuh.outletAdaAktivitas, 2);
cek('belum clock out', patuh.belumClockOut, 1);
dekat('persen belum clock out', patuh.persenBelumClockOut, (1 / 3) * 100);

// TANPA DATA SAMA SEKALI.
const patuhKosong = kpiKepatuhan({});
cek('nol item: kepatuhan NULL, bukan 100', patuhKosong.kepatuhanPersen, null);
cek('nol presensi: persen NULL, bukan 0', patuhKosong.persenBelumClockOut, null);
cek('nol item: pembilangnya tetap dilaporkan', patuhKosong.itemSelesai, 0);
cek('nol item: penyebutnya tetap dilaporkan', patuhKosong.itemTercatat, 0);

// Semua item selesai TETAP 100% — yang dilarang hanya 100% dari nol.
cek('semua selesai memang 100%', kpiKepatuhan({ items: [{ checked: true }] }).kepatuhanPersen, 100);
cek('tidak ada yang selesai memang 0%', kpiKepatuhan({ items: [{ checked: false }] }).kepatuhanPersen, 0);

// Batas penyebutnya harus ikut sampai ke layar, bukan tinggal di komentar kode.
if (!patuh.catatan?.includes('bukan yang seharusnya dikerjakan')) {
  gagal++;
  console.error('❌ batas penyebut kepatuhan tidak ikut dibawa ke layar');
}

// =====================================================================
// KEUANGAN
// =====================================================================
const kategori = [
  { id: 'k-sewa', name: 'Sewa', is_fixed_cost: true },
  { id: 'k-bahan', name: 'Bahan', is_fixed_cost: false }
];
const entri = [
  { entry_type: 'out', amount: -5000000, category_id: 'k-sewa' },
  { entry_type: 'out', amount: -3000000, category_id: 'k-bahan' },
  { entry_type: 'out', amount: -2000000, category_id: null },
  { entry_type: 'in', amount: 9000000, category_id: null }
];

const uang = kpiKeuangan({ biayaTetap: biayaTetapDariKas(entri, kategori), entri, omzet: 20000000 });
cek('kas keluar total (in tidak ikut)', uang.kasKeluar, 10000000);
cek('biaya tetap', uang.biayaTetap, 5000000);
cek('sisanya variabel', uang.biayaVariabel, 5000000);
cek('yang belum berkategori dilaporkan', uang.tanpaKategori, 2000000);
dekat('persen belum berkategori', uang.persenTanpaKategori, 20);
dekat('rasio biaya tetap terhadap omzet', uang.rasioBiayaTetap, 25);

cek('omzet nol: rasio NULL, bukan Infinity', kpiKeuangan({ biayaTetap: { total: 5000000 }, entri, omzet: 0 }).rasioBiayaTetap, null);
cek('tanpa entri: semuanya nol tanpa error', kpiKeuangan({ biayaTetap: null, entri: [] }).kasKeluar, 0);
cek('tanpa entri: persen NULL', kpiKeuangan({ biayaTetap: null, entri: [] }).persenTanpaKategori, null);

// =====================================================================
// RINGKASAN — `layakDipercaya`
//
// Ini yang menghalangi halaman owner memajang angka meyakinkan di atas data
// yang belum layak. Kalau ia longgar, seluruh kehati-hatian di berkas lain
// tidak ada gunanya.
// =====================================================================
const bepSehat = hitungBep({ marginSatuan: 7000, hargaRata: 10000, biayaTetap: 21000000, hariKerja: 30 });

const bersih = ringkasanOwner({
  penjualan: { omzet: 20000000, porsi: 2000, labaKotor: 8000000, persenTerlewat: 0 },
  operasional: { jumlahStokMinus: 0 },
  keuangan: { biayaTetap: 5000000, persenTanpaKategori: 0 },
  bep: bepSehat
});
cek('data bersih: layak dipercaya', bersih.layakDipercaya, true);
cek('data bersih: tidak ada alasan', bersih.alasan, []);
cek('sisa setelah biaya tetap', bersih.sisaSetelahBiayaTetap, 3000000);

const kotor = ringkasanOwner({
  penjualan: { omzet: 20000000, porsi: 2000, labaKotor: 8000000, persenTerlewat: 35 },
  operasional: { jumlahStokMinus: 12 },
  keuangan: { biayaTetap: 5000000, persenTanpaKategori: 44 },
  bep: hitungBep({ marginSatuan: 7000, hargaRata: 10000, biayaTetap: 0, hariKerja: 30 })
});
cek('data bermasalah: TIDAK layak dipercaya', kotor.layakDipercaya, false);
cek('  keempat masalahnya disebut satu per satu', kotor.alasan.length, 4);
if (!kotor.alasan.some((a) => a.includes('opname'))) {
  gagal++;
  console.error('❌ stok minus disebut tanpa mengarahkan ke opname');
}

// Ambang batasnya harus benar-benar menyaring, bukan sekadar ada.
const tepatDiAmbang = ringkasanOwner({
  penjualan: { omzet: 1, porsi: 1, labaKotor: 1, persenTerlewat: 10 },
  operasional: { jumlahStokMinus: 0 },
  keuangan: { biayaTetap: 1, persenTanpaKategori: 20 },
  bep: bepSehat
});
cek('tepat di ambang: belum dianggap bermasalah', tepatDiAmbang.layakDipercaya, true);

const lewatSedikit = ringkasanOwner({
  penjualan: { omzet: 1, porsi: 1, labaKotor: 1, persenTerlewat: 10.5 },
  operasional: { jumlahStokMinus: 0 },
  keuangan: { biayaTetap: 1, persenTanpaKategori: 0 },
  bep: bepSehat
});
cek('lewat ambang sedikit: langsung ditandai', lewatSedikit.layakDipercaya, false);

// SATU stok minus sudah cukup. Stok minus bukan soal banyaknya — satu bahan
// yang minus sudah membuat HPP dan nilai stok tidak bisa dipercaya.
const satuMinus = ringkasanOwner({
  penjualan: { omzet: 1, porsi: 1, labaKotor: 1, persenTerlewat: 0 },
  operasional: { jumlahStokMinus: 1 },
  keuangan: { biayaTetap: 1, persenTanpaKategori: 0 },
  bep: bepSehat
});
cek('satu bahan minus sudah cukup untuk menandai', satuMinus.layakDipercaya, false);

// Peringatan dari BEP ikut naik ke ringkasan, tidak berhenti di halaman BEP.
const bepBermasalah = ringkasanOwner({
  penjualan: { omzet: 1, porsi: 1, labaKotor: 1, persenTerlewat: 0 },
  operasional: { jumlahStokMinus: 0 },
  keuangan: { biayaTetap: 0, persenTanpaKategori: 0 },
  bep: hitungBep({ marginSatuan: 7000, hargaRata: 10000, biayaTetap: 0, hariKerja: 30 })
});
cek('peringatan BEP ikut naik ke ringkasan', bepBermasalah.layakDipercaya, false);

// =====================================================================
// TIDAK ADA DATA BUKAN DATA YANG BERSIH
//
// Versi pertama `ringkasanOwner` mengembalikan `layakDipercaya: true` untuk
// masukan kosong — karena tidak ada satu pun ambang yang terlampaui. Omzet 0
// lalu tampil di kartu teratas tanpa satu pun tanda, dan nol yang tenang jauh
// lebih dipercaya daripada nol yang bertanda tanya.
// =====================================================================
const nol = ringkasanOwner({});
cek('ringkasan dari data kosong tidak error', nol.omzet, 0);
cek('data kosong TIDAK boleh mengaku layak dipercaya', nol.layakDipercaya, false);
if (!nol.alasan.some((a) => a.includes('kosong, bukan nol'))) {
  gagal++;
  console.error('❌ data kosong tidak dibedakan dari nol yang sungguhan');
}

// Rentang tanpa penjualan, walau bagian lain datanya rapi.
const tanpaJualan = ringkasanOwner({
  penjualan: { omzet: 0, porsi: 0, labaKotor: 0, persenTerlewat: 0 },
  operasional: { jumlahStokMinus: 0 },
  keuangan: { biayaTetap: 5000000, persenTanpaKategori: 0 },
  bep: hitungBep({ marginSatuan: null, hargaRata: null, biayaTetap: 5000000 })
});
cek('tanpa penjualan: tidak layak dipercaya', tanpaJualan.layakDipercaya, false);
if (!tanpaJualan.alasan.some((a) => a.includes('Belum ada penjualan yang bisa dihitung'))) {
  gagal++;
  console.error('❌ sebab BEP gagal total tidak ikut naik ke ringkasan');
}

console.log(gagal === 0 ? '✅ kpi owner: semua lulus' : `❌ kpi owner: ${gagal} gagal`);
process.exit(gagal === 0 ? 0 : 1);
