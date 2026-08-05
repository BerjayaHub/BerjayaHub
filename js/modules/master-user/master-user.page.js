import {
  listStaffWithScopes,
  listDivisions,
  saveDivision,
  deleteDivision,
  listBusinessUnits,
  listOutlets,
  updateProfile,
  addMembershipScope,
  updateMembershipScope,
  removeMembershipScope,
  setPrimaryScope,
  createStaffUser,
  resetStaffPassword,
  listBuActiveModules,
  getUserModuleAccess,
  setUserModuleAccess,
  getAdminTabAccess,
  setAdminTabAccess
} from './master-user.service.js';
import { GRANTABLE_TABS } from '../../core/admin-tabs.js';
import { amISuperAdmin } from '../inventory/inventory.service.js';
import { listRegisteredFaceUserIds, resetFaceDescriptor } from '../attendance/attendance.service.js';
import { toast, confirmDialog, formDialog, escapeHtml } from '../../core/ui.js';

const ROLE_LABEL = {
  super_admin: 'Super Admin',
  bu_admin: 'Admin BU',
  outlet_admin: 'Admin Outlet',
  staff: 'Staff'
};

const ROLE_OPTIONS = [
  { value: 'staff', label: 'Staff' },
  { value: 'outlet_admin', label: 'Admin Outlet' },
  { value: 'bu_admin', label: 'Admin BU' },
  { value: 'super_admin', label: 'Super Admin' }
];

export async function renderMasterUserPage(container, ctx = {}) {
  const businessUnitId = ctx.businessUnitId ?? container.dataset.buId ?? null;
  container.dataset.buId = businessUnitId ?? '';
  container.innerHTML = `<p>Memuat data staff...</p>`;

  const [staffList, businessUnits, registeredFaceIds] = await Promise.all([
    listStaffWithScopes(),
    listBusinessUnits(),
    listRegisteredFaceUserIds()
  ]);

  container.innerHTML = `
    <div class="page-header">
      <h1>Master User</h1>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button id="btn-divisions">🏷️ Kelola Divisi</button>
        <button class="primary" id="btn-new-staff" style="max-width:180px">+ Tambah Staff</button>
      </div>
    </div>
    <div id="new-staff-form-wrap"></div>

    <div class="inline-card" style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin-bottom:10px">
      <div class="field" style="margin:0;max-width:240px">
        <label>Cari nama / email / telp</label>
        <input type="text" id="mu-q" placeholder="mis. iko atau @gmail" />
      </div>
      <div class="field" style="margin:0;max-width:200px">
        <label>Business Unit</label>
        <select id="mu-bu"><option value="">Semua BU</option>
          ${businessUnits.map((b) => `<option value="${escapeHtml(b.id)}">${escapeHtml(b.name)}</option>`).join('')}
        </select>
      </div>
      <div class="field" style="margin:0;max-width:200px">
        <label>Outlet</label>
        <select id="mu-outlet"><option value="">Semua outlet</option></select>
      </div>
      <button id="mu-reset">Reset</button>
      <span id="mu-count" style="font-size:0.8rem;color:var(--color-text-muted)"></span>
    </div>

    <p style="font-size:0.82rem;color:var(--color-text-muted);margin:0 0 10px">
      Tanda ★ = tempat kerja utama (basis perhitungan NBM). Klik ☆ pada salah satu scope untuk menetapkannya.
    </p>
    <div class="table-scroll"><table class="data-table table-freeze-1" id="staff-table">
      <thead>
        <tr>
          <th>Nama</th>
          <th>Email</th>
          <th>Telp</th>
          <th>Scope (BU / Outlet / Role)</th>
          <th>Status</th>
          <th>Wajah</th>
          <th>Aksi</th>
        </tr>
      </thead>
      <tbody id="staff-tbody"></tbody>
    </table></div>
  `;

  document.getElementById('btn-new-staff').addEventListener('click', () => {
    renderNewStaffForm(container, businessUnits);
  });
  document.getElementById('btn-divisions').addEventListener('click', () => openDivisionManager(container, businessUnits));

  // wireRowActions dipanggil DI DALAM wireFilters setiap kali baris digambar
  // ulang. Jangan dipanggil lagi di sini — tombolnya akan tersambung dua kali
  // dan setiap klik dieksekusi dobel (dialog muncul dua kali, aksi jalan dua kali).
  wireFilters(container, staffList, businessUnits, registeredFaceIds);
}

/**
 * Filter nama/email/telp + BU + Outlet.
 *
 * Disaring DI SISI KLIEN, bukan query ulang ke server: seluruh daftar staff
 * memang sudah dimuat (RLS yang membatasi cakupannya), jumlahnya puluhan bukan
 * ribuan, dan menyaring lokal membuat hasilnya muncul seketika saat mengetik.
 *
 * Pencocokan scope memakai logika "punya SALAH SATU scope yang cocok" — user
 * dengan banyak scope tetap muncul selama satu di antaranya sesuai filter.
 */
function wireFilters(container, staffList, businessUnits, registeredFaceIds) {
  const tbody = container.querySelector('#staff-tbody');
  const inputQ = container.querySelector('#mu-q');
  const selBu = container.querySelector('#mu-bu');
  const selOutlet = container.querySelector('#mu-outlet');
  const hitung = container.querySelector('#mu-count');

  // Daftar outlet diambil dari scope yang ADA di data, bukan query terpisah:
  // outlet yang tidak dipakai siapa pun hanya akan jadi pilihan yang selalu
  // menghasilkan tabel kosong.
  function isiOutlet() {
    const buId = selBu.value;
    const outlets = new Map();
    for (const s of staffList) {
      for (const sc of s.scopes) {
        if (!sc.outlet_id) continue;
        if (buId && sc.business_unit_id !== buId) continue;
        outlets.set(sc.outlet_id, sc.outlets?.name ?? 'Outlet');
      }
    }
    const sebelumnya = selOutlet.value;
    selOutlet.innerHTML =
      '<option value="">Semua outlet</option>' +
      [...outlets.entries()]
        .sort((a, b) => a[1].localeCompare(b[1]))
        .map(([id, nama]) => `<option value="${escapeHtml(id)}">${escapeHtml(nama)}</option>`)
        .join('');
    // Pertahankan pilihan lama kalau masih relevan setelah BU berganti.
    if ([...outlets.keys()].includes(sebelumnya)) selOutlet.value = sebelumnya;
  }

  function cocok(s) {
    const q = inputQ.value.trim().toLowerCase();
    if (q) {
      const bahan = [s.profile.full_name, s.profile.email, s.profile.phone].filter(Boolean).join(' ').toLowerCase();
      if (!bahan.includes(q)) return false;
    }
    if (selBu.value && !s.scopes.some((sc) => sc.business_unit_id === selBu.value)) return false;
    if (selOutlet.value && !s.scopes.some((sc) => sc.outlet_id === selOutlet.value)) return false;
    return true;
  }

  function gambar() {
    const hasil = staffList.filter(cocok);
    tbody.innerHTML =
      hasil.map((s) => staffRowHtml(s, registeredFaceIds)).join('') ||
      `<tr><td colspan="7" style="color:var(--color-text-muted)">Tidak ada staff yang cocok dengan filter ini.</td></tr>`;
    hitung.textContent = `${hasil.length} dari ${staffList.length} user`;
    // Baris digambar ulang -> tombol-tombolnya baru, jadi harus disambungkan lagi.
    wireRowActions(container, businessUnits);
  }

  // Simpan filter di dataset container supaya TIDAK hilang saat halaman
  // digambar ulang setelah aksi (nonaktifkan user, ubah scope, reset password).
  // Tanpa ini admin harus mengetik ulang filternya untuk setiap orang yang
  // disentuh — friksi kecil yang membuat fitur filter jadi tidak terpakai.
  function simpan() {
    container.dataset.muQ = inputQ.value;
    container.dataset.muBu = selBu.value;
    container.dataset.muOutlet = selOutlet.value;
  }
  inputQ.value = container.dataset.muQ ?? '';
  selBu.value = container.dataset.muBu ?? '';

  let timer;
  inputQ.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      simpan();
      gambar();
    }, 200);
  });
  selBu.addEventListener('change', () => {
    isiOutlet();
    simpan();
    gambar();
  });
  selOutlet.addEventListener('change', () => {
    simpan();
    gambar();
  });
  container.querySelector('#mu-reset').addEventListener('click', () => {
    inputQ.value = '';
    selBu.value = '';
    isiOutlet();
    selOutlet.value = '';
    simpan();
    gambar();
  });

  isiOutlet();
  selOutlet.value = container.dataset.muOutlet ?? '';
  gambar();
}

function staffRowHtml(s, registeredFaceIds) {
  const scopeBadges = s.scopes
    .map(
      (sc) => `
      <span class="scope-badge${sc.is_primary ? ' scope-badge-primary' : ''}" data-scope-id="${sc.id}">
        <button class="scope-primary${sc.is_primary ? ' is-primary' : ''}" data-scope-id="${sc.id}" data-user-id="${s.profile.id}"
          title="${sc.is_primary ? 'Tempat kerja utama (basis NBM)' : 'Jadikan tempat kerja utama (basis NBM)'}">${sc.is_primary ? '★' : '☆'}</button>
        ${escapeHtml(sc.business_units?.name ?? '-')} ${sc.outlets?.name ? '/ ' + escapeHtml(sc.outlets.name) : ''} — ${ROLE_LABEL[sc.role] ?? sc.role}${
          sc.divisions?.name ? ` · <em>${escapeHtml(sc.divisions.name)}</em>` : ''
        }
        <button class="scope-edit" data-scope-id="${sc.id}" data-user-id="${s.profile.id}"
          data-bu="${sc.business_unit_id ?? ''}" data-outlet="${sc.outlet_id ?? ''}" data-role="${sc.role}"
          data-division="${sc.division_id ?? ''}"
          title="Ubah scope ini">✎</button>
        <button class="scope-remove" data-scope-id="${sc.id}" title="Hapus scope ini">✕</button>
      </span>`
    )
    .join(' ');

  const hasFace = registeredFaceIds.has(s.profile.id);

  return `
    <tr data-user-id="${s.profile.id}">
      <td>${escapeHtml(s.profile.full_name)}</td>
      <td style="font-size:0.82rem">${
        s.profile.email
          ? escapeHtml(s.profile.email)
          : '<span style="color:var(--color-text-muted)" title="Jalankan migration 0049_user_email.sql kalau kolom ini kosong untuk semua orang">-</span>'
      }</td>
      <td>${escapeHtml(s.profile.phone ?? '-')}</td>
      <td>${scopeBadges} <button class="btn-add-scope" data-user-id="${s.profile.id}">+ scope</button></td>
      <td>${s.profile.is_active ? 'Aktif' : 'Nonaktif'}</td>
      <td>
        ${hasFace ? 'Terdaftar ✅' : 'Belum daftar'}
        ${hasFace ? `<button class="btn-reset-face" data-user-id="${s.profile.id}">Reset</button>` : ''}
      </td>
      <td>
        <button class="btn-edit" data-user-id="${s.profile.id}"
          data-name="${escapeHtml(s.profile.full_name ?? '')}"
          data-phone="${escapeHtml(s.profile.phone ?? '')}"
          data-email="${escapeHtml(s.profile.email ?? '')}">Edit</button>
        <button class="btn-modules" data-user-id="${s.profile.id}" data-name="${s.profile.full_name}">Akses Modul</button>
        <button class="btn-admin-access" data-user-id="${s.profile.id}" data-name="${s.profile.full_name}">Izin Admin</button>
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
          ${businessUnits.map((bu) => `<option value="${bu.id}">${escapeHtml(bu.name)}</option>`).join('')}
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
          <option value="super_admin">Super Admin</option>
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
      outlets.map((o) => `<option value="${o.id}">${escapeHtml(o.name)}</option>`).join('');
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
      // Nilai awal diambil dari data-* baris, BUKAN dari urutan kolom tabel.
      // Versi lama membaca row.children[1] — dulu itu kolom Telp, tapi sejak
      // kolom Email disisipkan di posisi kedua, kotak "No. Telp" jadi terisi
      // alamat email. Formnya benar, isinya yang salah kolom; indeks DOM memang
      // selalu jadi bom waktu setiap kali tabelnya berubah.
      const currentName = btn.dataset.name ?? '';
      const currentPhone = btn.dataset.phone ?? '';
      const email = btn.dataset.email ?? '';
      const values = await formDialog({
        title: 'Edit Staff',
        description: email
          ? `Email login: ${email} — dipakai untuk masuk aplikasi dan tidak bisa diubah dari sini.`
          : 'Email login belum tercatat untuk user ini.',
        fields: [
          { name: 'full_name', label: 'Nama Lengkap', type: 'text', required: true, value: currentName },
          { name: 'phone', label: 'No. Telp (bukan email login)', type: 'tel', value: currentPhone, placeholder: 'Opsional' }
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
    btn.addEventListener('click', () => openScopeDialog(container, businessUnits, { userId: btn.dataset.userId }));
  });

  container.querySelectorAll('.scope-edit').forEach((btn) => {
    btn.addEventListener('click', () =>
      openScopeDialog(container, businessUnits, {
        userId: btn.dataset.userId,
        scope: {
          id: btn.dataset.scopeId,
          bu: btn.dataset.bu,
          outlet: btn.dataset.outlet,
          role: btn.dataset.role,
          division: btn.dataset.division
        }
      })
    );
  });

  container.querySelectorAll('.btn-modules').forEach((btn) => {
    btn.addEventListener('click', () => openModuleAccessDialog(container, btn.dataset.userId, btn.dataset.name));
  });

  container.querySelectorAll('.btn-admin-access').forEach((btn) => {
    btn.addEventListener('click', () => openAdminAccessDialog(container, btn.dataset.userId, btn.dataset.name));
  });

  container.querySelectorAll('.scope-primary').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (btn.classList.contains('is-primary')) return; // sudah jadi basis, tak perlu apa-apa
      try {
        await setPrimaryScope(btn.dataset.userId, btn.dataset.scopeId);
        toast('Tempat kerja utama (basis NBM) diperbarui.', 'success');
        await renderMasterUserPage(container);
      } catch (error) {
        toast(error.message ?? 'Gagal menetapkan tempat kerja utama.', 'error');
      }
    });
  });
}

/**
 * Atur menu/tab Admin Portal yang boleh dibuka user ini di BU aktif.
 * Hanya Super Admin yang boleh mengatur. Tab "Master User" tidak ada di daftar
 * karena dikunci khusus Super Admin.
 */
async function openAdminAccessDialog(container, userId, staffName) {
  const businessUnitId = container.dataset.buId;
  if (!businessUnitId) {
    toast('BU aktif tidak diketahui. Pilih BU dulu di switcher.', 'warning');
    return;
  }
  if (!(await amISuperAdmin())) {
    toast('Hanya Super Admin yang bisa mengatur izin akses Admin Portal.', 'warning');
    return;
  }
  let current;
  try {
    current = await getAdminTabAccess(userId, businessUnitId);
  } catch (error) {
    toast(error.message ?? 'Gagal memuat izin akses.', 'error');
    return;
  }
  const isDefaultAll = current.size === 0;

  const values = await formDialog({
    title: `Izin Admin Portal — ${staffName}`,
    description: isDefaultAll
      ? 'Saat ini user ini bisa membuka SEMUA menu Admin Portal (default). Hilangkan centang untuk membatasi.'
      : 'Centang menu/tab Admin Portal yang boleh dibuka user ini.',
    fields: GRANTABLE_TABS.map((t) => ({
      name: `t_${t.code}`,
      label: `${t.group} › ${t.label}`,
      type: 'checkbox',
      value: isDefaultAll ? true : current.has(t.code)
    })),
    submitText: 'Simpan Izin'
  });
  if (!values) return;

  const chosen = GRANTABLE_TABS.filter((t) => values[`t_${t.code}`]).map((t) => t.code);
  try {
    await setAdminTabAccess(userId, businessUnitId, chosen, GRANTABLE_TABS.map((t) => t.code));
    toast(
      chosen.length === GRANTABLE_TABS.length
        ? 'Izin dikembalikan ke semua menu admin.'
        : `Izin admin disimpan (${chosen.length} menu). Dashboard selalu tersedia.`,
      'success'
    );
  } catch (error) {
    toast(error.message ?? 'Gagal menyimpan izin akses.', 'error');
  }
}

/**
 * Atur modul apa saja yang boleh diakses staff ini di BU aktif.
 * Semua tercentang = default (otomatis ikut modul baru yang diaktifkan BU).
 */
async function openModuleAccessDialog(container, userId, staffName) {
  const businessUnitId = container.dataset.buId;
  if (!businessUnitId) {
    toast('BU aktif tidak diketahui. Pilih BU dulu di switcher.', 'warning');
    return;
  }
  let modules;
  let current;
  try {
    [modules, current] = await Promise.all([listBuActiveModules(businessUnitId), getUserModuleAccess(userId, businessUnitId)]);
  } catch (error) {
    toast(error.message ?? 'Gagal memuat daftar modul.', 'error');
    return;
  }
  if (!modules.length) {
    toast('Belum ada modul aktif di BU ini (atur di BU & Outlet → Modul).', 'warning');
    return;
  }
  const isDefaultAll = current.size === 0;

  const values = await formDialog({
    title: `Akses Modul — ${staffName}`,
    description: isDefaultAll
      ? 'Saat ini staff ini bisa mengakses SEMUA modul aktif BU (default). Hilangkan centang untuk membatasi.'
      : 'Centang modul yang boleh diakses staff ini di Staff App.',
    fields: modules.map((m) => ({
      name: `m_${m.id}`,
      label: m.name,
      type: 'checkbox',
      value: isDefaultAll ? true : current.has(m.id)
    })),
    submitText: 'Simpan Akses'
  });
  if (!values) return;

  const chosen = modules.filter((m) => values[`m_${m.id}`]).map((m) => m.id);
  if (!chosen.length) {
    toast('Pilih minimal satu modul.', 'warning');
    return;
  }
  try {
    await setUserModuleAccess(userId, businessUnitId, chosen, modules.map((m) => m.id));
    toast(
      chosen.length === modules.length ? 'Akses dikembalikan ke semua modul BU.' : `Akses modul disimpan (${chosen.length} modul).`,
      'success'
    );
  } catch (error) {
    toast(error.message ?? 'Gagal menyimpan akses modul.', 'error');
  }
}

/**
 * Dialog scope pakai dropdown (tanpa ketik UUID). Outlet ikut BU yang dipilih.
 * `scope` diisi = mode edit (prefill + update); kosong = mode tambah.
 */
async function openScopeDialog(container, businessUnits, { userId, scope = null }) {
  const isEdit = !!scope;
  const values = await formDialog({
    title: isEdit ? 'Ubah Scope' : 'Tambah Scope',
    description: 'Pilih BU, outlet (opsional), dan role. Tidak perlu isi UUID.',
    fields: [
      {
        name: 'business_unit_id',
        label: 'Business Unit',
        type: 'select',
        required: true,
        value: scope?.bu ?? '',
        options: [{ value: '', label: '-- pilih BU --' }, ...businessUnits.map((bu) => ({ value: bu.id, label: bu.name }))]
      },
      {
        name: 'outlet_id',
        label: 'Outlet (opsional)',
        type: 'select',
        options: [{ value: '', label: '-- semua outlet / level BU --' }]
      },
      { name: 'role', label: 'Role', type: 'select', required: true, value: scope?.role ?? 'staff', options: ROLE_OPTIONS },
      {
        name: 'division_id',
        label: 'Divisi',
        type: 'select',
        // Divisi ikut BU, jadi pilihannya dimuat ulang setiap BU berganti —
        // sama seperti outlet. Daftarnya diisi di tombol "Kelola Divisi".
        help: 'Staff TANPA divisi tidak muncul di roster Jadwal Shift.',
        options: [{ value: '', label: '-- belum ditentukan --' }]
      }
    ],
    submitText: isEdit ? 'Simpan' : 'Tambah',
    onReady: (form) => {
      const buSelect = form.elements['business_unit_id'];
      const outletSelect = form.elements['outlet_id'];
      const loadOutlets = async (selectedOutletId) => {
        outletSelect.innerHTML = '<option value="">-- semua outlet / level BU --</option>';
        if (!buSelect.value) return;
        try {
          const outlets = await listOutlets(buSelect.value);
          outletSelect.innerHTML =
            '<option value="">-- semua outlet / level BU --</option>' +
            outlets
              .map((o) => `<option value="${o.id}"${o.id === selectedOutletId ? ' selected' : ''}>${escapeHtml(o.name)}</option>`)
              .join('');
        } catch {
          // biarkan default kalau gagal ambil outlet
        }
      };
      const divSelect = form.elements['division_id'];
      const loadDivisions = async (selectedId) => {
        divSelect.innerHTML = '<option value="">-- belum ditentukan --</option>';
        if (!buSelect.value) return;
        try {
          const divisi = await listDivisions(buSelect.value);
          divSelect.innerHTML =
            '<option value="">-- belum ditentukan --</option>' +
            divisi
              .map((d) => `<option value="${d.id}"${d.id === selectedId ? ' selected' : ''}>${escapeHtml(d.name)}</option>`)
              .join('');
        } catch {
          // biarkan default kalau gagal ambil divisi
        }
      };

      buSelect.addEventListener('change', () => {
        loadOutlets(null);
        loadDivisions(null);
      });
      if (scope?.bu) {
        loadOutlets(scope.outlet || null); // prefill outlet saat edit
        loadDivisions(scope.division || null);
      }
    }
  });
  if (!values) return;
  try {
    if (isEdit) {
      await updateMembershipScope(scope.id, {
        business_unit_id: values.business_unit_id,
        outlet_id: values.outlet_id || null,
        role: values.role,
        division_id: values.division_id || null
      });
      toast('Scope diperbarui.', 'success');
    } else {
      await addMembershipScope({
        user_id: userId,
        business_unit_id: values.business_unit_id,
        outlet_id: values.outlet_id || null,
        role: values.role,
        division_id: values.division_id || null
      });
      toast('Scope ditambahkan.', 'success');
    }
    await renderMasterUserPage(container);
  } catch (error) {
    toast(error.message ?? 'Gagal menyimpan scope.', 'error');
  }
}

/**
 * Kelola daftar divisi per BU (Kitchen, Bar, Mekanik, dst).
 *
 * Daftar master, bukan teks bebas di tiap user: "Kitchen", "kitchen", dan
 * "Ktichen" akan jadi tiga kelompok terpisah di tabel shift, dan
 * pengelompokannya rusak tanpa ada yang sadar — tabelnya tetap tampil rapi,
 * cuma isinya salah.
 */
async function openDivisionManager(container, businessUnits) {
  if (!businessUnits.length) return toast('Belum ada Business Unit.', 'warning');

  let buId = container.dataset.divBu || businessUnits[0].id;

  await dialogManual();

  async function dialogManual() {
    let divisi = [];
    try {
      divisi = await listDivisions(buId, false);
    } catch (error) {
      return toast(error.message ?? 'Gagal memuat divisi.', 'error');
    }

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-card" role="dialog" aria-modal="true" style="max-width:520px">
        <h3 class="modal-title">🏷️ Kelola Divisi</h3>
        <div class="field">
          <label for="dv-bu">Business Unit</label>
          <select id="dv-bu">${businessUnits
            .map((b) => `<option value="${escapeHtml(b.id)}"${b.id === buId ? ' selected' : ''}>${escapeHtml(b.name)}</option>`)
            .join('')}</select>
        </div>
        <div class="table-scroll">
          <table class="data-table">
            <thead><tr><th>Urutan</th><th>Divisi</th><th>Status</th><th>Aksi</th></tr></thead>
            <tbody>
              ${
                divisi
                  .map(
                    (d) => `<tr${d.is_active ? '' : ' style="opacity:0.55"'}>
                      <td>${d.sort_order}</td>
                      <td><strong>${escapeHtml(d.name)}</strong></td>
                      <td>${d.is_active ? 'Aktif' : 'Nonaktif'}</td>
                      <td>
                        <button class="dv-edit" data-id="${escapeHtml(d.id)}">Edit</button>
                        <button class="dv-del" data-id="${escapeHtml(d.id)}">Hapus</button>
                      </td>
                    </tr>`
                  )
                  .join('') || '<tr><td colspan="4" style="color:var(--color-text-muted)">Belum ada divisi di BU ini.</td></tr>'
              }
            </tbody>
          </table>
        </div>
        <p style="font-size:0.78rem;color:var(--color-text-muted);margin:10px 0 0">
          Angka <strong>Urutan</strong> menentukan susunan kelompok di tabel Jadwal Shift — angka kecil di atas.
          Staff tanpa divisi tidak muncul di roster.
        </p>
        <div class="modal-actions">
          <button type="button" class="btn-ghost" data-act="close">Tutup</button>
          <button type="button" class="primary btn-inline" id="dv-new">+ Tambah Divisi</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('show'));

    const tutup = (gambarUlang = false) => {
      overlay.classList.remove('show');
      setTimeout(() => overlay.remove(), 200);
      if (gambarUlang) renderMasterUserPage(container);
    };
    overlay.querySelector('[data-act="close"]').addEventListener('click', () => tutup(true));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) tutup(true);
    });

    overlay.querySelector('#dv-bu').addEventListener('change', (e) => {
      buId = e.target.value;
      container.dataset.divBu = buId;
      tutup();
      setTimeout(dialogManual, 220);
    });

    overlay.querySelector('#dv-new').addEventListener('click', async () => {
      tutup();
      await formDivisi(null);
    });

    overlay.querySelectorAll('.dv-edit').forEach((b) =>
      b.addEventListener('click', async () => {
        const d = divisi.find((x) => x.id === b.dataset.id);
        tutup();
        await formDivisi(d);
      })
    );

    overlay.querySelectorAll('.dv-del').forEach((b) =>
      b.addEventListener('click', async () => {
        const d = divisi.find((x) => x.id === b.dataset.id);
        tutup();
        const ok = await confirmDialog({
          title: `Hapus divisi "${d.name}"?`,
          message:
            'Staff yang memakai divisi ini TIDAK ikut terhapus — mereka hanya kembali "belum berdivisi", ' +
            'dan otomatis hilang dari roster Jadwal Shift sampai diberi divisi lagi.',
          confirmText: 'Hapus',
          danger: true
        });
        if (ok) {
          try {
            await deleteDivision(d.id);
            toast('Divisi dihapus.', 'success');
          } catch (error) {
            toast(error.message ?? 'Gagal menghapus.', 'error');
          }
        }
        await dialogManual();
      })
    );
  }

  async function formDivisi(existing) {
    const values = await formDialog({
      title: existing ? `Edit Divisi — ${existing.name}` : 'Tambah Divisi',
      fields: [
        { name: 'name', label: 'Nama divisi', type: 'text', required: true, value: existing?.name ?? '', placeholder: 'mis. Kitchen' },
        {
          name: 'sort_order',
          label: 'Urutan',
          type: 'number',
          min: 0,
          value: existing?.sort_order ?? 0,
          help: 'Angka kecil tampil lebih dulu di tabel shift.'
        },
        ...(existing ? [{ name: 'is_active', label: 'Aktif', type: 'checkbox', value: existing.is_active }] : [])
      ],
      submitText: 'Simpan'
    });
    if (values) {
      try {
        await saveDivision({ id: existing?.id, businessUnitId: buId, ...values });
        toast('Divisi tersimpan.', 'success');
      } catch (error) {
        toast(error.message ?? 'Gagal menyimpan divisi.', 'error');
      }
    }
    await dialogManual();
  }
}
