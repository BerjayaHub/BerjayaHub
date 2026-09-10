/**
 * Menyambungkan kotak pencarian ke baris-baris sebuah tabel/daftar.
 *
 * Aturannya cuma satu, dan seluruh berkas ini ada demi menegakkannya:
 *
 *     MENYEMBUNYIKAN, BUKAN MENGGAMBAR ULANG.
 *
 * Baris di layar-layar ini memuat kotak isian yang sudah diketik orang —
 * jumlah kirim, jumlah terima, keterangan. Menggambar ulang tabelnya berisi
 * baris yang cocok saja akan:
 *
 *   1. menghapus angka yang sudah diketik untuk baris lain, dan
 *   2. membuat baris yang tidak terlihat TIDAK IKUT TERKIRIM ke server —
 *      karena `querySelectorAll` hanya menemukan yang ada di DOM.
 *
 * Akibat kedua itu persis kegagalan yang baru saja diperbaiki 0132: barang
 * yang lenyap dari surat jalan tanpa satu pun error. Menyaring dengan
 * menggambar ulang akan menghidupkannya kembali lewat pintu yang berbeda.
 *
 * Jadi barisnya tetap ada di DOM selamanya; yang berubah cuma `hidden`.
 */

import { cocokKata, ringkasSaringan } from './saring-baris.js';

/**
 * @param {HTMLInputElement} kotak input pencariannya
 * @param {HTMLElement[]|NodeListOf<HTMLElement>} baris baris yang bisa disembunyikan
 * @param {HTMLElement} [info] tempat menulis "2 dari 30 bahan"
 * @param {(el: HTMLElement) => string} [nama] cara membaca nama dari sebuah baris
 */
export function saringTabel(kotak, baris, info, nama = (el) => el.dataset.nama ?? el.textContent ?? '') {
  if (!kotak) return;
  const daftar = [...(baris ?? [])];
  const total = daftar.length;

  const jalankan = () => {
    const kata = kotak.value;
    let tampil = 0;
    for (const el of daftar) {
      const cocok = cocokKata(nama(el), kata);
      // `hidden`, bukan `remove()`. Lihat catatan panjang di kepala berkas.
      el.hidden = !cocok;
      if (cocok) tampil += 1;
    }
    if (info) info.textContent = ringkasSaringan(total, tampil, kata);
  };

  kotak.addEventListener('input', jalankan);
  jalankan();
}
