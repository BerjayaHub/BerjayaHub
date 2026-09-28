/**
 * SABOTASE: impor Inventaris Aset dari Excel + filter catatan.
 *
 * ============ KENAPA BERKAS INI ADA ============
 *
 * Kerusakan paling mahal di fitur ini TIDAK melempar apa pun. Foto di Excel
 * menempel pada KOORDINAT, bukan pada baris — kalau jangkarnya bergeser satu,
 * kursi memakai foto meja dan meja memakai foto lemari. Setiap barisnya
 * terlihat wajar, setiap kolomnya terisi, dan tidak ada satu pun angka yang
 * bisa dipakai memeriksanya.
 *
 * Itu sebabnya dua hal di bawah ini dijaga sekeras penjaga database:
 * pratinjau sebelum simpan, dan laporan untuk foto yang melayang.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AKAR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const P = (rel) => path.join(AKAR, rel);

const MURNI = 'js/modules/asset/impor-aset.js';
const SARING = 'js/modules/asset/saringan-aset.js';
const SVC = 'js/modules/asset/asset.service.js';
const PAGE = 'js/modules/asset/asset.page.js';
const BACA = 'tools/lib/baca-xlsx.cjs';

const asli = new Map();
for (const rel of [MURNI, SARING, SVC, PAGE, BACA]) asli.set(rel, fs.readFileSync(P(rel), 'utf8'));

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
  // `String.replace` dengan string hanya mengganti kemunculan PERTAMA.
  if (typeof dari === 'string' && isi.split(dari).length > 2) {
    gagal++;
    console.error(`❌ POLANYA MUNCUL >1 KALI: ${nama} di ${rel} — sabotasenya cuma mengenai yang pertama.`);
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

const TES = 'tools/test-impor-aset.mjs';
const AUDIT = 'tools/audit-impor-aset.cjs';

console.log('SABOTASE FOTO KE BARIS YANG SALAH — tidak ada kolom yang bisa memeriksanya:');

sabotase(
  'jangkar digeser satu — kursi memakai foto meja, dan semuanya terlihat wajar',
  MURNI,
  '    const r = Number(g?.row);',
  '    const r = Number(g?.row) + 1;',
  TES
);
sabotase(
  'foto di luar baris data dibuang diam-diam — petunjuk jangkar bergeser ikut hilang',
  MURNI,
  '      melayang.push(g);\n      continue;',
  '      continue;',
  TES
);
sabotase(
  'foto kedua di baris yang sama menimpa yang pertama, tanpa laporan',
  MURNI,
  '    if (perBaris.has(r)) {\n      ganda.push(g);\n      continue;\n    }',
  '',
  TES
);
sabotase(
  'baris kosong yang menempeli foto ikut dilewati — fotonya lenyap tanpa laporan',
  MURNI,
  '    if (kosong && !punyaFoto) continue;',
  '    if (kosong) continue;',
  TES
);
sabotase(
  'pembaca fixture salah membaca jangkar — tesnya berhenti menguji berkas sungguhan',
  BACA,
  '    const row = Number(from.match(polaRow)?.[1]);',
  '    const row = Number(from.match(polaRow)?.[1]) + 1;',
  TES
);
sabotase(
  'pembaca fixture cuma mengenali tag tanpa awalan namespace — berkas simpanan Excel jadi NOL gambar',
  BACA,
  "  const T = (nama) => `(?:\\\\w+:)?${nama}`;",
  '  const T = (nama) => nama;',
  TES
);

console.log('\nSABOTASE BENTUK TEMPLATE & PEMBACAANNYA:');

sabotase(
  'header dikenali dari satu judul saja — subjudul "3 berfoto" dikira header',
  MURNI,
  '    if (iNama < 0 || iId < 0) continue;',
  '    if (iNama < 0) continue;',
  TES
);
sabotase(
  'kolom dibaca lewat nomor indeks, bukan judulnya',
  MURNI,
  "  const ambil = (row, judul) => (kolom[judul] === undefined ? '' : row?.[kolom[judul]]);",
  '  const ambil = (row, judul) => row?.[KOLOM_IMPOR_ASET.indexOf(judul)];',
  AUDIT
);
sabotase(
  '`row.values` tidak di-slice — SELURUH kolom bergeser satu, dan tiap baris ditolak "ID tidak ada"',
  SVC,
  '(row.values ?? []).slice(1)',
  '(row.values ?? [])',
  AUDIT
);
sabotase(
  'baris jangkar dibaca dari tempat lain, bukan nativeRow',
  SVC,
  'row: Number(im.range?.tl?.nativeRow),',
  'row: Number(im.range?.tl?.row),',
  AUDIT
);
sabotase(
  'sel berformula masuk sebagai "[object Object]" dan lolos jadi nama barang',
  SVC,
  "      if (typeof v === 'object') return v.result ?? v.text ?? (Array.isArray(v.richText) ? v.richText.map((t) => t.text).join('') : '');",
  '',
  AUDIT
);

console.log('\nSABOTASE "SEL KOSONG BERARTI JANGAN DIAPA-APAKAN":');

sabotase(
  'sel kosong dianggap perintah MENGHAPUS — satu unggahan mengosongkan catatan orang lain',
  MURNI,
  "  const pakai = (baru, lamaNilai) => (teks(baru) === '' ? (lamaNilai ?? null) : teks(baru));",
  '  const pakai = (baru) => teks(baru) || null;',
  TES
);
sabotase(
  'sel Jumlah kosong tersimpan sebagai 0 — "0 unit" terbaca seperti barang habis',
  MURNI,
  '  if (!/\\d/.test(bersih)) return null;',
  '',
  TES
);
sabotase(
  'jumlah bawaan barang baru jadi 0, bukan 1',
  MURNI,
  '    qty: baris.qty === null || baris.qty === undefined ? (baris.id ? (Number(lama.qty) ?? 1) : 1) : baris.qty,',
  '    qty: baris.qty ?? 0,',
  TES
);

console.log('\nSABOTASE YANG DITOLAK:');

sabotase(
  'ID asing diterima — barisnya diam-diam jadi barang baru, bukan memperbarui apa pun',
  MURNI,
  '    if (id && !lama) {',
  '    if (false) {',
  TES
);
sabotase(
  'kondisi yang tidak dikenal diterima',
  MURNI,
  '    if (kondisiSel && !kondisi) {',
  '    if (false) {',
  TES
);
sabotase(
  'jumlah negatif diterima',
  MURNI,
  '    if (qtySel !== null && qtySel < 0) {',
  '    if (false) {',
  TES
);
sabotase(
  'outlet asing diterima — barangnya mendarat di outlet yang bukan wewenangnya',
  MURNI,
  '    if (outletSel && !outletId) {',
  '    if (false) {',
  TES
);
sabotase(
  'barang baru tanpa outlet diterima',
  MURNI,
  '    if (!lama && !outletId) {',
  '    if (false) {',
  TES
);
sabotase(
  'kondisi "Lain-lain" masuk tanpa catatannya',
  MURNI,
  "    if (kondisiAkhir === 'lainnya' && !catatanKondisiAkhir) {",
  '    if (false) {',
  TES
);
sabotase(
  'barang baru tanpa nama diterima',
  MURNI,
  '    if (!nama && !lama) {',
  '    if (false) {',
  TES
);

console.log('\nSABOTASE LAYAR:');

sabotase(
  'berkasnya langsung disimpan tanpa pratinjau — foto salah barang tidak pernah ketahuan',
  PAGE,
  '    rencanaImpor = rencana;',
  '    rencanaImpor = rencana;\n    await saveAsset({ id: null, businessUnitId });',
  AUDIT
);
sabotase(
  'thumbnail pratinjau dicocokkan lewat posisi — pratinjau yang salah MEMBENARKAN foto yang salah',
  PAGE,
  "      const b = perBaris.get(img.dataset.baris);",
  '      const b = semuaBaris[0];',
  AUDIT
);
sabotase(
  'ID pembanding diambil dari daftar yang sedang tersaring',
  PAGE,
  '      semua = await listAssets({ businessUnitId });',
  '      semua = rows;',
  AUDIT
);
sabotase(
  'satu baris gagal menghentikan seluruh impor',
  PAGE,
  '        gagal.push(`Baris ${b.baris} (${b.name || b.lama?.name || \'-\'}) — ${error.message ?? error}`);',
  '        throw error;',
  AUDIT
);
sabotase(
  'kotak berkas tidak dikosongkan — berkas yang sama tidak bisa dipilih dua kali',
  PAGE,
  "    berkasImpor.value = '';",
  '',
  AUDIT
);

console.log('\nSABOTASE FILTER CATATAN:');

sabotase(
  'kotak Cari catatan digambar tapi tidak menyaring apa pun',
  SVC,
  "  if (catatan) query = query.ilike('notes', `%${catatan}%`);",
  '',
  AUDIT
);
sabotase(
  '`listAssets` membuang `catatan` sebelum sampai ke query',
  SVC,
  'export async function listAssets({ businessUnitId, outletId, condition, category, q, catatan, limit = 500 }) {',
  'export async function listAssets({ businessUnitId, outletId, condition, category, q, limit = 500 }) {',
  AUDIT
);
sabotase(
  'nilainya tidak dikirim dari layar',
  PAGE,
  '        catatan: state.catatan',
  "        catatan: ''",
  AUDIT
);
sabotase(
  'dua penunda terpisah — dua permintaan balapan, yang menang bukan yang terakhir diketik',
  PAGE,
  '  container.querySelector(\'#as-note\').addEventListener(\'input\', (e) => {\n    state.catatan = e.target.value.trim();\n    tunda();\n  });',
  '  let timer2;\n  container.querySelector(\'#as-note\').addEventListener(\'input\', (e) => {\n    state.catatan = e.target.value.trim();\n    clearTimeout(timer2);\n    timer2 = setTimeout(refresh, 300);\n  });',
  AUDIT
);
sabotase(
  'subjudul laporan berhenti menyebut saringan yang aktif — PDF hasil saringan terlihat lengkap',
  PAGE,
  '        subtitle: `${nama}${ringkasSaringan(state, ASSET_CONDITION)} · ${rows.length} jenis barang`,',
  '        subtitle: `${nama} · ${rows.length} jenis barang`,',
  AUDIT
);
sabotase(
  'outlet ikut dihitung sebagai saringan — "Belum ada aset tercatat" tidak pernah muncul di Staff App',
  SARING,
  "  return Boolean(teks(state?.q) || teks(state?.catatan) || teks(state?.category) || teks(state?.condition));",
  '  return Boolean(teks(state?.outletId) || teks(state?.q) || teks(state?.catatan));',
  AUDIT
);
sabotase(
  'kondisi yang tidak dikenal dibuang dari subjudul',
  SARING,
  '  if (kondisi) bagian.push(`Kondisi: ${labelKondisi[kondisi] ?? kondisi}`);',
  '  if (labelKondisi[kondisi]) bagian.push(`Kondisi: ${labelKondisi[kondisi]}`);',
  AUDIT
);

console.log('');
if (gagal === 0) console.log('Semua sabotase impor aset tertangkap. ✅');
else console.error(`${gagal} sabotase LOLOS — pemeriksanya tidak menjaga apa yang dikiranya dijaga.`);
process.exit(gagal === 0 ? 0 : 1);
