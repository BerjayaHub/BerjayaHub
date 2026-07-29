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
const POLA = new RegExp('\\$\\{[^}]*\\b' + JALUR + '\\s*\\??\\.\\s*' + FIELDS + '\\b[^}]*\\}', 'i');
const TAG = /<(td|th|option|div|span|p|strong|h\d)\b/;
const SUDAH_AMAN = /esc\(|escapeHtml\(|escAttr\(|escapeAttr\(|getModuleIcon\(/;

let masalah = 0;
for (const file of daftarFile(ROOT)) {
  fs.readFileSync(file, 'utf8')
    .split('\n')
    .forEach((ln, i) => {
      if (POLA.test(ln) && TAG.test(ln) && !SUDAH_AMAN.test(ln)) {
        console.error(`✗ ${path.relative(path.join(ROOT, '..'), file)}:${i + 1}`);
        console.error(`  ${ln.trim().slice(0, 110)}`);
        masalah++;
      }
    });
}

if (masalah) {
  console.error(`\n${masalah} tempat perlu dibungkus esc()/escapeHtml().`);
  process.exit(1);
}
console.log('Semua data dari database sudah di-escape sebelum masuk HTML. ✅');
