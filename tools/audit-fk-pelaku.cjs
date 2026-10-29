#!/usr/bin/env node
/**
 * AUDIT: setiap embed `user_profiles!kolom` harus punya FK ke user_profiles.
 *
 * ============ BUG YANG DICEGAH ============
 *
 *   Could not find a relationship between 'stock_counts' and 'user_profiles'
 *   in the schema cache
 *
 * PostgREST menyusun embed dari FOREIGN KEY yang benar-benar ada di database.
 * Kolom yang dideklarasikan begini:
 *
 *     opened_by uuid references auth.users(id)
 *
 * menyimpan nilai yang PERSIS SAMA dengan `user_profiles.id` (0001: profil
 * ber-primary-key `references auth.users(id)`), jadi datanya benar dan
 * kelihatan wajar di SQL Editor. Tapi relasi ke `user_profiles` tidak ada,
 * sehingga `user_profiles!opened_by(full_name)` ditolak.
 *
 * Dan penolakannya tidak sopan: SATU embed yang gagal membatalkan SELURUH
 * query. Bukan kolom nama yang kosong — seluruh daftarnya hilang. Tab Opname
 * di Admin Portal mati total karena ini.
 *
 * ============ KENAPA AUDIT LAIN TIDAK MENANGKAPNYA ============
 *
 * `audit-embed-ambigu` memastikan embed menyebut kolom FK-nya; embed yang
 * rusak ini MENYEBUTNYA dengan benar. `audit-kolom-tabel` memastikan kolomnya
 * ada di skema; kolomnya memang ada. Keduanya hijau untuk kode yang rusak.
 *
 * Yang tidak diperiksa siapa pun: apakah FK-nya menunjuk ke tabel yang
 * di-embed. Itu yang dikerjakan berkas ini.
 */

const fs = require('fs');
const path = require('path');
const { tanpaKomentar, periksaKewarasan } = require('./lib/tanpa-komentar.cjs');

const AKAR = path.join(__dirname, '..');
const DIR_JS = path.join(AKAR, 'js');
const DIR_SQL = path.join(AKAR, 'supabase', 'migrations');

function berkas(dir, akhiran, hasil = []) {
  if (!fs.existsSync(dir)) return hasil;
  for (const nama of fs.readdirSync(dir)) {
    const p = path.join(dir, nama);
    if (fs.statSync(p).isDirectory()) berkas(p, akhiran, hasil);
    else if (nama.endsWith(akhiran)) hasil.push(p);
  }
  return hasil;
}

// ---------------------------------------------------------
// 1. Kumpulkan FK ke user_profiles dari SELURUH migration.
//
// Dibaca dari gabungan semua file, berurutan, karena sebuah kolom bisa
// dibuat salah di satu migration lalu diperbaiki di migration berikutnya —
// persis yang terjadi pada 0084/0085 → 0086. Yang berlaku adalah pernyataan
// TERAKHIR, sama seperti di database sungguhan.
// ---------------------------------------------------------
const sql = berkas(DIR_SQL, '.sql')
  .sort()
  .map((p) => fs.readFileSync(p, 'utf8'))
  .join('\n');

/** `tabel.kolom` → 'user_profiles' | 'auth.users' */
const tujuanFk = new Map();

// Bentuk A: di dalam `create table <nama> ( ... kolom uuid references X ... )`
for (const m of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(\w+)\s*\(([\s\S]*?)\n\s*\);/gi)) {
  const tabel = m[1];
  for (const k of m[2].matchAll(/^\s*(\w+)\s+uuid[^,\n]*?references\s+([\w.]+)\s*\(id\)/gim)) {
    tujuanFk.set(`${tabel}.${k[1]}`, k[2].toLowerCase());
  }
}

// Bentuk B: `alter table T add column [if not exists] K uuid references X(id)`
for (const m of sql.matchAll(
  /alter\s+table\s+(\w+)\s+add\s+column\s+(?:if\s+not\s+exists\s+)?(\w+)\s+uuid[^;]*?references\s+([\w.]+)\s*\(id\)/gi
)) {
  tujuanFk.set(`${m[1]}.${m[2]}`, m[3].toLowerCase());
}

// Bentuk C: `alter table T add constraint ... foreign key (K) references X(id)`
for (const m of sql.matchAll(
  /alter\s+table\s+(\w+)\s+add\s+constraint\s+\w+\s+foreign\s+key\s*\(\s*(\w+)\s*\)\s*references\s+([\w.]+)\s*\(id\)/gi
)) {
  tujuanFk.set(`${m[1]}.${m[2]}`, m[3].toLowerCase());
}

// ---------------------------------------------------------
// 2. Cari embed `user_profiles!kolom` di JS, tentukan tabel asalnya.
// ---------------------------------------------------------
const temuan = [];
let diperiksa = 0;

/**
 * Tabel asal sebuah embed pada posisi `pos` di `teks`.
 *
 * Dua bentuk yang dipakai di repo ini:
 *
 *   a. langsung di rantainya — `supabase.from('x').select('…embed…')`
 *   b. lewat konstanta       — `const KOLOM = '…embed…'` lalu `.select(KOLOM)`
 *
 * Untuk (a) `.from()` dicari ke belakang TAPI tidak boleh melompati batas
 * pernyataan (`;`). Tanpa batas itu, embed yang berdiri sendiri akan mewarisi
 * `.from()` milik fungsi lain — yang persis bagaimana audit ini pernah
 * melaporkan embed presensi sebagai milik `exit_task_otp_codes`.
 *
 * @returns {string|null} nama tabel, atau null kalau tidak bisa dipastikan
 */
function tabelAsal(teks, pos) {
  const sebelum = teks.slice(0, pos);

  // (a) rantai yang sama: potong di `;` terakhir sebelum embed.
  const batas = sebelum.lastIndexOf(';');
  const rantai = sebelum.slice(batas + 1);
  const dari = [...rantai.matchAll(/\.from\(\s*['"](\w+)['"]\s*\)/g)].pop();
  if (dari) return dari[1];

  // (b) konstanta: cari nama konstanta yang memuat embed ini, lalu cari
  // `.select(NAMA)` di berkas yang sama dan ambil `.from()` di rantai itu.
  const deklarasi = [...teks.matchAll(/const\s+([A-Za-z_$][\w$]*)\s*=/g)].filter((d) => d.index < pos).pop();
  if (!deklarasi) return null;
  const nama = deklarasi[1];

  const pakai = [...teks.matchAll(new RegExp(`\\.select\\(\\s*${nama}\\b`, 'g'))];
  const tabelDipakai = new Set();
  for (const u of pakai) {
    const t = tabelAsal(teks, u.index);
    if (t) tabelDipakai.add(t);
  }

  // ============ SATU TINGKAT PEMBUNGKUS ============
  //
  // Bentuk yang dipakai di dua berkas: konstantanya tidak masuk `.select()`
  // langsung, melainkan lewat pembungkus lokal —
  //
  //   const ambil = (kolom) => ambilSemua(… .from('x').select(kolom) …);
  //   return await ambil(KOLOM_REKAP_PRESENSI);
  //
  // Jadi pemanggilan `nama` ditelusuri satu tingkat: cari `pembungkus(nama)`,
  // lalu `.from()` di dalam badan pembungkus itu.
  for (const c of teks.matchAll(new RegExp(`\\b(\\w+)\\s*\\(\\s*${nama}\\b`, 'g'))) {
    const pembungkus = c[1];
    const def = new RegExp(`(?:const|let|function)\\s+${pembungkus}\\b`).exec(teks);
    if (!def) continue;
    // Dibatasi sampai `export` berikutnya supaya tidak memungut `.from()`
    // milik fungsi lain di bawahnya — tebakan yang melebar persis bentuk
    // kesalahan yang sedang diperbaiki di sini.
    const akhir = teks.indexOf('\nexport ', def.index);
    const badan = teks.slice(def.index, akhir < 0 ? teks.length : akhir);
    for (const f of badan.matchAll(/\.from\(\s*['"](\w+)['"]\s*\)/g)) tabelDipakai.add(f[1]);
  }

  // Konstanta yang dipakai pada DUA tabel berbeda tidak bisa dinilai dengan
  // satu jawaban — dan menebak salah satunya adalah cara audit ini berbohong.
  return tabelDipakai.size === 1 ? [...tabelDipakai][0] : null;
}

for (const p of berkas(DIR_JS, '.js')) {
  const asli = fs.readFileSync(p, 'utf8');
  const rel = path.relative(AKAR, p).replace(/\\/g, '/');

  // ============ KOMENTARNYA DIBUANG DULU ============
  //
  // Pemotongan "rantai yang sama" memakai `;` sebagai batas pernyataan, dan
  // komentar di repo ini penuh kalimat ber-titik-koma:
  //
  //   // … Kodenya tidak berubah; skemanya yang berubah.
  //
  // Titik koma itu memotong rantainya di tengah `.select()`, `.from()`-nya
  // ikut terbuang, dan embed yang benar dilaporkan "tidak bisa dipastikan".
  //
  // `tanpaKomentar` mengganti komentar dengan SPASI, jadi nomor baris dan
  // posisi karakternya tetap sama.
  const teks = tanpaKomentar(asli);
  const pesanWaras = periksaKewarasan(asli, teks, ['user_profiles!', '.from(']);
  if (pesanWaras) {
    temuan.push(`${rel} — ${pesanWaras} (pemotong komentar tertipu; audit ini tidak bisa dipercaya untuk berkas itu)`);
    continue;
  }

  for (const m of teks.matchAll(/user_profiles!(\w+)\s*\(/g)) {
    const petunjuk = m[1];
    diperiksa++;

    const sebelum = teks.slice(0, m.index);
    const baris0 = sebelum.split('\n').length;

    // ============ TABEL ASALNYA DICARI, BUKAN DITEBAK ============
    //
    // Aturan lamanya: ".from('…') terdekat SEBELUM embed ini". Itu benar untuk
    // rantai `supabase.from('x').select('…user_profiles!y(…)')`, dan SALAH
    // untuk embed yang hidup di konstanta:
    //
    //   const KOLOM_REKAP_PRESENSI = '…, user_profiles!user_id(full_name)';
    //
    // Konstanta itu ditulis di atas fungsinya, jadi ".from() terdekat
    // sebelumnya" adalah milik fungsi LAIN beberapa ratus baris di atas —
    // dan audit ini melaporkan embed presensi sebagai milik
    // `exit_task_otp_codes`.
    //
    // Yang lebih berbahaya bukan temuan palsunya, melainkan kebalikannya:
    // embed yang benar-benar rusak bisa ditimpakan ke tabel lain yang
    // kebetulan punya FK yang pas, dan auditnya diam.
    const tabel = tabelAsal(teks, m.index);
    if (!tabel) {
      // Tidak bisa dipastikan = DILAPORKAN, bukan dilewati. Melewatinya diam-
      // diam persis sama dengan tidak punya audit untuk embed itu.
      temuan.push(
        `${rel}:${baris0} — embed user_profiles!${petunjuk}, tapi tabel asalnya tidak bisa dipastikan ` +
          '(tidak ada .from() di rantai yang sama, dan konstantanya tidak dipakai di .select() mana pun). ' +
          'Tulis embed-nya langsung di .select() tabelnya, atau pakai konstanta yang jelas pemakaiannya.'
      );
      continue;
    }

    // PostgREST menerima DUA bentuk petunjuk: nama kolom (`!used_by`) atau
    // nama constraint (`!exit_task_otp_codes_used_by_fkey`). Bentuk kedua
    // dipakai kalau satu tabel punya beberapa FK ke tabel yang sama, dan
    // menolaknya di sini akan menghasilkan temuan palsu pada kode yang benar.
    const kolom =
      petunjuk.startsWith(`${tabel}_`) && petunjuk.endsWith('_fkey')
        ? petunjuk.slice(tabel.length + 1, -'_fkey'.length)
        : petunjuk;

    const baris = baris0;
    const tujuan = tujuanFk.get(`${tabel}.${kolom}`);

    if (!tujuan) {
      temuan.push(`${rel}:${baris} — embed user_profiles!${petunjuk} pada '${tabel}', tapi FK ${tabel}.${kolom} tidak ditemukan di migration mana pun`);
    } else if (tujuan !== 'user_profiles') {
      temuan.push(`${rel}:${baris} — embed user_profiles!${petunjuk} pada '${tabel}', tapi FK-nya menunjuk ${tujuan}. PostgREST akan menolak SELURUH query-nya.`);
    }
  }
}

if (temuan.length) {
  console.error('❌ Embed user_profiles tanpa FK ke user_profiles:\n');
  for (const t of temuan) console.error('   ' + t);
  console.error(
    '\nKolom "siapa" harus dideklarasikan:\n' +
      '   created_by uuid references user_profiles(id) on delete set null\n' +
      'BUKAN `references auth.users(id)` — nilainya sama, relasinya tidak.\n' +
      'Sesudah memperbaiki FK di database, jalankan juga:  notify pgrst, \'reload schema\';'
  );
  process.exit(1);
}

console.log(`${diperiksa} embed user_profiles diperiksa terhadap ${tujuanFk.size} FK di migration. Semuanya punya relasi yang benar. ✅`);
