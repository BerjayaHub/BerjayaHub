/**
 * AUDIT: area presensi & status istirahat di layar Staff App.
 *
 * ============ TIGA CARA FITUR INI RUSAK TANPA TERLIHAT RUSAK ============
 *
 *   gerbang mengunci ke `sesi.outlet_id`  -> staff yang clock in di CK lalu
 *                                            pulang lewat Sentul ditolak "Kamu
 *                                            47501 m dari Central Kitchen",
 *                                            padahal ia BERDIRI di outlet
 *                                            terdaftar
 *   dua rumus kelonggaran ketelitian      -> bisa clock in, tidak bisa clock
 *                                            out, di outlet yang sama, tanpa
 *                                            keterangan apa pun
 *   `listIstirahat(...).catch(() => [])`  -> gagal baca terlihat sama dengan
 *                                            "tidak sedang istirahat", dan
 *                                            tombol Clock Out muncul untuk
 *                                            orang yang harusnya menekan Kembali
 *
 * Tidak satu pun melempar error.
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

const blokAntara = (teks, mulai, selesai) => {
  const i = teks.indexOf(mulai);
  if (i < 0) return '';
  const j = selesai ? teks.indexOf(selesai, i + mulai.length) : -1;
  return teks.slice(i, j > i ? j : undefined);
};

// ---------------------------------------------------------------
// 1. Modul murni aturannya.
// ---------------------------------------------------------------
const area = baca('js/modules/attendance/area-outlet.js');
if (area) {
  const kode = bersih(area, 'area-outlet.js', ['export function cariOutletArea', 'export function bolehAksiPresensi']);

  for (const n of ['diterimaDiArea', 'cariOutletArea', 'bolehAksiPresensi', 'berkoordinat']) {
    if (!new RegExp(`export function ${n}\\(`).test(kode)) salah(`area-outlet.js: \`${n}\` tidak diekspor.`);
  }

  // `Number(null)` adalah 0 — koordinat kosong jadi titik (0,0), radius kosong
  // jadi 0 meter, jarak tak terhitung jadi "tepat di titik outlet".
  if (!/if \(v === null \|\| v === undefined \|\| v === ''\) return null;/.test(kode)) {
    salah(
      "area-outlet.js: nilai kosong tidak disaring sebelum `Number()`. `Number(null)` adalah 0 — outlet tanpa koordinat " +
        'jadi terbaca berada di titik (0,0), dan radius yang kosong jadi 0 meter.'
    );
  }
  // Kelonggaran ketelitian PUNYA BATAS, dan akurasi yang tak terbaca bukan
  // alasan melonggarkan.
  if (!/a === null \|\| a > AKURASI_MAKS_TOLERANSI/.test(kode)) {
    salah(
      'area-outlet.js: batas kelonggaran ketelitian hilang. HP yang melaporkan ±1 km tidak sedang membuktikan orangnya ' +
        'di outlet — menerimanya membuat radius efektif jadi berkilo-kilometer.'
    );
  }
  // Yang PALING DEKAT menang, bukan yang pertama di daftar.
  if (!/if \(cocok && d < pilihJarak\)/.test(kode)) {
    salah(
      'area-outlet.js: outlet yang cocok tidak lagi dipilih yang terdekat. Dua outlet yang areanya bersinggungan akan ' +
        'membuat presensi tercatat di outlet yang salah, dan urutannya cuma kebetulan.'
    );
  }
  // Tiga pengecualian yang disengaja.
  if (!/if \(sesi\?\.is_storing\) return \{ boleh: true/.test(kode)) {
    salah('area-outlet.js: mode Tugas Luar tidak lagi dikecualikan — orangnya memang sedang tidak di outlet.');
  }
  if (!/if \(!daftar\.length\) return \{ boleh: true/.test(kode)) {
    salah('area-outlet.js: BU yang belum mendaftarkan geofence mana pun jadi ikut terkunci.');
  }
  if (!/if \(outletSesi && angka\(outletSesi\.latitude\) === null\)/.test(kode)) {
    salah(
      'area-outlet.js: outlet sesi yang belum ber-geofence tidak lagi dibebaskan. Staffnya selama ini memang bebas; ' +
        'mempersempitnya diam-diam mengunci orang yang baik-baik saja di luar jam kerja admin.'
    );
  }
  // GPS gagal TETAP ditolak.
  if (!/if \(!loc\) \{[\s\S]{0,200}?boleh: false/.test(kode)) {
    salah(
      'area-outlet.js: GPS yang gagal dibaca diloloskan. Seluruh gerbang ini lalu bisa dilewati cukup dengan ' +
        'mematikan izin lokasi.'
    );
  }
  // Pesan penolakan menyebut outlet TERDEKAT & menjelaskan aturannya.
  if (!/hasil\.terdekat/.test(kode) || !/outlet mana pun yang geofence-nya sudah didaftarkan/.test(kode)) {
    salah(
      'area-outlet.js: pesan penolakan tidak lagi menyebut outlet terdekat atau tidak menjelaskan bahwa clock out boleh ' +
        'di outlet mana pun. Menyebut outlet clock in yang 47 km jauhnya mengirim orangnya ke tempat yang tidak perlu.'
    );
  }
}

// ---------------------------------------------------------------
// 2. Layarnya.
// ---------------------------------------------------------------
const page = baca('js/modules/attendance/attendance.page.js');
if (page) {
  const kode = bersih(page, 'attendance.page.js', ['async function pastikanDiAreaPresensi', 'let istirahatTerbaca']);

  // Gerbang lama tidak boleh hidup lagi.
  if (/getOutletGeofence\(sesi\.outlet_id\)/.test(kode)) {
    salah(
      'attendance.page.js: gerbangnya kembali mengunci ke `sesi.outlet_id`. Staff yang clock in di CK lalu pulang lewat ' +
        'Sentul akan ditolak lagi dengan jarak ke outlet yang tidak relevan.'
    );
  }
  if (!/async function pastikanDiAreaPresensi\(/.test(kode)) salah('attendance.page.js: `pastikanDiAreaPresensi` tidak ada.');

  const blok = blokAntara(kode, 'async function pastikanDiAreaPresensi', '\n}\n');
  if (blok) {
    if (!/bolehAksiPresensi\(\{ sesi, outlets, loc, jarak: distanceMeters, aksi, outletSesi \}\)/.test(blok)) {
      salah('attendance.page.js: gerbangnya tidak memakai aturan murni `bolehAksiPresensi` — aturannya jadi tiruan yang akan menyimpang.');
    }
    if (!/if \(!hasil\.boleh\) throw new Error\(hasil\.alasan\);/.test(blok)) {
      salah('attendance.page.js: penolakan dari aturan murni tidak dilemparkan — gerbangnya jadi hiasan.');
    }
  }

  // Ketiga pemanggilnya mengirim DAFTAR outlet, bukan satu outlet.
  const pemanggil = (kode.match(/pastikanDiAreaPresensi\(\{/g) ?? []).length;
  if (pemanggil < 2) {
    salah(`attendance.page.js: hanya ${pemanggil} aksi yang lewat gerbang area — Clock Out dan Istirahat dua-duanya harus.`);
  }
  if (!/outlets: allOutlets/.test(kode)) {
    salah('attendance.page.js: daftar outlet tidak dikirim ke gerbangnya — ia tidak akan punya outlet lain untuk diterima.');
  }

  // SATU aturan untuk deteksi clock in juga.
  if (!/cariOutletArea\(\{ loc, outlets: allOutlets, jarak: distanceMeters \}\)/.test(kode)) {
    salah(
      'attendance.page.js: deteksi clock in tidak lagi memakai `cariOutletArea`. Dua rumus kelonggaran ketelitian yang ' +
        'terpisah sudah pernah menyimpang — staff bisa clock in tapi tidak bisa clock out di outlet yang sama.'
    );
  }
  if (/const AKURASI_MAKS_TOLERANSI = /.test(kode)) {
    salah('attendance.page.js: ambang ketelitian dideklarasikan ulang di layar — dua angka untuk satu aturan.');
  }

  // STATUS ISTIRAHAT: gagal baca tidak boleh menyamar jadi "tidak istirahat".
  if (/listIstirahat\(openSession\.id\)\.catch\(/.test(kode)) {
    salah(
      'attendance.page.js: `listIstirahat` kembali ditelan `.catch`. Daftar kosong berarti "tidak sedang istirahat", ' +
        'dan layar menggambar tombol CLOCK OUT untuk orang yang harusnya menekan Kembali — persis tombol yang tidak ' +
        'boleh ia tekan.'
    );
  }
  if (!/let istirahatTerbaca = true;/.test(kode)) {
    salah('attendance.page.js: kegagalan membaca status istirahat tidak ditandai.');
  }
  if (!/istirahatTerbaca\n?\s*\? ''/.test(kode) && !/istirahatTerbaca/.test(blokAntara(kode, 'class="att-istirahat"', '</div>'))) {
    salah('attendance.page.js: kegagalan membaca status istirahat tidak diberi tahu ke staffnya — ia hanya ditebak diam-diam.');
  }
  // TIDAK dikunci: clock out adalah satu-satunya aksi yang tidak boleh pernah
  // terhalang, dan server menutup istirahat menggantung saat clock out (0138).
  if (/istirahatTerbaca[\s\S]{0,80}disabled/.test(kode)) {
    salah(
      'attendance.page.js: tombol dikunci saat status istirahat tak terbaca. Clock out tidak boleh pernah terhalang — ' +
        'server sudah menutup istirahat yang menggantung dengan sendirinya (`tutup_istirahat_saat_pulang`, 0138).'
    );
  }

  // Tombol Kembali menggantikan Clock Out saat istirahat berjalan.
  if (!/berjalan\n\s*\? `<button class="primary" id="btn-istirahat-selesai"/.test(kode)) {
    salah(
      'attendance.page.js: tombol Clock Out tidak lagi digantikan "Kembali dari Istirahat" saat istirahat berjalan. ' +
        'Dua tombol utama berdampingan membuat orang menekan yang salah — dan di sini "salah" berarti pulang padahal ' +
        'ia cuma mau kembali bekerja.'
    );
  }
}

// ---------------------------------------------------------------
// 3. NBM tetap mengikuti outlet BASIS, bukan tempat fisik.
//
// Inilah yang membuat clock out lintas outlet aman. Kalau suatu saat laporan
// SDM berpindah membaca `outlet_id`, kelonggaran di atas langsung berubah jadi
// NBM yang tercatat di outlet yang salah.
// ---------------------------------------------------------------
const svc = baca('js/modules/attendance/attendance.service.js');
if (svc) {
  const kode = tanpaKomentar(svc);
  if (!/nbm_outlet_id: nbmOutletId \?\? null/.test(kode)) {
    salah('attendance.service.js: `nbm_outlet_id` tidak lagi disimpan terpisah dari `outlet_id` — NBM akan ikut tempat fisik.');
  }
}
const laporan = baca('js/modules/report/report.service.js');
if (laporan) {
  const kode = tanpaKomentar(laporan);
  // JUMLAHNYA DIHITUNG, bukan sekadar "ada minimal satu".
  //
  // Polanya muncul di LIMA tempat: penyaring outlet di `fetchAttendance`, Rekap
  // NBM (dua kali), dan Hak Cuti Pengganti (dua kali). Pemeriksaan yang cuma
  // menuntut kehadirannya lolos untuk perubahan yang menyentuh SATU saja — dan
  // satu laporan yang membaca outlet fisik sementara yang lain membaca basis
  // adalah dua laporan yang menjawab pertanyaan sama dengan angka berbeda.
  const dipakai = (kode.match(/nbm_outlet_id \?\? r\.outlet_id/g) ?? []).length;
  if (dipakai < 5) {
    salah(
      `report.service.js: hanya ${dipakai} tempat yang membaca \`nbm_outlet_id ?? outlet_id\` (seharusnya 5). ` +
        'Begitu satu laporan membaca tempat FISIK, clock out di outlet lain memindahkan NBM staff ke outlet yang salah — ' +
        'dan laporan di sebelahnya tetap benar, jadi selisihnya tidak bisa dijelaskan siapa pun.'
    );
  }
}

if (gagal === 0) {
  console.log(
    'Area presensi: clock out & istirahat boleh di outlet terdaftar mana pun, aturannya satu untuk clock in & clock out, ' +
      'status istirahat yang gagal dibaca mengaku, dan NBM tetap mengikuti outlet basis. ✅'
  );
}
process.exit(gagal === 0 ? 0 : 1);
