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
import { penjualanRentang, batasManual, hariAmanOutlet, HARI_RIWAYAT } from './batas-bahan.service.js';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const LENCANA = {
  habis: '<span class="badge" style="background:#fdecea;color:#b3261e">HABIS</span>',
  menipis: '<span class="badge badge-pending">Menipis</span>',
  aman: '<span class="badge badge-approved">Aman</span>'
};

/** Mundur N hari dari 'YYYY-MM-DD' — dipakai menentukan awal rentang riwayat. */
function mundurHari(tgl, n) {
  const d = new Date(`${tgl}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

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
  wadah.innerHTML = `<div class="inline-card fade-in">${loadingHtml('Menghitung pemakaian…', { baris: 3 })}</div>`;

  const sampai = todayWIB();
  const dari = mundurHari(sampai, HARI_RIWAYAT - 1);

  let sales, manual, hariAman;
  try {
    [sales, manual, hariAman] = await Promise.all([
      penjualanRentang(outletId, dari, sampai),
      batasManual(outletId).catch(() => new Map()),
      hariAmanOutlet(outletId).catch(() => 7)
    ]);
  } catch (e) {
    wadah.innerHTML = `<div class="inline-card"><p class="error-text">${esc(e.message ?? e)}</p></div>`;
    return;
  }

  const lap = susunBahanMenipis({ products, recipes, sales, hari: HARI_RIWAYAT, stok, hariAman, batasManual: manual });

  const baris = (r) => `
    <tr>
      <td data-label="Bahan"><strong>${esc(r.nama)}</strong>${
        r.batasManual ? ' <span style="font-size:0.72rem;color:var(--color-text-muted)">(batas manual)</span>' : ''
      }</td>
      <td data-label="Status">${LENCANA[r.status]}</td>
      <td data-label="Stok">${formatNum(r.stok)} ${esc(r.satuan)}</td>
      <td data-label="Pakai/hari">${formatNum(r.perHari)} ${esc(r.satuan)}</td>
      <td data-label="Cukup">${r.cukupHari == null ? '-' : `${formatNum(r.cukupHari)} hari`}</td>
      <td data-label="Batas">${formatNum(r.batas)} ${esc(r.satuan)}</td>
      <td data-label="Saran beli">${r.saranBeli > 0 ? `<strong>${formatNum(r.saranBeli)} ${esc(r.satuan)}</strong>` : '-'}</td>
    </tr>`;

  const tabel = (rows) => `
    <div class="table-scroll"><table class="data-table kartu-sempit">
      <thead><tr><th>Bahan</th><th>Status</th><th>Stok</th><th>Pakai/hari</th><th>Cukup</th><th>Batas</th><th>Saran beli</th></tr></thead>
      <tbody>${rows.map(baris).join('')}</tbody>
    </table></div>`;

  wadah.innerHTML = `
    <div class="inline-card fade-in" style="max-width:100%">
      <div class="page-header" style="margin-bottom:6px">
        <h3 style="margin:0;font-size:1rem">Bahan Menipis</h3>
        <button id="mnp-tutup">Tutup</button>
      </div>
      <p style="font-size:0.8rem;color:var(--color-text-muted);margin:0 0 10px">
        Pemakaian dihitung dari penjualan <strong>${HARI_RIWAYAT} hari terakhir</strong> dikalikan resep.
        Target stok cukup <strong>${lap.hariAman} hari</strong> (diatur admin per outlet).
      </p>

      ${
        lap.perlu.length
          ? `<p style="margin:0 0 6px;font-size:0.88rem">
               <strong style="color:var(--color-danger)">${lap.jumlahHabis} habis</strong> ·
               <strong>${lap.jumlahMenipis} menipis</strong>
             </p>
             ${tabel(lap.perlu)}
             <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
               <button class="primary" id="mnp-wa" style="max-width:240px">💬 Kirim daftar belanja</button>
             </div>`
          : `<p style="margin:0 0 10px">Tidak ada bahan yang menipis. 👍</p>`
      }

      ${
        lap.jumlahAman
          ? `<details style="margin-top:12px">
               <summary style="cursor:pointer;font-size:0.88rem">Lihat ${lap.jumlahAman} bahan yang masih aman</summary>
               <div style="margin-top:8px">${tabel(lap.baris.filter((r) => r.status === 'aman'))}</div>
             </details>`
          : ''
      }

      ${
        // KEJUJURAN YANG DIMINTA MUNCUL DI SINI.
        //
        // Bahan tanpa riwayat pemakaian sengaja tidak masuk daftar (itu yang
        // diminta), tapi jumlahnya tetap disebut. Kalau dihilangkan sama
        // sekali, bahan menu baru yang habis tidak akan terlihat di mana pun —
        // dan tidak ada apa pun di layar yang memberi tahu bahwa ada yang
        // tidak dihitung.
        lap.tersembunyi
          ? `<p style="margin-top:12px;font-size:0.8rem;color:var(--color-text-muted)">
               ${lap.tersembunyi} bahan belum pernah terpakai dalam ${HARI_RIWAYAT} hari terakhir, jadi belum bisa dihitung dan tidak ditampilkan.
               Minta admin memberi <strong>batas manual</strong> kalau bahan itu tetap perlu diawasi.
             </p>`
          : ''
      }
    </div>`;

  wadah.querySelector('#mnp-tutup').addEventListener('click', () => {
    wadah.innerHTML = '';
    wadah.setAttribute('hidden', '');
  });

  wadah.querySelector('#mnp-wa')?.addEventListener('click', () => {
    shareDialog({
      title: 'Kirim Daftar Belanja',
      helper: 'Teksnya bisa diedit dulu sebelum dikirim.',
      defaultMessage: teksBelanja(lap, { outlet: outletName, tanggal: sampai })
    });
    toast('Periksa dulu isinya sebelum dikirim.', 'info');
  });
}
