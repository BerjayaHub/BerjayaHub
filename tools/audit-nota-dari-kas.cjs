/**
 * AUDIT: kepala Kas dibekukan + nomor nota di riwayat kas bisa diketuk.
 *
 * ============ CARA FITUR INI BISA RUSAK TANPA TERLIHAT RUSAK ============
 *
 *   `penyesuaian_nota` tidak diambil   -> baris "Penyesuaian nota TRM-…" tidak
 *                                         bisa diketuk, padahal nomornya
 *                                         tertulis persis di layar
 *   satu jalur saja (payment_entry_id) -> idem, dan gejalanya cuma "kadang bisa
 *                                         kadang tidak"
 *   di-escape SEBELUM dipecah          -> kode yang memuat & atau < tidak akan
 *                                         pernah cocok; tautannya hilang diam-diam
 *   escape dilepas saat membungkus     -> keterangan jadi jalan masuk HTML
 *   query nota melempar                -> SELURUH riwayat kas kosong, hanya
 *                                         karena satu query tambahan gagal
 *   `overflow-y` masuk ke mode kartu   -> `overflow-x` ikut jadi auto dan
 *                                         halaman melebar lagi
 *   tinggi riwayat dipatok angka       -> ruang kosong di satu keadaan,
 *                                         halaman ikut menggulir di keadaan lain
 *
 * Tidak satu pun melempar error.
 */
const fs = require('fs');
const path = require('path');
const { tanpaKomentar, periksaKewarasan } = require('./lib/tanpa-komentar.cjs');

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

/**
 * Pemotong komentar + penjaganya. Beberapa pemeriksaan di bawah berbentuk
 * LARANGAN; pada bentuk itu pemotong yang kelebihan makan membuat auditnya
 * HIJAU karena sasarannya sudah terlanjur terhapus.
 */
const bersih = (isi, rel, penanda) => {
  const kode = tanpaKomentar(isi);
  const pesan = periksaKewarasan(isi, kode, penanda);
  if (pesan) salah(`${rel}: ${pesan}`);
  return kode;
};

// ---------------------------------------------------------------
// 1. Modul murni pemecah keterangan.
// ---------------------------------------------------------------
const ket = baca('js/modules/cash/keterangan-nota.js');
if (ket) {
  const kode = bersih(ket, 'keterangan-nota.js', ['export function pecahKeterangan', 'export function petaNotaPerEntri']);

  for (const n of ['pecahKeterangan', 'petaNotaPerEntri']) {
    if (!new RegExp(`export function ${n}\\(`).test(kode)) salah(`keterangan-nota.js: \`${n}\` tidak diekspor.`);
  }

  // KODE TERPANJANG MENANG saat posisinya seri. `TRM-1` adalah awalan
  // `TRM-12`; kalau yang pendek menang, tautannya menunjuk nota yang SALAH dan
  // yang terlihat cuma nomor yang sedikit terpotong.
  if (!/i === posisi && kode\.length > String\(pilih\.code\)\.length/.test(kode)) {
    salah(
      'keterangan-nota.js: pemenang seri tidak lagi ditentukan panjang kodenya. ' +
        '`TRM-1` adalah awalan `TRM-12` — yang pendek akan memotong yang panjang dan menautkan nota yang salah.'
    );
  }
  // Kode kosong: `''.indexOf('')` selalu 0 — putarannya tidak akan pernah maju.
  if (!/\.filter\(\(n\) => n\?\.id && n\?\.code\)/.test(kode)) {
    salah('keterangan-nota.js: nota tanpa id/kode tidak lagi disaring — kode kosong membuat putarannya menggantung.');
  }
  if (!/putaran < BATAS_POTONGAN/.test(kode)) {
    salah('keterangan-nota.js: penjaga putaran hilang.');
  }
  // Nota yang kodenya tidak tertulis tetap ditawarkan.
  if (!/tambahan: daftar\.filter\(\(n\) => !ketemu\.has\(n\.id\)\)/.test(kode)) {
    salah(
      'keterangan-nota.js: nota yang kodenya tidak tertulis di keterangan berhenti ditawarkan. ' +
        'Keterangan boleh diganti orangnya saat membayar — notanya lalu jadi mustahil dibuka, tanpa tanda apa pun.'
    );
  }
  // DUA jalur. `payment_entry_id` saja membuang entri koreksi (0131).
  if (!/if \(n\.payment_entry_id\) tambah\(n\.payment_entry_id, n\)/.test(kode)) {
    salah('keterangan-nota.js: jalur `payment_entry_id` hilang — pembayaran nota jadi tidak punya notanya.');
  }
  if (!/if \(e\?\.penyesuaian_nota\) tambah\(e\.id, perId\.get\(e\.penyesuaian_nota\)\)/.test(kode)) {
    salah(
      'keterangan-nota.js: jalur `penyesuaian_nota` hilang. Entri KOREKSI (0131) tidak ditunjuk `payment_entry_id` ' +
        'siapa pun — tanpa jalur ini, "Penyesuaian nota TRM-…" tidak bisa diketuk padahal nomornya tertulis di layar.'
    );
  }
  if (!/if \(!daftar\.some\(\(x\) => x\.id === nota\.id\)\)/.test(kode)) {
    salah('keterangan-nota.js: nota bisa masuk dua kali ke entri yang sama — nomornya tampil kembar.');
  }
}

// ---------------------------------------------------------------
// 2. Susunan rincian notanya.
// ---------------------------------------------------------------
const rin = baca('js/modules/inventory/rincian-nota.js');
if (rin) {
  const kode = bersih(rin, 'rincian-nota.js', ['export function susunRincianNota', 'hargaBeliBaris(it, hpp)']);

  if (!/export function susunRincianNota\(/.test(kode)) salah('rincian-nota.js: `susunRincianNota` tidak diekspor.');
  // SATU sumber harga, sama dengan `nota_ringkas` di server.
  if (!/hargaBeliBaris\(it, hpp\)/.test(kode)) {
    salah(
      'rincian-nota.js: nilai baris tidak lagi lewat `hargaBeliBaris`. ' +
        'Mengalikan `unit_cost × qty` sendiri meleset ribuan rupiah pada qty yang tidak membagi habis — ' +
        'dan dialog ini dibuka justru saat orang menyandingkannya dengan tagihan supplier.'
    );
  }
  if (!/hargaSatuanBaris\(it, hpp\)/.test(kode)) {
    salah('rincian-nota.js: harga/satuan tidak diturunkan dari harga barisnya — dua kolom di baris yang sama bisa tidak saling mengalikan.');
  }
  if (!/b\.nilai === null \? '-' : formatRupiah\(b\.nilai\)/.test(kode)) {
    salah('rincian-nota.js: baris tanpa harga tidak lagi ditulis "-". Rp0 berarti barangnya gratis — keterangan yang berbeda.');
  }
  if (!/totalTeks: adaNilai \? formatRupiah\(total\) : '-'/.test(kode)) {
    salah('rincian-nota.js: nota yang SELURUH barisnya belum berharga menampilkan Rp0, bukan "-".');
  }
  if (!/\(produk terhapus\)/.test(kode)) {
    salah('rincian-nota.js: produk yang sudah dihapus dari master dibuang — totalnya jadi tidak cocok dengan yang dibayarkan.');
  }
}

// ---------------------------------------------------------------
// 3. Pengambilan notanya.
// ---------------------------------------------------------------
const notaSvc = baca('js/modules/inventory/nota.service.js');
if (notaSvc) {
  const kode = bersih(notaSvc, 'nota.service.js', ['export async function notaTerkaitEntriKas']);
  if (!/export async function notaTerkaitEntriKas\(/.test(kode)) {
    salah('nota.service.js: `notaTerkaitEntriKas` tidak ada.');
  } else {
    if (!/kumpulkan\(entryIds, 'payment_entry_id'\)/.test(kode) || !/kumpulkan\(notaIds, 'id'\)/.test(kode)) {
      salah('nota.service.js `notaTerkaitEntriKas`: salah satu dari dua jalur (payment_entry_id / id) hilang.');
    }
    // Gagal SEBAGIAN tidak boleh mematikan riwayat kas.
    if (!/console\.warn\('\[kas\] gagal mengambil nota terkait:'/.test(kode)) {
      salah('nota.service.js `notaTerkaitEntriKas`: kegagalan query tidak lagi ditelan dengan peringatan — ia akan mematikan seluruh riwayat kas.');
    }
    // KOLOMNYA DIPERIKSA DI DALAM `KOLOM_NOTA_RINGKAS` SAJA, bukan di seluruh
    // berkas.
    //
    // Percobaan pertama cuma menuntut kata `photo_path` MUNCUL di nota.service.js
    // — dan sabotase yang membuangnya dari daftar kolom dialog lolos, karena
    // `riwayatNota` dan parameter `p_photo_path` masih memuatnya beberapa ratus
    // baris jauhnya. Ini bentuk kegagalan yang paling sering terulang di repo
    // ini: pemeriksaan yang hijau karena sasarannya ada di tempat lain.
    const iKol = kode.indexOf('const KOLOM_NOTA_RINGKAS');
    const blokKol = iKol >= 0 ? kode.slice(iKol, kode.indexOf(';', iKol) + 1) : '';
    if (!blokKol) {
      salah('nota.service.js: `KOLOM_NOTA_RINGKAS` tidak ada — daftar kolom dialog rincian nota hilang.');
    } else {
      for (const [kolom, akibat] of [
        ['photo_path', 'dialognya tidak akan pernah punya foto'],
        ['payment_entry_id', 'tidak ada cara memasangkan nota ke entri kas yang melunasinya'],
        ['status', 'nota yang sudah dibatalkan tampil seperti nota biasa'],
        ['code', 'nomornya tidak ada, jadi tidak ada yang bisa dicocokkan dengan keterangan kas']
      ]) {
        if (!blokKol.includes(kolom)) {
          salah(`nota.service.js \`KOLOM_NOTA_RINGKAS\`: kolom \`${kolom}\` tidak ikut diambil — ${akibat}.`);
        }
      }
    }
  }
}

const cashSvc = baca('js/modules/cash/cash.service.js');
if (cashSvc) {
  const kode = bersih(cashSvc, 'cash.service.js', ['export async function listMyCashEntries']);
  const i = kode.indexOf('export async function listMyCashEntries');
  const blok = i >= 0 ? kode.slice(i, kode.indexOf('\n}\n', i)) : '';
  if (!blok) salah('cash.service.js: `listMyCashEntries` tidak ada.');
  else if (!/penyesuaian_nota/.test(blok)) {
    salah(
      'cash.service.js `listMyCashEntries`: `penyesuaian_nota` tidak lagi diambil. ' +
        'Entri koreksi (0131) menyebut notanya di kolom itu — tanpa kolomnya, nomor yang tertulis di layar tidak bisa diketuk.'
    );
  }
}

// ---------------------------------------------------------------
// 4. Dialognya.
// ---------------------------------------------------------------
const dlg = baca('js/modules/inventory/nota-dialog.js');
if (dlg) {
  const kode = bersih(dlg, 'nota-dialog.js', ['export async function bukaDialogNota', 'export function badanDialog']);
  if (!/infoDialog\(/.test(kode)) salah('nota-dialog.js: dialognya tidak dibuka lewat `infoDialog`.');
  // Fotonya dimuat SESUDAH dialog terbuka: URL bertanda tangan butuh satu
  // perjalanan, dan mengetuk nomor yang tidak menghasilkan apa pun selama
  // satu-dua detik akan diketuk lagi.
  if (!/onReady: \(body\) => muatFoto\(body, r\.photoPath\)/.test(kode)) {
    salah('nota-dialog.js: foto tidak lagi dimuat sesudah dialognya terbuka — mengetuk nomor nota jadi terasa tidak berfungsi.');
  }
  if (!/img\?\.addEventListener\('error'/.test(kode)) {
    salah(
      'nota-dialog.js: gambar yang gagal dimuat tidak ditangani. Yang terlihat cuma ikon gambar rusak, ' +
        'dan itu terbaca sebagai "notanya tidak ada" — bukan "tautannya kedaluwarsa/tidak berwenang".'
    );
  }
  if (!/PESAN_FOTO_GAGAL/.test(kode)) {
    salah('nota-dialog.js: sebab foto tidak bisa dibuka tidak dikatakan — izin foto mengikuti OUTLET notanya, bukan BU-nya.');
  }
  // Isi nota gagal dimuat tidak boleh membatalkan dialognya: kepala notanya
  // sudah di tangan dan sering itu saja yang dicari orangnya.
  if (!/gagalItem = error\?\.message/.test(kode)) {
    salah('nota-dialog.js: isi nota yang gagal dimuat membatalkan seluruh dialog, padahal kepala notanya sudah di tangan.');
  }
  if (!/escapeHtml\(sel\)/.test(kode)) salah('nota-dialog.js: isi sel tabel tidak di-escape.');
}

// ---------------------------------------------------------------
// 5. Layar Kas.
// ---------------------------------------------------------------
const page = baca('js/modules/cash/cash.page.js');
if (page) {
  const kode = bersih(page, 'cash.page.js', ['function ketHtml(', 'function ukurRiwayat(', 'class="kas-header"']);

  if (!/class="kas-header"/.test(kode)) salah('cash.page.js: kepala halaman tidak dibungkus `.kas-header` — tidak ada yang bisa dibekukan.');
  if (!/class="table-scroll kas-riwayat"/.test(kode)) salah('cash.page.js: wadah riwayat tidak bertanda `.kas-riwayat` — ia tidak akan menggulir sendiri.');

  // ESCAPE SESUDAH PEMECAHAN, bukan sebelum. Kalau teksnya di-escape dulu,
  // kode nota yang memuat & atau < tidak akan pernah cocok — tautannya hilang
  // tanpa satu pun tanda.
  if (!/pecahKeterangan\(ket, notas \?\? \[\]\)/.test(kode)) {
    salah('cash.page.js `ketHtml`: keterangan tidak lagi dipecah lewat modul murni `pecahKeterangan`.');
  }
  if (!/escapeHtml\(b\.teks\)/.test(kode) || !/escapeHtml\(t\.teks\)/.test(kode)) {
    salah('cash.page.js `ketHtml`: potongan keterangan tidak di-escape — kolom Keterangan jadi jalan masuk HTML.');
  }
  if (!/escapeHtml\(t\.notaId\)/.test(kode)) salah('cash.page.js `ketHtml`: id nota tidak di-escape saat masuk atribut.');
  if (!/class="btn-nota"/.test(kode)) salah('cash.page.js: tombol nomor nota tidak digambar.');
  if (!/\.btn-nota'\)\.forEach/.test(kode)) salah('cash.page.js: tombol nomor nota digambar tapi tidak pernah dipasangi penangan klik.');
  if (!/bukaDialogNota\(/.test(kode)) salah('cash.page.js: dialog rincian nota tidak pernah dibuka.');

  // Riwayat tidak boleh mati karena query tambahan gagal.
  if (!/notaTerkaitEntriKas\([\s\S]{0,200}?\.catch\(\(\) => \[\]\)/.test(kode)) {
    salah(
      'cash.page.js: kegagalan mengambil nota tidak ditangkap. Satu query tambahan yang gagal akan mengosongkan ' +
        'SELURUH riwayat kas — angka yang benar hilang demi tautan yang cuma pelengkap.'
    );
  }

  // Tingginya DIUKUR, bukan dipatok.
  if (!/window\.innerHeight - atas - 16/.test(kode)) {
    salah('cash.page.js `ukurRiwayat`: tinggi riwayat tidak lagi diukur dari sisa layar — kepalanya berubah tinggi dan angka tetap akan salah di salah satu keadaan.');
  }
  if (!/if \(window\.innerWidth <= 560\)/.test(kode)) {
    salah(
      'cash.page.js `ukurRiwayat`: mode kartu (<=560px) tidak lagi dikecualikan. Menyetel tinggi di sana memaksa ' +
        '`overflow-x` ikut jadi `auto` — persis jalan masuk bug "tombol melebarkan halaman".'
    );
  }
  if (!/window\.removeEventListener\('resize', ukurRiwayat\)/.test(kode)) {
    salah('cash.page.js: pendengar `resize` tidak pernah dilepas — satu tertinggal tiap kali orang berpindah modul.');
  }
  if (!/ukurRiwayat\(\);/.test(kode)) salah('cash.page.js: `ukurRiwayat` tidak pernah dipanggil.');
}

// ---------------------------------------------------------------
// 6. CSS-nya.
// ---------------------------------------------------------------
const css = baca('css/styles.css');
if (css) {
  if (!/\.kas-header \{[\s\S]{0,300}?position: sticky/.test(css)) {
    salah('styles.css: `.kas-header` tidak lagi `position: sticky` — saldo & tombolnya ikut tergulir.');
  }
  if (!/\.table-scroll\.kas-riwayat \{[\s\S]{0,200}?overflow-y: auto/.test(css)) {
    salah('styles.css: `.kas-riwayat` tidak lagi menggulir sendiri.');
  }
  if (!/\.table-scroll\.kas-riwayat thead th \{[\s\S]{0,300}?position: sticky/.test(css)) {
    salah('styles.css: judul kolom riwayat tidak dibekukan — angka tanpa judul kolom bisa dibaca sebagai kolom yang salah.');
  }
  // SEMUANYA di dalam @media (min-width: 561px). Di bawah itu `.table-scroll`
  // sengaja `overflow-x: visible`, dan `overflow-y` memaksanya jadi `auto`.
  const iMedia = css.indexOf('@media (min-width: 561px)');
  const iScroll = css.indexOf('.table-scroll.kas-riwayat {');
  if (iMedia < 0 || iScroll < 0 || iScroll < iMedia) {
    salah(
      'styles.css: aturan gulir `.kas-riwayat` tidak lagi berada di dalam `@media (min-width: 561px)`. ' +
        'Di mode kartu, `overflow-y` memaksa `overflow-x` jadi `auto` dan halamannya melebar lagi.'
    );
  }
  // `.btn-nota` harus dikecualikan dari gaya tombol sekunder, kalau tidak ia
  // jadi kotak berlatar di dalam sel tabel — dan tombol berkotak di dalam sel
  // sudah pernah melebarkan halaman.
  const pengecualian = (css.match(/button:not\(\.primary\)[^{]*\{/g) ?? []).join('');
  if (!/:not\(\.btn-nota\)/.test(pengecualian)) {
    salah('styles.css: `.btn-nota` tidak dikecualikan dari gaya tombol sekunder — nomor nota jadi kotak yang menuntut lebar sendiri di dalam sel.');
  }
  if (!/\.btn-nota \{[\s\S]{0,300}?display: inline/.test(css)) {
    salah('styles.css: `.btn-nota` bukan `display: inline` — ia akan memutus kalimat keterangannya dan memakan lebar sel.');
  }
  if (!/\.nota-foto img \{/.test(css)) salah('styles.css: foto nota di dialog tidak punya batas ukuran — foto kamera HP akan memenuhi layar.');
}

if (gagal === 0) {
  console.log(
    'Kas: kepala dibekukan & riwayat menggulir sendiri (kecuali mode kartu), nomor nota dari KEDUA jalur bisa diketuk, ' +
      'dan rinciannya memakai harga baris yang sama dengan yang dibayarkan. ✅'
  );
}
process.exit(gagal === 0 ? 0 : 1);
