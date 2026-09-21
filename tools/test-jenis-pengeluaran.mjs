/**
 * TES: saringan bahan / selain bahan di Mutasi Kas.
 *
 * ============ YANG DIJAGA ============
 *
 * Aturan yang SAMA dipakai dua tempat: saringan di layar, dan `kas_untuk_esb`
 * (0150) yang menyusun berkas Disbursement. Kalau keduanya menyimpang, layar
 * berkata "3 pengeluaran selain bahan" sementara ekspornya mengirim 2 — dan
 * tidak ada satu pun layar yang bisa menjelaskan yang ketiga ke mana.
 *
 * Dua penanda yang menentukan, keduanya dijaga CONSTRAINT TRIGGER di database
 * (0122/0131) sehingga tidak bisa dikarang dari klien:
 *
 *   `untuk_nota`       entri ini MEMBAYAR nota penerimaan barang
 *   `penyesuaian_nota` entri ini KOREKSI dari nota
 */
import assert from 'node:assert/strict';
import {
  SARING_PENGELUARAN,
  LABEL_PENGELUARAN,
  KOLOM_DIBUTUHKAN,
  lengkap,
  untukBahan,
  selainBahan,
  saringPengeluaran,
  ringkasPengeluaran
} from '../js/modules/cash/jenis-pengeluaran.js';
import { kodeKas, cocokKodeKas, AWALAN_KAS } from '../js/modules/cash/kode-kas.js';

let n = 0;
const ok = (nama) => {
  n += 1;
  console.log(`  ✔ ${nama}`);
};

const e = (o = {}) => ({
  id: o.id ?? 'x',
  entry_type: o.entry_type ?? 'out',
  amount: o.amount ?? -30000,
  untuk_nota: o.untuk_nota ?? false,
  penyesuaian_nota: o.penyesuaian_nota ?? null,
  dicoret_at: o.dicoret_at ?? null,
  notes: o.notes ?? 'gojek makanan'
});

const TRANSPORT = e({ id: 'a' });
const BAYAR_NOTA = e({ id: 'b', untuk_nota: true, amount: -23000, notes: 'Pembayaran nota' });
const PENYESUAIAN = e({ id: 'c', penyesuaian_nota: 'nota-1', amount: -5000 });
const MASUK = e({ id: 'd', entry_type: 'in', amount: 158600 });
const TRANSFER = e({ id: 'f', entry_type: 'transfer_out', amount: -50000 });
const DICORET = e({ id: 'g', dicoret_at: '2026-09-20T00:00:00Z', amount: -99000 });

const SEMUA = [TRANSPORT, BAYAR_NOTA, PENYESUAIAN, MASUK, TRANSFER, DICORET];

console.log('§1 Apa yang membuat sebuah pengeluaran "untuk bahan"');

assert.equal(untukBahan(BAYAR_NOTA), true);
assert.equal(untukBahan(PENYESUAIAN), true);
ok('pembayaran nota & penyesuaiannya: untuk bahan');

assert.equal(untukBahan(TRANSPORT), false);
assert.equal(selainBahan(TRANSPORT), true);
ok('kas keluar biasa: selain bahan');

// Kas MASUK dan transfer bukan pengeluaran sama sekali — keduanya `false` di
// KEDUA fungsi. Kalau `selainBahan` cuma `!untukBahan`, kas masuk akan ikut
// terhitung sebagai "pengeluaran selain bahan", dan angkanya membesar tanpa
// ada pengeluaran yang bertambah.
for (const x of [MASUK, TRANSFER]) {
  assert.equal(untukBahan(x), false);
  assert.equal(selainBahan(x), false, `${x.entry_type} terhitung sebagai pengeluaran`);
}
ok('INTI: kas masuk & transfer bukan pengeluaran — false di KEDUA fungsi');

// Entri yang DICORET tetap terhitung jenisnya. Layar Mutasi Kas memang
// menampilkannya (dengan coretan); menyembunyikannya di balik saringan jenis
// akan membuatnya lenyap tanpa sebab yang terlihat.
assert.equal(selainBahan(DICORET), true);
ok('yang dicoret tetap punya jenis — ia masih ditampilkan, dengan coretannya');

assert.equal(untukBahan(null), false);
assert.equal(selainBahan(undefined), false);
assert.equal(untukBahan({}), false);
ok('masukan aneh tidak melempar');

// `penyesuaian_nota` yang `undefined` (kolomnya tidak ikut diambil) BUKAN
// berarti "ada penyesuaiannya".
assert.equal(untukBahan({ entry_type: 'out', untuk_nota: false, penyesuaian_nota: undefined }), false);
ok('kolom yang tidak ikut diambil tidak dibaca sebagai "ada isinya"');

console.log('\n§2 Menyaring');

assert.deepEqual(saringPengeluaran(SEMUA, SARING_PENGELUARAN.BAHAN).map((x) => x.id), ['b', 'c']);
ok('saringan BAHAN menyisakan pembayaran nota & penyesuaiannya');

assert.deepEqual(saringPengeluaran(SEMUA, SARING_PENGELUARAN.NON_BAHAN).map((x) => x.id), ['a', 'g']);
ok('saringan SELAIN BAHAN menyisakan kas keluar biasa — kas masuk & transfer tidak ikut');

assert.equal(saringPengeluaran(SEMUA, SARING_PENGELUARAN.SEMUA).length, SEMUA.length);
ok('"Semua jenis" tidak menyaring apa pun');

// Nilai yang tidak dikenal TIDAK mengosongkan daftarnya. Daftar kosong karena
// salah ketik nilai saringan terlihat persis seperti "memang tidak ada
// datanya" — bentuk kegagalan yang paling sering dikejar di repo ini.
assert.equal(saringPengeluaran(SEMUA, 'ngawur').length, SEMUA.length);
assert.equal(saringPengeluaran(SEMUA, null).length, SEMUA.length);
ok('INTI: nilai saringan yang tidak dikenal tidak mengosongkan daftarnya');

assert.deepEqual(saringPengeluaran(null, SARING_PENGELUARAN.BAHAN), []);
ok('daftar kosong tidak melempar');

console.log('\n§3 Ringkasan di sebelah saringannya');

const r = ringkasPengeluaran(SEMUA);
assert.equal(r.bahan, 2);
assert.equal(r.nonBahan, 2);
ok('jumlah per jenis dihitung apa adanya');

assert.equal(r.totalBahan, 28000);
ok('total bahan = 23.000 + 5.000');

// Yang DICORET tidak ikut dijumlahkan: uangnya sudah dinyatakan tidak pernah
// keluar, dan menjumlahkannya membuat totalnya tidak cocok dengan saldo mana
// pun. Ia tetap DIHITUNG barisnya — supaya angkanya cocok dengan tabel yang
// terlihat.
assert.equal(r.totalNonBahan, 30000);
ok('INTI: yang dicoret ikut dihitung barisnya, tidak ikut dijumlahkan uangnya');

assert.deepEqual(ringkasPengeluaran([]), { bahan: 0, nonBahan: 0, totalBahan: 0, totalNonBahan: 0 });
assert.equal(ringkasPengeluaran(null).bahan, 0);
ok('daftar kosong menghasilkan nol, bukan NaN');

// `Number(null)` dan `Number('')` adalah 0, bukan NaN — nominal yang tidak
// terbaca tidak boleh membuat seluruh totalnya jadi NaN.
// Nilainya ditimpa SESUDAH objeknya jadi: `o.amount ?? -30000` di pembantu di
// atas akan mengembalikan nominal yang sah untuk `null`, dan pemeriksaannya
// lolos tanpa menguji apa pun. Jebakan `??` yang sama sudah beberapa kali
// menggigit di sesi ini.
const anehA = e();
anehA.amount = null;
const anehB = e();
anehB.amount = 'sepuluh';
const aneh = ringkasPengeluaran([anehA, anehB]);
assert.equal(Number.isFinite(aneh.totalNonBahan), true);
assert.equal(aneh.totalNonBahan, 0);
ok('nominal yang tidak terbaca tidak menular jadi NaN');

console.log('\n§4 Kolom yang harus ikut diambil');

// ============ BUG YANG SUNGGUH TERJADI ============
//
// `untuk_nota` tidak ikut di `select` milik `listCashEntriesAdmin`. Akibatnya
// `untukBahan()` selalu false, dan layar berbunyi "0 untuk bahan · 35 selain
// bahan" — sambil menampilkan tautan "Pembayaran nota TRM-…" di kolom
// sebelahnya. Layar yang membantah dirinya sendiri, tanpa satu pun galat.
const tanpaKolom = { entry_type: 'out', penyesuaian_nota: null, amount: -23000, dicoret_at: null };
assert.equal(untukBahan(tanpaKolom), false);
assert.equal(lengkap(tanpaKolom), false, 'baris yang kehilangan kolom terbaca sebagai lengkap');
ok('INTI: baris tanpa `untuk_nota` terbaca TIDAK LENGKAP — bukan "bukan pembayaran nota"');

assert.equal(lengkap(BAYAR_NOTA), true);
assert.equal(lengkap(null), false);
ok('baris yang lengkap dikenali lengkap');

// Daftarnya yang dipatok audit ke `select` query-nya. Kalau ada yang hilang
// dari sini, penjagaan itu ikut hilang tanpa ada yang menyadarinya.
for (const k of ['entry_type', 'untuk_nota', 'penyesuaian_nota', 'amount', 'dicoret_at']) {
  assert.ok(KOLOM_DIBUTUHKAN.includes(k), `kolom "${k}" hilang dari KOLOM_DIBUTUHKAN`);
}
ok('kelima kolom yang menentukan terdaftar — auditnya memaksa query-nya memuatnya');

console.log('\n§5 Nomor kas');

assert.equal(kodeKas('7e9cf9f2-1234-5678-9abc-def012345678'), 'KAS-7E9CF9F2');
ok('nomornya sama dengan yang tampil di layar ekspor');

// String kosong, BUKAN "KAS-" — yang terakhir terlihat seperti nomor sungguhan
// yang rusak, dan orang akan mencarinya.
assert.equal(kodeKas(''), '');
assert.equal(kodeKas(null), '');
assert.equal(kodeKas(undefined), '');
ok('id kosong menghasilkan kosong, bukan "KAS-"');

assert.equal(AWALAN_KAS, 'KAS-');
ok('awalannya dipisahkan dari TRM- (nota) dan WST- (waste)');

const ID = '7e9cf9f2-1234-5678-9abc-def012345678';
assert.equal(cocokKodeKas(ID, 'KAS-7E9CF9F2'), true);
assert.equal(cocokKodeKas(ID, '7e9cf9f2'), true);
assert.equal(cocokKodeKas(ID, '7E9C'), true);
ok('INTI: nomor lengkap, tanpa awalan, dan sebagiannya sama-sama ketemu');

assert.equal(cocokKodeKas(ID, 'A0122F50'), false);
ok('nomor lain tidak ikut ketemu');

// Kata kosong TIDAK menyaring apa pun. Kebalikannya membuat tabelnya kosong
// begitu kotak pencariannya digambar, sebelum satu huruf pun diketik.
assert.equal(cocokKodeKas(ID, ''), true);
assert.equal(cocokKodeKas(ID, '   '), true);
ok('kotak cari yang kosong tidak menyaring apa pun');

console.log('\n§6 Labelnya');

assert.equal(Object.keys(LABEL_PENGELUARAN).length, 3);
for (const v of Object.values(SARING_PENGELUARAN)) {
  assert.ok(LABEL_PENGELUARAN[v], `nilai "${v}" tidak punya label`);
}
ok('ketiga pilihan punya label — tidak ada nilai yang tampil sebagai kode mentah');

assert.match(LABEL_PENGELUARAN[SARING_PENGELUARAN.NON_BAHAN], /Disbursement/);
ok('label "selain bahan" menyebut Disbursement — nama yang dipakai di layar ekspor');

console.log(`\n${n} pemeriksaan jenis pengeluaran lolos. ✅`);
