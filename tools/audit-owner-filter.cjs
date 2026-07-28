#!/usr/bin/env node
/**
 * Audit: fungsi "milik saya" yang lupa menyaring pemiliknya.
 *
 * Jalankan:  node tools/audit-owner-filter.cjs
 *
 * KENAPA ADA:
 * RLS di app ini sengaja mengizinkan ADMIN membaca baris milik staff lain
 * (untuk rekap, koreksi, approval). Akibatnya, query "milik saya" yang
 * menggantungkan pembatasan pada RLS akan JALAN BENAR untuk staff biasa, tapi
 * mengembalikan baris ORANG LAIN begitu yang login punya role admin.
 *
 * Bug itu sulit terlihat: staff bilang normal, admin melihat data aneh.
 * Contoh nyata: halaman Presensi menampilkan "sudah clock in" untuk super admin
 * padahal yang clock in adalah staff lain, karena `getMyTodaySession()` tidak
 * menyaring `user_id`.
 *
 * ATURANNYA: fungsi ber-nama *My* yang menyentuh tabel HARUS menyaring pemilik
 * secara eksplisit (`.eq('user_id', uid)` / `.eq('id', uid)` / `.eq('holder_id', uid)`),
 * atau memakai RPC yang menjaga sendiri.
 *
 * Kalau sebuah fungsi memang di-scope selain per-orang (mis. per outlet),
 * tulis alasannya di komentar tepat di atas fungsi dan daftarkan di PENGECUALIAN.
 */

const fs = require('fs');
const path = require('path');

// Fungsi yang memang BUKAN milik satu orang — sertakan alasannya.
const PENGECUALIAN = {
  listMyOrders: 'Order stok adalah dokumen OUTLET, di-scope lewat from_outlet_id — boleh dilihat seluruh staff outlet itu.'
};

const ROOT = path.resolve(__dirname, '..', 'js');

function daftarFile(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) daftarFile(p, out);
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

const POLA_FUNGSI = /export\s+(?:async\s+)?function\s+(\w*My\w*)\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/g;
const POLA_AMAN = [
  /\.eq\(\s*'(user_id|holder_id|id)'/, // baca: disaring pemiliknya
  /user_id:\s*(user\.id|uid)/, // tulis: pemilik ditetapkan dari sesi, bukan dari input
  /auth\.uid/,
  /\.rpc\(/ // RPC security-definer menjaga sendiri
];
const aman = (badan) => POLA_AMAN.some((p) => p.test(badan));

let masalah = 0;
let diperiksa = 0;

for (const file of daftarFile(ROOT)) {
  const src = fs.readFileSync(file, 'utf8');
  let m;
  while ((m = POLA_FUNGSI.exec(src))) {
    const [, nama, badan] = m;
    if (!/\.from\(/.test(badan)) continue; // tidak menyentuh tabel
    diperiksa++;
    if (PENGECUALIAN[nama]) continue;
    if (!aman(badan)) {
      console.error(`✗ ${nama}  —  ${path.relative(path.join(ROOT, '..'), file)}`);
      console.error(`  Tidak menyaring pemilik. Untuk akun ber-role admin, ini akan mengembalikan data orang lain.`);
      masalah++;
    }
  }
}

console.log(`\n${diperiksa} fungsi diperiksa · ${Object.keys(PENGECUALIAN).length} dikecualikan.`);
if (masalah) {
  console.error(`${masalah} fungsi perlu diperbaiki.`);
  process.exit(1);
}
console.log('Semua fungsi "milik saya" sudah menyaring pemiliknya. ✅');
