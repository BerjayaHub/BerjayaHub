/**
 * SABOTASE: penjaga layar mati.
 *
 * ============ KENAPA BERKAS INI ADA ============
 *
 * Penjaga ini satu-satunya hal yang berbicara saat seluruh aplikasi gagal
 * dimuat — yaitu tepat saat tidak ada apa pun lain yang bisa berbicara. Kalau
 * ia rusak, tidak ada yang akan menyadarinya sampai hari aplikasinya mati
 * lagi, dan pada hari itu yang terlihat tetap layar putih.
 *
 * Satu arah kerusakannya justru lebih berbahaya daripada penjaganya hilang:
 * penjaga yang MENIMPA layar yang sudah jalan mematikan aplikasi yang sehat.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AKAR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const P = (rel) => path.join(AKAR, rel);

const STAFF = 'index.html';
const ADMIN = 'admin.html';
const OWNER = 'owner.html';

const BERKAS = [STAFF, ADMIN, OWNER];
const asli = new Map();
for (const rel of BERKAS) asli.set(rel, fs.readFileSync(P(rel), 'utf8'));

const PENANDA = path.join(AKAR, 'tools/.sabotase-aktif');
const tandai = (rel) => fs.writeFileSync(PENANDA, `${path.basename(process.argv[1])} merusak ${rel}\n`);
const lepasTanda = () => {
  try {
    fs.unlinkSync(PENANDA);
  } catch {
    /* belum pernah ada — tidak apa-apa */
  }
};

const pulih = () => {
  if (process.env.SABOTASE_PERIKSA_POLA) return lepasTanda();
  for (const [rel, isi] of asli) fs.writeFileSync(P(rel), isi);
  lepasTanda();
};
process.on('exit', pulih);
process.on('SIGINT', () => process.exit(130));
process.on('SIGTERM', () => process.exit(143));

// ============ SEBAGIAN PEMERIKSA BUTUH FLAG ============
//
// `audit-syntax.cjs` keluar dengan kode galat kalau dijalankan TANPA
// `--experimental-vm-modules` — bukan karena ada yang rusak, melainkan karena
// ia tidak bisa jalan sama sekali. Menjalankannya polos membuat setiap
// sabotase yang menyasarnya "tertangkap" tanpa pernah benar-benar diperiksa.
const FLAG = { 'tools/audit-syntax.cjs': ['--experimental-vm-modules'] };

const jalan = (cmd) => {
  try {
    execFileSync('node', [...(FLAG[cmd] ?? []), cmd], { cwd: AKAR, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
};

// ============ PEMERIKSANYA HARUS HIJAU DULU ============
//
// "Tertangkap" hanya berarti sesuatu kalau pemeriksanya memang hijau sebelum
// kodenya dirusak. Pemeriksa yang sudah merah sejak awal akan melaporkan
// SELURUH sabotase sebagai tertangkap, dan harness ini berubah jadi stempel.
const pastikanHijau = (cmd) => {
  if (process.env.SABOTASE_PERIKSA_POLA) return;
  if (!jalan(cmd)) {
    console.error(`❌ PEMERIKSANYA SUDAH MERAH SEBELUM DISABOTASE: ${cmd} — "tertangkap" di bawah tidak berarti apa-apa.`);
    process.exit(1);
  }
};

let gagal = 0;
const sabotase = (nama, rel, dari, ke, pemeriksa) => {
  if (!fs.existsSync(P(pemeriksa))) {
    gagal++;
    console.error(`❌ PEMERIKSANYA TIDAK ADA: ${pemeriksa} — "tertangkap" di sini tidak berarti apa-apa.`);
    return;
  }
  const isi = asli.get(rel);
  const rusak = isi.replace(dari, ke);
  if (rusak === isi) {
    gagal++;
    console.error(`❌ SABOTASE TIDAK TERPASANG: ${nama} — polanya tidak ketemu di ${rel}.`);
    return;
  }
  if (typeof dari === 'string' && isi.split(dari).length > 2) {
    gagal++;
    console.error(`❌ POLANYA MUNCUL >1 KALI: ${nama} di ${rel} — sabotasenya cuma mengenai yang pertama.`);
    return;
  }
  if (process.env.SABOTASE_PERIKSA_POLA) {
    console.log(`   ✔ pola terpasang: ${nama}`);
    return;
  }
  tandai(rel);
  fs.writeFileSync(P(rel), rusak);
  const hijau = jalan(pemeriksa);
  pulih();
  if (hijau) {
    gagal++;
    console.error(`❌ LOLOS: ${nama}\n   ${pemeriksa} tetap hijau padahal ${rel} sudah dirusak.`);
  } else {
    console.log(`   ✔ tertangkap: ${nama}`);
  }
};

const TES = 'tools/test-penjaga-layar-mati.mjs';
const SYNTAX = 'tools/audit-syntax.cjs';

for (const p of [TES, SYNTAX]) pastikanHijau(p);

// =====================================================================
console.log('SABOTASE PENJAGA:');
// =====================================================================

// ============ ARAH YANG PALING BERBAHAYA ============
//
// Tanpa pemeriksaan "isinya masih sama seperti semula", penjaganya menimpa
// layar yang SUDAH JALAN — mematikan aplikasi yang sehat dua belas detik
// sesudah dibuka, dari berkas yang tidak dicurigai siapa pun.
sabotase(
  'pemeriksaan "layarnya masih kosong" dicabut — layar yang sehat ikut ditimpa',
  STAFF,
  "        if (!app || app.textContent.trim() !== AWAL) return;",
  '',
  TES
);

sabotase(
  'tungguannya dibuang — layar mati kembali diam selamanya',
  ADMIN,
  '      setTimeout(function () {',
  '      (function () { return; })(); (function () {',
  TES
);

sabotase(
  'tombol muat ulang hilang — pesannya ada, jalan keluarnya tidak',
  OWNER,
  "          '<button onclick=\"location.reload(true)\" style=\"padding:8px 14px;font-size:0.9rem\">Muat ulang</button>' +",
  '',
  TES
);

sabotase(
  'pesannya tidak lagi menyebut apa yang terjadi',
  STAFF,
  '<h2 style="margin:0 0 10px;font-size:1.05rem">Aplikasinya gagal dimuat</h2>',
  '<h2 style="margin:0 0 10px;font-size:1.05rem">&nbsp;</h2>',
  TES
);

sabotase(
  'galatnya tidak lagi didengarkan — laporannya tinggal "blank"',
  ADMIN,
  "      window.addEventListener('error', function (e) {",
  "      (function (_, fn) { return; })('error', function (e) {",
  TES
);

// ============ DAN SATU YANG MENJAGA KOMENTARNYA SENDIRI ============
//
// Komentar penjaga ini sengaja TIDAK menuliskan tag skrip bertipe module
// secara utuh: `audit-syntax` mencari pola itu untuk memeriksa skrip tertanam,
// dan menemukannya di dalam komentar membuat ia memotong potongan yang salah
// lalu melaporkan tiga berkas yang benar sebagai rusak. Itu sudah terjadi
// sekali saat penjaga ini ditulis.
sabotase(
  'tag module ditulis utuh di komentar — audit-syntax memotong di tempat yang salah',
  STAFF,
  '       Modul ES (tag skrip bertipe module di bawah) yang GAGAL DIMUAT tidak',
  '       `<script type="module">` yang GAGAL DIMUAT tidak',
  SYNTAX
);

// ---------------------------------------------------------------
console.log('');
if (gagal === 0) console.log('Semua sabotase penjaga layar mati tertangkap. ✅');
else console.error(`${gagal} sabotase LOLOS / tidak terpasang.`);
process.exit(gagal === 0 ? 0 : 1);
