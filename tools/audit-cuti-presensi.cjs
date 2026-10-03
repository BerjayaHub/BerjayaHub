/**
 * AUDIT: cuti ↔ presensi (0156).
 *
 * ============ CARA FITUR INI RUSAK TANPA TERLIHAT RUSAK ============
 *
 *   tanda dikirim LAYAR          -> clock-in yang tidak lewat Staff App (koreksi
 *                                   admin, PWA lama di cache, PostgREST langsung)
 *                                   menghasilkan NULL — yang artinya "tidak
 *                                   sedang cuti", persis seperti baris sehat
 *   `::date` tanpa zona          -> clock-in 06.30 WIB dibaca sebagai tanggal
 *                                   SEBELUMNYA; shift pagi — yang paling sering
 *                                   bertabrakan dengan cuti — justru yang luput
 *   trigger tanpa security definer-> koreksi presensi oleh admin tidak melihat
 *                                   cuti orang lain, tandanya diam-diam kosong
 *   status selain approved ikut  -> pengajuan yang BELUM disetujui menandai
 *                                   presensi, dan orang dituduh tanpa dasar
 *   peringatan SESUDAH unggah    -> pembatalan meninggalkan selfie yatim di
 *                                   Storage, tidak ditunjuk baris mana pun
 *   tombol tidak dinyalakan lagi -> yang menekan "Batal" tidak bisa absen sama
 *                                   sekali sampai halamannya dimuat ulang
 *   kolom tidak diminta          -> lencananya tidak pernah muncul, dan tidak
 *                                   ada galat apa pun yang menyebutkannya
 */
const fs = require('fs');
const path = require('path');
const { tanpaKomentar, periksaKewarasan } = require('./lib/tanpa-komentar.cjs');

const AKAR = path.dirname(__dirname);
let gagal = 0;
const salah = (pesan) => {
  gagal++;
  console.error(`❌ ${pesan}`);
};

const baca = (rel) => {
  const p = path.join(AKAR, rel);
  if (!fs.existsSync(p)) {
    salah(`${rel} tidak ada — audit ini kehilangan sasarannya.`);
    return null;
  }
  return fs.readFileSync(p, 'utf8');
};
const bersih = (isi, rel, penanda) => {
  const kode = tanpaKomentar(isi);
  const pesan = periksaKewarasan(isi, kode, penanda);
  if (pesan) salah(`${rel}: ${pesan}`);
  return kode;
};

/** Buang komentar `--` SQL, kecuali yang berada di dalam string literal. */
const tanpaSqlKomentar = (sql) =>
  sql
    .split('\n')
    .map((baris) => {
      let petik = 0;
      for (let i = 0; i < baris.length; i++) {
        if (baris[i] === "'") petik++;
        else if (baris[i] === '-' && baris[i + 1] === '-' && petik % 2 === 0) return baris.slice(0, i);
      }
      return baris;
    })
    .join('\n');

// ---------------------------------------------------------------
// 1. MIGRATION 0156.
// ---------------------------------------------------------------
const mig = baca('supabase/migrations/0156_presensi_saat_cuti.sql');
if (mig) {
  const kode = tanpaSqlKomentar(mig);
  // Kewarasan penyaringnya: satu baris KODE harus selamat, dan satu kalimat
  // KOMENTAR harus hilang.
  //
  // Percobaan pertama memakai perbandingan panjang (`< 1/3 aslinya`) dan
  // langsung merah — berkas ini memang lebih banyak komentar daripada kode,
  // dan itu disengaja. Ambang berbasis rasio mengukur gaya penulisan, bukan
  // apakah penyaringnya bekerja.
  if (!/create or replace function tandai_presensi_saat_cuti/.test(kode)) {
    salah('audit-cuti-presensi: penyaring komentar SQL ikut memakan kodenya — pemeriksaan di bawah ini tidak bisa dipercaya.');
  }
  if (/TANGGALNYA WIB, BUKAN UTC/.test(kode)) {
    salah('audit-cuti-presensi: komentar SQL tidak tersaring — pemeriksaan di bawah ini bisa hijau hanya karena kalimat penjelasnya.');
  }

  // ============ INTI: TANGGALNYA WIB ============
  if (!/at time zone 'Asia\/Jakarta'\)::date/.test(kode)) {
    salah(
      "0156: tanggal clock-in tidak lagi dikonversi ke WIB sebelum `::date`. `clock_in_at` adalah timestamptz dan zona " +
        'server adalah UTC, jadi clock-in 06.30 WIB dibaca sebagai tanggal SEBELUMNYA — dan shift pagi, satu-satunya ' +
        'shift yang paling sering bertabrakan dengan cuti, justru yang paling sering luput. Barisnya tetap tersimpan; ' +
        'tandanya saja yang kosong.'
    );
  }

  // ============ TRIGGER, BUKAN KOLOM YANG DIKIRIM LAYAR ============
  if (!/before insert on attendance_records/.test(kode)) {
    salah(
      '0156: triggernya bukan lagi BEFORE INSERT pada attendance_records. Kalau penandanya diserahkan ke layar, setiap ' +
        'clock-in yang tidak lewat Staff App menghasilkan NULL — tidak bisa dibedakan dari "tidak sedang cuti".'
    );
  }
  if (!/security definer/.test(kode)) {
    salah(
      '0156: triggernya bukan `security definer`. Untuk clock-in biasa ia membaca cuti dirinya sendiri dan RLS ' +
        'mengizinkan — tapi untuk koreksi presensi oleh admin, pemanggilnya BUKAN pemilik cutinya, dan tandanya ' +
        'diam-diam kosong di situ.'
    );
  }
  if (!/lr\.status = 'approved'/.test(kode)) {
    salah("0156: status `approved` tidak lagi disyaratkan — pengajuan yang belum disetujui ikut menandai presensi, dan orang dituduh tanpa dasar.");
  }
  if (!/lr\.start_date <= v_tanggal/.test(kode) || !/lr\.end_date >= v_tanggal/.test(kode)) {
    salah('0156: batas rentang cutinya tidak lagi inklusif di kedua ujung — hari pertama atau terakhir cuti jadi luput.');
  }
  if (!/order by lr\.start_date, lr\.id/.test(kode)) {
    salah(
      '0156: pilihan saat ada lebih dari satu cuti tidak ditentukan. Tanpa `order by`, baris yang sama bisa menunjuk ' +
        'cuti yang berbeda setiap kali — dan tidak ada yang bisa menjelaskan kenapa.'
    );
  }
  if (!/if new\.cuti_request_id is not null then\s*\n\s*return new;/.test(kode)) {
    salah('0156: nilai yang sudah diisi pemanggil ikut ditimpa — koreksi manual oleh admin dikembalikan lagi oleh trigger.');
  }
  if (!/on delete set null/.test(kode)) {
    salah('0156: FK-nya bukan `on delete set null` — menghapus satu pengajuan cuti akan ikut menghapus presensinya.');
  }
}

// ---------------------------------------------------------------
// 2. MODUL MURNI.
// ---------------------------------------------------------------
const modul = baca('js/modules/attendance/cuti-presensi.js');
if (modul) {
  const kode = bersih(modul, 'cuti-presensi.js', ['export function cutiPada', 'export function peringatanCuti']);

  if (/^import /m.test(kode)) {
    salah('cuti-presensi.js: ada impor — modul ini harus bisa diuji tanpa browser.');
  }
  if (!/timeZone: 'Asia\/Jakarta'/.test(kode)) {
    salah(
      "cuti-presensi.js `tanggalWIB`: zonanya bukan lagi Asia/Jakarta. Tanggal menurut perangkat orangnya BUKAN tanggal " +
        'menurut aplikasi — dan HP yang zonanya meleset akan menanyakan cuti untuk hari yang salah.'
    );
  }
  // Rentangnya harus lebih dari sehari, kalau tidak "sampai kapan" tidak terjawab.
  if (!/tambahHari\(keTanggal\(tanggal\), 60\)/.test(kode)) {
    salah(
      'cuti-presensi.js `akhirRentangCuti`: rentangnya bukan lagi 60 hari. Rentang sehari cukup menjawab "apakah hari ' +
        'ini cuti" tapi tidak "sampai kapan" — dan jawaban kedua itulah yang membedakan salah tanggal sehari dari cuti ' +
        'seminggu yang memang disengaja.'
    );
  }
  // Hari BERUNTUN, bukan tanggal terjauh di daftar.
  if (!/while \(n < 400 && hari\.has\(tambahHari\(sampai, 1\)\)\)/.test(kode)) {
    salah(
      'cuti-presensi.js `cutiPada`: hari terakhirnya tidak lagi dihitung dari hari BERUNTUN. Kalau yang dipakai tanggal ' +
        'terjauh di daftar, cuti yang habis besok akan dikabarkan "sampai dua minggu lagi" hanya karena ada pengajuan ' +
        'lain di bulan yang sama.'
    );
  }
  if (!/\/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\/\.test\(s\)/.test(kode)) {
    salah(
      'cuti-presensi.js `keTanggal`: pemotongannya tidak lagi dijaga bentuk tanggal. Nilai sampah yang dipotong jadi ' +
        'sepuluh karakter TERLIHAT seperti tanggal — jauh lebih sulit dilacak daripada nilai aslinya yang jelas salah.'
    );
  }
}

// ---------------------------------------------------------------
// 3. STAFF APP.
// ---------------------------------------------------------------
const page = baca('js/modules/attendance/attendance.page.js');
if (page) {
  const kode = bersih(page, 'attendance.page.js', ['cutiSayaRentang', 'uploadAttendanceSelfie']);

  // ============ URUTANNYA: PERIKSA DULU, BARU UNGGAH ============
  //
  // Dibatasi ke blok penangan CLOCK IN, bukan seluruh berkas.
  //
  // `uploadAttendanceSelfie({` dipanggil juga oleh clock out — dan panggilan
  // itu muncul LEBIH DULU di berkasnya. Membandingkan posisi terhadap
  // kemunculan pertama berarti membandingkan dengan unggahan yang tidak ada
  // hubungannya, dan auditnya merah untuk kode yang urutannya sudah benar.
  const iHandler = kode.indexOf("clockInBtn.addEventListener('click'");
  const blokClockIn = iHandler >= 0 ? kode.slice(iHandler) : '';
  if (!blokClockIn) {
    salah('attendance.page.js: penangan tombol clock in tidak ketemu — audit urutan di bawah ini kehilangan sasarannya.');
  }
  const iCek = blokClockIn.indexOf('cutiSayaRentang(');
  const iUnggah = blokClockIn.indexOf('uploadAttendanceSelfie({');
  if (iCek < 0) {
    salah('attendance.page.js: cuti tidak diperiksa sama sekali sebelum clock-in.');
  } else if (iUnggah >= 0 && iCek > iUnggah) {
    salah(
      'attendance.page.js: pemeriksaan cuti terjadi SESUDAH foto diunggah. Orang yang membatalkan meninggalkan selfie ' +
        'yatim di Storage — berkas yang tidak ditunjuk baris presensi mana pun, tidak pernah terlihat siapa pun, dan ' +
        'tidak pernah terhapus.'
    );
  }

  // Gagalnya pemeriksaan tidak boleh menghalangi presensi.
  if (!/catch \{\s*\n\s*cutiAktif = null;/.test(kode)) {
    salah(
      'attendance.page.js: kegagalan RPC cuti tidak lagi ditelan. Menolak clock-in karena satu pemeriksaan tambahan ' +
        'tidak terbaca berarti menukar satu ketidaknyamanan dengan satu orang yang tidak bisa absen sama sekali.'
    );
  }
  // Boleh lanjut — bukan ditolak.
  if (!/if \(!lanjut\) return;/.test(kode)) {
    salah('attendance.page.js: peringatannya tidak lagi bisa diteruskan, atau tidak lagi bisa dibatalkan.');
  }

  // ============ TOMBOLNYA HARUS NYALA LAGI ============
  //
  // Sebelum 0156, tombolnya hanya dinyalakan kembali di dalam `catch`. Itu
  // benar selama satu-satunya jalan keluar lebih awal adalah `throw` — dan
  // berhenti benar pada detik ada `return` di tengah.
  //
  // Spasi dirapatkan dulu: `tanpaKomentar` mengganti komentar dengan SPASI
  // (panjangnya dipertahankan supaya nomor barisnya tetap benar), jadi blok
  // `finally` yang berkomentar panjang tetap terbentang ratusan karakter
  // walau kodenya cuma satu baris.
  const rapat = kode.replace(/\s+/g, ' ');
  if (!/\} finally \{ e\.target\.disabled = false; \}/.test(rapat)) {
    salah(
      'attendance.page.js: tombol clock-in tidak dinyalakan kembali lewat `finally`. Orang yang memilih "Batal" pada ' +
        'peringatan cuti akan menemukan tombol presensinya mati permanen sampai halamannya dimuat ulang — tanpa satu ' +
        'pun galat; tombolnya cuma tidak menjawab.'
    );
  }
}

// ---------------------------------------------------------------
// 4. LAYANAN & LAYAR ADMIN.
// ---------------------------------------------------------------
const svc = baca('js/modules/attendance/attendance.service.js');
if (svc) {
  const kode = bersih(svc, 'attendance.service.js', ['export async function cutiSayaRentang']);
  if (!/rpc\('cuti_saya_rentang'/.test(kode)) {
    salah('attendance.service.js: `cuti_saya_rentang` tidak dipanggil dari mana pun.');
  }
  if (!/auto_closed_reason, cuti_request_id/.test(kode)) {
    salah(
      'attendance.service.js: `cuti_request_id` tidak diminta di rekap admin. Kolom yang tidak diminta terbaca sebagai ' +
        'TIDAK ADA — bukan sebagai galat — jadi lencananya tidak pernah muncul dan tak ada apa pun yang menyebutkannya.'
    );
  }
  // Kolom baru tidak boleh menyandera seluruh rekap saat push mendahului migration.
  if (!/auto_closed\|cuti_request_id/.test(kode)) {
    salah(
      'attendance.service.js: `cuti_request_id` tidak ikut di penjaga mundurnya. PostgREST menolak SELURUH permintaan ' +
        'karena satu kolom tidak dikenal — jeda antara push dan menjalankan migration itu wajar dan akan terjadi lagi.'
    );
  }
}

const adm = baca('js/modules/attendance/attendance.admin.page.js');
if (adm) {
  const kode = bersih(adm, 'attendance.admin.page.js', ['cuti_request_id']);
  if (!/r\.cuti_request_id/.test(kode)) {
    salah(
      'attendance.admin.page.js: lencana "masuk saat cuti" hilang. Tandanya ada di database dan tidak pernah terbaca ' +
        'siapa pun — dan hari itu tetap terhitung HADIR sekaligus CUTI, dua angka dari dua sumber yang tidak saling melihat.'
    );
  }
}

console.log('');
if (gagal === 0) console.log('Audit cuti ↔ presensi bersih. ✅');
else console.error(`${gagal} masalah ditemukan.`);
process.exit(gagal === 0 ? 0 : 1);
