/**
 * SABOTASE: keterangan di search-select.
 *
 * Yang dijaga: keterangan menolong MEMILIH, dan tidak pernah ikut jadi NILAI.
 * Kegagalannya senyap — nama supplier berubah sendiri tanpa ada yang mengetik
 * apa pun, dan baru ketahuan saat notanya ditolak ekspor ESB.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AKAR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const P = (rel) => path.join(AKAR, rel);

const UI = 'js/core/ui.js';
const asli = new Map([[UI, fs.readFileSync(P(UI), 'utf8')]]);

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
  const isi = asli.get(UI);
  const rusak = isi.replace(dari, ke);
  if (rusak === isi) {
    gagal++;
    console.error(`❌ SABOTASE TIDAK TERPASANG: ${nama} — polanya tidak ketemu di ${UI}.`);
    return;
  }
  fs.writeFileSync(P(UI), rusak);
  const hijau = jalan(pemeriksa);
  pulih();
  if (hijau) {
    gagal++;
    console.error(`❌ LOLOS: ${nama}\n   ${pemeriksa} tetap hijau padahal ${UI} sudah dirusak.`);
  } else {
    console.log(`   ✔ tertangkap: ${nama}`);
  }
};

const TES = 'tools/test-search-select.mjs';
const AUDIT = 'tools/audit-satuan-beli.cjs';

console.log('SABOTASE — keterangan menempel ke nilai:');

// INI bug aslinya, persis. Nama supplier berubah sendiri tanpa ada yang
// mengetik apa pun.
sabotase(
  'kotak isian ikut memuat keterangan saat allowCreate — nama supplier berubah sendiri',
  '  return allowCreate ? String(o?.label ?? \'\') : teksOpsi(o);',
  '  return teksOpsi(o);',
  TES
);
sabotase(
  'nilai awal dialog sudah tercemar sejak digambar',
  '  const shownLabel = selected ? teksKotak(selected, allowCreate) : allowCreate ? value ?? \'\' : \'\';',
  "  const shownLabel = selected ? teksOpsi(selected) : allowCreate ? value ?? '' : '';",
  TES
);
sabotase(
  'memilih dari daftar menaruh teks berketerangan ke kotaknya',
  '    return o ? teksKotak(o, allowCreate) : allowCreate ? val : \'\';',
  "    return o ? teksOpsi(o) : allowCreate ? val : '';",
  TES
);

console.log('\nSABOTASE — keterangan hilang dari tempat yang benar:');

sabotase(
  'keterangan dicabut dari kotak isian yang BUKAN nilainya — satuan beli hilang sesudah barang dipilih',
  '  return allowCreate ? String(o?.label ?? \'\') : teksOpsi(o);',
  "  return String(o?.label ?? '');",
  TES
);
sabotase(
  'keterangan dicabut dari daftarnya — tidak ada lagi yang menolong memilih',
  'class="ss-hint"',
  'class="ss-hint-nonaktif"',
  TES
);
sabotase(
  'teksOpsi berhenti menggabungkan keterangan sama sekali',
  "  return hint ? `${o?.label ?? ''} — ${hint}` : String(o?.label ?? '');",
  "  return String(o?.label ?? '');",
  AUDIT
);

console.log('\nSABOTASE — pencarian:');

sabotase(
  'pencarian dialihkan ke teks berketerangan — mengetik kode ESB memunculkan barang yang tidak bernama itu',
  'draw(options.filter((o) => fuzzyMatch(input.value, o.label)));',
  'draw(options.filter((o) => fuzzyMatch(input.value, teksOpsi(o))));',
  TES
);
sabotase(
  'tawaran "+ Tambah" dibandingkan dengan teks berketerangan — supplier yang sudah terdaftar ditawari sebagai nama baru',
  '    const exact = options.some((o) => String(o.label).toLowerCase() === typed.toLowerCase());',
  '    const exact = options.some((o) => teksOpsi(o).toLowerCase() === typed.toLowerCase());',
  TES
);

console.log('');
if (gagal === 0) console.log('Semua sabotase search-select tertangkap. ✅');
else console.error(`${gagal} sabotase LOLOS.`);
process.exit(gagal === 0 ? 0 : 1);
