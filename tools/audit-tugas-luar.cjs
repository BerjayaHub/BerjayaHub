/**
 * AUDIT: tugas luar di jadwal shift (0160).
 *
 * ============ KEADAAN KETIGA DI KOLOM LAMA ============
 *
 * `shift_schedules` mengenal dua keadaan sejak 0034, dan belasan pembaca sudah
 * ditulis di atas anggapan itu. Menambahkan keadaan ketiga adalah cara paling
 * mudah membuat kode yang sudah ada SALAH BACA tanpa bersuara: baris tugas luar
 * ber-`is_off` false dan ber-`shift_id` null, jadi setiap `is_off ? … : …` akan
 * menjatuhkannya ke cabang "shift" — shift tanpa nama, tanpa jam, tanpa galat.
 *
 * Audit ini menjaga tiap tempat yang sudah disisir supaya tetap tersisir.
 *
 * ============ CARA FITUR INI RUSAK TANPA TERLIHAT RUSAK ============
 *
 *   sandi `tl:` dirangkai di layar  -> penulis & pembaca nilai menyimpang;
 *                                      selnya tersimpan sebagai keadaan yang
 *                                      BERBEDA dari yang dipilih, dan layarnya
 *                                      digambar ulang dari database dengan
 *                                      tampilan yang benar — jadi tidak ada
 *                                      satu pun tanda
 *   `nilaiSel` kehilangan urutannya  -> sel tugas luar digambar KOSONG; admin
 *                                      mengira gagal tersimpan lalu menimpanya
 *   cabang `is_tugas_luar` dicabut
 *     dari layar staff               -> chip bertuliskan "Shift" dengan jam
 *                                      kosong di HP orang yang sedang memeriksa
 *                                      jadwalnya sendiri
 *   cabang di `hitung_ulang_status`
 *     ditaruh SESUDAH penjaga
 *     "tanpa jam mulai"              -> tidak pernah tercapai, dan auditnya
 *                                      tetap hijau karena kodenya ADA
 *   `setSchedule` berhenti mengirim
 *     ketiga kolomnya                -> `upsert` membiarkan nilai lama; Tugas
 *                                      Luar → Libur meninggalkan jenis terisi
 *   trigger BU silang dibuang        -> admin BU A memakai jenis BU B, dan
 *                                      rekap BU B memuat hari kerja orang yang
 *                                      bukan stafnya
 *   `LATE_LABEL.tugas_luar` hilang   -> lencana kosong tanpa warna, dan kunci
 *                                      database mentah tampil ke admin
 *   `jadwal_belum_clock_in`
 *     disederhanakan                 -> staff yang sedang tugas luar
 *                                      dilencanai "belum clock in" di seluruh
 *                                      dashboard admin
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
// 1. MIGRATION 0160.
// ---------------------------------------------------------------
const mig = baca('supabase/migrations/0160_tugas_luar_di_jadwal.sql');
if (mig) {
  const kode = tanpaSqlKomentar(mig);
  // Penyaring komentarnya diperiksa dari DUA arah: satu kalimat kode yang harus
  // bertahan, satu kalimat komentar yang harus hilang.
  if (!/create table if not exists tugas_luar_types/.test(kode)) {
    salah('audit-tugas-luar: penyaring komentar SQL ikut memakan kodenya — pemeriksaan di bawah tidak bisa dipercaya.');
  }
  if (/KEADAAN KETIGA, DAN KENAPA SEKARANG BOLEH/.test(kode)) {
    salah('audit-tugas-luar: komentar SQL tidak tersaring — pemeriksaan di bawah bisa hijau karena kalimat penjelasnya.');
  }

  // ============ CONSTRAINT TIGA KEADAAN, DISEBUT SATU-SATU ============
  if (!/alter table shift_schedules drop constraint if exists shift_or_off;/.test(kode)) {
    salah(
      '0160: `shift_or_off` lama tidak di-drop. Constraint itu menuntut "ada shift_id ATAU is_off" — jadi SETIAP ' +
        'penyimpanan tugas luar ditolak database, dan fiturnya tidak pernah bisa dipakai sama sekali.'
    );
  }
  const ctr = kode.match(/add constraint shift_libur_atau_tugas_luar check \([\s\S]*?\n  \);/);
  if (!ctr) {
    salah('0160: constraint tiga keadaan hilang — sel "tanpa shift dan tanpa keterangan" jadi mungkin ada lagi.');
  } else {
    const badan = ctr[0];
    // Shift & libur HARUS menolak kolom tugas luar. Constraint yang ditulis
    // sebagai hitungan "paling banyak satu yang true" meloloskan keduanya, dan
    // datanya cuma jadi tidak bisa dipercaya saat direkap.
    if ((badan.match(/tugas_luar_type_id is null/g) ?? []).length < 2) {
      salah(
        '0160: constraintnya tidak lagi menolak kolom tugas luar pada cabang SHIFT dan LIBUR (butuh dua ' +
          '`tugas_luar_type_id is null`). Shift yang membawa jenis tugas luar tidak akan pernah terlihat salah di ' +
          'layar — rekapnya saja yang memuat hari yang tidak pernah ada.'
      );
    }
    if (!/is_tugas_luar and not is_off and shift_id is null[\s\S]{0,120}tugas_luar_type_id is not null/.test(badan)) {
      salah('0160: tugas luar tidak lagi WAJIB berjenis — sel tugas luar tanpa jenis tersimpan, dan rekap per jenis kehilangan barisnya tanpa bersuara.');
    }
  }

  // ============ JENIS HARUS MILIK BU YANG SAMA ============
  if (!/before insert or update on shift_schedules/.test(kode) || !/jaga_jenis_tugas_luar/.test(kode)) {
    salah(
      '0160: trigger silang-BU hilang. Tanpa itu admin BU A bisa menunjuk jenis milik BU B: selnya tersimpan, ' +
        'layarnya menggambarnya, dan rekap BU B diam-diam memuat hari kerja orang yang bukan stafnya.'
    );
  }
  if (!/create or replace function jaga_jenis_tugas_luar[\s\S]{0,300}security definer/.test(kode)) {
    salah(
      '0160: `jaga_jenis_tugas_luar` bukan `security definer`. Ia membaca `tugas_luar_types` milik BU lain, yang ' +
        'RLS-nya justru menutup — pemeriksaannya lalu selalu bernilai "tidak ada", dan triggernya menolak justru ' +
        'yang seharusnya lolos.'
    );
  }

  // ============ SEED UNTUK BU YANG LAHIR SESUDAHNYA ============
  if (!/after insert on business_units/.test(kode)) {
    salah(
      '0160: trigger seed pada `business_units` hilang. `insert` seed cuma mengurus BU yang ADA saat migration ' +
        'jalan — admin di BU berikutnya membuka dropdown jenis, menemukannya kosong, dan tidak ada satu pun ' +
        'kalimat di layar yang bisa ia kerjakan. Lubang yang sama ditemukan tesnya sendiri di 0159.'
    );
  }

  // ============ `on delete restrict`, BUKAN cascade ============
  if (!/tugas_luar_type_id uuid references tugas_luar_types\(id\) on delete restrict/.test(kode)) {
    salah(
      '0160: FK jenisnya bukan lagi `on delete restrict`. `cascade` akan MENGHAPUS HARI KERJA orang begitu sebuah ' +
        'jenis dihapus; `set null` meninggalkan baris yang justru dilarang constraint, jadi penghapusannya gagal ' +
        'dengan pesan tentang constraint — bukan tentang apa yang sedang dilakukan orangnya.'
    );
  }

  if (!/late_status in \('ontime', 'tolerance', 'late', 'no_schedule', 'off_day', 'tugas_luar'\)/.test(kode)) {
    salah("0160: `late_status` belum melebar ke 'tugas_luar' — setiap penyimpanan status itu ditolak check constraint.");
  }

  // ============ URUTAN CABANGNYA MENENTUKAN HASILNYA ============
  //
  // Diperiksa lewat `indexOf`, bukan dengan mencari keduanya ada. Tugas luar
  // memang ber-shift_id null, jadi cabangnya yang ditaruh SESUDAH penjaga
  // "tanpa jam mulai" tidak akan pernah tercapai — dan audit yang cuma
  // memastikan kodenya ada akan tetap hijau untuk fitur yang mati.
  const fn = kode.indexOf('create or replace function hitung_ulang_status_shift');
  if (fn < 0) {
    salah('0160: `hitung_ulang_status_shift` tidak lagi ditulis ulang di sini — hari tugas luar kembali tercatat `no_schedule`.');
  } else {
    const badan = kode.slice(fn);
    const iTL = badan.indexOf('if v_jadwal.is_tugas_luar then');
    const iTanpaJam = badan.indexOf('if not v_jadwal.is_off and v_jadwal.start_time is null then');
    if (iTL < 0) {
      salah("0160: cabang `is_tugas_luar` hilang dari `hitung_ulang_status_shift` — hari tugas luar tercatat `no_schedule`, yang muncul di rekap sebagai kelalaian menyusun jadwal.");
    } else if (iTanpaJam >= 0 && iTL > iTanpaJam) {
      salah(
        '0160: cabang `is_tugas_luar` ada TAPI ditaruh sesudah penjaga "tanpa jam mulai". Tugas luar ber-shift_id ' +
          'null, jadi penjaga itu menelannya lebih dulu dan cabangnya tidak pernah tercapai — fiturnya mati, dan ' +
          'kodenya tetap terlihat ada.'
      );
    }
    if (!/select ss\.is_off, ss\.is_tugas_luar,/.test(badan)) {
      salah(
        '0160: `is_tugas_luar` tidak ikut di-select. Kolom yang TIDAK diminta terbaca sebagai "tidak ada" — bukan ' +
          'galat — jadi cabangnya tidak pernah menyala dan hari tugas luar diam-diam kembali jadi `no_schedule`.'
      );
    }
  }

  if (!/has_bu_scope\(auth\.uid\(\), p_bu\)/.test(kode)) {
    salah(
      '0160: `rekap_tugas_luar` kehilangan penjaga scope-nya. Fungsi itu `security definer`, jadi RLS tidak ' +
        'berlaku di dalamnya — siapa pun yang login bisa membaca rekap BU mana pun dengan menebak satu uuid.'
    );
  }
}

// ---------------------------------------------------------------
// 2. SANDI NILAI SEL ADA DI SATU TEMPAT.
// ---------------------------------------------------------------
const murni = baca('js/modules/shift/tugas-luar.js');
if (murni) {
  const kode = bersih(murni, 'tugas-luar.js', ['PREFIKS_TL']);
  if (!/export const PREFIKS_TL = 'tl:';/.test(kode)) {
    salah('tugas-luar.js: `PREFIKS_TL` hilang — penyandi dan pembaca nilai sel tidak lagi berbagi satu konstanta.');
  }
  // Urutan pemeriksaan di `nilaiSel`: tugas luar DULU.
  const ns = kode.indexOf('export function nilaiSel');
  if (ns < 0) salah('tugas-luar.js: `nilaiSel` hilang.');
  else {
    const batasNs = kode.indexOf('\nexport ', ns + 10);
    const badan = kode.slice(ns, batasNs < 0 ? undefined : batasNs);
    const iTL = badan.indexOf('is_tugas_luar');
    const iOff = badan.indexOf('is_off');
    if (iTL < 0 || (iOff >= 0 && iTL > iOff)) {
      salah(
        'tugas-luar.js: `nilaiSel` tidak lagi memeriksa `is_tugas_luar` lebih dulu. Baris tugas luar ber-is_off ' +
          'false dan ber-shift_id null, jadi ia memulangkan "" — sel digambar KOSONG, admin mengira tugas luarnya ' +
          'gagal tersimpan, lalu memilihnya lagi dan menimpa baris yang sudah benar.'
      );
    }
  }
}

// ============ LAYAR TIDAK MERANGKAI SANDINYA SENDIRI ============
//
// Ini kerusakan yang paling mungkin terjadi, karena merangkai `'tl:' + id` di
// layar terlihat lebih langsung daripada memanggil satu fungsi.
for (const rel of ['js/modules/shift/shift.admin.page.js', 'js/modules/shift/shift.page.js']) {
  const isi = baca(rel);
  if (!isi) continue;
  const kode = bersih(isi, path.basename(rel), ['shift']);
  if (/['"`]tl:/.test(kode)) {
    salah(
      `${path.basename(rel)}: merangkai sandi 'tl:' sendiri. Penyandian nilai sel milik \`tugas-luar.js\` — dua ` +
        'tempat yang merangkai sandi yang sama akan menyimpang tanpa bersuara, dan selnya tersimpan sebagai ' +
        'keadaan yang BERBEDA dari yang dipilih orangnya.'
    );
  }
}

// ---------------------------------------------------------------
// 3. LAYAR ADMIN.
// ---------------------------------------------------------------
const adm = baca('js/modules/shift/shift.admin.page.js');
if (adm) {
  const kode = bersih(adm, 'shift.admin.page.js', ['nilaiSel']);
  for (const [pola, pesan] of [
    [/const sel = nilaiSel\(cur\)/, 'sel jadwal tidak lagi memakai `nilaiSel` — tugas luar digambar kosong'],
    [/bacaNilaiSel\(sel\.value\)/, 'penyimpanan tidak lagi memakai `bacaNilaiSel` — nilai sel diurai sendiri di layar'],
    [/isTugasLuar: niat\.isTugasLuar/, 'keadaan tugas luar tidak lagi dikirim ke `setSchedule`'],
    [/periksaSelTugasLuar\(niat, jenisTL\)/, 'pemeriksaan jenis di layar hilang — penolakannya datang sebagai pesan constraint'],
    [/renderTugasLuarTab/, 'tab kelola jenis tugas luar hilang — tidak ada jalan menambah jenis baru'],
    [/listTugasLuarTypes\(businessUnitId, \{ semua: true \}\)/, 'layar kelola tidak memuat jenis nonaktif — yang dinonaktifkan tidak akan pernah bisa diaktifkan kembali']
  ]) {
    if (!pola.test(kode)) salah(`shift.admin.page.js: ${pesan}.`);
  }
  // `.catch()` pada pemuatan jenis: 0160 yang belum ter-deploy tidak boleh
  // mematikan seluruh layar penyusunan jadwal.
  if (!/listTugasLuarTypes\(businessUnitId\)\.catch\(\(\) => \[\]\)/.test(kode)) {
    salah(
      'shift.admin.page.js: pemuatan jenis di tab Jadwal tanpa `.catch()`. Satu RPC/tabel yang belum ter-deploy ' +
        'akan mematikan layar penyusunan jadwal seluruhnya — padahal yang hilang seharusnya cuma pilihan Tugas Luar.'
    );
  }
}

// ---------------------------------------------------------------
// 4. LAYAR STAFF & PRESENSI.
// ---------------------------------------------------------------
const sp = baca('js/modules/shift/shift.page.js');
if (sp) {
  const kode = bersih(sp, 'shift.page.js', ['is_tugas_luar']);
  const iTL = kode.indexOf('cur.is_tugas_luar');
  const iShift = kode.indexOf('const sh = cur.outlet_shifts');
  if (iTL < 0) {
    salah(
      'shift.page.js: cabang tugas luar hilang dari sel jadwal staff. Ia jatuh ke cabang shift, `sh` undefined, ' +
        'dan selnya digambar sebagai chip bertuliskan "Shift" dengan jam kosong — di HP orang yang sedang ' +
        'memeriksa jadwalnya sendiri.'
    );
  } else if (iShift >= 0 && iTL > iShift) {
    salah('shift.page.js: cabang tugas luar ditaruh sesudah cabang shift, jadi ia tidak pernah tercapai.');
  }
}

const ap = baca('js/modules/attendance/attendance.page.js');
if (ap) {
  const kode = bersih(ap, 'attendance.page.js', ['is_tugas_luar']);
  if (!/!mySchedule\.is_off && !mySchedule\.is_tugas_luar \? mySchedule\.outlet_shifts : null/.test(kode)) {
    salah('attendance.page.js: `myShift` tidak lagi mengecualikan tugas luar — hari tugas luar diperlakukan sebagai hari bershift.');
  }
  // Urutan penilaian status: tugas luar sebelum `is_off` dan sebelum `myShift`.
  const iTL = kode.indexOf('mySchedule?.is_tugas_luar) lateInfo');
  const iOff = kode.indexOf('mySchedule?.is_off) lateInfo');
  if (iTL < 0) {
    salah(
      'attendance.page.js: status `tugas_luar` tidak diberikan saat clock in — hari itu tercatat `no_schedule`, ' +
        'yang muncul di rekap sebagai kelalaian menyusun jadwal. Admin lalu mencari jadwal hilang yang tidak hilang.'
    );
  } else if (iOff >= 0 && iTL > iOff) {
    salah('attendance.page.js: cabang tugas luar ditaruh sesudah `is_off` — urutannya harus sama dengan 0160.');
  }
  if (!/value: keteranganClockIn\(mySchedule, jenisTLPerId, outletTLPerId\)/.test(kode)) {
    salah('attendance.page.js: keterangan tugas luar tidak lagi terisi dari jadwalnya.');
  }

  // ============ GERBANGNYA TIDAK BOLEH DILEWATI JADWAL ============
  //
  // Jadwal hanya memberi KETERANGAN. Sel jadwal bisa ditetapkan berhari-hari di
  // muka oleh orang yang tidak sedang melihat di mana staffnya berada — jadi
  // membiarkannya melewati geofence atau OTP menukar satu kenyamanan dengan
  // satu lubang.
  if (/is_tugas_luar[^\n]{0,80}(exitMode|redeemExitOtp|skip|lewati)/.test(kode)) {
    salah(
      'attendance.page.js: jadwal tugas luar menyentuh jalur OTP/geofence. Jadwal hanya boleh mengisi ' +
        'keterangannya; gerbangnya tetap milik `exit_task_mode` dan geofence, karena sel jadwal ditetapkan jauh ' +
        'sebelum hari itu oleh orang yang tidak sedang melihat lokasi staffnya.'
    );
  }
}

// ---------------------------------------------------------------
// 5. LENCANA & PEMBACA LAMA.
// ---------------------------------------------------------------
const svc = baca('js/modules/shift/shift.service.js');
if (svc) {
  const kode = bersih(svc, 'shift.service.js', ['LATE_LABEL']);
  for (const peta of ['LATE_LABEL', 'LATE_BADGE']) {
    const i = kode.indexOf(`export const ${peta} = {`);
    if (i < 0) {
      salah(`shift.service.js: ${peta} hilang.`);
      continue;
    }
    if (!/tugas_luar:/.test(kode.slice(i, kode.indexOf('};', i)))) {
      salah(
        `shift.service.js: ${peta} belum memuat \`tugas_luar\`. Pembacanya memakai \`?? r.late_status\`, jadi ini ` +
          'TIDAK menghasilkan galat — ia menampilkan kunci database mentah ("tugas_luar") kepada admin, dengan ' +
          'lencana tanpa warna. Dua gejala sepele yang tidak akan pernah dilaporkan siapa pun sebagai bug.'
      );
    }
  }
  // `setSchedule` wajib mengirim ketiga kolomnya SELALU — ini `upsert`.
  const ss = kode.indexOf('export async function setSchedule');
  if (ss < 0) salah('shift.service.js: `setSchedule` hilang.');
  else {
    // Dibatasi sampai `export` BERIKUTNYA, bukan sampai `\n}` pertama.
    //
    // Tanda tangan `setSchedule` memakai parameter terdestrukturisasi yang
    // ditulis multi-baris, jadi `\n}` pertama adalah penutup parameternya —
    // bukan penutup fungsinya. Versi pertama audit ini memotong di sana dan
    // melaporkan ketiga kolom "tidak dikirim" untuk kode yang mengirimkannya
    // dengan benar: audit yang MERAH karena alasan yang salah, yang sama
    // berbahayanya dengan hijau karena alasan yang salah — ia mengajari orang
    // mengabaikan auditnya.
    const batas = kode.indexOf('\nexport ', ss + 10);
    const badan = kode.slice(ss, batas < 0 ? undefined : batas);
    for (const kol of ['is_tugas_luar:', 'tugas_luar_type_id:', 'tugas_luar_outlet_id:']) {
      if (!badan.includes(kol)) {
        salah(
          `shift.service.js: \`setSchedule\` tidak mengirim \`${kol}\`. Ini \`upsert\`: kolom yang tidak disebut ` +
            'memakai nilai LAMANYA, jadi mengubah sel dari Tugas Luar ke Libur meninggalkan jenisnya terisi — dan ' +
            'constraintnya menolak dengan pesan tentang constraint, bukan tentang apa yang dilakukan orangnya.'
        );
      }
    }
  }
  // Kolomnya ikut di-select; yang tidak diminta terbaca "tidak ada".
  if ((kode.match(/is_tugas_luar, tugas_luar_type_id, tugas_luar_outlet_id/g) ?? []).length < 3) {
    salah(
      'shift.service.js: salah satu pembaca jadwal berhenti meminta kolom tugas luar. Kolom yang tidak diminta ' +
        'terbaca sebagai "tidak ada" — bukan galat — jadi layarnya menggambar hari tugas luar sebagai hari biasa.'
    );
  }
}

// ============ `jadwal_belum_clock_in` TETAP BERPASANGAN ============
//
// Bentuk `is_off = false AND shift_id is not null` ada di 0105, 0107, dan 0109.
// Komentar di 0109 menuliskan alasannya: "Kalau suatu saat constraint-nya
// dilonggarkan, yang tersisa di sini tetap menahan." Hari ini constraintnya
// dilonggarkan — jadi pasangan itu BUKAN lagi redundansi, ia satu-satunya yang
// mengecualikan tugas luar. Menyederhanakannya akan melencanai staff yang
// sedang tugas luar sebagai "belum clock in" di seluruh dashboard admin.
for (const rel of [
  'supabase/migrations/0105_lencana_shift_cuti_reservasi.sql',
  'supabase/migrations/0107_kabar_shift_dari_penilaian_ulang.sql',
  'supabase/migrations/0109_lencana_draft_semua_outlet.sql'
]) {
  const isi = baca(rel);
  if (!isi) continue;
  const kode = tanpaSqlKomentar(isi);
  if (!/and s\.is_off = false\s*\n\s*and s\.shift_id is not null/.test(kode)) {
    salah(
      `${path.basename(rel)}: \`jadwal_belum_clock_in\` tidak lagi berpasangan (\`is_off = false\` + ` +
        '`shift_id is not null`). Sejak 0160 pasangan itu bukan redundansi: baris tugas luar ber-is_off false, ' +
        'jadi `shift_id is not null` satu-satunya yang mengecualikannya. Tanpa itu, staff yang sedang tugas luar ' +
        'dilencanai "belum clock in" di seluruh dashboard admin.'
    );
  }
}

// Tutup otomatis (0138) bersandar pada inner join ke `outlet_shifts`.
const m138 = baca('supabase/migrations/0138_istirahat_dan_tutup_otomatis.sql');
if (m138) {
  const kode = tanpaSqlKomentar(m138);
  if (!/join outlet_shifts os on os\.id = ss\.shift_id/.test(kode)) {
    salah(
      '0138: tutup otomatis tidak lagi memakai inner join ke `outlet_shifts`. Join itu yang menggugurkan baris ' +
        'tugas luar dengan sendirinya — tanpa itu, sesi tugas luar dicoba ditutup memakai jam shift yang tidak ada.'
    );
  }
}

// ---------------------------------------------------------------
// 6. WARNA: JS DAN CSS TIDAK BOLEH MENYIMPANG.
// ---------------------------------------------------------------
//
// ============ KEGAGALANNYA SUNYI DI KEDUA ARAH ============
//
// Kelas `shift-w6` yang dihasilkan JS tapi tidak ada di CSS menghasilkan sel
// TANPA warna sama sekali — bukan galat, bukan warna salah, cuma sel polos di
// antara sel-sel berwarna. Dan kelas yang ada di CSS tapi tidak pernah
// dihasilkan JS adalah warna yang tidak akan pernah muncul, yang membuat orang
// berikutnya mengira paletnya lebih luas dari kenyataannya.
//
// Jadi keduanya DIHITUNG, bukan sekadar dicari ada.
const warna = baca('js/modules/shift/warna-shift.js');
const css = baca('css/styles.css');
if (warna && css) {
  const kode = bersih(warna, 'warna-shift.js', ['JUMLAH_WARNA_SHIFT']);
  const m = kode.match(/export const JUMLAH_WARNA_SHIFT = (\d+);/);
  if (!m) {
    salah('warna-shift.js: `JUMLAH_WARNA_SHIFT` hilang — tidak ada lagi angka yang bisa dibandingkan dengan CSS.');
  } else {
    const jumlah = Number(m[1]);
    for (const [awalan, apa] of [
      ['.shift-chip.shift-w', 'chip Staff App'],
      ['select.sc-cell.shift-w', 'sel Admin Portal']
    ]) {
      const ada = new Set();
      for (let i = 1; i <= 20; i++) if (css.includes(`${awalan}${i} `) || css.includes(`${awalan}${i} {`)) ada.add(i);
      if (ada.size !== jumlah) {
        salah(
          `css/styles.css: ${apa} punya ${ada.size} kelas warna, sedangkan JS menghasilkan ${jumlah}. Kelas yang ` +
            'dihasilkan JS tapi tidak ada di CSS membuat selnya TANPA warna — bukan galat, cuma sel polos di antara ' +
            'sel berwarna, yang tidak akan pernah dilaporkan siapa pun sebagai bug.'
        );
      }
    }
  }

  // Warna dihitung dari ID, bukan dari urutan. Ini yang menjaga arti warnanya
  // tidak berpindah saat ada shift baru ditambahkan.
  if (!/angkaStabil\(id\) % JUMLAH_WARNA_SHIFT/.test(kode)) {
    salah(
      'warna-shift.js: warna shift tidak lagi dihitung dari id-nya. Kalau ia mengikuti urutan di daftar, menambah ' +
        'satu shift baru akan MENGGESER warna semua shift lain — dan orang yang sudah hafal "biru itu Pagi" membaca ' +
        'jadwal yang sama dengan arti berbeda, tanpa apa pun di layar yang memberitahunya.'
    );
  }
  if (!/return h >>> 0;/.test(kode)) {
    salah(
      'warna-shift.js: hasil hash tidak lagi dibuat tak-bertanda. `%` atas angka negatif memulangkan angka negatif, ' +
        'dan `shift-w0`/`shift-w-2` tidak ada di CSS — selnya kehilangan warnanya, tanpa galat.'
    );
  }

  // Tugas luar WAJIB punya kelas sendiri, dan tidak boleh memakai kelas cuti.
  if (!/\.shift-chip\.shift-tugas-luar \{/.test(css)) {
    salah('css/styles.css: `.shift-chip.shift-tugas-luar` hilang — chip tugas luar digambar dengan warna primer bawaan, sama seperti shift.');
  }
  if (!/select\.sc-cell\.shift-tugas-luar \{/.test(css)) {
    salah('css/styles.css: sel admin tugas luar tidak punya warnanya sendiri.');
  }
}

const sp2 = baca('js/modules/shift/shift.page.js');
if (sp2) {
  const kode = bersih(sp2, 'shift.page.js', ['shift-chip']);
  if (/shift-chip shift-cuti">Tugas Luar/.test(kode)) {
    salah(
      'shift.page.js: chip tugas luar kembali memakai kelas CUTI. Keduanya berarti "orangnya tidak di outlet", tapi ' +
        'akibatnya berlawanan: cuti = timnya kurang orang, tugas luar = orangnya sedang bekerja di tempat lain. ' +
        'Admin yang salah membacanya mencari pengganti yang tidak perlu, atau tidak mencari yang perlu.'
    );
  }
  if (!/kelasWarnaShift\(cur\.shift_id\)/.test(kode)) {
    salah('shift.page.js: chip shift tidak lagi berwarna per shift — seluruh shift kembali seragam.');
  }
}

const adm2 = baca('js/modules/shift/shift.admin.page.js');
if (adm2) {
  const kode = bersih(adm2, 'shift.admin.page.js', ['optgroup']);
  if (!/<optgroup label="/.test(kode)) {
    salah(
      'shift.admin.page.js: `<optgroup>` hilang dari sel jadwal. Labelnya dipendekkan jadi nama jenis saja, jadi ' +
        'tanpa judul grup "Dinas Luar" berdiri sebaris dengan "PAGI"/"SIANG" tanpa apa pun yang membedakannya — ' +
        'dan nama jenis ditentukan admin sendiri, jadi "Siang Keliling" bisa saja lahir.'
    );
  }
  if (!/kelasWarnaSel\(cur\)/.test(kode)) {
    salah('shift.admin.page.js: sel jadwal admin tidak lagi berwarna — skema warnanya cuma berlaku di Staff App.');
  }
}

console.log('');
if (gagal === 0) console.log('Audit tugas luar bersih. ✅');
else console.error(`${gagal} masalah ditemukan.`);
process.exit(gagal === 0 ? 0 : 1);
