import { listAttendanceForNbm, listOutletsWithGeofence, listAttendanceOutlets, koreksiOutletBasisMassal } from './attendance.service.js';
import { listBuStaff } from '../leave/leave.service.js';
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
import { toast, formDialog, shareDialog, confirmDialog } from '../../core/ui.js';
import { formatRupiah, formatThousands, parseNumber, attachThousandsInput } from '../../core/format.js';
import { monthRangeWIB } from '../../core/dates.js';
import { loadingHtml } from '../../core/loading.js';

/** 'YYYY-MM-DD' -> '01 Agu 2026'. Kosong -> '…' supaya teksnya tetap terbaca. */
function fmtTanggal(d) {
  if (!d) return '…';
  return new Date(d + 'T00:00:00').toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

let lastReportRows = [];
// Nama SEMUA outlet aktif (RPC security-definer) — dipakai untuk kolom "Lokasi
// Absen", karena outlet milik BU lain tidak terbaca lewat RLS `outlets_select`.
let outletNameById = new Map();
const physOutletName = (r) => outletNameById.get(r.outlet_id) ?? r.outlets?.name ?? '-';

export async function renderNbmReportTab(container, businessUnitId) {
  container.innerHTML = loadingHtml('Memuat…');
  const outlets = await listOutletsWithGeofence(businessUnitId);
  outletNameById = new Map((await listAttendanceOutlets().catch(() => [])).map((o) => [o.id, o.name]));
  const range = monthRangeWIB();

  container.innerHTML = `
    <div class="inline-card" style="max-width:640px;display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end">
      <div class="field" style="margin:0">
        <label>Outlet basis (tempat kerja utama)</label>
        <select id="nbm-report-outlet">
          <option value="">Semua outlet</option>
          ${outlets.map((o) => `<option value="${o.id}">${esc(o.name)}</option>`).join('')}
        </select>
      </div>
      <div class="field" style="margin:0"><label>Dari tanggal</label><input type="date" id="nbm-report-from" value="${range.from}" /></div>
      <div class="field" style="margin:0"><label>Sampai tanggal</label><input type="date" id="nbm-report-to" value="${range.to}" /></div>
      <button class="primary" id="btn-nbm-report" style="max-width:120px">Tampilkan</button>
      <button id="btn-nbm-export">⇩ Export PDF</button>
      <button id="btn-nbm-pindah-basis" title="Betulkan outlet basis beberapa hari sekaligus">⇄ Koreksi Outlet Basis</button>
    </div>
    <div id="nbm-report-result"></div>
  `;

  document.getElementById('btn-nbm-report').addEventListener('click', () => runReport(businessUnitId, outlets));
  document.getElementById('btn-nbm-pindah-basis').addEventListener('click', () => koreksiMassal(businessUnitId, outlets));
  document.getElementById('btn-nbm-export').addEventListener('click', async () => {
    if (!lastReportRows.length) return toast('Tampilkan datanya dulu sebelum export.', 'warning');
    const outletId = document.getElementById('nbm-report-outlet').value;
    const outletName = outletId ? outlets.find((o) => o.id === outletId)?.name ?? '-' : 'Semua outlet';
    const from = document.getElementById('nbm-report-from').value;
    const to = document.getElementById('nbm-report-to').value;
    try {
      await exportTablePDF({
        title: 'Rekap NBM (Uang Hadir)',
        subtitle: `Outlet basis: ${outletName} · Periode ${fmtTanggal(from)} s/d ${fmtTanggal(to)}`,
        columns: [
          { header: 'Staff', width: 1.5 },
          { header: 'Outlet Basis', width: 1.2 },
          { header: 'Tanggal', width: 0.9 },
          { header: 'Tugas Luar/Storing', width: 1.1 },
          { header: 'Libur', width: 0.6 },
          { header: 'Base', width: 1 },
          { header: 'Lembur', width: 1 },
          { header: 'Bonus Tugas Luar/Storing', width: 1.2 },
          { header: 'Bonus PH', width: 1 },
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
  resultEl.innerHTML = loadingHtml('Menghitung…', { baris: 5 });

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

  // Judul periode & outlet dipakai di kartu, teks WhatsApp, dan PDF — dihitung
  // sekali supaya ketiganya TIDAK pernah berbeda. Kalau dihitung terpisah,
  // cepat atau lambat salah satunya tertinggal saat filternya berubah.
  const namaOutlet = outletId ? outlets.find((o) => o.id === outletId)?.name ?? '-' : 'Semua outlet';
  const judulPeriode = `Outlet basis: ${namaOutlet} · Periode ${fmtTanggal(from)} s/d ${fmtTanggal(to)}`;

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
        formatRupiah(nbm.phBonus ?? 0),
        formatRupiah(finalTotal(row)),
        ketOf(record) || '-'
      ];
    });

  resultEl.innerHTML = `
    <div class="inline-card" style="max-width:520px">
      <div class="page-header" style="margin-bottom:8px">
        <h2 style="font-size:1rem;margin:0">Total per Staff (periode ini)</h2>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button id="nbm-total-wa">💬 WhatsApp</button>
          <button id="nbm-total-pdf">⇩ PDF</button>
        </div>
      </div>
      <p style="font-size:0.78rem;color:var(--color-text-muted);margin:0 0 8px">${esc(judulPeriode)}</p>
      <div class="table-scroll"><table class="data-table table-freeze-1">
        <thead><tr><th>Staff</th><th style="text-align:right">Total NBM</th></tr></thead>
        <tbody>
          ${
            Object.entries(totalsByStaff)
              .map(([name, total]) => `<tr><td>${esc(name)}</td><td style="text-align:right">${formatRupiah(total)}</td></tr>`)
              .join('') || '<tr><td colspan="2">-</td></tr>'
          }
          ${
            Object.keys(totalsByStaff).length
              ? `<tr style="font-weight:700"><td>TOTAL</td><td style="text-align:right">${formatRupiah(
                  Object.values(totalsByStaff).reduce((t, n) => t + n, 0)
                )}</td></tr>`
              : ''
          }
        </tbody>
      </table></div>
    </div>
    <p style="font-size:0.8rem;color:var(--color-text-muted);margin:14px 0 6px">
      Kolom <strong>Total</strong> bisa diubah langsung — klik nominalnya, ketik nilai baru, lalu tekan Enter/keluar dari kolom untuk konfirmasi.
    </p>
    <div class="table-scroll"><table class="data-table table-freeze-1">
      <thead>
        <tr><th>Staff</th><th>Outlet Basis</th><th>Lokasi Absen</th><th>Tanggal</th><th>Tugas Luar/Storing</th><th>Libur</th><th>Base</th><th>Lembur</th><th>Bonus Tugas Luar/Storing</th><th>Bonus PH</th><th>Total</th><th>Keterangan</th></tr>
      </thead>
      <tbody>
        ${
          rows
            .map((row) => {
              const { record, nbm } = row;
              const baseName = record.nbm_outlet?.name ?? physOutletName(record);
              // Basis yang pernah dikoreksi manual diberi tanda — supaya angka
              // yang berbeda dari perkiraan bisa langsung ditelusuri alasannya,
              // bukan dicurigai sebagai salah hitung.
              const basisTag = record.nbm_outlet_note
                ? ` <span class="badge badge-pending" style="font-size:0.62rem" title="${esc(record.nbm_outlet_note)}">dikoreksi</span>`
                : '';
              const physName = physOutletName(record);
              const physCell = physName === baseName ? '<span style="color:var(--color-text-muted)">(sama)</span>' : esc(physName);
              if (!nbm) {
                return `<tr><td>${esc(record.user_profiles?.full_name ?? '-')}</td><td>${esc(baseName)}</td><td>${physCell}</td><td>${toDateKey(new Date(record.clock_in_at))}</td><td colspan="8">Belum bisa dihitung (belum clock out / NBM outlet basis belum diset)</td></tr>`;
              }
              const adj = adjustments.get(record.id);
              const total = finalTotal(row);
              return `
                <tr data-record="${record.id}">
                  <td>${esc(record.user_profiles?.full_name ?? '-')}</td>
                  <td>${esc(baseName)}${basisTag}</td>
                  <td>${physCell}</td>
                  <td>${toDateKey(new Date(record.clock_in_at))}</td>
                  <td>${record.is_storing ? 'Ya' : '-'}</td>
                  <td>${nbm.isHoliday ? 'Ya' : '-'}</td>
                  <td>${formatRupiah(nbm.base)}</td>
                  <td>${formatRupiah(nbm.overtimeBonus)}</td>
                  <td>${formatRupiah(nbm.storingBonus)}</td>
                  <td>${formatRupiah(nbm.phBonus ?? 0)}</td>
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
            .join('') || '<tr><td colspan="12">Tidak ada data.</td></tr>'
        }
      </tbody>
    </table></div>

  `;

  // ---- Total per staff: WhatsApp & PDF ----
  const barisTotal = Object.entries(totalsByStaff);
  const grandTotal = barisTotal.reduce((t, [, n]) => t + n, 0);

  resultEl.querySelector('#nbm-total-wa')?.addEventListener('click', () => {
    if (!barisTotal.length) return toast('Tidak ada data untuk dikirim.', 'warning');
    // Tanpa nomor tujuan: rekap ini dibagikan ke grup/atasan yang berbeda-beda,
    // jadi dialognya membiarkan pengirim memilih lewat share sheet WhatsApp.
    shareDialog({
      title: 'Kirim Rekap NBM',
      helper: 'Teks sudah memuat outlet dan rentang tanggalnya, jadi penerima tidak perlu bertanya periode mana.',
      defaultMessage: [
        '*REKAP NBM (Uang Hadir)*',
        judulPeriode,
        '',
        ...barisTotal.map(([nama, total]) => `• ${nama} : ${formatRupiah(total)}`),
        '',
        `*TOTAL : ${formatRupiah(grandTotal)}*`,
        `(${barisTotal.length} staff)`
      ].join('\n')
    });
  });

  resultEl.querySelector('#nbm-total-pdf')?.addEventListener('click', async () => {
    if (!barisTotal.length) return toast('Tidak ada data untuk diexport.', 'warning');
    try {
      await exportTablePDF({
        title: 'Rekap NBM — Total per Staff',
        subtitle: judulPeriode,
        columns: [
          { header: 'Staff', width: 2 },
          { header: 'Total NBM', width: 1 }
        ],
        rows: [...barisTotal.map(([nama, total]) => [nama, formatRupiah(total)]), ['TOTAL', formatRupiah(grandTotal)]],
        filename: 'rekap-nbm-total-per-staff'
      });
      toast('PDF total per staff terunduh.', 'success');
    } catch (error) {
      toast(error.message ?? 'Gagal membuat PDF.', 'error');
    }
  });

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

/**
 * Koreksi outlet basis untuk BEBERAPA HARI sekaligus.
 *
 * Untuk kasus yang sudah terbukti terjadi: orang pindah outlet tanggal 2, tapi
 * basis (★)-nya baru diperbarui tanggal 3. Hari-hari di antaranya terlanjur
 * memakai tarif outlet lama — dan hilang dari rekap begitu difilter ke outlet
 * baru, sehingga tidak ketahuan sampai gajinya dihitung.
 *
 * SELALU DIHITUNG DULU SEBELUM DIUBAH. Rentang yang kelewat lebar bisa
 * memindahkan berminggu-minggu gaji dalam satu klik, dan tidak ada tombol
 * urungkan. Jadi admin harus melihat angkanya lebih dulu, baru menyetujui.
 */
async function koreksiMassal(businessUnitId, outlets) {
  let staff = [];
  try {
    staff = await listBuStaff(businessUnitId, { includeInactive: true });
  } catch {
    return toast('Gagal memuat daftar staff.', 'error');
  }
  if (!staff.length) return toast('Belum ada staff di BU ini.', 'warning');
  if (!outlets.length) return toast('Belum ada outlet di BU ini.', 'warning');

  const range = monthRangeWIB();
  const values = await formDialog({
    title: 'Koreksi Outlet Basis',
    description:
      'Untuk kasus staff yang sudah pindah outlet tapi basis (★)-nya telat diperbarui. ' +
      'Presensi pada rentang ini akan dihitung ulang memakai tarif NBM outlet tujuan.',
    fields: [
      { name: 'user_id', label: 'Staff', type: 'searchselect', required: true, options: staff.map((s) => ({ value: s.user_id, label: s.full_name })) },
      { name: 'from', label: 'Dari tanggal', type: 'date', required: true, value: range.from },
      { name: 'to', label: 'Sampai tanggal', type: 'date', required: true, value: range.to },
      { name: 'outlet_id', label: 'Outlet basis yang benar', type: 'select', required: true, options: outlets.map((o) => ({ value: o.id, label: o.name })) },
      { name: 'note', label: 'Alasan koreksi', type: 'text', required: true, placeholder: 'mis. pindah ke CK sejak 2 Agu, ★ telat diperbarui' }
    ],
    submitText: 'Hitung Dampaknya'
  });
  if (!values) return;
  if (values.from > values.to) return toast('Tanggal "dari" melewati tanggal "sampai".', 'warning');

  let pratinjau;
  try {
    pratinjau = await koreksiOutletBasisMassal({
      userId: values.user_id,
      from: values.from,
      to: values.to,
      outletId: values.outlet_id,
      note: values.note,
      dryRun: true
    });
  } catch (error) {
    return toast(error.message ?? 'Gagal menghitung dampak.', 'error');
  }

  if (!pratinjau.terpengaruh) {
    return toast(
      pratinjau.dilewati
        ? `Tidak ada yang bisa diubah — ${pratinjau.dilewati} baris ada di outlet yang bukan wewenangmu.`
        : 'Tidak ada presensi yang perlu dikoreksi pada rentang itu.',
      'info'
    );
  }

  const namaStaff = staff.find((s) => s.user_id === values.user_id)?.full_name ?? 'staff ini';
  const namaOutlet = outlets.find((o) => o.id === values.outlet_id)?.name ?? 'outlet tujuan';
  const ok = await confirmDialog({
    title: `Pindahkan ${pratinjau.terpengaruh} hari presensi?`,
    message:
      `${pratinjau.terpengaruh} baris presensi ${namaStaff} (${fmtTanggal(values.from)} s/d ${fmtTanggal(values.to)}) ` +
      `akan dihitung ulang memakai tarif NBM ${namaOutlet}. Nominalnya bisa berubah, dan ini TIDAK bisa diurungkan otomatis.` +
      (pratinjau.dilewati ? ` ${pratinjau.dilewati} baris dilewati karena di luar wewenangmu.` : ''),
    confirmText: 'Ya, koreksi',
    danger: true
  });
  if (!ok) return;

  try {
    const hasil = await koreksiOutletBasisMassal({
      userId: values.user_id,
      from: values.from,
      to: values.to,
      outletId: values.outlet_id,
      note: values.note,
      dryRun: false
    });
    toast(`${hasil.terpengaruh} baris presensi dikoreksi.`, 'success');
    document.getElementById('btn-nbm-report')?.click();
  } catch (error) {
    toast(error.message ?? 'Gagal mengoreksi.', 'error');
  }
}
