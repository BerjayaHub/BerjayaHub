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

const ROLE_LABEL = {
  super_admin: 'Super Admin',
  bu_admin: 'Admin BU',
  outlet_admin: 'Admin Outlet',
  staff: 'Staff'
};

export async function renderMasterUserPage(container) {
  container.innerHTML = `<p>Memuat data staff...</p>`;

  const [staffList, businessUnits] = await Promise.all([
    listStaffWithScopes(),
    listBusinessUnits()
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
          <th>Aksi</th>
        </tr>
      </thead>
      <tbody>
        ${staffList.map((s) => staffRowHtml(s)).join('') || '<tr><td colspan="5">Belum ada staff.</td></tr>'}
      </tbody>
    </table>
  `;

  document.getElementById('btn-new-staff').addEventListener('click', () => {
    renderNewStaffForm(container, businessUnits);
  });

  wireRowActions(container, businessUnits);
}

function staffRowHtml(s) {
  const scopeBadges = s.scopes
    .map(
      (sc) => `
      <span class="scope-badge" data-scope-id="${sc.id}">
        ${sc.business_units?.name ?? '-'} ${sc.outlets?.name ? '/ ' + sc.outlets.name : ''} — ${ROLE_LABEL[sc.role] ?? sc.role}
        <button class="scope-remove" data-scope-id="${sc.id}" title="Hapus scope ini">✕</button>
      </span>`
    )
    .join(' ');

  return `
    <tr data-user-id="${s.profile.id}">
      <td>${s.profile.full_name}</td>
      <td>${s.profile.phone ?? '-'}</td>
      <td>${scopeBadges} <button class="btn-add-scope" data-user-id="${s.profile.id}">+ scope</button></td>
      <td>${s.profile.is_active ? 'Aktif' : 'Nonaktif'}</td>
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
      await updateProfile(userId, { is_active: !isActive });
      await renderMasterUserPage(container);
    });
  });

  container.querySelectorAll('.btn-reset-password').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const newPassword = prompt('Password baru untuk staff ini (minimal 6 karakter):');
      if (!newPassword) return;
      if (newPassword.length < 6) return alert('Password minimal 6 karakter.');
      try {
        await resetStaffPassword(btn.dataset.userId, newPassword);
        alert('Password berhasil direset. Kasih tau staff-nya password barunya.');
      } catch (error) {
        alert(error.message ?? 'Gagal reset password.');
      }
    });
  });

  container.querySelectorAll('.btn-edit').forEach((btn) => {
    btn.addEventListener('click', () => {
      const row = container.querySelector(`tr[data-user-id="${btn.dataset.userId}"]`);
      const currentName = row.children[0].textContent;
      const currentPhone = row.children[1].textContent === '-' ? '' : row.children[1].textContent;
      const newName = prompt('Nama lengkap:', currentName);
      if (newName === null) return;
      const newPhone = prompt('No. Telp:', currentPhone);
      updateProfile(btn.dataset.userId, { full_name: newName, phone: newPhone || null }).then(() =>
        renderMasterUserPage(container)
      );
    });
  });

  container.querySelectorAll('.scope-remove').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Hapus scope ini dari staff?')) return;
      await removeMembershipScope(btn.dataset.scopeId);
      await renderMasterUserPage(container);
    });
  });

  container.querySelectorAll('.btn-add-scope').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const userId = btn.dataset.userId;
      const buId = prompt(
        'ID Business Unit tujuan:\n' + businessUnits.map((bu) => `${bu.id} = ${bu.name}`).join('\n')
      );
      if (!buId) return;
      const role = prompt('Role (staff / outlet_admin / bu_admin):', 'staff');
      if (!role) return;
      try {
        await addMembershipScope({ user_id: userId, business_unit_id: buId, role });
        await renderMasterUserPage(container);
      } catch (error) {
        alert(error.message ?? 'Gagal menambah scope.');
      }
    });
  });
}
