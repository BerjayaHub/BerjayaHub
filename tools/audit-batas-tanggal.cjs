/**
 * AUDIT: batas tanggal untuk query `timestamptz` dibangun di SATU tempat.
 *
 * ============ BUG YANG MELAHIRKANNYA ============
 *
 * Rekap NBM difilter 31 Agustus – 5 September, dan tanggal 31 Agustus tidak
 * muncul. Batasnya dibangun sendiri di layar itu:
 *
 *     dateFrom: new Date(from).toISOString()
 *     dateTo:   new Date(to + 'T23:59:59').toISOString()
 *
 * Dua bentuk itu dibaca JavaScript dengan aturan yang BERBEDA:
 *
 *     'YYYY-MM-DD'            -> UTC    -> 00:00Z  = 07:00 WIB
 *     'YYYY-MM-DDTHH:MM:SS'   -> LOKAL  -> 00:00   waktu perangkat
 *
 * Batas awalnya melompat tujuh jam, dan setiap absensi sebelum pukul 07:00 di
 * tanggal pertama hilang dari rekap. Tanpa satu pun error — daftarnya tampil,
 * angkanya terlihat wajar, cuma sebagian orang tidak ada.
 *
 * Perbedaan tata bahasa ini tidak akan pernah terlihat saat membaca kodenya.
 * Karena itu yang dijaga bukan "tulis yang benar", melainkan "jangan tulis
 * sendiri": pakai `isoFrom`/`isoTo` dari `js/core/dates.js`, yang memasang
 * offset WIB secara eksplisit dan sudah diuji di `tools/test-batas-tanggal.mjs`.
 */
const fs = require('fs');
const path = require('path');
const { tanpaKomentar } = require('./lib/tanpa-komentar.cjs');

const AKAR = path.join(__dirname, '..', 'js');
let gagal = 0;
let diperiksa = 0;

function berkasJs(dir, keluar = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) berkasJs(p, keluar);
    else if (e.name.endsWith('.js')) keluar.push(p);
  }
  return keluar;
}

for (const berkas of berkasJs(AKAR)) {
  const rel = path.relative(path.join(__dirname, '..'), berkas);
  // `js/core/dates.js` justru TEMPATNYA — di situlah offsetnya ditulis.
  if (rel.replace(/\\/g, '/') === 'js/core/dates.js') continue;

  const kode = tanpaKomentar(fs.readFileSync(berkas, 'utf8'));
  diperiksa++;

  // 1. Batas ISO yang dirakit sendiri dari sebuah TANGGAL 'YYYY-MM-DD'.
  //
  // SENGAJA SEMPIT. Percobaan pertama menandai setiap
  // `new Date(x).toISOString()`, dan langsung menuduh enam tempat yang justru
  // benar — mengubah sebuah instant (`e.time`, hasil hitungan milidetik) jadi
  // ISO memang begitu caranya, dan tidak ada tanggal-polos yang terlibat.
  //
  // Yang berbahaya cuma satu bentuk: ketika yang masuk adalah tanggal TANPA
  // jam. Di situlah JavaScript diam-diam berpindah antara UTC dan waktu lokal.
  const NAMA_TANGGAL = /^(from|to|dari|sampai|date_?from|date_?to|tanggal|tgl|start|end|awal|akhir)/i;
  for (const m of kode.matchAll(/new Date\(\s*([^)]*?)\s*\)\s*\.toISOString\(\)/g)) {
    const arg = m[1];
    if (!arg) continue; // `new Date()` = sekarang, bukan batas rentang.
    const tanggalPolos = NAMA_TANGGAL.test(arg) || /^'\d{4}-\d{2}-\d{2}'$/.test(arg);
    const ditempelJam = /\+\s*'T[\d:]/.test(arg) || /T\d{2}:\d{2}/.test(arg);
    if (!tanggalPolos && !ditempelJam) continue;

    const baris = kode.slice(0, m.index).split('\n').length;
    gagal++;
    console.error(
      `❌ ${rel}:${baris} — batas tanggal dirakit sendiri: \`${m[0]}\`. ` +
        "`new Date('YYYY-MM-DD')` dibaca sebagai UTC sedangkan `new Date('YYYY-MM-DDTHH:MM')` dibaca sebagai waktu " +
        'LOKAL, jadi batas awal & akhir bisa memakai dua aturan berbeda tanpa terlihat. Pakai `isoFrom`/`isoTo` ' +
        'dari js/core/dates.js.'
    );
  }

  // 2. Offset WIB yang ditempel manual ke string tanggal.
  //
  // Bentuknya benar, tapi menyalinnya ke banyak tempat berarti suatu saat ada
  // yang menulis `T23:59:59` tanpa `+07:00`, atau `+07:00` di satu ujung saja —
  // dan ketimpangan itu tidak terlihat kecuali dibandingkan berdampingan.
  for (const m of kode.matchAll(/`\$\{[^}]+\}T(00:00:00|23:59:59)(\.\d+)?\+07:00`/g)) {
    const baris = kode.slice(0, m.index).split('\n').length;
    gagal++;
    console.error(
      `❌ ${rel}:${baris} — batas tanggal WIB ditulis manual: \`${m[0]}\`. ` +
        'Bentuknya benar sekarang, tapi salinan kelima akan kehilangan `+07:00` di salah satu ujungnya. ' +
        'Pakai `isoFrom`/`isoTo` dari js/core/dates.js.'
    );
  }
}

if (gagal === 0) {
  console.log(`Batas tanggal: ${diperiksa} berkas diperiksa — semuanya lewat isoFrom/isoTo. ✅`);
}
process.exit(gagal === 0 ? 0 : 1);
