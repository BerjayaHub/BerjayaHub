/**
 * Laporan satu nota penerimaan.
 *
 * Yang paling ditekankan: HARGA MANA YANG DIPAKAI, dan apa yang terjadi pada
 * barang yang belum punya harga. Dua-duanya gagal dengan tenang — totalnya
 * tetap tampil rapi, hanya angkanya yang salah, dan yang memakainya sedang
 * berdebat dengan supplier soal tagihan.
 */
import { susunLaporanNota, KOLOM_NOTA } from '../js/modules/inventory/laporan-nota.js';

let gagal = 0;
const cek = (nama, dapat, harap) => {
  if (JSON.stringify(dapat) !== JSON.stringify(harap)) {
    gagal++;
    console.error(`❌ ${nama}\n   dapat : ${JSON.stringify(dapat)}\n   harap : ${JSON.stringify(harap)}`);
  }
};

const nota = {
  code: 'GR-260818-7K3M',
  receipt_date: '2026-08-18',
  supplier: 'Toko Berkah',
  invoice_no: 'INV/2026/0812',
  outlets: { name: 'Gading Serpong' }
};

const items = [
  { product_id: 'gula', qty: 10, unit_cost: 15000, products: { name: 'Gula Pasir', base_unit: 'kg' } },
  { product_id: 'kopi', qty: 2, unit_cost: 150000, products: { name: 'Kopi Arabika', base_unit: 'kg' } },
  { product_id: 'susu', qty: 5, unit_cost: 18000, products: { name: 'Susu UHT', base_unit: 'liter' } }
];

// ---- Bentuk dasar ----
const lap = susunLaporanNota({ nota, items });
cek('judul memuat nomor nota', lap.judul, 'Nota Terima GR-260818-7K3M');
cek('subjudul lengkap', lap.subjudul, 'Gading Serpong · 2026-08-18 · Toko Berkah · no. supplier INV/2026/0812');
cek('jumlah item', lap.jumlahItem, 3);
cek('kolomnya lima', lap.kolom.length, 5);
cek('kolom sama dengan yang diekspor', lap.kolom, KOLOM_NOTA);
cek('total = 150.000 + 300.000 + 90.000', lap.total, 540000);
cek('tidak ada barang tanpa harga', lap.adaTanpaHarga, false);
cek('nama berkas aman', lap.namaBerkas, 'nota-GR-260818-7K3M');

// ---- Kolom uang ditandai numeric supaya SUM di Excel jalan ----
cek('kolom Harga/satuan numeric', KOLOM_NOTA[3].numeric, true);
cek('kolom Nilai numeric', KOLOM_NOTA[4].numeric, true);
cek('kolom Jumlah TIDAK numeric', KOLOM_NOTA[1].numeric ?? false, false);

// ---- Isi baris ----
cek('baris pertama nama', lap.baris[0][0], 'Gula Pasir');
cek('baris pertama satuan', lap.baris[0][2], 'kg');
cek('baris pertama nilai bukan "-"', lap.baris[0][4] !== '-', true);

// =====================================================================
// HARGA NOTA MENANG ATAS HPP SEKARANG
//
// Ini inti laporannya. Kalau urutannya terbalik, nota bulan lalu dinilai
// dengan harga hari ini — totalnya tidak pernah cocok dengan tagihan mana
// pun, dan tidak ada yang tampak salah.
// =====================================================================
const hppSekarang = new Map([['gula', 99000], ['kopi', 99000], ['susu', 99000]]);
const lapHpp = susunLaporanNota({ nota, items, hpp: hppSekarang });
cek('unit_cost nota dipakai, bukan HPP hari ini', lapHpp.total, 540000);

// ---- HPP hanya dipakai kalau nota tidak menyimpan harga ----
const itemsTanpaHarga = [
  { product_id: 'gula', qty: 10, unit_cost: null, products: { name: 'Gula Pasir', base_unit: 'kg' } }
];
const lapCadangan = susunLaporanNota({ nota, items: itemsTanpaHarga, hpp: new Map([['gula', 15000]]) });
cek('HPP jadi cadangan saat unit_cost kosong', lapCadangan.total, 150000);
cek('pakai cadangan tetap dianggap berharga', lapCadangan.adaTanpaHarga, false);

// ---- Tidak ada harga sama sekali ----
const lapKosong = susunLaporanNota({ nota, items: itemsTanpaHarga });
cek('tanpa harga: total tetap 0', lapKosong.total, 0);
cek('tanpa harga: ditandai', lapKosong.adaTanpaHarga, true);
cek('tanpa harga: sel harga "-"', lapKosong.baris[0][3], '-');
cek('tanpa harga: sel nilai "-" bukan Rp 0', lapKosong.baris[0][4], '-');

// ---- Campuran: sebagian berharga, sebagian tidak ----
const campur = susunLaporanNota({
  nota,
  items: [
    { product_id: 'gula', qty: 10, unit_cost: 15000, products: { name: 'Gula', base_unit: 'kg' } },
    { product_id: 'x', qty: 3, unit_cost: null, products: { name: 'Bahan Baru', base_unit: 'pcs' } }
  ]
});
cek('campuran: total hanya yang berharga', campur.total, 150000);
cek('campuran: ditandai ada yang belum berharga', campur.adaTanpaHarga, true);
cek('campuran: barisnya tetap dua', campur.jumlahItem, 2);

// =====================================================================
// HARGA NOL ADALAH HARGA YANG SAH
//
// Barang bonus/promo datang dengan harga 0. Kalau `??` jadi `||`, nol
// terbaca "kosong" dan diam-diam diganti HPP — nota bonus jadi bernilai.
// =====================================================================
const bonus = susunLaporanNota({
  nota,
  items: [{ product_id: 'gula', qty: 5, unit_cost: 0, products: { name: 'Gula Bonus', base_unit: 'kg' } }],
  hpp: new Map([['gula', 15000]])
});
cek('harga 0 tidak jatuh ke HPP', bonus.total, 0);
cek('harga 0 bukan "belum berharga"', bonus.adaTanpaHarga, false);
cek('harga 0 tidak ditulis "-"', bonus.baris[0][3] !== '-', true);

// ---- Produk yang sudah dihapus dari master ----
const yatim = susunLaporanNota({
  nota,
  items: [{ product_id: 'hilang', qty: 2, unit_cost: 5000, products: null }]
});
cek('produk terhapus tetap muncul', yatim.baris[0][0], '(produk terhapus)');
cek('produk terhapus tetap dihitung', yatim.total, 10000);
cek('produk terhapus: satuan kosong bukan undefined', yatim.baris[0][2], '');

// ---- Nota kosong / rusak ----
const nol = susunLaporanNota({ nota, items: [] });
cek('nota kosong: nol item', nol.jumlahItem, 0);
cek('nota kosong: total 0', nol.total, 0);
cek('nota kosong: tidak ditandai', nol.adaTanpaHarga, false);

const takAda = susunLaporanNota({ nota, items: null });
cek('items null tidak melempar', takAda.jumlahItem, 0);

const tanpaNota = susunLaporanNota({ nota: null, items });
cek('nota null: judul tetap terbaca', tanpaNota.judul, 'Nota Terima (tanpa nomor)');
cek('nota null: subjudul kosong', tanpaNota.subjudul, '');
cek('nota null: nama berkas tetap aman', tanpaNota.namaBerkas, 'nota--tanpa-nomor-');

// ---- Kepala nota yang sebagian kosong ----
const sebagian = susunLaporanNota({ nota: { code: 'GR-1', receipt_date: '2026-08-18' }, items });
cek('field kosong tidak jadi "undefined"', sebagian.subjudul, '2026-08-18');

// =====================================================================
// NAMA BERKAS
//
// Kode nota ikut jadi nama file. Karakter seperti "/" pada nomor akan
// memotong nama file diam-diam (atau menulis ke folder lain).
// =====================================================================
cek(
  'garis miring dibersihkan dari nama berkas',
  susunLaporanNota({ nota: { code: 'GR/2026/08' }, items: [] }).namaBerkas,
  'nota-GR-2026-08'
);
cek(
  'spasi & karakter aneh dibersihkan',
  susunLaporanNota({ nota: { code: 'GR 26 #7*' }, items: [] }).namaBerkas,
  'nota-GR-26-7-'
);

// ---- qty berbentuk teks (datang dari input) ----
const teks = susunLaporanNota({
  nota,
  items: [{ product_id: 'gula', qty: '10', unit_cost: 15000, products: { name: 'Gula', base_unit: 'kg' } }]
});
cek('qty teks tetap terhitung', teks.total, 150000);

// ---- qty pecahan ----
const pecah = susunLaporanNota({
  nota,
  items: [{ product_id: 'gula', qty: 2.5, unit_cost: 15000, products: { name: 'Gula', base_unit: 'kg' } }]
});
cek('qty pecahan terhitung', pecah.total, 37500);

// ---- totalTeks konsisten dengan total ----
cek('totalTeks bukan kosong', lap.totalTeks.length > 0, true);
cek('totalTeks memuat angka', /\d/.test(lap.totalTeks), true);

if (gagal) {
  console.error(`\n${gagal} kasus gagal.`);
  process.exit(1);
}
console.log('Laporan nota terima benar untuk 41 kasus — termasuk harga bonus 0 dan harga nota vs HPP hari ini. ✅');
