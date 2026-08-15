/**
 * Isi panel "bahan apa saja di resep ini" — dipakai Admin Portal DAN Staff App.
 *
 * KENAPA SATU SUMBER. Dua layar yang menampilkan resep yang sama dengan isi
 * yang berbeda adalah kerusakan yang lebih mahal daripada salah satu di
 * antaranya salah: setelah orang menemukan bedanya, keduanya berhenti dipercaya
 * dan resepnya dicek ulang manual — yang justru pekerjaan yang mau dihilangkan
 * aplikasi ini.
 *
 * Karena itu yang diuji bukan tampilannya (memang beda), melainkan ATURANNYA:
 * bahan mana, ditandai apa, dihitung berapa. Yang paling ditekankan: bahan
 * tanpa HPP tidak boleh diam-diam dihitung nol.
 */
import { susunPanelBahan } from '../js/modules/product/panel-bahan.js';

let gagal = 0;
const cek = (nama, dapat, harap) => {
  if (JSON.stringify(dapat) !== JSON.stringify(harap)) {
    gagal++;
    console.error(`❌ ${nama}\n   dapat : ${JSON.stringify(dapat)}\n   harap : ${JSON.stringify(harap)}`);
  }
};

const products = [
  { id: 'gula', name: 'Gula', product_type: 'raw', base_unit: 'gram' },
  { id: 'kopi', name: 'Kopi', product_type: 'raw', base_unit: 'gram' },
  { id: 'es', name: 'Es Kopi Susu', product_type: 'finished', base_unit: 'gelas' }
];
const recipes = [
  { product_id: 'es', mode: 'standalone', yield_qty: 1, items: [{ ingredient_product_id: 'kopi', qty: 18 }, { ingredient_product_id: 'gula', qty: 12 }] }
];
const hppBahan = (id) => ({ gula: 10, kopi: 150 })[id] ?? null;
const dasar = { products, recipes, productId: 'es', mode: 'standalone' };

// ---- Staff App: tanpa nilai ----
const staff = susunPanelBahan(dasar);
cek('ada resepnya', staff.ada, true);
cek('tidak kosong', staff.kosong, false);
cek('dua bahan', staff.baris.map((b) => b.nama), ['Kopi', 'Gula']);
cek('jumlah & satuan ikut', staff.baris[0].jumlah + ' ' + staff.baris[0].satuan, '18 gram');
cek('yield ikut', staff.yieldQty, 1);
// Tanpa nilai berarti BENAR-BENAR tanpa angka rupiah, bukan angka yang
// disembunyikan di tampilan — kalau nilainya tetap dihitung dan cuma tidak
// digambar, ia akan bocor lewat layar berikutnya yang lupa menyembunyikannya.
cek('tidak ada HPP per bahan', staff.baris.map((b) => b.hppSatuan), [null, null]);
cek('tidak ada biaya per bahan', staff.baris.map((b) => b.biaya), [null, null]);
cek('tidak ada total', staff.totalBiaya, null);

// PENTING: `hppBahan` SENGAJA diberikan di sini meski `denganNilai` false.
// Versi pertama tes ini tidak memberikannya, jadi hasilnya null karena
// fungsinya memang tidak ada — bukan karena penjaganya bekerja. Sabotase
// membuktikannya: mencabut `denganNilai &&` tetap hijau. Sekarang satu-satunya
// yang bisa membuat baris ini lolos adalah penjaga itu sendiri.
const staffDipancing = susunPanelBahan({ ...dasar, hppBahan, hppVarian: () => 2820 });
cek('hppBahan diabaikan kalau nilai tidak diminta', staffDipancing.baris.map((b) => b.hppSatuan), [null, null]);
cek('biayanya pun tidak dihitung', staffDipancing.baris.map((b) => b.biaya), [null, null]);
cek('dan totalnya tetap kosong', staffDipancing.totalBiaya, null);

// ---- Admin Portal: dengan nilai ----
const admin = susunPanelBahan({ ...dasar, denganNilai: true, hppBahan, hppVarian: () => 2820 });
cek('HPP per bahan ada', admin.baris.map((b) => b.hppSatuan), [150, 10]);
cek('biaya = jumlah x HPP', admin.baris.map((b) => b.biaya), [2700, 120]);
cek('total dijumlahkan', admin.totalBiaya, 2820);
cek('HPP varian diteruskan', admin.hpp, 2820);

// ---- Bahan tanpa HPP: TIDAK dihitung nol ----
// Nol membuat total terlihat sah padahal ada yang belum berbiaya — dan total
// itu dipakai menentukan harga jual.
const sebagian = susunPanelBahan({ ...dasar, denganNilai: true, hppBahan: (id) => (id === 'kopi' ? 150 : null), hppVarian: () => null });
cek('bahan tanpa HPP -> null', sebagian.baris[1].hppSatuan, null);
cek('dan biayanya null, bukan 0', sebagian.baris[1].biaya, null);
// Total sengaja null: angka separuh lebih menyesatkan daripada tidak ada
// angka, karena ia tetap terlihat seperti jawaban.
cek('total ditahan selama ada yang belum berbiaya', sebagian.totalBiaya, null);

// ---- Varian tanpa resep ----
const belum = susunPanelBahan({ ...dasar, mode: 'served_by_ck' });
cek('belum punya resep', belum.ada, false);
cek('barisnya kosong', belum.baris, []);
cek('dan tidak dianggap "resep kosong"', belum.kosong, false);

// ---- Resep KOSONG: beda dari "belum ada resep" ----
// Bedanya penting: yang satu pekerjaan yang belum dimulai, yang satu lagi
// pekerjaan yang HILANG (penyimpanan terputus sesudah bahan lama dihapus).
const kosong = susunPanelBahan({ products, recipes: [{ product_id: 'es', mode: 'standalone', yield_qty: 1, items: [] }], productId: 'es', mode: 'standalone' });
cek('resepnya ada', kosong.ada, true);
cek('tapi kosong', kosong.kosong, true);
cek('total tidak dihitung untuk resep kosong', kosong.totalBiaya, null);

// ---- Bahan yang produknya sudah dihapus ----
const hantu = susunPanelBahan({
  products,
  recipes: [{ product_id: 'es', mode: 'standalone', yield_qty: 1, items: [{ ingredient_product_id: 'entah', qty: 5 }] }],
  productId: 'es',
  mode: 'standalone',
  denganNilai: true,
  hppBahan
});
cek('bahan hilang tetap punya baris', hantu.baris.length, 1);
cek('namanya jujur', hantu.baris[0].nama, '(bahan sudah dihapus)');
// Pesannya harus BERBEDA dari "harganya belum diisi": yang satu diperbaiki di
// Master Produk, yang satu lagi tidak bisa diperbaiki kecuali resepnya diubah.
cek('masalahnya disebut khusus', hantu.baris[0].masalah, 'Bahan ini sudah tidak ada di Master Produk.');
cek('dan tidak dihitung biayanya', hantu.baris[0].biaya, null);
cek('total ditahan', hantu.totalBiaya, null);

// ---- Sebab hanya dikumpulkan kalau perlu ----
// Menelusuri seluruh pohon bahan tiap panel dibuka itu mahal di daftar panjang.
let dipanggil = 0;
susunPanelBahan({ ...dasar, hppVarian: () => 2820, sebabVarian: () => { dipanggil++; return ['x']; } });
cek('HPP ada -> sebab tidak ditelusuri', dipanggil, 0);
susunPanelBahan({ ...dasar, hppVarian: () => null, sebabVarian: () => { dipanggil++; return ['x']; } });
cek('HPP kosong -> sebab ditelusuri', dipanggil, 1);

// ---- Sebab per bahan diteruskan apa adanya ----
const bersebab = susunPanelBahan({ ...dasar, sebabBahan: (id) => (id === 'gula' ? 'Gula: harga belinya belum diisi' : null) });
cek('bahan bermasalah ditandai', bersebab.baris.map((b) => b.masalah), [null, 'Gula: harga belinya belum diisi']);

// ---- Nilai batas ----
cek('produk tidak ada', susunPanelBahan({ ...dasar, productId: 'entah' }).ada, false);
cek('recipes null aman', susunPanelBahan({ products, recipes: null, productId: 'es', mode: 'standalone' }).ada, false);
cek('products null aman', susunPanelBahan({ products: null, recipes, productId: 'es', mode: 'standalone' }).baris.length, 2);

if (gagal) {
  console.error(`\n${gagal} kasus gagal.`);
  process.exit(1);
}
console.log('Panel bahan sama aturannya di Admin & Staff untuk 33 kasus. ✅');
