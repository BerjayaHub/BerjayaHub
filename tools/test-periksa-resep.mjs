/**
 * Penjaga isi resep sebelum disimpan.
 *
 * Ketiga hal yang dijaga di sini sama-sama menghasilkan HPP yang SALAH tapi
 * terlihat wajar — dan itu jauh lebih mahal daripada gagal simpan, karena
 * angkanya dipakai menetapkan harga jual dan tidak ada yang curiga.
 */
import { periksaBahan, bahanGanda } from '../js/modules/product/periksa-resep.js';

let gagal = 0;
const cek = (nama, dapat, harap) => {
  if (JSON.stringify(dapat) !== JSON.stringify(harap)) {
    gagal++;
    console.error(`❌ ${nama}\n   dapat : ${JSON.stringify(dapat)}\n   harap : ${JSON.stringify(harap)}`);
  }
};
const nama = new Map([['gula', 'Gula'], ['kopi', 'Kopi'], ['es', 'Es Kopi Susu']]);
const opsi = { productId: 'es', nama };

// ---- Jalur normal ----
const ok = periksaBahan([{ ingredient_product_id: 'kopi', qty: 18 }, { ingredient_product_id: 'gula', qty: 12 }], opsi);
cek('dua bahan lolos', ok.items, [{ ingredient_product_id: 'kopi', qty: 18 }, { ingredient_product_id: 'gula', qty: 12 }]);
cek('tanpa masalah', ok.masalah, []);

// ---- Bahan dipilih tapi jumlah kosong: DILAPORKAN, bukan dibuang ----
// Inilah bug aslinya. `.filter(i => i.qty > 0)` membuat lupa mengisi satu
// jumlah berakhir dengan "Resep disimpan" dan resep yang berkurang satu bahan.
for (const [label, qty] of [['kosong', ''], ['nol', 0], ['null', null], ['bukan angka', 'abc'], ['negatif', -5]]) {
  const r = periksaBahan([{ ingredient_product_id: 'kopi', qty: 18 }, { ingredient_product_id: 'gula', qty }], opsi);
  cek(`jumlah ${label} -> ditolak`, r.masalah.length, 1);
  cek(`jumlah ${label} -> menyebut nama bahannya`, r.masalah[0].includes('Gula'), true);
}
// Baris yang benar-benar kosong (belum dipilih apa pun) bukan kesalahan —
// editor selalu menyisakan satu baris kosong di bawah.
cek('baris belum diisi diabaikan', periksaBahan([{ ingredient_product_id: '', qty: '' }], opsi).masalah, []);
cek('dan tidak menghasilkan item', periksaBahan([{ ingredient_product_id: '', qty: '' }], opsi).items, []);

// ---- Bahan sama dua kali: DIGABUNG ----
// `recipe_items` tidak punya unique index, jadi dua baris tersimpan dan
// biayanya dijumlahkan diam-diam.
const dobel = periksaBahan([{ ingredient_product_id: 'gula', qty: 10 }, { ingredient_product_id: 'gula', qty: 5 }], opsi);
cek('digabung jadi satu baris', dobel.items, [{ ingredient_product_id: 'gula', qty: 15 }]);
cek('bukan ditolak', dobel.masalah, []);
cek('bahanGanda menyebut namanya', bahanGanda([{ ingredient_product_id: 'gula', qty: 10 }, { ingredient_product_id: 'gula', qty: 5 }], { nama }), ['Gula']);
cek('tidak ganda -> daftar kosong', bahanGanda([{ ingredient_product_id: 'gula', qty: 10 }], { nama }), []);
// Baris tanpa jumlah tidak boleh dihitung sebagai kemunculan — kalau dihitung,
// pesan "digabung" muncul untuk resep yang sebenarnya ditolak.
cek('baris tanpa jumlah tidak dihitung ganda', bahanGanda([{ ingredient_product_id: 'gula', qty: 10 }, { ingredient_product_id: 'gula', qty: 0 }], { nama }), []);

// ---- Produk jadi bahan bagi dirinya sendiri ----
// Editor mencegahnya lewat dropdown, IMPOR tidak — dan di sana itu satu baris
// yang mudah salah ketik. Akibatnya siklus: HPP null selamanya.
const sendiri = periksaBahan([{ ingredient_product_id: 'es', qty: 1 }], opsi);
cek('ditolak', sendiri.masalah.length, 1);
cek('alasannya jelas', sendiri.masalah[0].includes('dirinya sendiri'), true);
cek('dan tidak ikut jadi item', sendiri.items, []);


// ---- Menu tidak boleh jadi bahan ----
// Editor tidak menawarkannya di dropdown, tapi IMPOR cuma mencocokkan nama —
// jadi lewat sana sebuah menu bisa masuk jadi bahan, dan resepnya kemudian
// tidak bisa dibuka di editor. Dua layar yang menjawab hal sama, satu di
// antaranya menolak isinya sendiri.
const tipe = new Map([['gula', 'raw'], ['sirup', 'semi'], ['es', 'finished'], ['lain', 'finished']]);
const namaLengkap = new Map([...nama, ['sirup', 'Sirup Gula'], ['lain', 'Lemon Tea']]);
const opsiTipe = { productId: 'es', nama: namaLengkap, tipe };

const pakaiMenu = periksaBahan([{ ingredient_product_id: 'lain', qty: 1 }], opsiTipe);
cek('menu sebagai bahan ditolak', pakaiMenu.masalah.length, 1);
cek('menyebut nama menunya', pakaiMenu.masalah[0].includes('Lemon Tea'), true);
// Pesannya menyebut JALAN KELUARNYA, bukan cuma larangan — kalau memang barang
// itu dipakai membuat barang lain, tipenya yang salah, bukan resepnya.
cek('menyarankan ubah tipe', pakaiMenu.masalah[0].includes('Setengah Jadi'), true);
cek('dan tidak ikut jadi item', pakaiMenu.items, []);

cek('bahan baku tetap boleh', periksaBahan([{ ingredient_product_id: 'gula', qty: 5 }], opsiTipe).masalah, []);
cek('setengah jadi tetap boleh', periksaBahan([{ ingredient_product_id: 'sirup', qty: 5 }], opsiTipe).masalah, []);
// Keduanya bersama — inilah bentuk resep menu yang lumrah.
cek('bahan baku + setengah jadi bersama', periksaBahan([{ ingredient_product_id: 'gula', qty: 5 }, { ingredient_product_id: 'sirup', qty: 3 }], opsiTipe).items.length, 2);
// Setengah jadi boleh berisi setengah jadi lain — kedalamannya tidak dibatasi.
cek('setengah jadi di dalam setengah jadi', periksaBahan([{ ingredient_product_id: 'sirup', qty: 3 }], { productId: 'semi-lain', nama: namaLengkap, tipe }).masalah, []);

// Tanpa peta tipe, pemeriksaan ini TIDAK berlaku — pemanggil yang tidak punya
// daftar produk tidak boleh jadi ikut menolak.
cek('tanpa peta tipe: tidak ikut menolak', periksaBahan([{ ingredient_product_id: 'lain', qty: 1 }], { productId: 'es', nama: namaLengkap }).masalah, []);

// ---- Beberapa masalah sekaligus: semuanya disebut ----
// Melaporkan satu lalu berhenti membuat orang membetulkan satu baris, menyimpan
// lagi, dan menemukan pesan berikutnya — berkali-kali.
const banyak = periksaBahan([{ ingredient_product_id: 'gula', qty: 0 }, { ingredient_product_id: 'kopi', qty: null }], opsi);
cek('dua masalah dilaporkan dua-duanya', banyak.masalah.length, 2);

// ---- Nilai batas ----
cek('daftar kosong aman', periksaBahan([], opsi), { items: [], masalah: [] });
cek('daftar null aman', periksaBahan(null, opsi), { items: [], masalah: [] });
cek('tanpa opsi sama sekali', periksaBahan([{ ingredient_product_id: 'gula', qty: 5 }]).items, [{ ingredient_product_id: 'gula', qty: 5 }]);
// Nama yang tidak dikenal tetap menghasilkan pesan yang bisa dibaca, bukan
// "undefined sudah dipilih tapi..."
cek('id tanpa nama tetap terbaca', periksaBahan([{ ingredient_product_id: 'xyz', qty: 0 }], opsi).masalah[0].includes('bahan ini'), true);
// Angka dalam bentuk teks dari sel Excel harus tetap diterima.
cek('jumlah berupa teks angka diterima', periksaBahan([{ ingredient_product_id: 'gula', qty: '12' }], opsi).items, [{ ingredient_product_id: 'gula', qty: 12 }]);

if (gagal) {
  console.error(`\n${gagal} kasus gagal.`);
  process.exit(1);
}
console.log('Penjaga isi resep benar untuk 38 kasus. ✅');
