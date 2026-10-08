/**
 * TES: teks surat jalan untuk WhatsApp, dan catatan baris yang dipakai bersama PDF.
 *
 * ============ APA YANG SESUNGGUHNYA DIJAGA ============
 *
 * Pesan WhatsApp adalah dokumen yang dibaca DULU — biasanya sebelum mobilnya
 * sampai. Kertasnya baru dibaca saat barang diserahkan. Jadi keterangan yang
 * hilang dari pesan hilang justru dari dokumen yang paling cepat menolong.
 *
 *   §1 Keterangan ikut di teksnya.
 *   §2 "Diminta X" hanya kalau memang berbeda.
 *   §3 Catatan baris: satu penyusun, dua pemakai.
 *   §4 Baris yang tidak dikirim diringkas.
 *   §5 Bentuk pesannya.
 *   §6 Masukan aneh.
 */
import assert from 'node:assert/strict';
import { catatanBaris, barisPesan, suratJalanWaText } from '../js/modules/dispatch/pesan-kiriman.js';

let n = 0;
const ok = (nama) => {
  n += 1;
  console.log(`  ✔ ${nama}`);
};

const DATA = {
  code: 'SJ-261008-001',
  title: 'SURAT JALAN',
  fromName: 'Central Kitchen',
  toName: 'AB Sentul',
  dateStr: '08 Okt 2026',
  notes: 'dikirim pagi',
  showReceived: false,
  items: [
    { name: 'Beras', unit: 'kg', sent: 10, ordered: 10 },
    { name: 'Gula', unit: 'kg', sent: 0, ordered: 5, keterangan: 'stok CK habis' },
    { name: 'Nanas', unit: 'kg', sent: 3, ordered: 5, keterangan: 'sisa panen kemarin' }
  ]
};

console.log('§1 Keterangan ikut di teksnya');

const teks = suratJalanWaText(DATA);
assert.ok(teks.includes('stok CK habis'), teks);
assert.ok(teks.includes('sisa panen kemarin'), teks);
ok('INTI: keterangan tiap baris muncul di pesan WhatsApp');

assert.ok(teks.includes('Catatan: dikirim pagi'));
ok('catatan surat jalan (satu dokumen) tetap ada');

console.log('\n§2 "Diminta X" hanya kalau berbeda');

// Baris yang dikirim persis sebanyak yang diminta TIDAK perlu menyebutnya —
// keramaian membuat baris yang sungguh berbeda ikut tidak dibaca.
assert.deepEqual(catatanBaris({ sent: 10, ordered: 10, unit: 'kg' }), []);
ok('dikirim = diminta → tidak ada catatan sama sekali');

assert.deepEqual(catatanBaris({ sent: 0, ordered: 5, unit: 'kg' }), ['diminta 5 kg']);
ok('INTI: dikirim 0 dari diminta 5 disebut — itu jawaban yang menutup perdebatan');

// `Number(null)` adalah 0, jadi tanpa penjaga `!= null` setiap baris tanpa
// `ordered` akan berbunyi "diminta 0" — tuduhan yang tidak pernah dibuat
// siapa pun.
assert.deepEqual(catatanBaris({ sent: 3, unit: 'kg' }), []);
assert.deepEqual(catatanBaris({ sent: 3, ordered: null, unit: 'kg' }), []);
ok('INTI: baris tanpa `ordered` tidak berbunyi "diminta 0"');

// Tapi nol SUNGGUHAN tetap disebut.
assert.deepEqual(catatanBaris({ sent: 2, ordered: 0, unit: 'kg' }), ['diminta 0 kg']);
ok('diminta 0 yang sungguhan tetap disebut — itu barang tambahan dari CK');

console.log('\n§3 Satu penyusun, dua pemakai');

// PDF memotong di 60 karakter (lebar A5); WhatsApp tidak. Pemotongan adalah
// milik pemanggil, bukan aturan bersama.
const panjang = 'a'.repeat(100);
assert.equal(catatanBaris({ sent: 1, keterangan: panjang })[0].length, 100);
assert.equal(catatanBaris({ sent: 1, keterangan: panjang }, { potong: 60 })[0].length, 60);
ok('INTI: pemotongan 60 karakter diminta pemanggil, bukan dipaksakan ke semua');

assert.deepEqual(catatanBaris({ sent: 0, ordered: 5, unit: 'kg', keterangan: 'stok CK habis' }), [
  'diminta 5 kg',
  'stok CK habis'
]);
ok('urutannya tetap: berapa yang diminta dulu, baru keterangannya');

// Keterangan berisi spasi saja bukan keterangan.
assert.deepEqual(catatanBaris({ sent: 1, keterangan: '   ' }), []);
ok('keterangan berisi spasi saja tidak menghasilkan catatan kosong');

console.log('\n§4 Barang yang tidak dikirim diringkas');

assert.ok(teks.includes('1 barang TIDAK dikirim'), teks);
assert.ok(teks.includes('Gula'), teks);
ok('INTI: baris ber-kirim-0 diringkas di bawah supaya tidak tenggelam');

// Nol-nya harus nol SUNGGUHAN, bukan baris yang jumlahnya tidak terbaca.
const tanpaNol = suratJalanWaText({ ...DATA, items: [{ name: 'Beras', unit: 'kg', sent: 10, ordered: 10 }] });
assert.ok(!tanpaNol.includes('TIDAK dikirim'), tanpaNol);
ok('tidak ada yang nol → ringkasannya tidak muncul sama sekali');

console.log('\n§5 Bentuk pesannya');

const baris = barisPesan({ name: 'Gula', unit: 'kg', sent: 0, ordered: 5, keterangan: 'stok CK habis' });
// Catatannya di BARIS SENDIRI: WhatsApp membungkus baris panjang sendiri, dan
// "• Gula: 0 kg — diminta 5 kg — stok CK habis" yang terbungkus jadi dua baris
// tidak bisa dibedakan dari dua barang.
assert.ok(baris.includes('\n'), JSON.stringify(baris));
assert.ok(baris.split('\n')[0].startsWith('• Gula'), baris);
ok('INTI: catatannya di baris sendiri, bukan disambung di belakang jumlahnya');

assert.ok(!barisPesan({ name: 'Beras', unit: 'kg', sent: 10, ordered: 10 }).includes('\n'));
ok('baris tanpa catatan tetap satu baris');

const terima = suratJalanWaText({ ...DATA, showReceived: true, title: 'BUKTI TERIMA', items: [{ name: 'Beras', unit: 'kg', sent: 10, received: 9 }] });
assert.ok(terima.includes('diterima 9'), terima);
assert.ok(terima.includes('BUKTI TERIMA'), terima);
ok('mode bukti terima menampilkan jumlah diterima');

assert.ok(teks.startsWith('*SURAT JALAN SJ-261008-001*'), teks.slice(0, 40));
ok('judul & nomornya tebal di baris pertama');

console.log('\n§6 Masukan aneh');

assert.equal(typeof suratJalanWaText({}), 'string');
assert.equal(typeof suratJalanWaText(null), 'string');
assert.equal(typeof suratJalanWaText({ items: null }), 'string');
ok('data kosong tidak melempar');

// Judul tanpa nomor tidak boleh meninggalkan spasi menggantung di dalam tebal.
assert.ok(!suratJalanWaText({ title: 'SURAT JALAN', items: [] }).startsWith('*SURAT JALAN *'));
ok('INTI: nomor yang kosong tidak menyisakan spasi menggantung di judul tebal');

assert.deepEqual(catatanBaris(null), []);
assert.deepEqual(catatanBaris(undefined), []);
assert.equal(typeof barisPesan(null), 'string');
ok('baris null tidak melempar');

console.log(`\n${n} pemeriksaan pesan kiriman lolos. ✅`);
