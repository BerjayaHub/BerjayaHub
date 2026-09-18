/**
 * AUDIT: membatalkan tanda ekspor ESB — ADA JALANNYA, dan ada jejaknya.
 *
 * ============ CARA FITUR INI RUSAK TANPA TERLIHAT RUSAK ============
 *
 *   layarnya hilang lagi            -> fungsinya tetap ada di database dan
 *                                      tetap diuji hijau, tapi satu-satunya
 *                                      jalan keluarnya kembali SQL Editor.
 *                                      Persis keadaan sebelum 0143 — dan
 *                                      selama tiga migration tidak ada yang
 *                                      menyadarinya
 *   alasannya jadi opsional         -> jejaknya terisi kekosongan, dan saat
 *                                      pembelian ganda di ESB ditelusuri nanti,
 *                                      yang tersedia cuma "siapa" tanpa "kenapa"
 *   tanda tangan lama dihidupkan    -> panggilan tanpa p_alasan jatuh ke sana:
 *                                      berhasil, tanpa alasan, tanpa jejak
 *   peringatan ESB dicabut          -> orang membuka tanda nota yang SUDAH
 *                                      masuk ESB, lalu unggahan berikutnya
 *                                      membuat pembelian ganda yang keduanya
 *                                      terlihat wajar
 *   hasilnya tidak dibandingkan     -> "berhasil" padahal nol baris terbuka
 *   jejak lama dibaca sebagai baru  -> nota sehat dilaporkan "tandanya terbuka"
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
// 1. Migration 0143.
// ---------------------------------------------------------------
const mig = baca('supabase/migrations/0143_batal_tanda_esb_berjejak.sql');
let panjangSql = null;
if (mig) {
  for (const t of ['goods_receipts', 'dispatches']) {
    for (const k of ['esb_dibatalkan_at', 'esb_dibatalkan_by', 'esb_alasan_batal']) {
      if (!new RegExp(`alter table ${t} add column if not exists ${k}`).test(mig)) {
        salah(`0143: kolom ${t}.${k} tidak dibuat.`);
      }
    }
  }

  // Tanda tangan LAMA harus dibuang, bukan dibiarkan berdampingan.
  //
  // Dicocokkan DARI AWAL BARIS. Versi pertama audit ini memakai `includes`, dan
  // sabotasenya lolos hanya dengan membubuhkan `-- ` di depan barisnya: perintah
  // matinya tetap memuat teks yang dicari. Substring yang "ada" di dalam
  // komentar sudah menipu audit di proyek ini beberapa kali.
  for (const fn of ['batalkan_tanda_esb(uuid[])', 'batalkan_tanda_kiriman_esb(uuid[])']) {
    const pola = new RegExp(`^drop function if exists ${fn.replace(/[()[\]]/g, '\\$&')};`, 'm');
    if (!pola.test(mig)) {
      salah(
        `0143: tanda tangan lama \`${fn}\` tidak dibuang. PostgREST memilih di antara kedua tanda tangan berdasarkan ` +
          'HIMPUNAN NAMA ARGUMEN — satu panggilan tanpa p_alasan akan jatuh ke yang lama: berhasil, tanpa alasan, tanpa jejak.'
      );
    }
  }

  const m = /select (\d+) \$\$;/.exec(mig.slice(mig.indexOf('function panjang_alasan_batal_esb')));
  if (!m) salah('0143: `panjang_alasan_batal_esb()` tidak ada — batas panjang alasannya tidak ditegakkan server.');
  else panjangSql = Number(m[1]);

  // Alasannya diperiksa SEBELUM apa pun ditulis.
  for (const fn of ['batalkan_tanda_esb', 'batalkan_tanda_kiriman_esb']) {
    const i = mig.indexOf(`function ${fn}(p_`);
    const blok = i < 0 ? '' : mig.slice(i, mig.indexOf('$$;', i));
    if (!/alasan_batal_esb_sah\(p_alasan\)/.test(blok)) {
      salah(`0143 \`${fn}\`: alasannya tidak divalidasi — jejaknya bisa terisi kekosongan.`);
    }
    if (!/esb_dibatalkan_by = v_uid/.test(blok) || !/esb_alasan_batal = v_alasan/.test(blok)) {
      salah(`0143 \`${fn}\`: pelaku atau alasannya tidak dicatat.`);
    }
    if (!/is_bu_admin\(v_uid/.test(blok)) {
      salah(`0143 \`${fn}\`: tidak memeriksa is_bu_admin — siapa pun bisa membuka tanda ekspor.`);
    }
    // Yang TIDAK bertanda harus dilewati, bukan ditulisi jejak palsu.
    if (!/esb_exported_at is not null/.test(blok)) {
      salah(
        `0143 \`${fn}\`: baris yang tidak bertanda ikut ditulisi jejak pembatalan. Penelusuran nanti akan menemukan ` +
          'pembatalan yang tidak pernah terjadi.'
      );
    }
  }

  // Pesan "terkunci" tinggal di SATU tempat.
  if (!/create or replace function tolak_karena_terekspor_esb/.test(mig)) {
    salah('0143: `tolak_karena_terekspor_esb` tidak ada — kalimatnya kembali ditulis berulang di tiap penjaga.');
  }
  for (const fn of ['jaga_ubah_item_nota', 'koreksi_nota', 'batalkan_nota']) {
    const i = mig.indexOf(`function ${fn}(`);
    const blok = i < 0 ? '' : mig.slice(i, mig.indexOf('$$;', i));
    if (!/perform tolak_karena_terekspor_esb\(/.test(blok)) {
      salah(`0143 \`${fn}\`: tidak memakai penjaga bersama — pesannya akan menyimpang dari dua penjaga lainnya.`);
    }
  }
  // Isi pesannya: siapa, di mana, tombol apa.
  const iPesan = mig.indexOf('function tolak_karena_terekspor_esb');
  const pesan = iPesan < 0 ? '' : mig.slice(iPesan, mig.indexOf('$$;', iPesan));
  for (const [apa, pola] of [
    ['siapa yang bisa membukanya', /admin BU/i],
    ['di layar mana', /Ekspor ESB/],
    ['nama tombolnya', /Batalkan tanda ekspor/]
  ]) {
    if (!pola.test(pesan)) {
      salah(`0143: pesan "nota terkunci" tidak menyebut ${apa}. Staff akan mencari tombol yang tidak ada di aplikasinya.`);
    }
  }
}

// ---------------------------------------------------------------
// 2. Modul murninya.
// ---------------------------------------------------------------
const murni = baca('js/modules/inventory/batal-tanda-esb.js');
if (murni) {
  const kode = bersih(murni, 'batal-tanda-esb.js', ['export function alasanSah', 'export function keadaanTanda']);

  for (const f of ['alasanSah', 'keadaanTanda', 'sedangBertanda', 'jejakBatal', 'susunDaftarBertanda', 'hasilPembatalan']) {
    if (!new RegExp(`export function ${f}\\(`).test(kode)) salah(`batal-tanda-esb.js: \`${f}\` tidak diekspor.`);
  }

  const m = /PANJANG_ALASAN_MIN = (\d+)/.exec(kode);
  if (!m) salah('batal-tanda-esb.js: `PANJANG_ALASAN_MIN` hilang.');
  else if (panjangSql !== null && Number(m[1]) !== panjangSql) {
    salah(
      `Batas panjang alasan menyimpang: layar ${m[1]} huruf, database ${panjangSql}. Yang longgar di layar akan ditolak ` +
        'database dengan pesan yang tidak diduga siapa pun; yang longgar di database membuat aturan layarnya sia-sia.'
    );
  }

  // Panjangnya dihitung SESUDAH dirapikan.
  if (!/const v = teks\(alasan\)\.trim\(\)/.test(kode) || !/v\.length < PANJANG_ALASAN_MIN/.test(kode)) {
    salah('batal-tanda-esb.js: panjang alasan tidak dihitung sesudah spasi tepinya dibuang — sebelas spasi akan lolos.');
  }

  // Jebakan utamanya: jejak lama vs tanda baru.
  if (!/batal > ekspor/.test(kode)) {
    salah(
      'batal-tanda-esb.js: keadaan tanda tidak lagi membandingkan WAKTU jejak dengan waktu ekspornya. Kolom jejak tidak ' +
        'dikosongkan saat notanya diekspor ulang, jadi nota yang sehat akan dilaporkan sebagai "tandanya terbuka".'
    );
  }

  // Hasil yang tidak berbohong.
  if (!/b < d/.test(kode) || !/nada: 'warning'/.test(kode) || !/nada: 'error'/.test(kode)) {
    salah(
      'batal-tanda-esb.js: hasilnya tidak lagi membedakan sebagian/nol dari semuanya. Database melewati baris yang bukan ' +
        'wewenangnya TANPA melempar galat — "berhasil" akan terucap padahal tidak ada yang terbuka.'
    );
  }

  if (!/TIDAK menghapus/.test(murni)) {
    salah('batal-tanda-esb.js: peringatan bahwa dokumennya tetap ada di ESB hilang.');
  }
}

// ---------------------------------------------------------------
// 3. LAYARNYA — inilah yang dulu tidak ada.
// ---------------------------------------------------------------
const adm = baca('js/modules/inventory/esb.admin.js');
if (adm) {
  const kode = bersih(adm, 'esb.admin.js', ['batalkanTandaEsb(', 'susunDaftarBertanda(']);

  if (!/id="batal-cari"/.test(kode) || !/id="batal-jalankan"/.test(kode)) {
    salah(
      'esb.admin.js: layar "Batalkan tanda ekspor" hilang. Fungsinya tetap ada di database dan tetap diuji hijau — dan ' +
        'satu-satunya jalan keluarnya kembali SQL Editor, persis keadaan yang bertahan tiga migration tanpa disadari.'
    );
  }
  for (const f of ['batalkanTandaEsb', 'batalkanTandaKirimanEsb', 'notaBertandaEsb', 'kirimanBertandaEsb']) {
    if (!new RegExp(`\\b${f}\\(`).test(kode)) salah(`esb.admin.js: \`${f}\` tidak dipanggil dari layar.`);
  }

  if (!/alasanSah\(box\.querySelector\('#batal-alasan'\)\.value\)/.test(kode)) {
    salah('esb.admin.js: alasannya tidak diperiksa di layar — orangnya baru tahu sesudah database menolaknya.');
  }
  if (!/hasilPembatalan\(ids\.length, n\)/.test(kode)) {
    salah('esb.admin.js: hasilnya tidak dibandingkan dengan yang dicentang — "berhasil" bisa terucap untuk nol baris.');
  }
  if (!/susunDaftarBertanda\(baris\)/.test(kode)) {
    salah('esb.admin.js: daftarnya tidak disaring lewat modul murni — baris yang tandanya sudah dibuka ikut tampil.');
  }
  // Peringatannya dicek DI DUA TEMPAT PEMAKAIANNYA, bukan sebagai nama yang
  // muncul entah di mana. Sabotase yang mencabutnya dari tabel pernah lolos
  // karena namanya masih tertinggal di daftar impor dan di kotak konfirmasi —
  // audit yang mencari nama, bukan pemakaian, selalu bisa ditipu begitu.
  if (!/\$\{esc\(PERINGATAN_ESB\)\}/.test(kode)) {
    salah('esb.admin.js: peringatan "tidak menghapus dokumennya di ESB" tidak ditampilkan di atas daftarnya.');
  }
  if (!/message: `\$\{PERINGATAN_ESB\}/.test(kode)) {
    salah('esb.admin.js: kotak konfirmasinya tidak mengulang peringatan ESB — itulah kesempatan terakhir membacanya.');
  }
  if (!/confirmDialog\(\{[\s\S]{0,400}danger: true/.test(kode)) {
    salah('esb.admin.js: pembatalan berjalan tanpa konfirmasi.');
  }

  // Centang dibaca dari SELURUH tbody, bukan dari baris yang terlihat.
  if (!/querySelectorAll\('#batal-baris \.batal-pilih:checked'\)/.test(kode)) {
    salah(
      'esb.admin.js: centang tidak dibaca dari seluruh tbody. Baris yang disembunyikan penyaring tetap ada di DOM dan ' +
        'centangnya tetap sah — membaca yang terlihat saja akan diam-diam melewatkannya.'
    );
  }
  if (!/saringTabel\(\s*box\.querySelector\('#batal-cari-kode'\)/.test(kode)) {
    salah('esb.admin.js: kotak cari kode tidak disambungkan.');
  }

  // Penomoran langkahnya DITURUNKAN, bukan ditulis dua kali.
  //
  // Audit lamanya mengunci angka "3" untuk Pemetaan, lalu satu langkah baru
  // disisipkan dan auditnya merah tanpa ada yang rusak. Yang dijaga sekarang
  // urutannya dan kesesuaian nomor yang disebut di kalimat pengantar.
  // Spasi & baris baru sesudah `>` ikut ditoleransi.
  //
  // Pola pertama menuntut angkanya menempel persis di belakang `>`. Begitu satu
  // judul ditulis di baris sendiri — seperti `<summary>` pada bagian Daftar
  // supplier — ia berhenti terbaca, dan auditnya melapor "langkahnya tidak
  // lengkap" untuk layar yang sebenarnya utuh. Yang diperiksa isinya, bukan
  // cara HTML-nya dirapikan.
  const judul = [...kode.matchAll(/>\s*(\d+)\.\s+([^<]+)</g)].map((x) => ({ no: Number(x[1]), nama: x[2].trim(), at: x.index }));
  // Daftar langkahnya BERTAMBAH seiring layar ini tumbuh — "Daftar supplier"
  // masuk sebagai langkah 4 saat admin perlu tahu nama mana yang sudah sama
  // dengan ESB. Yang dijaga bukan jumlahnya melainkan urutan & penomorannya
  // konsisten, jadi daftar ini memang perlu ikut diperbarui saat ada tambahan.
  const LANGKAH = ['Unduh', 'Batalkan tanda ekspor', 'Daftar induk ESB', 'Daftar supplier', 'Pemetaan'];
  const urut = judul.filter((h) => LANGKAH.includes(h.nama));
  if (urut.length !== LANGKAH.length) {
    salah(`esb.admin.js: ${LANGKAH.length} langkahnya tidak lengkap di layar (ketemu ${urut.length}).`);
  } else {
    if (urut[0].nama !== 'Unduh') {
      salah('esb.admin.js: Unduh bukan lagi yang pertama — pekerjaan tiap periode terkubur di bawah penyiapan yang sudah selesai.');
    }
    if (urut[1].nama !== 'Batalkan tanda ekspor') {
      salah('esb.admin.js: "Batalkan tanda ekspor" turun dari urutan kedua. Yang membukanya sedang menunggu jawaban staff yang notanya terkunci.');
    }
    for (let i = 0; i < urut.length; i++) {
      if (urut[i].no !== i + 1) salah(`esb.admin.js: penomoran langkahnya meleset — "${urut[i].nama}" bernomor ${urut[i].no}, harusnya ${i + 1}.`);
      if (i && urut[i].at < urut[i - 1].at) salah(`esb.admin.js: urutan di layar tidak sesuai penomorannya ("${urut[i].nama}").`);
    }
    // Nomor yang disebut kalimat pengantar ikut nomor judulnya.
    const noPeta = urut.find((h) => h.nama === 'Pemetaan')?.no;
    if (noPeta && !new RegExp(`pemetaan di langkah ${noPeta}`).test(kode)) {
      salah(`esb.admin.js: kalimat pengantar tidak menyebut "pemetaan di langkah ${noPeta}" — nomornya menunjuk langkah yang salah.`);
    }
  }
}

// ---------------------------------------------------------------
// 4. Lapisan layanannya.
// ---------------------------------------------------------------
const svc = baca('js/modules/inventory/esb.service.js');
if (svc) {
  const kode = bersih(svc, 'esb.service.js', ['export async function batalkanTandaEsb']);

  // `p_alasan` SELALU dikirim, termasuk saat kosong — kalau kuncinya dibuang,
  // `argumenRpc` menghilangkannya dan PostgREST tidak menemukan fungsinya.
  for (const [fn, kunci] of [
    ['batalkanTandaEsb', 'p_notas'],
    ['batalkanTandaKirimanEsb', 'p_kiriman']
  ]) {
    const i = kode.indexOf(`function ${fn}(`);
    const blok = i < 0 ? '' : kode.slice(i, i + 500);
    if (!new RegExp(`${kunci}:`).test(blok) || !/p_alasan: String\(alasan \?\? ''\)/.test(blok)) {
      salah(
        `esb.service.js \`${fn}\`: p_alasan tidak selalu dikirim sebagai string. Kunci yang undefined dibuang ` +
          '`argumenRpc`, dan galatnya jadi "function not found" — yang tidak memberitahu siapa pun bahwa yang kurang adalah alasannya.'
      );
    }
  }
  // Saringannya diperiksa PER FUNGSI, bukan sekali untuk seluruh berkas.
  // Sabotase yang mencabutnya dari `notaBertandaEsb` pernah lolos karena
  // `kirimanBertandaEsb` masih memilikinya — pemeriksaan seluruh-berkas selalu
  // ditutupi saudara kembarnya.
  for (const f of ['notaBertandaEsb', 'kirimanBertandaEsb']) {
    const i = kode.indexOf(`export async function ${f}(`);
    if (i < 0) {
      salah(`esb.service.js: \`${f}\` tidak ada.`);
      continue;
    }
    const blok = kode.slice(i, kode.indexOf('\n}', i));
    if (!/\.not\('esb_exported_at', 'is', null\)/.test(blok)) {
      salah(`esb.service.js \`${f}\`: tidak menyaring esb_exported_at — seluruh baris ikut tampil sebagai "bisa dibuka tandanya".`);
    }
    if (!/ambilSemua\(/.test(blok)) {
      salah(`esb.service.js \`${f}\`: tidak memakai ambilSemua — PostgREST memotong di ~1000 baris tanpa berkata apa-apa.`);
    }
  }
  // Batas tanggalnya: DATE tanpa offset untuk nota, timestamptz DENGAN offset
  // WIB untuk kiriman. Tertukar, dan barisnya bergeser sehari tanpa satu pun
  // pesan — persis kesalahan yang sudah dua kali terjadi di berkas ini.
  const iNota = kode.indexOf('export async function notaBertandaEsb(');
  const blokNota = iNota < 0 ? '' : kode.slice(iNota, kode.indexOf('\n}', iNota));
  if (/isoFrom\(|isoTo\(/.test(blokNota)) {
    salah('esb.service.js `notaBertandaEsb`: `receipt_date` bertipe DATE — membubuhkan jam & offset WIB justru menggeser batasnya satu hari.');
  }
  const iKir = kode.indexOf('export async function kirimanBertandaEsb(');
  const blokKir = iKir < 0 ? '' : kode.slice(iKir, kode.indexOf('\n}', iKir));
  if (!/isoFrom\(from\)/.test(blokKir) || !/isoTo\(to\)/.test(blokKir)) {
    salah('esb.service.js `kirimanBertandaEsb`: `received_at` bertipe timestamptz — tanpa batas WIB eksplisit, kiriman sore hari terakhir hilang.');
  }
}

if (gagal === 0) {
  console.log(
    'Batalkan tanda ekspor ESB: ada layarnya di langkah 2, alasannya wajib di layar & di server, jejaknya tercatat, ' +
      'dan hasilnya dibandingkan dengan yang dicentang. ✅'
  );
}
process.exit(gagal === 0 ? 0 : 1);
