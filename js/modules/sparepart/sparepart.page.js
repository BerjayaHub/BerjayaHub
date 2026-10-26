import { escapeHtml } from '../../core/ui.js';
import { formatRupiah } from '../../core/format.js';
import { listMyOutlets } from '../../core/my-outlets.js';
import { loadingHtml } from '../../core/loading.js';
import { listSpareparts, listHargaOutlet } from './sparepart.service.js';

/**
 * SPAREPART & JASA — Staff App.
 *
 * HANYA MELIHAT. Staff memakai layar ini untuk mencari kode SKU dan menyebut
 * harga ke pelanggan; ia tidak bisa menambah, mengubah, maupun menghapus.
 *
 * ============ KENAPA TIDAK BISA DIUBAH DARI SINI ============
 *
 * Seluruh alasan master ini ada adalah supaya nama dan kode SKU SAMA di semua
 * outlet. Membiarkan tiap outlet menambah barisnya sendiri mengembalikan
 * persis masalah yang mau diselesaikan — dan ia kembali diam-diam: dua SKU
 * mirip di dua outlet tidak memunculkan galat apa pun, cuma dua harga berbeda
 * untuk barang yang sama.
 *
 * RLS-nya pun sudah menolak (0166: `spareparts_modify` menuntut Admin BU),
 * jadi tombol ubah di sini cuma akan menghasilkan penolakan yang membingungkan.
 */
export async function renderSparepartPage(container, { businessUnitId, outletId }) {
  container.innerHTML = loadingHtml('Memuat daftar sparepart…');

  let daftar, hargaOutlet, myOutlets;
  try {
    [daftar, hargaOutlet, myOutlets] = await Promise.all([
      listSpareparts(businessUnitId, { hanyaAktif: true }),
      listHargaOutlet(businessUnitId),
      listMyOutlets(businessUnitId)
    ]);
  } catch (error) {
    container.innerHTML = `<p class="error-text">Gagal memuat: ${error.message ?? error}</p>`;
    return;
  }

  const state = {
    q: '',
    jenis: '',
    outletId: myOutlets.some((o) => o.id === outletId) ? outletId : myOutlets[0]?.id ?? ''
  };

  /** Harga yang berlaku di outlet ini: harga khusus outlet kalau ada, kalau tidak harga BU. */
  function harga(s, sisi) {
    const dasar = sisi === 'beli' ? s.harga_beli : s.harga_jual;
    const k = hargaOutlet.get(s.id)?.get(state.outletId);
    // `??` bukan `||` — harga khusus Rp0 adalah harga.
    return (sisi === 'beli' ? k?.beli : k?.jual) ?? dasar ?? null;
  }

  function tersaring() {
    const q = state.q.trim().toLowerCase();
    // Tanpa kata pencarian, daftarnya TIDAK digambar semuanya.
    //
    // Masternya 1.926 baris. Menggambar seluruhnya membuat HP tersendat
    // berdetik-detik setiap kali layar ini dibuka, dan daftar sepanjang itu
    // juga tidak ada gunanya: staff membuka layar ini untuk mencari SATU
    // barang, bukan untuk membaca semuanya.
    if (!q) return [];
    return daftar
      .filter((s) => {
        if (state.jenis && s.jenis !== state.jenis) return false;
        return `${s.sku} ${s.name} ${s.merek ?? ''} ${s.kategori ?? ''}`.toLowerCase().includes(q);
      })
      .slice(0, 100);
  }

  function gambar() {
    const baris = tersaring();
    const adaKata = state.q.trim() !== '';

    container.innerHTML = `
      <h1>Sparepart &amp; Jasa</h1>
      <p style="margin:0 0 12px;color:var(--color-text-muted);font-size:0.85rem">
        Daftar nama, kode SKU, dan harga. Hanya untuk dilihat — penjualan dan stok ada di Turboly.
      </p>

      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-bottom:12px">
        <div class="field" style="margin:0;flex:1;min-width:200px">
          <label for="sp-q">Cari nama / kode SKU</label>
          <input id="sp-q" type="search" value="${escapeHtml(state.q)}" placeholder="mis. KAMPAS REM atau 555.LTR">
        </div>
        <div class="field" style="margin:0">
          <label for="sp-jenis">Jenis</label>
          <select id="sp-jenis">
            <option value="">Semua</option>
            <option value="sparepart" ${state.jenis === 'sparepart' ? 'selected' : ''}>Sparepart</option>
            <option value="jasa" ${state.jenis === 'jasa' ? 'selected' : ''}>Jasa</option>
          </select>
        </div>
        ${
          myOutlets.length > 1
            ? `<div class="field" style="margin:0">
                 <label for="sp-outlet">Harga outlet</label>
                 <select id="sp-outlet">
                   ${myOutlets.map((o) => `<option value="${o.id}" ${o.id === state.outletId ? 'selected' : ''}>${escapeHtml(o.name)}</option>`).join('')}
                 </select>
               </div>`
            : ''
        }
      </div>

      ${
        !adaKata
          ? `<p style="color:var(--color-text-muted)">Ketik nama atau kode SKU di atas untuk mencari. Ada ${daftar.length} sparepart &amp; jasa terdaftar.</p>`
          : baris.length
            ? `<table class="data-table">
                 <thead><tr><th>SKU</th><th>Nama</th><th>Jenis</th><th>Harga jual</th></tr></thead>
                 <tbody>
                   ${baris
                     .map((s) => {
                       const j = harga(s, 'jual');
                       return `<tr>
                         <td style="font-family:monospace;font-size:0.78rem">${escapeHtml(s.sku)}</td>
                         <td>${escapeHtml(s.name)}${s.merek ? `<br><span style="font-size:0.75rem;color:var(--color-text-muted)">${escapeHtml(s.merek)}</span>` : ''}</td>
                         <td>${s.jenis === 'jasa' ? '<span class="badge badge-pending">Jasa</span>' : 'Sparepart'}</td>
                         <td><strong>${
                           // Harga yang BELUM DIISI ditulis apa adanya, bukan
                           // Rp0. Rp0 di layar yang dipakai menyebut harga ke
                           // pelanggan adalah kesalahan yang langsung jadi uang.
                           j === null ? '<span style="color:var(--color-danger)">belum ada harga</span>' : formatRupiah(j)
                         }</strong></td>
                       </tr>`;
                     })
                     .join('')}
                 </tbody>
               </table>
               ${baris.length === 100 ? '<p style="color:var(--color-text-muted);font-size:0.85rem">Menampilkan 100 hasil pertama — persempit kata pencarianmu.</p>' : ''}`
            : `<p style="color:var(--color-text-muted)">Tidak ada yang cocok dengan "${escapeHtml(state.q)}". Kalau barangnya memang belum terdaftar, minta admin menambahkannya — jangan dikira-kira harganya.</p>`
      }
    `;

    const q = container.querySelector('#sp-q');
    q.addEventListener('input', () => {
      state.q = q.value;
      gambar();
      // Fokus & posisi kursor dikembalikan karena menggambar ulang membuang
      // kotak isiannya — tanpa ini, mengetik huruf kedua sudah tidak mungkin.
      const baru = container.querySelector('#sp-q');
      baru.focus();
      baru.setSelectionRange(baru.value.length, baru.value.length);
    });
    container.querySelector('#sp-jenis').addEventListener('change', (e) => {
      state.jenis = e.target.value;
      gambar();
    });
    container.querySelector('#sp-outlet')?.addEventListener('change', (e) => {
      state.outletId = e.target.value;
      gambar();
    });
  }

  gambar();
}
