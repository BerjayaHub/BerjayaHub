/**
 * TES: rekap barang terkirim — rincian & rekap per barang.
 *
 * ============ YANG DIJAGA BERKAS INI ============
 *
 *   §1 Kedua bentuk datang dari SATU penelusuran — totalnya tidak bisa beda.
 *   §2 `received_qty` NULL bukan NOL. Ini aturan terpenting di sini.
 *   §3 Selisih dijumlahkan PER BARIS, bukan dari selisih kolom.
 *   §4 Dikelompokkan per PRODUK, bukan per nama.
 *   §5 "Nilai" berarti sama dengan di surat jalan: HPP × DIKIRIM.
 *   §6 HPP yang tidak ada dikosongkan, bukan dianggap nol.
 *   §7 Masukan aneh tidak melempar.
 */
import assert from 'node:assert/strict';
import {
  KOLOM_RINCIAN,
  KOLOM_REKAP,
  qty,
  sudahDiterima,
  tanggalWIB,
  susunRekapKiriman,
  ringkasKiriman
} from '../js/modules/dispatch/rekap-kiriman.js';

let n = 0;
const ok = (nama) => {
  n += 1;
  console.log(`  ✔ ${nama}`);
};

const LABEL = { draft: 'Draft', sent: 'Dikirim', received: 'Diterima', cancelled: 'Dibatalkan' };
const kol = (daftar, judul) => daftar.findIndex((k) => k.header === judul);

const R = {
  tanggal: kol(KOLOM_RINCIAN, 'Tanggal'),
  dikirim: kol(KOLOM_RINCIAN, 'Dikirim'),
  diterima: kol(KOLOM_RINCIAN, 'Diterima'),
  selisih: kol(KOLOM_RINCIAN, 'Selisih'),
  hpp: kol(KOLOM_RINCIAN, 'HPP/satuan'),
  nilai: kol(KOLOM_RINCIAN, 'Nilai'),
  nilaiTerima: kol(KOLOM_RINCIAN, 'Nilai Diterima')
};
const K = {
  barang: kol(KOLOM_REKAP, 'Barang'),
  sj: kol(KOLOM_REKAP, 'Surat Jalan'),
  dikirim: kol(KOLOM_REKAP, 'Dikirim'),
  diterima: kol(KOLOM_REKAP, 'Diterima'),
  selisih: kol(KOLOM_REKAP, 'Selisih'),
  belum: kol(KOLOM_REKAP, 'Belum diterima (baris)'),
  nilai: kol(KOLOM_REKAP, 'Nilai')
};

const item = (o = {}) => ({
  dispatch_id: o.dispatch_id ?? 'd1',
  code: o.code ?? 'SJ-001',
  status: o.status ?? 'received',
  created_at: o.created_at ?? '2026-09-10T03:00:00Z',
  from_outlet: o.from_outlet ?? 'Central Kitchen',
  to_outlet: o.to_outlet ?? 'AB Gading Serpong',
  product_id: o.product_id ?? 'p-gula',
  product_name: o.product_name ?? 'Gula Pasir',
  base_unit: o.base_unit ?? 'kg',
  ordered_qty: o.ordered_qty ?? 10,
  sent_qty: o.sent_qty ?? 10,
  received_qty: 'received_qty' in o ? o.received_qty : 9,
  keterangan: o.keterangan ?? ''
});

const BIAYA = new Map([
  ['p-gula', 1000],
  ['p-tepung', 500]
]);
const susun = (items, extra = {}) => susunRekapKiriman({ items, biaya: BIAYA, labelStatus: LABEL, ...extra });

console.log('§1 Satu sumber, dua bentuk');

const dasar = [
  item({ sent_qty: 10, received_qty: 9 }),
  item({ dispatch_id: 'd2', code: 'SJ-002', sent_qty: 5, received_qty: 5 }),
  item({ dispatch_id: 'd2', code: 'SJ-002', product_id: 'p-tepung', product_name: 'Tepung', sent_qty: 20, received_qty: 20 })
];
const h = susun(dasar);
assert.equal(h.rincian.length, 3);
assert.equal(h.rekap.length, 2);

// INTI: total kedua sheet WAJIB sama. Kalau keduanya disusun terpisah, sheet
// Rincian menjumlahkan 412 kg dan sheet Rekap menulis 408 kg — dan tidak ada
// satu pun layar yang bisa menjelaskan empat kilo itu ke mana.
const jml = (baris, i) => baris.reduce((t, b) => t + (typeof b[i] === 'number' ? b[i] : 0), 0);
assert.equal(jml(h.rincian, R.dikirim), jml(h.rekap, K.dikirim));
assert.equal(jml(h.rincian, R.diterima), jml(h.rekap, K.diterima));
assert.equal(jml(h.rincian, R.nilai), jml(h.rekap, K.nilai));
ok('INTI: total Dikirim, Diterima & Nilai identik di kedua bentuk');

assert.equal(h.total.dokumen, 2, 'dua surat jalan, walau tiga baris');
assert.equal(h.rekap.find((b) => b[K.barang] === 'Gula Pasir')[K.sj], 2);
ok('jumlah surat jalan dihitung unik, bukan per baris');

console.log('\n§2 `received_qty` NULL bukan NOL');

const adaYangBelum = [
  item({ sent_qty: 10, received_qty: 9 }),
  item({ dispatch_id: 'd9', code: 'SJ-009', status: 'sent', sent_qty: 90, received_qty: null })
];
const hb = susun(adaYangBelum);

// Baris yang belum diterima: kolomnya KOSONG, bukan 0.
const barisBelum = hb.rincian.find((b) => b[R.dikirim] === 90);
assert.strictEqual(barisBelum[R.diterima], '');
assert.strictEqual(barisBelum[R.selisih], '');
assert.strictEqual(barisBelum[R.nilaiTerima], '');
ok('INTI: baris yang belum diterima mengosongkan Diterima, Selisih & Nilai Diterima');

// …dan TIDAK ikut dijumlahkan.
const gula = hb.rekap.find((b) => b[K.barang] === 'Gula Pasir');
assert.equal(gula[K.dikirim], 100);
assert.equal(gula[K.diterima], 9, 'yang belum diterima ikut terjumlah sebagai 0');
assert.equal(gula[K.belum], 1);
ok('INTI: yang belum diterima dihitung sendiri, bukan dijumlahkan sebagai nol');

// Selisihnya −1, BUKAN −91. Angka kedua akan terbaca sebagai 91 kg hilang.
assert.equal(gula[K.selisih], -1);
ok('INTI: Selisih -1, bukan -91 — barang yang masih di jalan bukan barang hilang');

// Belum ada satu pun yang diterima: Selisih KOSONG, bukan 0.
// "0" terbaca sebagai "cocok, tidak ada selisih", padahal belum ada yang
// menghitung.
const semuaBelum = susun([item({ received_qty: null, status: 'sent' })]);
assert.strictEqual(semuaBelum.rekap[0][K.selisih], '');
assert.strictEqual(semuaBelum.rekap[0][K.diterima], 0);
ok('INTI: barang yang belum diterima sama sekali punya Selisih kosong, bukan 0');

// `received_qty` NOL SUNGGUHAN berbeda dari NULL — barangnya dihitung, dan
// hasilnya nol.
const nolSungguhan = susun([item({ sent_qty: 4, received_qty: 0 })]);
assert.strictEqual(nolSungguhan.rincian[0][R.diterima], 0);
assert.strictEqual(nolSungguhan.rincian[0][R.selisih], -4);
assert.equal(nolSungguhan.rekap[0][K.belum], 0);
ok('INTI: diterima NOL dibedakan dari BELUM diterima');

assert.equal(sudahDiterima({ received_qty: 0 }), true);
assert.equal(sudahDiterima({ received_qty: null }), false);
assert.equal(sudahDiterima({}), false);
assert.equal(sudahDiterima(null), false);
ok('`sudahDiterima` membedakan nol dari kosong');

console.log('\n§3 Selisih per baris, bukan selisih kolom');

// Dua baris: satu kurang 1, satu lebih 2. Selisih rekap = +1.
// Kalau dihitung `Diterima - Dikirim` atas kolomnya, hasilnya sama di sini —
// jadi kasus yang membedakan harus memuat baris yang BELUM diterima.
const campur = [
  item({ sent_qty: 10, received_qty: 9 }),
  item({ dispatch_id: 'd2', sent_qty: 10, received_qty: 12 }),
  item({ dispatch_id: 'd3', status: 'sent', sent_qty: 50, received_qty: null })
];
const hc = susun(campur);
const g = hc.rekap[0];
assert.equal(g[K.selisih], 1, 'selisih harus +1');
assert.notEqual(g[K.selisih], g[K.diterima] - g[K.dikirim]);
ok('INTI: Selisih tidak sama dengan (Diterima − Dikirim) saat ada yang belum sampai');

console.log('\n§4 Dikelompokkan per PRODUK');

// Dua produk berbeda yang namanya SAMA — beda satuan. Menggabungkannya lewat
// nama akan menjumlahkan kilogram dengan pack.
const namaKembar = [
  item({ product_id: 'p-a', product_name: 'Gula', base_unit: 'kg', sent_qty: 10, received_qty: 10 }),
  item({ product_id: 'p-b', product_name: 'Gula', base_unit: 'pack', sent_qty: 3, received_qty: 3 })
];
const hk = susun(namaKembar);
assert.equal(hk.rekap.length, 2);
ok('INTI: dua produk bernama sama tidak digabung — kilogram tidak dijumlah dengan pack');

console.log('\n§5 "Nilai" = HPP × DIKIRIM, sama dengan surat jalan');

const hn = susun([item({ sent_qty: 10, received_qty: 9 })]);
// `dokumen.js` menghitung Nilai = HPP × dikirim. Arti yang berbeda di dua
// unduhan membuat satu kiriman terbaca dua angka.
assert.equal(hn.rincian[0][R.nilai], 10 * 1000);
assert.equal(hn.rincian[0][R.nilaiTerima], 9 * 1000);
assert.equal(hn.rincian[0][R.hpp], 1000);
ok('INTI: Nilai memakai DIKIRIM; yang dihitung penerimanya bernama sendiri');

console.log('\n§6 HPP yang tidak ada');

const tanpaHpp = susunRekapKiriman({ items: [item({ product_id: 'p-hantu' })], biaya: BIAYA, labelStatus: LABEL });
assert.strictEqual(tanpaHpp.rincian[0][R.hpp], '');
assert.strictEqual(tanpaHpp.rincian[0][R.nilai], '');
assert.strictEqual(tanpaHpp.rekap[0][K.nilai], '');
ok('INTI: HPP yang tidak ada dikosongkan — "Rp0" terbaca seperti barang gratis');

// Satu baris berharga, satu tidak: totalnya tetap terisi, tidak ikut hilang.
const sebagian = susun([item({ product_id: 'p-gula', sent_qty: 2 }), item({ dispatch_id: 'd2', product_id: 'p-hantu', sent_qty: 5 })]);
assert.equal(sebagian.total.nilai, 2000);
ok('satu baris tanpa HPP tidak menghapus nilai baris lainnya');

console.log('\n§7 Bentuk & masukan aneh');

assert.equal(KOLOM_RINCIAN[0].header, 'Tanggal');
assert.ok(KOLOM_REKAP.some((k) => k.header === 'Belum diterima (baris)'));
// Kolom angka WAJIB bertanda `numeric` — tanpa itu Excel menganggapnya teks,
// SUM-nya nol, dan selnya tetap tampil rapi.
for (const judul of ['Dikirim', 'Diterima', 'Selisih', 'Nilai']) {
  assert.equal(KOLOM_RINCIAN.find((k) => k.header === judul)?.numeric, true, `${judul} (rincian) tidak numeric`);
  assert.equal(KOLOM_REKAP.find((k) => k.header === judul)?.numeric, true, `${judul} (rekap) tidak numeric`);
}
ok('INTI: kolom angka bertanda numeric — kalau tidak, SUM di Excel nol tanpa tanda');

assert.equal(qty(null), null);
assert.equal(qty(''), null);
assert.equal(qty(undefined), null);
assert.equal(qty('abc'), null);
assert.equal(qty(0), 0);
assert.equal(qty('7'), 7);
ok('`qty` membedakan kosong dari nol — `Number(null)` adalah 0');

assert.equal(tanggalWIB(''), '');
assert.equal(tanggalWIB(null), '');
assert.equal(tanggalWIB('bukan tanggal'), 'bukan tanggal');
assert.match(tanggalWIB('2026-09-10T03:00:00Z'), /^\d{2}\/\d{2}\/\d{4}$/);
ok('tanggal cacat ditulis apa adanya, bukan "Invalid Date"');

const kosong = susunRekapKiriman({ items: null });
assert.deepEqual(kosong.rincian, []);
assert.deepEqual(kosong.rekap, []);
assert.deepEqual(ringkasKiriman(kosong), { dokumen: 0, baris: 0, barang: 0, belum: 0 });
assert.deepEqual(ringkasKiriman(null), { dokumen: 0, baris: 0, barang: 0, belum: 0 });
// Produk terhapus tetap muncul — uangnya benar-benar keluar, dan baris yang
// hilang membuat total tidak cocok dengan dokumennya.
const terhapus = susunRekapKiriman({ items: [{ sent_qty: 3, dispatch_id: 'd1' }] });
assert.equal(terhapus.rekap[0][K.barang], '(produk terhapus)');
ok('masukan kosong & produk terhapus tidak melempar, dan tidak menghilangkan baris');

console.log(`\n${n} pemeriksaan rekap kiriman lolos. ✅`);
