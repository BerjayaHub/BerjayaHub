/**
 * AUDIT: istirahat & clock out otomatis (0138).
 *
 * ============ DUA JANJI YANG PALING MUDAH DIINGKARI ============
 *
 * 1. "fitur ini tidak berpengaruh terhadap nbm sama sekali"
 *
 *    Godaan berikutnya — "kan lebih adil kalau istirahat dipotong" — akan
 *    datang dari orang yang tidak membaca permintaan aslinya. Tidak ada satu
 *    pun error yang akan muncul kalau itu dilakukan; yang terjadi cuma gaji
 *    orang berkurang.
 *
 * 2. "dianggap masuk seperti biasa TANPA LEMBUR"
 *
 *    Batas 12 jam adalah PEMICU, bukan jam pulang. Kalau barisnya ditutup pada
 *    jam pemicu, staff yang lupa clock out tercatat bekerja 12 jam — lembur
 *    yang tidak pernah terjadi, di sistem yang membayar lembur bertingkat
 *    (0037). Menukar keduanya tidak menghasilkan error apa pun.
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

/** Komentar baris penuh dibuang: berkas SQL ini menjelaskan keputusannya sendiri. */
const tanpaKomentarSql = (sql) => String(sql).replace(/^[ \t]*--.*$/gm, '');

// ---------------------------------------------------------------
// 1. ISTIRAHAT TIDAK BOLEH MENYENTUH NBM.
// ---------------------------------------------------------------
const nbm = baca('js/modules/attendance/nbm.service.js');
if (nbm) {
  const kode = tanpaKomentar(nbm);
  if (/attendance_breaks|istirahat|breakMinutes|menitIstirahat/i.test(kode)) {
    salah(
      'nbm.service.js: perhitungan NBM menyentuh istirahat. ' +
        'Permintaannya jelas: "tidak berpengaruh terhadap nbm sama sekali". Tidak ada error yang akan muncul ' +
        'kalau ini dilanggar — yang terjadi cuma gaji orang berkurang.'
    );
  }
}

const murni = baca('js/modules/attendance/istirahat.js');
if (murni) {
  const kode = tanpaKomentar(murni);
  for (const n of ['setelanEfektif', 'bolehMulaiIstirahat', 'jamTutupOtomatis', 'totalMenitIstirahat', 'dalamJendela']) {
    if (!new RegExp(`export function ${n}\\(`).test(kode)) salah(`istirahat.js: \`${n}\` tidak diekspor.`);
  }
  // Berkas aturan ini TIDAK boleh punya fungsi yang mengurangi jam kerja.
  const berbahaya = (kode.match(/export (?:function|const) (\w+)/g) ?? []).filter((m) =>
    /bersih|dipotong|kurangiJam|jamKerjaEfektif|netto/i.test(m)
  );
  if (berbahaya.length) {
    salah(`istirahat.js: ada ekspor yang berbau memotong jam kerja (${berbahaya.join(', ')}).`);
  }
  // Jendela lintas tengah malam. Shift malam ada di aplikasi ini; perbandingan
  // lurus akan menolak seluruh jam yang sah tanpa satu pun pesan.
  if (!/return a <= b \? j >= a && j <= b : j >= a \|\| j <= b;/.test(kode)) {
    salah(
      'istirahat.js: jendela yang melewati tengah malam tidak ditangani. ' +
        'Jendela 23:00–01:00 akan menolak SELURUH jam yang sah, dan tombolnya mati tanpa sebab yang bisa dibaca.'
    );
  }
  // Jam keluar tidak boleh mendahului jam masuk.
  if (!/if \(waktu <= masuk\) return \{ waktu: masuk \+ standar, dari: 'standar' \};/.test(kode)) {
    salah(
      'istirahat.js: jam tutup otomatis bisa jatuh SEBELUM jam masuk. ' +
        'Durasi negatif menghasilkan angka mustahil di NBM, dan tetap tercetak rapi.'
    );
  }
}

// ---------------------------------------------------------------
// 2. Migration: jendela ditegakkan server, dan jam pulang dari SHIFT.
// ---------------------------------------------------------------
const mig = baca('supabase/migrations/0138_istirahat_dan_tutup_otomatis.sql');
if (mig) {
  const sql = tanpaKomentarSql(mig);

  // Keunikan setelan BU: `unique(bu, outlet)` biasa TIDAK mencegah dua baris
  // bawaan, karena NULL tidak pernah sama dengan NULL di Postgres.
  if (!/create unique index if not exists attendance_settings_bu_uk\s*\n?\s*on attendance_settings\(business_unit_id\) where outlet_id is null/.test(sql)) {
    salah(
      '0138: indeks unik parsial untuk baris bawaan BU hilang. ' +
        'Tanpa itu bisa ada dua baris bawaan, dan setelan yang berlaku tergantung baris mana yang kebetulan terbaca dulu.'
    );
  }
  // Jendela jam DITEGAKKAN SERVER. Kalau cuma aturan tampilan, ia bukan aturan.
  if (!/if v_set\.break_mode = 'ditentukan' then/.test(sql)) {
    salah(
      "0138 `mulai_istirahat`: jendela jamnya tidak ditegakkan di server. " +
        'Tombol yang disembunyikan layar tetap bisa ditembus PWA yang tertinggal versi.'
    );
  }
  // Jendela lintas tengah malam di sisi server juga.
  if (!/if v_set\.break_start <= v_set\.break_end then/.test(sql)) {
    salah('0138 `mulai_istirahat`: jendela lintas tengah malam tidak ditangani server.');
  }
  // Kembali TIDAK dibatasi jendela.
  //
  // Dicari kata `break_mode` DI MANA SAJA dalam badan fungsinya, bukan pola
  // `break_mode = 'ditentukan'` yang berdempetan. Percobaan pertama memakai
  // pola berdempetan itu dan sabotasenya lolos: ia menulis
  // `(select break_mode from setelan_presensi(...)) = 'ditentukan'`, dan dua
  // kata itu tidak pernah bersebelahan. Pola yang menuntut bentuk persis hanya
  // menangkap sabotase yang kebetulan ditulis dengan bentuk yang sama.
  const iSelesai = sql.indexOf('create or replace function selesai_istirahat');
  const iSesudah = sql.indexOf('create or replace function', iSelesai + 10);
  const badanSelesai = iSelesai >= 0 ? sql.slice(iSelesai, iSesudah > iSelesai ? iSesudah : undefined) : '';
  if (!badanSelesai) {
    salah('0138: `selesai_istirahat` tidak ada.');
  } else if (/break_mode|break_start|break_end/.test(badanSelesai)) {
    salah(
      "0138 `selesai_istirahat`: kembali ikut dibatasi jendela jam. " +
        'Menolak orang yang kembali di luar jam hanya menggantung istirahatnya sampai ditutup otomatis 2 jam — ' +
        'hukuman untuk orang yang justru kembali lebih awal.'
    );
  }

  // Kolom setelan HARUS boleh NULL — itu yang membuat penimpaan per kolom
  // mungkin. `not null default` diam-diam mematahkan seluruh gagasannya:
  // outlet yang dibuatkan baris hanya untuk mengubah jam istirahatnya tetap
  // mendapat nilai default, lalu default itu menimpa angka BU-nya.
  //
  // Diperiksa DI DALAM `create table` saja. Berkas ini juga memuat
  // `alter column … drop not null` untuk memperbaiki pemasangan lama — dan
  // pemeriksaan sefile akan membaca kata "not null" di sana sebagai
  // pelanggaran, lalu menuduh kode yang justru memperbaikinya.
  const iBuat = sql.indexOf('create table if not exists attendance_settings');
  const badanTabel = iBuat >= 0 ? sql.slice(iBuat, sql.indexOf(');', iBuat)) : '';
  if (!badanTabel) {
    salah('0138: tabel `attendance_settings` tidak ada.');
  } else {
    for (const kolom of ['standard_work_hours', 'auto_close_after_hours', 'break_mode']) {
      // Dicocokkan ke BARIS DEFINISI KOLOMNYA: nama, lalu tipenya, lalu sisa
      // baris itu saja.
      //
      // Percobaan pertama memakai `${kolom}[^,]*not null` pada seluruh badan
      // tabel, dan ia menuduh kode yang benar: batasan
      // `check (break_mode <> 'ditentukan' or (break_start is not null …))`
      // memuat `break_mode` lalu `not null` tanpa koma di antaranya. Yang
      // dituduh justru batasan yang menjaga jendela jamnya tetap lengkap.
      if (new RegExp(`^\\s*${kolom}\\s+\\w+[^,\\n]*not null`, 'm').test(badanTabel)) {
        salah(
          `0138: kolom \`${kolom}\` masih \`not null\` — outlet tidak bisa mewarisi nilai BU untuk kolom itu, ` +
            'dan defaultnya akan menimpa angka yang sudah diatur di BU tanpa ada yang memilihnya.'
        );
      }
    }
  }
  // Satu istirahat berjalan per presensi.
  if (!/create unique index if not exists attendance_breaks_satu_berjalan/.test(sql)) {
    salah('0138: dua istirahat terbuka sekaligus tidak dicegah — yang kedua tidak akan bisa ditutup dari layar.');
  }
  // Lupa kembali -> mulai + 2 jam, BUKAN "sekarang".
  if (!/set selesai_at = b\.mulai_at \+ batas_istirahat\(\)/.test(sql)) {
    salah(
      '0138: istirahat yang lupa ditutup tidak ditutup di `mulai + 2 jam`. ' +
        'Menutupnya di "sekarang" membuat rekapnya berbeda dari batas yang dijanjikan ke staff di layar.'
    );
  }
  // JAM PULANG DARI SHIFT, bukan jam pemicu.
  if (!/v_keluar := \(\(v_tanggal \+ case when v_shift\.end_time <= v_shift\.start_time then 1 else 0 end\)\s*\n?\s*\+ v_shift\.end_time\) at time zone 'Asia\/Jakarta'/.test(sql)) {
    salah(
      '0138: jam clock out otomatis tidak lagi diambil dari jam pulang shift (termasuk penanganan lintas tengah malam). ' +
        'Batas 12 jam adalah PEMICU, bukan jam pulang — menutup di jam pemicu mencatat lembur yang tidak pernah terjadi.'
    );
  }
  if (!/if v_keluar <= r\.clock_in_at then/.test(sql)) {
    salah('0138: jam keluar bisa mendahului jam masuk — durasi negatif tetap tercetak di seluruh laporan jam kerja.');
  }
  // Tanggal kerjanya = tanggal CLOCK IN (aturan yang sama dengan NBM).
  if (!/v_tanggal := \(r\.clock_in_at at time zone 'Asia\/Jakarta'\)::date;/.test(sql)) {
    salah(
      "0138: tanggal kerja tidak diambil dari tanggal CLOCK IN menurut WIB. " +
        'Sesi 22:00–07:00 adalah SATU hari kerja milik tanggal masuknya — aturan yang sama dengan yang dipakai NBM.'
    );
  }
  // Clock out menutup istirahat yang masih berjalan — DI TRIGGER, bukan di
  // layar. Jam pulang bisa terisi dari tiga jalan (tombol staff, penutup
  // otomatis, koreksi admin); aturan yang ditulis di satu jalan saja akan
  // terlewat di dua lainnya, dan yang terlihat cuma rekap yang kadang aneh.
  if (!/create trigger trg_tutup_istirahat_saat_pulang/.test(sql)) {
    salah(
      '0138: tidak ada trigger yang menutup istirahat saat clock out. ' +
        'Istirahat yang dibiarkan terbuka akan ditutup penutup otomatis di `mulai + 2 jam` — yang bisa jatuh ' +
        'SESUDAH jam pulangnya, dan total menit istirahat jadi lebih besar daripada jam kerjanya sendiri.'
    );
  }
  if (!/least\(new\.clock_out_at, mulai_at \+ batas_istirahat\(\)\)/.test(sql)) {
    salah(
      '0138 `tutup_istirahat_saat_pulang`: tidak mengambil yang LEBIH AWAL antara jam pulang dan batas 2 jam. ' +
        'Memakai jam pulang saja melanggar janji "maksimal 2 jam" yang dibaca staff di layarnya sendiri; ' +
        'memakai batas 2 jam saja membuat istirahatnya berakhir sesudah ia pulang.'
    );
  }

  // GERBANG BUKTI: foto wajib untuk mulai maupun kembali.
  //
  // Tanpa ini istirahat jadi satu-satunya tombol presensi yang bisa ditekan
  // dari rumah dan atas nama orang lain — dan justru tombol itu yang paling
  // sering ditekan dalam sehari.
  for (const fn of ['mulai_istirahat', 'selesai_istirahat']) {
    if (!new RegExp(`create or replace function ${fn}\\(p_attendance uuid, p_photo text, p_face_match boolean\\)`).test(sql)) {
      salah(`0138: \`${fn}\` tidak lagi menerima foto & kecocokan wajah.`);
    }
    // Bentuk lama WAJIB dibuang. PostgREST memilih fungsi dari himpunan nama
    // argumennya; dua bentuk yang hidup bersama berarti PWA lama tetap bisa
    // memanggil yang tanpa foto, dan gerbangnya jadi opsional diam-diam.
    if (!new RegExp(`drop function if exists ${fn}\\(uuid\\);`).test(sql)) {
      salah(`0138: bentuk lama \`${fn}(uuid)\` tidak dibuang — ia jadi pintu belakang tanpa foto.`);
    }
  }
  if (!/raise exception 'Ambil foto selfie dulu sebelum mulai istirahat\.'/.test(sql)) {
    salah('0138 `mulai_istirahat`: foto kosong tidak ditolak dengan pesan yang bisa ditindaklanjuti.');
  }

  // Penandanya wajib ada.
  if (!/auto_closed_at = now\(\)/.test(sql) || !/auto_closed_reason/.test(sql)) {
    salah(
      '0138: baris yang ditutup otomatis tidak ditandai. ' +
        '"pulang jam 5" dan "lupa clock out lalu ditebak jam 5" jadi terlihat sama persis.'
    );
  }
  // Tabel istirahat tanpa policy tulis: satu-satunya jalan masuk adalah RPC.
  if (/create policy attendance_breaks_(insert|modify|all)/.test(sql)) {
    salah('0138: ada policy tulis pada `attendance_breaks` — jendela jamnya jadi bisa dilewati lewat insert langsung.');
  }
}

// ---------------------------------------------------------------
// 3. Layar staff: tombolnya ada, sebabnya dikatakan, dan NBM disebut aman.
// ---------------------------------------------------------------
const hal = baca('js/modules/attendance/attendance.page.js');
if (hal) {
  const kode = tanpaKomentar(hal);
  if (!/btn-istirahat-mulai/.test(kode) || !/btn-istirahat-selesai/.test(kode)) {
    salah('attendance.page.js: tombol Istirahat / Kembali tidak ada di layar presensi.');
  }
  // Tombol mati TANPA sebab akan ditekan berulang kali lalu dilaporkan sebagai
  // aplikasi rusak.
  if (!/bolehMulai\.sebab/.test(kode)) {
    salah('attendance.page.js: tombol istirahat yang mati tidak menjelaskan sebabnya.');
  }
  // Staff harus tahu istirahat tidak memotong gajinya — kalau tidak, ia menahan
  // diri beristirahat karena mengira NBM-nya berkurang.
  if (!/tidak mengurangi NBM/i.test(hal)) {
    salah('attendance.page.js: layar tidak mengatakan bahwa istirahat tidak mengurangi NBM.');
  }

  // GERBANG YANG SAMA DENGAN CLOCK OUT untuk kedua aksi istirahat.
  if (!/pastikanDiAreaOutlet\(openSession, 'Istirahat'\)/.test(kode)) {
    salah('attendance.page.js: mulai istirahat tidak memeriksa geofence — tombolnya bisa ditekan dari rumah.');
  }
  if (!/isSameFace\(capturedOut\.descriptor, myFaceDescriptor\)[\s\S]{0,200}Istirahat ditolak/.test(kode)) {
    salah('attendance.page.js: mulai istirahat tidak memeriksa kecocokan wajah — bisa ditekan atas nama orang lain.');
  }
  // GPS yang gagal dibaca harus MENOLAK, bukan diloloskan: kalau ia
  // diloloskan, gerbangnya bisa dilewati cukup dengan mematikan izin lokasi.
  if (!/Lokasi tidak terbaca/.test(kode)) {
    salah('attendance.page.js: GPS yang gagal dibaca tidak menolak aksinya — geofence-nya bisa dilewati dengan mematikan izin lokasi.');
  }

  // Saat istirahat, Clock Out DISEMBUNYIKAN — bukan sekadar dinonaktifkan.
  // Dua tombol utama berdampingan membuat orang menekan yang salah, dan di
  // sini "yang salah" berarti pulang padahal ia cuma mau kembali bekerja.
  if (!/berjalan\s*\n?\s*\? `<button class="primary" id="btn-istirahat-selesai"/.test(kode)) {
    salah(
      'attendance.page.js: tombol Clock Out tidak digantikan tombol Kembali saat istirahat berjalan. ' +
        'Dua tombol utama berdampingan membuat orang pulang padahal ia cuma mau kembali bekerja.'
    );
  }

  // Dialog penegasan sesudah tiap aksi. Toast hilang sendiri dalam tiga detik
  // dan sering tidak terbaca di HP yang dipegang sambil berjalan; orangnya lalu
  // menekan tombolnya lagi untuk memastikan — dan pada tombol presensi,
  // "memastikan" itu mahal.
  const dialogWajib = [
    ['Clock In', /title: isStoring \? '🚩 Kamu sudah Clock In \(Tugas Luar\)' : '👋 Kamu sudah Clock In'/],
    ['Clock Out', /title: '🙌 Kamu sudah Clock Out'/],
    ['mulai istirahat', /title: '☕ Istirahatmu dimulai'/],
    ['kembali istirahat', /title: '👋 Selamat bekerja kembali'/]
  ];
  for (const [nama, pola] of dialogWajib) {
    if (!pola.test(kode)) salah(`attendance.page.js: tidak ada dialog penegasan sesudah ${nama}.`);
  }

  // Peringatan yang MENEKANKAN, bukan yang meremehkan.
  //
  // Kalimat "kalau lupa, kamu otomatis dianggap kembali 2 jam sesudah mulai"
  // membaca seperti izin: staff jadi tahu ada jaring pengamannya, lalu berhenti
  // menekan tombol Kembali. Jaring itu untuk kelalaian, bukan untuk dipakai.
  if (/otomatis dianggap\s*\n?\s*kembali/.test(hal)) {
    salah(
      'attendance.page.js: layar masih menawarkan "otomatis dianggap kembali 2 jam" sebagai keterangan biasa. ' +
        'Itu terbaca sebagai izin untuk tidak menekan Kembali.'
    );
  }
  if (!/Wajib absen kembali/.test(hal)) {
    salah('attendance.page.js: tidak ada peringatan tegas untuk absen kembali dari istirahat.');
  }
}

// ---------------------------------------------------------------
// 4. Layar admin: setelan, penanda ⏱, dan kolom istirahat.
// ---------------------------------------------------------------
const adm = baca('js/modules/attendance/attendance.admin.page.js');
if (adm) {
  const kode = tanpaKomentar(adm);
  if (!/istirahat-setelan/.test(kode)) salah('attendance.admin.page.js: tidak ada panel setelan istirahat.');
  if (!/r\.auto_closed_at/.test(kode)) {
    salah('attendance.admin.page.js: baris yang ditutup otomatis tidak ditandai di kolom Clock Out.');
  }
  if (!/listIstirahatBanyak\(/.test(kode)) {
    salah(
      'attendance.admin.page.js: istirahat diambil per baris, bukan sekaligus. ' +
        'Rekap sebulan bisa ratusan baris, dan satu permintaan per baris di jaringan outlet berarti sebagian gagal timeout.'
    );
  }
  if (!/<th>Istirahat<\/th>/.test(kode)) salah('attendance.admin.page.js: kolom Istirahat tidak ada di rekap.');
}

const svc = baca('js/modules/attendance/attendance.service.js');
if (svc) {
  const kode = tanpaKomentar(svc);
  // Kolom baru tidak boleh menyandera seluruh rekap (pelajaran 0122).
  if (!/return await ambil\(KOLOM_REKAP_PRESENSI\);/.test(kode)) {
    salah(
      'attendance.service.js: tidak ada jalan cadangan saat `auto_closed_*` belum ada. ' +
        'PostgREST menolak SELURUH permintaan karena satu kolom tidak dikenal — yang hilang bukan satu kolom, ' +
        'melainkan seluruh rekap kehadirannya.'
    );
  }
  if (/jamKerjaBersih|menitBersih|dikurangiIstirahat/i.test(kode)) {
    salah('attendance.service.js: ada angka "jam kerja bersih" — itu langkah pertama menuju NBM yang terpotong.');
  }
}

if (gagal === 0) {
  console.log(
    'Istirahat & clock out otomatis: NBM tidak tersentuh, jendela jam ditegakkan server, ' +
      'jam pulang diambil dari shift (bukan jam pemicu), dan yang ditebak sistem ditandai. ✅'
  );
}
process.exit(gagal === 0 ? 0 : 1);
