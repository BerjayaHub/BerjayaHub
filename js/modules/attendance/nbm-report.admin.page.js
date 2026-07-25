import { listAttendanceForNbm, listOutletsWithGeofence } from './attendance.service.js';
import { getNbmConfig, listOvertimeTiers, listHolidays, calculateNbm, toDateKey } from './nbm.service.js';
import { exportTablePDF } from '../../core/pdf.js';
import { toast } from '../../core/ui.js';
import { formatRupiah } from '../../core/format.js';

/** Tanggal 1 bulan ini & hari ini (WIB), untuk default filter. */
function defaultRange() {
  const now = new Date();
  const wib = new Date(now.getTime() + 7 * 3600000);
  const pad = (n) => String(n).padStart(2, '0');
  const y = wib.getUTCFullYear();
  const m = pad(wib.getUTCMonth() + 1);
  return { from: `${y}-${m}-01`, to: `${y}-${m}-${pad(wib.getUTCDate())}` };
}

let lastReportRows = [];

export async function renderNbmReportTab(container, businessUnitId) {
  container.innerHTML = `<p>Memuat...</p>`;
  const outlets = await listOutletsWithGeofence(businessUnitId);
  const range = defaultRange();

  container.innerHTML = `
    <div class="inline-card" style="max-width:640px;display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end">
      <div class="field" style="margin:0">
        <label>Outlet basis (tempat kerja utama)</label>
        <select id="nbm-report-outlet">
          <option value="">Semua outlet</option>
          ${outlets.map((o) => `<option value="${o.id}">${o.name}</option>`).join('')}
        </select>
      </div>
      <div class="field" style="margin:0"><label>Dari tanggal</label><input type="date" id="nbm-report-from" value="${range.from}" /></div>
      <div class="field" style="margin:0"><label>Sampai tanggal</label><input type="date" id="nbm-report-to" value="${range.to}" /></div>
      <button class="primary" id="btn-nbm-report" style="max-width:120px">Tampilkan</button>
      <button id="btn-nbm-export">⇩ Export PDF</button>
    </div>
    <div id="nbm-report-result"></div>
  `;

  document.getElementById('btn-nbm-report').addEventListener('click', () => runReport(businessUnitId, outlets));
  document.getElementById('btn-nbm-export').addEventListener('click', async () => {
    if (!lastReportRows.length) return toast('Tampilkan datanya dulu sebelum export.', 'warning');
    const outletId = document.getElementById('nbm-report-outlet').value;
    const outletName = outletId ? outlets.find((o) => o.id === outletId)?.name ?? '-' : 'Semua outlet';
    const from = document.getElementById('nbm-report-from').value;
    const to = document.getElementById('nbm-report-to').value;
    try {
      await exportTablePDF({
        title: 'Rekap NBM (Uang Hadir)',
        subtitle: `Outlet basis: ${outletName} · Periode ${from || '…'} s/d ${to || '…'}`,
        columns: [
          { header: 'Staff', width: 1.5 },
          { header: 'Outlet Basis', width: 1.2 },
          { header: 'Tanggal', width: 0.9 },
          { header: 'Storing', width: 0.7 },
          { header: 'Libur', width: 0.6 },
          { header: 'Base', width: 1 },
          { header: 'Lembur', width: 1 },
          { header: 'Storing+', width: 1 },
          { header: 'Total', width: 1 }
        ],
        rows: lastReportRows,
        filename: 'rekap-nbm'
      });
      toast('PDF rekap NBM terunduh.', 'success');
    } catch (error) {
      toast(error.message ?? 'Gagal membuat PDF.', 'error');
    }
  });

  // Tampilkan otomatis memakai rentang default (tgl 1 bulan ini s/d hari ini).
  runReport(businessUnitId, outlets);
}

async function runReport(businessUnitId, outlets) {
  const outletId = document.getElementById('nbm-report-outlet').value || '';
  const from = document.getElementById('nbm-report-from').value;
  const to = document.getElementById('nbm-report-to').value;
  const resultEl = document.getElementById('nbm-report-result');
  resultEl.innerHTML = `<p>Menghitung...</p>`;

  const records = await listAttendanceForNbm({
    businessUnitId,
    outletId,
    dateFrom: from ? new Date(from).toISOString() : '',
    dateTo: to ? new Date(to + 'T23:59:59').toISOString() : ''
  });

  // NBM dihitung berdasarkan outlet BASIS (nbm_outlet), bukan lokasi absen.
  // Fallback ke lokasi absen untuk record lama yang belum punya basis.
  const baseOutletId = (r) => r.nbm_outlet?.id ?? r.outlets?.id;

  // Preload config/tier/holiday per outlet basis yang muncul, biar gak query berulang
  const outletIds = [...new Set(records.map(baseOutletId).filter(Boolean))];
  const configByOutlet = {};
  const tiersByOutlet = {};
  const holidaysByOutlet = {};

  for (const oid of outletIds) {
    configByOutlet[oid] = await getNbmConfig(oid);
    tiersByOutlet[oid] = await listOvertimeTiers(oid);
    const holidays = await listHolidays({ businessUnitId, outletId: oid });
    holidaysByOutlet[oid] = holidays.map((h) => h.holiday_date);
  }

  const rows = records.map((r) => {
    const oid = baseOutletId(r);
    const nbm = calculateNbm(r, configByOutlet[oid], tiersByOutlet[oid], holidaysByOutlet[oid] ?? []);
    return { record: r, nbm };
  });

  const totalsByStaff = {};
  for (const { record, nbm } of rows) {
    if (!nbm) continue;
    const name = record.user_profiles?.full_name ?? '-';
    totalsByStaff[name] = (totalsByStaff[name] ?? 0) + nbm.total;
  }

  // Simpan bentuk siap-export (dipakai tombol Export PDF).
  lastReportRows = rows
    .filter(({ nbm }) => nbm)
    .map(({ record, nbm }) => [
      record.user_profiles?.full_name ?? '-',
      record.nbm_outlet?.name ?? record.outlets?.name ?? '-',
      toDateKey(new Date(record.clock_in_at)),
      record.is_storing ? 'Ya' : '-',
      nbm.isHoliday ? 'Ya' : '-',
      formatRupiah(nbm.base),
      formatRupiah(nbm.overtimeBonus),
      formatRupiah(nbm.storingBonus),
      formatRupiah(nbm.total)
    ]);

  resultEl.innerHTML = `
    <table class="data-table" style="margin-top:16px">
      <thead>
        <tr><th>Staff</th><th>Outlet Basis</th><th>Lokasi Absen</th><th>Tanggal</th><th>Storing</th><th>Libur</th><th>Base</th><th>Lembur</th><th>Storing+</th><th>Total</th></tr>
      </thead>
      <tbody>
        ${
          rows
            .map(({ record, nbm }) => {
              const baseName = record.nbm_outlet?.name ?? record.outlets?.name ?? '-';
              const physName = record.outlets?.name ?? '-';
              const physCell = physName === baseName ? '<span style="color:var(--color-text-muted)">(sama)</span>' : physName;
              if (!nbm) {
                return `<tr><td>${record.user_profiles?.full_name ?? '-'}</td><td>${baseName}</td><td>${physCell}</td><td>${toDateKey(new Date(record.clock_in_at))}</td><td colspan="6">Belum bisa dihitung (belum clock out / NBM outlet basis belum diset)</td></tr>`;
              }
              return `
                <tr>
                  <td>${record.user_profiles?.full_name ?? '-'}</td>
                  <td>${baseName}</td>
                  <td>${physCell}</td>
                  <td>${toDateKey(new Date(record.clock_in_at))}</td>
                  <td>${record.is_storing ? 'Ya' : '-'}</td>
                  <td>${nbm.isHoliday ? 'Ya' : '-'}</td>
                  <td>Rp${nbm.base.toLocaleString('id-ID')}</td>
                  <td>Rp${nbm.overtimeBonus.toLocaleString('id-ID')}</td>
                  <td>Rp${nbm.storingBonus.toLocaleString('id-ID')}</td>
                  <td><strong>Rp${nbm.total.toLocaleString('id-ID')}</strong></td>
                </tr>
              `;
            })
            .join('') || '<tr><td colspan="10">Tidak ada data.</td></tr>'
        }
      </tbody>
    </table>

    <h2 style="font-size:1rem;margin-top:20px">Total per Staff (periode ini)</h2>
    <table class="data-table" style="max-width:400px">
      <thead><tr><th>Staff</th><th>Total NBM</th></tr></thead>
      <tbody>
        ${
          Object.entries(totalsByStaff)
            .map(([name, total]) => `<tr><td>${name}</td><td>Rp${total.toLocaleString('id-ID')}</td></tr>`)
            .join('') || '<tr><td colspan="2">-</td></tr>'
        }
      </tbody>
    </table>
  `;
}
