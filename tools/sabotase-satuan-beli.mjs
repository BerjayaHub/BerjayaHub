/**
 * SABOTASE: keterangan satuan beli di pemilih barang.
 *
 * Yang dijaga: pengalinya benar dan bersumber dari `purchase_qty`, keterangannya
 * terlihat sebelum DAN sesudah barangnya dipilih, dan pencariannya tetap hanya
 * mencocokkan nama.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AKAR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const P = (rel) => path.join(AKAR, rel);

const MURNI = 'js/modules/product/satuan-beli.js';
const UI = 'js/core/ui.js';
const PICKER = 'js/modules/dispatch/item-picker.js';
const CSS = 'css/styles.css';

const asli = new Map();
for (const rel of [MURNI, UI, PICKER, CSS]) asli.set(rel, fs.readFileSync(P(rel), 'utf8'));

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

const TES = 'tools/test-satuan-beli.mjs';
const AUDIT = 'tools/audit-satuan-beli.cjs';

console.log('SABOTASE ANGKA PENGALINYA:');

sabotase(
  'isi pack ditebak dari NAMA satuannya — "DUS" dan "KARUNG" tidak punya angka sama sekali',
  MURNI,
  '  const isi = angka(p?.purchase_qty);\n  const kecil = teks(p?.base_unit);',
  "  const isi = angka((/(\\d+)/.exec(teks(p?.purchase_unit)) ?? [])[1]);\n  const kecil = teks(p?.base_unit);",
  TES
);
sabotase(
  'nilai kosong tidak disaring — Number("") yang bernilai 0 lolos jadi "= 0 pcs"',
  MURNI,
  "  if (v === null || v === undefined || v === '') return null;",
  '  if (v === undefined) return null;',
  TES
);
sabotase(
  'isi nol & negatif diterima — "1 PACK = 0 pcs" tampil seolah keterangan yang sah',
  MURNI,
  '  if (!unit || isi === null || isi <= 0) return \'\';',
  "  if (!unit || isi === null) return '';",
  TES
);
sabotase(
  'satuan beli = satuan kecil tapi isi ≠ 1 ikut tampil — "1 pcs = 100 pcs" mengajari mengalikan yang salah',
  MURNI,
  '  if (kecil && unit.toLowerCase() === kecil.toLowerCase()) return \'\';',
  '  if (false) return \'\';',
  TES
);
sabotase(
  'isi 1 ikut diumumkan — ratusan baris "1 BOTOL = 1 botol" menenggelamkan yang penting',
  MURNI,
  "  if (isi === 1) return '';",
  '  if (false) return \'\';',
  TES
);
sabotase(
  'angka yang ditampilkan tidak lagi sama dengan angka yang dimaksudkan',
  MURNI,
  '  return n * isi;',
  '  return n;',
  TES
);
sabotase(
  'satuan kecilnya hilang dari keterangan — "1 PACK@100PCS = 100" tanpa satuan apa pun',
  MURNI,
  '  return `1 ${unit} = ${rapikan(isi)}${kecil ? ` ${kecil}` : \'\'}`;',
  '  return `1 ${unit} = ${rapikan(isi)}`;',
  TES
);

console.log('\nSABOTASE TAMPIL vs CARI — inti fitur ini:');

// INI yang paling berbahaya: tidak ada error, tidak ada yang terlihat rusak,
// kotak carinya cuma "jadi kurang enak dipakai".
sabotase(
  'pencarian dialihkan ke teks yang TAMPIL — mengetik "100" memunculkan setiap barang berisi 100',
  UI,
  'draw(options.filter((o) => fuzzyMatch(input.value, o.label)));',
  'draw(options.filter((o) => fuzzyMatch(input.value, teksOpsi(o))));',
  AUDIT
);
sabotase(
  'keterangannya dijejalkan ke dalam label — kerusakan yang sama, lewat pintu lain',
  PICKER,
  'label: `${p.name} (${p.base_unit})`, hint: hintSatuanBeli(p)',
  'label: `${p.name} (${p.base_unit}) ${hintSatuanBeli(p)}`',
  AUDIT
);
sabotase(
  'teksOpsi berhenti menggabungkan keterangannya — tampil polos lagi',
  UI,
  "  return hint ? `${o?.label ?? ''} — ${hint}` : String(o?.label ?? '');",
  "  return String(o?.label ?? '');",
  TES
);

console.log('\nSABOTASE TEMPAT MUNCULNYA:');

sabotase(
  'keterangannya tidak digambar di dropdown',
  UI,
  'class="ss-hint"',
  'class="ss-hint-nonaktif"',
  AUDIT
);
// Begitu barangnya dipilih, dropdown-nya tertutup — dan justru SESUDAH itu
// orangnya mengetik jumlahnya. Keterangan yang hilang di saat itu tidak
// menolong siapa pun.
sabotase(
  'keterangannya lenyap tepat sesudah barangnya dipilih',
  UI,
  '    return o ? teksOpsi(o) : allowCreate ? val : \'\';',
  "    return o ? o.label : allowCreate ? val : '';",
  AUDIT
);
sabotase(
  'baris yang digambar ulang (ganti filter, Edit nota) kehilangan keterangannya',
  UI,
  '  const shownLabel = selected ? teksOpsi(selected) : allowCreate ? value ?? \'\' : \'\';',
  "  const shownLabel = selected?.label ?? (allowCreate ? value ?? '' : '');",
  AUDIT
);
sabotase(
  'pemilih barang berhenti membawa keterangannya',
  PICKER,
  'hint: hintSatuanBeli(p)',
  "hint: ''",
  AUDIT
);
sabotase(
  'gayanya dicabut — keterangannya menempel jadi satu kalimat dengan nama barangnya',
  CSS,
  '.search-select .ss-list li .ss-hint {',
  '.search-select .ss-list li .ss-hint-nonaktif {',
  AUDIT
);

console.log('');
if (gagal === 0) console.log('Semua sabotase satuan beli tertangkap. ✅');
else console.error(`${gagal} sabotase LOLOS.`);
process.exit(gagal === 0 ? 0 : 1);
