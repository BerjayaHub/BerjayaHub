import { supabase } from '../../config/supabase-client.js';
import { getMyOpenSession, getMyRecentAttendance, clockIn, clockOut } from './attendance.service.js';

export async function renderAttendancePage(container, { userId, businessUnitId, outletId }) {
  container.innerHTML = `<p>Memuat presensi...</p>`;

  const [openSession, recent] = await Promise.all([getMyOpenSession(), getMyRecentAttendance()]);

  let outletOptions = '';
  if (!outletId) {
    const { data: outlets } = await supabase
      .from('outlets')
      .select('id, name')
      .eq('business_unit_id', businessUnitId)
      .order('name');
    outletOptions = (outlets ?? []).map((o) => `<option value="${o.id}">${o.name}</option>`).join('');
  }

  container.innerHTML = `
    <h1>Presensi</h1>
    <div class="inline-card">
      ${
        openSession
          ? `
            <p>Kamu sedang bekerja sejak <strong>${formatTime(openSession.clock_in_at)}</strong>.</p>
            <button class="primary" id="btn-clock-out">Clock Out</button>
          `
          : `
            <p>Kamu belum absen hari ini.</p>
            ${
              outletId
                ? ''
                : `<div class="field"><label>Outlet</label><select id="clock-in-outlet">${outletOptions}</select></div>`
            }
            <button class="primary" id="btn-clock-in">Clock In</button>
          `
      }
      <p class="error-text" id="attendance-error"></p>
    </div>

    <h2 style="font-size:1rem;margin-top:24px">Riwayat Terakhir</h2>
    <table class="data-table">
      <thead><tr><th>Outlet</th><th>Clock In</th><th>Clock Out</th></tr></thead>
      <tbody>
        ${
          recent
            .map(
              (r) => `
              <tr>
                <td>${r.outlets?.name ?? '-'}</td>
                <td>${formatTime(r.clock_in_at)}</td>
                <td>${r.clock_out_at ? formatTime(r.clock_out_at) : '—'}</td>
              </tr>`
            )
            .join('') || '<tr><td colspan="3">Belum ada riwayat.</td></tr>'
        }
      </tbody>
    </table>
  `;

  const errorEl = document.getElementById('attendance-error');

  document.getElementById('btn-clock-in')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      const chosenOutletId = outletId ?? document.getElementById('clock-in-outlet')?.value;
      if (!chosenOutletId) throw new Error('Pilih outlet dulu.');
      await clockIn({ userId, businessUnitId, outletId: chosenOutletId });
      await renderAttendancePage(container, { userId, businessUnitId, outletId });
    } catch (error) {
      errorEl.textContent = error.message ?? 'Gagal clock in.';
      e.target.disabled = false;
    }
  });

  document.getElementById('btn-clock-out')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      await clockOut(openSession.id);
      await renderAttendancePage(container, { userId, businessUnitId, outletId });
    } catch (error) {
      errorEl.textContent = error.message ?? 'Gagal clock out.';
      e.target.disabled = false;
    }
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
