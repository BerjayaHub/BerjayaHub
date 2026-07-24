import { toast } from '../../core/ui.js';
import {
  getMyTodaySession,
  getMyRecentAttendance,
  clockIn,
  clockOut,
  getGeolocation,
  distanceMeters,
  listAttendanceOutlets,
  getMyNbmBase,
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

  const fallbackBase = { business_unit_id: businessUnitId, outlet_id: outletId };
  const [todaySession, recent, myFaceDescriptor, allOutlets, nbmBase] = await Promise.all([
    getMyTodaySession(),
    getMyRecentAttendance(),
    getMyFaceDescriptor(),
    listAttendanceOutlets().catch(() => []),
    getMyNbmBase(fallbackBase).catch(() => fallbackBase)
  ]);
  const exitMode = await getExitTaskMode(nbmBase.business_unit_id).catch(() => 'storing');

  // Staff wajib daftar wajah dulu sebelum bisa clock in/out sama sekali.
  if (!myFaceDescriptor) {
    renderFaceRegistrationGate(container, { userId, businessUnitId, outletId });
    return;
  }

  const openSession = todaySession && !todaySession.clock_out_at ? todaySession : null;
  const doneToday = todaySession && todaySession.clock_out_at ? todaySession : null;

  const outletName = (id) => allOutlets.find((o) => o.id === id)?.name ?? 'Outlet';
  const baseOutlet = allOutlets.find((o) => o.id === nbmBase.outlet_id) || null;

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
            <p>Kamu sedang bekerja sejak <strong>${formatTime(openSession.clock_in_at)}</strong> di <strong>${outletName(openSession.outlet_id)}</strong>.</p>
            <div class="field">
              <label>Foto Selfie (wajib untuk clock out)</label>
              <button type="button" id="btn-shoot-out" style="max-width:220px">📷 Ambil Foto Selfie</button>
              <img id="preview-out" class="selfie-preview" style="display:none" />
            </div>
            <button class="primary" id="btn-clock-out" disabled>Clock Out</button>
          `
          : `
            <p>Kamu belum absen hari ini.</p>
            <div class="detect-banner" id="detect-banner">📍 Mendeteksi lokasi kamu...</div>
            <div id="outside-options" style="display:none">${outsideOptionsHtml(exitMode)}</div>
            <div class="field">
              <label>Foto Selfie (wajib untuk clock in)</label>
              <button type="button" id="btn-shoot-in" style="max-width:220px" disabled>📷 Ambil Foto Selfie</button>
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

  // ---- Auto-deteksi lokasi (hanya di state clock in) ----
  let detected = null; // outlet terdeteksi (punya koordinat), atau null kalau di luar
  let mode = 'outside';

  async function runDetection() {
    const banner = document.getElementById('detect-banner');
    if (!banner) return;
    const loc = await getGeolocation();
    const withCoords = allOutlets.filter((o) => o.latitude != null && o.longitude != null);
    let best = null;
    let bestDist = Infinity;
    if (loc) {
      for (const o of withCoords) {
        const d = distanceMeters(loc.lat, loc.lng, o.latitude, o.longitude);
        if (d <= (o.geofence_radius_m ?? 100) && d < bestDist) {
          best = o;
          bestDist = d;
        }
      }
    }

    if (best) {
      detected = best;
      mode = 'inside';
      banner.className = 'detect-banner detect-in';
      banner.innerHTML = `✅ Terdeteksi di <strong>${best.business_unit_name}</strong> / <strong>${best.name}</strong>`;
      document.getElementById('outside-options').style.display = 'none';
      toast(`Terdeteksi di ${best.business_unit_name} / ${best.name}`, 'success');
    } else {
      detected = null;
      mode = 'outside';
      banner.className = 'detect-banner detect-out';
      banner.innerHTML = loc
        ? `⚠️ Kamu di luar outlet Berjaya manapun.`
        : `⚠️ Lokasi tidak terdeteksi (GPS mati/ditolak).`;
      document.getElementById('outside-options').style.display = 'block';
      toast(
        exitMode === 'otp'
          ? 'Di luar outlet Berjaya — isi kode OTP dari admin untuk lanjut.'
          : 'Di luar outlet Berjaya — tandai sebagai tugas luar untuk lanjut.',
        'warning'
      );
    }
    document.getElementById('btn-shoot-in').disabled = false;
  }
  if (!doneToday && !openSession) runDetection();

  // ---- Clock In ----
  document.getElementById('btn-shoot-in')?.addEventListener('click', async () => {
    errorEl.textContent = '';
    try {
      const wmOutlet = mode === 'inside' ? detected.name : baseOutlet?.name ?? 'Tugas Luar';
      capturedIn = await openCameraCapture({
        getWatermarkText: () => formatWatermarkText(wmOutlet, 'Clock In'),
        requireFace: true
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
      if (!capturedIn) throw new Error('Ambil foto selfie dulu.');

      // Face recognition memblokir: wajah tidak cocok -> presensi DITOLAK.
      if (!capturedIn.descriptor) {
        throw new Error('Wajah tidak terdeteksi di foto. Ulangi foto dengan pencahayaan cukup & wajah menghadap kamera.');
      }
      if (!isSameFace(capturedIn.descriptor, myFaceDescriptor)) {
        throw new Error('Wajah tidak cocok dengan yang terdaftar. Presensi ditolak.');
      }

      let recordOutletId;
      let recordBuId;
      let isStoring = false;
      let exitMethod = null;
      let exitReason = null;
      let exitOtpCodeId = null;

      if (mode === 'inside') {
        recordOutletId = detected.id;
        recordBuId = detected.business_unit_id;
      } else {
        // Di luar outlet -> catat di outlet basis (tempat kerja utama), tandai tugas luar.
        if (!nbmBase.outlet_id) {
          throw new Error('Kamu di luar outlet & belum punya "tempat kerja utama" (outlet). Minta admin menetapkannya di Master User.');
        }
        recordOutletId = nbmBase.outlet_id;
        recordBuId = nbmBase.business_unit_id;
        isStoring = true;
        exitReason = document.getElementById('clock-in-exit-reason')?.value || null;
        if (exitMode === 'otp') {
          const otp = document.getElementById('clock-in-otp')?.value?.trim();
          if (!otp) throw new Error('Kamu di luar outlet. Isi kode OTP dari admin dulu.');
          const codeId = await redeemExitOtp(otp, nbmBase.business_unit_id);
          if (!codeId) throw new Error('Kode OTP salah, sudah dipakai, atau kedaluwarsa.');
          exitMethod = 'otp';
          exitOtpCodeId = codeId;
        } else {
          exitMethod = 'storing';
        }
      }

      const location = await getGeolocation();
      const record = await clockIn({
        userId,
        businessUnitId: recordBuId,
        outletId: recordOutletId,
        nbmBusinessUnitId: nbmBase.business_unit_id,
        nbmOutletId: nbmBase.outlet_id,
        location,
        isStoring,
        exitMethod,
        exitReason,
        exitOtpCodeId,
        faceMatch: true
      });

      const photoPath = await uploadAttendanceSelfie({
        outletId: recordOutletId,
        recordId: record.id,
        kind: 'in',
        file: capturedIn.blob
      });
      await setClockInPhoto(record.id, photoPath);

      toast('Clock in berhasil. Selamat bekerja! 👋', 'success');
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
      capturedOut = await openCameraCapture({
        getWatermarkText: () => formatWatermarkText(outletName(openSession.outlet_id), 'Clock Out'),
        requireFace: true
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

      // Face recognition memblokir clock out juga.
      if (!capturedOut.descriptor) {
        throw new Error('Wajah tidak terdeteksi di foto. Ulangi foto dengan pencahayaan cukup & wajah menghadap kamera.');
      }
      if (!isSameFace(capturedOut.descriptor, myFaceDescriptor)) {
        throw new Error('Wajah tidak cocok dengan yang terdaftar. Clock out ditolak.');
      }

      const photoPath = await uploadAttendanceSelfie({
        outletId: openSession.outlet_id,
        recordId: openSession.id,
        kind: 'out',
        file: capturedOut.blob
      });

      await clockOut(openSession.id, { photoPath, faceMatch: true });

      toast('Clock out berhasil. Terima kasih atas kerja kerasnya hari ini! 🙌', 'success');
      await renderAttendancePage(container, { userId, businessUnitId, outletId });
    } catch (error) {
      errorEl.textContent = error.message ?? 'Gagal clock out.';
      e.target.disabled = false;
    }
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
        foto, hanya pola wajah (angka) yang tersimpan. Kalau wajah tidak cocok saat absen,
        presensi akan ditolak.
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

/** Field yang muncul saat staff terdeteksi DI LUAR semua outlet (tugas luar / OTP). */
function outsideOptionsHtml(exitMode) {
  if (exitMode === 'otp') {
    return `
      <div class="field">
        <label>Kode OTP Tugas Keluar (wajib, minta ke admin)</label>
        <input type="text" id="clock-in-otp" placeholder="6 digit dari admin" />
      </div>
      <div class="field">
        <label>Keterangan tujuan (opsional)</label>
        <input type="text" id="clock-in-exit-reason" placeholder="misal: antar barang ke customer" />
      </div>
    `;
  }
  return `
    <div class="field">
      <label>Keterangan tugas luar (opsional)</label>
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
