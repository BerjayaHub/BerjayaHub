/**
 * Bahan menipis — dari penjualan × resep.
 *
 * Yang paling ditekankan, karena semuanya gagal DIAM-DIAM:
 *
 *  - Pemakaian dihitung di SETIAP tingkat resep, bukan cuma bahan bakunya.
 *  - Menu "Dilayani CK" TIDAK boleh membentang jadi bahan di outlet gerai.
 *  - Batas manual 0 berbeda dari "tidak ada batas manual".
 *  - Resep bersiklus harus berhenti, bukan menggantung atau melempar error.
 *
 * Kalau salah satu meleset, angkanya tetap masuk akal dilihat — dan orang
 * belanja mengikutinya.
 */
import { pembentangResep, pemakaianHarian, susunBahanMenipis, teksBelanja } from '../js/modules/inventory/bahan-menipis.js';

let gagal = 0;
const cek = (nama, dapat, harap) => {
  if (JSON.stringify(dapat) !== JSON.stringify(harap)) {
    gagal++;
    console.error(`❌ ${nama}\n   dapat : ${JSON.stringify(dapat)}\n   harap : ${JSON.stringify(harap)}`);
  }
};
const dekat = (nama, dapat, harap, tol = 1e-6) => {
  if (!(Math.abs(Number(dapat) - Number(harap)) < tol)) {
    gagal++;
    console.error(`❌ ${nama}\n   dapat : ${dapat}\n   harap : ${harap}`);
  }
};

// ---------------------------------------------------------
// Data dasar: menu "Nasi Ayam" -> sambal (semi) -> cabai (raw)
// ---------------------------------------------------------
const products = [
  { id: 'cabai', name: 'Cabai Merah', base_unit: 'kg', product_type: 'raw', category: 'Sayur' },
  { id: 'ayam', name: 'Ayam', base_unit: 'kg', product_type: 'raw', category: 'Protein' },
  { id: 'garam', name: 'Garam', base_unit: 'kg', product_type: 'raw', category: 'Bumbu' },
  { id: 'sambal', name: 'Sambal', base_unit: 'kg', product_type: 'semi', category: 'Olahan' },
  { id: 'nasiayam', name: 'Nasi Ayam', base_unit: 'porsi', product_type: 'finished' },
  { id: 'sotock', name: 'Soto (CK)', base_unit: 'porsi', product_type: 'finished' }
];

const recipes = [
  // 1 kg sambal = 0,8 kg cabai + 0,02 kg garam
  { product_id: 'sambal', mode: 'production', yield_qty: 1, items: [
    { ingredient_product_id: 'cabai', qty: 0.8 },
    { ingredient_product_id: 'garam', qty: 0.02 }
  ] },
  // 1 porsi nasi ayam = 0,2 kg ayam + 0,05 kg sambal
  { product_id: 'nasiayam', mode: 'standalone', yield_qty: 1, items: [
    { ingredient_product_id: 'ayam', qty: 0.2 },
    { ingredient_product_id: 'sambal', qty: 0.05 }
  ] },
  // Soto HANYA punya varian CK
  { product_id: 'sotock', mode: 'served_by_ck', yield_qty: 1, items: [
    { ingredient_product_id: 'ayam', qty: 0.3 }
  ] }
];

// =====================================================================
// PEMBENTANGAN RESEP
// =====================================================================
const bentang = pembentangResep(products, recipes);

const isiNasi = bentang('nasiayam');
dekat('nasi ayam pakai ayam 0,2', isiNasi.get('ayam'), 0.2);
dekat('nasi ayam pakai sambal 0,05 (tingkat ini ikut dihitung)', isiNasi.get('sambal'), 0.05);
dekat('nasi ayam pakai cabai 0,05 x 0,8 = 0,04', isiNasi.get('cabai'), 0.04);
dekat('nasi ayam pakai garam 0,05 x 0,02 = 0,001', isiNasi.get('garam'), 0.001);
cek('bahannya empat', isiNasi.size, 4);

// MENU DILAYANI CK: tidak membentang sama sekali.
cek('soto CK tidak membentang jadi bahan', bentang('sotock').size, 0);

// Bahan baku tidak punya isi.
cek('bahan baku tidak membentang', bentang('cabai').size, 0);
cek('produk tak dikenal aman', bentang('entah').size, 0);

// Semi dibentang sendiri juga benar.
const isiSambal = bentang('sambal');
dekat('sambal pakai cabai 0,8', isiSambal.get('cabai'), 0.8);
dekat('sambal pakai garam 0,02', isiSambal.get('garam'), 0.02);

// ---- yield > 1 ----
const bentangYield = pembentangResep(products, [
  { product_id: 'sambal', mode: 'production', yield_qty: 5, items: [{ ingredient_product_id: 'cabai', qty: 4 }] }
]);
dekat('yield 5 dari 4 kg cabai -> 0,8 per kg', bentangYield('sambal').get('cabai'), 0.8);

// ---- resep tanpa item / yield 0 ----
const bentangRusak = pembentangResep(products, [
  { product_id: 'sambal', mode: 'production', yield_qty: 0, items: [{ ingredient_product_id: 'cabai', qty: 1 }] }
]);
cek('yield 0 tidak menghasilkan Infinity', bentangRusak('sambal').size, 0);

// =====================================================================
// SIKLUS — harus berhenti, tidak menggantung, tidak melempar
// =====================================================================
const siklus = [
  { product_id: 'a', mode: 'production', yield_qty: 1, items: [{ ingredient_product_id: 'b', qty: 1 }] },
  { product_id: 'b', mode: 'production', yield_qty: 1, items: [{ ingredient_product_id: 'a', qty: 1 }] }
];
const pSiklus = [
  { id: 'a', name: 'A', base_unit: 'kg', product_type: 'semi' },
  { id: 'b', name: 'B', base_unit: 'kg', product_type: 'semi' }
];
let lolosSiklus = true;
try {
  const hasil = pembentangResep(pSiklus, siklus)('a');
  cek('siklus tetap melaporkan b sebagai bahan a', hasil.has('b'), true);
} catch {
  lolosSiklus = false;
}
cek('siklus tidak melempar error', lolosSiklus, true);

// =====================================================================
// PEMAKAIAN HARIAN
// =====================================================================
const sales28 = [
  { product_id: 'nasiayam', qty: 280 }, // 10/hari selama 28 hari
  { product_id: 'sotock', qty: 56 } //  2/hari
];
const perHari = pemakaianHarian({ products, recipes, sales: sales28, hari: 28 });

dekat('ayam: 10 x 0,2 = 2/hari (soto CK TIDAK ikut)', perHari.get('ayam'), 2);
dekat('sambal 10 x 0,05 = 0,5/hari', perHari.get('sambal'), 0.5);
dekat('cabai 10 x 0,04 = 0,4/hari', perHari.get('cabai'), 0.4);
dekat('soto CK memakai dirinya sendiri 2/hari', perHari.get('sotock'), 2);

// Rentang tidak masuk akal -> peta kosong, bukan Infinity.
cek('hari 0 -> kosong', pemakaianHarian({ products, recipes, sales: sales28, hari: 0 }).size, 0);
cek('hari negatif -> kosong', pemakaianHarian({ products, recipes, sales: sales28, hari: -7 }).size, 0);
cek('tanpa penjualan -> kosong', pemakaianHarian({ products, recipes, sales: [], hari: 28 }).size, 0);
cek('sales null aman', pemakaianHarian({ products, recipes, sales: null, hari: 28 }).size, 0);

// Penjualan bahan baku langsung (air mineral botol).
const perHariRaw = pemakaianHarian({ products, recipes, sales: [{ product_id: 'garam', qty: 7 }], hari: 7 });
dekat('bahan baku dijual langsung terhitung', perHariRaw.get('garam'), 1);

// Qty aneh diabaikan, tidak merusak yang lain.
const perHariAneh = pemakaianHarian({
  products,
  recipes,
  sales: [{ product_id: 'nasiayam', qty: 280 }, { product_id: 'nasiayam', qty: null }, { product_id: 'nasiayam', qty: 'x' }],
  hari: 28
});
dekat('qty null/teks diabaikan', perHariAneh.get('ayam'), 2);

// =====================================================================
// TABEL BAHAN MENIPIS
// =====================================================================
const stok = new Map([['ayam', 5], ['sambal', 4], ['cabai', 0], ['garam', 10]]);
const lap = susunBahanMenipis({ products, recipes, sales: sales28, hari: 28, stok, hariAman: 5 });

const cari = (id) => lap.baris.find((r) => r.productId === id);

// ayam: pakai 2/hari, batas 2x5 = 10, stok 5 -> menipis, cukup 2,5 hari
cek('ayam menipis', cari('ayam').status, 'menipis');
dekat('ayam batas 10', cari('ayam').batas, 10);
dekat('ayam cukup 2,5 hari', cari('ayam').cukupHari, 2.5);
dekat('ayam saran beli 5', cari('ayam').saranBeli, 5);

// sambal: 0,5/hari, batas 2,5, stok 4 -> aman
cek('sambal aman', cari('sambal').status, 'aman');
dekat('sambal saran beli 0', cari('sambal').saranBeli, 0);

// cabai: stok 0 -> habis
cek('cabai habis', cari('cabai').status, 'habis');
cek('cabai cukupHari 0', cari('cabai').cukupHari, 0);
dekat('cabai saran beli = batas', cari('cabai').saranBeli, 0.4 * 5);

// garam: 0,001/hari x 5 = 0,005, stok 10 -> aman
cek('garam aman', cari('garam').status, 'aman');

// MENU TIDAK MASUK DAFTAR BELANJA
cek('menu tidak muncul', lap.baris.some((r) => r.productId === 'nasiayam'), false);
cek('menu CK tidak muncul walau terpakai', lap.baris.some((r) => r.productId === 'sotock'), false);

// URUTAN: habis dulu, lalu yang paling cepat habis
cek('baris pertama yang habis', lap.baris[0].productId, 'cabai');
cek('baris kedua ayam (2,5 hari)', lap.baris[1].productId, 'ayam');

cek('hitungan habis', lap.jumlahHabis, 1);
cek('hitungan menipis', lap.jumlahMenipis, 1);
cek('perlu = habis + menipis', lap.perlu.length, 2);
cek('hariAman ikut dilaporkan', lap.hariAman, 5);
cek('hariData ikut dilaporkan', lap.hariData, 28);

// =====================================================================
// BAHAN TANPA RIWAYAT PEMAKAIAN — DISEMBUNYIKAN (pilihan yang diminta)
// =====================================================================
const productsPlus = [...products, { id: 'baru', name: 'Bahan Baru', base_unit: 'kg', product_type: 'raw' }];
const lapBaru = susunBahanMenipis({
  products: productsPlus,
  recipes,
  sales: sales28,
  hari: 28,
  stok: new Map([...stok, ['baru', 0]]),
  hariAman: 5
});
cek('bahan tanpa pemakaian disembunyikan', lapBaru.baris.some((r) => r.productId === 'baru'), false);
cek('tapi jumlahnya dilaporkan', lapBaru.tersembunyi, 1);

// ...dan MUNCUL begitu diberi batas manual — jalan keluar yang dijanjikan.
const lapBaruManual = susunBahanMenipis({
  products: productsPlus,
  recipes,
  sales: sales28,
  hari: 28,
  stok: new Map([...stok, ['baru', 0]]),
  hariAman: 5,
  batasManual: new Map([['baru', 3]])
});
cek('batas manual memunculkannya', lapBaruManual.baris.some((r) => r.productId === 'baru'), true);
cek('dan statusnya habis', lapBaruManual.baris.find((r) => r.productId === 'baru').status, 'habis');
cek('tidak lagi terhitung tersembunyi', lapBaruManual.tersembunyi, 0);

// STATUS MENDAHULUI "cukup berapa hari" — dan ini harus diuji dengan kasus
// yang benar-benar MEMISAHKAN kedua aturan itu.
//
// 'baru' habis TAPI cukupHari-nya null (tidak ada pemakaian, jadi tidak bisa
// dihitung). Kalau urutannya cuma memakai cukupHari, null jatuh ke paling
// belakang dan bahan yang benar-benar HABIS tenggelam di bawah yang aman.
// Versi pertama tes ini tidak menangkapnya: di fixture utama, yang habis
// kebetulan juga yang cukupHari-nya paling kecil.
cek('yang habis tanpa data pemakaian tetap di atas', lapBaruManual.baris.find((r) => r.productId === 'baru').cukupHari, null);
cek('  dan urutannya di dua besar', lapBaruManual.baris.slice(0, 2).map((r) => r.productId).includes('baru'), true);
cek('  sedangkan yang aman ada di bawahnya', lapBaruManual.baris.at(-1).status, 'aman');

// =====================================================================
// BATAS MANUAL
// =====================================================================
const lapManual = susunBahanMenipis({
  products, recipes, sales: sales28, hari: 28, stok, hariAman: 5,
  batasManual: new Map([['ayam', 3]])
});
dekat('manual menimpa otomatis', lapManual.baris.find((r) => r.productId === 'ayam').batas, 3);
cek('ditandai manual', lapManual.baris.find((r) => r.productId === 'ayam').batasManual, true);
cek('stok 5 di atas batas 3 -> aman', lapManual.baris.find((r) => r.productId === 'ayam').status, 'aman');
cek('hariAman null kalau manual', lapManual.baris.find((r) => r.productId === 'ayam').hariAman, null);

// BATAS MANUAL 0 = SENGAJA TIDAK DIAWASI, bukan "belum diatur".
const lapNol = susunBahanMenipis({
  products, recipes, sales: sales28, hari: 28, stok, hariAman: 5,
  batasManual: new Map([['cabai', 0]])
});
cek('batas manual 0 mengeluarkan bahannya dari daftar', lapNol.baris.some((r) => r.productId === 'cabai'), false);
cek('dan cabai tidak lagi dihitung habis', lapNol.jumlahHabis, 0);
// Sedangkan TANPA baris manual, cabai tetap muncul — inilah bedanya.
cek('tanpa baris manual, cabai muncul', lap.baris.some((r) => r.productId === 'cabai'), true);

// ---- bahan nonaktif tidak ikut ----
const lapNonaktif = susunBahanMenipis({
  products: products.map((p) => (p.id === 'ayam' ? { ...p, is_active: false } : p)),
  recipes, sales: sales28, hari: 28, stok, hariAman: 5
});
cek('bahan nonaktif dikeluarkan', lapNonaktif.baris.some((r) => r.productId === 'ayam'), false);

// ---- hariAman tidak masuk akal -> jatuh ke 7 ----
cek('hariAman 0 jatuh ke 7', susunBahanMenipis({ products, recipes, sales: sales28, hari: 28, stok, hariAman: 0 }).hariAman, 7);
cek('hariAman null jatuh ke 7', susunBahanMenipis({ products, recipes, sales: sales28, hari: 28, stok, hariAman: null }).hariAman, 7);

// ---- stok kosong sama sekali ----
const lapTanpaStok = susunBahanMenipis({ products, recipes, sales: sales28, hari: 28, stok: new Map(), hariAman: 5 });
cek('tanpa stok semuanya habis', lapTanpaStok.jumlahMenipis, 0);
cek('dan tidak ada yang aman', lapTanpaStok.jumlahAman, 0);

// =====================================================================
// TEKS WHATSAPP
// =====================================================================
const teks = teksBelanja(lap, { outlet: 'Gading Serpong', tanggal: '18 Agu 2026' });
cek('memuat judul', teks.includes('*Bahan Perlu Dibeli*'), true);
cek('memuat outlet', teks.includes('Gading Serpong'), true);
cek('memuat bahan habis', teks.includes('Cabai Merah'), true);
cek('memuat bahan menipis', teks.includes('Ayam'), true);
cek('TIDAK memuat yang aman', teks.includes('Sambal'), false);
cek('menandai HABIS', teks.includes('HABIS'), true);
cek('memuat target hari', teks.includes('5 hari'), true);
// Koma desimal — bukan titik, karena dibaca orang Indonesia di chat.
cek('angka pakai koma desimal', teks.includes('2,5'), true);

const teksAman = teksBelanja({ perlu: [], hariAman: 5 }, { outlet: 'Sentul' });
cek('kalau tidak ada yang menipis, katakan begitu', teksAman.includes('Tidak ada bahan yang menipis'), true);

if (gagal) {
  console.error(`\n${gagal} kasus gagal.`);
  process.exit(1);
}
console.log('Bahan menipis benar untuk 65 kasus — termasuk menu Dilayani CK, resep bertingkat, siklus, dan batas manual 0. ✅');
