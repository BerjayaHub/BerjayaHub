/**
 * AUDIT: susunan layar Ekspor ESB & pemetaannya.
 *
 * ============ CARA FITUR INI RUSAK TANPA TERLIHAT RUSAK ============
 *
 *   urutan langkahnya kembali terbalik  -> pekerjaan yang dilakukan tiap
 *                                          periode terkubur di bawah dua
 *                                          langkah penyiapan yang sudah selesai
 *   yang belum dipetakan tidak naik     -> 8 baris di antara 647; lencananya
 *                                          menyebut jumlahnya tapi tidak ada
 *                                          cara sampai ke barisnya
 *   pencarian MENGGAMBAR ULANG tabelnya -> `<select>` yang sudah dipasangi
 *                                          penangan `change` lenyap dari DOM,
 *                                          dan pemetaan berhenti tersimpan
 *                                          tanpa satu pun error
 *   penomorannya tidak ikut berubah     -> kalimat "pemetaan di langkah 2"
 *                                          menunjuk langkah yang salah
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
// 1. Modul murni urutannya.
// ---------------------------------------------------------------
const urut = baca('js/modules/inventory/urut-pemetaan.js');
if (urut) {
  const kode = bersih(urut, 'urut-pemetaan.js', ['export function susunBarisPemetaan', 'export function perluCari']);

  for (const n of ['susunBarisPemetaan', 'perluCari']) {
    if (!new RegExp(`export function ${n}\\(`).test(kode)) salah(`urut-pemetaan.js: \`${n}\` tidak diekspor.`);
  }
  // Yang belum dipetakan DULU, lalu alfabetis.
  if (!/Number\(a\.dipetakan\) - Number\(b\.dipetakan\) \|\| a\.kunci\.localeCompare\(b\.kunci, 'id'\)/.test(kode)) {
    salah(
      'urut-pemetaan.js: urutannya bukan lagi "belum dipetakan dulu, lalu alfabetis". Delapan baris yang belum ' +
        'dipetakan akan tersebar lagi di antara 639 baris lain, dan dokumennya diam-diam tidak ikut terunduh.'
    );
  }
  // Spasi BUKAN padanan — nilai berisi spasi berangkat ke ESB sebagai sel
  // kosong dan ditolak di sana, jauh dari layar ini.
  if (!/teks\(nilai\(k\)\)\.trim\(\)/.test(kode) || !/dipetakan: v !== ''/.test(kode)) {
    salah('urut-pemetaan.js: nilai berisi spasi tidak lagi dihitung "belum dipetakan" — ia akan berangkat ke ESB sebagai sel kosong.');
  }
}

// ---------------------------------------------------------------
// 2. Layarnya.
// ---------------------------------------------------------------
const esb = baca('js/modules/inventory/esb.admin.js');
if (esb) {
  const kode = bersih(esb, 'esb.admin.js', ['susunBarisPemetaan(', 'saringTabel(']);

  // URUTAN LANGKAHNYA: Unduh paling atas, Pemetaan paling bawah.
  //
  // Nomornya TIDAK dikunci di sini lagi. Versi sebelumnya mencari "1. Unduh",
  // "2. Daftar induk ESB", "3. Pemetaan" apa adanya — lalu satu langkah baru
  // ("Batalkan tanda ekspor") disisipkan di urutan kedua, dan audit ini merah
  // tanpa ada satu pun yang rusak. Audit merah yang tidak menunjuk kerusakan
  // adalah audit yang lama-lama diabaikan, dan sesudah itu ia tidak menjaga
  // apa pun.
  //
  // Yang dijaga di sini tinggal prinsipnya: Unduh di atas segalanya, Pemetaan
  // di bawah segalanya. Penomorannya sendiri — dan kesesuaian nomor yang
  // disebut kalimat pengantar — dijaga tools/audit-batal-tanda-esb.cjs, yang
  // MENURUNKANNYA dari judul di layar alih-alih menuliskannya lagi.
  const iUnduh = kode.indexOf('. Unduh<');
  const iInduk = kode.indexOf('. Daftar induk ESB<');
  const iPeta = kode.indexOf('. Pemetaan<');
  if (iUnduh < 0 || iInduk < 0 || iPeta < 0) {
    salah('esb.admin.js: salah satu dari bagian Unduh / Daftar induk ESB / Pemetaan hilang dari layar.');
  } else if (!(iUnduh < iInduk && iInduk < iPeta)) {
    salah(
      'esb.admin.js: urutan bagiannya di layar salah. Unduh harus paling atas — impor & pemetaan adalah penyiapan yang ' +
        'dikerjakan sekali, sementara mengunduh dikerjakan tiap periode.'
    );
  }

  // Urutan barisnya lewat modul murni.
  if (!/susunBarisPemetaan\(lokal\[j\], \(k\) => m\.get\(normal\(k\)\) \?\? ''\)/.test(kode)) {
    salah('esb.admin.js: baris pemetaan tidak disusun lewat `susunBarisPemetaan` — urutannya jadi tiruan yang akan menyimpang.');
  }
  if (!/class="esb-belum"/.test(kode)) {
    salah(
      'esb.admin.js: baris yang belum dipetakan tidak lagi ditandai. Sesudah orangnya mengetik di kotak cari, hasilnya ' +
        'mencampur yang sudah dan belum — dan urutannya saja tidak cukup untuk membedakan.'
    );
  }

  // Pencarian: MENYEMBUNYIKAN, bukan menggambar ulang.
  //
  // Sasarannya DISEMPITKAN ke kotak cari pemetaan. Versi sebelumnya cuma
  // mencari `saringTabel(` di mana pun di berkas ini — lalu layar "Batalkan
  // tanda ekspor" datang membawa pemanggilan `saringTabel(` miliknya sendiri,
  // dan pemeriksaan ini tetap hijau walau kotak cari pemetaannya dicabut. Pola
  // lama yang sasarannya ada DI TEMPAT LAIN adalah cara audit berbohong tanpa
  // pernah berubah satu huruf pun.
  if (!/saringTabel\(\s*kotak,/.test(kode)) {
    salah('esb.admin.js: kotak cari pemetaan tidak disambungkan ke saringTabel.');
  }
  if (!/perluCari\(total\)/.test(kode)) salah('esb.admin.js: kotak cari muncul tanpa memandang jumlah barisnya.');
  if (!/class="esb-cari"/.test(kode)) salah('esb.admin.js: kotak cari tidak digambar.');
  if (!/tbody\[data-baris="\$\{kotak\.dataset\.jenis\}"\] tr/.test(kode)) {
    salah('esb.admin.js: kotak cari tidak menunjuk baris kelompoknya sendiri — mengetik di satu kelompok akan menyaring kelompok lain.');
  }
  // `data-nama` memuat KEDUA sisi.
  if (!/data-nama="\$\{esc\(k\)\} \$\{esc\(kini\)\}"/.test(kode)) {
    salah(
      'esb.admin.js: baris pemetaan hanya bisa dicari lewat satu sisi. Orang mencari lewat nama Berjaya Hub MAUPUN ' +
        'nama ESB-nya, tergantung mana yang sedang ia pegang.'
    );
  }
}

// ---------------------------------------------------------------
// 3. Aturan penyaringnya sendiri — ia yang dipinjam layar ini.
// ---------------------------------------------------------------
const saring = baca('js/modules/dispatch/saring-tabel.js');
if (saring) {
  const kode = bersih(saring, 'saring-tabel.js', ['export function saringTabel']);
  if (!/el\.hidden = !cocok;/.test(kode)) {
    salah(
      'saring-tabel.js: penyaringnya tidak lagi menyembunyikan baris. Kalau ia menggambar ulang, `<select>` pemetaan ' +
        'yang sudah dipasangi penangan `change` lenyap dari DOM — dan pemetaan berhenti tersimpan tanpa satu pun error.'
    );
  }
  if (/\.remove\(\)/.test(kode)) {
    salah('saring-tabel.js: baris dibuang dari DOM, bukan disembunyikan.');
  }
}

if (gagal === 0) {
  console.log(
    'Ekspor ESB: Unduh di paling atas, baris yang belum dipetakan naik ke atas & ditandai, dan pencariannya ' +
      'menyembunyikan baris alih-alih menggambar ulang. ✅'
  );
}
process.exit(gagal === 0 ? 0 : 1);
