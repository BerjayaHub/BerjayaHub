import {
  listAttendanceForAdmin,
  correctAttendanceRecord,
  listOutletsWithGeofence,
  setOutletLocation
} from './attendance.service.js';
import { renderNbmSettingsTab } from './nbm-settings.admin.page.js';
import { renderNbmReportTab } from './nbm-report.admin.page.js';

const TABS = [
  { key: 'presensi', label: 'Presensi' },
  { key: 'nbm-settings', label: 'Pengaturan NBM & Lembur' },
  { key: 'nbm-report', label: 'Rekap NBM' }
];

export async function renderAttendanceAdminPage(container, { businessUnitId }) {
  container.innerHTML = `
    <h1>Master Presensi</h1>
    <div class="tab-bar" id="attendance-tabs">
      ${TABS.map((t, i) => `<button class="tab-btn ${i === 0 ? 'active' : ''}" data-tab="${t.key}">${t.label}</button>`).join('')}
    </div>
    <div id="attendance-tab-content"></div>
  `;

  const content = document.getElementById('attendance-tab-content');

  async function showTab(key) {
    container.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === key));
    if (key === 'presensi') await renderPresensiTab(content, businessUnitId);
    if (key === 'nbm-settings') await renderNbmSettingsTab(content, businessUnitId);
    if (key === 'nbm-report') await renderNbmReportTab(content, businessUnitId);
  }

  container.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => showTab(btn.dataset.tab));
  });

  await showTab('presensi');
}

async function renderPresensiTab(container, businessUnitId) {
  container.innerHTML = `<p>Memuat presensi...</p>`;

  const outlets = await listOutletsWithGeofence(businessUnitId);
  const filters = { businessUnitId, outletId: '', dateFrom: '', dateTo: '' };

  async function refresh() {
    const records = await listAttendanceForAdmin(filters);
    container.querySelector('#attendance-table-body').innerHTML =
      records.map((r) => rowHtml(r)).join('') || '<tr><td colspan="6">Tidak ada data.</td></tr>';
    wireEditButtons(container);
  }

  container.innerHTML = `
    <details class="inline-card" style="max-width:640px">
      <summary style="cursor:pointer;font-weight:600">Pengaturan Lokasi Outlet (Geofencing)</summary>
      <table class="data-table" style="margin-top:12px">
        <thead><tr><th>Outlet</th><th>Koordinat</th><th>Radius</th><th>Aksi</th></tr></thead>
        <tbody id="outlet-geofence-body">
          ${(outlets ?? []).map((o) => outletGeofenceRowHtml(o)).join('')}
        </tbody>
      </table>
      <p style="font-size:0.8rem;color:var(--color-text-muted);margin-top:8px">
        Kalau koordinat belum diisi, staff bisa clock in dari mana saja (geofence belum aktif untuk outlet itu).
        Staff yang centang "Tugas storing" juga otomatis lewati geofence.
      </p>
    </details>

    <div class="inline-card" style="max-width:640px;display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end;margin-top:16px">
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
        <tr><th>Staff</th><th>Outlet</th><th>Clock In</th><th>Koordinat In</th><th>Clock Out</th><th>Aksi</th></tr>
      </thead>
      <tbody id="attendance-table-body"></tbody>
    </table>
  `;

  wireOutletGeofenceButtons(container, businessUnitId);

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
  const coord = r.clock_in_lat != null ? `${r.clock_in_lat.toFixed(5)}, ${r.clock_in_lng.toFixed(5)}` : '-';
  const storingTag = r.is_storing ? ' <span class="scope-badge">storing</span>' : '';
  return `
    <tr data-record-id="${r.id}">
      <td>${r.user_profiles?.full_name ?? '-'}</td>
      <td>${r.outlets?.name ?? '-'}${storingTag}</td>
      <td>${formatTime(r.clock_in_at)}</td>
      <td style="font-size:0.78rem">${coord}</td>
      <td>${r.clock_out_at ? formatTime(r.clock_out_at) : '—'}</td>
      <td><button class="btn-edit" data-record-id="${r.id}">Koreksi</button></td>
    </tr>
  `;
}

function outletGeofenceRowHtml(o) {
  const coord = o.latitude != null ? `${o.latitude.toFixed(5)}, ${o.longitude.toFixed(5)}` : 'Belum diset';
  return `
    <tr data-outlet-id="${o.id}">
      <td>${o.name}</td>
      <td style="font-size:0.8rem">${coord}</td>
      <td>${o.geofence_radius_m}m</td>
      <td><button class="btn-set-geofence" data-outlet-id="${o.id}">Atur Lokasi</button></td>
    </tr>
  `;
}

function wireOutletGeofenceButtons(container, businessUnitId) {
  container.querySelectorAll('.btn-set-geofence').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const lat = prompt('Latitude outlet (contoh: -6.301944):');
      if (lat === null || lat.trim() === '') return;
      const lng = prompt('Longitude outlet (contoh: 106.652778):');
      if (lng === null || lng.trim() === '') return;
      const radius = prompt('Radius toleransi (meter):', '100');
      if (radius === null) return;
      try {
        await setOutletLocation(btn.dataset.outletId, {
          latitude: parseFloat(lat),
          longitude: parseFloat(lng),
          geofence_radius_m: parseInt(radius, 10) || 100
        });
        const outlets = await listOutletsWithGeofence(businessUnitId);
        container.querySelector('#outlet-geofence-body').innerHTML = outlets.map((o) => outletGeofenceRowHtml(o)).join('');
        wireOutletGeofenceButtons(container, businessUnitId);
      } catch (error) {
        alert(error.message ?? 'Gagal menyimpan lokasi outlet.');
      }
    });
  });
}

function wireEditButtons(container) {
  container.querySelectorAll('.btn-edit').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const row = container.querySelector(`tr[data-record-id="${btn.dataset.recordId}"]`);
      const currentIn = row.children[2].textContent;
      const currentOut = row.children[4].textContent === '—' ? '' : row.children[4].textContent;

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
