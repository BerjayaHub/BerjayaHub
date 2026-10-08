/**
 * SABOTASE: unduhan barang terkirim.
 *
 * ============ KENAPA BERKAS INI ADA ============
 *
 * Kerusakan paling mahal di fitur ini menghasilkan berkas yang RAPI dan SALAH.
 * Kolomnya terisi, totalnya menjumlah, Excel-nya membuka tanpa keluhan — dan
 * angkanya membuat orang mencari barang yang tidak pernah hilang.
 *
 * Dua bentuknya yang paling berbahaya:
 *
 *   `received_qty` NULL dijumlah sebagai 0  -> "Dikirim 100, Diterima 40"
 *   rincian & rekap disusun terpisah        -> dua total yang tidak ada
 *                                              layarnya bisa menjelaskan
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AKAR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const P = (rel) => path.join(AKAR, rel);

const MURNI = 'js/modules/dispatch/rekap-kiriman.js';
const SVC = 'js/modules/dispatch/dispatch.service.js';
const PAGE = 'js/modules/dispatch/dispatch.admin.page.js';

const asli = new Map();
for (const rel of [MURNI, SVC, PAGE]) asli.set(rel, fs.readFileSync(P(rel), 'utf8'));

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
  // `String.replace` dengan string hanya mengganti kemunculan PERTAMA.
  if (typeof dari === 'string' && isi.split(dari).length > 2) {
    gagal++;
    console.error(`❌ POLANYA MUNCUL >1 KALI: ${nama} di ${rel} — sabotasenya cuma mengenai yang pertama.`);
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

const TES = 'tools/test-rekap-kiriman.mjs';
const AUDIT = 'tools/audit-rekap-kiriman.cjs';

console.log('SABOTASE "BELUM DITERIMA" JADI NOL — orang mencari barang yang tak hilang:');

sabotase(
  'yang belum diterima dijumlahkan sebagai 0 — "Dikirim 100, Diterima 40"',
  MURNI,
  '    const diterima = qty(it.received_qty);',
  '    const diterima = Number(it.received_qty ?? 0);',
  TES
);
sabotase(
  'Selisih dihitung juga untuk yang masih di jalan — terbaca sebagai barang hilang',
  MURNI,
  '    const selisih = diterima === null ? null : diterima - dikirim;',
  '    const selisih = (diterima ?? 0) - dikirim;',
  TES
);
sabotase(
  'kolom Diterima diisi 0, bukan dikosongkan — kosongnya sendiri adalah informasi',
  MURNI,
  "      diterima === null ? '' : diterima,",
  '      diterima ?? 0,',
  TES
);
sabotase(
  'kolom Selisih diisi 0 untuk yang belum diterima',
  MURNI,
  "      selisih === null ? '' : selisih,",
  '      selisih ?? 0,',
  TES
);
sabotase(
  'baris yang belum diterima tidak dihitung sendiri — dua kolom lain jadi tak bisa dipercaya',
  MURNI,
  '      p.belum += 1;',
  '      p.belum += 0;',
  TES
);
sabotase(
  'Selisih rekap dihitung dari selisih KOLOM, bukan per baris',
  MURNI,
  "      p.adaSelisih ? p.selisih : '',",
  '      p.diterima - p.dikirim,',
  TES
);
sabotase(
  'barang yang belum diterima sama sekali mendapat Selisih 0 — terbaca "cocok"',
  MURNI,
  '      p.selisih += selisih;\n      p.adaSelisih = true;',
  '      p.selisih += selisih;',
  TES
);

console.log('\nSABOTASE DUA BENTUK YANG MENYIMPANG:');

sabotase(
  'rekap berhenti menjumlahkan Dikirim — totalnya beda dari rincian',
  MURNI,
  '    p.dikirim += dikirim;',
  '    p.dikirim += 0;',
  TES
);
sabotase(
  'rekap dikelompokkan lewat NAMA — kilogram dijumlah dengan pack',
  MURNI,
  '    const kunci = it.product_id ?? `nama:${teks(it.product_name)}`;',
  '    const kunci = `nama:${teks(it.product_name)}`;',
  TES
);
sabotase(
  'jumlah surat jalan dihitung per baris, bukan unik',
  MURNI,
  '      p.dokumen.size,',
  '      p.dikirim > 0 ? 1 : 0,',
  TES
);
sabotase(
  '"Nilai" berubah arti jadi HPP × DITERIMA — satu kiriman terbaca dua angka',
  MURNI,
  '    const nilai = adaHpp ? Number(hpp) * dikirim : null;',
  '    const nilai = adaHpp ? Number(hpp) * (diterima ?? 0) : null;',
  TES
);
sabotase(
  'HPP yang tidak ada ditulis 0 — "Rp0" terbaca seperti barang gratis',
  MURNI,
  "      adaHpp ? Number(hpp) : '',",
  '      Number(hpp) || 0,',
  TES
);
sabotase(
  'kolom angka kehilangan `numeric` — SUM di Excel nol, dan selnya tetap rapi',
  MURNI,
  "  { header: 'Dikirim', width: 0.8, align: 'right', numeric: true },",
  "  { header: 'Dikirim', width: 0.8, align: 'right' },",
  TES
);
sabotase(
  'kolom "Belum diterima" dibuang dari rekap',
  MURNI,
  "  { header: 'Belum diterima (baris)', width: 1.1, align: 'right', numeric: true },",
  '',
  AUDIT
);
sabotase(
  '`qty` meratakan kosong jadi nol',
  MURNI,
  "  if (v === null || v === undefined || v === '') return null;",
  '  if (v === null || v === undefined) return 0;',
  TES
);

console.log('\nSABOTASE LAYANAN:');

sabotase(
  '`ambilSemua` dilepas — sebulan kiriman terpotong di ~1.000 baris, tanpa galat',
  SVC,
  '  const baris = await ambilSemua((dari, sampai) => {',
  '  const baris = await (async (f) => (await f(0, 999)).data)((dari, sampai) => {',
  AUDIT
);
sabotase(
  '`received_qty` diratakan di layanan — seluruh lapisan di atasnya kehilangan bedanya',
  SVC,
  '    received_qty: it.received_qty,',
  '    received_qty: it.received_qty ?? 0,',
  AUDIT
);
sabotase(
  'header kiriman tidak di-embed `!inner` — saringannya tidak menempel',
  SVC,
  "          'dispatches!inner(id, code, status, created_at, received_at, '",
  "          'dispatches(id, code, status, created_at, received_at, '",
  AUDIT
);
sabotase(
  'saringan outlet tujuan hilang dari unduhan',
  SVC,
  "    if (toOutletId) query = query.eq('dispatches.to_outlet_id', toOutletId);",
  '',
  AUDIT
);
sabotase(
  'saringan outlet tabel kembali tidak sampai ke server',
  SVC,
  "  if (toOutletId) query = query.eq('to_outlet_id', toOutletId);",
  '',
  AUDIT
);

sabotase(
  'diurutkan lewat kolom embed — paginasi kehilangan baris tanpa satu pun galat',
  SVC,
  "      .order('id');",
  "      .order('created_at', { ascending: false, referencedTable: 'dispatches' });",
  AUDIT
);
sabotase(
  'urutan yang dilihat orang tidak lagi disusun di memori',
  SVC,
  "    .sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')));",
  '  ;',
  AUDIT
);

console.log('\nSABOTASE LAYAR:');

sabotase(
  'tombol unduh Excel tidak digambar — kemampuannya ada, jalannya tidak',
  PAGE,
  '<button id="dp-xlsx">⇩ Excel barang terkirim</button>',
  '',
  AUDIT
);
sabotase(
  'saringan outlet asal tidak digambar',
  PAGE,
  '<select id="dp-from-outlet"><option value="">Semua outlet</option>${opsiOutlet}</select>',
  '<span></span>',
  AUDIT
);
sabotase(
  'saringan dibaca terpisah oleh daftar & unduhan — layar dan berkas menjawab beda',
  PAGE,
  'function saringan(container) {',
  'function saringanLama(container) {',
  AUDIT
);
sabotase(
  'kedua bentuk jadi dua berkas terpisah — tidak ada yang bisa memastikan keduanya serentang',
  PAGE,
  "          { name: 'Rekap per Barang', title: 'Barang Terkirim — Rekap per Barang', subtitle: catatan, columns: KOLOM_REKAP, rows: hasil.rekap }",
  '',
  AUDIT
);
sabotase(
  'berkasnya berhenti menyebutkan saringan yang aktif',
  PAGE,
  'function ringkasSaringan(s, namaOutlet) {',
  'function ringkasSaringanLama(s, namaOutlet) {',
  AUDIT
);
sabotase(
  'jumlah baris yang belum diterima tidak ikut ditulis di berkasnya',
  PAGE,
  "    r.belum ? ` · ${r.belum} baris belum diterima` : ''",
  "    ''",
  AUDIT
);
sabotase(
  '`round()` yang tidak pernah dipakai hidup lagi',
  PAGE,
  'function fmtDateTime(iso) {',
  'function round(n) {\n  return Math.round(Number(n) * 100) / 100;\n}\nfunction fmtDateTime(iso) {',
  AUDIT
);

console.log('');
if (gagal === 0) console.log('Semua sabotase rekap kiriman tertangkap. ✅');
else console.error(`${gagal} sabotase LOLOS — pemeriksanya tidak menjaga apa yang dikiranya dijaga.`);
process.exit(gagal === 0 ? 0 : 1);
