/**
 * AUDIT: markup yang dikirim ke dialog yang tidak merendernya.
 *
 * ============ BENTUK KEGAGALANNYA ============
 *
 * `confirmDialog` memasang `message` lewat `textContent` — default yang benar,
 * karena isinya sering memuat nama barang, nama orang, atau catatan yang
 * diketik staff.
 *
 * Tapi selama ini tidak ada pintu lain, jadi pemanggil yang perlu menebalkan
 * satu angka menulis `<strong>` di sana. Hasilnya tag mentahnya terpampang:
 *
 *     <p>Sudah dikirim untuk 2026-10-02.</p><p style="margin:6px 0 0">Kirim
 *     ulang paksa? …
 *
 * Tidak ada galat di mana pun. `textContent` mengerjakan persis apa yang
 * diminta; yang salah adalah anggapan pemanggilnya, dan tidak ada apa pun yang
 * memberitahunya. 14 tempat sudah begitu, sebagian sejak lama, dan tak satu pun
 * pernah dilaporkan — tagnya terbaca sebagai "aplikasinya memang begitu".
 *
 * Itu sebabnya audit ini menyapu SELURUH `js/`, bukan berkas yang kebetulan
 * sedang diperbaiki: bentuk ini akan lahir lagi di dialog berikutnya.
 */
const fs = require('fs');
const path = require('path');

const AKAR = path.dirname(__dirname);
let gagal = 0;
const salah = (pesan) => {
  gagal++;
  console.error(`❌ ${pesan}`);
};

/** Tag HTML sungguhan — `<strong>`, `<p style=…>`, `</p>`, `<br />`. */
const POLA_TAG = /<\/?[a-z][a-z0-9]*[ />]/i;

/**
 * Nilai properti `message:` di dalam sebuah pemanggilan dialog.
 *
 * Kurung kurawalnya dihitung, bukan dicari penutupnya dengan regex: badan
 * `confirmDialog` sering memuat objek lain di dalamnya, dan regex yang
 * berhenti di `}` pertama akan memotong nilainya di tengah lalu melaporkan
 * "bersih" untuk teks yang belum selesai dibaca.
 */
function nilaiMessage(teks, mulai) {
  const buka = teks.indexOf('{', mulai);
  if (buka < 0) return null;
  let depth = 0;
  let k = buka;
  for (; k < teks.length; k++) {
    if (teks[k] === '{') depth++;
    else if (teks[k] === '}') {
      depth--;
      if (depth === 0) {
        k++;
        break;
      }
    }
  }
  const blok = teks.slice(buka, k);
  // `message:` HARUS yang berdiri sendiri — `messageHtml:` juga memuatnya
  // sebagai awalan, dan tanpa penjaga ini setiap perbaikan justru terbaca
  // sebagai pelanggaran.
  const m = blok.match(/(^|[^a-zA-Z])message:/);
  if (!m) return null;
  const mi = blok.indexOf(m[0]) + m[0].length - 'message:'.length;
  const sisa = blok.slice(mi);
  const akhir = sisa.search(/\n\s*(confirmText|cancelText|danger|title|onReady|messageHtml)\s*:/);
  return akhir > 0 ? sisa.slice(0, akhir) : sisa;
}

const berkasJs = [];
(function walk(d) {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.js')) berkasJs.push(p);
  }
})(path.join(AKAR, 'js'));

if (berkasJs.length < 50) {
  salah(`hanya ${berkasJs.length} berkas js/ terbaca — audit ini kehilangan sasarannya.`);
}

// ---------------------------------------------------------------
// 1. `message:` TIDAK BOLEH MEMUAT TAG.
// ---------------------------------------------------------------
let diperiksa = 0;
for (const p of berkasJs) {
  const teks = fs.readFileSync(p, 'utf8');
  let i = -1;
  while ((i = teks.indexOf('confirmDialog(', i + 1)) >= 0) {
    const nilai = nilaiMessage(teks, i);
    if (nilai == null) continue;
    diperiksa++;
    if (POLA_TAG.test(nilai)) {
      const baris = teks.slice(0, i).split('\n').length;
      salah(
        `${path.relative(AKAR, p)}:${baris} — \`message:\` memuat tag HTML. Ia dipasang lewat \`textContent\`, jadi ` +
          'tagnya akan TERBACA oleh pengguna sebagai teks biasa. Pakai `messageHtml:` kalau markupnya memang disengaja ' +
          '(dan escape sendiri apa pun yang berasal dari pengguna).'
      );
    }
  }
}

if (diperiksa === 0) {
  salah('tidak satu pun pemanggilan `confirmDialog` dengan `message:` ketemu — pembaca blok ini tidak bekerja, dan "bersih" di sini tidak berarti apa-apa.');
}

// ---------------------------------------------------------------
// 2. `ui.js` benar-benar menyediakan dua pintunya.
// ---------------------------------------------------------------
const ui = fs.readFileSync(path.join(AKAR, 'js/core/ui.js'), 'utf8');

if (!/messageHtml = ''/.test(ui)) {
  salah('js/core/ui.js: `confirmDialog` tidak lagi menerima `messageHtml` — setiap pemanggil yang memakainya diam-diam kehilangan seluruh pesannya.');
}
if (!/kotakTeks\.innerHTML = messageHtml/.test(ui)) {
  salah('js/core/ui.js: `messageHtml` diterima tapi tidak pernah dipasang. Pesannya hilang sama sekali — lebih buruk daripada tag yang terbaca.');
}
// ============ `message` HARUS TETAP textContent ============
//
// Melonggarkannya jadi innerHTML "supaya semua pemanggil lama ikut benar"
// adalah perbaikan yang membuka lubang: nama barang & catatan staff masuk ke
// sana apa adanya, dan satu nama yang memuat `<img onerror=…>` jadi jalan masuk.
if (!/kotakTeks\.textContent = message/.test(ui)) {
  salah(
    'js/core/ui.js: `message` tidak lagi dipasang lewat `textContent`. Isinya memuat nama barang & catatan yang ' +
      'diketik staff — melonggarkannya jadi innerHTML menukar satu tampilan jelek dengan satu jalan masuk.'
  );
}
if (/\.modal-text'\)\.innerHTML = message[^H]/.test(ui)) {
  salah('js/core/ui.js: `message` dipasang lewat innerHTML.');
}

console.log('');
if (gagal === 0) console.log(`${diperiksa} pemanggilan dialog diperiksa; tidak ada markup yang nyasar ke jalur teks. ✅`);
else console.error(`${gagal} masalah ditemukan.`);
process.exit(gagal === 0 ? 0 : 1);
