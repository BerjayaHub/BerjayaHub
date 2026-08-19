/**
 * BEP & bauran penjualan.
 *
 * Berkas ini punya satu tes yang lebih penting daripada semuanya digabung:
 * PEMBOBOTAN. Ia yang membedakan halaman BEP Berjaya Hub dari Project Hub, dan
 * ia juga satu-satunya kesalahan di sini yang tidak akan pernah terlihat salah
 * — karena rata-rata datar SELALU menghasilkan angka yang wajar, hanya kebetulan
 * angka yang salah, dan salahnya selalu ke arah yang menyenangkan.
 *
 * Fixture di bawah sengaja dibuat ekstrem supaya bedanya tidak bisa lolos:
 * satu menu murah yang laku 400, satu menu mahal yang laku 3.
 */
const { biayaTetapDariKas, bauranPenjualan, hitungBep, posisiTerhadapBep } = await import('../js/modules/owner/bep.js');

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
// BIAYA TETAP DARI KAS
// =====================================================================
const kategori = [
  { id: 'k-sewa', name: 'Sewa', is_fixed_cost: true },
  { id: 'k-gaji', name: 'Gaji', is_fixed_cost: true },
  { id: 'k-bahan', name: 'Belanja Bahan', is_fixed_cost: false },
  { id: 'k-lain', name: 'Lain-lain' } // tanpa penanda sama sekali
];

const entri = [
  { entry_type: 'out', amount: -5000000, category_id: 'k-sewa' },
  { entry_type: 'out', amount: -8000000, category_id: 'k-gaji' },
  { entry_type: 'out', amount: -2000000, category_id: 'k-gaji' },
  { entry_type: 'out', amount: -3000000, category_id: 'k-bahan' }, // variabel
  { entry_type: 'out', amount: -700000, category_id: null }, // belum berkategori
  { entry_type: 'out', amount: -100000, category_id: 'k-lain' }, // tak ditandai
  { entry_type: 'in', amount: 20000000, category_id: 'k-sewa' }, // MASUK: bukan biaya
  { entry_type: 'transfer_out', amount: -1000000, category_id: 'k-sewa' }, // pindah, bukan biaya
  { entry_type: 'move_in', amount: 1000000, category_id: 'k-sewa' }
];

const bt = biayaTetapDariKas(entri, kategori);
cek('hanya kategori bertanda tetap yang dijumlah', bt.total, 15000000);
cek('kas keluar tanpa kategori dihitung TERPISAH', bt.tanpaKategori, 700000);
cek('rincian per kategori diurut menurun', bt.perKategori.map((k) => k.nama), ['Gaji', 'Sewa']);
cek('gaji dua entri dijumlahkan', bt.perKategori[0].total, 10000000);

// `amount` bertanda: nilai mutlaknya yang dipakai. Kalau suatu saat ada entri
// keluar yang tersimpan positif, ia tetap harus dihitung sebagai pengeluaran.
cek(
  'keluar bertanda positif tetap dihitung',
  biayaTetapDariKas([{ entry_type: 'out', amount: 5000000, category_id: 'k-sewa' }], kategori).total,
  5000000
);

cek('daftar kosong aman', biayaTetapDariKas([], kategori).total, 0);
cek('entri null aman', biayaTetapDariKas(null, null).total, 0);
cek('kategori kosong: tidak ada yang tetap', biayaTetapDariKas(entri, []).total, 0);

// =====================================================================
// PEMBOBOTAN — INTI BERKAS INI
// =====================================================================
const products = [
  { id: 'p-kopi', name: 'Kopi Susu', packaging_cost: 0 },
  { id: 'p-steak', name: 'Steak Wagyu', packaging_cost: 0 }
];
const biaya = new Map([
  ['p-kopi', 3000],
  ['p-steak', 30000]
]);
const sales = [
  { product_id: 'p-kopi', qty: 400, unit_price: 10000 },
  { product_id: 'p-steak', qty: 3, unit_price: 100000 }
];

const b = bauranPenjualan({ sales, products, biaya });

cek('total porsi', b.totalQty, 403);
cek('total omzet', b.totalOmzet, 4300000);

// Rata-rata DATAR margin = (7000 + 70000) / 2 = 38500.
// Rata-rata DITIMBANG  = (400x7000 + 3x70000) / 403 = 7468.98...
//
// Bedanya lima kali lipat. Kalau angka di bawah pernah mendekati 38500,
// pembobotannya hilang.
dekat('margin tertimbang, BUKAN rata-rata datar', b.marginTertimbang, 3010000 / 403);
if (b.marginTertimbang > 20000) {
  gagal++;
  console.error(`❌ margin tertimbang ${b.marginTertimbang} terlalu tinggi — ini rata-rata datar, bukan tertimbang`);
}

dekat('harga tertimbang', b.hargaTertimbang, 4300000 / 403);
dekat('HPP tertimbang', b.hppTertimbang, 1290000 / 403);

// Identitas yang harus selalu berlaku: margin tertimbang = harga tertimbang
// dikurangi HPP tertimbang. Kalau salah satunya dihitung dengan cara berbeda,
// tes ini yang jatuh lebih dulu.
dekat('margin = harga - hpp (tertimbang)', b.marginTertimbang, b.hargaTertimbang - b.hppTertimbang, 1e-9);

// Menu penyumbang laba terbesar diurutkan duluan. Kopi menyumbang 2,8 juta;
// steak hanya 210 ribu — walau marginnya per porsi sepuluh kali lipat.
cek('diurutkan menurut kontribusi, bukan margin satuan', b.baris.map((x) => x.nama), ['Kopi Susu', 'Steak Wagyu']);
dekat('kontribusi kopi', b.baris[0].kontribusi, 2800000);
dekat('porsi kopi hampir seluruh penjualan', b.baris[0].porsiPersen, (400 / 403) * 100);

// =====================================================================
// KEMASAN IKUT MENAMBAH HPP
// =====================================================================
const denganKemasan = bauranPenjualan({
  sales: [{ product_id: 'p-kopi', qty: 10, unit_price: 10000 }],
  products: [{ id: 'p-kopi', name: 'Kopi Susu', packaging_cost: 1500 }],
  biaya
});
dekat('kemasan masuk HPP satuan', denganKemasan.hppTertimbang, 4500);
dekat('kemasan mengurangi margin', denganKemasan.marginTertimbang, 5500);

// =====================================================================
// YANG TIDAK BISA DIHITUNG DIKELUARKAN — TIDAK DIANGGAP NOL
//
// Ini kesalahan paling mahal yang mungkin terjadi di sini. HPP kosong yang
// dianggap 0 menghasilkan margin 100%, BEP anjlok, dan semuanya tetap terlihat
// masuk akal.
// =====================================================================
const adaYangKosong = bauranPenjualan({
  sales: [
    { product_id: 'p-kopi', qty: 100, unit_price: 10000 },
    { product_id: 'p-misteri', qty: 100, unit_price: 10000 }
  ],
  products: [
    { id: 'p-kopi', name: 'Kopi Susu' },
    { id: 'p-misteri', name: 'Menu Tanpa Resep' }
  ],
  biaya: new Map([['p-kopi', 3000]]) // p-misteri tidak ada -> HPP tidak diketahui
});

cek('menu tanpa HPP tidak masuk baris', adaYangKosong.baris.length, 1);
cek('  dan dilaporkan sebagai terlewat', adaYangKosong.terlewat.map((t) => t.nama), ['Menu Tanpa Resep']);
cek('  dengan sebab yang bisa ditindaklanjuti', adaYangKosong.terlewat[0].sebab, 'HPP belum bisa dihitung');
cek('  qty-nya tidak ikut total', adaYangKosong.totalQty, 100);
dekat('  separuh penjualan tidak terhitung', adaYangKosong.persenTerlewat, 50);

// Kalau HPP kosong dianggap 0, margin tertimbang akan jadi (7000+10000)/2 = 8500.
dekat('margin hanya dari yang diketahui', adaYangKosong.marginTertimbang, 7000);

// HPP bernilai null EKSPLISIT (bukan sekadar tidak ada) juga harus dikeluarkan —
// computeCosts() memang mengembalikan null, bukan menghilangkan kuncinya.
const hppNull = bauranPenjualan({
  sales: [{ product_id: 'p-kopi', qty: 10, unit_price: 10000 }],
  products: [{ id: 'p-kopi', name: 'Kopi Susu' }],
  biaya: new Map([['p-kopi', null]])
});
cek('HPP null eksplisit dikeluarkan', hppNull.baris.length, 0);
cek('  dan dilaporkan', hppNull.terlewat[0]?.sebab, 'HPP belum bisa dihitung');

// Penjualan tanpa harga sama sekali.
const tanpaHarga = bauranPenjualan({
  sales: [{ product_id: 'p-kopi', qty: 10 }],
  products: [{ id: 'p-kopi', name: 'Kopi Susu' }],
  biaya
});
cek('penjualan tanpa harga dikeluarkan', tanpaHarga.baris.length, 0);
cek('  sebabnya dibedakan dari HPP kosong', tanpaHarga.terlewat[0].sebab, 'Penjualannya tidak mencatat harga');

// `revenue` menang atas qty x unit_price — ia yang benar-benar tercatat masuk.
const pakaiRevenue = bauranPenjualan({
  sales: [{ product_id: 'p-kopi', qty: 10, unit_price: 10000, revenue: 90000 }],
  products: [{ id: 'p-kopi', name: 'Kopi Susu' }],
  biaya
});
dekat('revenue dipakai kalau ada (mis. ada diskon)', pakaiRevenue.hargaTertimbang, 9000);

// Satu produk terjual di beberapa hari -> digabung, bukan jadi beberapa baris.
const beberapaHari = bauranPenjualan({
  sales: [
    { product_id: 'p-kopi', qty: 10, unit_price: 10000 },
    { product_id: 'p-kopi', qty: 5, unit_price: 12000 }
  ],
  products: [{ id: 'p-kopi', name: 'Kopi Susu' }],
  biaya
});
cek('penjualan produk sama digabung jadi satu baris', beberapaHari.baris.length, 1);
cek('  qty-nya dijumlah', beberapaHari.baris[0].qty, 15);
dekat('  harganya rata-rata tertimbang, bukan rata-rata harga', beberapaHari.baris[0].hargaRata, 160000 / 15);

// Masukan rusak.
cek('sales kosong: tidak ada rata-rata yang dikarang', bauranPenjualan({ sales: [], products, biaya }).marginTertimbang, null);
cek('semua null aman', bauranPenjualan({}).totalQty, 0);
cek('qty nol diabaikan', bauranPenjualan({ sales: [{ product_id: 'p-kopi', qty: 0, unit_price: 1 }], products, biaya }).totalQty, 0);
cek('qty negatif diabaikan', bauranPenjualan({ sales: [{ product_id: 'p-kopi', qty: -5, unit_price: 1 }], products, biaya }).totalQty, 0);

// =====================================================================
// BEP
// =====================================================================
const bep = hitungBep({ marginSatuan: 7000, hargaRata: 10000, biayaTetap: 21000000, hariKerja: 30 });
dekat('BEP porsi', bep.porsi, 3000);
dekat('BEP omzet', bep.omzet, 30000000);
dekat('BEP harian', bep.porsiHarian, 100);
dekat('BEP omzet harian', bep.omzetHarian, 1000000);
cek('tidak ada sebab saat semuanya wajar', bep.sebab, null);
cek('tidak ada peringatan saat semuanya wajar', bep.peringatan, []);

const denganTarget = hitungBep({ marginSatuan: 7000, hargaRata: 10000, biayaTetap: 21000000, targetLaba: 7000000, hariKerja: 30 });
dekat('target laba menambah porsi yang harus terjual', denganTarget.porsi, 4000);

// MARGIN NOL & MINUS.
//
// Membagi dengan margin minus menghasilkan BEP NEGATIF — dan angka negatif
// terbaca seolah targetnya sudah terlampaui, kebalikan persis dari keadaannya.
const marginNol = hitungBep({ marginSatuan: 0, hargaRata: 10000, biayaTetap: 21000000 });
cek('margin nol: tidak ada BEP', marginNol.porsi, null);
if (!marginNol.sebab?.includes('sama dengan HPP')) {
  gagal++;
  console.error(`❌ margin nol: sebabnya tidak menjelaskan — "${marginNol.sebab}"`);
}

const marginMinus = hitungBep({ marginSatuan: -500, hargaRata: 10000, biayaTetap: 21000000 });
cek('margin minus: TIDAK menghasilkan angka negatif', marginMinus.porsi, null);
if (!marginMinus.sebab?.includes('DI BAWAH HPP')) {
  gagal++;
  console.error(`❌ margin minus: sebabnya tidak menjelaskan — "${marginMinus.sebab}"`);
}

// BIAYA TETAP NOL: benar secara matematika, hampir pasti salah secara kenyataan.
const tanpaBiaya = hitungBep({ marginSatuan: 7000, hargaRata: 10000, biayaTetap: 0, hariKerja: 30 });
cek('biaya tetap nol: BEP 0', tanpaBiaya.porsi, 0);
if (!tanpaBiaya.peringatan.some((p) => p.includes('belum ditandai'))) {
  gagal++;
  console.error('❌ biaya tetap nol lolos tanpa peringatan — BEP 0 akan terbaca "selalu untung"');
}

// Tanpa penjualan sama sekali.
const kosong = hitungBep({ marginSatuan: null, hargaRata: null, biayaTetap: 21000000 });
cek('tanpa penjualan: porsi null', kosong.porsi, null);
if (!kosong.sebab?.includes('Belum ada penjualan')) {
  gagal++;
  console.error(`❌ tanpa penjualan: sebabnya tidak jelas — "${kosong.sebab}"`);
}

// Hari kerja nol tidak boleh menghasilkan Infinity.
const tanpaHari = hitungBep({ marginSatuan: 7000, hargaRata: 10000, biayaTetap: 21000000, hariKerja: 0 });
cek('hari kerja nol: harian null, bukan Infinity', tanpaHari.porsiHarian, null);
cek('  BEP bulanannya tetap ada', tanpaHari.porsi, 3000);
if (!tanpaHari.peringatan.some((p) => p.includes('hari kerja'))) {
  gagal++;
  console.error('❌ hari kerja nol lolos tanpa peringatan');
}

// =====================================================================
// POSISI TERHADAP BEP
// =====================================================================
cek('sudah lewat BEP', posisiTerhadapBep({ totalQty: 3500, bepPorsi: 3000 }).lewat, true);
cek('belum lewat BEP', posisiTerhadapBep({ totalQty: 2000, bepPorsi: 3000 }).lewat, false);
cek('persis di BEP dihitung lewat', posisiTerhadapBep({ totalQty: 3000, bepPorsi: 3000 }).lewat, true);
dekat('persen pencapaian', posisiTerhadapBep({ totalQty: 1500, bepPorsi: 3000 }).persen, 50);
cek('BEP null: tidak menyimpulkan apa pun', posisiTerhadapBep({ totalQty: 3500, bepPorsi: null }).lewat, null);
cek('BEP nol: tidak dibagi', posisiTerhadapBep({ totalQty: 3500, bepPorsi: 0 }).persen, null);

console.log(gagal === 0 ? '✅ bep: semua lulus' : `❌ bep: ${gagal} gagal`);
process.exit(gagal === 0 ? 0 : 1);
