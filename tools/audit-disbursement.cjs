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
// 1b. Migration 0150 — sumbu outlet, bukan business_unit_id.
// ---------------------------------------------------------------
const mig150 = baca('supabase/migrations/0150_disbursement_lewat_outlet.sql');
if (mig150) {
  // Indeksnya pindah: atas kolom yang selalu NULL ia tidak pernah menolong.
  if (!/drop index if exists idx_kas_belum_esb;/.test(mig150)) {
    salah('0150: indeks lama tidak dibuang — `create index if not exists` tidak akan menggantikannya.');
  }
  if (!/create index if not exists idx_kas_belum_esb on cash_entries\(outlet_id, entry_date\)/.test(mig150)) {
    salah('0150: indeksnya tidak pindah ke `outlet_id`.');
  }

  for (const [nama, tanda] of [
    ['kas_untuk_esb', 'create or replace function kas_untuk_esb('],
    ['kas_bertanda_esb', 'create or replace function kas_bertanda_esb(']
  ]) {
    if (!mig150.includes(tanda)) salah(`0150: \`${nama}\` tidak ada.`);
  }

  // WEWENANG LEWAT OUTLET. `is_bu_admin(v_uid, c.business_unit_id)` selalu
  // false untuk entri baru — dan false yang diam terlihat seperti "tidak ada
  // datanya", bukan seperti izin yang ditolak.
  for (const fn of ['tandai_kas_esb', 'batalkan_tanda_kas_esb', 'kas_untuk_esb', 'kas_bertanda_esb']) {
    const i = mig150.indexOf(`function ${fn}(`);
    const blok = i < 0 ? '' : mig150.slice(i, mig150.indexOf('$$;', i));
    if (!blok) {
      salah(`0150: \`${fn}\` tidak ditemukan.`);
      continue;
    }
    if (!/is_admin_of_outlet\((v_uid|auth\.uid\(\)), (c|ce)\.outlet_id\)/.test(blok)) {
      salah(`0150 \`${fn}\`: wewenangnya tidak lewat outlet — \`business_unit_id\` selalu NULL sejak 0040.`);
    }
    if (/is_bu_admin\([^)]*\.business_unit_id\)/.test(blok)) {
      salah(`0150 \`${fn}\`: masih memakai \`is_bu_admin(…business_unit_id)\` — penjaga yang selalu menolak, diam-diam.`);
    }
  }

  // "Selain bahan" dijaga DI DUA sisi: daftar yang disusun satu aturan dan
  // ditandai dengan aturan lain akan menandai baris yang tidak pernah terunduh.
  for (const fn of ['tandai_kas_esb', 'kas_untuk_esb']) {
    const i = mig150.indexOf(`function ${fn}(`);
    const blok = i < 0 ? '' : mig150.slice(i, mig150.indexOf('$$;', i));
    for (const [nama, pola] of [
      ['untuk_nota', /untuk_nota = false/],
      ['penyesuaian_nota', /penyesuaian_nota is null/],
      ['dicoret_at', /dicoret_at is null/],
      ["entry_type = 'out'", /entry_type = 'out'/]
    ]) {
      if (!pola.test(blok)) salah(`0150 \`${fn}\`: saringan "${nama}" tidak ada — aturannya berbeda dari sisi yang lain.`);
    }
  }

  // BU-nya diturunkan dari outletnya, bukan dari kolom kasnya.
  if (!/o\.business_unit_id = p_bu/.test(mig150)) {
    salah('0150: BU-nya tidak diturunkan dari outlet — kas BU lain bisa ikut, atau tidak ada yang ikut sama sekali.');
  }
}

// ---------------------------------------------------------------
// 1c. Saringan bahan / selain bahan — satu aturan, dua tempat.
// ---------------------------------------------------------------
const jenis = baca('js/modules/cash/jenis-pengeluaran.js');
if (jenis) {
  const kode = bersih(jenis, 'jenis-pengeluaran.js', ['export function untukBahan']);
  for (const f of ['untukBahan', 'selainBahan', 'saringPengeluaran', 'ringkasPengeluaran']) {
    if (!new RegExp(`export function ${f}\\(`).test(kode)) salah(`jenis-pengeluaran.js: \`${f}\` tidak diekspor.`);
  }
  // `selainBahan` BUKAN sekadar `!untukBahan`: kas masuk & transfer juga bukan
  // bahan, tapi mereka bukan pengeluaran. Tanpa penjaga ini kas masuk ikut
  // terhitung sebagai "pengeluaran selain bahan".
  const iSelain = kode.indexOf('export function selainBahan');
  const fnSelain = iSelain < 0 ? '' : kode.slice(iSelain, kode.indexOf('\n}', iSelain));
  if (!/if \(!entri \|\| entri\.entry_type !== 'out'\) return false;/.test(fnSelain)) {
    salah('jenis-pengeluaran.js `selainBahan`: kas masuk & transfer ikut terhitung sebagai pengeluaran.');
  }
  // Nilai saringan yang tidak dikenal tidak boleh mengosongkan daftarnya.
  if (!/return daftar;/.test(kode)) {
    salah('jenis-pengeluaran.js: nilai saringan yang tidak dikenal mengosongkan daftarnya — terlihat seperti "tidak ada datanya".');
  }

  // ============ PENJAGA YANG LAHIR DARI BUG SUNGGUHAN ============
  //
  // `untuk_nota` sempat tidak ikut di `select` milik `listCashEntriesAdmin`.
  // `untukBahan()` lalu selalu false, dan layar berbunyi "0 untuk bahan · 35
  // selain bahan" sambil menampilkan tautan "Pembayaran nota TRM-…" di kolom
  // sebelahnya — layar yang membantah dirinya sendiri, tanpa satu pun galat.
  //
  // Daftar kolomnya sekarang DIBACA dari modulnya sendiri dan dipatok ke
  // query-nya. Bukan daftar yang ditulis ulang di sini: dua daftar akan
  // menyimpang, dan yang menyimpang berhenti menjaga apa pun.
  const mCol = /export const KOLOM_DIBUTUHKAN = \[([^\]]*)\]/.exec(kode);
  if (!mCol) salah('jenis-pengeluaran.js: `KOLOM_DIBUTUHKAN` tidak ada — auditnya kehilangan daftarnya.');
  else {
    const kolom = [...mCol[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
    if (kolom.length < 5) salah(`jenis-pengeluaran.js: KOLOM_DIBUTUHKAN cuma memuat ${kolom.length} kolom.`);
    // DIBACA TANPA KOMENTAR. Komentar di atas `select` menyebut `untuk_nota`
    // untuk menjelaskan kenapa ia harus ada — dan versi pertama audit ini
    // membaca berkas mentah, jadi sabotase yang MENCABUT kolomnya dari
    // select-nya tetap hijau: katanya masih ketemu, di penjelasannya sendiri.
    const svcMentah = baca('js/modules/cash/cash.service.js');
    const svcKas = svcMentah ? tanpaKomentar(svcMentah) : null;
    if (svcKas) {
      const iSel = svcKas.indexOf('export async function listCashEntriesAdmin');
      const sel = iSel < 0 ? '' : svcKas.slice(iSel, svcKas.indexOf('.order(', iSel));
      if (!sel) salah('cash.service.js: `listCashEntriesAdmin` tidak ditemukan — audit ini kehilangan sasarannya.');
      else {
        for (const k of kolom) {
          if (!new RegExp(`\\b${k}\\b`).test(sel)) {
            salah(
              `cash.service.js \`listCashEntriesAdmin\`: kolom "${k}" tidak ikut di \`select\`, padahal ` +
                '`jenis-pengeluaran.js` menuntutnya. Kolom yang tidak diminta dibaca sebagai "tidak ada isinya", ' +
                'dan saringannya salah menggolongkan SELURUH baris tanpa satu pun galat.'
            );
          }
        }
      }
    }
  }
}

// ---------------------------------------------------------------
// 1d. Nomor kas — satu rumus, dua layar.
// ---------------------------------------------------------------
const kode_ = baca('js/modules/cash/kode-kas.js');
if (kode_) {
  const k = bersih(kode_, 'kode-kas.js', ['export function kodeKas']);
  for (const f of ['kodeKas', 'cocokKodeKas']) {
    if (!new RegExp(`export function ${f}\\(`).test(k)) salah(`kode-kas.js: \`${f}\` tidak diekspor.`);
  }
  // Id kosong -> string kosong, BUKAN "KAS-": yang terakhir terlihat seperti
  // nomor sungguhan yang rusak, dan orang akan mencarinya.
  if (!/if \(!s\) return '';/.test(k)) {
    salah('kode-kas.js: id kosong menghasilkan "KAS-" — nomor palsu yang akan dicari orang.');
  }
  // DUA layar memakainya. Dua salinan akan menghasilkan dua nomor berbeda
  // untuk baris yang sama, dan pencariannya berhenti bekerja tanpa galat.
  for (const rel of ['js/modules/inventory/esb.service.js', 'js/modules/cash/cash.admin.page.js']) {
    const isi = baca(rel);
    if (isi && !/from '.*kode-kas\.js'/.test(isi)) {
      salah(`${rel}: nomor kas tidak diambil dari \`kode-kas.js\` — rumusnya disalin, dan salinan akan menyimpang.`);
    }
  }
}

const halKas = baca('js/modules/cash/cash.admin.page.js');
if (halKas) {
  const k = bersih(halKas, 'cash.admin.page.js', ['kodeKas(r.id)']);
  // Nomor yang ditampilkan layar EKSPOR harus bisa ditemukan di layar ini —
  // kalau tidak, "KAS-7E9CF9F2" cuma nomor yang tidak menunjuk ke mana pun.
  if (!/kodeKas\(r\.id\)/.test(k)) {
    salah(
      'cash.admin.page.js: nomor kas tidak ditampilkan di tabel Mutasi Kas. Layar ekspor menyebut "KAS-7E9CF9F2" di ' +
        'daftar yang tertahan, dan tidak ada satu pun layar tempat nomor itu bisa dicari.'
    );
  }
  if (!/id="cm-kode"/.test(k) || !/cocokKodeKas\(r\.id, cariKode\)/.test(k)) {
    salah('cash.admin.page.js: tidak ada kotak cari nomor kas, atau kotaknya digambar tapi tidak dipakai menyaring.');
  }
}

const adminKas = baca('js/modules/cash/cash.admin.page.js');
if (adminKas) {
  const kode = bersih(adminKas, 'cash.admin.page.js', ['saringPengeluaran(']);
  if (!/id="cm-bahan"/.test(kode)) {
    salah('cash.admin.page.js: saringan bahan/selain-bahan tidak ada di layar Mutasi Kas.');
  }
  if (!/saringPengeluaran\(rows, saringBahan\)/.test(kode)) {
    salah('cash.admin.page.js: saringannya digambar tapi tidak dipakai menyaring.');
  }
  // Ringkasannya dihitung dari SELURUH baris, sebelum disaring. Kalau angkanya
  // ikut menyusut, yang membacanya kehilangan petunjuk berapa yang di sisi lain.
  const iRingkas = kode.indexOf('const rincian = ringkasPengeluaran(rows);');
  const iSaring = kode.indexOf('rows = saringPengeluaran(rows, saringBahan);');
  if (iRingkas < 0 || iSaring < 0 || iRingkas > iSaring) {
    salah('cash.admin.page.js: ringkasan per jenis dihitung SESUDAH disaring — angkanya ikut menyusut dan kehilangan artinya.');
  }
  if (!/#cm-bahan'\)\.addEventListener\('change'/.test(kode)) {
    salah('cash.admin.page.js: saringannya tidak menggambar ulang saat dipilih.');
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
    // COA dari OUTLET MILIK KANTONG (0151), bukan kategori biaya.
    ['coa', /peta\?\.coa\?\.get\?\.\(normalNama\(c\.kantong_outlet_nama\)\)/],
    ['payment_method', /peta\?\.payment_method\?\.get\?\.\(normalNama\(caraBayar\)\)/]
  ]) {
    if (!pola.test(kode)) {
      salah(
        `esb-disbursement.js: pencarian peta \`${nama}\` tidak memakai \`normalNama\` — aturan yang BERBEDA dari ` +
          '`buatPeta` yang menyimpan kuncinya, jadi nilai ber-spasi ganda tidak akan pernah ketemu padanannya.'
      );
    }
  }
  // ============ COA TIDAK BOLEH KEMBALI KE KATEGORI, ATAU JATUH KE BRANCH ============
  //
  // Dua regresi yang menghasilkan berkas yang DITERIMA ESB dengan tenang dan
  // mendarat di akun yang salah — tidak ada layar Berjaya Hub yang bisa
  // menunjukkannya, dan yang menemukannya membaca laporan ESB berminggu-minggu
  // kemudian.
  if (/peta\?\.coa\?\.get\?\.\(normalNama\(c\.kategori_nama\)\)/.test(kode)) {
    salah(
      'esb-disbursement.js: kolom `Account` kembali dibaca dari KATEGORI BIAYA. Contoh di templatenya berisi ' +
        "'1 1 02 01' — akun HARTA. Kolom itu menyatakan dari mana uangnya keluar, bukan untuk apa dibelanjakan."
    );
  }
  if (/peta\?\.coa\?\.get\?\.\(normalNama\(c\.outlet_nama\)\)/.test(kode)) {
    salah(
      'esb-disbursement.js: kolom `Account` jatuh ke outlet PERUNTUKAN. Itu kolom `Branch`; sumber dananya adalah ' +
        'outlet MILIK KANTONG. Keduanya sering sama — dan berbeda persis di baris yang paling perlu diperiksa.'
    );
  }
  // Entri tanpa outlet kantong TERTAHAN, tidak ditebak.
  if (!/catat\('kantong', c\.kantong_nama, kode\)/.test(kode)) {
    salah(
      'esb-disbursement.js: entri yang kantongnya tanpa outlet tidak ditahan dengan alasan sendiri. Tanpa itu ia ' +
        'berangkat dengan sel Account kosong, atau ditahan dengan alasan "COANo (kosong)" yang tidak menunjuk ke ' +
        'layar mana pun.'
    );
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
  for (const f of ['kasUntukEsb', 'tandaiKasEsb', 'batalkanTandaKasEsb', 'kasBertandaEsb']) {
    if (!new RegExp(`export (async )?function ${f}\\(`).test(kode)) salah(`esb.service.js: \`${f}\` tidak ada.`);
  }
  // `kodeKas` pindah ke `js/modules/cash/kode-kas.js` — ia nomor kas, bukan
  // urusan ESB, dan layar Mutasi Kas memakainya juga.
  if (!/import \{ kodeKas \} from '\.\.\/cash\/kode-kas\.js'/.test(kode)) {
    salah('esb.service.js: nomor kas tidak diambil dari modulnya — rumusnya disalin, dan salinan akan menyimpang.');
  }
  // SARINGANNYA PINDAH KE DATABASE (0150), dan itu bukan kerapian.
  //
  // Versi pertama menyaringnya di sini dengan `business_unit_id` — kolom yang
  // DEPRECATED sejak 0040 dan selalu NULL untuk entri baru. Hasilnya nol baris,
  // dan layarnya berbunyi "tidak ada kas keluar baru" sementara Mutasi Kas di
  // sebelahnya menampilkan entrinya. Yang dijaga di sini sekarang: jalur ini
  // TIDAK menyusun saringannya sendiri lagi.
  if (!/supabase\.rpc\(\s*'kas_untuk_esb'/.test(kode)) {
    salah('esb.service.js `kasUntukEsb`: tidak lewat RPC `kas_untuk_esb` — saringannya disusun lagi di klien.');
  }
  // Keterangan kantong diteruskan APA ADANYA. Kalau ia diratakan jadi string
  // kosong di sini, SELURUH kas keluar tertahan dengan alasan "kantongnya
  // belum punya outlet" — untuk kantong yang outletnya ada dan terlihat jelas
  // di layar Kantong Kas. Tes murni tidak bisa melihatnya: ia tidak menyentuh
  // layanan sama sekali.
  for (const k of ['kantong_nama', 'kantong_outlet_nama']) {
    if (!new RegExp(`${k}: c\\.${k} \\?\\? ''`).test(kode)) {
      salah(`esb.service.js \`kasUntukEsb\`: \`${k}\` tidak diteruskan dari RPC — kolom Account kehilangan sumbernya, diam-diam.`);
    }
  }
  if (!/outlet_kantong_kas_esb/.test(kode)) {
    salah('esb.service.js: `outletKantongKasEsb` tidak ada — layar pemetaan kehilangan nama outlet kantong lintas BU.');
  }
  if (/\.from\('cash_entries'\)/.test(kode)) {
    salah(
      'esb.service.js: kembali membaca `cash_entries` langsung. Saringan "selain bahan" lalu hidup di DUA tempat, ' +
        'dan yang menyimpang akan menandai baris yang tidak pernah ikut terunduh.'
    );
  }
  if (/business_unit_id.*cash|cash.*business_unit_id/.test(kode)) {
    salah(
      'esb.service.js: kas disaring lewat `business_unit_id` lagi. Kolom itu DEPRECATED sejak 0040 dan selalu NULL ' +
        'untuk entri baru — saringannya cocok dengan NOL baris, tanpa satu pun galat.'
    );
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
  // Diperiksa PER KOLOM, bukan sebagai satu potongan kalimat: menyisipkan satu
  // kolom di antaranya (seperti `untuk_nota`) akan memutus pola yang mematok
  // urutannya, dan auditnya merah tanpa ada yang rusak.
  const iSelAdm = kode.indexOf('export async function listCashEntriesAdmin');
  const selAdm = iSelAdm < 0 ? '' : kode.slice(iSelAdm, kode.indexOf('.order(', iSelAdm));
  if (!/\bsupplier\b/.test(selAdm)) {
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
  // ============ DAFTAR PEMETAAN COA (0151) ============
  //
  // Kuncinya SUMBER DANA: cara bayar nota + outlet pemilik kantong. Tanpa
  // outletnya di daftar, kolom `Account` tidak akan pernah punya padanan,
  // SELURUH kas keluar tertahan, dan tidak ada satu pun baris di layar untuk
  // membereskannya.
  if (!/coa: \[\.\.\.CARA_BAYAR, \.\.\.outlets\.map\(\(o\) => o\.name\), \.\.\.outletKantong\]/.test(kode)) {
    salah(
      'esb.admin.js: daftar pemetaan COA tidak berisi outlet + outlet kantong. Kolom `Account` tidak akan pernah ' +
        'punya padanan, dan alasan tertahannya menunjuk ke baris yang tidak ada.'
    );
  }
  // Outlet kantong LINTAS BU ikut — tanpa RPC-nya, nama seperti itu muncul
  // sebagai alasan tertahan tanpa baris untuk memperbaikinya.
  if (!/outletKantongKasEsb\(businessUnitId\)\.catch\(\(\) => \[\]\)/.test(kode)) {
    salah('esb.admin.js: daftar outlet kantong tidak dimuat, atau kegagalannya tidak ditangkap.');
  }
  // KATEGORI BIAYA TIDAK BOLEH KEMBALI. Selama ia di sana, layar ini
  // menampilkan baris merah abadi untuk pekerjaan yang tidak dipakai berkas
  // mana pun — di tabel yang gunanya justru menyebutkan pekerjaan yang perlu.
  if (/kategoriKas/.test(kode) || /listCashCategories/.test(kode)) {
    salah(
      'esb.admin.js: kategori biaya kas kembali ke daftar pemetaan COA. Ia dibuang di 0151 — kolom `Account` ' +
        'menyatakan sumber dana, bukan jenis biaya.'
    );
  }
  for (const k of ['tanggal-kas', 'jumlah-kas', 'kantong']) {
    // Kunci tanpa tanda hubung ditulis tanpa kutip di objek literal; keduanya
    // diterima supaya audit ini tidak menuntut gaya penulisan tertentu.
    if (!new RegExp(`(?:'${k}'|\\b${k}): `).test(kode)) {
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
  // DUA tempat memuat daftar supplier, dan KEDUANYA pernah memakai kolom yang
  // selalu NULL. Yang pertama membuat kotaknya tidak pernah digambar; yang
  // kedua membuat aksi massalnya selalu berhenti di "Daftar supplier ESB belum
  // diimpor" — kalimat yang menyuruh mengimpor daftar yang sudah ada.
  for (const [nama, pola] of [
    ['dialog koreksi', /listEsbMaster\(buKasEntri\(r\), 'supplier'\)/],
    ['aksi massal "Isi Supplier"', /const bu = buKasEntri\(semuaPerId\.get\(ids\[0\]\)\);/]
  ]) {
    if (!pola.test(kode)) {
      salah(
        `cash.admin.page.js: ${nama} tidak memakai \`buKasEntri\`. \`cash_entries.business_unit_id\` DEPRECATED ` +
          'sejak 0040 dan selalu NULL — daftar suppliernya kosong, tanpa satu pun galat.'
      );
    }
  }
  if (/business_unit_id/.test(kode)) {
    salah(
      'cash.admin.page.js: `business_unit_id` dibaca langsung dari barisnya lagi. Kolom itu selalu NULL sejak 0040; ' +
        'BU-nya diturunkan dari outlet lewat `buKasEntri`.'
    );
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

// ---------------------------------------------------------------
// 7. Migration 0151 — COA lewat outlet MILIK KANTONG.
// ---------------------------------------------------------------
const mig151 = baca('supabase/migrations/0151_coa_disbursement_dari_kantong.sql');
if (mig151) {
  // Tipe kembalian berubah, jadi `create or replace` saja akan ditolak
  // Postgres dengan "cannot change return type" — dan migration yang gagal di
  // tengah meninggalkan setengah perubahan.
  if (!/drop function if exists kas_untuk_esb\(uuid, date, date, uuid, boolean\);/.test(mig151)) {
    salah('0151: `kas_untuk_esb` tidak di-drop dulu. Menambah kolom pada `returns table` ditolak `create or replace`.');
  }
  for (const k of ['kantong_nama text', 'kantong_outlet_nama text']) {
    if (!mig151.includes(k)) salah(`0151: kolom \`${k}\` tidak ada di kembalian \`kas_untuk_esb\`.`);
  }
  // KEDUANYA `left join`. `join` biasa menghilangkan entri yang kantongnya
  // tanpa outlet — dan hilang dari daftar berarti hilang dari daftar tertahan
  // juga: "12 siap, 0 tertahan" untuk 20 entri, tanpa satu pun tempat bagi
  // delapan sisanya untuk muncul.
  for (const [nama, pola] of [
    ['cash_accounts', /left join cash_accounts ca on ca\.id = ce\.account_id/],
    ['outlet kantong', /left join outlets ko on ko\.id = ca\.outlet_id/]
  ]) {
    if (!pola.test(mig151)) {
      salah(`0151: \`${nama}\` tidak di-LEFT JOIN — entri tanpa kantong lenyap dari daftar, termasuk dari daftar tertahan.`);
    }
  }
  if (!/coalesce\(ca\.name, 'Kas Utama'\)/.test(mig151)) {
    salah('0151: kantong tanpa baris tidak dinamai "Kas Utama" — alasan tertahannya tidak cocok dengan yang dilihat orang di Staff App.');
  }
  // Saringan "selain bahan" & wewenang outlet HARUS ikut terbawa saat fungsinya
  // ditulis ulang. Menulis ulang fungsi berarti mengetik ulang seluruh isinya.
  for (const [nama, pola] of [
    ['untuk_nota', /and ce\.untuk_nota = false/],
    ['penyesuaian_nota', /and ce\.penyesuaian_nota is null/],
    ['dicoret', /and ce\.dicoret_at is null/],
    ['sumbu outlet', /and o\.business_unit_id = p_bu/],
    ['belum diekspor', /and \(p_termasuk_sudah_ekspor or ce\.esb_exported_at is null\)/],
    ['wewenang outlet', /and is_admin_of_outlet\(auth\.uid\(\), ce\.outlet_id\)/]
  ]) {
    if (!pola.test(mig151)) {
      salah(`0151: penjaga "${nama}" HILANG saat \`kas_untuk_esb\` ditulis ulang di 0151.`);
    }
  }
  if (!/create or replace function outlet_kantong_kas_esb\(p_bu uuid\)/.test(mig151)) {
    salah('0151: `outlet_kantong_kas_esb` tidak ada — outlet kantong lintas BU akan menahan entri tanpa baris untuk memperbaikinya.');
  }
  if (!/grant execute on function outlet_kantong_kas_esb\(uuid\) to authenticated;/.test(mig151)) {
    salah('0151: `outlet_kantong_kas_esb` tidak bisa dipanggil siapa pun — RPC-nya balas 404, dan layarnya diam saja.');
  }
}

// ---------------------------------------------------------------
// 8. Supplier kas WAJIB & dari daftar — satu aturan, tiga form.
// ---------------------------------------------------------------
const sup = baca('js/modules/cash/supplier-kas.js');
if (sup) {
  const kode = bersih(sup, 'supplier-kas.js', ['export function periksaSupplierKas']);
  // BU dari OUTLET, bukan kolom yang selalu NULL.
  if (!/return entri\.outlets\?\.business_unit_id \?\? entri\.business_unit_id \?\? null;/.test(kode)) {
    salah(
      'supplier-kas.js: `buKasEntri` tidak membaca BU dari outletnya. `cash_entries.business_unit_id` DEPRECATED ' +
        'sejak 0040 dan selalu NULL — daftar suppliernya kosong, dan kotaknya tidak pernah digambar.'
    );
  }
  // Wajib HANYA kalau daftarnya ada — sama dengan aturan Purpose (0147).
  if (!/return Array\.isArray\(daftarInduk\) && daftarInduk\.length > 0;/.test(kode)) {
    salah(
      'supplier-kas.js: kewajiban tidak lagi bergantung pada adanya daftar induk. BU yang belum mengimpor Master ' +
        'Supplier akan kehilangan SELURUH kemampuan mencatat kas keluar.'
    );
  }
  // Nilai lama di luar daftar tetap ditawarkan — kalau tidak, koreksi hal lain
  // MENGHAPUS nama yang sudah tersimpan (bug 0119, bentuk keempat).
  if (!/opsi\.unshift\(\{ value: lama, label: lama, hint: HINT_DI_LUAR_DAFTAR \}\)/.test(kode)) {
    salah('supplier-kas.js: nilai lama di luar daftar tidak ditawarkan — membuka dialog koreksi akan menghapusnya saat disimpan.');
  }
  // …dan nilai lama yang tidak disentuh tetap boleh disimpan, kalau tidak
  // dialognya jadi form yang tidak bisa disimpan sama sekali.
  if (!/if \(lama && normalNama\(v\) === normalNama\(lama\)\) return null;/.test(kode)) {
    salah('supplier-kas.js: nilai lama ditolak setiap kali — dialog koreksi entri lama jadi form yang mustahil disimpan.');
  }
  if (!/import \{ normalNama \} from '\.\.\/inventory\/cocok-supplier\.js';/.test(kode)) {
    salah('supplier-kas.js: pembanding namanya disalin, bukan dipinjam dari `cocok-supplier.js` — dua aturan untuk satu pekerjaan pasti menyimpang.');
  }
}

// Ketiga form memakai modul itu, dan tidak satu pun masih membolehkan nama
// bebas. `allowCreate` di kolom supplier kas adalah nama yang ditolak ESB saat
// berkasnya diimpor — jauh dari orang yang mengetiknya.
for (const rel of ['js/modules/cash/cash.page.js', 'js/modules/cash/cash.admin.page.js']) {
  const isi = baca(rel);
  if (!isi) continue;
  const kode = bersih(isi, rel, ["name: 'supplier'"]);
  const nama = rel.split('/').pop();
  if (!/from '\.\/supplier-kas\.js'/.test(kode)) {
    salah(`${nama}: aturan supplier kas ditulis ulang di layar alih-alih diambil dari \`supplier-kas.js\`.`);
  }
  // DIHITUNG, bukan sekadar "ada". Kedua berkas ini punya DUA form yang
  // menulis kolom supplier — form tambah & dialog koreksi di `cash.page.js`,
  // dialog koreksi & aksi massal di `cash.admin.page.js`. Mencari satu
  // kemunculan membuat audit ini tetap hijau saat pemeriksaan di salah satu
  // form dicabut: yang ketemu adalah pemeriksaan milik form yang lain.
  //
  // Bentuk kegagalan itu sudah berulang kali muncul di repo ini — audit hijau
  // karena sasarannya ada di tempat lain.
  const nPeriksa = (kode.match(/periksaSupplierKas\(/g) ?? []).length;
  if (nPeriksa < 2) {
    salah(
      `${nama}: isian supplier cuma diperiksa di ${nPeriksa} dari 2 tempat. Nama di luar daftar yang lolos lewat ` +
        'form yang longgar baru ketahuan berminggu-minggu kemudian, sebagai baris tertahan.'
    );
  }
  // Blok kolom suppliernya saja yang diperiksa: `allowCreate` sah di kolom lain.
  for (const m of kode.matchAll(/name: 'supplier',[\s\S]{0,400}?\n\s*\}/g)) {
    if (/allowCreate/.test(m[0])) {
      salah(`${nama}: kolom supplier kas masih membolehkan nama diketik sendiri — ESB menolaknya saat berkasnya diimpor.`);
    }
    if (!/required: true/.test(m[0])) {
      salah(`${nama}: kolom supplier kas tidak wajib diisi.`);
    }
  }
}

// Embed outletnya ikut diambil — tanpa itu `buKasEntri` tidak punya apa pun
// untuk dibaca, dan kotak suppliernya kembali tidak digambar.
const svcKas = baca('js/modules/cash/cash.service.js');
if (svcKas) {
  const kode = bersih(svcKas, 'cash.service.js', ['listCashEntriesAdmin']);
  const i = kode.indexOf('listCashEntriesAdmin');
  // Jendelanya lebar karena `tanpaKomentar` MENGOSONGKAN komentar tanpa
  // memendekkan berkasnya — offsetnya tetap, jadi blok ini sebagian besar
  // berisi spasi. Jendela sempit membuat audit ini merah karena panjang
  // komentar, bukan karena kodenya.
  const blok = i < 0 ? '' : kode.slice(i, i + 4000);
  if (!/outlets!outlet_id\(name, business_unit_id\)/.test(blok)) {
    salah(
      'cash.service.js: `listCashEntriesAdmin` tidak mengambil `outlets!outlet_id(name, business_unit_id)`. Tanpa ' +
        'itu BU entrinya tidak diketahui, daftar suppliernya kosong, dan kotak Supplier di dialog admin tidak ' +
        'pernah digambar — tanpa satu pun galat.'
    );
  }
}

console.log('');
if (gagal === 0) console.log('Audit Disbursement bersih. ✅');
else console.error(`${gagal} masalah ditemukan.`);
process.exit(gagal === 0 ? 0 : 1);
