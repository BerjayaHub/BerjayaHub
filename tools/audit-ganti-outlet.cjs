/**
 * AUDIT: berganti outlet harus benar-benar mengganti SEMUANYA.
 *
 * ============ DUA BUG YANG DILAPORKAN, SATU AKAR ============
 *
 *   "outlet sudah saya ubah ke ab sentul tetapi di tabel, jumlah stock yang
 *    tampil masih di ab serpong"
 *
 *   Satu layar menulis "sistem 155 gr" di panel opname, sementara tabel di
 *   bawahnya menulis 15.871 untuk bahan yang sama.
 *
 * Penyebabnya satu baris: penangan ganti-outlet memanggil `refresh()` dan
 * MEMBUANG hasilnya. Peta stok di layar digambar ulang, tapi variabel
 * `stockMap` tetap memegang outlet lama — dan `stockMap` itulah yang dipakai
 * saringan Kategori, kotak Cari, dan seluruh panel opname.
 *
 * Gejalanya menipu: tabel terlihat BENAR sesaat sesudah berganti outlet, lalu
 * kembali ke angka lama begitu ada yang mengetik di kotak cari. Itu sebabnya
 * laporannya berbunyi "terkadang".
 *
 * ============ YANG KETIGA, DAN PALING MERUGIKAN ============
 *
 * Panel yang MEMEGANG outlet harus ditutup saat outletnya berganti. Nota dan
 * bahan-menipis sudah ditutup sejak awal; panel OPNAME tidak ikut — padahal ia
 * memegang SESI milik outlet lama. Hitungan fisik yang diketik sesudah
 * berganti outlet masuk ke sesi outlet SEBELUMNYA, dan saat sesi itu ditutup,
 * stok outlet yang salah yang disesuaikan.
 *
 * Tidak ada error di mana pun, dan layarnya bahkan terlihat wajar.
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

// ---------------------------------------------------------------
// 1. Setiap `refresh()` hasilnya dipakai.
//
// `refresh()` mengembalikan peta stok yang baru. Memanggilnya tanpa memasang
// hasilnya berarti layar tergambar ulang tapi ingatannya tidak — dan seluruh
// pembaca `stockMap` sesudahnya memakai outlet yang salah.
// ---------------------------------------------------------------
/**
 * Buang komentar sebelum memindai.
 *
 * Percobaan pertama audit ini melaporkan TIGA pelanggaran palsu — ketiganya
 * kata `refresh()` yang kebetulan ada di dalam komentar penjelasan. Audit yang
 * mengeluh tentang komentar akan cepat diabaikan, dan audit yang diabaikan
 * sama saja dengan tidak ada.
 *
 * Barisnya diganti spasi (bukan dihapus) supaya nomor barisnya tetap benar
 * saat dilaporkan — pesan yang menunjuk baris yang salah lebih membingungkan
 * daripada tidak menyebut baris sama sekali.
 */
const tanpaKomentar = isi
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));

const panggilan = [...tanpaKomentar.matchAll(/^[ \t]*(.*?)\brefresh\(\)/gm)];
if (panggilan.length < 2) {
  salah(
    `${BERKAS}: hampir tidak ada panggilan \`refresh()\` (${panggilan.length}). ` +
      'Audit ini kehilangan sasarannya, jadi dilaporkan gagal daripada lolos tanpa memeriksa apa pun.'
  );
}

for (const m of panggilan) {
  const awalan = m[1];
  const baris = tanpaKomentar.slice(0, m.index).split('\n').length;

  // Definisi fungsinya sendiri, bukan pemanggilan.
  if (/async function/.test(awalan)) continue;

  if (!/stockMap\s*=/.test(awalan)) {
    salah(
      `${BERKAS}:${baris}: \`refresh()\` dipanggil tanpa memasang hasilnya ke \`stockMap\` (awalan: "${awalan.trim()}"). ` +
        'Layar tergambar ulang tapi ingatannya tidak: saringan Kategori dan kotak Cari akan mengembalikan angka outlet LAMA, ' +
        'dan panel opname menampilkan stok sistem outlet yang salah.'
    );
  }
}

// ---------------------------------------------------------------
// 2. Panel opname ditutup saat outlet berganti.
// ---------------------------------------------------------------
const iHandler = isi.indexOf("outletSelect.addEventListener('change'");
if (iHandler === -1) {
  salah(`${BERKAS}: penangan ganti-outlet tidak ditemukan — audit kehilangan sasarannya.`);
} else {
  let dalam = 0;
  let j = isi.indexOf('{', iHandler);
  const awal = j;
  for (; j < isi.length; j++) {
    if (isi[j] === '{') dalam++;
    else if (isi[j] === '}') {
      dalam--;
      if (dalam === 0) break;
    }
  }
  const badan = isi.slice(awal, j + 1);

  if (!/opnameState\.open\s*=\s*false/.test(badan)) {
    salah(
      `${BERKAS}: penangan ganti-outlet tidak menutup panel opname (\`opnameState.open = false\`). ` +
        'Panelnya memegang SESI milik outlet lama — hitungan yang diketik sesudah berganti outlet masuk ke sesi ' +
        'outlet SEBELUMNYA, dan stok outlet yang salah yang disesuaikan saat sesi itu ditutup.'
    );
  }

  if (!/stockMap\s*=\s*\(await refresh\(\)\)/.test(badan)) {
    salah(
      `${BERKAS}: penangan ganti-outlet tidak memasang ulang \`stockMap\`. ` +
        'Inilah baris yang membuat tabel stok "kembali ke outlet lama" begitu kotak Cari disentuh.'
    );
  }

  if (!/async\s*\(\s*\)\s*=>/.test(isi.slice(iHandler, iHandler + 80))) {
    salah(
      `${BERKAS}: penangan ganti-outlet bukan \`async\`, jadi \`await refresh()\` di dalamnya tidak mungkin benar.`
    );
  }
}


// ---------------------------------------------------------------
// 3. Penggambaran panel opname yang KETINGGALAN harus berhenti sendiri.
//
// `renderOpnamePanel()` menunggu dua panggilan jaringan sebelum menggambar.
// Outletnya bisa sudah berganti selama menunggu — dan panggilan lama itu tetap
// jalan sampai selesai, lalu menimpa panel dengan sesi outlet SEBELUMNYA.
//
// Menutup panel saja (bagian 2 di atas) TIDAK menutup lubang ini: penggambaran
// yang sudah lewat pemeriksaan `opnameState.open` di awal tidak akan
// memeriksanya lagi sesudah `await`.
// ---------------------------------------------------------------
const iRender = isi.indexOf('async function renderOpnamePanel');
if (iRender === -1) {
  salah(`${BERKAS}: \`renderOpnamePanel\` tidak ditemukan — audit kehilangan sasarannya.`);
} else {
  let dalam = 0;
  let j = isi.indexOf('{', iRender);
  const awal = j;
  for (; j < isi.length; j++) {
    if (isi[j] === '{') dalam++;
    else if (isi[j] === '}') {
      dalam--;
      if (dalam === 0) break;
    }
  }
  const badan = isi.slice(awal, j + 1);

  // Nomornya harus benar-benar NAIK.
  //
  // Sabotase `const giliran = opnameGiliran` (tanpa `++`) lolos dari versi
  // pertama audit ini: perbandingannya masih ada, tapi selalu sama, jadi
  // `basi()` tidak pernah benar dan penjaganya jadi hiasan.
  if (!/const giliran = \+\+opnameGiliran/.test(badan)) {
    salah(
      `${BERKAS}: nomor giliran tidak dinaikkan (\`const giliran = ++opnameGiliran\`). ` +
        'Tanpa kenaikan itu, perbandingannya selalu sama dan penjaga basi tidak pernah menyala.'
    );
  }

  if (!/giliran\s*!==\s*opnameGiliran/.test(badan) || !/outletSaat\s*!==\s*state\.outletId/.test(badan)) {
    salah(
      `${BERKAS}: \`renderOpnamePanel\` tidak punya penjaga basi yang lengkap ` +
        '(nomor giliran DAN outlet dibandingkan). Tanpa keduanya, penggambaran yang ketinggalan ' +
        'akan menimpa panel dengan sesi outlet lama — pemilih outlet menunjuk satu outlet, panelnya outlet lain.'
    );
  }

  // Tiap `await` DI JALUR PENGGAMBARAN harus diikuti pemeriksaan `basi()`.
  //
  // "Jalur penggambaran" = `await` yang benar-benar dijalankan oleh
  // `renderOpnamePanel` sendiri — BUKAN yang berada di dalam penangan klik
  // bersarang. `await` di dalam penangan tidak perlu dijaga: penangan hanya
  // bisa berbunyi dari panel yang sedang tampil, dan panel outlet lama sudah
  // dikosongkan sebelum sempat diklik.
  //
  // Dua percobaan sebelumnya memakai batas berdasarkan POSISI (sebelum
  // `panel.innerHTML` terakhir, lalu sebelum `addEventListener` pertama).
  // Keduanya salah, karena penangan bersarang tersebar di tengah badan, di
  // antara dua `await` yang justru harus dijaga. Jadi sarangnya dilacak
  // sungguhan: kedalaman kurung kurawal saja tidak cukup — `try { }` juga
  // menambah kedalaman tanpa membuat konteks baru — yang dihitung hanya
  // kurawal yang MEMBUKA BADAN FUNGSI.
  const jalurGambar = badan;

  const dalamFungsiBersarang = (() => {
    const hasil = [];
    const tumpukan = [];
    for (let k = 0; k < jalurGambar.length; k++) {
      const c = jalurGambar[k];
      if (c === '{') {
        const sebelum = jalurGambar.slice(Math.max(0, k - 60), k);
        tumpukan.push(/=>\s*$/.test(sebelum) || /\bfunction\b[^{}]*\)\s*$/.test(sebelum));
      } else if (c === '}') {
        tumpukan.pop();
      } else if (jalurGambar.startsWith('await', k) && !/\w/.test(jalurGambar[k - 1] ?? ' ')) {
        hasil.push({ i: k, bersarang: tumpukan.some(Boolean) });
      }
    }
    return hasil;
  })();

  const wajibDijaga = dalamFungsiBersarang.filter((a) => !a.bersarang);
  if (wajibDijaga.length < 2) {
    salah(
      `${BERKAS}: jalur penggambaran \`renderOpnamePanel\` hampir tidak punya \`await\` yang tidak bersarang ` +
        `(${wajibDijaga.length}). Audit ini kehilangan sasarannya, jadi dilaporkan gagal daripada lolos tanpa memeriksa apa pun.`
    );
  }
  for (const a of wajibDijaga) {
    // JENDELANYA DIPOTONG DI `} catch`, dan itu yang membuat pemeriksaan ini
    // berarti.
    //
    // Versi pertama memakai jendela 400 karakter apa adanya. Sabotase yang
    // mencabut `basi()` sesudah `await itemOpname(...)` LOLOS — karena
    // jendelanya menjangkau terus sampai ke `} catch (error) { if (basi())`,
    // dan penjaga milik blok penanganan error dihitung sebagai penjaga milik
    // jalur suksesnya. Dua penjaga yang berbeda maksud, dianggap satu.
    const penuh = jalurGambar.slice(a.i + 5, a.i + 405);
    const potong = penuh.search(/\}\s*catch\b/);
    const sesudah = potong === -1 ? penuh : penuh.slice(0, potong);
    if (!/basi\(\)/.test(sesudah)) {
      salah(
        `${BERKAS}: ada \`await\` di jalur penggambaran \`renderOpnamePanel\` yang tidak diikuti pemeriksaan \`basi()\` ` +
          `(sesudahnya: "${sesudah.split('\n').slice(0, 2).join(' ').trim().slice(0, 90)}…"). ` +
          'Titik tunggu tanpa pemeriksaan adalah persis tempat panel outlet lama bisa menimpa layar.'
      );
    }
  }
}

if (gagal === 0) {
  console.log('Ganti outlet: peta stok ikut berganti, panel yang memegang outlet ditutup, dan penggambaran yang ketinggalan berhenti sendiri. ✅');
}
process.exit(gagal === 0 ? 0 : 1);
