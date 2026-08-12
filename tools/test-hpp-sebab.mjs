/**
 * Kenapa HPP tidak bisa dihitung, dan pemindahan varian resep.
 *
 * Label lamanya berbunyi "resep belum lengkap" — dan itu hampir selalu salah
 * menunjuk. Resep yang sedang dilihat biasanya sudah lengkap; yang kurang ada
 * di bahannya, sering dua tingkat ke bawah. Orang lalu membongkar resep yang
 * tidak rusak, tidak menemukan apa-apa, dan berhenti percaya pada layarnya.
 *
 * Jadi yang diuji di sini bukan "apakah ada pesan", tapi apakah pesannya
 * MENUNJUK KE BENDA YANG BENAR — termasuk saat sebabnya berada di bawah dua
 * lapis resep, dan saat ada dua sebab sekaligus.
 */
import { costForMode, sebabHppKosong } from '../js/modules/product/hpp.js';
import { periksaPindah, pasanganVarian } from '../js/modules/product/varian-pindah.js';

let gagal = 0;
const cek = (nama, dapat, harap) => {
  if (JSON.stringify(dapat) !== JSON.stringify(harap)) {
    gagal++;
    console.error(`❌ ${nama}\n   dapat : ${JSON.stringify(dapat)}\n   harap : ${JSON.stringify(harap)}`);
  }
};
const memuat = (nama, daftar, potongan) => {
  if (!daftar.some((s) => s.includes(potongan))) {
    gagal++;
    console.error(`❌ ${nama}\n   tidak ada yang memuat "${potongan}" dalam ${JSON.stringify(daftar)}`);
  }
};

const raw = (id, name, harga, isi) => ({ id, name, product_type: 'raw', base_unit: 'gram', purchase_price: harga, purchase_qty: isi });

// ---- Rantai: Es Kopi Susu -> Sirup Gula -> Gula ----
const products = [
  raw('gula', 'Gula', 25000, 25000),
  raw('kopi', 'Kopi', 150000, 1000),
  { id: 'sirup', name: 'Sirup Gula', product_type: 'semi', base_unit: 'ml' },
  { id: 'es', name: 'Es Kopi Susu', product_type: 'finished', base_unit: 'gelas' }
];
const recipes = [
  { product_id: 'sirup', mode: 'production', yield_qty: 1800, items: [{ ingredient_product_id: 'gula', qty: 1000 }] },
  { product_id: 'es', mode: 'standalone', yield_qty: 1, items: [{ ingredient_product_id: 'kopi', qty: 18 }, { ingredient_product_id: 'sirup', qty: 30 }] }
];

cek('rantai lengkap: HPP terhitung', Math.round(costForMode(products, recipes, 'es', 'standalone') * 100) / 100, 2700 + Math.round((1000 * 1) / 1800 * 30 * 100) / 100);
cek('rantai lengkap: tidak ada sebab', sebabHppKosong(products, recipes, 'es', 'standalone'), []);

// ---- STOK TIDAK BERPENGARUH ----
// Ini pertanyaan yang diajukan langsung: apakah resep "lengkap" butuh stok?
// Jawabannya tidak, dan itu harus benar di kode, bukan cuma di penjelasan.
const adaStok = products.map((p) => ({ ...p, stock_qty: 0, current_stock: 0 }));
cek('stok nol tidak membuat HPP hilang', costForMode(adaStok, recipes, 'es', 'standalone') != null, true);
cek('dan tidak memunculkan sebab apa pun', sebabHppKosong(adaStok, recipes, 'es', 'standalone'), []);

// ---- Sebab ada DUA TINGKAT ke bawah ----
const tanpaHargaGula = products.map((p) => (p.id === 'gula' ? { ...p, purchase_price: null } : p));
const s1 = sebabHppKosong(tanpaHargaGula, recipes, 'es', 'standalone');
cek('harga bahan hilang -> HPP menu ikut kosong', costForMode(tanpaHargaGula, recipes, 'es', 'standalone'), null);
memuat('menyebut Gula, bukan Es Kopi Susu', s1, 'Gula: harga belinya belum diisi');
// Jalurnya ikut disebut supaya orangnya tahu HARUS BUKA MANA — Gula tidak
// muncul di layar menu ini sama sekali.
memuat('menyebut lewat mana bahan itu terpakai', s1, 'dipakai Sirup Gula');
cek('tidak menyalahkan resep yang sedang dilihat', s1.some((x) => x.startsWith('Es Kopi Susu')), false);

// `purchase_qty` kosong adalah sebab yang BERBEDA dari harga kosong: diisi di
// kolom lain. Pesan yang menyamakan keduanya mengirim orang ke kolom yang salah.
const tanpaIsi = products.map((p) => (p.id === 'gula' ? { ...p, purchase_qty: 0 } : p));
memuat('isi per satuan beli kosong disebut sendiri', sebabHppKosong(tanpaIsi, recipes, 'es', 'standalone'), 'isi per satuan beli');
cek('dan tidak dilaporkan sebagai harga kosong', sebabHppKosong(tanpaIsi, recipes, 'es', 'standalone').some((x) => x.includes('harga belinya')), false);

// ---- Setengah jadi tanpa resep Produksi ----
const tanpaResepSirup = recipes.filter((r) => r.product_id !== 'sirup');
memuat('setengah jadi tanpa resep disebut', sebabHppKosong(products, tanpaResepSirup, 'es', 'standalone'), 'Sirup Gula: belum punya resep Produksi');

// ---- Resep ada tapi kosong / yield 0 ----
memuat(
  'resep tanpa bahan',
  sebabHppKosong(products, [{ product_id: 'es', mode: 'standalone', yield_qty: 1, items: [] }], 'es', 'standalone'),
  'resepnya ada tapi belum berisi bahan'
);
memuat(
  'yield nol disebut apa adanya',
  sebabHppKosong(products, [{ ...recipes[1], yield_qty: 0 }, recipes[0]], 'es', 'standalone'),
  'hasil/yield-nya 0'
);

// ---- DUA sebab sekaligus: keduanya harus disebut ----
// Melaporkan satu lalu berhenti membuat orang membetulkan satu bahan, memuat
// ulang, dan menemukan pesan yang sama lagi — berkali-kali.
const duaRusak = products.map((p) => (p.id === 'gula' || p.id === 'kopi' ? { ...p, purchase_price: null } : p));
const s2 = sebabHppKosong(duaRusak, recipes, 'es', 'standalone');
cek('dua bahan rusak -> dua sebab', s2.length, 2);
memuat('sebab pertama', s2, 'Kopi');
memuat('sebab kedua', s2, 'Gula');

// ---- Siklus tidak boleh menggantung ----
const siklus = [
  { product_id: 'a', mode: 'production', yield_qty: 1, items: [{ ingredient_product_id: 'b', qty: 1 }] },
  { product_id: 'b', mode: 'production', yield_qty: 1, items: [{ ingredient_product_id: 'a', qty: 1 }] }
];
const prodSiklus = [
  { id: 'a', name: 'A', product_type: 'semi', base_unit: 'kg' },
  { id: 'b', name: 'B', product_type: 'semi', base_unit: 'kg' }
];
cek('siklus tidak menggantung', Array.isArray(sebabHppKosong(prodSiklus, siklus, 'a', 'production')), true);

// ---- Varian yang tidak dikenal / produk hilang ----
cek('produk tidak ada -> tidak error', sebabHppKosong(products, recipes, 'entah', 'standalone'), []);
memuat('menu tanpa resep Dilayani CK', sebabHppKosong(products, recipes, 'es', 'served_by_ck'), 'belum punya resep Dilayani CK');

// ================= Pemindahan varian =================

cek('menu punya pasangan', pasanganVarian('finished', 'standalone'), 'served_by_ck');
cek('dan sebaliknya', pasanganVarian('finished', 'served_by_ck'), 'standalone');
cek('setengah jadi tidak punya pasangan', pasanganVarian('semi', 'production'), null);
cek('bahan baku pun tidak', pasanganVarian('raw', 'standalone'), null);

cek(
  'pindah normal boleh',
  periksaPindah({ productType: 'finished', dari: 'standalone', ke: 'served_by_ck', adaDari: true, adaKe: false }).boleh,
  true
);
cek(
  'arah sebaliknya juga boleh',
  periksaPindah({ productType: 'finished', dari: 'served_by_ck', ke: 'standalone', adaDari: true, adaKe: false }).boleh,
  true
);

// Inilah yang dijaga: `recipes_product_mode_uk` akan menolak UPDATE-nya, dan
// pesan "duplicate key value violates unique constraint" tidak berarti apa pun
// bagi orang yang cuma mau memindahkan resep.
const tabrakan = periksaPindah({ productType: 'finished', dari: 'standalone', ke: 'served_by_ck', adaDari: true, adaKe: true });
cek('tujuan sudah terisi -> ditolak', tabrakan.boleh, false);
memuat('alasannya menyebut jalan keluarnya', [tabrakan.alasan], 'hapus dulu resep');
// Menimpa diam-diam akan menghapus pekerjaan orang lain tanpa diminta.
memuat('dan menegaskan tidak menimpa', [tabrakan.alasan], 'tidak menimpa');

cek(
  'varian asal kosong -> tidak ada yang dipindah',
  periksaPindah({ productType: 'finished', dari: 'standalone', ke: 'served_by_ck', adaDari: false, adaKe: false }).boleh,
  false
);
cek(
  'setengah jadi ditolak dengan alasan yang benar',
  periksaPindah({ productType: 'semi', dari: 'production', ke: 'standalone', adaDari: true, adaKe: false }).alasan.includes('hanya punya satu varian'),
  true
);
cek(
  'bahan baku ditolak',
  periksaPindah({ productType: 'raw', dari: 'standalone', ke: 'served_by_ck', adaDari: true, adaKe: false }).boleh,
  false
);
cek(
  'asal = tujuan ditolak',
  periksaPindah({ productType: 'finished', dari: 'standalone', ke: 'standalone', adaDari: true, adaKe: false }).boleh,
  false
);
// "production" bukan varian menu — kalau lolos, UPDATE-nya akan membuat baris
// yang tidak pernah bisa ditampilkan layar mana pun, karena modesForType()
// untuk finished tidak memuatnya.
cek(
  'menu tidak bisa dipindah ke Produksi',
  periksaPindah({ productType: 'finished', dari: 'standalone', ke: 'production', adaDari: true, adaKe: false }).boleh,
  false
);

if (gagal) {
  console.error(`\n${gagal} kasus gagal.`);
  process.exit(1);
}
console.log('Sebab HPP kosong menunjuk bahan yang benar & pemindahan varian aman — 30 kasus. ✅');
