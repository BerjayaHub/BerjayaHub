/**
 * Aturan ISTIRAHAT & CLOCK OUT OTOMATIS — murni, tanpa impor.
 *
 * ============ ISTIRAHAT TIDAK MENYENTUH NBM ============
 *
 *   "fitur ini tidak berpengaruh terhadap nbm sama sekali, jadi mau ambil
 *    istirahat atau tidak tidak berpengaruh kepada nbm"
 *
 * Itu ditulis di sini sebagai peringatan, bukan sebagai kode: berkas ini
 * memang tidak mengekspor satu pun fungsi yang mengurangi jam kerja. Godaan
 * berikutnya — "kan lebih adil kalau istirahat dipotong" — akan datang dari
 * orang yang tidak membaca permintaan aslinya, dan yang menahannya cuma
 * catatan ini plus auditnya.
 *
 * ============ 12 JAM ADALAH PEMICU, BUKAN JAM PULANG ============
 *
 *   "12 jam setelah clock in staff belum clock out maka otomatis dia dianggap
 *    clock out di jam sesuai shift nya ... dianggap masuk seperti biasa tanpa
 *    lembur"
 *
 * Kalau barisnya ditutup PADA jam pemicu, staff yang lupa clock out tercatat
 * bekerja 12 jam — lembur yang tidak pernah terjadi, di sistem yang membayar
 * lembur bertingkat (0037). Pemicu dan jam pulang adalah dua angka yang
 * berbeda, dan menukarnya tidak menghasilkan error apa pun.
 */

export const MODE_BEBAS = 'bebas';
export const MODE_DITENTUKAN = 'ditentukan';

/** Lupa kembali dari istirahat -> dianggap kembali 2 jam sesudah mulai. */
export const BATAS_ISTIRAHAT_JAM = 2;

export const SETELAN_BAWAAN = {
  breakMode: MODE_BEBAS,
  breakStart: null,
  breakEnd: null,
  standardWorkHours: 8,
  autoCloseAfterHours: 12
};

const teks = (v) => (v === null || v === undefined ? null : String(v));
/**
 * Angka JAM yang sah, atau `null`.
 *
 * Nol dan negatif DITOLAK, berbeda dari tempat lain di repo ini yang
 * memperlakukan 0 sebagai nilai sah. Di sini 0 bukan "gratis" melainkan
 * "jam kerja standar nol jam" — dan artinya clock out otomatis jatuh PERSIS di
 * jam masuk. Durasi nol lolos ke NBM dan seluruh laporan jam kerja tanpa satu
 * pun error.
 */
const angka = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * Setelan yang BERLAKU: penimpa outlet, lalu bawaan BU, lalu bawaan aplikasi.
 *
 * Dipakai layar; server punya `setelan_presensi()` dengan urutan yang sama.
 * Keduanya diuji terhadap kasus yang sama supaya tidak menyimpang.
 *
 * @param {object|null} bu     baris attendance_settings milik BU (outlet_id null)
 * @param {object|null} outlet baris attendance_settings milik outlet
 */
export function setelanEfektif(bu, outlet) {
  // Per-KOLOM, bukan per-baris. Outlet yang cuma ingin mengubah jam
  // istirahatnya tidak boleh kehilangan `standard_work_hours` milik BU-nya
  // hanya karena barisnya ada.
  const ambil = (nama, ubah = (v) => v) => {
    const dariOutlet = outlet?.[nama];
    if (dariOutlet !== null && dariOutlet !== undefined && dariOutlet !== '') return ubah(dariOutlet);
    const dariBu = bu?.[nama];
    if (dariBu !== null && dariBu !== undefined && dariBu !== '') return ubah(dariBu);
    return undefined;
  };

  const mode = ambil('break_mode');
  return {
    breakMode: mode === MODE_DITENTUKAN ? MODE_DITENTUKAN : MODE_BEBAS,
    breakStart: teks(ambil('break_start')) ?? null,
    breakEnd: teks(ambil('break_end')) ?? null,
    standardWorkHours: angka(ambil('standard_work_hours')) ?? SETELAN_BAWAAN.standardWorkHours,
    autoCloseAfterHours: angka(ambil('auto_close_after_hours')) ?? SETELAN_BAWAAN.autoCloseAfterHours,
    dari: outlet ? 'outlet' : bu ? 'bu' : 'bawaan'
  };
}

/** 'HH:MM' atau 'HH:MM:SS' -> menit sejak tengah malam. `null` kalau tidak sah. */
export function keMenit(jam) {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(String(jam ?? '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mnt = Number(m[2]);
  if (h > 23 || mnt > 59) return null;
  return h * 60 + mnt;
}

/**
 * Apakah `jam` berada di dalam jendela mulai..selesai?
 *
 * Jendela yang MELEWATI TENGAH MALAM (mis. 23:00–01:00) ditangani dengan
 * membalik perbandingannya. Shift malam ada di aplikasi ini — jendela seperti
 * itu bukan kemungkinan teoretis, dan perbandingan lurus akan menolak seluruh
 * jam yang sah tanpa satu pun pesan yang menjelaskan.
 */
export function dalamJendela(jam, mulai, selesai) {
  const j = keMenit(jam);
  const a = keMenit(mulai);
  const b = keMenit(selesai);
  if (j === null || a === null || b === null) return false;
  return a <= b ? j >= a && j <= b : j >= a || j <= b;
}

/**
 * Boleh menekan tombol Istirahat sekarang?
 *
 * @param {object} o
 * @param {object} o.setelan hasil `setelanEfektif`
 * @param {string} o.jamSekarang 'HH:MM' waktu WIB
 * @param {boolean} o.sedangIstirahat
 * @param {boolean} o.sudahClockOut
 */
export function bolehMulaiIstirahat({ setelan, jamSekarang, sedangIstirahat = false, sudahClockOut = false } = {}) {
  if (sudahClockOut) return { boleh: false, sebab: 'Kamu sudah clock out.' };
  if (sedangIstirahat) return { boleh: false, sebab: 'Istirahatmu masih berjalan.' };
  if (setelan?.breakMode !== MODE_DITENTUKAN) return { boleh: true, sebab: '' };

  if (!setelan.breakStart || !setelan.breakEnd) {
    // Mode 'ditentukan' tanpa jamnya adalah setelan yang tidak bisa dijalankan.
    // Dikatakan apa adanya — tombol yang mati tanpa sebab akan dilaporkan
    // sebagai aplikasi rusak.
    return { boleh: false, sebab: 'Jam istirahat belum diatur admin untuk outlet ini.' };
  }
  if (!dalamJendela(jamSekarang, setelan.breakStart, setelan.breakEnd)) {
    return {
      boleh: false,
      sebab: `Istirahat hanya bisa diambil antara ${setelan.breakStart.slice(0, 5)} dan ${setelan.breakEnd.slice(0, 5)}.`
    };
  }
  return { boleh: true, sebab: '' };
}

/**
 * Kembali dari istirahat SELALU boleh selama ada yang berjalan.
 *
 * Jendela jamnya sengaja TIDAK ditegakkan di sini. Menolak orang yang kembali
 * di luar jam hanya menghasilkan istirahat yang menggantung, lalu ditutup
 * otomatis 2 jam — hukuman untuk orang yang justru kembali lebih awal.
 */
export function bolehSelesaiIstirahat({ sedangIstirahat = false } = {}) {
  return sedangIstirahat
    ? { boleh: true, sebab: '' }
    : { boleh: false, sebab: 'Tidak ada istirahat yang sedang berjalan.' };
}

/** Kapan sebuah istirahat akan ditutup sendiri kalau lupa. */
export function batasKembali(mulaiMs) {
  const t = Number(mulaiMs);
  if (!Number.isFinite(t)) return null;
  return t + BATAS_ISTIRAHAT_JAM * 3600 * 1000;
}

/**
 * Jam pulang yang DITEBAK untuk sesi yang menggantung.
 *
 * Cerminan `tutup_presensi_tertinggal()` di 0138 — dipakai layar untuk
 * memberi tahu staff kapan sesinya akan ditutup sendiri, dan diuji dengan
 * kasus yang sama supaya keduanya tidak menyimpang.
 *
 * @param {object} o
 * @param {number} o.clockInMs
 * @param {{start: string, end: string}|null} o.shift jam shift terjadwal hari itu
 * @param {number} o.jamStandar jam kerja standar kalau tidak ada shift
 * @returns {{waktu: number, dari: 'shift'|'standar'}}
 */
export function jamTutupOtomatis({ clockInMs, shift = null, jamStandar = 8 } = {}) {
  const masuk = Number(clockInMs);
  const standar = (angka(jamStandar) ?? 8) * 3600 * 1000;
  if (!Number.isFinite(masuk)) return { waktu: NaN, dari: 'standar' };

  const a = shift ? keMenit(shift.start) : null;
  const b = shift ? keMenit(shift.end) : null;
  if (a === null || b === null) return { waktu: masuk + standar, dari: 'standar' };

  const d = new Date(masuk);
  // Tanggal kerjanya = tanggal CLOCK IN. Sesi 22:00–07:00 adalah SATU hari
  // kerja milik tanggal masuknya — aturan yang sama dengan yang dipakai NBM.
  const dasar = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0).getTime();
  // Shift yang melewati tengah malam (end <= start) pulangnya HARI BERIKUTNYA.
  // Tanpa ini jam keluar jatuh sebelum jam masuk, dan durasinya negatif.
  const lintasHari = b <= a ? 24 * 60 : 0;
  const waktu = dasar + (b + lintasHari) * 60 * 1000;

  // Jam keluar tidak boleh mendahului jam masuk — bisa terjadi kalau jadwalnya
  // diubah sesudah orangnya masuk, atau ia masuk jauh sesudah shiftnya usai.
  // Durasi negatif menghasilkan angka mustahil di NBM, dan tetap tercetak.
  if (waktu <= masuk) return { waktu: masuk + standar, dari: 'standar' };
  return { waktu, dari: 'shift' };
}

/**
 * Total menit istirahat sebuah presensi — UNTUK REKAP SAJA.
 *
 * Sengaja tidak mengembalikan apa pun yang berbentuk "jam kerja bersih":
 * istirahat tidak boleh mengurangi apa pun, dan angka bernama "jam kerja
 * setelah istirahat" adalah langkah pertama menuju NBM yang terpotong.
 */
export function totalMenitIstirahat(breaks, sekarangMs = Date.now()) {
  let menit = 0;
  let berjalan = 0;
  let otomatis = 0;
  for (const b of Array.isArray(breaks) ? breaks : []) {
    if (!b?.mulai_at) continue;
    const mulai = new Date(b.mulai_at).getTime();
    if (!Number.isFinite(mulai)) continue;
    if (b.selesai_at) {
      const selesai = new Date(b.selesai_at).getTime();
      if (Number.isFinite(selesai) && selesai >= mulai) menit += (selesai - mulai) / 60000;
      if (b.otomatis) otomatis++;
    } else {
      berjalan++;
      // Yang masih berjalan dihitung sampai SEKARANG, tapi dijepit ke batas
      // 2 jam: sesudah itu server akan menutupnya di angka yang sama, dan
      // rekap yang terus tumbuh akan berbeda dari angka final tanpa sebab.
      const batas = batasKembali(mulai);
      menit += (Math.min(sekarangMs, batas) - mulai) / 60000;
    }
  }
  return { menit: Math.max(0, Math.round(menit)), berjalan, otomatis };
}
