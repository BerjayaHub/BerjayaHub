import { escapeHtml } from './ui.js';

/**
 * Tampilan "sedang memuat" yang dipakai SELURUH modul.
 *
 * Sebelumnya tiap halaman menulis `<p>Memuat...</p>` sendiri — 77 tempat dengan
 * gaya yang berbeda-beda. Selain tidak enak dilihat, teks polos itu punya
 * masalah nyata: ia tidak bergerak. Layar yang diam tidak bisa dibedakan dari
 * layar yang macet, jadi orang menekan tombolnya lagi (atau menutup aplikasi)
 * justru saat datanya sedang dalam perjalanan.
 *
 * Ada dua bentuk, dan pilihannya bukan soal selera:
 *
 * - **Kerangka (skeleton)** — untuk sesuatu yang akan berubah jadi DAFTAR atau
 *   TABEL. Bentuknya sudah menyerupai hasil akhirnya, jadi tata letak tidak
 *   melompat saat data datang, dan orang bisa mulai membaca posisi kolomnya
 *   sebelum isinya ada.
 * - **Pemutar (spinner)** — untuk halaman penuh atau sesuatu yang bentuk
 *   akhirnya tidak diketahui. Kerangka yang salah bentuk lebih mengganggu
 *   daripada tidak ada kerangka sama sekali.
 *
 * Animasinya otomatis berhenti kalau sistem meminta `prefers-reduced-motion` —
 * lihat `css/styles.css`. Gerakan berulang bisa memicu pusing pada sebagian
 * orang, dan itu bukan harga yang pantas dibayar untuk sekadar terlihat manis.
 */

/**
 * @param {string} pesan  ditampilkan di bawah animasi. Kosongkan kalau tidak perlu.
 * @param {object} [opsi]
 * @param {number} [opsi.baris]  >0 -> kerangka daftar dengan sekian baris.
 * @param {boolean} [opsi.penuh] true -> diberi ruang tinggi, untuk halaman penuh.
 */
export function loadingHtml(pesan = 'Memuat…', { baris = 0, penuh = false } = {}) {
  const teks = pesan ? `<p class="loading-text">${escapeHtml(pesan)}</p>` : '';

  if (baris > 0) {
    // Lebar baris dibuat tidak seragam supaya menyerupai teks sungguhan.
    // Kerangka yang semua barisnya sama panjang terbaca sebagai grafik, bukan
    // sebagai "tulisan yang belum datang".
    const lebar = [92, 78, 85, 70, 88, 74];
    const items = Array.from(
      { length: Math.min(baris, 8) },
      (_, i) => `<div class="skeleton-row" style="width:${lebar[i % lebar.length]}%"></div>`
    ).join('');
    return `<div class="loading-block" role="status" aria-live="polite" aria-busy="true">
      <div class="skeleton-list">${items}</div>${teks}
    </div>`;
  }

  return `<div class="loading-block${penuh ? ' loading-block-full' : ''}" role="status" aria-live="polite" aria-busy="true">
    <span class="loading-spinner" aria-hidden="true"></span>${teks}
  </div>`;
}

/** Kerangka tabel: header + beberapa baris. Untuk area yang akan jadi tabel. */
export function loadingTableHtml(pesan = 'Memuat…', baris = 5) {
  return loadingHtml(pesan, { baris });
}

/**
 * Loading kecil untuk DI DALAM tombol, mis. saat menyiapkan export.
 * Mengembalikan fungsi pemulih supaya pemanggil tidak perlu menyimpan
 * label aslinya sendiri — dan tidak akan lupa mengembalikannya.
 *
 * @returns {() => void} panggil untuk mengembalikan tombol seperti semula
 */
export function tombolSibuk(btn, teks = 'Menyiapkan…') {
  if (!btn) return () => {};
  const html = btn.innerHTML;
  const nonaktif = btn.disabled;
  btn.disabled = true;
  btn.innerHTML = `<span class="loading-spinner loading-spinner-sm" aria-hidden="true"></span> ${escapeHtml(teks)}`;
  return () => {
    btn.innerHTML = html;
    btn.disabled = nonaktif;
  };
}
