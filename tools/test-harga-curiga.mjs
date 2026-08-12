/**
 * Deteksi harga beli yang diisi dengan satuan yang salah.
 *
 * "Harga Beli" bisa dibaca dua arah — harga sekarung atau harga segram — dan
 * salah bacanya tidak menimbulkan gejala apa pun: impornya sukses, tabelnya
 * rapi, dan HPP-nya meleset ratusan kali lipat sampai ada yang curiga
 * berbulan-bulan kemudian, biasanya setelah harga jual telanjur ditetapkan.
 *
 * DUA HAL YANG DIUJI, DAN YANG KEDUA LEBIH PENTING:
 *   1. yang salah memang ketangkap;
 *   2. yang BENAR tidak ikut ditandai. Peringatan yang muncul di data normal
 *      akan diabaikan dalam seminggu, dan setelah itu ia tidak menjaga apa pun.
 */
import { curigaHargaTertukar, curigaBanyak } from '../js/modules/product/harga-curiga.js';

let gagal = 0;
const cek = (nama, dapat, harap) => {
  if (JSON.stringify(dapat) !== JSON.stringify(harap)) {
    gagal++;
    console.error(`❌ ${nama}\n   dapat : ${JSON.stringify(dapat)}\n   harap : ${JSON.stringify(harap)}`);
  }
};
const bahan = (o) => ({ product_type: 'raw', name: 'X', base_unit: 'gram', purchase_unit: 'karung', ...o });

// ================= Yang WAJAR tidak boleh ditandai =================

// Gula sekarung 25 kg, Rp 250.000 → Rp 10/gram.
cek('gula sekarung wajar', curigaHargaTertukar(bahan({ name: 'Gula', purchase_qty: 25000, purchase_price: 250000 })), null);
// Kopi 1 kg Rp 150.000 → Rp 150/gram.
cek('kopi kiloan wajar', curigaHargaTertukar(bahan({ name: 'Kopi', purchase_qty: 1000, purchase_price: 150000 })), null);
// Satuan beli = satuan pakai, isi 1: yang paling lumrah untuk barang satuan.
cek(
  'satuan beli sama dengan satuan pakai, isi 1',
  curigaHargaTertukar(bahan({ name: 'Susu UHT', base_unit: 'pcs', purchase_unit: 'pcs', purchase_qty: 1, purchase_price: 18000 })),
  null
);
// Beda huruf besar/kecil dan spasi tidak boleh dianggap satuan yang berbeda —
// kalau dianggap beda, "Pcs" vs "pcs " akan memicu peringatan palsu di kasus
// paling umum, dan justru itu yang mematikan peringatannya.
cek(
  'beda kapital & spasi tetap dianggap sama',
  curigaHargaTertukar(bahan({ name: 'Susu', base_unit: 'pcs', purchase_unit: ' Pcs', purchase_qty: 1, purchase_price: 18000 })),
  null
);
// Tepat Rp 1/gram — batasnya, dan batas harus lolos.
cek('tepat Rp 1 per satuan pakai lolos', curigaHargaTertukar(bahan({ purchase_qty: 1000, purchase_price: 1000 })), null);

// Data yang belum lengkap bukan urusan file ini — itu tugas sebabHppKosong().
cek('harga kosong diabaikan', curigaHargaTertukar(bahan({ purchase_qty: 25000, purchase_price: null })), null);
cek('isi kosong diabaikan', curigaHargaTertukar(bahan({ purchase_qty: null, purchase_price: 250000 })), null);
cek('isi nol diabaikan', curigaHargaTertukar(bahan({ purchase_qty: 0, purchase_price: 250000 })), null);
cek('produk null aman', curigaHargaTertukar(null), null);

// Setengah jadi & menu: HPP-nya datang dari RESEP, bukan dari harga beli, jadi
// kolom itu tidak berarti apa-apa di sana. Angkanya sengaja dibuat yang PASTI
// memicu kedua aturan kalau saringan tipenya dicabut — versi sebelumnya memakai
// angka yang kebetulan wajar, jadi tes ini hijau tanpa membuktikan apa pun.
cek(
  'setengah jadi diabaikan',
  curigaHargaTertukar({ product_type: 'semi', name: 'Sirup', base_unit: 'ml', purchase_unit: 'botol', purchase_qty: 25000, purchase_price: 10 }),
  null
);
cek(
  'menu diabaikan',
  curigaHargaTertukar({ product_type: 'finished', name: 'Es Kopi', base_unit: 'gelas', purchase_unit: 'dus', purchase_qty: 1, purchase_price: 250000 }),
  null
);

// ================= Yang SALAH harus ketangkap =================

// Kasus asli: harga per gram (10) diisi di kolom harga sekarung.
const terbalik = curigaHargaTertukar(bahan({ name: 'Gula', purchase_qty: 25000, purchase_price: 10 }));
cek('harga per gram di kolom harga beli ketangkap', terbalik != null, true);
cek('menyebut nama produknya', terbalik.includes('Gula'), true);
// Angkanya ikut ditulis: "Rp 0,0004/gram" langsung terlihat mustahil, sedangkan
// "harga mungkin salah" masih bisa diperdebatkan dalam hati.
cek('menyebut HPP yang mustahil itu', terbalik.includes('0.0004'), true);
cek('menyebut satuan pakainya', terbalik.includes('gram'), true);
cek('menjelaskan yang benar diisi apa', terbalik.includes('sekarung') || terbalik.includes('SATU'), true);

// Arah salah yang BERLAWANAN: isi dibiarkan 1 padahal satuannya berbeda.
// Tidak tertangkap kasus pertama karena hasil baginya justru besar.
const isiSatu = curigaHargaTertukar(bahan({ name: 'Gula', purchase_qty: 1, purchase_price: 250000 }));
cek('isi 1 dengan satuan berbeda ketangkap', isiSatu != null, true);
cek('dan alasannya menyebut kolom isi', isiSatu.includes('Isi per Satuan Beli'), true);
cek('bukan pesan yang sama dengan kasus terbalik', isiSatu.includes('terlihat terbalik'), false);
// Ini yang membedakannya dari kasus wajar "pcs → pcs isi 1".
cek('menyebut kedua satuannya supaya bedanya terlihat', isiSatu.includes('karung') && isiSatu.includes('gram'), true);

// Rp 0,99/gram — tepat di bawah ambang.
cek('tepat di bawah Rp 1 ketangkap', curigaHargaTertukar(bahan({ purchase_qty: 1000, purchase_price: 990 })) != null, true);

// ================= Sekumpulan produk =================
const daftar = [
  bahan({ name: 'Gula', purchase_qty: 25000, purchase_price: 250000 }), // wajar
  bahan({ name: 'Tepung', purchase_qty: 25000, purchase_price: 8 }), // terbalik
  bahan({ name: 'Garam', purchase_qty: 1, purchase_price: 15000 }), // isi 1
  { product_type: 'finished', name: 'Es Kopi', sale_price: 18000 } // bukan bahan baku
];
const semua = curigaBanyak(daftar);
cek('hanya yang bermasalah yang dilaporkan', semua.length, 2);
cek('yang wajar tidak ikut', semua.some((w) => w.includes('Gula')), false);
cek('daftar kosong aman', curigaBanyak([]), []);
cek('daftar null aman', curigaBanyak(null), []);

if (gagal) {
  console.error(`\n${gagal} kasus gagal.`);
  process.exit(1);
}
console.log('Deteksi harga beli tertukar benar untuk 26 kasus — dan diam pada data yang wajar. ✅');
