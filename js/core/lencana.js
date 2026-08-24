/**
 * LENCANA KARTU BERANDA — dua jenis tanda yang sengaja dibedakan.
 *
 * ============ KENAPA DUA, BUKAN SATU ============
 *
 *   MERAH + ANGKA  "ada yang menunggu kamu kerjakan"
 *                  hilang saat PEKERJAANNYA selesai
 *
 *   TITIK BIRU     "ada yang baru sejak terakhir kamu buka"
 *                  hilang saat KARTUNYA dibuka
 *
 * Permintaan aslinya adalah yang kedua. Tapi yang kedua sendirian punya
 * kelemahan yang serius di aplikasi operasional: staff membuka Pengiriman,
 * melihat tiga kiriman perlu dikonfirmasi, lalu dipanggil tamu. Tandanya sudah
 * hilang — padahal kerjanya belum. Besoknya tidak ada lagi yang mengingatkan,
 * dan tiga kiriman itu menggantung tanpa satu pun jejak di layar.
 *
 * Itu pola "kegagalan yang terlihat seperti keberhasilan" yang dijaga di
 * seluruh aplikasi ini. Maka yang merah dipakai untuk pekerjaan, dan yang biru
 * hanya untuk kabar.
 *
 * ============ MERAH SELALU MENANG ============
 *
 * Kalau sebuah kartu punya keduanya, yang tampil merah. Angka pekerjaan lebih
 * penting daripada "ada yang baru", dan dua tanda di satu kartu kecil hanya
 * membuat keduanya sulit dibaca.
 *
 * Tidak ada impor di berkas ini.
 */

export const JENIS = {
  ANGKA: 'angka',
  SERU: 'seru',
  BARU: 'baru',
  KOSONG: 'kosong'
};

/** Angka, atau `null`. Jenisnya diperiksa lebih dulu — alasannya di `pricing.js`. */
const angka = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

/**
 * Satu lencana untuk satu kartu.
 *
 * @param {{jumlah?: number, jenis?: string}|null} tertunda hasil `lencana_beranda`
 * @param {boolean} adaYangBaru dari perbandingan waktu di `adaKabarBaru()`
 */
export function lencanaKartu(tertunda, adaYangBaru = false) {
  const n = angka(tertunda?.jumlah) ?? 0;

  // MERAH DULU. Lihat kepala berkas.
  if (n > 0) {
    if (tertunda?.jenis === JENIS.SERU) {
      return { jenis: JENIS.SERU, teks: '!', judul: 'Ada yang perlu diperhatikan' };
    }
    return {
      jenis: JENIS.ANGKA,
      // Angka besar dipangkas supaya tidak melebarkan kartunya. 99+ sudah
      // menyampaikan hal yang sama dengan 137: terlalu banyak.
      teks: n > 99 ? '99+' : String(n),
      jumlah: n,
      judul: `${n} hal menunggu dikerjakan`
    };
  }

  if (adaYangBaru) {
    return { jenis: JENIS.BARU, teks: '', judul: 'Ada aktivitas baru sejak terakhir dibuka' };
  }

  return { jenis: JENIS.KOSONG, teks: '' };
}

/**
 * Susun lencana untuk seluruh kartu sekaligus.
 *
 * @param {Array<{code: string}>} modul kartu yang sedang digambar
 * @param {object} hasilRpc keluaran `lencana_beranda`
 * @param {Set<string>|Array<string>} kodeBaru modul yang punya kabar baru
 * @returns {Map<string, ReturnType<lencanaKartu>>}
 */
export function lencanaSemua(modul, hasilRpc, kodeBaru = []) {
  const baru = kodeBaru instanceof Set ? kodeBaru : new Set(kodeBaru ?? []);
  const perModul = hasilRpc?.modul ?? {};
  const peta = new Map();
  for (const m of modul ?? []) {
    if (!m?.code) continue;
    peta.set(m.code, lencanaKartu(perModul[m.code] ?? null, baru.has(m.code)));
  }
  return peta;
}

// =====================================================================
// "SUDAH DIBUKA" — disimpan per perangkat
// =====================================================================

const KUNCI = 'lencana_dibuka_v1';

/**
 * Kapan tiap modul terakhir dibuka, per akun & per outlet.
 *
 * Per PERANGKAT, bukan per akun di server — dan itu disengaja. Pertanyaannya
 * "apa yang baru sejak SAYA terakhir melihat", dan orang yang sama di HP
 * berbeda memang belum melihatnya di HP itu.
 *
 * Kalau penyimpanannya diblokir (mode privat), seluruh fitur titik biru
 * sekadar mati: `bacaWaktuBuka()` mengembalikan peta kosong, `adaKabarBaru()`
 * jadi false, dan lencana merah tetap bekerja. Yang hilang adalah kabar, bukan
 * pekerjaan.
 */
export function bacaWaktuBuka(userId, outletId) {
  try {
    const semua = JSON.parse(localStorage.getItem(KUNCI) || '{}');
    return semua[`${userId}|${outletId}`] ?? {};
  } catch {
    return {};
  }
}

export function catatWaktuBuka(userId, outletId, kodeModul, waktu = new Date().toISOString()) {
  try {
    const semua = JSON.parse(localStorage.getItem(KUNCI) || '{}');
    const kunci = `${userId}|${outletId}`;
    semua[kunci] = { ...(semua[kunci] ?? {}), [kodeModul]: waktu };
    localStorage.setItem(KUNCI, JSON.stringify(semua));
  } catch {
    // Penyimpanan diblokir -> titik biru mati, sisanya jalan. Lihat di atas.
  }
}

/**
 * Modul mana yang punya aktivitas lebih baru daripada terakhir dibuka.
 *
 * @param {Record<string, string|null>} terakhirAktivitas kode -> ISO waktu aktivitas terbaru
 * @param {Record<string, string>} waktuBuka kode -> ISO waktu terakhir dibuka
 */
export function adaKabarBaru(terakhirAktivitas, waktuBuka) {
  const hasil = new Set();
  for (const [kode, waktu] of Object.entries(terakhirAktivitas ?? {})) {
    if (!waktu) continue;
    const dibuka = waktuBuka?.[kode];

    // BELUM PERNAH DIBUKA BUKAN BERARTI ADA KABAR BARU.
    //
    // Kalau dianggap baru, staff baru akan mendapati SELURUH kartu bertitik
    // biru pada hari pertama — dan titik yang muncul di mana-mana tidak
    // menyampaikan apa pun. Yang pertama kali dilihat adalah keadaan awal,
    // bukan perubahan.
    if (!dibuka) continue;

    const a = Date.parse(waktu);
    const b = Date.parse(dibuka);
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    if (a > b) hasil.add(kode);
  }
  return hasil;
}
