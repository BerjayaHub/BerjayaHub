/**
 * Pencocokan NAMA yang ditulis manusia — dipisah ke core supaya BISA DIUJI.
 *
 * `product-import.js` mengimpor klien Supabase, yang mengimpor dari CDN,
 * sehingga tidak bisa dijalankan di luar browser. Aturan yang tidak bisa diuji
 * hanya diperiksa dengan cara membacanya ulang — dan aturan inilah yang membuat
 * impor menolak bahan yang jelas-jelas sudah ada.
 *
 * Tidak ada impor di file ini, dan sebaiknya tetap begitu.
 */

/**
 * Bentuk baku sebuah nama, untuk MEMBANDINGKAN — bukan untuk ditampilkan.
 *
 * KENAPA TIDAK CUKUP `trim().toLowerCase()`. Nama yang dipakai orang datang dari
 * Excel, dan Excel penuh karakter yang tidak kelihatan di layar:
 *
 *   - SPASI GANDA di tengah nama. "Gula  Pasir" dan "Gula Pasir" terlihat sama
 *     persis di sel, tapi bagi kode itu dua nama berbeda.
 *   - SPASI TANPA PEMISAH (U+00A0), yang muncul begitu saja saat menyalin dari
 *     web atau dari WhatsApp. `trim()` membuangnya di tepi, tapi tidak di tengah.
 *   - KARAKTER LEBAR NOL (U+200B/FEFF). Benar-benar tidak terlihat, dan tidak
 *     dihitung sebagai spasi oleh `trim()`.
 *   - HURUF BERAKSEN yang tersusun dari dua kode (é = e + tanda) saat berasal
 *     dari Mac. Terlihat identik, dibandingkan sebagai string berbeda.
 *
 * Semua itu menghasilkan gejala yang sama dan paling membingungkan: *"bahan
 * tidak ditemukan"* untuk bahan yang jelas-jelas terlihat ada di daftar.
 * Orangnya lalu mengetik ulang nama yang sudah benar, berkali-kali.
 *
 * Yang TIDAK dilakukan di sini: membuang tanda baca atau menyamakan kata yang
 * mirip. "Gula Pasir" dan "Gula Aren" harus tetap berbeda — menyatukannya akan
 * menaruh bahan yang salah ke dalam resep, dan itu jauh lebih buruk daripada
 * menolak dengan jelas.
 */
export function bakukanNama(teks) {
  return String(teks ?? '')
    .normalize('NFKC') // é dua kode -> é satu kode
    .replace(/[\u200B-\u200D\uFEFF]/g, '') // karakter lebar nol
    .replace(/\s+/g, ' ') // termasuk U+00A0; spasi ganda jadi tunggal
    .trim()
    .toLowerCase();
}

/**
 * Nama yang PALING MIRIP dari daftar, untuk menuntun saat tidak ketemu.
 *
 * Pesan "bahan tidak ditemukan" saja membuat orang mengetik ulang nama yang
 * sebenarnya sudah benar. Menyebut kandidat terdekatnya mengubah pertanyaan
 * "kenapa aplikasinya tidak menemukan?" jadi "oh, di master namanya sedikit
 * berbeda".
 *
 * Jaraknya dihitung sederhana (Levenshtein) dan hanya dipakai untuk MENYARANKAN
 * — tidak pernah untuk memilih otomatis.
 */
export function palingMirip(target, kandidat) {
  const t = bakukanNama(target);
  if (!t) return null;
  const tanpaSpasi = t.replace(/ /g, '');
  let terbaik = null;
  let jarakTerbaik = Infinity;
  for (const nama of kandidat) {
    const n = bakukanNama(nama);
    if (n.replace(/ /g, '') === tanpaSpasi) return nama; // cuma beda spasi
    const d = jarakEdit(t, n);
    if (d < jarakTerbaik) {
      jarakTerbaik = d;
      terbaik = nama;
    }
  }
  // Ambang 3: cukup untuk salah ketik atau beda imbuhan, tapi tidak sampai
  // menyarankan nama yang sama sekali lain.
  return jarakTerbaik <= 3 ? terbaik : null;
}

function jarakEdit(a, b) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 3) return 99; // pasti di luar ambang
  const baris = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let sebelumnya = baris[0];
    baris[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const simpan = baris[j];
      baris[j] = Math.min(baris[j] + 1, baris[j - 1] + 1, sebelumnya + (a[i - 1] === b[j - 1] ? 0 : 1));
      sebelumnya = simpan;
    }
  }
  return baris[b.length];
}


/**
 * Angka yang ditulis manusia di Excel/CSV.
 *
 * KENAPA TIDAK CUKUP MEMBUANG SEMUA SELAIN ANGKA DAN TITIK. Versi sebelumnya
 * melakukan itu, dan hasilnya salah untuk cara orang Indonesia menulis angka:
 *
 *     "0,5"   -> 5      (seharusnya 0.5 — sepuluh kali lipat!)
 *     "1,25"  -> 125
 *     "1.000" -> 1
 *
 * Di file .xlsx yang selnya benar-benar bertipe angka, ini tidak pernah muncul:
 * SheetJS sudah mengembalikan angka. Ia muncul di CSV, dan di sel yang
 * kebetulan berformat teks — dan tidak meninggalkan jejak apa pun. Resepnya
 * masuk, HPP-nya dihitung dari jumlah yang salah, dan HPP itu dipakai untuk
 * menentukan harga jual.
 *
 * ATURANNYA:
 *   - Kalau ADA titik DAN koma, yang PALING KANAN adalah pemisah desimal.
 *     ("1.234,5" -> 1234.5 ; "1,234.5" -> 1234.5)
 *   - Kalau hanya ada koma, koma itu desimal. Ini konteks Indonesia; "0,5"
 *     jauh lebih sering berarti setengah daripada lima ratus.
 *   - Kalau hanya ada titik, titik itu desimal — sama seperti sebelumnya, jadi
 *     file lama tetap terbaca sama.
 *
 * Yang TERSISA ambigu dengan sengaja: "1.000" tetap dibaca 1, bukan seribu.
 * Menebaknya sebagai ribuan akan mengubah arti file yang selama ini sudah
 * benar, dan menebak salah di sini berarti angka resep meleset seribu kali.
 */
export function bacaAngka(v) {
  if (v === '' || v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;

  let t = String(v).trim();
  if (!t) return null;

  const titik = t.lastIndexOf('.');
  const koma = t.lastIndexOf(',');
  if (titik >= 0 && koma >= 0) {
    // Yang paling kanan = desimal; yang lain pemisah ribuan.
    const desimal = titik > koma ? '.' : ',';
    const ribuan = desimal === '.' ? ',' : '.';
    t = t.split(ribuan).join('').replace(desimal, '.');
  } else if (koma >= 0) {
    t = t.replace(',', '.');
  }

  const bersih = t.replace(/[^\d.-]/g, '');
  // Tanpa satu pun angka -> BUKAN nol, tapi "tidak terbaca". Mengembalikan 0
  // membuat sel yang salah ketik tersimpan sebagai jumlah nol yang terlihat
  // sah, dan resep dengan bahan berjumlah nol tidak akan pernah dipertanyakan
  // siapa pun sampai HPP-nya dipakai.
  if (!/\d/.test(bersih)) return null;
  const n = Number(bersih);
  return Number.isFinite(n) ? n : null;
}
