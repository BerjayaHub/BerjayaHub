/**
 * SABOTASE: audit escape HTML.
 *
 * ============ KENAPA BERKAS INI ADA ============
 *
 * `audit-html-escape.cjs` baru saja diberi PENGECUALIAN — daftar fungsi yang
 * boleh mengembalikan HTML tanpa dibungkus `esc()` di tempat pemanggilannya.
 * Pengecualian adalah cara paling rapi sebuah pemeriksa berhenti menjaga:
 * ia tetap hijau, tetap dijalankan, dan tidak ada yang curiga.
 *
 * Jadi yang diuji di sini bukan kodenya, melainkan apakah pengecualian itu
 * masih menuntut syaratnya — dan apakah aturan intinya masih menangkap
 * interpolasi yang lolos.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AKAR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const P = (rel) => path.join(AKAR, rel);

const KAS = 'js/modules/cash/keterangan-nota-html.js';
const ASET = 'js/modules/asset/asset.page.js';

const BERKAS = [KAS, ASET];
const asli = new Map();
for (const rel of BERKAS) asli.set(rel, fs.readFileSync(P(rel), 'utf8'));

const PENANDA = path.join(AKAR, 'tools/.sabotase-aktif');
const tandai = (rel) => fs.writeFileSync(PENANDA, `${path.basename(process.argv[1])} merusak ${rel}\n`);
const lepasTanda = () => {
  try {
    fs.unlinkSync(PENANDA);
  } catch {
    /* belum pernah ada — tidak apa-apa */
  }
};

const pulih = () => {
  if (process.env.SABOTASE_PERIKSA_POLA) return lepasTanda();
  for (const [rel, isi] of asli) fs.writeFileSync(P(rel), isi);
  lepasTanda();
};
process.on('exit', pulih);
process.on('SIGINT', () => process.exit(130));
process.on('SIGTERM', () => process.exit(143));

const jalan = (cmd) => {
  try {
    execFileSync('node', [cmd], { cwd: AKAR, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
};

let gagal = 0;
const sabotase = (nama, rel, dari, ke, pemeriksa) => {
  if (!fs.existsSync(P(pemeriksa))) {
    gagal++;
    console.error(`❌ PEMERIKSANYA TIDAK ADA: ${pemeriksa} — "tertangkap" di sini tidak berarti apa-apa.`);
    return;
  }
  const isi = asli.get(rel);
  const rusak = isi.replace(dari, ke);
  if (rusak === isi) {
    gagal++;
    console.error(`❌ SABOTASE TIDAK TERPASANG: ${nama} — polanya tidak ketemu di ${rel}.`);
    return;
  }
  if (typeof dari === 'string' && isi.split(dari).length > 2) {
    gagal++;
    console.error(`❌ POLANYA MUNCUL >1 KALI: ${nama} di ${rel} — sabotasenya cuma mengenai yang pertama.`);
    return;
  }
  if (process.env.SABOTASE_PERIKSA_POLA) {
    console.log(`   ✔ pola terpasang: ${nama}`);
    return;
  }
  tandai(rel);
  fs.writeFileSync(P(rel), rusak);
  const hijau = jalan(pemeriksa);
  pulih();
  if (hijau) {
    gagal++;
    console.error(`❌ LOLOS: ${nama}\n   ${pemeriksa} tetap hijau padahal ${rel} sudah dirusak.`);
  } else {
    console.log(`   ✔ tertangkap: ${nama}`);
  }
};

const AUDIT = 'tools/audit-html-escape.cjs';
const TES = 'tools/test-keterangan-nota-html.mjs';

// =====================================================================
console.log('SABOTASE PENGECUALIAN:');
// =====================================================================

// ============ PENGECUALIAN TANPA SYARAT = LUBANG ============
//
// `ketHtml` boleh tidak dibungkus esc() HANYA karena badannya sendiri
// meng-escape. Begitu badannya bocor, izin itu harus ikut gugur — kalau tidak,
// satu nama fungsi yang terdaftar jadi pintu terbuka selamanya.
// ============ YANG MEMBUKTIKANNYA ADALAH TESNYA, BUKAN AUDITNYA ============
//
// Audit berbasis pola tidak bisa melihat bedanya `esc(b.teks)` dan `b.teks` di
// tengah rantai `map().join()`. Jadi dua sabotase pertama ditujukan ke TESNYA —
// dan kalau suatu hari tesnya dihapus, sabotase ketiga yang menangkapnya.
sabotase(
  'berhenti meng-escape teks biasa di antara tombol nota',
  KAS,
  'const utama = bagian.map((b) => (b.notaId ? tombol(b) : escapeHtml(b.teks))).join(\'\');',
  'const utama = bagian.map((b) => (b.notaId ? tombol(b) : b.teks)).join(\'\');',
  TES
);

sabotase(
  'berhenti meng-escape teks di dalam tombol nota',
  KAS,
  '`<button type="button" class="btn-nota" data-id="${escapeHtml(t.notaId)}">${escapeHtml(t.teks)}</button>`;',
  '`<button type="button" class="btn-nota" data-id="${escapeHtml(t.notaId)}">${t.teks}</button>`;',
  TES
);

sabotase(
  'id nota tidak di-escape — bisa keluar dari atributnya',
  KAS,
  'data-id="${escapeHtml(t.notaId)}"',
  'data-id="${t.notaId}"',
  TES
);

// Pengecualian yang menunjuk fungsi yang sudah tidak ada bukan "tidak apa-apa":
// ia adalah pengecualian yang tidak pernah lagi diperiksa.
sabotase(
  'fungsinya diganti nama — pengecualian menunjuk yang sudah tidak ada',
  KAS,
  'export function ketNotaHtml(ket, notas) {',
  'export function ketNotaHtmlBaru(ket, notas) {',
  AUDIT
);

// =====================================================================
console.log('\nSABOTASE ATURAN INTI:');
// =====================================================================

// ============ DUA INTERPOLASI DI SATU BARIS ============
//
// Versi lama audit ini memeriksa seluruh BARIS: asal ada kata "esc(" di
// mana pun, barisnya lolos. Baris di bawah sudah memuat esc() — jadi
// interpolasi kedua yang telanjang hanya tertangkap kalau auditnya memeriksa
// tiap interpolasi sendiri-sendiri.
sabotase(
  'satu interpolasi telanjang di baris yang juga memuat esc()',
  ASET,
  '<td style="font-size:0.85rem" data-label="Kategori">${esc(a.category ?? \'-\')}</td>',
  '<td style="font-size:0.85rem" data-label="Kategori">${esc(a.kode)} ${a.name}</td>',
  AUDIT
);

// Bentuk paling polos: satu interpolasi telanjang, tanpa esc() di mana pun
// pada barisnya. Diuji terpisah supaya aturan dasarnya tidak diam-diam ikut
// hilang saat pemeriksaan per-interpolasi ditambahkan.
sabotase(
  'nama barang masuk HTML tanpa esc() sama sekali',
  ASET,
  '<td style="font-size:0.85rem" data-label="Kategori">${esc(a.category ?? \'-\')}</td>',
  '<td style="font-size:0.85rem" data-label="Kategori">${a.name}</td>',
  AUDIT
);

// ---------------------------------------------------------------
console.log('');
if (gagal === 0) console.log('Semua sabotase escape HTML tertangkap. ✅');
else console.error(`${gagal} sabotase LOLOS / tidak terpasang.`);
process.exit(gagal === 0 ? 0 : 1);
