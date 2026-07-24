import { toast, confirmDialog, formDialog } from '../../core/ui.js';
import {
  listLeaveRequestsForAdmin,
  reviewLeaveRequest,
  getAttachmentUrl,
  listLeaveTypesForAdmin,
  createLeaveType,
  updateLeaveType,
  deleteLeaveType,
  listBuStaff,
  getLeaveQuota,
  getLeaveUsedDays,
  upsertLeaveQuota
} from './leave.service.js';

const STATUS_BADGE = {
  pending: { label: 'Menunggu', cls: 'badge-pending' },
  approved: { label: 'Disetujui', cls: 'badge-approved' },
  rejected: { label: 'Ditolak', cls: 'badge-rejected' },
  cancelled: { label: 'Dibatalkan', cls: 'badge-cancelled' }
};

const TABS = [
  { key: 'requests', label: 'Pengajuan' },
  { key: 'types', label: 'Jenis Cuti' },
  { key: 'quotas', label: 'Jatah Cuti' }
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
    if (key === 'types') await renderTypesTab(content, businessUnitId);
    if (key === 'quotas') await renderQuotasTab(content, businessUnitId);
  }
  container.querySelectorAll('.tab-btn').forEach((btn) => btn.addEventListener('click', () => showTab(btn.dataset.tab)));
  await showTab('requests');
}

// ---- Tab: Pengajuan ----

async function renderRequestsTab(content, businessUnitId) {
  content.innerHTML = `
    <div class="field" style="max-width:220px">
      <label>Status</label>
      <select id="leave-status-filter">
        <option value="pending">Menunggu</option>
        <option value="approved">Disetujui</option>
        <option value="rejected">Ditolak</option>
        <option value="cancelled">Dibatalkan</option>
        <option value="">Semua</option>
      </select>
    </div>
    <div id="leave-req-result"><p>Memuat...</p></div>
  `;
  const filter = document.getElementById('leave-status-filter');
  const result = document.getElementById('leave-req-result');

  async function refresh() {
    result.innerHTML = `<p>Memuat...</p>`;
    let requests;
    try {
      requests = await listLeaveRequestsForAdmin({ businessUnitId, status: filter.value });
    } catch (error) {
      result.innerHTML = `<p class="error-text">${error.message ?? error}</p>`;
      return;
    }
    result.innerHTML = `
      <table class="data-table" style="margin-top:12px">
        <thead><tr><th>Staff</th><th>Jenis</th><th>Tanggal</th><th>Hari</th><th>Alasan</th><th>Status</th><th>Aksi</th></tr></thead>
        <tbody>
          ${requests.map(reqRowHtml).join('') || '<tr><td colspan="7">Tidak ada pengajuan.</td></tr>'}
        </tbody>
      </table>
    `;
    wireReqActions(result, businessUnitId, refresh);
  }

  filter.addEventListener('change', refresh);
  await refresh();
}

function reqRowHtml(r) {
  const badge = STATUS_BADGE[r.status] ?? { label: r.status, cls: '' };
  const range = r.start_date === r.end_date ? fmt(r.start_date) : `${fmt(r.start_date)} – ${fmt(r.end_date)}`;
  const isPending = r.status === 'pending';
  return `
    <tr>
      <td>${escapeHtml(r.user_profiles?.full_name ?? '-')}</td>
      <td>${escapeHtml(r.leave_types?.name ?? '-')}${r.leave_types?.deducts_quota ? ' <span style="font-size:0.7rem;color:var(--color-text-muted)">(potong jatah)</span>' : ''}</td>
      <td>${range}</td>
      <td>${r.day_count}</td>
      <td>${escapeHtml(r.reason ?? '-')}${r.review_note ? `<div style="font-size:0.72rem;color:var(--color-text-muted)">Catatan: ${escapeHtml(r.review_note)}</div>` : ''}</td>
      <td><span class="badge ${badge.cls}">${badge.label}</span></td>
      <td>
        ${r.attachment_path ? `<button class="btn-view-attach" data-path="${r.attachment_path}">Lampiran</button>` : ''}
        ${isPending ? `<button class="btn-approve" data-id="${r.id}">Setujui</button> <button class="btn-reject" data-id="${r.id}">Tolak</button>` : ''}
      </td>
    </tr>
  `;
}

function wireReqActions(root, businessUnitId, refresh) {
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
    btn.addEventListener('click', () => reviewDialog(btn.dataset.id, 'approved', refresh));
  });
  root.querySelectorAll('.btn-reject').forEach((btn) => {
    btn.addEventListener('click', () => reviewDialog(btn.dataset.id, 'rejected', refresh));
  });
}

async function reviewDialog(id, status, refresh) {
  const isApprove = status === 'approved';
  const values = await formDialog({
    title: isApprove ? 'Setujui Cuti' : 'Tolak Cuti',
    fields: [{ name: 'note', label: 'Catatan (opsional)', type: 'text', placeholder: isApprove ? 'mis. disetujui' : 'mis. jadwal padat' }],
    submitText: isApprove ? 'Setujui' : 'Tolak'
  });
  if (!values) return;
  try {
    await reviewLeaveRequest(id, { status, reviewNote: values.note });
    toast(isApprove ? 'Cuti disetujui.' : 'Cuti ditolak.', 'success');
    await refresh();
  } catch (error) {
    toast(error.message ?? 'Gagal memproses.', 'error');
  }
}

// ---- Tab: Jenis Cuti ----

async function renderTypesTab(content, businessUnitId) {
  content.innerHTML = `<p>Memuat...</p>`;
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
    <table class="data-table">
      <thead><tr><th>Nama</th><th>Potong Jatah</th><th>Wajib Lampiran</th><th>Lingkup</th><th>Status</th><th>Aksi</th></tr></thead>
      <tbody>
        ${types.map(typeRowHtml).join('') || '<tr><td colspan="6">Belum ada jenis cuti.</td></tr>'}
      </tbody>
    </table>
    <p style="font-size:0.8rem;color:var(--color-text-muted);margin-top:8px">Jenis "Global" berlaku semua BU dan hanya bisa diubah Super Admin.</p>
  `;

  document.getElementById('btn-new-type').addEventListener('click', () => openTypeDialog(content, businessUnitId, null));
  content.querySelectorAll('.btn-edit-type').forEach((btn) => {
    btn.addEventListener('click', () => openTypeDialog(content, businessUnitId, JSON.parse(btn.dataset.type)));
  });
  content.querySelectorAll('.btn-del-type').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const ok = await confirmDialog({ title: 'Hapus jenis cuti?', message: 'Jenis ini akan dihapus.', confirmText: 'Hapus', danger: true });
      if (!ok) return;
      try {
        await deleteLeaveType(btn.dataset.id);
        toast('Jenis cuti dihapus.', 'success');
        await renderTypesTab(content, businessUnitId);
      } catch (error) {
        toast(error.message ?? 'Gagal menghapus (mungkin jenis global).', 'error');
      }
    });
  });
}

function typeRowHtml(t) {
  const scope = t.business_unit_id ? 'BU ini' : 'Global';
  return `
    <tr>
      <td>${escapeHtml(t.name)}</td>
      <td>${t.deducts_quota ? 'Ya' : '-'}</td>
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
      { name: 'deducts_quota', label: 'Memotong jatah cuti tahunan', type: 'checkbox', value: existing ? existing.deducts_quota : false },
      { name: 'requires_attachment', label: 'Wajib lampiran', type: 'checkbox', value: existing ? existing.requires_attachment : false },
      ...(isEdit ? [{ name: 'is_active', label: 'Aktif', type: 'checkbox', value: existing.is_active }] : [])
    ],
    submitText: 'Simpan'
  });
  if (!values) return;
  try {
    if (isEdit) {
      await updateLeaveType(existing.id, {
        name: values.name,
        deducts_quota: values.deducts_quota,
        requires_attachment: values.requires_attachment,
        is_active: values.is_active
      });
      toast('Jenis cuti diperbarui.', 'success');
    } else {
      await createLeaveType({
        businessUnitId,
        name: values.name,
        deducts_quota: values.deducts_quota,
        requires_attachment: values.requires_attachment
      });
      toast('Jenis cuti ditambahkan.', 'success');
    }
    await renderTypesTab(content, businessUnitId);
  } catch (error) {
    toast(error.message ?? 'Gagal menyimpan (jenis global hanya untuk Super Admin).', 'error');
  }
}

// ---- Tab: Jatah Cuti ----

async function renderQuotasTab(content, businessUnitId) {
  const year = new Date().getFullYear();
  content.innerHTML = `<p>Memuat jatah cuti...</p>`;
  let staff;
  try {
    staff = await listBuStaff(businessUnitId);
  } catch (error) {
    content.innerHTML = `<p class="error-text">${error.message ?? error}</p>`;
    return;
  }

  const summary = await Promise.all(
    staff.map(async (s) => {
      const [total, used] = await Promise.all([getLeaveQuota(s.user_id, year), getLeaveUsedDays(s.user_id, year)]);
      return { ...s, total, used };
    })
  );

  content.innerHTML = `
    <h2 style="font-size:1.05rem">Jatah Cuti ${year}</h2>
    <table class="data-table">
      <thead><tr><th>Staff</th><th>Jatah</th><th>Terpakai</th><th>Sisa</th><th>Aksi</th></tr></thead>
      <tbody>
        ${
          summary
            .map(
              (s) => `
          <tr>
            <td>${escapeHtml(s.full_name)}${s.is_active === false ? ' <span style="font-size:0.7rem;color:var(--color-danger)">(nonaktif)</span>' : ''}</td>
            <td>${s.total == null ? '<span style="color:var(--color-text-muted)">belum diatur</span>' : s.total}</td>
            <td>${s.used}</td>
            <td>${s.total == null ? '-' : s.total - s.used}</td>
            <td><button class="btn-set-quota" data-user="${s.user_id}" data-name="${escapeAttr(s.full_name)}" data-total="${s.total ?? ''}">Set Jatah</button></td>
          </tr>`
            )
            .join('') || '<tr><td colspan="5">Belum ada staff di BU ini.</td></tr>'
        }
      </tbody>
    </table>
  `;

  content.querySelectorAll('.btn-set-quota').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const values = await formDialog({
        title: `Set Jatah Cuti ${year}`,
        description: `Untuk ${btn.dataset.name}.`,
        fields: [{ name: 'total_days', label: 'Jatah hari per tahun', type: 'number', required: true, min: 0, value: btn.dataset.total }],
        submitText: 'Simpan'
      });
      if (!values) return;
      try {
        await upsertLeaveQuota(btn.dataset.user, year, Number(values.total_days));
        toast('Jatah cuti disimpan.', 'success');
        await renderQuotasTab(content, businessUnitId);
      } catch (error) {
        toast(error.message ?? 'Gagal menyimpan jatah.', 'error');
      }
    });
  });
}

function fmt(dateStr) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(s) {
  return escapeHtml(s);
}
