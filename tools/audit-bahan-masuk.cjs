/**
 * AUDIT: ekspor bahan masuk satu rentang tanggal.
 *
 * ============ APA YANG SEBENARNYA DIJAGA ============
 *
 * Berkas ini dipakai orang untuk mencocokkan tagihan supplier. Seluruh cara ia
 * bisa gagal berbentuk sama: berkasnya tetap rapi, kolomnya lengkap, totalnya
 * masuk akal — hanya saja angkanya salah. Tidak satu pun melempar error.
 *
 *   nota batal ikut terhitung   -> pembelian terlihat lebih besar
 *   `unit_cost × qty` dipakai   -> meleset ribuan karena pembulatan
 *   baris tanpa harga jadi 0    -> total lebih kecil, tanpa tanda
 *   sebagian nota gagal diambil -> beberapa nota hilang, tanpa tanda
 *
 * Yang terakhir itu yang paling mahal, dan paling mudah masuk kembali: pola
 * `.catch(() => [])` sudah dipakai di layar rincian per nota (di sana benar —
 * satu dialog kosong langsung kelihatan salah) dan menyalinnya ke sini berarti
 * berkas yang kekurangan nota tanpa jejak apa pun.
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
// 1. Harga beli baris: SATU jawaban, dan `line_total` menang.
// ---------------------------------------------------------------
const harga = baca('js/modules/inventory/harga-baris.js');
if (harga) {
  const kode = tanpaKomentar(harga);
  for (const fn of ['hargaBeliBaris', 'hargaSatuanBaris']) {
    if (!new RegExp(`export function ${fn}\\(`).test(kode)) salah(`harga-baris.js: \`${fn}\` tidak diekspor.`);
  }
  if (!/const total = angkaAtauNull\(item\.line_total\);\s*\n\s*if \(total !== null\) return total;/.test(kode)) {
    salah(
      'harga-baris.js: `line_total` tidak lagi menang lebih dulu. ' +
        'Sejak 0123 itulah angka yang DIKETIK ORANG; menghitung ulang dari `unit_cost` meleset karena pembulatan ' +
        '(100.000 dibagi 3 lalu dikali 3 kembali = 99.999).'
    );
  }
  // Berkas murni: tidak boleh mengimpor apa pun, supaya bisa diuji tanpa browser.
  if (/^\s*import\s/m.test(kode)) {
    salah('harga-baris.js: ada `import` — modul ini sengaja tanpa impor supaya bisa diuji tanpa browser.');
  }
  // `Number('')` adalah 0. Kolom kosong tidak boleh terbaca sebagai harga nol.
  if (!/v === ''/.test(kode)) {
    salah(
      "harga-baris.js: string kosong tidak disaring sebelum `Number()`. " +
        "`Number('')` adalah 0, bukan NaN — kolom harga yang kosong akan terbaca sebagai barang gratis."
    );
  }
}

// ---------------------------------------------------------------
// 2. Laporan per nota memakai jawaban yang sama.
//
// Kalau layar rincian dan berkas rentang memberi total yang berbeda untuk nota
// yang sama, keduanya berhenti bisa dipakai berdebat dengan supplier — dan yang
// membacanya tidak punya cara tahu mana yang benar.
// ---------------------------------------------------------------
const lapNota = baca('js/modules/inventory/laporan-nota.js');
if (lapNota) {
  const kode = tanpaKomentar(lapNota);
  if (!/hargaBeliBaris\(/.test(kode)) {
    salah(
      'laporan-nota.js: tidak memakai `hargaBeliBaris`. ' +
        'Server (`nota_ringkas`, `bayar_nota`) sudah memakai `coalesce(line_total, qty * unit_cost)` sejak 0123; ' +
        'layar yang menghitung sendiri akan menyimpang tanpa ada yang menandainya.'
    );
  }
  if (/const nilai = harga == null \? null : harga \* jumlah;/.test(kode)) {
    salah('laporan-nota.js: nilainya masih dihitung `harga × jumlah` di layar, bukan diambil dari `line_total`.');
  }
}

// ---------------------------------------------------------------
// 3. Laporan rentang: nota batal dibuang, dan jumlahnya DISEBUT.
// ---------------------------------------------------------------
const lapRentang = baca('js/modules/inventory/laporan-bahan-masuk.js');
if (lapRentang) {
  const kode = tanpaKomentar(lapRentang);
  for (const n of ['susunBahanMasuk', 'KOLOM_BAHAN_MASUK', 'KOLOM_REKAP_BAHAN']) {
    if (!new RegExp(`export (?:function|const) ${n}\\b`).test(kode)) salah(`laporan-bahan-masuk.js: \`${n}\` tidak diekspor.`);
  }
  if (!/n\.status === STATUS_BATAL/.test(kode)) {
    salah(
      'laporan-bahan-masuk.js: nota batal tidak disaring. ' +
        'Barangnya sudah ditarik dari stok (0131); ikut menghitungnya membuat total pembelian lebih besar dari yang sebenarnya.'
    );
  }
  if (!/notaBatal\+\+/.test(kode)) {
    salah(
      'laporan-bahan-masuk.js: nota batal dibuang tanpa dihitung. ' +
        'Penyaringan yang diam membuat orang mengira ada nota yang hilang.'
    );
  }
  if (!/notaBatal \? `\$\{notaBatal\} nota batal/.test(kode)) {
    salah('laporan-bahan-masuk.js: jumlah nota batal tidak disebut di subjudul berkasnya.');
  }
  if (!/barisTanpaHarga\+\+/.test(kode)) {
    salah(
      'laporan-bahan-masuk.js: baris tanpa harga tidak dihitung. ' +
        'Kegagalan yang paling mungkin lolos di laporan pembelian adalah total yang rapi tapi lebih kecil dari seharusnya.'
    );
  }
  // "-" dan bukan Rp0 untuk yang belum berharga, di KEDUA sheet.
  if (!/r\.nilai === null \? '-'/.test(kode) || !/g\.adaNilai \? formatRupiah\(g\.nilai\) : '-'/.test(kode)) {
    salah("laporan-bahan-masuk.js: baris/bahan tanpa harga tidak ditulis \"-\". Rp0 membuat total terlihat sah padahal kurang.");
  }
  // Kolom uang harus numeric — justru menjumlahkan itulah alasan orang minta xlsx.
  const blokRincian = kode.slice(kode.indexOf('KOLOM_BAHAN_MASUK'), kode.indexOf('KOLOM_REKAP_BAHAN'));
  if (!/header: 'Harga beli'[^}]*numeric: true/.test(blokRincian)) {
    salah("laporan-bahan-masuk.js: kolom 'Harga beli' tidak ditandai numeric — di Excel ia jadi teks dan tidak bisa dijumlahkan.");
  }
}

// ---------------------------------------------------------------
// 4. Pengambilan datanya: satu permintaan bertahap, bukan 43 permintaan.
// ---------------------------------------------------------------
const svc = baca('js/modules/inventory/nota.service.js');
if (svc) {
  const kode = tanpaKomentar(svc);
  const i = kode.indexOf('export async function itemNotaBanyak');
  if (i < 0) {
    salah('nota.service.js: `itemNotaBanyak` tidak ada — ekspornya akan memanggil `itemNota` puluhan kali berurutan.');
  } else {
    const blok = kode.slice(i, i + 1400);
    if (!/ambilSemua\(/.test(blok)) {
      salah(
        'nota.service.js `itemNotaBanyak`: tidak memakai `ambilSemua`. ' +
          'PostgREST memotong diam-diam di sekitar 1000 baris — satu bulan pembelian melewatinya, dan yang hilang ' +
          'adalah baris terakhir tanpa satu pun error.'
      );
    }
    if (!/receipt_id/.test(blok)) {
      salah('nota.service.js `itemNotaBanyak`: `receipt_id` tidak ikut diambil — barisnya tidak bisa dipasangkan kembali ke notanya.');
    }
    if (!/line_total/.test(blok)) {
      salah('nota.service.js `itemNotaBanyak`: `line_total` tidak ikut diambil — harga beli barisnya hilang.');
    }
    if (!/slice\(i, i \+ POTONG\)/.test(blok)) {
      salah(
        'nota.service.js `itemNotaBanyak`: daftar id tidak dipotong. ' +
          'Daftar `in.(uuid,…)` ikut masuk URL, dan URL yang terlalu panjang ditolak 414 — dengan pesan yang tidak ' +
          'menyinggung jumlah nota sama sekali.'
      );
    }
  }
}

// ---------------------------------------------------------------
// 5. Layarnya: tombolnya ada, memakai filter yang sedang tampil, dua sheet,
//    dan kegagalannya tidak ditelan.
// ---------------------------------------------------------------
const hal = baca('js/modules/inventory/nota.admin.js');
if (hal) {
  const kode = tanpaKomentar(hal);
  if (!/id="nt-ekspor"/.test(kode)) {
    salah('nota.admin.js: tombol ekspor rentang tidak ada di layar.');
  }
  if (!/#nt-ekspor'\)\.addEventListener/.test(kode)) {
    salah('nota.admin.js: tombol ekspor tidak dipasangi penangan — tombol yang tidak melakukan apa-apa lebih buruk daripada tidak ada.');
  }
  if (!/itemNotaBanyak\(notaTampil\.map/.test(kode)) {
    salah('nota.admin.js: ekspornya tidak mengambil isi nota lewat `itemNotaBanyak`.');
  }
  // Yang diekspor HARUS daftar yang sedang terlihat. Membaca ulang kotak
  // tanggalnya membuka celah: orang mengubah tanggal tanpa menekan
  // "Tampilkan", lalu berkasnya berisi rentang yang berbeda dari tabelnya.
  if (!/notas: notaTampil/.test(kode)) {
    salah(
      'nota.admin.js: yang diekspor bukan daftar yang sedang terlihat. ' +
        'Berkas yang isinya berbeda dari tabel di layarnya adalah kegagalan yang tidak akan pernah dicurigai.'
    );
  }
  if (!/exportSheetsXLSX\(/.test(kode)) {
    salah('nota.admin.js: tidak memakai `exportSheetsXLSX` — rekap per bahan tidak akan ikut dalam berkasnya.');
  }
  const iEkspor = kode.indexOf('#nt-ekspor');
  const blokEkspor = iEkspor >= 0 ? kode.slice(iEkspor) : '';
  if (!/name: 'Rincian'/.test(blokEkspor) || !/name: 'Rekap per Bahan'/.test(blokEkspor)) {
    salah('nota.admin.js: berkasnya tidak berisi dua sheet (Rincian + Rekap per Bahan).');
  }
  if (/itemNotaBanyak\([^)]*\)[\s\S]{0,80}\.catch\(\(\) => \[\]\)/.test(blokEkspor)) {
    salah(
      'nota.admin.js: kegagalan mengambil isi nota ditelan `.catch(() => [])`. ' +
        'Untuk satu dialog itu benar — kosongnya langsung kelihatan. Untuk berkas ekspor artinya beberapa nota hilang ' +
        'tanpa jejak, dan yang memakainya sedang mencocokkan tagihan.'
    );
  }
}

// ---------------------------------------------------------------
// 6. Penulis xlsx tetap SATU.
//
// Bug `Number('')` dulu harus diperbaiki di dua berkas sekaligus karena
// loader-nya disalin. Dua penulis sheet akan mengulang persis pelajaran itu.
// ---------------------------------------------------------------
const xlsx = baca('js/core/xlsx.js');
if (xlsx) {
  const kode = tanpaKomentar(xlsx);
  if (!/export async function exportSheetsXLSX\(/.test(kode)) {
    salah('js/core/xlsx.js: `exportSheetsXLSX` tidak ada — satu berkas dua sheet tidak mungkin.');
  }
  if (!/return exportSheetsXLSX\(\{ filename, sheets: \[/.test(kode)) {
    salah(
      'js/core/xlsx.js: `exportTableXLSX` tidak lagi meneruskan ke `exportSheetsXLSX`. ' +
        'Dua salinan penulis xlsx pasti menyimpang pada perbaikan berikutnya — persis yang terjadi pada loader-nya dulu.'
    );
  }
  if (!/while \(terpakai\.has\(nama\)\)/.test(kode)) {
    salah(
      'js/core/xlsx.js: nama sheet kembar tidak dicegah. ' +
        'Excel menolak berkas dengan dua sheet bernama sama — yang gagal bukan tampilannya, melainkan membuka berkasnya.'
    );
  }
}

if (gagal === 0) {
  console.log(
    'Ekspor bahan masuk: line_total menang, nota batal dibuang & disebut, baris tanpa harga dihitung, ' +
      'pengambilannya bertahap, dan berkasnya dua sheet dari satu penulis. ✅'
  );
}
process.exit(gagal === 0 ? 0 : 1);
