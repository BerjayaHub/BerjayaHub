/**
 * AUDIT: ekspor kas keluar ke ESB Disbursement (0149).
 *
 * ============ CARA FITUR INI RUSAK TANPA TERLIHAT RUSAK ============
 *
 *   pembayaran nota ikut terkirim  -> pengeluaran yang SAMA tercatat dua kali
 *                                     di ESB: sekali sebagai Simple Purchase,
 *                                     sekali sebagai Disbursement
 *   entri yang dicoret ikut        -> uang yang sudah dinyatakan salah
 *                                     berangkat sebagai pengeluaran sah
 *   Document Date dikirim sebagai
 *   nomor seri Excel               -> templatenya menuntut TEKS; diperiksa di
 *                                     selnya sendiri (type=s, format '@')
 *   supplier terhapus saat koreksi -> `ubah_kas` menulis PENUH; kolom yang
 *                                     tidak dikirim lenyap. Bug 0119, lagi
 *   yang sudah diekspor bisa diubah -> catatan berbeda di dua tempat, selamanya
 *   dua overload ubah_kas          -> Supplier yang baru dipilih lenyap tanpa
 *                                     satu pun pesan
 *   riwayat tidak mengembalikan
 *   supplier                       -> dialog koreksi menampilkannya kosong,
 *                                     lalu MENGHAPUSNYA saat disimpan
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
// 1. Migration 0149.
// ---------------------------------------------------------------
const mig = baca('supabase/migrations/0149_disbursement_kas.sql');
if (mig) {
  for (const k of ['supplier', 'supplier_diisi_by', 'supplier_diisi_at', 'esb_exported_at', 'esb_alasan_batal']) {
    if (!new RegExp(`add column if not exists ${k}\\b`).test(mig)) {
      salah(`0149: kolom \`${k}\` tidak ditambahkan ke cash_entries.`);
    }
  }

  // YANG SUDAH DIEKSPOR TERKUNCI — dan penjaganya di `alasan_tolak_koreksi_kas`,
  // bukan di salah satu pintu. Dari sanalah `ubah_kas`, `coret_kas`, DAN layar
  // yang menggambar tombolnya membacanya.
  const iTolak = mig.indexOf('function alasan_tolak_koreksi_kas');
  const fnTolak = iTolak < 0 ? '' : mig.slice(iTolak, mig.indexOf('$$;', iTolak));
  if (!fnTolak) salah('0149: `alasan_tolak_koreksi_kas` tidak ditulis ulang — penjaganya tidak akan menular ke ketiga pintu.');
  else {
    if (!/if v\.esb_exported_at is not null then/.test(fnTolak)) {
      salah(
        '0149: entri yang sudah diekspor masih bisa dikoreksi. Berkasnya sudah berangkat membawa angka yang lama; ' +
          'mengubahnya membuat catatan berbeda di dua tempat, selamanya, tanpa satu pun tanda.'
      );
    }
    if (!/Batalkan tanda ekspor/.test(fnTolak)) {
      salah('0149: penolakannya tidak menyebut jalan keluarnya — yang membacanya akan membuka SQL Editor.');
    }
    // Penjaga LAMA tidak boleh ikut hilang saat fungsinya ditulis ulang.
    for (const [nama, pola] of [
      ['dicoret', /if v\.dicoret_at is not null then/],
      ['transfer', /if v\.entry_type not in \('in', 'out'\) then/],
      ['pembayaran nota', /from goods_receipts where payment_entry_id = p_entry/],
      ['penyesuaian nota', /if v\.penyesuaian_nota is not null then/],
      ['wewenang', /if not boleh_koreksi_kas\(v\.holder_id\) then/]
    ]) {
      if (!pola.test(fnTolak)) {
        salah(`0149: penjaga "${nama}" HILANG saat \`alasan_tolak_koreksi_kas\` ditulis ulang — menulis ulang fungsi berarti mengetik ulang seluruh isinya.`);
      }
    }
  }

  // TANDA TANGAN LAMA DIBUANG.
  if (!/drop function if exists ubah_kas\(uuid, numeric, uuid, uuid, text, numeric, text, date\);/.test(mig)) {
    salah(
      '0149: tanda tangan 8-argumen `ubah_kas` tidak dibuang. PostgREST memilih overload lewat HIMPUNAN NAMA ' +
        'ARGUMEN — permintaan yang kehilangan `p_supplier` akan diam-diam memilih yang lama, dan Supplier yang baru ' +
        'saja dipilih orangnya lenyap tanpa satu pun pesan.'
    );
  }
  const iUbah = mig.indexOf('create or replace function ubah_kas');
  const fnUbah = iUbah < 0 ? '' : mig.slice(iUbah, mig.indexOf('$$;', iUbah));
  if (!/p_supplier text\s*\) returns void/.test(fnUbah)) salah('0149: `ubah_kas` tidak menerima `p_supplier`.');
  // Kas MASUK tidak pernah jadi Disbursement.
  if (!/supplier = case when v_type = 'out' then v_supplier else null end/.test(fnUbah)) {
    salah('0149 `ubah_kas`: kas masuk ikut menyimpan supplier — kolom yang tidak akan pernah dipakai, diisi dari layar.');
  }
  // Jejaknya hanya disentuh kalau nilainya BERUBAH.
  if (!/when v_supplier is distinct from v_lama then/.test(fnUbah)) {
    salah('0149 `ubah_kas`: jejak pengisi supplier ditulis ulang tiap koreksi — mengoreksi nominal jadi terlihat seperti mengisi supplier.');
  }

  // Isi MUNDUR & penanda ekspor.
  for (const [nama, tanda] of [
    ['ubah_supplier_kas', 'create or replace function ubah_supplier_kas(p_entries uuid[], p_supplier text)'],
    ['tandai_kas_esb', 'create or replace function tandai_kas_esb(p_entries uuid[])'],
    ['batalkan_tanda_kas_esb', 'create or replace function batalkan_tanda_kas_esb(p_entries uuid[], p_alasan text)']
  ]) {
    if (!mig.includes(tanda)) salah(`0149: \`${nama}\` tidak ada.`);
  }
  const iIsi = mig.indexOf('function ubah_supplier_kas');
  const fnIsi = iIsi < 0 ? '' : mig.slice(iIsi, mig.indexOf('$$;', iIsi));
  for (const [nama, pola] of [
    ['kas keluar saja', /and c\.entry_type = 'out'/],
    ['bukan yang dicoret', /and c\.dicoret_at is null/],
    ['bukan yang sudah diekspor', /and c\.esb_exported_at is null/],
    ['wewenang koreksi kas', /and boleh_koreksi_kas\(c\.holder_id\)/]
  ]) {
    if (!pola.test(fnIsi)) salah(`0149 \`ubah_supplier_kas\`: saringan "${nama}" tidak ada.`);
  }
  if (!/raise exception 'Pilih suppliernya dulu/.test(fnIsi)) {
    salah('0149 `ubah_supplier_kas`: mengosongkannya diterima — tidak memperbaiki apa pun, dan tidak meninggalkan jejak kenapa.');
  }

  const iBatal = mig.indexOf('function batalkan_tanda_kas_esb');
  const fnBatal = iBatal < 0 ? '' : mig.slice(iBatal, mig.indexOf('$$;', iBatal));
  if (!/alasan_batal_esb_sah\(p_alasan\)/.test(fnBatal)) {
    salah('0149: pembatalan tanda kas tidak menuntut alasan.');
  }
  if (!/and c\.esb_exported_at is not null/.test(fnBatal)) {
    salah('0149: kas yang TIDAK bertanda ikut ditulisi jejak pembatalan yang tidak pernah terjadi.');
  }
  const iTandai = mig.indexOf('function tandai_kas_esb');
  const fnTandai = iTandai < 0 ? '' : mig.slice(iTandai, mig.indexOf('$$;', iTandai));
  if (!/and c\.esb_exported_at is null/.test(fnTandai)) {
    salah('0149 `tandai_kas_esb`: menghitung ulang yang sudah bertanda — "3 ditandai" muncul untuk 0 yang sungguh baru.');
  }
  for (const [nama, fn] of [
    ['tandai_kas_esb', fnTandai],
    ['batalkan_tanda_kas_esb', fnBatal]
  ]) {
    if (!/is_bu_admin\(v_uid, c\.business_unit_id\)/.test(fn)) {
      salah(`0149: \`${nama}\` tidak memeriksa is_bu_admin — fungsinya \`security definer\`.`);
    }
  }

  // `riwayat_kas_saya` mengembalikan supplier — tanpa ini dialog koreksi
  // menampilkannya kosong, lalu MENGHAPUSNYA saat disimpan.
  if (!/drop function if exists riwayat_kas_saya\(int\);/.test(mig)) {
    salah('0149: `riwayat_kas_saya` lama tidak dibuang sebelum ditulis ulang — `create or replace` menolak perubahan daftar kolomnya.');
  }
  const iRiwayat = mig.indexOf('create or replace function riwayat_kas_saya');
  const fnRiwayat = iRiwayat < 0 ? '' : mig.slice(iRiwayat, mig.indexOf('$$;', iRiwayat));
  if (!/  supplier text,/.test(fnRiwayat) || !/    ce\.supplier,/.test(fnRiwayat)) {
    salah(
      '0149: `riwayat_kas_saya` tidak mengembalikan `supplier`. Dialog koreksi mengisi kotaknya dari `e.supplier` — ' +
        'kotaknya akan tampil KOSONG untuk entri yang sudah terisi, dan menekan Simpan MENGHAPUSNYA.'
    );
  }
}

// ---------------------------------------------------------------
// 2. Modul murninya.
// ---------------------------------------------------------------
const murni = baca('js/modules/inventory/esb-disbursement.js');
if (murni) {
  const kode = bersih(murni, 'esb-disbursement.js', ['export function barisEsbDisbursement']);
  for (const f of ['barisEsbDisbursement', 'ringkasDisbursement']) {
    if (!new RegExp(`export function ${f}\\(`).test(kode)) salah(`esb-disbursement.js: \`${f}\` tidak diekspor.`);
  }
  if (!/export const KOLOM_DISBURSEMENT = \[/.test(kode)) salah('esb-disbursement.js: daftar kolomnya hilang.');

  // TEKS, bukan nomor seri. Templatenya sendiri yang menjawab: D2 bertipe `s`
  // berformat '@'.
  if (!/tanggalTeksEsb\(c\.entry_date\)/.test(kode)) {
    salah(
      'esb-disbursement.js: Document Date tidak memakai `tanggalTeksEsb`. Template ini menuntut TEKS dd/mm/yyyy — ' +
        'kebalikan dari Simple Purchase, dan itu diperiksa di selnya sendiri.'
    );
  }
  if (/serialTanggalExcel\(/.test(kode)) {
    salah('esb-disbursement.js: memakai nomor seri Excel — itu aturan Simple Purchase, bukan Disbursement.');
  }
  if (!/String\(seq\)/.test(kode)) {
    salah('esb-disbursement.js: Sequence dikirim sebagai angka — sel `Sequence` di templatenya bertipe teks berformat \'@\'.');
  }
  // Nominalnya disimpan bertanda; yang dikirim besarnya.
  if (!/bulatkanEsb\(Math\.abs\(nominal\)\)/.test(kode)) {
    salah('esb-disbursement.js: Amount tidak dibulatkan 4 desimal, atau tandanya ikut terkirim.');
  }
  // Pencarian peta memakai normalisasi yang SAMA dengan `buatPeta`.
  for (const [nama, pola] of [
    ['branch', /peta\?\.branch\?\.get\?\.\(normalNama\(c\.outlet_nama\)\)/],
    ['coa', /peta\?\.coa\?\.get\?\.\(normalNama\(c\.kategori_nama\)\)/],
    ['payment_method', /peta\?\.payment_method\?\.get\?\.\(normalNama\(caraBayar\)\)/]
  ]) {
    if (!pola.test(kode)) {
      salah(
        `esb-disbursement.js: pencarian peta \`${nama}\` tidak memakai \`normalNama\` — aturan yang BERBEDA dari ` +
          '`buatPeta` yang menyimpan kuncinya, jadi nilai ber-spasi ganda tidak akan pernah ketemu padanannya.'
      );
    }
  }
  // Satu entri bermasalah tidak menahan yang lain.
  if (!/if \(adaMasalah\) continue;/.test(kode)) {
    salah('esb-disbursement.js: satu entri bermasalah menahan entri lain — tiap kas keluar berdiri sendiri.');
  }
  // Payment To memakai aturan yang SAMA dengan nota, termasuk pengecualian
  // daftar-induk-kosong.
  if (!/const adaMasterSupplier = masterSupplier\?\.size > 0;/.test(kode)) {
    salah(
      'esb-disbursement.js: pengecualian daftar-induk-kosong hilang. BU yang belum sempat mengimpor daftar supplier ' +
        'akan mendadak kehilangan SELURUH ekspornya karena aturan baru dinyalakan.'
    );
  }
}

// ---------------------------------------------------------------
// 3. Layanannya — saringan "selain bahan".
// ---------------------------------------------------------------
const svc = baca('js/modules/inventory/esb.service.js');
if (svc) {
  const kode = bersih(svc, 'esb.service.js', ['export async function kasUntukEsb']);
  for (const f of ['kasUntukEsb', 'tandaiKasEsb', 'batalkanTandaKasEsb', 'kasBertandaEsb', 'kodeKas']) {
    if (!new RegExp(`export (async )?function ${f}\\(`).test(kode)) salah(`esb.service.js: \`${f}\` tidak ada.`);
  }
  const iKas = kode.indexOf('export async function kasUntukEsb');
  const fnKas = iKas < 0 ? '' : kode.slice(iKas, kode.indexOf('\n}', iKas));
  // EMPAT saringan, dan tiga di antaranya bukan selera.
  for (const [nama, pola, akibat] of [
    ["entry_type = 'out'", /\.eq\('entry_type', 'out'\)/, 'kas masuk & transfer ikut jadi pengeluaran'],
    [
      'untuk_nota = false',
      /\.eq\('untuk_nota', false\)/,
      'pembayaran nota ikut terkirim — pengeluaran yang SAMA tercatat dua kali di ESB, sekali lewat Simple Purchase'
    ],
    ['penyesuaian_nota null', /\.is\('penyesuaian_nota', null\)/, 'koreksi otomatis nota ikut jadi dokumen pengeluaran'],
    ['dicoret_at null', /\.is\('dicoret_at', null\)/, 'entri yang sudah dinyatakan salah berangkat sebagai pengeluaran sah']
  ]) {
    if (!pola.test(fnKas)) salah(`esb.service.js \`kasUntukEsb\`: saringan ${nama} hilang — ${akibat}.`);
  }
  if (!/q = q\.is\('esb_exported_at', null\)/.test(fnKas)) {
    salah('esb.service.js `kasUntukEsb`: yang sudah diekspor ditawarkan lagi — pengeluarannya tercatat dua kali.');
  }
}

const cash = baca('js/modules/cash/cash.service.js');
if (cash) {
  const kode = bersih(cash, 'cash.service.js', ['export async function ubahKas']);
  if (!/p_supplier: supplier\?\.trim\(\) \|\| null/.test(kode)) {
    salah(
      'cash.service.js `ubahKas`: `p_supplier` tidak dikirim. `JSON.stringify` membuang kunci bernilai `undefined`, ' +
        'dan PostgREST lalu mencari `ubah_kas` berargumen delapan — yang sudah dibuang di 0149.'
    );
  }
  if (!/const { error } = await supabase\.rpc\(\s*'ubah_kas',\s*argumenRpc\(/.test(kode)) {
    salah('cash.service.js `ubahKas`: tidak lewat `argumenRpc` — kunci `undefined` akan hilang di perjalanan.');
  }
  if (!/export async function ubahSupplierKas\(ids, supplier\)/.test(kode)) {
    salah('cash.service.js: `ubahSupplierKas` tidak ada — tidak ada jalan mengisi Supplier mundur.');
  }
  // `ubah_kas` menulis PENUH: kolom yang tidak dikirim TERHAPUS (bug 0119).
  if (!/supplier, esb_exported_at,/.test(kode)) {
    salah(
      'cash.service.js `listCashEntriesAdmin`: `supplier` tidak ikut diambil. Dialog admin mengirim kolom yang tidak ' +
        'ditampilkannya apa adanya dari barisnya — tanpa kolom ini ia mengirim `undefined` dan MENGHAPUS Payment To. ' +
        'Itu bug 0119 dalam bentuk ketiga.'
    );
  }
  if (!/supplier: type === 'out' \? supplier\?\.trim\(\) \|\| null : null/.test(kode)) {
    salah('cash.service.js `recordCashEntry`: supplier tidak disimpan, atau kas masuk ikut menyimpannya.');
  }
}

// ---------------------------------------------------------------
// 4. Layar Ekspor ESB.
// ---------------------------------------------------------------
const adm = baca('js/modules/inventory/esb.admin.js');
if (adm) {
  const kode = bersih(adm, 'esb.admin.js', ['barisEsbDisbursement(']);
  if (!/value="disbursement"/.test(kode)) {
    salah('esb.admin.js: Disbursement tidak ada di pilihan jenis dokumen — fungsinya ada, jalannya tidak.');
  }
  // DUA dropdown, diperiksa di potongannya masing-masing.
  const potong = (id) => {
    const i = kode.indexOf(`id="${id}"`);
    return i < 0 ? '' : kode.slice(i, kode.indexOf('</select>', i));
  };
  for (const [id, apa] of [
    ['esb-dokumen', 'UNDUH'],
    ['batal-dokumen', 'Batalkan tanda ekspor']
  ]) {
    const blok = potong(id);
    if (!blok) salah(`esb.admin.js: dropdown #${id} tidak ditemukan — audit ini kehilangan sasarannya.`);
    else if (!/value="disbursement"/.test(blok)) {
      salah(`esb.admin.js: Disbursement tidak ada di pilihan ${apa}.`);
    }
  }
  if (!/barisEsbDisbursement\(\{/.test(kode)) salah('esb.admin.js: pratinjau Disbursement tidak menyusun barisnya.');
  const iDis = kode.indexOf("if (jenis === 'disbursement')");
  const cabang = iDis < 0 ? '' : kode.slice(iDis, kode.indexOf('ids = hasil.kasIds;', iDis));
  if (!cabang) salah('esb.admin.js: cabang pratinjau Disbursement tidak ditemukan — audit ini kehilangan sasarannya.');
  else if (!/masterSupplier: petaSupplier\(master\)/.test(cabang)) {
    salah('esb.admin.js: Disbursement tidak memakai daftar induk supplier — Payment To berangkat apa adanya.');
  }
  if (!/kasBertandaEsb\(\{ businessUnitId, from, to, outletId \}\)/.test(kode)) {
    salah('esb.admin.js: layar "Batalkan tanda ekspor" tidak bisa menampilkan kas keluar bertanda.');
  }
  if (!/batalkanTandaKasEsb\(ids, periksa\.alasan\)/.test(kode)) {
    salah('esb.admin.js: tidak ada jalan membuka tanda ekspor kas — jalan keluarnya kembali jadi SQL Editor.');
  }
  // Penandaan SESUDAH berkasnya jadi.
  const iUnduh = kode.indexOf('await unduhEsb(dok.kolom');
  const iTandai = kode.indexOf('tandaiKasEsb(ids)');
  if (iUnduh < 0 || iTandai < 0 || iTandai < iUnduh) {
    salah('esb.admin.js: kas ditandai SEBELUM berkasnya jadi — kalau pembuatan berkasnya gagal, entrinya hilang dari daftar.');
  }
  // Kategori biaya masuk daftar pemetaan COA — tanpa itu kolom Account tidak
  // akan pernah punya padanan, dan SELURUH kas keluar tertahan.
  if (!/coa: \[\.\.\.CARA_BAYAR, \.\.\.kategoriKas\.map\(/.test(kode)) {
    salah(
      'esb.admin.js: kategori biaya kas tidak masuk daftar pemetaan COA. Kolom `Account` tidak akan pernah punya ' +
        'padanan, SELURUH kas keluar tertahan, dan tidak ada satu pun baris di layar untuk membereskannya.'
    );
  }
  if (!/listCashCategories\(true\)\.catch\(\(\) => \[\]\)/.test(kode)) {
    salah('esb.admin.js: daftar kategori biaya tidak dimuat, atau kegagalannya tidak ditangkap.');
  }
  for (const k of ['tanggal-kas', 'jumlah-kas']) {
    if (!new RegExp(`'${k}': `).test(kode)) {
      salah(`esb.admin.js: alasan "${k}" tidak punya label — tabel penahan menampilkan kode mentah.`);
    }
  }
}

// ---------------------------------------------------------------
// 5. Layar Kas — dua pintu, dan pintu kedua yang biasanya terlewat.
// ---------------------------------------------------------------
const hal = baca('js/modules/cash/cash.page.js');
if (hal) {
  const kode = bersih(hal, 'cash.page.js', ['async function openKeluar']);
  // DUA tempat: form tambah DAN dialog koreksi. Kolom yang cuma ada di form
  // tambah adalah kolom yang tidak pernah bisa dibetulkan — dan pola itu sudah
  // menggigit sekali di proyek ini, pada kolom Supplier nota.
  const n = (kode.match(/name: 'supplier',/g) ?? []).length;
  if (n < 2) {
    salah(
      `cash.page.js: kotak Supplier cuma ada di ${n} dari 2 tempat (form Kas Keluar & dialog koreksi). Kolom yang ` +
        'cuma bisa diisi saat mencatat adalah kolom yang tidak pernah bisa dibetulkan.'
    );
  }
  if ((kode.match(/supplier: values\.supplier/g) ?? []).length < 2) {
    salah('cash.page.js: nilainya tidak dikirim dari kedua tempat — kotaknya digambar, isinya tidak sampai ke database.');
  }
  if (!/listEsbMaster\(businessUnitId, 'supplier'\)\.catch\(\(\) => \[\]\)/.test(kode)) {
    salah(
      'cash.page.js: daftar supplier tidak dimuat, atau kegagalannya tidak ditangkap. Layar Kas tidak boleh mati ' +
        'karena satu daftar tambahan tidak terbaca.'
    );
  }
}

const halAdm = baca('js/modules/cash/cash.admin.page.js');
if (halAdm) {
  const kode = bersih(halAdm, 'cash.admin.page.js', ['async function ubahEntriAdmin']);
  if (!/supplier: values\.supplier \?\? r\.supplier \?\? null/.test(kode)) {
    salah(
      'cash.admin.page.js: supplier tidak diteruskan saat mengoreksi. `ubah_kas` menulis PENUH — admin yang ' +
        'membetulkan satu huruf di keterangan akan MENGHAPUS Payment To-nya. Itu bug 0119 dalam bentuk ketiga.'
    );
  }
  if (!/ubahSupplierKas\(ids, v\.supplier\)/.test(kode)) {
    salah('cash.admin.page.js: tidak ada jalan mengisi Supplier mundur — ratusan entri lama harus diisi satu per satu.');
  }
  // Centang hanya pada baris yang memang bisa diisi.
  if (!/const bisaSupplier = r\.entry_type === 'out' && !k\.dicoret && !r\.esb_exported_at;/.test(kode)) {
    salah('cash.admin.page.js: centang ditawarkan pada baris yang pasti ditolak database — kas masuk, yang dicoret, atau yang sudah diekspor.');
  }
  if (!/if \(n === ids\.length\)/.test(kode)) {
    salah('cash.admin.page.js: hasil `ubahSupplierKas` tidak dibandingkan dengan yang dicentang — "0 terisi" dilaporkan sebagai berhasil.');
  }
}

// ---------------------------------------------------------------
// 6. Tanggal teks — dan penjaga yang dipinjamkan.
// ---------------------------------------------------------------
const tgl = baca('js/modules/inventory/tanggal-excel.js');
if (tgl) {
  const kode = bersih(tgl, 'tanggal-excel.js', ['export function tanggalTeksEsb']);
  if (!/export function tanggalTeksEsb\(v\)/.test(kode)) salah('tanggal-excel.js: `tanggalTeksEsb` tidak ada.');
  // Dipinjamkan ke penjaga yang sudah ada, bukan diperiksa ulang dengan aturan
  // kedua: tanggal yang TIDAK ADA (2026-02-30) harus ditolak di KEDUA jalur.
  if (!/const serial = serialTanggalExcel\(v\);/.test(kode)) {
    salah(
      'tanggal-excel.js: `tanggalTeksEsb` memeriksa tanggalnya sendiri alih-alih meminjam `serialTanggalExcel`. ' +
        'Dua aturan untuk satu pekerjaan pasti menyimpang — dan yang menyimpang meloloskan 30 Februari.'
    );
  }
  if (!/return `\$\{m\[3\]\}\/\$\{m\[2\]\}\/\$\{m\[1\]\}`;/.test(kode)) {
    salah('tanggal-excel.js: urutan hari/bulan/tahunnya berubah — "01/09/2026" terbaca sebagai 9 Januari di separuh dunia.');
  }
}

console.log('');
if (gagal === 0) console.log('Audit Disbursement bersih. ✅');
else console.error(`${gagal} masalah ditemukan.`);
process.exit(gagal === 0 ? 0 : 1);
