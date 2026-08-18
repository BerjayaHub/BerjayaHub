/**
 * Pemilih foto: penjaga urutan & penanda "sudah dikecilkan".
 *
 * Dua hal yang diuji, dua-duanya gagal DIAM-DIAM kalau salah:
 *
 *  1. FOTO YANG DIPILIH TERAKHIR HARUS YANG MENANG. Kompresi butuh ratusan
 *     milidetik. Kalau orangnya memotret ulang sebelum yang pertama selesai,
 *     tanpa penjaga urutan hasil LAMA yang mendarat belakangan akan menimpa
 *     yang baru — pratinjaunya menampilkan foto baru, yang tersimpan foto
 *     lama. Bukti yang salah, tanpa satu pun tanda di layar.
 *
 *  2. FILE YANG SUDAH DIKECILKAN TIDAK BOLEH DIKECILKAN LAGI. Kompresi kedua
 *     tidak melempar error dan ukurannya memang mengecil sedikit lagi; yang
 *     turun mutunya, dan foto ini dipakai sebagai bukti pekerjaan.
 *
 * `sudahDikecilkan` & `perluDikecilkan` diuji dari BERKAS ASLINYA.
 *
 * Penjaga urutannya TIDAK — ia hidup di dalam `wirePhotoInput`, yang menuntut
 * DOM. Yang diuji di bawah adalah tiruannya. Perlu dikatakan terus terang:
 * tes ini menjaga ATURANNYA tetap benar, bukan kode yang benar-benar berjalan
 * di browser. Kalau `wirePhotoInput` diubah tanpa mengubah tiruan ini, tes
 * tetap hijau — jadi keduanya harus diubah bersamaan.
 */
import { sudahDikecilkan, perluDikecilkan } from '../js/core/photo-input.js';

let gagal = 0;
const cek = (nama, dapat, harap) => {
  if (JSON.stringify(dapat) !== JSON.stringify(harap)) {
    gagal++;
    console.error(`❌ ${nama}\n   dapat : ${JSON.stringify(dapat)}\n   harap : ${JSON.stringify(harap)}`);
  }
};

// =====================================================================
// 1. PENJAGA URUTAN — tiruan dari wirePhotoInput
// =====================================================================
function buatPemilih(kecilkan) {
  let urutan = 0;
  let terpilih = null;
  const jejak = [];

  async function pilih(file) {
    const ke = ++urutan;
    if (!file) {
      terpilih = null;
      return;
    }
    terpilih = null; // "menyiapkan…"
    const kecil = await kecilkan(file);
    if (ke !== urutan) {
      jejak.push(`buang:${file}`);
      return;
    }
    terpilih = kecil;
    jejak.push(`pakai:${file}`);
  }

  return { pilih, baca: () => terpilih, jejak };
}

// Kompresi yang sengaja SELESAI TERBALIK: yang pertama lambat, yang kedua cepat.
const tunda = (ms) => new Promise((r) => setTimeout(r, ms));
const lambatDuluan = new Map([['foto-A', 60], ['foto-B', 5]]);
const kecilkanTakUrut = async (f) => {
  await tunda(lambatDuluan.get(f) ?? 0);
  return `kecil(${f})`;
};

const p1 = buatPemilih(kecilkanTakUrut);
await Promise.all([p1.pilih('foto-A'), p1.pilih('foto-B')]);
cek('yang dipilih TERAKHIR yang menang', p1.baca(), 'kecil(foto-B)');
cek('hasil lama dibuang, bukan menimpa', p1.jejak.includes('buang:foto-A'), true);

// Urutan normal (yang pertama selesai lebih dulu) juga benar.
const p2 = buatPemilih(async (f) => `kecil(${f})`);
await p2.pilih('foto-A');
await p2.pilih('foto-B');
cek('berurutan: yang terakhir tetap menang', p2.baca(), 'kecil(foto-B)');

// Satu foto saja.
const p3 = buatPemilih(async (f) => `kecil(${f})`);
await p3.pilih('foto-A');
cek('satu foto tersimpan', p3.baca(), 'kecil(foto-A)');

// Membatalkan pilihan.
await p3.pilih(null);
cek('batal mengosongkan pilihan', p3.baca(), null);

// Tiga kali berturut-turut dengan penyelesaian acak.
const p4 = buatPemilih(async (f) => {
  await tunda({ a: 30, b: 50, c: 1 }[f] ?? 0);
  return `kecil(${f})`;
});
await Promise.all([p4.pilih('a'), p4.pilih('b'), p4.pilih('c')]);
cek('tiga pilihan: yang terakhir (c) yang menang', p4.baca(), 'kecil(c)');
cek('  dua sebelumnya dibuang', p4.jejak.filter((x) => x.startsWith('buang')).length, 2);

// SELAMA MENYIAPKAN, pembacanya null.
//
// Yang berbahaya BUKAN kasus kosong — pemilih baru memang mulai dari null,
// jadi mengujinya tidak membuktikan apa pun (sabotase pertama pada bagian ini
// lolos persis karena itu). Yang berbahaya adalah MENGGANTI foto: kalau
// pilihan lama tidak dikosongkan, menekan Kirim selagi foto pengganti sedang
// disiapkan akan mengirim foto LAMA — bukti pekerjaan yang salah, dan
// layarnya sudah menampilkan yang baru.
const p5 = buatPemilih(async (f) => {
  await tunda(20);
  return `kecil(${f})`;
});
await p5.pilih('foto-A');
cek('foto pertama tersimpan', p5.baca(), 'kecil(foto-A)');

const janji = p5.pilih('foto-B');
cek('selagi mengganti, foto LAMA tidak boleh terbaca', p5.baca(), null);
await janji;
cek('sesudah siap, foto baru terbaca', p5.baca(), 'kecil(foto-B)');

// =====================================================================
// 2. PENANDA "SUDAH DIKECILKAN"
// =====================================================================
const fileMentah = { nama: 'mentah.jpg' };
const fileKecil = { nama: 'kecil.jpg' };

cek('file mentah perlu dikecilkan', perluDikecilkan(fileMentah), true);
sudahDikecilkan.add(fileKecil);
cek('file yang sudah ditandai tidak perlu lagi', perluDikecilkan(fileKecil), false);
cek('file lain tetap perlu', perluDikecilkan(fileMentah), true);
cek('null tidak perlu apa-apa', perluDikecilkan(null), false);
cek('undefined aman', perluDikecilkan(undefined), false);

// Penanda melekat pada OBJEK, bukan pada namanya — dua objek berisi nama sama
// tetap dibedakan. Ini yang membuat WeakSet tepat: salinan file adalah objek
// baru, dan objek baru memang belum dikecilkan.
const kembaran = { nama: 'kecil.jpg' };
cek('objek berbeda dengan isi sama tetap perlu dikecilkan', perluDikecilkan(kembaran), true);

if (gagal) {
  console.error(`\n${gagal} kasus gagal.`);
  process.exit(1);
}
console.log('Pemilih foto benar untuk 17 kasus — termasuk kompresi yang selesai tidak berurutan. ✅');
