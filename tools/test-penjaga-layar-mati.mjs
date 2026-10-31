/**
 * PENJAGA LAYAR MATI — tes atas skrip yang BENAR-BENAR ADA di HTML-nya.
 *
 * ============ KENAPA DIEKSTRAK, BUKAN DISALIN ============
 *
 * Skripnya diambil dari `index.html` / `admin.html` / `owner.html` apa adanya
 * lalu dijalankan di DOM tiruan. Menyalin isinya ke berkas tes berarti yang
 * diuji adalah salinannya: HTML-nya bisa dirusak besok dan tes ini tetap
 * hijau — bentuk kegagalan yang sama dengan audit yang sasarannya pindah.
 *
 * ============ DUA ARAH, DAN YANG KEDUA LEBIH BERBAHAYA ============
 *
 *   layar mati  -> harus muncul pesan + tombol muat ulang
 *   layar hidup -> penjaga TIDAK BOLEH menyentuh apa pun
 *
 * Penjaga yang menimpa layar yang sudah jalan jauh lebih buruk daripada tidak
 * punya penjaga sama sekali: ia mematikan aplikasi yang sehat, dan sebabnya
 * ada di berkas yang tidak dicurigai siapa pun.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const AKAR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

let gagal = 0;
let n = 0;
const benar = (nama, syarat, ket = '') => {
  n++;
  if (!syarat) {
    gagal++;
    console.error(`❌ ${nama}${ket ? ' — ' + ket : ''}`);
  }
};

/** Skrip penjaga di dalam HTML — blok script TANPA atribut type. */
function ambilPenjaga(html) {
  for (const m of html.matchAll(/<script(?![^>]*\btype=)[^>]*>([\s\S]*?)<\/script>/g)) {
    if (m[1].includes('setTimeout')) return m[1];
  }
  return null;
}

/** DOM tiruan secukupnya: satu elemen #app, satu antrean timer. */
function jalankan(skrip, { isiAwal, sebelumWaktunya }) {
  const app = { id: 'app', textContent: isiAwal, innerHTML: isiAwal };
  const timer = [];
  const dengar = [];
  const sandbox = {
    document: { getElementById: (id) => (id === 'app' ? app : null) },
    window: { addEventListener: (jenis, fn) => dengar.push([jenis, fn]) },
    setTimeout: (fn, ms) => timer.push([fn, ms]),
    location: { reload: () => {} },
    String
  };
  vm.createContext(sandbox);
  vm.runInContext(skrip, sandbox);

  // Aplikasinya sempat menggambar sesuatu sebelum waktunya habis?
  if (sebelumWaktunya) {
    app.textContent = sebelumWaktunya;
    app.innerHTML = sebelumWaktunya;
  }
  for (const [fn] of timer) fn();
  return { app, timer, dengar };
}

for (const berkas of ['index.html', 'admin.html', 'owner.html']) {
  console.log(`§ ${berkas}`);
  const html = fs.readFileSync(path.join(AKAR, berkas), 'utf8');
  const skrip = ambilPenjaga(html);
  benar(`${berkas}: penjaganya ada`, Boolean(skrip));
  if (!skrip) continue;

  // Penjaganya harus berdiri SEBELUM modulnya dimuat; dipasang sesudahnya, ia
  // tidak pernah sempat berjalan saat modulnya yang gagal.
  benar(`${berkas}: penjaga dipasang sebelum tag modulnya`, html.indexOf(skrip) < html.indexOf('type="module"'));

  // ---- layar mati ----
  const mati = jalankan(skrip, { isiAwal: 'Memuat...' });
  benar(`${berkas}: ada tungguan waktu`, mati.timer.length === 1);
  benar(`${berkas}: pesannya menggantikan layar kosong`, mati.app.innerHTML !== 'Memuat...');
  benar(`${berkas}: menyebut aplikasinya gagal dimuat`, /gagal dimuat/i.test(mati.app.innerHTML), mati.app.innerHTML.slice(0, 80));
  benar(
    `${berkas}: menyediakan tombol muat ulang`,
    /Muat ulang/.test(mati.app.innerHTML) && /location\.reload/.test(mati.app.innerHTML)
  );

  // ---- layar hidup: penjaganya harus DIAM ----
  const hidup = jalankan(skrip, { isiAwal: 'Memuat...', sebelumWaktunya: 'Berjaya Hub — Staff\nEmail\nPassword' });
  benar(
    `${berkas}: TIDAK menimpa layar yang sudah jalan`,
    hidup.app.innerHTML === 'Berjaya Hub — Staff\nEmail\nPassword',
    hidup.app.innerHTML.slice(0, 80)
  );

  // Galat yang sempat tertangkap dipakai sebagai keterangan — tanpa itu, yang
  // melapor cuma bisa bilang "blank", dan tidak ada yang bisa dikerjakan dari
  // laporan seperti itu.
  benar(`${berkas}: mendengarkan galat untuk keterangannya`, mati.dengar.some(([j]) => j === 'error'));
}

console.log(`\n${gagal === 0 ? '✅' : '❌'} test-penjaga-layar-mati: ${n - gagal}/${n} lulus`);
process.exit(gagal === 0 ? 0 : 1);
