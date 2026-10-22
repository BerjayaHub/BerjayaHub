/**
 * AUDIT: Laporan Laba Rugi Outlet + perbaikan COGS.
 *
 * ============ SATU BENTUK KEGAGALAN, DAN IA TIDAK BERBUNYI ============
 *
 * Laporan ini menjawab "outlet ini untung atau rugi". Semua cara ia salah
 * menghasilkan angka yang terlihat masuk akal dan tercetak rapi:
 *
 *   kiriman CK tidak ikut barang masuk  -> HPP jauh lebih kecil, laba terlihat
 *                                          besar. Ini BUG NYATA yang baru
 *                                          diperbaiki di laporan COGS.
 *   kiriman dihitung per tanggal KIRIM  -> kiriman akhir bulan masuk periode
 *                                          yang salah, dan DUA bulan jadi
 *                                          keliru sekaligus
 *   nota dibatalkan ikut dihitung       -> barang yang sudah ditarik tetap
 *                                          menaikkan HPP
 *   entri kas dicoret ikut dihitung     -> biaya lebih besar dari layar Kas
 *   bahan tanpa HPP dianggap nol diam2  -> HPP kecil, laba besar, tak ada yang
 *                                          bertanya
 *   HPP minus didiamkan                 -> terbaca sebagai untung luar biasa
 *   food cost dibagi omzet nol          -> Infinity% atau 0%, dua-duanya bohong
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

const blokSampai = (kode, mulai, akhir) => {
  const i = kode.indexOf(mulai);
  if (i < 0) return '';
  const j = kode.indexOf(akhir, i + mulai.length);
  return kode.slice(i, j < 0 ? undefined : j);
};

// =====================================================================
// 1. MODUL MURNI.
// =====================================================================
const mod = baca('js/modules/report/laba-rugi-outlet.js');
if (mod) {
  const kode = bersih(mod, 'laba-rugi-outlet.js', ['barisLabaRugi', 'rekapPerBahan']);

  const b = blokSampai(kode, 'export function barisLabaRugi', 'function catatanBaris');

  // ============ RUMUSNYA ============
  if (!/const masuk = ck \+ sup;/.test(b)) {
    salah(
      'laba-rugi-outlet.js: barang masuk tidak lagi menjumlahkan CK dan supplier. Kiriman CK yang hilang membuat ' +
        'HPP jauh lebih kecil dan laba terlihat besar — bug yang persis baru diperbaiki di laporan COGS.'
    );
  }
  if (!/const hpp = awal \+ masuk - akhir;/.test(b)) {
    salah('laba-rugi-outlet.js: rumus HPP berubah bentuk.');
  }
  if (!/const labaKotor = jual - hpp;/.test(b) || !/const labaBersih = labaKotor - biaya;/.test(b)) {
    salah('laba-rugi-outlet.js: rumus laba kotor / laba bersih berubah bentuk.');
  }

  // ============ CK & SUPPLIER TIDAK BOLEH DILEBUR ============
  if (!/nilaiCk: ck/.test(b) || !/nilaiSupplier: sup/.test(b)) {
    salah(
      'laba-rugi-outlet.js: nilai CK dan supplier tidak lagi dipisah. "Belanja outlet terlalu besar" ditindaklanjuti ' +
        'dengan memeriksa nota; "kiriman CK terlalu besar" dengan memeriksa order — satu angka gabungan tidak ' +
        'memberitahu ke mana harus melihat.'
    );
  }

  // ============ PEMBAGIAN NOL ============
  if (!/const bagi = \(a, b\) => \(num\(b\) === 0 \? null : num\(a\) \/ num\(b\)\);/.test(kode)) {
    salah(
      'laba-rugi-outlet.js: pembagian tidak lagi menjaga penyebut nol. Outlet beromzet nol akan menghasilkan ' +
        '`Infinity%` atau `0%` — dua-duanya berbohong, dan dua-duanya tercetak rapi.'
    );
  }
  if (!/if \(n === null\) return '—';/.test(kode)) {
    salah("laba-rugi-outlet.js: `persen()` tidak lagi memulangkan '—' untuk nilai yang tidak terdefinisi.");
  }

  // ============ BAHAN TANPA HPP DIHITUNG TERPISAH ============
  if (!/const tanpaHpp = num\(stokAwal\.tanpaHpp\) \+ num\(stokAkhir\.tanpaHpp\) \+ num\(masukCk\.tanpaHpp\);/.test(b)) {
    salah(
      'laba-rugi-outlet.js: bahan tanpa HPP tidak lagi dihitung. Diam-diam dianggap nol membuat HPP lebih kecil ' +
        'dan laba lebih besar — arah kesalahan yang paling tidak akan dipertanyakan siapa pun.'
    );
  }

  // ============ HPP MINUS HARUS BERBUNYI ============
  const c = blokSampai(kode, 'function catatanBaris', 'export function ringkasLabaRugi');
  if (!/if \(hpp < 0\) c\.push\('HPP minus/.test(c)) {
    salah(
      'laba-rugi-outlet.js: HPP minus tidak lagi ditandai. Stok akhir yang lebih besar dari stok awal + barang ' +
        'masuk berarti ada barang yang muncul tanpa dokumen — dan tanpa kalimat itu angkanya terbaca sebagai ' +
        'untung luar biasa.'
    );
  }
  if (/Math\.max\(0, *awal \+ masuk - akhir\)|Math\.max\(0, *hpp\)/.test(b)) {
    salah('laba-rugi-outlet.js: HPP minus dipotong ke nol. Yang disembunyikan justru satu-satunya tanda bahwa ada dokumen yang belum dicatat.');
  }
  for (const [pola, apa] of [
    [/belum pernah opname/, 'outlet yang belum pernah opname'],
    [/omzet nol/, 'omzet nol'],
    [/bahan tanpa HPP/, 'bahan tanpa HPP'],
    [/baris nota belum berharga/, 'baris nota belum berharga']
  ]) {
    if (!pola.test(c)) salah(`laba-rugi-outlet.js: catatan baris tidak lagi menyebut ${apa}.`);
  }

  // ============ TOTAL DIJUMLAHKAN DARI BARIS ============
  const r = blokSampai(kode, 'export function ringkasLabaRugi', 'export function persen');
  if (!/const labaKotor = omzet - hpp;/.test(r)) {
    salah(
      'laba-rugi-outlet.js: total laba kotor tidak lagi diturunkan dari total omzet & HPP. Total yang dihitung ' +
        'dari sumber terpisah cepat atau lambat menyimpang dari jumlah barisnya.'
    );
  }

  // Rekap per bahan menggabungkan dua sumber dalam satu baris.
  const rb = blokSampai(kode, 'export function rekapPerBahan', 'export function pesanLabaRugi');
  if (!/qtyCk/.test(rb) || !/qtySupplier/.test(rb)) {
    salah(
      'laba-rugi-outlet.js: rekap per bahan tidak lagi memisah kolom CK dan supplier. Pertanyaan "ada bahan yang ' +
        'dibeli sendiri padahal CK juga mengirimkannya?" tidak bisa dijawab dua tabel terpisah.'
    );
  }
  if (!/\.sort\(\(a, b\) => b\.nilaiTotal - a\.nilaiTotal/.test(rb)) {
    salah('laba-rugi-outlet.js: rekap per bahan tidak lagi diurutkan dari nilai terbesar — yang dibaca pertama jadi bahan paling awal menurut abjad.');
  }
}

// =====================================================================
// 2. LAYANAN: PERBAIKAN COGS + LAPORAN BARU.
// =====================================================================
const svc = baca('js/modules/report/report.service.js');
if (svc) {
  const kode = bersih(svc, 'report.service.js', ['buildLabaRugiOutlet', 'nilaiKirimanMasuk']);

  // ============ PERBAIKAN COGS ============
  const nk = blokSampai(kode, 'async function nilaiKirimanMasuk', 'async function buildCogs');
  if (!nk) {
    salah(
      'report.service.js: `nilaiKirimanMasuk` hilang — kiriman dari CK kembali tidak dihitung sebagai barang ' +
        'masuk, dan COGS outlet yang dipasok CK kembali jauh lebih kecil dari seharusnya.'
    );
  } else {
    if (!/\.eq\('dispatches\.status', 'received'\)/.test(nk)) {
      salah(
        'report.service.js: kiriman yang dihitung tidak lagi dibatasi status `received`. Kiriman yang masih di ' +
          'jalan belum menggerakkan stok — menghitungnya membuat barang masuk lebih besar dari stoknya sendiri.'
      );
    }
    // ============ TANGGAL TERIMA, BUKAN TANGGAL KIRIM ============
    if (!/dispatches\.received_at/.test(nk)) {
      salah(
        'report.service.js: kiriman tidak lagi disaring pada `received_at`. Gerakan stoknya ditulis SAAT DITERIMA, ' +
          'jadi kiriman yang berangkat 31 Agustus dan diterima 1 September akan membuat DUA bulan salah sekaligus.'
      );
    }
    if (/dispatches\.created_at|dispatches\.sent_at/.test(nk)) {
      salah('report.service.js: kiriman disaring pada tanggal KIRIM. Stoknya bergerak saat DITERIMA — dua bulan akan salah sekaligus.');
    }
    if (!/else kini\.tanpaHpp \+= 1;/.test(nk)) {
      salah('report.service.js: bahan tanpa HPP pada kiriman tidak lagi dihitung terpisah — nilainya diam-diam nol.');
    }
  }
  if (!/pembelian\.set\(oid, \(pembelian\.get\(oid\) \?\? 0\) \+ k\.nilai\)/.test(kode)) {
    salah('report.service.js: nilai kiriman CK tidak lagi ditambahkan ke barang masuk pada `buildCogs`.');
  }
  // Catatan perubahan harus ada — rekap lama memuat angka yang berbeda.
  if (!/sejak perbaikan ini, kolom Barang Masuk memuat kiriman dari Central Kitchen/.test(kode)) {
    salah(
      'report.service.js: catatan bahwa angka COGS BERUBAH hilang. Rekap yang terlanjur dicetak memuat angka yang ' +
        'jauh lebih kecil, dan tanpa kalimat ini orang yang membandingkannya mengira salah satunya rusak.'
    );
  }

  // ============ LAPORAN BARU ============
  if (!/key: 'laba_rugi_outlet'/.test(kode)) {
    salah('report.service.js: laporan `laba_rugi_outlet` tidak terdaftar di katalog — fungsinya ada dan tidak bisa dipilih siapa pun.');
  }
  if (!/build: buildLabaRugiOutlet/.test(kode)) {
    salah('report.service.js: laporan terdaftar tapi tidak menunjuk fungsi pembangunnya.');
  }

  const lr = blokSampai(kode, 'async function buildLabaRugiOutlet', '\n// ---');
  // Nota dibatalkan tidak ikut.
  const rn = blokSampai(kode, 'async function rincianNotaSupplier', 'async function biayaNonBahanPerOutlet');
  if (!/if \(nRow\.status === 'dibatalkan'\) continue;/.test(rn)) {
    salah(
      'report.service.js: nota yang DIBATALKAN ikut dihitung sebagai barang masuk. Barangnya sudah ditarik — ' +
        'menghitungnya menaikkan HPP untuk barang yang tidak pernah ada di rak.'
    );
  }
  if (!/if \(!notaDipakai\.has\(it\.receipt_id\)\) continue;/.test(rn)) {
    salah(
      'report.service.js: baris bahan milik nota yang dibatalkan ikut masuk rekap per bahan. Dua bagian laporan ' +
        'yang sama jadi tidak sejalan: totalnya tidak memuatnya, rekapnya memuat.'
    );
  }

  // Entri kas dicoret tidak ikut.
  const bn = blokSampai(kode, 'async function biayaNonBahanPerOutlet', 'async function buildLabaRugiOutlet');
  if (!/if \(e\.dicoret_at\) continue;/.test(bn)) {
    salah(
      'report.service.js: entri kas yang DICORET ikut dihitung sebagai biaya. Seluruh pembaca kas menyaringnya ' +
        '(0141) — laporan yang tidak ikut akan berbeda dari layar Kas untuk periode yang sama.'
    );
  }
  if (!/selainBahan\(e\)/.test(bn)) {
    salah(
      'report.service.js: biaya tidak lagi disaring `selainBahan`. Pembayaran nota bahan akan terhitung DUA KALI: ' +
        'sekali sebagai barang masuk, sekali sebagai biaya operasional.'
    );
  }
  if (!/untuk_nota/.test(bn)) {
    salah(
      'report.service.js: kolom `untuk_nota` tidak ikut diambil. `untukBahan()` membacanya `undefined`, dan ' +
        'SELURUH pembayaran nota terhitung sebagai "selain bahan" — biaya operasional membengkak diam-diam.'
    );
  }

  // Stok awal = SEBELUM hari pertama.
  if (!/sebelum\.setDate\(sebelum\.getDate\(\) - 1\);/.test(lr)) {
    salah(
      'report.service.js: stok awal tidak lagi diambil dari hari SEBELUM periode. Memakai `from` sendiri membuat ' +
        'barang masuk hari pertama terhitung dua kali.'
    );
  }

  // Rincian hanya saat satu outlet dipilih.
  if (!/if \(outletId && baris\.length === 1\)/.test(lr)) {
    salah(
      'report.service.js: rincian per dokumen digambar juga di tingkat BU. Enam outlet berincian penuh ' +
        'menghasilkan belasan halaman yang tidak dibaca siapa pun.'
    );
  }
  for (const judul of ['Central Kitchen', 'supplier', 'per bahan', 'selain bahan']) {
    if (!new RegExp(judul).test(lr)) {
      salah(`report.service.js: bagian rincian "${judul}" hilang dari laporan.`);
    }
  }
}

// =====================================================================
// 3. HALAMAN LAPORAN.
// =====================================================================
const page = baca('js/modules/report/report.admin.page.js');
if (page) {
  const kode = bersih(page, 'report.admin.page.js', ['bagian']);
  if (!/\(data\.bagian \?\? \[\]\)/.test(kode)) {
    salah('report.admin.page.js: bagian rincian tidak digambar — laporan menghitungnya dan tidak ada yang menampilkannya.');
  }
  // Excel: tiap bagian jadi sheet sendiri.
  if (!/exportSheetsXLSX\(\{/.test(kode)) {
    salah(
      'report.admin.page.js: rincian tidak lagi diekspor sebagai sheet terpisah. Menumpuknya di satu sheet membuat ' +
        'kolom yang berbeda bertabrakan, dan SUM kolomnya jadi campuran dua hal.'
    );
  }
  if (!/const bagian = last\.data\.bagian \?\? \[\];/.test(kode) || !/if \(bagian\.length\)/.test(kode)) {
    salah('report.admin.page.js: laporan tanpa `bagian` tidak lagi memakai jalur ekspor lamanya.');
  }
}

console.log('');
if (gagal === 0) console.log('Audit Laba Rugi Outlet & perbaikan COGS bersih. ✅');
else console.error(`${gagal} masalah ditemukan.`);
process.exit(gagal === 0 ? 0 : 1);
