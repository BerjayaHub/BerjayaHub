/**
 * SABOTASE: kepala Kas dibekukan + nomor nota bisa diketuk.
 *
 * Yang dijaga bukan "tautannya ada", melainkan bahwa ia tidak pernah menunjuk
 * NOTA YANG SALAH, tidak pernah HILANG DIAM-DIAM untuk sebagian entri, dan
 * tidak pernah mengorbankan riwayat kasnya sendiri.
 *
 * ============ JEBAKAN YANG SUDAH MENGGIGIT BERKALI-KALI ============
 *
 * `String.replace` dengan STRING hanya mengganti kemunculan PERTAMA. Pola yang
 * muncul lebih dari sekali harus memakai regex `/…/g` — kalau tidak, yang
 * tersabotase adalah tempat yang salah dan "tertangkap"-nya tidak membuktikan
 * apa pun. `ukurRiwayat();` di cash.page.js adalah kasus itu: ia dipanggil dari
 * dua tempat.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AKAR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const P = (rel) => path.join(AKAR, rel);

const KET = 'js/modules/cash/keterangan-nota.js';
const RIN = 'js/modules/inventory/rincian-nota.js';
const NOTA_SVC = 'js/modules/inventory/nota.service.js';
const CASH_SVC = 'js/modules/cash/cash.service.js';
const DLG = 'js/modules/inventory/nota-dialog.js';
const PAGE = 'js/modules/cash/cash.page.js';
const CSS = 'css/styles.css';

const asli = new Map();
for (const rel of [KET, RIN, NOTA_SVC, CASH_SVC, DLG, PAGE, CSS]) asli.set(rel, fs.readFileSync(P(rel), 'utf8'));

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

const TES_KET = 'tools/test-keterangan-nota.mjs';
const TES_RIN = 'tools/test-rincian-nota.mjs';
const AUDIT = 'tools/audit-nota-dari-kas.cjs';

console.log('SABOTASE PENCOCOKAN KODE NOTA:');

sabotase(
  'pemenang seri jadi yang pertama ketemu — `TRM-1` memotong `TRM-12` dan menautkan nota yang SALAH',
  KET,
  '      if (posisi < 0 || i < posisi || (i === posisi && kode.length > String(pilih.code).length)) {',
  '      if (posisi < 0 || i < posisi) {',
  TES_KET
);
sabotase(
  'kode dicocokkan dari yang paling KANAN — potongan kalimatnya jadi tertukar',
  KET,
  '      if (posisi < 0 || i < posisi || (i === posisi && kode.length > String(pilih.code).length)) {',
  '      if (posisi < 0 || i > posisi) {',
  TES_KET
);
sabotase(
  'nota tanpa kode berhenti disaring — `\'\'.indexOf(\'\')` selalu 0, putarannya tidak pernah maju',
  KET,
  '.filter((n) => n?.id && n?.code)',
  '.filter((n) => n?.id)',
  TES_KET
);
sabotase(
  'sisa kalimat sesudah kode terakhir dibuang',
  KET,
  '  if (sisa) bagian.push({ teks: sisa });',
  '',
  TES_KET
);
sabotase(
  'nota yang kodenya tidak tertulis di keterangan berhenti ditawarkan — notanya jadi mustahil dibuka',
  KET,
  '    tambahan: daftar.filter((n) => !ketemu.has(n.id)).map((n) => ({ teks: String(n.code), notaId: n.id }))',
  '    tambahan: []',
  TES_KET
);

console.log('\nSABOTASE PASANGAN ENTRI ↔ NOTA:');

sabotase(
  'jalur `penyesuaian_nota` dicabut — baris "Penyesuaian nota TRM-…" tidak bisa diketuk padahal nomornya tertulis',
  KET,
  "    if (e?.penyesuaian_nota) tambah(e.id, perId.get(e.penyesuaian_nota));",
  '    void e;',
  TES_KET
);
sabotase(
  'jalur `payment_entry_id` dicabut — pembayaran nota kehilangan notanya',
  KET,
  '  for (const n of perId.values()) if (n.payment_entry_id) tambah(n.payment_entry_id, n);',
  '',
  TES_KET
);
sabotase(
  'nota boleh masuk dua kali ke entri yang sama — nomornya tampil kembar',
  KET,
  '    if (!daftar.some((x) => x.id === nota.id)) daftar.push(nota);',
  '    daftar.push(nota);',
  TES_KET
);
sabotase(
  '`penyesuaian_nota` berhenti diambil dari database — separuh tautannya mati di server, bukan di layar',
  CASH_SVC,
  'proof_path, penyesuaian_nota, created_at',
  'proof_path, created_at',
  AUDIT
);

console.log('\nSABOTASE NILAI DI DIALOG RINCIAN:');

sabotase(
  'nilai baris dihitung `unit_cost x qty` — meleset ribuan rupiah dari yang benar-benar dibayarkan',
  RIN,
  '      const nilai = hargaBeliBaris(it, hpp);',
  '      const nilai = (Number(it?.unit_cost) || 0) * (Number(it?.qty) || 0);',
  TES_RIN
);
sabotase(
  'harga/satuan dibaca sendiri dari `unit_cost` — dua kolom di baris yang sama berhenti saling mengalikan',
  RIN,
  '      const satuan = hargaSatuanBaris(it, hpp);',
  '      const satuan = Number(it?.unit_cost) || 0;',
  TES_RIN
);
sabotase(
  'baris tanpa harga ditulis Rp0 — total rapi dan lebih kecil dari tagihan supplier',
  RIN,
  "    b.nilai === null ? '-' : formatRupiah(b.nilai)",
  '    formatRupiah(b.nilai ?? 0)',
  TES_RIN
);
sabotase(
  'nota yang SELURUH barisnya belum berharga menampilkan Rp0 — seolah barangnya gratis',
  RIN,
  "    totalTeks: adaNilai ? formatRupiah(total) : '-',",
  '    totalTeks: formatRupiah(total),',
  TES_RIN
);
sabotase(
  'baris tanpa harga berhenti dihitung — tidak ada tanda bahwa totalnya kurang',
  RIN,
  '      if (nilai === null) tanpaHarga++;',
  '      if (false) tanpaHarga++;',
  TES_RIN
);
sabotase(
  'produk yang sudah dihapus dari master dibuang — total dialog tidak lagi cocok dengan yang dibayarkan',
  RIN,
  "        bahan: teks(it?.products?.name) || '(produk terhapus)',",
  "        bahan: teks(it?.products?.name),",
  TES_RIN
);
sabotase(
  'barisnya tidak diurut — dialog yang sama dibuka dua kali menampilkan urutan berbeda',
  RIN,
  "    .sort((a, b) => a.bahan.localeCompare(b.bahan, 'id'));",
  '    .slice();',
  TES_RIN
);
sabotase(
  'status batal berhenti ditandai — nota yang barangnya sudah ditarik terlihat seperti nota biasa',
  RIN,
  '  const batal = n.status === STATUS_BATAL;',
  '  const batal = false;',
  TES_RIN
);

console.log('\nSABOTASE PENGAMBILAN & DIALOG:');

sabotase(
  'hanya satu jalur nota yang diambil dari server',
  NOTA_SVC,
  "  await kumpulkan(notaIds, 'id');",
  '',
  AUDIT
);
sabotase(
  'kegagalan query nota dilempar — SELURUH riwayat kas ikut kosong',
  NOTA_SVC,
  "        console.warn('[kas] gagal mengambil nota terkait:', error.message);",
  '        throw error;',
  AUDIT
);
// Polanya memuat `status, alasan_batal` supaya menyasar `KOLOM_NOTA_RINGKAS`,
// BUKAN daftar kolom `riwayatNota` yang memuat potongan `invoice_no,
// photo_path, notes` yang sama dan berada ratusan baris LEBIH DULU di berkas ini.
sabotase(
  'foto nota tidak ikut diambil',
  NOTA_SVC,
  'invoice_no, photo_path, notes, status, alasan_batal',
  'invoice_no, notes, status, alasan_batal',
  AUDIT
);
sabotase(
  '`payment_entry_id` tidak ikut diambil — notanya tidak bisa dipasangkan ke entri kas yang melunasinya',
  NOTA_SVC,
  'payment_status, payment_source, payment_entry_id, outlet_id',
  'payment_status, payment_source, outlet_id',
  AUDIT
);
sabotase(
  'foto dimuat SEBELUM dialognya terbuka — mengetuk nomor nota terasa tidak berfungsi selama satu-dua detik',
  DLG,
  '    onReady: (body) => muatFoto(body, r.photoPath)',
  '    onReady: null',
  AUDIT
);
sabotase(
  'gambar yang gagal dimuat dibiarkan jadi ikon rusak — terbaca sebagai "notanya tidak ada"',
  DLG,
  "  img?.addEventListener('error', () => {",
  '  const abaikan = () => (() => {',
  AUDIT
);
sabotase(
  'isi nota yang gagal dimuat membatalkan seluruh dialog, padahal kepala notanya sudah di tangan',
  DLG,
  '    gagalItem = error?.message ?? String(error);',
  '    throw error;',
  AUDIT
);

console.log('\nSABOTASE LAYAR & CSS:');

sabotase('kepala halaman tidak lagi dibungkus pembekunya', PAGE, '<div class="kas-header">', '<div>', AUDIT);
sabotase('wadah riwayat kehilangan penandanya', PAGE, 'class="table-scroll kas-riwayat"', 'class="table-scroll"', AUDIT);
sabotase(
  'potongan keterangan berhenti di-escape — kolom Keterangan jadi jalan masuk HTML',
  PAGE,
  '    const utama = bagian.map((b) => (b.notaId ? tombol(b) : escapeHtml(b.teks))).join(\'\');',
  "    const utama = bagian.map((b) => (b.notaId ? tombol(b) : b.teks)).join('');",
  AUDIT
);
sabotase(
  'tombol nomor nota digambar tapi tidak pernah dipasangi penangan klik',
  PAGE,
  "      box.querySelectorAll('.btn-nota').forEach((btn) =>",
  '      [].forEach((btn) =>',
  AUDIT
);
sabotase(
  'kegagalan mengambil nota mengosongkan seluruh riwayat kas',
  PAGE,
  '      ).catch(() => []);\n      const notaPerEntri',
  '      );\n      const notaPerEntri',
  AUDIT
);
sabotase(
  'tinggi riwayat dipatok angka tetap — ruang kosong di satu keadaan, halaman ikut menggulir di keadaan lain',
  PAGE,
  '    kotak.style.maxHeight = `${Math.max(220, window.innerHeight - atas - 16)}px`;',
  "    kotak.style.maxHeight = '400px';",
  AUDIT
);
sabotase(
  'mode kartu ikut diberi tinggi — `overflow-x` terpaksa jadi auto dan halamannya melebar lagi',
  PAGE,
  '    if (window.innerWidth <= 560) {',
  '    if (false) {',
  AUDIT
);
sabotase(
  'pendengar `resize` tidak pernah dilepas — satu tertinggal tiap kali orang berpindah modul',
  PAGE,
  "      window.removeEventListener('resize', ukurRiwayat);",
  '',
  AUDIT
);
// `/…/g`: `ukurRiwayat();` dipanggil dari DUA tempat (akhir `refresh` dan
// `openKelola`). Dengan string biasa cuma yang pertama mati, dan wadahnya tetap
// terukur dari panggilan yang lain — "tertangkap" yang tidak membuktikan apa pun.
sabotase(
  'pengukuran tingginya tidak pernah dipanggil',
  PAGE,
  /\n\s*ukurRiwayat\(\);/g,
  '',
  AUDIT
);
sabotase(
  '`.kas-header` tidak lagi dibekukan — saldo & tombolnya ikut tergulir',
  CSS,
  '  .kas-header {\n    position: -webkit-sticky;\n    position: sticky;',
  '  .kas-header {\n    position: static;',
  AUDIT
);
sabotase(
  'riwayat berhenti menggulir sendiri',
  CSS,
  '  .table-scroll.kas-riwayat {\n    overflow-y: auto;',
  '  .table-scroll.kas-riwayat {\n    overflow-y: visible;',
  AUDIT
);
sabotase(
  'judul kolom riwayat berhenti dibekukan — angka tanpa judul kolom bisa dibaca sebagai kolom yang salah',
  CSS,
  '  .table-scroll.kas-riwayat thead th {\n    position: -webkit-sticky;\n    position: sticky;',
  '  .table-scroll.kas-riwayat thead th {\n    position: static;',
  AUDIT
);
// `/…/g`: pengecualiannya ditulis DUA KALI (satu untuk `.app-content`, satu
// untuk `.staff-main`). Dengan string biasa hanya yang pertama hilang, salah
// satu selektor masih memuatnya, dan auditnya tetap hijau — "tertangkap" yang
// tidak membuktikan apa pun.
sabotase(
  '`.btn-nota` kembali ikut gaya tombol sekunder — kotak berlatar di dalam sel tabel',
  CSS,
  /:not\(\.btn-whatsapp\):not\(\.btn-nota\)/g,
  ':not(.btn-whatsapp)',
  AUDIT
);
sabotase(
  '`.btn-nota` jadi blok — memutus kalimat keterangannya dan memakan lebar sel',
  CSS,
  '.btn-nota {\n  display: inline;',
  '.btn-nota {\n  display: block;',
  AUDIT
);
sabotase(
  'foto nota di dialog tanpa batas ukuran — foto kamera HP memenuhi layar',
  CSS,
  '.nota-foto img {',
  '.nota-foto img-nonaktif {',
  AUDIT
);

console.log('');
if (gagal === 0) console.log('Semua sabotase nota-dari-kas tertangkap. ✅');
else console.error(`${gagal} sabotase LOLOS.`);
process.exit(gagal === 0 ? 0 : 1);
