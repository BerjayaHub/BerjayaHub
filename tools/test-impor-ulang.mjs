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
import { rencanaLengkapi, saringMenurutTipe, kolomDiabaikan, petaResep } from '../js/modules/product/import-merge.js';

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
cek('argumen null aman', rencanaLengkapi(null, null), { patch: {}, terisi: [], diubah: [], konflik: [] });

// Harga 0 adalah NILAI, bukan kekosongan — dan harus bisa mengisi kolom kosong.
cek('harga 0 tetap dianggap nilai', rencanaLengkapi(minyakKosong, { sale_price: 0 }).patch, { sale_price: 0 });
// Tapi 0 di sistem juga nilai: file yang menyebut 18000 tidak boleh menimpanya.
cek('0 di sistem tidak dianggap kosong', rencanaLengkapi({ ...minyakKosong, sale_price: 0 }, { sale_price: 18000 }).patch, {});


// ================= MODE TIMPA =================
//
// Dipakai untuk update massal (mis. harga beli bulanan). Yang dijaga di sini
// bukan "apakah bisa menimpa" — itu bagian mudahnya — melainkan bahwa mode ini
// TIDAK PERNAH aktif tanpa diminta, dan bahwa kolom struktural tetap tertutup
// walau kotaknya dicentang.

const t1 = rencanaLengkapi(sudahLengkap, { ...dariFile, purchase_price: 30000 }, { timpa: true });
cek('timpa: nilai baru masuk patch', t1.patch, { purchase_price: 30000 });
cek('timpa: tidak dilaporkan sebagai konflik', t1.konflik, []);
// Nilai LAMA ikut ditulis di daftar. Pratinjau yang cuma berbunyi "Harga Beli
// diubah" tidak bisa diperiksa siapa pun sebelum menekan Simpan — dan
// pratinjau yang tidak bisa diperiksa cuma menambah satu ketukan.
cek('timpa: melaporkan sebelum -> sesudah', t1.diubah, ['Harga Beli: "25000" -> "30000"']);

// Bawaan HARUS tetap tidak menimpa. Kalau default-nya berubah, file lama yang
// diimpor ulang akan memundurkan harga yang baru dikoreksi manual — tanpa
// jejak, karena impornya dilaporkan berhasil.
const t2 = rencanaLengkapi(sudahLengkap, { ...dariFile, purchase_price: 30000 });
cek('tanpa opsi: TIDAK menimpa', t2.patch, {});
cek('tanpa opsi: dilaporkan sebagai konflik', t2.konflik.length, 1);
cek('tanpa opsi: daftar diubah kosong', t2.diubah, []);
cek('opsi kosong sama dengan tanpa opsi', rencanaLengkapi(sudahLengkap, { ...dariFile, purchase_price: 30000 }, {}).patch, {});
cek('timpa: false eksplisit', rencanaLengkapi(sudahLengkap, { ...dariFile, purchase_price: 30000 }, { timpa: false }).patch, {});

// Kolom KOSONG tetap dilengkapi di mode timpa, dan tetap masuk daftar "terisi"
// yang berbeda dari "diubah" — mengisi tempat kosong bukan mengganti angka
// yang sedang dipakai, dan menggabungkannya menyembunyikan yang perlu diperiksa.
const t3 = rencanaLengkapi(minyakKosong, dariFile, { timpa: true });
cek('timpa: yang kosong tetap dilengkapi', t3.terisi.length > 0, true);
cek('timpa: yang kosong tidak masuk daftar diubah', t3.diubah, []);

// Nilai yang SAMA tidak dianggap perubahan — kalau tidak, pratinjau update
// massal akan berisi ratusan baris yang tidak berubah apa-apa, dan daftar
// seperti itu tidak akan dibaca.
cek('timpa: nilai sama bukan perubahan', rencanaLengkapi(sudahLengkap, dariFile, { timpa: true }).diubah, []);
cek('timpa: "25000" vs 25000 bukan perubahan', rencanaLengkapi(sudahLengkap, { ...dariFile, purchase_price: '25000' }, { timpa: true }).diubah, []);

// STRUKTURAL TETAP TERTUTUP. Satuan pakai adalah satuan seluruh resep dan stok
// yang sudah tercatat; menggantinya membuat semua angka lama berpindah arti
// tanpa satu pun ikut dikonversi. Tidak ada kotak centang yang pantas membuka
// pintu itu.
const t4 = rencanaLengkapi(sudahLengkap, { ...dariFile, base_unit: 'kg', product_type: 'semi' }, { timpa: true });
cek('timpa: satuan pakai tidak ikut berubah', t4.patch.base_unit, undefined);
cek('timpa: tipe tidak ikut berubah', t4.patch.product_type, undefined);
cek('timpa: keduanya tetap dilaporkan', t4.konflik.length, 2);
cek('timpa: dan tidak masuk daftar diubah', t4.diubah, []);

// Kolom yang tidak disebut file tetap tidak disentuh, walau mode timpa.
cek('timpa: kolom kosong di file tidak menghapus nilai lama', rencanaLengkapi(sudahLengkap, { category: '' }, { timpa: true }).patch, {});
cek('timpa: null di file tidak menghapus', rencanaLengkapi(sudahLengkap, { purchase_price: null }, { timpa: true }).patch, {});


// ================= KOLOM MANA BERLAKU UNTUK TIPE APA =================
//
// Dua jalur impor sempat menyimpang: "buat baru" membuang purchase_* untuk
// non-bahan-baku, "lengkapi" menyimpannya. Jadi mengisi Harga Beli untuk sebuah
// SETENGAH JADI diabaikan kalau produknya baru, tapi tersimpan kalau produknya
// sudah ada.
//
// Nilai itu tidak salah hari ini — HPP setengah jadi dihitung dari resep
// Produksi, bukan harga beli, dan kolomnya tidak ditampilkan. Yang berbahaya
// adalah NANTI: begitu tipenya diubah jadi "Bahan Baku", harga basi itu hidup
// dan ikut menghitung HPP tanpa seorang pun pernah mengetiknya untuk produk itu.

const isiPenuh = { category: 'X', purchase_unit: 'karung', purchase_qty: 25000, purchase_price: 250000, sale_price: 18000 };

const utkRaw = saringMenurutTipe('raw', isiPenuh);
cek('bahan baku: harga beli dipertahankan', utkRaw.purchase_price, 250000);
cek('bahan baku: isi per satuan dipertahankan', utkRaw.purchase_qty, 25000);
cek('bahan baku: harga jual dibuang', 'sale_price' in utkRaw, false);

const utkSemi = saringMenurutTipe('semi', isiPenuh);
cek('setengah jadi: harga beli dibuang', 'purchase_price' in utkSemi, false);
cek('setengah jadi: satuan beli dibuang', 'purchase_unit' in utkSemi, false);
cek('setengah jadi: isi per satuan dibuang', 'purchase_qty' in utkSemi, false);
cek('setengah jadi: harga jual juga dibuang', 'sale_price' in utkSemi, false);

const utkMenu = saringMenurutTipe('finished', isiPenuh);
cek('menu: harga jual dipertahankan', utkMenu.sale_price, 18000);
cek('menu: harga beli dibuang', 'purchase_price' in utkMenu, false);

// Kolom yang tidak ada urusannya dengan tipe tidak boleh ikut terbuang.
cek('kategori selalu lolos', [utkRaw.category, utkSemi.category, utkMenu.category], ['X', 'X', 'X']);

// DAN INI YANG MENGUNCINYA: dipakai bersama rencanaLengkapi, harga beli tidak
// bisa menyelinap ke setengah jadi lewat jalur "lengkapi".
const sirupKosong = { name: 'Sirup Gula', product_type: 'semi', base_unit: 'ml', category: null, purchase_price: null, purchase_qty: null };
const rs = rencanaLengkapi(sirupKosong, saringMenurutTipe('semi', isiPenuh));
cek('setengah jadi tidak menerima harga beli lewat impor', rs.patch.purchase_price, undefined);
cek('tapi kategorinya tetap dilengkapi', rs.patch.category, 'X');


// ---- Kolom yang diisi tapi tidak berlaku HARUS DISEBUT ----
//
// Membuangnya sudah benar; membuangnya DIAM-DIAM tidak. Orang mengisi harga
// beli untuk lima puluh setengah jadi, impornya "berhasil", kolomnya tetap
// kosong, dan tidak ada kalimat yang menjelaskan kenapa. Yang disimpulkan
// berikutnya hampir selalu "impornya tidak jalan" — lalu diulang, dengan hasil
// yang sama persis.
cek('setengah jadi: harga beli dilaporkan diabaikan', kolomDiabaikan('semi', { purchase_price: 250000 }), ['Harga Beli']);
cek('setengah jadi: beberapa kolom sekaligus', kolomDiabaikan('semi', isiPenuh), ['Satuan Beli', 'Isi per Satuan Beli', 'Harga Beli', 'Harga Jual']);
cek('menu: harga beli dilaporkan', kolomDiabaikan('finished', { purchase_price: 250000 }), ['Harga Beli']);
cek('menu: harga jual TIDAK dilaporkan', kolomDiabaikan('finished', { sale_price: 18000 }), []);
cek('bahan baku: harga beli TIDAK dilaporkan', kolomDiabaikan('raw', { purchase_price: 250000 }), []);
cek('bahan baku: harga jual dilaporkan', kolomDiabaikan('raw', { sale_price: 18000 }), ['Harga Jual']);
// Kolom KOSONG tidak dilaporkan — kalau dilaporkan, tiap impor menu biasa akan
// memunculkan catatan tentang kolom yang memang sengaja dibiarkan kosong, dan
// catatan yang selalu muncul berhenti dibaca.
cek('kolom kosong tidak dilaporkan', kolomDiabaikan('semi', { purchase_price: null, sale_price: '' }), []);
cek('nol tetap dianggap terisi', kolomDiabaikan('semi', { purchase_price: 0 }), ['Harga Beli']);
cek('nilai null aman', kolomDiabaikan('semi', null), []);

cek('nilai null aman', saringMenurutTipe('raw', null), {});
cek('tipe tak dikenal diperlakukan paling ketat', saringMenurutTipe('entah', isiPenuh), { category: 'X' });


// ================= RESEP KOSONG BUKAN RESEP YANG SUDAH ADA =================
//
// Bedanya halus tapi menentukan. Selama "sudah ada" diukur dari ADANYA BARIS
// resep, baris kosong yang tertinggal (penyimpanan terputus — lihat 0082)
// menjadi TIDAK BISA DIPERBAIKI lewat impor: tiap impor ulang menjawab
// "dilewati, resep sudah ada", sementara layarnya tetap bilang resepnya kosong.
// Yang tersisa cuma membuka ratusan resep satu per satu — justru pekerjaan yang
// mau dihindari dengan mengimpor.

const daftarResep = [
  { product_id: 'es', mode: 'standalone', items: [{ ingredient_product_id: 'kopi', qty: 18 }] },
  { product_id: 'es', mode: 'served_by_ck', items: [] },          // kosong: sisa penyimpanan terputus
  { product_id: 'air', mode: 'served_by_ck' },                     // items undefined = kosong juga
  { product_id: 'sirup', mode: 'production', items: [{ ingredient_product_id: 'gula', qty: 1000 }] }
];
const peta = petaResep(daftarResep);

cek('yang berisi masuk "berisi"', [...peta.berisi].sort(), ['es|standalone', 'sirup|production']);
cek('yang kosong masuk "kosong"', [...peta.kosong].sort(), ['air|served_by_ck', 'es|served_by_ck']);
// `items` yang tidak ada sama sekali harus diperlakukan sama dengan array
// kosong — dua bentuk yang sama artinya, dan membedakannya cuma akan membuat
// sebagian resep kosong tetap tidak bisa diperbaiki.
cek('items undefined dihitung kosong', peta.kosong.has('air|served_by_ck'), true);
cek('dan tidak ikut dihitung berisi', peta.berisi.has('air|served_by_ck'), false);
// Satu produk bisa punya satu varian berisi dan satu varian kosong; keduanya
// harus dipisahkan per VARIAN, bukan per produk.
cek('varian dipisah, bukan per produk', peta.berisi.has('es|standalone') && peta.kosong.has('es|served_by_ck'), true);
cek('daftar kosong aman', petaResep([]), { berisi: new Set(), kosong: new Set() });
cek('null aman', petaResep(null), { berisi: new Set(), kosong: new Set() });

if (gagal) {
  console.error(`\n${gagal} kasus gagal.`);
  process.exit(1);
}
console.log('Impor ulang benar untuk 69 kasus: melengkapi yang kosong, dan hanya menimpa kalau diminta dengan sadar. ✅');
