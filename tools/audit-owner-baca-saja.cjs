#!/usr/bin/env node
/**
 * HALAMAN OWNER TIDAK BOLEH MENULIS DATA OPERASIONAL.
 *
 * ============ KENAPA INI JUSTRU LEBIH PERLU SEKARANG ============
 *
 * Rancangan pertama memakai role `owner` tersendiri yang bukan anggota BU,
 * sehingga `has_bu_scope()` selalu gagal untuknya dan seluruh jalur tulis
 * tertutup dengan sendirinya. Ketidakmampuan menulis itu sifat bawaan — tidak
 * ada yang bisa lupa memasangnya.
 *
 * Keputusannya diubah: yang membuka `owner.html` adalah SUPER ADMIN. Dan super
 * admin bisa menulis apa pun, di mana pun. Artinya penjagaan yang tadinya di
 * database sekarang tidak ada lagi — satu-satunya yang menahan halaman owner
 * dari mengubah stok, penjualan, atau opname adalah halamannya memang tidak
 * punya kodenya.
 *
 * Penjagaan seperti itu hilang tanpa suara. Satu `.update()` yang ditambahkan
 * "supaya sekalian bisa dibetulkan dari sini" akan berjalan mulus, tidak
 * ditolak siapa pun, dan tidak meninggalkan jejak bahwa perubahannya datang
 * dari halaman ringkasan alih-alih dari modul yang seharusnya.
 *
 * Berkas ini yang menggantikan penjagaan database itu.
 *
 * ============ CARA PENGECUALIANNYA DITENTUKAN ============
 *
 * Seluruh isi `js/modules/owner/` dilarang menulis, KECUALI dua berkas yang
 * disebut di bawah beserta alasannya — dan untuk keduanya pun yang boleh
 * ditulis dibatasi ke tabel tertentu, bukan dibebaskan.
 *
 * Berkas BARU di folder itu otomatis kena aturan penuh. Itu perilaku yang
 * diinginkan: yang paling mungkin terjadi setahun lagi adalah seseorang
 * menambah satu layar baru di sini, dan yang paling mahal adalah layar itu
 * diam-diam boleh menulis karena auditnya cuma menghafal nama berkas lama.
 */

const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'js', 'modules', 'owner');
const MAIN = path.join(__dirname, '..', 'js', 'main-owner.js');

/** Berkas yang boleh menulis, beserta tabel yang boleh disentuhnya. */
const BOLEH_TULIS = {
  'dokumen.service.js': {
    alasan: 'mengunggah dokumen (dipakai Admin Portal) & menyimpan tanda tangan sendiri',
    tabel: new Set(['documents', 'owner_signatures']),
    rpc: new Set(['putuskan_dokumen'])
  },
  'biaya.service.js': {
    alasan:
      'daftar biaya tetap/variabel per outlet — satu-satunya masukan BEP yang tidak bisa datang dari kejadian operasional, jadi harus bisa diketik di tempat ia dibaca',
    tabel: new Set(['outlet_costs']),
    rpc: new Set()
  },
  'dokumen.admin.page.js': {
    alasan: 'layar Admin Portal, bukan halaman owner — menghapus dokumen yang belum diputus',
    tabel: new Set(['documents']),
    rpc: new Set()
  }
};

const TULIS = ['insert', 'update', 'delete', 'upsert'];

function tanpaKomentar(js) {
  return js
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((b) => b.replace(/(^|[^:])\/\/.*$/, '$1'))
    .join('\n');
}

const masalah = [];
let diperiksa = 0;

const berkas = fs
  .readdirSync(DIR)
  .filter((f) => f.endsWith('.js'))
  .sort()
  .map((f) => ({ nama: f, jalan: path.join(DIR, f) }));

berkas.push({ nama: 'main-owner.js', jalan: MAIN });

for (const { nama, jalan } of berkas) {
  const src = tanpaKomentar(fs.readFileSync(jalan, 'utf8'));
  const izin = BOLEH_TULIS[nama] ?? null;
  diperiksa++;

  // --- Penulisan tabel: supabase.from('x')....insert(
  const polaFrom = /\.from\(\s*['"`](\w+)['"`]\s*\)([\s\S]{0,600}?);/g;
  let m;
  while ((m = polaFrom.exec(src))) {
    const [, tabel, rantai] = m;
    for (const op of TULIS) {
      if (!new RegExp(`\\.${op}\\s*\\(`).test(rantai)) continue;

      // `.from()` juga dipakai storage (`storage.from('bucket')`), yang
      // operasinya `upload`/`remove`/`download` — bukan salah satu di atas.
      // Jadi kalau sampai ke sini, ini benar-benar tabel.
      if (izin?.tabel.has(tabel)) continue;

      masalah.push(
        izin
          ? `${nama} — .${op}() pada tabel "${tabel}".\n` +
            `    Berkas ini boleh menulis, tapi hanya ke: ${[...izin.tabel].join(', ')}.`
          : `${nama} — .${op}() pada tabel "${tabel}".\n` +
            `    Halaman owner hanya membaca. Perubahan data dikerjakan di modul yang\n` +
            `    bersangkutan, supaya riwayatnya tercatat dari tempat yang benar.`
      );
    }
  }

  // --- RPC: satu-satunya jalur tulis yang diizinkan, dan namanya disebut.
  const polaRpc = /\.rpc\(\s*['"`](\w+)['"`]/g;
  while ((m = polaRpc.exec(src))) {
    const fn = m[1];
    if (izin?.rpc.has(fn)) continue;
    masalah.push(
      `${nama} — memanggil RPC "${fn}".\n` +
        `    RPC bisa menulis apa saja tanpa terlihat sebagai penulisan. Kalau memang\n` +
        `    perlu, daftarkan namanya di BOLEH_TULIS beserta alasannya.`
    );
  }
}

if (masalah.length) {
  console.error('❌ Halaman owner menulis data:\n');
  for (const p of masalah) console.error(`  ${p}\n`);
  process.exit(1);
}

const jumlahPengecualian = Object.keys(BOLEH_TULIS).length;
console.log(
  `${diperiksa} berkas halaman owner diperiksa. Semuanya baca-saja kecuali ${jumlahPengecualian} yang terdaftar beralasan. ✅`
);
