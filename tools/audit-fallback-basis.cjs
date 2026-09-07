/**
 * AUDIT: BU/outlet BASIS selalu berarti `coalesce(nbm_*, lokasi fisik)`.
 *
 * ============ ATURANNYA, DAN DI MANA IA DITULIS ============
 *
 * Migration 0011 menyatakannya hitam di atas putih:
 *
 *     "nbm_* = BU/outlet basis staff, dipakai untuk perhitungan NBM.
 *      Nullable: baris lama / fallback -> pakai lokasi fisik seperti perilaku lama."
 *
 * Jadi `nbm_business_unit_id` NULL BUKAN berarti "tidak punya basis"; ia berarti
 * "basisnya = tempat ia absen". Fungsi SQL 0074 dan 0106 memakai
 * `coalesce(ar.nbm_outlet_id, ar.outlet_id)`, dan layar rekapnya memakai
 * `r.nbm_outlet_id ?? r.outlet_id` saat menghitung.
 *
 * ============ BUG YANG MELAHIRKAN AUDIT INI ============
 *
 * `listAttendanceForNbm` memakai `eq('nbm_business_unit_id', …)` polos. Baris
 * yang basisnya belum pernah dicap tidak pernah ikut terambil — jadi layarnya
 * menghitung fallback untuk baris yang tidak pernah sampai kepadanya.
 *
 * Rekapnya tetap tampil. Totalnya tetap terlihat wajar. Yang hilang cuma
 * sebagian orang, dan tidak ada satu pun error di sepanjang jalan itu.
 *
 * Yang menyakitkan: `report.service.js` sudah memakai bentuk `.or(...)` yang
 * benar untuk pertanyaan yang PERSIS SAMA. Dua layar, satu aturan, dua jawaban.
 */
const fs = require('fs');
const path = require('path');
const { tanpaKomentar } = require('./lib/tanpa-komentar.cjs');

const AKAR = path.join(__dirname, '..', 'js');
let gagal = 0;
let diperiksa = 0;

function berkasJs(dir, keluar = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) berkasJs(p, keluar);
    else if (e.name.endsWith('.js')) keluar.push(p);
  }
  return keluar;
}

/** Rantai pemanggilan sesudah sebuah posisi, sampai `;` di kedalaman kurung 0. */
function rantaiSesudah(src, mulai) {
  let i = mulai;
  let dalam = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '(' || c === '[' || c === '{') dalam++;
    else if (c === ')' || c === ']' || c === '}') dalam--;
    else if (c === ';' && dalam <= 0) break;
    i++;
  }
  return src.slice(mulai, i);
}

const PASANGAN = {
  nbm_business_unit_id: 'business_unit_id',
  nbm_outlet_id: 'outlet_id'
};

for (const berkas of berkasJs(AKAR)) {
  const rel = path.relative(path.join(__dirname, '..'), berkas).replace(/\\/g, '/');
  const kode = tanpaKomentar(fs.readFileSync(berkas, 'utf8'));
  if (!/attendance_records/.test(kode)) continue;
  diperiksa++;

  for (const [basis, fisik] of Object.entries(PASANGAN)) {
    // `.eq('nbm_*', …)` — penyaringan tanpa fallback.
    const pola = new RegExp(`\\.eq\\(\\s*['"]${basis}['"]`, 'g');
    for (const m of kode.matchAll(pola)) {
      // Rantai di sekitarnya: kalau `.or(...)` dengan `is.null` ada di query
      // yang sama, fallback-nya sudah tertangani.
      const awal = Math.max(0, m.index - 800);
      const sekitar = kode.slice(awal, m.index + rantaiSesudah(kode, m.index).length + 400);
      const adaFallback = new RegExp(`${basis}\\.is\\.null`).test(sekitar);
      // Atau disaring di klien dengan `?? fisik` sesudah datanya diambil.
      const adaKlien = new RegExp(`${basis}\\s*\\?\\?\\s*\\w*\\.?${fisik}`).test(kode);
      if (adaFallback || adaKlien) continue;

      const baris = kode.slice(0, m.index).split('\n').length;
      gagal++;
      console.error(
        `❌ ${rel}:${baris} — menyaring \`${basis}\` tanpa fallback ke \`${fisik}\`. ` +
          'Migration 0011 menyatakan kolom itu NULLABLE dan NULL berarti "pakai lokasi fisik". Baris yang basisnya ' +
          'belum pernah dicap tidak akan pernah ikut terambil — dan yang terlihat cuma sebagian orang hilang dari ' +
          `rekap, tanpa satu pun error. Pakai .or('${basis}.eq.X,and(${basis}.is.null,${fisik}.eq.X)').`
      );
    }
  }
}

if (gagal === 0) {
  console.log(`Fallback basis NBM: ${diperiksa} berkas yang menyentuh attendance_records — semuanya menghormati coalesce. ✅`);
}
process.exit(gagal === 0 ? 0 : 1);
