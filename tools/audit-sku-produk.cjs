/**
 * AUDIT: kode SKU produk — template unduh-isi-unggah, dan pemetaan yang tahan
 * banting.
 *
 * ============ CARA FITUR INI RUSAK TANPA TERLIHAT RUSAK ============
 *
 *   sel kosong menghapus kodenya    -> unggahan berikutnya membuang ratusan
 *                                      kode yang sudah diisi, diam-diam
 *   dicocokkan lewat NAMA           -> satu produk yang namanya dibetulkan di
 *                                      antara unduh dan unggah mendapat kode
 *                                      milik produk lain
 *   seluruh baris ikut dikirim      -> 647 `updated_at` berubah tanpa ada yang
 *                                      berubah; riwayatnya tak terbaca lagi
 *   string kosong tidak dirapikan   -> `''` bentrok dengan `''` lain, dan
 *                                      produk kedua yang belum berkode ditolak
 *   bentrok diserahkan ke indeks    -> 23505 yang menyebut nama indeks, dan
 *                                      satu bentrokan membatalkan 646 baris
 *   `sku` diminta sebelum 0148 jalan -> PostgREST menolak SELURUH permintaan
 *                                      `listProducts`, dan hampir seluruh
 *                                      aplikasi ikut mati
 *   template ditulis berjudul       -> berkasnya dibaca kembali oleh aplikasi
 *                                      ini sendiri, dan datanya bergeser
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
// 1. Migration 0148.
// ---------------------------------------------------------------
const mig = baca('supabase/migrations/0148_sku_produk.sql');
if (mig) {
  if (!/alter table products add column if not exists sku text;/.test(mig)) {
    salah('0148: kolom `sku` tidak ditambahkan.');
  }
  // UNIKNYA PARSIAL — pilihan ukuran, bukan penjaga kebenaran. Lihat catatan
  // panjang di 0148: Postgres menganggap tiap NULL berbeda, jadi produk yang
  // belum berkode tetap lolos tanpa klausa ini. Diperiksa langsung, bukan
  // diduga.
  if (!/create unique index if not exists idx_produk_sku_unik[\s\S]{0,200}where sku is not null;/.test(mig)) {
    salah(
      '0148: indeks uniknya tidak lagi parsial. Ini pilihan UKURAN, bukan penjaga kebenaran — Postgres menganggap ' +
        'tiap NULL berbeda, jadi produk yang belum berkode tetap lolos tanpa klausa ini. Yang hilang: indeks yang ' +
        'memuat 647 baris padahal cuma belasan yang berisi.'
    );
  }
  if (!/on products \(business_unit_id, lower\(btrim\(sku\)\)\)/.test(mig)) {
    salah(
      '0148: uniknya tidak per BU, atau tidak mengabaikan huruf besar-kecil & spasi tepi. Manusia menyalin kode ' +
        'dari Excel apa adanya, dan "BCK-001" vs "bck-001 " akan lolos jadi dua produk berkode sama.'
    );
  }
  if (!/update products set sku = null where sku is not null and btrim\(sku\) = '';/.test(mig)) {
    salah("0148: string kosong tidak dirapikan jadi null — `''` akan bentrok dengan `''` lain.");
  }

  if (!/create or replace function ubah_sku_produk\(p_bu uuid, p_items jsonb\)/.test(mig)) {
    salah('0148: `ubah_sku_produk` tidak ada.');
  }
  const iFn = mig.indexOf('function ubah_sku_produk');
  const fn = iFn < 0 ? '' : mig.slice(iFn, mig.indexOf('$$;', iFn));
  if (!/if not is_bu_admin\(v_uid, p_bu\) then\s+raise exception/.test(fn)) {
    salah('0148 `ubah_sku_produk`: tidak memeriksa is_bu_admin — fungsinya `security definer`, jadi siapa pun bisa.');
  }
  // INTI: sel kosong DILEWATI, bukan menghapus kode.
  if (!/where coalesce\(btrim\(x->>'sku'\), ''\) <> ''/.test(fn)) {
    salah(
      '0148 `ubah_sku_produk`: baris berkode kosong ikut diproses. Mengosongkan sel di Excel adalah cara paling ' +
        'wajar mengatakan "yang ini jangan diapa-apakan" — memperlakukannya sebagai perintah menghapus akan ' +
        'membuang ratusan kode yang sudah diisi, diam-diam.'
    );
  }
  // Bentrokan diperiksa SENDIRI, bukan diserahkan ke indeks uniknya.
  if (!/if v_pemilik is not null then/.test(fn)) {
    salah(
      '0148 `ubah_sku_produk`: bentrokan diserahkan ke indeks uniknya. Ia melempar 23505 yang menyebut nama indeks ' +
        'dan bukan produk mana yang bertabrakan — dan karena seluruhnya satu transaksi, satu bentrokan membatalkan ' +
        '646 baris lain tanpa satu pun penjelasan.'
    );
  }
  if (!/and p\.id <> r\.id/.test(fn)) {
    salah('0148 `ubah_sku_produk`: produk dihitung bentrok dengan dirinya sendiri — tidak ada kode yang bisa disimpan ulang.');
  }
  if (!/and \(p\.sku is distinct from r\.sku\)/.test(fn)) {
    salah('0148 `ubah_sku_produk`: baris yang nilainya sudah sama ikut ditulis — `updated_at` berubah tanpa ada yang berubah.');
  }
  // LAPIS KEDUA, dan diakui begitu: pencarian nama di atasnya sudah menolak id
  // milik BU lain. Dijaga karena kedua penjaganya bisa dicabut satu per satu.
  //
  // DICARI DI DALAM PERNYATAAN `update`-nya, bukan di seluruh fungsi. Versi
  // pertama menanyakan "apakah `and p.business_unit_id = p_bu` ada" — kalimat
  // itu juga ada di pencarian nama beberapa baris di atasnya, jadi mencabutnya
  // dari `update` tetap hijau. Jebakan sasaran-di-tempat-lain, untuk kesekian
  // kalinya di repo ini.
  const iUpd = fn.indexOf('update products p');
  const upd = iUpd < 0 ? '' : fn.slice(iUpd, fn.indexOf(';', iUpd));
  if (!upd) salah('0148 `ubah_sku_produk`: pernyataan `update products` tidak ditemukan.');
  else if (!/and p\.business_unit_id = p_bu/.test(upd)) {
    salah('0148 `ubah_sku_produk`: lapis kedua pembatas BU pada update-nya dicabut.');
  }
}

// ---------------------------------------------------------------
// 2. Modul murninya.
// ---------------------------------------------------------------
const murni = baca('js/modules/product/sku-template.js');
if (murni) {
  const kode = bersih(murni, 'sku-template.js', ['export function susunPerubahanSku']);
  for (const f of ['barisTemplateSku', 'bacaTemplateSku', 'susunPerubahanSku', 'pesanPerubahanSku', 'normalSku']) {
    if (!new RegExp(`export function ${f}\\(`).test(kode)) salah(`sku-template.js: \`${f}\` tidak diekspor.`);
  }
  // Posisi kolomnya DITURUNKAN dari judulnya.
  if (!/export const KOL_ID = KOLOM_SKU\.indexOf\(/.test(kode) || !/export const KOL_SKU = KOLOM_SKU\.indexOf\(/.test(kode)) {
    salah('sku-template.js: posisi kolom ID/SKU ditulis sebagai angka — kolom yang ditambah membuatnya menunjuk sel yang salah.');
  }
  // INTI: sel kosong dilewati.
  if (!/if \(!sku\) \{\s*kosong \+= 1;\s*continue;/.test(kode)) {
    salah('sku-template.js: sel kosong tidak lagi dilewati — unggahan berikutnya akan menghapus kode yang sudah diisi.');
  }
  // INTI: dicocokkan lewat ID.
  if (!/const p = peta\.get\(b\.id\);/.test(kode)) {
    salah(
      'sku-template.js: barisnya tidak dicocokkan lewat ID. Nama berubah di antara unduh dan unggah, dan dua produk ' +
        'bisa bernama sama — keduanya membuat kode mendarat di produk yang salah, tanpa satu pun galat.'
    );
  }
  if (!/if \(teks\(p\.sku\) === sku\) \{\s*sama \+= 1;/.test(kode)) {
    salah('sku-template.js: yang nilainya sudah sama ikut dikirim — 647 baris yang tidak mengubah apa pun.');
  }
  // Header DICARI, bukan diasumsikan di baris pertama.
  if (!/const iHeader = isi\.findIndex\(/.test(kode)) {
    salah('sku-template.js: baris header diasumsikan di posisi tetap — baris judul tambahan akan menggeser seluruh datanya.');
  }
  if (!/const cId = header\.indexOf\(KOLOM_SKU\[KOL_ID\]\)/.test(kode)) {
    salah('sku-template.js: kolomnya tidak dicari lewat judulnya — kolom yang dipindah orang akan terbaca salah.');
  }
  if (!/if \(!dilapor\.has\(k\)\)/.test(kode)) {
    salah(
      'sku-template.js: laporan kode kembar dikumpulkan lewat kalimatnya, bukan lewat kunci yang sudah disamakan. ' +
        '"SAMA" dan "sama " akan jadi dua laporan untuk SATU bentrokan.'
    );
  }
  // Tanda baca TIDAK dibuang: "BCK-001" dan "BCK001" berbeda bagi ESB.
  if (/replace\(\/\[\^a-z0-9\]/.test(kode)) {
    salah('sku-template.js: normalisasinya membuang tanda baca — dua kode berbeda akan ditahan sebagai kembar.');
  }
  // MENU tidak ikut di template; NONAKTIF ikut.
  if (!/p\.product_type !== 'finished'/.test(kode)) {
    salah('sku-template.js: menu ikut di template — kodenya tidak dipakai di mana pun dan cuma memanjangkan daftar yang diisi tangan.');
  }
  if (/is_active/.test(kode)) {
    salah('sku-template.js: produk nonaktif disaring keluar — nota lamanya masih perlu diekspor, dan kodenya tetap harus benar.');
  }
}

// ---------------------------------------------------------------
// 3. Layanannya.
// ---------------------------------------------------------------
const svc = baca('js/modules/product/product.service.js');
if (svc) {
  const kode = bersih(svc, 'product.service.js', ['export async function listProducts']);
  if (!/export async function ubahSkuProduk\(businessUnitId, items\)/.test(kode)) {
    salah('product.service.js: `ubahSkuProduk` tidak ada.');
  }
  // `listProducts` DIPAKAI BELASAN LAYAR. Kolom baru yang belum ada di
  // database akan membuat PostgREST menolak seluruh permintaan — dan yang mati
  // bukan satu kolom melainkan hampir seluruh aplikasi.
  if (!/return await ambil\(`\$\{KOLOM\}, sku`\);/.test(kode)) {
    salah('product.service.js: `sku` tidak diminta — kolomnya ada di database tapi tidak pernah sampai ke layar.');
  }
  if (!/if \(!\/\\bsku\\b\/\.test\(String\(e\?\.message \?\? ''\)\)\) throw e;/.test(kode)) {
    salah(
      'product.service.js: tidak ada jalan mundur saat `sku` belum ada, atau galat lain ikut ditelan. `listProducts` ' +
        'dipakai Master Produk, Bahan, Order, Pengiriman, Menu, dan rekap waste — satu kolom yang belum ada akan ' +
        'mematikan hampir seluruh aplikasi di jeda antara push dan menjalankan migration.'
    );
  }
  if (!/return await ambil\(KOLOM\);/.test(kode)) {
    salah('product.service.js: tingkat paling bawahnya hilang — jalan mundurnya tidak sampai ke mana pun.');
  }
}

// ---------------------------------------------------------------
// 4. Layarnya.
// ---------------------------------------------------------------
const hal = baca('js/modules/product/product.admin.page.js');
if (hal) {
  const kode = bersih(hal, 'product.admin.page.js', ['async function unggahSku']);
  for (const id of ['btn-tpl-sku', 'btn-unggah-sku']) {
    if (!new RegExp(`id="${id}"`).test(kode)) {
      salah(`product.admin.page.js: tombol #${id} tidak ada — kemampuannya ada, jalannya tidak ada di layar.`);
    }
    if (!new RegExp(`getElementById\\('${id}'\\)`).test(kode)) {
      salah(`product.admin.page.js: tombol #${id} tidak disambungkan ke apa pun.`);
    }
  }
  // Template ditulis dengan header di BARIS PERTAMA. `exportTableXLSX`
  // menyisipkan judul & subjudul — bagus untuk laporan, salah untuk berkas
  // yang dibaca kembali oleh aplikasi ini sendiri.
  if (!/aoa_to_sheet\(\[KOLOM_SKU, \.\.\.baris\]\)/.test(kode)) {
    salah('product.admin.page.js: template SKU tidak disusun sebagai [header, ...baris] — datanya akan bergeser saat dibaca kembali.');
  }
  if (/exportTableXLSX\(\{[^}]*KOLOM_SKU/.test(kode)) {
    salah('product.admin.page.js: template SKU ditulis lewat `exportTableXLSX` yang menyisipkan baris judul.');
  }
  // DITAMPILKAN DULU, BARU DISIMPAN — dicari DI DALAM `unggahSku`.
  //
  // Versi pertama mencari `confirmDialog({` di seluruh berkas. Berkas ini punya
  // `confirmDialog` lain (hapus produk) yang letaknya jauh di atas, jadi
  // sabotase yang mencabut konfirmasi dari `unggahSku` tetap hijau: urutannya
  // masih benar terhadap konfirmasi milik fitur yang sama sekali lain.
  const iUnggah = kode.indexOf('async function unggahSku(');
  const fnUnggah = iUnggah < 0 ? '' : kode.slice(iUnggah, kode.indexOf('\n}', iUnggah));
  if (!fnUnggah) salah('product.admin.page.js: `unggahSku` tidak ditemukan — audit ini kehilangan sasarannya.');
  const iKonfirm = fnUnggah.indexOf('await confirmDialog({');
  const iSimpan = fnUnggah.indexOf('ubahSkuProduk(businessUnitId');
  if (!fnUnggah || iKonfirm < 0 || iSimpan < 0 || iSimpan < iKonfirm) {
    salah(
      'product.admin.page.js: unggahan SKU langsung disimpan tanpa ringkasan. Ia menyentuh ratusan baris, dan salah ' +
        'berkas adalah kesalahan yang wajar — templatenya menumpuk di folder Downloads dengan nama yang mirip.'
    );
  }
  if (!/const sisa = hasil\.ubah\.length - r\.diubah;/.test(kode)) {
    salah('product.admin.page.js: hasil dari database tidak dibandingkan dengan yang dikirim — "0 tersimpan" dilaporkan sebagai berhasil.');
  }
}

// ---------------------------------------------------------------
// 5. Pemetaan ESB memakai kodenya — inilah alasan fitur ini dibuat.
// ---------------------------------------------------------------
const esb = baca('js/modules/inventory/esb.admin.js');
if (esb) {
  const kode = bersih(esb, 'esb.admin.js', ["#esb-cocokkan"]);
  if (!/const kodeEsb = new Map\(/.test(kode)) {
    salah(
      'esb.admin.js: pencocokan otomatis tidak memakai kode SKU. Nama adalah jembatan yang putus saat salah satu ' +
        'ujungnya diganti — dan keduanya memang diganti: produk diubah namanya di Master Produk, ESB merapikan ' +
        'ejaannya sendiri. Kode tidak ikut berubah; itulah seluruh alasan fitur ini dibuat.'
    );
  }
  // KODE DIDAHULUKAN DARI NAMA — dan sungguh DIPAKAI.
  //
  // Versi pertama cuma membandingkan urutan dua baris. Sabotase yang mengganti
  // isinya jadi `const lewatSku = null;` lolos: barisnya masih di tempat yang
  // benar, cuma tidak mengerjakan apa pun lagi. Urutan baris bukan bukti
  // perilaku.
  if (!/const lewatSku = sku \? kodeEsb\.get\(sku\) : null;/.test(kode)) {
    salah('esb.admin.js: kode SKU tidak lagi dipakai mencari padanan ESB-nya.');
  }
  if (!/if \(lewatSku\) \{\s*usul\.push\(\{ jenis: j, kunci: k, nilai: lewatSku \}\);/.test(kode)) {
    salah('esb.admin.js: hasil pencocokan lewat kode tidak diusulkan — dihitung lalu dibuang.');
  }
  const iSku = kode.indexOf('const lewatSku =');
  const iNama = kode.indexOf('const cocok = idx.get(normal(k));');
  if (iSku < 0 || iNama < 0 || iSku > iNama) {
    salah('esb.admin.js: nama masih didahulukan dari kode — pemetaan yang putus tidak akan tertolong.');
  }
  if (!/j === 'item' \? namaKeSku\.get\(normal\(k\)\) : null/.test(kode)) {
    salah('esb.admin.js: kode dipakai untuk jenis selain item — lima jenis lain tidak punya kode di Berjaya Hub.');
  }
}

console.log('');
if (gagal === 0) console.log('Audit kode SKU bersih. ✅');
else console.error(`${gagal} masalah ditemukan.`);
process.exit(gagal === 0 ? 0 : 1);
