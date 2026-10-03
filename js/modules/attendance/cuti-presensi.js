/**
 * CUTI YANG SEDANG BERLAKU SAAT ORANGNYA HENDAK CLOCK IN.
 *
 *   "apakah shift dan cuti sudah terkoneksi dengan presensi?"
 *
 * ============ APA YANG DIPUTUSKAN DI SINI ============
 *
 * Bukan apakah boleh absen — boleh, selalu. Ada kalanya orang yang sedang cuti
 * memang dipanggil masuk, dan menolaknya memaksa dia absen lewat jalan lain
 * (titip akun, atau minta admin mengoreksi belakangan). Dua-duanya
 * menghasilkan catatan yang lebih tidak bisa dipercaya daripada presensi yang
 * ditandai.
 *
 * Yang diputuskan di sini cuma: apakah hari ini jatuh di dalam cuti yang sudah
 * disetujui, dan kalau ya — cuti apa, sampai kapan.
 *
 * ============ KENAPA "SAMPAI KAPAN" IKUT DIHITUNG ============
 *
 * `cuti_saya_rentang` (0113) mengembalikan SATU BARIS PER TANGGAL, bukan satu
 * baris per pengajuan. Kalimat "kamu sedang cuti" tanpa tanggal akhir
 * menyisakan pertanyaan yang justru paling penting bagi orang yang sedang
 * ragu-ragu di depan tombol: ini cuti sehari atau cuti seminggu? Yang sehari
 * mungkin memang salah tanggal; yang seminggu hampir pasti disengaja.
 *
 * Tidak ada impor di berkas ini, supaya bisa diuji tanpa browser.
 */

const teks = (v) => (v === null || v === undefined ? '' : String(v));

/**
 * Tanggal jadi 'YYYY-MM-DD'.
 *
 * PostgREST mengembalikan kolom `date` sebagai string, tapi `cuti_saya_rentang`
 * menghasilkan tanggalnya lewat `generate_series` atas `interval '1 day'` —
 * dan bentuk keluarannya pernah berbeda antar versi. Pemotongan dikerjakan di
 * satu tempat supaya penyusun dan pembaca tidak pernah memakai bentuk yang
 * berbeda; kalau sampai berbeda, tidak ada yang cocok dan gejalanya cuma
 * "peringatannya tidak muncul", tanpa satu pun galat.
 */
export function keTanggal(nilai) {
  const s = teks(nilai);
  // Dipotong HANYA kalau sepuluh karakter pertamanya memang berbentuk tanggal.
  //
  // Versi pertama memotong apa pun yang panjangnya ≥10, dan hasilnya nilai
  // sampah berubah jadi potongan yang TERLIHAT seperti tanggal — bentuk
  // kegagalan yang jauh lebih sulit dilacak daripada nilai aslinya yang
  // jelas-jelas salah.
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : s;
}

/** Tanggal hari ini menurut WIB — bukan menurut zona perangkatnya. */
export function tanggalWIB(saat = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(saat);
}

const tambahHari = (tanggal, n) => {
  const d = new Date(`${tanggal}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/**
 * Batas akhir rentang yang diminta dari `cuti_saya_rentang`.
 *
 * Bukan sehari. Rentang sehari cukup untuk menjawab "apakah hari ini cuti",
 * tapi tidak bisa menjawab "sampai kapan" — dan jawaban kedua itulah yang
 * membedakan salah tanggal sehari dari cuti seminggu yang memang disengaja.
 *
 * 60 hari: lebih panjang dari cuti terpanjang yang masuk akal, dan masih satu
 * permintaan kecil.
 */
export function akhirRentangCuti(tanggal) {
  return tambahHari(keTanggal(tanggal), 60);
}

/**
 * Cuti yang berlaku pada sebuah tanggal, berikut hari terakhirnya yang
 * BERUNTUN dari tanggal itu.
 *
 * @param {Array<{tanggal: string, jenis?: string, leave_request_id?: string}>} baris
 *        hasil `cuti_saya_rentang(hari_ini, hari_ini + beberapa minggu)`
 * @param {string} tanggal 'YYYY-MM-DD'
 * @returns {{jenis: string, id: string|null, sampai: string, hari: number}|null}
 */
export function cutiPada(baris, tanggal) {
  const hari = new Map();
  for (const b of baris ?? []) {
    const t = keTanggal(b?.tanggal);
    if (t) hari.set(t, b);
  }
  const ini = hari.get(tanggal);
  if (!ini) return null;

  // Hari terakhir yang BERUNTUN. Dua pengajuan terpisah yang kebetulan
  // bersebelahan sengaja dibaca sebagai satu rentang: bagi orang yang sedang
  // berdiri di depan tombol, "cuti sampai tanggal berapa" adalah satu
  // pertanyaan, bukan dua.
  let sampai = tanggal;
  let n = 1;
  // Batas 400 supaya data yang aneh tidak membuat gelang ini berputar
  // selamanya di HP orang. Cuti setahun penuh pun masih di bawahnya.
  while (n < 400 && hari.has(tambahHari(sampai, 1))) {
    sampai = tambahHari(sampai, 1);
    n += 1;
  }

  return {
    jenis: teks(ini.jenis) || 'Cuti',
    id: ini.leave_request_id ?? null,
    sampai,
    hari: n
  };
}

/** Tanggal untuk dibaca manusia: '5 Oktober 2026'. */
export function tanggalPanjang(tanggal) {
  const t = keTanggal(tanggal);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  return new Date(`${t}T00:00:00`).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
}

/**
 * Kalimat peringatannya.
 *
 * Nadanya sengaja BUKAN tuduhan. Yang paling sering terjadi bukan orang yang
 * curang, melainkan orang yang lupa cutinya sudah disetujui, atau yang memang
 * dipanggil masuk. Kalimat yang menuduh membuat yang kedua merasa harus
 * mencari jalan lain — dan jalan lain itulah yang menghasilkan catatan buruk.
 *
 * @param {{jenis: string, sampai: string, hari: number}} cuti
 * @returns {{judul: string, pesan: string, lanjut: string}}
 */
export function peringatanCuti(cuti) {
  const sampai = tanggalPanjang(cuti?.sampai);
  const jenis = teks(cuti?.jenis) || 'Cuti';
  const hari = Number(cuti?.hari) || 1;

  return {
    judul: 'Kamu sedang cuti hari ini',
    pesan:
      hari > 1
        ? `<strong>${jenis}</strong> kamu berlaku sampai <strong>${sampai}</strong> (${hari} hari).`
        : `<strong>${jenis}</strong> kamu berlaku untuk <strong>hari ini</strong>.`,
    // Disebut terus terang: presensinya TETAP tercatat, dan tandanya terlihat
    // admin. Menyembunyikan itu akan membuat orang merasa dikerjai saat
    // tandanya muncul di rekap.
    lanjut: 'Tetap absen'
  };
}

/** Catatan di bawah pesannya — apa yang akan terjadi kalau diteruskan. */
export const CATATAN_LANJUT =
  'Presensinya tetap tercatat seperti biasa, dan diberi tanda "masuk saat cuti" supaya admin tahu hari ini terhitung dua kali.';
