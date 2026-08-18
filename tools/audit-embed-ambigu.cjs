#!/usr/bin/env node
/**
 * Audit: embed PostgREST yang ambigu.
 *
 * Jalankan:  node tools/audit-embed-ambigu.cjs
 *
 * ============ KENAPA ADA ============
 *
 * PostgREST menolak embed kalau ada LEBIH DARI SATU foreign key antara dua
 * tabel, dengan pesan:
 *
 *     Could not embed because more than one relationship was found
 *
 * Yang berbahaya: query-nya sudah lama jalan dan tidak disentuh sama sekali.
 * Yang berubah cuma SKEMA — satu kolom foreign key baru ditambahkan ke tabel
 * yang sama, dan seluruh halaman yang memakai embed itu mendadak gagal total.
 *
 * ============ AUDIT INI PERNAH GAGAL PERSIS DI TUGASNYA ============
 *
 * Versi pertamanya memakai daftar PENGECUALIAN yang ditulis tangan. Salah satu
 * isinya berbunyi:
 *
 *     'modules/production/production.service.js':
 *       'production_logs hanya punya satu FK ke user_profiles (created_by).'
 *
 * Dua hal salah di situ. Nama tabelnya keliru (`production_logs` tidak pernah
 * ada; yang benar `production_runs`), dan pernyataannya berhenti benar begitu
 * migration 0092 menambahkan `cancelled_by`. Auditnya tetap hijau, dan layar
 * Produksi mati dengan pesan di atas.
 *
 * Jadi audit yang dibangun untuk menangkap PERGESERAN SKEMA justru
 * mengandalkan catatan manual tentang skema — catatan yang tidak ikut berubah
 * saat skemanya berubah. Itu bukan kelalaian menulis daftarnya; itu bentuk
 * auditnya yang salah.
 *
 * ============ SEKARANG DIHITUNG DARI MIGRATION ============
 *
 * Jumlah foreign key tiap `tabel -> tujuan` dibaca langsung dari
 * `supabase/migrations`. Tidak ada lagi yang perlu diingat orang, dan
 * pengecualiannya tidak bisa basi karena tidak ada pengecualian.
 *
 * ATURANNYA: kalau sebuah tabel punya ≥2 FK ke tabel tujuan, embed-nya WAJIB
 * menyebut kolomnya — `user_profiles!created_by(...)`, bukan
 * `user_profiles(...)`.
 *
 * Menyebut kolomnya juga membuat maksudnya terbaca: `!created_by` vs
 * `!cancelled_by` langsung menjelaskan orang mana yang dimaksud.
 */

const fs = require('fs');
const path = require('path');

const AKAR = path.resolve(__dirname, '..');
const DIR_JS = path.join(AKAR, 'js');
const DIR_SQL = path.join(AKAR, 'supabase', 'migrations');

// ---------------------------------------------------------
// 1. Hitung FK per (tabel -> tujuan) dari seluruh migration.
// ---------------------------------------------------------
/** `tabel|tujuan` -> Set(kolom) */
const fkPer = new Map();
const catat = (tabel, kolom, tujuan) => {
  const kunci = `${tabel.toLowerCase()}|${tujuan.toLowerCase().replace(/^public\./, '')}`;
  if (!fkPer.has(kunci)) fkPer.set(kunci, new Set());
  fkPer.get(kunci).add(kolom.toLowerCase());
};

const sql = fs
  .readdirSync(DIR_SQL)
  .filter((n) => n.endsWith('.sql'))
  .sort()
  .map((n) => fs.readFileSync(path.join(DIR_SQL, n), 'utf8'))
  .join('\n');

// Bentuk A: di dalam `create table X ( ... kolom <tipe> references Y(...) ... )`
for (const m of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(\w+)\s*\(([\s\S]*?)\n\s*\);/gi)) {
  for (const k of m[2].matchAll(/^\s*(\w+)\s+\w+[^,\n]*?references\s+([\w.]+)\s*\(/gim)) {
    catat(m[1], k[1], k[2]);
  }
}
// Bentuk B: `alter table X add column [if not exists] K <tipe> references Y(...)`
for (const m of sql.matchAll(/alter\s+table\s+(\w+)\s+add\s+column\s+(?:if\s+not\s+exists\s+)?(\w+)\s+\w+[^;]*?references\s+([\w.]+)\s*\(/gi)) {
  catat(m[1], m[2], m[3]);
}
// Bentuk C: `alter table X add constraint ... foreign key (K) references Y(...)`
for (const m of sql.matchAll(/alter\s+table\s+(\w+)\s+add\s+constraint\s+\w+\s+foreign\s+key\s*\(\s*(\w+)\s*\)\s*references\s+([\w.]+)\s*\(/gi)) {
  catat(m[1], m[2], m[3]);
}

// ---------------------------------------------------------
// 2. Cari embed POLOS (tanpa `!kolom`) di JS.
// ---------------------------------------------------------
function berkasJs(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) berkasJs(p, out);
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

/** Buang komentar supaya contoh di dalamnya tidak ikut terbaca. */
function tanpaKomentar(teks) {
  let out = '';
  let kutip = null;
  for (let i = 0; i < teks.length; i++) {
    const c = teks[i];
    const d = teks[i + 1];
    if (kutip) {
      if (c === '\\') {
        out += '  ';
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

for (const p of berkasJs(DIR_JS)) {
  const rel = path.relative(AKAR, p).replace(/\\/g, '/');
  const isi = tanpaKomentar(fs.readFileSync(p, 'utf8'));

  // Tabel asalnya = argumen `.from('...')` terdekat SEBELUM embed-nya.
  for (const m of isi.matchAll(/(?<![\w!.])(\w+)\s*\(/g)) {
    const tujuan = m[1];
    // Hanya nama tabel yang benar-benar jadi tujuan FK di skema ini.
    const adaSebagaiTujuan = [...fkPer.keys()].some((k) => k.endsWith(`|${tujuan.toLowerCase()}`));
    if (!adaSebagaiTujuan) continue;
    // Sudah menyebut kolomnya (`tabel!kolom(`) -> aman, dilewati oleh lookbehind `!`.

    const sebelum = isi.slice(0, m.index);
    const dari = [...sebelum.matchAll(/\.from\(\s*['"](\w+)['"]\s*\)/g)].pop();
    if (!dari) continue;
    const asal = dari[1];

    const kolom = fkPer.get(`${asal.toLowerCase()}|${tujuan.toLowerCase()}`);
    if (!kolom) continue; // bukan embed dari tabel ini
    diperiksa++;
    if (kolom.size < 2) continue; // cuma satu FK -> embed polos masih sah

    const baris = sebelum.split('\n').length;
    temuan.push(
      `${rel}:${baris} — embed polos \`${tujuan}(...)\` dari '${asal}', padahal ada ${kolom.size} foreign key ke sana ` +
        `(${[...kolom].sort().join(', ')}). PostgREST akan menolak SELURUH query-nya.`
    );
  }
}

if (temuan.length) {
  console.error('❌ Embed ambigu:\n');
  for (const t of temuan) console.error('   ' + t);
  console.error('\nSebutkan kolomnya: `user_profiles!created_by(full_name)`, bukan `user_profiles(full_name)`.');
  process.exit(1);
}

console.log(
  `${diperiksa} embed diperiksa terhadap jumlah foreign key yang dibaca langsung dari migration — tidak ada yang ambigu. ✅`
);
