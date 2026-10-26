import { toast } from '../../core/ui.js';
import { formatRupiah, attachRupiahInput, bacaRupiah } from '../../core/format.js';
import { listMyOutlets } from '../../core/my-outlets.js';
import { loadingHtml, sekaliJalan } from '../../core/loading.js';
import { supabase } from '../../config/supabase-client.js';
import { omzetHari, simpanOmzetHari, omzetRentang, todayWIB } from './sparepart.service.js';

/**
 * PENJUALAN BENGKEL — Staff App.
 *
 * Bengkel tidak melaporkan barang. Staff melaporkan DUA nominal untuk hari
 * ini: berapa rupiah Sparepart yang terjual, dan berapa rupiah Jasa. Tidak ada
 * stok, tidak ada baris barang, tidak ada resep.
 *
 * ============ KENAPA MENIMPA, BUKAN MENAMBAH ============
 *
 * Satu outlet punya SATU baris per tanggal, dan Simpan menimpanya. Layar yang
 * menambah baris baru tiap kali Simpan ditekan akan menghitung omzet dua kali
 * begitu staff menekannya dua kali — atau begitu dua staff di satu outlet
 * sama-sama melapor di sore hari. Dua-duanya normal terjadi, keduanya tidak
 * memunculkan galat, dan laporannya tetap tercetak rapi.
 *
 * Karena itu layar ini selalu MEMUAT dulu angka yang sudah ada hari itu dan
 * menampilkannya di kotak isian — supaya yang menimpa tahu persis apa yang
 * sedang ditimpanya.
 */
export async function renderPenjualanBengkelPage(container, { businessUnitId, outletId }) {
  container.innerHTML = loadingHtml('Memuat penjualan bengkel…');

  let myOutlets;
  try {
    myOutlets = (await listMyOutlets(businessUnitId)).filter((o) => o.allow_sales !== false);
  } catch (error) {
    container.innerHTML = `<p class="error-text">Gagal memuat: ${error.message ?? error}</p>`;
    return;
  }
  if (!myOutlets.length) {
    container.innerHTML = `<h1>Penjualan Bengkel</h1><p style="color:var(--color-text-muted)">Penjualan belum diaktifkan untuk outletmu. (Diatur admin di Master BU &amp; Outlet.)</p>`;
    return;
  }

  const {
    data: { user }
  } = await supabase.auth.getUser();

  const state = {
    outletId: myOutlets.some((o) => o.id === outletId) ? outletId : myOutlets[0].id,
    tanggal: todayWIB(),
    sudahAda: null,
    riwayat: []
  };

  await muat();

  async function muat() {
    container.innerHTML = loadingHtml('Memuat…');
    try {
      const sejak = new Date(Date.now() + 7 * 3600 * 1000 - 13 * 86400000).toISOString().slice(0, 10);
      const [ada, riwayat] = await Promise.all([
        omzetHari(state.outletId, state.tanggal),
        omzetRentang(businessUnitId, sejak, state.tanggal)
      ]);
      state.sudahAda = ada;
      state.riwayat = riwayat.filter((r) => r.outlet_id === state.outletId);
    } catch (error) {
      container.innerHTML = `<p class="error-text">Gagal memuat: ${error.message ?? error}</p>`;
      return;
    }
    gambar();
  }

  function gambar() {
    const ada = state.sudahAda;
    const outletNama = myOutlets.find((o) => o.id === state.outletId)?.name ?? '';

    container.innerHTML = `
      <h1>Penjualan Bengkel</h1>

      <div class="inline-card" style="max-width:520px">
        <div class="field">
          <label for="pb-outlet">Outlet</label>
          <select id="pb-outlet">
            ${myOutlets.map((o) => `<option value="${o.id}" ${o.id === state.outletId ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}
          </select>
        </div>

        <div class="field">
          <label for="pb-tanggal">Tanggal</label>
          <input id="pb-tanggal" type="date" value="${state.tanggal}" max="${todayWIB()}">
        </div>

        ${
          ada
            ? `<p class="badge badge-pending" style="display:block;padding:8px;line-height:1.45">
                 Hari ini SUDAH dilaporkan: Sparepart ${formatRupiah(ada.omzet_sparepart)},
                 Jasa ${formatRupiah(ada.omzet_jasa)}.<br>
                 Menekan Simpan akan <strong>mengganti</strong> angka di atas, bukan menambahkannya.
               </p>`
            : `<p style="color:var(--color-text-muted);font-size:0.85rem">Belum ada laporan untuk tanggal ini.</p>`
        }

        <div class="field">
          <label for="pb-sparepart">Omzet Sparepart (Rp)</label>
          <input id="pb-sparepart" type="text" inputmode="numeric" placeholder="0" value="${ada ? formatRupiah(ada.omzet_sparepart).replace(/^Rp\s*/, '') : ''}">
        </div>

        <div class="field">
          <label for="pb-jasa">Omzet Jasa (Rp)</label>
          <input id="pb-jasa" type="text" inputmode="numeric" placeholder="0" value="${ada ? formatRupiah(ada.omzet_jasa).replace(/^Rp\s*/, '') : ''}">
        </div>

        <div class="field">
          <label for="pb-catatan">Catatan (opsional)</label>
          <input id="pb-catatan" type="text" value="${esc(ada?.catatan ?? '')}" placeholder="mis. ada 2 unit servis besar">
        </div>

        <p style="margin:4px 0 10px;font-size:0.95rem">
          Total hari ini: <strong id="pb-total">${formatRupiah(Number(ada?.omzet_sparepart ?? 0) + Number(ada?.omzet_jasa ?? 0))}</strong>
        </p>

        <button id="pb-simpan" class="btn-primary">${ada ? 'Ganti laporan hari ini' : 'Simpan'}</button>
      </div>

      <h2 style="margin-top:22px">14 hari terakhir — ${esc(outletNama)}</h2>
      ${
        state.riwayat.length
          ? `<table class="data-table">
               <thead><tr><th>Tanggal</th><th>Sparepart</th><th>Jasa</th><th>Total</th><th>Catatan</th></tr></thead>
               <tbody>
                 ${state.riwayat
                   .map(
                     (r) => `<tr>
                       <td>${r.sale_date}</td>
                       <td>${formatRupiah(r.omzet_sparepart)}</td>
                       <td>${formatRupiah(r.omzet_jasa)}</td>
                       <td><strong>${formatRupiah(Number(r.omzet_sparepart) + Number(r.omzet_jasa))}</strong></td>
                       <td>${esc(r.catatan ?? '')}</td>
                     </tr>`
                   )
                   .join('')}
               </tbody>
             </table>`
          : '<p style="color:var(--color-text-muted)">Belum ada laporan 14 hari terakhir.</p>'
      }
    `;

    const iSpare = container.querySelector('#pb-sparepart');
    const iJasa = container.querySelector('#pb-jasa');
    attachRupiahInput(iSpare);
    attachRupiahInput(iJasa);

    const hitungTotal = () => {
      const t = (bacaRupiah(iSpare.value) || 0) + (bacaRupiah(iJasa.value) || 0);
      container.querySelector('#pb-total').textContent = formatRupiah(t);
    };
    iSpare.addEventListener('input', hitungTotal);
    iJasa.addEventListener('input', hitungTotal);

    container.querySelector('#pb-outlet').addEventListener('change', (e) => {
      state.outletId = e.target.value;
      muat();
    });
    container.querySelector('#pb-tanggal').addEventListener('change', (e) => {
      state.tanggal = e.target.value || todayWIB();
      muat();
    });

    container.querySelector('#pb-simpan').addEventListener(
      'click',
      sekaliJalan(async () => {
        const sparepart = bacaRupiah(iSpare.value) || 0;
        const jasa = bacaRupiah(iJasa.value) || 0;

        // Dua kotak kosong bukan "omzet nol" — hampir selalu artinya orangnya
        // salah tekan. Nol yang disimpan diam-diam akan terbaca di laporan
        // sebagai hari tanpa pemasukan, dan tidak ada cara membedakannya dari
        // hari yang memang sepi.
        if (!sparepart && !jasa) {
          toast('Isi minimal salah satu nominal. Kalau hari ini memang nol, tulis 0 di salah satunya.', 'warning');
          return;
        }

        try {
          await simpanOmzetHari({
            businessUnitId,
            outletId: state.outletId,
            tanggal: state.tanggal,
            sparepart,
            jasa,
            catatan: container.querySelector('#pb-catatan').value,
            userId: user?.id ?? null
          });
          toast('Penjualan tersimpan.', 'success');
          await muat();
        } catch (error) {
          toast(error.message ?? 'Gagal menyimpan.', 'error');
        }
      })
    );
  }
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
