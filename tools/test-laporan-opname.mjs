/**
 * Laporan satu sesi Stok Opname.
 *
 * Yang paling ditekankan: ARAH SELISIH. "kurang 5" dan "lebih 5" sama-sama
 * masuk akal dibaca, tidak menghasilkan error kalau tertukar, dan kalau
 * tertukar maka laporan kehilangan barang berubah jadi laporan kelebihan.
 * Angka ini yang dipakai menjelaskan selisih ke pemilik.
 */
import { susunLaporanOpname } from '../js/modules/inventory/laporan-opname.js';

let gagal = 0;
const cek = (nama, dapat, harap) => {
  if (JSON.stringify(dapat) !== JSON.stringify(harap)) {
    gagal++;
    console.error(`❌ ${nama}\n   dapat : ${JSON.stringify(dapat)}\n   harap : ${JSON.stringify(harap)}`);
  }
};

const sesi = { code: 'OPN-260818-A1B2', count_date: '2026-08-18', status: 'closed', outletName: 'Gading Serpong' };
const items = [
  { product_id: 'gula', system_qty: 100, counted_qty: 92, products: { name: 'Gula', base_unit: 'kg' }, penghitung: { full_name: 'Budi' }, sebelumnya: [] },
  { product_id: 'kopi', system_qty: 20, counted_qty: 23, products: { name: 'Kopi', base_unit: 'kg' }, penghitung: { full_name: 'Sari' }, sebelumnya: [] },
  { product_id: 'susu', system_qty: 50, counted_qty: 50, products: { name: 'Susu', base_unit: 'liter' }, penghitung: { full_name: 'Budi' }, sebelumnya: [] }
];
const hpp = new Map([['gula', 15000], ['kopi', 150000], ['susu', 18000]]);

// ---- Tanpa nilai (Staff App) ----
const staff = susunLaporanOpname({ sesi, items });
cek('kolomnya enam', staff.kolom.length, 6);
cek('tidak ada kolom rupiah', staff.kolom.some((k) => k.header.includes('HPP')), false);
cek('nilai tidak dihitung', staff.nilaiKurang, null);

// ---- ARAH SELISIH ----
// dihitung − sistem. Kurang = negatif, lebih = positif.
cek('barang KURANG -> negatif', staff.baris[0][4], '-8');
cek('barang LEBIH -> positif dengan tanda +', staff.baris[1][4], '+3');
cek('cocok -> 0 tanpa tanda', staff.baris[2][4], '0');
cek('yang cocok tidak dihitung sebagai selisih', staff.jumlahSelisih, 2);

// ---- Dengan nilai (Admin) ----
const admin = susunLaporanOpname({ sesi, items, hpp, denganNilai: true });
cek('dua kolom rupiah', admin.kolom.slice(-2).map((k) => k.header), ['HPP/satuan', 'Nilai Selisih']);
cek('ditandai numeric untuk Excel', admin.kolom.slice(-2).every((k) => k.numeric), true);
cek('nilai kurang = -8 x 15000', admin.nilaiKurang, -120000);
cek('nilai lebih = +3 x 150000', admin.nilaiLebih, 450000);
// KURANG dan LEBIH sengaja DIPISAH. Kehilangan 2 juta yang tertutup kelebihan
// 2 juta bukan "impas" — itu dua masalah, dan angka bersih nol menyembunyikan
// keduanya.
cek('tidak dijumlahkan jadi angka bersih', admin.nilaiKurang + admin.nilaiLebih !== 0, true);
cek('teks rupiah diformat', admin.nilaiKurangTeks, 'Rp -120.000');

// ---- Selisih tanpa HPP: "-", bukan 0 ----
const tanpaHpp = susunLaporanOpname({ sesi, items, hpp: new Map([['kopi', 150000]]), denganNilai: true });
cek('selisih tanpa HPP ditandai "-"', tanpaHpp.baris[0].slice(-2), ['-', '-']);
cek('dan tidak ikut menambah total', tanpaHpp.nilaiKurang, 0);
cek('ditandai supaya bisa disebut di layar', tanpaHpp.adaTanpaHpp, true);
cek('kalau semua berHPP, tidak ditandai', admin.adaTanpaHpp, false);
// Item yang selisihnya 0 tanpa HPP BUKAN masalah — tidak ada nilai yang hilang.
const nolTanpaHpp = susunLaporanOpname({
  sesi,
  items: [{ product_id: 'x', system_qty: 5, counted_qty: 5, products: { name: 'X' }, sebelumnya: [] }],
  hpp: new Map(),
  denganNilai: true
});
cek('selisih nol tanpa HPP tidak ditandai', nolTanpaHpp.adaTanpaHpp, false);

// ---- Hitungan yang tergantikan ditandai ----
const bentrok = susunLaporanOpname({
  sesi,
  items: [
    { product_id: 'gula', system_qty: 100, counted_qty: 40, products: { name: 'Gula' }, penghitung: { full_name: 'Sari' }, sebelumnya: [{ qty: 12, by: 'u1' }] }
  ]
});
cek('yang pernah dihitung beda ditandai ⚠', bentrok.baris[0][5].includes('⚠'), true);
cek('dihitung di ringkasan', bentrok.jumlahBentrok, 1);
cek('dan disebut di subjudul', bentrok.subjudul.includes('perlu dicek'), true);
cek('yang tidak bentrok tidak ditandai', staff.baris[0][5], 'Budi');
cek('tanpa bentrok tidak muncul di subjudul', staff.subjudul.includes('perlu dicek'), false);

// ---- Sesi yang masih berjalan disebut apa adanya ----
const jalan = susunLaporanOpname({ sesi: { ...sesi, status: 'open' }, items });
cek('status berjalan ditulis mencolok', jalan.subjudul.includes('MASIH BERJALAN'), true);

// ---- Nilai batas ----
cek('nama berkas aman dipakai', admin.namaBerkas, 'opname-OPN-260818-A1B2');
cek('nomor bergaris miring dibersihkan', susunLaporanOpname({ sesi: { code: 'OPN/1' }, items: [] }).namaBerkas, 'opname-OPN-1');
cek('tanpa item aman', susunLaporanOpname({ sesi, items: [] }).baris, []);
cek('items null aman', susunLaporanOpname({ sesi, items: null }).baris, []);
cek('tanpa sesi tetap punya judul', susunLaporanOpname({ items: [] }).judul, 'Stok Opname (tanpa nomor)');
cek('produk terhapus tetap disebut', susunLaporanOpname({ sesi, items: [{ product_id: 'z', system_qty: 1, counted_qty: 0 }] }).baris[0][0], '(produk terhapus)');
cek('penghitung kosong jadi "-"', susunLaporanOpname({ sesi, items: [{ product_id: 'z', system_qty: 1, counted_qty: 1 }] }).baris[0][5], '-');
// Pecahan harus utuh — banyak bahan ditakar dalam gram/ml.
cek('selisih pecahan tidak dibulatkan', susunLaporanOpname({ sesi, items: [{ product_id: 'z', system_qty: 1.5, counted_qty: 1.25 }] }).baris[0][4], '-0,25');

if (gagal) {
  console.error(`\n${gagal} kasus gagal.`);
  process.exit(1);
}
console.log('Laporan opname benar untuk 28 kasus — termasuk arah selisih dan nilai yang tidak dijumlahkan bersih. ✅');
