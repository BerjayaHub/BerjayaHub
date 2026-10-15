/**
 * AUDIT: backtick di dalam komentar HTML, di dalam template literal.
 *
 * ============ GEJALA YANG MELAHIRKAN BERKAS INI ============
 *
 *   "modul ekspor esb hanya memuat, saya tunggu sekitar 5 menit tidak ada
 *    perubahan"
 *
 * Konsol browser menjawabnya dalam satu baris:
 *
 *   ReferenceError: details is not defined
 *     at renderEsbAdmin (esb.admin.js:346)
 *
 * Sebabnya satu komentar HTML di dalam sebuah template literal:
 *
 *   container.innerHTML = `
 *     <!-- ... ia tidak membuka tujuh `<details>` satu per satu ... -->
 *   `;
 *
 * Backtick pertama MENUTUP template literalnya. `<details>` lalu dibaca
 * sebagai ekspresi JavaScript — perbandingan `<` dengan variabel `details` —
 * dan backtick kedua MEMBUKA template baru.
 *
 * ============ KENAPA `audit-syntax` TIDAK MENANGKAPNYA ============
 *
 * Karena backticknya BERPASANGAN. Berkasnya tetap sah sebagai ES module, dan
 * `audit-syntax` memang hanya memeriksa itu. Yang hancur bukan sintaksnya
 * melainkan ARTINYA, dan itu baru meledak saat barisnya dijalankan.
 *
 * Akibatnya persis bentuk kegagalan yang paling mahal di repo ini: galatnya
 * dilempar SEBELUM `container.innerHTML` diganti, jadi kerangka "Memuat…"
 * bertahan di layar. Orang yang melihatnya menunggu lima menit, bukan melapor.
 *
 * ============ INI SUDAH KETIGA KALINYA ============
 *
 * Pertama di `dispatch.page.js`, juga di komentar HTML. Keduanya "diperbaiki"
 * dengan menulis ulang komentarnya dan mencatat sebabnya — tanpa ada yang
 * menjaga supaya tidak terulang. Maka terulang.
 *
 * Catatan di komentar bukan penjaga. Berkas inilah penjaganya.
 */
const fs = require('fs');
const path = require('path');

const AKAR = path.dirname(__dirname);
let gagal = 0;
let diperiksa = 0;
const salah = (pesan) => {
  gagal++;
  console.error(`❌ ${pesan}`);
};

/** Semua .js di js/, rekursif. */
function berkasJs(dir, hasil = []) {
  for (const nama of fs.readdirSync(dir)) {
    const p = path.join(dir, nama);
    const st = fs.statSync(p);
    if (st.isDirectory()) berkasJs(p, hasil);
    else if (nama.endsWith('.js')) hasil.push(p);
  }
  return hasil;
}

/**
 * Cari komentar HTML `<!-- ... -->` yang BERADA DI DALAM template literal, dan
 * memuat backtick.
 *
 * Caranya sederhana dan sengaja begitu: pemindai karakter yang melacak apakah
 * kita sedang di dalam template literal. Mem-parse JS sungguhan lebih tepat,
 * tapi jauh lebih berat untuk satu aturan — dan aturan yang terlalu mahal
 * dijalankan adalah aturan yang dimatikan orang.
 *
 * Yang DIABAIKAN dengan sadar: backtick di dalam komentar JavaScript biasa —
 * baik yang satu baris maupun yang blok. Di sana ia memang cuma teks, dan
 * seluruh repo ini penuh dengan komentar bergaya `kode` yang sah.
 *
 * (Catatan kecil yang pantas ditinggalkan: versi pertama paragraf ini menulis
 * contoh pembuka-penutup komentar blok apa adanya — dan urutan bintang-garis
 * itu MENUTUP komentar ini di tengah jalan, membuat auditnya sendiri gagal
 * dimuat. Berkas tentang jebakan sintaks komentar, dirusak jebakan sintaks
 * komentar.)
 */
function cariBacktickDalamKomentarHtml(isi) {
  const temuan = [];
  let i = 0;
  let diTemplate = false;
  let barisAwalKomentar = 0;

  const barisKe = (idx) => isi.slice(0, idx).split('\n').length;

  while (i < isi.length) {
    const c = isi[i];

    // Lewati komentar JS biasa — backtick di sana tidak berbahaya.
    if (!diTemplate && c === '/' && isi[i + 1] === '/') {
      const akhir = isi.indexOf('\n', i);
      i = akhir < 0 ? isi.length : akhir;
      continue;
    }
    if (!diTemplate && c === '/' && isi[i + 1] === '*') {
      const akhir = isi.indexOf('*/', i + 2);
      i = akhir < 0 ? isi.length : akhir + 2;
      continue;
    }
    // Lewati string biasa.
    if (!diTemplate && (c === "'" || c === '"')) {
      i++;
      while (i < isi.length && isi[i] !== c) {
        if (isi[i] === '\\') i++;
        i++;
      }
      i++;
      continue;
    }

    if (c === '\\') {
      i += 2;
      continue;
    }

    if (c === '`') {
      diTemplate = !diTemplate;
      i++;
      continue;
    }

    // Di dalam template literal: temukan komentar HTML dan periksa isinya.
    if (diTemplate && c === '<' && isi.startsWith('<!--', i)) {
      barisAwalKomentar = barisKe(i);
      const akhir = isi.indexOf('-->', i + 4);
      const batas = akhir < 0 ? isi.length : akhir;
      const badan = isi.slice(i + 4, batas);
      if (badan.includes('`')) {
        temuan.push({ baris: barisAwalKomentar, cuplikan: badan.split('\n').find((b) => b.includes('`'))?.trim() ?? '' });
      }
      // ============ MAJU SAMPAI SESUDAH `-->` ============
      //
      // Dan JANGAN mengubah `diTemplate` di sepanjang jalan, walau ada
      // backtick di dalamnya. Komentarnya memang sedang salah — tapi kalau
      // pemindai ikut terbalik di sini, seluruh berkas sesudahnya terbaca
      // dengan keadaan yang salah dan auditnya melaporkan temuan karangan di
      // tempat-tempat yang tidak bermasalah.
      i = akhir < 0 ? isi.length : akhir + 3;
      continue;
    }

    i++;
  }
  return temuan;
}

for (const p of berkasJs(path.join(AKAR, 'js'))) {
  diperiksa++;
  const rel = path.relative(AKAR, p).replace(/\\/g, '/');
  const isi = fs.readFileSync(p, 'utf8');
  for (const t of cariBacktickDalamKomentarHtml(isi)) {
    salah(
      `${rel}:${t.baris} — backtick di dalam komentar HTML, di dalam template literal.\n` +
        `   ${t.cuplikan}\n` +
        '   Backtick pertama MENUTUP template literalnya; isi sesudahnya dibaca sebagai JavaScript.\n' +
        '   Sintaksnya tetap sah kalau backticknya berpasangan, jadi audit-syntax lulus — galatnya\n' +
        '   baru meledak saat barisnya dijalankan, SEBELUM innerHTML diganti, dan layarnya berhenti\n' +
        '   di kerangka "Memuat…" selamanya. Tulis namanya tanpa backtick.'
    );
  }
}

console.log('');
if (gagal === 0) console.log(`${diperiksa} berkas diperiksa. Tidak ada backtick liar di komentar HTML. ✅`);
else console.error(`${gagal} komentar HTML memuat backtick di dalam template literal.`);
process.exit(gagal === 0 ? 0 : 1);
