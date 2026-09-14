/**
 * AUDIT: laporan yang menyaring per outlet harus ikut menyaring DAFTAR STAFF-nya.
 *
 * ============ BUG YANG MELAHIRKANNYA ============
 *
 *   "apabila saya filter outlet nya, tetap semua staff di BU tersebut akan
 *    tampil tetapi nilainya 0 semua"
 *
 * Rekap Presensi & Disiplin menyaring PRESENSI per outlet, tapi daftar
 * staffnya diambil per-BU. Satu outlet berisi 5 orang menampilkan 30 baris,
 * 25 di antaranya nol semua.
 *
 * Yang membuatnya berbahaya, bukan cuma berisik: baris nol hari hadir punya
 * ARTI PENTING di laporan disiplin — "orang ini tidak pernah masuk". Bercampur
 * dengan orang yang memang bertugas di outlet lain, pembacanya kehilangan cara
 * membedakan keduanya, dan laporan disiplin berhenti bisa dipakai menilai
 * siapa pun.
 */
const fs = require('fs');
const path = require('path');
const { tanpaKomentar } = require('./lib/tanpa-komentar.cjs');

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

const tanpaKomentarSql = (sql) => String(sql).replace(/^[ \t]*--.*$/gm, '');

// ---------------------------------------------------------------
// 1. Migration: saringannya ada, dan bentuk lamanya dibuang.
// ---------------------------------------------------------------
const mig = baca('supabase/migrations/0139_staff_per_outlet_basis.sql');
if (mig) {
  const sql = tanpaKomentarSql(mig);
  if (!/and \(p_outlet_id is null or ms\.outlet_id = p_outlet_id\)/.test(sql)) {
    salah('0139: saringan `p_outlet_id` hilang — daftar staff kembali seluruh BU.');
  }
  // BENTUK LAMA WAJIB DIBUANG.
  //
  // PostgREST memilih fungsi dari himpunan nama argumennya. Dua bentuk yang
  // hidup berdampingan membuat panggilan dua argumen jadi AMBIGU dan ditolak —
  // yang mematikan SETIAP layar yang memakai daftar staff, bukan cuma
  // laporannya.
  if (!/drop function if exists list_bu_staff_for_admin\(uuid, boolean\);/.test(sql)) {
    salah(
      '0139: bentuk lama `list_bu_staff_for_admin(uuid, boolean)` tidak dibuang. ' +
        'Berdampingan dengan bentuk tiga-argumen berdefault, panggilan dua argumen jadi ambigu dan ditolak — ' +
        'setiap layar yang memakai daftar staff ikut mati.'
    );
  }
  if (!/raise exception 'Harus TEPAT satu bentuk list_bu_staff_for_admin/.test(sql)) {
    salah('0139: tidak memeriksa bahwa hanya ada satu bentuk fungsinya sesudah dipasang.');
  }
}

// ---------------------------------------------------------------
// 2. Service meneruskan outletnya, dan tidak pernah `undefined`.
// ---------------------------------------------------------------
const svc = baca('js/modules/leave/leave.service.js');
if (svc) {
  const kode = tanpaKomentar(svc);
  if (!/p_outlet_id: outletId \?\? null/.test(kode)) {
    salah(
      'leave.service.js `listBuStaff`: `p_outlet_id` tidak selalu dikirim. ' +
        '`JSON.stringify` membuang kunci bernilai `undefined`, dan kunci yang hilang mengubah fungsi mana yang ' +
        'dicari PostgREST — bukan berarti "pakai defaultnya".'
    );
  }
}

// ---------------------------------------------------------------
// 3. Laporan disiplin benar-benar memakainya.
// ---------------------------------------------------------------
const rpt = baca('js/modules/report/report.service.js');
if (rpt) {
  const kode = tanpaKomentar(rpt);
  const i = kode.indexOf('async function buildAttendanceDiscipline');
  const iSesudah = kode.indexOf('async function build', i + 10);
  const blok = i >= 0 ? kode.slice(i, iSesudah > i ? iSesudah : undefined) : '';
  if (!blok) {
    salah('report.service.js: `buildAttendanceDiscipline` tidak ada.');
  } else {
    if (!/outletId \? listBuStaff\(businessUnitId, \{ includeInactive: true, outletId \}\)/.test(blok)) {
      salah(
        'report.service.js `buildAttendanceDiscipline`: daftar staff tidak disaring per outlet. ' +
          'Satu outlet berisi 5 orang akan menampilkan seluruh staff BU dengan nilai nol — dan baris nol itu ' +
          'punya arti sendiri di laporan disiplin, jadi keduanya jadi tidak bisa dibedakan.'
      );
    }
    // Siapa pun yang PUNYA PRESENSI di outlet itu tetap muncul.
    //
    // Tanpa ini, staff bercakupan level BU yang memang bekerja di sana hilang
    // dari laporan BESERTA angkanya, dan total di kartu ringkas tidak akan
    // cocok dengan jumlah barisnya.
    if (!/cakupanOutlet\.has\(uid\) \|\| agg\.has\(uid\)/.test(blok)) {
      salah(
        'report.service.js `buildAttendanceDiscipline`: staff yang punya presensi di outlet itu tidak dijamin muncul. ' +
          'Barisnya hilang beserta angkanya, dan total ringkasnya berhenti cocok dengan isi tabelnya.'
      );
    }
    // Gagal memuat daftar outletnya harus menampilkan SEMUA, bukan kosong.
    if (!/const tampil = \(uid\) => !cakupanOutlet \|\|/.test(blok)) {
      salah(
        'report.service.js: kegagalan memuat daftar staff per outlet tidak jatuh kembali ke "tampilkan semua". ' +
          'Laporan yang kelebihan baris masih bisa dibaca; yang kekurangan baris diam-diam tidak.'
      );
    }
  }
}

if (gagal === 0) {
  console.log(
    'Rekap disiplin: daftar staff ikut disaring per outlet basis, yang punya presensi di sana tetap muncul, ' +
      'dan bentuk lama fungsinya dibuang. ✅'
  );
}
process.exit(gagal === 0 ? 0 : 1);
