/**
 * Pencocokan nama bahan & pembacaan angka saat impor resep.
 *
 * KELUHAN YANG MELAHIRKAN TES INI: "impor ditolak karena ada bahan yang belum
 * masuk, padahal bahannya sudah ada."
 *
 * Nama dicocokkan sebagai teks, dan teks dari Excel penuh karakter yang tidak
 * terlihat di layar: spasi ganda, spasi tanpa pemisah (U+00A0), karakter lebar
 * nol, huruf beraksen yang tersusun dari dua kode. Semuanya menghasilkan satu
 * gejala yang sama dan paling membingungkan — bahan yang JELAS TERLIHAT ada
 * dinyatakan tidak ditemukan, lalu orangnya mengetik ulang nama yang sebenarnya
 * sudah benar.
 *
 * Fungsinya DIIMPOR dari js/core/nama.js, bukan disalin: salinan akan tetap
 * hijau saat aslinya berubah.
 */
import { bakukanNama, bacaAngka } from '../js/core/nama.js';

let gagal = 0;
const cek = (nama, dapat, harap) => {
  if (dapat !== harap) {
    gagal++;
    console.error(`❌ ${nama}\n   dapat : ${JSON.stringify(dapat)}\n   harap : ${JSON.stringify(harap)}`);
  }
};
const sama = (nama, a, b) => cek(nama, bakukanNama(a) === bakukanNama(b), true);
const beda = (nama, a, b) => cek(nama, bakukanNama(a) === bakukanNama(b), false);

// --- Yang dulu sudah tertangani ---
sama('beda huruf besar-kecil', 'Gula Pasir', 'gula pasir');
sama('spasi di tepi', '  Gula Pasir  ', 'Gula Pasir');

// --- Penyebab tersering, dan semuanya tak terlihat di layar ---
sama('spasi ganda di tengah', 'Gula  Pasir', 'Gula Pasir');
sama('spasi tanpa pemisah (U+00A0) di tengah', 'Gula Pasir', 'Gula Pasir');
sama('karakter lebar nol (U+200B)', 'Gula​Pasir', 'GulaPasir');
sama('BOM/U+FEFF nyangkut di depan', '﻿Gula Pasir', 'Gula Pasir');
sama('tab dianggap spasi', 'Gula\tPasir', 'Gula Pasir');
sama('baris baru dari sel Excel', 'Gula\nPasir', 'Gula Pasir');
sama('é tersusun dua kode (dari Mac)', 'Café Latte', 'Café Latte');
sama('gabungan: spasi ganda + NBSP + huruf besar', ' SUSU  UHT  Full Cream ', 'susu uht full cream');

// --- Yang TIDAK boleh disamakan ---
//
// Menyatukan nama yang mirip akan menaruh bahan yang SALAH ke dalam resep, dan
// itu jauh lebih buruk daripada menolak dengan jelas: HPP-nya ikut salah, dan
// HPP dipakai untuk menentukan harga jual.
beda('gula pasir vs gula aren', 'Gula Pasir', 'Gula Aren');
beda('susu full cream vs susu skim', 'Susu Full Cream', 'Susu Skim');
beda('nama yang salah satunya lebih panjang', 'Kopi', 'Kopi Robusta');
beda('tanda baca tetap berarti', 'Sirup Gula (1L)', 'Sirup Gula 1L');
beda('angka berbeda', 'Cup 12oz', 'Cup 16oz');

// --- Nilai batas ---
cek('kosong tetap kosong', bakukanNama(''), '');
cek('null aman', bakukanNama(null), '');
cek('undefined aman', bakukanNama(undefined), '');
cek('angka jadi teks', bakukanNama(12), '12');
cek('hanya spasi jadi kosong', bakukanNama('      '), '');

// --- Bentuk bakunya dipakai sebagai KUNCI peta, jadi harus stabil ---
const daftar = ['Gula Pasir', 'Susu UHT', 'Kopi Robusta'];
const peta = new Map(daftar.map((n) => [bakukanNama(n), n]));
cek('nama dari Excel dengan NBSP tetap ketemu', peta.get(bakukanNama('Gula Pasir')), 'Gula Pasir');
cek('nama dengan spasi ganda tetap ketemu', peta.get(bakukanNama('Susu  UHT')), 'Susu UHT');
cek('nama yang memang tidak ada tetap tidak ketemu', peta.get(bakukanNama('Teh Hijau')), undefined);

// ---------------------------------------------------------------
// Angka dari sel Excel/CSV — jebakan yang sama diam-diamnya.
//
// Versi lama membuang semua selain angka dan titik, jadi "0,5" jadi 5 —
// SEPULUH KALI LIPAT, tanpa satu pun tanda. Resepnya masuk, HPP-nya dihitung
// dari jumlah yang salah, dan HPP itu dipakai menentukan harga jual.
// ---------------------------------------------------------------
cek('koma desimal ala Indonesia', bacaAngka('0,5'), 0.5);
cek('koma desimal dengan dua angka', bacaAngka('1,25'), 1.25);
cek('titik desimal ala Inggris tetap sama', bacaAngka('0.5'), 0.5);
cek('ribuan titik + desimal koma', bacaAngka('1.234,5'), 1234.5);
cek('ribuan koma + desimal titik', bacaAngka('1,234.5'), 1234.5);
cek('spasi sebagai pemisah ribuan', bacaAngka('2 500'), 2500);
cek('angka asli dari sel bertipe angka', bacaAngka(0.5), 0.5);
cek('nol tetap nol, bukan kosong', bacaAngka(0), 0);

// Tidak terbaca harus jadi null, BUKAN 0: jumlah nol yang terlihat sah tidak
// akan pernah dipertanyakan siapa pun sampai HPP-nya dipakai.
cek('teks bukan angka -> tidak terbaca', bacaAngka('abc'), null);
cek('sel kosong -> tidak terbaca', bacaAngka(''), null);
cek('hanya spasi -> tidak terbaca', bacaAngka('   '), null);
cek('hanya tanda minus -> tidak terbaca', bacaAngka('-'), null);
cek('null aman', bacaAngka(null), null);

// Dibiarkan ambigu dengan SENGAJA: menebaknya sebagai ribuan akan mengubah arti
// file yang selama ini sudah benar, dan salah tebak di sini meleset 1000×.
cek('"1.000" tetap dibaca 1 seperti sebelumnya', bacaAngka('1.000'), 1);

// ---------------------------------------------------------------
// Penyaring nama di tabel Produk & Resep memakai fungsi yang SAMA.
//
// Kalau penyaringnya memakai pencocokan lain, orang yang mengetik "gula pasir"
// untuk mencari "Gula  Pasir" akan menyimpulkan produknya tidak ada — persis
// kesalahan yang membuat impor menolak bahan yang jelas-jelas ada.
// ---------------------------------------------------------------
const cocokPenyaring = (namaBaris, ketikan) => bakukanNama(namaBaris).includes(bakukanNama(ketikan));
cek('cari sebagian nama', cocokPenyaring('Es Kopi Susu', 'kopi'), true);
cek('cari tanpa peduli huruf besar', cocokPenyaring('Es Kopi Susu', 'ES KOPI'), true);
cek('cari dengan spasi berlebih', cocokPenyaring('Es Kopi Susu', '  kopi  susu '), true);
cek('nama berspasi ganda tetap ketemu', cocokPenyaring('Gula  Pasir', 'gula pasir'), true);
cek('ketikan kosong mencocokkan semua', cocokPenyaring('Apa pun', ''), true);
cek('yang tidak cocok tetap tidak cocok', cocokPenyaring('Es Kopi Susu', 'teh'), false);

if (gagal) {
  console.error(`\n${gagal} kasus gagal.`);
  process.exit(1);
}
console.log('Pencocokan nama bahan benar untuk 43 kasus, termasuk karakter tak terlihat & koma desimal dari Excel. ✅');
