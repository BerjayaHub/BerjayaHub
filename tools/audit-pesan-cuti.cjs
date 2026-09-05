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

if (gagal === 0) {
  console.log('Pesan cuti: WhatsApp seisi Telegram, dan persempitan tanggal terlihat di semua layar. ✅');
}
process.exit(gagal === 0 ? 0 : 1);
