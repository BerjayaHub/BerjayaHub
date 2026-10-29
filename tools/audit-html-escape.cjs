#!/usr/bin/env node
/**
 * Audit: data dari database yang dirender ke HTML tanpa di-escape.
 *
 * Jalankan:  node tools/audit-html-escape.cjs
 *
 * KENAPA ADA:
 * Seluruh UI dibangun dengan template literal + innerHTML. Nama outlet/BU/produk
 * diketik manusia, jadi cepat atau lambat ada yang mengandung kutip atau tanda
 * kurung sudut. Nama seperti  Cafe "Awal" Bermula  akan MERUSAK dropdown kalau
 * disisipkan mentah — dan karena hanya muncul pada data tertentu, bug ini lolos
 * dari uji coba biasa.
 *
 * ATURANNYA: setiap ${x.name} / ${x.label} / ${x.code} dan sejenisnya yang masuk
 * ke HTML harus dibungkus esc() atau escapeHtml().
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', 'js');

function daftarFile(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) daftarFile(p, out);
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

// Bidang yang isinya teks bebas dari manusia.
const FIELDS = '(name|full_name|customer_name|notes|reason|exit_reason|label|title|plate_number|code)';
// Jalur propertinya boleh bersarang dan boleh memakai optional chaining, karena
// data dari PostgREST sering datang sebagai embed: r.user_profiles?.full_name.
// Versi lama regex ini hanya mengenali SATU tingkat (r.full_name) sehingga
// justru melewatkan bentuk yang paling sering dipakai di repo ini.
const JALUR = '[a-z]\\w*(?:\\s*\\??\\.\\s*\\w+)*';
// `g` dengan sengaja: TIAP interpolasi di satu baris diperiksa sendiri-sendiri.
//
// ============ KENAPA BUKAN "ADA esc() DI BARIS INI" ============
//
// Versi lama memeriksa seluruh BARIS. Satu baris yang memuat dua interpolasi —
// `${esc(r.name)}` dan `${r.notes}` — lolos utuh, karena kata "esc(" memang
// ada di situ. Hari ini kebetulan tidak ada baris seperti itu di repo; yang
// berbahaya adalah auditnya tetap hijau pada hari pertama ada. Pemeriksa yang
// benar hanya karena datanya kebetulan rapi bukan pemeriksa.
const POLA = new RegExp('\\$\\{[^}]*\\b' + JALUR + '\\s*\\??\\.\\s*' + FIELDS + '\\b[^}]*\\}', 'ig');
const TAG = /<(td|th|option|div|span|p|strong|h\d)\b/;
const SUDAH_AMAN = /esc\(|escapeHtml\(|escAttr\(|escapeAttr\(|getModuleIcon\(/;

// ============ PENGHASIL HTML YANG SUDAH MENG-ESCAPE SENDIRI ============
//
// Sebagian helper mengembalikan HTML jadi — tombol beserta teksnya — jadi
// membungkusnya `esc()` justru mencetak tag-nya sebagai teks. Tapi "nama
// fungsinya berakhiran Html" adalah lubang yang cukup lebar untuk dilewati apa
// saja: siapa pun bisa menamai fungsi barunya begitu dan audit ini diam.
//
// Jadi pengecualiannya: (1) disebut satu per satu, (2) terbatas pada berkas
// tempat ia didefinisikan, dan (3) ISI FUNGSINYA diperiksa dengan aturan yang
// sama persis. Kalau badannya memuat interpolasi tak ter-escape, pengecualian
// ini gugur dan tempat pemanggilannya ikut merah.
//
// DAN pengecekan di sini TIDAK CUKUP, dengan sadar: audit berbasis pola tidak
// bisa membuktikan sebuah fungsi meng-escape seluruh keluarannya — `esc(b.teks)`
// yang berubah jadi `b.teks` di tengah rantai `map().join()` tidak terlihat beda
// bagi regex mana pun. Pembuktiannya ada di `tools/test-keterangan-nota-html.mjs`,
// yang memasukkan keterangan bermuatan markup lalu memeriksa keluarannya.
// `tes` di bawah menyebutkan berkas itu, dan audit ini MENOLAK pengecualian
// yang tesnya sudah tidak ada.
const PENGHASIL_HTML_AMAN = [
  {
    fungsi: 'ketNotaHtml',
    file: 'js/modules/cash/keterangan-nota-html.js',
    dipakaiDi: ['js/modules/cash/cash.admin.page.js', 'js/modules/cash/cash.page.js'],
    tes: 'tools/test-keterangan-nota-html.mjs',
    alasan:
      'Mengembalikan tombol nota beserta teksnya; esc() di tempat pemanggilan akan mencetak <button> sebagai teks.'
  }
];

let masalah = 0;
const salah = (pesan) => {
  console.error(`✗ ${pesan}`);
  masalah++;
};

/** Badan fungsi `nama` di `isi`, dipotong dengan menghitung kurung kurawal. */
function badanFungsi(isi, nama) {
  const m = new RegExp(`function\\s+${nama}\\s*\\(`).exec(isi);
  if (!m) return null;
  const mulai = isi.indexOf('{', m.index);
  if (mulai < 0) return null;
  let dalam = 0;
  for (let i = mulai; i < isi.length; i++) {
    if (isi[i] === '{') dalam++;
    else if (isi[i] === '}' && --dalam === 0) return isi.slice(mulai, i + 1);
  }
  return null;
}

/** Interpolasi berisi data manusia yang TIDAK di-escape, per baris. */
function pelanggaran(baris, amanTambahan = null) {
  if (!TAG.test(baris)) return [];
  const aman = (x) => SUDAH_AMAN.test(x) || (amanTambahan && amanTambahan.test(x));
  return (baris.match(POLA) ?? []).filter((x) => !aman(x));
}

// ---- 1. Pengecualiannya dibuktikan dulu, sebelum dipakai ----
const amanPerFile = new Map();
for (const p of PENGHASIL_HTML_AMAN) {
  const abs = path.join(ROOT, '..', p.file);
  if (!fs.existsSync(abs)) {
    salah(`Pengecualian menunjuk berkas yang tidak ada: ${p.file} — pengecualian ini sudah berhenti menjaga apa pun.`);
    continue;
  }
  const isi = fs.readFileSync(abs, 'utf8');
  const badan = badanFungsi(isi, p.fungsi);
  if (!badan) {
    salah(`Pengecualian menunjuk fungsi yang tidak ada: ${p.fungsi}() di ${p.file}.`);
    continue;
  }
  // Aturan yang SAMA dijalankan pada badannya. Di dalam `ketHtml` sendiri tidak
  // ada pengecualian apa pun — ia harus benar-benar meng-escape.
  const bocor = badan.split('\n').flatMap((ln) => pelanggaran(ln));
  if (bocor.length) {
    salah(
      `${p.file}: ${p.fungsi}() didaftarkan sebagai penghasil HTML yang aman, ` +
        `tapi badannya meloloskan ${bocor[0].slice(0, 70)} tanpa esc(). Pengecualiannya gugur.`
    );
    continue;
  }
  // Tesnya harus ADA. Pengecualian yang tesnya terhapus adalah pengecualian
  // yang tidak pernah lagi dibuktikan — dan tidak ada yang akan menyadarinya,
  // karena auditnya tetap hijau.
  if (!fs.existsSync(path.join(ROOT, '..', p.tes))) {
    salah(
      `Pengecualian untuk ${p.fungsi}() menunjuk tes yang tidak ada: ${p.tes}. ` +
        'Audit ini tidak bisa membuktikan sendiri bahwa fungsinya meng-escape.'
    );
    continue;
  }

  const pola = new RegExp(`\\b${p.fungsi}\\s*\\(`);
  for (const f of [p.file, ...(p.dipakaiDi ?? [])]) {
    amanPerFile.set(f, amanPerFile.has(f) ? new RegExp(`${amanPerFile.get(f).source}|${pola.source}`) : pola);
  }
}

// ---- 2. Baru seluruh repo dipindai ----
for (const file of daftarFile(ROOT)) {
  const rel = path.relative(path.join(ROOT, '..'), file).split(path.sep).join('/');
  const tambahan = amanPerFile.get(rel) ?? null;
  fs.readFileSync(file, 'utf8')
    .split('\n')
    .forEach((ln, i) => {
      for (const bocor of pelanggaran(ln, tambahan)) {
        console.error(`✗ ${rel}:${i + 1}`);
        console.error(`  ${bocor.trim().slice(0, 110)}`);
        masalah++;
      }
    });
}

if (masalah) {
  console.error(`\n${masalah} tempat perlu dibungkus esc()/escapeHtml().`);
  process.exit(1);
}
console.log('Semua data dari database sudah di-escape sebelum masuk HTML. ✅');
