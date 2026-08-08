import { toast, formDialog, confirmDialog } from '../../core/ui.js';
import {
  getMyTodaySession,
  getMyOpenSession,
  getMySesiTertinggal,
  getMyRecentAttendance,
  clockIn,
  clockOut,
  getGeolocation,
  distanceMeters,
  listAttendanceOutlets,
  getMyNbmBase,
  uploadAttendanceSelfie,
  getExitTaskMode,
  redeemExitOtp,
  getMyFaceDescriptor,
  saveMyFaceDescriptor
} from './attendance.service.js';
import { getShiftSettings, getMyScheduleFor, evaluateLateness, todayWIB, LATE_LABEL, resolveAutoOff, holidayMapOf } from '../shift/shift.service.js';
import { getHolidayPolicy, listHolidays } from './nbm.service.js';
import { openCameraCapture, formatWatermarkText } from './camera-capture.js';
import { openFaceRegistration } from './face-registration.js';
import { loadFaceModels, isSameFace } from './face-recognition.js';
import { pushCardHtml, wirePushCard } from '../../core/push-card.js';
import { loadingHtml } from '../../core/loading.js';
import { dapatkanLokasi, pesanAkurasiBuruk } from '../../core/geolocation.js';

export async function renderAttendancePage(container, ctx) {
  const { userId, businessUnitId, outletId } = ctx;
  container.innerHTML = loadingHtml('Memuat presensi…');
  loadFaceModels().catch(() => {});

  const fallbackBase = { business_unit_id: businessUnitId, outlet_id: outletId };
  const [todaySession, sesiTerbuka, sesiTertinggal, recent, myFaceDescriptor, allOutlets, nbmBase] = await Promise.all([
    getMyTodaySession(),
    // Sesi yang masih terbuka APA PUN TANGGALNYA — inilah yang membuat shift
    // malam bisa clock out esok paginya.
    getMyOpenSession().catch(() => null),
    getMySesiTertinggal().catch(() => null),
    getMyRecentAttendance(),
    getMyFaceDescriptor(),
    listAttendanceOutlets().catch(() => []),
    getMyNbmBase(fallbackBase).catch(() => fallbackBase)
  ]);
  const exitMode = await getExitTaskMode(nbmBase.business_unit_id).catch(() => 'storing');

  // Wajib daftar wajah dulu — TIDAK otomatis clock in setelah daftar.
  if (!myFaceDescriptor) {
    renderFaceRegistrationGate(container, ctx);
    return;
  }

  // Sesi terbuka lintas hari didahulukan. Sebelumnya baris ini hanya melihat
  // presensi HARI INI, jadi shift 6 Agustus 22:00 tidak terlihat lagi pada 7
  // Agustus pagi: tombol Clock Out tak pernah muncul, dan orangnya malah bisa
  // clock in lagi sementara baris kemarin menggantung tanpa jam pulang.
  const openSession = sesiTerbuka ?? (todaySession && !todaySession.clock_out_at ? todaySession : null);
  // "Sudah selesai hari ini" hanya berlaku untuk sesi yang MULAI hari ini.
  // Kalau yang tadi pagi ditutup itu shift semalam, malam ini dia berhak
  // clock in lagi — itu shift berikutnya, bukan pengulangan.
  const doneToday = todaySession && todaySession.clock_out_at ? todaySession : null;

  const outletName = (id) => allOutlets.find((o) => o.id === id)?.name ?? 'Outlet';
  const baseOutlet = allOutlets.find((o) => o.id === nbmBase.outlet_id) || null;

  // Jadwal shift hari ini — hanya kalau OUTLET BASIS staff ini yang mengaktifkan
  // modul Shift. `allOutlets` berisi outlet SEMUA BU (dari RPC security-definer),
  // jadi jangan pakai .some(): satu outlet BU lain yang pakai shift akan bikin
  // staff BU non-shift ikut kena catatan "belum dijadwalkan".
  const shiftOutletActive = !!baseOutlet?.shift_enabled;
  const [mySchedule, shiftSettings] = shiftOutletActive
    ? await Promise.all([
        getMyScheduleFor(todayWIB(), nbmBase.outlet_id).catch(() => null),
        getShiftSettings(nbmBase.business_unit_id).catch(() => ({ late_tolerance_minutes: 10 }))
      ])
    : [null, { late_tolerance_minutes: 10 }];
  const myShift = mySchedule && !mySchedule.is_off ? mySchedule.outlet_shifts : null;

  // Kebijakan hari libur BU basis (0038) — berlaku untuk semua BU, termasuk
  // yang tidak memakai modul Shift.
  const [holidayPolicy, buHolidays] = await Promise.all([
    // Libur rutin ikut OUTLET BASIS staff; kalau outletnya belum diatur,
    // otomatis mewarisi kebijakan BU (jalur untuk BU tanpa outlet).
    getHolidayPolicy(nbmBase.business_unit_id, nbmBase.outlet_id).catch(() => ({ holiday_policy: 'operational', weekly_off_days: [] })),
    listHolidays({ businessUnitId: nbmBase.business_unit_id, outletId: nbmBase.outlet_id }).catch(() => [])
  ]);
  const autoOff = resolveAutoOff(todayWIB(), holidayPolicy, holidayMapOf(buHolidays));

  container.innerHTML = `
    <h1>Presensi</h1>
    ${
      // Sesi yang lebih dari 18 jam belum ditutup TIDAK dipakai sebagai sesi
      // aktif — kalau dipakai, satu kali lupa clock out akan memblokir presensi
      // berhari-hari. Tapi ia juga tidak boleh didiamkan: baris tanpa jam pulang
      // tidak dihitung NBM sama sekali, dan orangnya baru sadar saat gajian.
      sesiTertinggal
        ? `<div class="inline-card" style="border-color:var(--color-danger)">
             <strong style="font-size:0.9rem">⚠️ Ada presensi yang belum clock out</strong>
             <p style="font-size:0.82rem;color:var(--color-text-muted);margin:6px 0 0">
               Clock in <strong>${esc(fmtTanggalPendek(sesiTertinggal.clock_in_at))} ${esc(formatTime(sesiTertinggal.clock_in_at))}</strong>
               di ${esc(outletName(sesiTertinggal.outlet_id))} tidak pernah ditutup, jadi hari itu belum terhitung NBM.
               Minta admin membetulkannya lewat Master Presensi. Kamu tetap bisa presensi seperti biasa hari ini.
             </p>
           </div>`
        : ''
    }
    <div id="att-main"></div>
    ${pushCardHtml({ title: 'Notifikasi Pengingat Clock In' })}
    <h2 style="font-size:1rem;margin-top:24px">Riwayat Terakhir</h2>
    <table class="data-table">
      <thead><tr><th>Outlet</th><th>Clock In</th><th>Clock Out</th></tr></thead>
      <tbody>
        ${
          recent
            .map(
              (r) => `<tr>
                <td>${esc(outletName(r.outlet_id))}</td>
                <td>${formatTime(r.clock_in_at)}</td>
                <td>${r.clock_out_at ? formatTime(r.clock_out_at) : '—'}</td>
              </tr>`
            )
            .join('') || '<tr><td colspan="3">Belum ada riwayat.</td></tr>'
        }
      </tbody>
    </table>
  `;

  const main = container.querySelector('#att-main');
  wirePushCard(container, userId);

  // ---- Sudah selesai hari ini ----
  if (doneToday) {
    main.innerHTML = `
      <div class="att-card att-done fade-in">
        <div class="att-emoji">✅</div>
        <h3>Presensi hari ini sudah lengkap</h3>
        <p>Clock In <strong>${formatTime(doneToday.clock_in_at)}</strong> · Clock Out <strong>${formatTime(doneToday.clock_out_at)}</strong></p>
        <p class="att-hint">Clock in &amp; clock out hanya sekali sehari. Sampai jumpa besok!</p>
      </div>`;
    return;
  }

  // ---- Sedang bekerja -> clock out ----
  if (openSession) {
    let capturedOut = null;
    main.innerHTML = `
      <div class="att-card fade-in">
        <div class="att-status-line"><span class="att-dot"></span> Sedang bekerja sejak <strong>${formatTime(openSession.clock_in_at)}</strong>${
          // Tanggal disebut HANYA kalau clock in-nya bukan hari ini. Tanpa itu,
          // "sejak 22.00" pada pukul 7 pagi terbaca seperti kekeliruan.
          sameDayWIB(openSession.clock_in_at) ? '' : ` <span class="badge badge-pending" style="font-size:0.68rem">${esc(fmtTanggalPendek(openSession.clock_in_at))}</span>`
        }</div>
        <p class="att-hint">Lokasi: ${esc(outletName(openSession.outlet_id))}${openSession.is_storing ? ' · <strong>Tugas Luar</strong>' : ''}</p>
        <div class="att-photo-row">
          <button type="button" class="att-shoot" id="btn-shoot-out"><span>📷</span> Ambil Foto Selfie</button>
          <img id="preview-out" class="selfie-preview" style="display:none" />
        </div>
        <button class="primary" id="btn-clock-out" disabled>Clock Out</button>
        <p class="error-text" id="att-error"></p>
      </div>`;

    const errorEl = main.querySelector('#att-error');
    main.querySelector('#btn-shoot-out').addEventListener('click', async () => {
      errorEl.textContent = '';
      try {
        capturedOut = await openCameraCapture({
          getWatermarkText: () => formatWatermarkText(outletName(openSession.outlet_id), 'Clock Out'),
          requireFace: true
        });
        const preview = main.querySelector('#preview-out');
        preview.src = URL.createObjectURL(capturedOut.blob);
        preview.style.display = 'block';
        main.querySelector('#btn-clock-out').disabled = false;
        toast('Foto siap. Lanjut Clock Out.', 'info');
      } catch (error) {
        errorEl.textContent = error.message ?? 'Gagal mengambil foto.';
      }
    });

    main.querySelector('#btn-clock-out').addEventListener('click', async (e) => {
      errorEl.textContent = '';
      e.target.disabled = true;
      try {
        if (!capturedOut) throw new Error('Ambil foto selfie dulu.');
        if (!capturedOut.descriptor) throw new Error('Wajah tidak terdeteksi di foto. Ulangi dengan pencahayaan cukup & wajah menghadap kamera.');
        if (!isSameFace(capturedOut.descriptor, myFaceDescriptor)) throw new Error('Wajah tidak cocok dengan yang terdaftar. Clock out ditolak.');

        const photoPath = await uploadAttendanceSelfie({ outletId: openSession.outlet_id, kind: 'out', file: capturedOut.blob });
        await clockOut(openSession.id, { photoPath, faceMatch: true });
        toast('Clock out berhasil. Terima kasih atas kerja kerasnya hari ini! 🙌', 'success');
        await renderAttendancePage(container, ctx);
      } catch (error) {
        errorEl.textContent = error.message ?? 'Gagal clock out.';
        e.target.disabled = false;
      }
    });
    return;
  }

  // ---- Belum absen -> clock in ----
  let capturedIn = null;
  let detected = null;
  let mode = 'detecting'; // detecting | inside | outside
  let storing = null; // { reason, method, otpCodeId } bila mode tugas luar dikonfirmasi

  // Libur otomatis (kebijakan BU) diberi tahu duluan — berlaku juga untuk BU
  // yang tidak memakai modul Shift, mis. Divisi Admin.
  const shiftInfoHtml = autoOff.off
    ? `<div class="shift-note shift-note-off">🌴 Hari ini <strong>libur</strong> (${esc(autoOff.reason)}). Presensi tetap bisa dicatat bila memang masuk.</div>`
    : autoOff.holidayName
    ? `<div class="shift-note">🎉 Hari ini <strong>${esc(autoOff.holidayName)}</strong> — BU kamu tetap beroperasi, dan presensimu dihitung dengan tarif hari libur.</div>`
    : !shiftOutletActive
    ? ''
    : mySchedule?.is_off
    ? `<div class="shift-note shift-note-off">🌴 Hari ini kamu <strong>dijadwalkan libur</strong>. Presensi tetap bisa dicatat bila memang masuk.</div>`
    : myShift
    ? `<div class="shift-note">🗓️ Shift hari ini: <strong>${esc(myShift.name)}</strong> ${myShift.start_time.slice(0, 5)}–${myShift.end_time.slice(0, 5)}
         <span style="color:var(--color-text-muted)">· toleransi ${shiftSettings.late_tolerance_minutes} menit</span></div>`
    : `<div class="shift-note shift-note-none">🗓️ Kamu <strong>belum dijadwalkan</strong> hari ini. Presensi tetap bisa, dan akan ditandai “Tanpa jadwal”.</div>`;

  main.innerHTML = `
    <div class="att-card fade-in">
      ${shiftInfoHtml}
      <div class="detect-banner" id="detect-banner">📍 Mendeteksi lokasi kamu…</div>
      <button type="button" id="btn-retry-loc" style="display:none;max-width:200px;margin:6px 0 0">↻ Coba Deteksi Lagi</button>
      <div id="storing-zone"></div>
      <div class="att-photo-row">
        <button type="button" class="att-shoot" id="btn-shoot-in" disabled><span>📷</span> Ambil Foto Selfie</button>
        <img id="preview-in" class="selfie-preview" style="display:none" />
      </div>
      <button class="primary" id="btn-clock-in" disabled>Clock In</button>
      <p class="error-text" id="att-error"></p>
    </div>`;

  const errorEl = main.querySelector('#att-error');
  const banner = main.querySelector('#detect-banner');
  const retryBtn = main.querySelector('#btn-retry-loc');
  // Ketelitian fix yang dipakai untuk deteksi, ikut disimpan ke baris presensi.
  let lokasiAkurasi = null;
  retryBtn.addEventListener('click', () => runDetection());
  const storingZone = main.querySelector('#storing-zone');
  const shootBtn = main.querySelector('#btn-shoot-in');
  const clockInBtn = main.querySelector('#btn-clock-in');

  function syncButtons() {
    const ready = mode === 'inside' || (mode === 'outside' && storing);
    shootBtn.disabled = !ready;
    clockInBtn.disabled = !(ready && capturedIn);
  }

  function renderStoringZone() {
    if (mode !== 'outside') {
      storingZone.innerHTML = '';
      return;
    }
    if (storing) {
      storingZone.innerHTML = `
        <div class="storing-banner fade-in">
          <div class="storing-title">🚩 Kamu dalam mode <strong>Tugas Luar/Storing</strong></div>
          <div class="storing-desc">${esc(storing.reason)}</div>
          <div class="storing-meta">Presensi dicatat di outlet basis: <strong>${esc(baseOutlet?.name ?? '-')}</strong>${storing.method === 'otp' ? ' · OTP terverifikasi' : ''}</div>
          <button type="button" id="btn-cancel-storing">Batalkan mode ini</button>
        </div>`;
      storingZone.querySelector('#btn-cancel-storing').addEventListener('click', () => {
        storing = null;
        capturedIn = null;
        main.querySelector('#preview-in').style.display = 'none';
        renderStoringZone();
        syncButtons();
        toast('Mode tugas luar dibatalkan.', 'info');
      });
    } else {
      storingZone.innerHTML = `
        <div class="storing-prompt fade-in">
          <p>Kamu tidak berada di area outlet manapun. Untuk tetap absen, aktifkan <strong>mode Tugas Luar/Storing</strong> dan isi keterangan tugasmu.</p>
          <button class="primary" id="btn-enable-storing" style="max-width:280px">🚩 Aktifkan Mode Tugas Luar/Storing</button>
        </div>`;
      storingZone.querySelector('#btn-enable-storing').addEventListener('click', openStoringDialog);
    }
    syncButtons();
  }

  async function openStoringDialog() {
    const fields = [
      {
        name: 'reason',
        label: 'Keterangan tugas luar (wajib)',
        type: 'text',
        required: true,
        placeholder: 'mis. antar pesanan ke customer di Serpong'
      }
    ];
    if (exitMode === 'otp') {
      fields.unshift({ name: 'otp', label: 'Kode OTP dari admin (wajib)', type: 'text', required: true, placeholder: '6 digit' });
    }
    const values = await formDialog({
      title: 'Aktifkan Mode Tugas Luar/Storing',
      description:
        'Mode ini untuk staff yang sedang bertugas di luar outlet. Presensi akan ditandai "Tugas Luar/Storing" dan dicatat di outlet basismu.',
      fields,
      submitText: 'Lanjut'
    });
    if (!values) return;
    if (!nbmBase.outlet_id) {
      toast('Kamu belum punya "tempat kerja utama". Minta admin menetapkannya di Master User.', 'error');
      return;
    }

    let method = 'storing';
    let otpCodeId = null;
    if (exitMode === 'otp') {
      try {
        otpCodeId = await redeemExitOtp(values.otp.trim(), nbmBase.business_unit_id);
      } catch (error) {
        toast(error.message ?? 'Gagal memverifikasi OTP.', 'error');
        return;
      }
      if (!otpCodeId) {
        toast('Kode OTP salah, sudah dipakai, atau kedaluwarsa.', 'error');
        return;
      }
      method = 'otp';
    }

    const ok = await confirmDialog({
      title: 'Konfirmasi Mode Tugas Luar',
      message: `Keterangan: "${values.reason}". Presensi akan ditandai sebagai Tugas Luar/Storing di outlet ${baseOutlet?.name ?? 'basis'}. Lanjutkan?`,
      confirmText: 'Ya, aktifkan'
    });
    if (!ok) return;

    storing = { reason: values.reason, method, otpCodeId };
    renderStoringZone();
    toast('Mode Tugas Luar aktif. Silakan ambil foto selfie.', 'success');
  }

  /**
   * Ambang ketelitian yang masih boleh dipakai untuk MENERIMA presensi lewat
   * lingkaran ketelitian. Di atas ini, angkanya terlalu kabur untuk berarti
   * apa pun — HP yang bilang "saya di suatu tempat dalam radius 1 km" tidak
   * sedang membuktikan dia ada di outlet.
   *
   * KONSEKUENSINYA HARUS DISADARI: radius efektif jadi `radius + akurasi`,
   * paling jauh `radius + 250 m`. Itu kelonggaran yang nyata, dan dipilih
   * sadar — fix berbasis wifi/menara di dalam gedung memang jatuh di kisaran
   * 50-250 m, dan itulah kasus orang jujur yang selama ini tertolak.
   *
   * Yang di atas 250 m (mis. "Lokasi Presisi" mati, yang memberi 1-3 km) TIDAK
   * dilonggarkan — orangnya justru diberi tahu cara membetulkannya. Menerima
   * angka sekabur itu tidak akan menolong siapa pun; ia hanya memindahkan
   * kesalahan ke tempat yang lebih sulit dilihat.
   */
  const AKURASI_MAKS_TOLERANSI = 250;

  async function runDetection() {
    banner.className = 'detect-banner';
    banner.innerHTML = '📍 Mencari lokasi kamu…';
    retryBtn.style.display = 'none';
    lokasiAkurasi = null;

    let loc = null;
    let galat = null;
    try {
      loc = await dapatkanLokasi({
        akurasiTarget: 50,
        timeoutMs: 20000,
        // Menunggu 20 detik di depan layar yang diam terasa seperti macet.
        // Angka akurasinya diperlihatkan supaya terlihat ada kemajuan.
        onProgress: ({ accuracy, detik }) => {
          banner.innerHTML = `📍 Mencari lokasi kamu… ketelitian ±${Math.round(accuracy)} m (${detik} dtk)`;
        }
      });
    } catch (e) {
      galat = e;
    }
    lokasiAkurasi = loc?.accuracy ?? null;

    const withCoords = allOutlets.filter((o) => o.latitude != null && o.longitude != null);
    let best = null;
    let bestDist = Infinity;
    let terdekat = null;
    let jarakTerdekat = Infinity;
    let lewatToleransi = false;

    if (loc) {
      for (const o of withCoords) {
        const d = distanceMeters(loc.lat, loc.lng, o.latitude, o.longitude);
        const radius = o.geofence_radius_m ?? 100;
        if (d < jarakTerdekat) {
          jarakTerdekat = d;
          terdekat = o;
        }
        // Diterima kalau titiknya di dalam radius, ATAU kalau lingkaran
        // ketelitiannya masih menyentuh area outlet. Alasannya: HP yang
        // melaporkan "±300 m" tidak sedang mengatakan orangnya di luar — ia
        // sedang mengatakan tidak tahu. Menolak ketidaktahuan sebagai
        // pelanggaran adalah cara membuat orang yang benar-benar hadir tidak
        // bisa absen.
        //
        // Kelonggaran ini dibatasi AKURASI_MAKS_TOLERANSI dan angka akurasinya
        // IKUT DISIMPAN (0075), jadi bisa dipertanggungjawabkan — bukan
        // kelonggaran diam-diam.
        const cocok = d <= radius;
        const cocokLonggar = !cocok && loc.accuracy <= AKURASI_MAKS_TOLERANSI && d - loc.accuracy <= radius;
        if ((cocok || cocokLonggar) && d < bestDist) {
          best = o;
          bestDist = d;
          lewatToleransi = !cocok;
        }
      }
    }

    if (best) {
      detected = best;
      mode = 'inside';
      banner.className = 'detect-banner detect-in';
      banner.innerHTML =
        `✅ Terdeteksi di <strong>${esc(best.business_unit_name)}</strong> / <strong>${esc(best.name)}</strong>` +
        `<div style="font-size:0.74rem;opacity:0.85">${Math.round(bestDist)} m dari titik outlet · ketelitian ±${Math.round(loc.accuracy)} m${
          lewatToleransi ? ' · diterima lewat batas ketelitian' : ''
        }</div>`;
      toast(`Terdeteksi di ${best.name}. Silakan ambil foto selfie.`, 'success');
    } else {
      detected = null;
      mode = 'outside';
      banner.className = 'detect-banner detect-out';
      retryBtn.style.display = 'inline-block';

      if (!loc) {
        // Pesan sesuai JENIS kegagalannya, bukan satu kalimat untuk semua.
        // "GPS mati / izin ditolak" menyuruh orang memeriksa hal yang sudah
        // benar, dan menyembunyikan hal yang sebenarnya salah.
        banner.innerHTML = `⚠️ ${galat?.pesan ?? 'Lokasi tidak bisa diambil.'}`;
      } else if (loc.accuracy > AKURASI_MAKS_TOLERANSI) {
        // Inilah kasus "izin sudah diberikan, orangnya memang di outlet, tapi
        // tetap ditolak". Sebelum ini tidak ada satu pun petunjuk kenapa.
        banner.innerHTML = `⚠️ ${pesanAkurasiBuruk(loc.accuracy)}`;
      } else {
        banner.innerHTML =
          `⚠️ Kamu <strong>di luar area outlet</strong> Berjaya manapun.` +
          (terdekat
            ? `<div style="font-size:0.74rem;opacity:0.85">Terdekat: ${esc(terdekat.name)} — ${Math.round(jarakTerdekat)} m (radius ${terdekat.geofence_radius_m ?? 100} m) · ketelitian ±${Math.round(loc.accuracy)} m</div>`
            : '');
      }
    }
    renderStoringZone();
    syncButtons();
  }

  shootBtn.addEventListener('click', async () => {
    errorEl.textContent = '';
    try {
      const wmOutlet = mode === 'inside' ? detected.name : `${baseOutlet?.name ?? 'Tugas Luar'} (Tugas Luar)`;
      capturedIn = await openCameraCapture({
        getWatermarkText: () => formatWatermarkText(wmOutlet, 'Clock In'),
        requireFace: true
      });
      const preview = main.querySelector('#preview-in');
      preview.src = URL.createObjectURL(capturedIn.blob);
      preview.style.display = 'block';
      syncButtons();
      toast('Foto siap. Lanjut Clock In.', 'info');
    } catch (error) {
      errorEl.textContent = error.message ?? 'Gagal mengambil foto.';
    }
  });

  clockInBtn.addEventListener('click', async (e) => {
    errorEl.textContent = '';
    e.target.disabled = true;
    try {
      if (!capturedIn) throw new Error('Ambil foto selfie dulu.');
      if (!capturedIn.descriptor) throw new Error('Wajah tidak terdeteksi di foto. Ulangi dengan pencahayaan cukup & wajah menghadap kamera.');
      if (!isSameFace(capturedIn.descriptor, myFaceDescriptor)) throw new Error('Wajah tidak cocok dengan yang terdaftar. Presensi ditolak.');

      const isStoring = mode === 'outside';
      if (isStoring && !storing) throw new Error('Aktifkan mode Tugas Luar/Storing dulu sebelum clock in.');
      const recordOutletId = isStoring ? nbmBase.outlet_id : detected.id;
      const recordBuId = isStoring ? nbmBase.business_unit_id : detected.business_unit_id;

      // Foto diunggah DULU, baru record dibuat -> tidak ada presensi tanpa foto.
      // Penilaian keterlambatan terhadap jadwal shift (snapshot, ikut riwayat).
      let lateInfo = { status: null, minutes: null };
      if (autoOff.off) {
        // Libur menurut kebijakan BU -> masuk hari ini tidak dinilai terlambat,
        // walau BU-nya tidak memakai modul Shift sama sekali.
        lateInfo = { status: 'off_day', minutes: null };
      } else if (shiftOutletActive) {
        if (mySchedule?.is_off) lateInfo = { status: 'off_day', minutes: null };
        else if (myShift) lateInfo = evaluateLateness(new Date(), myShift, shiftSettings.late_tolerance_minutes);
        else lateInfo = { status: 'no_schedule', minutes: null };
      }

      const photoPath = await uploadAttendanceSelfie({ outletId: recordOutletId, kind: 'in', file: capturedIn.blob });
      const location = await getGeolocation();
      // Kalau fix untuk pencatatan tidak membawa akurasi, pakai angka dari
      // deteksi tadi — lebih baik daripada kolomnya kosong dan keluhan
      // berikutnya kembali mustahil ditelusuri.
      if (location && location.accuracy == null && lokasiAkurasi != null) location.accuracy = lokasiAkurasi;
      await clockIn({
        userId,
        businessUnitId: recordBuId,
        outletId: recordOutletId,
        nbmBusinessUnitId: nbmBase.business_unit_id,
        nbmOutletId: nbmBase.outlet_id,
        location,
        isStoring,
        exitMethod: isStoring ? storing.method : null,
        exitReason: isStoring ? storing.reason : null,
        exitOtpCodeId: isStoring ? storing.otpCodeId : null,
        faceMatch: true,
        photoPath,
        shiftId: myShift?.id ?? null,
        shiftName: myShift?.name ?? null,
        lateMinutes: lateInfo.minutes,
        lateStatus: lateInfo.status
      });

      if (lateInfo.status === 'late') {
        toast(`Clock in tercatat, tapi ${lateInfo.minutes} menit melewati toleransi — ditandai Terlambat.`, 'warning');
      } else if (lateInfo.status === 'tolerance') {
        toast(`Clock in berhasil (${lateInfo.minutes} menit, masih dalam toleransi).`, 'success');
      } else {
        toast(isStoring ? 'Clock in (Tugas Luar/Storing) berhasil. Hati-hati di jalan! 🚩' : 'Clock in berhasil. Selamat bekerja! 👋', 'success');
      }
      await renderAttendancePage(container, ctx);
    } catch (error) {
      errorEl.textContent = error.message ?? 'Gagal clock in.';
      e.target.disabled = false;
    }
  });

  runDetection();
}

// ---- Gerbang registrasi wajah ----

function renderFaceRegistrationGate(container, ctx) {
  container.innerHTML = `
    <h1>Presensi</h1>
    <div class="att-card fade-in">
      <div class="att-emoji">🙂</div>
      <h3>Daftarkan Wajah Dulu</h3>
      <p class="att-hint">
        Sebelum bisa clock in/out, daftarkan wajahmu sekali di sini. Yang disimpan hanya
        <strong>pola wajah (angka)</strong>, bukan fotonya. Kalau wajah tidak cocok saat absen, presensi ditolak.
      </p>
      <button class="primary" id="btn-register-face" style="max-width:260px">📷 Daftarkan Wajah Sekarang</button>
      <p class="error-text" id="face-register-error"></p>
    </div>
  `;

  container.querySelector('#btn-register-face').addEventListener('click', async (e) => {
    e.target.disabled = true;
    const errorEl = container.querySelector('#face-register-error');
    errorEl.textContent = '';
    try {
      const descriptor = await openFaceRegistration();
      await saveMyFaceDescriptor(descriptor);
      toast('Wajah berhasil didaftarkan.', 'success');
      // Sengaja TIDAK langsung clock in — tampilkan konfirmasi dulu.
      container.innerHTML = `
        <h1>Presensi</h1>
        <div class="att-card att-done fade-in">
          <div class="att-emoji">✅</div>
          <h3>Wajah Berhasil Didaftarkan</h3>
          <p class="att-hint">Pendaftaran wajah <strong>tidak</strong> mencatat presensi. Lanjutkan bila kamu memang mau clock in sekarang.</p>
          <button class="primary" id="btn-continue" style="max-width:260px">Lanjut ke Presensi</button>
        </div>`;
      container.querySelector('#btn-continue').addEventListener('click', () => renderAttendancePage(container, ctx));
    } catch (error) {
      errorEl.textContent = error.message ?? 'Gagal mendaftarkan wajah.';
      e.target.disabled = false;
    }
  });
}

/** Apakah timestamp ini jatuh di tanggal yang sama dengan sekarang, menurut WIB? */
function sameDayWIB(iso) {
  const opsi = { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' };
  return new Date(iso).toLocaleDateString('sv-SE', opsi) === new Date().toLocaleDateString('sv-SE', opsi);
}

/** 'Rab, 06 Agu' — dipakai menandai sesi yang dimulai hari sebelumnya. */
function fmtTanggalPendek(iso) {
  return new Date(iso).toLocaleDateString('id-ID', { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'Asia/Jakarta' });
}

function formatTime(iso) {
  return new Date(iso).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
