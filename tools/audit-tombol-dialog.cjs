#!/usr/bin/env node
/**
 * AUDIT: tombol di dalam infoDialog harus dipasang lewat `onReady`.
 *
 * ============ BUG YANG DICEGAH ============
 *
 * `infoDialog()` mengembalikan Promise yang selesai ketika dialognya DITUTUP.
 * Jadi pola ini terlihat benar tapi tidak pernah bekerja:
 *
 *     await infoDialog({ bodyHtml: '<button id="unduh">Unduh</button>' });
 *     document.getElementById('unduh').addEventListener('click', ...);   // ← mati
 *
 * Listener-nya dipasang setelah dialognya ditutup — ke elemen yang sedang
 * dibuang. Yang bikin ini lolos: `getElementById` MASIH menemukan elemennya
 * (overlay baru dihapus 200 ms kemudian), jadi tidak ada error, tidak ada
 * null, tidak ada apa pun di console. Tombolnya tampak normal dan tidak
 * melakukan apa-apa selamanya.
 *
 * Persis ini yang terjadi pada tombol "⬇ Unduh Excel" di dialog rincian Stok
 * Opname: tersedia di layar sejak dibuat, tidak pernah bisa mengunduh.
 *
 * ============ ATURANNYA ============
 *
 * Kalau `bodyHtml` sebuah `infoDialog` memuat elemen interaktif (<button>,
 * <input>, <select>, <textarea>, atau [onclick]), panggilan itu WAJIB punya
 * `onReady` — satu-satunya tempat yang dijalankan selagi dialognya hidup.
 */

const fs = require('fs');
const path = require('path');

const AKAR = path.join(__dirname, '..', 'js');
const INTERAKTIF = /<(button|input|select|textarea)\b/i;

/** Kumpulkan semua .js di bawah dir. */
function berkasJs(dir, hasil = []) {
  for (const nama of fs.readdirSync(dir)) {
    const p = path.join(dir, nama);
    const st = fs.statSync(p);
    if (st.isDirectory()) berkasJs(p, hasil);
    else if (nama.endsWith('.js')) hasil.push(p);
  }
  return hasil;
}

/**
 * Ambil isi argumen `infoDialog(...)` dengan menghitung kurung.
 *
 * Pakai pemindai karakter, bukan regex: `bodyHtml` penuh template literal
 * berisi `{`, `}`, `(`, `)` dan tanda kutip. Regex apa pun akan berhenti di
 * tempat yang salah dan menghasilkan temuan palsu — yang jauh lebih buruk
 * daripada tidak mengaudit sama sekali, karena orang belajar mengabaikannya.
 */
function petikPanggilan(teks, mulai) {
  let i = mulai;
  let dalam = 0;
  let kutip = null;
  let lolos = false;
  for (; i < teks.length; i++) {
    const c = teks[i];
    if (lolos) {
      lolos = false;
      continue;
    }
    if (c === '\\') {
      lolos = true;
      continue;
    }
    if (kutip) {
      if (c === kutip) kutip = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      kutip = c;
      continue;
    }
    if (c === '(') dalam++;
    else if (c === ')') {
      dalam--;
      if (dalam === 0) return teks.slice(mulai, i + 1);
    }
  }
  return null;
}

/**
 * Buang komentar, tapi jangan sentuh isi string/template literal.
 *
 * WAJIB dilakukan sebelum mencari `onReady`. Tanpa ini, satu baris komentar
 * yang menjelaskan "dipasang lewat onReady" sudah cukup membuat audit ini
 * menyatakan lulus — dan komentar seperti itu justru paling mungkin ada di
 * tempat yang pernah salah. Sabotase pertama pada audit ini lolos persis
 * karena lubang tersebut.
 */
function tanpaKomentar(teks) {
  let out = '';
  let kutip = null;
  for (let i = 0; i < teks.length; i++) {
    const c = teks[i];
    const d = teks[i + 1];
    if (kutip) {
      if (c === '\\') {
        out += c + (d ?? '');
        i++;
        continue;
      }
      if (c === kutip) kutip = null;
      out += c;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      kutip = c;
      out += c;
      continue;
    }
    if (c === '/' && d === '/') {
      while (i < teks.length && teks[i] !== '\n') i++;
      out += '\n';
      continue;
    }
    if (c === '/' && d === '*') {
      i += 2;
      while (i < teks.length && !(teks[i] === '*' && teks[i + 1] === '/')) i++;
      i++;
      out += ' ';
      continue;
    }
    out += c;
  }
  return out;
}

const temuan = [];
let diperiksa = 0;

for (const berkas of berbagi()) {
  const teks = fs.readFileSync(berkas, 'utf8');
  const rel = path.relative(path.join(__dirname, '..'), berkas).replace(/\\/g, '/');

  // File yang MENDEFINISIKAN infoDialog tidak diaudit.
  if (rel.endsWith('core/ui.js')) continue;

  let idx = 0;
  while ((idx = teks.indexOf('infoDialog(', idx)) !== -1) {
    const buka = teks.indexOf('(', idx);
    const mentah = petikPanggilan(teks, buka);
    idx = buka + 1;
    if (!mentah) continue;
    diperiksa++;

    const isi = tanpaKomentar(mentah);
    if (!INTERAKTIF.test(isi)) continue; // dialog baca-saja, tidak masalah
    // Dicari sebagai NAMA PROPERTI (`onReady:`), bukan sekadar kata. Menyebut
    // namanya tidak sama dengan memakainya.
    if (/(^|[,{(\s])onReady\s*:/.test(isi)) continue;

    const baris = teks.slice(0, idx).split('\n').length;
    const jenis = isi.match(INTERAKTIF)?.[1] ?? 'elemen';
    temuan.push(`${rel}:${baris} — infoDialog memuat <${jenis}> tapi tidak punya onReady`);
  }
}

function berbagi() {
  return berkasJs(AKAR);
}

if (temuan.length) {
  console.error('❌ Tombol di dalam infoDialog yang tidak mungkin bisa ditekan:\n');
  for (const t of temuan) console.error('   ' + t);
  console.error(
    '\nPasang listener-nya lewat onReady(body):\n' +
      "   infoDialog({ bodyHtml: '…', onReady: (body) => body.querySelector('#x').addEventListener(…) })\n" +
      'Memasangnya setelah `await` tidak akan pernah bekerja — dialognya sudah ditutup.'
  );
  process.exit(1);
}

console.log(`${diperiksa} pemanggilan infoDialog diperiksa. Setiap dialog berisi tombol memasangnya lewat onReady. ✅`);
