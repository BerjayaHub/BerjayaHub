import { toast, formDialog, confirmDialog, infoDialog } from '../../core/ui.js';
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
  saveMyFaceDescriptor,
  getSetelanPresensi,
  listIstirahat,
  mulaiIstirahat,
  selesaiIstirahat,
  getOutletGeofence
} from './attendance.service.js';
import { setelanEfektif, bolehMulaiIstirahat, totalMenitIstirahat, BATAS_ISTIRAHAT_JAM } from './istirahat.js';
import { getShiftSettings, getMyScheduleFor, evaluateLateness, todayWIB, LATE_LABEL, resolveAutoOff, holidayMapOf } from '../shift/shift.service.js';
import { getHolidayPolicy, listHolidays } from './nbm.service.js';
import { openCameraCapture, formatWatermarkText } from './camera-capture.js';
import { openFaceRegistration } from './face-registration.js';
import { loadFaceModels, isSameFace } from './face-recognition.js';
import { pushCardHtml, wirePushCard } from '../../core/push-card.js';
import { loadingHtml, sekaliJalan } from '../../core/loading.js';
import { dapatkanLokasi, pesanAkurasiBuruk } from '../../core/geolocation.js';

/**
 * Menolak aksi presensi yang dilakukan di luar area outletnya.
 *
 * Dipakai Istirahat & Kembali — clock in punya jalurnya sendiri yang lebih
 * rumit (ia masih MEMILIH outlet; di sini outletnya sudah pasti).
 *
 * Tiga hal yang sengaja TIDAK menolak:
 *
 *   - outlet tanpa koordinat  -> geofence-nya memang belum aktif, aturan yang
 *     sama dengan clock in ("kalau koordinat belum diisi, staff bisa clock in
 *     dari mana saja")
 *   - sesi Tugas Luar/Storing -> orangnya memang sedang tidak di outlet
 *   - GPS yang gagal dibaca   -> ditolak dengan pesan yang menyebut GPS, bukan
 *     dibiarkan lolos. Kalau kegagalan GPS diloloskan, seluruh gerbang ini
 *     bisa dilewati cukup dengan mematikan izin lokasi.
 */
async function pastikanDiAreaOutlet(sesi, aksi) {
  if (sesi?.is_storing) return;

  let outlet = null;
  try {
    outlet = await getOutletGeofence(sesi.outlet_id);
  } catch {
    // Gagal membaca setelan outlet bukan bukti orangnya di luar area.
    return;
  }
  if (outlet?.latitude == null || outlet?.longitude == null) return;

  let loc = null;
  try {
    loc = await dapatkanLokasi({ akurasiTarget: 50, timeoutMs: 20000 });
  } catch {
    loc = null;
  }
  if (!loc) {
    throw new Error(`Lokasi tidak terbaca, jadi ${aksi} belum bisa dicatat. Nyalakan GPS lalu coba lagi.`);
  }

  const jarak = distanceMeters(loc.lat, loc.lng, outlet.latitude, outlet.longitude);
  const radius = outlet.geofence_radius_m ?? 100;
  // Ketelitian GPS ikut diberi kelonggaran — menolak orang yang BERDIRI di
  // dalam outlet karena sinyalnya meleset 30 meter akan membuat fitur ini
  // dimatikan dalam seminggu.
  if (jarak > radius + Math.min(loc.accuracy ?? 0, 50)) {
    throw new Error(
      `Kamu ${Math.round(jarak)} m dari ${outlet.name} (radius ${radius} m), jadi ${aksi} belum bisa dicatat.`
    );
  }
}

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

    // ISTIRAHAT (0138) — TIDAK BERPENGARUH KE NBM SAMA SEKALI.
    //
    // Diambil atau tidak, lupa kembali atau tidak, jam kerja yang dibayar tetap
    // sama. Yang dicatat di sini hanya masuk ke rekap admin. Ditulis di layar
    // juga (di bawah), supaya staff tidak menahan diri beristirahat karena
    // mengira NBM-nya terpotong.
    const setelan = await getSetelanPresensi(openSession.outlet_id).catch(() => null);
    const setelanAktif = setelanEfektif(setelan, null);
    const istirahat = await listIstirahat(openSession.id).catch(() => []);
    const berjalan = istirahat.find((b) => !b.selesai_at) ?? null;
    const rekapIstirahat = totalMenitIstirahat(istirahat);

    const jamWib = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(11, 16);
    const bolehMulai = bolehMulaiIstirahat({
      setelan: setelanAktif,
      jamSekarang: jamWib,
      sedangIstirahat: !!berjalan,
      // Satu istirahat per hari kerja. Satu baris presensi = satu hari kerja,
      // termasuk yang melewati tengah malam.
      sudahIstirahat: istirahat.length > 0
    });

    main.innerHTML = `
      <div class="att-card fade-in">
        <div class="att-status-line"><span class="att-dot"></span> Sedang bekerja sejak <strong>${formatTime(openSession.clock_in_at)}</strong>${
          // Tanggal disebut HANYA kalau clock in-nya bukan hari ini. Tanpa itu,
          // "sejak 22.00" pada pukul 7 pagi terbaca seperti kekeliruan.
          sameDayWIB(openSession.clock_in_at) ? '' : ` <span class="badge badge-pending" style="font-size:0.68rem">${esc(fmtTanggalPendek(openSession.clock_in_at))}</span>`
        }</div>
        <p class="att-hint">Lokasi: ${esc(outletName(openSession.outlet_id))}${openSession.is_storing ? ' · <strong>Tugas Luar</strong>' : ''}</p>

        <div class="att-istirahat">
          ${
            berjalan
              ? `<div class="att-status-line" style="color:var(--color-warning,#8a5800)">
                   ☕ Sedang istirahat sejak <strong>${formatTime(berjalan.mulai_at)}</strong>
                 </div>
                 <p class="att-hint" style="color:var(--color-danger);font-weight:600">
                   ⚠️ Wajib absen kembali begitu istirahatmu selesai.
                 </p>
                 <p class="att-hint">
                   Kelalaian absen kembali tercatat di rekap dan ditandai untuk atasanmu.
                 </p>`
              : `<button id="btn-istirahat-mulai"${bolehMulai.boleh ? '' : ' disabled'}>☕ Ambil Istirahat</button>
                 ${
                   // SEBABNYA DIKATAKAN. Tombol yang mati tanpa keterangan akan
                   // ditekan berulang kali lalu dilaporkan sebagai aplikasi rusak.
                   bolehMulai.boleh
                     ? ''
                     : `<p class="att-hint" style="color:var(--color-text-muted)">${esc(bolehMulai.sebab)}</p>`
                 }`
          }
          ${
            rekapIstirahat.menit
              ? `<p class="att-hint">Istirahat hari ini: <strong>${rekapIstirahat.menit} menit</strong>${
                  rekapIstirahat.otomatis ? ' (ditutup otomatis)' : ''
                } — <em>tidak mengurangi NBM.</em></p>`
              : '<p class="att-hint"><em>Istirahat sekali per hari kerja, dan tidak mengurangi NBM.</em></p>'
          }
        </div>

        <div class="att-photo-row">
          <button type="button" class="att-shoot" id="btn-shoot-out"><span>📷</span> Ambil Foto Selfie</button>
          <img id="preview-out" class="selfie-preview" style="display:none" />
        </div>
        ${
          // SAAT ISTIRAHAT, TOMBOL CLOCK OUT DISEMBUNYIKAN — bukan sekadar
          // dinonaktifkan.
          //
          // Dua tombol utama berdampingan membuat orang menekan yang salah, dan
          // di sini "yang salah" berarti pulang padahal ia cuma mau kembali
          // bekerja. Tombol Kembali mengambil tempat dan sorotan yang sama
          // supaya tidak ada yang perlu dibaca dua kali.
          berjalan
            ? `<button class="primary" id="btn-istirahat-selesai" disabled>↩️ Kembali dari Istirahat</button>`
            : `<button class="primary" id="btn-clock-out" disabled>Clock Out</button>`
        }
        <p class="error-text" id="att-error"></p>
      </div>`;

    const errorEl = main.querySelector('#att-error');

    // ISTIRAHAT MEMAKAI GERBANG YANG SAMA DENGAN CLOCK IN/OUT.
    //
    // Tanpa itu, istirahat jadi satu-satunya tombol presensi yang bisa ditekan
    // dari rumah dan atas nama orang lain — dan justru tombol itu yang paling
    // sering ditekan dalam sehari. Foto selfie + kecocokan wajah + geofence:
    // ketiganya sama persis dengan yang dituntut clock out.
    const tombolAksi = main.querySelector(berjalan ? '#btn-istirahat-selesai' : '#btn-clock-out');

    const labelAksi = berjalan ? 'Kembali dari Istirahat' : 'Clock Out';

    main.querySelector('#btn-shoot-out').addEventListener('click', async () => {
      errorEl.textContent = '';
      try {
        capturedOut = await openCameraCapture({
          getWatermarkText: () => formatWatermarkText(outletName(openSession.outlet_id), labelAksi),
          requireFace: true
        });
        const preview = main.querySelector('#preview-out');
        preview.src = URL.createObjectURL(capturedOut.blob);
        preview.style.display = 'block';
        tombolAksi.disabled = false;
        toast(`Foto siap. Lanjut ${labelAksi}.`, 'info');
      } catch (error) {
        errorEl.textContent = error.message ?? 'Gagal mengambil foto.';
      }
    });

    tombolAksi.addEventListener('click', async (e) => {
      errorEl.textContent = '';
      e.target.disabled = true;
      try {
        if (!capturedOut) throw new Error('Ambil foto selfie dulu.');
        if (!capturedOut.descriptor) throw new Error('Wajah tidak terdeteksi di foto. Ulangi dengan pencahayaan cukup & wajah menghadap kamera.');
        if (!isSameFace(capturedOut.descriptor, myFaceDescriptor)) {
          throw new Error(`Wajah tidak cocok dengan yang terdaftar. ${labelAksi} ditolak.`);
        }
        await pastikanDiAreaOutlet(openSession, labelAksi);

        if (berjalan) {
          const path = await uploadAttendanceSelfie({ outletId: openSession.outlet_id, kind: 'break_in', file: capturedOut.blob });
          await selesaiIstirahat(openSession.id, { photoPath: path, faceMatch: true });
          await infoDialog({
            title: '👋 Selamat bekerja kembali',
            bodyHtml:
              '<p>Kamu sudah tercatat <strong>kembali dari istirahat</strong>.</p>' +
              '<p style="color:var(--color-text-muted);font-size:0.9rem">Jangan lupa Clock Out saat jam kerjamu selesai.</p>',
            closeText: 'Oke'
          });
        } else {
          const photoPath = await uploadAttendanceSelfie({ outletId: openSession.outlet_id, kind: 'out', file: capturedOut.blob });
          await clockOut(openSession.id, { photoPath, faceMatch: true });
          await infoDialog({
            title: '🙌 Kamu sudah Clock Out',
            bodyHtml:
              '<p>Terima kasih atas kerja kerasnya hari ini.</p>' +
              '<p style="color:var(--color-text-muted);font-size:0.9rem">Hati-hati di jalan, sampai jumpa besok!</p>',
            closeText: 'Oke'
          });
        }
        await renderAttendancePage(container, ctx);
      } catch (error) {
        errorEl.textContent = error.message ?? `Gagal ${labelAksi.toLowerCase()}.`;
        e.target.disabled = false;
      }
    });

    // Penolakan server TIDAK ditelan: jendela jamnya ditegakkan di
    // `mulai_istirahat` juga, dan PWA yang tertinggal versi bisa mengirim
    // permintaan yang layar barunya sudah cegah.
    main.querySelector('#btn-istirahat-mulai')?.addEventListener(
      'click',
      sekaliJalan(async () => {
        errorEl.textContent = '';
        try {
          // Gerbang yang sama dengan clock out: foto, wajah, lalu lokasi.
          if (!capturedOut) throw new Error('Ambil foto selfie dulu sebelum mulai istirahat.');
          if (!capturedOut.descriptor) throw new Error('Wajah tidak terdeteksi di foto. Ulangi dengan pencahayaan cukup & wajah menghadap kamera.');
          if (!isSameFace(capturedOut.descriptor, myFaceDescriptor)) {
            throw new Error('Wajah tidak cocok dengan yang terdaftar. Istirahat ditolak.');
          }
          await pastikanDiAreaOutlet(openSession, 'Istirahat');

          const path = await uploadAttendanceSelfie({ outletId: openSession.outlet_id, kind: 'break_out', file: capturedOut.blob });
          await mulaiIstirahat(openSession.id, { photoPath: path, faceMatch: true });
          await infoDialog({
            title: '☕ Istirahatmu dimulai',
            bodyHtml:
              '<p>Selamat istirahat — waktumu sudah tercatat.</p>' +
              '<p style="color:var(--color-danger);font-weight:600">Wajib absen kembali begitu istirahatmu selesai.</p>' +
              '<p style="color:var(--color-text-muted);font-size:0.9rem">Kelalaian absen kembali tercatat di rekap dan ditandai untuk atasanmu.</p>',
            closeText: 'Oke, saya mengerti'
          });
          await renderAttendancePage(container, ctx);
        } catch (error) {
          errorEl.textContent = error.message ?? 'Gagal memulai istirahat.';
        }
      })
    );
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

      // DIALOG PENEGASAN, bukan cuma toast.
      //
      // Toast hilang sendiri dalam tiga detik, dan di HP yang sedang dipegang
      // sambil berjalan ia sering tidak terbaca sama sekali. Orangnya lalu
      // menekan tombolnya lagi untuk memastikan — dan pada tombol presensi,
      // "memastikan" itu mahal. Dialog menuntut satu ketukan sadar, dan
      // ketukan itulah buktinya bahwa pesannya benar-benar sampai.
      //
      // Status terlambat SENGAJA ikut di sini, bukan disembunyikan di toast:
      // itu hal pertama yang perlu diketahui orangnya, dan yang paling mudah
      // terlewat kalau cuma lewat.
      if (lateInfo.status === 'late') {
        await infoDialog({
          title: '⚠️ Kamu sudah Clock In — tercatat Terlambat',
          bodyHtml:
            `<p>Clock in kamu tercatat, tapi <strong>${lateInfo.minutes} menit</strong> melewati toleransi.</p>` +
            '<p style="color:var(--color-text-muted);font-size:0.9rem">Kalau ada alasannya, sampaikan ke atasanmu supaya bisa dikoreksi.</p>',
          closeText: 'Oke'
        });
      } else {
        await infoDialog({
          title: isStoring ? '🚩 Kamu sudah Clock In (Tugas Luar)' : '👋 Kamu sudah Clock In',
          bodyHtml:
            `<p>${isStoring ? 'Tugas luar kamu sudah tercatat.' : 'Kehadiranmu sudah tercatat.'}</p>` +
            (lateInfo.status === 'tolerance'
              ? `<p style="font-size:0.9rem">${lateInfo.minutes} menit dari jadwal — masih dalam toleransi.</p>`
              : '') +
            `<p style="color:var(--color-text-muted);font-size:0.9rem">${
              isStoring ? 'Hati-hati di jalan!' : 'Selamat bekerja hari ini!'
            }</p>`,
          closeText: 'Oke'
        });
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
