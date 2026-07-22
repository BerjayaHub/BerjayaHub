import { supabase } from '../../config/supabase-client.js';
import {
  getMyOpenSession,
  getMyRecentAttendance,
  clockIn,
  clockOut,
  getGeolocation,
  getOutletGeofence,
  distanceMeters,
  uploadAttendanceSelfie,
  setClockInPhoto,
  getExitTaskMode,
  redeemExitOtp
} from './attendance.service.js';

export async function renderAttendancePage(container, { userId, businessUnitId, outletId }) {
  container.innerHTML = `<p>Memuat presensi...</p>`;

  const [openSession, recent, exitMode] = await Promise.all([
    getMyOpenSession(),
    getMyRecentAttendance(),
    getExitTaskMode(businessUnitId)
  ]);

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
            <div class="field">
              <label>Foto Selfie (wajib untuk clock out)</label>
              <input type="file" accept="image/*" capture="user" id="clock-out-photo" required />
            </div>
            <button class="primary" id="btn-clock-out">Clock Out</button>
          `
          : `
            <p>Kamu belum absen hari ini.</p>
            ${
              outletId
                ? ''
                : `<div class="field"><label>Outlet</label><select id="clock-in-outlet">${outletOptions}</select></div>`
            }
            <div class="field">
              <label>Foto Selfie (wajib untuk clock in)</label>
              <input type="file" accept="image/*" capture="user" id="clock-in-photo" required />
            </div>
            ${exitTaskFieldHtml(exitMode)}
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

      const photoFile = document.getElementById('clock-in-photo').files[0];
      if (!photoFile) throw new Error('Foto selfie wajib diisi untuk clock in.');

      let isStoring = false;
      let exitMethod = null;
      let exitReason = null;
      let exitOtpCodeId = null;

      if (exitMode === 'storing') {
        isStoring = document.getElementById('clock-in-storing')?.checked ?? false;
        exitMethod = isStoring ? 'storing' : null;
        exitReason = isStoring ? document.getElementById('clock-in-exit-reason')?.value || null : null;
      } else if (exitMode === 'otp') {
        const otpInput = document.getElementById('clock-in-otp')?.value?.trim();
        if (otpInput) {
          const codeId = await redeemExitOtp(otpInput, businessUnitId);
          if (!codeId) throw new Error('Kode OTP salah, sudah dipakai, atau kedaluwarsa.');
          isStoring = true;
          exitMethod = 'otp';
          exitOtpCodeId = codeId;
          exitReason = document.getElementById('clock-in-exit-reason')?.value || null;
        }
      }

      const location = await getGeolocation();

      if (!isStoring) {
        const outlet = await getOutletGeofence(chosenOutletId);
        if (outlet.latitude != null && outlet.longitude != null) {
          if (!location) {
            throw new Error(`Outlet ini butuh validasi lokasi. Aktifkan izin lokasi di browser/HP kamu, lalu coba lagi.`);
          }
          const dist = distanceMeters(location.lat, location.lng, outlet.latitude, outlet.longitude);
          if (dist > outlet.geofence_radius_m) {
            throw new Error(
              `Kamu berada ${Math.round(dist)}m dari outlet (maks ${outlet.geofence_radius_m}m). Mendekatlah ke outlet, atau isi tugas keluar kalau memang sedang bertugas di luar.`
            );
          }
        }
      }

      const record = await clockIn({
        userId,
        businessUnitId,
        outletId: chosenOutletId,
        location,
        isStoring,
        exitMethod,
        exitReason,
        exitOtpCodeId
      });

      const photoPath = await uploadAttendanceSelfie({
        outletId: chosenOutletId,
        recordId: record.id,
        kind: 'in',
        file: photoFile
      });
      await setClockInPhoto(record.id, photoPath);

      await renderAttendancePage(container, { userId, businessUnitId, outletId });
    } catch (error) {
      errorEl.textContent = error.message ?? 'Gagal clock in.';
      e.target.disabled = false;
    }
  });

  document.getElementById('btn-clock-out')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      const photoFile = document.getElementById('clock-out-photo').files[0];
      if (!photoFile) throw new Error('Foto selfie wajib diisi untuk clock out.');

      const photoPath = await uploadAttendanceSelfie({
        outletId: openSession.outlet_id,
        recordId: openSession.id,
        kind: 'out',
        file: photoFile
      });

      await clockOut(openSession.id, { photoPath });
      await renderAttendancePage(container, { userId, businessUnitId, outletId });
    } catch (error) {
      errorEl.textContent = error.message ?? 'Gagal clock out.';
      e.target.disabled = false;
    }
  });

  // Toggle input reason muncul cuma kalau storing dicentang (mode storing)
  document.getElementById('clock-in-storing')?.addEventListener('change', (e) => {
    const reasonField = document.getElementById('clock-in-exit-reason-wrap');
    if (reasonField) reasonField.style.display = e.target.checked ? 'block' : 'none';
  });
}

function exitTaskFieldHtml(exitMode) {
  if (exitMode === 'otp') {
    return `
      <div class="field">
        <label>Kode OTP Tugas Keluar (isi kalau sedang bertugas di luar outlet)</label>
        <input type="text" id="clock-in-otp" placeholder="Kosongkan kalau tidak ada tugas keluar" />
      </div>
      <div class="field">
        <label>Keterangan tujuan (opsional)</label>
        <input type="text" id="clock-in-exit-reason" placeholder="misal: antar barang ke customer" />
      </div>
    `;
  }
  return `
    <div class="field" style="display:flex;align-items:center;gap:8px">
      <input type="checkbox" id="clock-in-storing" style="width:auto" />
      <label for="clock-in-storing" style="margin:0">Tugas storing (di luar outlet)</label>
    </div>
    <div class="field" id="clock-in-exit-reason-wrap" style="display:none">
      <label>Keterangan tujuan (opsional)</label>
      <input type="text" id="clock-in-exit-reason" placeholder="misal: antar barang ke customer" />
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
