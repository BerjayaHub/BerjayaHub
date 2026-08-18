#!/usr/bin/env node
/**
 * AUDIT: pemulihan layar harus dibaca lewat `mulaiModul()`, bukan sendiri-sendiri.
 *
 * ============ BUG YANG DICEGAH ============
 *
 * `ingatModul(kode)` menulis ingatan yang BERSIH — itu memang tugasnya. Jadi
 * apa pun yang dibaca SESUDAHNYA pasti kosong:
 *
 *     ingatModul(code);                 // ingatan dikosongkan
 *     ...
 *     const ingatan = konteksTerakhir(code);   // ← selalu null
 *
 * Aturan itu tidak pernah tertulis, dan sudah menelan satu perbaikan utuh.
 * Ingatan outlet ditambahkan supaya pemulihan Daily Activities tidak mendarat
 * di outlet yang salah — tapi halamannya membaca `konteksTerakhir()` dari
 * dalam dirinya sendiri, yang dijalankan `openModule()` SESUDAH `ingatModul()`.
 *
 * Akibatnya fiturnya tidak pernah hidup sedetik pun. Tidak ada error, tidak
 * ada nilai aneh, dan seluruh tes tetap hijau — karena tesnya menguji modul
 * ingatannya secara terpisah, bukan urutan pemakaiannya.
 *
 * Yang gagal bukan kodenya, melainkan asumsinya. Dan asumsi tidak bisa diuji
 * dengan menguji potongan-potongannya satu per satu.
 *
 * ============ ATURANNYA ============
 *
 * `gulirTerakhir` / `layarTerakhir` / `konteksTerakhir` hanya boleh dipanggil
 * dari `core/ingatan-layar.js` sendiri. Semua yang lain memakai `mulaiModul()`,
 * yang membaca dulu lalu mengosongkan dalam satu langkah — sehingga urutannya
 * tidak lagi bisa salah.
 */

const fs = require('fs');
const path = require('path');

const AKAR = path.resolve(__dirname, '..');
const DIR_JS = path.join(AKAR, 'js');
const SUMBER = path.join(DIR_JS, 'core', 'ingatan-layar.js');

const PEMBACA = ['gulirTerakhir', 'layarTerakhir', 'konteksTerakhir'];

function berkasJs(dir, hasil = []) {
  for (const nama of fs.readdirSync(dir)) {
    const p = path.join(dir, nama);
    if (fs.statSync(p).isDirectory()) berkasJs(p, hasil);
    else if (nama.endsWith('.js')) hasil.push(p);
  }
  return hasil;
}

/** Buang komentar supaya penjelasan tentang bug ini tidak ikut terhitung. */
function tanpaKomentar(teks) {
  let out = '';
  let kutip = null;
  for (let i = 0; i < teks.length; i++) {
    const c = teks[i];
    const d = teks[i + 1];
    if (kutip) {
      if (c === '\\') {
        out += '  ';
        i++;
        continue;
      }
      if (c === kutip) kutip = null;
      out += c;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      kutip = c;
      out += c;
      continue;
    }
    if (c === '/' && d === '/') {
      while (i < teks.length && teks[i] !== '\n') i++;
      out += '\n';
      continue;
    }
    if (c === '/' && d === '*') {
      i += 2;
      while (i < teks.length && !(teks[i] === '*' && teks[i + 1] === '/')) i++;
      i++;
      out += ' ';
      continue;
    }
    out += c;
  }
  return out;
}

const temuan = [];
let diperiksa = 0;

for (const p of berkasJs(DIR_JS)) {
  if (path.resolve(p) === SUMBER) continue; // yang mendefinisikannya
  const rel = path.relative(AKAR, p).replace(/\\/g, '/');
  const isi = tanpaKomentar(fs.readFileSync(p, 'utf8'));

  for (const nama of PEMBACA) {
    const re = new RegExp(`\\b${nama}\\s*\\(`, 'g');
    let m;
    while ((m = re.exec(isi))) {
      diperiksa++;
      const baris = isi.slice(0, m.index).split('\n').length;
      temuan.push(
        `${rel}:${baris} — memanggil ${nama}() langsung. Nilainya akan kosong kalau ingatModul() sudah jalan lebih dulu.`
      );
    }
  }
}

// Sanity: `mulaiModul` harus benar-benar ada dan benar-benar dipakai. Audit
// yang menyuruh memakai fungsi yang tidak ada hanya menghasilkan kebingungan.
const sumber = fs.readFileSync(SUMBER, 'utf8');
if (!/export function mulaiModul\b/.test(sumber)) {
  console.error('❌ core/ingatan-layar.js tidak lagi mengekspor mulaiModul() — audit ini kehilangan penggantinya.');
  process.exit(1);
}
const pemakai = berkasJs(DIR_JS).filter(
  (p) => path.resolve(p) !== SUMBER && /\bmulaiModul\s*\(/.test(fs.readFileSync(p, 'utf8'))
);
if (!pemakai.length) {
  console.error('❌ Tidak ada satu pun yang memakai mulaiModul(). Pemulihan layar kemungkinan mati total.');
  process.exit(1);
}

if (temuan.length) {
  console.error('❌ Pembacaan ingatan layar di luar mulaiModul():\n');
  for (const t of temuan) console.error('   ' + t);
  console.error(
    '\nPakai `mulaiModul(kode, { pulihkan })` — ia membaca gulir, layar, dan konteks\n' +
      'SEBELUM mengosongkan ingatannya, dalam satu langkah. Memisahkannya pernah\n' +
      'membuat sebuah pemulihan tidak pernah hidup sama sekali, tanpa satu pun error.'
  );
  process.exit(1);
}

console.log(
  `Pemulihan ingatan layar dibaca lewat mulaiModul() di ${pemakai.length} berkas; tidak ada pembacaan langsung yang bisa kosong. ✅`
);
