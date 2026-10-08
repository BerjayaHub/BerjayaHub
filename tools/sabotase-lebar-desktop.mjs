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

// ============ JEJAK "SABOTASE SEDANG TERPASANG" ============
//
// `process.on('exit')` TIDAK berjalan kalau prosesnya di-SIGKILL — mis. saat
// harness ini kena batas waktu di luar. Yang tertinggal adalah berkas repo
// yang masih tersabotase, dan ia TIDAK terlihat sebagai apa pun: migration-nya
// tetap sah, aplikasinya tetap jalan, dan satu-satunya tanda adalah satu tes
// yang merah entah kenapa berjam-jam kemudian.
//
// Itu benar-benar terjadi: `0153` tertinggal dengan `if false then` di tempat
// penjaga "kas keluar harus menyebut outlet peruntukannya".
//
// Jadi penanda ini ditulis SEBELUM berkas pertama dirusak dan dibuang sesudah
// semuanya pulih. `tools/audit-sisa-sabotase.cjs` berteriak kalau ia tertinggal.
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
  // ============ MODE PERIKSA POLA TIDAK MEMULIHKAN APA PUN ============
  //
  // Karena ia tidak pernah merusak apa pun. `fs.writeFileSync` dengan isi yang
  // SAMA tetap sebuah penulisan: berkasnya dipotong lebih dulu, lalu diisi
  // ulang. Proses lain yang kebetulan membacanya pada milidetik itu melihat
  // berkas kosong atau separuh.
  //
  // Itu benar-benar terjadi: `audit-sabotase-terpasang.cjs` menjalankan 53
  // harness sekaligus, ketiganya-puluh-tiga menulis ulang berkasnya saat
  // keluar, dan `audit-import-ekspor.cjs` yang berjalan berbarengan melaporkan
  // "mengimpor REPORTS tapi berkasnya tidak mengekspornya" — untuk berkas yang
  // isinya tidak pernah berubah sedetik pun.
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
  // ============ MODE PERIKSA POLA ============
  //
  // Dipakai `tools/audit-sabotase-terpasang.cjs`: berhenti TEPAT sesudah pola
  // `dari` dipastikan cocok, sebelum satu berkas pun disentuh.
  //
  // Alasannya satu kejadian nyata: `sabotase-0132.mjs` basi sejak `0142` —
  // tiga polanya tidak cocok lagi dengan kodenya — dan tidak ada yang tahu
  // berbulan-bulan, karena harness sabotase berat (tiap sabotase menjalankan
  // pemeriksanya sendiri) sehingga tidak pernah ikut sweep rutin. Harness yang
  // polanya tidak terpasang TIDAK menguji apa pun, dan ia melaporkannya hanya
  // kalau ada yang menjalankannya.
  //
  // Mode ini tidak menjalankan pemeriksa sama sekali, jadi seluruh 50+ harness
  // bisa disapu dalam hitungan detik.
  if (process.env.SABOTASE_PERIKSA_POLA) {
    console.log(`   \u2714 pola terpasang: ${nama}`);
    return;
  }
  tandai(CSS);
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
