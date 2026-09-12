/**
 * AUDIT: Nilai Opname & laporan COGS.
 *
 * ============ SATU ANGKA SALAH YANG TIDAK TERLIHAT SALAH ============
 *
 *   COGS = stok awal + pembelian − stok akhir
 *
 * Tiga angka, dua di antaranya dari opname. Tiap cara ia bisa rusak
 * menghasilkan laporan yang tetap rapi:
 *
 *   opname tidak ada dianggap nol  -> COGS melonjak atau jadi negatif
 *   dipakai `system_qty`           -> stok akhir jadi angka CATATAN, padahal
 *                                     seluruh guna opname justru karena
 *                                     keduanya berbeda
 *   opname 'cancelled' ikut        -> dinilai dari hitungan yang sengaja tidak
 *                                     pernah diberlakukan ke stok (0085)
 *   nota batal ikut                -> pembelian, dan COGS, lebih besar
 *   stok awal diambil dari `from`  -> opname di dalam periode jadi stok awal,
 *                                     dan pembelian hari itu terhitung dua kali
 *
 * Tidak satu pun melempar error.
 */
const fs = require('fs');
const path = require('path');
const { tanpaKomentar } = require('./lib/tanpa-komentar.cjs');

const AKAR = path.dirname(__dirname);
let gagal = 0;
const salah = (pesan) => {
  gagal++;
  console.error(`❌ ${pesan}`);
};

const baca = (rel) => {
  const p = path.join(AKAR, rel);
  if (!fs.existsSync(p)) {
    salah(`${rel} tidak ada — audit ini kehilangan sasarannya.`);
    return null;
  }
  return fs.readFileSync(p, 'utf8');
};

// ---------------------------------------------------------------
// 1. Nilai Opname di laporan opname.
// ---------------------------------------------------------------
const opn = baca('js/modules/inventory/laporan-opname.js');
if (opn) {
  const kode = tanpaKomentar(opn);
  if (!/\{ header: 'Nilai Opname'/.test(kode)) {
    salah('laporan-opname.js: kolom `Nilai Opname` hilang — nilai stok yang benar-benar ada tidak disebut di mana pun.');
  }
  if (!/const nilaiAda = h == null \? null : h \* dihitung;/.test(kode)) {
    salah(
      'laporan-opname.js: Nilai Opname tidak dihitung dari `dihitung`. ' +
        'Kalau ia memakai `sistem`, angkanya jadi nilai CATATAN — dan seluruh guna opname justru karena keduanya berbeda.'
    );
  }
  if (!/nilaiOpnameTeks: denganNilai \? rupiah\(nilaiOpname\) : null/.test(kode)) {
    salah('laporan-opname.js: `nilaiOpnameTeks` tidak diekspor — layar tidak punya angka untuk ditampilkan.');
  }
  // Baris berstok tanpa HPP harus ditandai: ia membuat nilai opname lebih kecil.
  if (!/if \(h == null && \(selisih !== 0 \|\| dihitung !== 0\)\) adaTanpaHpp = true;/.test(kode)) {
    salah(
      'laporan-opname.js: baris BERSTOK tanpa HPP tidak lagi ditandai. ' +
        'Sejak ada kolom Nilai Opname, baris berselisih NOL pun menyumbang nilai — HPP yang kosong di situ ' +
        'membuat total nilai opname lebih kecil tanpa satu pun tanda.'
    );
  }
}

const opnAdmin = baca('js/modules/inventory/opname.admin.js');
if (opnAdmin && !/nilaiOpnameTeks/.test(tanpaKomentar(opnAdmin))) {
  salah('opname.admin.js: Nilai Opname tidak ditampilkan — angkanya dihitung tapi tidak pernah terlihat.');
}

// ---------------------------------------------------------------
// 2. Aturan COGS-nya sendiri.
// ---------------------------------------------------------------
const murni = baca('js/modules/report/cogs.js');
if (murni) {
  const kode = tanpaKomentar(murni);
  for (const n of ['nilaiOpname', 'barisCogs', 'ringkasCogs']) {
    if (!new RegExp(`export function ${n}\\(`).test(kode)) salah(`cogs.js: \`${n}\` tidak diekspor.`);
  }
  if (!/cogs: bisa \? nAwal \+ beli - nAkhir : null,/.test(kode)) {
    salah(
      'cogs.js: rumusnya berubah, atau opname yang tidak ada tidak lagi menghasilkan `null`. ' +
        'Nol di kolom COGS terbaca sebagai "tidak ada biaya pokok bulan ini" — pernyataan yang sepenuhnya berbeda ' +
        'dari "belum bisa dihitung", dan keduanya sama-sama terlihat wajar.'
    );
  }
  if (!/const bisa = nAwal !== null && nAkhir !== null;/.test(kode)) {
    salah('cogs.js: syarat "bisa dihitung" berubah — satu opname yang hilang cukup membuat angkanya salah besar.');
  }
  // Outlet yang tidak terhitung tidak boleh menyumbang apa pun ke total.
  if (!/\.filter\(\(b\) => b\?\.bisaDihitung\)/.test(kode)) {
    salah(
      'cogs.js: total ikut menjumlahkan outlet yang COGS-nya tidak bisa dihitung. ' +
        'Pembelian tanpa stok awal/akhirnya membuat total tidak konsisten dengan barisnya sendiri.'
    );
  }
}

// ---------------------------------------------------------------
// 3. Cara datanya diambil.
// ---------------------------------------------------------------
const svc = baca('js/modules/report/report.service.js');
if (svc) {
  const kode = tanpaKomentar(svc);

  if (!/key: 'cogs'/.test(kode)) salah("report.service.js: laporan 'cogs' tidak terdaftar di katalog REPORTS.");
  if (!/build: buildCogs/.test(kode)) salah('report.service.js: `buildCogs` tidak dipasang ke entri katalognya.');

  const i = kode.indexOf('async function opnameTerakhirPerOutlet');
  const blokSesi = i >= 0 ? kode.slice(i, i + 1500) : '';
  if (!blokSesi) {
    salah('report.service.js: `opnameTerakhirPerOutlet` tidak ada.');
  } else {
    // 'closed' SAJA. 'open' belum selesai dihitung; 'cancelled' sengaja ditutup
    // TANPA menyentuh stok (0085) — menilai stok dari keduanya berarti memakai
    // hitungan yang belum atau tidak pernah berlaku.
    if (!/\.eq\('status', 'closed'\)/.test(blokSesi)) {
      salah(
        "report.service.js: opname yang dipakai tidak disaring `status = 'closed'`. " +
          "Sesi 'open' belum selesai dan 'cancelled' sengaja tidak pernah menyentuh stok — keduanya bukan keadaan rak."
      );
    }
    if (!/\.order\('count_date', \{ ascending: false \}\)/.test(blokSesi)) {
      salah('report.service.js: opname tidak diurutkan menurun — yang terambil bisa sesi paling AWAL, bukan paling akhir.');
    }
  }

  const j = kode.indexOf('async function buildCogs');
  const blok = j >= 0 ? kode.slice(j, j + 4000) : '';
  if (!blok) {
    salah('report.service.js: `buildCogs` tidak ada.');
  } else {
    // Stok awal = keadaan SEBELUM hari pertama periode.
    if (!/sebelum\.setDate\(sebelum\.getDate\(\) - 1\);/.test(blok)) {
      salah(
        'report.service.js `buildCogs`: stok awal tidak lagi diambil dari SEHARI SEBELUM periode. ' +
          'Memakai `from` sendiri mengambil opname DI DALAM periode sebagai stok awal, dan pembelian hari itu ' +
          'jadi terhitung dua kali.'
      );
    }
    if (!/if \(n\.status === 'dibatalkan'\) continue;/.test(blok)) {
      salah(
        "report.service.js `buildCogs`: nota dibatalkan (0131) ikut dihitung sebagai pembelian. " +
          'Barangnya sudah ditarik — pembelian, dan karenanya COGS, jadi lebih besar dari yang sebenarnya.'
      );
    }
    if (!/counted_qty/.test(blok) && !/nilaiSesiOpname/.test(blok)) {
      salah('report.service.js `buildCogs`: nilai opnamenya tidak dihitung dari `counted_qty`.');
    }
    // Baris yang tidak bisa dihitung wajib berbunyi "-", bukan Rp0.
    if (!/b\.cogs === null \? '-' : rp\(b\.cogs\)/.test(blok)) {
      salah('report.service.js `buildCogs`: baris tanpa opname ditulis sebagai rupiah, bukan "-".');
    }
    if (!/note:/.test(blok)) {
      salah(
        'report.service.js `buildCogs`: tidak ada catatan metodologi. ' +
          'Angka ini beda arti dari HPP resep di Laba Kotor, dan tanpa keterangan keduanya akan dikira saling menggantikan.'
      );
    }
  }
}

if (gagal === 0) {
  console.log(
    'Nilai Opname & COGS: dihitung dari jumlah yang BENAR-BENAR dihitung, opname yang tidak ada jadi "-" bukan nol, ' +
      "hanya sesi 'closed' yang dipakai, dan nota batal tidak ikut. ✅"
  );
}
process.exit(gagal === 0 ? 0 : 1);
