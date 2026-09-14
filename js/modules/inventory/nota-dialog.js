/**
 * DIALOG RINCIAN NOTA — dipakai layar mana pun yang menampilkan nomor nota.
 *
 * ============ YANG DIMINTA ============
 *
 *   "nomor nota di kolom keterangan saya ingin bisa di klik atau tap dan saat
 *    di klik muncul pop up rincian nota nya dan foto nota"
 *
 * ============ FOTONYA DIMUAT SESUDAH DIALOGNYA TERBUKA ============
 *
 * URL bertanda tangan butuh satu perjalanan ke server. Menunggunya sebelum
 * membuka dialog berarti mengetuk nomor nota TIDAK MENGHASILKAN APA PUN selama
 * satu-dua detik — dan orang akan mengetuknya lagi. Jadi dialognya dibuka
 * lebih dulu dengan tempat foto yang berkata "memuat", lalu diisi.
 *
 * ============ FOTO YANG TIDAK BISA DIBUKA PUNYA SEBAB ============
 *
 * Kebijakan `receipt-photos` (0084) menuntut wewenang di OUTLET notanya, bukan
 * sekadar di BU-nya. Pemegang kas yang kantongnya dibebani staff outlet lain
 * (0120/0126) memang bisa melihat notanya tapi tidak fotonya — keadaan yang
 * sah, dan yang harus DIKATAKAN alih-alih ditampilkan sebagai gambar rusak.
 */

import { infoDialog, escapeHtml, toast } from '../../core/ui.js';
import { itemNota, urlFotoNota } from './nota.service.js';
import { susunRincianNota } from './rincian-nota.js';

const PESAN_FOTO_GAGAL =
  'Foto notanya tidak bisa dibuka dari sini. Izin membuka foto nota mengikuti OUTLET notanya, ' +
  'jadi ini terjadi kalau kamu tidak punya peran di outlet itu — meski notanya sendiri boleh kamu lihat.';

/**
 * Buka dialog rincian satu nota.
 *
 * @param {object} nota baris `goods_receipts` yang sudah diambil pemanggil
 *   (lihat `notaTerkaitEntriKas`). Diminta utuh, bukan cuma id-nya, supaya
 *   dialognya bisa langsung tampil tanpa satu perjalanan tambahan.
 */
export async function bukaDialogNota(nota) {
  if (!nota?.id) return toast('Nota ini tidak ditemukan.', 'warning');

  let items = [];
  let gagalItem = '';
  try {
    items = await itemNota(nota.id);
  } catch (error) {
    // Isinya gagal dimuat TIDAK boleh membatalkan dialognya: kepala notanya —
    // nomor, tanggal, supplier, foto — sudah di tangan dan itu saja sering
    // sudah menjawab pertanyaan orangnya.
    gagalItem = error?.message ?? String(error);
  }

  const r = susunRincianNota({ nota, items });

  await infoDialog({
    title: r.judul,
    bodyHtml: badanDialog(r, gagalItem),
    closeText: 'Tutup',
    onReady: (body) => muatFoto(body, r.photoPath)
  });
}

/** Dipisah supaya bisa dibaca (dan diaudit) tanpa menjalankan dialognya. */
export function badanDialog(r, gagalItem = '') {
  return `
    ${
      r.batal
        ? `<p class="error-text" style="margin-top:0"><strong>Nota ini DIBATALKAN.</strong>${
            r.alasanBatal ? ` ${escapeHtml(r.alasanBatal)}` : ''
          } Barangnya sudah ditarik dari stok.</p>`
        : ''
    }
    ${
      r.info.length
        ? `<dl class="nota-info">
             ${r.info
               .map(
                 (i) => `<dt>${escapeHtml(i.label)}</dt><dd>${escapeHtml(i.value)}</dd>`
               )
               .join('')}
           </dl>`
        : ''
    }
    ${gagalItem ? `<p class="error-text">Isi notanya gagal dimuat: ${escapeHtml(gagalItem)}</p>` : ''}
    <div class="table-scroll" style="margin-top:10px">
      <table class="data-table kartu-sempit">
        <thead><tr>${r.kolom.map((c) => `<th${c.numeric ? ' style="text-align:right"' : ''}>${escapeHtml(c.header)}</th>`).join('')}</tr></thead>
        <tbody>
          ${
            r.rows
              .map(
                (baris) =>
                  `<tr>${baris
                    .map(
                      (sel, i) =>
                        `<td data-label="${escapeHtml(r.kolom[i]?.header ?? '')}"${
                          r.kolom[i]?.numeric ? ' style="text-align:right"' : ''
                        }>${escapeHtml(sel)}</td>`
                    )
                    .join('')}</tr>`
              )
              .join('') || `<tr><td colspan="${r.kolom.length}">Nota ini belum berisi bahan apa pun.</td></tr>`
          }
        </tbody>
        <tfoot><tr><th colspan="${r.kolom.length - 1}">TOTAL (${r.jumlahBaris} bahan)</th><th style="text-align:right">${escapeHtml(
          r.totalTeks
        )}</th></tr></tfoot>
      </table>
    </div>
    ${
      r.tanpaHarga
        ? `<p class="report-note">${r.tanpaHarga} baris belum berharga sehingga ditulis "-" dan tidak ikut total —
             totalnya lebih kecil dari tagihan supplier sampai harganya dilengkapi.</p>`
        : ''
    }
    <div class="nota-foto" data-foto>
      ${r.adaFoto ? '<p class="nota-foto-status">Memuat foto nota…</p>' : '<p class="nota-foto-status">Nota ini belum punya foto.</p>'}
    </div>
  `;
}

async function muatFoto(body, path) {
  const kotak = body?.querySelector('[data-foto]');
  if (!kotak || !path) return;
  let url = null;
  try {
    url = await urlFotoNota(path);
  } catch {
    url = null;
  }
  // Dialognya bisa sudah ditutup selama menunggu. Menulis ke simpul yang sudah
  // lepas dari dokumen tidak melempar error — ia cuma tidak terlihat — jadi
  // tidak ada yang perlu dijaga selain tidak mengasumsikan sebaliknya.
  if (!url) {
    kotak.innerHTML = `<p class="nota-foto-status error-text">${escapeHtml(PESAN_FOTO_GAGAL)}</p>`;
    return;
  }
  kotak.innerHTML = `
    <a href="${escapeHtml(url)}" target="_blank" rel="noopener">
      <img src="${escapeHtml(url)}" alt="Foto nota" loading="lazy" />
    </a>
    <p class="nota-foto-status">Ketuk fotonya untuk membukanya ukuran penuh.</p>
  `;
  const img = kotak.querySelector('img');
  // Tautan bertanda tangan punya masa berlaku. Kalau gambarnya gagal dimuat,
  // yang terlihat tanpa penjaga ini cuma ikon gambar rusak — yang terbaca
  // seperti "notanya tidak ada", bukan "tautannya kedaluwarsa".
  img?.addEventListener('error', () => {
    kotak.innerHTML = `<p class="nota-foto-status error-text">${escapeHtml(PESAN_FOTO_GAGAL)}</p>`;
  });
}
