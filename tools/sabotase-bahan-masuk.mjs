/**
 * SABOTASE: ekspor bahan masuk satu rentang tanggal.
 *
 * Berkas ini dipakai mencocokkan tagihan supplier. Semua cara ia gagal
 * berbentuk sama — kolomnya lengkap, totalnya masuk akal, angkanya salah, dan
 * tidak ada satu pun error. Yang diperiksa di sini: apakah tes & auditnya
 * benar-benar menggigit kalau salah satu penjagaannya dicabut.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AKAR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const P = (rel) => path.join(AKAR, rel);

const HARGA = 'js/modules/inventory/harga-baris.js';
const RENTANG = 'js/modules/inventory/laporan-bahan-masuk.js';
const LAPNOTA = 'js/modules/inventory/laporan-nota.js';
const SVC = 'js/modules/inventory/nota.service.js';
const HAL = 'js/modules/inventory/nota.admin.js';
const XLSX = 'js/core/xlsx.js';

const asli = new Map();
for (const rel of [HARGA, RENTANG, LAPNOTA, SVC, HAL, XLSX]) asli.set(rel, fs.readFileSync(P(rel), 'utf8'));

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

const TES = 'tools/test-bahan-masuk.mjs';
const TES_NOTA = 'tools/test-laporan-nota.mjs';
const AUDIT = 'tools/audit-bahan-masuk.cjs';

console.log('SABOTASE HARGA BELI BARIS:');

sabotase(
  '`line_total` diabaikan — kembali menghitung `unit_cost × qty` yang meleset karena pembulatan',
  HARGA,
  '  const total = angkaAtauNull(item.line_total);\n  if (total !== null) return total;',
  '',
  TES
);
sabotase(
  'harga 0 jatuh ke HPP — nota barang bonus jadi bernilai',
  HARGA,
  'const satuan = angkaAtauNull(item.unit_cost) ??',
  'const satuan = angkaAtauNull(item.unit_cost) ||',
  TES
);
sabotase(
  'string kosong tidak disaring — kolom harga kosong terbaca Rp0',
  HARGA,
  "  if (v === null || v === undefined || v === '') return null;",
  '  if (v === null || v === undefined) return null;',
  TES
);
sabotase(
  'baris tanpa harga dikembalikan 0, bukan null — total terlihat sah padahal kurang',
  HARGA,
  '  if (satuan === null) return null;',
  '  if (satuan === null) return 0;',
  TES
);
sabotase('harga satuan dibagi qty 0 — Infinity masuk laporan', HARGA, '  if (!qty) return null;', '', TES);

console.log('\nSABOTASE LAPORAN RENTANG:');

sabotase(
  'nota batal ikut dihitung — pembelian terlihat lebih besar dari yang sebenarnya',
  RENTANG,
  "    if (n.status === STATUS_BATAL) {\n      notaBatal++;\n      continue;\n    }",
  '',
  TES
);
sabotase(
  'nota batal dibuang diam-diam — orang mengira notanya hilang',
  RENTANG,
  'notaBatal ? `${notaBatal} nota batal tidak diikutkan` : \'\',',
  "'',",
  TES
);
sabotase(
  'baris tanpa harga berhenti dihitung — kekurangannya tidak lagi terlihat',
  RENTANG,
  '    if (nilai === null) barisTanpaHarga++;',
  '    if (nilai === null) { /* diam */ }',
  TES
);
sabotase(
  'bahan tanpa harga ditulis Rp0, bukan "-"',
  RENTANG,
  "      g.adaNilai ? formatRupiah(g.nilai) : '-',",
  '      formatRupiah(g.nilai),',
  TES
);
sabotase(
  'kolom Harga beli berhenti numeric — di Excel jadi teks dan tidak bisa dijumlahkan',
  RENTANG,
  "  { header: 'Harga beli', width: 1.2, align: 'right', numeric: true },",
  "  { header: 'Harga beli', width: 1.2, align: 'right' },",
  AUDIT
);
sabotase(
  'rekap berhenti menghitung jumlah nota per bahan',
  RENTANG,
  '    g.notas.add(r.receiptId);',
  '',
  TES
);

console.log('\nSABOTASE LAPORAN PER NOTA (harus tetap sama dengan server):');

sabotase(
  'laporan per nota kembali menghitung sendiri, menyimpang dari `nota_ringkas`',
  LAPNOTA,
  '    const nilai = hargaBeliBaris(i, hpp);',
  '    const nilai = (i.unit_cost ?? hpp.get(i.product_id) ?? null) == null ? null : (i.unit_cost ?? hpp.get(i.product_id)) * jumlah;',
  AUDIT
);

console.log('\nSABOTASE PENGAMBILAN DATA:');

sabotase(
  '`ambilSemua` dilepas — sebulan pembelian terpotong diam-diam di 1000 baris',
  SVC,
  '    const baris = await ambilSemua((dari, sampai) =>',
  '    const baris = await (async () => (await (',
  AUDIT
);
sabotase(
  'daftar id tidak dipotong — URL kepanjangan ditolak 414',
  SVC,
  '    const bagian = ids.slice(i, i + POTONG);',
  '    const bagian = ids;',
  AUDIT
);
sabotase('`line_total` tidak ikut diambil — harga beli barisnya hilang', SVC, 'receipt_id, product_id, qty, unit_cost, line_total, notes, products(name, base_unit)', 'receipt_id, product_id, qty, unit_cost, notes, products(name, base_unit)', AUDIT);

console.log('\nSABOTASE LAYAR:');

sabotase('tombol ekspor rentang dihapus', HAL, 'id="nt-ekspor"', 'id="nt-x"', AUDIT);
sabotase(
  'yang diekspor bukan daftar yang sedang terlihat',
  HAL,
  '          notas: notaTampil,',
  '          notas: [],',
  AUDIT
);
sabotase(
  'kegagalan mengambil isi nota ditelan — berkas kekurangan nota tanpa jejak',
  HAL,
  '          items = await itemNotaBanyak(notaTampil.map((n) => n.id));',
  '          items = await itemNotaBanyak(notaTampil.map((n) => n.id)).catch(() => []);',
  AUDIT
);
sabotase(
  'sheet rekap per bahan dibuang',
  HAL,
  "              name: 'Rekap per Bahan',",
  "              name: 'Rincian',",
  AUDIT
);

console.log('\nSABOTASE PENULIS XLSX:');

sabotase(
  '`exportTableXLSX` menulis sendiri lagi — dua salinan yang akan menyimpang',
  XLSX,
  '  return exportSheetsXLSX({ filename, sheets: [',
  '  return exportLama({ filename, sheets: [',
  AUDIT
);
sabotase(
  'nama sheet kembar tidak dicegah — Excel menolak membuka berkasnya',
  XLSX,
  '    while (terpakai.has(nama)) nama = `${nama.slice(0, 28)}(${n++})`;',
  '',
  AUDIT
);

console.log('\nREGRESI: laporan per nota yang lama tetap benar');
if (!jalan(TES_NOTA)) {
  gagal++;
  console.error(`❌ ${TES_NOTA} MERAH pada kode yang tidak dirusak — perubahan line_total memutus laporan per nota.`);
} else {
  console.log('   ✔ test-laporan-nota tetap hijau sesudah beralih ke line_total');
}

console.log('');
if (gagal === 0) console.log('Semua sabotase bahan-masuk tertangkap. ✅');
else console.error(`${gagal} sabotase LOLOS.`);
process.exit(gagal === 0 ? 0 : 1);
