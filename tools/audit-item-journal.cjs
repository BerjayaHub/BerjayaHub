/**
 * AUDIT: ekspor waste/spoil ke ESB Item Journal.
 *
 * ============ CARA FITUR INI RUSAK TANPA TERLIHAT RUSAK ============
 *
 * Semuanya berakhir sebagai berkas yang DITERIMA ESB tanpa keluhan. Tidak ada
 * satu pun yang melempar galat di layar mana pun.
 *
 *   berkas gabungan beberapa outlet -> seluruhnya masuk ke outlet yang dipilih
 *                                      saat impor. Stok outlet lain berkurang
 *                                      di ESB tanpa pernah berkurang di sini,
 *                                      dan baru ketahuan saat opname
 *   header di baris 1               -> ESB membaca "ESB Item Journal Template"
 *                                      sebagai nama kolom pertamanya
 *   Value per Unit dikirim 0        -> "bahannya gratis" — pernyataan yang
 *                                      BERBEDA dari "belum tahu". Nilai
 *                                      kerugiannya lebih kecil dari yang
 *                                      sebenarnya, dan angkanya terlihat wajar
 *   Mode jadi Add                   -> stoknya BERTAMBAH sebanyak yang terbuang
 *   purpose tidak terdaftar         -> petanya tidak pernah terisi, seluruh
 *                                      waste tertahan, dan tidak ada satu pun
 *                                      baris di layar untuk membereskannya
 *   ditandai sebelum berkasnya jadi -> waste hilang dari daftar tanpa pernah
 *                                      sampai ke ESB
 *   tidak ada jalan membuka tandanya -> satu-satunya jalan keluar SQL Editor
 *
 * Yang diperiksa di sini adalah SAMBUNGANNYA — hal-hal yang tidak bisa
 * dijangkau tes murni karena letaknya di layar dan di layanan.
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
// 1. Migration 0146.
// ---------------------------------------------------------------
const mig = baca('supabase/migrations/0146_ekspor_waste_esb.sql');
if (mig) {
  for (const k of ['esb_exported_at', 'esb_exported_by', 'esb_dibatalkan_at', 'esb_dibatalkan_by', 'esb_alasan_batal']) {
    if (!new RegExp(`add column if not exists ${k}\\b`).test(mig)) {
      salah(`0146: kolom \`${k}\` tidak ditambahkan ke waste_runs.`);
    }
  }
  // `if not exists` pada KELIMA kolom. Satu yang tertinggal membuat migration
  // ini gagal saat dijalankan ulang — dan yang menjalankannya tidak punya cara
  // tahu seberapa jauh ia sempat berjalan sebelum berhenti.
  const nKolom = (mig.match(/alter table waste_runs add column if not exists/g) ?? []).length;
  if (nKolom < 5) salah(`0146: hanya ${nKolom} dari 5 kolom memakai \`if not exists\`.`);

  // Jenis 'purpose' DI KEDUA tabel. Blok keduanya diperiksa terpisah: pola yang
  // dicari "ada atau tidak" buta terhadap kerusakan di salah satu dari dua
  // tempat, dan jebakan itu sudah beberapa kali menggigit di repo ini.
  for (const t of ['esb_master', 'esb_map']) {
    const i = mig.indexOf(`alter table ${t}\n  add constraint`);
    const blok = i < 0 ? '' : mig.slice(i, mig.indexOf(';', i));
    if (!blok) {
      salah(`0146: constraint jenis ${t} tidak dibuat ulang.`);
      continue;
    }
    if (!/'purpose'/.test(blok)) {
      salah(
        `0146: ${t} tidak menerima jenis 'purpose'. Pemetaan Purpose gagal disimpan, dan SELURUH waste tertahan ` +
          'dengan alasan yang tidak bisa dibereskan dari layar mana pun.'
      );
    }
    // Memperlebar `check` berarti MENGETIK ULANG seluruh daftarnya. Satu yang
    // tertinggal menutup seluruh pemetaan jenis itu — diam-diam.
    for (const j of ['branch', 'location', 'unit', 'item', 'payment_method', 'coa', 'supplier']) {
      if (!new RegExp(`'${j}'`).test(blok)) salah(`0146: jenis '${j}' HILANG dari check ${t}.`);
    }
  }
  const nCari = (mig.match(/select conname into v_nama from pg_constraint/g) ?? []).length;
  if (nCari < 2) {
    salah(
      `0146: nama constraint lama dicari di katalog hanya di ${nCari} dari 2 blok. Nama itu SUDAH pernah berubah ` +
        '(0144 membuatnya ulang dengan nama eksplisit), jadi menebaknya menggagalkan migration di tengah jalan.'
    );
  }

  if (!/create or replace function tandai_waste_esb\(p_waste uuid\[\]\)/.test(mig)) {
    salah('0146: `tandai_waste_esb` tidak ada — waste yang sudah diekspor akan ditawarkan lagi dan stoknya dipotong dua kali di ESB.');
  }
  if (!/create or replace function batalkan_tanda_waste_esb\(p_waste uuid\[\], p_alasan text\)/.test(mig)) {
    salah('0146: `batalkan_tanda_waste_esb` tidak ada — satu-satunya jalan keluar kembali jadi SQL Editor.');
  }
  const iBatal = mig.indexOf('function batalkan_tanda_waste_esb');
  const fnBatal = iBatal < 0 ? '' : mig.slice(iBatal, mig.indexOf('$$;', iBatal));
  if (!/alasan_batal_esb_sah\(p_alasan\)/.test(fnBatal)) {
    salah('0146: pembatalan tanda waste tidak menuntut alasan — jejak tanpa alasan tidak menjawab pertanyaan apa pun nanti.');
  }
  if (!/and w\.esb_exported_at is not null/.test(fnBatal)) {
    salah(
      '0146: waste yang TIDAK bertanda ikut ditulisi jejak pembatalan. Penelusuran nanti akan menemukan pembatalan ' +
        'yang tidak pernah terjadi, dan tidak ada cara membedakannya dari yang sungguhan.'
    );
  }
  const iTandai = mig.indexOf('function tandai_waste_esb');
  const fnTandai = iTandai < 0 ? '' : mig.slice(iTandai, mig.indexOf('$$;', iTandai));
  if (!/and w\.esb_exported_at is null/.test(fnTandai)) {
    salah('0146: `tandai_waste_esb` menghitung ulang yang sudah bertanda — "3 waste ditandai" muncul untuk 0 yang sungguh baru.');
  }
  for (const [nama, fn] of [
    ['tandai_waste_esb', fnTandai],
    ['batalkan_tanda_waste_esb', fnBatal]
  ]) {
    if (!/is_bu_admin\(v_uid, w\.business_unit_id\)/.test(fn)) {
      salah(`0146: \`${nama}\` tidak memeriksa is_bu_admin — fungsinya \`security definer\`, jadi tanpa itu siapa pun bisa menyentuh waste BU mana pun.`);
    }
  }
}

// ---------------------------------------------------------------
// 2. Modul murninya.
// ---------------------------------------------------------------
const murni = baca('js/modules/inventory/esb-journal.js');
if (murni) {
  const kode = bersih(murni, 'esb-journal.js', ['export function barisEsbJournal']);

  for (const f of ['barisEsbJournal', 'ringkasJournal']) {
    if (!new RegExp(`export function ${f}\\(`).test(kode)) salah(`esb-journal.js: \`${f}\` tidak diekspor.`);
  }
  if (!/export const BARIS_HEADER_JOURNAL = 2;/.test(kode)) {
    salah('esb-journal.js: baris header templatenya bukan lagi 2 (baris ke-3 di Excel).');
  }
  if (!/export const MODE_KURANG = 'Deduct';/.test(kode)) {
    salah('esb-journal.js: MODE_KURANG bukan "Deduct" — waste yang berangkat sebagai "Add" MENAMBAH stok di ESB sebanyak yang terbuang.');
  }
  // Satu berkas satu outlet, dijaga DI MODUL MURNINYA. Penjaga yang cuma ada
  // di layar adalah penjaga yang hilang begitu ada jalan lain ke fungsi ini.
  if (!/if \(outlet\.size > 1\)\s*\{\s*throw new Error/.test(kode)) {
    salah(
      'esb-journal.js: waste dari beberapa outlet tidak lagi ditolak. Berkas gabungan DITERIMA ESB dengan tenang, ' +
        'dan stok outlet lain berkurang di sana tanpa pernah berkurang di sini.'
    );
  }
  // DUA SUMBER NILAI, lewat fungsi yang SAMA dengan rekap waste.
  //
  // Versi pertama cuma melihat biaya rata-rata nota, dan seluruh barang
  // produksi tertahan — "Danish Cinnamon (WIP)" tidak pernah dibeli, ia
  // diproduksi. Dua layar yang menyebut angka berbeda untuk barang yang sama
  // membuat keduanya tidak bisa dipercaya.
  if (!/hargaSatuanBahan\(w\.outlet_id, it\.product_id, biaya, hpp\)/.test(kode)) {
    salah(
      'esb-journal.js: nilai per satuan tidak lagi diambil lewat `hargaSatuanBahan` — cadangan HPP resep hilang, ' +
        'dan SELURUH barang setengah jadi akan tertahan dengan alasan "belum ada harga beli" untuk barang yang ' +
        'memang tidak pernah dibeli.'
    );
  }
  if (!/from '\.\/laporan-waste\.js'/.test(kode)) {
    salah('esb-journal.js: aturan harganya disalin, bukan dipakai bersama rekap waste — dua salinan pasti menyimpang.');
  }
  // Nilai yang TIDAK ADA menahan barisnya. Ini keputusan yang diambil bersama
  // pemiliknya, bukan detail teknis.
  if (!/if \(nilai === null\) \{\s*catat\('nilai-bahan'/.test(kode)) {
    salah(
      'esb-journal.js: bahan tanpa harga beli tidak lagi menahan waste-nya. Yang berangkat jadi 0 — "bahannya gratis", ' +
        'pernyataan yang BERBEDA dari "belum tahu", dan ESB menerimanya tanpa keluhan.'
    );
  }
  if (!/no -= barisWaste\.length;/.test(kode)) {
    salah('esb-journal.js: nomor baris tidak dikembalikan saat sebuah waste ditahan — berkasnya berangkat dengan No yang melompat.');
  }
  // PURPOSE DIBACA DARI KEJADIANNYA (0147), tidak dipetakan dan tidak ditebak.
  //
  // Sampai 0146 ia dipetakan dari `jenis` waste. Berkas Master Purpose yang
  // sesungguhnya membantah bentuk itu: sumbunya "dapur / bar / kemasan", bukan
  // "rusak atau terbuang". Aturannya sendiri dijaga tools/audit-purpose-waste.cjs;
  // yang dijaga DI SINI cuma bahwa jalur lamanya tidak diam-diam kembali.
  if (/peta\?\.purpose/.test(kode)) {
    salah('esb-journal.js: Purpose kembali dipetakan — lihat tools/audit-purpose-waste.cjs untuk alasan lengkapnya.');
  }
  if (!/const purpose = teks\(w\.purpose\) \|\| null;/.test(kode)) {
    salah('esb-journal.js: Purpose tidak dibaca dari kejadiannya.');
  }
}

// ---------------------------------------------------------------
// 3. Purpose BUKAN jenis pemetaan.
//
// Sempat jadi satu di 0146, dicabut lagi di 0147. Kalau ia kembali, layar
// pemetaan menumbuhkan kelompok "Purpose" kosong yang tidak bisa dikerjakan
// siapa pun — dan yang membukanya menyangka ada pekerjaan yang tertinggal.
// ---------------------------------------------------------------
const pur = baca('js/modules/inventory/esb-purchase.js');
if (pur) {
  const kode = bersih(pur, 'esb-purchase.js', ['export const JENIS_PETA']);
  if (/JENIS_PETA = \[[^\]]*'purpose'/.test(kode)) {
    salah("esb-purchase.js: 'purpose' kembali jadi jenis pemetaan — kelompok kosong yang tidak bisa dikerjakan siapa pun.");
  }
}

// ---------------------------------------------------------------
// 4. Layanannya.
// ---------------------------------------------------------------
const svc = baca('js/modules/inventory/esb.service.js');
if (svc) {
  const kode = bersih(svc, 'esb.service.js', ['export async function wasteUntukEsb']);

  for (const f of ['wasteUntukEsb', 'tandaiWasteEsb', 'batalkanTandaWasteEsb', 'wasteBertandaEsb']) {
    if (!new RegExp(`export async function ${f}\\(`).test(kode)) salah(`esb.service.js: \`${f}\` tidak ada.`);
  }
  // Outlet WAJIB, dan itu diperiksa sebelum satu pun baris diambil.
  if (!/if \(!outletId\) throw new Error\(/.test(kode)) {
    salah(
      'esb.service.js `wasteUntukEsb`: outlet tidak lagi wajib. "Semua outlet" akan mengumpulkan waste seluruh outlet ' +
        'ke satu berkas yang tidak punya kolom outlet sama sekali.'
    );
  }
  const iW = kode.indexOf('export async function wasteUntukEsb');
  const fnW = iW < 0 ? '' : kode.slice(iW, kode.indexOf('\n}', iW));
  if (!/\.eq\('outlet_id', outletId\)/.test(fnW)) {
    salah('esb.service.js `wasteUntukEsb`: hasilnya tidak disaring per outlet — argumennya diminta lalu diabaikan.');
  }
  if (!/q = q\.is\('esb_exported_at', null\)/.test(fnW)) {
    salah('esb.service.js `wasteUntukEsb`: waste yang sudah diekspor ikut ditawarkan lagi — stoknya dipotong dua kali di ESB.');
  }
}

// ---------------------------------------------------------------
// 5. Layarnya.
// ---------------------------------------------------------------
const adm = baca('js/modules/inventory/esb.admin.js');
if (adm) {
  const kode = bersih(adm, 'esb.admin.js', ['async function unduhEsb']);

  // DUA dropdown memuat `value="journal"`: yang mengunduh, dan yang membuka
  // tanda ekspor. Versi pertama audit ini cuma menanyakan "apakah
  // `value="journal"` ada", dan sabotase yang MENGHAPUS pilihan dari dropdown
  // unduh lolos — karena dropdown yang satunya masih memuatnya. Jebakan
  // prefix/keberadaan yang sudah berkali-kali menggigit di repo ini. Sekarang
  // keduanya dicari di potongan HTML-nya masing-masing.
  const potong = (idSelect) => {
    const i = kode.indexOf(`id="${idSelect}"`);
    return i < 0 ? '' : kode.slice(i, kode.indexOf('</select>', i));
  };
  const dropUnduh = potong('esb-dokumen');
  const dropBatal = potong('batal-dokumen');
  if (!dropUnduh) salah('esb.admin.js: dropdown jenis dokumen (#esb-dokumen) tidak ditemukan — audit ini kehilangan sasarannya.');
  else if (!/value="journal"/.test(dropUnduh)) {
    salah('esb.admin.js: Item Journal tidak ada di pilihan UNDUH — seluruh fiturnya ada, jalannya tidak.');
  }
  if (!dropBatal) salah('esb.admin.js: dropdown #batal-dokumen tidak ditemukan — audit ini kehilangan sasarannya.');
  else if (!/value="journal"/.test(dropBatal)) {
    salah(
      'esb.admin.js: waste tidak ada di pilihan "Batalkan tanda ekspor". Waste yang terlanjur ditandai tidak bisa ' +
        'dibuka lagi dari layar mana pun, dan satu-satunya jalan keluar kembali jadi SQL Editor.'
    );
  }
  if (!/outletWajib: true/.test(kode)) {
    salah('esb.admin.js: Item Journal tidak ditandai `outletWajib` — layarnya membiarkan "Semua outlet" terpilih.');
  }
  // Pilihannya DICABUT dari layar, bukan cuma ditolak belakangan.
  if (!/semua\.disabled = true;/.test(kode)) {
    salah('esb.admin.js: pilihan "Semua outlet" tidak dinonaktifkan untuk Item Journal.');
  }
  // ...DAN tetap ada penjaga saat pratinjau. Yang pertama bisa lepas lewat
  // keadaan yang tidak terduga (BU tanpa outlet, nilai yang dikosongkan).
  if (!/if \(dok\.outletWajib && !outletId\)/.test(kode)) {
    salah('esb.admin.js: tidak ada penjaga outlet saat pratinjau — kalau pilihan di layar lepas, tidak ada yang menangkapnya.');
  }
  if (!/barisHeader: BARIS_HEADER_JOURNAL/.test(kode)) {
    salah(
      'esb.admin.js: baris header Item Journal tidak diambil dari `BARIS_HEADER_JOURNAL`. Angka yang ditulis ulang di ' +
        'tempat kedua pasti menyimpang suatu hari, dan berkasnya ditolak di ESB — jauh dari sini.'
    );
  }
  // ...dan angka itu benar-benar SAMPAI ke penulis berkasnya.
  //
  // Versi pertama audit ini berhenti di baris atas, dan sabotase yang mengganti
  // argumen pemanggilnya jadi angka tetap (`barisHeader: 3`) lolos — `DOKUMEN`
  // masih memuat kalimat yang dicari, jadi polanya tetap ketemu. Sasaran yang
  // ADA DI TEMPAT LAIN membuat audit hijau tanpa menjaga apa pun.
  const iPanggil = kode.indexOf('await unduhEsb(dok.kolom');
  const panggil = iPanggil < 0 ? '' : kode.slice(iPanggil, kode.indexOf('});', iPanggil));
  if (!panggil) salah('esb.admin.js: pemanggilan `unduhEsb` tidak ditemukan — audit ini kehilangan sasarannya.');
  else if (!/barisHeader: dok\.barisHeader/.test(panggil)) {
    salah(
      'esb.admin.js: baris header yang dikirim ke `unduhEsb` bukan `dok.barisHeader`. Angka tetap di sini membuat ' +
        'SEMUA dokumen memakai bentuk berkas yang sama — Simple Purchase berangkat dengan header di baris ke-3, ' +
        'dan ESB menolak seluruhnya.'
    );
  }
  // Judul + baris kosong benar-benar ditulis ke berkasnya.
  if (!/for \(let r = 0; r < barisHeader; r\+\+\) atas\.push/.test(kode)) {
    salah('esb.admin.js `unduhEsb`: baris kepala berkas tidak ditulis — header Item Journal mendarat di baris 1, dan ESB menolak seluruh berkasnya.');
  }
  if (!/pasangFormatTanggal\(ws, kolom, baris\.length, \(c, r\) => XLSX\.utils\.encode_cell\(\{ c, r \}\), barisHeader\)/.test(kode)) {
    salah('esb.admin.js `unduhEsb`: format tanggal tidak diberi tahu baris headernya — formatnya akan meleset ke atas tanpa satu pun galat.');
  }
  // Penandaan SESUDAH berkasnya jadi.
  const iUnduh = kode.indexOf("await unduhEsb(dok.kolom");
  const iTandai = kode.indexOf('tandaiWasteEsb(ids)');
  if (iUnduh < 0 || iTandai < 0 || iTandai < iUnduh) {
    salah(
      'esb.admin.js: waste ditandai SEBELUM berkasnya jadi. Kalau pembuatan berkasnya gagal, waste itu hilang dari ' +
        'daftar tanpa pernah sampai ke ESB — dan tidak ada yang tahu sampai stoknya tidak cocok.'
    );
  }
  // Jalan membuka tandanya harus ada DI LAYAR, bukan cuma di database.
  if (!/batalkanTandaWasteEsb\(ids, periksa\.alasan\)/.test(kode)) {
    salah('esb.admin.js: tidak ada jalan membuka tanda ekspor waste — satu-satunya jalan keluar kembali jadi SQL Editor.');
  }
  if (!/wasteBertandaEsb\(\{ businessUnitId, from, to, outletId \}\)/.test(kode)) {
    salah('esb.admin.js: layar "Batalkan tanda ekspor" tidak bisa menampilkan waste yang sudah bertanda.');
  }
  // DUA SUMBER NILAI ikut dimuat. Kalau salah satunya hilang, barang yang
  // memakainya tertahan tanpa ada yang rusak di layar mana pun.
  if (!/getBiayaRataBu\(businessUnitId\)/.test(kode)) {
    salah('esb.admin.js: biaya rata-rata nota tidak dimuat — seluruh bahan yang pernah dibeli kehilangan nilainya.');
  }
  if (!/hpp: computeCosts\(produk, resep\)/.test(kode)) {
    salah(
      'esb.admin.js: HPP resep tidak dikirim ke penyusun barisnya. Barang setengah jadi tidak pernah dibeli — ia ' +
        'diproduksi — jadi seluruhnya akan tertahan, padahal Master Produk & Rekap Waste menampilkan HPP-nya.'
    );
  }
  // Alasan penahan harus punya label yang bisa dibaca; tanpa itu tabelnya
  // menampilkan kode mentah ("nilai-bahan") dan tidak ada yang tahu artinya.
  for (const k of ['nilai-bahan', 'purpose-kosong']) {
    if (!new RegExp(`'${k}': `).test(kode)) {
      salah(`esb.admin.js: alasan "${k}" tidak punya label — tabel penahan menampilkan kode mentah.`);
    }
  }
}

// ---------------------------------------------------------------
// 6. Offset baris header di modul tanggalnya.
// ---------------------------------------------------------------
const tgl = baca('js/modules/inventory/tanggal-excel.js');
if (tgl) {
  const kode = bersih(tgl, 'tanggal-excel.js', ['export function pasangFormatTanggal']);
  if (!/export function pasangFormatTanggal\(ws, kolom, jumlahBaris, alamat, barisHeader = 0\)/.test(kode)) {
    salah('tanggal-excel.js: `pasangFormatTanggal` tidak lagi menerima baris header — template berbaris-judul akan diberi format yang meleset.');
  }
  if (!/for \(let r = awal; r < awal \+ jumlahBaris; r\+\+\)/.test(kode)) {
    salah('tanggal-excel.js: perulangannya tidak lagi bermula dari baris sesudah header.');
  }
}

console.log('');
if (gagal === 0) console.log('Audit ESB Item Journal bersih. ✅');
else console.error(`${gagal} masalah ditemukan.`);
process.exit(gagal === 0 ? 0 : 1);
