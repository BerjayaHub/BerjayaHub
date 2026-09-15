/**
 * AUDIT: Export Excel buku resep.
 *
 * ============ SATU JUDUL KOLOM YANG MENGALIKAN HPP 1800x ============
 *
 * Pengimpor resep membaca `r['yield']`. Kolomnya dulu bertuliskan
 * "Hasil/Yield" — nama itu tidak ditemukan, jadi yield jatuh ke nilai BAWAAN 1.
 * Berkas ekspor yang diunggah untuk mengisi resep kosong (atau menyalin resep
 * ke BU baru) menyetel yield 1800 jadi 1, dan HPP-nya melonjak 1800 kali lipat.
 * Tanpa error, tanpa baris merah.
 *
 * Cara lain fitur ini bisa rusak tanpa terlihat rusak:
 *
 *   penanda resep kosong di kolom Bahan -> berkasnya mencari bahan bernama
 *                                          "(resep kosong — ...)", tepat pada
 *                                          berkas yang dipakai memperbaikinya
 *   ekspor mengabaikan saringan         -> berkas 400 varian padahal layarnya 12
 *   subjudul tak menyebut saringan      -> berkas sebagian tak punya cara mengaku
 *   Yield/Jumlah bukan numeric          -> tidak bisa dipivot di Excel
 *   bahan tanpa harga ditulis 0         -> kolom Biaya terlihat sah, totalnya salah
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
// 1. Judul kolomnya HARUS dikenali pengimpor.
// ---------------------------------------------------------------
const imp = baca('js/modules/product/product-import.js');
const buku = baca('js/modules/product/buku-resep.js');
if (imp && buku) {
  const m = imp.match(/'(Produk,Varian,[^']*)\\n'/);
  if (!m) {
    salah('product-import.js: baris judul `template-resep.csv` tidak ditemukan — pemeriksaan kecocokan kolom kehilangan sasarannya.');
  } else {
    const judulTemplate = m[1].split(',');
    const daftar = blokAntara(tanpaKomentar(buku), 'export const KOLOM_IMPOR_RESEP', ';');
    if (!daftar) {
      salah('buku-resep.js: `KOLOM_IMPOR_RESEP` tidak ada.');
    } else {
      for (const judul of judulTemplate) {
        if (!daftar.includes(`'${judul}'`)) {
          salah(
            `buku-resep.js \`KOLOM_IMPOR_RESEP\`: judul "${judul}" tidak ada, padahal template impor memakainya. ` +
              'Pengimpor membaca berdasarkan NAMA kolom — nama yang meleset dibaca sebagai kosong, dan untuk kolom ' +
              'Yield itu berarti seluruh resep jatuh ke yield 1.'
          );
        }
      }
      const jml = (daftar.match(/'/g) ?? []).length / 2;
      if (jml !== judulTemplate.length) {
        salah(`buku-resep.js \`KOLOM_IMPOR_RESEP\`: berisi ${jml} judul, template impor ${judulTemplate.length}.`);
      }
    }
  }
}

// ---------------------------------------------------------------
// 2. Penyusunnya.
// ---------------------------------------------------------------
if (buku) {
  const kode = bersih(buku, 'buku-resep.js', ['export function susunBukuResep', 'export const KOLOM_IMPOR_RESEP']);

  if (!/export function susunBukuResep\(/.test(kode)) salah('buku-resep.js: `susunBukuResep` tidak diekspor.');

  // Judulnya dipakai dari konstantanya, bukan diulang sebagai literal —
  // judul yang ditulis dua kali akan diperbaiki di satu tempat saja.
  for (const i of [0, 1, 2, 3, 4]) {
    if (!new RegExp(`header: KOLOM_IMPOR_RESEP\\[${i}\\]`).test(kode)) {
      salah(`buku-resep.js: kolom ke-${i + 1} tidak memakai \`KOLOM_IMPOR_RESEP[${i}]\` — judulnya jadi dua salinan yang bisa menyimpang.`);
    }
  }
  // Nama lama tidak boleh hidup lagi.
  if (/'Hasil\/Yield'/.test(kode)) {
    salah(
      "buku-resep.js: kolom 'Hasil/Yield' hidup lagi. Pengimpor mencari `yield`, tidak menemukannya, dan memakai " +
        'nilai bawaan 1 — yield 1800 jadi 1, HPP-nya 1800 kali lipat, tanpa satu pun error.'
    );
  }

  // Penanda resep kosong TIDAK boleh di kolom Bahan.
  if (!/export const CATATAN_RESEP_KOSONG/.test(kode)) {
    salah('buku-resep.js: `CATATAN_RESEP_KOSONG` tidak ada.');
  }
  const blokKosong = blokAntara(kode, 'if (!items.length) {', 'continue;');
  if (!blokKosong) {
    salah('buku-resep.js: cabang resep kosong tidak ditemukan.');
  } else {
    if (!/CATATAN_RESEP_KOSONG\n\s*\]\);/.test(blokKosong) && !/CATATAN_RESEP_KOSONG/.test(blokKosong)) {
      salah('buku-resep.js: resep kosong tidak lagi diberi catatan.');
    }
    if (/'\(resep kosong/.test(blokKosong)) {
      salah(
        'buku-resep.js: penanda resep kosong kembali ditulis di kolom BAHAN. Berkas yang diunggah balik akan mencari ' +
          'bahan bernama "(resep kosong — …)" — satu baris galat untuk tiap resep kosong, tepat pada berkas yang ' +
          'dipakai MEMPERBAIKI resep kosong.'
      );
    }
  }

  // Saringan & kejujuran berkas.
  if (!/const adaSaringan = Boolean\(/.test(kode)) salah('buku-resep.js: saringan tidak lagi dikenali.');
  if (!/adaSaringan \? `Saringan:/.test(kode)) {
    salah('buku-resep.js: subjudul tidak menyebut saringan yang aktif — berkas sebagian jadi tidak punya cara mengaku sebagian.');
  }
  if (!/\$\{jumlahVarian\} dari \$\{varianTotal\} varian resep/.test(kode)) {
    salah('buku-resep.js: subjudul tidak menyebut "sekian dari sekian" — yang menerima berkasnya tidak melihat layar tempat saringannya dipasang.');
  }
  if (!/if \(!lolos\(p\)\) continue;/.test(kode)) salah('buku-resep.js: saringan tidak benar-benar menyaring barisnya.');
  if (!/bakukan\(p\.name\)\.includes\(s\.nama\)/.test(kode)) {
    salah('buku-resep.js: nama tidak dibakukan di kedua sisi — "sirup gula" tidak akan menemukan "Sirup  Gula" berspasi ganda.');
  }

  // Bahan tanpa harga: "-", bukan 0.
  if (!/hpp == null \? '-' : rupiah\(hpp\)/.test(kode)) {
    salah('buku-resep.js: bahan tanpa harga tidak lagi ditulis "-" — Rp0 membuat kolom Biaya terlihat sah dan totalnya bisa dijumlah tanpa curiga.');
  }

  // Yield & Jumlah harus ANGKA di Excel.
  const blokKolom = blokAntara(kode, 'const kolom = [', '];');
  for (const [i, nama] of [[2, 'Yield'], [4, 'Jumlah']]) {
    const pola = new RegExp(`header: KOLOM_IMPOR_RESEP\\[${i}\\][^}]*numeric: true`);
    if (!pola.test(blokKolom)) {
      salah(`buku-resep.js: kolom ${nama} tidak bertanda \`numeric\` — di Excel ia jadi TEKS dan tidak bisa dipivot.`);
    }
  }
}

// ---------------------------------------------------------------
// 3. Layarnya.
// ---------------------------------------------------------------
const page = baca('js/modules/product/product.admin.page.js');
if (page) {
  const kode = bersih(page, 'product.admin.page.js', ['btn-unduh-resep-xlsx', 'susunBukuResep(']);

  if (!/id="btn-unduh-resep-xlsx"/.test(kode)) salah('product.admin.page.js: tombol unduh Excel resep tidak digambar.');

  const blok = blokAntara(kode, 'const susun = () =>', '#btn-unduh-resep-pdf');
  if (!blok) {
    salah('product.admin.page.js: penyusun buku resep tidak ditemukan.');
  } else {
    // SARINGAN DIBACA DARI KOTAK ISIANNYA, bukan dari salinan di memori.
    for (const sel of ['#cari-resep', '#tipe-resep', '#kat-resep', '#sub-resep']) {
      if (!blok.includes(sel)) {
        salah(
          `product.admin.page.js: saringan \`${sel}\` tidak ikut dikirim ke unduhan resep. ` +
            'Berkas yang isinya berbeda dari yang dilihat orangnya adalah perbedaan yang tidak akan pernah ia sadari.'
        );
      }
    }
    if (!/exportSheetsXLSX\(/.test(blok)) salah('product.admin.page.js: sheet Rekap resep tidak ikut ditulis.');
    if (!/sekaliJalan\(/.test(blok)) salah('product.admin.page.js: tombol unduh resep tidak dikunci `sekaliJalan`.');
    if (!/if \(!b\.baris\.length\)/.test(blok)) {
      salah('product.admin.page.js: berkas resep kosong tetap diunduh — orangnya akan mengira unduhannya rusak, bukan saringannya yang tidak cocok.');
    }
    // PDF memakai PENYUSUN YANG SAMA. Kalau ia menyusun sendiri, takarannya
    // akan menyimpang dari berkas Excel, dan resep yang angkanya berbeda antara
    // keduanya tidak bisa dipakai memeriksa apa pun.
    if ((kode.match(/susunBukuResep\(/g) ?? []).length !== 1) {
      salah('product.admin.page.js: `susunBukuResep` dipanggil lebih dari sekali — Excel & PDF harus memakai satu penyusun yang sama.');
    }
  }
}

if (gagal === 0) {
  console.log(
    'Export buku resep: judul kolomnya dikenali pengimpor (yield tidak lagi jatuh ke 1), penanda resep kosong tidak ' +
      'menyamar jadi nama bahan, dan berkasnya mengikuti saringan yang tampil. ✅'
  );
}
process.exit(gagal === 0 ? 0 : 1);
