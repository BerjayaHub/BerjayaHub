/**
 * APA YANG BERLAKU UNTUK SEBUAH TIPE BU — dan apa yang tidak.
 *
 * Murni: tidak menyentuh DOM, tidak menyentuh Supabase.
 *
 * ============ KENAPA INI ADA ============
 *
 * "Peran Outlet" (Standalone / Central Kitchen / Dilayani CK) dan "Mode
 * Reservasi" (Cafe / Hotel) adalah gagasan dapur. Di bengkel keduanya tidak
 * berarti apa-apa: tidak ada dapur pusat yang mengirim sparepart matang, dan
 * tidak ada meja yang dipesan.
 *
 * Menampilkannya tetap bukan sekadar berantakan — ia MENUNTUT jawaban. Form
 * yang mewajibkan "Peran Outlet" memaksa orang memilih salah satu, dan pilihan
 * itu lalu dibaca sungguhan oleh modul Pengiriman dan laporan Laba Rugi.
 * Outlet bengkel yang terlanjur dicap "Central Kitchen" akan muncul sebagai
 * sumber kiriman di layar yang tidak ada hubungannya dengan bengkel.
 */

/**
 * Tipe yang TIDAK memakai gagasan dapur pusat & reservasi.
 *
 * Daftar LARANGAN, bukan daftar izin — jadi tipe baru yang ditambahkan ke
 * `BU_TYPE_OPTIONS` tanpa menyentuh berkas ini tetap melihat isiannya.
 *
 * 'armada' SENGAJA tidak ada di sini walaupun peran dapur sama tak berartinya
 * di sana. Menyembunyikannya adalah perubahan perilaku yang tidak diminta
 * siapa pun, dan BU armada yang sudah berjalan mungkin memakai `outlet_role`
 * untuk sesuatu yang tidak saya ketahui. Kalau memang perlu, tambahkan di sini
 * dengan sengaja.
 */
const TIPE_TANPA_DAPUR = ['workshop'];

/**
 * Isian mana yang ditampilkan di dialog Outlet untuk tipe BU tertentu.
 *
 * @param {string} tipeBu nilai `business_units.type`
 * @returns {{peranOutlet: boolean, modeReservasi: boolean, bolehJual: boolean}}
 */
export function isianOutlet(tipeBu) {
  const t = String(tipeBu ?? '').trim().toLowerCase();

  // Tipe yang TIDAK dikenal diperlakukan seperti cafe — isiannya tampil.
  //
  // Arah default ini dipilih dengan sadar: menyembunyikan isian dari tipe baru
  // yang belum sempat didaftarkan di sini akan membuat setelan yang sudah ada
  // tidak bisa diubah lagi dari layar mana pun, dan tidak ada galat yang
  // memberi tahu. Menampilkan isian yang tidak perlu cuma berisik.
  const berdapur = !TIPE_TANPA_DAPUR.includes(t);

  return {
    peranOutlet: berdapur,
    modeReservasi: berdapur,
    // "Bisa melakukan penjualan" berlaku di SEMUA tipe — bengkel pun punya
    // outlet yang tidak menerima penjualan (gudang, kantor).
    bolehJual: true
  };
}

/**
 * Lengkapi nilai dari dialog dengan setelan yang isiannya TIDAK ditampilkan.
 *
 * ============ KENAPA HARUS DILENGKAPI, BUKAN DIBIARKAN KOSONG ============
 *
 * `updateOutlet` menulis `outlet_role` apa adanya. Kalau isiannya disembunyikan
 * dan nilainya tidak dilengkapi, yang terkirim `undefined`.
 *
 * Hari ini itu kebetulan tidak merusak apa-apa: `JSON.stringify` membuang
 * kunci bernilai `undefined`, jadi kolomnya tidak ikut ditulis. Tapi itu
 * kebetulan, bukan jaminan — satu `?? null` yang ditambahkan nanti di
 * `organization.service.js` akan mengubahnya jadi `outlet_role: null` untuk
 * SETIAP outlet bengkel yang pernah dibuka dan disimpan, tanpa galat, dan
 * tanpa ada yang menyadarinya sampai modul Pengiriman mulai berperilaku aneh.
 *
 * Jadi nilainya dilengkapi di sini, terang-terangan.
 *
 * @param {object} o
 * @param {object} o.nilai hasil dari dialog
 * @param {string} o.tipeBu
 * @param {object|null} [o.sebelumnya] outlet yang sedang diubah (null = baru)
 */
export function lengkapiNilaiOutlet({ nilai, tipeBu, sebelumnya = null } = {}) {
  const tampil = isianOutlet(tipeBu);
  const hasil = { ...(nilai ?? {}) };

  if (!tampil.peranOutlet) {
    // Outlet bengkel berdiri sendiri. Yang sudah punya peran lain — misalnya
    // tersisa dari saat BU-nya masih bertipe cafe — DIBIARKAN apa adanya:
    // menormalkannya diam-diam akan memutus kiriman yang sedang berjalan.
    hasil.outlet_role = sebelumnya?.outlet_role ?? 'standalone';
    hasil.served_by_outlet_id = sebelumnya?.served_by_outlet_id ?? '';
  }

  if (!tampil.modeReservasi) {
    hasil.reservation_mode = sebelumnya?.reservation_mode ?? 'cafe';
  }

  return hasil;
}
