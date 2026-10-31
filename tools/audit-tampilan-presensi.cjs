/**
 * AUDIT: tampilan presensi & bilah bawah mobile.
 *
 * ============ UI YANG RUSAK TIDAK MELEMPAR GALAT ============
 *
 * Tidak satu pun hal di bawah ini memunculkan error. Semuanya berakhir sebagai
 * layar yang terlihat "agak beda" — dan yang memakainya menyesuaikan diri
 * tanpa pernah melaporkannya:
 *
 *   warna kalah kekhususan      -> kartu presensi kembali putih semua, dan
 *                                  keadaan yang berbeda terlihat sama
 *   dua layar punya aturan
 *     warnanya sendiri          -> Beranda dan modulnya mewarnai keadaan yang
 *                                  sama dengan warna berbeda
 *   bunyi dipanggil SEBELUM
 *     tersimpan                 -> terdengar "berhasil" padahal unggahannya
 *                                  gagal sedetik kemudian
 *   bilah bawah tanpa ruang     -> baris terakhir tabel berada di baliknya,
 *                                  dan terbaca seperti "datanya habis"
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

/** JS tanpa komentarnya — komentar di repo ini mengutip kode yang dijaganya. */
const bacaKode = (rel) => {
  const asli = baca(rel);
  if (!asli) return null;
  const kode = tanpaKomentar(asli);
  const pesan = periksaKewarasan(asli, kode, ['bunyiPresensi', 'att-state-', 'mobile-footer']);
  if (pesan) {
    salah(`${rel}: ${pesan} — audit ini tidak bisa dipercaya untuk berkas itu.`);
    return null;
  }
  return kode;
};

const CSS = 'css/styles.css';
const RUPA = 'js/modules/attendance/tampilan-presensi.js';
const SUARA = 'js/core/suara-presensi.js';
const SHELL = 'js/main-staff.js';
const PAGE = 'js/modules/attendance/attendance.page.js';
const KAS = 'js/modules/cash/cash.page.js';
const TES = 'tools/test-tampilan-presensi.mjs';

// =====================================================================
// 1. CSS
// =====================================================================
const css = baca(CSS);
if (css) {
  // ============ YANG DICARI BLOK YANG MENDEFINISIKAN WARNANYA ============
  //
  // `css.includes('.att-state-bekerja')` cocok juga dengan
  // `.att-state-bekerja-mati` DAN dengan `.att-mini.att-state-bekerja` yang
  // cuma MEMAKAI warnanya. Jadi kelasnya bisa diganti nama — sehingga tidak
  // ada yang mendefinisikan `--att-bg` lagi — dan auditnya tetap hijau.
  // Sabotasenya yang menunjukkan itu.
  // Komentar CSS dibuang dulu: tanpa itu, teks komentar di atas sebuah aturan
  // ikut terbawa sebagai bagian selektornya, dan perbandingan persisnya selalu
  // gagal — audit yang merah pada kode yang benar akan dimatikan orang.
  const cssBersih = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const blokWarna = [...cssBersih.matchAll(/([^{}]+)\{([^}]*)\}/g)]
    .filter((m) => /--att-bg\s*:/.test(m[2]) && /--att-fg\s*:/.test(m[2]))
    .flatMap((m) => m[1].split(',').map((x) => x.trim()));
  for (const k of ['att-state-belum', 'att-state-bekerja', 'att-state-istirahat', 'att-state-selesai']) {
    if (!blokWarna.includes(`.${k}`)) {
      salah(`${CSS}: tidak ada blok yang mendefinisikan --att-bg/--att-fg untuk \`.${k}\`.`);
    }
  }

  // ============ TOMBOL BERWARNA HARUS DIKECUALIKAN ============
  //
  // Aturan tombol sekunder memakai daftar `:not()` yang panjang, dan tiap
  // `:not(.x)` MENAIKKAN kekhususannya — sampai ia mengalahkan aturan `.kelas`
  // tunggal yang ditulis belakangan. Kartu presensi & tombol istirahat sempat
  // tidak berwarna sama sekali karena itu, tanpa satu pun galat.
  const iTombol = css.indexOf('.staff-main button:not(.primary)');
  const barisTombol = iTombol >= 0 ? css.slice(iTombol, css.indexOf('{', iTombol)) : '';
  for (const kelas of ['att-mini', 'btn-att-break']) {
    if (!barisTombol.includes(`:not(.${kelas})`)) {
      salah(
        `${CSS}: \`.${kelas}\` tidak dikecualikan dari aturan tombol sekunder. ` +
          'Kekhususan daftar `:not()` mengalahkan warnanya sendiri, dan tombolnya kembali putih tanpa galat.'
      );
    }
  }

  for (const b of ['btn-att-in', 'btn-att-out', 'btn-att-break', 'btn-att-back']) {
    if (!css.includes(`.${b} {`) && !css.includes(`.${b},`)) salah(`${CSS}: tombol \`${b}\` tidak punya warnanya sendiri.`);
  }
  // Empat tombol dengan warna yang sama = tidak ada yang dibedakan.
  const warna = ['btn-att-in', 'btn-att-out', 'btn-att-break', 'btn-att-back'].map((b) => {
    const m = new RegExp(`\\.${b} \\{ background: (#[0-9a-f]{6})`).exec(css);
    return m ? m[1] : b;
  });
  if (new Set(warna).size !== 4) {
    salah(`${CSS}: tombol presensi tidak berbeda warnanya satu sama lain — ${warna.join(', ')}`);
  }

  if (!/\.mobile-footer/.test(css)) salah(`${CSS}: bilah bawah tidak punya gaya.`);
  // Fixed = MENUTUPI konten. Tanpa ruang bawah, baris terakhir tabel mana pun
  // berada di baliknya dan terbaca seperti "datanya habis".
  if (!/\.staff-main \{\s*padding-bottom:/.test(css)) {
    salah(`${CSS}: \`.staff-main\` tidak diberi ruang bawah — bilah bawah akan menutupi baris terakhir.`);
  }
  if (!/env\(safe-area-inset-bottom/.test(css)) {
    salah(`${CSS}: lekukan layar iPhone tidak diperhitungkan — tombolnya tertimpa garis gestur.`);
  }
  // Di desktop tombolnya tetap di header; dua tempat untuk satu tombol membuat
  // orang ragu keduanya mengerjakan hal yang sama.
  if (!/#btn-home-top,\s*\n?\s*\.staff-topbar #btn-profile \{\s*\n?\s*display: none/.test(css)) {
    salah(`${CSS}: tombol Beranda/Profil di header tidak disembunyikan saat bilah bawah muncul.`);
  }
}

// =====================================================================
// 2. Satu sumber rupa untuk DUA layar
// =====================================================================
const rupa = bacaKode(RUPA);
if (rupa) {
  if (!/export function keadaanPresensi/.test(rupa)) salah(`${RUPA}: \`keadaanPresensi\` tidak ada.`);
  // Clock out diperiksa SEBELUM istirahat; warnanya sama (kuning), jadi
  // kekeliruan urutannya tidak akan terlihat sebagai kekeliruan.
  const iOut = rupa.indexOf('clock_out_at');
  const iIstirahat = rupa.indexOf('istirahatBerjalan)');
  if (iOut < 0 || iIstirahat < 0 || iOut > iIstirahat) {
    salah(`${RUPA}: istirahat diperiksa sebelum clock out — yang sudah pulang akan terlihat "sedang istirahat".`);
  }
  if (!/TAMPILAN\[keadaan\] \?\? TAMPILAN\.belum/.test(rupa)) {
    salah(
      `${RUPA}: cadangan keadaan tak dikenal bukan "belum". Jatuh ke "bekerja" membuat orang pulang tanpa merasa perlu menekan apa pun.`
    );
  }
}

const shell = bacaKode(SHELL);
const page = bacaKode(PAGE);
for (const [rel, isi] of [
  [SHELL, shell],
  [PAGE, page]
]) {
  if (!isi) continue;
  // KEDUANYA wajib lewat modul yang sama. Yang menulis kelasnya sendiri akan
  // menyimpang, dan penyimpangannya cuma terlihat kalau dua layar dibuka
  // berdampingan — yang tidak pernah terjadi di HP.
  if (!/tampilanPresensi\(/.test(isi)) {
    salah(`${rel}: tidak memakai \`tampilanPresensi\` — warnanya akan menyimpang dari layar satunya.`);
  }
  if (/att-state-bekerja['"\s]*\+|class="att-state-/.test(isi)) {
    salah(`${rel}: menulis kelas keadaan secara langsung alih-alih memakai \`rupa.kelas\`.`);
  }
}

// =====================================================================
// 3. Bunyi — sesudah tersimpan, dan tidak pernah menggagalkan apa pun
// =====================================================================
const suara = bacaKode(SUARA);
if (suara) {
  if (!/catch\s*\{/.test(suara)) {
    salah(`${SUARA}: galat audio tidak ditelan. Presensi yang sah bisa gagal hanya karena perangkatnya tidak bisa berbunyi.`);
  }
  if (!fs.existsSync(path.join(AKAR, TES))) salah(`${TES} tidak ada — pola nadanya tidak dibuktikan di mana pun.`);
}

if (page) {
  // Bunyi pada ketukan terdengar seperti "berhasil" padahal unggahannya bisa
  // gagal sedetik kemudian — dan bunyi itulah yang dipercaya orang yang
  // sedang berjalan.
  for (const [aksi, panggil] of [
    ['clockIn(', "bunyiUntuk('clock_in')"],
    ['clockOut(', "bunyiUntuk('clock_out')"]
  ]) {
    const iAksi = page.indexOf(aksi);
    const iBunyi = page.indexOf(panggil);
    if (iAksi < 0 || iBunyi < 0) {
      salah(`${PAGE}: ${panggil} tidak dipanggil sama sekali.`);
    } else if (iBunyi < iAksi) {
      salah(`${PAGE}: ${panggil} dibunyikan SEBELUM ${aksi} selesai — terdengar berhasil padahal belum tersimpan.`);
    }
  }
}

// =====================================================================
// 4. Bilah bawah: satu penanganan, dan tinggi yang diperhitungkan
// =====================================================================
if (shell) {
  if (!/id="mobile-footer"/.test(shell)) salah(`${SHELL}: bilah bawah tidak digambar.`);
  if (!/const keBeranda = /.test(shell) || !/const keProfil = /.test(shell)) {
    salah(`${SHELL}: penanganan tombol header & bilah bawah tidak dipakai bersama — keduanya akan menyimpang.`);
  }
  for (const id of ['mf-home', 'mf-profile']) {
    if (!new RegExp(`getElementById\\('${id}'\\)\\.addEventListener`).test(shell)) {
      salah(`${SHELL}: tombol \`${id}\` tidak dipasangi penangan klik.`);
    }
  }
  if (!/tandaiFooter\(''\)/.test(shell)) {
    salah(`${SHELL}: sorotan bilah tidak dibersihkan saat modul dibuka — bilahnya berbohong tentang di mana orangnya berada.`);
  }
}

const kas = bacaKode(KAS);
if (kas && !/mobile-footer/.test(kas)) {
  salah(
    `${KAS}: tinggi riwayat kas tidak mengurangi bilah bawah. ` +
      'Bilahnya `fixed`, jadi `window.innerHeight` tidak berkurang — beberapa baris terakhir berada di baliknya.'
  );
}

console.log('');
if (gagal === 0) console.log('Audit tampilan presensi & bilah bawah bersih. ✅');
else console.error(`${gagal} masalah ditemukan.`);
process.exit(gagal === 0 ? 0 : 1);
