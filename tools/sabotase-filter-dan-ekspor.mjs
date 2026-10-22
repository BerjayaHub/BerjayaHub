/**
 * SABOTASE: saringan nama/tanggal + ekspor berfoto (sesi ini).
 *
 * ============ KENAPA BERKAS INI ADA ============
 *
 * Kelima perubahan sesi ini menghasilkan BERKAS yang dikirim ke orang lain —
 * akuntan, grup WhatsApp, lampiran tagihan. Kegagalannya karena itu punya
 * bentuk yang khas: tidak terlihat di komputer yang membuatnya, dan baru
 * ketahuan di tangan orang yang menerimanya.
 *
 *   PDF memuat 40 orang padahal layarnya 1  -> ketahuan setelah dikirim
 *   kolom Nominal berlipat delapan          -> ketahuan saat direkonsiliasi
 *   nama sheet ber-"/"                      -> Excel menolak seluruh berkasnya
 *   batas memotong di nota ke-60            -> separuh tagihan tidak tercocokkan
 *
 * Yang diperiksa di sini bukan kodenya, melainkan apakah PEMERIKSANYA masih
 * benar-benar menjaga sesuatu.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AKAR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const P = (rel) => path.join(AKAR, rel);

const SISA = 'js/modules/leave/sisa-cuti.js';
const LSVC = 'js/modules/leave/leave.service.js';
const LADM = 'js/modules/leave/leave.admin.page.js';
const ATT = 'js/modules/attendance/attendance.admin.page.js';
const NBM = 'js/modules/attendance/nbm-report.admin.page.js';
const LK = 'js/modules/cash/laporan-kas.js';
const EK = 'js/modules/cash/ekspor-kas.js';
const CADM = 'js/modules/cash/cash.admin.page.js';
const AP = 'js/modules/inventory/aturan-nota-persheet.js';
const EP = 'js/modules/inventory/ekspor-nota-persheet.js';
const NADM = 'js/modules/inventory/nota.admin.js';
const XF = 'js/core/xlsx-foto.js';
const PDF = 'js/core/pdf.js';

const BERKAS = [SISA, LSVC, LADM, ATT, NBM, LK, EK, CADM, AP, EP, NADM, XF, PDF];
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

const AUDIT = 'tools/audit-filter-dan-ekspor.cjs';
const T_CUTI = 'tools/test-sisa-cuti.mjs';
const T_KAS = 'tools/test-laporan-kas.mjs';
const T_SHEET = 'tools/test-ekspor-persheet.mjs';

// =====================================================================
console.log('SABOTASE SISA CUTI:');
// =====================================================================

// Dua pemeriksa untuk sabotase yang sama: auditnya membaca penjaganya, tes
// murninya menguji AKIBATNYA.
sabotase(
  "penjaga null `quota_days` dicabut — Number(null) adalah 0, jadi 'belum diatur' jadi 'jatahmu nol'",
  SISA,
  "const adaKuota = quotaDays !== null && quotaDays !== undefined && quotaDays !== '';",
  'const adaKuota = Number.isFinite(Number(quotaDays));',
  AUDIT
);
sabotase(
  'penjaga null `quota_days` dicabut — DAN tes murni harus ikut merah',
  SISA,
  "const adaKuota = quotaDays !== null && quotaDays !== undefined && quotaDays !== '';",
  'const adaKuota = Number.isFinite(Number(quotaDays));',
  T_CUTI
);

sabotase(
  'sisa minus dipotong ke nol — persetujuan yang melampaui jatah jadi tak terlihat',
  SISA,
  '  const sisa = kuota - pakai;',
  '  const sisa = Math.max(0, kuota - pakai);',
  T_CUTI
);

sabotase(
  'pengajuan tertunda ikut dijumlahkan jadi terpakai — sisa beda dari layar staff',
  SISA,
  "    if (p?.status !== 'approved') continue;",
  "    if (p?.status !== 'approved' && p?.status !== 'pending') continue;",
  T_CUTI
);

// Polanya DIPANJANGKAN sampai baris sebelumnya: penyaringan tahun muncul
// identik di `hitungTerpakai` DAN `hitungTertunda`, dan `replace` hanya
// mengenai yang pertama. Sabotase yang mengenai fungsi yang salah menguji hal
// yang berbeda dari judulnya — harness-nya sendiri yang menangkap ini.
sabotase(
  'tahun lain ikut terhitung di `hitungTerpakai` — jatah tidak lagi penuh tiap Januari',
  SISA,
  "    if (p?.status !== 'approved') continue;\n    const mulai = teks(p.start_date);\n    if (tahun != null && mulai.slice(0, 4) !== String(tahun)) continue;",
  "    if (p?.status !== 'approved') continue;",
  T_CUTI
);

sabotase(
  '"belum diberi" dilebur dengan "tanpa batas" — dua keadaan yang butuh tindakan berbeda',
  SISA,
  "  if (!sel.punyaHak) return 'belum diberi';",
  '  /* dilebur */',
  T_CUTI
);

sabotase(
  'staff tanpa hak apa pun disaring keluar — yang justru perlu dikerjakan jadi tak terlihat',
  SISA,
  '  const baris = (Array.isArray(staff) ? staff : []).map((s) => {',
  '  const baris = (Array.isArray(staff) ? staff : []).filter(() => false).map((s) => {',
  T_CUTI
);

sabotase(
  '`ambilSemua` dicabut — PostgREST memotong di ~1.000 baris tanpa galat, sisa cuti terlihat lebih besar',
  LSVC,
  '    ambilSemua(async (dari, sampai) =>\n      supabase\n        .from(\'leave_requests\')',
  "    (async () =>\n      supabase\n        .from('leave_requests')",
  AUDIT
);

sabotase(
  'saringan tanggal cuti jadi "mulai di dalam rentang" — cuti 28 Sep–3 Okt hilang dari Oktober',
  LSVC,
  "  if (dari) query = query.gte('end_date', dari);",
  "  if (dari) query = query.gte('start_date', dari);",
  AUDIT
);

sabotase(
  'tab Sisa Cuti dicabut dari daftar tab — layarnya ada, tidak bisa dicapai siapa pun',
  LADM,
  "  { key: 'sisa', label: 'Sisa Cuti' },",
  '',
  AUDIT
);

sabotase(
  'tab Sisa Cuti terdaftar tapi tidak dirender — diklik, lalu tidak terjadi apa-apa',
  LADM,
  "    if (key === 'sisa') await renderSisaTab(content, businessUnitId);",
  '',
  AUDIT
);

// =====================================================================
console.log('\nSABOTASE SARINGAN NAMA PRESENSI:');
// =====================================================================

// ============ URUTAN, BUKAN KEBERADAAN ============
//
// Sabotase ini tidak menghapus apa pun: saringannya tetap ada dan layarnya
// tetap benar. Yang berubah cuma urutannya — dan itu cukup membuat PDF memuat
// empat puluh orang untuk layar yang menampilkan satu.
// ============ SATU SABOTASE YANG SAYA GANTI SENDIRI ============
//
// Percobaan pertama mengubah `lastRecords = records` jadi `[...records]` dan
// LOLOS — dan auditnya benar: menyalin array yang SUDAH disaring tidak
// mengubah apa pun. Yang salah sabotasenya, bukan auditnya.
//
// Diganti dengan yang benar-benar membalik urutannya: `lastRecords` diisi
// SEBELUM saringan dijalankan. Mencatatnya di sini, bukan menghapusnya
// diam-diam, karena "sabotase yang lolos" dan "sabotase yang tidak menguji apa
// pun" terlihat sama di layar dan artinya berlawanan.
sabotase(
  'saringan nama dipindah ke SESUDAH `lastRecords` — layar 1 orang, PDF 40 orang',
  ATT,
  "    const namaCari = container.querySelector('#filter-nama')?.value ?? '';",
  "    lastRecords = records;\n    const namaCari = container.querySelector('#filter-nama')?.value ?? '';",
  AUDIT
);

sabotase(
  'kotak saringan nama dicabut dari rekap presensi',
  ATT,
  '        <input type="search" id="filter-nama" placeholder="ketik sebagian nama" autocomplete="off" />',
  '',
  AUDIT
);

// Percobaan pertama di sini cuma mengganti nama variabelnya, yang menghasilkan
// ReferenceError — kerusakan yang nyata tapi BUKAN kerusakan yang sedang
// dijaga, dan auditnya memang tidak dirancang menangkapnya. Diganti dengan
// regresi yang sesungguhnya: saringannya tidak berlaku sama sekali.
sabotase(
  'saringan nama NBM tidak lagi berlaku — layar, WhatsApp, dan PDF memuat semua orang',
  NBM,
  '  const records = cariNama.trim()\n    ? semuaRecords.filter((r) => fuzzyMatch(cariNama, r.user_profiles?.full_name ?? \'\'))\n    : semuaRecords;',
  '  const records = semuaRecords;',
  AUDIT
);

sabotase(
  'saringan nama tidak lagi masuk judul — rekap upah satu orang terbaca sebagai rekap seluruh outlet',
  NBM,
  "    (cariNama.trim() ? ` · HANYA nama yang cocok \"${cariNama.trim()}\"` : '');",
  "    '';",
  AUDIT
);

// =====================================================================
console.log('\nSABOTASE LAPORAN KAS:');
// =====================================================================

// Yang paling mahal di seluruh berkas ini.
sabotase(
  'nominal ditulis di TIAP baris barang — kolom Nominal berlipat delapan',
  LK,
  '        nominal: i === 0 ? dasar.nominal : null,',
  '        nominal: dasar.nominal,',
  AUDIT
);
sabotase(
  'nominal ditulis di tiap baris barang — DAN tes murni harus ikut merah',
  LK,
  '        nominal: i === 0 ? dasar.nominal : null,',
  '        nominal: dasar.nominal,',
  T_KAS
);

sabotase(
  'foto disisipkan di tiap baris nota — berkasnya membengkak berlipat',
  LK,
  '        fotoNota: i === 0 ? dasar.fotoNota : null,',
  '        fotoNota: dasar.fotoNota,',
  T_KAS
);

sabotase(
  'entri yang dicoret ikut menjumlah lagi — koreksinya tidak pernah berlaku',
  LK,
  '      nominal: isDicoret ? 0 : angka(e.amount) ?? 0,',
  '      nominal: angka(e.amount) ?? 0,',
  T_KAS
);

sabotase(
  'total keluar ikut menghitung yang dicoret',
  LK,
  "      totalKeluar: daftar.filter((e) => e.entry_type === 'out' && !e.dicoret_at)",
  "      totalKeluar: daftar.filter((e) => e.entry_type === 'out')",
  T_KAS
);

sabotase(
  'entri non-nota disaring keluar — total tidak cocok dengan Mutasi Kas',
  LK,
  '    if (!barang.length) {\n      baris.push({',
  '    if (!barang.length) {\n      if (!n) continue;\n      baris.push({',
  T_KAS
);

sabotase(
  '"nota tanpa rincian" dilebur dengan "bukan nota" — dua tindakan berbeda jadi satu',
  LK,
  '        sebabKosong: isDicoret ? SEBAB_NOL.DICORET : n ? SEBAB_NOL.NOTA_TANPA_BARIS : SEBAB_NOL.BUKAN_NOTA',
  '        sebabKosong: SEBAB_NOL.BUKAN_NOTA',
  T_KAS
);

sabotase(
  'lampiran foto tidak lagi menyaring duplikat — satu gambar masuk berkali-kali',
  LK,
  '      if (!path || sudah.has(path)) continue;',
  '      if (!path) continue;',
  T_KAS
);

sabotase(
  'lampiran foto kehilangan penandanya — tumpukan gambar yang tak bisa dicocokkan',
  LK,
  '        penanda: `${jenis} — ${b.tanggal} · ${b.pemegang}${b.noNota && b.noNota !== \'-\' ? \' · nota \' + b.noNota : \'\'}`',
  "        penanda: ''",
  T_KAS
);

sabotase(
  'nota koreksi (`penyesuaian_nota`) ikut dibentangkan — daftar barang yang sama muncul dua kali',
  EK,
  '    if (n?.payment_entry_id) notaPer.set(n.payment_entry_id, n);',
  '    if (n?.id) notaPer.set(n.payment_entry_id ?? n.id, n);',
  AUDIT
);

sabotase(
  "foto gagal tidak lagi ditandai 'GAGAL' — laporan terbaca seperti separuh entri belum difoto",
  EK,
  "    dataUrl.set(path, (await imageToDataUrl(url, maxPx, 0.72)) ?? 'GAGAL');",
  '    dataUrl.set(path, await imageToDataUrl(url, maxPx, 0.72));',
  AUDIT
);

sabotase(
  "'GAGAL' diteruskan ke lampiran PDF — tiap halaman cuma berisi \"(foto gagal)\"",
  EK,
  "    .filter((f) => f.dataUrl && f.dataUrl !== 'GAGAL');",
  '    .filter((f) => f.dataUrl);',
  AUDIT
);

sabotase(
  'PDF memakai ukuran foto Excel — berkas ratusan MB yang menggantungkan HP',
  EK,
  '  const lap = await siapkanLaporanKas(entries, { maxPx: PX_PDF });',
  '  const lap = await siapkanLaporanKas(entries, { maxPx: PX_EXCEL });',
  AUDIT
);

sabotase(
  'unduhan memakai `semuaBaris` — berkas memuat baris yang tidak terlihat saat tombolnya ditekan',
  CADM,
  '          const h = await fn({ entries: rows, judul: judulUnduh, subjudul: subjudulUnduh, namaBerkas });',
  '          const h = await fn({ entries: semuaBaris, judul: judulUnduh, subjudul: subjudulUnduh, namaBerkas });',
  AUDIT
);

sabotase(
  'tombol ekspor kas dicabut',
  CADM,
  '      <button id="cm-xlsx">⬇ Export Excel (+ foto)</button>',
  '',
  AUDIT
);

// =====================================================================
console.log('\nSABOTASE SHEET PER NOTA:');
// =====================================================================

sabotase(
  'nama sheet tidak dibersihkan — "INV/2026/09" membuat Excel menolak SELURUH berkasnya',
  AP,
  "  return kode.replace(/[:\\\\/?*[\\]]+/g, '-').slice(0, 31) || `Nota ${urutan + 1}`;",
  '  return kode.slice(0, 31) || `Nota ${urutan + 1}`;',
  AUDIT
);
sabotase(
  'nama sheet tidak dibersihkan — DAN tes murni harus ikut merah',
  AP,
  "  return kode.replace(/[:\\\\/?*[\\]]+/g, '-').slice(0, 31) || `Nota ${urutan + 1}`;",
  '  return kode.slice(0, 31) || `Nota ${urutan + 1}`;',
  T_SHEET
);

sabotase(
  'batas 31 karakter nama sheet dicabut — Excel menolak berkasnya',
  AP,
  "  return kode.replace(/[:\\\\/?*[\\]]+/g, '-').slice(0, 31) || `Nota ${urutan + 1}`;",
  "  return kode.replace(/[:\\\\/?*[\\]]+/g, '-') || `Nota ${urutan + 1}`;",
  T_SHEET
);

sabotase(
  'batas jumlah nota tidak lagi menolak — separuh rentang hilang tanpa tanda',
  AP,
  '  if (jumlahNota <= batas) return null;',
  '  if (true) return null;',
  T_SHEET
);

sabotase(
  'penolakan batas tidak lagi menyebut jalan keluarnya',
  AP,
  '(batas ${batas}). Persempit rentang tanggalnya, atau pilih satu outlet, lalu ulangi. ',
  '(batas ${batas}). ',
  T_SHEET
);

sabotase(
  'batas tidak diperiksa di layar — orang menunggu belasan detik untuk penolakan yang sudah bisa diketahui',
  NADM,
  '        const tolak = periksaBatas(notaTampil.length);',
  '        const tolak = null;',
  AUDIT
);

sabotase(
  'sheet rincian gabungan dicabut — harus membuka 40 tab untuk tahu totalnya',
  EP,
  '  const sheets = [sheetGabungan].filter(Boolean);',
  '  const sheets = [];',
  AUDIT
);

sabotase(
  'nota tanpa rincian dilewati — jumlah sheet tidak cocok dengan jumlah nota di layar',
  EP,
  "      rows: lap.baris.length ? lap.baris : [['(nota ini belum ada rincian barangnya)', '', '', '', '', '']].map((r) => r.slice(0, lap.kolom.length)),",
  '      rows: lap.baris,',
  AUDIT
);

sabotase(
  'batas dicabut dari fungsi ekspornya juga',
  EP,
  '  if (tolak) throw new Error(tolak);',
  '  /* dibuang */',
  AUDIT
);

sabotase(
  'tombol Export per Nota dicabut',
  NADM,
  '      <button id="nt-ekspor-sheet">⬇ Export per Nota (+ foto)</button>',
  '',
  AUDIT
);

// =====================================================================
console.log('\nSABOTASE PUSTAKA EKSPOR:');
// =====================================================================

sabotase(
  'tinggi baris kembali dihitung dari `findIndex` — kolom foto kedua tergambar di baris yang terlalu pendek',
  XF,
  '  const adaKolomFoto = columns.some((c) => c.foto);',
  '  const adaKolomFoto = columns.findIndex((c) => c.foto) > 0;',
  AUDIT
);

sabotase(
  'nama sheet kembar tidak lagi dibedakan — berkasnya GAGAL DIBUKA sama sekali',
  XF,
  '    while (terpakai.has(nama)) nama = `${nama.slice(0, 27)} (${n++})`;',
  '    /* dibuang */',
  AUDIT
);

sabotase(
  'sheet tidak lagi membedakan foto GAGAL dari nota yang memang tidak berfoto',
  XF,
  "    } else if (s.foto === 'GAGAL') {",
  '    } else if (false) {',
  AUDIT
);

sabotase(
  'dukungan lampiran foto PDF dicabut — ekspor kas kehilangan buktinya',
  PDF,
  '  lampiranFoto = []',
  '  lampiranFotoX = []',
  AUDIT
);

sabotase(
  'penanda lampiran ditulis SESUDAH gambarnya — halaman gagal berisi gambar kosong tanpa keterangan',
  PDF,
  '        doc.text(doc.splitTextToSize(String(f.penanda ?? \'-\'), fotoW), x, atas);\n        try {\n          doc.addImage(f.dataUrl, \'JPEG\', x, atas + 14, fotoW, fotoH);',
  '        try {\n          doc.addImage(f.dataUrl, \'JPEG\', x, atas + 14, fotoW, fotoH);\n          doc.text(doc.splitTextToSize(String(f.penanda ?? \'-\'), fotoW), x, atas);',
  AUDIT
);

console.log('');
if (gagal === 0) console.log('Semua sabotase tertangkap. ✅');
else console.error(`${gagal} sabotase LOLOS / tidak terpasang.`);
process.exit(gagal === 0 ? 0 : 1);
