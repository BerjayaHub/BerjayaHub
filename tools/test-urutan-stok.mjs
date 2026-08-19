/**
 * Urutan tabel stok.
 *
 * Yang paling ditekankan: STOK YANG TIDAK DIKETAHUI TIDAK BOLEH IKUT KE PUNCAK.
 *
 * `Number(null)` adalah 0, dan 0 lolos `isFinite`. Kalau jenisnya tidak
 * diperiksa lebih dulu, bahan yang saldonya belum pernah tercatat akan menyamar
 * jadi "kosong", duduk di antara bahan yang benar-benar habis, dan menenggelamkan
 * yang sungguhan minus — yaitu kebalikan persis dari tujuan pengurutan ini.
 */
const { urutStokTerendah } = await import('../js/modules/inventory/urutan-stok.js');

let gagal = 0;
const cek = (nama, dapat, harap) => {
  if (JSON.stringify(dapat) !== JSON.stringify(harap)) {
    gagal++;
    console.error(`❌ ${nama}\n   dapat : ${JSON.stringify(dapat)}\n   harap : ${JSON.stringify(harap)}`);
  }
};

const urut = (baris) => urutStokTerendah(baris, (b) => b.qty, (b) => b.nama).map((b) => b.nama);

// =====================================================================
// DASAR
// =====================================================================
cek(
  'minus paling atas, lalu menaik',
  urut([
    { nama: 'Gula', qty: 50 },
    { nama: 'Tepung', qty: -12 },
    { nama: 'Susu', qty: 0 },
    { nama: 'Kopi', qty: 3 }
  ]),
  ['Tepung', 'Susu', 'Kopi', 'Gula']
);

cek(
  'beberapa minus diurut dari yang PALING minus',
  urut([
    { nama: 'A', qty: -2 },
    { nama: 'B', qty: -40 },
    { nama: 'C', qty: -7 }
  ]),
  ['B', 'C', 'A']
);

cek('daftar kosong aman', urut([]), []);
cek('null aman', urutStokTerendah(null, (b) => b.qty, (b) => b.nama), []);

// =====================================================================
// PEMECAH SERI
//
// Stok 0 akan sangat banyak. Tanpa pemecah seri, urutan di antara mereka
// mewarisi urutan sebelumnya — dan urutan sebelumnya berubah tiap kali
// saringan diubah, sehingga daftarnya seolah mengacak diri sendiri saat orang
// mengetik di kotak cari.
// =====================================================================
cek(
  'stok sama diurut menurut nama',
  urut([
    { nama: 'Zaitun', qty: 0 },
    { nama: 'Almond', qty: 0 },
    { nama: 'Mentega', qty: 0 }
  ]),
  ['Almond', 'Mentega', 'Zaitun']
);

// Masukan dengan urutan awal BERBEDA harus menghasilkan keluaran yang SAMA.
// Kalau ini gagal, pemecah serinya tidak bekerja dan daftarnya akan berubah
// sendiri tanpa ada yang mengubah apa pun.
const acak1 = [
  { nama: 'Beras', qty: 0 },
  { nama: 'Ayam', qty: 0 },
  { nama: 'Cabai', qty: 0 }
];
const acak2 = [
  { nama: 'Cabai', qty: 0 },
  { nama: 'Beras', qty: 0 },
  { nama: 'Ayam', qty: 0 }
];
cek('urutan awal tidak mempengaruhi hasil', urut(acak1), urut(acak2));

// =====================================================================
// STOK TIDAK DIKETAHUI — DI BAWAH, BUKAN DIANGGAP NOL
// =====================================================================
cek(
  'null ditaruh paling bawah',
  urut([
    { nama: 'BelumTercatat', qty: null },
    { nama: 'Minus', qty: -5 },
    { nama: 'Habis', qty: 0 },
    { nama: 'Ada', qty: 10 }
  ]),
  ['Minus', 'Habis', 'Ada', 'BelumTercatat']
);

cek(
  'undefined juga di bawah',
  urut([{ nama: 'Tak ada kunci' }, { nama: 'Minus', qty: -1 }]),
  ['Minus', 'Tak ada kunci']
);

cek(
  'string bukan angka juga di bawah',
  urut([{ nama: 'Rusak', qty: 'entah' }, { nama: 'Habis', qty: 0 }]),
  ['Habis', 'Rusak']
);

cek(
  'beberapa yang tidak diketahui tetap diurut namanya',
  urut([{ nama: 'Z', qty: null }, { nama: 'A', qty: null }, { nama: 'M', qty: 5 }]),
  ['M', 'A', 'Z']
);

// Angka dalam bentuk string TETAP dibaca sebagai angka — `stock_balances`
// memulangkan numeric, dan PostgREST kadang mengirimnya sebagai string.
cek(
  'angka berbentuk string tetap dihitung',
  urut([{ nama: 'Besar', qty: '100' }, { nama: 'Minus', qty: '-3' }, { nama: 'Nol', qty: '0' }]),
  ['Minus', 'Nol', 'Besar']
);

// =====================================================================
// TIDAK MENGUBAH ARRAY MASUKAN
//
// Layar lain masih memegang array yang sama. `sort()` di tempat akan mengubah
// urutan daftar produk induknya, dan dropdown di layar itu ikut teracak tanpa
// ada yang menyentuhnya.
// =====================================================================
const asli = [{ nama: 'B', qty: 5 }, { nama: 'A', qty: 1 }];
const salinan = JSON.stringify(asli);
urutStokTerendah(asli, (b) => b.qty, (b) => b.nama);
cek('array masukan tidak diubah', JSON.stringify(asli), salinan);

// =====================================================================
// BENTUK BARIS YANG BERBEDA — dua layar memakainya dengan bentuk berbeda
// =====================================================================
const barisAdmin = [
  { p: { name: 'Gula' }, qty: 20 },
  { p: { name: 'Tepung' }, qty: -4 }
];
cek(
  'bentuk Admin Portal (r.p.name / r.qty)',
  urutStokTerendah(barisAdmin, (r) => r.qty, (r) => r.p.name).map((r) => r.p.name),
  ['Tepung', 'Gula']
);

console.log(gagal === 0 ? '✅ urutan stok: semua lulus' : `❌ urutan stok: ${gagal} gagal`);
process.exit(gagal === 0 ? 0 : 1);
