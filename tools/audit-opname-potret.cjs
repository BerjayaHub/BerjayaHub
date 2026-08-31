/**
 * AUDIT: opname tidak boleh mengirim potret sistem yang dikarang.
 *
 * ============ KEGAGALAN YANG DIJAGA ============
 *
 * Hitungan opname disimpan sebagai SELISIH: `counted_qty − system_qty`.
 * `system_qty` dikirim dari layar, diambil dari peta stok yang dimuat
 * `refresh()`. Dan `refresh()` mengembalikan `null` kalau pemuatannya gagal.
 *
 * Dulu barisnya berbunyi `stockMap?.get(pid) ?? 0`. Ketika petanya null,
 * SETIAP potret sistem jadi 0 — dan selisihnya berubah dari `dihitung − 40`
 * menjadi `dihitung − 0`. Beras yang tercatat 40 lalu dihitung 38 tidak
 * menghasilkan −2 melainkan +38, dan saldonya melonjak ke 78.
 *
 * Yang membuatnya berbahaya: layar menulis "sistem 0" untuk semua bahan, dan
 * itu terlihat MASUK AKAL buat orang yang memang sedang mengisi stok awal.
 * Tidak ada error di mana pun, dan salahnya baru ketahuan berbulan-bulan
 * kemudian sebagai angka opname yang tidak bisa dijelaskan siapa pun.
 *
 * Tiga hal yang dituntut audit ini, dan ketiganya harus ada bersama —
 * masing-masing sendirian bisa ditembus:
 *
 *   1. panel opname MENOLAK dibuka saat peta stoknya tidak ada
 *   2. tombol Simpan memeriksa ULANG, karena panel bisa terbuka lama dan
 *      petanya bisa hilang di tengah jalan
 *   3. saat mengumpulkan isian, petanya dibaca LANGSUNG (`stockMap.get`),
 *      bukan lewat `?.` yang menyembunyikan hilangnya peta
 */
const fs = require('fs');
const path = require('path');

const AKAR = path.dirname(__dirname);
const BERKAS = 'js/modules/inventory/inventory.page.js';
let gagal = 0;
const salah = (pesan) => {
  gagal++;
  console.error(`❌ ${pesan}`);
};

const isi = fs.readFileSync(path.join(AKAR, BERKAS), 'utf8');

/**
 * Badan sebuah penangan `querySelector('#id').addEventListener(...)`.
 *
 * Dihitung dengan menghitung kurung, BUKAN dengan memotong sekian ratus
 * karakter di belakang jangkarnya. Versi pertama audit ini memakai jendela
 * tetap 700 karakter, dan sabotase yang mengembalikan `?? stockMap` LOLOS:
 * polanya mulai di karakter ke-662 dan panjangnya ~40, jadi ujungnya terpotong
 * jendela dan regex-nya tidak pernah cocok.
 *
 * Jendela tetap selalu punya bentuk kegagalan itu — ia bergantung pada panjang
 * komentar di atas kodenya, yang bisa berubah kapan saja tanpa ada yang sadar
 * bahwa auditnya ikut berhenti bekerja.
 */
function badanPenangan(teks, id) {
  const jangkar = teks.indexOf(`#${id}').addEventListener`);
  if (jangkar === -1) return null;
  let dalam = 0;
  let j = teks.indexOf('{', jangkar);
  if (j === -1) return null;
  const awal = j;
  for (; j < teks.length; j++) {
    if (teks[j] === '{') dalam++;
    else if (teks[j] === '}') {
      dalam--;
      if (dalam === 0) return teks.slice(awal, j + 1);
    }
  }
  return null;
}

// ---------------------------------------------------------------
// 0. Sasarannya masih ada.
//
// Kalau baris pengumpul isian berganti bentuk, seluruh audit di bawah
// memeriksa tempat yang salah dan akan hijau tanpa arti. Jadi keberadaannya
// diperiksa lebih dulu, dan ketidakhadirannya dilaporkan GAGAL — bukan
// dilewati diam-diam.
// ---------------------------------------------------------------
const pengumpul = isi.match(/isian\.push\(\{[^}]*\}\);/);
if (!pengumpul) {
  salah(
    `${BERKAS}: tidak menemukan \`isian.push({...})\` di layar opname. ` +
      'Audit ini kehilangan sasarannya, jadi dilaporkan gagal daripada lolos tanpa memeriksa apa pun.'
  );
} else {
  // ---------------------------------------------------------------
  // 3. Peta dibaca langsung, bukan lewat `?.`
  // ---------------------------------------------------------------
  if (/stockMap\?\./.test(pengumpul[0])) {
    salah(
      `${BERKAS}: potret sistem diambil dengan \`stockMap?.get(...)\`. ` +
        'Saat peta stok gagal dimuat, seluruh potret jadi 0 dan penyesuaian opname dihitung dari nol — ' +
        'stok melonjak sebesar seluruh hitungan, tanpa satu pun error. Pakai `stockMap.get(...)` dan tolak lebih dulu kalau petanya tidak ada.'
    );
  }
  if (!/stockMap\.get\(/.test(pengumpul[0])) {
    salah(`${BERKAS}: \`isian.push\` tidak lagi membaca \`stockMap.get(...)\` — dari mana potret sistemnya sekarang?`);
  }
}

// ---------------------------------------------------------------
// 1. Panel menolak dibuka tanpa peta stok.
// ---------------------------------------------------------------
if (!/if\s*\(\s*sesi\s*&&\s*!stockMap\s*\)/.test(isi)) {
  salah(
    `${BERKAS}: panel opname tidak menolak dibuka saat \`stockMap\` tidak ada ` +
      '(dicari `if (sesi && !stockMap)`). Tanpa itu orang bisa menghitung seratus bahan lalu menyimpannya ' +
      'dengan potret sistem nol semua.'
  );
}

// ---------------------------------------------------------------
// 2. Tombol Simpan memeriksa ULANG.
//
// Dicari di dalam badan penangan `#opname-save`, bukan di seluruh berkas:
// pemeriksaan yang ada di tempat lain tidak melindungi penyimpanan.
// ---------------------------------------------------------------
const badanSimpan = badanPenangan(isi, 'opname-save');
if (!badanSimpan) {
  salah(`${BERKAS}: penangan tombol #opname-save tidak ditemukan — audit kehilangan sasarannya.`);
} else if (!/if\s*\(\s*!stockMap\s*\)/.test(badanSimpan)) {
  salah(
    `${BERKAS}: penangan #opname-save tidak memeriksa \`if (!stockMap)\`. ` +
      'Panel opname terbuka lama sambil orangnya menghitung isi rak; yang menentukan benar-salahnya angka ' +
      'adalah keadaan pada DETIK DISIMPAN, bukan detik panelnya dibuka.'
  );
}

// ---------------------------------------------------------------
// 4. Tombol muat ulang di panel opname tidak boleh menyimpan peta BASI.
//
// `?? stockMap` sah untuk sekadar menampilkan stok — data basi lebih berguna
// daripada layar kosong. Untuk opname justru terbalik: potret basi
// menghasilkan selisih yang salah dengan tenang.
// ---------------------------------------------------------------
const badanUlang = badanPenangan(isi, 'opname-ulang');
if (badanUlang && /stockMap\s*=\s*\(await refresh\(\)\)\s*\?\?\s*stockMap/.test(badanUlang)) {
  salah(
    `${BERKAS}: tombol muat ulang opname memakai \`?? stockMap\`, jadi peta BASI dipertahankan saat pemuatan gagal. ` +
      'Untuk opname, potret basi lebih berbahaya daripada tidak ada potret: selisihnya salah tanpa satu pun tanda.'
  );
}


// ---------------------------------------------------------------
// 5. HITUNGAN YANG SUDAH TERSIMPAN WAJIB DIMUAT.
//
// Bug aslinya: layar staff tidak pernah memanggil `itemOpname()`. Fungsinya
// sudah ada di service dan RLS-nya sudah mengizinkan staff membaca — ia cuma
// tidak pernah dipanggil.
//
// Akibatnya kotak isian SELALU kosong, walau rekannya sudah menghitung separuh
// gudang. Orang kedua tidak punya satu pun cara tahu rak mana yang sudah
// didatangi, jadi bahan dihitung dua kali (yang kedua menimpa yang pertama)
// atau tidak dihitung sama sekali karena masing-masing mengira yang lain sudah.
//
// Tidak ada error di mana pun. Layar kosong terlihat persis seperti "belum ada
// yang menghitung" — dan itulah yang membuatnya bertahan.
// ---------------------------------------------------------------
if (!/itemOpname/.test(isi)) {
  salah(
    `${BERKAS}: tidak memanggil \`itemOpname()\`. Panel opname akan selalu tampil kosong, ` +
      'jadi staff kedua tidak bisa tahu bahan mana yang sudah dihitung rekannya — dan menghitung ulang menimpa hasilnya.'
  );
}

// Dipanggil dengan sesi yang sedang terbuka, bukan sekadar disebut namanya di
// suatu tempat (mis. tertinggal di import tanpa dipakai).
if (!/await itemOpname\(sesi\.id\)/.test(isi)) {
  salah(
    `${BERKAS}: \`itemOpname\` disebut tapi tidak dipanggil dengan \`sesi.id\`. ` +
      'Import yang tidak terpakai tidak menampilkan apa pun ke staff.'
  );
}

// Kemajuan dihitung dari yang TERSIMPAN, bukan dari isian lokal.
//
// Versi lama menghitung `draft.has(...)` — isian di HP ini saja — jadi angkanya
// selalu mulai dari 0 tiap panel dibuka. "0 dari 5" pada sesi yang sudah 60%
// selesai bukan sekadar tidak membantu; ia menyuruh orang mengulang pekerjaan
// yang sudah beres.
//
// Diperiksa dengan menuntut sumber yang BENAR (`h.selesai` / `h.total` dari
// `susunDaftar`), bukan dengan melarang satu bentuk tulisan yang salah.
// Sabotase pertama saya lolos justru karena auditnya mencari `draft.has` —
// sementara sabotasenya memakai `[...draft.keys()].length`. Daftar hitam
// bentuk-yang-salah selalu bisa dilewati dengan menulisnya sedikit berbeda;
// menuntut bentuk-yang-benar tidak bisa.
const iKemajuan = isi.indexOf("#opname-kemajuan')");
if (iKemajuan === -1) {
  salah(`${BERKAS}: blok kemajuan opname (#opname-kemajuan) tidak ditemukan — audit kehilangan sasarannya.`);
} else {
  const blok = isi.slice(iKemajuan, iKemajuan + 900);
  if (!/h\.selesai/.test(blok) || !/h\.total/.test(blok)) {
    salah(
      `${BERKAS}: angka kemajuan opname tidak lagi dibaca dari \`h.selesai\`/\`h.total\` (hasil susunDaftar, ` +
        'yang bersumber dari server). Dihitung dari isian lokal, angkanya selalu mulai dari 0 tiap panel dibuka — ' +
        'dan "0 dari 87" pada sesi yang sudah separuh selesai menyuruh orang mengulang pekerjaan yang sudah beres.'
    );
  }
  if (/draft\.(has|keys|size)/.test(blok)) {
    salah(`${BERKAS}: blok kemajuan opname masih membaca \`draft\` — itu isian di perangkat ini saja, bukan pekerjaan tim.`);
  }
}


// ---------------------------------------------------------------
// 6. BAWAAN PENYARING TIDAK BOLEH MENYEMBUNYIKAN YANG SUDAH DIHITUNG.
//
// Hitungan opname bersifat KUMULATIF: kotaknya berisi total outlet, dan orang
// berikutnya menambahkan bagiannya.
//
//   Adhe (kitchen) isi susu 3, simpan
//   Shenda (bar)   punya 1 lagi -> harus MELIHAT 3 supaya bisa mengubah jadi 4
//
// Kalau bawaannya `SARING.BELUM`, baris susu LENYAP dari layar Shenda begitu
// Adhe menyimpan. Shenda tidak punya apa pun untuk ditambah, dan tebakan yang
// paling wajar — mengisi 1, jatahnya sendiri — menghapus hitungan Adhe.
//
// Saya sempat memasangnya sebagai BELUM dengan alasan "sisa pekerjaan jadi
// jelas". Itu alasan yang benar untuk cara kerja yang salah.
// ---------------------------------------------------------------
const mBawaan = isi.match(/const opnameState = \{[^}]*\}/);
if (!mBawaan) {
  salah(`${BERKAS}: \`opnameState\` tidak ditemukan — audit kehilangan sasarannya.`);
} else if (!/saring:\s*SARING\.SEMUA/.test(mBawaan[0])) {
  salah(
    `${BERKAS}: bawaan penyaring opname bukan \`SARING.SEMUA\` (${mBawaan[0].replace(/\s+/g, ' ')}). ` +
      'Hitungannya kumulatif — bahan yang sudah diisi rekan HARUS tetap terlihat, ' +
      'supaya orang berikutnya menambahkan ke angka itu alih-alih menimpanya dengan jatahnya sendiri.'
  );
}

// Peringatan "angka turun" harus benar-benar dipasang, bukan cuma diimpor.
if (!/peringatanTurun\(tersimpan,/.test(isi)) {
  salah(
    `${BERKAS}: \`peringatanTurun()\` tidak dipanggil saat mengetik. ` +
      'Pada hitungan kumulatif, angka baru yang lebih kecil hampir selalu berarti seseorang mengisi ' +
      'jatah divisinya sendiri — dan itu menghapus hitungan rekannya tanpa satu pun tanda.'
  );
}

if (gagal === 0) {
  console.log('Opname: potret sistem tidak dikarang, tidak basi, dan hitungan tersimpan selalu dimuat. ✅');
}
process.exit(gagal === 0 ? 0 : 1);
