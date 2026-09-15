/**
 * AUDIT: Export Excel di Master Produk.
 *
 * ============ CARA FITUR INI BISA RUSAK TANPA TERLIHAT RUSAK ============
 *
 *   judul kolom bergeser          -> berkasnya masih terbuka rapi di Excel,
 *                                    tapi begitu di-upload balik kolom yang
 *                                    tidak dikenali dibaca KOSONG dan harga
 *                                    beli ratusan produk lenyap tanpa pesan
 *   ekspor mengabaikan saringan   -> berkas berisi 785 baris padahal layarnya
 *                                    menampilkan 40; perbedaan yang tidak akan
 *                                    pernah disadari orangnya
 *   subjudul tidak menyebut saringan -> berkas sebagian terkirim lewat WhatsApp
 *                                    tanpa cara apa pun untuk mengaku sebagian
 *   "-" masuk ke kolom impor      -> orang mengetiknya balik apa adanya
 *   kolom nominal tidak numeric   -> SUM-nya nol di Excel, dan justru itu alasan
 *                                    orang minta .xlsx alih-alih PDF
 *   sebabHppKosong dipanggil per baris -> 785 pembangunan graf resep; tabnya
 *                                    menggantung belasan detik tanpa satu tanda
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

const bersih = (isi, rel, penanda) => {
  const kode = tanpaKomentar(isi);
  const pesan = periksaKewarasan(isi, kode, penanda);
  if (pesan) salah(`${rel}: ${pesan}`);
  return kode;
};

const blokAntara = (teks, mulai, selesai) => {
  const i = teks.indexOf(mulai);
  if (i < 0) return '';
  const j = selesai ? teks.indexOf(selesai, i + mulai.length) : -1;
  return teks.slice(i, j > i ? j : undefined);
};

// ---------------------------------------------------------------
// 1. Judul kolomnya HARUS sama dengan template impor.
//
// Dibandingkan LANGSUNG antara dua berkas, bukan dengan daftar yang ditulis
// ulang di audit ini — daftar ketiga cuma menambah satu tempat lagi yang bisa
// menyimpang.
// ---------------------------------------------------------------
const imp = baca('js/modules/product/product-import.js');
const eks = baca('js/modules/product/ekspor-produk.js');
if (imp && eks) {
  const m = imp.match(/'(Nama,Tipe,[^']*)\\n'/);
  if (!m) {
    salah('product-import.js: baris judul `template-produk.csv` tidak ditemukan — pemeriksaan kecocokan kolom kehilangan sasarannya.');
  } else {
    const judulTemplate = m[1].split(',');
    const daftar = blokAntara(tanpaKomentar(eks), 'export const KOLOM_IMPOR', '];');
    if (!daftar) {
      salah('ekspor-produk.js: `KOLOM_IMPOR` tidak ada.');
    } else {
      for (const judul of judulTemplate) {
        if (!daftar.includes(`'${judul}'`)) {
          salah(
            `ekspor-produk.js \`KOLOM_IMPOR\`: judul "${judul}" tidak ada, padahal template impor memakainya. ` +
              'Berkas hasil ekspor yang judulnya bergeser tidak gagal dengan jelas — ia terimpor SEBAGIAN, dan kolom ' +
              'yang tidak dikenali dibaca sebagai kosong.'
          );
        }
      }
      const jml = (daftar.match(/'/g) ?? []).length / 2;
      if (jml !== judulTemplate.length) {
        salah(
          `ekspor-produk.js \`KOLOM_IMPOR\`: berisi ${jml} judul, template impor ${judulTemplate.length}. ` +
            'Jumlah atau urutannya berbeda berarti kolomnya tidak lagi sejajar.'
        );
      }
    }
  }
}

// ---------------------------------------------------------------
// 2. Modul murninya.
// ---------------------------------------------------------------
if (eks) {
  const kode = bersih(eks, 'ekspor-produk.js', ['export function susunEksporProduk', 'export const KOLOM_IMPOR']);

  for (const n of ['susunEksporProduk', 'catatanProduk']) {
    if (!new RegExp(`export function ${n}\\(`).test(kode)) salah(`ekspor-produk.js: \`${n}\` tidak diekspor.`);
  }
  // KOLOM_PRODUK wajib MEMAKAI KOLOM_IMPOR, bukan mengulang judulnya sebagai
  // literal. Judul yang ditulis dua kali akan diperbaiki di satu tempat saja.
  if (!/header: KOLOM_IMPOR\[0\]/.test(kode)) {
    salah('ekspor-produk.js: `KOLOM_PRODUK` tidak memakai `KOLOM_IMPOR` — judulnya jadi dua salinan yang bisa menyimpang.');
  }

  // Saringan dipakai lewat aturan yang SAMA dengan layar.
  if (!/cocokSaringan\(/.test(kode)) {
    salah('ekspor-produk.js: tidak memakai `cocokSaringan` — aturan saringnya jadi tiruan yang akan menyimpang dari tabelnya.');
  }
  if (!/bakukanNama\(p\?\.name\)/.test(kode) || !/bakukanNama\(saring\?\.nama \?\? ''\)/.test(kode)) {
    salah(
      'ekspor-produk.js: nama tidak dibakukan di KEDUA sisi. Mengetik "gula pasir" untuk "Gula  Pasir" yang berspasi ' +
        'ganda akan menghasilkan berkas kosong, dan berkas kosong terbaca sebagai data hilang.'
    );
  }

  // Kosong vs "-": dua arti yang tidak boleh tertukar.
  if (!/h === null \? '-' : formatRupiah\(h\)/.test(kode)) {
    salah('ekspor-produk.js: HPP yang tak bisa dihitung tidak lagi ditulis "-" — sel kosong di situ terbaca seperti isian yang terlupa.');
  }
  for (const [kolom, pola] of [
    ['Satuan Beli', /isRaw \? teks\(p\?\.purchase_unit\) : ''/],
    ['Isi per Satuan Beli', /formatNum\(Number\(p\.purchase_qty\), 4\) : ''/],
    ['Harga Beli', /formatRupiah\(Number\(p\.purchase_price\)\) : ''/],
    ['Harga Jual', /isMenu && jual !== null \? formatRupiah\(jual\) : ''/]
  ]) {
    if (!pola.test(kode)) {
      salah(
        `ekspor-produk.js: kolom "${kolom}" tidak lagi ditulis sebagai sel KOSONG saat tidak berlaku. ` +
          'Kolom ini dibaca pengimpor — "-" di dalamnya akan diketik balik orang apa adanya.'
      );
    }
  }

  // Berkas yang SEBAGIAN harus mengaku.
  if (!/adaSaringan \? `Saringan:/.test(kode)) {
    salah('ekspor-produk.js: subjudul tidak lagi menyebut saringan yang aktif — berkas sebagian jadi tidak punya cara mengaku sebagian.');
  }
  if (!/\$\{rincian\.length\} dari \$\{semua\.length\} produk/.test(kode)) {
    salah('ekspor-produk.js: subjudul tidak menyebut "sekian dari sekian" — yang menerima berkasnya tidak melihat layar tempat saringannya dipasang.');
  }

  // Non-finite & "Number('') adalah 0".
  if (!/Number\.isFinite\(n\) \? n : null/.test(kode)) {
    salah('ekspor-produk.js: angka non-finite tidak disaring — `Infinity` lolos ke formatRupiah sebagai "Rp∞".');
  }
  if (!/v === null \|\| v === undefined \|\| v === ''/.test(kode)) {
    salah("ekspor-produk.js: string kosong tidak disaring lebih dulu — `Number('')` adalah 0, jadi harga yang belum diisi akan tampil sebagai Rp0.");
  }

  // `sebabHppKosong` membangun ulang graf resep TIAP PANGGILAN.
  if (/sebabHppKosong/.test(kode)) {
    salah(
      'ekspor-produk.js: memanggil `sebabHppKosong`. Fungsi itu membangun ulang seluruh graf resep tiap kali; untuk ' +
        '785 produk berarti 785 pembangunan graf, dan tabnya menggantung belasan detik tanpa satu pun tanda.'
    );
  }
  // Peringatan harga tertukar dipakai apa adanya, bukan ditulis ulang.
  if (!/curigaHargaTertukar\(p\)/.test(kode)) {
    salah('ekspor-produk.js: tidak memakai `curigaHargaTertukar` — peringatan "cek satuan" jadi dua kalimat untuk satu aturan.');
  }

  const numerik = (kode.match(/numeric: true/g) ?? []).length;
  if (numerik < 8) {
    salah(
      `ekspor-produk.js: hanya ${numerik} kolom bertanda \`numeric\`. Kolom rupiah yang jadi TEKS di Excel tidak bisa ` +
        'dijumlahkan — dan menjumlahkan itulah alasan orang meminta .xlsx alih-alih PDF.'
    );
  }
}

// ---------------------------------------------------------------
// 3. Tombolnya di layar.
// ---------------------------------------------------------------
const page = baca('js/modules/product/product.admin.page.js');
if (page) {
  const kode = bersih(page, 'product.admin.page.js', ['btn-export-product', 'susunEksporProduk(']);

  if (!/id="btn-export-product"/.test(kode)) salah('product.admin.page.js: tombol Export Excel tidak digambar.');
  if (!/susunEksporProduk\(/.test(kode)) salah('product.admin.page.js: ekspornya tidak disusun lewat modul murni.');
  if (!/exportSheetsXLSX\(/.test(kode)) salah('product.admin.page.js: berkasnya tidak ditulis (sheet Produk + Rekap).');

  const blok = blokAntara(kode, "getElementById('btn-export-product')", '\n  );');
  if (!blok) {
    salah('product.admin.page.js: tombol Export Excel tidak dipasangi penangan klik.');
  } else {
    // SARINGAN DIBACA DARI KOTAK ISIANNYA, bukan dari salinan di memori. Dua
    // sumber kebenaran soal "apa yang sedang tampil" pasti menyimpang.
    for (const sel of ['#cari-produk', '#tipe-produk', '#kat-produk', '#sub-produk']) {
      if (!blok.includes(sel)) {
        salah(
          `product.admin.page.js: saringan \`${sel}\` tidak ikut dikirim ke ekspor. ` +
            'Berkas yang isinya berbeda dari yang dilihat orangnya adalah perbedaan yang tidak akan pernah ia sadari.'
        );
      }
    }
    if (!/sekaliJalan\(/.test(blok)) {
      salah('product.admin.page.js: tombol ekspor tidak dikunci `sekaliJalan` — menekannya dua kali menulis dua berkas sekaligus.');
    }
    if (!/if \(!b\.rincian\.length\)/.test(blok)) {
      salah('product.admin.page.js: berkas kosong tetap diunduh — orangnya akan mengira ekspornya rusak, bukan saringannya yang tidak cocok.');
    }
  }
}

if (gagal === 0) {
  console.log(
    'Export Master Produk: sembilan kolom pertamanya sejajar dengan template impor, ekspornya mengikuti saringan yang ' +
      'tampil dan mengakuinya di subjudul, dan kolom nominalnya tetap ANGKA di Excel. ✅'
  );
}
process.exit(gagal === 0 ? 0 : 1);
