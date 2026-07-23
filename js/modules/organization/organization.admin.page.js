import {
  listOrganizations,
  createOrganization,
  listBusinessUnitsFull,
  createBusinessUnit,
  updateBusinessUnit,
  deleteBusinessUnit,
  listOutletsForBu,
  createOutlet,
  updateOutlet,
  deleteOutlet
} from './organization.service.js';
import { toast, confirmDialog, formDialog } from '../../core/ui.js';

const BU_TYPE_OPTIONS = [
  { value: 'cafe', label: 'Cafe' },
  { value: 'workshop', label: 'Workshop / Bengkel' },
  { value: 'armada', label: 'Armada / Logistik' },
  { value: 'retail', label: 'Retail' },
  { value: 'other', label: 'Lainnya' }
];

const OUTLET_ROLE_OPTIONS = [
  { value: 'standalone', label: 'Standalone (olah sendiri)' },
  { value: 'central_kitchen', label: 'Central Kitchen (dapur pusat)' },
  { value: 'served_by_ck', label: 'Dilayani Central Kitchen' }
];

const OUTLET_ROLE_LABEL = {
  standalone: 'Standalone',
  central_kitchen: 'Central Kitchen',
  served_by_ck: 'Dilayani CK'
};

export async function renderOrganizationAdminPage(container) {
  container.innerHTML = `<p>Memuat data organisasi...</p>`;

  let businessUnits, organizations;
  try {
    [businessUnits, organizations] = await Promise.all([listBusinessUnitsFull(), listOrganizations()]);
  } catch (error) {
    container.innerHTML = `<p class="error-text">Gagal memuat data: ${error.message ?? error}</p>`;
    return;
  }

  // Ambil outlet tiap BU secara paralel
  const outletsByBu = {};
  await Promise.all(
    businessUnits.map(async (bu) => {
      try {
        outletsByBu[bu.id] = await listOutletsForBu(bu.id);
      } catch {
        outletsByBu[bu.id] = [];
      }
    })
  );

  container.innerHTML = `
    <div class="page-header">
      <h1>Master BU &amp; Outlet</h1>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button id="btn-new-org">+ Organisasi</button>
        <button class="primary" id="btn-new-bu" style="max-width:200px">+ Business Unit</button>
      </div>
    </div>
    <p style="color:var(--color-text-muted);font-size:0.9rem;margin-top:-6px">
      Kelola Business Unit dan Outlet langsung dari sini — tambah, ubah, atau hapus tanpa perlu SQL.
    </p>
    <div id="bu-list">
      ${
        businessUnits.map((bu) => buCardHtml(bu, outletsByBu[bu.id] ?? [])).join('') ||
        '<div class="inline-card"><p>Belum ada Business Unit. Klik "+ Business Unit" untuk menambah.</p></div>'
      }
    </div>
  `;

  document.getElementById('btn-new-org').addEventListener('click', () => openOrgDialog(container));
  document.getElementById('btn-new-bu').addEventListener('click', () => openBuDialog(container, organizations, null));

  wireActions(container, businessUnits, organizations, outletsByBu);
}

function buCardHtml(bu, outlets) {
  const typeLabel = BU_TYPE_OPTIONS.find((t) => t.value === bu.type)?.label ?? bu.type;
  const outletRows =
    outlets
      .map(
        (o) => `
        <tr>
          <td>${escapeHtml(o.name)}</td>
          <td>${OUTLET_ROLE_LABEL[o.outlet_role] ?? o.outlet_role}</td>
          <td>${o.is_active ? 'Aktif' : 'Nonaktif'}</td>
          <td>
            <button class="btn-edit-outlet" data-bu="${bu.id}" data-outlet="${o.id}">Edit</button>
            <button class="btn-del-outlet" data-bu="${bu.id}" data-outlet="${o.id}">Hapus</button>
          </td>
        </tr>`
      )
      .join('') || '<tr><td colspan="4" style="color:var(--color-text-muted)">Belum ada outlet.</td></tr>';

  return `
    <div class="inline-card" style="max-width:640px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
        <div>
          <h3 style="margin:0">${escapeHtml(bu.name)} ${bu.is_active ? '' : '<span style="font-size:0.7rem;color:var(--color-danger)">(nonaktif)</span>'}</h3>
          <p style="margin:2px 0 0;font-size:0.82rem;color:var(--color-text-muted)">
            ${typeLabel} &middot; ${escapeHtml(bu.organizations?.name ?? '-')}
          </p>
        </div>
        <div style="display:flex;gap:6px;flex-shrink:0">
          <button class="btn-edit-bu" data-bu="${bu.id}">Edit</button>
          <button class="btn-del-bu" data-bu="${bu.id}">Hapus</button>
        </div>
      </div>
      <table class="data-table" style="margin-top:12px">
        <thead><tr><th>Outlet</th><th>Peran</th><th>Status</th><th>Aksi</th></tr></thead>
        <tbody>${outletRows}</tbody>
      </table>
      <button class="btn-add-outlet" data-bu="${bu.id}" style="margin-top:10px">+ Tambah Outlet</button>
    </div>
  `;
}

function wireActions(container, businessUnits, organizations, outletsByBu) {
  const buById = Object.fromEntries(businessUnits.map((b) => [b.id, b]));

  container.querySelectorAll('.btn-edit-bu').forEach((btn) => {
    btn.addEventListener('click', () => openBuDialog(container, organizations, buById[btn.dataset.bu]));
  });

  container.querySelectorAll('.btn-del-bu').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: 'Hapus Business Unit?',
        message: 'Semua outlet, staff-scope, dan data di BU ini ikut terhapus. Tindakan ini tidak bisa dibatalkan.',
        confirmText: 'Hapus',
        danger: true
      });
      if (!ok) return;
      try {
        await deleteBusinessUnit(btn.dataset.bu);
        toast('Business Unit dihapus.', 'success');
        await renderOrganizationAdminPage(container);
      } catch (error) {
        toast(error.message ?? 'Gagal menghapus BU.', 'error');
      }
    });
  });

  container.querySelectorAll('.btn-add-outlet').forEach((btn) => {
    btn.addEventListener('click', () => openOutletDialog(container, btn.dataset.bu, outletsByBu[btn.dataset.bu] ?? [], null));
  });

  container.querySelectorAll('.btn-edit-outlet').forEach((btn) => {
    btn.addEventListener('click', () => {
      const outlets = outletsByBu[btn.dataset.bu] ?? [];
      const outlet = outlets.find((o) => o.id === btn.dataset.outlet);
      openOutletDialog(container, btn.dataset.bu, outlets, outlet);
    });
  });

  container.querySelectorAll('.btn-del-outlet').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: 'Hapus outlet?',
        message: 'Data terkait outlet ini akan ikut terhapus.',
        confirmText: 'Hapus',
        danger: true
      });
      if (!ok) return;
      try {
        await deleteOutlet(btn.dataset.outlet);
        toast('Outlet dihapus.', 'success');
        await renderOrganizationAdminPage(container);
      } catch (error) {
        toast(error.message ?? 'Gagal menghapus outlet.', 'error');
      }
    });
  });
}

async function openOrgDialog(container) {
  const values = await formDialog({
    title: 'Tambah Organisasi',
    fields: [{ name: 'name', label: 'Nama Organisasi', type: 'text', required: true }],
    submitText: 'Simpan'
  });
  if (!values) return;
  try {
    await createOrganization({ name: values.name });
    toast('Organisasi ditambahkan.', 'success');
    await renderOrganizationAdminPage(container);
  } catch (error) {
    toast(error.message ?? 'Gagal menambah organisasi.', 'error');
  }
}

async function openBuDialog(container, organizations, existing) {
  const isEdit = !!existing;
  if (!isEdit && organizations.length === 0) {
    toast('Buat Organisasi dulu sebelum menambah Business Unit.', 'warning');
    return openOrgDialog(container);
  }

  const fields = [];
  if (!isEdit) {
    fields.push({
      name: 'organization_id',
      label: 'Organisasi',
      type: 'select',
      required: true,
      options: organizations.map((o) => ({ value: o.id, label: o.name }))
    });
  }
  fields.push(
    { name: 'name', label: 'Nama Business Unit', type: 'text', required: true, value: existing?.name ?? '' },
    { name: 'type', label: 'Tipe', type: 'select', required: true, value: existing?.type ?? 'cafe', options: BU_TYPE_OPTIONS },
    { name: 'is_active', label: 'Aktif', type: 'checkbox', value: existing ? existing.is_active : true }
  );

  const values = await formDialog({
    title: isEdit ? 'Edit Business Unit' : 'Tambah Business Unit',
    fields,
    submitText: 'Simpan'
  });
  if (!values) return;

  try {
    if (isEdit) {
      await updateBusinessUnit(existing.id, { name: values.name, type: values.type, is_active: values.is_active });
      toast('Business Unit diperbarui.', 'success');
    } else {
      await createBusinessUnit({
        organization_id: values.organization_id,
        name: values.name,
        type: values.type,
        is_active: values.is_active
      });
      toast('Business Unit ditambahkan.', 'success');
    }
    await renderOrganizationAdminPage(container);
  } catch (error) {
    toast(error.message ?? 'Gagal menyimpan BU.', 'error');
  }
}

async function openOutletDialog(container, businessUnitId, siblingOutlets, existing) {
  const isEdit = !!existing;
  const ckOptions = siblingOutlets
    .filter((o) => o.outlet_role === 'central_kitchen' && o.id !== existing?.id)
    .map((o) => ({ value: o.id, label: o.name }));

  const values = await formDialog({
    title: isEdit ? 'Edit Outlet' : 'Tambah Outlet',
    fields: [
      { name: 'name', label: 'Nama Outlet', type: 'text', required: true, value: existing?.name ?? '' },
      { name: 'address', label: 'Alamat (opsional)', type: 'text', value: existing?.address ?? '' },
      {
        name: 'outlet_role',
        label: 'Peran Outlet',
        type: 'select',
        required: true,
        value: existing?.outlet_role ?? 'standalone',
        options: OUTLET_ROLE_OPTIONS
      },
      {
        name: 'served_by_outlet_id',
        label: 'Dilayani oleh CK (isi hanya jika peran "Dilayani Central Kitchen")',
        type: 'select',
        value: existing?.served_by_outlet_id ?? '',
        options: [{ value: '', label: '-- pilih Central Kitchen --' }, ...ckOptions]
      },
      { name: 'is_active', label: 'Aktif', type: 'checkbox', value: existing ? existing.is_active : true }
    ],
    submitText: 'Simpan',
    onReady: (form) => {
      const roleSelect = form.elements['outlet_role'];
      const ckField = form.elements['served_by_outlet_id']?.closest('.field');
      const sync = () => {
        if (ckField) ckField.style.display = roleSelect.value === 'served_by_ck' ? 'block' : 'none';
      };
      roleSelect.addEventListener('change', sync);
      sync();
    }
  });
  if (!values) return;

  if (values.outlet_role === 'served_by_ck' && !values.served_by_outlet_id) {
    toast('Pilih Central Kitchen yang melayani outlet ini.', 'warning');
    return;
  }

  try {
    if (isEdit) {
      await updateOutlet(existing.id, values);
      toast('Outlet diperbarui.', 'success');
    } else {
      await createOutlet({ business_unit_id: businessUnitId, ...values });
      toast('Outlet ditambahkan.', 'success');
    }
    await renderOrganizationAdminPage(container);
  } catch (error) {
    toast(error.message ?? 'Gagal menyimpan outlet.', 'error');
  }
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
