/**
 * AUDIT: Purpose waste/spoil — dipilih orang, disimpan apa adanya, dijaga ESB.
 *
 * ============ CARA FITUR INI RUSAK TANPA TERLIHAT RUSAK ============
 *
 *   Purpose ditebak dari jenis/kategori -> biaya waste masuk ke akun COGS yang
 *                                          SALAH. Angkanya tetap wajar, dan
 *                                          tidak ada satu pun petunjuk
 *   yang kosong berangkat sebagai ''     -> ESB menerimanya, jurnalnya masuk
 *                                          tanpa akun tujuan
 *   ejaan yang DIKETIK ikut terkirim     -> "waste bar" huruf kecil ditolak
 *                                          ESB, di layar yang berbeda
 *   wajib padahal daftarnya belum ada    -> staff berdiri di dapur dengan
 *                                          barang rusak dan tombol Simpan yang
 *                                          menolak, karena admin belum sempat
 *                                          mengunggah sebuah berkas Excel
 *   dua overload catat_waste             -> permintaan yang kehilangan
 *                                          p_purpose tersimpan diam-diam tanpa
 *                                          Purpose
 *   tidak ada jalan mengisi mundur       -> ratusan kejadian lama tertahan
 *                                          selamanya, jalan keluarnya SQL Editor
 *   yang sudah diekspor bisa diubah      -> catatan berbeda di dua tempat,
 *                                          selamanya, tanpa satu pun tanda
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
// 1. Migration 0147.
// ---------------------------------------------------------------
const mig = baca('supabase/migrations/0147_purpose_waste.sql');
if (mig) {
  for (const k of ['purpose', 'purpose_diisi_by', 'purpose_diisi_at']) {
    if (!new RegExp(`add column if not exists ${k}\\b`).test(mig)) {
      salah(`0147: kolom \`${k}\` tidak ditambahkan ke waste_runs.`);
    }
  }

  // SATU tempat yang memutuskan nilainya sah. Aturan yang ditulis dua kali
  // pasti menyimpang, dan yang menyimpang mengirim nilai yang ditolak ESB.
  if (!/create or replace function purpose_esb_sah\(p_bu uuid, p_purpose text\)/.test(mig)) {
    salah('0147: `purpose_esb_sah` tidak ada.');
  }
  const iSah = mig.indexOf('function purpose_esb_sah');
  const fnSah = iSah < 0 ? '' : mig.slice(iSah, mig.indexOf('$$;', iSah));
  if (!/if not v_ada then\s+return v;/.test(fnSah)) {
    salah(
      '0147 `purpose_esb_sah`: BU yang belum mengimpor daftar Purpose ikut dikunci. Staff akan berdiri di dapur ' +
        'dengan barang rusak dan tombol Simpan yang menolak, karena admin belum sempat mengunggah sebuah berkas Excel.'
    );
  }
  if (!/if v is null then\s+return null;/.test(fnSah)) {
    salah('0147 `purpose_esb_sah`: nilai kosong tidak lagi dibolehkan — mencatat waste jadi mustahil sebelum daftarnya ada.');
  }
  if (!/select m\.nama into v_kanonik/.test(fnSah)) {
    salah(
      '0147 `purpose_esb_sah`: yang dikembalikan bukan ejaan kanonik dari daftarnya. "waste bar" huruf kecil akan ' +
        'tersimpan apa adanya dan ditolak ESB — di layar yang berbeda, berminggu-minggu kemudian.'
    );
  }
  if (!/lower\(btrim\(m\.nama\)\) = lower\(v\)/.test(fnSah)) {
    salah('0147 `purpose_esb_sah`: pencocokannya membedakan huruf besar-kecil — pilihan yang sah akan ditolak.');
  }

  // TANDA TANGAN LAMA DIBUANG. Dua overload = permintaan yang kehilangan
  // p_purpose memilih yang lama, tersimpan tanpa Purpose, tanpa satu pun pesan.
  if (!/drop function if exists catat_waste\(uuid, text, uuid, numeric, text, text\);/.test(mig)) {
    salah(
      '0147: tanda tangan 6-argumen `catat_waste` tidak dibuang. PostgREST memilih overload lewat HIMPUNAN NAMA ' +
        'ARGUMEN — permintaan yang kehilangan `p_purpose` akan diam-diam memilih yang lama dan tersimpan tanpa Purpose.'
    );
  }
  if (!/create or replace function catat_waste\([\s\S]{0,200}p_purpose text\s*\) returns uuid/.test(mig)) {
    salah('0147: `catat_waste` tidak menerima `p_purpose`.');
  }
  const iCatat = mig.indexOf('create or replace function catat_waste');
  const fnCatat = iCatat < 0 ? '' : mig.slice(iCatat, mig.indexOf('$$;', iCatat));
  if (!/v_purpose := purpose_esb_sah\(v_bu, p_purpose\);/.test(fnCatat)) {
    salah('0147 `catat_waste`: nilainya tidak diperiksa — ejaan liar masuk ke database dan ditolak ESB belakangan.');
  }
  // Diperiksa SEBELUM barisnya ditulis dan stok bergerak.
  const iPeriksa = fnCatat.indexOf('purpose_esb_sah');
  const iInsert = fnCatat.indexOf('insert into waste_runs');
  if (iPeriksa >= 0 && iInsert >= 0 && iPeriksa > iInsert) {
    salah('0147 `catat_waste`: Purpose diperiksa SESUDAH barisnya ditulis — penolakannya meninggalkan kejadian separuh jadi.');
  }
  if (!/case when v_purpose is null then null else v_uid end/.test(fnCatat)) {
    salah('0147 `catat_waste`: pengisi Purpose dikarang untuk kejadian yang Purpose-nya kosong — jejak yang tidak pernah terjadi.');
  }

  // JALAN MENGISI MUNDUR. Tanpa ini, seluruh kejadian yang sudah ada tertahan
  // selamanya dan jalan keluarnya SQL Editor.
  if (!/create or replace function ubah_purpose_waste\(p_waste uuid\[\], p_purpose text\)/.test(mig)) {
    salah('0147: `ubah_purpose_waste` tidak ada — kejadian lama tidak punya cara diisi Purpose-nya.');
  }
  const iUbah = mig.indexOf('function ubah_purpose_waste');
  const fnUbah = iUbah < 0 ? '' : mig.slice(iUbah, mig.indexOf('$$;', iUbah));
  if (!/is_bu_admin\(v_uid, w\.business_unit_id\)/.test(fnUbah)) {
    salah('0147 `ubah_purpose_waste`: tidak memeriksa is_bu_admin — fungsinya `security definer`, jadi siapa pun bisa.');
  }
  if (!/and w\.esb_exported_at is null/.test(fnUbah)) {
    salah(
      '0147 `ubah_purpose_waste`: kejadian yang SUDAH diekspor ikut berubah. Berkasnya sudah berangkat membawa nilai ' +
        'lama — catatannya jadi berbeda di dua tempat, selamanya, tanpa satu pun tanda.'
    );
  }
  if (!/Batalkan tanda ekspor/.test(fnUbah)) {
    salah('0147 `ubah_purpose_waste`: penolakannya tidak menyebut jalan keluarnya — yang membacanya akan membuka SQL Editor.');
  }
  if (!/purpose_esb_sah\(v_bu, p_purpose\)/.test(fnUbah)) {
    salah('0147 `ubah_purpose_waste`: nilainya tidak diperiksa lewat penjaga yang sama dengan jalur staff.');
  }
  // BU-nya diambil dari waste-nya sendiri, bukan dari klien. Daftar induk
  // berlaku per BU, dan memercayai klien berarti nilai milik BU lain lolos.
  if (!/select w\.business_unit_id into v_bu/.test(fnUbah)) {
    salah('0147 `ubah_purpose_waste`: BU-nya tidak diambil dari waste-nya sendiri — daftar induk BU lain bisa lolos.');
  }

  // View-nya memuat Purpose, dan KOLOM LAMA TIDAK BERGESER.
  if (!/create or replace view waste_rekap as/.test(mig)) {
    salah('0147: `waste_rekap` tidak diperbarui — layar rekap tidak akan pernah melihat kolom Purpose.');
  }
  if (!/w\.purpose\s+as purpose/.test(mig) || !/null::text\s+as purpose/.test(mig)) {
    salah('0147: kolom purpose tidak ada di KEDUA cabang `union all` — jumlah kolomnya tidak sama dan view-nya gagal dibuat.');
  }
  if (!/\(w\.esb_exported_at is not null\) as esb_terkunci/.test(mig)) {
    salah('0147: penanda `esb_terkunci` tidak ada — layar akan menawarkan tombol Edit yang pasti ditolak database.');
  }
}

// ---------------------------------------------------------------
// 2. Modul murninya.
// ---------------------------------------------------------------
const murni = baca('js/modules/inventory/purpose-esb.js');
if (murni) {
  const kode = bersih(murni, 'purpose-esb.js', ['export function periksaPurpose']);
  for (const f of ['opsiPurpose', 'purposeWajib', 'periksaPurpose', 'normalPurpose']) {
    if (!new RegExp(`export function ${f}\\(`).test(kode)) salah(`purpose-esb.js: \`${f}\` tidak diekspor.`);
  }
  if (!/if \(!daftar\.length\) \{\s*return \{ boleh: true, nilai: null/.test(kode)) {
    salah('purpose-esb.js: tanpa daftar induk, isiannya jadi wajib — pencatatan waste mati sebelum admin mengimpor daftarnya.');
  }
  if (!/return \{ boleh: true, nilai: cocok\.value/.test(kode)) {
    salah('purpose-esb.js: yang dikembalikan bukan ejaan dari daftarnya — nama yang diketik akan terkirim apa adanya.');
  }
  // Tanda baca TIDAK dibuang: "COGS - Food" dan "COGS Food" berbeda bagi ESB.
  if (/replace\(\/\[\^a-z0-9\]/.test(kode)) {
    salah('purpose-esb.js: normalisasinya membuang tanda baca — dua nilai yang berbeda bagi ESB akan dianggap sama.');
  }
  if (!/if \(sudah\.has\(k\)\) continue;/.test(kode)) {
    salah('purpose-esb.js: nama kembar membuat yang TERAKHIR menang — ejaan yang dipakai jadi tergantung urutan dari database.');
  }
  if (!/if \(teks\(m\?\.jenis\) !== 'purpose'\) continue;/.test(kode)) {
    salah('purpose-esb.js: baris berjenis lain ikut jadi opsi — nama produk akan ditawarkan sebagai Purpose yang sah.');
  }
}

// ---------------------------------------------------------------
// 3. Ekspor Item Journal.
// ---------------------------------------------------------------
const journal = baca('js/modules/inventory/esb-journal.js');
if (journal) {
  const kode = bersih(journal, 'esb-journal.js', ['export function barisEsbJournal']);
  if (!/const purpose = teks\(w\.purpose\) \|\| null;/.test(kode)) {
    salah('esb-journal.js: Purpose tidak dibaca dari kejadiannya.');
  }
  // Menebaknya dari jenis atau kategori berarti biaya waste masuk ke akun COGS
  // yang salah — angkanya tetap wajar, dan tidak ada satu pun petunjuk.
  if (/peta\?\.purpose/.test(kode)) {
    salah('esb-journal.js: Purpose kembali dipetakan. Sumbunya "dapur/bar/kemasan" — tidak bisa diturunkan dari data yang ada.');
  }
  if (!/if \(adaMasalah \|\| !purpose\)/.test(kode)) {
    salah('esb-journal.js: waste tanpa Purpose tidak lagi ditahan — jurnalnya masuk ke ESB tanpa akun tujuan.');
  }
}

const pur = baca('js/modules/inventory/esb-purchase.js');
if (pur) {
  const kode = bersih(pur, 'esb-purchase.js', ['export const JENIS_PETA']);
  if (/JENIS_PETA = \[[^\]]*'purpose'/.test(kode)) {
    salah(
      "esb-purchase.js: 'purpose' kembali jadi jenis pemetaan. Layar pemetaan akan menumbuhkan kelompok \"Purpose\" " +
        'kosong yang tidak bisa dikerjakan siapa pun, dan yang membukanya menyangka ada pekerjaan yang tertinggal.'
    );
  }
}

// ---------------------------------------------------------------
// 4. Layanannya.
// ---------------------------------------------------------------
const wsvc = baca('js/modules/inventory/waste.service.js');
if (wsvc) {
  const kode = bersih(wsvc, 'waste.service.js', ['export async function catatWaste']);
  if (!/p_purpose: purpose \?\? null/.test(kode)) {
    salah(
      'waste.service.js: `p_purpose` tidak dikirim, atau dikirim sebagai `undefined`. `JSON.stringify` membuang kunci ' +
        'bernilai `undefined`, dan PostgREST lalu mencari `catat_waste` berargumen enam — yang sudah dibuang di 0147.'
    );
  }
  if (!/export async function ubahPurposeWaste\(wasteIds, purpose\)/.test(kode)) {
    salah('waste.service.js: `ubahPurposeWaste` tidak ada — Admin Portal tidak punya cara mengisi Purpose mundur.');
  }
  // Permintaan kolom baru TURUN BERTINGKAT, bukan gagal seluruhnya. Ini pernah
  // terjadi sungguhan pada 0122: satu kolom yang belum ada membuat layarnya
  // kehilangan seluruh daftar, bukan satu kolom.
  if (!/pola: \/\\b\(purpose\|esb_terkunci\)\\b\//.test(kode)) {
    salah('waste.service.js: permintaan kolom Purpose tidak punya jalur mundur — rekap waste mati total sebelum 0147 dijalankan.');
  }
  if (!/if \(!t\.pola \|\| !t\.pola\.test\(String\(e\?\.message \?\? ''\)\)\) throw e;/.test(kode)) {
    salah(
      'waste.service.js: galat yang BUKAN tentang kolomnya ikut ditelan. Masalah izin atau jaringan akan menyamar ' +
        'jadi "kolomnya belum ada", dan yang mencarinya membuka SQL Editor untuk migration yang sudah jalan.'
    );
  }
}

const esvc = baca('js/modules/inventory/esb.service.js');
if (esvc) {
  const kode = bersih(esvc, 'esb.service.js', ['export async function wasteUntukEsb']);
  if (!/select\('id, code, jenis, notes, purpose, outlet_id/.test(kode)) {
    salah('esb.service.js `wasteUntukEsb`: kolom `purpose` tidak diambil — setiap waste akan tertahan dengan alasan yang salah.');
  }
}

// ---------------------------------------------------------------
// 5. Form staff.
// ---------------------------------------------------------------
const inv = baca('js/modules/inventory/inventory.page.js');
if (inv) {
  const kode = bersih(inv, 'inventory.page.js', ['catatWaste(']);
  if (!/listEsbMaster\(businessUnitId, 'purpose'\)\.catch\(\(\) => \[\]\)/.test(kode)) {
    salah(
      'inventory.page.js: daftar Purpose tidak dimuat, atau kegagalannya tidak ditangkap. Barang yang sudah rusak ' +
        'tidak menunggu daftar induk terbaca — layar Bahan tidak boleh mati karena satu daftar tambahan.'
    );
  }
  if (!/const adaPurpose = purposeWajib\(purposeOptions\)/.test(kode)) {
    salah('inventory.page.js: barisnya tidak dikondisikan pada ada-tidaknya daftar.');
  }
  if (!/\.\.\.\(adaPurpose\s*\?/.test(kode)) {
    salah('inventory.page.js: kotak Purpose muncul walau daftarnya kosong — satu kotak yang tidak bisa diisi, untuk ditebak artinya.');
  }
  if (!/const cekPurpose = periksaPurpose\(v\.purpose, purposeOptions\);/.test(kode)) {
    salah('inventory.page.js: nilainya tidak diperiksa sebelum dikirim.');
  }
  if (!/purpose: cekPurpose\.nilai/.test(kode)) {
    salah('inventory.page.js: yang dikirim bukan ejaan hasil pemeriksaan — nama dari kotaknya berangkat apa adanya.');
  }
  // Diperiksa SEBELUM fotonya diunggah: unggahan yang berhasil lalu ditolak
  // meninggalkan berkas yatim di Storage, dan staff yang mengulanginya
  // mengunggahnya lagi.
  const iCek = kode.indexOf('periksaPurpose(v.purpose');
  const iUnggah = kode.indexOf('unggahFotoWaste(state.outletId');
  if (iCek >= 0 && iUnggah >= 0 && iCek > iUnggah) {
    salah('inventory.page.js: Purpose diperiksa SESUDAH fotonya diunggah — penolakannya meninggalkan berkas yatim di Storage.');
  }
}

// ---------------------------------------------------------------
// 6. Rekap di Admin Portal.
// ---------------------------------------------------------------
const lap = baca('js/modules/inventory/laporan-waste.js');
if (lap) {
  const kode = bersih(lap, 'laporan-waste.js', ['export function susunRekapWaste']);
  // Posisi kolomnya DITURUNKAN dari judulnya. Angka tetap akan membuat tombol
  // Edit menempel di sel Catatan begitu ada kolom baru di depannya — tanpa
  // melempar apa pun.
  if (!/export const KOLOM_PURPOSE = KOLOM_WASTE\.findIndex\(\(k\) => k\.header === 'Purpose'\);/.test(kode)) {
    salah('laporan-waste.js: posisi kolom Purpose tidak diturunkan dari judulnya.');
  }
  // Dihitung per KEJADIAN. Per baris membuat satu waste menu berbahan sepuluh
  // terbaca sebagai sepuluh pekerjaan.
  if (!/kejadianTanpaPurpose = new Set\(\)/.test(kode)) {
    salah('laporan-waste.js: kejadian tanpa Purpose dihitung per BARIS, bukan per kejadian — angkanya berlipat.');
  }
  if (!/if \(!purpose && !b\?\.lama && b\?\.waste_id\)/.test(kode)) {
    salah(
      'laporan-waste.js: baris LAMA ikut dihitung sebagai pekerjaan. Ia tidak punya `waste_runs` dan tidak bisa ' +
        'diekspor sama sekali — admin akan disuruh mengerjakan sesuatu yang tidak bisa dikerjakan, selamanya.'
    );
  }
  if (!/r\.purpose \|\| \(r\.lama \? '-' : PURPOSE_KOSONG\)/.test(kode)) {
    salah('laporan-waste.js: Purpose kosong jadi sel kosong — di Excel itu terbaca "tidak berlaku", bukan "belum dikerjakan".');
  }
  if (!/terkunci: r\.terkunci/.test(kode)) {
    salah('laporan-waste.js: penanda terkunci tidak diteruskan ke meta — layar akan menawarkan tombol yang pasti ditolak.');
  }
}

const adm = baca('js/modules/inventory/waste.admin.js');
if (adm) {
  const kode = bersih(adm, 'waste.admin.js', ['function selPurpose']);
  if (!/j === KOLOM_PURPOSE/.test(kode)) {
    salah('waste.admin.js: kolom Purpose tidak digambar sebagai sel khusus — tidak ada tombol untuk mengisinya.');
  }
  if (!/ubahPurposeWaste\(\[wasteId\], v\.purpose\)/.test(kode)) {
    salah('waste.admin.js: tidak ada jalan mengisi Purpose — jalan keluarnya kembali jadi SQL Editor.');
  }
  if (!/if \(meta\.terkunci\)/.test(kode)) {
    salah('waste.admin.js: kejadian yang sudah diekspor tetap diberi tombol — kliknya pasti ditolak database.');
  }
  if (!/if \(!meta\?\.wasteId \|\| meta\.lama\)/.test(kode)) {
    salah('waste.admin.js: baris lama diberi tombol Edit — tidak ada `waste_runs` yang bisa diubahnya.');
  }
  // Angka dari database DIBANDINGKAN dengan yang diminta. `0` yang dilaporkan
  // sebagai berhasil membuat admin mengira pekerjaannya selesai.
  if (!/if \(n === 0\) \{/.test(kode)) {
    salah('waste.admin.js: hasil `ubahPurposeWaste` tidak diperiksa — "0 berubah" dilaporkan sebagai berhasil.');
  }
  // DICARI DI DALAM `isiPurpose`, bukan di seluruh berkas.
  //
  // `await muat();` juga ada di ujung `renderWasteAdmin` — versi pertama audit
  // ini cuma menanyakan "apakah kalimatnya ada", dan sabotase yang
  // menghapusnya dari `isiPurpose` lolos karena kemunculan yang satunya masih
  // di sana. Sasaran yang ADA DI TEMPAT LAIN membuat audit hijau tanpa menjaga
  // apa pun — jebakan yang sudah berkali-kali menggigit di repo ini.
  const iIsi = kode.indexOf('async function isiPurpose(');
  const fnIsi = iIsi < 0 ? '' : kode.slice(iIsi, kode.indexOf('\n  }', iIsi));
  if (!fnIsi) salah('waste.admin.js: `isiPurpose` tidak ditemukan — audit ini kehilangan sasarannya.');
  else if (!/await muat\(\);/.test(fnIsi)) {
    salah('waste.admin.js: tabelnya tidak dimuat ulang sesudah Purpose diisi — tombolnya tetap berbunyi "belum diisi".');
  }
}

// ---------------------------------------------------------------
// 7. Impor Master Purpose & label yang tidak kembar.
// ---------------------------------------------------------------
const esb = baca('js/modules/inventory/esb.admin.js');
if (esb) {
  const kode = bersih(esb, 'esb.admin.js', ['async function bacaMasterEsb']);
  if (!/purpose: \['Purpose Name'\]/.test(kode)) {
    salah('esb.admin.js: berkas Master Purpose tidak bisa dibaca — dropdown Purpose tidak akan pernah terisi.');
  }
  if (!/<option value="purpose">Master Purpose<\/option>/.test(kode)) {
    salah('esb.admin.js: Master Purpose tidak ada di pilihan impor. Kemampuannya ada, jalannya tidak ada di layar.');
  }
  if (!/'branch', 'unit', 'item', 'supplier', 'purpose'/.test(kode)) {
    salah('esb.admin.js: jumlah Purpose tersimpan tidak ditampilkan — tidak ada cara tahu daftarnya sudah masuk atau belum.');
  }
  // Baris NONAKTIF tidak ikut: menawarkan pilihan yang pasti ditolak ESB berarti
  // kegagalannya baru terbaca saat berkasnya diunggah.
  if (!/const iStatus = kol\('Status'\);/.test(kode)) {
    salah('esb.admin.js: kolom Status tidak dibaca — nilai nonaktif ikut ditawarkan dan pasti ditolak ESB.');
  }
  if (!/=== 'inactive'\) continue;/.test(kode)) {
    salah('esb.admin.js: baris nonaktif tetap diimpor.');
  }

  // KUNCI KEMBAR DI SATU OBJEK LITERAL ITU SAH DI JAVASCRIPT, dan yang
  // belakangan menang diam-diam. Percobaan pertama memakai `purpose` untuk dua
  // arti yang berbeda, dan langkah "Daftar induk ESB" berbunyi "5 Purpose
  // kosong (isi di Rekap Waste / Spoil)". Tidak ada galat, tidak ada peringatan.
  const iLabel = kode.indexOf('const LABEL_JENIS = {');
  const blok = iLabel < 0 ? '' : kode.slice(iLabel, kode.indexOf('\n};', iLabel));
  if (!blok) salah('esb.admin.js: LABEL_JENIS tidak ditemukan — audit ini kehilangan sasarannya.');
  else {
    const kunci = [...blok.matchAll(/^\s*'?([a-z-]+)'?:/gm)].map((m) => m[1]);
    const kembar = kunci.filter((k, i) => kunci.indexOf(k) !== i);
    if (kembar.length) {
      salah(
        `esb.admin.js: LABEL_JENIS punya kunci kembar (${[...new Set(kembar)].join(', ')}). ` +
          'Kunci kembar sah di JavaScript dan yang belakangan menang diam-diam — satu label akan muncul di tempat yang salah.'
      );
    }
    if (!kunci.includes('purpose-kosong')) {
      salah('esb.admin.js: alasan "purpose-kosong" tidak punya label — tabel penahan menampilkan kode mentah.');
    }
  }
}

console.log('');
if (gagal === 0) console.log('Audit Purpose waste bersih. ✅');
else console.error(`${gagal} masalah ditemukan.`);
process.exit(gagal === 0 ? 0 : 1);
