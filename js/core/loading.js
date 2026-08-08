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

/**
 * Bungkus handler klik ASINKRON supaya tombolnya terkunci selama proses.
 *
 * KENAPA PERLU: di jaringan lambat, tombol yang ditekan tidak memberi tanda apa
 * pun. Orang menekannya lagi — refleks yang sepenuhnya wajar. Untuk tombol
 * "Kirim", itu berarti DUA transaksi kas, atau dua baris presensi. Kerugiannya
 * bukan tampilan, melainkan data yang salah dan sulit ditelusuri kemudian.
 *
 * Tombolnya dikembalikan seperti semula di `finally` — termasuk saat handler
 * melempar error. Tombol yang mati permanen setelah satu kegagalan jaringan
 * memaksa orang memuat ulang halaman, dan itu justru kehilangan yang lebih
 * besar daripada masalah yang sedang dicegah.
 *
 * Kalau tombolnya sudah hilang dari layar (halaman digambar ulang setelah
 * sukses), tidak ada yang perlu dikembalikan — dan itu bukan kesalahan.
 *
 * @param {(e: Event) => Promise<void>} handler
 * @param {{teks?: string}} [opsi] teks sementara selama proses berjalan
 */
export function sekaliJalan(handler, { teks, jagaGulir = true } = {}) {
  return async function (e) {
    const btn = e.currentTarget instanceof HTMLButtonElement ? e.currentTarget : null;
    if (btn?.disabled) return; // ketukan kedua saat proses pertama masih jalan
    const pulih = btn ? (teks ? tombolSibuk(btn, teks) : ((btn.disabled = true), () => (btn.disabled = false))) : () => {};
    const gulirAwal = window.scrollY;
    try {
      await handler.call(this, e);
    } finally {
      pulih();
      // Posisi gulir dikembalikan. Hampir semua aksi ini diakhiri dengan
      // menggambar ulang seluruh daftar, dan menggambar ulang melempar layar
      // kembali ke atas. Untuk admin yang sedang menyunting baris ke-40 di
      // Rekap Presensi, itu berarti menggulir turun lagi setiap kali menyimpan
      // satu koreksi — friksi kecil yang berulang puluhan kali.
      if (jagaGulir && gulirAwal > 100) pulihkanGulir(gulirAwal);
    }
  };
}

/**
 * Kembalikan posisi gulir SETELAH DOM-nya selesai digambar.
 *
 * Dua frame, bukan satu: frame pertama biasanya baru menyisipkan HTML-nya,
 * tingginya belum final. Memulihkan terlalu cepat menghasilkan lompatan yang
 * justru lebih mengganggu daripada tidak dipulihkan sama sekali.
 *
 * Dijepit ke tinggi halaman yang BARU. Kalau daftarnya memendek (mis. satu
 * baris dihapus), memaksa posisi lama akan menampilkan ruang kosong di bawah.
 */
function pulihkanGulir(y) {
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const maks = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      window.scrollTo({ top: Math.min(y, maks), behavior: 'auto' });
    })
  );
}
