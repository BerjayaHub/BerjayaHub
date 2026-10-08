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
