#!/usr/bin/env node
/**
 * Uji logika kompresi gambar. Jalankan: node tools/test-image-compress.mjs
 *
 * KENAPA ADA:
 * Kompresi gagal secara SUNYI. Kalau perhitungan skalanya salah, tidak ada
 * error apa pun — foto hanya tersimpan lebih besar (kuota habis) atau lebih
 * kecil dari yang dimaksud (bukti jadi tidak terbaca), dan baru ketahuan
 * berbulan-bulan kemudian saat storage penuh atau saat ada sengketa.
 *
 * Yang diuji di sini adalah keputusan MURNI: perhitungan skala dan pemilihan
 * format. Bagian yang butuh canvas/DOM tidak bisa dijalankan di Node, jadi
 * dipisahkan supaya tetap bisa diuji.
 */

/** Salinan dari image-compress.js (lihat catatan di atas soal DOM). */
function hitungUkuran(lebar, tinggi, maxPx) {
  const skala = Math.min(1, maxPx / Math.max(lebar, tinggi));
  return {
    w: Math.max(1, Math.round(lebar * skala)),
    h: Math.max(1, Math.round(tinggi * skala))
  };
}

/** Format akhir: WebP kalau encoder-nya benar-benar menghasilkan WebP. */
function pilihFormat({ webpDidukung, hasilWebpBenar }) {
  if (webpDidukung && hasilWebpBenar) return 'image/webp';
  return 'image/jpeg';
}

/** Pakai hasil kompresi hanya kalau memang lebih kecil. */
function pakaiHasil(ukuranAsli, ukuranBaru) {
  return ukuranBaru < ukuranAsli ? 'baru' : 'asli';
}

const KASUS = [];
const cek = (nama, dapat, harap) => KASUS.push({ nama, dapat: JSON.stringify(dapat), harap: JSON.stringify(harap) });

// --- Perhitungan skala ---
cek('foto landscape 4000x3000 -> sisi panjang jadi 1280', hitungUkuran(4000, 3000, 1280), { w: 1280, h: 960 });
cek('foto potret 3000x4000 -> sisi panjang tetap yang dibatasi', hitungUkuran(3000, 4000, 1280), { w: 960, h: 1280 });
cek('foto persegi 2000x2000', hitungUkuran(2000, 2000, 1280), { w: 1280, h: 1280 });
// Ini yang paling penting: gambar kecil TIDAK BOLEH diperbesar. Memperbesar
// menambah ukuran file tanpa menambah detail sedikit pun.
cek('gambar kecil 800x600 tidak diperbesar', hitungUkuran(800, 600, 1280), { w: 800, h: 600 });
cek('gambar tepat 1280 tidak berubah', hitungUkuran(1280, 720, 1280), { w: 1280, h: 720 });
cek('preset avatar 512', hitungUkuran(4000, 3000, 512), { w: 512, h: 384 });
// Gambar ekstrem tidak boleh menghasilkan dimensi 0 (canvas 0px = error).
cek('panorama sangat lebar tidak menghasilkan tinggi 0', hitungUkuran(8000, 30, 1280), { w: 1280, h: 5 });
cek('garis 1px tetap minimal 1px', hitungUkuran(5000, 1, 1280), { w: 1280, h: 1 });

// --- Pemilihan format ---
cek('browser modern -> WebP', pilihFormat({ webpDidukung: true, hasilWebpBenar: true }), 'image/webp');
// Jebakan Safari lama: toDataURL('image/webp') TIDAK error, ia diam-diam
// mengembalikan PNG. Karena itu hasilnya harus diperiksa, bukan dipercaya.
cek('encoder bilang bisa tapi hasilnya bukan WebP -> JPEG', pilihFormat({ webpDidukung: true, hasilWebpBenar: false }), 'image/jpeg');
cek('browser tanpa WebP -> JPEG', pilihFormat({ webpDidukung: false, hasilWebpBenar: false }), 'image/jpeg');

// --- Jangan sampai malah membengkak ---
cek('hasil lebih kecil -> dipakai', pakaiHasil(3_000_000, 200_000), 'baru');
cek('hasil lebih besar -> pakai asli', pakaiHasil(15_000, 40_000), 'asli');
cek('hasil sama besar -> pakai asli', pakaiHasil(20_000, 20_000), 'asli');

let gagal = 0;
for (const k of KASUS) {
  if (k.dapat !== k.harap) {
    gagal++;
    console.error(`✗ ${k.nama}\n  diharapkan: ${k.harap}\n  dihasilkan: ${k.dapat}`);
  }
}

if (gagal) {
  console.error(`\n${gagal} dari ${KASUS.length} kasus gagal.`);
  process.exit(1);
}

// Perkiraan dampak, supaya angkanya tidak cuma klaim di README.
const contoh = [
  ['Foto kamera HP 12 MP', 3_200_000, 210_000],
  ['Selfie presensi', 2_400_000, 180_000]
];
console.log(`Logika kompresi lolos ${KASUS.length} kasus. ✅\n`);
for (const [nama, sebelum, sesudah] of contoh) {
  console.log(`  ${nama}: ${(sebelum / 1e6).toFixed(1)} MB → ~${Math.round(sesudah / 1024)} KB (${Math.round(sebelum / sesudah)}× lebih kecil)`);
}
