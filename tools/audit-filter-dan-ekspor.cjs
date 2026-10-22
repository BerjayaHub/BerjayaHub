/**
 * AUDIT: saringan nama/tanggal + ekspor berfoto (sesi ini).
 *
 * ============ SATU BENTUK KEGAGALAN, LIMA TEMPAT ============
 *
 * Kelima perubahan sesi ini punya cara rusak yang sama: BERKAS atau LAYAR yang
 * isinya tidak sama dengan yang dikira orang.
 *
 *   saringan nama diterapkan
 *     SESUDAH `lastRecords`       -> layar menampilkan 1 orang, PDF memuat 40
 *   saringan tidak masuk judul    -> rekap NBM satu orang terbaca sebagai rekap
 *                                    seluruh outlet yang kehilangan orang
 *   unduhan memakai `semuaBaris`  -> berkas memuat baris yang tidak terlihat
 *                                    saat tombolnya ditekan
 *   nominal ditulis di tiap baris
 *     barang                      -> siapa pun yang menjumlahkan kolom itu
 *                                    mendapat delapan kali lipat
 *   nama sheet ber-"/"            -> berkasnya GAGAL DIBUKA, tanpa menyebut
 *                                    sheet mana
 *   batas sheet memotong diam-diam-> separuh rentang hilang tanpa tanda
 *
 * Tidak satu pun dari itu memunculkan pesan merah di mana pun.
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

/** Potongan DI ANTARA dua penanda — supaya pemeriksaan tidak se-berkas. */
const blokSampai = (kode, mulai, akhir) => {
  const i = kode.indexOf(mulai);
  if (i < 0) return '';
  const j = kode.indexOf(akhir, i + mulai.length);
  return kode.slice(i, j < 0 ? undefined : j);
};

// =====================================================================
// 1. SISA CUTI.
// =====================================================================
const sisa = baca('js/modules/leave/sisa-cuti.js');
if (sisa) {
  const kode = bersih(sisa, 'sisa-cuti.js', ['hitungSisa', 'KEADAAN']);

  // ============ TIGA KEADAAN, BUKAN SATU ANGKA ============
  for (const k of ['BERKUOTA', 'TANPA_BATAS', 'TIDAK_DIPOTONG']) {
    if (!new RegExp(`${k}:`).test(kode)) {
      salah(
        `sisa-cuti.js: keadaan ${k} hilang. Kalau ketiganya dilebur jadi satu angka, "jatah belum diatur" ` +
          'terbaca sebagai "sisa 0" — dan staff ditolak mengajukan cuti yang sebenarnya belum dibatasi siapa pun.'
      );
    }
  }
  const hs = blokSampai(kode, 'export function hitungSisa', 'export function hitungTerpakai');
  if (!/quotaDays !== null && quotaDays !== undefined && quotaDays !== ''/.test(hs)) {
    salah(
      "sisa-cuti.js: `quota_days` tidak lagi diperiksa null SEBELUM dikonversi. `Number(null)` adalah 0, dan 0 " +
        'hari adalah jatah yang SAH — jadi "belum diatur" diam-diam menjadi "jatahmu nol".'
    );
  }
  if (!/sisa = kuota - pakai/.test(hs)) {
    salah('sisa-cuti.js: perhitungan sisa berubah bentuk.');
  }
  // Minus TIDAK dipotong ke nol.
  if (/Math\.max\(0, *kuota - pakai\)|Math\.max\(0, *sisa\)/.test(hs)) {
    salah(
      'sisa-cuti.js: sisa minus dipotong ke nol. Itu menyembunyikan persetujuan yang MELAMPAUI jatah — satu-satunya ' +
        'keadaan di layar ini yang tidak bisa terjadi tanpa ada yang menyetujuinya.'
    );
  }

  // `pending` tidak boleh dijumlahkan ke `terpakai`.
  const ht = blokSampai(kode, 'export function hitungTerpakai', 'export function hitungTertunda');
  if (!/p\?\.status !== 'approved'/.test(ht)) {
    salah(
      "sisa-cuti.js: `hitungTerpakai` tidak lagi dibatasi status 'approved'. Menjumlahkan pengajuan tertunda " +
        'membuat sisa di layar admin BERBEDA dari yang dilihat staff di aplikasinya sendiri — pertanyaan yang ' +
        'tidak bisa dijawab siapa pun.'
    );
  }
  if (!/export function hitungTertunda/.test(kode)) {
    salah('sisa-cuti.js: `hitungTertunda` hilang — pengajuan tertunda tidak lagi dilaporkan sama sekali.');
  }

  // "belum diberi" dan "tanpa batas" sama-sama ber-sisa null.
  const ts = blokSampai(kode, 'export function teksSel', 'export function ringkasSisaCuti');
  if (!/belum diberi/.test(ts)) {
    salah(
      'sisa-cuti.js: `teksSel` tidak lagi membedakan "belum diberi hak" dari "jatah tanpa batas". Keduanya ' +
        'ber-`sisa: null`, jadi layar yang hanya membaca `sisa` menampilkannya sama — padahal yang satu admin lupa ' +
        'mengatur, yang satu sengaja tidak dibatasi.'
    );
  }
}

const lsvc = baca('js/modules/leave/leave.service.js');
if (lsvc) {
  const kode = bersih(lsvc, 'leave.service.js', ['dataSisaCutiBu']);
  const d = blokSampai(kode, 'export async function dataSisaCutiBu', '\n}');
  if (!d) {
    salah('leave.service.js: `dataSisaCutiBu` hilang — tab Sisa Cuti tidak punya datanya.');
  } else {
    // ~1.000 baris dipotong TANPA error.
    // ============ KEDUANYA, BUKAN "ADA KATA ambilSemua" ============
    //
    // `dataSisaCutiBu` membaca DUA tabel. Mencari kata `ambilSemua` se-blok
    // tetap hijau sesudah salah satunya dicabut — ia menemukan yang satunya
    // lagi. Ditemukan sabotasenya; mode kegagalan yang sudah berkali-kali
    // muncul di repo ini.
    for (const [tabel, apa] of [
      ["leave_entitlements", 'hak & jatah'],
      ["leave_requests", 'pengajuan cuti']
    ]) {
      const pola = new RegExp(`ambilSemua\\(async \\(dari, sampai\\) =>[\\s\\S]{0,160}from\\('${tabel}'\\)`);
      if (!pola.test(d)) {
        salah(
          `leave.service.js: pembacaan ${apa} (${tabel}) tidak lagi lewat \`ambilSemua\`. PostgREST memotong di ` +
            '~1.000 baris tanpa galat, dan yang terjadi bukan error melainkan beberapa staff yang sisanya terlihat ' +
            'lebih besar daripada seharusnya.'
        );
      }
    }
    if (!/ambilPerPotong\(ids/.test(d)) {
      salah('leave.service.js: daftar id tidak lagi dipecah — seribu UUID di query string ditolak sebelum sampai ke database.');
    }
  }

  // Rentang tanggal memakai BERSINGGUNGAN, bukan "mulai di dalam rentang".
  const l = blokSampai(kode, 'export async function listLeaveRequestsForAdmin', '\n}');
  if (!/query\.lte\('start_date', sampai\)/.test(l) || !/query\.gte\('end_date', dari\)/.test(l)) {
    salah(
      'leave.service.js: saringan tanggal cuti tidak lagi memakai persinggungan (`start_date <= sampai` DAN ' +
        '`end_date >= dari`). Dengan `start_date >= dari`, cuti 28 Sep–3 Okt hilang dari daftar Oktober — dan admin ' +
        'yang menyusun shift Oktober menugaskan orang yang sedang cuti.'
    );
  }
}

const ladm = baca('js/modules/leave/leave.admin.page.js');
if (ladm) {
  const kode = bersih(ladm, 'leave.admin.page.js', ['renderSisaTab']);
  if (!/\{ key: 'sisa', label: 'Sisa Cuti' \}/.test(kode)) {
    salah('leave.admin.page.js: tab Sisa Cuti hilang dari daftar tab — layarnya ada tapi tidak bisa dicapai siapa pun.');
  }
  if (!/if \(key === 'sisa'\) await renderSisaTab/.test(kode)) {
    salah('leave.admin.page.js: tab Sisa Cuti terdaftar tapi tidak dirender — tab yang diklik lalu tidak terjadi apa-apa.');
  }
  if (!/id="leave-nama-filter"/.test(kode) || !/id="leave-dari"/.test(kode)) {
    salah('leave.admin.page.js: saringan nama / tanggal di tab Pengajuan hilang.');
  }
  if (!/value="\$\{awal\}"/.test(kode) || !/monthEndWIB\(\)/.test(kode)) {
    salah('leave.admin.page.js: rentang bawaan (hari ini s/d akhir bulan) hilang.');
  }
}

// =====================================================================
// 2. SARINGAN NAMA DI PRESENSI.
// =====================================================================
const att = baca('js/modules/attendance/attendance.admin.page.js');
if (att) {
  const kode = bersih(att, 'attendance.admin.page.js', ['filter-nama']);
  if (!/id="filter-nama"/.test(kode)) {
    salah('attendance.admin.page.js: kotak saringan nama hilang.');
  }

  // ============ URUTANNYA YANG MENENTUKAN ============
  //
  // `lastRecords` dipakai Export PDF. Menyaring SESUDAHNYA berarti layar
  // menampilkan satu orang dan PDF memuat empat puluh.
  const iSaring = kode.indexOf('records.filter((r) => fuzzyMatch(namaCari');
  const iSimpan = kode.indexOf('lastRecords = records;');
  if (iSaring < 0) {
    salah('attendance.admin.page.js: saringan nama tidak lagi diterapkan ke `records`.');
  } else if (iSimpan >= 0 && iSimpan < iSaring) {
    salah(
      'attendance.admin.page.js: saringan nama diterapkan SESUDAH `lastRecords` diisi. Export PDF memakai ' +
        '`lastRecords`, jadi layarnya menampilkan satu orang dan berkasnya memuat semuanya — unduhan yang isinya ' +
        'tidak sama dengan yang terlihat saat tombolnya ditekan.'
    );
  }
}

const nbm = baca('js/modules/attendance/nbm-report.admin.page.js');
if (nbm) {
  const kode = bersih(nbm, 'nbm-report.admin.page.js', ['nbm-report-nama']);
  if (!/id="nbm-report-nama"/.test(kode)) {
    salah('nbm-report.admin.page.js: kotak saringan nama hilang dari Rekap NBM.');
  }

  // ============ DISARING SEKALI, SEBELUM APA PUN DIHITUNG ============
  //
  // `records` menurunkan enam hal: baris tabel, total per staff, teks
  // WhatsApp, PDF per baris, PDF total, dan `lastReportRows`.
  const iSaring = kode.indexOf('semuaRecords.filter((r) => fuzzyMatch(cariNama');
  const iRows = kode.indexOf('const rows = records.map((r) =>');
  if (iSaring < 0) {
    salah('nbm-report.admin.page.js: saringan nama tidak lagi diterapkan.');
  } else if (iRows >= 0 && iRows < iSaring) {
    salah(
      'nbm-report.admin.page.js: saringan nama diterapkan SESUDAH `rows` dihitung. Enam keluaran berasal dari ' +
        '`records`, dan yang paling berbahaya di antaranya adalah teks WhatsApp — ia langsung dikirim ke grup ' +
        'tanpa dibaca ulang.'
    );
  }

  // Rekap upah yang disaring HARUS mengatakan bahwa ia disaring.
  if (!/HANYA nama yang cocok/.test(kode)) {
    salah(
      'nbm-report.admin.page.js: saringan nama tidak lagi masuk JUDUL periode. Judul itu dipakai WhatsApp dan PDF ' +
        'juga — dan rekap NBM satu orang tanpa keterangan terbaca seperti rekap seluruh outlet yang kehilangan ' +
        'orang. Di dokumen yang menyangkut upah, itu kesalahan yang mahal.'
    );
  }
}

// =====================================================================
// 3. LAPORAN KAS (modul murni).
// =====================================================================
const lk = baca('js/modules/cash/laporan-kas.js');
if (lk) {
  const kode = bersih(lk, 'laporan-kas.js', ['susunBarisKas']);

  // ============ PEMERIKSAAN TERPENTING DI BERKAS INI ============
  if (!/nominal: i === 0 \? dasar\.nominal : null/.test(kode)) {
    salah(
      'laporan-kas.js: nominal tidak lagi dibatasi ke baris PERTAMA tiap nota. Nota berisi 8 barang menghasilkan ' +
        '8 baris, dan kolom bernama "Nominal" yang berisi angka di tiap baris PASTI dijumlahkan orang — hasilnya ' +
        'delapan kali lipat.'
    );
  }
  if (!/fotoKas: i === 0/.test(kode) || !/fotoNota: i === 0/.test(kode)) {
    salah('laporan-kas.js: foto tidak lagi dibatasi ke baris pertama — gambar yang sama disisipkan berkali-kali dan berkasnya membengkak.');
  }

  // Entri non-nota IKUT.
  if (!/sebabKosong: isDicoret \? SEBAB_NOL\.DICORET : n \? SEBAB_NOL\.NOTA_TANPA_BARIS : SEBAB_NOL\.BUKAN_NOTA/.test(kode)) {
    salah(
      'laporan-kas.js: entri tanpa barang tidak lagi dibedakan sebabnya. "Bukan pembayaran nota" dan "nota yang ' +
        'belum ada rinciannya" butuh tindakan yang berbeda, dan yang kedua perlu dikerjakan.'
    );
  }
  // Dicoret: nol, tapi tetap ada.
  if (!/nominal: isDicoret \? 0 :/.test(kode)) {
    salah('laporan-kas.js: entri yang dicoret ikut menjumlah lagi — koreksinya tidak pernah berlaku di laporan.');
  }
  if (!/nominalAsli:/.test(kode)) {
    salah('laporan-kas.js: nominal asli entri yang dicoret tidak lagi disimpan — bukti koreksinya hilang dari laporan.');
  }
  if (!/e\.dicoret_at/.test(kode)) {
    salah('laporan-kas.js: penanda dicoret tidak lagi dibaca.');
  }
  // Total tidak boleh memuat yang dicoret.
  if (!/!e\.dicoret_at\)\.reduce/.test(kode)) {
    salah('laporan-kas.js: total masuk/keluar ikut menghitung entri yang dicoret.');
  }
  // Lampiran tanpa duplikat & berpenanda.
  const dl = blokSampai(kode, 'export function daftarLampiranFoto', '\n}');
  if (!/sudah\.has\(path\)/.test(dl)) {
    salah('laporan-kas.js: lampiran foto tidak lagi menyaring duplikat — satu gambar bisa masuk berkali-kali.');
  }
  if (!/penanda:/.test(dl)) {
    salah(
      'laporan-kas.js: lampiran foto kehilangan penandanya. Tumpukan gambar yang tidak bisa dicocokkan dengan ' +
        'barisnya adalah lampiran yang berhenti dibuka orang.'
    );
  }
}

const ek = baca('js/modules/cash/ekspor-kas.js');
if (ek) {
  const kode = bersih(ek, 'ekspor-kas.js', ['siapkanLaporanKas']);
  // Hanya nota yang DIBAYAR entri itu.
  if (!/if \(n\?\.payment_entry_id\) notaPer\.set\(n\.payment_entry_id, n\)/.test(kode)) {
    salah(
      'ekspor-kas.js: nota dipetakan tanpa memastikan ia DIBAYAR entri itu. `notaTerkaitEntriKas` juga memulangkan ' +
        'nota yang ditunjuk `penyesuaian_nota` — itu entri KOREKSI, dan membentangkan barangnya di situ membuat ' +
        'daftar yang sama muncul dua kali.'
    );
  }
  // 'GAGAL' dibedakan dari "tidak berfoto" — diikat ke tempat foto DIAMBIL.
  // Mencarinya se-berkas tetap hijau sesudah penandanya dicabut di sini: ia
  // menemukan `?? 'GAGAL'` milik `unduhKasExcel` di bawah, yang cuma membaca
  // kembali peta yang sudah terlanjur berisi null. Ditemukan sabotasenya.
  const sl = blokSampai(kode, 'export async function siapkanLaporanKas', 'function kolomExcel');
  if (!/\?\? 'GAGAL'/.test(sl)) {
    salah(
      "ekspor-kas.js: foto yang gagal dimuat tidak lagi ditandai 'GAGAL'. Kalau disamakan dengan \"tidak berfoto\", " +
        'laporannya terbaca seperti separuh entri belum difoto — dan orang disuruh memfoto ulang yang fotonya sudah ada.'
    );
  }
  // PDF: 'GAGAL' tidak boleh masuk lampiran.
  if (!/f\.dataUrl !== 'GAGAL'/.test(kode)) {
    salah("ekspor-kas.js: 'GAGAL' ikut diteruskan ke lampiran PDF — `addImage` melempar dan yang tercetak cuma deretan \"(foto gagal)\".");
  }
  if (!/maxPx: PX_PDF/.test(kode)) {
    salah(
      'ekspor-kas.js: PDF tidak lagi memakai ukuran fotonya sendiri. PDF menanam base64 di badan dokumen — foto ' +
        'sebesar Excel menghasilkan berkas ratusan MB yang menggantungkan HP, tanpa satu pun galat.'
    );
  }
}

const cadm = baca('js/modules/cash/cash.admin.page.js');
if (cadm) {
  const kode = bersih(cadm, 'cash.admin.page.js', ['cm-xlsx']);
  if (!/id="cm-xlsx"/.test(kode) || !/id="cm-pdf"/.test(kode)) {
    salah('cash.admin.page.js: tombol ekspor Excel/PDF hilang dari Mutasi Kas.');
  }
  // ============ UNDUHAN MEMAKAI YANG TERLIHAT ============
  if (!/fn\(\{ entries: rows,/.test(kode)) {
    salah(
      'cash.admin.page.js: unduhan tidak lagi memakai `rows` (yang lolos seluruh saringan). Memakai `semuaBaris` ' +
        'menghasilkan berkas yang isinya berbeda dari layar saat tombolnya ditekan — dan karena berkas itu dikirim ' +
        'ke orang lain, salahnya baru ketahuan di sana.'
    );
  }
  if (/fn\(\{ entries: semuaBaris/.test(kode)) {
    salah('cash.admin.page.js: unduhan memakai `semuaBaris` — baris yang tersembunyi saringan ikut terbawa ke berkas.');
  }
}

// =====================================================================
// 4. EKSPOR SHEET PER NOTA.
// =====================================================================
const ap = baca('js/modules/inventory/aturan-nota-persheet.js');
if (ap) {
  const kode = bersih(ap, 'aturan-nota-persheet.js', ['namaSheet', 'periksaBatas']);

  // Excel MENOLAK berkas yang nama sheetnya memuat karakter ini.
  // Dicocokkan sebagai TEKS BIASA, bukan regex literal: polanya sendiri memuat
  // "/" dan "[", yang di dalam sebuah regex literal harus di-escape berlapis —
  // dan versi pertama audit ini gagal dimuat karena itu. Audit yang tidak bisa
  // dijalankan tidak menjaga apa pun.
  const PEMBERSIH_NAMA = "replace(/[:\\\\/?*[\\]]+/g, '-')";
  if (!kode.includes(PEMBERSIH_NAMA)) {
    salah(
      'aturan-nota-persheet.js: nama sheet tidak lagi dibersihkan dari : \\ / ? * [ ]. Nomor nota supplier sering ' +
        'berbentuk "INV/2026/09" — dan Excel menolak SELURUH berkasnya, tanpa menyebut sheet mana.'
    );
  }
  if (!/slice\(0, 31\)/.test(kode)) {
    salah('aturan-nota-persheet.js: batas 31 karakter nama sheet hilang — Excel menolak berkasnya.');
  }
  const pb = blokSampai(kode, 'export function periksaBatas', '\n}');
  if (!/jumlahNota <= batas/.test(pb)) {
    salah('aturan-nota-persheet.js: pemeriksaan batas jumlah nota hilang.');
  }
  for (const [pola, apa] of [
    [/\$\{jumlahNota\}/, 'jumlah nota yang ada'],
    [/\$\{batas\}/, 'angka batasnya'],
    [/Persempit|persempit/, 'jalan keluarnya'],
    [/Rincian \+ Rekap/, 'ekspor lain yang tanpa batas']
  ]) {
    if (!pola.test(pb)) {
      salah(
        `aturan-nota-persheet.js: kalimat penolakan batas tidak lagi menyebut ${apa}. Penolakan yang cuma berbunyi ` +
          '"terlalu banyak" meninggalkan orangnya di tempat yang sama persis.'
      );
    }
  }
}

const ep = baca('js/modules/inventory/ekspor-nota-persheet.js');
if (ep) {
  const kode = bersih(ep, 'ekspor-nota-persheet.js', ['unduhNotaPerSheet']);
  if (!/const tolak = periksaBatas\(daftar\.length\);/.test(kode) || !/if \(tolak\) throw new Error\(tolak\)/.test(kode)) {
    salah(
      'ekspor-nota-persheet.js: batas tidak lagi MENOLAK. Memotong diam-diam di nota ke-60 menghasilkan berkas ' +
        'berisi separuh rentang tanpa satu pun tanda — di berkas yang dipakai mencocokkan tagihan, itu yang paling mahal.'
    );
  }
  if (!/sheets = \[sheetGabungan\]/.test(kode)) {
    salah(
      'ekspor-nota-persheet.js: sheet rincian gabungan tidak lagi jadi sheet pertama. Tanpanya orang harus membuka ' +
        '40 tab untuk menjumlahkan total belanja sebulan.'
    );
  }
  // Nota tanpa baris tetap dapat sheetnya.
  if (!/lap\.baris\.length \? lap\.baris :/.test(kode)) {
    salah(
      'ekspor-nota-persheet.js: nota tanpa rincian dilewati. Jumlah sheet lalu tidak cocok dengan jumlah nota di ' +
        'layar, dan yang membacanya mengira notanya hilang.'
    );
  }
}

const nadm = baca('js/modules/inventory/nota.admin.js');
if (nadm) {
  const kode = bersih(nadm, 'nota.admin.js', ['nt-ekspor-sheet']);
  if (!/id="nt-ekspor-sheet"/.test(kode)) {
    salah('nota.admin.js: tombol "Export per Nota" hilang.');
  }
  // Ditolak SEBELUM satu foto pun diunduh.
  const blok = blokSampai(kode, "'#nt-ekspor-sheet'", 'await muat();');
  if (!/periksaBatas\(notaTampil\.length\)/.test(blok)) {
    salah(
      'nota.admin.js: batas tidak diperiksa di layar. Memeriksanya hanya di dalam fungsi ekspor berarti orang ' +
        'menunggu belasan detik unduhan foto untuk sebuah penolakan yang sudah bisa diketahui sejak awal.'
    );
  }
  if (!/notas: notaTampil/.test(blok)) {
    salah('nota.admin.js: ekspor per-nota tidak lagi memakai nota yang SEDANG TAMPIL.');
  }
}

// =====================================================================
// 5. PUSTAKA EKSPOR.
// =====================================================================
const xf = baca('js/core/xlsx-foto.js');
if (xf) {
  const kode = bersih(xf, 'xlsx-foto.js', ['exportSheetsXLSXFoto']);
  // Dulu `findIndex`, yang memulangkan 0 untuk kolom pertama.
  if (!/const adaKolomFoto = columns\.some\(\(c\) => c\.foto\)/.test(kode)) {
    salah(
      'xlsx-foto.js: tinggi baris kembali dihitung dari `findIndex` kolom foto. Dengan lebih dari satu kolom foto, ' +
        'kolom kedua tergambar tapi barisnya bisa terlalu pendek — gagal diam-diam, bukan menolak.'
    );
  }
  if (!/export async function exportSheetsXLSXFoto/.test(kode)) {
    salah('xlsx-foto.js: `exportSheetsXLSXFoto` hilang — ekspor sheet-per-nota tidak punya penggambarnya.');
  }
  const es = blokSampai(kode, 'export async function exportSheetsXLSXFoto', 'function unduh(');
  if (!/while \(terpakai\.has\(nama\)\)/.test(es)) {
    salah(
      'xlsx-foto.js: nama sheet kembar tidak lagi dibedakan. Dua sheet bernama sama membuat berkasnya GAGAL DIBUKA ' +
        'sama sekali, bukan sekadar tampil aneh.'
    );
  }
  if (!/s\.foto === 'GAGAL'/.test(es)) {
    salah("xlsx-foto.js: sheet tidak lagi membedakan foto yang GAGAL dimuat dari nota yang memang tidak berfoto.");
  }
}

const pdf = baca('js/core/pdf.js');
if (pdf) {
  const kode = bersih(pdf, 'pdf.js', ['lampiranFoto']);
  if (!/lampiranFoto = \[\]/.test(kode)) {
    salah('pdf.js: dukungan lampiran foto hilang — ekspor PDF kas kehilangan bukti fotonya.');
  }
  // Penanda ditulis SEBELUM gambarnya, supaya tetap ada kalau addImage melempar.
  const iPenanda = kode.indexOf('doc.splitTextToSize(String(f.penanda');
  const iGambar = kode.indexOf("doc.addImage(f.dataUrl, 'JPEG'");
  if (iPenanda < 0 || iGambar < 0) {
    salah('pdf.js: jalur lampiran foto tidak lengkap.');
  } else if (iGambar < iPenanda) {
    salah(
      'pdf.js: penanda lampiran ditulis SESUDAH gambarnya. Kalau `addImage` melempar, halaman itu berisi gambar ' +
        'kosong tanpa keterangan — dan lampiran yang tidak bisa dicocokkan dengan barisnya berhenti dibuka orang.'
    );
  }
}

console.log('');
if (gagal === 0) console.log('Audit saringan & ekspor bersih. ✅');
else console.error(`${gagal} masalah ditemukan.`);
process.exit(gagal === 0 ? 0 : 1);
