/**
 * MENCOCOKKAN NAMA SUPPLIER DENGAN DAFTAR ESB.
 *
 * ============ TIGA KEADAAN, DAN KETIGANYA HARUS BISA DIBEDAKAN ============
 *
 *   'daftar'      — namanya ADA di daftar induk ESB. Berangkat apa adanya.
 *   'dipetakan'   — ejaan lama yang sudah dipetakan ke nama ESB. Berangkat
 *                   sebagai nama ESB-nya; teks di notanya tidak disentuh.
 *   'tak-dikenal' — tidak ada di keduanya. Notanya DITAHAN.
 *
 * Yang ketiga itulah sebabnya berkas ini ada. Sebelum ini, nama apa pun
 * berangkat ke sel Supplier — dan ESB menolak berkasnya jauh belakangan, di
 * layar yang berbeda, tanpa menyebut nota mana yang bermasalah.
 *
 * ============ NAMA KANONIK, BUKAN NAMA YANG DIKETIK ============
 *
 * Yang dikirim ke ESB selalu nama dari DAFTARNYA, bukan yang diketik staff.
 * "toko beras ridho" cocok dengan "Toko Beras Ridho" — dan yang berangkat
 * ejaan ESB-nya. Mengirim ejaan yang diketik berarti mengirim nama yang, bagi
 * ESB, bukan nama yang sama.
 *
 * ============ NORMALISASINYA SENGAJA DANGKAL ============
 *
 * Hanya huruf besar-kecil dan spasi berlebih. TIDAK menghapus titik, koma, atau
 * "PT"/"CV" — "PT KIMIA YASA" dan "CV KIMIA YASA" adalah dua badan hukum yang
 * berbeda, dan mencocokkan keduanya akan menaruh pembelian di akun yang salah
 * tanpa satu pun tanda di layar.
 *
 * Tidak ada impor di berkas ini, supaya bisa diuji tanpa browser.
 */

const teks = (v) => (v === null || v === undefined ? '' : String(v));

/**
 * Bentuk nama untuk DIBANDINGKAN — bukan untuk ditampilkan atau dikirim.
 *
 * Spasi ganda ikut dirapikan: "Duta  Buah" yang terketik dari salin-tempel
 * tidak terlihat berbeda di layar mana pun, dan tanpa ini ia jadi supplier
 * yang berbeda selamanya.
 */
export function normalNama(nama) {
  return teks(nama).trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Susun daftar induk supplier jadi peta siap-cari.
 *
 * @param {{jenis: string, nama: string, kode?: string}[]} master baris `esb_master`
 * @returns {Map<string, {nama: string, kode: string}>} kunci sudah dinormalkan
 */
export function petaSupplier(master) {
  const peta = new Map();
  for (const m of Array.isArray(master) ? master : []) {
    if (teks(m?.jenis) !== 'supplier') continue;
    const nama = teks(m?.nama).trim();
    if (!nama) continue;
    const k = normalNama(nama);
    // Yang PERTAMA menang, bukan yang terakhir.
    //
    // Daftar ESB bisa memuat dua baris yang cuma beda huruf besar-kecil. Kalau
    // yang terakhir menang, nama kanoniknya berubah-ubah tergantung urutan
    // datangnya dari database — dan dua unduhan berturut-turut bisa berisi
    // ejaan yang berbeda untuk supplier yang sama.
    if (!peta.has(k)) peta.set(k, { nama, kode: teks(m?.kode).trim() });
  }
  return peta;
}

/** Susun baris `esb_map` berjenis supplier jadi peta ejaan-lama -> nama ESB. */
export function petaEjaanSupplier(baris) {
  const peta = new Map();
  for (const b of Array.isArray(baris) ? baris : []) {
    if (teks(b?.jenis) !== 'supplier') continue;
    const kunci = normalNama(b?.kunci);
    const nilai = teks(b?.nilai).trim();
    if (!kunci || !nilai) continue;
    if (!peta.has(kunci)) peta.set(kunci, nilai);
  }
  return peta;
}

/**
 * Cocokkan satu nama supplier.
 *
 * @param {string} nama yang tertulis di nota
 * @param {Map} master hasil `petaSupplier`
 * @param {Map} [ejaan] hasil `petaEjaanSupplier`
 * @returns {{keadaan: 'kosong'|'daftar'|'dipetakan'|'tak-dikenal', nama: string|null, diketik: string}}
 */
export function cocokkanSupplier(nama, master, ejaan = new Map()) {
  const diketik = teks(nama).trim();
  if (!diketik) return { keadaan: 'kosong', nama: null, diketik: '' };

  const k = normalNama(diketik);

  const diDaftar = master?.get?.(k);
  if (diDaftar) return { keadaan: 'daftar', nama: diDaftar.nama, diketik };

  const dipetakan = ejaan?.get?.(k);
  if (dipetakan) {
    // Pemetaan yang menunjuk nama yang SUDAH TIDAK ADA di daftar induk tidak
    // dianggap sah. ESB bisa menonaktifkan supplier, lalu impor berikutnya
    // menghapusnya dari daftar — sementara pemetaannya tetap tinggal dan terus
    // mengirim nama hantu yang ditolak ESB tanpa ada yang tahu sebabnya.
    const masihAda = master?.get?.(normalNama(dipetakan));
    if (masihAda) return { keadaan: 'dipetakan', nama: masihAda.nama, diketik };
    return { keadaan: 'tak-dikenal', nama: null, diketik };
  }

  return { keadaan: 'tak-dikenal', nama: null, diketik };
}

/** Boleh berangkat ke ESB? */
export function supplierSiap(hasil) {
  return hasil?.keadaan === 'daftar' || hasil?.keadaan === 'dipetakan';
}

/**
 * Keterangan singkat untuk layar staff.
 *
 * Nadanya sengaja tidak menyalahkan: staff yang mengetik nama supplier baru
 * tidak melakukan kesalahan — ia mencatat pembelian yang sungguh terjadi.
 * Yang perlu dikerjakan ada di pihak admin.
 */
export const PESAN_DI_LUAR_DAFTAR =
  'Nama ini belum ada di daftar supplier ESB. Notanya tetap tersimpan — admin BU perlu menambahkannya di ESB ' +
  'lalu mengimpor ulang daftarnya sebelum nota ini bisa diekspor.';

/**
 * Ringkasan untuk layar pemetaan: ejaan mana yang masih perlu dibereskan.
 *
 * @param {{nama: string, jumlah: number, belum_ekspor: number}[]} terpakai hasil `nama_supplier_terpakai`
 * @param {Map} master hasil `petaSupplier`
 * @param {Map} [ejaan] hasil `petaEjaanSupplier`
 */
export function supplierPerluDibereskan(terpakai, master, ejaan = new Map()) {
  return (Array.isArray(terpakai) ? terpakai : [])
    .map((t) => ({ ...t, hasil: cocokkanSupplier(t?.nama, master, ejaan) }))
    .filter((t) => !supplierSiap(t.hasil) && t.hasil.keadaan !== 'kosong')
    .sort(
      (a, b) =>
        // Yang punya nota BELUM DIEKSPOR didahulukan: cuma itu yang benar-benar
        // menghambat. Ejaan yang semua notanya sudah berangkat ke ESB adalah
        // kerapian, bukan penghalang.
        Number(b.belum_ekspor ?? 0) - Number(a.belum_ekspor ?? 0) ||
        Number(b.jumlah ?? 0) - Number(a.jumlah ?? 0) ||
        teks(a.nama).localeCompare(teks(b.nama), 'id')
    );
}
