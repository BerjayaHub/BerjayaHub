/**
 * SUPPLIER ("Payment To") pada kas keluar — satu aturan, tiga form.
 *
 *   "di staff app form entri untuk cash ledger, wajibkan staff untuk isi
 *    supplier sesuai dengan data supplier yang sudah terdaftar"
 *
 * ============ TIGA FORM YANG HARUS BERBUNYI SAMA ============
 *
 *   Staff App  → Catat Kas Keluar
 *   Staff App  → Ubah entri kas sendiri
 *   Admin      → Ubah entri kas orang lain
 *
 * Ketiganya menulis kolom yang sama dan memberi makan berkas yang sama. Kalau
 * aturannya ditulis tiga kali, yang terjadi bukan galat melainkan celah: satu
 * form mewajibkan, dua form tidak, dan entri yang lolos lewat form yang longgar
 * baru ketahuan berminggu-minggu kemudian sebagai baris tertahan di layar
 * ekspor — dengan alasan yang terlihat datang entah dari mana.
 *
 * ============ WAJIB HANYA KALAU DAFTARNYA ADA ============
 *
 * Bentuk yang sama persis dengan Purpose (`purpose-esb.js`, 0147), dan karena
 * alasan yang sama.
 *
 * "Sesuai dengan data supplier yang sudah terdaftar" tidak bisa dipenuhi kalau
 * belum ada yang terdaftar. BU yang belum mengimpor Master Supplier di Ekspor
 * ESB langkah 3 akan kehilangan SELURUH kemampuan mencatat kas keluar — kasir
 * yang membeli galon jam 9 malam berhadapan dengan form yang menolak apa pun
 * yang ia ketik, dan tidak ada satu pun kalimat di layar itu yang bisa ia
 * kerjakan.
 *
 * Jadi: daftar induknya ada → wajib, dan HANYA dari daftar. Belum ada → kolom
 * ini tidak digambar sama sekali, persis seperti sebelum fitur ini lahir.
 *
 * ============ NILAI LAMA DI LUAR DAFTAR TETAP DITAWARKAN ============
 *
 * Ratusan entri terlanjur tersimpan dengan nama yang diketik sendiri, sebelum
 * daftarnya ada. Kalau dropdown-nya hanya berisi daftar induk, membuka dialog
 * koreksi untuk membetulkan SATU HURUF di keterangan akan menampilkan kolom
 * supplier kosong — dan menyimpannya MENGHAPUS nama yang sudah ada. Itu bug
 * 0119 dalam bentuknya yang keempat.
 *
 * Nilai lamanya ikut ditawarkan, ditandai bahwa ia di luar daftar ESB. Ia tidak
 * menjadi sah karenanya: ekspornya tetap menahannya, dan keterangan di
 * pilihannya mengatakan itu.
 *
 * Satu-satunya impor adalah `normalNama` — aturan pembanding nama yang SAMA
 * dengan yang dipakai ekspornya. Menyalinnya ke sini berarti dua aturan yang
 * cepat atau lambat menyimpang, dan menyimpangnya berbentuk "nama ini sudah
 * benar di layar tapi tertahan di ekspor".
 */

import { normalNama } from '../inventory/cocok-supplier.js';

const teks = (v) => (v === null || v === undefined ? '' : String(v).trim());

export const PESAN_WAJIB = 'Pilih dulu supplier / penerima pembayarannya.';
export const PESAN_DI_LUAR_DAFTAR =
  'Nama itu tidak ada di daftar supplier ESB. Pilih dari daftar — nama yang diketik sendiri ditolak ESB saat diimpor.';
/** Keterangan pada pilihan warisan, supaya terlihat kenapa ia berbeda. */
export const HINT_DI_LUAR_DAFTAR = 'di luar daftar ESB — akan tertahan saat diekspor';

/**
 * BU mana yang daftar suppliernya berlaku untuk entri ini?
 *
 * DARI OUTLETNYA, bukan dari `cash_entries.business_unit_id`.
 *
 * Kolom itu DEPRECATED sejak 0040 (kas ikut USER, bukan BU) dan selalu NULL
 * pada tiap baris yang dibuat sejak itu. Dialog koreksi admin memakainya untuk
 * memuat daftar supplier — jadi daftarnya selalu kosong, jadi kotak
 * suppliernya tidak pernah digambar, jadi tidak ada satu pun jalan mengisi
 * Payment To dari Admin Portal. Tidak ada galat di mana pun; dialognya terbuka
 * lengkap, hanya tanpa kolom yang dicari.
 *
 * Ini kolom yang SAMA yang membuat `kas_untuk_esb` mengembalikan nol baris
 * sebelum 0150. Dua gejala, satu sebab.
 *
 * @param {object} entri baris mutasi kas; `outlets` adalah embed PostgREST.
 * @returns {string|null}
 */
export function buKasEntri(entri) {
  if (!entri) return null;
  return entri.outlets?.business_unit_id ?? entri.business_unit_id ?? null;
}

/**
 * Apakah kolom supplier digambar & diwajibkan?
 *
 * @param {Array} daftarInduk hasil `listEsbMaster(bu, 'supplier')`
 */
export function supplierKasWajib(daftarInduk) {
  return Array.isArray(daftarInduk) && daftarInduk.length > 0;
}

/**
 * Pilihan untuk `<select>`-nya, terurut, dengan nilai lama yang di luar daftar
 * ikut ditawarkan di PALING ATAS.
 *
 * Di atas, bukan di tengah: ia nilai yang sedang terpasang, dan orang yang
 * membuka dialog untuk mengubah hal lain harus melihatnya tanpa mencari.
 *
 * @param {Array} daftarInduk
 * @param {string} [nilaiSekarang]
 */
export function opsiSupplierKas(daftarInduk, nilaiSekarang = '') {
  const induk = Array.isArray(daftarInduk) ? daftarInduk : [];
  const opsi = induk
    .map((m) => ({ value: teks(m?.nama), label: teks(m?.nama), hint: teks(m?.kode) ? `kode ESB ${teks(m.kode)}` : '' }))
    .filter((o) => o.value)
    .sort((a, b) => a.label.localeCompare(b.label, 'id'));

  const lama = teks(nilaiSekarang);
  if (lama && !opsi.some((o) => normalNama(o.value) === normalNama(lama))) {
    opsi.unshift({ value: lama, label: lama, hint: HINT_DI_LUAR_DAFTAR });
  }
  return opsi;
}

/**
 * Periksa isian sebelum dikirim ke database.
 *
 * Pemeriksaan di layar BUKAN penjaga sesungguhnya — `ubah_supplier_kas`
 * menolak yang kosong di database, dan ekspornya menahan yang di luar daftar.
 * Gunanya di sini adalah mengatakannya saat orangnya masih di depan formnya,
 * bukan dua minggu kemudian lewat baris tertahan.
 *
 * ============ `nilaiLama` YANG TIDAK DISENTUH SELALU LOLOS ============
 *
 * Tanpa pengecualian ini, dialog koreksi entri lama menjadi FORM YANG TIDAK
 * BISA DISIMPAN: entri bersupplier "Toko Ani" (diketik sebelum daftar induknya
 * ada) ditolak setiap kali, sehingga membetulkan satu huruf di keterangannya
 * mustahil sampai seseorang menemukan padanan ESB untuk Toko Ani. Yang
 * diperbaiki bukan itu, dan yang menahannya bukan urusan orang yang sedang
 * membetulkan angka.
 *
 * Nilai lamanya tidak jadi sah karenanya — ekspornya tetap menahannya, dan
 * keterangan di pilihannya mengatakan begitu. Yang ditolak di sini adalah
 * nama BARU di luar daftar: itu kesalahan yang sedang dibuat, sekarang, oleh
 * orang yang masih bisa membatalkannya.
 *
 * @param {string} nilai isian sekarang
 * @param {Array} daftarInduk
 * @param {{nilaiLama?: string}} [opsi]
 * @returns {string|null} pesan kalau tidak sah, `null` kalau lolos
 */
export function periksaSupplierKas(nilai, daftarInduk, { nilaiLama = '' } = {}) {
  if (!supplierKasWajib(daftarInduk)) return null;
  const v = teks(nilai);
  if (!v) return PESAN_WAJIB;
  const ada = daftarInduk.some((m) => normalNama(teks(m?.nama)) === normalNama(v));
  if (ada) return null;
  // Dibandingkan lewat `normalNama`, bukan `===`: nilai yang kembali dari
  // dropdown bisa berbeda spasinya dari yang tersimpan, dan beda spasi bukan
  // perubahan yang perlu ditolak.
  const lama = teks(nilaiLama);
  if (lama && normalNama(v) === normalNama(lama)) return null;
  return PESAN_DI_LUAR_DAFTAR;
}
