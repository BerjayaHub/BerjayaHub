/**
 * AUDIT: WhatsApp & Telegram menceritakan cuti dengan isi yang SAMA,
 *        dan tanggal yang dipersempit tidak pernah disembunyikan.
 *
 * ============ DUA HAL YANG DIKUNCI ============
 *
 * 1. Tombol "Bagikan" memakai `pesan-cuti.js`, bukan kalimatnya sendiri.
 *
 *    Versi lama: "Pengajuan cuti Anda (…) tanggal … telah DISETUJUI." Satu
 *    kalimat, untuk orang yang paling berkepentingan. Kalau suatu saat ada yang
 *    menuliskan kalimatnya lagi di layar, kedua saluran mulai menyimpang — dan
 *    yang menyimpang duluan selalu yang lebih jarang dibaca pengembangnya.
 *
 * 2. Persempitan tanggal (0117) muncul di EMPAT tempat, bukan satu.
 *
 *    Pesan WhatsApp bisa terlewat, terhapus, atau tidak pernah dikirim —
 *    membagikannya adalah langkah TERPISAH yang bisa dibatalkan admin. Kalau
 *    layarnya sendiri cuma menulis "6–8 disetujui", staff yang mengajukan 4–8
 *    akan mengira ia salah mengetik pengajuannya sendiri, dan tidak punya
 *    tempat untuk memastikan. Admin lain yang membuka daftar beberapa hari
 *    kemudian akan menyimpulkan hal yang keliru dengan cara yang sama.
 */
const fs = require('fs');
const path = require('path');

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

// Pemotong komentar yang MENGHORMATI STRING — lihat tools/lib/tanpa-komentar.cjs.
//
// Versi dua-baris yang dulu disalin ke tiap audit memperlakukan `/*` di dalam
// string (`accept="image/*"`) sebagai awal komentar, lalu menelan puluhan baris
// kode sampai `*/` JSDoc berikutnya. Pada pemeriksaan LARANGAN, itu berarti
// audit hijau karena kodenya sudah terlanjur terhapus.
const { tanpaKomentar } = require('./lib/tanpa-komentar.cjs');

// ---------------------------------------------------------------
// 1. Layar admin memakai modul bersama, bukan kalimatnya sendiri.
// ---------------------------------------------------------------
const adminCuti = baca('js/modules/leave/leave.admin.page.js');
if (adminCuti) {
  const kode = tanpaKomentar(adminCuti);

  if (!/pesanCutiWa\s*\(/.test(kode)) {
    salah(
      'js/modules/leave/leave.admin.page.js: teks share tidak memakai `pesanCutiWa`. ' +
        'Dua saluran yang menceritakan peristiwa sama akan bercerita berbeda, dan yang menyimpang ' +
        'duluan selalu yang lebih jarang dibaca.'
    );
  }
  // Bentuk kalimat tunggal versi lama tidak boleh muncul lagi.
  if (/telah \$\{verdict\}|telah DISETUJUI|Pengajuan cuti Anda/.test(kode)) {
    salah(
      'js/modules/leave/leave.admin.page.js: masih ada kalimat tunggal versi lama. ' +
        'Itu persis isi yang dikeluhkan: penerimanya tidak tahu jenis cuti, jumlah hari, siapa yang memutuskan, ' +
        'maupun apakah tanggalnya dipersempit.'
    );
  }
}

// ---------------------------------------------------------------
// 2. Jejak persempitan tampil di kedua layar.
// ---------------------------------------------------------------
for (const [rel, siapa] of [
  ['js/modules/leave/leave.admin.page.js', 'daftar admin'],
  ['js/modules/leave/leave.page.js', 'riwayat staff']
]) {
  const isi = baca(rel);
  if (!isi) continue;
  const kode = tanpaKomentar(isi);
  if (!/diubahAdmin\s*\(/.test(kode)) {
    salah(
      `${rel}: ${siapa} tidak menampilkan jejak persempitan (\`diubahAdmin\`). ` +
        'Yang terbaca hanya tanggal akhirnya, dan tidak ada tempat untuk memastikan berapa yang sebenarnya diminta.'
    );
  }
  // DIPASANG KE BARISNYA, bukan sekadar DIHITUNG.
  //
  // Percobaan pertama cuma mencari kata `jejakUbah`. Sabotase yang membuang
  // `${jejakUbah}` dari templat barisnya LOLOS — namanya masih ada, di
  // deklarasinya sendiri. Nilainya dihitung dengan benar lalu dibuang, dan
  // layarnya kembali diam persis seperti sebelum perbaikan ini.
  //
  // Yang ironis: komentar audit ini sudah menyebut "dihitung lalu dibuang"
  // sebagai hal yang dijaganya, sementara polanya tidak bisa membedakan
  // keduanya. Sekarang yang dituntut adalah pemakaiannya di dalam templat.
  if (!/\$\{jejakUbah\}/.test(kode)) {
    salah(
      `${rel}: \`jejakUbah\` tidak dipasang ke templat barisnya — dihitung lalu dibuang, ` +
        'dan layarnya kembali hanya menampilkan tanggal akhirnya.'
    );
  }
}

// ---------------------------------------------------------------
// 3. Kolom jejaknya benar-benar diambil dari server.
// ---------------------------------------------------------------
const svc = baca('js/modules/leave/leave.service.js');
if (svc) {
  const jumlah = (svc.match(/start_date_awal/g) ?? []).length;
  if (jumlah < 2) {
    salah(
      `js/modules/leave/leave.service.js: \`start_date_awal\` hanya muncul ${jumlah}x. ` +
        'Kedua daftar (admin & staff) harus mengambilnya — kolom yang tidak diambil selalu `undefined`, ' +
        'dan `diubahAdmin` akan diam-diam selalu menjawab "tidak berubah".'
    );
  }
  // Penulisannya lewat RPC, karena aturannya ada di server.
  if (!/rpc\('setujui_cuti'/.test(svc)) {
    salah(
      "js/modules/leave/leave.service.js: `reviewLeaveRequest` tidak memakai RPC `setujui_cuti`. " +
        'Aturan "hanya boleh dipersempit", hitung ulang `day_count`, dan penyalinan tanggal asli semuanya ' +
        'ada di server — menulis langsung ke tabel berarti menirukan ketiganya di klien, dan tiruan aturan ' +
        'selalu menyimpang dari aslinya.'
    );
  }
  // PENANDANYA `reviewed_by`, BUKAN sekadar `status`.
  //
  // Percobaan pertama melarang setiap `.update()` yang menyebut `status`, dan
  // menangkap `cancelLeaveRequest` — staff membatalkan pengajuannya SENDIRI
  // selagi masih pending. Itu jalur yang sah, tidak melewati penjagaan apa pun
  // (tidak ada tanggal, tidak ada persetujuan), dan tidak ada hubungannya
  // dengan 0117.
  //
  // Audit yang melarang hal yang benar akan dimatikan orang, dan audit yang
  // dimatikan sama saja dengan tidak ada. Yang dicari adalah jalur PERSETUJUAN,
  // dan satu-satunya yang menandainya adalah `reviewed_by`.
  if (/from\('leave_requests'\)[\s\S]{0,300}\.update\(\s*\{[\s\S]{0,300}reviewed_by/.test(svc)) {
    salah(
      'js/modules/leave/leave.service.js: masih ada `.update()` langsung yang menyetel `reviewed_by`. ' +
        'Itu jalur persetujuan, dan ia melewati seluruh penjagaan 0117: batas "hanya boleh dipersempit", ' +
        'hitung ulang `day_count`, dan penyalinan tanggal asli.'
    );
  }
}

// ---------------------------------------------------------------
// 4. Edge Function menyebut persempitan juga.
// ---------------------------------------------------------------
const edge = baca('supabase/functions/notify-telegram/index.ts');
if (edge) {
  if (!/start_date_awal/.test(edge)) {
    salah(
      'supabase/functions/notify-telegram/index.ts: pesan Telegram tidak menyebut tanggal yang diajukan. ' +
        'Grup akan membaca "6–8 disetujui" untuk pengajuan 4–8 tanpa satu pun tanda bahwa sebagian ditolak.'
    );
  }
}

// ---------------------------------------------------------------
// 5. Dialog persetujuan benar-benar menanyakan tanggalnya.
// ---------------------------------------------------------------
if (adminCuti) {
  const kode = tanpaKomentar(adminCuti);
  const punyaKotak = /name:\s*'start'[\s\S]{0,200}type:\s*'date'/.test(kode) && /name:\s*'end'[\s\S]{0,200}type:\s*'date'/.test(kode);
  if (!punyaKotak) {
    salah(
      'js/modules/leave/leave.admin.page.js: dialog Setujui tidak punya kotak tanggal mulai & selesai. ' +
        'RPC-nya menerimanya, tapi tidak ada jalan di layar untuk mengisinya — kemampuannya ada, ' +
        'jalannya tidak ada di layar.'
    );
  }
  if (!/startDate:\s*isApprove\s*\?/.test(kode)) {
    salah(
      'js/modules/leave/leave.admin.page.js: tanggal dari dialog tidak diteruskan ke `reviewLeaveRequest`, ' +
        'atau diteruskan juga saat MENOLAK. Menolak sambil mengubah tanggal bukan keadaan yang punya arti.'
    );
  }
}

// ---------------------------------------------------------------
// 5. Pesan keputusan membawa SELURUH isi form (diminta 0178).
//
// Dulu ia cuma membawa nama, jenis, rentang, pemutus, catatan admin. Lokasi,
// ALASAN YANG DITULIS STAFF, dan lampiran hanya ada di pesan "Pengajuan
// Baru" — jadi pesan yang paling penting justru yang paling miskin.
// ---------------------------------------------------------------
const murni = baca('js/modules/leave/pesan-cuti.js');
const edgeTs = baca('supabase/functions/notify-telegram/index.ts');
if (murni && edgeTs) {
  const kodeMurni = tanpaKomentar(murni);

  for (const [pola, apa] of [
    [/r\?\.reason/, 'alasan yang ditulis staff'],
    [/attachment_path/, 'keberadaan lampiran'],
    [/business_units\?\./, 'nama BU'],
    [/outlets\?\./, 'nama outlet'],
    [/revisi_ke/, 'penanda revisi']
  ]) {
    if (!pola.test(kodeMurni)) {
      salah(`js/modules/leave/pesan-cuti.js: pesan keputusan tidak membawa ${apa}.`);
    }
  }

  // ALASAN STAFF vs CATATAN ADMIN — ikonnya harus berbeda.
  //
  // Keduanya dulu 💬. Begitu muncul bersamaan di satu pesan, kalimat staff
  // terbaca sebagai keputusan atasannya, atau sebaliknya.
  if (!/Alasan: /.test(kodeMurni) || !/Catatan admin: /.test(kodeMurni)) {
    salah('js/modules/leave/pesan-cuti.js: alasan staff & catatan admin tidak diberi label yang membedakannya.');
  }

  // Edge Function menyusun barisnya sendiri (ia berjalan di Deno, tidak bisa
  // mengimpor modul browser). Jadi yang dijaga: ia membawa potongan yang SAMA.
  //
  // DIPOTONG ke fungsi KEPUTUSANNYA dulu. `r.reason` juga muncul di
  // `pesanCutiBaru`, jadi memeriksa seluruh berkas membuat alasan staff bisa
  // dicabut dari pesan keputusan sementara auditnya tetap hijau — persis yang
  // ditunjukkan sabotasenya.
  const iKeputusan = edgeTs.indexOf('async function pesanCutiDireview');
  const edgeKeputusan = iKeputusan >= 0 ? edgeTs.slice(iKeputusan, edgeTs.indexOf('\n}', iKeputusan)) : '';
  if (!edgeKeputusan) salah('supabase/functions/notify-telegram/index.ts: `pesanCutiDireview` tidak ada.');
  for (const [pola, apa] of [
    [/r\.reason/, 'alasan staff'],
    [/r\.attachment_path/, 'lampiran'],
    [/lokasi \? /, 'lokasi BU/outlet'],
    [/REVISI ke-/, 'penanda revisi'],
    [/Catatan admin/, 'label catatan admin']
  ]) {
    if (!pola.test(edgeKeputusan)) {
      salah(`supabase/functions/notify-telegram/index.ts: pesan keputusan Telegram tidak membawa ${apa} — dua saluran bercerita berbeda.`);
    }
  }

  // Revisi yang TIDAK mengubah status tetap harus dikabarkan: cuti 4–8 yang
  // direvisi jadi 6–12 tetap `approved`, dan tanpa ini grup tidak pernah tahu
  // tanggalnya berubah.
  if (!/revisi_ke\) \|\| 0\) > \(Number\(old_record\.revisi_ke\)/.test(edgeTs)) {
    salah(
      'supabase/functions/notify-telegram/index.ts: revisi yang tidak mengubah status tidak dikabarkan. ' +
        'Pesan keputusan lama tertinggal di grup sebagai satu-satunya rujukan.'
    );
  }
}

// ---------------------------------------------------------------
// 6. Jalur revisi di Admin Portal.
// ---------------------------------------------------------------
const adminKode = baca('js/modules/leave/leave.admin.page.js');
if (adminKode) {
  const kode = tanpaKomentar(adminKode);
  // Markupnya, bukan nama kelasnya di mana pun: baris `querySelectorAll` yang
  // menganggur tetap memuat namanya dan tetap menghijaukan audit.
  if (!/class="btn-revisi-cuti"/.test(kode)) {
    salah('js/modules/leave/leave.admin.page.js: tidak ada tombol Revisi untuk cuti yang sudah diputuskan.');
  }
  if (!/querySelectorAll\('\.btn-revisi-cuti'\)/.test(kode)) {
    salah('js/modules/leave/leave.admin.page.js: tombol Revisi digambar tapi tidak pernah dipasangi penangan klik.');
  }
  // Alasan wajib DI LAYAR, bukan cuma di database: galat server untuk hal yang
  // bisa dicegat di form adalah dialog yang diisi dua kali.
  const iDlg = kode.indexOf('async function revisiDialog');
  const dlg = iDlg >= 0 ? kode.slice(iDlg, kode.indexOf('async function reviewDialog')) : '';
  if (!/name: 'alasan'[\s\S]{0,160}required: true/.test(dlg)) {
    salah('js/modules/leave/leave.admin.page.js: alasan revisi tidak diwajibkan di formnya.');
  }
  // Cuti lampau: jatahnya berubah SURUT, dan rekap bulan itu jadi berbeda dari
  // yang sudah pernah dibaca orang.
  if (!/SUDAH LEWAT/.test(dlg)) {
    salah('js/modules/leave/leave.admin.page.js: revisi cuti yang tanggalnya sudah lewat tidak diperingatkan.');
  }
  // Dialog Setujui TIDAK boleh ikut longgar: batas "hanya boleh dipersempit"
  // itu yang menjaga keputusan pertama.
  const iRev = kode.indexOf('async function reviewDialog');
  const rev = iRev >= 0 ? kode.slice(iRev, iRev + 2000) : '';
  // DIHITUNG, bukan sekadar dicari. Kotak tanggalnya ada DUA (mulai &
  // selesai); mencari satu kemunculan membuat batas pada salah satunya bisa
  // dicabut sementara auditnya tetap hijau.
  const batasMin = (rev.match(/min: record\.start_date/g) ?? []).length;
  const batasMax = (rev.match(/max: record\.end_date/g) ?? []).length;
  if (batasMin < 2 || batasMax < 2) {
    salah(
      `js/modules/leave/leave.admin.page.js: dialog Setujui kehilangan batas rentang pengajuannya ` +
        `(min ${batasMin}/2, max ${batasMax}/2).`
    );
  }
}

const svcCuti = baca('js/modules/leave/leave.service.js');
if (svcCuti) {
  // Kolom yang tidak diambil selalu `undefined`, dan penanda REVISI-nya
  // diam-diam tidak pernah muncul — pesan versi lama dan versi baru jadi
  // terlihat sama persis.
  for (const kolom of ['revisi_ke', 'alasan_revisi', 'direvisi_by_nama', 'leave_type_id']) {
    if (!svcCuti.includes(kolom)) {
      salah(`js/modules/leave/leave.service.js: kolom \`${kolom}\` tidak diambil — layar & pesannya kehilangan jejak revisinya.`);
    }
  }
  if (!/rpc\(\s*'revisi_cuti'/.test(svcCuti)) {
    salah('js/modules/leave/leave.service.js: `revisiCuti` tidak memanggil RPC-nya.');
  }
}

const mig = baca('supabase/migrations/0178_revisi_cuti.sql');
if (mig) {
  const sql = mig
    .split('\n')
    .map((b) => (b.trim().startsWith('--') ? '' : b))
    .join('\n');
  if (!/Alasan revisi wajib/.test(sql)) salah('0178: alasan revisi tidak diwajibkan di database.');
  if (!/is_admin_of_outlet\(v_uid, v_r\.outlet_id\)/.test(sql)) {
    salah('0178: wewenangnya tidak sama dengan `setujui_cuti` — dua definisi "siapa admin" akan menyimpang.');
  }
  if (!/v_r\.status = 'pending'/.test(sql)) {
    salah('0178: pengajuan yang masih pending tidak ditolak jalur ini — batas "hanya boleh dipersempit" jadi bisa dilewati.');
  }
  if (!/day_count = \(p_end - p_start\) \+ 1/.test(sql)) {
    salah('0178: `day_count` tidak dihitung ulang — jatah cuti terpotong sebesar yang tidak dipakai.');
  }
  // `*_awal` adalah PERMINTAAN ASLI staff. Menimpanya menghapus satu-satunya
  // jejak apa yang sebenarnya diminta orangnya.
  if (/start_date_awal\s*=/.test(sql)) {
    salah('0178: kolom `*_awal` ikut ditimpa — jejak permintaan asli staff hilang.');
  }
  if (!/direvisi_by_nama = v_nama/.test(sql)) {
    salah('0178: nama perevisi tidak disimpan sebagai teks — jejaknya hilang saat akunnya dihapus.');
  }
}

if (gagal === 0) {
  console.log('Pesan cuti: WhatsApp seisi Telegram, dan persempitan tanggal terlihat di semua layar. ✅');
}
process.exit(gagal === 0 ? 0 : 1);
