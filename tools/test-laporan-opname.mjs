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
cek('tiga kolom rupiah', admin.kolom.slice(-3).map((k) => k.header), ['HPP/satuan', 'Nilai Opname', 'Nilai Selisih']);
cek('ditandai numeric untuk Excel', admin.kolom.slice(-3).every((k) => k.numeric), true);

// ---- NILAI OPNAME = dihitung × HPP ----
//
// Berbeda arti dari Nilai Selisih di sebelahnya: selisih menjawab "berapa yang
// hilang/lebih", nilai opname menjawab "berapa nilai stok yang ADA". Yang kedua
// itulah yang dipakai laporan COGS sebagai stok akhir.
// gula 92×15.000 + kopi 23×150.000 + susu 50×18.000
cek('nilai opname = Σ dihitung × HPP', admin.nilaiOpname, 92 * 15000 + 23 * 150000 + 50 * 18000);
// Yang DIHITUNG, bukan yang di sistem. Kalau tertukar, stok akhir jadi angka
// catatan — dan seluruh gunanya opname justru karena keduanya berbeda.
cek('bukan sistem × HPP', admin.nilaiOpname !== 100 * 15000 + 20 * 150000 + 50 * 18000, true);
// Baris berselisih NOL tetap menyumbang nilai: susu 50 cocok, tapi stoknya ada.
cek('baris tanpa selisih tetap ikut', admin.nilaiOpname > admin.nilaiLebih + Math.abs(admin.nilaiKurang), true);
cek('teksnya diformat', /^Rp /.test(admin.nilaiOpnameTeks), true);
cek('tanpa nilai: nilai opname null', staff.nilaiOpname, null);
cek('nilai kurang = -8 x 15000', admin.nilaiKurang, -120000);
cek('nilai lebih = +3 x 150000', admin.nilaiLebih, 450000);
// KURANG dan LEBIH sengaja DIPISAH. Kehilangan 2 juta yang tertutup kelebihan
// 2 juta bukan "impas" — itu dua masalah, dan angka bersih nol menyembunyikan
// keduanya.
cek('tidak dijumlahkan jadi angka bersih', admin.nilaiKurang + admin.nilaiLebih !== 0, true);
cek('teks rupiah diformat', admin.nilaiKurangTeks, 'Rp -120.000');

// ---- Selisih tanpa HPP: "-", bukan 0 ----
const tanpaHpp = susunLaporanOpname({ sesi, items, hpp: new Map([['kopi', 150000]]), denganNilai: true });
cek('tanpa HPP: ketiga kolom rupiahnya "-"', tanpaHpp.baris[0].slice(-3), ['-', '-', '-']);
cek('dan tidak ikut menambah total', tanpaHpp.nilaiKurang, 0);
cek('tidak ikut menambah nilai opname juga', tanpaHpp.nilaiOpname, 23 * 150000);
cek('ditandai supaya bisa disebut di layar', tanpaHpp.adaTanpaHpp, true);
cek('kalau semua berHPP, tidak ditandai', admin.adaTanpaHpp, false);

// ARTI `adaTanpaHpp` MELUAS sejak ada kolom Nilai Opname.
//
// Dulu baris berselisih NOL tanpa HPP bukan masalah — ia menyumbang nol ke
// satu-satunya kolom berduit. Sekarang ia tetap punya NILAI STOK: 5 unit yang
// cocok dengan sistem tetap barang yang ada di rak, dan HPP yang kosong di situ
// membuat total nilai opname lebih kecil tanpa satu pun tanda.
const nolTanpaHpp = susunLaporanOpname({
  sesi,
  items: [{ product_id: 'x', system_qty: 5, counted_qty: 5, products: { name: 'X' }, sebelumnya: [] }],
  hpp: new Map(),
  denganNilai: true
});
cek('selisih nol tapi BERSTOK tanpa HPP: ditandai', nolTanpaHpp.adaTanpaHpp, true);

// Yang benar-benar tidak menyumbang apa pun tetap TIDAK ditandai — peringatan
// yang tidak bisa ditindaklanjuti membuat orang berhenti membaca peringatan.
const nolKosong = susunLaporanOpname({
  sesi,
  items: [{ product_id: 'x', system_qty: 0, counted_qty: 0, products: { name: 'X' }, sebelumnya: [] }],
  hpp: new Map(),
  denganNilai: true
});
cek('nol-nol tanpa HPP tidak ditandai', nolKosong.adaTanpaHpp, false);

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
