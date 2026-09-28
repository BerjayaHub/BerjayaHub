/**
 * AUDIT: impor Inventaris Aset dari Excel + filter catatan.
 *
 * ============ CARA FITUR INI RUSAK TANPA TERLIHAT RUSAK ============
 *
 *   `row.values` tidak di-slice    -> SELURUH kolom bergeser satu; nama barang
 *                                     terbaca sebagai ID, dan tiap baris
 *                                     ditolak dengan "ID tidak ada" — menuduh
 *                                     orangnya mengubah kolom yang tak
 *                                     disentuhnya
 *   pratinjau dilewati             -> foto menempel ke barang yang salah, dan
 *                                     tidak ada satu pun kolom yang bisa
 *                                     dipakai memeriksanya
 *   foto melayang dibuang diam2    -> satu-satunya petunjuk bahwa jangkarnya
 *                                     bergeser ikut hilang
 *   sel kosong dianggap "hapus"    -> satu unggahan mengosongkan kolom yang
 *                                     kebetulan tidak diisi orangnya
 *   pembanding ID pakai `rows`     -> ID yang sah tapi sedang disembunyikan
 *                                     saringan layar ikut ditolak
 *   `Number('')` = 0               -> sel Jumlah kosong tersimpan sebagai 0,
 *                                     dan "0 unit" terbaca seperti barang habis
 *   subjudul laporan tidak menyebut
 *   saringan yang aktif            -> PDF hasil saringan terlihat seperti
 *                                     laporan lengkap di tangan penerimanya
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
// 1. Fixture .xlsx sungguhan — tanpa itu tesnya tidak membuktikan apa pun.
// ---------------------------------------------------------------
const fixture = path.join(AKAR, 'tools/fixtures/contoh-impor-aset.xlsx');
if (!fs.existsSync(fixture)) {
  salah(
    'tools/fixtures/contoh-impor-aset.xlsx tidak ada. Tanpa berkas .xlsx sungguhan, pencocokan foto ke baris cuma ' +
      'diuji terhadap fixture yang saya tulis sendiri — dan fixture itu memantulkan kembali anggapan yang sedang diuji.'
  );
} else if (fs.statSync(fixture).size < 2000) {
  salah('tools/fixtures/contoh-impor-aset.xlsx terlalu kecil untuk memuat gambar — fixture-nya kosong.');
}

// ---------------------------------------------------------------
// 2. Modul murni impor.
// ---------------------------------------------------------------
const modul = baca('js/modules/asset/impor-aset.js');
if (modul) {
  const kode = bersih(modul, 'impor-aset.js', ['export function susunImporAset']);

  // Foto melayang & ganda DILAPORKAN.
  if (!/melayang\.push\(g\);/.test(kode) || !/ganda\.push\(g\);/.test(kode)) {
    salah(
      'impor-aset.js: foto di luar baris data atau yang bertumpuk dibuang diam-diam. Foto melayang adalah tanda ' +
        'paling awal bahwa jangkarnya sudah tidak sejalan dengan barisnya — membuangnya menghilangkan satu-satunya petunjuk.'
    );
  }
  // Jangkar dipakai APA ADANYA, tanpa ±1. Satu penyesuaian yang "kelihatannya
  // benar" menggeser SELURUH foto satu barang.
  if (/g\.row\s*[+-]\s*1/.test(kode) || /Number\(g\?\.row\)\s*[+-]/.test(kode)) {
    salah('impor-aset.js: baris jangkar digeser ±1. Ia sudah 0-based, sama dengan indeks `aoa` — dibuktikan terhadap .xlsx sungguhan.');
  }
  // `Number('')` adalah 0.
  if (!/if \(!\/\\d\/\.test\(bersih\)\) return null;/.test(kode)) {
    salah("impor-aset.js: `angkaSel` tidak lagi menolak sel tanpa satu pun digit. `Number('')` dan `Number('-')` adalah 0 — sel Jumlah kosong tersimpan sebagai \"0 unit\", yang terbaca seperti barang habis.");
  }
  // Sel kosong = jangan diapa-apakan.
  if (!/const pakai = \(baru, lamaNilai\) => \(teks\(baru\) === '' \? \(lamaNilai \?\? null\) : teks\(baru\)\);/.test(kode)) {
    salah(
      'impor-aset.js: `nilaiSimpan` tidak lagi mempertahankan nilai lama untuk sel kosong. Satu unggahan akan ' +
        'mengosongkan seluruh kolom yang kebetulan tidak diisi orangnya — bug 0119 dalam bentuk kelima.'
    );
  }
  // Header dicari lewat DUA judul, bukan satu.
  if (!/const iNama = sel\.indexOf\(normal\('Nama Barang'\)\);/.test(kode) || !/const iId = sel\.indexOf\(normal\('ID \(jangan diubah\)'\)\);/.test(kode)) {
    salah('impor-aset.js: header dikenali dari satu judul saja — subjudul yang kebetulan memuat kata itu akan dikira header.');
  }
  // Kolom dipetakan lewat judul, bukan indeks tetap.
  // Bentuk POSITIFNYA yang dijaga, bukan larangan `row[0]`. Larangan hanya
  // menangkap satu ejaan; `row?.[KOLOM.indexOf(judul)]` adalah indeks tetap
  // juga, dan ia lolos larangan itu tanpa masalah.
  if (!/const ambil = \(row, judul\) => \(kolom\[judul\] === undefined \? '' : row\?\.\[kolom\[judul\]\]\);/.test(kode)) {
    salah(
      'impor-aset.js: kolom tidak lagi dibaca lewat peta judul hasil `cariHeader`. Indeks tetap akan membaca kolom ' +
        'yang salah begitu satu kolom tersisip — nama masuk ke kolom kategori, dan impornya terlihat berhasil.'
    );
  }
  // Baris kosong yang PUNYA foto tidak dilewati.
  if (!/if \(kosong && !punyaFoto\) continue;/.test(kode)) {
    salah('impor-aset.js: baris kosong yang menempeli foto ikut dilewati — fotonya lenyap tanpa satu pun laporan.');
  }
  // Kondisi "Lain-lain" menuntut catatannya, sama dengan form (0045).
  if (!/kondisiAkhir === 'lainnya' && !catatanKondisiAkhir/.test(kode)) {
    salah('impor-aset.js: kondisi "Lain-lain" bisa masuk tanpa catatan — baris yang tidak bisa dijelaskan siapa pun yang membacanya nanti.');
  }
}

// ---------------------------------------------------------------
// 3. Pembaca berkasnya — satu-satunya yang mengenal bentuk ExcelJS.
// ---------------------------------------------------------------
const svc = baca('js/modules/asset/asset.service.js');
if (svc) {
  const kode = bersih(svc, 'asset.service.js', ['export async function bacaBerkasImporAset']);

  // `row.values` 1-BASED. `.slice(1)` yang hilang menggeser seluruh kolom.
  if (!/\(row\.values \?\? \[\]\)\.slice\(1\)/.test(kode)) {
    salah(
      "asset.service.js: `row.values` tidak di-`slice(1)`. Ia 1-based di ExcelJS — tanpa itu SELURUH kolom bergeser " +
        'satu, nama barang terbaca sebagai ID, dan tiap baris ditolak dengan "ID tidak ada di inventaris ini".'
    );
  }
  if (!/im\.range\?\.tl\?\.nativeRow/.test(kode)) {
    salah('asset.service.js: baris jangkar gambar tidak dibaca dari `range.tl.nativeRow` — itu satu-satunya angka yang 0-based sama dengan `aoa`.');
  }
  if (!/loadExcelJS/.test(kode)) {
    salah('asset.service.js: berkasnya dibaca dengan pustaka selain ExcelJS. SheetJS versi komunitas tidak bisa membaca gambar sama sekali.');
  }
  // Sel berformula & rich text tidak boleh jadi "[object Object]".
  if (!/v\.result \?\? v\.text/.test(kode)) {
    salah('asset.service.js: sel berformula/rich-text tidak diterjemahkan — nilainya masuk sebagai "[object Object]" dan lolos sebagai nama barang.');
  }

  // Filter catatan sungguh sampai ke query.
  if (!/if \(catatan\) query = query\.ilike\('notes', `%\$\{catatan\}%`\);/.test(kode)) {
    salah('asset.service.js: filter Catatan tidak menyaring apa pun — kotaknya digambar, hasilnya tidak berubah.');
  }
  if (!/listAssets\(\{ businessUnitId, outletId, condition, category, q, catatan, limit = 500 \}\)/.test(kode)) {
    salah('asset.service.js: `listAssets` tidak menerima `catatan` — nilainya dibuang sebelum sampai ke query.');
  }
}

// ---------------------------------------------------------------
// 4. Layar.
// ---------------------------------------------------------------
const hal = baca('js/modules/asset/asset.page.js');
if (hal) {
  const kode = bersih(hal, 'asset.page.js', ['async function bacaImpor', 'as-note']);

  // PRATINJAU WAJIB. Tanpa itu seluruh gunanya hilang.
  const iBaca = kode.indexOf('async function bacaImpor');
  const iSimpan = kode.indexOf('async function simpanImpor');
  if (iBaca < 0 || iSimpan < 0) {
    salah('asset.page.js: jalur impornya tidak terbagi baca-lalu-simpan — berkasnya tersimpan tanpa satu pun kesempatan memeriksa fotonya.');
  } else if (/await saveAsset\(/.test(kode.slice(iBaca, iSimpan))) {
    salah(
      'asset.page.js: `bacaImpor` sudah menyimpan. Gambar di Excel menempel pada koordinat, bukan pada baris — ' +
        'satu-satunya yang bisa memastikan jangkarnya benar adalah mata orang yang punya barangnya, SEBELUM disimpan.'
    );
  }
  if (!/id="as-impor-simpan"/.test(kode)) {
    salah('asset.page.js: tidak ada tombol yang menyetujui rencananya — pratinjau tanpa tombol simpan adalah jalan buntu.');
  }
  // Thumbnail dicocokkan lewat NOMOR BARIS, bukan urutan.
  if (!/img\[data-baris\]/.test(kode) || !/perBaris\.get\(img\.dataset\.baris\)/.test(kode)) {
    salah(
      'asset.page.js: thumbnail pratinjau dicocokkan lewat posisi, bukan nomor baris. Itu persis kesalahan yang ' +
        'sedang dijaga layar ini — dan pratinjau yang salah justru MEMBENARKAN foto yang salah.'
    );
  }
  // Pembanding ID diambil TANPA saringan layar.
  if (!/await listAssets\(\{ businessUnitId \}\)/.test(kode)) {
    salah(
      'asset.page.js: ID pembanding diambil dari daftar yang sedang tersaring. ID yang sah tapi disembunyikan ' +
        'saringan akan ditolak dengan "ID tidak ada di inventaris ini" — menuduh orangnya mengubah kolom yang tak disentuhnya.'
    );
  }
  // Satu baris gagal tidak menghentikan sisanya.
  if (!/gagal\.push\(`Baris \$\{b\.baris\}/.test(kode)) {
    salah('asset.page.js: kegagalan satu baris menghentikan seluruh impor — berkas 200 baris harus diulang dari awal karena satu outlet terhapus.');
  }
  // Kotak berkas dikosongkan supaya berkas yang sama bisa dipilih lagi.
  if (!/berkasImpor\.value = '';/.test(kode)) {
    salah("asset.page.js: kotak berkas tidak dikosongkan — memilih berkas yang SAMA dua kali tidak menyalakan `change`, dan tombolnya terlihat rusak.");
  }

  // Filter catatan: kotaknya ada, nilainya dipakai, dan satu penunda saja.
  if (!/id="as-note"/.test(kode)) salah('asset.page.js: kotak "Cari catatan" tidak digambar.');
  if (!/catatan: state\.catatan/.test(kode)) salah('asset.page.js: nilai kotak catatan tidak dikirim ke `listAssets`.');
  if ((kode.match(/let timer/g) ?? []).length > 1) {
    salah(
      'asset.page.js: dua penunda terpisah untuk dua kotak cari. Mengetik bergantian menembakkan dua permintaan yang ' +
        'balapan, dan yang menang belum tentu yang terakhir diketik.'
    );
  }

  // Subjudul laporan menyebut saringan yang aktif — DI KEDUANYA.
  const nRingkas = (kode.match(/ringkasSaringan\(state, ASSET_CONDITION\)/g) ?? []).length;
  if (nRingkas < 2) {
    salah(
      `asset.page.js: subjudul laporan menyebut saringan aktif di ${nRingkas} dari 2 tempat (PDF & Excel). Laporan ` +
        'hasil saringan yang tidak menyebutkannya terlihat seperti laporan lengkap di tangan orang yang menerimanya.'
    );
  }
}

// ---------------------------------------------------------------
// 5. Modul saringan.
// ---------------------------------------------------------------
const saring = baca('js/modules/asset/saringan-aset.js');
if (saring) {
  const kode = bersih(saring, 'saringan-aset.js', ['export function ringkasSaringan']);
  if (/outlet/i.test(kode.replace(/^[\s\S]*?export function adaSaringan/, ''))) {
    salah(
      'saringan-aset.js: outlet ikut dihitung sebagai saringan. Untuk staff ia SELALU terisi, jadi "Belum ada aset ' +
        'tercatat" tidak pernah muncul — dan yang membacanya mengira ada saringan tersembunyi.'
    );
  }
  if (!/labelKondisi\[kondisi\] \?\? kondisi/.test(kode)) {
    salah('saringan-aset.js: kondisi yang tidak dikenal dibuang dari subjudul — subjudul yang diam-diam kehilangan satu saringan.');
  }
}

console.log('');
if (gagal === 0) console.log('Audit impor aset & filter catatan bersih. ✅');
else console.error(`${gagal} masalah ditemukan.`);
process.exit(gagal === 0 ? 0 : 1);
