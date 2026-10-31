import { toast, confirmDialog, formDialog, shareDialog, fuzzyMatch } from '../../core/ui.js';
import { todayWIB, monthEndWIB } from '../../core/dates.js';
import {
  susunSisaCuti,
  ringkasSisaCuti,
  pesanRingkas,
  teksSel,
  tahunBerjalanWIB,
  KEADAAN
} from './sisa-cuti.js';
import { pesanCutiWa, fmtRentang, fmtTanggal, diubahAdmin } from './pesan-cuti.js';
import {
  dataSisaCutiBu,
  listLeaveRequestsForAdmin,
  reviewLeaveRequest,
  getAttachmentUrl,
  listLeaveTypesForAdmin,
  createLeaveType,
  updateLeaveType,
  deleteLeaveType,
  listBuStaff,
  countDaysInclusive,
  listStaffEntitlements,
  setStaffEntitlement,
  removeStaffEntitlement,
  revisiCuti
} from './leave.service.js';
import { loadingHtml, sekaliJalan } from '../../core/loading.js';

const STATUS_BADGE = {
  pending: { label: 'Menunggu', cls: 'badge-pending' },
  approved: { label: 'Disetujui', cls: 'badge-approved' },
  rejected: { label: 'Ditolak', cls: 'badge-rejected' },
  cancelled: { label: 'Dibatalkan', cls: 'badge-cancelled' }
};

const TABS = [
  { key: 'requests', label: 'Pengajuan' },
  // Di sebelah Pengajuan dan BUKAN di dalam "Hak & Jatah", walaupun datanya
  // bertetangga. "Hak & Jatah" adalah layar MENGATUR — dibuka satu staff pada
  // satu waktu. Yang ini layar MELIHAT: seluruh BU sekaligus, tanpa tombol apa
  // pun. Menggabungkannya memaksa orang yang cuma ingin tahu sisa cuti masuk
  // ke layar penuh tombol ubah.
  { key: 'sisa', label: 'Sisa Cuti' },
  { key: 'types', label: 'Jenis Cuti' },
  { key: 'quotas', label: 'Hak & Jatah' }
];

export async function renderLeaveAdminPage(container, { businessUnitId }) {
  container.innerHTML = `
    <h1>Pengajuan Cuti</h1>
    <div class="tab-bar" id="leave-tabs">
      ${TABS.map((t, i) => `<button class="tab-btn ${i === 0 ? 'active' : ''}" data-tab="${t.key}">${t.label}</button>`).join('')}
    </div>
    <div id="leave-tab-content"></div>
  `;
  const content = document.getElementById('leave-tab-content');

  async function showTab(key) {
    container.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === key));
    if (key === 'requests') await renderRequestsTab(content, businessUnitId);
    if (key === 'sisa') await renderSisaTab(content, businessUnitId);
    if (key === 'types') await renderTypesTab(content, businessUnitId);
    if (key === 'quotas') await renderEntitlementsTab(content, businessUnitId);
  }
  container.querySelectorAll('.tab-btn').forEach((btn) => btn.addEventListener('click', () => showTab(btn.dataset.tab)));
  await showTab('requests');
}

// ---- Tab: Sisa Cuti (seluruh staff BU) ----

async function renderSisaTab(content, businessUnitId) {
  const tahun = tahunBerjalanWIB();
  content.innerHTML = loadingHtml('Menghitung sisa cuti…', { baris: 6 });

  let data;
  try {
    data = await dataSisaCutiBu(businessUnitId, tahun);
  } catch (error) {
    content.innerHTML = `<p class="error-text">${escapeHtml(error.message ?? error)}</p>`;
    return;
  }

  const tabel = susunSisaCuti({ ...data, tahun });
  const ringkas = ringkasSisaCuti(tabel);

  if (!tabel.baris.length) {
    content.innerHTML = `<p style="color:var(--color-text-muted)">${escapeHtml(pesanRingkas(ringkas))}</p>`;
    return;
  }

  const render = (cari) => {
    const terlihat = tabel.baris.filter((b) => fuzzyMatch(cari, b.nama));
    const body = content.querySelector('#sisa-body');
    const info = content.querySelector('#sisa-info');
    body.innerHTML =
      terlihat.map((b) => barisSisaHtml(b, tabel.jenis)).join('') ||
      `<tr><td colspan="${tabel.jenis.length + 1}">Tidak ada nama yang cocok.</td></tr>`;
    info.textContent = terlihat.length === tabel.baris.length ? '' : `${tabel.baris.length - terlihat.length} staff lain disembunyikan saringan nama.`;
  };

  content.innerHTML = `
    <p class="inline-card" style="margin:0 0 10px;font-size:0.88rem">${escapeHtml(pesanRingkas(ringkas))}</p>
    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin-bottom:8px">
      <div class="field" style="margin:0;min-width:200px">
        <label for="sisa-cari">Nama staff</label>
        <input type="search" id="sisa-cari" placeholder="ketik sebagian nama" autocomplete="off" />
      </div>
      <div style="font-size:0.82rem;color:var(--color-text-muted);padding-bottom:6px">
        Tahun <strong>${tahun}</strong>
      </div>
    </div>
    <p id="sisa-info" style="font-size:0.8rem;color:var(--color-text-muted);margin:0 0 6px"></p>

    <!-- Keterangan dibaca SEBELUM tabelnya, bukan sesudah: tiga keadaan di
         bawah terlihat mirip di sel, dan orang yang salah membacanya akan
         mengira jatah yang belum diatur adalah jatah yang sudah habis. -->
    <p style="font-size:0.78rem;color:var(--color-text-muted);margin:0 0 10px;max-width:680px">
      <strong>7 dari 12</strong> = sisa 7 hari dari jatah 12 ·
      <strong>belum diberi</strong> = staff belum didaftarkan di jenis cuti itu (atur di tab Hak &amp; Jatah) ·
      <strong>n terpakai</strong> = sudah didaftarkan tapi jatahnya belum diisi angka ·
      <strong>—</strong> = jenis cuti ini memang tidak memotong jatah.
      Pengajuan yang masih <em>menunggu</em> belum dipotong, dan ditandai terpisah.
    </p>

    <div class="table-scroll"><table class="data-table table-freeze-1">
      <thead><tr>
        <th>Staff</th>
        ${tabel.jenis.map((j) => `<th>${escapeHtml(j.name)}</th>`).join('')}
      </tr></thead>
      <tbody id="sisa-body"></tbody>
    </table></div>
  `;

  content.querySelector('#sisa-cari').addEventListener('input', (e) => render(e.target.value));
  render('');
}

function barisSisaHtml(b, jenis) {
  const sel = jenis
    .map((j) => {
      const c = b.sel.find((x) => x.jenisId === j.id);
      const teks = escapeHtml(teksSel(c));
      // Minus diberi penanda merah: ia satu-satunya keadaan yang tidak bisa
      // terjadi tanpa ada yang menyetujui melampaui jatah.
      const kelas = c?.keadaan === KEADAAN.BERKUOTA && c.sisa < 0 ? 'nota-telat' : c?.habis ? 'nota-telat' : '';
      const tunda = c?.tertunda ? `<div style="font-size:0.72rem;color:var(--color-text-muted)">+${c.tertunda} menunggu</div>` : '';
      return `<td>${kelas ? `<span class="${kelas}">${teks}</span>` : teks}${tunda}</td>`;
    })
    .join('');
  return `<tr>
    <td>${escapeHtml(b.nama)}${
      b.belumDiatur ? '<div style="font-size:0.72rem;color:var(--color-text-muted)">belum diatur sama sekali</div>' : ''
    }</td>
    ${sel}
  </tr>`;
}

// ---- Tab: Pengajuan ----

async function renderRequestsTab(content, businessUnitId) {
  // Bawaan: hari ini sampai akhir bulan. Yang paling sering ditanyakan di layar
  // ini adalah "siapa yang cuti dari sekarang sampai tutup bulan" — bukan
  // seluruh riwayat. Rentangnya tetap bisa digeser ke belakang kapan saja.
  const awal = todayWIB();
  const akhir = monthEndWIB();

  content.innerHTML = `
    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin-bottom:4px">
      <div class="field" style="margin:0;min-width:180px">
        <label for="leave-nama-filter">Nama staff</label>
        <input type="search" id="leave-nama-filter" placeholder="ketik sebagian nama" autocomplete="off" />
      </div>
      <div class="field" style="margin:0;max-width:200px">
        <label for="leave-status-filter">Status</label>
        <select id="leave-status-filter">
          <option value="">Semua</option>
          <option value="pending">Menunggu</option>
          <option value="approved">Disetujui</option>
          <option value="rejected">Ditolak</option>
          <option value="cancelled">Dibatalkan</option>
        </select>
      </div>
      <div class="field" style="margin:0;min-width:140px">
        <label for="leave-dari">Cuti dari</label>
        <input type="date" id="leave-dari" value="${awal}" />
      </div>
      <div class="field" style="margin:0;min-width:140px">
        <label for="leave-sampai">sampai</label>
        <input type="date" id="leave-sampai" value="${akhir}" />
      </div>
      <button id="leave-semua" class="btn-ghost btn-inline" style="font-size:0.8rem">Semua tanggal</button>
    </div>
    <p style="font-size:0.78rem;color:var(--color-text-muted);margin:0 0 10px;max-width:620px">
      Rentangnya memakai <strong>tanggal cuti</strong>, dan memuat cuti yang
      <strong>bersinggungan</strong> dengan rentang itu — cuti 28 Sep–3 Okt tetap muncul di rentang Oktober.
    </p>
    <div id="leave-req-result">${loadingHtml('Memuat…')}</div>
  `;
  const filter = document.getElementById('leave-status-filter');
  const nama = document.getElementById('leave-nama-filter');
  const dari = document.getElementById('leave-dari');
  const sampai = document.getElementById('leave-sampai');
  const result = document.getElementById('leave-req-result');

  async function refresh() {
    result.innerHTML = loadingHtml('Memuat…', { baris: 5 });
    let requests;
    try {
      requests = await listLeaveRequestsForAdmin({
        businessUnitId,
        status: filter.value,
        dari: dari.value || null,
        sampai: sampai.value || null
      });
    } catch (error) {
      result.innerHTML = `<p class="error-text">${error.message ?? error}</p>`;
      return;
    }

    // ============ NAMA DISARING DI BROWSER, TANGGAL DI SERVER ============
    //
    // Bukan karena malas: `fuzzyMatch` menerima huruf yang berurutan tapi tidak
    // berdampingan ("bdi" cocok dengan "Budi"), dan itu tidak bisa diungkapkan
    // sebagai `ilike` tanpa menjadi pencarian yang berbeda dari layar lain.
    // Rentang tanggalnya sudah memotong jumlah barisnya lebih dulu, jadi yang
    // disaring di sini tidak pernah sebesar seluruh riwayat.
    const semua = requests;
    requests = requests.filter((r) => fuzzyMatch(nama.value, r.user_profiles?.full_name ?? ''));
    const disembunyikan = semua.length - requests.length;

    result.innerHTML = `
      ${
        disembunyikan
          ? `<p style="font-size:0.8rem;color:var(--color-text-muted);margin:0 0 6px">
               ${disembunyikan} pengajuan lain disembunyikan saringan nama.
             </p>`
          : ''
      }
      <div class="table-scroll" style="margin-top:12px"><table class="data-table table-freeze-1">
        <thead><tr><th>Staff</th><th>Diajukan</th><th>Jenis</th><th>Tanggal Cuti</th><th>Hari</th><th>Alasan</th><th>Status</th><th>Aksi</th></tr></thead>
        <tbody>
          ${requests.map(reqRowHtml).join('') || '<tr><td colspan="8">Tidak ada pengajuan.</td></tr>'}
        </tbody>
      </table></div>
    `;
    wireReqActions(result, requests, refresh);
  }

  filter.addEventListener('change', refresh);
  dari.addEventListener('change', refresh);
  sampai.addEventListener('change', refresh);
  // `input`, bukan `change`: saringan nama tidak memanggil jaringan sama sekali
  // (lihat catatan di atas), jadi menyaring per ketukan huruf itu murah — dan
  // menunggu blur membuat kotaknya terasa rusak.
  nama.addEventListener('input', refresh);
  document.getElementById('leave-semua').addEventListener('click', () => {
    dari.value = '';
    sampai.value = '';
    refresh();
  });
  await refresh();
}

function reqRowHtml(r) {
  const badge = STATUS_BADGE[r.status] ?? { label: r.status, cls: '' };
  const range = fmtRentang(r.start_date, r.end_date);
  const isPending = r.status === 'pending';

  // JEJAK PERSEMPITAN DITAMPILKAN DI SINI, bukan hanya di pesan yang dikirim.
  //
  // Admin lain yang membuka daftar ini beberapa hari kemudian hanya melihat
  // "6–8 disetujui" dan tidak punya cara tahu bahwa yang diminta 4–8. Ia bisa
  // menyimpulkan staffnya memang cuma minta tiga hari — dan kalau ada
  // pertanyaan belakangan, jawabannya keliru tanpa ada yang menyadarinya.
  const jejakUbah = diubahAdmin(r)
    ? `<div class="cuti-jejak-ubah">diajukan ${escapeHtml(fmtRentang(r.start_date_awal, r.end_date_awal))}${
        r.day_count_awal ? ` (${r.day_count_awal} hari)` : ''
      }</div>`
    : '';
  return `
    <tr>
      <td>${escapeHtml(r.user_profiles?.full_name ?? '-')}</td>
      <td style="font-size:0.82rem;color:var(--color-text-muted)">${r.created_at ? fmtDateTime(r.created_at) : '-'}</td>
      <td>${escapeHtml(r.leave_types?.name ?? '-')}${r.leave_types?.deducts_quota ? ' <span style="font-size:0.7rem;color:var(--color-text-muted)">(potong jatah)</span>' : ''}</td>
      <td>${range}${jejakUbah}</td>
      <td>${r.day_count}</td>
      <td>${escapeHtml(r.reason ?? '-')}${r.review_note ? `<div style="font-size:0.72rem;color:var(--color-text-muted)">Catatan: ${escapeHtml(r.review_note)}</div>` : ''}</td>
      <td><span class="badge ${badge.cls}">${escapeHtml(badge.label)}</span></td>
      <td>
        ${r.attachment_path ? `<button class="btn-view-attach" data-path="${r.attachment_path}">Lampiran</button>` : ''}
        ${isPending ? `<button class="btn-approve" data-id="${r.id}">Setujui</button> <button class="btn-reject" data-id="${r.id}">Tolak</button>` : ''}
        ${r.status === 'approved' || r.status === 'rejected' ? `<button class="btn-share" data-msg="${escapeAttr(decisionMsg(r))}">Bagikan</button>` : ''}
        ${
          // Revisi hanya untuk yang SUDAH diputuskan. Yang masih menunggu
          // punya tombol Setujui/Tolak sendiri — dan jalur itu yang menjaga
          // batas "hanya boleh dipersempit" pada keputusan pertama.
          r.status === 'approved' || r.status === 'rejected'
            ? `<button class="btn-revisi-cuti" data-id="${r.id}">Revisi</button>`
            : ''
        }
      </td>
    </tr>
  `;
}

/**
 * Teks yang dibagikan lewat WhatsApp.
 *
 * ISINYA SAMA PERSIS DENGAN TELEGRAM — lihat `pesan-cuti.js`.
 *
 * Versi lama satu kalimat: "Pengajuan cuti Anda (…) tanggal … telah DISETUJUI."
 * Yang menerimanya justru orang yang paling berkepentingan, dan dia yang
 * mendapat versi paling miskin: tidak ada jenis cuti, tidak ada jumlah hari,
 * tidak ada siapa yang memutuskan — dan sejak 0117, tidak ada keterangan kalau
 * tanggalnya ternyata dipersempit.
 *
 * `statusOverride`/`noteOverride` dipakai TEPAT SESUDAH menyetujui, ketika
 * data di layar belum sempat dimuat ulang dari server.
 */
function decisionMsg(r, statusOverride, noteOverride, tanggalOverride) {
  return pesanCutiWa({
    ...r,
    status: statusOverride ?? r.status,
    review_note: noteOverride ?? r.review_note,
    ...(tanggalOverride ?? {})
  });
}

function wireReqActions(root, requests, refresh) {
  const byId = new Map(requests.map((r) => [r.id, r]));

  root.querySelectorAll('.btn-view-attach').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        const url = await getAttachmentUrl(btn.dataset.path);
        if (url) window.open(url, '_blank');
      } catch (error) {
        toast(error.message ?? 'Gagal membuka lampiran.', 'error');
      }
    });
  });

  root.querySelectorAll('.btn-approve').forEach((btn) => {
    btn.addEventListener('click', () => reviewDialog(byId.get(btn.dataset.id), 'approved', refresh));
  });
  root.querySelectorAll('.btn-reject').forEach((btn) => {
    btn.addEventListener('click', () => reviewDialog(byId.get(btn.dataset.id), 'rejected', refresh));
  });
  root.querySelectorAll('.btn-revisi-cuti').forEach((btn) =>
    btn.addEventListener('click', sekaliJalan(() => revisiDialog(byId.get(btn.dataset.id), refresh)))
  );

  root.querySelectorAll('.btn-share').forEach((btn) => {
    btn.addEventListener('click', () =>
      shareDialog({ title: 'Bagikan keputusan ke staff', helper: 'Kirim ke staff bersangkutan lewat WhatsApp/chat.', defaultMessage: btn.dataset.msg })
    );
  });
}

/**
 * REVISI CUTI YANG SUDAH DIPUTUSKAN.
 *
 * ============ KENAPA BUKAN DIALOG SETUJUI YANG DIPAKAI ULANG ============
 *
 * Aturannya memang berbeda, dan bedanya bukan kosmetik. Dialog Setujui hanya
 * boleh MEMPERSEMPIT rentang yang diajukan — itu yang menjaga agar staff tidak
 * dicatatkan cuti pada hari yang tidak pernah ia minta. Revisi melepas batas
 * itu, dan yang menggantikannya adalah alasan wajib + jejak perevisinya.
 *
 * Memakai satu dialog untuk dua aturan berarti salah satu aturannya ikut
 * longgar diam-diam.
 */
async function revisiDialog(record, refresh) {
  if (!record) return;

  let jenis = [];
  try {
    jenis = await listLeaveTypesForAdmin(record.business_unit_id);
  } catch {
    // Daftar jenis yang gagal dimuat TIDAK membatalkan revisinya: tanggal dan
    // status tetap bisa dibetulkan. Yang hilang cuma kemampuan mengganti
    // jenisnya, dan itu disebutkan di bawah.
    jenis = [];
  }
  const jenisAktif = jenis.filter((t) => t.is_active !== false || t.id === record.leave_type_id);

  const nilai = await formDialog({
    title: 'Revisi Cuti',
    description:
      `${record.user_profiles?.full_name ?? 'Staff'} — ${fmtRentang(record.start_date, record.end_date)} ` +
      `(${record.day_count} hari, ${STATUS_BADGE[record.status]?.label ?? record.status}).` +
      (record.revisi_ke ? ` Sudah direvisi ${record.revisi_ke}×.` : ''),
    fields: [
      {
        name: 'status',
        label: 'Keputusan',
        type: 'select',
        required: true,
        value: record.status,
        options: [
          { value: 'approved', label: 'Disetujui' },
          { value: 'rejected', label: 'Ditolak' },
          // Dipakai saat staff tidak jadi cuti. Jatahnya kembali, dan barisnya
          // tetap ada sebagai jejak — bukan dihapus.
          { value: 'cancelled', label: 'Dibatalkan (tidak jadi cuti)' }
        ]
      },
      ...(jenisAktif.length
        ? [
            {
              name: 'type',
              label: 'Jenis cuti',
              type: 'select',
              value: record.leave_type_id ?? '',
              options: jenisAktif.map((t) => ({ value: t.id, label: t.name + (t.deducts_quota ? ' (potong jatah)' : '') }))
            }
          ]
        : []),
      {
        name: 'start',
        label: 'Mulai',
        type: 'date',
        required: true,
        value: record.start_date
      },
      {
        name: 'end',
        label: 'Sampai',
        type: 'date',
        required: true,
        value: record.end_date,
        // TIDAK ada `min`/`max` di sini, dan itu disengaja — lihat kepala
        // fungsi. Yang diajukan staff tetap disebut sebagai acuan.
        help: `Diajukan staff ${fmtRentang(record.start_date_awal ?? record.start_date, record.end_date_awal ?? record.end_date)}. Revisi boleh keluar dari rentang itu.`
      },
      { name: 'note', label: 'Catatan untuk staff (opsional)', type: 'text', value: record.review_note ?? '' },
      {
        name: 'alasan',
        label: 'Alasan revisi (wajib)',
        type: 'text',
        required: true,
        placeholder: 'mis. acara keluarga digeser, cuti diperpanjang 2 hari',
        // Ikut tercetak di pesan WhatsApp/Telegram: pesan versi sebelumnya
        // sudah beredar, dan yang membacanya perlu tahu kenapa angkanya
        // berubah tanpa harus bertanya.
        help: 'Ikut tercetak di pesan yang dibagikan ke staff.'
      }
    ],
    submitText: 'Simpan revisi',
    danger: true
  });
  if (!nilai) return;
  if (nilai.end < nilai.start) return toast('Tanggal selesai tidak boleh sebelum tanggal mulai.', 'warning');

  const hariBaru = countDaysInclusive(nilai.start, nilai.end);
  const lewat = record.end_date < todayWIB();
  const ok = await confirmDialog({
    title: 'Simpan revisi cuti?',
    messageHtml:
      `<ul style="margin:0 0 8px;padding-left:18px;font-size:0.88rem">
         ${record.status !== nilai.status ? `<li>Keputusan: ${escapeHtml(STATUS_BADGE[record.status]?.label ?? record.status)} → <strong>${escapeHtml(STATUS_BADGE[nilai.status]?.label ?? nilai.status)}</strong></li>` : ''}
         ${
           record.start_date !== nilai.start || record.end_date !== nilai.end
             ? `<li>Tanggal: ${escapeHtml(fmtRentang(record.start_date, record.end_date))} → <strong>${escapeHtml(fmtRentang(nilai.start, nilai.end))}</strong></li>`
             : ''
         }
         ${record.day_count !== hariBaru ? `<li>Jumlah hari: ${record.day_count} → <strong>${hariBaru}</strong></li>` : ''}
       </ul>` +
      (lewat
        ? `<p style="margin:0 0 8px;color:var(--color-danger);font-size:0.85rem">Cuti ini tanggalnya SUDAH LEWAT (berakhir ${escapeHtml(fmtTanggal(record.end_date))}). Jatah cutinya ikut berubah surut, dan rekap bulan itu akan berbeda dari yang sudah pernah dibaca orang.</p>`
        : '') +
      '<p style="margin:0;font-size:0.82rem;color:var(--color-text-muted)">Namamu & alasannya tersimpan, dan ikut tercetak di pesan untuk staff.</p>',
    confirmText: 'Simpan revisi',
    danger: true
  });
  if (!ok) return;

  let hasil;
  try {
    hasil = await revisiCuti({
      id: record.id,
      status: nilai.status,
      startDate: nilai.start,
      endDate: nilai.end,
      leaveTypeId: nilai.type || record.leave_type_id,
      note: nilai.note,
      alasan: nilai.alasan
    });
  } catch (error) {
    return toast(error.message ?? 'Gagal merevisi cuti.', 'error');
  }

  toast(`Cuti direvisi (revisi ke-${hasil.revisi_ke ?? 1}).`, 'success');
  await refresh();

  // Pesan versi sebelumnya sudah beredar di chat dan tidak bisa ditarik, jadi
  // dialog bagikan dibuka langsung — versi barunya menyusul ke tempat yang
  // sama, membawa penanda REVISI-nya.
  await shareDialog({
    title: 'Bagikan revisi ke staff',
    helper: 'Versi sebelumnya sudah terkirim; kirim yang ini ke chat yang sama.',
    defaultMessage: pesanCutiWa({
      ...record,
      status: nilai.status,
      start_date: nilai.start,
      end_date: nilai.end,
      day_count: hariBaru,
      review_note: nilai.note,
      revisi_ke: hasil.revisi_ke ?? (Number(record.revisi_ke) || 0) + 1,
      alasan_revisi: nilai.alasan,
      leave_types: jenisAktif.find((t) => t.id === (nilai.type || record.leave_type_id)) ?? record.leave_types
    })
  });
}

async function reviewDialog(record, status, refresh) {
  if (!record) return;
  const isApprove = status === 'approved';

  // TANGGAL HANYA DITANYAKAN SAAT MENYETUJUI.
  //
  // "Ditolak, tapi tanggalnya 6–8" bukan keadaan yang punya arti, dan kotak
  // yang muncul lalu diabaikan mengajari orang bahwa isian di dialog ini
  // kadang tidak berpengaruh — pelajaran yang akan terbawa ke kotak yang
  // berpengaruh.
  const fields = [
    { name: 'note', label: 'Catatan (opsional)', type: 'text', placeholder: isApprove ? 'mis. disetujui' : 'mis. jadwal padat' }
  ];
  if (isApprove) {
    fields.unshift(
      {
        name: 'start',
        label: 'Mulai disetujui',
        type: 'date',
        value: record.start_date,
        required: true,
        // `min`/`max` memandu pemilih tanggal di HP, TAPI bukan penjaganya —
        // orang tetap bisa mengetik di luar rentang, dan browser lama
        // mengabaikannya. Penjagaan yang sesungguhnya ada di `setujui_cuti`
        // (0117), yang menolak dengan menyebutkan rentang yang berlaku.
        min: record.start_date,
        max: record.end_date
      },
      {
        name: 'end',
        label: 'Sampai disetujui',
        type: 'date',
        value: record.end_date,
        required: true,
        min: record.start_date,
        max: record.end_date,
        help: `Diajukan ${fmtRentang(record.start_date, record.end_date)}. Boleh dipersempit, tidak boleh diperluas — kalau tanggalnya harus digeser keluar, tolak dan minta staff mengajukan ulang.`
      }
    );
  }

  const values = await formDialog({
    title: isApprove ? 'Setujui Cuti' : 'Tolak Cuti',
    description: isApprove
      ? `${record.user_profiles?.full_name ?? 'Staff'} mengajukan ${fmtRentang(record.start_date, record.end_date)} (${record.day_count} hari).`
      : '',
    fields,
    submitText: isApprove ? 'Setujui' : 'Tolak'
  });
  if (!values) return;

  try {
    await reviewLeaveRequest(record.id, {
      status,
      reviewNote: values.note,
      startDate: isApprove ? values.start : null,
      endDate: isApprove ? values.end : null
    });
  } catch (error) {
    // Pesan server sudah menyebut rentang yang diajukan dan apa jalan
    // keluarnya. Diteruskan apa adanya — menggantinya dengan "Gagal memproses"
    // membuang satu-satunya keterangan yang berguna.
    toast(error.message ?? 'Gagal memproses.', 'error');
    return;
  }

  const dipersempit = isApprove && (values.start !== record.start_date || values.end !== record.end_date);
  toast(
    isApprove ? (dipersempit ? 'Cuti disetujui sebagian.' : 'Cuti disetujui.') : 'Cuti ditolak.',
    'success'
  );
  await refresh();

  // Tanggal yang BARU dititipkan ke pesannya, karena `record` di tangan kita
  // masih memegang keadaan sebelum penyimpanan. Tanpa ini, staff menerima
  // pesan berisi tanggal yang justru tidak jadi disetujui — kebalikan dari
  // yang ingin diberitahukan.
  const tanggalBaru = isApprove
    ? {
        start_date: values.start,
        end_date: values.end,
        day_count: hitungHari(values.start, values.end),
        start_date_awal: dipersempit ? record.start_date : null,
        end_date_awal: dipersempit ? record.end_date : null,
        day_count_awal: dipersempit ? record.day_count : null
      }
    : {};

  await shareDialog({
    title: 'Bagikan keputusan ke staff',
    helper: 'Kirim ke staff bersangkutan lewat WhatsApp/chat.',
    defaultMessage: decisionMsg(record, status, values.note, tanggalBaru)
  });
}

/** Jumlah hari kalender inklusif — cerminan `(end - start) + 1` di 0117. */
function hitungHari(mulai, selesai) {
  const a = new Date(`${mulai}T00:00:00`);
  const b = new Date(`${selesai}T00:00:00`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  return Math.round((b - a) / 86400000) + 1;
}

// ---- Tab: Jenis Cuti ----

async function renderTypesTab(content, businessUnitId) {
  content.innerHTML = loadingHtml('Memuat…', { baris: 5 });
  let types;
  try {
    types = await listLeaveTypesForAdmin(businessUnitId);
  } catch (error) {
    content.innerHTML = `<p class="error-text">${error.message ?? error}</p>`;
    return;
  }
  content.innerHTML = `
    <div class="page-header">
      <h2 style="font-size:1.05rem;margin:0">Jenis Cuti</h2>
      <button class="primary" id="btn-new-type" style="max-width:200px">+ Tambah Jenis (BU ini)</button>
    </div>
    <div class="table-scroll"><table class="data-table table-freeze-1">
      <thead><tr><th>Nama</th><th>Punya Jatah</th><th>Jatah Default</th><th>Wajib Lampiran</th><th>Lingkup</th><th>Status</th><th>Aksi</th></tr></thead>
      <tbody>
        ${types.map(typeRowHtml).join('') || '<tr><td colspan="7">Belum ada jenis cuti.</td></tr>'}
      </tbody>
    </table></div>
    <p style="font-size:0.8rem;color:var(--color-text-muted);margin-top:8px">Jenis "Global" berlaku semua BU dan hanya bisa diubah Super Admin. "Jatah default" dipakai saat jenis diberikan ke staff (bisa diubah per staff di tab Hak &amp; Jatah).</p>
  `;

  document.getElementById('btn-new-type').addEventListener('click', () => openTypeDialog(content, businessUnitId, null));
  content.querySelectorAll('.btn-edit-type').forEach((btn) => {
    btn.addEventListener('click', () => openTypeDialog(content, businessUnitId, JSON.parse(btn.dataset.type)));
  });
  content.querySelectorAll('.btn-del-type').forEach((btn) => {
    btn.addEventListener('click', sekaliJalan(async () => {
      const ok = await confirmDialog({ title: 'Hapus jenis cuti?', message: 'Jenis ini akan dihapus.', confirmText: 'Hapus', danger: true });
      if (!ok) return;
      try {
        await deleteLeaveType(btn.dataset.id);
        toast('Jenis cuti dihapus.', 'success');
        await renderTypesTab(content, businessUnitId);
      } catch (error) {
        toast(error.message ?? 'Gagal menghapus (mungkin jenis global).', 'error');
      }
    }));
  });
}

function typeRowHtml(t) {
  const scope = t.business_unit_id ? 'BU ini' : 'Global';
  return `
    <tr>
      <td>${escapeHtml(t.name)}</td>
      <td>${t.deducts_quota ? 'Ya' : '-'}</td>
      <td>${t.deducts_quota ? (t.default_quota != null ? `${t.default_quota} hari` : '-') : '—'}</td>
      <td>${t.requires_attachment ? 'Ya' : '-'}</td>
      <td>${scope}</td>
      <td>${t.is_active ? 'Aktif' : 'Nonaktif'}</td>
      <td>
        <button class="btn-edit-type" data-type='${escapeAttr(JSON.stringify(t))}'>Edit</button>
        <button class="btn-del-type" data-id="${t.id}">Hapus</button>
      </td>
    </tr>
  `;
}

async function openTypeDialog(content, businessUnitId, existing) {
  const isEdit = !!existing;
  const values = await formDialog({
    title: isEdit ? 'Edit Jenis Cuti' : 'Tambah Jenis Cuti',
    fields: [
      { name: 'name', label: 'Nama Jenis', type: 'text', required: true, value: existing?.name ?? '' },
      { name: 'deducts_quota', label: 'Punya jatah tersendiri', type: 'checkbox', value: existing ? existing.deducts_quota : false },
      { name: 'default_quota', label: 'Jatah default (hari/tahun)', type: 'number', min: 0, value: existing?.default_quota ?? '' },
      { name: 'requires_attachment', label: 'Wajib lampiran', type: 'checkbox', value: existing ? existing.requires_attachment : false },
      ...(isEdit ? [{ name: 'is_active', label: 'Aktif', type: 'checkbox', value: existing.is_active }] : [])
    ],
    submitText: 'Simpan',
    onReady: (form) => {
      const chk = form.elements['deducts_quota'];
      const qField = form.elements['default_quota']?.closest('.field');
      const sync = () => {
        if (qField) qField.style.display = chk.checked ? 'block' : 'none';
      };
      chk.addEventListener('change', sync);
      sync();
    }
  });
  if (!values) return;
  const defaultQuota = values.default_quota === '' || values.default_quota == null ? null : Number(values.default_quota);
  try {
    if (isEdit) {
      await updateLeaveType(existing.id, {
        name: values.name,
        deducts_quota: values.deducts_quota,
        requires_attachment: values.requires_attachment,
        is_active: values.is_active,
        default_quota: defaultQuota
      });
      toast('Jenis cuti diperbarui.', 'success');
    } else {
      await createLeaveType({
        businessUnitId,
        name: values.name,
        deducts_quota: values.deducts_quota,
        requires_attachment: values.requires_attachment,
        default_quota: defaultQuota
      });
      toast('Jenis cuti ditambahkan.', 'success');
    }
    await renderTypesTab(content, businessUnitId);
  } catch (error) {
    toast(error.message ?? 'Gagal menyimpan (jenis global hanya untuk Super Admin).', 'error');
  }
}

// ---- Tab: Hak & Jatah (entitlements per staff) ----

async function renderEntitlementsTab(content, businessUnitId) {
  content.innerHTML = loadingHtml('Memuat…', { baris: 5 });
  let staff;
  let types;
  try {
    [staff, types] = await Promise.all([listBuStaff(businessUnitId), listLeaveTypesForAdmin(businessUnitId)]);
  } catch (error) {
    content.innerHTML = `<p class="error-text">${error.message ?? error}</p>`;
    return;
  }
  const activeTypes = types.filter((t) => t.is_active);

  // Hitung berapa jenis yang sudah diberikan tiap staff (untuk kolom status).
  const withCounts = await Promise.all(
    staff.map(async (s) => {
      let count = 0;
      try {
        count = (await listStaffEntitlements(s.user_id)).length;
      } catch {
        count = 0;
      }
      return { ...s, count };
    })
  );

  content.innerHTML = `
    <p style="color:var(--color-text-muted);font-size:0.9rem">Staff <strong>aktif</strong> di BU ini. Yang sudah dinonaktifkan di Master User tidak ditampilkan. Kolom status menandai siapa yang <strong>belum diatur</strong> hak/jatah cutinya. Klik "Atur" untuk mengatur jenis cuti yang boleh diajukan &amp; jatahnya.</p>
    <div class="table-scroll"><table class="data-table table-freeze-1">
      <thead><tr><th>Staff</th><th>Status Jatah</th><th>Aksi</th></tr></thead>
      <tbody>
        ${
          withCounts
            .map(
              (s) => `
          <tr>
            <td>${escapeHtml(s.full_name)}${s.is_active === false ? ' <span style="font-size:0.7rem;color:var(--color-danger)">(nonaktif)</span>' : ''}</td>
            <td>${s.count > 0 ? `${s.count} jenis diberikan` : '<span class="badge badge-pending">Belum diatur</span>'}</td>
            <td><button class="btn-set-ent" data-user="${s.user_id}" data-name="${escapeAttr(s.full_name)}">Atur</button></td>
          </tr>`
            )
            .join('') || '<tr><td colspan="3">Belum ada staff di BU ini.</td></tr>'
        }
      </tbody>
    </table></div>
    <div id="ent-detail" style="margin-top:16px"></div>
  `;

  content.querySelectorAll('.btn-set-ent').forEach((btn) =>
    btn.addEventListener('click', () => renderStaffEntitlements(content, businessUnitId, btn.dataset.user, btn.dataset.name, activeTypes))
  );
}

async function renderStaffEntitlements(content, businessUnitId, userId, staffName, activeTypes) {
  const detail = content.querySelector('#ent-detail');
  detail.innerHTML = loadingHtml('Memuat hak & jatah…');
  let current;
  try {
    current = await listStaffEntitlements(userId);
  } catch (error) {
    detail.innerHTML = `<p class="error-text">${error.message ?? error}</p>`;
    return;
  }
  const byType = new Map(current.map((e) => [e.leave_type_id, e.quota_days]));

  detail.innerHTML = `
    <div class="inline-card" style="max-width:560px">
      <h3 style="margin-top:0">Hak & Jatah — ${escapeHtml(staffName)}</h3>
      <table class="data-table">
        <thead><tr><th>Boleh</th><th>Jenis</th><th>Jatah (hari/tahun)</th></tr></thead>
        <tbody>
          ${activeTypes
            .map((t) => {
              const allowed = byType.has(t.id);
              const quota = byType.get(t.id);
              const quotaVal = quota != null ? quota : t.deducts_quota ? t.default_quota ?? '' : '';
              return `
              <tr data-type="${t.id}" data-hasquota="${t.deducts_quota ? '1' : '0'}">
                <td><input type="checkbox" class="ent-allow" ${allowed ? 'checked' : ''} /></td>
                <td>${escapeHtml(t.name)}${t.deducts_quota ? '' : ' <span style="font-size:0.7rem;color:var(--color-text-muted)">(tanpa jatah)</span>'}</td>
                <td>${t.deducts_quota ? `<input type="number" class="ent-quota" min="0" value="${quotaVal}" style="max-width:120px" />` : '—'}</td>
              </tr>`;
            })
            .join('') || '<tr><td colspan="3">Belum ada jenis cuti.</td></tr>'}
        </tbody>
      </table>
      <button class="primary" id="btn-save-ent" style="max-width:200px;margin-top:12px">Simpan Hak & Jatah</button>
    </div>
  `;

  document.getElementById('btn-save-ent').addEventListener('click', async () => {
    const rows = [...detail.querySelectorAll('tr[data-type]')];
    try {
      for (const row of rows) {
        const typeId = row.dataset.type;
        const allowed = row.querySelector('.ent-allow').checked;
        const hasQuota = row.dataset.hasquota === '1';
        if (allowed) {
          const q = hasQuota ? row.querySelector('.ent-quota').value : '';
          await setStaffEntitlement(userId, typeId, q === '' ? null : Number(q));
        } else {
          await removeStaffEntitlement(userId, typeId);
        }
      }
      toast('Hak & jatah cuti disimpan.', 'success');
      await renderEntitlementsTab(content, businessUnitId);
    } catch (error) {
      toast(error.message ?? 'Gagal menyimpan.', 'error');
    }
  });
}

function fmt(dateStr) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}
function fmtDateTime(iso) {
  return new Date(iso).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(s) {
  return escapeHtml(s);
}
