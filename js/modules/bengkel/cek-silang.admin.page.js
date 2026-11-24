/**
 * CEK SILANG — omzet harian (staff) vs penjualan Turboly, per tanggal.
 *
 * Satu-satunya layar yang menyandingkan dua jalur yang selama ini tidak
 * pernah saling melihat. Selama keduanya hidup terpisah, dua kebocoran bisa
 * bertahan bertahun-tahun tanpa ketahuan: uang masuk yang tidak pernah
 * dibukukan, dan transaksi dibukukan yang uangnya tidak pernah dilaporkan.
 * Dilihat dari satu sisi, keduanya tampak wajar.
 */

import { toast, escapeHtml } from '../../core/ui.js';
import { loadingHtml, sekaliJalan } from '../../core/loading.js';
import { formatRupiah } from '../../core/format.js';
import { exportTableXLSX } from '../../core/xlsx.js';
import { monthRangeWIB } from '../../core/dates.js';
import { listOutletsForBu } from '../organization/organization.service.js';
import { omzetRentang } from '../sparepart/sparepart.service.js';
import { barisPenjualan } from './penjualan-rinci.service.js';
import { cekSilangHarian, catatanCekSilang, STATUS, PESAN_STATUS } from './cek-silang-harian.js';

const esc = escapeHtml;
const WARNA = {
  [STATUS.COCOK]: 'var(--color-success, #2e7d32)',
  [STATUS.BEDA]: 'var(--color-danger)',
  [STATUS.TANPA_RINCI]: 'var(--color-warning, #b26a00)',
  [STATUS.TANPA_HARIAN]: 'var(--color-warning, #b26a00)'
};
const LABEL = {
  [STATUS.COCOK]: 'cocok',
  [STATUS.BEDA]: 'beda',
  [STATUS.TANPA_RINCI]: 'Turboly kosong',
  [STATUS.TANPA_HARIAN]: 'staff belum lapor'
};

export async function renderCekSilangAdminPage(container, { businessUnitId }) {
  const { from: awal, to: akhir } = monthRangeWIB();
  // Toleransi bawaan Rp1.000: pembulatan kasir bukan kebocoran, dan daftar
  // yang selalu merah berhenti dibaca orang. Tetap bisa diubah — yang
  // memutuskan berapa rupiah "masih wajar" adalah yang memegang kasnya.
  const state = { dari: awal, sampai: akhir, outletId: '', toleransi: 1000 };

  let outlets = [];
  try {
    outlets = await listOutletsForBu(businessUnitId);
  } catch (e) {
    container.innerHTML = `<p class="error-text">Gagal memuat outlet: ${esc(e.message ?? e)}</p>`;
    return;
  }

  container.innerHTML = `
    <div class="page-header">
      <h2 style="font-size:1.05rem;margin:0">Cek Silang — Harian vs Turboly</h2>
    </div>
    <p style="color:var(--color-text-muted);font-size:0.88rem;margin:0 0 10px;max-width:720px">
      Omzet yang dilaporkan staff tiap sore disandingkan dengan penjualan yang diimpor dari Turboly, per tanggal
      per outlet. Penjualan <strong>korporat tidak ikut dibandingkan</strong> — ia ditagih kantor, tidak lewat
      kasir — tapi tetap ditampilkan di kolomnya sendiri.
    </p>
    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin-bottom:10px">
      <div class="field" style="margin:0;min-width:140px"><label>Dari</label>
        <input type="date" id="cs-dari" value="${esc(state.dari)}" /></div>
      <div class="field" style="margin:0;min-width:140px"><label>Sampai</label>
        <input type="date" id="cs-sampai" value="${esc(state.sampai)}" /></div>
      <div class="field" style="margin:0;min-width:150px"><label>Outlet</label>
        <select id="cs-outlet"><option value="">Semua</option>${outlets
          .map((o) => `<option value="${o.id}">${esc(o.name)}</option>`)
          .join('')}</select></div>
      <div class="field" style="margin:0;min-width:130px"><label>Toleransi (Rp)</label>
        <input type="number" id="cs-tol" value="${state.toleransi}" min="0" step="500" /></div>
      <button id="cs-tampil" class="primary">Tampilkan</button>
    </div>
    <div id="cs-hasil"></div>`;

  const hasil = container.querySelector('#cs-hasil');
  let tampil = null;

  container.querySelector('#cs-tampil').addEventListener('click', () => {
    state.dari = container.querySelector('#cs-dari').value;
    state.sampai = container.querySelector('#cs-sampai').value;
    state.outletId = container.querySelector('#cs-outlet').value;
    state.toleransi = Number(container.querySelector('#cs-tol').value) || 0;
    muat();
  });

  async function muat() {
    hasil.innerHTML = loadingHtml('Menyandingkan…', { baris: 5 });
    let harian = [];
    let rinci = [];
    try {
      [harian, rinci] = await Promise.all([
        omzetRentang(businessUnitId, state.dari, state.sampai),
        barisPenjualan(businessUnitId, { dari: state.dari, sampai: state.sampai, outletId: state.outletId })
      ]);
    } catch (e) {
      hasil.innerHTML = `<p class="error-text">${esc(
        /bengkel_penjualan_rinci/.test(String(e.message ?? e))
          ? 'Migration 0185–0188 belum dijalankan di Supabase.'
          : e.message ?? e
      )}</p>`;
      return;
    }
    // Saringan outlet dikerjakan di SINI untuk sisi harian: `omzetRentang`
    // tidak menerimanya, dan menyaring satu sisi saja akan membuat seluruh
    // hari tampak "staff belum lapor".
    if (state.outletId) harian = harian.filter((h) => h.outlet_id === state.outletId);

    const { baris, ringkas } = cekSilangHarian({ harian, rinci, toleransi: state.toleransi });
    tampil = { baris, ringkas };
    if (!baris.length) {
      hasil.innerHTML = `<p style="color:var(--color-text-muted)">Tidak ada data pada rentang ini.</p>`;
      return;
    }

    const catatan = catatanCekSilang(ringkas);
    hasil.innerHTML = `
      <div class="inline-card" style="max-width:720px;margin-bottom:10px">
        <table class="data-table" style="max-width:460px">
          <tbody>
            <tr><td>Hari dibandingkan</td><td style="text-align:right">${ringkas.hari}</td></tr>
            <tr><td>Cocok</td><td style="text-align:right">${ringkas.cocok}</td></tr>
            <tr><td>Beda</td><td style="text-align:right;color:${ringkas.beda ? 'var(--color-danger)' : 'inherit'}">${ringkas.beda}</td></tr>
            <tr><td>Omzet harian (staff)</td><td style="text-align:right">${formatRupiah(ringkas.harian)}</td></tr>
            <tr><td>Omzet Turboly</td><td style="text-align:right">${formatRupiah(ringkas.turboly)}</td></tr>
            <tr><td><strong>Selisih bersih</strong></td><td style="text-align:right"><strong>${formatRupiah(ringkas.selisih)}</strong></td></tr>
            <tr><td>Selisih mutlak</td><td style="text-align:right">${formatRupiah(ringkas.selisihMutlak)}</td></tr>
            <tr><td>Korporat (tidak dibandingkan)</td><td style="text-align:right">${formatRupiah(ringkas.korporat)}</td></tr>
          </tbody>
        </table>
        ${catatan.map((c) => `<p class="nota-telat" style="margin:6px 0 0;font-size:0.82rem">${esc(c)}</p>`).join('')}
        <button id="cs-ekspor" style="margin-top:10px">⬇ Export Excel</button>
      </div>
      <div class="table-scroll"><table class="data-table kartu-sempit">
        <thead><tr>
          <th>Tanggal</th><th>Outlet</th>
          <th>Staff — Sparepart</th><th>Staff — Jasa</th><th>Staff — Total</th>
          <th>Turboly — Sparepart</th><th>Turboly — Jasa</th><th>Turboly — Total</th>
          <th>Selisih</th><th>Korporat</th><th>Status</th>
        </tr></thead>
        <tbody>${baris
          .map(
            (b) => `<tr>
              <td data-label="Tanggal">${esc(b.tanggal)}</td>
              <td data-label="Outlet">${esc(b.outlet || '—')}</td>
              <td data-label="Staff — Sparepart" style="text-align:right">${formatRupiah(b.harianSparepart)}</td>
              <td data-label="Staff — Jasa" style="text-align:right">${formatRupiah(b.harianJasa)}</td>
              <td data-label="Staff — Total" style="text-align:right">${formatRupiah(b.harianTotal)}</td>
              <td data-label="Turboly — Sparepart" style="text-align:right">${formatRupiah(b.turbolySparepart)}</td>
              <td data-label="Turboly — Jasa" style="text-align:right">${formatRupiah(b.turbolyJasa)}</td>
              <td data-label="Turboly — Total" style="text-align:right">${formatRupiah(b.turbolyTotal)}</td>
              <td data-label="Selisih" style="text-align:right;color:${b.selisih ? WARNA[STATUS.BEDA] : 'inherit'}">${
                b.selisih ? formatRupiah(b.selisih) : '—'
              }${
                // Selisih per jenis disebut HANYA kalau totalnya cocok tapi
                // jenisnya tidak: itu dua kesalahan yang saling menutupi, dan
                // kalau tidak ditulis di sini ia tidak terlihat di mana pun.
                !b.selisih && (b.selisihSparepart || b.selisihJasa)
                  ? `<div style="font-size:0.7rem;color:var(--color-warning,#b26a00)">sparepart ${formatRupiah(
                      b.selisihSparepart
                    )} · jasa ${formatRupiah(b.selisihJasa)}</div>`
                  : ''
              }</td>
              <td data-label="Korporat" style="text-align:right">${b.korporat ? formatRupiah(b.korporat) : '—'}</td>
              <td data-label="Status"><span style="color:${WARNA[b.status]};font-size:0.8rem" title="${esc(
                PESAN_STATUS[b.status] ?? ''
              )}">${esc(LABEL[b.status])}</span></td>
            </tr>`
          )
          .join('')}</tbody>
      </table></div>`;

    hasil.querySelector('#cs-ekspor').addEventListener(
      'click',
      sekaliJalan(async () => {
        await exportTableXLSX({
          filename: `cek-silang-bengkel-${state.dari}-${state.sampai}`,
          sheetName: 'Cek Silang',
          title: 'Cek Silang — Omzet Harian vs Turboly',
          subtitle: [`${state.dari} s/d ${state.sampai}`, `toleransi ${formatRupiah(state.toleransi)}`, ...catatan].join(' · '),
          columns: [
            { header: 'Tanggal', width: 12 },
            { header: 'Outlet', width: 18 },
            { header: 'Staff Sparepart', numeric: true, width: 16 },
            { header: 'Staff Jasa', numeric: true, width: 14 },
            { header: 'Staff Total', numeric: true, width: 16 },
            { header: 'Turboly Sparepart', numeric: true, width: 17 },
            { header: 'Turboly Jasa', numeric: true, width: 14 },
            { header: 'Turboly Total', numeric: true, width: 16 },
            { header: 'Selisih', numeric: true, width: 14 },
            { header: 'Selisih Sparepart', numeric: true, width: 16 },
            { header: 'Selisih Jasa', numeric: true, width: 14 },
            { header: 'Korporat', numeric: true, width: 14 },
            { header: 'Status', width: 16 }
          ],
          rows: tampil.baris.map((b) => [
            b.tanggal,
            b.outlet,
            b.harianSparepart,
            b.harianJasa,
            b.harianTotal,
            b.turbolySparepart,
            b.turbolyJasa,
            b.turbolyTotal,
            b.selisih,
            b.selisihSparepart,
            b.selisihJasa,
            b.korporat,
            LABEL[b.status]
          ])
        });
        toast('Cek silang terunduh.', 'success');
      })
    );
  }

  await muat();
}
