/**
 * Panel "Bahan Menipis" di Staff App.
 *
 * DIPAKAI SAMBIL BERDIRI DI GUDANG, jadi bentuknya kartu di layar sempit
 * (`kartu-sempit`) dan yang mendesak selalu di atas. Yang aman tetap bisa
 * dilihat, tapi harus ditekan dulu — daftar yang dibuka untuk tahu "apa yang
 * harus dibeli" tidak boleh dimulai dengan puluhan baris yang tidak perlu
 * dibeli.
 *
 * TIDAK ADA RUPIAH DI SINI, sama seperti layar resep staff.
 */

import { toast, shareDialog } from '../../core/ui.js';
import { formatNum } from '../../core/format.js';
import { loadingHtml } from '../../core/loading.js';
import { todayWIB } from '../../core/dates.js';
import { susunBahanMenipis, teksBelanja } from './bahan-menipis.js';
import { batasManual, porsiMinimumOutlet } from './batas-bahan.service.js';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const LENCANA = {
  habis: '<span class="badge" style="background:#fdecea;color:#b3261e">HABIS</span>',
  menipis: '<span class="badge badge-pending">Menipis</span>',
  aman: '<span class="badge badge-approved">Aman</span>'
};

/**
 * @param {HTMLElement} wadah
 * @param {object} o
 * @param {string} o.outletId
 * @param {string} o.outletName
 * @param {object[]} o.products SELURUH produk (menu ikut — dipakai membentang resep)
 * @param {object[]} o.recipes
 * @param {Map} o.stok productId → jumlah
 */
export async function renderMenipisStaff(wadah, { outletId, outletName, products, recipes, stok }) {
  wadah.innerHTML = `<div class="inline-card fade-in">${loadingHtml('Menghitung…', { baris: 3 })}</div>`;

  let manual, minPorsi;
  try {
    [manual, minPorsi] = await Promise.all([
      batasManual(outletId).catch(() => new Map()),
      porsiMinimumOutlet(outletId).catch(() => 30)
    ]);
  } catch (e) {
    wadah.innerHTML = `<div class="inline-card"><p class="error-text">${esc(e.message ?? e)}</p></div>`;
    return;
  }

  const lap = susunBahanMenipis({ products, recipes, stok, minPorsi, batasManual: manual });

  const baris = (r) => `
    <tr>
      <td data-label="Bahan"><strong>${esc(r.nama)}</strong>${
        r.batasManual ? ' <span style="font-size:0.72rem;color:var(--color-text-muted)">(batas manual)</span>' : ''
      }</td>
      <td data-label="Status">${LENCANA[r.status]}</td>
      <td data-label="Stok">${formatNum(r.stok)} ${esc(r.satuan)}</td>
      <td data-label="Cukup">${r.porsi == null ? '-' : `${formatNum(r.porsi)} porsi`}</td>
      <td data-label="Batas">${formatNum(r.batas)} ${esc(r.satuan)}</td>
      <td data-label="Saran beli">${r.saranBeli > 0 ? `<strong>${formatNum(r.saranBeli)} ${esc(r.satuan)}</strong>` : '-'}</td>
    </tr>`;

  const tabel = (rows) => `
    <div class="table-scroll"><table class="data-table kartu-sempit">
      <thead><tr><th>Bahan</th><th>Status</th><th>Stok</th><th>Cukup</th><th>Batas</th><th>Saran beli</th></tr></thead>
      <tbody>${rows.map(baris).join('')}</tbody>
    </table></div>`;

  wadah.innerHTML = `
    <div class="inline-card fade-in" style="max-width:100%">
      <div class="page-header" style="margin-bottom:6px">
        <h3 style="margin:0;font-size:1rem">Bahan Menipis</h3>
        <button id="mnp-tutup">Tutup</button>
      </div>
      <p style="font-size:0.8rem;color:var(--color-text-muted);margin:0 0 10px">
        Stok dibagi takaran resep = <strong>cukup berapa porsi lagi</strong>.
        Target di outlet ini: stok harus cukup untuk <strong>${lap.minPorsi} porsi</strong> (diatur admin).
      </p>

      ${
        lap.perlu.length
          ? `<p style="margin:0 0 6px;font-size:0.88rem">
               <strong style="color:var(--color-danger)">${lap.jumlahHabis} habis</strong> ·
               <strong>${lap.jumlahMenipis} menipis</strong>
             </p>
             ${tabel(lap.perlu)}`
          : `<p style="margin:0 0 10px">Tidak ada bahan yang menipis. 👍</p>`
      }

      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
        <button class="primary" id="mnp-wa" style="max-width:260px">💬 Kirim daftar belanja</button>
      </div>

      ${
        lap.jumlahAman
          ? `<details style="margin-top:12px">
               <summary style="cursor:pointer;font-size:0.88rem">Lihat ${lap.jumlahAman} bahan yang masih aman</summary>
               <div style="margin-top:8px">${tabel(lap.baris.filter((r) => r.status === 'aman'))}</div>
             </details>`
          : ''
      }

      ${
        // Bahan yang tidak dipakai resep mana pun (gas, tisu, sedotan) tidak
        // punya angka porsi, jadi tidak bisa dihitung. Jumlahnya tetap disebut
        // supaya tidak hilang tanpa jejak — dan jalan keluarnya ditulis di sini
        // juga, bukan cuma di dokumen.
        lap.tersembunyi
          ? `<p style="margin-top:12px;font-size:0.8rem;color:var(--color-text-muted)">
               ${lap.tersembunyi} bahan tidak dipakai resep mana pun (mis. gas, tisu, kemasan), jadi tidak bisa dihitung per porsi.
               Minta admin memberinya <strong>batas manual</strong> kalau tetap perlu diawasi.
             </p>`
          : ''
      }
    </div>`;

  wadah.querySelector('#mnp-tutup').addEventListener('click', () => {
    wadah.innerHTML = '';
    wadah.setAttribute('hidden', '');
  });

  // TOMBOL KIRIM SELALU ADA, termasuk saat tidak ada yang menipis.
  //
  // Versi sebelumnya menaruhnya di dalam cabang "ada yang perlu dibeli", jadi
  // tombolnya lenyap persis ketika daftarnya kosong. Dari sisi staff itu
  // terbaca seperti fiturnya tidak ada — dan mengabarkan "semua aman" ke grup
  // juga kabar yang berguna.
  wadah.querySelector('#mnp-wa').addEventListener('click', () => {
    shareDialog({
      title: 'Kirim Daftar Belanja',
      helper: 'Teksnya bisa diedit dulu sebelum dikirim lewat WhatsApp atau disalin.',
      defaultMessage: teksBelanja(lap, { outlet: outletName, tanggal: todayWIB() })
    });
    toast('Periksa dulu isinya sebelum dikirim.', 'info');
  });
}
