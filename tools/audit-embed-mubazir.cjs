#!/usr/bin/env node
/**
 * AUDIT: embed beralias yang tidak pernah dibaca di layar mana pun.
 *
 * ============ KENAPA INI PENTING ============
 *
 * Biasanya "mengambil kolom yang tidak dipakai" cuma mubazir. Di PostgREST ia
 * lebih dari itu: **embed yang gagal membatalkan SELURUH permintaan.** Bukan
 * kolomnya yang kosong — seluruh daftarnya hilang.
 *
 * Yang benar-benar terjadi: `riwayatNota()` meminta
 * `pembuat:user_profiles!created_by(full_name)`, dan nama itu **tidak pernah
 * digambar di layar mana pun**. Ketika FK-nya ternyata salah menunjuk
 * `auth.users` (lihat 0086), layar "Terima dari Supplier" di Staff App mati
 * total — karena satu kolom yang tidak dipakai siapa pun.
 *
 * Setiap embed adalah satu cara tambahan untuk gagal. Yang tidak digambar
 * seharusnya tidak diminta.
 *
 * ============ YANG DIPERIKSA ============
 *
 * Hanya embed BERALIAS (`alias:tabel!kolom(...)`), karena aliasnya yang
 * menjadi nama properti di hasil. Embed tanpa alias (`products(name)`) diakses
 * lewat nama tabelnya, yang terlalu umum untuk dilacak dengan andal — dan
 * audit yang menebak-nebak lebih buruk daripada tidak ada, karena orang
 * belajar mengabaikannya.
 *
 * ============ BATASNYA, DIAKUI TERUS TERANG ============
 *
 * "Dipakai" dicari di SELURUH js/, bukan hanya di berkas yang memakai
 * service-nya. Akibatnya **nama alias yang sama di modul lain akan menutupi
 * temuan di sini**: `pembuat` juga dipakai dokumen Dispatch, jadi `pembuat`
 * yang mubazir di modul Nota tidak akan tertangkap. Sabotase membuktikan ini,
 * dan dicatat alih-alih ditutupi.
 *
 * Versi berbasis grafik import sempat dicoba supaya lebih presisi, lalu
 * dibuang: modul pembantu seperti `dokumen.js` menerima datanya lewat
 * PARAMETER, bukan lewat import, sehingga ia menghasilkan tiga temuan palsu
 * pada kode yang benar. Audit yang berteriak pada kode benar akan diabaikan,
 * dan audit yang diabaikan sama dengan tidak ada.
 *
 * Jadi berkas ini menangkap sebagian, bukan semuanya. Cara paling murah
 * menutup sisanya: JANGAN pakai nama alias yang sama di dua modul berbeda.
 */

const fs = require('fs');
const path = require('path');

const AKAR = path.join(__dirname, '..');
const DIR_JS = path.join(AKAR, 'js');
const DIR_SQL = path.join(AKAR, 'supabase', 'migrations');

/**
 * Nama tabel sungguhan, dibaca dari migration.
 *
 * Ini penyaring yang menentukan. Tanpa syarat "tabelnya harus ada di skema",
 * pola `alias:nama(` juga cocok dengan hal-hal yang sama sekali bukan embed —
 * `background:var(--color-x)` di dalam string CSS, atau `kategoriOpsi:
 * daftarKategori(...)` di dalam template literal. Audit yang menyalakan alarm
 * untuk hal-hal itu akan cepat diabaikan, dan audit yang diabaikan sama saja
 * dengan tidak ada.
 */
const TABEL = new Set();
if (fs.existsSync(DIR_SQL)) {
  for (const nama of fs.readdirSync(DIR_SQL)) {
    if (!nama.endsWith('.sql')) continue;
    const sql = fs.readFileSync(path.join(DIR_SQL, nama), 'utf8');
    for (const m of sql.matchAll(/create\s+(?:table|view|materialized\s+view)\s+(?:if\s+not\s+exists\s+)?(?:public\.)?(\w+)/gi)) {
      TABEL.add(m[1].toLowerCase());
    }
  }
}

function berkasJs(dir, hasil = []) {
  for (const nama of fs.readdirSync(dir)) {
    const p = path.join(dir, nama);
    if (fs.statSync(p).isDirectory()) berkasJs(p, hasil);
    else if (nama.endsWith('.js')) hasil.push(p);
  }
  return hasil;
}

const semua = berkasJs(DIR_JS);
const isi = new Map(semua.map((p) => [p, fs.readFileSync(p, 'utf8')]));

const gabungan = [...isi.values()].join('\n');

/**
 * Petik semua STRING LITERAL beserta posisi awalnya.
 *
 * Embed dicari di dalam string, BUKAN dari kedekatannya dengan `.select(`.
 *
 * Versi pertama audit ini memakai kedekatan — "ada `.select(` dalam 600
 * karakter sebelumnya" — dan langsung punya titik buta: begitu daftar
 * kolomnya disusun di variabel terpisah (`const kolom = '…' + (…)`), embednya
 * tidak lagi dekat dengan `.select(` dan **tidak terlihat sama sekali**.
 * Sabotase menemukannya: menghapus kolom "Diinput" tidak membuat auditnya
 * merah, karena embed `pembuat` memang sudah tidak pernah diperiksa.
 *
 * Ironisnya justru kode yang baru saja diperbaiki yang membuka titik buta itu.
 * Audit yang bergantung pada bentuk penulisan akan selalu begitu.
 */
function stringLiteral(teks) {
  const hasil = [];
  let i = 0;
  while (i < teks.length) {
    const c = teks[i];
    // Lewati komentar supaya contoh di dalamnya tidak ikut terbaca.
    if (c === '/' && teks[i + 1] === '/') {
      while (i < teks.length && teks[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && teks[i + 1] === '*') {
      i += 2;
      while (i < teks.length && !(teks[i] === '*' && teks[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const mulai = i;
      i++;
      while (i < teks.length) {
        if (teks[i] === '\\') {
          i += 2;
          continue;
        }
        if (teks[i] === c) break;
        i++;
      }
      hasil.push({ mulai: mulai + 1, teks: teks.slice(mulai + 1, i) });
      i++;
      continue;
    }
    i++;
  }
  return hasil;
}

const temuan = [];
let diperiksa = 0;

for (const [p, teks] of isi) {
  const rel = path.relative(AKAR, p).replace(/\\/g, '/');

  for (const { mulai, teks: s } of stringLiteral(teks)) {
    // `alias:tabel!kolom(` atau `alias:tabel(`
    for (const m of s.matchAll(/(?<![\w.])([a-z][a-zA-Z0-9_]*)\s*:\s*(\w+)(?:!\w+)?\s*\(/g)) {
      const alias = m[1];
      const tabel = m[2];
      // Tabelnya harus benar-benar ada. Lihat catatan pada TABEL di atas.
      if (!TABEL.has(tabel.toLowerCase())) continue;
      diperiksa++;

      // Dipakai kalau aliasnya muncul sebagai PEMBACAAN properti di mana pun:
      // `.alias`, `?.alias`, `['alias']`, atau destructuring `{ alias }=`.
      const pola = new RegExp(`(\\??\\.\\s*${alias}\\b)|(\\[\\s*['"]${alias}['"]\\s*\\])|(\\{[^}\\n]*\\b${alias}\\b[^}\\n]*\\}\\s*=)`);
      if (pola.test(gabungan)) continue;

      const baris = teks.slice(0, mulai + m.index).split('\n').length;
      temuan.push(`${rel}:${baris} — embed '${alias}:${tabel}' diminta tapi '${alias}' tidak pernah dibaca di js/`);
    }
  }
}

if (temuan.length) {
  console.error('❌ Embed yang diambil tapi tidak pernah dipakai:\n');
  for (const t of temuan) console.error('   ' + t);
  console.error(
    '\nDi PostgREST, embed yang gagal membatalkan SELURUH query — bukan cuma kolomnya.\n' +
      'Jadi embed yang tidak digambar bukan sekadar mubazir; ia menambah cara untuk gagal.\n' +
      'Hapus, atau tampilkan datanya. Kalau memang perlu diambil bersyarat, jadikan\n' +
      'parameter seperti `denganPembuat` di riwayatNota().'
  );
  process.exit(1);
}

console.log(`${diperiksa} embed beralias diperiksa. Semuanya benar-benar dibaca di layar. ✅`);
