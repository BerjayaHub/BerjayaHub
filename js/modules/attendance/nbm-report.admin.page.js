import { listAttendanceForNbm, listOutletsWithGeofence } from './attendance.service.js';
import { getNbmConfig, listOvertimeTiers, listHolidays, calculateNbm, toDateKey } from './nbm.service.js';

export async function renderNbmReportTab(container, businessUnitId) {
  container.innerHTML = `<p>Memuat...</p>`;
  const outlets = await listOutletsWithGeofence(businessUnitId);

  container.innerHTML = `
    <div class="inline-card" style="max-width:640px;display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end">
      <div class="field" style="margin:0">
        <label>Outlet basis (tempat kerja utama)</label>
        <select id="nbm-report-outlet">
          <option value="">Semua outlet</option>
          ${outlets.map((o) => `<option value="${o.id}">${o.name}</option>`).join('')}
        </select>
      </div>
      <div class="field" style="margin:0"><label>Dari tanggal</label><input type="date" id="nbm-report-from" /></div>
      <div class="field" style="margin:0"><label>Sampai tanggal</label><input type="date" id="nbm-report-to" /></div>
      <button class="primary" id="btn-nbm-report" style="max-width:120px">Tampilkan</button>
    </div>
    <div id="nbm-report-result"></div>
  `;

  document.getElementById('btn-nbm-report').addEventListener('click', () => runReport(businessUnitId, outlets));
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
