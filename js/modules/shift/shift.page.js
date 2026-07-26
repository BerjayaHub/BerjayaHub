import { listAttendanceOutlets } from '../attendance/attendance.service.js';
import { listBuStaff } from '../leave/leave.service.js';
import { listOutletShifts, listSchedules, weekRange, addDays, todayWIB, shiftCrossesMidnight, resolveAutoOff, holidayMapOf } from './shift.service.js';
import { getHolidayPolicy, listHolidays } from '../attendance/nbm.service.js';

/**
 * Jadwal Shift (Staff App): tabel jadwal satu minggu — baris staff, kolom tanggal.
 * Default minggu berjalan, bisa geser minggu / pilih tanggal acuan.
 */
export async function renderShiftPage(container, { userId, businessUnitId, outletId }) {
  container.innerHTML = `<p style="color:var(--color-text-muted)">Memuat jadwal...</p>`;

  let outlets;
  try {
    outlets = (await listAttendanceOutlets()).filter((o) => o.business_unit_id === businessUnitId && o.shift_enabled);
  } catch (error) {
    container.innerHTML = `<p class="error-text">Gagal memuat: ${error.message ?? error}</p>`;
    return;
  }
  if (!outlets.length) {
    container.innerHTML = `<h1>Jadwal Shift</h1><p style="color:var(--color-text-muted)">Modul Shift belum diaktifkan untuk outlet manapun di BU ini.</p>`;
    return;
  }
  const state = { outletId: outlets.some((o) => o.id === outletId) ? outletId : outlets[0].id, anchor: todayWIB() };

  container.innerHTML = `
    <h1>Jadwal Shift</h1>
    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin-bottom:10px">
      <div class="field" style="margin:0;max-width:220px"><label>Outlet</label>
        <select id="sp-outlet">${outlets.map((o) => `<option value="${o.id}"${o.id === state.outletId ? ' selected' : ''}>${esc(o.name)}</option>`).join('')}</select>
      </div>
      <div class="field" style="margin:0;max-width:170px"><label>Minggu</label>
        <input type="date" id="sp-date" value="${state.anchor}" />
      </div>
      <button id="sp-prev">←</button>
      <button id="sp-today">Minggu ini</button>
      <button id="sp-next">→</button>
    </div>
    <div id="sp-grid"></div>
  `;

  const grid = container.querySelector('#sp-grid');
  const dateInput = container.querySelector('#sp-date');
  container.querySelector('#sp-outlet').addEventListener('change', (e) => {
    state.outletId = e.target.value;
    draw();
  });
  dateInput.addEventListener('change', () => {
    state.anchor = dateInput.value || todayWIB();
    draw();
  });
  container.querySelector('#sp-prev').addEventListener('click', () => {
    state.anchor = addDays(state.anchor, -7);
    dateInput.value = state.anchor;
    draw();
  });
  container.querySelector('#sp-next').addEventListener('click', () => {
    state.anchor = addDays(state.anchor, 7);
    dateInput.value = state.anchor;
    draw();
  });
  container.querySelector('#sp-today').addEventListener('click', () => {
    state.anchor = todayWIB();
    dateInput.value = state.anchor;
    draw();
  });

  async function draw() {
    grid.innerHTML = `<p>Memuat...</p>`;
    const wk = weekRange(state.anchor);
    let staff, shifts, schedules, policy, holidays;
    try {
      [staff, shifts, schedules, policy, holidays] = await Promise.all([
        listBuStaff(businessUnitId),
        listOutletShifts(state.outletId),
        listSchedules({ outletId: state.outletId, from: wk.from, to: wk.to }),
        getHolidayPolicy(businessUnitId).catch(() => ({ holiday_policy: 'operational', weekly_off_days: [] })),
        listHolidays({ businessUnitId, outletId: state.outletId }).catch(() => [])
      ]);
    } catch (error) {
      grid.innerHTML = `<p class="error-text">${error.message ?? error}</p>`;
      return;
    }
    const holidayMap = holidayMapOf(holidays);
    const autoOff = new Map(wk.days.map((d) => [d, resolveAutoOff(d, policy, holidayMap)]));
    const map = new Map();
    for (const s of schedules) map.set(`${s.user_id}|${s.work_date}`, s);
    // Tampilkan staff yang punya jadwal minggu ini + diri sendiri (biar ringkas).
    const scheduled = new Set(schedules.map((s) => s.user_id));
    const rows = staff.filter((s) => scheduled.has(s.user_id) || s.user_id === userId);
    const today = todayWIB();

    grid.innerHTML = `
      <p style="font-size:0.82rem;color:var(--color-text-muted);margin:0 0 8px">
        Periode <strong>${fmtDate(wk.from)} – ${fmtDate(wk.to)}</strong>
      </p>
      <div class="table-scroll">
        <table class="data-table shift-grid">
          <thead>
            <tr><th style="min-width:140px">Staff</th>${wk.days
              .map(
                (d) => `<th style="text-align:center${d === today ? ';background:color-mix(in srgb, var(--color-primary) 12%, transparent)' : ''}">
                  ${dayLabel(d)}<div style="font-weight:400;font-size:0.72rem;color:var(--color-text-muted)">${fmtShort(d)}</div></th>`
              )
              .join('')}</tr>
          </thead>
          <tbody>
            ${
              rows
                .map(
                  (st) => `<tr${st.user_id === userId ? ' class="shift-me"' : ''}>
                    <td>${esc(st.full_name)}${st.user_id === userId ? ' <span class="badge badge-approved" style="font-size:0.65rem">Saya</span>' : ''}</td>
                    ${wk.days
                      .map((d) => {
                        const cur = map.get(`${st.user_id}|${d}`);
                        const auto = autoOff.get(d);
                        // Libur otomatis dari kebijakan BU — tidak perlu baris jadwal.
                        if (!cur && auto?.off)
                          return `<td style="text-align:center"><span class="shift-chip shift-off">Libur</span>
                            <div style="font-size:0.66rem;color:var(--color-text-muted)">${esc(auto.reason)}</div></td>`;
                        if (!cur) return `<td style="text-align:center;color:var(--color-text-muted)">–</td>`;
                        if (cur.is_off) return `<td style="text-align:center"><span class="shift-chip shift-off">Libur</span></td>`;
                        const sh = cur.outlet_shifts;
                        return `<td style="text-align:center"><span class="shift-chip">${esc(sh?.name ?? 'Shift')}</span>
                          <div style="font-size:0.68rem;color:var(--color-text-muted)">${sh ? `${sh.start_time.slice(0, 5)}–${sh.end_time.slice(0, 5)}` : ''}</div></td>`;
                      })
                      .join('')}
                  </tr>`
                )
                .join('') || `<tr><td colspan="8">Belum ada jadwal minggu ini.</td></tr>`
            }
          </tbody>
        </table>
      </div>
      ${
        shifts.filter((s) => s.is_active).length
          ? `<p style="font-size:0.76rem;color:var(--color-text-muted);margin-top:8px">${shifts
              .filter((s) => s.is_active)
              .map((s) => `<strong>${esc(s.name)}</strong> ${s.start_time.slice(0, 5)}–${s.end_time.slice(0, 5)}${shiftCrossesMidnight(s) ? ' (+1 hari)' : ''}`)
              .join(' · ')}</p>`
          : ''
      }
    `;
  }

  await draw();
}

function dayLabel(d) {
  return new Date(d + 'T00:00:00').toLocaleDateString('id-ID', { weekday: 'short' });
}
function fmtShort(d) {
  return new Date(d + 'T00:00:00').toLocaleDateString('id-ID', { day: '2-digit', month: 'short' });
}
function fmtDate(d) {
  return new Date(d + 'T00:00:00').toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
