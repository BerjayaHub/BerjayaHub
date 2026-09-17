/**
 * SABOTASE: susunan layar Ekspor ESB & pemetaannya.
 *
 * Yang dijaga: delapan baris yang belum dipetakan bisa DITEMUKAN di antara 647,
 * pencariannya tidak mematikan penyimpanan pemetaan, dan langkah yang dikerjakan
 * tiap periode tidak terkubur di bawah penyiapan yang sudah selesai.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AKAR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const P = (rel) => path.join(AKAR, rel);

const URUT = 'js/modules/inventory/urut-pemetaan.js';
const PAGE = 'js/modules/inventory/esb.admin.js';
const SARING = 'js/modules/dispatch/saring-tabel.js';

const asli = new Map();
for (const rel of [URUT, PAGE, SARING]) asli.set(rel, fs.readFileSync(P(rel), 'utf8'));

const pulih = () => {
  for (const [rel, isi] of asli) fs.writeFileSync(P(rel), isi);
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

const TES = 'tools/test-urut-pemetaan.mjs';
const AUDIT = 'tools/audit-pemetaan-esb.cjs';

console.log('SABOTASE URUTAN:');

sabotase(
  'yang belum dipetakan berhenti naik ke atas — 8 baris tersebar lagi di antara 647',
  URUT,
  "    (a, b) => Number(a.dipetakan) - Number(b.dipetakan) || a.kunci.localeCompare(b.kunci, 'id')",
  "    (a, b) => a.kunci.localeCompare(b.kunci, 'id')",
  TES
);
sabotase(
  'urutannya terbalik — yang sudah dipetakan justru di atas',
  URUT,
  '    (a, b) => Number(a.dipetakan) - Number(b.dipetakan)',
  '    (a, b) => Number(b.dipetakan) - Number(a.dipetakan)',
  TES
);
sabotase(
  'alfabetis di dalam kelompok dicabut — urutannya ikut urutan datangnya dari database',
  URUT,
  "|| a.kunci.localeCompare(b.kunci, 'id')",
  '|| 0',
  TES
);
sabotase(
  'spasi dianggap padanan — nilainya berangkat ke ESB sebagai sel kosong',
  URUT,
  '    const v = typeof nilai === \'function\' ? teks(nilai(k)).trim() : \'\';',
  "    const v = typeof nilai === 'function' ? teks(nilai(k)) : '';",
  TES
);
sabotase(
  'nilai "0" dianggap belum dipetakan — COANo bernilai 0 jadi mustahil dipetakan',
  URUT,
  "    return { kunci: teks(k), nilai: v, dipetakan: v !== '' };",
  '    return { kunci: teks(k), nilai: v, dipetakan: Boolean(v) && v !== "0" };',
  TES
);
sabotase(
  'hitungan "belum" salah — lencananya menyebut angka yang tidak cocok dengan barisnya',
  URUT,
  '  return { baris, belum: baris.filter((b) => !b.dipetakan).length, total: baris.length };',
  '  return { baris, belum: 0, total: baris.length };',
  TES
);
sabotase(
  'kotak cari muncul untuk daftar sependek tiga baris',
  URUT,
  '  return Number(total) > AMBANG_CARI;',
  '  return true;',
  TES
);

console.log('\nSABOTASE SUSUNAN LAYAR:');

sabotase(
  'Unduh dikembalikan ke paling bawah — pekerjaan tiap periode terkubur lagi',
  PAGE,
  '<h3 style="margin-top:0;font-size:0.95rem">1. Unduh</h3>',
  '<h3 style="margin-top:0;font-size:0.95rem">3. Unduh</h3>',
  AUDIT
);
sabotase(
  'penomorannya diacak tapi susunannya tidak',
  PAGE,
  '<h3 style="margin-top:0;font-size:0.95rem">2. Daftar induk ESB</h3>',
  '<h3 style="margin-top:0;font-size:0.95rem">1. Daftar induk ESB</h3>',
  AUDIT
);
sabotase(
  'kalimat pengantar menunjuk langkah yang salah',
  PAGE,
  '<strong>pemetaan di langkah 3 tidak ikut terhapus</strong>',
  '<strong>pemetaan di langkah 2 tidak ikut terhapus</strong>',
  AUDIT
);
sabotase(
  'baris pemetaan disusun sendiri di layar, bukan lewat modul murni',
  PAGE,
  "const { baris, belum: kurang, total } = susunBarisPemetaan(lokal[j], (k) => m.get(normal(k)) ?? '');",
  "const baris = lokal[j].map((k) => ({ kunci: k, nilai: m.get(normal(k)) ?? '', dipetakan: m.has(normal(k)) })); const kurang = 0; const total = baris.length;",
  AUDIT
);
sabotase(
  'baris yang belum dipetakan berhenti ditandai — hasil pencarian mencampur keduanya tanpa pembeda',
  PAGE,
  "${dipetakan ? '' : ' class=\"esb-belum\"'}",
  "''",
  AUDIT
);

console.log('\nSABOTASE PENCARIAN:');

sabotase('kotak cari dihapus', PAGE, 'class="esb-cari"', 'class="esb-cari-nonaktif"', AUDIT);
sabotase(
  'kotak cari tidak pernah disambungkan',
  PAGE,
  '    box.querySelectorAll(\'.esb-cari\').forEach((kotak) =>\n      saringTabel(',
  "    box.querySelectorAll('.esb-cari').forEach((kotak) =>\n      ((..._) => {})(",
  AUDIT
);
sabotase(
  'kotak cari menyaring SELURUH kelompok, bukan kelompoknya sendiri',
  PAGE,
  'box.querySelectorAll(`tbody[data-baris="${kotak.dataset.jenis}"] tr`)',
  "box.querySelectorAll('tbody tr')",
  AUDIT
);
sabotase(
  'baris hanya bisa dicari lewat nama Berjaya Hub, bukan nama ESB-nya',
  PAGE,
  'data-nama="${esc(k)} ${esc(kini)}"',
  'data-nama="${esc(k)}"',
  AUDIT
);
sabotase(
  'kotak cari muncul tanpa memandang jumlah baris',
  PAGE,
  '            perluCari(total)',
  '            true',
  AUDIT
);
// INI yang paling berbahaya: penyaring yang MENGGAMBAR ULANG membuang
// `<select>` beserta penangan `change`-nya, dan pemetaan berhenti tersimpan
// tanpa satu pun error.
sabotase(
  'penyaring menggambar ulang alih-alih menyembunyikan — pemetaan berhenti tersimpan diam-diam',
  SARING,
  '      el.hidden = !cocok;',
  '      if (!cocok) el.remove();',
  AUDIT
);

console.log('');
if (gagal === 0) console.log('Semua sabotase pemetaan ESB tertangkap. ✅');
else console.error(`${gagal} sabotase LOLOS.`);
process.exit(gagal === 0 ? 0 : 1);
