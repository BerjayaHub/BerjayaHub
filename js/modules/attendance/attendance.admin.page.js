import { supabase } from '../../config/supabase-client.js';
import { listAttendanceForAdmin, correctAttendanceRecord } from './attendance.service.js';

export async function renderAttendanceAdminPage(container, { businessUnitId }) {
  container.innerHTML = `<p>Memuat presensi...</p>`;

  const { data: outlets } = await supabase
    .from('outlets')
    .select('id, name')
    .eq('business_unit_id', businessUnitId)
    .order('name');

  const filters = { businessUnitId, outletId: '', dateFrom: '', dateTo: '' };

  async function refresh() {
    const records = await listAttendanceForAdmin(filters);
    container.querySelector('#attendance-table-body').innerHTML =
      records.map((r) => rowHtml(r)).join('') || '<tr><td colspan="5">Tidak ada data.</td></tr>';
    wireEditButtons(container);
  }

  container.innerHTML = `
    <h1>Master Presensi</h1>
    <div class="inline-card" style="max-width:640px;display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end">
      <div class="field" style="margin:0">
        <label>Outlet</label>
        <select id="filter-outlet">
          <option value="">Semua outlet</option>
          ${(outlets ?? []).map((o) => `<option value="${o.id}">${o.name}</option>`).join('')}
        </select>
      </div>
      <div class="field" style="margin:0"><label>Dari tanggal</label><input type="date" id="filter-from" /></div>
      <div class="field" style="margin:0"><label>Sampai tanggal</label><input type="date" id="filter-to" /></div>
      <button class="primary" id="btn-filter" style="max-width:120px">Filter</button>
    </div>

    <table class="data-table">
      <thead>
        <tr><th>Staff</th><th>Outlet</th><th>Clock In</th><th>Clock Out</th><th>Aksi</th></tr>
      </thead>
      <tbody id="attendance-table-body"></tbody>
    </table>
  `;

  document.getElementById('btn-filter').addEventListener('click', () => {
    filters.outletId = document.getElementById('filter-outlet').value || '';
    const from = document.getElementById('filter-from').value;
    const to = document.getElementById('filter-to').value;
    filters.dateFrom = from ? new Date(from).toISOString() : '';
    filters.dateTo = to ? new Date(to + 'T23:59:59').toISOString() : '';
    refresh();
  });

  await refresh();
}

function rowHtml(r) {
  return `
    <tr data-record-id="${r.id}">
      <td>${r.user_profiles?.full_name ?? '-'}</td>
      <td>${r.outlets?.name ?? '-'}</td>
      <td>${formatTime(r.clock_in_at)}</td>
      <td>${r.clock_out_at ? formatTime(r.clock_out_at) : '—'}</td>
      <td><button class="btn-edit" data-record-id="${r.id}">Koreksi</button></td>
    </tr>
  `;
}

function wireEditButtons(container) {
  container.querySelectorAll('.btn-edit').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const row = container.querySelector(`tr[data-record-id="${btn.dataset.recordId}"]`);
      const currentIn = row.children[2].textContent;
      const currentOut = row.children[3].textContent === '—' ? '' : row.children[3].textContent;

      const newInRaw = prompt('Clock In (format: YYYY-MM-DD HH:MM):', toInputFormat(currentIn));
      if (newInRaw === null) return;
      const newOutRaw = prompt('Clock Out (kosongkan kalau belum clock out):', toInputFormat(currentOut));
      if (newOutRaw === null) return;

      try {
        await correctAttendanceRecord(btn.dataset.recordId, {
          clock_in_at: new Date(newInRaw).toISOString(),
          clock_out_at: newOutRaw ? new Date(newOutRaw).toISOString() : null
        });
        document.getElementById('btn-filter').click();
      } catch (error) {
        alert(error.message ?? 'Gagal koreksi presensi.');
      }
    });
  });
}

function formatTime(iso) {
  return new Date(iso).toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function toInputFormat(displayText) {
  const d = new Date(displayText);
  if (isNaN(d)) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
