/**
 * Penyaringan tabel Produk/Resep, jalur layar, dan penyusunan buku resep.
 *
 * Ketiganya kelihatan sepele, dan justru itu masalahnya — kalau salah, tidak
 * ada yang error. Penyaring yang keliru menyembunyikan baris yang benar, dan
 * orangnya menyimpulkan produknya belum ada lalu membuatnya lagi dengan nama
 * yang sedikit berbeda. Setelah itu ada dua "Gula" di master produk dan HPP-nya
 * tidak pernah bisa dijelaskan lagi.
 */
import { cocokSaringan, saringBaris, daftarKategori, TANPA_KATEGORI } from '../js/modules/product/saringan.js';
import { kepala, ekor, gabung } from '../js/core/jalur-layar.js';
import { susunBukuResep } from '../js/modules/product/buku-resep.js';

let gagal = 0;
const cek = (nama, dapat, harap) => {
  if (JSON.stringify(dapat) !== JSON.stringify(harap)) {
    gagal++;
    console.error(`❌ ${nama}\n   dapat : ${JSON.stringify(dapat)}\n   harap : ${JSON.stringify(harap)}`);
  }
};

// ================= Saringan =================

const baris = [
  { nama: 'gula pasir', tipe: 'Bahan Baku', kategori: 'Bahan Kering' },
  { nama: 'gula merah', tipe: 'Bahan Baku', kategori: 'Bahan Kering' },
  { nama: 'sirup gula', tipe: 'Setengah Jadi', kategori: '' },
  { nama: 'es kopi susu', tipe: 'Menu', kategori: 'Minuman' }
];

// Saringan kosong = SEMUA. Kedengarannya sudah pasti, tapi ini yang paling
// mudah terbalik saat null/undefined/string kosong bercampur — dan akibatnya
// tabel kosong yang terlihat persis seperti data hilang.
cek('tanpa saringan: semua lolos', saringBaris(baris, {}).length, 4);
cek('saringan undefined: semua lolos', saringBaris(baris).length, 4);
cek('nilai null diperlakukan sebagai kosong', saringBaris(baris, { nama: null, tipe: null, kategori: null }).length, 4);
cek('spasi saja dianggap kosong', saringBaris(baris, { nama: '   ' }).length, 4);

cek('cocok sebagian nama', saringBaris(baris, { nama: 'gula' }).length, 3);
cek('saringan tipe', saringBaris(baris, { tipe: 'Menu' }).map((b) => b.nama), ['es kopi susu']);
cek('saringan kategori', saringBaris(baris, { kategori: 'Bahan Kering' }).length, 2);

// DAN, bukan ATAU. Kalau digabung dengan ATAU, memilih tipe "Menu" lalu
// mengetik "gula" akan menampilkan 4 baris — dan penyaring yang justru
// melebarkan hasil saat dipersempit membuat orang berhenti memakainya.
cek('nama + tipe digabung dengan DAN', saringBaris(baris, { nama: 'gula', tipe: 'Bahan Baku' }).length, 2);
cek('tiga saringan sekaligus', saringBaris(baris, { nama: 'gula', tipe: 'Bahan Baku', kategori: 'Bahan Kering' }).length, 2);
cek('kombinasi yang tidak mungkin -> kosong', saringBaris(baris, { nama: 'gula', tipe: 'Menu' }).length, 0);

// Produk tanpa kategori hanya cocok dengan "(tanpa kategori)". Kalau ia ikut
// muncul di kategori mana pun, orangnya menyangka kategorinya sudah terisi dan
// tidak pernah membetulkannya.
cek('tanpa kategori punya kelompok sendiri', saringBaris(baris, { kategori: TANPA_KATEGORI }).map((b) => b.nama), ['sirup gula']);
cek('dan tidak ikut kategori lain', saringBaris(baris, { kategori: 'Minuman' }).map((b) => b.nama), ['es kopi susu']);

cek('baris tanpa data aman', cocokSaringan(undefined, { nama: 'gula' }), false);
cek('baris tanpa data lolos kalau tak ada saringan', cocokSaringan(undefined, {}), true);

// Daftar kategori untuk dropdown
cek('kategori terurut & unik', daftarKategori([{ category: 'Minuman' }, { category: 'Bahan Kering' }, { category: 'Minuman' }]), ['Bahan Kering', 'Minuman']);
// "(tanpa kategori)" ditaruh di AKHIR karena ia bukan kategori, melainkan
// ketiadaannya — di tengah daftar ia terbaca seperti nama kategori sungguhan.
cek('yang kosong jadi pilihan terakhir', daftarKategori([{ category: 'Minuman' }, { category: '' }]), ['Minuman', TANPA_KATEGORI]);
cek('tidak ada yang kosong -> tidak ada pilihan itu', daftarKategori([{ category: 'Minuman' }]), ['Minuman']);
cek('daftar kosong aman', daftarKategori([]), []);
cek('daftar null aman', daftarKategori(null), []);

// ================= Jalur layar =================

cek('satu potongan', kepala('master_product'), 'master_product');
cek('tidak ada sisa', ekor('master_product'), null);
cek('dua potongan: kepala', kepala('master_product/recipes'), 'master_product');
cek('dua potongan: ekor', ekor('master_product/recipes'), 'recipes');
cek('tiga potongan: ekor tetap utuh', ekor('a/b/c'), 'b/c');
cek('kosong', kepala(''), null);
cek('null', kepala(null), null);
cek('undefined aman', ekor(undefined), null);

// `gabung` membuang yang kosong, bukan menjadikannya potongan kosong. Kalau
// menghasilkan "master_product/", lapis di bawahnya menerima string kosong yang
// tidak berarti apa-apa — dan tab yang dipulihkan jadi meleset diam-diam.
cek('gabung normal', gabung('master_product', 'recipes'), 'master_product/recipes');
cek('gabung dengan null tidak meninggalkan garis miring', gabung('master_product', null), 'master_product');
cek('gabung dengan string kosong', gabung('master_product', ''), 'master_product');
cek('gabung tiga', gabung('a', 'b', 'c'), 'a/b/c');
cek('gabung semuanya kosong', gabung(null, undefined, ''), '');
// Bolak-balik harus utuh: apa yang digabung harus bisa dipecah lagi persis sama.
cek('bolak-balik utuh', ekor(gabung('master_product', 'recipes')), 'recipes');

// ================= Buku resep =================

const products = [
  { id: 'gula', name: 'Gula', product_type: 'raw', base_unit: 'gram', category: 'Bahan Kering' },
  { id: 'kopi', name: 'Kopi', product_type: 'raw', base_unit: 'gram', category: 'Bahan Kering' },
  { id: 'es', name: 'Es Kopi Susu', product_type: 'finished', base_unit: 'gelas', category: 'Minuman' }
];
const recipes = [
  { product_id: 'es', mode: 'standalone', yield_qty: 1, items: [{ ingredient_product_id: 'kopi', qty: 18 }, { ingredient_product_id: 'gula', qty: 12 }] }
];
const hppBahan = (id) => ({ gula: 10, kopi: 150 })[id] ?? null;
const buku = susunBukuResep({ products, recipes, hppBahan, hppVarian: () => 2820 });

cek('satu baris per bahan', buku.baris.length, 2);
// Kolom Produk & Varian diulang di TIAP baris. Terlihat mubazir, tapi itu yang
// membuat "Filter" dan pivot di Excel bekerja — dan menyaring adalah alasan
// utama file ini diunduh.
cek('nama produk diulang tiap baris', buku.baris.map((b) => b[0]), ['Es Kopi Susu', 'Es Kopi Susu']);
cek('varian diulang juga', buku.baris.map((b) => b[3]), ['Standalone', 'Standalone']);
cek('biaya bahan = qty x hpp', buku.baris[0][9], 'Rp 2.700');
cek('jumlah varian dihitung', buku.jumlahVarian, 1);

// Bahan tanpa HPP ditandai "-", bukan 0 — nol membuat kolom Biaya terlihat sah
// dan totalnya bisa dijumlah tanpa curiga.
const bukuTanpaHpp = susunBukuResep({ products, recipes, hppBahan: () => null, hppVarian: () => null });
cek('bahan tanpa HPP ditandai "-"', bukuTanpaHpp.baris[0].slice(8, 10), ['-', '-']);
cek('varian tanpa HPP dihitung', bukuTanpaHpp.tanpaHpp, 1);
cek('dan disebut di subjudul', bukuTanpaHpp.subjudul.includes('belum bisa dihitung'), true);

// Resep KOSONG tetap muncul. Kalau dilewati, file unduhan terlihat lengkap
// sementara di aplikasi ada peringatan — dan orang lebih percaya file yang
// dipegangnya.
const bukuKosong = susunBukuResep({ products, recipes: [{ product_id: 'es', mode: 'standalone', yield_qty: 1, items: [] }], hppVarian: () => null });
cek('resep kosong tetap punya baris', bukuKosong.baris.length, 1);
cek('dan barisnya menjelaskan diri', bukuKosong.baris[0][5].includes('resep kosong'), true);

// Resep yatim (produknya sudah terhapus) tidak boleh membuat baris hantu.
const yatim = susunBukuResep({ products, recipes: [{ product_id: 'entah', mode: 'standalone', yield_qty: 1, items: [] }] });
cek('resep tanpa produk dilewati', yatim.baris.length, 0);
cek('dan tidak ikut dihitung', yatim.jumlahVarian, 0);

// Urutannya stabil supaya dua unduhan bisa dibandingkan.
const acak = susunBukuResep({
  products: [...products, { id: 'a', name: 'Ayam Goreng', product_type: 'finished', base_unit: 'porsi' }],
  recipes: [recipes[0], { product_id: 'a', mode: 'standalone', yield_qty: 1, items: [{ ingredient_product_id: 'gula', qty: 1 }] }]
});
cek('diurutkan menurut nama produk', acak.baris.map((b) => b[0]), ['Ayam Goreng', 'Es Kopi Susu', 'Es Kopi Susu']);

cek('tanpa nilai: kolomnya lebih sedikit', susunBukuResep({ products, recipes, denganNilai: false }).kolom.length, 8);
cek('dengan nilai: tiga kolom tambahan', buku.kolom.length, 11);
cek('kolom nilai ditandai numeric untuk Excel', buku.kolom.slice(-3).every((k) => k.numeric), true);
cek('tanpa resep sama sekali', susunBukuResep({ products, recipes: [] }).baris, []);
cek('recipes null aman', susunBukuResep({ products, recipes: null }).baris, []);

if (gagal) {
  console.error(`\n${gagal} kasus gagal.`);
  process.exit(1);
}
console.log('Saringan, jalur layar & buku resep benar untuk 47 kasus. ✅');
