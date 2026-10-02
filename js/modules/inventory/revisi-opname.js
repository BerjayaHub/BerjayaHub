/**
 * REVISI HASIL OPNAME — siapa boleh, dan berapa stok yang akan bergerak.
 *
 *   "setelah stock opname selesai dan ditutup, ada case staff masih salah
 *    input, apakah admin bisa mengubah hasil stock opname ini agar sesuai"
 *
 * ============ KENAPA ARITMETIKANYA ADA DI BERKAS TERPISAH ============
 *
 * Yang ditulis ke buku stok saat revisi BUKAN angka hitungannya, melainkan
 * SELISIH antara hitungan baru dan hitungan lama. Angka itu tidak pernah
 * terlihat di layar mana pun kecuali kalau sengaja ditampilkan — dan kalau
 * tandanya terbalik, stok bergerak dua kali sebesar kesalahannya ke arah yang
 * salah, tanpa satu pun galat.
 *
 * Jadi dialognya memperlihatkan pergerakan itu SEBELUM menyimpan, dan
 * rumusnya diuji di sini tanpa browser.
 *
 * ============ DUA PENJAGA UNTUK SATU ATURAN ============
 *
 * `bolehRevisiOpname` menentukan apakah TOMBOLNYA digambar. Penjaga yang
 * sesungguhnya ada di `opname_tolak_revisi` (0155) di dalam database, dan
 * kalimatnya di sana lebih panjang karena ia yang dibaca orang saat benar-benar
 * ditolak. Yang di sini pendek: ia muncul sebagai keterangan tombol mati.
 *
 * Dua tempat untuk satu aturan memang bisa menyimpang — tapi menyembunyikan
 * tombol BUKAN pengaman, dan satu-satunya alternatifnya adalah memanggil RPC
 * per baris hanya untuk tahu apakah tombolnya perlu digambar.
 *
 * Tidak ada impor di berkas ini, supaya bisa diuji tanpa browser.
 */

export const TOLAK_BUKAN_ADMIN = 'Hanya Admin BU & Super Admin';
export const TOLAK_MASIH_BERJALAN = 'Masih berjalan — perbaiki dari Staff App';
export const TOLAK_DIBATALKAN = 'Dibatalkan — tidak pernah menyentuh stok';
export const TOLAK_ADA_YANG_LEBIH_BARU = 'Sudah ada opname yang lebih baru di outlet ini';
export const TOLAK_ADA_SESI_TERBUKA = 'Ada sesi yang sedang berjalan di outlet ini';

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Boleh direvisi atau tidak, berikut alasan pendek untuk tombol yang mati.
 *
 * @param {object} sesi satu baris stock_counts (butuh id, outlet_id, status, closed_at)
 * @param {object[]} daftar seluruh riwayat sesi yang sedang ditampilkan
 * @param {{adminBu?: boolean}} [opsi]
 * @returns {{boleh: boolean, alasan: string}}
 */
export function bolehRevisiOpname(sesi, daftar = [], { adminBu = false } = {}) {
  if (!adminBu) return { boleh: false, alasan: TOLAK_BUKAN_ADMIN };
  if (!sesi?.id) return { boleh: false, alasan: TOLAK_DIBATALKAN };
  if (sesi.status === 'open') return { boleh: false, alasan: TOLAK_MASIH_BERJALAN };
  if (sesi.status !== 'closed') return { boleh: false, alasan: TOLAK_DIBATALKAN };

  const lain = (daftar ?? []).filter((d) => d?.outlet_id === sesi.outlet_id && d?.id !== sesi.id);

  // Sesi berjalan menghalangi, dan alasannya bukan kerapian: potret stok yang
  // sudah terisi di sesi itu jadi basi begitu saldo digeser revisi — dan basi
  // di situ tidak terlihat sampai sesinya ditutup dengan penyesuaian salah.
  if (lain.some((d) => d.status === 'open')) return { boleh: false, alasan: TOLAK_ADA_SESI_TERBUKA };

  // Perbandingan `>` pada string ISO 8601 BERLAKU karena bentuknya seragam dan
  // berzona sama — tapi hanya kalau dua-duanya ada. `closed_at` yang kosong
  // dibandingkan dengan apa pun selalu menghasilkan false, dan itu akan
  // mengizinkan revisi pada sesi yang sudah ketiban sesi berikutnya.
  const ini = sesi.closed_at ?? '';
  const adaLebihBaru = lain.some((d) => d.status === 'closed' && (!ini || String(d.closed_at ?? '') > String(ini)));
  if (adaLebihBaru) return { boleh: false, alasan: TOLAK_ADA_YANG_LEBIH_BARU };

  return { boleh: true, alasan: '' };
}

/**
 * Delta stok untuk MENGUBAH angka baris yang sudah ada.
 *
 * `system_qty` tidak ikut sama sekali — dan itu bukan kelalaian. Stok sekarang
 * SUDAH memuat penyesuaian penutupan, jadi menghitung ulang `baru − sistem`
 * akan menerapkan koreksinya dua kali (bentuk bug nanas di 0114).
 */
export function deltaRevisi({ lama, baru } = {}) {
  return num(baru) - num(lama);
}

/**
 * Delta stok untuk MENAMBAH bahan yang terlewat.
 *
 * Di sini `sistem` memang ikut, karena belum pernah ada penyesuaian untuk
 * bahan ini — dan angkanya adalah stok PADA SAAT SESI DITUTUP, bukan stok
 * sekarang. Yang menghitungnya adalah server (0155); yang di sini hanya
 * memperlihatkan hasilnya sebelum disimpan.
 */
export function deltaTambah({ counted, sistem } = {}) {
  return num(counted) - num(sistem);
}

/**
 * Delta stok untuk MEMBUANG baris yang salah barang.
 *
 * Mengembalikan stok ke angka SEBELUM opname — bukan ke nol. Opname tidak
 * pernah mengklaim nol untuk bahan yang tidak dihitung, jadi membuang
 * hitungannya harus mengembalikan keadaan itu persis.
 */
export function deltaHapus(item = {}) {
  return num(item.system_qty) - num(item.counted_qty);
}

const angka = (n) => String(Math.round(num(n) * 10000) / 10000).replace('.', ',');

/** "+5" / "−5" / "0" — tanda ditulis eksplisit, termasuk yang positif. */
export function teksDelta(d) {
  const v = num(d);
  if (v === 0) return '0';
  // Minus tipografis (−), bukan hyphen: di kolom yang dibaca cepat, "-5" dan
  // "5" beda satu karakter yang mudah terlewat.
  return (v > 0 ? '+' : '−') + angka(Math.abs(v));
}

/** Apakah baris ini pernah direvisi admin. */
export function adaRevisi(item) {
  return Array.isArray(item?.revisi) && item.revisi.length > 0;
}

/** Hitungan PALING AWAL yang pernah tersimpan di baris ini, atau null. */
export function qtyAsli(item) {
  if (!adaRevisi(item)) return null;
  // Entri pertama menyimpan angka sebelum revisi pertama. Untuk baris yang
  // DITAMBAHKAN admin, `qty_lama`-nya null — memang tidak ada angka asli.
  const pertama = item.revisi[0];
  return pertama?.qty_lama ?? null;
}

/**
 * "4.600 (semula 46.000)" — pola yang sama dengan koreksi penjualan (0112).
 *
 * Angka hasil revisi yang berdiri sendiri tidak bisa dibedakan dari angka yang
 * memang diisi staff, dan itu justru yang membuat laporan berubah sendiri
 * tidak bisa dipertanggungjawabkan.
 */
export function labelDihitung(item) {
  const sekarang = angka(item?.counted_qty);
  const asli = qtyAsli(item);
  if (asli == null) return adaRevisi(item) ? `${sekarang} (ditambahkan admin)` : sekarang;
  return `${sekarang} (semula ${angka(asli)})`;
}

/** Baris yang ikut dihitung di laporan: yang dibuang TIDAK ikut. */
export function itemTerpakai(items = []) {
  return (items ?? []).filter((it) => !it?.dibuang_at);
}

/** Ringkasan untuk kepala laporan & daftar sesi. */
export function ringkasRevisi(items = []) {
  const semua = items ?? [];
  return {
    jumlahDirevisi: semua.filter((it) => !it?.dibuang_at && adaRevisi(it)).length,
    jumlahDibuang: semua.filter((it) => it?.dibuang_at).length
  };
}
