/**
 * KETERANGAN KAS JADI HTML — nomor notanya berupa tombol.
 *
 * ============ KENAPA BERKAS SENDIRI ============
 *
 * Fungsi ini ditulis DUA KALI: sekali di `cash.page.js` (Staff App), sekali di
 * `cash.admin.page.js`. Isinya sama persis, termasuk komentarnya. Itu bentuk
 * yang sudah berulang kali menggigit di repo ini — "kalimat filter aktif" yang
 * ditulis di tiga tempat lalu menyimpang bertiga — dan di sini taruhannya lebih
 * besar daripada kalimat yang keliru.
 *
 * Keterangan kas adalah teks yang DIKETIK ORANG. Kalau salah satu salinan lupa
 * meng-escape, ia tidak terlihat rusak sama sekali: baris kasnya tampak wajar
 * sampai ada yang menulis keterangan memuat `<`, dan sejak itu markup orang
 * lain ikut masuk ke tabel admin.
 *
 * ============ ESCAPE SESUDAH PEMECAHAN, BUKAN SEBELUMNYA ============
 *
 * Kalau teksnya di-escape lebih dulu, kode nota yang memuat `&` atau `<` tidak
 * akan pernah cocok dengan kode aslinya, dan tombolnya tidak pernah terbentuk.
 */
import { escapeHtml } from '../../core/ui.js';
import { pecahKeterangan } from './keterangan-nota.js';

/**
 * @param {string} ket teks apa adanya dari `cash_entries.notes`
 * @param {{id: string, code: string}[]} notas nota yang terkait entri itu
 * @returns {string} HTML siap tempel — SUDAH ter-escape seluruhnya
 */
export function ketNotaHtml(ket, notas) {
  const { bagian, tambahan } = pecahKeterangan(ket, notas ?? []);

  const tombol = (t) =>
    `<button type="button" class="btn-nota" data-id="${escapeHtml(t.notaId)}">${escapeHtml(t.teks)}</button>`;

  const utama = bagian.map((b) => (b.notaId ? tombol(b) : escapeHtml(b.teks))).join('');

  // Nota yang kodenya tidak tertulis di keterangan tetap ditawarkan, supaya
  // tidak ada nota yang mustahil dibuka hanya karena kalimatnya tidak
  // menyebutnya.
  const ekor = tambahan.length ? `<div class="kas-nota-ekor">Nota: ${tambahan.map(tombol).join(' ')}</div>` : '';

  return (utama || escapeHtml(ket ?? '-')) + ekor;
}
