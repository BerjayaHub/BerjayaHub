import { listAttendanceForNbm, listOutletsWithGeofence, listAttendanceOutlets } from './attendance.service.js';
import {
  getNbmConfig,
  listOvertimeTiers,
  listHolidays,
  calculateNbm,
  toDateKey,
  listNbmAdjustments,
  upsertNbmAdjustment,
  removeNbmAdjustment
} from './nbm.service.js';
import { exportTablePDF } from '../../core/pdf.js';
import { toast, formDialog } from '../../core/ui.js';
import { formatRupiah, formatThousands, parseNumber, attachThousandsInput } from '../../core/format.js';
import { monthRangeWIB } from '../../core/dates.js';

let lastReportRows = [];
// Nama SEMUA outlet aktif (RPC security-definer) — dipakai untuk kolom "Lokasi
// Absen", karena outlet milik BU lain tidak terbaca lewat RLS `outlets_select`.
let outletNameById = new Map();
const physOutletName = (r) => outletNameById.get(r.outlet_id) ?? r.outlets?.name ?? '-';

export async function renderNbmReportTab(container, businessUnitId) {
  container.innerHTML = `<p>Memuat...</p>`;
  const outlets = await listOutletsWithGeofence(businessUnitId);
  outletNameById = new Map((await listAttendanceOutlets().catch(() => [])).map((o) => [o.id, o.name]));
  const range = monthRangeWIB();

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
          { header: 'Total', width: 1 },
          { header: 'Keterangan', width: 1.8 }
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
  const baseOutletId = (r) => r.nbm_outlet_id ?? r.outlet_id;

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

  // Penyesuaian manual admin (override nominal total).
  let adjustments = new Map();
  try {
    adjustments = await listNbmAdjustments(rows.map(({ record }) => record.id));
  } catch {
    adjustments = new Map();
  }
  const finalTotal = ({ record, nbm }) => {
    const adj = adjustments.get(record.id);
    return adj ? Number(adj.amount) : nbm?.total ?? 0;
  };
  const ketOf = (record) => {
    const adj = adjustments.get(record.id);
    if (!adj) return '';
    const who = adj.user_profiles?.full_name ?? 'admin';
    const when = adj.edited_at ? new Date(adj.edited_at).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
    return `Diedit oleh ${who}${when ? ' · ' + when : ''}${adj.note ? ' — ' + adj.note : ''}`;
  };

  const totalsByStaff = {};
  for (const row of rows) {
    if (!row.nbm) continue;
    const name = row.record.user_profiles?.full_name ?? '-';
    totalsByStaff[name] = (totalsByStaff[name] ?? 0) + finalTotal(row);
  }

  // Simpan bentuk siap-export (dipakai tombol Export PDF).
  lastReportRows = rows
    .filter(({ nbm }) => nbm)
    .map((row) => {
      const { record, nbm } = row;
      return [
        record.user_profiles?.full_name ?? '-',
        record.nbm_outlet?.name ?? physOutletName(record),
        toDateKey(new Date(record.clock_in_at)),
        record.is_storing ? 'Ya' : '-',
        nbm.isHoliday ? 'Ya' : '-',
        formatRupiah(nbm.base),
        formatRupiah(nbm.overtimeBonus),
        formatRupiah(nbm.storingBonus),
        formatRupiah(finalTotal(row)),
        ketOf(record) || '-'
      ];
    });

  resultEl.innerHTML = `
    <p style="font-size:0.8rem;color:var(--color-text-muted);margin:14px 0 6px">
      Kolom <strong>Total</strong> bisa diubah langsung — klik nominalnya, ketik nilai baru, lalu tekan Enter/keluar dari kolom untuk konfirmasi.
    </p>
    <table class="data-table">
      <thead>
        <tr><th>Staff</th><th>Outlet Basis</th><th>Lokasi Absen</th><th>Tanggal</th><th>Storing</th><th>Libur</th><th>Base</th><th>Lembur</th><th>Storing+</th><th>Total</th><th>Keterangan</th></tr>
      </thead>
      <tbody>
        ${
          rows
            .map((row) => {
              const { record, nbm } = row;
              const baseName = record.nbm_outlet?.name ?? physOutletName(record);
              const physName = physOutletName(record);
              const physCell = physName === baseName ? '<span style="color:var(--color-text-muted)">(sama)</span>' : esc(physName);
              if (!nbm) {
                return `<tr><td>${esc(record.user_profiles?.full_name ?? '-')}</td><td>${esc(baseName)}</td><td>${physCell}</td><td>${toDateKey(new Date(record.clock_in_at))}</td><td colspan="7">Belum bisa dihitung (belum clock out / NBM outlet basis belum diset)</td></tr>`;
              }
              const adj = adjustments.get(record.id);
              const total = finalTotal(row);
              return `
                <tr data-record="${record.id}">
                  <td>${esc(record.user_profiles?.full_name ?? '-')}</td>
                  <td>${esc(baseName)}</td>
                  <td>${physCell}</td>
                  <td>${toDateKey(new Date(record.clock_in_at))}</td>
                  <td>${record.is_storing ? 'Ya' : '-'}</td>
                  <td>${nbm.isHoliday ? 'Ya' : '-'}</td>
                  <td>${formatRupiah(nbm.base)}</td>
                  <td>${formatRupiah(nbm.overtimeBonus)}</td>
                  <td>${formatRupiah(nbm.storingBonus)}</td>
                  <td>
                    <input type="text" inputmode="numeric" class="nbm-total-input${adj ? ' is-edited' : ''}"
                      data-record="${record.id}" data-original="${nbm.total}" value="${formatThousands(Math.round(total))}" />
                  </td>
                  <td style="font-size:0.78rem;max-width:200px">
                    <span class="nbm-ket">${adj ? `<span class="badge badge-pending">✎</span> ${esc(ketOf(record))}` : '<span style="color:var(--color-text-muted)">-</span>'}</span>
                    ${adj ? `<div><button class="btn-reset-nbm" data-record="${record.id}" style="margin-top:4px">Kembalikan hitungan sistem</button></div>` : ''}
                  </td>
                </tr>
              `;
            })
            .join('') || '<tr><td colspan="11">Tidak ada data.</td></tr>'
        }
      </tbody>
    </table>

    <h2 style="font-size:1rem;margin-top:20px">Total per Staff (periode ini)</h2>
    <table class="data-table" style="max-width:400px">
      <thead><tr><th>Staff</th><th>Total NBM</th></tr></thead>
      <tbody>
        ${
          Object.entries(totalsByStaff)
            .map(([name, total]) => `<tr><td>${esc(name)}</td><td>${formatRupiah(total)}</td></tr>`)
            .join('') || '<tr><td colspan="2">-</td></tr>'
        }
      </tbody>
    </table>
  `;

  // ---- Edit nominal langsung di tabel ----
  resultEl.querySelectorAll('.nbm-total-input').forEach((input) => {
    attachThousandsInput(input);
    let before = input.value;
    input.addEventListener('focus', () => {
      before = input.value;
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') input.blur();
      if (e.key === 'Escape') {
        input.value = before;
        input.blur();
      }
    });
    input.addEventListener('blur', async () => {
      if (input.value === before) return;
      const newAmount = parseNumber(input.value);
      const original = Number(input.dataset.original) || 0;
      const values = await formDialog({
        title: 'Konfirmasi Ubah Nominal NBM',
        description: `Nominal sistem ${formatRupiah(original)} akan diubah menjadi ${formatRupiah(newAmount)}. Perubahan ini tercatat atas namamu.`,
        fields: [{ name: 'note', label: 'Alasan/catatan (opsional)', type: 'text', placeholder: 'mis. koreksi lembur manual' }],
        submitText: 'Simpan Perubahan'
      });
      if (!values) {
        input.value = before;
        return;
      }
      try {
        await upsertNbmAdjustment({ recordId: input.dataset.record, businessUnitId, amount: newAmount, note: values.note });
        toast('Nominal NBM diperbarui.', 'success');
        await runReport(businessUnitId, outlets);
      } catch (error) {
        toast(error.message ?? 'Gagal menyimpan perubahan.', 'error');
        input.value = before;
      }
    });
  });

  resultEl.querySelectorAll('.btn-reset-nbm').forEach((btn) =>
    btn.addEventListener('click', async () => {
      try {
        await removeNbmAdjustment(btn.dataset.record);
        toast('Nominal dikembalikan ke hitungan sistem.', 'success');
        await runReport(businessUnitId, outlets);
      } catch (error) {
        toast(error.message ?? 'Gagal mengembalikan nominal.', 'error');
      }
    })
  );
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
