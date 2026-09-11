/**
 * SABOTASE: tombol di dalam sel tabel tidak boleh melebarkan halaman.
 *
 * Yang dijaga bukan "tampilannya rapi", melainkan bahwa sebuah tombol di sel
 * Aksi TIDAK PERNAH lagi mendorong lebar halaman melewati lebar layar. Bentuk
 * kegagalannya diam total: tidak ada error, tidak ada yang rusak, cuma tombol
 * terakhir yang terpotong di tepi kanan dan halaman yang harus digeser atau
 * diperkecil dulu supaya tombolnya kelihatan.
 *
 * Dua modul pernah menambal gejalanya sendiri dengan `style="min-height:38px"`
 * inline tanpa pernah menemukan sebabnya — satu baris `width: 100% !important`
 * di `@media (max-width: 768px)` yang ditulis untuk tombol DIALOG dan mengenai
 * seluruh aplikasi.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AKAR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const P = (rel) => path.join(AKAR, rel);

const CSS = 'css/styles.css';
const BEP = 'js/modules/owner/bep.owner.js';

const asli = new Map();
for (const rel of [CSS, BEP]) asli.set(rel, fs.readFileSync(P(rel), 'utf8'));

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

const AUDIT = 'tools/audit-tombol-aksi.cjs';

console.log('SABOTASE PAKSAAN LEBAR PENUH (sebab aslinya):');

sabotase(
  'pengecualian sel tabel dihapus — bug aslinya kembali utuh',
  CSS,
  `  .data-table td .btn-inline,
  .data-table td .btn-ghost,
  .data-table td .btn-danger {
    width: auto !important;
  }
`,
  '',
  AUDIT
);
sabotase(
  'pengecualian ada tapi tetap memaksa 100% — tampak diperbaiki, tidak memperbaiki apa pun',
  CSS,
  `  .data-table td .btn-danger {
    width: auto !important;
  }`,
  `  .data-table td .btn-danger {
    width: 100% !important;
  }`,
  AUDIT
);

console.log('\nSABOTASE UKURAN TOMBOL DI SEL:');

sabotase(
  'tombol sel dibesarkan lagi ke ukuran tombol formulir',
  CSS,
  '  min-height: 34px;\n  line-height: 1.25;',
  '  min-height: 48px;\n  line-height: 1.25;',
  AUDIT
);
sabotase(
  '`width: auto` dicabut — `button.primary` di sel Aksi merebut lebar penuh lagi',
  CSS,
  '  width: auto;\n  max-width: none;',
  '  max-width: none;',
  AUDIT
);
sabotase(
  'tombol merah dikembalikan 44px — menjulang di antara tetangga 34px',
  CSS,
  `.data-table td .btn-danger {
  padding: 6px 10px;
  font-size: 0.8rem;
  min-height: 34px;
}`,
  `.data-table td .btn-danger {
  padding: 12px 16px;
  font-size: 0.95rem;
  min-height: 44px;
}`,
  AUDIT
);

console.log('\nSABOTASE MODE KARTU:');

sabotase(
  'jaring pengaman dicabut — nilai yang kelebaran meluap keluar layar lagi',
  CSS,
  '    flex-wrap: wrap;\n    row-gap: 4px;',
  '    row-gap: 4px;',
  AUDIT
);
sabotase(
  'sel Aksi tidak lagi dapat barisnya sendiri',
  CSS,
  '  .data-table.kartu-sempit td:has(button ~ button) {\n    display: block;',
  '  .data-table.kartu-sempit td:has(button ~ button) {\n    display: flex;',
  AUDIT
);
sabotase(
  '`white-space:nowrap` inline dibiarkan menang — tombol Penjualan berhenti membungkus',
  CSS,
  '    white-space: normal !important;',
  '    white-space: nowrap;',
  AUDIT
);

console.log('\nSABOTASE TAMBALAN INLINE (bentuk yang dulu menyembunyikan sebabnya):');

sabotase(
  'satu layar menambal ukurannya sendiri lewat atribut style',
  BEP,
  '<button class="btn-danger" data-hapus-biaya="${b.id}">',
  '<button class="btn-danger" data-hapus-biaya="${b.id}" style="min-height:44px">',
  AUDIT
);

console.log('');
if (gagal === 0) console.log('Semua sabotase tombol-aksi tertangkap. ✅');
else console.error(`${gagal} sabotase LOLOS.`);
process.exit(gagal === 0 ? 0 : 1);
