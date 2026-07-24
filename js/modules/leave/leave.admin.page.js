import { toast, confirmDialog, formDialog, shareDialog } from '../../core/ui.js';
import {
  listLeaveRequestsForAdmin,
  reviewLeaveRequest,
  getAttachmentUrl,
  listLeaveTypesForAdmin,
  createLeaveType,
  updateLeaveType,
  deleteLeaveType,
  listBuStaff,
  listStaffEntitlements,
  setStaffEntitlement,
  removeStaffEntitlement
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
    if (key === 'types') await renderTypesTab(content, businessUnitId);
    if (key === 'quotas') await renderEntitlementsTab(content, businessUnitId);
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
    wireReqActions(result, requests, refresh);
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
        ${r.status === 'approved' || r.status === 'rejected' ? `<button class="btn-share" data-msg="${escapeAttr(decisionMsg(r))}">Bagikan</button>` : ''}
      </td>
    </tr>
  `;
}

function decisionMsg(r, statusOverride, noteOverride) {
  const status = statusOverride ?? r.status;
  const note = noteOverride ?? r.review_note;
  const range = r.start_date === r.end_date ? fmt(r.start_date) : `${fmt(r.start_date)} s/d ${fmt(r.end_date)}`;
  const verdict = status === 'approved' ? 'DISETUJUI' : 'DITOLAK';
  let m = `Pengajuan cuti Anda (${r.leave_types?.name ?? 'cuti'}) tanggal ${range} telah ${verdict}.`;
  if (note) m += ` Catatan: ${note}.`;
  return m;
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
  root.querySelectorAll('.btn-share').forEach((btn) => {
    btn.addEventListener('click', () =>
      shareDialog({ title: 'Bagikan keputusan ke staff', helper: 'Kirim ke staff bersangkutan lewat WhatsApp/chat.', defaultMessage: btn.dataset.msg })
    );
  });
}

async function reviewDialog(record, status, refresh) {
  if (!record) return;
  const isApprove = status === 'approved';
  const values = await formDialog({
    title: isApprove ? 'Setujui Cuti' : 'Tolak Cuti',
    fields: [{ name: 'note', label: 'Catatan (opsional)', type: 'text', placeholder: isApprove ? 'mis. disetujui' : 'mis. jadwal padat' }],
    submitText: isApprove ? 'Setujui' : 'Tolak'
  });
  if (!values) return;
  try {
    await reviewLeaveRequest(record.id, { status, reviewNote: values.note });
    toast(isApprove ? 'Cuti disetujui.' : 'Cuti ditolak.', 'success');
    await refresh();
    await shareDialog({
      title: 'Bagikan keputusan ke staff',
      helper: 'Kirim ke staff bersangkutan lewat WhatsApp/chat.',
      defaultMessage: decisionMsg(record, status, values.note)
    });
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
      <thead><tr><th>Nama</th><th>Punya Jatah</th><th>Jatah Default</th><th>Wajib Lampiran</th><th>Lingkup</th><th>Status</th><th>Aksi</th></tr></thead>
      <tbody>
        ${types.map(typeRowHtml).join('') || '<tr><td colspan="7">Belum ada jenis cuti.</td></tr>'}
      </tbody>
    </table>
    <p style="font-size:0.8rem;color:var(--color-text-muted);margin-top:8px">Jenis "Global" berlaku semua BU dan hanya bisa diubah Super Admin. "Jatah default" dipakai saat jenis diberikan ke staff (bisa diubah per staff di tab Hak &amp; Jatah).</p>
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
  content.innerHTML = `<p>Memuat...</p>`;
  let staff;
  let types;
  try {
    [staff, types] = await Promise.all([listBuStaff(businessUnitId), listLeaveTypesForAdmin(businessUnitId)]);
  } catch (error) {
    content.innerHTML = `<p class="error-text">${error.message ?? error}</p>`;
    return;
  }
  const activeTypes = types.filter((t) => t.is_active);

  content.innerHTML = `
    <p style="color:var(--color-text-muted);font-size:0.9rem">Pilih staff, lalu centang jenis cuti yang boleh dia ajukan &amp; isi jatahnya. Jenis "punya jatah" akan memotong sisa; jenis tanpa jatah tidak dibatasi.</p>
    <div class="field" style="max-width:280px">
      <label>Staff</label>
      <select id="ent-staff-select">
        <option value="">-- pilih staff --</option>
        ${staff.map((s) => `<option value="${s.user_id}">${escapeHtml(s.full_name)}${s.is_active === false ? ' (nonaktif)' : ''}</option>`).join('')}
      </select>
    </div>
    <div id="ent-detail"></div>
  `;

  const select = document.getElementById('ent-staff-select');
  select.addEventListener('change', () => renderStaffEntitlements(select.value, activeTypes));
}

async function renderStaffEntitlements(userId, activeTypes) {
  const detail = document.getElementById('ent-detail');
  if (!userId) {
    detail.innerHTML = '';
    return;
  }
  detail.innerHTML = `<p>Memuat hak & jatah...</p>`;
  let current;
  try {
    current = await listStaffEntitlements(userId);
  } catch (error) {
    detail.innerHTML = `<p class="error-text">${error.message ?? error}</p>`;
    return;
  }
  const byType = new Map(current.map((e) => [e.leave_type_id, e.quota_days]));

  detail.innerHTML = `
    <table class="data-table" style="margin-top:12px">
      <thead><tr><th>Boleh</th><th>Jenis</th><th>Jatah (hari/tahun)</th></tr></thead>
      <tbody>
        ${activeTypes
          .map((t) => {
            const allowed = byType.has(t.leave_type_id ?? t.id);
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
      await renderStaffEntitlements(userId, activeTypes);
    } catch (error) {
      toast(error.message ?? 'Gagal menyimpan.', 'error');
    }
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
