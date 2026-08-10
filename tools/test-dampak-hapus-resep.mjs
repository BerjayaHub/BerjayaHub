/**
 * Siapa yang ikut kehilangan HPP kalau sebuah resep dihapus.
 *
 * KENAPA DIUJI. Menghapus resep terasa seperti tindakan lokal — "saya cuma
 * membetulkan satu produk yang salah impor". Padahal HPP dihitung BERANTAI:
 * menu memakai setengah jadi, setengah jadi memakai bahan baku. Menghapus resep
 * Produksi sebuah setengah jadi membuat HPP semua menu yang memakainya ikut
 * kosong — diam-diam, di layar lain, tanpa ada yang menghubungkannya dengan
 * penghapusan tadi.
 *
 * Yang dijaga di sini: daftar terdampaknya LENGKAP (termasuk yang berantai dua
 * tingkat), tidak kelebihan (varian lain di produk yang sama tidak ikut
 * terseret), dan tidak menggantung saat datanya membentuk siklus.
 *
 * Diimpor dari modul aslinya — `recipe-graph.js` sengaja dibuat tanpa impor apa
 * pun supaya bisa dijalankan di luar browser.
 */
import { pemakaiResep } from '../js/modules/product/recipe-graph.js';

let gagal = 0;
const cek = (nama, dapat, harap) => {
  if (JSON.stringify(dapat) !== JSON.stringify(harap)) {
    gagal++;
    console.error(`❌ ${nama}\n   dapat : ${JSON.stringify(dapat)}\n   harap : ${JSON.stringify(harap)}`);
  }
};

const products = [
  { id: 'gula', name: 'Gula', product_type: 'raw' },
  { id: 'kopi', name: 'Kopi', product_type: 'raw' },
  { id: 'susu', name: 'Susu', product_type: 'raw' },
  { id: 'sirup', name: 'Sirup Gula', product_type: 'semi' },
  { id: 'base', name: 'Base Kopi Susu', product_type: 'semi' },
  { id: 'eskopsu', name: 'Es Kopi Susu', product_type: 'finished' },
  { id: 'teh', name: 'Es Teh', product_type: 'finished' }
];

const recipes = [
  // Sirup Gula (setengah jadi) dari gula
  { product_id: 'sirup', mode: 'production', items: [{ ingredient_product_id: 'gula' }] },
  // Base Kopi Susu (setengah jadi) memakai Sirup Gula -> berantai dua tingkat
  { product_id: 'base', mode: 'production', items: [{ ingredient_product_id: 'kopi' }, { ingredient_product_id: 'sirup' }] },
  // Es Kopi Susu punya DUA varian yang berdiri sendiri
  { product_id: 'eskopsu', mode: 'standalone', items: [{ ingredient_product_id: 'kopi' }, { ingredient_product_id: 'sirup' }] },
  { product_id: 'eskopsu', mode: 'served_by_ck', items: [{ ingredient_product_id: 'base' }, { ingredient_product_id: 'susu' }] },
  // Es Teh tidak menyentuh apa pun di atas
  { product_id: 'teh', mode: 'standalone', items: [{ ingredient_product_id: 'gula' }] }
];

const nama = (hasil) => hasil.map((h) => `${h.name}|${h.mode}`).sort();

// --- Menghapus resep setengah jadi yang dipakai berantai ---
//
// Sirup Gula dipakai LANGSUNG oleh Base Kopi Susu dan Es Kopi Susu (standalone).
// Base Kopi Susu dipakai Es Kopi Susu (dilayani CK) — jadi varian itu ikut
// terdampak walau tidak menyebut Sirup Gula sama sekali. Inilah yang tidak
// terlihat kalau hanya memeriksa satu tingkat.
cek('sirup gula: terdampak berantai dua tingkat', nama(pemakaiResep(products, recipes, 'sirup')), [
  'Base Kopi Susu|production',
  'Es Kopi Susu|served_by_ck',
  'Es Kopi Susu|standalone'
]);

// --- Menghapus setengah jadi yang hanya dipakai satu varian ---
cek('base kopi susu: hanya varian dilayani CK', nama(pemakaiResep(products, recipes, 'base')), ['Es Kopi Susu|served_by_ck']);

// --- Menu tidak dipakai siapa pun ---
cek('menu tidak jadi bahan produk lain', pemakaiResep(products, recipes, 'eskopsu'), []);
cek('es teh juga tidak', pemakaiResep(products, recipes, 'teh'), []);

// --- Bahan baku dipakai banyak tempat ---
cek('gula dipakai sirup & es teh', nama(pemakaiResep(products, recipes, 'gula')), [
  'Base Kopi Susu|production',
  'Es Kopi Susu|served_by_ck',
  'Es Kopi Susu|standalone',
  'Es Teh|standalone',
  'Sirup Gula|production'
]);

// --- Produk yang tidak dipakai & tidak dikenal ---
cek('susu hanya dipakai satu varian', nama(pemakaiResep(products, recipes, 'susu')), ['Es Kopi Susu|served_by_ck']);
cek('id tidak dikenal -> kosong, bukan error', pemakaiResep(products, recipes, 'entah'), []);

// --- Nilai batas ---
cek('daftar resep kosong', pemakaiResep(products, [], 'sirup'), []);
cek('daftar produk kosong tetap jalan', pemakaiResep([], recipes, 'sirup').length, 3);
cek('argumen null aman', pemakaiResep(null, null, 'sirup'), []);

// Nama produk yang sudah terhapus tidak boleh membuat dialognya kosong —
// lebih baik menyebut "(produk terhapus)" daripada tidak menyebut apa-apa.
cek('produk tak dikenal diberi nama pengganti', pemakaiResep([], recipes, 'base')[0].name, '(produk terhapus)');

// --- SIKLUS: data salah input yang tidak boleh membekukan halaman ---
//
// A memakai B, B memakai A. Penelusuran rekursif akan berputar selamanya, dan
// yang muncul ke user bukan peringatan melainkan halaman yang membeku.
const siklus = [
  { product_id: 'a', mode: 'production', items: [{ ingredient_product_id: 'b' }] },
  { product_id: 'b', mode: 'production', items: [{ ingredient_product_id: 'a' }] }
];
const produkSiklus = [
  { id: 'a', name: 'A', product_type: 'semi' },
  { id: 'b', name: 'B', product_type: 'semi' }
];
// Yang didaftar hanya B: resep A adalah yang sedang dihapus, bukan korbannya.
cek('siklus berhenti, tidak berputar selamanya', nama(pemakaiResep(produkSiklus, siklus, 'a')), ['B|production']);

// Produk yang memakai DIRINYA SENDIRI (salah pilih bahan) juga tidak boleh
// membuat penelusurannya menggantung.
const sendiri = [{ product_id: 'x', mode: 'production', items: [{ ingredient_product_id: 'x' }] }];
cek('produk yang memakai dirinya sendiri', pemakaiResep([{ id: 'x', name: 'X', product_type: 'semi' }], sendiri, 'x'), []);

// SIKLUS YANG TIDAK MENYENTUH PRODUK YANG DIHAPUS.
//
// Fixture di atas berhenti karena alasan lain: siklusnya melewati produk yang
// sedang dihapus, dan penelusurannya berhenti di situ. Jadi ia TIDAK menguji
// apa yang dikira diujinya. Yang benar-benar berbahaya adalah siklus di HULU:
// bahan baku 'r' dipakai p, p dipakai q, q dipakai p lagi. Menghapus resep
// yang memakai 'r' membuat penelusuran masuk ke lingkaran p<->q tanpa pernah
// bertemu produk yang dihapus.
const hulu = [
  { product_id: 'p', mode: 'production', items: [{ ingredient_product_id: 'r' }, { ingredient_product_id: 'q' }] },
  { product_id: 'q', mode: 'production', items: [{ ingredient_product_id: 'p' }] }
];
const produkHulu = [
  { id: 'r', name: 'R', product_type: 'raw' },
  { id: 'p', name: 'P', product_type: 'semi' },
  { id: 'q', name: 'Q', product_type: 'semi' }
];
cek('siklus di hulu tetap berhenti', nama(pemakaiResep(produkHulu, hulu, 'r')), ['P|production', 'Q|production']);

if (gagal) {
  console.error(`\n${gagal} kasus gagal.`);
  process.exit(1);
}
console.log('Dampak hapus resep benar untuk 14 kasus, termasuk rantai dua tingkat & data bersiklus. ✅');
