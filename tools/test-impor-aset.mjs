/**
 * TES: impor Inventaris Aset dari Excel, berikut foto tertanamnya.
 *
 * ============ DIUJI TERHADAP BERKAS .xlsx SUNGGUHAN ============
 *
 * `tools/fixtures/contoh-impor-aset.xlsx` adalah berkas Excel asli dengan tiga
 * gambar tertanam. Yang paling ingin dibuktikan berkas ini cuma satu hal:
 * **baris jangkar gambar sejalan dengan indeks baris datanya**.
 *
 * Angka itu datang dari bentuk .xlsx, bukan dari kode Berjaya Hub. Fixture
 * yang ditulis tangan sebagai JSON akan memantulkan kembali anggapan yang
 * sedang diuji — kalau saya salah mengira jangkarnya 1-based, fixture-nya pun
 * saya tulis 1-based, dan tesnya hijau untuk kode yang salah.
 *
 *   §1 Berkas sungguhan: jangkar 0-based, sejalan dengan `aoa`.
 *   §2 Header dicari lewat JUDUL, bukan nomor baris.
 *   §3 Baris ber-ID diperbarui, tanpa ID jadi baru.
 *   §4 Sel kosong = "jangan diapa-apakan", BUKAN "hapus".
 *   §5 Yang ditolak, dan alasannya terbaca.
 *   §6 Foto melayang & ganda DILAPORKAN, bukan dibuang diam-diam.
 *   §7 Masukan aneh tidak melempar.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
  KOLOM_IMPOR_ASET,
  KONDISI_IMPOR,
  kodeKondisi,
  angkaSel,
  barisTemplateAset,
  cariHeader,
  cocokkanFoto,
  susunImporAset,
  nilaiSimpan,
  ringkasImpor
} from '../js/modules/asset/impor-aset.js';

const require = createRequire(import.meta.url);
const { bacaXlsx } = require('./lib/baca-xlsx.cjs');
const AKAR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

let n = 0;
const ok = (nama) => {
  n += 1;
  console.log(`  ✔ ${nama}`);
};

const OUTLETS = [
  { id: 'o-serpong', name: 'AB Gading Serpong' },
  { id: 'o-ck', name: 'Central Kitchen Tangerang' }
];
const ID_KURSI = '11111111-1111-1111-1111-111111111111';
const ID_LEMARI = '22222222-2222-2222-2222-222222222222';
const SEKARANG = [
  {
    id: ID_KURSI,
    itemId: 'item-kursi',
    kode: 'M001',
    name: 'Kursi Kayu',
    category: 'Meja Kursi',
    qty: 4,
    size: '40x40',
    condition: 'normal',
    condition_note: null,
    outlet_id: 'o-serpong',
    notes: 'catatan lama'
  },
  {
    id: ID_LEMARI,
    itemId: 'item-lemari',
    kode: 'P001',
    name: 'Lemari Besi',
    category: 'Penyimpanan',
    qty: 1,
    size: '180 cm',
    condition: 'normal',
    condition_note: null,
    outlet_id: 'o-serpong',
    notes: 'catatan lemari'
  }
];

console.log('§1 Berkas .xlsx sungguhan');

const berkas = bacaXlsx(path.join(AKAR, 'tools/fixtures/contoh-impor-aset.xlsx'));
assert.equal(berkas.gambar.length, 3);

const header = cariHeader(berkas.aoa);
assert.ok(header, 'header template tidak ketemu di berkas sungguhan');
// Judul + subjudul + baris kosong, jadi headernya di indeks 3 (baris ke-4).
assert.equal(header.barisHeader, 3);
ok('INTI: header ketemu di berkas sungguhan, di bawah judul & subjudul');

// INILAH angka yang sedang dibuktikan. Gambar pertama dijangkar di sel A5;
// baris data pertama ada di `aoa[4]`. Keduanya harus angka yang SAMA.
assert.deepEqual(
  berkas.gambar.map((g) => g.row),
  [4, 5, 6]
);
assert.equal(berkas.aoa[4][2], 'Kursi Kayu');
assert.equal(berkas.aoa[5][2], 'Meja Bundar');
assert.equal(berkas.aoa[6][2], 'Lemari Besi');
ok('INTI: jangkar gambar 0-based dan sejalan dengan indeks baris datanya');

// Kolom dipetakan lewat judul — posisi `Catatan` di kolom ke-10, bukan ditebak.
assert.equal(header.kolom['Nama Barang'], 2);
assert.equal(header.kolom['Catatan'], 9);
ok('kolom dipetakan lewat judulnya');

const rencana = susunImporAset({
  aoa: berkas.aoa,
  gambar: berkas.gambar,
  asetSekarang: SEKARANG,
  outlets: OUTLETS
});
assert.equal(rencana.galat, null);
assert.equal(rencana.ubah.length, 2);
assert.equal(rencana.tambah.length, 1);
assert.equal(rencana.tolak.length, 0);
ok('INTI: dua baris ber-ID diperbarui, satu tanpa ID jadi barang baru');

// ============ TEMPLATE LAMA MASIH DITERIMA ============
//
// Berkas fixture ini memakai header LAMA ("ID (jangan diubah)") — persis
// seperti template yang sudah terlanjur diunduh orang dan diisi berjam-jam
// sebelum perubahannya terpasang. Menolaknya berarti pekerjaan itu hilang,
// dengan pesan yang tidak menjelaskan sebabnya.
assert.ok(header.kolom['ID (jangan diubah)'] !== undefined, 'kolom ID lama harus tetap dikenali');
assert.equal(header.kolom['Kode'], undefined, 'fixture ini memang belum punya kolom Kode');
ok('INTI: template versi LAMA (berkolom ID) masih bisa diunggah');

// Tiap baris membawa gambarnya SENDIRI — bukan bergeser satu.
assert.equal(rencana.ubah.find((b) => b.id === ID_KURSI).fotoDi.nama, 'Image 1');
assert.equal(rencana.tambah[0].name, 'Meja Bundar');
assert.equal(rencana.tambah[0].fotoDi.nama, 'Image 2');
assert.equal(rencana.ubah.find((b) => b.id === ID_LEMARI).fotoDi.nama, 'Image 3');
ok('INTI: tiap barang mendapat fotonya sendiri, tidak bergeser satu baris');

// Nomor baris yang dilaporkan adalah yang DILIHAT ORANG di Excel (1-based).
assert.equal(rencana.ubah.find((b) => b.id === ID_KURSI).baris, 5);
ok('nomor baris yang dilaporkan sama dengan yang terlihat di Excel');

console.log('\n§2 Header dicari, bukan diasumsikan');

// Tanpa judul & subjudul — header langsung di baris pertama.
const tanpaJudul = [KOLOM_IMPOR_ASET, [null, '', 'Kursi', '', 1, '', 'Normal', '', 'AB Gading Serpong', '']];
assert.equal(cariHeader(tanpaJudul).barisHeader, 0);
ok('header di baris pertama juga ketemu');

// Baris yang memuat "Nama Barang" tapi BUKAN header template — mis. tabel
// ringkas kecil yang ditempel orangnya di atas. Kolom ID yang membedakannya.
const palsu = [['Barang paling sering rusak'], ['Nama Barang', 'Jumlah'], ['Kursi', 3], KOLOM_IMPOR_ASET];
assert.equal(cariHeader(palsu).barisHeader, 3);
ok('INTI: baris ber-"Nama Barang" tanpa kolom ID tidak dikira header');

assert.equal(cariHeader([['a'], ['b']]), null);
assert.match(susunImporAset({ aoa: [['a']] }).galat ?? '', /Unduh templatenya/);
ok('berkas yang bukan template ditolak dengan kalimat yang bisa dikerjakan');

// Kolom tambahan milik orangnya sendiri tidak merusak apa pun.
const adaKolomEkstra = [
  [...KOLOM_IMPOR_ASET, 'Punya saya'],
  [null, '', 'Rak', '', 1, '', 'Normal', '', 'AB Gading Serpong', 'x', 'abaikan']
];
const rEkstra = susunImporAset({ aoa: adaKolomEkstra, outlets: OUTLETS });
assert.equal(rEkstra.tambah.length, 1);
assert.equal(rEkstra.tambah[0].name, 'Rak');
ok('kolom tambahan di kanan tidak mengganggu');

console.log('\n§3 Sel kosong berarti "jangan diapa-apakan"');

const lama = SEKARANG[0];
const barisKosong = { id: ID_KURSI, lama, name: 'Kursi Kayu', category: '', qty: null, size: '', condition: null, condition_note: '', outlet_id: null, notes: '' };
const simpan = nilaiSimpan(barisKosong);
assert.equal(simpan.category, 'Meja Kursi');
assert.equal(simpan.qty, 4);
assert.equal(simpan.size, '40x40');
assert.equal(simpan.notes, 'catatan lama');
assert.equal(simpan.outlet_id, 'o-serpong');
assert.equal(simpan.condition, 'normal');
ok('INTI: sel kosong pada baris ber-ID mempertahankan nilai lamanya');

const barisIsi = { ...barisKosong, category: 'Kursi', notes: 'catatan baru', qty: 7 };
const simpan2 = nilaiSimpan(barisIsi);
assert.equal(simpan2.category, 'Kursi');
assert.equal(simpan2.notes, 'catatan baru');
assert.equal(simpan2.qty, 7);
ok('sel yang diisi memang mengubah nilainya');

// Barang BARU tidak punya nilai lama untuk dipertahankan.
const baru = nilaiSimpan({ name: 'Rak', category: '', qty: null, size: '', condition: 'normal', condition_note: '', outlet_id: 'o-ck', notes: '' });
assert.equal(baru.category, null);
assert.equal(baru.qty, 1, 'jumlah bawaan barang baru harus 1, sama dengan default kolomnya');
ok('barang baru: kosong berarti kosong, jumlah bawaannya 1');

console.log('\n§4 Angka & kondisi');

// `Number('')` adalah 0 — sel kosong tidak boleh jadi "0 unit".
assert.equal(angkaSel(''), null);
assert.equal(angkaSel('   '), null);
assert.equal(angkaSel(null), null);
assert.equal(angkaSel(undefined), null);
assert.equal(angkaSel('-'), null);
assert.equal(angkaSel(0), 0);
assert.equal(angkaSel('1.500'), 1500);
assert.equal(angkaSel('1,5'), 1.5);
assert.equal(angkaSel(3), 3);
ok('INTI: sel kosong menjawab null, bukan 0 — "0 unit" terbaca seperti barang habis');

assert.equal(kodeKondisi('Rusak'), 'rusak');
assert.equal(kodeKondisi('rusak'), 'rusak');
assert.equal(kodeKondisi('  Lain-lain '), 'lainnya');
assert.equal(kodeKondisi('lainnya'), 'lainnya');
assert.equal(kodeKondisi(''), 'normal');
assert.equal(kodeKondisi('hancur'), null);
ok('kondisi menerima label maupun kodenya; yang asing menjawab null');

console.log('\n§5 Yang ditolak');

const tolakan = (baris) => susunImporAset({ aoa: [KOLOM_IMPOR_ASET, baris], asetSekarang: SEKARANG, outlets: OUTLETS }).tolak;

assert.match(tolakan([null, 'ZZ999', 'X', '', 1, '', 'Normal', '', 'AB Gading Serpong', ''])[0].sebab, /Kode "ZZ999" tidak ada/);
assert.match(tolakan([null, '', '', '', 1, '', 'Normal', '', 'AB Gading Serpong', ''])[0].sebab, /Nama barang wajib/);
assert.match(tolakan([null, '', 'X', '', 1, '', 'hancur', '', 'AB Gading Serpong', ''])[0].sebab, /Kondisi "hancur" tidak dikenal/);
assert.match(tolakan([null, '', 'X', '', -2, '', 'Normal', '', 'AB Gading Serpong', ''])[0].sebab, /tidak boleh negatif/);
assert.match(tolakan([null, '', 'X', '', 1, '', 'Normal', '', 'Outlet Hantu', ''])[0].sebab, /Outlet "Outlet Hantu" tidak ada/);
assert.match(tolakan([null, '', 'X', '', 1, '', 'Normal', '', '', ''])[0].sebab, /Outlet wajib diisi/);
assert.match(tolakan([null, '', 'X', '', 1, '', 'Lain-lain', '', 'AB Gading Serpong', ''])[0].sebab, /harus disertai Catatan kondisi/);
ok('INTI: tujuh sebab penolakan, masing-masing menyebut barisnya dan apa yang harus dikerjakan');

// Barang lama yang kondisinya SUDAH 'lainnya' dan catatannya sudah ada tidak
// ikut ditolak hanya karena selnya dikosongkan.
const punyaCatatan = [{ ...SEKARANG[0], condition: 'lainnya', condition_note: 'hilang sebagian' }];
const r5 = susunImporAset({
  // Jumlahnya diisi: baris yang SUDAH ADA boleh dikosongkan jumlahnya dan
  // nilainya dipertahankan, tapi di sini yang diuji kondisinya — biar tidak
  // dua hal sekaligus.
  aoa: [KOLOM_IMPOR_ASET, [null, 'M001', 'Kursi Kayu', '', 4, '', '', '', 'AB Gading Serpong', '']],
  asetSekarang: punyaCatatan,
  outlets: OUTLETS
});
assert.equal(r5.tolak.length, 0);
assert.equal(r5.ubah.length, 1);
ok('INTI: barang lama berkondisi Lain-lain tidak ditolak saat selnya dibiarkan kosong');

// Baris kosong di bawah data DIABAIKAN — Excel menyimpan ratusan.
const banyakKosong = [KOLOM_IMPOR_ASET, ['', '', '', '', '', '', '', '', '', ''], [], [null, null]];
const r6 = susunImporAset({ aoa: banyakKosong, outlets: OUTLETS });
assert.equal(r6.tambah.length + r6.ubah.length + r6.tolak.length, 0);
ok('INTI: baris kosong tidak jadi tujuh ratus "nama wajib diisi"');

console.log('\n§6 Foto melayang & ganda');

const { perBaris, melayang, ganda } = cocokkanFoto(
  [{ row: 4, nama: 'A' }, { row: 5, nama: 'B' }, { row: 5, nama: 'B2' }, { row: 99, nama: 'C' }, { row: 0, nama: 'D' }],
  3,
  3
);
assert.deepEqual([...perBaris.keys()], [4, 5]);
assert.deepEqual(melayang.map((g) => g.nama), ['C', 'D']);
assert.deepEqual(ganda.map((g) => g.nama), ['B2']);
ok('INTI: foto di luar baris data & foto kembar DILAPORKAN, bukan dibuang diam-diam');

// Baris kosong yang PUNYA foto tidak ikut dibuang — kalau tidak, fotonya
// lenyap tanpa satu pun laporan, dan itu persis kasus jangkar yang bergeser.
const kosongBerfoto = susunImporAset({
  aoa: [KOLOM_IMPOR_ASET, ['', '', '', '', '', '', '', '', '', '']],
  gambar: [{ row: 1, nama: 'yatim' }],
  outlets: OUTLETS
});
assert.equal(kosongBerfoto.tolak.length, 1);
assert.match(kosongBerfoto.tolak[0].sebab, /Nama barang wajib/);
ok('INTI: baris kosong yang menempeli foto tetap dilaporkan, bukan dilewati');

const ringkas = ringkasImpor(rencana);
assert.deepEqual(ringkas, { tambah: 1, ubah: 2, tolak: 0, lewati: 0, foto: 3, melayang: 0, ganda: 0 });
ok('ringkasannya menghitung apa adanya');

console.log('\n§7 Template & masukan aneh');

const tpl = barisTemplateAset(SEKARANG, new Map([[ID_KURSI, 'data:image/png;base64,xx']]));
assert.equal(tpl.length, 2);
assert.equal(tpl[0][1], 'M001', 'kolom kedua harus KODE, bukan UUID');
assert.equal(tpl[0][6], 'Normal', 'kondisi ditulis sebagai label, bukan kode');
// Barang berfoto yang fotonya gagal dimuat ditandai 'GAGAL', bukan dikosongkan.
assert.equal(barisTemplateAset([{ ...SEKARANG[0], photo_path: 'x.jpg' }], new Map())[0][0], 'GAGAL');
assert.equal(tpl[0][0], null, 'barang tanpa foto: sel kosong');
ok('INTI: foto yang gagal dimuat ditandai GAGAL — sel kosong terbaca "belum difoto"');

// ============ "BELUM DIDATA" DITULIS KOSONG, BUKAN NOL ============
//
// Template satu outlet memuat SELURUH item BU, termasuk yang outlet itu belum
// pernah menghitungnya. Kalau barisnya ditulis "0", orang yang mengunduh
// template lalu mengunggahnya kembali TANPA MENGUBAH APA PUN akan menetapkan
// nol untuk seluruh barang yang belum dihitung — mengubah "belum ada yang
// melihat" jadi "sudah dicek, memang tidak ada", dalam satu klik, tanpa galat,
// dan tanpa cara mengembalikannya.
const tplBelum = barisTemplateAset([{ ...SEKARANG[0], qty: 0, belumDidata: true }], new Map());
assert.equal(tplBelum[0][4], null, 'barang yang belum didata: kolom Jumlah KOSONG, bukan 0');
const tplNol = barisTemplateAset([{ ...SEKARANG[0], qty: 0, belumDidata: false }], new Map());
assert.equal(tplNol[0][4], 0, 'barang yang sudah dihitung dan memang nol: tetap ditulis 0');
ok('INTI: template membedakan "belum didata" dari "sudah dihitung, nol"');

// ============ KOLOM OUTLET TIDAK BOLEH KOSONG DI TEMPLATE ============
//
// Baris yang belum didata tidak punya embed `outlets(name)` — ia tidak punya
// baris stok sama sekali. Kalau template mengambil namanya dari embed, kolom
// Outletnya kosong, dan saat berkasnya diunggah balik baris itu tidak punya
// tujuan yang disebut siapa pun.
const belumDidataTanpaEmbed = { ...SEKARANG[0], outlets: undefined, outlet_id: 'o-ck', belumDidata: true, qty: 0 };
const tplOutlet = barisTemplateAset([belumDidataTanpaEmbed], new Map(), (a) =>
  OUTLETS.find((o) => o.id === a.outlet_id)?.name ?? ''
);
assert.equal(tplOutlet[0][8], 'Central Kitchen Tangerang', 'kolom Outlet harus terisi walau barisnya belum punya stok');
ok('INTI: template selalu menuliskan outletnya, termasuk untuk barang yang belum didata');

// Dan sel Outlet yang kosong TIDAK ditebak dari item berkode sama.
//
// `item` adalah baris PERTAMA yang kebetulan berkode itu; di template "semua
// outlet" ia bisa milik outlet mana saja. Menebak dari situ menuliskan hasil
// hitungan ke outlet yang tidak pernah disebut orangnya — tanpa galat, dan
// baru ketahuan saat dua outlet sama-sama merasa angkanya aneh.
const outletKosong = susunImporAset({
  aoa: [KOLOM_IMPOR_ASET, [null, 'M001', 'Kursi Kayu', '', 9, '', '', '', '', '']],
  asetSekarang: SEKARANG,
  outlets: OUTLETS
});
assert.equal(outletKosong.tambah.length + outletKosong.ubah.length, 0, 'tidak boleh ditebak');
assert.match(outletKosong.tolak[0].sebab, /Outlet wajib diisi/);
ok('INTI: sel Outlet kosong DITOLAK, bukan ditebak dari item berkode sama');

// Dan unggahan baliknya MELEWATI baris itu, bukan menuliskan nol.
const kembali = susunImporAset({
  aoa: [KOLOM_IMPOR_ASET, [null, 'M001', 'Kursi Kayu', '', '', '', '', '', 'Central Kitchen Tangerang', '']],
  // SEKARANG[0] ada di o-serpong, jadi di Central Kitchen item ini belum didata.
  asetSekarang: SEKARANG,
  outlets: OUTLETS
});
assert.equal(kembali.tambah.length, 0, 'baris belum-didata yang dibiarkan kosong TIDAK boleh jadi baris baru');
assert.equal(kembali.ubah.length, 0);
assert.equal(kembali.tolak.length, 0, 'ini bukan kesalahan — tidak boleh masuk daftar ditolak');
assert.equal(kembali.lewati.length, 1, 'dilaporkan terpisah, supaya orangnya tahu ada yang belum diisi');
ok('INTI: mengunggah balik template tanpa mengisi apa pun tidak menetapkan nol di mana pun');

// Tapi jumlah yang DIISI nol memang berarti nol — orangnya sudah menghitung.
const nolSengaja = susunImporAset({
  aoa: [KOLOM_IMPOR_ASET, [null, 'M001', 'Kursi Kayu', '', 0, '', '', '', 'Central Kitchen Tangerang', '']],
  asetSekarang: SEKARANG,
  outlets: OUTLETS
});
assert.equal(nolSengaja.tambah.length, 1);
assert.equal(nolSengaja.tambah[0].qty, 0);
assert.equal(nolSengaja.tambah[0].itemId, 'item-kursi', 'kodenya menunjuk item yang sudah ada, bukan bikin item baru');
ok('INTI: nol yang DIKETIK orang tetap tersimpan sebagai nol');

// Baris yang sudah ada boleh dikosongkan jumlahnya — nilai lamanya bertahan.
const adaTapiKosong = susunImporAset({
  aoa: [KOLOM_IMPOR_ASET, [null, 'M001', 'Kursi Kayu', '', '', '', '', '', 'AB Gading Serpong', '']],
  asetSekarang: SEKARANG,
  outlets: OUTLETS
});
assert.equal(adaTapiKosong.ubah.length, 1);
assert.equal(nilaiSimpan(adaTapiKosong.ubah[0]).qty, 4, 'jumlah lama dipertahankan, bukan dijadikan nol');
ok('INTI: baris yang sudah didata boleh dikosongkan jumlahnya tanpa kehilangan angkanya');

assert.equal(KOLOM_IMPOR_ASET[0], 'Foto');
// Kolom kunci sekarang KODE, bukan UUID.
//
// UUID tidak bisa dicocokkan dengan apa pun di dunia nyata, jadi satu-satunya
// cara memakainya adalah percaya. Kode bisa dibaca, sudah tertempel di
// barangnya, dan menunjuk item se-BU — persis yang dibutuhkan template yang
// memuat beberapa outlet sekaligus.
assert.equal(KOLOM_IMPOR_ASET[1], 'Kode');
assert.deepEqual(Object.keys(KONDISI_IMPOR), ['normal', 'rusak', 'lainnya']);
ok('bentuk templatenya tetap: Foto di kolom pertama, ID di kedua');

assert.deepEqual(barisTemplateAset(null), []);
assert.deepEqual(cocokkanFoto(null, 0, 0).melayang, []);
assert.equal(susunImporAset({ aoa: null }).galat !== null, true);
assert.equal(susunImporAset({ aoa: [KOLOM_IMPOR_ASET], gambar: null, outlets: null }).tambah.length, 0);
ok('masukan kosong & cacat tidak melempar');

console.log(`\n${n} pemeriksaan impor aset lolos. ✅`);
