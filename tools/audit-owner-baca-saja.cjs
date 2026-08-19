#!/usr/bin/env node
/**
 * OWNER TIDAK BOLEH BISA MENULIS.
 *
 * ============ KENAPA INI PERLU DIJAGA MESIN ============
 *
 * Ketidakmampuan owner menulis TIDAK dijaga oleh satu penjagaan yang bisa
 * dibaca. Ia lahir dari sebuah keputusan struktural di 0093: owner sengaja
 * BUKAN anggota `membership_scopes`, sehingga `has_bu_scope()` selalu gagal
 * untuknya — dan `has_bu_scope()` itulah yang menjaga sebelas jalur tulis
 * transaksional (stok, produksi, penjualan, opname, nota, kiriman, order,
 * waste, rencana menu, aktivitas harian).
 *
 * Keputusan seperti itu rapuh justru karena tidak terlihat. Menambahkan
 * `'owner'` ke CHECK constraint `membership_scopes.role` adalah satu baris yang
 * terlihat sangat masuk akal — "supaya owner bisa dilihat di Master User" —
 * dan satu baris itu membuka sebelas jalur tulis sekaligus, tanpa satu pun
 * pesan, tanpa satu pun tes yang jatuh, dan tanpa perubahan apa pun yang
 * terlihat di layar.
 *
 * Berkas ini memeriksa dua hal:
 *
 *   1. `owner` TIDAK pernah muncul di CHECK role `membership_scopes`.
 *   2. Fungsi cakupan owner tidak pernah dipakai policy yang MENULIS.
 *
 * ============ SATU PENGECUALIAN, DAN CARANYA DITENTUKAN ============
 *
 * Owner memang harus bisa menulis SATU hal: berkas hasil tanda tangan ke
 * `storage.objects`. Pengecualiannya tidak ditulis sebagai daftar nama policy —
 * daftar nama akan basi, dan pengalaman di repo ini sudah membuktikannya
 * (`audit-embed-ambigu` pernah hijau selama berbulan-bulan karena pengecualian
 * tulisan tangan menyebut nama tabel yang salah).
 *
 * Yang dipakai: pengecualian ditentukan dari TABEL SASARAN policy-nya. Owner
 * boleh menulis ke `storage.objects`, tidak ke tabel lain mana pun. Aturan itu
 * tidak bisa basi karena ia dibaca dari policy-nya sendiri.
 */

const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'supabase', 'migrations');
const FUNGSI_OWNER = ['owner_punya_bu', 'owner_punya_outlet', 'is_owner', 'orang_di_bu_owner'];

/** Buang komentar SQL supaya contoh di dalam penjelasan tidak ikut terbaca. */
function tanpaKomentar(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((b) => b.replace(/--.*$/, ''))
    .join('\n');
}

const berkas = fs
  .readdirSync(DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort();

const masalah = [];

// ---------------------------------------------------------
// (1) 'owner' tidak boleh masuk daftar role membership_scopes
// ---------------------------------------------------------
for (const f of berkas) {
  const sql = tanpaKomentar(fs.readFileSync(path.join(DIR, f), 'utf8'));

  // Semua CHECK yang menyebut daftar role, di tabel mana pun yang bernama
  // membership_scopes — baik saat dibuat maupun saat constraint-nya diganti.
  const pola = /role\s+text[^,]*check\s*\(\s*role\s+in\s*\(([^)]*)\)|constraint\s+\w*role\w*\s+check\s*\(\s*role\s+in\s*\(([^)]*)\)|alter\s+table\s+membership_scopes[\s\S]{0,400}?check\s*\(\s*role\s+in\s*\(([^)]*)\)/gi;
  let m;
  while ((m = pola.exec(sql))) {
    const daftar = m[1] ?? m[2] ?? m[3] ?? '';
    if (/'owner'/i.test(daftar)) {
      masalah.push(
        `${f} — 'owner' ditambahkan ke daftar role membership_scopes.\n` +
          `    Itu membuat has_bu_scope() meloloskan owner, dan sebelas jalur TULIS\n` +
          `    transaksional terbuka sekaligus (lihat header 0093).\n` +
          `    Cakupan owner disimpan di tabel owner_scopes, bukan di sini.`
      );
    }
  }
}

// ---------------------------------------------------------
// (2) Fungsi owner tidak boleh dipakai policy yang menulis
// ---------------------------------------------------------
let policyDiperiksa = 0;

for (const f of berkas) {
  const sql = tanpaKomentar(fs.readFileSync(path.join(DIR, f), 'utf8'));

  // Satu policy = dari `create policy` sampai `;` berikutnya di akhir baris.
  const pola = /create\s+policy\s+(\w+)\s+on\s+([\w.]+)([\s\S]*?);\s*(?:\n|$)/gi;
  let m;
  while ((m = pola.exec(sql))) {
    const [, nama, tabel, tubuh] = m;
    if (!FUNGSI_OWNER.some((fn) => new RegExp(`\\b${fn}\\s*\\(`, 'i').test(tubuh))) continue;

    policyDiperiksa++;

    // Perintahnya. Tanpa `for ...` PostgreSQL memakai ALL — dan itu justru
    // yang paling berbahaya, jadi ketiadaannya diperlakukan sebagai ALL, bukan
    // dilewati.
    const cmd = (tubuh.match(/\bfor\s+(all|select|insert|update|delete)\b/i)?.[1] ?? 'all').toLowerCase();
    if (cmd === 'select') continue;

    // SATU-SATUNYA pengecualian: berkas hasil tanda tangan. Ditentukan dari
    // tabel sasarannya, bukan dari daftar nama policy.
    if (tabel.toLowerCase() === 'storage.objects') continue;

    masalah.push(
      `${f} — policy "${nama}" pada ${tabel} memberi hak ${cmd.toUpperCase()} lewat fungsi owner.\n` +
        `    Owner dirancang tidak bisa menulis apa pun kecuali berkas tanda tangan.\n` +
        `    Kalau memang perlu menulis, lewatkan RPC SECURITY DEFINER seperti\n` +
        `    putuskan_dokumen() — supaya kolom yang boleh berubah dibatasi di satu tempat.`
    );
  }
}

if (masalah.length) {
  console.error('❌ Hak tulis owner bocor:\n');
  for (const p of masalah) console.error(`  ${p}\n`);
  process.exit(1);
}

console.log(`${policyDiperiksa} policy owner diperiksa. Semuanya baca-saja, dan 'owner' tidak ada di membership_scopes. ✅`);
