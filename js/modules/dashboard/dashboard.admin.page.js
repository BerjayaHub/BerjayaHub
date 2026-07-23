import { listAttendanceForAdmin } from '../attendance/attendance.service.js';

export async function renderAdminDashboard(container, { businessUnitId }) {
  container.innerHTML = `<p>Memuat dashboard...</p>`;

  const records = await listAttendanceForAdmin({ businessUnitId, outletId: '', dateFrom: '', dateTo: '' });

  const events = [];
  for (const r of records) {
    events.push({
      time: r.clock_in_at,
      text: `${r.user_profiles?.full_name ?? 'Staff'} clock in di ${r.outlets?.name ?? '-'}${r.is_storing ? ' (tugas keluar)' : ''}`,
      icon: '🕐'
    });
    if (r.clock_out_at) {
      events.push({
        time: r.clock_out_at,
        text: `${r.user_profiles?.full_name ?? 'Staff'} clock out di ${r.outlets?.name ?? '-'}`,
        icon: '🕐'
      });
    }
  }
  events.sort((a, b) => new Date(b.time) - new Date(a.time));
  const recentEvents = events.slice(0, 15);

  container.innerHTML = `
    <h1>Dashboard</h1>
    <p style="color:var(--color-text-muted)">Ringkasan aktivitas terbaru.</p>

    <div class="inline-card" style="max-width:520px">
      <h3 style="margin-top:0">Aktivitas Terbaru</h3>
      <div class="activity-feed">
        ${
          recentEvents
            .map(
              (e) => `
            <div class="activity-item">
              <span class="activity-icon">${e.icon}</span>
              <div>
                <div>${e.text}</div>
                <div class="activity-time">${formatTime(e.time)}</div>
              </div>
            </div>`
            )
            .join('') || '<p style="font-size:0.85rem;color:var(--color-text-muted)">Belum ada aktivitas.</p>'
        }
      </div>
      <p style="font-size:0.78rem;color:var(--color-text-muted);margin-top:12px">
        Saat ini menampilkan aktivitas Presensi. Pengajuan Cuti & pergerakan Inventory akan otomatis muncul di sini juga setelah modul-modul itu dibangun.
      </p>
    </div>
  `;
}

function formatTime(iso) {
  return new Date(iso).toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  });
}
