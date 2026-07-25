import { toast, confirmDialog, formDialog } from '../../core/ui.js';
import { formatRupiah } from '../../core/format.js';
import { listBuStaff } from '../leave/leave.service.js';
import {
  ENTRY_LABEL,
  listCashCategories,
  createCashCategory,
  updateCashCategory,
  deleteCashCategory,
  listCashBalances,
  listCashEntriesAdmin,
  getCashProofUrl,
  todayWIB
} from './cash.service.js';

const DIRECTIONS = [
  { value: 'both', label: 'Masuk & Keluar' },
  { value: 'in', label: 'Masuk saja' },
  { value: 'out', label: 'Keluar saja' }
];

const TABS = [
  { key: 'balances', label: 'Saldo & Mutasi' },
  { key: 'categories', label: 'Kategori' }
];

export async function renderCashAdminPage(container, { businessUnitId }) {
  container.innerHTML = `
    <h1>Kas</h1>
    <div class="tab-bar">
      ${TABS.map((t, i) => `<button class="tab-btn ${i === 0 ? 'active' : ''}" data-tab="${t.key}">${t.label}</button>`).join('')}
    </div>
    <div id="cash-admin-content"></div>
  `;
  const content = document.getElementById('cash-admin-content');
  async function showTab(key) {
    container.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === key));
    if (key === 'balances') await renderBalancesTab(content, businessUnitId);
    if (key === 'categories') await renderCategoriesTab(content, businessUnitId);
  }
  container.querySelectorAll('.tab-btn').forEach((btn) => btn.addEventListener('click', () => showTab(btn.dataset.tab)));
  await showTab('balances');
}

// ---- Tab: Saldo & Mutasi ----

async function renderBalancesTab(content, businessUnitId) {
  content.innerHTML = `<p>Memuat...</p>`;
  let balances, staff;
  try {
    [balances, staff] = await Promise.all([listCashBalances(businessUnitId), listBuStaff(businessUnitId)]);
  } catch (error) {
    content.innerHTML = `<p class="error-text">${error.message ?? error}</p>`;
    return;
  }
  const nameById = new Map(staff.map((s) => [s.user_id, s.full_name]));
  const rows = balances.filter((b) => Number(b.balance) !== 0 || nameById.has(b.holder_id));
  const total = rows.reduce((sum, b) => sum + Number(b.balance || 0), 0);
  const today = todayWIB();

  content.innerHTML = `
    <h2 style="font-size:1.05rem">Saldo Kas per Pemegang</h2>
    <table class="data-table" style="max-width:460px">
      <thead><tr><th>Pemegang</th><th>Saldo</th></tr></thead>
      <tbody>
        ${rows.map((b) => `<tr><td>${esc(nameById.get(b.holder_id) ?? '-')}</td><td>${formatRupiah(b.balance)}</td></tr>`).join('') || '<tr><td colspan="2">Belum ada data kas.</td></tr>'}
      </tbody>
    </table>
    <p style="font-weight:600;margin-top:8px">Total kas BU: ${formatRupiah(total)}</p>

    <h2 style="font-size:1.05rem;margin-top:20px">Mutasi Kas</h2>
    <div class="inline-card" style="max-width:640px;display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end">
      <div class="field" style="margin:0"><label>Pemegang</label>
        <select id="cm-holder"><option value="">Semua</option>${staff.map((s) => `<option value="${s.user_id}">${esc(s.full_name)}</option>`).join('')}</select>
      </div>
      <div class="field" style="margin:0"><label>Jenis</label>
        <select id="cm-type"><option value="">Semua</option>${Object.entries(ENTRY_LABEL).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
      </div>
      <div class="field" style="margin:0"><label>Dari</label><input type="date" id="cm-from" value="${today}" /></div>
      <div class="field" style="margin:0"><label>Sampai</label><input type="date" id="cm-to" value="${today}" /></div>
      <button class="primary" id="cm-go" style="max-width:120px">Tampilkan</button>
    </div>
    <div id="cm-result"></div>
  `;
  const go = () => loadMutasi(content, businessUnitId);
  content.querySelector('#cm-go').addEventListener('click', go);
  await go();
}

async function loadMutasi(content, businessUnitId) {
  const holderId = content.querySelector('#cm-holder').value || '';
  const entryType = content.querySelector('#cm-type').value || '';
  const from = content.querySelector('#cm-from').value;
  const to = content.querySelector('#cm-to').value;
  const result = content.querySelector('#cm-result');
  result.innerHTML = `<p>Memuat...</p>`;
  let rows;
  try {
    rows = await listCashEntriesAdmin({ businessUnitId, holderId, entryType, dateFrom: from || '', dateTo: to || '' });
  } catch (error) {
    result.innerHTML = `<p class="error-text">${error.message ?? error}</p>`;
    return;
  }
  let masuk = 0;
  let keluar = 0;
  for (const r of rows) {
    const a = Number(r.amount) || 0;
    if (a >= 0) masuk += a;
    else keluar += Math.abs(a);
  }
  result.innerHTML = `
    <p style="margin:12px 0 6px;font-weight:600">Masuk ${formatRupiah(masuk)} · Keluar ${formatRupiah(keluar)} · Net ${formatRupiah(masuk - keluar)}</p>
    <table class="data-table">
      <thead><tr><th>Tanggal</th><th>Pemegang</th><th>Jenis</th><th>Kategori / Lawan</th><th>Jumlah</th><th></th></tr></thead>
      <tbody>
        ${rows
          .map((r) => {
            const amt = Number(r.amount);
            const ket = r.cash_categories?.name ?? (r.counterpart?.full_name ? `${amt >= 0 ? 'dari' : 'ke'} ${r.counterpart.full_name}` : '-');
            return `<tr>
              <td style="font-size:0.82rem">${fmtDate(r.entry_date)}</td>
              <td>${esc(r.holder?.full_name ?? '-')}</td>
              <td>${ENTRY_LABEL[r.entry_type] ?? r.entry_type}</td>
              <td>${esc(ket)}${r.notes ? `<div style="font-size:0.75rem;color:var(--color-text-muted)">${esc(r.notes)}</div>` : ''}</td>
              <td style="color:${amt >= 0 ? 'var(--color-primary)' : 'var(--color-danger)'};font-weight:600">${amt >= 0 ? '+' : '−'}${formatRupiah(Math.abs(amt))}</td>
              <td>${r.proof_path ? `<button class="btn-proof" data-path="${r.proof_path}">Bukti</button>` : ''}</td>
            </tr>`;
          })
          .join('') || '<tr><td colspan="6">Tidak ada data.</td></tr>'}
      </tbody>
    </table>
  `;
  result.querySelectorAll('.btn-proof').forEach((btn) =>
    btn.addEventListener('click', async () => {
      try {
        const url = await getCashProofUrl(btn.dataset.path);
        if (url) window.open(url, '_blank');
      } catch (error) {
        toast(error.message ?? 'Gagal membuka bukti.', 'error');
      }
    })
  );
}

// ---- Tab: Kategori ----

async function renderCategoriesTab(content, businessUnitId) {
  content.innerHTML = `<p>Memuat...</p>`;
  let cats;
  try {
    cats = await listCashCategories(businessUnitId, false);
  } catch (error) {
    content.innerHTML = `<p class="error-text">${error.message ?? error}</p>`;
    return;
  }
  content.innerHTML = `
    <div class="page-header">
      <h2 style="font-size:1.05rem;margin:0">Kategori Kas</h2>
      <button class="primary" id="btn-new-cat" style="max-width:180px">+ Tambah Kategori</button>
    </div>
    <table class="data-table" style="max-width:520px">
      <thead><tr><th>Nama</th><th>Arah</th><th>Status</th><th>Aksi</th></tr></thead>
      <tbody>
        ${cats
          .map(
            (c) => `<tr>
              <td>${esc(c.name)}</td>
              <td>${DIRECTIONS.find((d) => d.value === c.direction)?.label ?? c.direction}</td>
              <td>${c.is_active ? 'Aktif' : 'Nonaktif'}</td>
              <td>
                <button class="btn-edit-cat" data-json='${escAttr(JSON.stringify(c))}'>Edit</button>
                <button class="btn-del-cat" data-id="${c.id}">Hapus</button>
              </td>
            </tr>`
          )
          .join('') || '<tr><td colspan="4">Belum ada kategori.</td></tr>'}
      </tbody>
    </table>
  `;
  document.getElementById('btn-new-cat').addEventListener('click', () => openCatDialog(content, businessUnitId, null));
  content.querySelectorAll('.btn-edit-cat').forEach((btn) => btn.addEventListener('click', () => openCatDialog(content, businessUnitId, JSON.parse(btn.dataset.json))));
  content.querySelectorAll('.btn-del-cat').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const ok = await confirmDialog({ title: 'Hapus kategori?', confirmText: 'Hapus', danger: true });
      if (!ok) return;
      try {
        await deleteCashCategory(btn.dataset.id);
        toast('Kategori dihapus.', 'success');
        await renderCategoriesTab(content, businessUnitId);
      } catch (error) {
        toast(error.message ?? 'Gagal menghapus.', 'error');
      }
    })
  );
}

async function openCatDialog(content, businessUnitId, existing) {
  const isEdit = !!existing;
  const values = await formDialog({
    title: isEdit ? 'Edit Kategori Kas' : 'Tambah Kategori Kas',
    fields: [
      { name: 'name', label: 'Nama Kategori', type: 'text', required: true, value: existing?.name ?? '', placeholder: 'mis. Belanja Bahan' },
      { name: 'direction', label: 'Berlaku untuk', type: 'select', required: true, value: existing?.direction ?? 'both', options: DIRECTIONS },
      ...(isEdit ? [{ name: 'is_active', label: 'Aktif', type: 'checkbox', value: existing.is_active }] : [])
    ],
    submitText: 'Simpan'
  });
  if (!values) return;
  try {
    if (isEdit) await updateCashCategory(existing.id, { name: values.name, direction: values.direction, is_active: values.is_active });
    else await createCashCategory({ businessUnitId, name: values.name, direction: values.direction });
    toast(isEdit ? 'Kategori diperbarui.' : 'Kategori ditambahkan.', 'success');
    await renderCategoriesTab(content, businessUnitId);
  } catch (error) {
    toast(error.message ?? 'Gagal menyimpan.', 'error');
  }
}

function fmtDate(d) {
  return new Date(d + 'T00:00:00').toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escAttr(s) {
  return esc(s);
}
