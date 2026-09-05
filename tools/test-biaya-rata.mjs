/**
 * Tes: biaya rata-rata bahan dari nota penerimaan.
 *
 * Yang diuji bukan "apakah rumusnya dijalankan" — itu satu baris. Yang diuji
 * adalah perbatasannya, tempat angka gila lahir tanpa ada error:
 *
 *   - pembelian TANPA harga tidak boleh menarik rata-rata ke nol;
 *   - stok MINUS (yang di sistem ini memang mungkin) tidak boleh masuk rumus;
 *   - pembelian pertama menetapkan harganya, bukan dirata-rata dengan nol;
 *   - perbandingan menolak menebak kalau salah satu sisinya belum ada.
 */
import assert from 'node:assert/strict';
import { rataTertimbang, hargaMaster, bandingHarga, perluDitinjau, ringkasNota } from '../js/modules/inventory/biaya-rata.js';

let lulus = 0;
const uji = (nama, fn) => {
  try {
    fn();
    lulus++;
  } catch (e) {
    console.error(`❌ ${nama}\n   ${e.message}`);
    process.exitCode = 1;
  }
};

uji('pembelian pertama menetapkan harganya', () => {
  const r = rataTertimbang([{ qty: 10, unitCost: 12000, stokSebelum: 0 }]);
  assert.equal(r.rata, 12000);
  assert.equal(r.dasar, 10);
});

uji('INTI: rumus tertimbang stok', () => {
  // Beli 10 @12.000 -> rata 12.000. Sisa stok 4 saat beli 6 @15.000:
  // (4×12.000 + 6×15.000) / 10 = (48.000 + 90.000) / 10 = 13.800
  const r = rataTertimbang([
    { qty: 10, unitCost: 12000, stokSebelum: 0 },
    { qty: 6, unitCost: 15000, stokSebelum: 4 }
  ]);
  assert.equal(r.rata, 13800);
  assert.equal(r.dasar, 16);
});

uji('stok besar meredam harga baru; stok tipis membuatnya melompat', () => {
  const banyak = rataTertimbang([
    { qty: 100, unitCost: 10000, stokSebelum: 0 },
    { qty: 1, unitCost: 20000, stokSebelum: 99 }
  ]);
  const tipis = rataTertimbang([
    { qty: 100, unitCost: 10000, stokSebelum: 0 },
    { qty: 1, unitCost: 20000, stokSebelum: 0 }
  ]);
  assert.ok(banyak.rata < 10200, `stok banyak seharusnya meredam, dapat ${banyak.rata}`);
  assert.equal(tipis.rata, 20000);
});

uji('INTI: pembelian tanpa harga tidak menarik rata-rata ke nol', () => {
  // Nota lama diinput sebelum kotak harganya ada, dan staff boleh
  // mengosongkannya. Menganggapnya 0 membuat rata-rata anjlok tanpa sebab.
  const r = rataTertimbang([
    { qty: 10, unitCost: 12000, stokSebelum: 0 },
    { qty: 10, unitCost: null, stokSebelum: 10 },
    { qty: 10, unitCost: undefined, stokSebelum: 20 }
  ]);
  assert.equal(r.rata, 12000);
  assert.equal(r.dasar, 10, 'yang tanpa harga tidak ikut jadi dasar');
});

uji('INTI: stok MINUS tidak masuk rumus', () => {
  // Penjualan di sistem ini SENGAJA boleh membuat stok negatif. Memasukkan
  // angka negatif menghasilkan rata-rata negatif atau pembagian mendekati nol.
  const r = rataTertimbang([
    { qty: 10, unitCost: 12000, stokSebelum: 0 },
    { qty: 5, unitCost: 20000, stokSebelum: -30 }
  ]);
  assert.equal(r.rata, 20000, 'stok minus diperlakukan seperti nol');
  assert.ok(r.rata > 0);
});

uji('harga nol (barang gratis/sampel) sah, dan bukan "tanpa harga"', () => {
  const r = rataTertimbang([
    { qty: 10, unitCost: 10000, stokSebelum: 0 },
    { qty: 10, unitCost: 0, stokSebelum: 10 }
  ]);
  assert.equal(r.rata, 5000);
});

uji('harga negatif diabaikan', () => {
  const r = rataTertimbang([
    { qty: 10, unitCost: 10000, stokSebelum: 0 },
    { qty: 10, unitCost: -500, stokSebelum: 10 }
  ]);
  assert.equal(r.rata, 10000);
});

uji('belum ada nota berharga sama sekali -> null, bukan 0', () => {
  // 0 akan dibaca sebagai "bahannya gratis" dan dibandingkan dengan harga
  // master menghasilkan -100%.
  assert.equal(rataTertimbang([]).rata, null);
  assert.equal(rataTertimbang([{ qty: 5, unitCost: null, stokSebelum: 0 }]).rata, null);
  assert.equal(rataTertimbang(null).rata, null);
});

uji('qty nol atau tidak masuk akal dilewati', () => {
  const r = rataTertimbang([
    { qty: 0, unitCost: 99999, stokSebelum: 0 },
    { qty: -5, unitCost: 99999, stokSebelum: 0 },
    { qty: 10, unitCost: 8000, stokSebelum: 0 }
  ]);
  assert.equal(r.rata, 8000);
});

uji('harga master = harga beli ÷ isi kemasan', () => {
  assert.equal(hargaMaster({ purchase_price: 60000, purchase_qty: 5000 }), 12);
  assert.equal(hargaMaster({ purchase_price: 60000, purchase_qty: 0 }), null);
  assert.equal(hargaMaster({ purchase_price: null, purchase_qty: 5000 }), null);
  assert.equal(hargaMaster({}), null);
});

uji('perbandingan menyebut arah, bukan cuma angka', () => {
  const naik = bandingHarga({ purchase_price: 10000, purchase_qty: 1000 }, 12);
  assert.equal(naik.master, 10);
  assert.equal(naik.nota, 12);
  assert.equal(naik.selisih, 2);
  assert.equal(naik.persen, 20);
  assert.equal(naik.arah, 'naik');

  const turun = bandingHarga({ purchase_price: 10000, purchase_qty: 1000 }, 8);
  assert.equal(turun.arah, 'turun');
  assert.equal(turun.persen, -20);
});

uji('INTI: satu sisi belum ada -> menolak menebak', () => {
  // "0%" atau "-100%" untuk keadaan ini akan dibaca sebagai temuan, lalu
  // ditindaklanjuti orang.
  const tanpaNota = bandingHarga({ purchase_price: 10000, purchase_qty: 1000 }, null);
  assert.equal(tanpaNota.arah, 'tak-tahu');
  assert.equal(tanpaNota.persen, null);

  const tanpaMaster = bandingHarga({}, 12);
  assert.equal(tanpaMaster.arah, 'tak-tahu');
  assert.equal(tanpaMaster.persen, null);
  assert.equal(tanpaMaster.nota, 12, 'yang ada tetap disebut');
});

uji('ambang peninjauan memakai PERSEN, bukan rupiah', () => {
  // Rp50 pada bahan Rp200/gr = 25% (berarti). Rp50 pada Rp20.000/kg = 0,25%
  // (tidak berarti). Ambang rupiah akan membalik keduanya.
  assert.equal(perluDitinjau(bandingHarga({ purchase_price: 200, purchase_qty: 1 }, 250)), true);
  assert.equal(perluDitinjau(bandingHarga({ purchase_price: 20000, purchase_qty: 1 }, 20050)), false);
  assert.equal(perluDitinjau(bandingHarga({ purchase_price: 100, purchase_qty: 1 }, null)), false);
});

uji('ringkasan nota memisahkan baris yang belum berharga', () => {
  const r = ringkasNota([
    { qty: 2, unit_cost: 10000 },
    { qty: 3, unit_cost: 5000 },
    { qty: 1, unit_cost: null }
  ]);
  assert.equal(r.total, 35000);
  assert.equal(r.berharga, 2);
  assert.equal(r.tanpaHarga, 1);
  assert.equal(r.lengkap, false, 'total yang terlihat wajar padahal ada baris tanpa harga adalah angka yang paling mudah dipercaya dan paling salah');
});

uji('ringkasan nota yang semuanya berharga ditandai lengkap', () => {
  const r = ringkasNota([{ qty: 2, unit_cost: 10000 }]);
  assert.equal(r.lengkap, true);
  assert.equal(r.tanpaHarga, 0);
});

uji('masukan rusak tidak melempar', () => {
  assert.equal(ringkasNota(null).total, 0);
  assert.equal(ringkasNota([{}, null]).total, 0);
  assert.equal(ringkasNota([{ qty: 'x', unit_cost: 'y' }]).total, 0);
});

if (!process.exitCode) console.log(`Biaya rata-rata bahan: ${lulus} pemeriksaan lulus. ✅`);
