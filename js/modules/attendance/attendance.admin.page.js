import { listBuStaff } from '../leave/leave.service.js';
import { rencanaKoreksi, keInputLokal } from './koreksi-presensi.js';
import {
  listPushEnabledUserIds,
  listAttendanceForAdmin,
  correctAttendanceRecord,
  koreksiOutletBasis,
  hitungUlangStatusShift,
  hitungUlangStatusShiftMassal,
  listOutletsWithGeofence,
  listAttendanceOutlets,
  setOutletLocation,
  setOutletWorkHours,
  getExitTaskMode,
  setExitTaskMode,
  generateExitOtp,
  listRecentExitOtp,
  getSignedPhotoUrl,
  reverseGeocode
} from './attendance.service.js';
import { renderNbmSettingsTab } from './nbm-settings.admin.page.js';
import { renderNbmReportTab } from './nbm-report.admin.page.js';
import { toast, formDialog } from '../../core/ui.js';
import { exportTablePDF } from '../../core/pdf.js';
import { monthRangeWIB, isoFrom, isoTo } from '../../core/dates.js';
import { LATE_LABEL, LATE_BADGE } from '../shift/shift.service.js';
import { loadingHtml, sekaliJalan } from '../../core/loading.js';
import { sayaAdminBu } from '../../core/base-scope.js';

const TABS = [
  { key: 'presensi', label: 'Presensi' },
  { key: 'nbm-settings', label: 'Pengaturan NBM & Lembur' },
  { key: 'nbm-report', label: 'Rekap NBM' }
];

export async function renderAttendanceAdminPage(container, { businessUnitId }) {
  container.innerHTML = `
    <h1>Master Presensi</h1>
    <div class="tab-bar" id="attendance-tabs">
      ${TABS.map((t, i) => `<button class="tab-btn ${i === 0 ? 'active' : ''}" data-tab="${t.key}">${t.label}</button>`).join('')}
    </div>
    <div id="attendance-tab-content"></div>
  `;

  const content = document.getElementById('attendance-tab-content');

  async function showTab(key) {
    container.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === key));
    if (key === 'presensi') await renderPresensiTab(content, businessUnitId);
    if (key === 'nbm-settings') await renderNbmSettingsTab(content, businessUnitId);
    if (key === 'nbm-report') await renderNbmReportTab(content, businessUnitId);
  }

  container.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => showTab(btn.dataset.tab));
  });

  await showTab('presensi');
}

async function renderPresensiTab(container, businessUnitId) {
  container.innerHTML = loadingHtml('Memuat presensi…');

  const outlets = await listOutletsWithGeofence(businessUnitId);
  // Lokasi/geofence & jam kerja outlet ditulis ke tabel `outlets`, dan policy
  // `outlets_update` HANYA membuka untuk admin BU — admin outlet tidak
  // termasuk. Tombolnya karena itu tidak digambar untuk mereka: menekannya
  // dulu menghasilkan "tersimpan" yang tidak menyimpan apa pun, dan geofence
  // yang salah berarti seluruh staf outlet itu gagal clock in.
  const bolehUbahOutlet = await sayaAdminBu(businessUnitId).catch(() => false);
  const exitMode = await getExitTaskMode(businessUnitId);
  // Default periode: tanggal 1 bulan berjalan s/d hari ini.
  const range = monthRangeWIB();
  const filters = { businessUnitId, outletId: '', outletMode: 'lokasi', dateFrom: isoFrom(range.from), dateTo: isoTo(range.to) };
  let lastRecords = [];

  // Direktori SEMUA outlet aktif (lewat RPC security-definer). Dibutuhkan karena
  // staff basis BU ini boleh absen di outlet BU lain, sedangkan RLS `outlets_select`
  // hanya mengizinkan admin membaca outlet dalam scope-nya sendiri — tanpa ini
  // kolom Outlet akan kosong ("-") untuk presensi lintas BU.
  const allOutlets = await listAttendanceOutlets().catch(() => []);
  const outletInfo = new Map(allOutlets.map((o) => [o.id, o]));
  // Siapa yang sudah mengaktifkan notifikasi. Dipakai untuk penanda 🔕 — staff
  // tanpa langganan tidak akan pernah menerima reminder clock in, dan sebelum
  // ini tidak ada satu pun tempat di aplikasi yang memperlihatkannya.
  const pushAktif = await listPushEnabledUserIds();

  // Divisi tiap staff, untuk mengurutkan rekap per bagian (Kitchen, Bar, dst).
  // includeInactive: rekap adalah CATATAN RIWAYAT — orang yang sudah keluar
  // tetap punya baris presensi di periode saat dia masih bekerja, dan namanya
  // harus tetap terbaca.
  const divisiUser = new Map();
  try {
    for (const st of await listBuStaff(businessUnitId, { includeInactive: true })) {
      divisiUser.set(st.user_id, { nama: st.division_name, urut: st.division_sort ?? 0 });
    }
  } catch {
    // Gagal baca divisi -> rekap tetap tampil, hanya tidak dikelompokkan.
  }
  // Nama outlet untuk filter/PDF.
  const outletNames = new Map((outlets ?? []).map((o) => [o.id, o.name]));

  /** Nama outlet lokasi absen + BU-nya, apa pun BU pemiliknya. */
  function outletOf(r) {
    const info = outletInfo.get(r.outlet_id);
    const basis = r.nbm_outlet_id && r.nbm_outlet_id !== r.outlet_id ? outletInfo.get(r.nbm_outlet_id) : null;
    return {
      name: info?.name ?? outletNames.get(r.outlet_id) ?? '-',
      buName: info?.business_unit_name ?? '',
      isOtherBu: !!(r.nbm_business_unit_id && r.business_unit_id && r.nbm_business_unit_id !== r.business_unit_id),
      basisName: basis?.name ?? (r.nbm_outlet_id && r.nbm_outlet_id !== r.outlet_id ? 'outlet lain' : ''),
      basisNote: r.nbm_outlet_note ?? '',
      basisDikoreksi: !!r.nbm_outlet_note
    };
  }

  async function refresh() {
    const body = container.querySelector('#attendance-table-body');
    let records;
    try {
      records = await listAttendanceForAdmin(filters);
    } catch (error) {
      body.innerHTML = `<tr><td colspan="11" class="error-text">Gagal memuat rekap presensi: ${escapeHtml(error.message ?? error)}</td></tr>`;
      return;
    }
    lastRecords = records;

    // Urut per divisi, lalu nama, lalu waktu. BEDA dengan Jadwal Shift: yang
    // belum berdivisi TIDAK disembunyikan di sini — rekap presensi adalah bukti
    // kehadiran, dan menghilangkan baris yang datanya ada berarti jam kerja
    // seseorang lenyap dari catatan. Mereka dikumpulkan di kelompok terakhir.
    const urutDivisi = (uid) => divisiUser.get(uid)?.urut ?? Number.MAX_SAFE_INTEGER;
    const namaDivisi = (uid) => divisiUser.get(uid)?.nama ?? null;
    records.sort(
      (a, b) =>
        urutDivisi(a.user_id) - urutDivisi(b.user_id) ||
        String(namaDivisi(a.user_id) ?? 'zzz').localeCompare(String(namaDivisi(b.user_id) ?? 'zzz')) ||
        String(a.user_profiles?.full_name ?? '').localeCompare(String(b.user_profiles?.full_name ?? '')) ||
        String(b.clock_in_at ?? '').localeCompare(String(a.clock_in_at ?? ''))
    );

    let divisiTerakhir = Symbol('awal');
    const potongan = [];
    for (const r of records) {
      const d = namaDivisi(r.user_id);
      if (d !== divisiTerakhir) {
        divisiTerakhir = d;
        potongan.push(`<tr class="shift-divisi"><td colspan="11">${escapeHtml(d ?? 'Tanpa divisi')}</td></tr>`);
      }
      potongan.push(rowHtml(r, outletOf(r), pushAktif));
    }
    body.innerHTML = potongan.join('') || '<tr><td colspan="11">Tidak ada data.</td></tr>';

    // Lengkapi pilihan filter outlet dengan outlet lain yang terpakai di data.
    const sel = container.querySelector('#filter-outlet');
    let added = false;
    for (const r of records) {
      if (r.outlet_id && !outletNames.has(r.outlet_id)) {
        const info = outletInfo.get(r.outlet_id);
        outletNames.set(r.outlet_id, info?.name ?? 'Outlet lain');
        sel.insertAdjacentHTML(
          'beforeend',
          `<option value="${r.outlet_id}">${escapeHtml(info?.name ?? 'Outlet lain')}${info?.business_unit_name ? ` (${escapeHtml(info.business_unit_name)})` : ''}</option>`
        );
        added = true;
      }
    }
    if (added) sel.value = filters.outletId || '';

    wireEditButtons(container, outlets ?? []);
    wirePhotoButtons(container);
    wireAddressButtons(container);
    container.querySelectorAll('.btn-recalc-shift').forEach((btn) =>
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          const hasil = await hitungUlangStatusShift(btn.dataset.id);
          if (!hasil || hasil.status === 'no_schedule') {
            // Dikatakan apa adanya. Menampilkan "berhasil" untuk hitungan yang
            // tidak menemukan apa pun hanya membuat admin mencoba lagi.
            toast('Tetap tanpa jadwal — belum ada jadwal shift untuk staff ini pada tanggal tersebut.', 'warning');
          } else {
            toast(`Status diperbarui: ${LATE_LABEL[hasil.status] ?? hasil.status}.`, 'success');
          }
          await refresh();
        } catch (error) {
          toast(error.message ?? 'Gagal menghitung ulang.', 'error');
          btn.disabled = false;
        }
      })
    );
  }

  container.innerHTML = `
    <div class="inline-card" style="max-width:640px">
      <h3 style="margin-top:0">Mode Tugas Luar/Storing (BU ini)</h3>
      <div class="field" style="max-width:220px">
        <select id="exit-mode-select">
          <option value="storing" ${exitMode === 'storing' ? 'selected' : ''}>Tugas Luar/Storing (tanpa OTP)</option>
          <option value="otp" ${exitMode === 'otp' ? 'selected' : ''}>OTP (kode dari admin)</option>
        </select>
      </div>
      <button class="primary" id="btn-save-exit-mode" style="max-width:140px;margin-top:8px">Simpan Mode</button>
      <p style="font-size:0.78rem;color:var(--color-text-muted);margin:8px 0 0">
        Mode ini mengikuti <strong>BU basis (★)</strong> staff, bukan BU yang sedang kamu buka di sini.
        Staff yang basisnya di BU lain tetap memakai mode BU-nya sendiri — atur di BU tersebut.
      </p>

      <div id="otp-generator-wrap" style="margin-top:16px;${exitMode === 'otp' ? '' : 'display:none'}">
        <button class="primary" id="btn-generate-otp" style="max-width:200px">+ Generate Kode OTP</button>
        <div id="otp-result" style="margin-top:8px"></div>
        <table class="data-table" style="margin-top:12px">
          <thead><tr><th>Kode</th><th>Kedaluwarsa</th><th>Dipakai oleh</th></tr></thead>
          <tbody id="otp-recent-body"></tbody>
        </table>
      </div>
    </div>

    <details class="inline-card" style="max-width:640px;margin-top:16px">
      <summary style="cursor:pointer;font-weight:600">Pengaturan Lokasi Outlet (Geofencing)</summary>
      <table class="data-table" style="margin-top:12px">
        <thead><tr><th>Outlet</th><th>Koordinat</th><th>Radius</th><th>Aksi</th></tr></thead>
        <tbody id="outlet-geofence-body">
          ${(outlets ?? []).map((o) => outletGeofenceRowHtml(o, bolehUbahOutlet)).join('')}
        </tbody>
      </table>
      <p style="font-size:0.8rem;color:var(--color-text-muted);margin-top:8px">
        Kalau koordinat belum diisi, staff bisa clock in dari mana saja (geofence belum aktif untuk outlet itu).
        Staff yang mengaktifkan mode Tugas Luar/Storing juga otomatis lewati geofence.
      </p>
    </details>

    <details class="inline-card" style="max-width:640px;margin-top:16px">
      <summary style="cursor:pointer;font-weight:600">Jam Kerja & Reminder Clock In</summary>
      <table class="data-table" style="margin-top:12px">
        <thead><tr><th>Outlet</th><th>Jam Masuk</th><th>Jam Pulang</th><th>Reminder</th><th>Aksi</th></tr></thead>
        <tbody id="outlet-workhours-body">
          ${(outlets ?? []).map((o) => outletWorkHoursRowHtml(o, bolehUbahOutlet)).join('')}
        </tbody>
      </table>
      <p style="font-size:0.8rem;color:var(--color-text-muted);margin-top:8px">
        Staff yang belum clock in <strong>10 menit</strong> setelah jam masuknya akan dapat
        notifikasi pengingat otomatis (sekali per staff per outlet per hari).
        Staff perlu mengaktifkan sendiri notifikasinya lewat halaman Presensi mereka.
      </p>
      <p style="font-size:0.8rem;color:var(--color-text-muted);margin-top:8px">
        <strong>Outlet yang memakai modul Shift tidak perlu mengisi "Jam Masuk"</strong> — jam masuknya
        diambil dari jadwal shift masing-masing staff hari itu, dan yang dijadwalkan libur tidak diingatkan.
        Konsekuensinya: staff yang <strong>belum dijadwalkan</strong> hari itu tidak akan diingatkan sama sekali.
        Untuk outlet tanpa modul Shift, "Jam Masuk" wajib diisi — kalau kosong, remindernya tidak aktif.
      </p>
    </details>

    <div class="inline-card" style="max-width:640px;display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end;margin-top:16px">
      <div class="field" style="margin:0">
        <label>Outlet</label>
        <select id="filter-outlet">
          <option value="">Semua outlet</option>
          ${(outlets ?? []).map((o) => `<option value="${o.id}">${escapeHtml(o.name)}</option>`).join('')}
        </select>
      </div>
      <div class="field" style="margin:0;max-width:190px">
        <label for="filter-outlet-mode">Outlet yang dicari</label>
        <select id="filter-outlet-mode">
          <option value="lokasi">Lokasi absen</option>
          <option value="basis">Outlet basis (NBM)</option>
        </select>
      </div>
      <div class="field" style="margin:0"><label>Dari tanggal</label><input type="date" id="filter-from" value="${range.from}" /></div>
      <div class="field" style="margin:0"><label>Sampai tanggal</label><input type="date" id="filter-to" value="${range.to}" /></div>
      <button class="primary" id="btn-filter" style="max-width:120px">Filter</button>
      <button id="btn-recalc-all" title="Untuk presensi yang terlanjur Tanpa jadwal karena jadwalnya baru dibuat belakangan">↻ Hitung Ulang Shift</button>
      <button id="btn-export-att">⇩ Export PDF</button>
    </div>

    <div class="table-scroll"><table class="data-table table-freeze-1">
      <thead>
        <tr><th>Staff</th><th>Outlet</th><th>Tipe</th><th>Keterangan</th><th>Shift</th><th>Clock In</th><th>Wajah</th><th>Foto</th><th>Alamat</th><th>Clock Out</th><th>Aksi</th></tr>
      </thead>
      <tbody id="attendance-table-body"></tbody>
    </table></div>
    <p style="font-size:0.78rem;color:var(--color-text-muted);margin-top:8px">
      Kolom <strong>Outlet</strong> menampilkan <strong>lokasi absen</strong> — tempat yang dibuktikan foto dan koordinatnya.
      Kalau outlet <strong>basis NBM</strong>-nya berbeda (mis. setelah dikoreksi lewat ✎), basisnya ditulis di bawahnya dengan tanda ★.
      Pemilih <em>Outlet yang dicari</em> menentukan yang mana dipakai saat menyaring.
      Status <strong>Tepat waktu / Toleransi / Terlambat</strong> dihitung terhadap <strong>jadwal shift</strong> staff saat dia clock in,
      dan disimpan sebagai catatan — mengubah jadwalnya belakangan tidak mengubah penilaian yang sudah tercatat.
    </p>
    <p style="font-size:0.78rem;color:var(--color-text-muted);margin:8px 0 0">
      🔕 di sebelah nama = staff itu belum mengaktifkan notifikasi di perangkat mana pun,
      jadi <strong>pengingat clock in tidak akan sampai padanya</strong>. Minta dia membuka
      Profil di Staff App lalu menekan <em>Aktifkan Notifikasi</em>.
    </p>
  `;

  wireOutletGeofenceButtons(container, businessUnitId);
  wireOutletWorkHoursButtons(container, businessUnitId);

  document.getElementById('exit-mode-select').addEventListener('change', (e) => {
    document.getElementById('otp-generator-wrap').style.display = e.target.value === 'otp' ? 'block' : 'none';
  });

  document.getElementById('btn-save-exit-mode').addEventListener('click', async () => {
    try {
      await setExitTaskMode(businessUnitId, document.getElementById('exit-mode-select').value);
      toast('Mode Tugas Luar/Storing disimpan.', 'success');
    } catch (error) {
      toast(error.message ?? 'Gagal menyimpan mode.', 'error');
    }
  });

  document.getElementById('btn-generate-otp').addEventListener('click', async () => {
    try {
      const otp = await generateExitOtp(businessUnitId);
      document.getElementById('otp-result').innerHTML = `
        <div class="scope-badge" style="font-size:1rem;padding:6px 12px">
          Kode: <strong>${escapeHtml(otp.code)}</strong> — berlaku sampai ${formatTime(otp.expires_at)}
        </div>
      `;
      await refreshOtpList();
    } catch (error) {
      toast(error.message ?? 'Gagal generate kode OTP.', 'error');
    }
  });

  async function refreshOtpList() {
    const codes = await listRecentExitOtp(businessUnitId);
    document.getElementById('otp-recent-body').innerHTML =
      codes
        .map(
          (c) => `
        <tr>
          <td>${escapeHtml(c.code)}</td>
          <td>${formatTime(c.expires_at)}</td>
          <td>${c.used_at ? escapeHtml(c.user_profiles?.full_name ?? 'Ya') : '-'}</td>
        </tr>`
        )
        .join('') || '<tr><td colspan="3">Belum ada kode.</td></tr>';
  }
  if (exitMode === 'otp') await refreshOtpList();

  document.getElementById('btn-export-att').addEventListener('click', async () => {
    if (!lastRecords.length) return toast('Tidak ada data untuk diexport.', 'warning');
    const namaOutlet = filters.outletId ? outletNames.get(filters.outletId) ?? '-' : 'Semua outlet';
    const dFrom = document.getElementById('filter-from').value;
    const dTo = document.getElementById('filter-to').value;
    const periode = dFrom || dTo ? `${dFrom || '…'} s/d ${dTo || '…'}` : 'Semua tanggal';
    try {
      await exportTablePDF({
        title: 'Rekap Presensi',
        subtitle: `${namaOutlet} · Periode ${periode}`,
        columns: [
          { header: 'Staff', width: 1.4 },
          { header: 'Outlet', width: 1.2 },
          { header: 'Tipe', width: 1.2 },
          { header: 'Keterangan', width: 1.6 },
          { header: 'Shift / Status', width: 1.4 },
          { header: 'Clock In', width: 1.1 },
          { header: 'Clock Out', width: 1.1 },
          { header: 'Wajah', width: 0.8 }
        ],
        rows: lastRecords.map((r) => [
          r.user_profiles?.full_name ?? '-',
          outletOf(r).name,
          tipeOf(r),
          r.is_storing ? r.exit_reason ?? '-' : '-',
          shiftText(r),
          formatTime(r.clock_in_at),
          r.clock_out_at ? formatTime(r.clock_out_at) : '—',
          r.clock_in_face_match === true ? 'Cocok' : r.clock_in_face_match === false ? 'Perlu review' : '-'
        ]),
        filename: 'rekap-presensi'
      });
      toast('PDF rekap presensi terunduh.', 'success');
    } catch (error) {
      toast(error.message ?? 'Gagal membuat PDF.', 'error');
    }
  });

  document.getElementById('btn-recalc-all').addEventListener('click', async (e) => {
    const dari = document.getElementById('filter-from').value;
    const sampai = document.getElementById('filter-to').value;
    if (!dari || !sampai) return toast('Isi rentang tanggalnya dulu.', 'warning');
    e.target.disabled = true;
    try {
      const hasil = await hitungUlangStatusShiftMassal({
        from: dari,
        to: sampai,
        outletId: document.getElementById('filter-outlet').value || null
      });
      // Dua angka, bukan satu: "diproses" saja akan terbaca sebagai keberhasilan
      // padahal bisa jadi tidak satu pun menemukan jadwal.
      toast(
        hasil.diproses
          ? `${hasil.jadi_dinilai} dari ${hasil.diproses} presensi kini punya status shift.`
          : 'Tidak ada presensi tanpa jadwal di rentang ini.',
        hasil.jadi_dinilai ? 'success' : 'warning'
      );
      await refresh();
    } catch (error) {
      toast(error.message ?? 'Gagal menghitung ulang.', 'error');
    } finally {
      e.target.disabled = false;
    }
  });

  document.getElementById('btn-filter').addEventListener('click', () => {
    filters.outletId = document.getElementById('filter-outlet').value || '';
    filters.outletMode = document.getElementById('filter-outlet-mode').value || 'lokasi';
    filters.dateFrom = isoFrom(document.getElementById('filter-from').value);
    filters.dateTo = isoTo(document.getElementById('filter-to').value);
    refresh();
  });

  await refresh();
}

/** Tipe presensi: Normal vs Tugas Luar/Storing. */
function tipeOf(r) {
  return r.is_storing ? `Tugas Luar/Storing${r.exit_method === 'otp' ? ' (OTP)' : ''}` : 'Normal';
}

/** Keterangan shift + status keterlambatan (kalau modul Shift dipakai). */
function shiftCell(r) {
  // Tombol ↻ HANYA untuk baris yang belum pernah dinilai. Status di sini adalah
  // POTRET saat clock in: kalau jadwalnya baru disusun setelah orangnya masuk,
  // barisnya tetap "Tanpa jadwal" selamanya sampai dihitung ulang. Yang sudah
  // dinilai tidak diberi tombol — penilaian yang sudah terjadi bukan sesuatu
  // yang pantas diubah dengan satu ketukan.
  const bisaHitungUlang = !r.late_status || r.late_status === 'no_schedule';
  const tombol = bisaHitungUlang
    ? ` <button class="btn-recalc-shift" data-id="${r.id}" title="Hitung ulang dari jadwal shift yang berlaku">↻</button>`
    : '';
  if (!r.late_status) return `<span style="color:var(--color-text-muted)">-</span>${tombol}`;
  const label = LATE_LABEL[r.late_status] ?? r.late_status;
  const badge = LATE_BADGE[r.late_status] ?? '';
  const detail = r.late_minutes ? ` ${r.late_minutes} mnt` : '';
  return `${r.shift_name ? `${escapeHtml(r.shift_name)}<br>` : ''}<span class="badge ${badge}">${label}${detail}</span>${tombol}`;
}

/** Teks ringkas untuk export PDF. */
function shiftText(r) {
  if (!r.late_status) return '-';
  const label = LATE_LABEL[r.late_status] ?? r.late_status;
  return `${r.shift_name ? r.shift_name + ' — ' : ''}${label}${r.late_minutes ? ` (${r.late_minutes} mnt)` : ''}`;
}

function rowHtml(r, outlet, pushAktif) {
  const storingTag = '';
  // 🔕 = staff ini belum mengaktifkan notifikasi di device mana pun, jadi
  // reminder clock in tidak akan pernah sampai padanya. Bukan error, tapi harus
  // terlihat — kalau tidak, admin baru sadar setelah orangnya telat berkali-kali.
  // Dua hal yang berarti "tidak tahu", dan keduanya HARUS diam, bukan menuduh:
  //   - pushAktif null  -> RPC gagal / migration 0047 belum dijalankan
  //   - r.user_id kosong -> query rekap lupa mengambil kolomnya
  // Kesalahan kedua itu pernah benar-benar terjadi dan membuat SEMUA staff
  // ditandai 🔕 padahal notifikasinya aktif. Penanda yang salah lebih merusak
  // daripada tidak ada penanda: admin jadi tidak mempercayainya lagi.
  const tanpaPush = pushAktif instanceof Map && !!r.user_id && !pushAktif.get(r.user_id);
  const pushTag = tanpaPush
    ? ` <span title="Belum mengaktifkan notifikasi — tidak akan menerima pengingat clock in" style="cursor:help">🔕</span>`
    : '';
  const fotoButtons = [
    r.clock_in_photo_path ? `<button class="btn-view-photo" data-path="${r.clock_in_photo_path}">In</button>` : '',
    r.clock_out_photo_path ? `<button class="btn-view-photo" data-path="${r.clock_out_photo_path}">Out</button>` : ''
  ]
    .filter(Boolean)
    .join(' ');

  return `
    <tr data-record-id="${r.id}" data-lat="${r.clock_in_lat ?? ''}" data-lng="${r.clock_in_lng ?? ''}"
        data-in="${r.clock_in_at ?? ''}" data-out="${r.clock_out_at ?? ''}">
      <td>${escapeHtml(r.user_profiles?.full_name ?? '-')}${pushTag}</td>
      <td>${escapeHtml(outlet.name)}${storingTag}${
        // Kalau absen di outlet milik BU lain, tampilkan BU lokasinya agar jelas.
        outlet.isOtherBu && outlet.buName
          ? `<div style="font-size:0.72rem;color:var(--color-text-muted)">di BU ${escapeHtml(outlet.buName)}</div>`
          : ''
      }${
        // Outlet BASIS ditampilkan HANYA kalau berbeda dari lokasi absennya.
        // Ini yang berubah saat admin mengoreksi basis (0062): beban NBM-nya
        // pindah, sementara lokasi absen — yang dibuktikan foto & koordinat —
        // tetap apa adanya. Dua-duanya benar, dan menampilkan cuma salah
        // satunya membuat orang mengira yang lain hilang.
        outlet.basisName
          ? `<div style="font-size:0.72rem;color:var(--color-primary)" title="${escapeHtml(outlet.basisNote || 'Outlet basis NBM untuk baris ini')}">
               ★ basis: ${escapeHtml(outlet.basisName)}${outlet.basisDikoreksi ? ' ✎' : ''}
             </div>`
          : ''
      }</td>
      <td>${r.is_storing ? `<span class="badge badge-pending">${tipeOf(r)}</span>` : '<span class="badge badge-approved">Normal</span>'}</td>
      <td style="font-size:0.8rem;max-width:180px">${r.is_storing ? (r.exit_reason ? escapeHtml(r.exit_reason) : '<span style="color:var(--color-text-muted)">tanpa keterangan</span>') : '-'}</td>
      <td style="font-size:0.8rem">${shiftCell(r)}</td>
      <td>${formatTime(r.clock_in_at)}${
        // Ketelitian GPS ditampilkan HANYA kalau meragukan (>100 m). Selalu
        // menampilkannya membuat angka yang tidak penting ikut ramai; tidak
        // pernah menampilkannya membuat keluhan "saya di outlet tapi ditolak"
        // mustahil ditelusuri.
        r.clock_in_accuracy_m != null && r.clock_in_accuracy_m > 100
          ? `<div style="font-size:0.7rem;color:var(--color-danger)" title="Ketelitian GPS saat clock in — makin besar makin tidak bisa dipastikan lokasinya">±${r.clock_in_accuracy_m} m</div>`
          : ''
      }</td>
      <td>${faceMatchBadgeHtml(r.clock_in_face_match)}${r.clock_out_at ? '<br>' + faceMatchBadgeHtml(r.clock_out_face_match) : ''}</td>
      <td>${fotoButtons || '-'}</td>
      <td style="font-size:0.78rem;max-width:180px" class="address-cell">
        ${r.clock_in_lat != null ? '<button class="btn-view-address">Lihat Alamat</button>' : '-'}
      </td>
      <td>${r.clock_out_at ? formatTime(r.clock_out_at) : '—'}</td>
      <td><button class="btn-edit" data-record-id="${r.id}">Koreksi</button></td>
    </tr>
  `;
}

function faceMatchBadgeHtml(match) {
  if (match === true) return '<span class="scope-badge" style="color:var(--color-primary)">✅ Cocok</span>';
  if (match === false) return '<span class="scope-badge" style="color:var(--color-danger)">⚠️ Perlu Review</span>';
  return '<span class="scope-badge">– Tidak dicek</span>';
}

/** @param {boolean} boleh admin BU? Kalau bukan, barisnya tetap tampil tanpa tombol. */
function outletGeofenceRowHtml(o, boleh = true) {
  const coord = o.latitude != null ? `${o.latitude.toFixed(5)}, ${o.longitude.toFixed(5)}` : 'Belum diset';
  return `
    <tr data-outlet-id="${o.id}">
      <td>${escapeHtml(o.name)}</td>
      <td style="font-size:0.8rem">${coord}</td>
      <td>${o.geofence_radius_m}m</td>
      <td>${boleh ? `<button class="btn-set-geofence" data-outlet-id="${o.id}">Atur Lokasi</button>` : '<span style="font-size:0.75rem;color:var(--color-text-muted)">Admin BU</span>'}</td>
    </tr>
  `;
}

function wireOutletGeofenceButtons(container, businessUnitId) {
  container.querySelectorAll('.btn-set-geofence').forEach((btn) => {
    btn.addEventListener('click', sekaliJalan(async () => {
      const values = await formDialog({
        title: 'Atur Lokasi Outlet',
        description: 'Isi koordinat GPS outlet & radius toleransi geofence.',
        fields: [
          { name: 'latitude', label: 'Latitude', type: 'text', required: true, placeholder: 'contoh: -6.301944' },
          { name: 'longitude', label: 'Longitude', type: 'text', required: true, placeholder: 'contoh: 106.652778' },
          { name: 'radius', label: 'Radius toleransi (meter)', type: 'number', required: true, min: 1, value: '100' }
        ],
        submitText: 'Simpan Lokasi'
      });
      if (!values) return;
      try {
        await setOutletLocation(btn.dataset.outletId, {
          latitude: parseFloat(values.latitude),
          longitude: parseFloat(values.longitude),
          geofence_radius_m: parseInt(values.radius, 10) || 100
        });
        toast('Lokasi outlet disimpan.', 'success');
        const outlets = await listOutletsWithGeofence(businessUnitId);
        container.querySelector('#outlet-geofence-body').innerHTML = outlets.map((o) => outletGeofenceRowHtml(o, true)).join('');
        wireOutletGeofenceButtons(container, businessUnitId);
      } catch (error) {
        toast(error.message ?? 'Gagal menyimpan lokasi outlet.', 'error');
      }
    }));
  });
}

/** @param {boolean} boleh admin BU? Sama alasannya dengan baris geofence. */
function outletWorkHoursRowHtml(o, boleh = true) {
  return `
    <tr data-outlet-id="${o.id}">
      <td>${escapeHtml(o.name)}</td>
      <td>${o.clock_in_time ? o.clock_in_time.slice(0, 5) : 'Belum diset'}</td>
      <td>${o.clock_out_time ? o.clock_out_time.slice(0, 5) : '-'}</td>
      <td>${o.clock_in_time ? (o.reminder_enabled ? 'Aktif' : 'Nonaktif') : '-'}</td>
      <td>${boleh ? `<button class="btn-set-workhours" data-outlet-id="${o.id}">Atur Jam Kerja</button>` : '<span style="font-size:0.75rem;color:var(--color-text-muted)">Admin BU</span>'}</td>
    </tr>
  `;
}

function wireOutletWorkHoursButtons(container, businessUnitId) {
  container.querySelectorAll('.btn-set-workhours').forEach((btn) => {
    btn.addEventListener('click', sekaliJalan(async () => {
      const values = await formDialog({
        title: 'Atur Jam Kerja Outlet',
        description: 'Jam masuk dipakai untuk reminder clock in. Kosongkan jam masuk untuk mematikan reminder.',
        fields: [
          { name: 'clock_in_time', label: 'Jam masuk', type: 'time' },
          { name: 'clock_out_time', label: 'Jam pulang (opsional)', type: 'time' }
        ],
        submitText: 'Simpan Jam Kerja'
      });
      if (!values) return;
      try {
        await setOutletWorkHours(btn.dataset.outletId, {
          clock_in_time: values.clock_in_time || null,
          clock_out_time: values.clock_out_time || null,
          reminder_enabled: !!values.clock_in_time
        });
        toast('Jam kerja outlet disimpan.', 'success');
        const outlets = await listOutletsWithGeofence(businessUnitId);
        container.querySelector('#outlet-workhours-body').innerHTML = outlets.map((o) => outletWorkHoursRowHtml(o, true)).join('');
        wireOutletWorkHoursButtons(container, businessUnitId);
      } catch (error) {
        toast(error.message ?? 'Gagal menyimpan jam kerja outlet.', 'error');
      }
    }));
  });
}

function wirePhotoButtons(container) {
  container.querySelectorAll('.btn-view-photo').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        const url = await getSignedPhotoUrl(btn.dataset.path);
        if (url) window.open(url, '_blank');
        else toast('Foto tidak ditemukan.', 'warning');
      } catch (error) {
        toast(error.message ?? 'Gagal membuka foto.', 'error');
      }
    });
  });
}

function wireAddressButtons(container) {
  container.querySelectorAll('.btn-view-address').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const row = btn.closest('tr');
      const lat = parseFloat(row.dataset.lat);
      const lng = parseFloat(row.dataset.lng);
      btn.textContent = 'Memuat...';
      btn.disabled = true;
      try {
        const address = await reverseGeocode(lat, lng);
        row.querySelector('.address-cell').textContent = address;
      } catch (error) {
        btn.textContent = 'Gagal, coba lagi';
        btn.disabled = false;
      }
    });
  });
}

function wireEditButtons(container, outletPilihan = []) {
  container.querySelectorAll('.btn-edit').forEach((btn) => {
    btn.addEventListener('click', sekaliJalan(async () => {
      const row = container.querySelector(`tr[data-record-id="${btn.dataset.recordId}"]`);
      // NILAI ASLINYA (ISO) dibaca dari atribut baris, BUKAN dari teks di sel.
      //
      // Teks di sel diformat gaya Indonesia — "17 Agu, 08.15" — dan
      // `new Date()` tidak bisa membacanya: hasilnya `Invalid Date`, isian
      // tanggal terbuka kosong, dan karena Clock In wajib, tombol simpan tidak
      // pernah bisa ditekan. Jadi kasus paling sering (staff lupa absen pulang,
      // admin cuma mau menambahkan jam pulang) justru satu-satunya yang
      // mustahil. Teks itu bahkan tidak memuat TAHUN.
      const isoIn = row.dataset.in || '';
      const isoOut = row.dataset.out || '';
      const basisSekarang = btn.dataset.nbmOutlet || '';

      const values = await formDialog({
        title: 'Koreksi Presensi',
        fields: [
          {
            name: 'clock_in_at',
            label: 'Jam Masuk',
            type: 'datetime-local',
            // TIDAK wajib lagi: mengosongkannya berarti "jangan diubah".
            value: keInputLokal(isoIn),
            help: 'Kosongkan kalau tidak ingin mengubah jam masuk.'
          },
          {
            name: 'clock_out_at',
            label: 'Jam Pulang',
            type: 'datetime-local',
            value: keInputLokal(isoOut),
            help: isoOut
              ? 'Kosongkan kalau tidak ingin mengubah. Untuk menghapusnya, centang di bawah.'
              : 'Isi di sini kalau staff lupa absen pulang — jam masuknya tidak akan ikut berubah.'
          },
          ...(isoOut
            ? [{ name: 'hapus_out', label: 'Hapus jam pulang (jadikan belum absen pulang)', type: 'checkbox', value: false }]
            : []),
          {
            name: 'nbm_outlet_id',
            label: 'Outlet basis (penentu tarif NBM)',
            type: 'select',
            value: basisSekarang,
            // Basis dipotret saat clock-in. Kalau seseorang pindah outlet tapi
            // basisnya baru diperbarui beberapa hari kemudian, hari-hari di
            // antaranya terlanjur memakai tarif outlet lama — dan hilang dari
            // rekap saat difilter ke outlet baru. Ini tempat membetulkannya.
            help: 'Ubah HANYA kalau basis saat clock-in memang keliru — mis. sudah pindah outlet tapi ★-nya telat diperbarui.',
            options: [{ value: '', label: '-- biarkan seperti sekarang --' }, ...outletPilihan.map((o) => ({ value: o.id, label: o.name }))]
          },
          { name: 'nbm_note', label: 'Alasan koreksi basis', type: 'text', placeholder: 'wajib kalau outlet basis diubah' }
        ],
        submitText: 'Simpan Koreksi'
      });
      if (!values) return;

      const gantiBasis = values.nbm_outlet_id && values.nbm_outlet_id !== basisSekarang;
      if (gantiBasis && !values.nbm_note?.trim()) {
        toast('Isi alasan koreksi basis — perubahan ini mempengaruhi perhitungan gaji.', 'warning');
        return;
      }

      const { patch, masalah, berubah } = rencanaKoreksi({
        inSekarang: isoIn,
        outSekarang: isoOut,
        inBaru: values.clock_in_at,
        outBaru: values.clock_out_at,
        hapusClockOut: Boolean(values.hapus_out)
      });
      if (masalah.length) {
        toast(masalah.join(' '), 'warning');
        return;
      }
      if (!berubah.length && !gantiBasis) {
        toast('Tidak ada yang diubah.', 'info');
        return;
      }

      try {
        await correctAttendanceRecord(btn.dataset.recordId, patch);
        // Basis diubah lewat RPC terpisah: izinnya lebih ketat (harus admin di
        // outlet asal DAN outlet tujuan), dan itu tidak bisa dijamin oleh
        // update biasa yang tunduk pada policy presensi saja.
        if (gantiBasis) {
          await koreksiOutletBasis(btn.dataset.recordId, values.nbm_outlet_id, values.nbm_note);
        }
        // Yang berubah disebutkan, bukan cuma "dikoreksi": koreksi presensi
        // memengaruhi perhitungan NBM, dan admin perlu bisa memastikan yang
        // tersentuh memang yang dimaksud.
        toast([...berubah, gantiBasis ? 'Outlet basis dikoreksi.' : ''].filter(Boolean).join(' · ') || 'Presensi dikoreksi.', 'success');
        document.getElementById('btn-filter').click();
      } catch (error) {
        toast(error.message ?? 'Gagal koreksi presensi.', 'error');
      }
    }));
  });
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function formatTime(iso) {
  return new Date(iso).toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  });
}

