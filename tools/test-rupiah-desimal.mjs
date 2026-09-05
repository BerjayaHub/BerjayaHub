/**
 * Tes: kotak Rupiah yang BOLEH pecahan.
 *
 * `formatThousands` yang sudah ada membuang semua non-digit — cocok untuk
 * rupiah bulat, tapi menghancurkan harga bahan per satuan-pakai: cabai
 * Rp13,80/gram akan tersimpan sebagai Rp1.380.
 *
 * Yang diuji di sini justru perbatasannya, tempat kesalahan tidak kelihatan:
 *
 *   - koma yang BARU diketik (`13,`) tidak boleh lenyap, kalau tidak komanya
 *     mustahil diketik sama sekali;
 *   - kosong harus jadi `null`, BUKAN 0 — nol berarti barangnya gratis, dan itu
 *     ikut menimbang biaya rata-rata bahan;
 *   - format lalu baca harus bolak-balik tanpa kehilangan angka.
 */
import assert from 'node:assert/strict';
import { formatRibuanDesimal, bacaRupiah, formatThousands } from '../js/core/format.js';

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

uji('ribuan diberi titik', () => {
  assert.equal(formatRibuanDesimal('13800'), '13.800');
  assert.equal(formatRibuanDesimal('1234567'), '1.234.567');
  assert.equal(formatRibuanDesimal('999'), '999');
});

uji('INTI: desimal koma dipertahankan', () => {
  // Inilah yang membedakannya dari `formatThousands`, yang membuang komanya
  // dan mengubah 13,80 jadi 1.380 — seratus kali lipat.
  assert.equal(formatRibuanDesimal('13800,5'), '13.800,5');
  assert.equal(formatRibuanDesimal('0,05'), '0,05');
  assert.equal(formatThousands('13,80'), '1.380', 'formatThousands memang begitu — itu sebabnya ada yang baru');
});

uji('INTI: koma yang baru diketik tidak lenyap', () => {
  // Kalau `13,` dirapikan jadi `13`, komanya mustahil diketik: tiap kali
  // ditekan ia hilang sebelum digit berikutnya sempat masuk.
  assert.equal(formatRibuanDesimal('13,'), '13,');
  assert.equal(formatRibuanDesimal('13800,'), '13.800,');
});

uji('koma kedua dan seterusnya dibuang', () => {
  // "1,2,3" yang lolos ke parser menghasilkan angka yang tidak bisa ditebak
  // siapa pun.
  assert.equal(formatRibuanDesimal('1,2,3'), '1,23');
  assert.equal(bacaRupiah('1,2,3'), 1.23);
});

uji('huruf & simbol dibuang', () => {
  assert.equal(formatRibuanDesimal('Rp 13.800'), '13.800');
  assert.equal(formatRibuanDesimal('abc'), '');
});

uji('INTI: kosong jadi null, BUKAN 0', () => {
  // Nol berarti barangnya gratis, dan itu ikut menimbang biaya rata-rata.
  assert.equal(bacaRupiah(''), null);
  assert.equal(bacaRupiah('   '), null);
  assert.equal(bacaRupiah(null), null);
  assert.equal(bacaRupiah(undefined), null);
  assert.equal(bacaRupiah('abc'), null);
  assert.equal(bacaRupiah(','), null);
});

uji('nol yang DIKETIK tetap nol', () => {
  // Barang gratis/sampel memang ada, dan itu pernyataan yang berbeda dari
  // "belum diisi".
  assert.equal(bacaRupiah('0'), 0);
  assert.equal(bacaRupiah('0,00'), 0);
});

uji('format lalu baca kembali ke angka yang sama', () => {
  for (const n of [12, 13.8, 0.05, 1234567.89, 999, 0]) {
    const teks = formatRibuanDesimal(String(n).replace('.', ','));
    assert.equal(bacaRupiah(teks), n, `bolak-balik gagal untuk ${n} (lewat "${teks}")`);
  }
});

uji('angka yang sudah terformat tidak rusak saat diformat lagi', () => {
  // Ini terjadi tiap ketukan tombol: nilainya sudah rapi, lalu dirapikan lagi.
  let v = '1.234.567,89';
  for (let i = 0; i < 5; i++) v = formatRibuanDesimal(v);
  assert.equal(v, '1.234.567,89');
});

if (!process.exitCode) console.log(`Kotak Rupiah desimal: ${lulus} pemeriksaan lulus. ✅`);
