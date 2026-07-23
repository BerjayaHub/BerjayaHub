import {
  listStaffWithScopes,
  listBusinessUnits,
  listOutlets,
  updateProfile,
  addMembershipScope,
  removeMembershipScope,
  createStaffUser,
  resetStaffPassword
} from './master-user.service.js';
import { listRegisteredFaceUserIds, resetFaceDescriptor } from '../attendance/attendance.service.js';
import { toast, confirmDialog, formDialog } from '../../core/ui.js';

const ROLE_LABEL = {
  super_admin: 'Super Admin',
  bu_admin: 'Admin BU',
  outlet_admin: 'Admin Outlet',
  staff: 'Staff'
};

const ROLE_OPTIONS = [
  { value: 'staff', label: 'Staff' },
  { value: 'outlet_admin', label: 'Admin Outlet' },
  { value: 'bu_admin', label: 'Admin BU' }
];

export async function renderMasterUserPage(container) {
  container.innerHTML = `<p>Memuat data staff...</p>`;

  const [staffList, businessUnits, registeredFaceIds] = await Promise.all([
    listStaffWithScopes(),
    listBusinessUnits(),
    listRegisteredFaceUserIds()
  ]);

  container.innerHTML = `
    <div class="page-header">
      <h1>Master User</h1>
      <button class="primary" id="btn-new-staff" style="max-width:180px">+ Tambah Staff</button>
    </div>
    <div id="new-staff-form-wrap"></div>
    <table class="data-table" id="staff-table">
      <thead>
        <tr>
          <th>Nama</th>
          <th>Telp</th>
          <th>Scope (BU / Outlet / Role)</th>
          <th>Status</th>
          <th>Wajah</th>
          <th>Aksi</th>
        </tr>
      </thead>
      <tbody>
        ${staffList.map((s) => staffRowHtml(s, registeredFaceIds)).join('') || '<tr><td colspan="6">Belum ada staff.</td></tr>'}
      </tbody>
    </table>
  `;

  document.getElementById('btn-new-staff').addEventListener('click', () => {
    renderNewStaffForm(container, businessUnits);
  });

  wireRowActions(container, businessUnits);
}

function staffRowHtml(s, registeredFaceIds) {
  const scopeBadges = s.scopes
    .map(
      (sc) => `
      <span class="scope-badge" data-scope-id="${sc.id}">
        ${sc.business_units?.name ?? '-'} ${sc.outlets?.name ? '/ ' + sc.outlets.name : ''} — ${ROLE_LABEL[sc.role] ?? sc.role}
        <button class="scope-remove" data-scope-id="${sc.id}" title="Hapus scope ini">✕</button>
      </span>`
    )
    .join(' ');

  const hasFace = registeredFaceIds.has(s.profile.id);

  return `
    <tr data-user-id="${s.profile.id}">
      <td>${s.profile.full_name}</td>
      <td>${s.profile.phone ?? '-'}</td>
      <td>${scopeBadges} <button class="btn-add-scope" data-user-id="${s.profile.id}">+ scope</button></td>
      <td>${s.profile.is_active ? 'Aktif' : 'Nonaktif'}</td>
      <td>
        ${hasFace ? 'Terdaftar ✅' : 'Belum daftar'}
        ${hasFace ? `<button class="btn-reset-face" data-user-id="${s.profile.id}">Reset</button>` : ''}
      </td>
      <td>
        <button class="btn-edit" data-user-id="${s.profile.id}">Edit</button>
        <button class="btn-reset-password" data-user-id="${s.profile.id}">Reset Password</button>
        <button class="btn-toggle-active" data-user-id="${s.profile.id}" data-active="${s.profile.is_active}">
          ${s.profile.is_active ? 'Nonaktifkan' : 'Aktifkan'}
        </button>
      </td>
    </tr>
  `;
}

function renderNewStaffForm(container, businessUnits) {
  const wrap = container.querySelector('#new-staff-form-wrap');
  wrap.innerHTML = `
    <form class="inline-card" id="new-staff-form">
      <h3>Tambah Staff Baru</h3>
      <div class="field"><label>Nama Lengkap</label><input name="full_name" required /></div>
      <div class="field"><label>Email</label><input name="email" type="email" required /></div>
      <div class="field"><label>Password Awal</label><input name="password" type="text" minlength="6" required placeholder="Minimal 6 karakter" /></div>
      <div class="field"><label>No. Telp</label><input name="phone" /></div>
      <div class="field">
        <label>Business Unit</label>
        <select name="business_unit_id" required>
          <option value="">-- pilih BU --</option>
          ${businessUnits.map((bu) => `<option value="${bu.id}">${bu.name}</option>`).join('')}
        </select>
      </div>
      <div class="field">
        <label>Outlet (opsional)</label>
        <select name="outlet_id"><option value="">-- semua outlet / level BU --</option></select>
      </div>
      <div class="field">
        <label>Role</label>
        <select name="role" required>
          <option value="staff">Staff</option>
          <option value="outlet_admin">Admin Outlet</option>
          <option value="bu_admin">Admin BU</option>
        </select>
      </div>
      <button class="primary" type="submit">Simpan</button>
      <button type="button" id="btn-cancel-new-staff">Batal</button>
      <p class="error-text" id="new-staff-error"></p>
    </form>
  `;

  const form = document.getElementById('new-staff-form');

  form.business_unit_id.addEventListener('change', async (e) => {
    const outlets = e.target.value ? await listOutlets(e.target.value) : [];
    form.outlet_id.innerHTML =
      `<option value="">-- semua outlet / level BU --</option>` +
      outlets.map((o) => `<option value="${o.id}">${o.name}</option>`).join('');
  });

  document.getElementById('btn-cancel-new-staff').addEventListener('click', () => {
    wrap.innerHTML = '';
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      full_name: form.full_name.value.trim(),
      email: form.email.value.trim(),
      password: form.password.value,
      phone: form.phone.value.trim() || null,
      business_unit_id: form.business_unit_id.value,
      outlet_id: form.outlet_id.value || null,
      role: form.role.value
    };
    try {
      await createStaffUser(payload);
      wrap.innerHTML = '';
      toast('Staff baru berhasil ditambahkan.', 'success');
      await renderMasterUserPage(container);
    } catch (error) {
      document.getElementById('new-staff-error').textContent = error.message ?? 'Gagal menyimpan staff.';
    }
  });
}

function wireRowActions(container, businessUnits) {
  container.querySelectorAll('.btn-toggle-active').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const userId = btn.dataset.userId;
      const isActive = btn.dataset.active === 'true';
      const ok = await confirmDialog({
        title: isActive ? 'Nonaktifkan staff?' : 'Aktifkan staff?',
        message: isActive
          ? 'Staff yang dinonaktifkan tidak bisa login sampai diaktifkan lagi.'
          : 'Staff akan bisa login kembali.',
        confirmText: isActive ? 'Nonaktifkan' : 'Aktifkan',
        danger: isActive
      });
      if (!ok) return;
      try {
        await updateProfile(userId, { is_active: !isActive });
        toast(isActive ? 'Staff dinonaktifkan.' : 'Staff diaktifkan.', 'success');
        await renderMasterUserPage(container);
      } catch (error) {
        toast(error.message ?? 'Gagal memperbarui status.', 'error');
      }
    });
  });

  container.querySelectorAll('.btn-reset-face').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: 'Reset data wajah?',
        message: 'Staff akan diminta mendaftarkan wajah ulang saat clock in berikutnya.',
        confirmText: 'Reset',
        danger: true
      });
      if (!ok) return;
      try {
        await resetFaceDescriptor(btn.dataset.userId);
        toast('Data wajah direset.', 'success');
        await renderMasterUserPage(container);
      } catch (error) {
        toast(error.message ?? 'Gagal reset data wajah.', 'error');
      }
    });
  });

  container.querySelectorAll('.btn-reset-password').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const values = await formDialog({
        title: 'Reset Password Staff',
        description: 'Isi password baru. Beritahu staff password barunya setelah ini.',
        fields: [
          { name: 'password', label: 'Password baru', type: 'text', required: true, minlength: 6, placeholder: 'Minimal 6 karakter' }
        ],
        submitText: 'Reset Password'
      });
      if (!values) return;
      try {
        await resetStaffPassword(btn.dataset.userId, values.password);
        toast('Password berhasil direset.', 'success');
      } catch (error) {
        toast(error.message ?? 'Gagal reset password.', 'error');
      }
    });
  });

  container.querySelectorAll('.btn-edit').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const row = container.querySelector(`tr[data-user-id="${btn.dataset.userId}"]`);
      const currentName = row.children[0].textContent;
      const currentPhone = row.children[1].textContent === '-' ? '' : row.children[1].textContent;
      const values = await formDialog({
        title: 'Edit Staff',
        fields: [
          { name: 'full_name', label: 'Nama Lengkap', type: 'text', required: true, value: currentName },
          { name: 'phone', label: 'No. Telp', type: 'tel', value: currentPhone, placeholder: 'Opsional' }
        ],
        submitText: 'Simpan'
      });
      if (!values) return;
      try {
        await updateProfile(btn.dataset.userId, { full_name: values.full_name, phone: values.phone || null });
        toast('Data staff diperbarui.', 'success');
        await renderMasterUserPage(container);
      } catch (error) {
        toast(error.message ?? 'Gagal memperbarui staff.', 'error');
      }
    });
  });

  container.querySelectorAll('.scope-remove').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: 'Hapus scope?',
        message: 'Akses staff ke BU/outlet ini akan dicabut.',
        confirmText: 'Hapus',
        danger: true
      });
      if (!ok) return;
      try {
        await removeMembershipScope(btn.dataset.scopeId);
        toast('Scope dihapus.', 'success');
        await renderMasterUserPage(container);
      } catch (error) {
        toast(error.message ?? 'Gagal menghapus scope.', 'error');
      }
    });
  });

  container.querySelectorAll('.btn-add-scope').forEach((btn) => {
    btn.addEventListener('click', () => openAddScopeDialog(container, businessUnits, btn.dataset.userId));
  });
}

/** Tambah scope pakai dropdown (tanpa ketik UUID). Outlet ikut BU yang dipilih. */
async function openAddScopeDialog(container, businessUnits, userId) {
  const values = await formDialog({
    title: 'Tambah Scope',
    description: 'Pilih BU, outlet (opsional), dan role. Tidak perlu isi UUID.',
    fields: [
      {
        name: 'business_unit_id',
        label: 'Business Unit',
        type: 'select',
        required: true,
        options: [{ value: '', label: '-- pilih BU --' }, ...businessUnits.map((bu) => ({ value: bu.id, label: bu.name }))]
      },
      {
        name: 'outlet_id',
        label: 'Outlet (opsional)',
        type: 'select',
        options: [{ value: '', label: '-- semua outlet / level BU --' }]
      },
      { name: 'role', label: 'Role', type: 'select', required: true, options: ROLE_OPTIONS }
    ],
    submitText: 'Tambah',
    onReady: (form) => {
      const buSelect = form.elements['business_unit_id'];
      const outletSelect = form.elements['outlet_id'];
      buSelect.addEventListener('change', async () => {
        outletSelect.innerHTML = '<option value="">-- semua outlet / level BU --</option>';
        if (!buSelect.value) return;
        try {
          const outlets = await listOutlets(buSelect.value);
          outletSelect.innerHTML =
            '<option value="">-- semua outlet / level BU --</option>' +
            outlets.map((o) => `<option value="${o.id}">${o.name}</option>`).join('');
        } catch {
          // biarkan default kalau gagal ambil outlet
        }
      });
    }
  });
  if (!values) return;
  try {
    await addMembershipScope({
      user_id: userId,
      business_unit_id: values.business_unit_id,
      outlet_id: values.outlet_id || null,
      role: values.role
    });
    toast('Scope ditambahkan.', 'success');
    await renderMasterUserPage(container);
  } catch (error) {
    toast(error.message ?? 'Gagal menambah scope.', 'error');
  }
}
