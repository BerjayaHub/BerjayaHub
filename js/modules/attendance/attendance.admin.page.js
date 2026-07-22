import {
  listAttendanceForAdmin,
  correctAttendanceRecord,
  listOutletsWithGeofence,
  setOutletLocation,
  getExitTaskMode,
  setExitTaskMode,
  generateExitOtp,
  listRecentExitOtp,
  getSignedPhotoUrl,
  reverseGeocode
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
  const exitMode = await getExitTaskMode(businessUnitId);
  const filters = { businessUnitId, outletId: '', dateFrom: '', dateTo: '' };

  async function refresh() {
    const records = await listAttendanceForAdmin(filters);
    container.querySelector('#attendance-table-body').innerHTML =
      records.map((r) => rowHtml(r)).join('') || '<tr><td colspan="7">Tidak ada data.</td></tr>';
    wireEditButtons(container);
    wirePhotoButtons(container);
    wireAddressButtons(container);
  }

  container.innerHTML = `
    <div class="inline-card" style="max-width:640px">
      <h3 style="margin-top:0">Mode Tugas Keluar (BU ini)</h3>
      <div class="field" style="max-width:220px">
        <select id="exit-mode-select">
          <option value="storing" ${exitMode === 'storing' ? 'selected' : ''}>Storing (tanpa OTP)</option>
          <option value="otp" ${exitMode === 'otp' ? 'selected' : ''}>OTP (kode dari admin)</option>
        </select>
      </div>
      <button class="primary" id="btn-save-exit-mode" style="max-width:140px;margin-top:8px">Simpan Mode</button>

      <div id="otp-generator-wrap" style="margin-top:16px;${exitMode === 'otp' ? '' : 'display:none'}">
        <button class="primary" id="btn-generate-otp" style="max-width:200px">+ Generate Kode OTP</button>
        <div id="otp-result" style="margin-top:8px"></div>
        <table class="data-table" style="margin-top:12px">
          <thead><tr><th>Kode</th><th>Kedaluwarsa</th><th>Dipakai oleh</th></tr></thead>
          <tbody id="otp-recent-body"></tbody>
        </table>
      </div>
    </div>

    <details class="inline-card" style="max-width:640px;margin-top:16px">
      <summary style="cursor:pointer;font-weight:600">Pengaturan Lokasi Outlet (Geofencing)</summary>
      <table class="data-table" style="margin-top:12px">
        <thead><tr><th>Outlet</th><th>Koordinat</th><th>Radius</th><th>Aksi</th></tr></thead>
        <tbody id="outlet-geofence-body">
          ${(outlets ?? []).map((o) => outletGeofenceRowHtml(o)).join('')}
        </tbody>
      </table>
      <p style="font-size:0.8rem;color:var(--color-text-muted);margin-top:8px">
        Kalau koordinat belum diisi, staff bisa clock in dari mana saja (geofence belum aktif untuk outlet itu).
        Staff yang mengisi tugas keluar juga otomatis lewati geofence.
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
        <tr><th>Staff</th><th>Outlet</th><th>Clock In</th><th>Foto</th><th>Alamat</th><th>Clock Out</th><th>Aksi</th></tr>
      </thead>
      <tbody id="attendance-table-body"></tbody>
    </table>
  `;

  wireOutletGeofenceButtons(container, businessUnitId);

  document.getElementById('exit-mode-select').addEventListener('change', (e) => {
    document.getElementById('otp-generator-wrap').style.display = e.target.value === 'otp' ? 'block' : 'none';
  });

  document.getElementById('btn-save-exit-mode').addEventListener('click', async () => {
    try {
      await setExitTaskMode(businessUnitId, document.getElementById('exit-mode-select').value);
      alert('Mode tugas keluar disimpan.');
    } catch (error) {
      alert(error.message ?? 'Gagal menyimpan mode.');
    }
  });

  document.getElementById('btn-generate-otp').addEventListener('click', async () => {
    try {
      const otp = await generateExitOtp(businessUnitId);
      document.getElementById('otp-result').innerHTML = `
        <div class="scope-badge" style="font-size:1rem;padding:6px 12px">
          Kode: <strong>${otp.code}</strong> — berlaku sampai ${formatTime(otp.expires_at)}
        </div>
      `;
      await refreshOtpList();
    } catch (error) {
      alert(error.message ?? 'Gagal generate kode OTP.');
    }
  });

  async function refreshOtpList() {
    const codes = await listRecentExitOtp(businessUnitId);
    document.getElementById('otp-recent-body').innerHTML =
      codes
        .map(
          (c) => `
        <tr>
          <td>${c.code}</td>
          <td>${formatTime(c.expires_at)}</td>
          <td>${c.used_at ? (c.user_profiles?.full_name ?? 'Ya') : '-'}</td>
        </tr>`
        )
        .join('') || '<tr><td colspan="3">Belum ada kode.</td></tr>';
  }
  if (exitMode === 'otp') await refreshOtpList();

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
  const storingTag = r.is_storing ? ` <span class="scope-badge">${r.exit_method ?? 'tugas keluar'}</span>` : '';
  const fotoButtons = [
    r.clock_in_photo_path ? `<button class="btn-view-photo" data-path="${r.clock_in_photo_path}">In</button>` : '',
    r.clock_out_photo_path ? `<button class="btn-view-photo" data-path="${r.clock_out_photo_path}">Out</button>` : ''
  ]
    .filter(Boolean)
    .join(' ');

  return `
    <tr data-record-id="${r.id}" data-lat="${r.clock_in_lat ?? ''}" data-lng="${r.clock_in_lng ?? ''}">
      <td>${r.user_profiles?.full_name ?? '-'}</td>
      <td>${r.outlets?.name ?? '-'}${storingTag}</td>
      <td>${formatTime(r.clock_in_at)}</td>
      <td>${fotoButtons || '-'}</td>
      <td style="font-size:0.78rem;max-width:180px" class="address-cell">
        ${r.clock_in_lat != null ? '<button class="btn-view-address">Lihat Alamat</button>' : '-'}
      </td>
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

function wirePhotoButtons(container) {
  container.querySelectorAll('.btn-view-photo').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        const url = await getSignedPhotoUrl(btn.dataset.path);
        if (url) window.open(url, '_blank');
        else alert('Foto tidak ditemukan.');
      } catch (error) {
        alert(error.message ?? 'Gagal membuka foto.');
      }
    });
  });
}

function wireAddressButtons(container) {
  container.querySelectorAll('.btn-view-address').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const row = btn.closest('tr');
      const lat = parseFloat(row.dataset.lat);
      const lng = parseFloat(row.dataset.lng);
      btn.textContent = 'Memuat...';
      btn.disabled = true;
      try {
        const address = await reverseGeocode(lat, lng);
        row.querySelector('.address-cell').textContent = address;
      } catch (error) {
        btn.textContent = 'Gagal, coba lagi';
        btn.disabled = false;
      }
    });
  });
}

function wireEditButtons(container) {
  container.querySelectorAll('.btn-edit').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const row = container.querySelector(`tr[data-record-id="${btn.dataset.recordId}"]`);
      const currentIn = row.children[2].textContent;
      const currentOut = row.children[5].textContent === '—' ? '' : row.children[5].textContent;

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
