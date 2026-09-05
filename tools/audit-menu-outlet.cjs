/**
 * AUDIT: menu aktif per outlet (0115) benar-benar terpasang di layar.
 *
 * ============ KENAPA AUDIT, BUKAN CUKUP TES ============
 *
 * `test-menu-outlet.mjs` membuktikan ATURANNYA benar, dan
 * `test-migrasi-0115.mjs` membuktikan SERVERNYA benar. Keduanya bisa hijau
 * sempurna sementara tidak satu pun layar memanggilnya — bentuk kegagalan yang
 * di repo ini sudah berulang kali muncul dan sekarang punya namanya sendiri:
 * kemampuannya ada, jalannya tidak ada di layar.
 *
 * ============ TIGA HAL YANG DIKUNCI ============
 *
 * 1. Staff App (Penjualan & modul Menu) benar-benar menyaring, DAN memuat
 *    ulang saringannya saat outlet berganti. Menyaring sekali saat halaman
 *    dibuka lalu membiarkannya menghasilkan gejala yang persis sama dengan bug
 *    stok basi yang baru saja diperbaiki: layar menunjukkan menu outlet lama.
 *
 * 2. Kegagalan memuat TIDAK menghasilkan layar kosong. Himpunan kosong dan
 *    "gagal dimuat" tidak bisa dibedakan kalau keduanya diwakili nilai yang
 *    sama — dan yang satu berarti "outlet ini tidak menjual apa pun".
 *
 * 3. Layar admin memakai `validasiSimpan`. Tanpa itu, mencabut centang
 *    terakhir menyimpan nol baris — yang artinya AKTIF DI SEMUA OUTLET,
 *    kebalikan persis dari maksudnya.
 */
const fs = require('fs');
const path = require('path');

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

/** Buang komentar sebelum memindai — sudah berkali-kali jadi sumber lolos/palsu. */
// Pemotong komentar yang MENGHORMATI STRING — lihat tools/lib/tanpa-komentar.cjs.
//
// Versi dua-baris yang dulu disalin ke tiap audit memperlakukan `/*` di dalam
// string (`accept="image/*"`) sebagai awal komentar, lalu menelan puluhan baris
// kode sampai `*/` JSDoc berikutnya. Pada pemeriksaan LARANGAN, itu berarti
// audit hijau karena kodenya sudah terlanjur terhapus.
const { tanpaKomentar } = require('./lib/tanpa-komentar.cjs');

// ---------------------------------------------------------------
// 1. Staff App menyaring, dan menyaring ulang saat outlet berganti.
// ---------------------------------------------------------------
const LAYAR_STAFF = [
  ['js/modules/sales/sales.page.js', 'layar Penjualan'],
  ['js/modules/menu/menu.page.js', 'modul Menu']
];

for (const [rel, nama] of LAYAR_STAFF) {
  const isi = baca(rel);
  if (!isi) continue;
  const kode = tanpaKomentar(isi);

  if (!/listMenuAktifOutlet\s*\(/.test(kode)) {
    salah(
      `${rel}: ${nama} tidak memakai \`listMenuAktifOutlet\`. ` +
        'Seluruh menu BU tetap tampil di semua outlet — pengaturannya tersimpan tapi tidak berpengaruh apa pun.'
    );
    continue;
  }

  // Daftar yang digambar harus yang SUDAH disaring.
  if (!/saringMenu\(\s*menuOutlet\(\)/.test(kode)) {
    salah(
      `${rel}: daftar menunya tidak diambil dari \`menuOutlet()\`. ` +
        'Saringannya dimuat tapi tidak dipakai — persis bentuk kegagalan yang paling sulit terlihat, ' +
        'karena semuanya berjalan tanpa error.'
    );
  }

  // Kegagalan memuat tidak boleh berarti "tidak ada menu".
  if (!/menuAktif\s*\?\s*menus\.filter/.test(kode)) {
    salah(
      `${rel}: \`menuOutlet()\` tidak berjaga terhadap saringan yang belum/gagal dimuat. ` +
        'Himpunan kosong akan menyembunyikan SELURUH menu, dan layar penjualan yang kosong terbaca ' +
        'sebagai aplikasi rusak oleh orang yang sedang menutup shift.'
    );
  }

  // Ganti outlet harus memuat ulang saringannya.
  const iGanti = kode.search(/(outletSel|outletSelect)\s*\.addEventListener\('change'|querySelector\('#[\w-]*outlet[\w-]*'\)[\s\S]{0,40}addEventListener\('change'/);
  if (iGanti === -1) {
    salah(`${rel}: penangan ganti-outlet tidak ditemukan — audit kehilangan sasarannya.`);
  } else {
    // BADAN PENANGANNYA DIAMBIL UTUH, bukan sepotong dari awalnya.
    //
    // Percobaan pertama memakai jendela 900 karakter dan GAGAL pada kode yang
    // sudah benar: komentar dibuang dengan cara diganti spasi (supaya posisi
    // karakternya tetap sepadan), sehingga blok penjelasan yang panjang tetap
    // memakan jendelanya — dan panggilan yang dicari ada sesudah itu.
    //
    // Jendela sepanjang apa pun cuma menunda masalah yang sama. Kurungnya
    // dihitung.
    const sesudah = (() => {
      let j = kode.indexOf('{', iGanti);
      if (j === -1) return '';
      let dalam = 0;
      const awal = j;
      for (; j < kode.length; j++) {
        if (kode[j] === '{') dalam++;
        else if (kode[j] === '}') {
          dalam--;
          if (dalam === 0) break;
        }
      }
      return kode.slice(awal, j + 1);
    })();
    const langsung = /loadMenuAktif\(\)/.test(sesudah);
    const lewatReload = /reload\(\)/.test(sesudah) && /listMenuAktifOutlet[\s\S]{0,400}renderRows/.test(kode);
    if (!langsung && !lewatReload) {
      salah(
        `${rel}: berganti outlet tidak memuat ulang daftar menu aktif. ` +
          'Layarnya akan menampilkan menu outlet SEBELUMNYA — sementara harga & stoknya sudah ikut berganti, ' +
          'jadi hasilnya tidak pernah benar untuk outlet mana pun.'
      );
    }
  }
}

// ---------------------------------------------------------------
// 2. Layar admin per menu memakai validasiSimpan.
// ---------------------------------------------------------------
const adminMenu = baca('js/modules/menu/menu.admin.page.js');
if (adminMenu) {
  const kode = tanpaKomentar(adminMenu);
  if (!/validasiSimpan\s*\(/.test(kode)) {
    salah(
      'js/modules/menu/menu.admin.page.js: menyimpan tanpa `validasiSimpan`. ' +
        'Mencabut centang terakhir akan menyimpan nol baris — yang artinya AKTIF DI SEMUA OUTLET, ' +
        'kebalikan persis dari maksud orang yang baru saja mencabutnya.'
    );
  }
  if (!/if\s*\(\s*!\s*v\.boleh\s*\)/.test(kode)) {
    salah(
      'js/modules/menu/menu.admin.page.js: hasil `validasiSimpan` tidak diperiksa. ' +
        'Memanggil penjaga lalu mengabaikan jawabannya sama saja dengan tidak memanggilnya.'
    );
  }
  // Daftar outletnya harus LENGKAP se-BU.
  if (!/listOutletsForBu\s*\(/.test(kode)) {
    salah(
      'js/modules/menu/menu.admin.page.js: daftar outletnya bukan seluruh outlet BU. ' +
        '`set_menu_outlet` mengganti SELURUH daftar, jadi kotak centang yang tidak lengkap akan MENGHAPUS ' +
        'outlet yang tidak terlihat dari daftar izin menu itu — penghapusan data yang tidak terlihat siapa pun.'
    );
  }
}

// ---------------------------------------------------------------
// 3. Layar massal terdaftar sebagai tab, kalau tidak ia tidak ada.
// ---------------------------------------------------------------
const mainAdmin = baca('js/main-admin.js');
if (mainAdmin) {
  if (!/renderMenuPerOutletTab/.test(mainAdmin)) {
    salah(
      'js/main-admin.js: tab "Menu per Outlet" tidak terdaftar. ' +
        'Layarnya ada di repo tapi tidak bisa dibuka dari mana pun — kemampuannya ada, jalannya tidak ada di layar.'
    );
  } else if (!/menu_per_outlet[^}]*syaratModul:\s*'menu'/.test(mainAdmin)) {
    salah(
      "js/main-admin.js: tab \"Menu per Outlet\" tidak memakai `syaratModul: 'menu'`. " +
        'Kodenya tidak ada di tabel `modules`, jadi tanpa itu tabnya TIDAK PERNAH muncul — ' +
        'dan tab yang disaring keluar tidak meninggalkan jejak apa pun untuk ditelusuri.'
    );
  }
}

// ---------------------------------------------------------------
// 4. Penulisan lewat RPC, bukan lewat tabel.
// ---------------------------------------------------------------
const svc = baca('js/modules/menu/menu-outlet.service.js');
if (svc) {
  if (/from\('menu_outlet_aktif'\)[\s\S]{0,80}\.(insert|update|delete|upsert)\(/.test(svc)) {
    salah(
      'js/modules/menu/menu-outlet.service.js: menulis langsung ke tabel `menu_outlet_aktif`. ' +
        'PostgREST tidak menganggap penolakan RLS sebagai error pada UPDATE/DELETE — staff akan melihat ' +
        'toast hijau dan pengaturan yang tidak berubah. Seluruh penulisan harus lewat RPC yang melempar exception.'
    );
  }
}


// ---------------------------------------------------------------
// 5. Perkiraan "bisa dibuat" tidak boleh dipotong rencana menu yang
//    TIDAK dijual di outlet itu (0116).
// ---------------------------------------------------------------
const halMenu = baca('js/modules/menu/menu.page.js');
if (halMenu) {
  const kode = tanpaKomentar(halMenu);

  if (!/aktif:\s*menuAktif/.test(kode)) {
    salah(
      'js/modules/menu/menu.page.js: `petaPerkiraan`/`rincianBahanMenu` dipanggil tanpa `aktif: menuAktif`. ' +
        'Rencana untuk menu yang outlet ini TIDAK jual akan tetap memotong stok — beras 17.280 gr dengan ' +
        'takaran 200 gr/porsi bisa berbunyi "bahan habis", dan sesudah 0115 barisnya bahkan tidak tampil ' +
        'lagi sehingga penyebabnya tidak ada di layar mana pun.'
    );
  }

  // Panel rincian harus menampilkan SISA, bukan cuma stok mentah.
  if (!/rincianBahanMenu\s*\(/.test(kode)) {
    salah(
      'js/modules/menu/menu.page.js: panel bahan tidak memakai `rincianBahanMenu`. ' +
        'Kolom Stok menampilkan angka MENTAH sementara vonis "bahan habis" dihitung dari SISA — ' +
        'dua angka untuk satu hal di layar yang sama, dan yang menentukan tidak pernah ditampilkan.'
    );
  }
  if (!/<th>Sisa<\/th>/.test(kode)) {
    salah(
      'js/modules/menu/menu.page.js: panel bahan tidak punya kolom Sisa. ' +
        'Tanpa kolom itu, "beras 17.280 gr, takaran 200 gr, tapi bahan habis" adalah pertanyaan ' +
        'yang mustahil dijawab pembacanya.'
    );
  }
}

// ---------------------------------------------------------------
// 6. Modul perkiraan: `aktif` tidak boleh menyaring saat BELUM dimuat.
// ---------------------------------------------------------------
const perkiraan = baca('js/modules/menu/perkiraan.js');
if (perkiraan) {
  if (!/!aktif\s*\|\|\s*aktif\.has\?\.\(/.test(tanpaKomentar(perkiraan))) {
    salah(
      'js/modules/menu/perkiraan.js: penyaring `aktif` tidak berjaga terhadap daftar yang belum/gagal dimuat. ' +
        'Menyaring dengan himpunan kosong membuat SELURUH rencana lenyap dan tiap menu terlihat lebih longgar ' +
        'daripada sebenarnya — terlalu optimis, arah kesalahan yang paling merugikan di layar ini.'
    );
  }
}

if (gagal === 0) {
  console.log('Menu aktif per outlet: tersaring di Staff App, dijaga di admin, tabnya bisa dibuka, dan perkiraan stok tidak dipotong menu yang tidak dijual. ✅');
}
process.exit(gagal === 0 ? 0 : 1);
