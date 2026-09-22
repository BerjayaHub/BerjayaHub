/**
 * TES: ekspor kas keluar ke template ESB Disbursement.
 *
 * ============ YANG DIJAGA BERKAS INI ============
 *
 *   §1 Bentuk templatenya — 18 kolom, urutannya, Sequence & Document Date
 *      sebagai TEKS.
 *   §2 `Document Date` berupa teks dd/mm/yyyy — KEBALIKAN dari Simple
 *      Purchase, dan itu diperiksa di templatenya sendiri.
 *   §3 Kepala & rincian sama nilainya, dan Sequence tidak bocor.
 *   §4 Yang belum dipetakan menahan barisnya SENDIRI — bukan seluruh berkas.
 *   §5 Payment To memakai aturan yang sama persis dengan nota.
 *   §6 Amount: besarnya, bukan tandanya; empat desimal.
 *   §7 Masukan aneh tidak melempar.
 */
import assert from 'node:assert/strict';
import {
  KOLOM_DISBURSEMENT,
  MATA_UANG,
  RATE_IDR,
  barisEsbDisbursement,
  ringkasDisbursement
} from '../js/modules/inventory/esb-disbursement.js';
import { buatPeta } from '../js/modules/inventory/esb-purchase.js';
import { petaSupplier } from '../js/modules/inventory/cocok-supplier.js';
import { DESIMAL_ESB_MAKS } from '../js/modules/inventory/desimal-esb.js';

let n = 0;
const ok = (nama) => {
  n += 1;
  console.log(`  ✔ ${nama}`);
};

// Indeks kolom DITURUNKAN dari daftarnya — 18 kolom terlalu banyak untuk
// dihitung dengan jari, dan salah hitung satu membuat tes ini memeriksa sel
// yang salah sambil tetap hijau.
const K = Object.fromEntries(KOLOM_DISBURSEMENT.map((k, i) => [k, i]));

const PETA = buatPeta([
  { jenis: 'branch', kunci: 'AB Gading Serpong', nilai: 'Awal Bermula Serpong' },
  // COA = SUMBER DANA, dipetakan dari outlet MILIK KANTONG (0151) — bukan dari
  // kategori biaya. Kuncinya sengaja dipilih outlet yang BERBEDA dari outlet
  // peruntukan di atas, supaya tes ini tidak bisa lolos dengan membaca Branch.
  { jenis: 'coa', kunci: 'AB Alam Sutera', nilai: '1 1 02 01' },
  // Cara bayar 'pusat' sudah punya barisnya sendiri di pemetaan COANo sejak
  // lama — entri DIBAYAR PUSAT (0153) memakai kunci itu.
  { jenis: 'coa', kunci: 'pusat', nilai: '1 1 02 00' },
  { jenis: 'payment_method', kunci: 'kas', nilai: 'CASH' }
]);
const MASTER = petaSupplier([
  { jenis: 'supplier', nama: 'Pasar', kode: 'CK01' },
  { jenis: 'supplier', nama: 'AICE', kode: 'CK19' }
]);

const kas = (o = {}) => ({
  id: o.id ?? 'k1',
  kode: o.kode ?? 'KAS-001',
  entry_date: o.entry_date ?? '2026-09-10',
  // Kas keluar disimpan BERTANDA NEGATIF (0026).
  amount: o.amount ?? -120000,
  notes: o.notes ?? 'Bensin motor operasional',
  supplier: o.supplier ?? 'Pasar',
  outlet_nama: o.outlet_nama ?? 'AB Gading Serpong',
  kategori_nama: o.kategori_nama ?? 'Bensin',
  // Kantongnya milik outlet LAIN — uangnya keluar dari kas Alam Sutera dan
  // dibelanjakan untuk Gading Serpong. Persis keadaan yang membuat
  // `outlet_nama` tidak boleh dipakai sebagai COA.
  kantong_nama: o.kantong_nama ?? 'Kas Operasional',
  kantong_outlet_nama: o.kantong_outlet_nama ?? 'AB Alam Sutera',
  dibayar_pusat: o.dibayar_pusat ?? false
});

const susun = (daftar, extra = {}) =>
  barisEsbDisbursement({ kas: daftar, peta: PETA, masterSupplier: MASTER, ...extra });

console.log('§1 Bentuk templatenya');

assert.equal(KOLOM_DISBURSEMENT.length, 18);
assert.deepEqual(KOLOM_DISBURSEMENT.slice(0, 5), [
  'Sequence',
  'Payment To',
  'Supplier Bank Account Number',
  'Document Date',
  'Branch'
]);
assert.deepEqual(KOLOM_DISBURSEMENT.slice(-5), [
  'Branch Detail',
  'Account Detail',
  'Amount',
  'Description',
  'Additional Information'
]);
ok('18 kolom, nama & urutannya persis seperti templatenya');

const satu = susun([kas()]);
assert.equal(satu.baris.length, 1);
const b = satu.baris[0];

// Sel `Sequence` di templatenya bertipe `s` berformat '@' — teks, bukan angka.
assert.strictEqual(b[K['Sequence']], '1');
ok('Sequence berupa teks, mengikuti templatenya');

assert.equal(b[K['Currency']], MATA_UANG);
assert.equal(b[K['Rate']], RATE_IDR);
assert.equal(MATA_UANG, 'IDR');
assert.equal(RATE_IDR, 1);
ok('Currency & Rate dipatok IDR / 1');

// Yang tidak punya padanan DIKOSONGKAN, bukan dikarang.
for (const kolom of ['Supplier Bank Account Number', 'Cost Center', 'Project', 'Credit Terms', 'Supplier Invoice Number']) {
  assert.strictEqual(b[K[kolom]], '', `${kolom} tidak dikosongkan`);
}
ok('lima kolom yang tidak punya padanan dikosongkan, tidak dikarang');

console.log('\n§2 Document Date berupa TEKS dd/mm/yyyy');

// KEBALIKAN dari Simple Purchase, dan itu diperiksa di templatenya sendiri:
// D2 bertipe `s` berformat '@'. Menyeragamkan keduanya "supaya rapi" berarti
// menebak, dan berkas yang ditolak ESB bernilai nol rupiah.
assert.strictEqual(b[K['Document Date']], '10/09/2026');
assert.equal(typeof b[K['Document Date']], 'string');
ok('INTI: tanggalnya teks "10/09/2026", bukan nomor seri Excel');

// Tanggal yang gagal dibaca MENAHAN barisnya. Sel Document Date yang kosong
// akan diisi tanggal unggah oleh ESB, dan pengeluaran bulan lalu masuk sebagai
// pengeluaran hari ini — ke bulan yang sudah ditutup.
// Nilainya ditimpa SESUDAH objeknya jadi, bukan lewat argumen pembantunya:
// `o.entry_date ?? '2026-09-10'` akan mengembalikan tanggal yang sah untuk
// `null` dan `undefined`, dan pemeriksaannya lolos tanpa menguji apa pun.
for (const buruk of ['10/09/2026', '', null, undefined, '2026-02-30', 'kemarin']) {
  const c = kas();
  c.entry_date = buruk;
  const r = susun([c]);
  assert.equal(r.baris.length, 0, `tanggal ${JSON.stringify(buruk)} lolos`);
  assert.ok(r.kurang.some((x) => x.jenis === 'tanggal-kas'));
}
ok('tanggal yang tidak terbaca menahan barisnya — termasuk 30 Februari');

console.log('\n§3 Kepala & rincian, dan Sequence');

assert.equal(b[K['Branch']], 'Awal Bermula Serpong');
assert.equal(b[K['Branch Detail']], b[K['Branch']]);
assert.equal(b[K['Account']], '1 1 02 01');
assert.equal(b[K['Account Detail']], b[K['Account']]);
ok('kepala & rincian sama nilainya — satu entri kas, satu dokumen satu baris');

assert.equal(b[K['Payment Method']], 'CASH');
assert.equal(b[K['Description']], 'Bensin motor operasional');
assert.equal(b[K['Additional Information']], 'KAS-001');
ok('Payment Method, Description, dan Additional Information terisi');

// Sequence tidak boleh melompat saat sebuah entri tertahan: lompatan itu tidak
// salah bagi ESB, tapi yang mencocokkannya mengira ada dokumen yang hilang.
const tigaSatuTertahan = susun([
  kas({ id: 'a', kode: 'K-A' }),
  kas({ id: 'b', kode: 'K-B', kantong_outlet_nama: 'Outlet Tidak Dipetakan' }),
  kas({ id: 'c', kode: 'K-C' })
]);
assert.deepEqual(tigaSatuTertahan.kasIds, ['a', 'c']);
assert.deepEqual(tigaSatuTertahan.baris.map((x) => x[K['Sequence']]), ['1', '2']);
ok('INTI: entri yang tertahan tidak meninggalkan lubang di Sequence');

console.log('\n§4 Yang tertahan hanya dirinya sendiri');

// BERBEDA dari nota: baris satu nota adalah SATU dokumen, jadi satu baris
// bermasalah menahan seluruhnya. Tiap kas keluar berdiri sendiri — menahan
// yang lain karenanya akan menunda pekerjaan yang sudah benar.
assert.equal(tigaSatuTertahan.baris.length, 2);
ok('satu entri bermasalah tidak menahan entri lain');

const branchKurang = susun([kas({ outlet_nama: 'Outlet Baru' })]);
assert.equal(branchKurang.baris.length, 0);
assert.ok(branchKurang.kurang.some((x) => x.jenis === 'branch' && x.nilai === 'Outlet Baru'));
ok('outlet yang belum dipetakan menahan barisnya');

// KANTONG TANPA OUTLET tidak punya apa pun untuk dipetakan — dan itu
// dikatakan lewat alasannya sendiri, bukan berangkat dengan sel Account kosong
// yang diterima ESB sebagai akun bawaan, dan bukan pula jatuh ke Branch.
//
// Nilainya ditimpa SESUDAH objeknya jadi: `o.x ?? 'default'` mengembalikan
// nilai bawaan untuk `null` DAN `undefined`, jadi lewat argumen pembantunya
// kedua keadaan ini tidak akan pernah benar-benar teruji.
for (const kosong of ['', null, undefined, '   ']) {
  const tk = kas();
  tk.kantong_outlet_nama = kosong;
  const tanpaKantong = susun([tk]);
  assert.equal(tanpaKantong.baris.length, 0, `kantong ${JSON.stringify(kosong)} tidak menahan barisnya`);
  // Alasannya menyebut KANTONGNYA, bukan "(kosong)" — yang membacanya perlu
  // tahu kantong mana yang harus ditempeli outlet.
  assert.ok(tanpaKantong.kurang.some((x) => x.jenis === 'kantong' && x.nilai === 'Kas Operasional'));
  // Dan TIDAK boleh tertahan sebagai 'coa': itu alasan yang menunjuk ke layar
  // pemetaan, tempat pekerjaan ini tidak bisa diselesaikan.
  assert.ok(!tanpaKantong.kurang.some((x) => x.jenis === 'coa'));
}
ok('INTI: kantong tanpa outlet menahan barisnya, dan alasannya menyebut nama kantongnya');

// Yang PALING berbahaya: COA jatuh ke outlet peruntukan. Berkasnya akan
// diterima ESB dengan tenang dan mendarat di akun kas yang bukan sumbernya.
const petaBranchSajaCoa = buatPeta([
  { jenis: 'branch', kunci: 'AB Gading Serpong', nilai: 'Awal Bermula Serpong' },
  { jenis: 'coa', kunci: 'AB Gading Serpong', nilai: '9 9 99 99' },
  { jenis: 'payment_method', kunci: 'kas', nilai: 'CASH' }
]);
const jatuhKeBranch = barisEsbDisbursement({ kas: [kas()], peta: petaBranchSajaCoa, masterSupplier: MASTER });
assert.equal(jatuhKeBranch.baris.length, 0);
assert.ok(jatuhKeBranch.kurang.some((x) => x.jenis === 'coa' && x.nilai === 'AB Alam Sutera'));
ok('INTI: COA tidak jatuh ke outlet peruntukan walau outlet itu SUDAH punya padanan COA');

// Kategori biaya tidak lagi menentukan apa pun — entri tanpa kategori tetap
// berangkat. Kalau tes ini merah, COA kembali dibaca dari kategori.
const tanpaKategori = kas();
tanpaKategori.kategori_nama = null;
const kategoriTakRelevan = susun([tanpaKategori]);
assert.equal(kategoriTakRelevan.baris.length, 1);
assert.equal(kategoriTakRelevan.baris[0][K['Account']], '1 1 02 01');
ok('INTI: kategori biaya tidak lagi menentukan Account — entri tanpa kategori tetap berangkat');

const tanpaBayar = barisEsbDisbursement({
  kas: [kas()],
  peta: buatPeta([
    { jenis: 'branch', kunci: 'AB Gading Serpong', nilai: 'Awal Bermula Serpong' },
    { jenis: 'coa', kunci: 'AB Alam Sutera', nilai: '1 1 02 01' }
  ]),
  masterSupplier: MASTER
});
assert.equal(tanpaBayar.baris.length, 0);
assert.ok(tanpaBayar.kurang.some((x) => x.jenis === 'payment_method'));
ok('cara bayar yang belum dipetakan menahan barisnya');

// ============ DIBAYAR PUSAT (0153) ============
//
// Uangnya tidak keluar dari kantong mana pun, dan itu BUKAN kekurangan yang
// perlu dibereskan. Tanpa cabang ini ia tertahan dengan alasan "kantongnya
// belum punya outlet" — untuk pengeluaran yang memang sengaja tidak punya
// kantong, dan yang tidak bisa dibereskan di layar mana pun.
const pusat = kas({ id: 'p', kode: 'K-P', dibayar_pusat: true, kantong_nama: 'Pusat' });
pusat.kantong_outlet_nama = '';
const hasilPusat = susun([pusat]);
assert.equal(hasilPusat.baris.length, 1);
assert.equal(hasilPusat.baris[0][K['Account']], '1 1 02 00');
assert.equal(hasilPusat.baris[0][K['Account Detail']], '1 1 02 00');
ok('INTI: entri DIBAYAR PUSAT berangkat dengan COA `pusat`, walau tanpa kantong');

// Dan Branch-nya TETAP outlet peruntukan — yang berubah cuma akunnya.
assert.equal(hasilPusat.baris[0][K['Branch']], 'Awal Bermula Serpong');
ok('Branch entri Pusat tetap outlet peruntukannya');

// Kalau 'pusat' belum dipetakan, ia tertahan sebagai `coa` bernama "pusat" —
// bukan sebagai "kantong", yang akan menyuruh orang menempeli outlet pada
// kantong yang memang tidak ada.
const tanpaPetaPusat = barisEsbDisbursement({
  kas: [pusat],
  peta: buatPeta([
    { jenis: 'branch', kunci: 'AB Gading Serpong', nilai: 'Awal Bermula Serpong' },
    { jenis: 'payment_method', kunci: 'kas', nilai: 'CASH' }
  ]),
  masterSupplier: MASTER
});
assert.equal(tanpaPetaPusat.baris.length, 0);
assert.ok(tanpaPetaPusat.kurang.some((x) => x.jenis === 'coa' && x.nilai === 'pusat'));
assert.ok(!tanpaPetaPusat.kurang.some((x) => x.jenis === 'kantong'));
ok('INTI: `pusat` yang belum dipetakan tertahan sebagai COA, bukan sebagai kantong');

console.log('\n§5 Payment To — aturan yang sama dengan nota');

const tidakDikenal = susun([kas({ supplier: 'Warung Ujung' })]);
assert.equal(tidakDikenal.baris.length, 0);
assert.ok(tidakDikenal.kurang.some((x) => x.jenis === 'supplier' && x.nilai === 'Warung Ujung'));
ok('supplier di luar daftar induk menahan barisnya');

// Yang berangkat nama KANONIK dari daftarnya, bukan yang diketik.
const bedaEjaan = susun([kas({ supplier: '  aice ' })]);
assert.equal(bedaEjaan.baris[0][K['Payment To']], 'AICE');
ok('INTI: yang berangkat ejaan kanonik dari daftarnya, bukan yang diketik');

// DAFTAR INDUK KOSONG: pemeriksaannya dilewati, sama persis dengan nota. BU
// yang belum sempat mengimpornya tidak boleh mendadak kehilangan ekspornya.
const tanpaMaster = barisEsbDisbursement({ kas: [kas({ supplier: 'Warung Ujung' })], peta: PETA });
assert.equal(tanpaMaster.baris.length, 1);
assert.equal(tanpaMaster.baris[0][K['Payment To']], 'Warung Ujung');
ok('INTI: tanpa daftar induk, namanya berangkat apa adanya — aturan yang sama dengan nota');

// ...tapi KOSONG tetap ditahan, dengan atau tanpa daftar induk: Payment To
// terisi di keempat baris contoh templatenya.
for (const m of [MASTER, new Map()]) {
  const c = kas();
  c.supplier = '';
  const r = barisEsbDisbursement({ kas: [c], peta: PETA, masterSupplier: m });
  assert.equal(r.baris.length, 0, 'supplier kosong lolos');
  assert.ok(r.kurang.some((x) => x.jenis === 'supplier'));
}
ok('Payment To yang kosong ditahan, dengan maupun tanpa daftar induk');

console.log('\n§6 Amount');

assert.equal(b[K['Amount']], 120000);
ok('yang dikirim BESARNYA, bukan tandanya — kas keluar tersimpan negatif');

// Empat desimal, aturan yang sama dengan ketiga dokumen lain.
const desimal = (v) => (String(v).includes('.') ? String(v).split('.')[1].length : 0);
const panjang = susun([kas({ amount: -8270.724851 })]);
assert.equal(panjang.baris[0][K['Amount']], 8270.7249);
assert.ok(desimal(panjang.baris[0][K['Amount']]) <= DESIMAL_ESB_MAKS);
ok('Amount dibulatkan ke 4 desimal — aturan yang sama dengan tiga dokumen lain');

// Nol & nilai yang tidak terbaca ditahan: dokumen pengeluaran senilai nol
// rupiah tidak menyatakan apa pun, dan ESB menerimanya tanpa keluhan.
for (const buruk of [0, null, '', undefined, 'sepuluh ribu']) {
  const c = kas();
  c.amount = buruk;
  const r = susun([c]);
  assert.equal(r.baris.length, 0, `amount ${JSON.stringify(buruk)} lolos`);
  assert.ok(r.kurang.some((x) => x.jenis === 'jumlah-kas'));
}
ok('nominal nol atau tidak terbaca menahan barisnya');

console.log('\n§7 Ringkasan & masukan aneh');

const r7 = ringkasDisbursement(tigaSatuTertahan, 3);
assert.equal(r7.siap, 2);
assert.equal(r7.tertahan, 1);
assert.equal(r7.baris, 2);
assert.ok(r7.kurang >= 1);
ok('siap, tertahan, jumlah baris & alasan dihitung apa adanya');

assert.equal(ringkasDisbursement(tigaSatuTertahan, 1).tertahan, 0);
ok('tertahan tidak pernah negatif');

assert.deepEqual(susun(null).baris, []);
assert.deepEqual(susun([]).baris, []);
assert.deepEqual(barisEsbDisbursement({ kas: [kas()], peta: {} }).baris, []);
assert.doesNotThrow(() => barisEsbDisbursement({}));
ok('masukan kosong & peta kosong tidak melempar');

console.log(`\n${n} pemeriksaan ESB Disbursement lolos. ✅`);
