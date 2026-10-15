/**
 * KESIAPAN EKSPOR ESB — satu vonis untuk seluruh jenis kode.
 *
 *   "di ekspor esb saya ingin semua kode yang terdaftar di berjaya hub, seperti
 *    supplier, item, dll dicocokan dengan import dari esb jika belum cocok
 *    berikan peringatan"
 *
 * ============ ANGKANYA SUDAH ADA, YANG TIDAK ADA SATU TEMPAT ============
 *
 * Tiap kelompok pemetaan sudah memakai lencana "8 belum dipetakan" sejak 0141.
 * Yang belum ada adalah JUMLAH SELURUHNYA, di tempat yang terbaca sebelum
 * orangnya menekan Unduh.
 *
 * Bedanya bukan kosmetik. Kelompok-kelompok itu `<details>` yang tertutup, dan
 * tujuh di antaranya. Orang yang membuka layar ini untuk mengunduh berkas
 * bulanan tidak membuka tujuh kelompok satu per satu untuk memastikan semuanya
 * hijau — ia menekan Unduh, lalu menemukan barisnya tertahan, lalu kembali ke
 * sini mencari sebabnya. Banner ini memindahkan penemuan itu ke awal.
 *
 * ============ DIHITUNG SEKALI, DIPAKAI DUA KALI ============
 *
 * Berkas ini TIDAK menghitung sendiri mana yang belum dipetakan. Ia menerima
 * hitungan yang SAMA dengan yang dipakai lencana tiap kelompok.
 *
 * Kalau ia menghitung ulang, cepat atau lambat kedua hitungan itu menyimpang —
 * dan menyimpangnya berbentuk banner yang berkata "semua sudah cocok" di atas
 * kelompok yang lencananya merah. Dari dua angka yang bertentangan di satu
 * layar, orang akan berhenti mempercayai keduanya.
 *
 * ============ DUA SEBAB YANG BERBEDA, DUA PEKERJAAN YANG BERBEDA ============
 *
 *   daftar induknya BELUM DIIMPOR  -> tidak ada yang bisa dipilih sama sekali.
 *                                     Pekerjaannya: impor berkas ESB di
 *                                     langkah 3.
 *   induknya ada, padanannya kosong-> pekerjaannya: pilih padanannya satu per
 *                                     satu di langkah 5.
 *
 * Melebur keduanya jadi "12 belum cocok" menyuruh orang mengerjakan hal yang
 * tidak bisa dikerjakan: memilih padanan dari daftar kosong. Itu kalimat yang
 * terlihat benar dan tidak bisa ditindaklanjuti — bentuk kegagalan yang paling
 * sering muncul di layar ini.
 *
 * Tidak ada impor di berkas ini, supaya bisa diuji tanpa browser.
 */

const angka = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};
const teks = (v) => (v === null || v === undefined ? '' : String(v).trim());

/** Sebab sebuah jenis belum siap. */
export const SEBAB = {
  /** Daftar induk ESB-nya belum pernah diimpor. */
  TANPA_INDUK: 'tanpa-induk',
  /** Induknya ada, tapi sebagian padanannya belum dipilih. */
  BELUM_COCOK: 'belum-cocok'
};

/**
 * Susun vonis seluruh jenis.
 *
 * @param {Array<{jenis: string, label: string, belum: number, total: number, adaInduk: boolean}>} hitungan
 *        Satu baris per jenis, angkanya DARI pemanggil — lihat alasannya di
 *        kepala berkas.
 */
export function ringkasKesiapan(hitungan) {
  const baris = [];
  let belum = 0;
  let total = 0;

  for (const h of Array.isArray(hitungan) ? hitungan : []) {
    const jenis = teks(h?.jenis);
    if (!jenis) continue;
    const b = angka(h?.belum);
    total += angka(h?.total);
    if (!b) continue;
    belum += b;
    baris.push({
      jenis,
      label: teks(h?.label) || jenis,
      belum: b,
      // `adaInduk === false` HARUS eksplisit. `undefined` berarti pemanggil
      // tidak memberi tahu — dan menebaknya sebagai "tidak ada induk" akan
      // menyuruh orang mengimpor daftar yang sudah ia impor.
      sebab: h?.adaInduk === false ? SEBAB.TANPA_INDUK : SEBAB.BELUM_COCOK
    });
  }

  // Yang BUTUH IMPOR di atas: ia menghalangi pekerjaan yang di bawahnya.
  // Memilih padanan mustahil selama daftarnya kosong, jadi menaruhnya
  // berurutan menurut jumlah saja akan menempatkan pekerjaan yang terkunci di
  // atas pekerjaan yang bisa langsung dikerjakan.
  baris.sort((a, b) => {
    if (a.sebab !== b.sebab) return a.sebab === SEBAB.TANPA_INDUK ? -1 : 1;
    return b.belum - a.belum || a.label.localeCompare(b.label, 'id');
  });

  return { siap: belum === 0, belum, total, baris };
}

/**
 * Kalimat vonisnya.
 *
 * Menyebut PEKERJAANNYA, bukan sekadar angkanya. "12 belum cocok" tidak
 * memberitahu siapa pun apa yang harus dilakukan berikutnya.
 */
export function pesanKesiapan(ringkas) {
  if (!ringkas || ringkas.siap) {
    // Kalimat keadaan-normal sengaja pendek. Yang panjang di keadaan yang
    // tidak menuntut apa-apa akan berhenti dibaca dalam hitungan hari, dan
    // bersamanya kalimat yang menuntut sesuatu ikut tidak terbaca.
    return 'Semua kode sudah cocok dengan daftar ESB.';
  }
  const tanpaInduk = ringkas.baris.filter((b) => b.sebab === SEBAB.TANPA_INDUK);
  const belumCocok = ringkas.baris.filter((b) => b.sebab === SEBAB.BELUM_COCOK);
  const bagian = [];
  if (tanpaInduk.length) {
    bagian.push(
      `daftar induk ${tanpaInduk.map((b) => b.label).join(', ')} belum diimpor — impor dulu berkas ESB-nya di langkah 3`
    );
  }
  if (belumCocok.length) {
    bagian.push(
      `${belumCocok.reduce((t, b) => t + b.belum, 0)} kode belum dipilih padanannya (${belumCocok
        .map((b) => `${b.label} ${b.belum}`)
        .join(', ')}) — lengkapi di langkah 5`
    );
  }
  return `${bagian.join('; ')}.`;
}

/**
 * Kalimat akibatnya, untuk ditaruh di bawah pesannya.
 *
 * Disebut terus terang bahwa ekspornya TIDAK dihalangi, dan apa yang terjadi
 * kalau diteruskan. Peringatan yang tidak menyebutkan akibatnya akan dibaca
 * sebagai larangan — lalu orang yang sebenarnya boleh meneruskan berhenti, dan
 * orang yang sudah terbiasa mengabaikannya tidak membacanya lagi.
 */
export function akibatKesiapan(ringkas) {
  if (!ringkas || ringkas.siap) return '';
  return (
    'Unduhan tidak dihalangi: baris yang memakai kode ini memang sudah tertahan sendiri saat diekspor, ' +
    'dan baris lainnya tetap ikut. Melengkapinya sekarang membuat yang tertahan itu ikut di unduhan berikutnya.'
  );
}
