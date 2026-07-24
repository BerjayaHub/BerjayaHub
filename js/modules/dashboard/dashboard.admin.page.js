import { listRecentAttendanceActivity } from '../attendance/attendance.service.js';
import { listRecentLeaveActivity } from '../leave/leave.service.js';

const PAGE_SIZE = 20;

// =========================================================
// Feed aktivitas multi-sumber (lintas-BU). Setiap modul menyumbang aktivitas
// lewat sebuah "provider": async ({ before, limit }) => Event[]
//   Event = { time: ISO string, text, icon }
// Tambah modul baru (Inventory, Ceklis Kebersihan, dll) cukup dengan
// menambah satu provider ke array ACTIVITY_PROVIDERS di bawah — sisanya
// (merge, urut, paginasi) otomatis.
// =========================================================

function fmtRange(a, b) {
  const f = (d) => new Date(d + 'T00:00:00').toLocaleDateString('id-ID', { day: '2-digit', month: 'short' });
  return a === b ? f(a) : `${f(a)}–${f(b)}`;
}

async function attendanceProvider({ before, limit }) {
  const records = await listRecentAttendanceActivity({ before, limit });
  const events = [];
  for (const r of records) {
    const who = r.user_profiles?.full_name ?? 'Staff';
    const where = `${r.outlets?.name ?? '-'}${r.business_units?.name ? ` · ${r.business_units.name}` : ''}`;
    events.push({ time: r.clock_in_at, icon: '🕐', text: `${who} clock in di ${where}${r.is_storing ? ' (tugas luar)' : ''}` });
    if (r.clock_out_at) events.push({ time: r.clock_out_at, icon: '🕐', text: `${who} clock out di ${where}` });
  }
  return events;
}

async function leaveProvider({ before, limit }) {
  const rows = await listRecentLeaveActivity({ before, limit });
  const events = [];
  for (const r of rows) {
    const who = r.user_profiles?.full_name ?? 'Staff';
    const type = r.leave_types?.name ?? 'cuti';
    const bu = r.business_units?.name ? ` · ${r.business_units.name}` : '';
    const range = fmtRange(r.start_date, r.end_date);
    events.push({ time: r.created_at, icon: '📝', text: `${who} mengajukan ${type} (${range})${bu}` });
    if (r.reviewed_at && (r.status === 'approved' || r.status === 'rejected')) {
      events.push({
        time: r.reviewed_at,
        icon: r.status === 'approved' ? '✅' : '❌',
        text: `Cuti ${who} (${range}) ${r.status === 'approved' ? 'disetujui' : 'ditolak'}${bu}`
      });
    }
  }
  return events;
}

const ACTIVITY_PROVIDERS = [attendanceProvider, leaveProvider];

export async function renderAdminDashboard(container) {
  container.innerHTML = `
    <h1>Dashboard</h1>
    <p style="color:var(--color-text-muted)">Aktivitas terbaru dari semua modul & Business Unit yang bisa kamu akses.</p>

    <div class="inline-card" style="max-width:560px">
      <h3 style="margin-top:0">Aktivitas Terbaru</h3>
      <div class="activity-feed" id="activity-feed"><p style="font-size:0.85rem;color:var(--color-text-muted)">Memuat...</p></div>
      <button id="btn-load-more" style="margin-top:12px;display:none">Muat lebih banyak</button>
      <p style="font-size:0.78rem;color:var(--color-text-muted);margin-top:12px">
        Menggabungkan Presensi & Pengajuan Cuti. Modul lain (Inventory, Ceklis Kebersihan, dll) otomatis ikut tampil di sini begitu dibangun.
      </p>
    </div>
  `;

  const feed = document.getElementById('activity-feed');
  const loadMoreBtn = document.getElementById('btn-load-more');
  const shownKeys = new Set();
  let cursor = new Date().toISOString(); // ambil yang lebih lama dari ini
  let firstPage = true;

  async function loadPage() {
    loadMoreBtn.disabled = true;
    let batches;
    try {
      batches = await Promise.all(ACTIVITY_PROVIDERS.map((p) => p({ before: cursor, limit: PAGE_SIZE }).catch(() => [])));
    } catch (error) {
      if (firstPage) feed.innerHTML = `<p class="error-text">${error.message ?? error}</p>`;
      loadMoreBtn.disabled = false;
      return;
    }

    const merged = batches
      .flat()
      .filter((e) => e.time && new Date(e.time).toISOString() < cursor)
      .filter((e) => {
        const key = `${e.time}|${e.text}`;
        if (shownKeys.has(key)) return false;
        shownKeys.add(key);
        return true;
      })
      .sort((a, b) => new Date(b.time) - new Date(a.time));

    const page = merged.slice(0, PAGE_SIZE);

    if (firstPage) {
      feed.innerHTML = '';
      firstPage = false;
    }
    feed.insertAdjacentHTML('beforeend', page.map(eventHtml).join(''));

    if (feed.children.length === 0) {
      feed.innerHTML = '<p style="font-size:0.85rem;color:var(--color-text-muted)">Belum ada aktivitas.</p>';
    }

    if (page.length > 0) cursor = new Date(page[page.length - 1].time).toISOString();
    loadMoreBtn.disabled = false;
    loadMoreBtn.style.display = page.length >= PAGE_SIZE ? 'inline-block' : 'none';
  }

  loadMoreBtn.addEventListener('click', loadPage);
  await loadPage();
}

function eventHtml(e) {
  return `
    <div class="activity-item">
      <span class="activity-icon">${e.icon}</span>
      <div>
        <div>${escapeHtml(e.text)}</div>
        <div class="activity-time">${formatTime(e.time)}</div>
      </div>
    </div>`;
}

function formatTime(iso) {
  return new Date(iso).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
