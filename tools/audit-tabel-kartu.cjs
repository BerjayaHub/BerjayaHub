/**
 * Menjaga tabel tetap terbaca di layar sempit.
 *
 * ============ YANG BERUBAH, DAN KENAPA AUDIT INI IKUT BERUBAH ============
 *
 * Dulu mode kartu OPT-IN: tiap tabel menuliskan `kartu-sempit` sendiri, dan
 * tiap sel menuliskan `data-label` sendiri. Audit ini menjaga agar tidak ada
 * sel yang lupa dilabeli.
 *
 * Penjagaan itu bekerja untuk tabel yang ikut, tapi ia sama sekali tidak bisa
 * melihat masalah yang lebih besar: **57 dari 86 tabel tidak pernah ikut sama
 * sekali**. Audit yang hanya memeriksa yang sudah mendaftar akan selamanya
 * hijau sementara dua pertiga aplikasinya tidak terbaca di ponsel — dan
 * hijaunya justru meyakinkan.
 *
 * Sekarang mode kartu dan pengisian label dikerjakan `js/core/tabel-responsif.js`
 * untuk SEMUA tabel, saat halamannya berjalan. Maka yang perlu dijaga bergeser:
 *
 *   1. Pengurusnya benar-benar dipasang di setiap halaman yang punya tabel.
 *      Kalau satu halaman lupa memanggilnya, seluruh tabel di halaman itu
 *      kembali jadi tabel yang harus digeser ke samping — dan tidak ada error
 *      apa pun, karena di layar lebar semuanya tampak normal.
 *
 *   2. `tabel-tetap` (penolakan mode kartu) harus disertai alasan tertulis.
 *      Pengecualian tanpa alasan tidak bisa dibedakan dari kelalaian setahun
 *      lagi — aturan yang sama sudah dipakai `audit-ambil-terpotong.cjs`.
 *
 * ============ YANG SENGAJA TIDAK LAGI DIPERIKSA ============
 *
 * Versi pertama penulisan ulang ini juga menuntut: berkas yang sudah memakai
 * `data-label` di satu tempat harus memakainya di SEMUA `<td>`-nya. Aturan itu
 * langsung menemukan 19 pelanggaran di `cleaning.admin.page.js` — dan setelah
 * diperiksa, tidak satu pun dari sembilan belas itu masalah.
 *
 * Yang keliru aturannya, bukan kodenya. Pengurus otomatis mengisi sel yang
 * kosong dari judul kolomnya, jadi tabel yang sebagian selnya dilabeli tangan
 * dan sisanya dibiarkan tetap menghasilkan kartu yang benar seluruhnya. Yang
 * dulu berbahaya — sel telanjang di tengah kartu berlabel — sudah tidak
 * mungkin terjadi lagi.
 *
 * Aturan itu DIBUANG, bukan dilonggarkan atau diberi daftar pengecualian.
 * Audit yang menyala untuk hal yang bukan masalah akan diabaikan, dan sesudah
 * itu ia tidak berguna justru saat menemukan yang sungguhan.
 */

const fs = require('fs');
const path = require('path');

const AKAR = path.join(__dirname, '..');
const DIR_JS = path.join(AKAR, 'js');

function berkasJs(dir, keluar = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) berkasJs(p, keluar);
    else if (e.name.endsWith('.js')) keluar.push(p);
  }
  return keluar;
}

const masalah = [];

// =====================================================================
// (1) PENGURUSNYA DIPASANG DI SETIAP HALAMAN YANG PUNYA TABEL
//
// Halaman ditemukan dari berkas HTML-nya sendiri, bukan dari daftar nama —
// halaman kelima yang ditambahkan tahun depan otomatis ikut diperiksa.
// =====================================================================
const halaman = fs.readdirSync(AKAR).filter((f) => f.endsWith('.html'));
let halamanDiperiksa = 0;

for (const h of halaman) {
  const html = fs.readFileSync(path.join(AKAR, h), 'utf8');

  // Berkas masuk (entry) halaman ini.
  const masuk = [...html.matchAll(/<script[^>]*src=["']([^"']+\.js)["']/g)].map((m) => m[1]);
  if (!masuk.length) continue;

  // Apakah halaman ini benar-benar punya tabel? Ditelusuri dari berkas
  // masuknya sampai satu tingkat impor — cukup untuk membedakan halaman
  // beraplikasi penuh dari halaman publik seperti reservasi.
  const terjangkau = new Set();
  const antre = [...masuk];
  while (antre.length) {
    const rel = antre.pop();
    const jalan = path.join(AKAR, rel.replace(/^\.\//, ''));
    if (terjangkau.has(jalan) || !fs.existsSync(jalan)) continue;
    terjangkau.add(jalan);

    const src = fs.readFileSync(jalan, 'utf8');
    for (const m of src.matchAll(/from\s+['"](\.[^'"]+\.js)['"]/g)) {
      antre.push(path.join(path.dirname(rel), m[1]));
    }
  }

  const punyaTabel = [...terjangkau].some((f) => fs.readFileSync(f, 'utf8').includes('class="data-table'));
  if (!punyaTabel) continue;

  halamanDiperiksa++;

  // BERKAS YANG MENDEFINISIKANNYA DIKELUARKAN.
  //
  // Versi pertama pemeriksaan ini mencari `pasangTabelResponsif()` di SELURUH
  // berkas yang terjangkau — termasuk `core/tabel-responsif.js`, yang memuat
  // `export function pasangTabelResponsif()`. Pola itu cocok, jadi setiap
  // halaman yang sekadar MENGIMPOR modulnya dinyatakan lulus.
  //
  // Sabotase yang menghapus pemanggilan di `main-staff.js` lolos tanpa
  // suara. Ini kelas kesalahan yang sudah beberapa kali terjadi di repo ini:
  // audit yang hijau karena menemukan katanya di tempat yang salah.
  const dipasang = [...terjangkau]
    .filter((f) => !f.endsWith(path.join('core', 'tabel-responsif.js')))
    .some((f) => /pasangTabelResponsif\s*\(\s*\)/.test(fs.readFileSync(f, 'utf8')));
  if (!dipasang) {
    masalah.push(
      `${h} — punya tabel tapi tidak pernah memanggil pasangTabelResponsif().\n` +
        `    Semua tabel di halaman ini akan jadi tabel geser-samping di ponsel.\n` +
        `    Tidak ada error: di layar lebar semuanya tampak normal.`
    );
  }
}

if (halamanDiperiksa === 0) {
  // Keadaan sebaliknya juga harus berbunyi. Kalau penelusurannya rusak dan
  // tidak menemukan satu halaman pun, audit ini akan hijau selamanya tanpa
  // memeriksa apa-apa — kegagalan yang persis sama dengan yang mau dicegah.
  masalah.push('Tidak satu pun halaman ber-tabel ditemukan. Penelusuran impornya kemungkinan rusak.');
}

// =====================================================================
// (2) PENOLAKAN MODE KARTU HARUS BERALASAN
// =====================================================================
for (const berkas of berkasJs(DIR_JS)) {
  const src = fs.readFileSync(berkas, 'utf8');
  if (!src.includes('tabel-tetap')) continue;
  const rel = path.relative(AKAR, berkas);

  for (const m of src.matchAll(/tabel-tetap/g)) {
    if (rel.endsWith('core/tabel-responsif.js')) continue; // definisinya sendiri
    const mulai = src.lastIndexOf('\n', Math.max(0, m.index - 400));
    const sekitar = src.slice(Math.max(0, mulai), m.index);
    if (/\/\/|\/\*/.test(sekitar)) continue;

    const baris = src.slice(0, m.index).split('\n').length;
    masalah.push(
      `${rel}:${baris} — memakai "tabel-tetap" tanpa komentar alasan di dekatnya.\n` +
        `    Menolak mode kartu kadang benar, tapi setahun lagi tidak ada yang bisa\n` +
        `    membedakan penolakan yang disengaja dari yang tertinggal.`
    );
  }
}

if (masalah.length) {
  console.error('❌ Tabel berisiko tidak terbaca di layar sempit:\n');
  for (const p of masalah) console.error(`  ${p}\n`);
  process.exit(1);
}

console.log(`${halamanDiperiksa} halaman ber-tabel memasang pengurus responsif; penolakan mode kartu semuanya beralasan. ✅`);
