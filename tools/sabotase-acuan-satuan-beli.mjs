/**
 * SABOTASE: acuan satuan beli di layar opname.
 *
 * ============ KENAPA BERKAS INI ADA ============
 *
 * Baris acuan ini dibaca sambil berdiri di depan rak, dan gunanya cuma satu:
 * membuat dus yang belum dibuka TIDAK perlu dibongkar. Kalau ia rusak, tidak
 * ada galat — yang terjadi cuma dus yang dibongkar lagi (pekerjaan yang
 * terbuang), atau yang lebih mahal: "4" diketik untuk 4 dus, dan stok 200 pcs
 * tercatat sebagai 4 pcs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AKAR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const P = (rel) => path.join(AKAR, rel);

const MURNI = 'js/modules/inventory/acuan-satuan-beli.js';
const PAGE = 'js/modules/inventory/inventory.page.js';
const CSS = 'css/styles.css';
const KONVERSI = 'js/modules/inventory/konversi-satuan.js';

const BERKAS = [MURNI, PAGE, CSS, KONVERSI];
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

// ============ PEMERIKSANYA HARUS HIJAU DULU ============
//
// "Tertangkap" hanya berarti sesuatu kalau pemeriksanya memang hijau sebelum
// kodenya dirusak. Pemeriksa yang sudah merah sejak awal akan melaporkan
// SELURUH sabotase sebagai tertangkap, dan harness ini berubah jadi stempel.
const pastikanHijau = (cmd) => {
  if (process.env.SABOTASE_PERIKSA_POLA) return;
  if (!jalan(cmd)) {
    console.error(`❌ PEMERIKSANYA SUDAH MERAH SEBELUM DISABOTASE: ${cmd} — "tertangkap" di bawah tidak berarti apa-apa.`);
    process.exit(1);
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

const AUDIT = 'tools/audit-acuan-satuan-beli.cjs';
const TES = 'tools/test-acuan-satuan-beli.mjs';

for (const p of [AUDIT, TES]) pastikanHijau(p);

// =====================================================================
console.log('SABOTASE SALAH ISI — yang paling mahal:');
// =====================================================================

// ============ DUA SATUAN YANG TAMPIL SAMA MENONJOL ============
//
// Yang diketik harus satuan KECIL. Kalau acuannya tampil sepenting satuan
// kecilnya, "4" diketik untuk 4 dus — dan 200 pcs tercatat sebagai 4 pcs.
sabotase(
  'acuan satuan beli tidak lagi diredupkan',
  CSS,
  '.opname-acuan {\n  font-size: 0.74rem;\n  color: var(--color-text-muted);',
  '.opname-acuan {\n  font-size: 0.74rem;\n  color: var(--color-text);',
  AUDIT
);

sabotase(
  'satuan kecil di sebelah kotak isian tidak lagi ditebalkan',
  CSS,
  '.opname-satuan-utama {\n  font-weight: 700;',
  '.opname-satuan-utama {\n  font-weight: 400;',
  AUDIT
);

sabotase(
  'penanda satuan utama dicabut dari kartunya',
  PAGE,
  'class="opname-satuan opname-satuan-utama"',
  'class="opname-satuan"',
  AUDIT
);

// =====================================================================
console.log('\nSABOTASE ANGKA ACUANNYA:');
// =====================================================================

// Bentuknya tetap benar, isinya salah — dan tidak ada yang akan
// membandingkannya dengan apa pun.
sabotase(
  'terjemahan stok dipanggil dengan angka yang salah',
  PAGE,
  '` · sistem ${esc(teksAcuanStok(sys, p))}`',
  '` · sistem ${esc(teksAcuanStok(0, p))}`',
  AUDIT
);

sabotase(
  'acuannya tidak digambar sama sekali',
  PAGE,
  '<div class="opname-acuan">📦 ${esc(labelAcuan(p))}',
  '<div class="opname-acuan">📦 ${esc(labelAcuanX(p))}',
  AUDIT
);

// Ekor desimal di layar membuat orang ragu pada hitungan yang benar, dan
// keraguan itu berakhir dengan dus yang dibongkar — persis yang dihindari.
sabotase(
  'hasilnya tidak dibulatkan — ekor 40.299999999999955 tercetak',
  MURNI,
  '  return Math.round(n * 10000) / 10000;',
  '  return n;',
  TES
);

sabotase(
  'sisa dihitung dengan modulo — ekor pecahan kembali muncul',
  MURNI,
  '  const sisa = bulat(n - besar * isi);',
  '  const sisa = n % isi;',
  TES
);

// =====================================================================
console.log('\nSABOTASE AMBANG "PUNYA SATUAN BELI":');
// =====================================================================

// ============ HARUS SEPAKAT DENGAN EKSPOR ESB ============
//
// Produk yang sama tidak boleh dianggap bersatuan beli di satu tempat dan
// tidak di tempat lain. `<= 1` membuang isi PECAHAN (1 pack = 0,5 kg) yang
// tetap dikonversi saat ekspor — dan bedanya tidak memunculkan galat di mana
// pun.
sabotase(
  'ambangnya menyimpang dari konversi-satuan (isi pecahan dibuang)',
  MURNI,
  '  if (!unit || isi === null || isi <= 0 || isi === 1) return false;',
  '  if (!unit || isi === null || isi <= 1) return false;',
  TES
);

sabotase(
  'isi 1 ikut dianggap berguna — "1 pack = 1 pcs" di tiap kartu',
  MURNI,
  '  if (!unit || isi === null || isi <= 0 || isi === 1) return false;',
  '  if (!unit || isi === null || isi <= 0) return false;',
  TES
);

sabotase(
  'satuan beli yang namanya sama tidak disaring',
  MURNI,
  '  return unit.toLowerCase() !== kecil.toLowerCase();',
  '  return true;',
  TES
);

sabotase(
  'ambang di konversi-satuan yang bergeser',
  KONVERSI,
  'isi <= 0 || isi === 1',
  'isi <= 0',
  AUDIT
);

// ---------------------------------------------------------------
console.log('');
if (gagal === 0) console.log('Semua sabotase acuan satuan beli tertangkap. ✅');
else console.error(`${gagal} sabotase LOLOS / tidak terpasang.`);
process.exit(gagal === 0 ? 0 : 1);
