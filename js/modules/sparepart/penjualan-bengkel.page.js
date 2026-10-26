import { toast, shareDialog, escapeHtml } from '../../core/ui.js';
import { formatRupiah, attachRupiahInput, bacaRupiah } from '../../core/format.js';
import { listMyOutlets } from '../../core/my-outlets.js';
import { loadingHtml, sekaliJalan } from '../../core/loading.js';
import { supabase } from '../../config/supabase-client.js';
import { omzetHari, simpanOmzetHari, omzetRentang, todayWIB } from './sparepart.service.js';
import { pesanPenjualanHarian, pesanRekapPeriode } from './pesan-penjualan-bengkel.js';

/**
 * PENJUALAN BENGKEL — Staff App.
 *
 * Bengkel tidak melaporkan barang. Staff melaporkan DUA nominal untuk satu
 * hari: berapa rupiah Sparepart yang terjual, dan berapa rupiah Jasa. Tidak
 * ada stok, tidak ada baris barang, tidak ada resep — penjualan dan stok
 * ditangani Turboly; yang dicatat di sini cuma pemasukannya.
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
  const { data: profil } = await supabase.from('user_profiles').select('full_name').eq('id', user?.id ?? '').maybeSingle();
  const namaSaya = profil?.full_name ?? '';

  const hariIni = todayWIB();
  const state = {
    outletId: myOutlets.some((o) => o.id === outletId) ? outletId : myOutlets[0].id,
    tanggal: hariIni,
    // Riwayat punya rentangnya SENDIRI, lepas dari tanggal yang sedang diisi.
    // Menyatukannya berarti memeriksa bulan lalu ikut memindahkan tanggal yang
    // sedang diketik — dan isian yang sudah diketik hilang tanpa peringatan.
    dari: hariIni.slice(0, 8) + '01',
    sampai: hariIni,
    sudahAda: null,
    riwayat: []
  };

  const outletNama = (id) => myOutlets.find((o) => o.id === id)?.name ?? '';

  async function muat() {
    container.innerHTML = loadingHtml('Memuat…');
    try {
      const [ada, riwayat] = await Promise.all([
        omzetHari(state.outletId, state.tanggal),
        omzetRentang(businessUnitId, state.dari, state.sampai)
      ]);
      state.sudahAda = ada;
      state.riwayat = riwayat.filter((r) => r.outlet_id === state.outletId);
    } catch (error) {
      container.innerHTML = `<p class="error-text">Gagal memuat: ${error.message ?? error}</p>`;
      return;
    }
    gambar();
  }

  function bagikanHari(b) {
    const pesan = pesanPenjualanHarian({
      outlet: outletNama(b.outlet_id ?? state.outletId),
      tanggal: b.sale_date,
      sparepart: b.omzet_sparepart,
      jasa: b.omzet_jasa,
      catatan: b.catatan,
      oleh: namaSaya
    });
    return shareDialog({
      title: `Bagikan laporan ${b.sale_date}`,
      helper: 'Teks ini bisa langsung dikirim ke grup WhatsApp.',
      defaultMessage: pesan
    });
  }

  function gambar() {
    const ada = state.sudahAda;
    const nilaiRp = (v) => (v === null || v === undefined ? '' : formatRupiah(v).replace(/^Rp\s*/, ''));

    container.innerHTML = `
      <h1>Penjualan Bengkel</h1>

      <div class="inline-card" style="max-width:520px">
        <div class="field">
          <label for="pb-outlet">Outlet</label>
          <select id="pb-outlet">
            ${myOutlets.map((o) => `<option value="${o.id}" ${o.id === state.outletId ? 'selected' : ''}>${escapeHtml(o.name)}</option>`).join('')}
          </select>
        </div>

        <div class="field">
          <label for="pb-tanggal">Tanggal</label>
          <input id="pb-tanggal" type="date" value="${state.tanggal}" max="${hariIni}">
        </div>

        ${
          ada
            ? `<p class="badge badge-pending" style="display:block;padding:8px;line-height:1.45">
                 Tanggal ini SUDAH dilaporkan: Sparepart ${formatRupiah(ada.omzet_sparepart)},
                 Jasa ${formatRupiah(ada.omzet_jasa)}.<br>
                 Menekan Simpan akan <strong>mengganti</strong> angka di atas, bukan menambahkannya.
               </p>`
            : `<p style="color:var(--color-text-muted);font-size:0.85rem">Belum ada laporan untuk tanggal ini.</p>`
        }

        <div class="field">
          <label for="pb-sparepart">Omzet Sparepart (Rp)</label>
          <input id="pb-sparepart" type="text" inputmode="numeric" placeholder="0" value="${nilaiRp(ada?.omzet_sparepart)}">
        </div>

        <div class="field">
          <label for="pb-jasa">Omzet Jasa (Rp)</label>
          <input id="pb-jasa" type="text" inputmode="numeric" placeholder="0" value="${nilaiRp(ada?.omzet_jasa)}">
        </div>

        <div class="field">
          <label for="pb-catatan">Catatan (opsional)</label>
          <input id="pb-catatan" type="text" value="${escapeHtml(ada?.catatan ?? '')}" placeholder="mis. ada 2 unit servis besar">
        </div>

        <p style="margin:4px 0 10px;font-size:0.95rem">
          Total: <strong id="pb-total">${formatRupiah(Number(ada?.omzet_sparepart ?? 0) + Number(ada?.omzet_jasa ?? 0))}</strong>
        </p>

        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button id="pb-simpan" class="btn-primary">${ada ? 'Ganti laporan tanggal ini' : 'Simpan'}</button>
          ${ada ? '<button id="pb-bagikan-ini">Bagikan ke WhatsApp</button>' : ''}
        </div>
      </div>

      <h2 style="margin-top:22px">Riwayat — ${escapeHtml(outletNama(state.outletId))}</h2>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-bottom:10px">
        <div class="field" style="margin:0"><label for="pb-dari">Dari</label><input id="pb-dari" type="date" value="${state.dari}"></div>
        <div class="field" style="margin:0"><label for="pb-sampai">Sampai</label><input id="pb-sampai" type="date" value="${state.sampai}"></div>
        <button id="pb-bagikan-rekap">Bagikan rekap</button>
      </div>

      ${
        state.riwayat.length
          ? `<table class="data-table">
               <thead><tr><th>Tanggal</th><th>Sparepart</th><th>Jasa</th><th>Total</th><th>Catatan</th><th>Bagikan</th></tr></thead>
               <tbody>
                 ${state.riwayat
                   .map(
                     (r) => `<tr>
                       <td>${r.sale_date}</td>
                       <td>${formatRupiah(r.omzet_sparepart)}</td>
                       <td>${formatRupiah(r.omzet_jasa)}</td>
                       <td><strong>${formatRupiah(Number(r.omzet_sparepart) + Number(r.omzet_jasa))}</strong></td>
                       <td>${escapeHtml(r.catatan ?? '')}</td>
                       <td><button class="pb-bagikan" data-id="${r.id}" title="Kirim ulang laporan tanggal ini">Bagikan</button></td>
                     </tr>`
                   )
                   .join('')}
               </tbody>
             </table>`
          : '<p style="color:var(--color-text-muted)">Belum ada laporan di rentang ini.</p>'
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
      state.tanggal = e.target.value || hariIni;
      muat();
    });
    container.querySelector('#pb-dari').addEventListener('change', (e) => {
      state.dari = e.target.value;
      muat();
    });
    container.querySelector('#pb-sampai').addEventListener('change', (e) => {
      state.sampai = e.target.value;
      muat();
    });

    container.querySelector('#pb-bagikan-ini')?.addEventListener('click', () =>
      bagikanHari({ ...state.sudahAda, outlet_id: state.outletId })
    );

    container.querySelectorAll('.pb-bagikan').forEach((b) =>
      b.addEventListener('click', () => {
        const r = state.riwayat.find((x) => x.id === b.dataset.id);
        // Dibagikan dari BARIS YANG TERSIMPAN, bukan dari kotak isian di atas.
        //
        // Kotak isian bisa sedang memuat tanggal lain, atau angka yang belum
        // ditekan Simpan. Mengirim isinya berarti mengirim angka yang tidak
        // ada di database — dan di grup WhatsApp angka itu terlihat sama
        // resminya dengan yang benar.
        if (r) bagikanHari(r);
      })
    );

    container.querySelector('#pb-bagikan-rekap').addEventListener('click', () => {
      if (!state.riwayat.length) return toast('Belum ada laporan di rentang ini.', 'warning');
      shareDialog({
        title: 'Bagikan rekap',
        helper: 'Rekap seluruh tanggal yang sedang tampil.',
        defaultMessage: pesanRekapPeriode({
          outlet: outletNama(state.outletId),
          dari: state.dari,
          sampai: state.sampai,
          baris: state.riwayat
        })
      });
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

        const catatan = container.querySelector('#pb-catatan').value;
        const tanggal = state.tanggal;
        try {
          await simpanOmzetHari({
            businessUnitId,
            outletId: state.outletId,
            tanggal,
            sparepart,
            jasa,
            catatan,
            userId: user?.id ?? null
          });
        } catch (error) {
          toast(error.message ?? 'Gagal menyimpan.', 'error');
          return;
        }

        toast('Penjualan tersimpan.', 'success');

        // Dialog bagikan dibuka SESUDAH tersimpan, dan hanya kalau tersimpan.
        // Menawarkannya lebih dulu berarti ada kemungkinan laporan terkirim ke
        // grup sementara datanya gagal masuk — dan yang di grup itu yang akan
        // dipercaya orang.
        await bagikanHari({
          outlet_id: state.outletId,
          sale_date: tanggal,
          omzet_sparepart: sparepart,
          omzet_jasa: jasa,
          catatan
        });
        await muat();
      })
    );
  }

  await muat();
}
