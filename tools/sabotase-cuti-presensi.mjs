/**
 * SABOTASE: cuti ↔ presensi (0156).
 *
 * ============ KENAPA BERKAS INI ADA ============
 *
 * Seluruh fitur ini berbentuk SATU KOLOM yang kosong untuk mayoritas baris.
 * Artinya kegagalannya tidak punya gejala sama sekali: kolom yang gagal diisi
 * terlihat persis seperti kolom yang memang tidak perlu diisi, dan satu-satunya
 * cara mengetahuinya adalah mencari orang yang masuk saat cuti lalu memeriksa
 * barisnya satu per satu.
 *
 * Sabotase tanggal WIB di bawah adalah contoh paling murninya: ia hanya
 * meleset untuk clock-in sebelum pukul 07.00 WIB — yaitu shift pagi, yaitu
 * shift yang paling sering bertabrakan dengan cuti.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AKAR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const P = (rel) => path.join(AKAR, rel);

const MIG = 'supabase/migrations/0156_presensi_saat_cuti.sql';
const MURNI = 'js/modules/attendance/cuti-presensi.js';
const PAGE = 'js/modules/attendance/attendance.page.js';
const SVC = 'js/modules/attendance/attendance.service.js';
const ADM = 'js/modules/attendance/attendance.admin.page.js';

const asli = new Map();
for (const rel of [MIG, MURNI, PAGE, SVC, ADM]) asli.set(rel, fs.readFileSync(P(rel), 'utf8'));

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

const PG = 'tools/test-migrasi-0156.mjs';
const TES = 'tools/test-cuti-presensi.mjs';
const AUDIT = 'tools/audit-cuti-presensi.cjs';

console.log('SABOTASE ZONA WAKTU — meleset hanya untuk shift pagi:');

sabotase(
  "`::date` tanpa konversi WIB — clock-in 06.30 dibaca sebagai tanggal SEBELUMNYA",
  MIG,
  "  v_tanggal := (coalesce(new.clock_in_at, now()) at time zone 'Asia/Jakarta')::date;",
  '  v_tanggal := coalesce(new.clock_in_at, now())::date;',
  PG
);
sabotase(
  'tanggal hari ini di layar diambil dari zona perangkat, bukan WIB',
  MURNI,
  "    timeZone: 'Asia/Jakarta',\n",
  '',
  AUDIT
);

console.log('\nSABOTASE "SERAHKAN SAJA KE LAYAR":');

sabotase(
  'penandanya bukan lagi trigger — setiap clock-in di luar Staff App jadi NULL',
  MIG,
  '  before insert on attendance_records',
  '  after truncate on attendance_records',
  AUDIT
);
sabotase(
  'trigger bukan `security definer` — koreksi presensi oleh admin tidak melihat cutinya',
  MIG,
  'security definer\nset search_path = public\nas $$\ndeclare\n  v_tanggal date;',
  'set search_path = public\nas $$\ndeclare\n  v_tanggal date;',
  AUDIT
);

console.log('\nSABOTASE SYARAT CUTINYA:');

sabotase(
  'pengajuan yang BELUM disetujui ikut menandai — orang dituduh tanpa dasar',
  MIG,
  "     and lr.status = 'approved'\n",
  '',
  PG
);
sabotase(
  'hari terakhir cuti tidak ikut — batasnya jadi eksklusif',
  MIG,
  '     and lr.end_date >= v_tanggal',
  '     and lr.end_date > v_tanggal',
  PG
);
sabotase(
  'cuti orang lain ikut menandai',
  MIG,
  '   where lr.user_id = new.user_id',
  '   where lr.user_id is not null',
  PG
);
sabotase(
  'nilai yang sudah diisi admin ditimpa lagi oleh trigger',
  MIG,
  '  if new.cuti_request_id is not null then\n    return new;\n  end if;',
  '',
  PG
);
sabotase(
  'pilihan saat ada dua cuti tidak ditentukan — baris yang sama bisa menunjuk cuti berbeda',
  MIG,
  '   order by lr.start_date, lr.id\n',
  '',
  AUDIT
);
sabotase(
  'menghapus pengajuan cuti ikut menghapus presensinya',
  MIG,
  'references leave_requests(id) on delete set null',
  'references leave_requests(id) on delete cascade',
  PG
);

console.log('\nSABOTASE MODUL MURNI:');

sabotase(
  '"sampai kapan" diambil dari tanggal TERJAUH, bukan hari beruntun',
  MURNI,
  '  while (n < 400 && hari.has(tambahHari(sampai, 1))) {\n    sampai = tambahHari(sampai, 1);\n    n += 1;\n  }',
  '  for (const t of hari.keys()) if (t > sampai) sampai = t;',
  TES
);
sabotase(
  'rentang yang diminta cuma sehari — "sampai kapan" jadi tidak terjawab',
  MURNI,
  '  return tambahHari(keTanggal(tanggal), 60);',
  '  return keTanggal(tanggal);',
  TES
);
sabotase(
  'bentuk bertimestamp tidak lagi dipotong — tidak ada satu pun tanggal yang cocok',
  MURNI,
  '  return /^\\d{4}-\\d{2}-\\d{2}/.test(s) ? s.slice(0, 10) : s;',
  '  return s;',
  TES
);
sabotase(
  'nilai sampah dipotong jadi sesuatu yang TERLIHAT seperti tanggal',
  MURNI,
  '  return /^\\d{4}-\\d{2}-\\d{2}/.test(s) ? s.slice(0, 10) : s;',
  '  return s.length >= 10 ? s.slice(0, 10) : s;',
  AUDIT
);
sabotase(
  'kalimatnya berubah jadi tuduhan — yang dipanggil masuk jadi mencari jalan lain',
  MURNI,
  "    judul: 'Kamu sedang cuti hari ini',",
  "    judul: 'Kamu dilarang absen: sedang cuti',",
  TES
);

console.log('\nSABOTASE STAFF APP:');

sabotase(
  'peringatannya muncul SESUDAH foto diunggah — pembatalan meninggalkan selfie yatim',
  PAGE,
  // Percobaan pertama sabotase ini cuma menyelipkan variabel mati sebelum
  // pemeriksaannya — dan auditnya tetap hijau, dengan benar: urutan
  // periksa-lalu-unggah memang belum berubah. Yang harus disabotase adalah
  // URUTANNYA, jadi di sini unggahan sungguhan dipindahkan ke depan.
  '      const hariIni = tanggalWIB();',
  "      await uploadAttendanceSelfie({ outletId: recordOutletId, kind: 'in', file: capturedIn.blob });\n      const hariIni = tanggalWIB();",
  AUDIT
);
sabotase(
  'cuti tidak diperiksa sama sekali sebelum clock-in',
  PAGE,
  '        cutiAktif = cutiPada(await cutiSayaRentang(hariIni, akhirRentangCuti(hariIni)), hariIni);',
  '        cutiAktif = null;',
  AUDIT
);
sabotase(
  'RPC cuti yang gagal ikut menggagalkan presensinya',
  PAGE,
  '      } catch {\n        cutiAktif = null;\n      }',
  '      } finally {\n        void 0;\n      }',
  AUDIT
);
sabotase(
  'peringatannya tidak bisa dibatalkan — absennya tetap jalan',
  PAGE,
  '        if (!lanjut) return;',
  '        void lanjut;',
  AUDIT
);
sabotase(
  'tombol clock-in mati permanen untuk yang menekan "Batal"',
  PAGE,
  '    } finally {',
  '    } catch (e2) {\n      void e2;',
  AUDIT
);

console.log('\nSABOTASE LAYANAN & LAYAR ADMIN:');

sabotase(
  '`cuti_request_id` tidak diminta — lencananya tidak pernah muncul',
  SVC,
  'auto_closed_reason, cuti_request_id`',
  'auto_closed_reason`',
  AUDIT
);
sabotase(
  'kolom baru menyandera seluruh rekap saat push mendahului migration',
  SVC,
  '/auto_closed|cuti_request_id/',
  '/auto_closed/',
  AUDIT
);
sabotase(
  'lencana "masuk saat cuti" dibuang dari rekap admin',
  ADM,
  '        r.cuti_request_id',
  '        false',
  AUDIT
);

console.log('');
if (gagal === 0) console.log('Semua sabotase cuti ↔ presensi tertangkap. ✅');
else console.error(`${gagal} sabotase LOLOS — pemeriksanya tidak menjaga apa yang dikiranya dijaga.`);
process.exit(gagal === 0 ? 0 : 1);
