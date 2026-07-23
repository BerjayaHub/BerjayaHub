import { supabase } from '../../config/supabase-client.js';
import { toast } from '../../core/ui.js';
import {
  getMyTodaySession,
  getMyRecentAttendance,
  clockIn,
  clockOut,
  getGeolocation,
  getOutletGeofence,
  distanceMeters,
  uploadAttendanceSelfie,
  setClockInPhoto,
  getExitTaskMode,
  redeemExitOtp,
  getMyFaceDescriptor,
  saveMyFaceDescriptor
} from './attendance.service.js';
import { openCameraCapture, formatWatermarkText } from './camera-capture.js';
import { openFaceRegistration } from './face-registration.js';
import { loadFaceModels, isSameFace } from './face-recognition.js';
import {
  isPushSupported,
  isPushConfigured,
  isSubscribedOnThisDevice,
  getPermissionStatus,
  enableReminderNotifications
} from './push-notifications.js';

export async function renderAttendancePage(container, { userId, businessUnitId, outletId }) {
  container.innerHTML = `<p>Memuat presensi...</p>`;
  loadFaceModels().catch(() => {}); // mulai load di background, tidak perlu ditunggu

  const [todaySession, recent, exitMode, myFaceDescriptor] = await Promise.all([
    getMyTodaySession(),
    getMyRecentAttendance(),
    getExitTaskMode(businessUnitId),
    getMyFaceDescriptor()
  ]);

  // Sesi terbuka hari ini (belum clock out) -> boleh clock out.
  const openSession = todaySession && !todaySession.clock_out_at ? todaySession : null;
  // Sudah clock in DAN clock out hari ini -> presensi hari ini selesai, tidak boleh clock-in lagi.
  const doneToday = todaySession && todaySession.clock_out_at ? todaySession : null;

  // Staff wajib daftar wajah dulu sebelum bisa clock in/out sama sekali.
  if (!myFaceDescriptor) {
    renderFaceRegistrationGate(container, { userId, businessUnitId, outletId });
    return;
  }

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
        doneToday
          ? `
            <p style="font-size:1.05rem"><strong>✅ Presensi hari ini sudah lengkap.</strong></p>
            <p style="color:var(--color-text-muted);font-size:0.9rem">
              Clock In <strong>${formatTime(doneToday.clock_in_at)}</strong> &middot;
              Clock Out <strong>${formatTime(doneToday.clock_out_at)}</strong>.<br>
              Clock in &amp; clock out hanya bisa sekali sehari. Sampai jumpa besok!
            </p>
          `
          : openSession
          ? `
            <p>Kamu sedang bekerja sejak <strong>${formatTime(openSession.clock_in_at)}</strong>.</p>
            <div class="field">
              <label>Foto Selfie (wajib untuk clock out)</label>
              <button type="button" id="btn-shoot-out" style="max-width:220px">📷 Ambil Foto Selfie</button>
              <img id="preview-out" class="selfie-preview" style="display:none" />
            </div>
            <button class="primary" id="btn-clock-out" disabled>Clock Out</button>
          `
          : `
            <p>Kamu belum absen hari ini.</p>
            ${
              outletId
                ? ''
                : `<div class="field"><label>Outlet</label><select id="clock-in-outlet">${outletOptions}</select></div>`
            }
            ${exitTaskFieldHtml(exitMode)}
            <div class="field">
              <label>Foto Selfie (wajib untuk clock in)</label>
              <button type="button" id="btn-shoot-in" style="max-width:220px">📷 Ambil Foto Selfie</button>
              <img id="preview-in" class="selfie-preview" style="display:none" />
            </div>
            <button class="primary" id="btn-clock-in" disabled>Clock In</button>
          `
      }
      <p class="error-text" id="attendance-error"></p>
    </div>

    ${notificationCardHtml()}

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
  let capturedIn = null; // { blob, descriptor }
  let capturedOut = null;

  wireNotificationCard(container, userId);

  // ---- Clock In ----
  document.getElementById('btn-shoot-in')?.addEventListener('click', async () => {
    errorEl.textContent = '';
    try {
      const chosenOutletId = outletId ?? document.getElementById('clock-in-outlet')?.value;
      if (!chosenOutletId) throw new Error('Pilih outlet dulu sebelum ambil foto.');
      const outlet = await getOutletGeofence(chosenOutletId);

      capturedIn = await openCameraCapture({
        getWatermarkText: () => formatWatermarkText(outlet.name, 'Clock In')
      });
      const preview = document.getElementById('preview-in');
      preview.src = URL.createObjectURL(capturedIn.blob);
      preview.style.display = 'block';
      document.getElementById('btn-clock-in').disabled = false;
    } catch (error) {
      errorEl.textContent = error.message ?? 'Gagal mengambil foto.';
    }
  });

  document.getElementById('btn-clock-in')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      const chosenOutletId = outletId ?? document.getElementById('clock-in-outlet')?.value;
      if (!chosenOutletId) throw new Error('Pilih outlet dulu.');
      if (!capturedIn) throw new Error('Ambil foto selfie dulu.');

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

      // Wajah tidak cocok TIDAK memblokir clock in -- cuma ditandai untuk direview admin.
      const faceMatch = capturedIn.descriptor ? isSameFace(capturedIn.descriptor, myFaceDescriptor) : null;

      const record = await clockIn({
        userId,
        businessUnitId,
        outletId: chosenOutletId,
        location,
        isStoring,
        exitMethod,
        exitReason,
        exitOtpCodeId,
        faceMatch
      });

      const photoPath = await uploadAttendanceSelfie({
        outletId: chosenOutletId,
        recordId: record.id,
        kind: 'in',
        file: capturedIn.blob
      });
      await setClockInPhoto(record.id, photoPath);

      toast(
        faceMatch === false
          ? 'Clock in berhasil, tapi wajah kurang cocok — ditandai untuk review admin.'
          : 'Clock in berhasil. Selamat bekerja! 👋',
        faceMatch === false ? 'warning' : 'success'
      );

      await renderAttendancePage(container, { userId, businessUnitId, outletId });
    } catch (error) {
      errorEl.textContent = error.message ?? 'Gagal clock in.';
      e.target.disabled = false;
    }
  });

  // ---- Clock Out ----
  document.getElementById('btn-shoot-out')?.addEventListener('click', async () => {
    errorEl.textContent = '';
    try {
      const outlet = await getOutletGeofence(openSession.outlet_id);
      capturedOut = await openCameraCapture({
        getWatermarkText: () => formatWatermarkText(outlet.name, 'Clock Out')
      });
      const preview = document.getElementById('preview-out');
      preview.src = URL.createObjectURL(capturedOut.blob);
      preview.style.display = 'block';
      document.getElementById('btn-clock-out').disabled = false;
    } catch (error) {
      errorEl.textContent = error.message ?? 'Gagal mengambil foto.';
    }
  });

  document.getElementById('btn-clock-out')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      if (!capturedOut) throw new Error('Ambil foto selfie dulu.');

      const photoPath = await uploadAttendanceSelfie({
        outletId: openSession.outlet_id,
        recordId: openSession.id,
        kind: 'out',
        file: capturedOut.blob
      });

      const faceMatch = capturedOut.descriptor ? isSameFace(capturedOut.descriptor, myFaceDescriptor) : null;
      await clockOut(openSession.id, { photoPath, faceMatch });

      toast(
        faceMatch === false
          ? 'Clock out berhasil, tapi wajah kurang cocok — ditandai untuk review admin.'
          : 'Clock out berhasil. Terima kasih atas kerja kerasnya hari ini! 🙌',
        faceMatch === false ? 'warning' : 'success'
      );

      await renderAttendancePage(container, { userId, businessUnitId, outletId });
    } catch (error) {
      errorEl.textContent = error.message ?? 'Gagal clock out.';
      e.target.disabled = false;
    }
  });

  document.getElementById('clock-in-storing')?.addEventListener('change', (e) => {
    const reasonField = document.getElementById('clock-in-exit-reason-wrap');
    if (reasonField) reasonField.style.display = e.target.checked ? 'block' : 'none';
  });
}

// ---- Gerbang registrasi wajah (wajib sebelum bisa presensi sama sekali) ----

function renderFaceRegistrationGate(container, { userId, businessUnitId, outletId }) {
  container.innerHTML = `
    <h1>Presensi</h1>
    <div class="inline-card">
      <h3 style="margin-top:0">Daftarkan Wajah Dulu</h3>
      <p style="font-size:0.9rem;color:var(--color-text-muted)">
        Sebelum bisa clock in/out, kamu perlu daftarkan wajah sekali di sini. Foto ini
        dipakai untuk mencocokkan wajah kamu setiap presensi -- bukan disimpan sebagai
        foto, hanya pola wajah (angka) yang tersimpan.
      </p>
      <button class="primary" id="btn-register-face" style="max-width:240px">📷 Daftarkan Wajah Sekarang</button>
      <p class="error-text" id="face-register-error"></p>
    </div>
  `;

  document.getElementById('btn-register-face').addEventListener('click', async (e) => {
    e.target.disabled = true;
    const errorEl = document.getElementById('face-register-error');
    errorEl.textContent = '';
    try {
      const descriptor = await openFaceRegistration();
      await saveMyFaceDescriptor(descriptor);
      await renderAttendancePage(container, { userId, businessUnitId, outletId });
    } catch (error) {
      errorEl.textContent = error.message ?? 'Gagal mendaftarkan wajah.';
      e.target.disabled = false;
    }
  });
}

// ---- Kartu notifikasi pengingat clock in ----

function notificationCardHtml() {
  if (!isPushSupported()) return '';
  return `
    <div class="inline-card" id="notif-card" style="margin-top:16px">
      <h3 style="margin-top:0;font-size:0.95rem">Notifikasi Pengingat Clock In</h3>
      <p style="font-size:0.85rem;color:var(--color-text-muted)" id="notif-status">Memeriksa status...</p>
      <button id="btn-enable-notif" style="max-width:260px">🔔 Aktifkan Notifikasi Pengingat</button>
    </div>
  `;
}

async function wireNotificationCard(container, userId) {
  const card = document.getElementById('notif-card');
  if (!card) return;
  const statusEl = document.getElementById('notif-status');
  const btn = document.getElementById('btn-enable-notif');

  async function refreshStatus() {
    const subscribed = await isSubscribedOnThisDevice();
    if (subscribed) {
      statusEl.textContent = 'Aktif ✓ — kamu akan diingatkan kalau lupa clock in.';
      btn.style.display = 'none';
    } else if (getPermissionStatus() === 'denied') {
      statusEl.textContent = 'Izin notifikasi diblokir di browser/HP kamu. Aktifkan lewat pengaturan browser kalau ingin dapat pengingat.';
      btn.style.display = 'none';
    } else if (!isPushConfigured()) {
      statusEl.textContent = 'Fitur ini belum diaktifkan admin sistem.';
      btn.style.display = 'none';
    } else {
      statusEl.textContent = 'Belum aktif. Nyalakan supaya kamu dapat pengingat kalau lupa clock in.';
      btn.style.display = 'inline-block';
    }
  }

  btn?.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      await enableReminderNotifications(userId);
      await refreshStatus();
    } catch (error) {
      statusEl.textContent = error.message ?? 'Gagal mengaktifkan notifikasi.';
      btn.disabled = false;
    }
  });

  await refreshStatus();
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
