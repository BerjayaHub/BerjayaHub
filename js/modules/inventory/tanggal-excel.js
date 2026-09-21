/**
 * TANGGAL UNTUK BERKAS ESB — sel tanggal sungguhan, bukan tulisan.
 *
 * ============ APA YANG SEBENARNYA DITUNTUT ESB ============
 *
 * Template resmi ESB dibuka dan selnya diperiksa apa adanya:
 *
 *     Simple Purchase  C2 -> type=d, number_format='mm-dd-yy', 1 Sep 2020
 *     Simple Transfer  B2 -> type=d, number_format='[$-409]d-mmm-yy', 18 Mar 2019
 *
 * Jadi yang dituntut adalah **sel tanggal**, bukan teks. Angka `01/09/2020` yang
 * terlihat di Excel cuma cara Excel menampilkannya menurut locale yang membuka
 * — format bawaan templatenya sendiri justru bulan-dulu.
 *
 * Berjaya Hub dulu mengirim `"2026-09-01"` sebagai TEKS, dan ESB menolaknya.
 * Menggantinya jadi teks `"01/09/2026"` TIDAK menyelesaikan apa pun: ia tetap
 * teks, dan menambah cara gagal yang baru — terbaca sebagai 9 Januari.
 *
 * ============ KENAPA ANGKANYA DIHITUNG SENDIRI ============
 *
 * SheetJS bisa menerima objek `Date`, tapi hasilnya bergantung zona waktu
 * mesin yang membuatnya. Diuji langsung di zona Asia/Jakarta:
 *
 *     new Date(2026, 8, 1)  ->  46266.00013888889
 *
 * Bukan bilangan bulat. Selisih 12 detik itu sisa LMT Jakarta (UTC+7:07:12)
 * yang ikut terbawa, jadi selnya jadi "1 Sep 2026 pukul 00:00:12". Untuk ESB
 * mungkin tidak masalah — tapi "mungkin tidak masalah" bukan dasar yang baik
 * untuk berkas yang ditolaknya secara diam-diam.
 *
 * Nomor seri Excel adalah aritmetika murni: jumlah hari sejak 30 Desember 1899.
 * Dihitung dari komponen tahun/bulan/hari lewat `Date.UTC` — kedua ujungnya
 * UTC, jadi zona waktu mesin tidak pernah ikut campur.
 *
 * Tidak ada impor di berkas ini, supaya bisa diuji tanpa browser.
 */

/**
 * Titik nol penanggalan Excel.
 *
 * 30 Desember 1899, bukan 31 Desember — Excel sengaja mempertahankan bug Lotus
 * 1-2-3 yang menganggap 1900 tahun kabisat. Menggeser satu hari di sini
 * membuat SELURUH tanggal meleset satu hari, dan tidak ada satu pun yang
 * terlihat salah: 31 Agustus tetap tanggal yang masuk akal untuk sebuah nota.
 */
const EPOCH_UTC = Date.UTC(1899, 11, 30);

/** Format tampilan selnya. Isi selnya tetap tanggal; ini cuma cara Excel menuliskannya. */
export const FORMAT_TANGGAL_EXCEL = 'dd/mm/yyyy';

/** Judul kolom tanggal di kedua template ESB. */
export const KOLOM_TANGGAL = 'Date';

/**
 * Nomor seri Excel dari sebuah tanggal.
 *
 * @param {string|null|undefined} v `YYYY-MM-DD`, atau timestamp yang diawali
 *   bentuk itu (`2026-09-01T03:00:00Z`). Bentuk lain DITOLAK — menebak
 *   "01/09/2026" berarti menebak antara 1 September dan 9 Januari, dan tebakan
 *   itu tidak akan pernah terlihat salah di layar mana pun.
 * @returns {number|null} `null` kalau tidak terbaca
 */
export function serialTanggalExcel(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return null;

  const th = Number(m[1]);
  const bl = Number(m[2]);
  const hr = Number(m[3]);
  if (!(bl >= 1 && bl <= 12) || !(hr >= 1 && hr <= 31)) return null;

  const utc = Date.UTC(th, bl - 1, hr);
  if (!Number.isFinite(utc)) return null;

  // Tanggal yang TIDAK ADA ditolak, bukan digulirkan.
  //
  // `Date.UTC(2026, 1, 30)` menghasilkan 2 Maret tanpa mengeluh. Nota
  // bertanggal 30 Februari memang salah input, tapi memindahkannya diam-diam
  // ke Maret membuat pembelian tercatat di bulan yang salah — dan yang
  // mencocokkannya dengan tagihan supplier tidak punya petunjuk apa pun.
  const balik = new Date(utc);
  if (balik.getUTCFullYear() !== th || balik.getUTCMonth() !== bl - 1 || balik.getUTCDate() !== hr) return null;

  const serial = (utc - EPOCH_UTC) / 86400000;
  // Excel tidak mengenal tanggal sebelum 1 Januari 1900 (serial 1).
  return serial >= 1 ? serial : null;
}

/**
 * Tanggal sebagai **TEKS** `dd/mm/yyyy` — untuk template yang memang menuntutnya.
 *
 * ============ KENAPA ADA DUA CARA, DAN INI BUKAN KELALAIAN ============
 *
 * Simple Purchase & Simple Transfer menuntut SEL TANGGAL (`type=d`); itu
 * diperiksa di templatenya dan dicatat di kepala berkas ini.
 *
 * Template **Disbursement** menjawab sebaliknya, dan sama tegasnya. Selnya
 * diperiksa apa adanya:
 *
 *     D2 -> type=s, number_format='@', val='30/04/2026'
 *
 * `@` adalah format TEKS di Excel. Jadi bukan sel tanggal yang kebetulan
 * tampil begitu — ia memang teks, dan kolom `Sequence` di sebelahnya pun
 * bertipe sama.
 *
 * Menyeragamkan keduanya "supaya rapi" berarti menebak, dan tebakan di sini
 * berakhir sebagai berkas yang ditolak ESB — di layar yang berbeda,
 * berminggu-minggu kemudian. Yang dipakai selalu apa yang ada di templatenya.
 *
 * Bentuk masukannya sama ketatnya dengan `serialTanggalExcel`: hanya
 * `YYYY-MM-DD` (atau timestamp yang diawali begitu). Menebak "01/09/2026"
 * berarti memilih antara 1 September dan 9 Januari.
 *
 * @param {string|null|undefined} v
 * @returns {string|null} `'30/04/2026'`, atau `null` kalau tidak terbaca
 */
export function tanggalTeksEsb(v) {
  const serial = serialTanggalExcel(v);
  // Dipinjamkan ke penjaga yang sudah ada, bukan diperiksa ulang dengan aturan
  // kedua: tanggal yang TIDAK ADA (`2026-02-30`) harus ditolak di kedua jalur,
  // dan dua aturan untuk satu pekerjaan pasti menyimpang.
  if (serial === null) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v).trim());
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/**
 * Pasang format tanggal pada satu kolom sebuah worksheet SheetJS.
 *
 * Nilainya sudah berupa angka seri saat sampai di sini, dan angka tanpa format
 * tampil sebagai `46266` — benar isinya, tapi tak terbaca siapa pun yang
 * membuka berkasnya untuk memeriksa sebelum diunggah.
 *
 * Indeks kolomnya DITURUNKAN dari daftar judul, bukan ditulis sebagai angka:
 * kolom yang ditambah atau dipindah di `KOLOM_ESB` tidak boleh membuat format
 * ini menempel di kolom yang salah.
 *
 * @param {object} ws worksheet SheetJS
 * @param {string[]} kolom daftar judul kolom
 * @param {number} jumlahBaris banyaknya baris data (tidak termasuk header)
 * @param {(c: number, r: number) => string} alamat pembuat alamat sel (`XLSX.utils.encode_cell`)
 * @param {number} [barisHeader=0] indeks baris header di dalam berkas.
 *   Simple Purchase & Simple Transfer menaruh header di baris pertama; Item
 *   Journal menaruhnya di baris ke-3 (indeks 2). Kalau angka ini diabaikan,
 *   formatnya menempel pada baris yang MELESET ke atas — dua sel teratas tetap
 *   tampil sebagai angka mentah dan dua sel terbawah tidak pernah diberi
 *   format, tanpa satu pun galat.
 * @returns {number} berapa sel yang diberi format — 0 berarti kolomnya tidak ketemu
 */
export function pasangFormatTanggal(ws, kolom, jumlahBaris, alamat, barisHeader = 0) {
  const c = (Array.isArray(kolom) ? kolom : []).indexOf(KOLOM_TANGGAL);
  if (c < 0 || !ws || typeof alamat !== 'function') return 0;
  const awal = Number.isInteger(barisHeader) && barisHeader >= 0 ? barisHeader + 1 : 1;
  let n = 0;
  for (let r = awal; r < awal + jumlahBaris; r++) {
    const sel = ws[alamat(c, r)];
    // Sel yang bukan angka dilewati: baris yang tanggalnya gagal dibaca memang
    // sengaja dibiarkan kosong, dan memberinya format tanggal membuat sel
    // kosong tampil sebagai "00/01/1900".
    if (!sel || sel.t !== 'n') continue;
    sel.z = FORMAT_TANGGAL_EXCEL;
    n += 1;
  }
  return n;
}
