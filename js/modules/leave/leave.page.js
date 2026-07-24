import { toast, confirmDialog, formDialog, shareDialog } from '../../core/ui.js';
import {
  getMyEntitlementSummary,
  listAllowedLeaveTypes,
  listMyLeaveRequests,
  submitLeaveRequest,
  cancelLeaveRequest,
  getAttachmentUrl
} from './leave.service.js';

const STATUS_BADGE = {
  pending: { label: 'Menunggu', cls: 'badge-pending' },
  approved: { label: 'Disetujui', cls: 'badge-approved' },
  rejected: { label: 'Ditolak', cls: 'badge-rejected' },
  cancelled: { label: 'Dibatalkan', cls: 'badge-cancelled' }
};

export async function renderLeavePage(container, { userId, businessUnitId, outletId }) {
  container.innerHTML = `<p>Memuat data cuti...</p>`;
  container.dataset.userId = userId ?? '';
  container.dataset.buId = businessUnitId ?? '';
  container.dataset.outletId = outletId ?? '';
  const year = new Date().getFullYear();

  const [entitlements, types, requests] = await Promise.all([
    getMyEntitlementSummary(),
    listAllowedLeaveTypes(),
    listMyLeaveRequests()
  ]);

  container.innerHTML = `
    <h1>Pengajuan Cuti</h1>
    <div class="inline-card">
      <h3 style="margin-top:0">Hak &amp; Sisa Jatah Cuti ${year}</h3>
      ${
        entitlements.length
          ? `<table class="data-table">
              <thead><tr><th>Jenis</th><th>Jatah</th><th>Terpakai</th><th>Sisa</th></tr></thead>
              <tbody>
                ${entitlements
                  .map((e) => {
                    const quota = e.has_quota && e.quota_days != null ? `${e.quota_days} hari` : 'Tanpa batas';
                    const sisa = e.has_quota && e.quota_days != null ? `${e.quota_days - e.used} hari` : '—';
                    return `<tr><td>${escapeHtml(e.name)}</td><td>${quota}</td><td>${e.used}</td><td>${sisa}</td></tr>`;
                  })
                  .join('')}
              </tbody>
            </table>`
          : `<p style="color:var(--color-text-muted)">Kamu belum diberi hak jenis cuti apa pun. Hubungi admin.</p>`
      }
      <button class="primary" id="btn-new-leave" style="max-width:200px;margin-top:12px" ${types.length ? '' : 'disabled'}>+ Ajukan Cuti</button>
    </div>

    <h2 style="font-size:1rem;margin-top:24px">Riwayat Pengajuan</h2>
    <table class="data-table">
      <thead><tr><th>Jenis</th><th>Tanggal</th><th>Hari</th><th>Status</th><th></th></tr></thead>
      <tbody id="leave-rows">
        ${requests.map(rowHtml).join('') || '<tr><td colspan="5">Belum ada pengajuan.</td></tr>'}
      </tbody>
    </table>
  `;

  document.getElementById('btn-new-leave').addEventListener('click', () =>
    openLeaveForm(container, { businessUnitId, outletId }, types)
  );

  wireRows(container);
}

function rowHtml(r) {
  const badge = STATUS_BADGE[r.status] ?? { label: r.status, cls: '' };
  const range = r.start_date === r.end_date ? fmt(r.start_date) : `${fmt(r.start_date)} – ${fmt(r.end_date)}`;
  const canCancel = r.status === 'pending';
  return `
    <tr>
      <td>${r.leave_types?.name ?? '-'}</td>
      <td>${range}</td>
      <td>${r.day_count}</td>
      <td>
        <span class="badge ${badge.cls}">${badge.label}</span>
        ${r.review_note ? `<div style="font-size:0.75rem;color:var(--color-text-muted);margin-top:2px">Catatan: ${escapeHtml(r.review_note)}</div>` : ''}
      </td>
      <td>
        ${r.attachment_path ? `<button class="btn-view-attach" data-path="${r.attachment_path}">Lampiran</button>` : ''}
        ${r.status !== 'cancelled' ? `<button class="btn-share" data-msg="${escapeHtml(staffShareMsg(r, range))}">Bagikan</button>` : ''}
        ${canCancel ? `<button class="btn-cancel-leave" data-id="${r.id}">Batalkan</button>` : ''}
      </td>
    </tr>
  `;
}

function staffShareMsg(r, range) {
  const type = r.leave_types?.name ?? 'cuti';
  if (r.status === 'approved') return `Info: cuti saya (${type}) tanggal ${range} sudah disetujui.`;
  if (r.status === 'rejected') return `Info: pengajuan cuti saya (${type}) tanggal ${range} ditolak.`;
  return `Halo, saya mengajukan ${type} tanggal ${range}${r.reason ? ` (${r.reason})` : ''}. Mohon persetujuannya. Terima kasih.`;
}

function wireRows(container) {
  container.querySelectorAll('.btn-cancel-leave').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: 'Batalkan pengajuan?',
        message: 'Pengajuan cuti ini akan dibatalkan.',
        confirmText: 'Batalkan',
        danger: true
      });
      if (!ok) return;
      try {
        await cancelLeaveRequest(btn.dataset.id);
        toast('Pengajuan dibatalkan.', 'success');
        await renderLeavePage(container, contextFrom(container));
      } catch (error) {
        toast(error.message ?? 'Gagal membatalkan.', 'error');
      }
    });
  });

  container.querySelectorAll('.btn-view-attach').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        const url = await getAttachmentUrl(btn.dataset.path);
        if (url) window.open(url, '_blank');
      } catch (error) {
        toast(error.message ?? 'Gagal membuka lampiran.', 'error');
      }
    });
  });

  container.querySelectorAll('.btn-share').forEach((btn) => {
    btn.addEventListener('click', () =>
      shareDialog({ title: 'Bagikan ke PIC', helper: 'Kirim lewat WhatsApp/chat ke atasan/PIC.', defaultMessage: btn.dataset.msg })
    );
  });
}

// Simpan konteks di dataset supaya re-render setelah aksi tetap tahu BU/outlet.
function contextFrom(container) {
  return {
    userId: container.dataset.userId,
    businessUnitId: container.dataset.buId,
    outletId: container.dataset.outletId || null
  };
}

async function openLeaveForm(container, { businessUnitId, outletId }, types) {
  if (types.length === 0) {
    toast('Belum ada jenis cuti yang tersedia. Hubungi admin.', 'warning');
    return;
  }
  const values = await formDialog({
    title: 'Ajukan Cuti',
    fields: [
      { name: 'leave_type_id', label: 'Jenis Cuti', type: 'select', required: true, options: types.map((t) => ({ value: t.id, label: t.name })) },
      { name: 'start_date', label: 'Tanggal Mulai', type: 'date', required: true },
      { name: 'end_date', label: 'Tanggal Selesai', type: 'date', required: true },
      { name: 'reason', label: 'Alasan (opsional)', type: 'text', placeholder: 'mis. acara keluarga' },
      { name: 'file', label: 'Lampiran (opsional)', type: 'file', accept: 'image/*,application/pdf', help: 'mis. surat dokter untuk cuti sakit' }
    ],
    submitText: 'Kirim Pengajuan'
  });
  if (!values) return;

  if (values.end_date < values.start_date) {
    toast('Tanggal selesai tidak boleh sebelum tanggal mulai.', 'error');
    return;
  }
  const type = types.find((t) => t.id === values.leave_type_id);
  if (type?.requires_attachment && !values.file) {
    toast(`Jenis cuti "${type.name}" wajib melampirkan file.`, 'warning');
    return;
  }

  try {
    await submitLeaveRequest({
      businessUnitId,
      outletId,
      leaveTypeId: values.leave_type_id,
      startDate: values.start_date,
      endDate: values.end_date,
      reason: values.reason,
      file: values.file
    });
    toast('Pengajuan cuti terkirim. Menunggu persetujuan admin.', 'success');
    await renderLeavePage(container, { userId: container.dataset.userId, businessUnitId, outletId });
  } catch (error) {
    toast(error.message ?? 'Gagal mengirim pengajuan.', 'error');
  }
}

function fmt(dateStr) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
