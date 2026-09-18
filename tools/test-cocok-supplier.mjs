/**
 * TES: pencocokan nama supplier dengan daftar induk ESB.
 *
 * Yang dijaga: nama KANONIK yang berangkat (bukan ejaan yang diketik), nota
 * bersupplier tak dikenal TERTAHAN, dan BU yang belum mengimpor daftarnya tidak
 * mendadak kehilangan seluruh notanya.
 */
import assert from 'node:assert/strict';
import {
  normalNama,
  petaSupplier,
  petaEjaanSupplier,
  cocokkanSupplier,
  supplierSiap,
  supplierPerluDibereskan,
  PESAN_DI_LUAR_DAFTAR
} from '../js/modules/inventory/cocok-supplier.js';
import { KOLOM_ESB, JENIS_PETA, buatPeta, barisEsbPurchase } from '../js/modules/inventory/esb-purchase.js';

let n = 0;
const ok = (nama) => {
  n += 1;
  console.log(`  ✔ ${nama}`);
};

// Diambil apa adanya dari berkas ESB yang diunggah: 35 supplier, dan ejaannya
// beragam — ada titik, ada "PT"/"CV"/"UD", ada yang seluruhnya huruf besar.
const MASTER = [
  { jenis: 'supplier', nama: 'General Supplier', kode: 'CK00' },
  { jenis: 'supplier', nama: 'Pasar', kode: 'CK01' },
  { jenis: 'supplier', nama: 'Mitra Plastik', kode: 'CK02' },
  { jenis: 'supplier', nama: 'Toko Beras Ridho', kode: 'CK11' },
  { jenis: 'supplier', nama: 'PD. Es Cristal Glass', kode: 'CK16' },
  { jenis: 'supplier', nama: 'UD. Naden Bumbu', kode: 'CK05' },
  { jenis: 'supplier', nama: 'PT KIMIA YASA', kode: 'CK25' },
  { jenis: 'supplier', nama: 'Gerobak Telur', kode: 'CK10' },
  // Baris berjenis LAIN harus diabaikan — satu tabel menampung semua daftar.
  //
  // Namanya sengaja TIDAK sama dengan supplier mana pun di atas. Percobaan
  // pertama memakai 'Pasar' dan 'Mitra Plastik', dan pemeriksaannya jadi tidak
  // membuktikan apa pun: baris itu dibuang oleh aturan "nama kembar diabaikan",
  // bukan oleh penyaring jenis. Sabotase yang mencabut penyaring jenisnya tetap
  // lolos, karena penjaga sebelah kebetulan menangkapnya.
  { jenis: 'item', nama: 'BERAS PREMIUM', kode: 'X1' },
  { jenis: 'branch', nama: 'HEAD OFFICE', kode: 'X2' }
];

const master = petaSupplier(MASTER);

console.log('§1 Peta daftar induk');

assert.equal(master.size, 8);
ok('hanya baris berjenis supplier yang masuk — 8, bukan 10');

assert.equal(master.get('pasar').nama, 'Pasar');
assert.equal(master.get('pasar').kode, 'CK01');
ok('nama & kode ESB tersimpan');

assert.equal(petaSupplier(null).size, 0);
assert.equal(petaSupplier([{ jenis: 'supplier', nama: '   ' }]).size, 0);
ok('masukan kosong & nama kosong tidak melempar');

// Dua baris yang cuma beda huruf besar-kecil: yang PERTAMA menang. Kalau yang
// terakhir menang, nama kanoniknya berubah tergantung urutan datangnya dari
// database — dan dua unduhan berturut-turut bisa berisi ejaan berbeda.
const kembar = petaSupplier([
  { jenis: 'supplier', nama: 'Pasar' },
  { jenis: 'supplier', nama: 'PASAR' }
]);
assert.equal(kembar.size, 1);
assert.equal(kembar.get('pasar').nama, 'Pasar');
ok('nama kembar beda huruf besar-kecil: yang pertama menang, hasilnya stabil');

console.log('\n§2 Normalisasi');

assert.equal(normalNama('  Toko   Beras  Ridho '), 'toko beras ridho');
ok('huruf besar-kecil & spasi ganda dirapikan');

// Titik, koma, "PT"/"CV" TIDAK disentuh. "PT KIMIA YASA" dan "CV KIMIA YASA"
// adalah dua badan hukum yang berbeda; mencocokkannya akan menaruh pembelian
// di akun yang salah tanpa satu pun tanda di layar.
assert.notEqual(normalNama('PT KIMIA YASA'), normalNama('CV KIMIA YASA'));
assert.notEqual(normalNama('PD. Es Cristal Glass'), normalNama('PD Es Cristal Glass'));
ok('titik dan bentuk badan hukum TIDAK diabaikan');

console.log('\n§3 Tiga keadaan');

assert.deepEqual(cocokkanSupplier('Pasar', master), { keadaan: 'daftar', nama: 'Pasar', diketik: 'Pasar' });
ok('nama yang ada di daftar: keadaan "daftar"');

const beda = cocokkanSupplier('  toko   beras   ridho ', master);
assert.equal(beda.keadaan, 'daftar');
assert.equal(beda.nama, 'Toko Beras Ridho');
assert.equal(beda.diketik, 'toko   beras   ridho');
ok('beda huruf besar-kecil & spasi tetap cocok, dan yang dikembalikan ejaan ESB-nya');

assert.equal(cocokkanSupplier('Toko Sebelah', master).keadaan, 'tak-dikenal');
assert.equal(cocokkanSupplier('Toko Sebelah', master).nama, null);
ok('nama di luar daftar: "tak-dikenal", tanpa nama pengganti yang dikarang');

assert.equal(cocokkanSupplier('', master).keadaan, 'kosong');
assert.equal(cocokkanSupplier(null, master).keadaan, 'kosong');
assert.equal(cocokkanSupplier('   ', master).keadaan, 'kosong');
ok('supplier kosong dibedakan dari supplier yang tidak dikenal');

const ejaan = petaEjaanSupplier([
  { jenis: 'supplier', kunci: 'PD Es Cristal Glass', nilai: 'PD. Es Cristal Glass' },
  { jenis: 'supplier', kunci: 'toko beras rido', nilai: 'Toko Beras Ridho' },
  { jenis: 'branch', kunci: 'AB Sentul', nilai: 'Cabang Sentul' }
]);
assert.equal(ejaan.size, 2);
ok('peta ejaan hanya memuat jenis supplier');

const lewatPeta = cocokkanSupplier('PD Es Cristal Glass', master, ejaan);
assert.equal(lewatPeta.keadaan, 'dipetakan');
assert.equal(lewatPeta.nama, 'PD. Es Cristal Glass');
ok('ejaan lama tanpa titik dipetakan ke nama ESB-nya');

assert.equal(cocokkanSupplier('Toko Beras Rido', master, ejaan).nama, 'Toko Beras Ridho');
ok('salah ketik sungguhan pun bisa dipetakan sekali');

// Pemetaan yang menunjuk nama yang SUDAH TIDAK ADA di daftar tidak sah. ESB
// bisa menonaktifkan supplier, impor berikutnya menghapusnya, dan pemetaannya
// tetap tinggal — terus mengirim nama hantu yang ditolak ESB.
const hantu = petaEjaanSupplier([{ jenis: 'supplier', kunci: 'apa saja', nilai: 'Supplier Yang Sudah Dihapus' }]);
assert.equal(cocokkanSupplier('apa saja', master, hantu).keadaan, 'tak-dikenal');
ok('pemetaan ke nama yang sudah lenyap dari daftar induk TIDAK dianggap sah');

assert.equal(supplierSiap({ keadaan: 'daftar' }), true);
assert.equal(supplierSiap({ keadaan: 'dipetakan' }), true);
assert.equal(supplierSiap({ keadaan: 'tak-dikenal' }), false);
assert.equal(supplierSiap({ keadaan: 'kosong' }), false);
assert.equal(supplierSiap(null), false);
ok('hanya "daftar" dan "dipetakan" yang boleh berangkat');

console.log('\n§4 Ekspor Purchase');

assert.ok(JENIS_PETA.includes('supplier'));
ok('supplier jadi jenis pemetaan ke-7');

const petaLengkap = buatPeta([
  { jenis: 'branch', kunci: 'AB Sentul', nilai: 'AB SENTUL' },
  { jenis: 'location', kunci: 'AB Sentul', nilai: 'GUDANG SENTUL' },
  { jenis: 'payment_method', kunci: 'kas', nilai: 'CASH' },
  { jenis: 'coa', kunci: 'kas', nilai: '1101' },
  { jenis: 'item', kunci: 'Beras', nilai: 'BERAS PREMIUM' },
  { jenis: 'unit', kunci: 'gr', nilai: 'GRAM' },
  { jenis: 'supplier', kunci: 'toko beras rido', nilai: 'Toko Beras Ridho' }
]);
const iSup = KOLOM_ESB.indexOf('Supplier');
assert.equal(iSup, 1, 'kolom Supplier pindah — tes ini menguji kolom yang salah');

const nota = (sup) => ({
  id: 'n1',
  code: 'TRM-001',
  receipt_date: '2026-09-01',
  supplier: sup,
  outlet_name: 'AB Sentul',
  payment_status: 'lunas',
  payment_source: 'outlet'
});
const items = new Map([['n1', [{ product_name: 'Beras', base_unit: 'gr', qty: 100, unit_cost: 36 }]]]);
const jalankan = (sup, opsi = {}) =>
  barisEsbPurchase({ notas: [nota(sup)], itemsPerNota: items, peta: petaLengkap, masterSupplier: master, ...opsi });

const h1 = jalankan('Pasar');
assert.equal(h1.baris.length, 1);
assert.equal(h1.baris[0][iSup], 'Pasar');
ok('supplier yang ada di daftar berangkat');

// INI inti perubahannya: yang dikirim nama DAFTARNYA, bukan yang diketik.
const h2 = jalankan('  pasar  ');
assert.equal(h2.baris[0][iSup], 'Pasar');
assert.notEqual(h2.baris[0][iSup], '  pasar  ');
ok('ejaan yang diketik diganti nama kanonik ESB — bukan dikirim apa adanya');

const h3 = jalankan('toko beras rido');
assert.equal(h3.baris[0][iSup], 'Toko Beras Ridho');
ok('ejaan lama yang sudah dipetakan berangkat sebagai nama ESB-nya');

const h4 = jalankan('Toko Sebelah');
assert.equal(h4.baris.length, 0, 'nota bersupplier tak dikenal seharusnya TERTAHAN');
assert.deepEqual(h4.notaIds, []);
assert.ok(
  h4.kurang.some((k) => k.jenis === 'supplier' && k.nilai === 'Toko Sebelah' && k.nota.includes('TRM-001')),
  'alasannya harus terbaca, lengkap dengan nama supplier & kode notanya'
);
ok('supplier tak dikenal MENAHAN notanya, dan alasannya menyebut namanya');

const h5 = jalankan('');
assert.equal(h5.baris.length, 0);
assert.ok(h5.kurang.some((k) => k.jenis === 'supplier' && k.nilai === '(kosong)'));
ok('supplier kosong juga menahan, dan ditandai "(kosong)"');

// BU yang belum pernah mengimpor daftar supplier TIDAK boleh mendadak
// kehilangan seluruh notanya karena aturan yang baru dinyalakan.
const h6 = barisEsbPurchase({ notas: [nota('Toko Apa Saja')], itemsPerNota: items, peta: petaLengkap });
assert.equal(h6.baris.length, 1);
assert.equal(h6.baris[0][iSup], 'Toko Apa Saja');
assert.equal(h6.kurang.filter((k) => k.jenis === 'supplier').length, 0);
ok('daftar induk kosong: pemeriksaannya DILEWATI, nota lama tetap berangkat');

const h7 = barisEsbPurchase({ notas: [nota('Pasar')], itemsPerNota: items, peta: petaLengkap, masterSupplier: new Map() });
assert.equal(h7.baris.length, 1);
ok('peta kosong eksplisit diperlakukan sama — bukan "semua tak dikenal"');

console.log('\n§5 Spasi ganda di kunci pemetaan');

// `buatPeta` dan `cocokkanSupplier` HARUS memakai aturan normalisasi yang sama.
// Dulu yang pertama cuma trim+lowercase sementara yang kedua juga merapikan
// spasi ganda — "AB  Sentul" hasil salin-tempel cocok di satu jalur, tidak di
// jalur lain, dan tidak ada layar yang bisa menunjukkan bedanya.
const petaSpasi = buatPeta([{ jenis: 'supplier', kunci: 'Toko  Dua  Spasi', nilai: 'Toko Beras Ridho' }]);
assert.equal(cocokkanSupplier('Toko Dua Spasi', master, petaSpasi.supplier).nama, 'Toko Beras Ridho');
ok('kunci pemetaan bersespasi ganda tetap ketemu — satu aturan normalisasi, bukan dua');

console.log('\n§6 Daftar yang perlu dibereskan');

const terpakai = [
  { nama: 'Pasar', jumlah: 50, belum_ekspor: 0 },
  { nama: 'Toko Sebelah', jumlah: 3, belum_ekspor: 3 },
  { nama: 'Warung Ujung', jumlah: 40, belum_ekspor: 0 },
  { nama: 'Kios Baru', jumlah: 1, belum_ekspor: 1 },
  { nama: 'toko beras rido', jumlah: 9, belum_ekspor: 9 },
  { nama: '   ', jumlah: 2, belum_ekspor: 2 }
];
const perlu = supplierPerluDibereskan(terpakai, master, ejaan);
assert.deepEqual(perlu.map((t) => t.nama), ['Toko Sebelah', 'Kios Baru', 'Warung Ujung']);
ok('yang sudah cocok & yang sudah dipetakan dibuang; nama kosong tidak ikut');

// Yang punya nota BELUM DIEKSPOR didahulukan — cuma itu yang menghambat.
// "Warung Ujung" punya 40 nota tapi semuanya sudah berangkat: itu kerapian,
// bukan penghalang, jadi ia turun di bawah "Kios Baru" yang cuma 1 nota.
assert.equal(perlu[0].nama, 'Toko Sebelah');
assert.equal(perlu[perlu.length - 1].nama, 'Warung Ujung');
ok('diurut menurut yang benar-benar menghambat, bukan menurut jumlah notanya');

assert.deepEqual(supplierPerluDibereskan(null, master), []);
assert.deepEqual(supplierPerluDibereskan([], master), []);
ok('masukan kosong tidak melempar');

assert.match(PESAN_DI_LUAR_DAFTAR, /tetap tersimpan/);
assert.match(PESAN_DI_LUAR_DAFTAR, /admin BU/);
ok('pesan ke staff menyebut notanya tetap tersimpan, dan siapa yang melanjutkan');

console.log(`\n${n} pemeriksaan supplier lolos. ✅`);
