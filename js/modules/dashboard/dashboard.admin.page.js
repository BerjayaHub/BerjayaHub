import { listRecentAttendanceActivity } from '../attendance/attendance.service.js';

const PAGE_SIZE = 20;

// Dashboard sengaja LINTAS-BU: menampilkan aktivitas dari semua BU yang boleh
// dilihat admin (RLS yang membatasi), tidak tergantung BU aktif di switcher.
export async function renderAdminDashboard(container) {
  container.innerHTML = `
    <h1>Dashboard</h1>
    <p style="color:var(--color-text-muted)">Aktivitas terbaru dari semua Business Unit yang bisa kamu akses.</p>

    <div class="inline-card" style="max-width:560px">
      <h3 style="margin-top:0">Aktivitas Terbaru</h3>
      <div class="activity-feed" id="activity-feed"><p style="font-size:0.85rem;color:var(--color-text-muted)">Memuat...</p></div>
      <button id="btn-load-more" style="margin-top:12px;display:none">Muat lebih banyak</button>
      <p style="font-size:0.78rem;color:var(--color-text-muted);margin-top:12px">
        Menampilkan aktivitas Presensi. Data dihitung langsung dari catatan presensi — tidak terhapus otomatis, hanya bergeser ke halaman berikutnya seiring bertambahnya aktivitas.
      </p>
    </div>
  `;

  const feed = document.getElementById('activity-feed');
  const loadMoreBtn = document.getElementById('btn-load-more');
  let offset = 0;
  let firstPage = true;

  async function loadPage() {
    loadMoreBtn.disabled = true;
    let records;
    try {
      records = await listRecentAttendanceActivity({ limit: PAGE_SIZE, offset });
    } catch (error) {
      if (firstPage) feed.innerHTML = `<p class="error-text">${error.message ?? error}</p>`;
      loadMoreBtn.disabled = false;
      return;
    }

    if (firstPage) feed.innerHTML = '';
    firstPage = false;

    const events = [];
    for (const r of records) {
      const who = r.user_profiles?.full_name ?? 'Staff';
      const where = `${r.outlets?.name ?? '-'}${r.business_units?.name ? ` · ${r.business_units.name}` : ''}`;
      events.push({ time: r.clock_in_at, text: `${who} clock in di ${where}${r.is_storing ? ' (tugas luar)' : ''}` });
      if (r.clock_out_at) events.push({ time: r.clock_out_at, text: `${who} clock out di ${where}` });
    }
    events.sort((a, b) => new Date(b.time) - new Date(a.time));

    feed.insertAdjacentHTML(
      'beforeend',
      events
        .map(
          (e) => `
        <div class="activity-item">
          <span class="activity-icon">🕐</span>
          <div>
            <div>${escapeHtml(e.text)}</div>
            <div class="activity-time">${formatTime(e.time)}</div>
          </div>
        </div>`
        )
        .join('')
    );

    if (feed.children.length === 0) {
      feed.innerHTML = '<p style="font-size:0.85rem;color:var(--color-text-muted)">Belum ada aktivitas.</p>';
    }

    offset += records.length;
    loadMoreBtn.disabled = false;
    loadMoreBtn.style.display = records.length < PAGE_SIZE ? 'none' : 'inline-block';
  }

  loadMoreBtn.addEventListener('click', loadPage);
  await loadPage();
}

function formatTime(iso) {
  return new Date(iso).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
