/**
 * SABOTASE: area presensi & status istirahat.
 *
 * Yang dijaga: staff bisa clock out di outlet terdaftar mana pun, aturannya
 * SATU untuk clock in maupun clock out, gerbangnya tidak bisa dilewati dengan
 * mematikan GPS, dan status istirahat tidak pernah ditebak diam-diam.
 *
 * ============ JEBAKAN `String.replace` ============
 *
 * Mengganti dengan STRING hanya mengenai kemunculan PERTAMA. `outlets:
 * allOutlets` di attendance.page.js muncul dua kali (Clock Out & Istirahat) —
 * mematikan satu saja tidak membuktikan yang lain dijaga.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AKAR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const P = (rel) => path.join(AKAR, rel);

const AREA = 'js/modules/attendance/area-outlet.js';
const PAGE = 'js/modules/attendance/attendance.page.js';
const SVC = 'js/modules/attendance/attendance.service.js';
const LAPORAN = 'js/modules/report/report.service.js';

const asli = new Map();
for (const rel of [AREA, PAGE, SVC, LAPORAN]) asli.set(rel, fs.readFileSync(P(rel), 'utf8'));

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

const TES = 'tools/test-area-outlet.mjs';
const AUDIT = 'tools/audit-area-presensi.cjs';

console.log('SABOTASE ATURAN AREA:');

sabotase(
  'nilai kosong tidak disaring — outlet tanpa koordinat terbaca di titik (0,0), radius kosong jadi 0 meter',
  AREA,
  "  if (v === null || v === undefined || v === '') return null;",
  '  if (false) return null;',
  TES
);
sabotase(
  'kelonggaran ketelitian kehilangan batasnya — radius efektif jadi berkilo-kilometer',
  AREA,
  '  if (a === null || a > AKURASI_MAKS_TOLERANSI) return { cocok: false, lewatToleransi: false };',
  '  if (a === null) return { cocok: false, lewatToleransi: false };',
  TES
);
sabotase(
  'akurasi yang tak terbaca justru melonggarkan',
  AREA,
  '  if (a === null || a > AKURASI_MAKS_TOLERANSI) return { cocok: false, lewatToleransi: false };',
  '  if (a !== null && a > AKURASI_MAKS_TOLERANSI) return { cocok: false, lewatToleransi: false };\n  if (a === null) return { cocok: true, lewatToleransi: true };',
  TES
);
sabotase(
  'kelonggaran ketelitian dicabut seluruhnya — orang yang berdiri di outlet ditolak karena sinyal',
  AREA,
  '  return { cocok: d - a <= r, lewatToleransi: d - a <= r };',
  '  return { cocok: false, lewatToleransi: false };',
  TES
);
sabotase(
  'diterima lewat kelonggaran berhenti ditandai — kelonggaran diam-diam',
  AREA,
  '  return { cocok: d - a <= r, lewatToleransi: d - a <= r };',
  '  return { cocok: d - a <= r, lewatToleransi: false };',
  TES
);
sabotase(
  'yang pertama di daftar menang, bukan yang terdekat — presensi tercatat di outlet yang salah',
  AREA,
  '    if (cocok && d < pilihJarak) {',
  '    if (cocok && pilih === null) {',
  TES
);
sabotase(
  'outlet terdekat berhenti dilaporkan — pesan penolakannya kehilangan tempat yang relevan',
  AREA,
  '    if (d < jarakTerdekat) {\n      jarakTerdekat = d;\n      terdekat = o;\n    }',
  '',
  TES
);

console.log('\nSABOTASE GERBANG AKSI:');

sabotase(
  'gerbang kembali mengunci ke satu outlet — clock out di Sentul ditolak lagi',
  AREA,
  '  const hasil = cariOutletArea({ loc, outlets: daftar, jarak });',
  '  const hasil = cariOutletArea({ loc, outlets: daftar.filter((o) => o.id === sesi?.outlet_id), jarak });',
  TES
);
sabotase(
  'GPS yang gagal diloloskan — gerbangnya bisa dilewati dengan mematikan izin lokasi',
  AREA,
  '  if (!loc) {\n    return {\n      boleh: false,',
  '  if (!loc) {\n    return {\n      boleh: true,',
  TES
);
sabotase(
  'mode Tugas Luar berhenti dikecualikan — staff yang memang di luar outlet tidak bisa absen',
  AREA,
  '  if (sesi?.is_storing) return { boleh: true, alasan: \'\', outlet: null, lewatToleransi: false };',
  '  if (false) return { boleh: true, alasan: \'\', outlet: null, lewatToleransi: false };',
  TES
);
sabotase(
  'BU yang belum mendaftarkan geofence mana pun ikut terkunci',
  AREA,
  '  if (!daftar.length) return { boleh: true, alasan: \'\', outlet: null, lewatToleransi: false };',
  '  if (false) return { boleh: true, alasan: \'\', outlet: null, lewatToleransi: false };',
  TES
);
sabotase(
  'outlet sesi yang belum ber-geofence ikut terkunci — perilaku lama dicabut diam-diam',
  AREA,
  '  if (outletSesi && angka(outletSesi.latitude) === null) {',
  '  if (false) {',
  TES
);
sabotase(
  'pesan penolakan berhenti menjelaskan bahwa clock out boleh di outlet mana pun',
  AREA,
  '        `${aksi} boleh dilakukan di outlet mana pun yang geofence-nya sudah didaftarkan, tidak harus tempat kamu clock in.`',
  "        ''",
  AUDIT
);

console.log('\nSABOTASE LAYAR:');

sabotase(
  'gerbang lama hidup lagi — mengunci ke outlet clock in',
  PAGE,
  '  const hasil = bolehAksiPresensi({ sesi, outlets, loc, jarak: distanceMeters, aksi, outletSesi });\n  if (!hasil.boleh) throw new Error(hasil.alasan);',
  '  const g = await getOutletGeofence(sesi.outlet_id);\n  void g; void loc; void outlets; void outletSesi; void aksi;',
  AUDIT
);
sabotase(
  'penolakan aturan murni tidak dilemparkan — gerbangnya jadi hiasan',
  PAGE,
  '  if (!hasil.boleh) throw new Error(hasil.alasan);',
  '  void hasil;',
  AUDIT
);
// `/…/g`: dikirim dua kali (Clock Out & Istirahat). Mematikan satu saja tidak
// membuktikan yang lain dijaga.
sabotase(
  'daftar outlet berhenti dikirim ke gerbangnya — tidak ada outlet lain untuk diterima',
  PAGE,
  /outlets: allOutlets/g,
  'outlets: []',
  AUDIT
);
sabotase(
  'deteksi clock in memakai rumusnya sendiri lagi — dua aturan yang akan menyimpang',
  PAGE,
  '    const hasilArea = loc ? cariOutletArea({ loc, outlets: allOutlets, jarak: distanceMeters }) : null;',
  '    const hasilArea = null;',
  AUDIT
);
sabotase(
  'ambang ketelitian dideklarasikan ulang di layar — dua angka untuk satu aturan',
  PAGE,
  '  async function runDetection() {',
  '  const AKURASI_MAKS_TOLERANSI = 999;\n  async function runDetection() {',
  AUDIT
);

console.log('\nSABOTASE STATUS ISTIRAHAT:');

sabotase(
  'status istirahat ditelan `.catch` lagi — Clock Out muncul untuk orang yang sedang istirahat',
  PAGE,
  '    let istirahat = [];\n    let istirahatTerbaca = true;\n    try {\n      istirahat = await listIstirahat(openSession.id);\n    } catch {\n      istirahatTerbaca = false;\n    }',
  '    const istirahat = await listIstirahat(openSession.id).catch(() => []);\n    const istirahatTerbaca = true;',
  AUDIT
);
sabotase(
  'kegagalan membacanya tidak diberitahukan ke staffnya',
  PAGE,
  '            istirahatTerbaca\n              ? \'\'',
  "            true\n              ? ''",
  AUDIT
);
sabotase(
  'tombol dikunci saat status istirahat tak terbaca — clock out jadi terhalang',
  PAGE,
  '            : `<button class="primary" id="btn-clock-out" disabled>Clock Out</button>`',
  '            : `<button class="primary" id="btn-clock-out" ${istirahatTerbaca ? \'\' : \'disabled\'} disabled>Clock Out</button>`',
  AUDIT
);
sabotase(
  'tombol Kembali tidak lagi menggantikan Clock Out saat istirahat berjalan',
  PAGE,
  '          berjalan\n            ? `<button class="primary" id="btn-istirahat-selesai" disabled>↩️ Kembali dari Istirahat</button>`\n            : `<button class="primary" id="btn-clock-out" disabled>Clock Out</button>`',
  '          `<button class="primary" id="btn-clock-out" disabled>Clock Out</button>`',
  AUDIT
);

console.log('\nSABOTASE NBM (yang membuat kelonggaran ini aman):');

sabotase(
  'NBM ikut tempat fisik, bukan outlet basis — clock out di Sentul memindahkan NBM ke Sentul',
  SVC,
  '      nbm_outlet_id: nbmOutletId ?? null,',
  '      nbm_outlet_id: null,',
  AUDIT
);
// `/…/g`: polanya muncul di LIMA tempat (penyaring outlet, Rekap NBM, Rekap
// Disiplin, dan dua kali di Hak Cuti Pengganti). Dengan string biasa hanya yang
// pertama berubah, empat lainnya masih benar, dan auditnya tetap hijau —
// "tertangkap" yang tidak membuktikan apa pun.
sabotase(
  'laporan SDM membaca outlet fisik, bukan basis',
  LAPORAN,
  /r\.nbm_outlet_id \?\? r\.outlet_id/g,
  'r.outlet_id',
  AUDIT
);
sabotase(
  'satu tempat saja yang berubah — sisanya masih basis, dan dua laporan menjawab outlet yang berbeda',
  LAPORAN,
  '  return rows.filter((r) => (r.nbm_outlet_id ?? r.outlet_id) === outletId);',
  '  return rows.filter((r) => r.outlet_id === outletId);',
  AUDIT
);

console.log('');
if (gagal === 0) console.log('Semua sabotase area presensi tertangkap. ✅');
else console.error(`${gagal} sabotase LOLOS.`);
process.exit(gagal === 0 ? 0 : 1);
