/**
 * AUDIT: setiap `import { X } from './y.js'` harus benar-benar ada ekspornya.
 *
 * ============ KENAPA `audit-syntax` TIDAK CUKUP ============
 *
 * `audit-syntax` menjawab "apakah berkas ini sah sebagai ES module". Import
 * yang menunjuk nama yang tidak pernah diekspor SAH SECARA SINTAKS — ia baru
 * meledak di browser, saat modulnya benar-benar dimuat.
 *
 * Dan "saat modulnya dimuat" itu jauh lebih terlambat daripada kedengarannya:
 * modul layar hanya dimuat ketika tabnya dibuka. Jadi kesalahannya tidak
 * terlihat saat halaman dibuka, tidak terlihat di tab mana pun yang lain, dan
 * baru muncul di depan orang yang kebetulan membuka satu tab tertentu — sebagai
 * layar kosong tanpa penjelasan.
 *
 * Audit ini lahir dari kejadian nyata: `menu-outlet.admin.js` mengimpor
 * `sayaAdminBu` dari `product.service.js`, padahal tempatnya di
 * `core/base-scope.js`. `audit-syntax` lulus dengan 162 berkas valid.
 *
 * ============ YANG SENGAJA TIDAK DIPERIKSA ============
 *
 * Impor dari CDN/paket (yang tidak diawali `.`) dilewati — tidak ada berkasnya
 * di repo untuk diperiksa. `import * as X` dan `import X` (default) juga
 * dilewati: keduanya tidak menyebut nama tertentu yang bisa salah.
 */
const fs = require('fs');
const path = require('path');

const AKAR = path.dirname(__dirname);
const SUMBER = path.join(AKAR, 'js');

let gagal = 0;
let diperiksa = 0;

/** Apakah `nama` diekspor oleh isi modul `src`? */
function diekspor(src, nama) {
  // export function X / export async function X / export const X / export class X
  if (new RegExp(`export\\s+(async\\s+)?(function|const|let|var|class)\\s+${nama}\\b`).test(src)) return true;
  // export { X } / export { Y as X }
  for (const m of src.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (let bagian of m[1].split(',')) {
      const potong = bagian.split(/\s+as\s+/);
      const keluar = (potong[1] ?? potong[0]).trim();
      if (keluar === nama) return true;
    }
  }
  // export * from './lain.js' — dianggap mungkin. Menelusurinya berarti
  // menyelesaikan seluruh graf modul; kalau pola ini nanti dipakai, lebih baik
  // audit ini diperluas daripada mengeluh palsu sekarang.
  if (/export\s+\*\s+from/.test(src)) return true;
  return false;
}

function daftar(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) daftar(p, out);
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

const berkas = daftar(SUMBER);
if (berkas.length < 50) {
  console.error(`❌ hanya ${berkas.length} berkas ditemukan di js/ — audit ini kehilangan sasarannya.`);
  process.exit(1);
}

for (const f of berkas) {
  const isi = fs.readFileSync(f, 'utf8');
  const rel = path.relative(AKAR, f).split(path.sep).join('/');

  for (const m of isi.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"](\.[^'"]+)['"]/g)) {
    const tujuanRel = m[2];
    const tujuan = path.join(path.dirname(f), tujuanRel);

    if (!fs.existsSync(tujuan)) {
      gagal++;
      console.error(`❌ ${rel}: mengimpor dari '${tujuanRel}' yang BERKASNYA TIDAK ADA.`);
      continue;
    }
    const src = fs.readFileSync(tujuan, 'utf8');

    for (let nama of m[1].split(',')) {
      nama = nama.trim().split(/\s+as\s+/)[0].trim();
      if (!nama) continue;
      diperiksa++;
      if (!diekspor(src, nama)) {
        gagal++;
        console.error(
          `❌ ${rel}: mengimpor \`${nama}\` dari '${tujuanRel}', tapi berkas itu tidak mengekspornya. ` +
            'Sintaksnya sah, jadi audit-syntax lulus — kesalahannya baru muncul di browser saat tab ini dibuka, ' +
            'sebagai layar kosong tanpa penjelasan.'
        );
      }
    }
  }
}

if (gagal === 0) console.log(`Impor bernama: ${diperiksa} nama diperiksa, semuanya ada ekspornya. ✅`);
process.exit(gagal === 0 ? 0 : 1);
