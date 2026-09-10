/**
 * SABOTASE pencarian nama bahan — memeriksa bahwa tes & auditnya MENGGIGIT.
 *
 * Bahaya terbesar fitur ini bukan pencariannya melainkan CARA menyaringnya.
 * Menyaring dengan menggambar ulang tabel akan menghapus isian yang sudah
 * diketik DAN membuat baris yang tersembunyi tidak ikut terkirim ke server —
 * menghidupkan kembali kegagalan yang baru saja diperbaiki 0132, lewat pintu
 * yang tidak akan dicurigai siapa pun.
 *
 * Jalankan: node tools/sabotase-saring-bahan.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AKAR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const P = (rel) => path.join(AKAR, rel);

const MURNI = 'js/modules/dispatch/saring-baris.js';
const HELPER = 'js/modules/dispatch/saring-tabel.js';
const HAL = 'js/modules/dispatch/dispatch.page.js';
const PICK = 'js/modules/dispatch/item-picker.js';

const asli = new Map();
for (const rel of [MURNI, HELPER, HAL, PICK]) asli.set(rel, fs.readFileSync(P(rel), 'utf8'));

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

const TES = 'tools/test-saring-baris.mjs';
const AUDIT = 'tools/audit-saring-bahan.cjs';

console.log('\n== Aturan inti: sembunyikan, jangan buang ==');

sabotase(
  'baris disaring dengan remove() — isian yang sudah diketik hilang & tidak terkirim',
  HELPER,
  'el.hidden = !cocok;',
  'if (!cocok) el.remove();',
  AUDIT
);

sabotase(
  'tabel digambar ulang berisi yang cocok saja',
  HELPER,
  '      el.hidden = !cocok;\n      if (cocok) tampil += 1;',
  '      if (cocok) { tampil += 1; } else { el.innerHTML = ""; }',
  AUDIT
);

sabotase(
  'picker membuang baris, bukan menyembunyikannya',
  PICK,
  'row.hidden = !cocok;',
  'if (!cocok) row.remove();',
  AUDIT
);

console.log('\n== Aturan pencocokan ==');

sabotase(
  'kata kunci kosong dianggap TIDAK cocok — seluruh tabel menghilang saat layar dibuka',
  MURNI,
  'if (!q) return true;',
  'if (!q) return false;',
  TES
);

sabotase(
  'dicocokkan sebagai satu potongan — "crispy cireng" tidak pernah ketemu',
  MURNI,
  "return q.split(' ').every((w) => t.includes(w));",
  'return t.includes(q);',
  TES
);

sabotase(
  'huruf besar-kecil berhenti diabaikan',
  MURNI,
  '    .toLowerCase()\n    .replace(/[^a-z0-9]+/g, \' \')',
  "    .replace(/[^a-zA-Z0-9]+/g, ' ')",
  TES
);

sabotase(
  'barisCocok mengembalikan nilainya, bukan indeksnya',
  MURNI,
  'if (cocokKata(n, kata)) hasil.push(i);',
  'if (cocokKata(n, kata)) hasil.push(n);',
  TES
);

sabotase(
  'keadaan "tidak ada yang cocok" berhenti menegaskan bahwa sisanya disembunyikan',
  MURNI,
  /if \(tampil === 0\) return `Tidak ada bahan yang cocok[^`]*`;/,
  "if (tampil === 0) return 'Kosong.';",
  TES
);

console.log('\n== Penyambungan di tiga layar ==');

sabotase(
  'kotak pencarian hilang dari Order Masuk (CK)',
  HAL,
  'class="ord-cari-bahan"',
  'class="ord-cari-bahan-nonaktif"',
  AUDIT
);

sabotase(
  'kotak pencarian hilang dari layar Terima (outlet)',
  HAL,
  'class="recv-cari-bahan"',
  'class="recv-cari-bahan-nonaktif"',
  AUDIT
);

sabotase(
  'Draft Surat Jalan berhenti menyalakan pencariannya',
  HAL,
  'cariBaris: true,',
  'cariBaris: false,',
  AUDIT
);

sabotase(
  'baris tabel berhenti membawa namanya — tidak ada yang bisa dicocokkan',
  HAL,
  / data-nama="\$\{esc\(it\.products\?\.name \?\? ''\)\}"/g,
  '',
  AUDIT
);

sabotase(
  'kotak pencarian picker tidak tersambung',
  PICK,
  "mountEl.querySelector('.pf-cari')?.addEventListener('input', terapkanSaringan);",
  '',
  AUDIT
);

sabotase(
  'saringan tidak dijalankan ulang sesudah baris baru ditambahkan',
  PICK,
  '    rowsBox.appendChild(row);\n    wireRow(row, opts);\n    segarkanDuplikat();\n    terapkanSaringan();',
  '    rowsBox.appendChild(row);\n    wireRow(row, opts);\n    segarkanDuplikat();',
  AUDIT
);

sabotase(
  'baris kosong ikut disembunyikan — "+ Tambah Produk" terlihat tidak melakukan apa-apa',
  PICK,
  'const cocok = !id || cocokKata(',
  'const cocok = cocokKata(',
  AUDIT
);

sabotase(
  'ringkasan "x dari y" dihapus — tabel dua baris terbaca seperti datanya hilang',
  HELPER,
  'if (info) info.textContent = ringkasSaringan(total, tampil, kata);',
  '',
  AUDIT
);

sabotase(
  'saringan tidak dijalankan sekali saat dipasang — ringkasannya kosong sampai orang mengetik',
  HELPER,
  "  kotak.addEventListener('input', jalankan);\n  jalankan();",
  "  kotak.addEventListener('input', jalankan);",
  AUDIT
);

console.log('');
if (gagal === 0) {
  console.log('Semua sabotase cari-bahan tertangkap. Tes & auditnya menggigit. ✅');
} else {
  console.error(`${gagal} sabotase LOLOS.`);
}
process.exit(gagal === 0 ? 0 : 1);
