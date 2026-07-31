import { toast } from '../../core/ui.js';
import { exportTablePDF } from '../../core/pdf.js';
import { monthRangeWIB } from '../../core/dates.js';
import { REPORTS, getReport } from './report.service.js';
import { listMyOutlets, PESAN_TANPA_OUTLET } from '../../core/my-outlets.js';

/**
 * Halaman Laporan (Fase 11) — kerangka generik.
 *
 * Halaman ini tidak tahu isi laporan apa pun: ia hanya menyediakan pemilih
 * laporan + periode + outlet, memanggil `build()` dari katalog REPORTS, lalu
 * merender & meng-export hasilnya. Menambah laporan baru cukup menambah satu
 * entri di `report.service.js` — file ini tidak perlu disentuh.
 */
export async function renderReportAdminPage(container, { businessUnitId }) {
  const range = monthRangeWIB();
  const state = { key: REPORTS[0].key, outletId: '', from: range.from, to: range.to };
  let last = null; // { report, data, subtitle }

  const outlets = await listMyOutlets(businessUnitId).catch(() => []);
  if (!outlets.length) {
    container.innerHTML = `<h1>Laporan</h1><p style="color:var(--color-text-muted)">${PESAN_TANPA_OUTLET}</p>`;
    return;
  }
  const outletNames = new Map(outlets.map((o) => [o.id, o.name]));

  // Laporan dikelompokkan supaya daftar tetap terbaca saat jumlahnya bertambah.
  const groups = [...new Set(REPORTS.map((r) => r.group))];

  container.innerHTML = `
    <h1>Laporan</h1>
    <div class="inline-card" style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end">
      <div class="field" style="margin:0;min-width:240px;flex:1;max-width:320px">
        <label for="rp-report">Jenis laporan</label>
        <select id="rp-report">
          ${groups
            .map(
              (g) => `<optgroup label="${esc(g)}">${REPORTS.filter((r) => r.group === g)
                .map((r) => `<option value="${r.key}">${esc(r.label)}</option>`)
                .join('')}</optgroup>`
            )
            .join('')}
        </select>
      </div>
      <div class="field" style="margin:0;max-width:220px">
        <label for="rp-outlet">Outlet</label>
        <select id="rp-outlet">
          <option value="">Semua outlet</option>
          ${outlets.map((o) => `<option value="${o.id}">${esc(o.name)}</option>`).join('')}
        </select>
      </div>
      <div class="field" style="margin:0;max-width:165px"><label for="rp-from">Dari tanggal</label><input type="date" id="rp-from" value="${range.from}" /></div>
      <div class="field" style="margin:0;max-width:165px"><label for="rp-to">Sampai tanggal</label><input type="date" id="rp-to" value="${range.to}" /></div>
      <button class="primary" id="rp-run" style="max-width:130px">Tampilkan</button>
      <button id="rp-pdf">⇩ Export PDF</button>
    </div>
    <p id="rp-desc" style="font-size:0.82rem;color:var(--color-text-muted);margin:8px 2px 0"></p>
    <div id="rp-result" style="margin-top:12px"></div>
  `;

  const sel = container.querySelector('#rp-report');
  const result = container.querySelector('#rp-result');
  const desc = container.querySelector('#rp-desc');

  const showDesc = () => {
    desc.textContent = getReport(sel.value).description ?? '';
  };
  sel.addEventListener('change', () => {
    state.key = sel.value;
    showDesc();
    run();
  });
  container.querySelector('#rp-outlet').addEventListener('change', (e) => (state.outletId = e.target.value));
  container.querySelector('#rp-from').addEventListener('change', (e) => (state.from = e.target.value));
  container.querySelector('#rp-to').addEventListener('change', (e) => (state.to = e.target.value));
  container.querySelector('#rp-run').addEventListener('click', run);
  container.querySelector('#rp-pdf').addEventListener('click', exportPdf);

  function subtitleOf() {
    const outlet = state.outletId ? outletNames.get(state.outletId) ?? '-' : 'Semua outlet';
    return `${outlet} · Periode ${fmtDate(state.from)} – ${fmtDate(state.to)}`;
  }

  async function run() {
    const report = getReport(state.key);
    if (!state.from || !state.to) return toast('Isi periode laporannya dulu.', 'warning');
    if (state.from > state.to) return toast('Tanggal "dari" melewati tanggal "sampai".', 'warning');
    result.innerHTML = `<p style="color:var(--color-text-muted)">Menghitung ${esc(report.label)}…</p>`;
    try {
      const data = await report.build({ businessUnitId, outletId: state.outletId, from: state.from, to: state.to });
      last = { report, data, subtitle: subtitleOf() };
      result.innerHTML = renderResult(report, data, subtitleOf());
    } catch (error) {
      last = null;
      result.innerHTML = `<p class="error-text">Gagal menyusun laporan: ${esc(error.message ?? error)}</p>`;
    }
  }

  async function exportPdf() {
    if (!last?.data?.rows?.length) return toast('Tampilkan laporannya dulu.', 'warning');
    try {
      await exportTablePDF({
        title: last.report.label,
        subtitle: last.subtitle,
        columns: last.data.columns.map((c) => ({ header: c.header, width: c.width ?? 1 })),
        rows: last.data.rows,
        filename: `laporan-${last.report.key}`
      });
      toast('PDF laporan terunduh.', 'success');
    } catch (error) {
      toast(error.message ?? 'Gagal membuat PDF.', 'error');
    }
  }

  showDesc();
  await run();
}

function renderResult(report, data, subtitle) {
  const bold = new Set(data.bold ?? []);
  return `
    <h2 style="font-size:1.05rem;margin:0 0 2px">${esc(report.label)}</h2>
    <p style="font-size:0.82rem;color:var(--color-text-muted);margin:0 0 10px">${esc(subtitle)}</p>
    ${
      data.summary?.length
        ? `<div class="report-kpis">
             ${data.summary
               .map(
                 (s) => `<div class="report-kpi"><span class="report-kpi-label">${esc(s.label)}</span><strong class="report-kpi-value">${esc(s.value)}</strong></div>`
               )
               .join('')}
           </div>`
        : ''
    }
    <div class="table-scroll">
      <table class="data-table">
        <thead><tr>${data.columns.map((c) => `<th${c.numeric ? ' style="text-align:right"' : ''}>${esc(c.header)}</th>`).join('')}</tr></thead>
        <tbody>
          ${
            data.rows
              .map(
                (r, i) => `<tr${bold.has(i) ? ' style="font-weight:700;background:var(--color-bg)"' : ''}>${r
                  .map((cell, ci) => `<td${data.columns[ci]?.numeric ? ' style="text-align:right"' : ''}>${esc(cell)}</td>`)
                  .join('')}</tr>`
              )
              .join('') || `<tr><td colspan="${data.columns.length}">Tidak ada data pada periode ini.</td></tr>`
          }
        </tbody>
      </table>
    </div>
    ${data.note ? `<p class="report-note">${mdBold(esc(data.note))}</p>` : ''}
  `;
}

/** Hanya menerjemahkan **tebal** — sisanya sudah di-escape lebih dulu. */
function mdBold(s) {
  return s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}
function fmtDate(d) {
  return d ? new Date(d + 'T00:00:00').toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) : '-';
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
