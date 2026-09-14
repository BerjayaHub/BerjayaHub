/**
 * KOREKSI ENTRI KAS — aturan tampilannya.
 *
 * ============ SATU SUMBER ATURAN, DAN IA ADA DI SERVER ============
 *
 * Boleh tidaknya sebuah entri dikoreksi diputuskan `alasan_tolak_koreksi_kas()`
 * (migration 0141) dan dikirim ke layar sebagai `alasan_tolak` pada tiap baris.
 * Berkas ini SENGAJA tidak menyimpan salinan aturannya — ia hanya menerjemahkan
 * jawaban server jadi tombol.
 *
 * Kenapa itu penting di sini khususnya: aturan yang ditiru di klien akan
 * menyimpang dari servernya cepat atau lambat, dan penyimpangannya muncul
 * sebagai tombol yang tampak hidup lalu selalu ditolak — atau, jauh lebih
 * buruk, tombol yang hilang untuk entri yang sebenarnya boleh diperbaiki.
 *
 * ============ TOMBOL YANG TIDAK BOLEH DITEKAN TETAP DIGAMBAR ============
 *
 * Entri pembayaran nota tidak bisa dikoreksi dari modul Kas, dan alasannya
 * panjang (nominalnya milik notanya; jalurnya di modul Bahan). Menyembunyikan
 * tombolnya berarti orang mencarinya, tidak menemukannya, dan menyimpulkan
 * aplikasinya rusak. Jadi tombolnya tetap ada, MATI, dan sebabnya tertulis di
 * tooltip-nya — kalimat yang sama persis dengan yang akan dilempar server.
 *
 * Tidak ada impor di berkas ini, supaya bisa diuji tanpa browser.
 */

/** Entri yang sudah dicoret: masih ditampilkan, tapi tidak menghitung saldo. */
export const LABEL_DICORET = 'DIHAPUS';

/**
 * Ringkasan satu baris riwayat kas untuk digambar.
 *
 * @param {object} e baris hasil RPC `riwayat_kas_saya` / `mutasi_kas_admin`
 * @returns {{dicoret: boolean, bolehKoreksi: boolean, alasanTolak: string, jejak: string}}
 */
export function keadaanKoreksi(e) {
  const dicoret = !!e?.dicoret_at;
  const alasanTolak = teks(e?.alasan_tolak);
  return {
    dicoret,
    // `alasan_tolak` KOSONG berarti boleh. Bukan sebaliknya: kalau servernya
    // tidak mengirim kolom itu sama sekali (versi lama, RPC gagal sebagian),
    // jawabannya jadi "boleh" — dan servernya tetap menolak dengan pesan yang
    // benar. Menebak "tidak boleh" akan mematikan tombol untuk semua orang
    // hanya karena satu kolom tidak terbaca.
    bolehKoreksi: !dicoret && !alasanTolak,
    alasanTolak,
    jejak: jejakKoreksi(e)
  };
}

/**
 * Kalimat "diubah/dihapus oleh siapa" untuk ditempel di bawah keterangannya.
 *
 * Mengembalikan string kosong kalau entrinya belum pernah disentuh — baris
 * yang tidak punya jejak tidak boleh menampilkan tempat kosong yang terbaca
 * seperti data yang hilang.
 */
export function jejakKoreksi(e) {
  const bagian = [];
  if (e?.dicoret_at) {
    const oleh = teks(e.dicoret_oleh);
    const alasan = teks(e.alasan_coret);
    bagian.push(
      `${LABEL_DICORET}${oleh ? ` oleh ${oleh}` : ''} · ${tanggal(e.dicoret_at)}${alasan ? ` — ${alasan}` : ''}`
    );
  }
  // Jejak UBAH tetap ditampilkan walau entrinya sudah dicoret: urutan
  // "diubah lalu dihapus" adalah bagian dari ceritanya, dan membuang yang
  // pertama membuat yang kedua tidak bisa dijelaskan.
  if (e?.diubah_at) {
    const oleh = teks(e.diubah_oleh);
    bagian.push(`Diubah${oleh ? ` oleh ${oleh}` : ''} · ${tanggal(e.diubah_at)}`);
  }
  return bagian.join(' · ');
}

/**
 * Nominal yang IKUT MENGHITUNG saldo. Entri yang dicoret bernilai nol.
 *
 * Dipakai layar untuk menjumlahkan sendiri apa yang sedang tampil. Server sudah
 * menyaringnya di `cash_balances` (0141); ini menjaga supaya total di layar
 * tidak berselisih dengan saldo di kartu atasnya — dua angka yang berbeda di
 * satu halaman selalu terbaca sebagai salah satunya rusak.
 */
export function nominalEfektif(e) {
  if (e?.dicoret_at) return 0;
  const n = Number(e?.amount);
  return Number.isFinite(n) ? n : 0;
}

/** Total masuk & keluar dari sekumpulan baris, mengabaikan yang dicoret. */
export function totalKas(entries) {
  let masuk = 0;
  let keluar = 0;
  let dicoret = 0;
  for (const e of Array.isArray(entries) ? entries : []) {
    if (e?.dicoret_at) {
      dicoret++;
      continue;
    }
    const n = nominalEfektif(e);
    if (n >= 0) masuk += n;
    else keluar += Math.abs(n);
  }
  return { masuk, keluar, net: masuk - keluar, dicoret };
}

const teks = (v) => (v === null || v === undefined ? '' : String(v));

function tanggal(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return teks(ts);
  return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}
