/**
 * Bahan menipis — stok akhir ÷ takaran resep = cukup berapa porsi lagi.
 *
 * Yang paling ditekankan, karena semuanya gagal DIAM-DIAM:
 *
 *  - Takaran RATA-RATA dari semua menu yang memakai bahan itu.
 *  - Pemakaian dihitung di SETIAP tingkat resep, bukan cuma bahan bakunya.
 *  - Menu "Dilayani CK" TIDAK boleh ikut menyumbang takaran di outlet gerai.
 *  - Bahan tanpa resep hanya diawasi lewat batas manual — dan batas manual 0
 *    berbeda dari "tidak ada batas manual".
 *  - Resep bersiklus harus berhenti, bukan menggantung atau melempar.
 *
 * Kalau salah satu meleset, angkanya tetap masuk akal dilihat — dan orang
 * belanja mengikutinya.
 */
import { pembentangResep, takaranPerPorsi, susunBahanMenipis, teksBelanja } from '../js/modules/inventory/bahan-menipis.js';

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
// Nasi Ayam -> ayam + sambal (semi) -> cabai + garam
// Soto      -> ayam (takaran beda)
// Soto CK   -> hanya varian "Dilayani CK"
// ---------------------------------------------------------
const products = [
  { id: 'cabai', name: 'Cabai Merah', base_unit: 'kg', product_type: 'raw', category: 'Sayur' },
  { id: 'ayam', name: 'Ayam', base_unit: 'kg', product_type: 'raw', category: 'Protein' },
  { id: 'garam', name: 'Garam', base_unit: 'kg', product_type: 'raw', category: 'Bumbu' },
  { id: 'gas', name: 'Gas 12kg', base_unit: 'tabung', product_type: 'raw', category: 'Umum' },
  { id: 'sambal', name: 'Sambal', base_unit: 'kg', product_type: 'semi', category: 'Olahan' },
  { id: 'nasiayam', name: 'Nasi Ayam', base_unit: 'porsi', product_type: 'finished' },
  { id: 'soto', name: 'Soto Ayam', base_unit: 'porsi', product_type: 'finished' },
  { id: 'sotock', name: 'Soto CK', base_unit: 'porsi', product_type: 'finished' }
];

const recipes = [
  { product_id: 'sambal', mode: 'production', yield_qty: 1, items: [
    { ingredient_product_id: 'cabai', qty: 0.8 },
    { ingredient_product_id: 'garam', qty: 0.02 }
  ] },
  { product_id: 'nasiayam', mode: 'standalone', yield_qty: 1, items: [
    { ingredient_product_id: 'ayam', qty: 0.2 },
    { ingredient_product_id: 'sambal', qty: 0.05 }
  ] },
  { product_id: 'soto', mode: 'standalone', yield_qty: 1, items: [{ ingredient_product_id: 'ayam', qty: 0.1 }] },
  { product_id: 'sotock', mode: 'served_by_ck', yield_qty: 1, items: [{ ingredient_product_id: 'ayam', qty: 0.3 }] }
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
cek('menu Dilayani CK tidak membentang', bentang('sotock').size, 0);
cek('bahan baku tidak membentang', bentang('cabai').size, 0);

const bentangYield = pembentangResep(products, [
  { product_id: 'sambal', mode: 'production', yield_qty: 5, items: [{ ingredient_product_id: 'cabai', qty: 4 }] }
]);
dekat('yield 5 dari 4 kg cabai -> 0,8 per kg', bentangYield('sambal').get('cabai'), 0.8);
cek(
  'yield 0 tidak menghasilkan Infinity',
  pembentangResep(products, [{ product_id: 'sambal', mode: 'production', yield_qty: 0, items: [{ ingredient_product_id: 'cabai', qty: 1 }] }])('sambal').size,
  0
);

// ---- siklus ----
const pSiklus = [
  { id: 'a', name: 'A', base_unit: 'kg', product_type: 'semi' },
  { id: 'b', name: 'B', base_unit: 'kg', product_type: 'semi' }
];
const rSiklus = [
  { product_id: 'a', mode: 'production', yield_qty: 1, items: [{ ingredient_product_id: 'b', qty: 1 }] },
  { product_id: 'b', mode: 'production', yield_qty: 1, items: [{ ingredient_product_id: 'a', qty: 1 }] }
];
let lolosSiklus = true;
try {
  cek('siklus tetap melaporkan b sebagai bahan a', pembentangResep(pSiklus, rSiklus)('a').has('b'), true);
} catch {
  lolosSiklus = false;
}
cek('siklus tidak melempar error', lolosSiklus, true);

// =====================================================================
// TAKARAN RATA-RATA
// =====================================================================
const tk = takaranPerPorsi(products, recipes);

// Ayam: Nasi Ayam 0,2 + Soto 0,1 -> rata 0,15. Soto CK TIDAK ikut.
dekat('ayam rata-rata 0,15', tk.get('ayam').rata, 0.15);
cek('ayam dipakai 2 menu (CK tidak dihitung)', tk.get('ayam').jumlahMenu, 2);
dekat('ayam takaran terkecil 0,1', tk.get('ayam').min, 0.1);
dekat('ayam takaran terbesar 0,2', tk.get('ayam').maks, 0.2);

// Sambal & cabai hanya dari Nasi Ayam.
dekat('sambal 0,05', tk.get('sambal').rata, 0.05);
cek('sambal cuma 1 menu', tk.get('sambal').jumlahMenu, 1);
dekat('cabai 0,04', tk.get('cabai').rata, 0.04);
dekat('garam 0,001', tk.get('garam').rata, 0.001);

// Gas tidak dipakai resep mana pun.
cek('gas tidak punya takaran', tk.has('gas'), false);

// Menu nonaktif tidak menyumbang takaran.
const tkNonaktif = takaranPerPorsi(
  products.map((p) => (p.id === 'soto' ? { ...p, is_active: false } : p)),
  recipes
);
dekat('tanpa Soto, ayam kembali 0,2', tkNonaktif.get('ayam').rata, 0.2);
cek('  dan cuma 1 menu', tkNonaktif.get('ayam').jumlahMenu, 1);

cek('tanpa produk apa pun aman', takaranPerPorsi([], []).size, 0);
cek('products null aman', takaranPerPorsi(null, null).size, 0);

// =====================================================================
// TABEL BAHAN MENIPIS
// =====================================================================
// minPorsi 30:
//   ayam   batas 0,15 x 30 = 4,5   stok 3   -> menipis, porsi 20
//   sambal batas 0,05 x 30 = 1,5   stok 4   -> aman,    porsi 80
//   cabai  batas 0,04 x 30 = 1,2   stok 0   -> habis
//   garam  batas 0,001 x 30 = 0,03 stok 10  -> aman
//   gas    tanpa takaran & tanpa manual     -> disembunyikan
const stok = new Map([['ayam', 3], ['sambal', 4], ['cabai', 0], ['garam', 10], ['gas', 1]]);
const lap = susunBahanMenipis({ products, recipes, stok, minPorsi: 30 });
const cari = (id) => lap.baris.find((r) => r.productId === id);

cek('ayam menipis', cari('ayam').status, 'menipis');
dekat('ayam batas 4,5', cari('ayam').batas, 4.5);
dekat('ayam cukup 20 porsi', cari('ayam').porsi, 20);
dekat('ayam saran beli 1,5', cari('ayam').saranBeli, 1.5);
cek('ayam menyebut jumlah menu', cari('ayam').jumlahMenu, 2);

cek('sambal aman', cari('sambal').status, 'aman');
dekat('sambal saran beli 0', cari('sambal').saranBeli, 0);
cek('cabai habis', cari('cabai').status, 'habis');
cek('cabai porsi 0', cari('cabai').porsi, 0);
dekat('cabai saran beli = batas', cari('cabai').saranBeli, 1.2);
cek('garam aman', cari('garam').status, 'aman');

cek('menu tidak muncul di daftar belanja', lap.baris.some((r) => r.productId === 'nasiayam'), false);
cek('gas disembunyikan (tanpa resep & tanpa batas manual)', lap.baris.some((r) => r.productId === 'gas'), false);
cek('jumlah tersembunyi dilaporkan', lap.tersembunyi, 1);

cek('urutan: habis dulu', lap.baris[0].productId, 'cabai');
cek('lalu porsi paling sedikit', lap.baris[1].productId, 'ayam');
cek('hitungan habis', lap.jumlahHabis, 1);
cek('hitungan menipis', lap.jumlahMenipis, 1);
cek('perlu = habis + menipis', lap.perlu.length, 2);
cek('minPorsi dilaporkan', lap.minPorsi, 30);

// =====================================================================
// AMBANG PORSI BERUBAH -> SEMUANYA IKUT BERUBAH
// =====================================================================
const lapKetat = susunBahanMenipis({ products, recipes, stok, minPorsi: 100 });
cek('ambang 100: sambal jadi menipis', lapKetat.baris.find((r) => r.productId === 'sambal').status, 'menipis');
dekat('  batas sambal jadi 5', lapKetat.baris.find((r) => r.productId === 'sambal').batas, 5);

const lapLonggar = susunBahanMenipis({ products, recipes, stok, minPorsi: 10 });
cek('ambang 10: ayam jadi aman', lapLonggar.baris.find((r) => r.productId === 'ayam').status, 'aman');

// Ambang tidak masuk akal -> jatuh ke 30, bukan 0 (0 membuat semua terlihat aman).
cek('minPorsi 0 jatuh ke 30', susunBahanMenipis({ products, recipes, stok, minPorsi: 0 }).minPorsi, 30);
cek('minPorsi null jatuh ke 30', susunBahanMenipis({ products, recipes, stok, minPorsi: null }).minPorsi, 30);
cek('minPorsi negatif jatuh ke 30', susunBahanMenipis({ products, recipes, stok, minPorsi: -5 }).minPorsi, 30);

// =====================================================================
// BATAS MANUAL
// =====================================================================
// Bahan non-resep BARU BISA DIAWASI lewat batas manual — inilah satu-satunya
// jalan gas/tisu/sedotan muncul di daftar mana pun.
const lapGas = susunBahanMenipis({ products, recipes, stok, minPorsi: 30, batasManual: new Map([['gas', 2]]) });
const gas = lapGas.baris.find((r) => r.productId === 'gas');
cek('gas muncul karena punya batas manual', !!gas, true);
cek('gas menipis (stok 1 < batas 2)', gas.status, 'menipis');
cek('gas tidak punya angka porsi', gas.porsi, null);
cek('gas ditandai manual', gas.batasManual, true);
cek('gas tidak lagi terhitung tersembunyi', lapGas.tersembunyi, 0);

// Manual menimpa hitungan otomatis, dan satuannya satuan BAHAN — bukan porsi.
const lapManual = susunBahanMenipis({ products, recipes, stok, minPorsi: 30, batasManual: new Map([['ayam', 2]]) });
dekat('manual menimpa otomatis', lapManual.baris.find((r) => r.productId === 'ayam').batas, 2);
cek('stok 3 di atas batas 2 -> aman', lapManual.baris.find((r) => r.productId === 'ayam').status, 'aman');
cek('minPorsi null kalau manual', lapManual.baris.find((r) => r.productId === 'ayam').minPorsi, null);
dekat('porsi tetap dihitung walau batasnya manual', lapManual.baris.find((r) => r.productId === 'ayam').porsi, 20);

// BATAS MANUAL 0 = SENGAJA TIDAK DIAWASI, bukan "belum diatur".
const lapNol = susunBahanMenipis({ products, recipes, stok, minPorsi: 30, batasManual: new Map([['cabai', 0]]) });
cek('batas manual 0 mengeluarkan bahannya dari daftar', lapNol.baris.some((r) => r.productId === 'cabai'), false);
cek('dan cabai tidak lagi dihitung habis', lapNol.jumlahHabis, 0);
cek('tanpa baris manual, cabai muncul', lap.baris.some((r) => r.productId === 'cabai'), true);

// ---- bahan nonaktif tidak ikut ----
cek(
  'bahan nonaktif dikeluarkan',
  susunBahanMenipis({
    products: products.map((p) => (p.id === 'ayam' ? { ...p, is_active: false } : p)),
    recipes,
    stok,
    minPorsi: 30
  }).baris.some((r) => r.productId === 'ayam'),
  false
);

// ---- tanpa stok sama sekali ----
const lapKosong = susunBahanMenipis({ products, recipes, stok: new Map(), minPorsi: 30 });
cek('tanpa stok: tidak ada yang aman', lapKosong.jumlahAman, 0);
cek('tanpa stok: tidak ada yang sekadar menipis', lapKosong.jumlahMenipis, 0);
cek('stok null aman', susunBahanMenipis({ products, recipes, stok: null, minPorsi: 30 }).jumlahHabis > 0, true);

// ---- tanpa resep sama sekali: semuanya tersembunyi ----
const lapTanpaResep = susunBahanMenipis({ products, recipes: [], stok, minPorsi: 30 });
cek('tanpa resep, tidak ada baris', lapTanpaResep.baris.length, 0);
cek('  dan semuanya terhitung tersembunyi', lapTanpaResep.tersembunyi, 5);

// =====================================================================
// TEKS WHATSAPP
// =====================================================================
const teks = teksBelanja(lap, { outlet: 'Gading Serpong', tanggal: '18 Agu 2026' });
cek('memuat judul', teks.includes('*Bahan Perlu Dibeli*'), true);
cek('memuat outlet', teks.includes('Gading Serpong'), true);
cek('memuat bahan habis', teks.includes('Cabai Merah'), true);
cek('menandai HABIS', teks.includes('HABIS'), true);
cek('memuat bahan menipis', teks.includes('Ayam'), true);
cek('TIDAK memuat yang aman', teks.includes('Sambal'), false);
cek('menyebut target porsi', teks.includes('30 porsi'), true);
cek('menyebut sisa porsi', teks.includes('20 porsi'), true);
// Koma desimal — dibaca orang Indonesia di chat, bukan titik.
cek('angka pakai koma desimal', teks.includes('1,5'), true);

cek(
  'kalau tidak ada yang menipis, katakan begitu',
  teksBelanja({ perlu: [], minPorsi: 30 }, { outlet: 'Sentul' }).includes('Tidak ada bahan yang menipis'),
  true
);
cek('lap tanpa perlu[] tidak melempar', teksBelanja({ minPorsi: 30 }, {}).includes('Tidak ada bahan'), true);

if (gagal) {
  console.error(`\n${gagal} kasus gagal.`);
  process.exit(1);
}
console.log('Bahan menipis benar untuk 67 kasus — takaran rata-rata, menu Dilayani CK, resep bertingkat, siklus, dan batas manual. ✅');
