#!/usr/bin/env node
/**
 * SIMULASI TIDAK BOLEH MENYENTUH APA PUN — DAN TIDAK BOLEH MENYAMAR.
 *
 * ============ MASALAHNYA ============
 *
 * Layar Simulasi penuh kotak isian harga, dan di sebelahnya ada modul yang
 * memang bertugas menyimpan harga. Jarak antara "hitung harga seandainya" dan
 * "pasang harga itu" tinggal satu tombol — dan tombol itu akan terasa sangat
 * masuk akal untuk ditambahkan.
 *
 * Kalau ditambahkan, harga jual sungguhan berubah dari halaman yang seluruh
 * angkanya karangan, tanpa lewat layar yang seharusnya mencatatnya sebagai
 * keputusan.
 *
 * Bahaya kedua lebih halus: angka simulasi yang kehilangan labelnya. Tiga konteks
 * lain masih terikat sesuatu yang nyata; yang ini tidak terikat apa pun, dan
 * karangan yang rapi lebih meyakinkan daripada kenyataan yang berantakan.
 *
 * ============ YANG DIPERIKSA ============
 *
 *   1. Tidak menulis: DB, jaringan, penyimpanan peramban.
 *   2. Tidak memakai `products.sale_price` sebagai sumber kebenaran.
 *   3. Seluruh hasilnya berkonteks `simulated` — tidak pernah actual/projected/target.
 *   4. Tidak memutasi masukannya (Actual/Projection/Target aman).
 *   5. Tidak memakai mesin lama `bep.js` yang mencampur biaya tetap & pricing.
 *   6. Biaya bersama/korporat tidak masuk ke simulasi outlet.
 *   7. Biaya tetap tidak masuk ke perhitungan harga jual.
 *   8. Tidak ada pembagian tanpa penjaga.
 *   9. Konsolidasi bukan BEP gabungan yang disamarkan.
 *  10. Layar memasang penanda SIMULATION dan tidak punya tombol simpan.
 */

const fs = require('fs');
const path = require('path');

const AKAR = path.join(__dirname, '..');
const DIR = path.join(AKAR, 'js', 'modules', 'owner');
const MESIN = path.join(DIR, 'simulasi.js');
const LAYAR = path.join(DIR, 'simulasi.owner.js');

function tanpaKomentar(js) {
  return js
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((b) => b.replace(/(^|[^:])\/\/.*$/, '$1'))
    .join('\n');
}

/**
 * Tubuh sebuah `export function`, dipotong di `export` berikutnya.
 *
 * Namanya dicocokkan sampai kurung buka. `indexOf('export function simulasiOutlet')`
 * juga cocok dengan `simulasiOutletLama` — fungsi yang diganti nama akan terlihat
 * masih ada dan seluruh pemeriksaan di bawahnya memeriksa fungsi yang salah.
 * Sabotase mengganti nama sempat lolos persis begini di audit Target.
 */
function tubuhFungsi(src, nama) {
  const cocok = new RegExp(`export\\s+function\\s+${nama}\\s*\\(`).exec(src);
  if (!cocok) return null;
  const sisa = src.slice(cocok.index + 10);
  const j = sisa.indexOf('\nexport ');
  return j < 0 ? sisa : sisa.slice(0, j);
}

const masalah = [];
const catat = (p) => masalah.push(p);
const barisKe = (src, pola) => src.split('\n').findIndex((b) => pola.test(b)) + 1;

for (const jalan of [MESIN, LAYAR]) {
  if (!fs.existsSync(jalan)) catat(`${path.basename(jalan)} tidak ditemukan — audit ini sudah basi.`);
}
if (masalah.length) {
  console.error('❌ ' + masalah.join('\n'));
  process.exit(1);
}

const mesin = tanpaKomentar(fs.readFileSync(MESIN, 'utf8'));
const layar = tanpaKomentar(fs.readFileSync(LAYAR, 'utf8'));
const BERKAS = [
  { nama: 'simulasi.js', src: mesin },
  { nama: 'simulasi.owner.js', src: layar }
];

// =====================================================================
// 1. TIDAK MENULIS APA PUN
// =====================================================================
const TULIS = [
  { pola: /\.insert\s*\(/, apa: '.insert()' },
  { pola: /\.update\s*\(/, apa: '.update()' },
  { pola: /\.upsert\s*\(/, apa: '.upsert()' },
  { pola: /\.delete\s*\(/, apa: '.delete()' },
  { pola: /\.rpc\s*\(/, apa: '.rpc()' },
  { pola: /supabase/i, apa: 'klien supabase' },
  { pola: /\bfetch\s*\(/, apa: 'fetch()' },
  { pola: /localStorage|sessionStorage/, apa: 'penyimpanan peramban' },
  { pola: /simpanHarga|setHargaOutlet|upsertHarga/, apa: 'penyimpan harga outlet' }
];

for (const b of BERKAS) {
  for (const t of TULIS) {
    if (!t.pola.test(b.src)) continue;
    catat(
      `${b.nama}:${barisKe(b.src, t.pola)} — memakai ${t.apa}.\n` +
        `    Simulasi adalah kotak pasir hitung. Harga hasil simulasi yang bisa dipasang\n` +
        `    dari sini akan mengubah harga jual sungguhan dari halaman yang seluruh\n` +
        `    angkanya karangan, tanpa lewat layar yang mencatatnya sebagai keputusan.`
    );
  }
}

// Tombol simpan di layar simulasi — bahkan yang belum terhubung ke mana pun.
if (/>\s*(Simpan|Terapkan ke|Pasang harga)/i.test(layar)) {
  catat(
    `simulasi.owner.js:${barisKe(layar, />\s*(Simpan|Terapkan ke|Pasang harga)/i)} — ada tombol bernada menyimpan.\n` +
      `    Layar ini tidak boleh punya jalan keluar ke data sungguhan, bahkan yang\n` +
      `    tombolnya belum terhubung — tombol yang ada akan dihubungkan cepat atau lambat.`
  );
}

// =====================================================================
// 2. BUKAN HARGA MASTER
// =====================================================================
for (const b of BERKAS) {
  if (/sale_price/.test(b.src)) {
    catat(
      `${b.nama}:${barisKe(b.src, /sale_price/)} — menyentuh products.sale_price.\n` +
        `    Harga master adalah SATU angka untuk seluruh BU, yaitu persis yang dihapus\n` +
        `    di Phase 1–7. Memakainya di sini mengembalikannya lewat pintu belakang.`
    );
  }
}

// =====================================================================
// 3. KONTEKSNYA SELALU `simulated`
// =====================================================================
const FUNGSI = ['baselineSimulasi', 'hargaSimulasi', 'simulasiOutlet', 'bandingkan', 'ringkasSimulasi'];
for (const fn of FUNGSI) {
  const tubuh = tubuhFungsi(mesin, fn);
  if (tubuh == null) {
    catat(`simulasi.js — fungsi ${fn}() tidak ada lagi.`);
    continue;
  }
  if (!/konteks:\s*'simulated'/.test(tubuh)) {
    catat(
      `simulasi.js — ${fn}() mengembalikan hasil tanpa konteks: 'simulated'.\n` +
        `    Label harus melekat pada DATANYA, bukan hanya di layar: angka yang dioper ke\n` +
        `    unduhan atau ringkasan akan sampai tanpa keterangan apa pun.`
    );
  }
}

// Seluruh berkas — termasuk helper dan jalur hasil-kosong.
for (const lain of ['actual', 'projected', 'target']) {
  const pola = new RegExp(`konteks:\\s*'${lain}'`);
  if (pola.test(mesin)) {
    catat(
      `simulasi.js:${barisKe(mesin, pola)} — ada hasil bertanda konteks: '${lain}'.\n` +
        `    Hasil simulasi yang menyamar sebagai konteks lain adalah kegagalan paling\n` +
        `    mahal di modul ini: angka karangan yang dibaca sebagai kenyataan.`
    );
  }
}

// =====================================================================
// 4. TIDAK MEMUTASI MASUKANNYA
// =====================================================================
//
// Ditangkap secara struktural: penugasan ke properti dari objek masukan.
// `input.x =`, `baseline.x =`, `actual.x =` semuanya berarti simulasi menulis ke
// dalam objek milik orang lain — dan objek itu dipakai bersama oleh tab Actual.
for (const b of BERKAS) {
  const pola = /\b(actual|baseline|input|proyeksi|target|sim|dasar)\s*(\.[A-Za-z_$][\w$]*)+\s*=[^=]/;
  if (pola.test(b.src)) {
    catat(
      `${b.nama}:${barisKe(b.src, pola)} — menulis ke dalam objek masukan.\n` +
        `    Simulasi harus MEMBUAT objek baru. Memutasi masukannya membuat angka di tab\n` +
        `    Actual berubah hanya karena tab Simulasi pernah dibuka — dan penyebabnya\n` +
        `    nyaris mustahil dilacak.`
    );
  }
}

// =====================================================================
// 5. TIDAK MEMAKAI MESIN LAMA
// =====================================================================
//
// `pricing.js` BOLEH: ia murni HPP -> harga, tidak menyentuh biaya tetap, dan
// sudah diuji tersendiri. `bep.js` TIDAK: ia melebur seluruh outlet dan
// mencampur biaya tetap, biaya variabel, dan pricing dalam satu perhitungan.
for (const terlarang of ['bep.js', 'kpi.js', '.service.js', 'muat-data.js']) {
  const pola = new RegExp(`from\\s+'[^']*${terlarang.replace('.', '\\.')}'`);
  if (pola.test(mesin)) {
    catat(
      `simulasi.js — mengimpor "${terlarang}".\n` +
        `    Mesin lama melebur seluruh outlet dan mencampur biaya tetap dengan biaya\n` +
        `    variabel. Simulasi per outlet yang diam-diam memakainya akan menghasilkan\n` +
        `    angka yang tidak bisa dibandingkan dengan tab mana pun.`
    );
  }
}

// =====================================================================
// 6. BIAYA BERSAMA TIDAK MASUK KE OUTLET
// =====================================================================
for (const cakupan of ['shared_bu', 'corporate']) {
  if (new RegExp(cakupan).test(mesin)) {
    catat(
      `simulasi.js:${barisKe(mesin, new RegExp(cakupan))} — menyebut "${cakupan}".\n` +
        `    Simulasi per outlet hanya boleh memuat biaya direct_outlet. Biaya bersama yang\n` +
        `    dibagi rata akan terhitung berulang di setiap outlet.`
    );
  }
}

// =====================================================================
// 7. BIAYA TETAP TIDAK MASUK KE HARGA JUAL
// =====================================================================
const tubuhHarga = tubuhFungsi(mesin, 'hargaSimulasi');
if (tubuhHarga) {
  for (const jejak of ['fixed', 'sewa', 'hariOperasional', 'targetLaba']) {
    if (new RegExp(`\\b${jejak}`, 'i').test(tubuhHarga)) {
      catat(
        `simulasi.js — hargaSimulasi() menyentuh "${jejak}".\n` +
          `    Membebankan biaya tetap ke tiap porsi membuat harga NAIK ketika penjualan\n` +
          `    TURUN — persis kebalikan dari yang seharusnya. Biaya tetap ditutup oleh\n` +
          `    volume, dan itulah gunanya BEP.`
      );
    }
  }
}

// =====================================================================
// 8. PEMBAGIAN SELALU BERPENJAGA
// =====================================================================
//
// Tiga pembagi di modul ini bisa nol dari isian pengguna: CM%, ASP, dan hari
// operasional. Yang dicari bukan operator `/` (terlalu banyak) melainkan
// keberadaan penjaganya.
//
// Dicari PERSIS pada baris yang mendefinisikan penjaganya (`const bisaX = …`),
// bukan "di mana saja dalam berkas". Versi pertama aturan ini hanya mencari
// polanya, dan sabotase yang melumpuhkan `bisaPorsi` tetap lolos — karena pola
// yang sama masih ada di `susunVariabel()` beberapa puluh baris di atasnya.
const PENJAGA = [
  { pola: /const\s+cmSehat\s*=\s*cmRasio\s*!=\s*null\s*&&\s*cmRasio\s*>\s*0/, apa: 'CM% (pembagi BEP & target)' },
  { pola: /const\s+bisaPorsi\s*=\s*aspEfektif\s*!=\s*null\s*&&\s*aspEfektif\s*>\s*0/, apa: 'harga jual (pembagi porsi)' },
  { pola: /const\s+bisaHarian\s*=\s*hari\s*!=\s*null\s*&&\s*hari\s*>\s*0/, apa: 'hari operasional (pembagi harian)' }
];
for (const p of PENJAGA) {
  if (!p.pola.test(mesin)) {
    catat(
      `simulasi.js — penjaga pembagian untuk ${p.apa} tidak ada lagi.\n` +
        `    Tanpa penjaganya, isian nol menghasilkan Infinity yang diteruskan ke layar\n` +
        `    sebagai angka rupiah.`
    );
  }
}

// Porsi DAN omzet negatif harus sama-sama ditolak — dihitung, bukan sekadar
// dicari sekali. Sabotase yang melumpuhkan hanya salah satunya sempat lolos
// karena kalimat penolakannya masih ada di cabang yang satunya.
const jumlahTolakNegatif = (mesin.match(/tidak boleh negatif/gi) ?? []).length;
if (jumlahTolakNegatif < 2) {
  catat(
    `simulasi.js — hanya ${jumlahTolakNegatif} dari 2 penolakan nilai negatif yang tersisa.\n` +
      `    Porsi DAN omzet negatif keduanya harus ditolak. Keduanya bukan "penjualan\n` +
      `    terbalik"; keduanya salah ketik, dan meneruskannya menghasilkan rugi besar\n` +
      `    yang tidak ada apa-apa di baliknya.`
  );
}

// =====================================================================
// 9. KONSOLIDASI BUKAN BEP GABUNGAN
// =====================================================================
const tubuhRingkas = tubuhFungsi(mesin, 'ringkasSimulasi');
if (tubuhRingkas) {
  for (const jejak of ['cmRasio', 'cmPersen', 'variabelPersen', 'fixedBulanan', 'bep\\.']) {
    if (new RegExp(jejak).test(tubuhRingkas)) {
      catat(
        `simulasi.js — ringkasSimulasi() menyentuh "${jejak.replace('\\', '')}".\n` +
          `    Penjumlahan tidak memerlukan margin maupun biaya tetap. Kehadirannya berarti\n` +
          `    ada BEP gabungan yang dihitung dari angka rata-rata — dan itu menyembunyikan\n` +
          `    outlet bermargin tipis di balik yang tebal, dengan arah galat yang tak tertebak.`
      );
    }
  }
  if (!/SUM OF OUTLET SIMULATIONS/.test(tubuhRingkas)) {
    catat(`simulasi.js — ringkasSimulasi() tidak lagi memberi label "SUM OF OUTLET SIMULATIONS".`);
  }
  if (!/bepGabungan:\s*false/.test(tubuhRingkas)) {
    catat(`simulasi.js — ringkasSimulasi() tidak lagi menyatakan bepGabungan: false di dalam datanya.`);
  }
}

// =====================================================================
// 10. LAYAR MENANDAI DIRINYA
// =====================================================================
if (!/tanda-konteks[^<]*>\s*SIMULATION/.test(layar)) {
  catat(
    `simulasi.owner.js — penanda konteksnya tidak bertuliskan SIMULATION.\n` +
      `    Angka karangan yang rapi lebih meyakinkan daripada kenyataan yang berantakan.\n` +
      `    Tanpa label, laba hasil asumsi lima menit lalu terlihat seperti laba yang\n` +
      `    sudah masuk rekening.`
  );
}

// Kolom baseline pun harus berlabel: ia bukan angka aktual, melainkan ekonomi
// apa adanya yang dijalankan lewat mesin simulasi.
if (!/Baseline \$\{TANDA\}/.test(layar)) {
  catat(
    `simulasi.owner.js — kolom Baseline tidak berlabel SIMULATION.\n` +
      `    Baseline BUKAN angka Actual — ia hasil mesin simulasi dengan ekonomi apa adanya.\n` +
      `    Melabelinya ACTUAL, atau membiarkannya polos, membuat kolom kiri terbaca\n` +
      `    sebagai kenyataan yang sudah terjadi.`
  );
}

// Kotak kosong tidak boleh jadi 0 — `Number('')` adalah 0, dan Variable Cost 0%
// berarti CM 100%: simulasi jauh lebih indah daripada yang sebenarnya.
if (!/===\s*''\s*\?\s*null\s*:/.test(layar)) {
  catat(
    `simulasi.owner.js — kotak kosong tidak lagi diubah jadi null.\n` +
      `    Number('') adalah 0. Variable Cost 0% berarti CM 100%, dan ASP 0 menghasilkan\n` +
      `    pembagian dengan nol.`
  );
}

// =====================================================================
// 11. SIMULASI TIDAK BOCOR KE LAYAR LAIN
// =====================================================================
for (const nama of ['actual.owner.js', 'proyeksi.owner.js', 'target.owner.js', 'ringkasan.owner.js']) {
  const jalan = path.join(DIR, nama);
  if (!fs.existsSync(jalan)) {
    catat(`${nama} tidak ditemukan — daftar layar di audit ini sudah basi.`);
    continue;
  }
  const src = tanpaKomentar(fs.readFileSync(jalan, 'utf8'));
  const pola = /from\s+'\.\/simulasi\.js'/;
  if (pola.test(src)) {
    catat(
      `${nama}:${barisKe(src, pola)} — mengimpor simulasi.js.\n` +
        `    Angka simulasi di layar Actual, Proyeksi, atau Target akan terbaca sebagai\n` +
        `    kenyataan, perkiraan, atau tuntutan. Simulasi hanya boleh tampil di layarnya.`
    );
  }
}

if (masalah.length) {
  console.error('❌ Simulasi berpotensi mengubah data atau menyamar jadi konteks lain:\n');
  for (const p of masalah) console.error(`  ${p}\n`);
  process.exit(1);
}

console.log('Simulasi: kotak pasir, tidak menulis, konteksnya melekat, konsolidasinya penjumlahan. ✅');
