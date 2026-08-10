/**
 * Impor ulang produk dengan nama yang SUDAH ADA.
 *
 * PERTANYAAN YANG MELAHIRKAN TES INI: "minyak goreng saya impor pertama kali
 * dengan kolom lain kosong; impor kedua kolomnya sudah terisi — apakah ini
 * menumpuk, atau mengedit yang tadi?"
 *
 * Perilaku lamanya: tidak keduanya. Barisnya dilewati, dan kolom yang kosong
 * tetap kosong selamanya. Impor kedua terasa "berhasil" padahal tidak mengubah
 * apa pun — dan itu tidak terlihat di ringkasan hasilnya.
 *
 * Yang dijaga di sini, dan keduanya sama pentingnya:
 *   - kolom kosong BENAR-BENAR terisi (kalau tidak, fiturnya cuma janji);
 *   - nilai yang sudah ada TIDAK PERNAH tertimpa diam-diam (kalau tidak, satu
 *     impor file lama bisa menghapus koreksi harga yang dikerjakan manual).
 */
import { rencanaLengkapi } from '../js/modules/product/import-merge.js';

let gagal = 0;
const cek = (nama, dapat, harap) => {
  if (JSON.stringify(dapat) !== JSON.stringify(harap)) {
    gagal++;
    console.error(`❌ ${nama}\n   dapat : ${JSON.stringify(dapat)}\n   harap : ${JSON.stringify(harap)}`);
  }
};

// ---- Kasus persis yang ditanyakan ----
const minyakKosong = {
  id: 'p1',
  name: 'Minyak Goreng',
  product_type: 'raw',
  base_unit: 'gram',
  category: null,
  subcategory: null,
  purchase_unit: null,
  purchase_qty: null,
  purchase_price: null,
  sale_price: null
};
const dariFile = {
  product_type: 'raw',
  base_unit: 'gram',
  category: 'Bahan Basah',
  subcategory: '',
  purchase_unit: 'jerigen',
  purchase_qty: 1000,
  purchase_price: 25000,
  sale_price: null
};

const r1 = rencanaLengkapi(minyakKosong, dariFile);
cek('kolom kosong benar-benar diisi', r1.patch, {
  category: 'Bahan Basah',
  purchase_unit: 'jerigen',
  purchase_qty: 1000,
  purchase_price: 25000
});
cek('yang terisi disebutkan namanya', r1.terisi, ['Kategori', 'Satuan Beli', 'Isi per Satuan Beli', 'Harga Beli']);
cek('tidak ada konflik', r1.konflik, []);

// ---- Impor ketiga dengan file yang sama: tidak ada yang perlu diubah ----
const sudahLengkap = { ...minyakKosong, category: 'Bahan Basah', purchase_unit: 'jerigen', purchase_qty: 1000, purchase_price: 25000 };
const r2 = rencanaLengkapi(sudahLengkap, dariFile);
cek('impor ulang file yang sama tidak mengubah apa pun', r2.patch, {});
cek('dan tidak melaporkan konflik palsu', r2.konflik, []);

// ---- Nilai berbeda: DILAPORKAN, bukan ditimpa ----
//
// Ini pagarnya. Seseorang membetulkan harga beli di aplikasi, lalu tiga hari
// kemudian file lama diimpor ulang. Kalau ditimpa, koreksinya lenyap tanpa
// jejak dan tidak ada yang tahu sampai HPP-nya terasa aneh.
const r3 = rencanaLengkapi(sudahLengkap, { ...dariFile, purchase_price: 30000 });
cek('harga berbeda tidak ikut ditimpa', r3.patch, {});
cek('harga berbeda dilaporkan', r3.konflik, ['Harga Beli: sistem "25000" vs file "30000"']);

// ---- Angka yang sama tapi beda tipe bukan konflik ----
//
// Sel Excel bisa mengembalikan 25000 (angka) atau "25000" (teks). Melaporkannya
// sebagai konflik hanya melatih orang mengabaikan daftar konflik.
cek('angka vs teks yang nilainya sama bukan konflik', rencanaLengkapi(sudahLengkap, { ...dariFile, purchase_price: '25000' }).konflik, []);
cek('teks beda huruf besar bukan konflik', rencanaLengkapi(sudahLengkap, { ...dariFile, category: 'bahan basah' }).konflik, []);

// Yang benar-benar memerlukan perbandingan ANGKA, bukan teks: bentuk tulisannya
// berbeda tapi nilainya sama. Excel gemar menuliskan 25000 sebagai "25000.00",
// dan melaporkan itu sebagai konflik akan memenuhi daftar dengan kebisingan
// sampai konflik yang sungguhan ikut terlewat.
cek('25000 vs "25000.00" bukan konflik', rencanaLengkapi(sudahLengkap, { ...dariFile, purchase_price: '25000.00' }).konflik, []);
cek('1000 vs "1000.0" pada isi per satuan', rencanaLengkapi(sudahLengkap, { ...dariFile, purchase_qty: '1000.0' }).konflik, []);
cek('tapi 25000 vs "25000.01" tetap konflik', rencanaLengkapi(sudahLengkap, { ...dariFile, purchase_price: '25000.01' }).konflik, [
  'Harga Beli: sistem "25000" vs file "25000.01"'
]);

// ---- Kolom struktural tidak pernah diubah lewat impor ----
//
// Satuan pakai adalah satuan SELURUH resep dan stok yang sudah tercatat.
// Mengubahnya lewat impor membuat semua angka lama berpindah arti tanpa satu
// pun yang ikut dikonversi.
const r4 = rencanaLengkapi(sudahLengkap, { ...dariFile, base_unit: 'kg', product_type: 'semi' });
cek('satuan pakai & tipe tidak masuk patch', r4.patch, {});
cek('keduanya dilaporkan sebagai konflik', r4.konflik, [
  'Tipe: sistem "raw" vs file "semi" — tidak diubah lewat impor',
  'Satuan Pakai: sistem "gram" vs file "kg" — tidak diubah lewat impor'
]);

// ---- File yang kolomnya kosong tidak boleh MENGOSONGKAN data lama ----
//
// Kebalikan dari kasus utama, dan sama berbahayanya: mengimpor file ringkas
// yang cuma berisi nama tidak boleh menghapus harga yang sudah ada.
const r5 = rencanaLengkapi(sudahLengkap, { category: '', purchase_price: null, purchase_qty: undefined });
cek('kolom kosong di file tidak menghapus data lama', r5.patch, {});
cek('dan tidak dianggap konflik', r5.konflik, []);

// ---- Nilai batas ----
cek('produk lama tanpa kolom sama sekali', rencanaLengkapi({}, { category: 'Minuman' }).patch, { category: 'Minuman' });
cek('file kosong sepenuhnya', rencanaLengkapi(sudahLengkap, {}).patch, {});
cek('argumen null aman', rencanaLengkapi(null, null), { patch: {}, terisi: [], konflik: [] });

// Harga 0 adalah NILAI, bukan kekosongan — dan harus bisa mengisi kolom kosong.
cek('harga 0 tetap dianggap nilai', rencanaLengkapi(minyakKosong, { sale_price: 0 }).patch, { sale_price: 0 });
// Tapi 0 di sistem juga nilai: file yang menyebut 18000 tidak boleh menimpanya.
cek('0 di sistem tidak dianggap kosong', rencanaLengkapi({ ...minyakKosong, sale_price: 0 }, { sale_price: 18000 }).patch, {});

if (gagal) {
  console.error(`\n${gagal} kasus gagal.`);
  process.exit(1);
}
console.log('Impor ulang benar untuk 21 kasus: melengkapi yang kosong, tidak pernah menimpa yang sudah terisi. ✅');
