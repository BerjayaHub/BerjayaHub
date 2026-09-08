/**
 * SABOTASE pelebaran desktop — memeriksa bahwa auditnya benar-benar MENGGIGIT.
 *
 * Semua pelonggaran di bawah punya bentuk kegagalan yang sama: tidak ada error,
 * tidak ada yang berubah di layar orang yang menulisnya, dan yang menemukannya
 * adalah staff yang membuka aplikasi dari HP sambil berdiri di depan rak.
 *
 * Jalankan: node tools/sabotase-lebar-desktop.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AKAR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const P = (rel) => path.join(AKAR, rel);

const CSS = 'css/styles.css';
const asli = new Map([[CSS, fs.readFileSync(P(CSS), 'utf8')]]);

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
const sabotase = (nama, dari, ke, pemeriksa) => {
  if (!fs.existsSync(P(pemeriksa))) {
    gagal++;
    console.error(`❌ PEMERIKSANYA TIDAK ADA: ${pemeriksa} — "tertangkap" di sini tidak berarti apa-apa.`);
    return;
  }
  const isi = asli.get(CSS);
  const rusak = isi.replace(dari, ke);
  if (rusak === isi) {
    gagal++;
    console.error(`❌ SABOTASE TIDAK TERPASANG: ${nama} — polanya tidak ketemu di ${CSS}.`);
    return;
  }
  fs.writeFileSync(P(CSS), rusak);
  const hijau = jalan(pemeriksa);
  pulih();
  if (hijau) {
    gagal++;
    console.error(`❌ LOLOS: ${nama}\n   ${pemeriksa} tetap hijau padahal ${CSS} sudah dirusak.`);
  } else {
    console.log(`   ✔ tertangkap: ${nama}`);
  }
};

const AUDIT = 'tools/audit-lebar-desktop.cjs';

console.log('\n== Batas media ==');

sabotase(
  'syarat tinggi dilepas — HP yang diputar mendatar ikut memakai tata letak desktop',
  '@media (min-width: 769px) and (min-height: 501px) {',
  '@media (min-width: 769px) {',
  AUDIT
);

sabotase(
  'batas lebar digeser ke 768px — satu piksel yang masuk aturan mobile DAN desktop sekaligus',
  '@media (min-width: 769px) and (min-height: 501px) {',
  '@media (min-width: 768px) and (min-height: 501px) {',
  AUDIT
);

sabotase(
  'batas tinggi digeser ke 500px — tumpang tindih dengan aturan layar pendek',
  '@media (min-width: 769px) and (min-height: 501px) {',
  '@media (min-width: 769px) and (min-height: 500px) {',
  AUDIT
);

sabotase(
  'aturan mobile untuk kartu dihapus — kartu di HP kembali terikat batas inline-nya',
  '  .inline-card {\n    max-width: 100% !important;\n  }',
  '',
  AUDIT
);

console.log('\n== Isi blok desktop ==');

sabotase(
  'pelebaran kartu kehilangan !important — aturannya ada tapi tidak melakukan apa pun',
  /\.app-content \.inline-card \{\n    max-width: none !important;\n  \}/,
  '.app-content .inline-card {\n    max-width: none;\n  }',
  AUDIT
);

sabotase(
  'ukuran huruf ikut diubah di blok desktop — bukan lagi sekadar pelebaran',
  '  .staff-main {\n    max-width: none;',
  '  .staff-main {\n    font-size: 0.9rem;\n    max-width: none;',
  AUDIT
);

sabotase(
  'susunan ikut diubah di blok desktop',
  '  .staff-main {\n    max-width: none;',
  '  .staff-main {\n    display: grid;\n    max-width: none;',
  AUDIT
);

sabotase(
  'jarak atas-bawah ikut berubah — yang diminta lebarnya, bukan tingginya',
  'padding: var(--spacing-lg) clamp(20px, 3vw, 56px);',
  'padding: 4px clamp(20px, 3vw, 56px);',
  AUDIT
);

sabotase(
  'dialog ikut dilebarkan — selebar layar ia berhenti terbaca sebagai dialog',
  '  .staff-main .field > input:not(.isian-lebar),',
  '  .modal-card { max-width: none !important; }\n  .staff-main .field > input:not(.isian-lebar),',
  AUDIT
);

sabotase(
  'batas kotak isian tunggal dilepas — kotak "Nomor nota" jadi sepanjang meja',
  /  \.staff-main \.field > input:not\(\.isian-lebar\),[\s\S]*?max-width: 520px;\n  \}/,
  '',
  AUDIT
);

sabotase(
  '.staff-main tidak jadi dilebarkan — keluhan aslinya tidak tersentuh',
  '  .staff-main {\n    max-width: none;',
  '  .staff-main {\n    max-width: 760px;',
  AUDIT
);

console.log('\n== Kebocoran ke lingkup global ==');

sabotase(
  'pelebaran ditaruh di luar media query — kartu di HP ikut melebar dan tidak bisa ditahan',
  '/* =========================================================\n   LEBAR DESKTOP',
  '.inline-card { max-width: none !important; }\n\n/* =========================================================\n   LEBAR DESKTOP',
  AUDIT
);

console.log('');
if (gagal === 0) {
  console.log('Semua sabotase lebar-desktop tertangkap. Auditnya menggigit. ✅');
} else {
  console.error(`${gagal} sabotase LOLOS.`);
}
process.exit(gagal === 0 ? 0 : 1);
