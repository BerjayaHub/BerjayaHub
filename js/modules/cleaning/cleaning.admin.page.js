import { toast, confirmDialog, formDialog, infoDialog } from '../../core/ui.js';
import {
  listBuOutlets,
  listItems,
  createItem,
  updateItem,
  deleteItem,
  listSessions,
  createSession,
  updateSession,
  deleteSession,
  listRunsForAdmin,
  getRunItems,
  getChecklistPhotoUrl,
  todayWIB
} from './cleaning.service.js';

const TABS = [
  { key: 'items', label: 'Item Ceklis' },
  { key: 'sessions', label: 'Sesi' },
  { key: 'report', label: 'Rekap' }
];

export async function renderCleaningAdminPage(container, { businessUnitId }) {
  container.innerHTML = `
    <h1>Ceklis Kebersihan</h1>
    <div class="tab-bar">
      ${TABS.map((t, i) => `<button class="tab-btn ${i === 0 ? 'active' : ''}" data-tab="${t.key}">${t.label}</button>`).join('')}
    </div>
    <div id="clean-admin-content"></div>
  `;
  const content = document.getElementById('clean-admin-content');
  async function showTab(key) {
    container.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === key));
    if (key === 'items') await renderItemsTab(content, businessUnitId);
    if (key === 'sessions') await renderSessionsTab(content, businessUnitId);
    if (key === 'report') await renderReportTab(content, businessUnitId);
  }
  container.querySelectorAll('.tab-btn').forEach((btn) => btn.addEventListener('click', () => showTab(btn.dataset.tab)));
  await showTab('items');
}

// ---- Tab: Item ----

async function renderItemsTab(content, businessUnitId) {
  content.innerHTML = `<p>Memuat...</p>`;
  let items;
  try {
    items = await listItems(businessUnitId);
  } catch (error) {
    content.innerHTML = `<p class="error-text">${error.message ?? error}</p>`;
    return;
  }
  content.innerHTML = `
    <div class="page-header">
      <h2 style="font-size:1.05rem;margin:0">Item Ceklis (berlaku semua outlet BU)</h2>
      <button class="primary" id="btn-new-item" style="max-width:180px">+ Tambah Item</button>
    </div>
    <table class="data-table">
      <thead><tr><th>Urutan</th><th>Item</th><th>Status</th><th>Aksi</th></tr></thead>
      <tbody>
        ${items
          .map(
            (it) => `
          <tr>
            <td>${it.sort_order}</td>
            <td>${escapeHtml(it.label)}</td>
            <td>${it.is_active ? 'Aktif' : 'Nonaktif'}</td>
            <td>
              <button class="btn-edit-item" data-json='${escapeAttr(JSON.stringify(it))}'>Edit</button>
              <button class="btn-del-item" data-id="${it.id}">Hapus</button>
            </td>
          </tr>`
          )
          .join('') || '<tr><td colspan="4">Belum ada item.</td></tr>'}
      </tbody>
    </table>
  `;
  document.getElementById('btn-new-item').addEventListener('click', () => openItemDialog(content, businessUnitId, null));
  content.querySelectorAll('.btn-edit-item').forEach((btn) =>
    btn.addEventListener('click', () => openItemDialog(content, businessUnitId, JSON.parse(btn.dataset.json)))
  );
  content.querySelectorAll('.btn-del-item').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const ok = await confirmDialog({ title: 'Hapus item?', confirmText: 'Hapus', danger: true });
      if (!ok) return;
      try {
        await deleteItem(btn.dataset.id);
        toast('Item dihapus.', 'success');
        await renderItemsTab(content, businessUnitId);
      } catch (error) {
        toast(error.message ?? 'Gagal menghapus.', 'error');
      }
    })
  );
}

async function openItemDialog(content, businessUnitId, existing) {
  const isEdit = !!existing;
  const values = await formDialog({
    title: isEdit ? 'Edit Item' : 'Tambah Item',
    fields: [
      { name: 'label', label: 'Nama Item', type: 'text', required: true, value: existing?.label ?? '' },
      { name: 'sort_order', label: 'Urutan', type: 'number', min: 0, value: existing?.sort_order ?? 0 },
      ...(isEdit ? [{ name: 'is_active', label: 'Aktif', type: 'checkbox', value: existing.is_active }] : [])
    ],
    submitText: 'Simpan'
  });
  if (!values) return;
  try {
    if (isEdit) {
      await updateItem(existing.id, { label: values.label, sort_order: Number(values.sort_order) || 0, is_active: values.is_active });
      toast('Item diperbarui.', 'success');
    } else {
      await createItem({ businessUnitId, label: values.label, sort_order: Number(values.sort_order) || 0 });
      toast('Item ditambahkan.', 'success');
    }
    await renderItemsTab(content, businessUnitId);
  } catch (error) {
    toast(error.message ?? 'Gagal menyimpan item.', 'error');
  }
}

// ---- Tab: Sesi ----

async function renderSessionsTab(content, businessUnitId) {
  content.innerHTML = `<p>Memuat...</p>`;
  let sessions;
  try {
    sessions = await listSessions(businessUnitId);
  } catch (error) {
    content.innerHTML = `<p class="error-text">${error.message ?? error}</p>`;
    return;
  }
  content.innerHTML = `
    <div class="page-header">
      <h2 style="font-size:1.05rem;margin:0">Sesi Ceklis (mis. Buka, Tutup)</h2>
      <button class="primary" id="btn-new-session" style="max-width:180px">+ Tambah Sesi</button>
    </div>
    <table class="data-table">
      <thead><tr><th>Urutan</th><th>Sesi</th><th>Status</th><th>Aksi</th></tr></thead>
      <tbody>
        ${sessions
          .map(
            (s) => `
          <tr>
            <td>${s.sort_order}</td>
            <td>${escapeHtml(s.name)}</td>
            <td>${s.is_active ? 'Aktif' : 'Nonaktif'}</td>
            <td>
              <button class="btn-edit-session" data-json='${escapeAttr(JSON.stringify(s))}'>Edit</button>
              <button class="btn-del-session" data-id="${s.id}">Hapus</button>
            </td>
          </tr>`
          )
          .join('') || '<tr><td colspan="4">Belum ada sesi.</td></tr>'}
      </tbody>
    </table>
  `;
  document.getElementById('btn-new-session').addEventListener('click', () => openSessionDialog(content, businessUnitId, null));
  content.querySelectorAll('.btn-edit-session').forEach((btn) =>
    btn.addEventListener('click', () => openSessionDialog(content, businessUnitId, JSON.parse(btn.dataset.json)))
  );
  content.querySelectorAll('.btn-del-session').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const ok = await confirmDialog({ title: 'Hapus sesi?', confirmText: 'Hapus', danger: true });
      if (!ok) return;
      try {
        await deleteSession(btn.dataset.id);
        toast('Sesi dihapus.', 'success');
        await renderSessionsTab(content, businessUnitId);
      } catch (error) {
        toast(error.message ?? 'Gagal menghapus.', 'error');
      }
    })
  );
}

async function openSessionDialog(content, businessUnitId, existing) {
  const isEdit = !!existing;
  const values = await formDialog({
    title: isEdit ? 'Edit Sesi' : 'Tambah Sesi',
    fields: [
      { name: 'name', label: 'Nama Sesi', type: 'text', required: true, value: existing?.name ?? '', placeholder: 'mis. Buka' },
      { name: 'sort_order', label: 'Urutan', type: 'number', min: 0, value: existing?.sort_order ?? 0 },
      ...(isEdit ? [{ name: 'is_active', label: 'Aktif', type: 'checkbox', value: existing.is_active }] : [])
    ],
    submitText: 'Simpan'
  });
  if (!values) return;
  try {
    if (isEdit) {
      await updateSession(existing.id, { name: values.name, sort_order: Number(values.sort_order) || 0, is_active: values.is_active });
      toast('Sesi diperbarui.', 'success');
    } else {
      await createSession({ businessUnitId, name: values.name, sort_order: Number(values.sort_order) || 0 });
      toast('Sesi ditambahkan.', 'success');
    }
    await renderSessionsTab(content, businessUnitId);
  } catch (error) {
    toast(error.message ?? 'Gagal menyimpan sesi.', 'error');
  }
}

// ---- Tab: Rekap ----

async function renderReportTab(content, businessUnitId) {
  let outlets;
  try {
    outlets = await listBuOutlets(businessUnitId);
  } catch (error) {
    content.innerHTML = `<p class="error-text">${error.message ?? error}</p>`;
    return;
  }
  content.innerHTML = `
    <div class="inline-card" style="max-width:600px;display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end">
      <div class="field" style="margin:0"><label>Outlet</label>
        <select id="rep-outlet"><option value="">Semua outlet</option>${outlets.map((o) => `<option value="${o.id}">${escapeHtml(o.name)}</option>`).join('')}</select>
      </div>
      <div class="field" style="margin:0"><label>Tanggal</label><input type="date" id="rep-date" value="${todayWIB()}" /></div>
      <button class="primary" id="rep-go" style="max-width:120px">Tampilkan</button>
    </div>
    <div id="rep-result"></div>
  `;
  const run = () => loadReport(content, businessUnitId);
  document.getElementById('rep-go').addEventListener('click', run);
  await run();
}

async function loadReport(content, businessUnitId) {
  const outletId = content.querySelector('#rep-outlet').value || '';
  const date = content.querySelector('#rep-date').value || '';
  const result = content.querySelector('#rep-result');
  result.innerHTML = `<p>Memuat...</p>`;
  let runs;
  try {
    runs = await listRunsForAdmin({ businessUnitId, outletId, date });
  } catch (error) {
    result.innerHTML = `<p class="error-text">${error.message ?? error}</p>`;
    return;
  }
  result.innerHTML = `
    <table class="data-table" style="margin-top:16px">
      <thead><tr><th>Tanggal</th><th>Outlet</th><th>Sesi</th><th>Oleh</th><th>Catatan</th><th>Aksi</th></tr></thead>
      <tbody>
        ${runs
          .map(
            (r) => `
          <tr>
            <td>${r.run_date}</td>
            <td>${escapeHtml(r.outlets?.name ?? '-')}</td>
            <td>${escapeHtml(r.checklist_sessions?.name ?? '-')}</td>
            <td>${escapeHtml(r.user_profiles?.full_name ?? '-')}</td>
            <td>${escapeHtml(r.notes ?? '-')}</td>
            <td>
              <button class="btn-run-detail" data-id="${r.id}">Detail</button>
              ${r.photo_path ? `<button class="btn-run-photo" data-path="${r.photo_path}">Foto</button>` : ''}
            </td>
          </tr>`
          )
          .join('') || '<tr><td colspan="6">Tidak ada data.</td></tr>'}
      </tbody>
    </table>
  `;

  result.querySelectorAll('.btn-run-photo').forEach((btn) =>
    btn.addEventListener('click', async () => {
      try {
        const url = await getChecklistPhotoUrl(btn.dataset.path);
        if (url) window.open(url, '_blank');
      } catch (error) {
        toast(error.message ?? 'Gagal membuka foto.', 'error');
      }
    })
  );
  result.querySelectorAll('.btn-run-detail').forEach((btn) =>
    btn.addEventListener('click', async () => {
      try {
        const items = await getRunItems(btn.dataset.id);
        const bodyHtml = items.length
          ? `<ul style="margin:0;padding-left:18px">${items
              .map((i) => `<li>${i.checked ? '✅' : '⬜'} ${escapeHtml(i.checklist_items?.label ?? '-')}${i.note ? ` <span style="color:var(--color-text-muted)">(${escapeHtml(i.note)})</span>` : ''}</li>`)
              .join('')}</ul>`
          : '<p>Tidak ada item.</p>';
        await infoDialog({ title: 'Detail Ceklis', bodyHtml });
      } catch (error) {
        toast(error.message ?? 'Gagal memuat detail.', 'error');
      }
    })
  );
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(s) {
  return escapeHtml(s);
}
