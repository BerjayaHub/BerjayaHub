/**
 * AUDIT: unduhan barang terkirim di Admin Portal.
 *
 * ============ CARA FITUR INI RUSAK TANPA TERLIHAT RUSAK ============
 *
 *   dua bentuk disusun terpisah   -> sheet Rincian menjumlahkan 412 kg, sheet
 *                                    Rekap menulis 408 kg, dan tidak ada layar
 *                                    yang bisa menjelaskan selisihnya
 *   `received_qty` NULL jadi 0    -> "Dikirim 100, Diterima 40" untuk barang
 *                                    yang 60-nya masih di jalan; orang mencari
 *                                    barang yang tidak pernah hilang
 *   Selisih dari selisih kolom    -> angka minus besar yang terbaca sebagai
 *                                    kehilangan
 *   kolom angka tanpa `numeric`   -> SUM di Excel nol, dan selnya tetap rapi
 *   saringan tabel & unduhan beda -> layar dan berkas menjawab pertanyaan yang
 *                                    berbeda, dan cuma ketahuan kalau ada yang
 *                                    membandingkan keduanya
 *   `ambilSemua` dilupakan        -> PostgREST memotong ~1.000 baris; totalnya
 *                                    lebih kecil tanpa satu pun galat
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
const bersih = (isi, rel, penanda) => {
  const kode = tanpaKomentar(isi);
  const pesan = periksaKewarasan(isi, kode, penanda);
  if (pesan) salah(`${rel}: ${pesan}`);
  return kode;
};

// ---------------------------------------------------------------
// 1. Modul murni.
// ---------------------------------------------------------------
const modul = baca('js/modules/dispatch/rekap-kiriman.js');
if (modul) {
  const kode = bersih(modul, 'rekap-kiriman.js', ['export function susunRekapKiriman']);

  // SATU fungsi mengembalikan KEDUA bentuk.
  if (!/return \{ rincian, rekap, total:/.test(kode)) {
    salah(
      'rekap-kiriman.js: rincian & rekap tidak lagi dikembalikan dari satu penelusuran. Disusun terpisah, keduanya ' +
        'akan menyimpang — dan menyimpangnya berbentuk dua total yang tidak ada layarnya bisa menjelaskan selisihnya.'
    );
  }

  // `received_qty` NULL bukan NOL.
  if (!/const diterima = qty\(it\.received_qty\);/.test(kode)) {
    salah('rekap-kiriman.js: `received_qty` tidak lagi dibaca lewat `qty()`. `Number(null)` adalah 0 — yang belum diterima ikut terjumlah.');
  }
  if (!/const selisih = diterima === null \? null : diterima - dikirim;/.test(kode)) {
    salah(
      'rekap-kiriman.js: Selisih dihitung juga untuk baris yang belum diterima. "-12" untuk kiriman yang masih di ' +
        'jalan terbaca sebagai barang hilang, padahal belum ada yang menghitungnya.'
    );
  }
  if (!/diterima === null \? '' : diterima,/.test(kode)) {
    salah('rekap-kiriman.js: kolom Diterima diisi 0 untuk yang belum diterima — kosongnya sendiri adalah informasi.');
  }
  // Baris yang belum diterima DIHITUNG SENDIRI. Tanpa angka ini dua kolom
  // lainnya tidak bisa dipercaya.
  if (!/p\.belum \+= 1;/.test(kode) || !/'Belum diterima \(baris\)'/.test(kode)) {
    salah(
      'rekap-kiriman.js: baris yang belum diterima tidak dihitung sendiri. Tanpa kolom itu, "Diterima 40 dari ' +
        'Dikirim 100" terbaca sebagai 60 hilang.'
    );
  }
  // Selisih rekap dijumlahkan PER BARIS.
  if (!/p\.selisih \+= selisih;/.test(kode)) {
    salah('rekap-kiriman.js: Selisih rekap tidak lagi dijumlahkan per baris — dihitung dari selisih kolom, ia jadi angka minus besar.');
  }
  if (!/p\.adaSelisih \? p\.selisih : ''/.test(kode)) {
    salah('rekap-kiriman.js: barang yang belum diterima sama sekali mendapat Selisih 0 — terbaca "cocok", padahal belum ada yang menghitung.');
  }
  // Dikelompokkan per PRODUK.
  if (!/const kunci = it\.product_id \?\? `nama:\$\{teks\(it\.product_name\)\}`;/.test(kode)) {
    salah('rekap-kiriman.js: rekap dikelompokkan lewat nama produk. Dua produk bernama sama akan menjumlahkan kilogram dengan pack.');
  }
  // "Nilai" berarti sama dengan di surat jalan.
  if (!/const nilai = adaHpp \? Number\(hpp\) \* dikirim : null;/.test(kode)) {
    salah(
      'rekap-kiriman.js: "Nilai" tidak lagi HPP × DIKIRIM. `dokumen.js` memakai arti itu untuk satu surat jalan — ' +
        'arti berbeda di dua unduhan membuat satu kiriman terbaca dua angka.'
    );
  }
  if (!/'Nilai Diterima'/.test(kode)) {
    salah('rekap-kiriman.js: nilai versi penerima tidak punya nama sendiri — dua kolom bernama sama yang menghitung hal berbeda.');
  }
  // HPP yang tidak ada dikosongkan, bukan nol.
  if (!/adaHpp \? Number\(hpp\) : ''/.test(kode)) {
    salah('rekap-kiriman.js: HPP yang tidak ada ditulis 0 — "Rp0" terbaca seperti barang gratis.');
  }
  // Kolom angka WAJIB `numeric`.
  for (const [nama, daftar] of [
    ['KOLOM_RINCIAN', kode.slice(kode.indexOf('KOLOM_RINCIAN'), kode.indexOf('KOLOM_REKAP'))],
    ['KOLOM_REKAP', kode.slice(kode.indexOf('KOLOM_REKAP'), kode.indexOf('const teks'))]
  ]) {
    for (const judul of ['Dikirim', 'Diterima', 'Selisih', 'Nilai']) {
      const baris = daftar.split('\n').find((l) => l.includes(`'${judul}'`));
      if (!baris || !/numeric: true/.test(baris)) {
        salah(
          `rekap-kiriman.js ${nama}: kolom "${judul}" tidak bertanda \`numeric\`. Excel menganggapnya teks, SUM-nya ` +
            'nol — dan selnya tetap tampil rapi, jadi tidak ada yang menyadarinya.'
        );
      }
    }
  }
}

// ---------------------------------------------------------------
// 2. Layanannya.
// ---------------------------------------------------------------
const svc = baca('js/modules/dispatch/dispatch.service.js');
if (svc) {
  const kode = bersih(svc, 'dispatch.service.js', ['export async function listItemKirimanAdmin']);
  const i = kode.indexOf('listItemKirimanAdmin');
  const blok = i < 0 ? '' : kode.slice(i, kode.indexOf('export async function listRecentDispatchActivity'));

  if (!/ambilSemua/.test(blok)) {
    salah(
      'dispatch.service.js `listItemKirimanAdmin`: tidak memakai `ambilSemua`. PostgREST memotong di sekitar 1.000 ' +
        'baris — sebulan kiriman satu BU melewatinya, dan yang hilang bukan galat, cuma baris terakhir menurut urutannya.'
    );
  }
  if (!/dispatches!inner\(/.test(blok)) {
    salah('dispatch.service.js: header kiriman tidak di-embed `!inner` — saringan outlet/status/tanggal tidak akan menempel padanya.');
  }
  // Urutan paginasi WAJIB atas kolom milik `dispatch_items` sendiri.
  //
  // `ambilSemua` memanggil `.range()` berulang, dan paginasi tanpa urutan yang
  // pasti membuat halaman kedua memuat baris yang sudah terbawa halaman
  // pertama — sementara yang lain hilang sama sekali. Tidak ada galat;
  // totalnya saja yang salah.
  if (!/\.order\('id'\)/.test(blok)) {
    salah(
      "dispatch.service.js `listItemKirimanAdmin`: tidak diurutkan lewat kolom miliknya sendiri. Paginasi tanpa " +
        'urutan pasti menghasilkan baris kembar di satu halaman dan baris hilang di halaman lain.'
    );
  }
  if (/referencedTable: 'dispatches'/.test(blok)) {
    salah(
      "dispatch.service.js: mengurutkan lewat `referencedTable: 'dispatches'`. PostgREST tidak mengurutkan baris " +
        'TINGKAT ATAS lewat kolom embed to-one — `created_at` bahkan tidak ada di `dispatch_items`.'
    );
  }
  if (!/\.sort\(\(a, b\) => String\(b\.created_at \?\? ''\)/.test(blok)) {
    salah('dispatch.service.js: urutan yang dilihat orang tidak disusun di memori — daftarnya keluar dengan urutan yang tidak dijanjikan siapa pun.');
  }
  if (!/received_qty: it\.received_qty,/.test(blok)) {
    salah(
      'dispatch.service.js: `received_qty` diratakan sebelum sampai ke modul murni. NULL-nya bermakna "belum ' +
        'diterima" — meratakannya jadi 0 di sini membuat seluruh lapisan di atasnya kehilangan bedanya.'
    );
  }
  for (const [nama, pola] of [
    ['BU', /\.eq\('dispatches\.business_unit_id', businessUnitId\)/],
    ['status', /\.eq\('dispatches\.status', status\)/],
    ['outlet asal', /\.eq\('dispatches\.from_outlet_id', fromOutletId\)/],
    ['outlet tujuan', /\.eq\('dispatches\.to_outlet_id', toOutletId\)/]
  ]) {
    if (!pola.test(blok)) salah(`dispatch.service.js \`listItemKirimanAdmin\`: saringan ${nama} tidak ada.`);
  }

  // Tabel & unduhan menyaring dengan sumbu yang SAMA.
  const iAdmin = kode.indexOf('listDispatchesAdmin');
  const blokAdmin = iAdmin < 0 ? '' : kode.slice(iAdmin, iAdmin + 2500);
  if (!/\.eq\('from_outlet_id', fromOutletId\)/.test(blokAdmin) || !/\.eq\('to_outlet_id', toOutletId\)/.test(blokAdmin)) {
    salah(
      'dispatch.service.js `listDispatchesAdmin`: saringan outlet tidak sampai ke server. Menyaringnya di klien ' +
        'atas kolom yang tidak ikut di `select` membuang SELURUH baris — tabelnya berbunyi "Tidak ada data" ' +
        'sementara unduhannya penuh isi.'
    );
  }
}

// ---------------------------------------------------------------
// 3. Layarnya.
// ---------------------------------------------------------------
const hal = baca('js/modules/dispatch/dispatch.admin.page.js');
if (hal) {
  const kode = bersih(hal, 'dispatch.admin.page.js', ['async function unduh']);

  if (!/id="dp-xlsx"/.test(kode) || !/id="dp-pdf"/.test(kode)) {
    salah('dispatch.admin.page.js: tombol unduh barang terkirim tidak digambar — kemampuannya ada, jalannya tidak ada di layar.');
  }
  if (!/id="dp-from-outlet"/.test(kode) || !/id="dp-to-outlet"/.test(kode)) {
    salah('dispatch.admin.page.js: saringan outlet asal/tujuan tidak digambar.');
  }
  // SATU pembaca saringan, dipakai daftar DAN unduhan.
  if (!/function saringan\(container\)/.test(kode)) {
    salah(
      'dispatch.admin.page.js: saringan dibaca terpisah oleh daftar & unduhan. Dua pembacaan akan menyimpang, dan ' +
        'bedanya cuma ketahuan kalau seseorang membandingkan layar dengan berkasnya.'
    );
  }
  if ((kode.match(/saringan\(container\)/g) ?? []).length < 3) {
    salah('dispatch.admin.page.js: `saringan()` tidak dipakai oleh daftar maupun unduhan.');
  }
  // Dua sheet dalam SATU berkas.
  if (!/exportSheetsXLSX\(\{/.test(kode) || !/name: 'Rincian'/.test(kode) || !/name: 'Rekap per Barang'/.test(kode)) {
    salah(
      'dispatch.admin.page.js: kedua bentuk tidak lagi jadi satu berkas dua sheet. Dua berkas terpisah akan berpisah ' +
        'juga di folder unduhan, dan tidak ada apa pun di dalamnya yang bisa memastikan keduanya dari rentang yang sama.'
    );
  }
  // Subjudul menyebut saringannya.
  if (!/function ringkasSaringan\(s, namaOutlet\)/.test(kode) || !/subtitle: catatan/.test(kode)) {
    salah(
      'dispatch.admin.page.js: berkasnya tidak menyebutkan saringan yang aktif. Berkas hasil saringan terlihat ' +
        'seperti laporan LENGKAP di tangan orang yang menerimanya.'
    );
  }
  // Angka "belum diterima" dikatakan, bukan disembunyikan.
  if (!/belum \? ` · \$\{r\.belum\} baris belum diterima` : ''/.test(kode)) {
    salah('dispatch.admin.page.js: jumlah baris yang belum diterima tidak ikut ditulis di berkasnya — dan yang membukanya seminggu lagi cuma punya berkasnya.');
  }
  // `round()` yang tidak pernah dipakai sudah dibuang.
  if (/function round\(/.test(kode)) {
    salah('dispatch.admin.page.js: `round()` hidup lagi tanpa satu pun pemanggil — kode mati yang membuat pembaca berikutnya mengira ia load-bearing.');
  }
}

console.log('');
if (gagal === 0) console.log('Audit rekap barang terkirim bersih. ✅');
else console.error(`${gagal} masalah ditemukan.`);
process.exit(gagal === 0 ? 0 : 1);
