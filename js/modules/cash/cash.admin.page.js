import { toast, confirmDialog, formDialog } from '../../core/ui.js';
import { formatRupiah } from '../../core/format.js';
import {
  ENTRY_LABEL,
  listCashCategories,
  listCashMembers,
  createCashCategory,
  updateCashCategory,
  deleteCashCategory,
  listCashBalances,
  listCashEntriesAdmin,
  getCashProofUrl,
  daftarKantongKas,
  aturKantongKas
} from './cash.service.js';
import { listMyOutletsAllBu } from '../../core/my-outlets.js';
import { monthRangeWIB } from '../../core/dates.js';
import { loadingHtml, sekaliJalan } from '../../core/loading.js';

const DIRECTIONS = [
  { value: 'both', label: 'Masuk & Keluar' },
  { value: 'in', label: 'Masuk saja' },
  { value: 'out', label: 'Keluar saja' }
];

const TABS = [
  { key: 'balances', label: 'Saldo & Mutasi' },
  { key: 'accounts', label: 'Kantong Kas' },
  { key: 'categories', label: 'Kategori' }
];

/**
 * Kas melekat pada USER (migration 0040), jadi halaman ini lintas BU:
 * menampilkan SEMUA pemegang kas di organisasi. Aksesnya dibatasi Super Admin
 * lewat `admin-tabs.js` + RLS `cash_entries_select_super`.
 */
export async function renderCashAdminPage(container) {
  container.innerHTML = `
    <h1>Kas</h1>
    <p style="font-size:0.82rem;color:var(--color-text-muted);margin-top:0">
      Kas melekat pada orang, bukan BU/outlet — daftar di bawah mencakup seluruh pemegang kas di organisasi.
    </p>
    <div class="tab-bar">
      ${TABS.map((t, i) => `<button class="tab-btn ${i === 0 ? 'active' : ''}" data-tab="${t.key}">${t.label}</button>`).join('')}
    </div>
    <div id="cash-admin-content"></div>
  `;
  const content = document.getElementById('cash-admin-content');
  async function showTab(key) {
    container.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === key));
    if (key === 'balances') await renderBalancesTab(content);
    if (key === 'accounts') await renderAccountsTab(content);
    if (key === 'categories') await renderCategoriesTab(content);
  }
  container.querySelectorAll('.tab-btn').forEach((btn) => btn.addEventListener('click', () => showTab(btn.dataset.tab)));
  await showTab('balances');
}

// ---- Tab: Saldo & Mutasi ----

async function renderBalancesTab(content) {
  content.innerHTML = loadingHtml('Memuat…', { baris: 5 });
  let balances, staff;
  try {
    [balances, staff] = await Promise.all([listCashBalances(), listCashMembers()]);
  } catch (error) {
    content.innerHTML = `<p class="error-text">${error.message ?? error}</p>`;
    return;
  }
  const nameById = new Map(staff.map((s) => [s.user_id, s.full_name]));
  const rows = balances.filter((b) => Number(b.balance) !== 0 || nameById.has(b.holder_id));
  const total = rows.reduce((sum, b) => sum + Number(b.balance || 0), 0);
  const range = monthRangeWIB();

  content.innerHTML = `
    <h2 style="font-size:1.05rem">Saldo Kas per Pemegang</h2>
    <div class="table-scroll" style="max-width:460px"><table class="data-table table-freeze-1">
      <thead><tr><th>Pemegang</th><th>Saldo</th></tr></thead>
      <tbody>
        ${rows.map((b) => `<tr><td>${esc(nameById.get(b.holder_id) ?? '-')}</td><td>${formatRupiah(b.balance)}</td></tr>`).join('') || '<tr><td colspan="2">Belum ada data kas.</td></tr>'}
      </tbody>
    </table></div>
    <p style="font-weight:600;margin-top:8px">Total kas seluruh pemegang: ${formatRupiah(total)}</p>

    <h2 style="font-size:1.05rem;margin-top:20px">Mutasi Kas</h2>
    <div class="inline-card" style="max-width:640px;display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end">
      <div class="field" style="margin:0"><label>Pemegang</label>
        <select id="cm-holder"><option value="">Semua</option>${staff.map((s) => `<option value="${s.user_id}">${esc(s.full_name)}</option>`).join('')}</select>
      </div>
      <div class="field" style="margin:0"><label>Jenis</label>
        <select id="cm-type"><option value="">Semua</option>${Object.entries(ENTRY_LABEL).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
      </div>
      <div class="field" style="margin:0"><label>Dari</label><input type="date" id="cm-from" value="${range.from}" /></div>
      <div class="field" style="margin:0"><label>Sampai</label><input type="date" id="cm-to" value="${range.to}" /></div>
      <button class="primary" id="cm-go" style="max-width:120px">Tampilkan</button>
    </div>
    <div id="cm-result"></div>
  `;
  const go = () => loadMutasi(content);
  content.querySelector('#cm-go').addEventListener('click', go);
  await go();
}

async function loadMutasi(content) {
  const holderId = content.querySelector('#cm-holder').value || '';
  const entryType = content.querySelector('#cm-type').value || '';
  const from = content.querySelector('#cm-from').value;
  const to = content.querySelector('#cm-to').value;
  const result = content.querySelector('#cm-result');
  result.innerHTML = loadingHtml('Memuat…', { baris: 5 });
  let rows;
  try {
    rows = await listCashEntriesAdmin({ holderId, entryType, dateFrom: from || '', dateTo: to || '' });
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

// ---- Tab: Kantong Kas ----

/**
 * KENAPA TAB INI ADA.
 *
 * 0120 membuat kantong kas bisa diberi OUTLET, supaya staff outlet itu boleh
 * mencatat pengeluaran dari kantong milik orang lain (Shenda menginput nota,
 * kas Risma yang berkurang).
 *
 * Satu-satunya layar yang bisa mengisi outlet itu ada di STAFF APP, di balik
 * tombol yang hanya digambar kalau jatah kantongnya lebih dari satu — dan
 * pemegang berjatah 1 bahkan belum punya baris kantong sama sekali; kasnya
 * hidup sebagai "Kas Utama". Jadi tidak ada seorang pun, termasuk super admin,
 * yang bisa menyalakan fitur itu.
 *
 * Di sini adminnya yang membuatkan.
 */

const KET_OUTLET_KANTONG_ADMIN =
  'Kalau kantong ini diberi outlet, SIAPA PUN yang bertugas di outlet itu bisa mencatat pengeluaran dari kantong ' +
  'pemegangnya — mis. staff yang menginput nota dari supplier. Uangnya tetap milik pemegangnya dan selisihnya tetap ' +
  'tanggung jawabnya; setiap entri mencatat siapa yang membuatnya. Kosongkan kalau kantong ini pribadi.';

async function renderAccountsTab(content) {
  content.innerHTML = loadingHtml('Memuat…', { baris: 5 });
  let kantong, staff, outlets;
  try {
    [kantong, staff, outlets] = await Promise.all([daftarKantongKas(), listCashMembers(), listMyOutletsAllBu().catch(() => [])]);
  } catch (error) {
    content.innerHTML = `<p class="error-text">${error.message ?? error}</p>`;
    return;
  }

  const adaKasUtamaBerisi = kantong.some((k) => !k.kantong_nyata);

  content.innerHTML = `
    <div class="page-header">
      <h2 style="font-size:1.05rem;margin:0">Kantong Kas</h2>
      <button class="primary" id="btn-new-akun" style="max-width:190px">+ Tambah Kantong</button>
    </div>
    <p style="font-size:0.82rem;color:var(--color-text-muted);max-width:720px">
      Kantong yang diberi <strong>outlet</strong> boleh dibebani siapa pun yang bertugas di outlet itu — inilah yang
      membuat staff bisa menginput nota supplier sementara uangnya berkurang dari kas pemegangnya.
      Kantong tanpa outlet tetap pribadi: hanya pemegangnya.
    </p>
    ${
      adaKasUtamaBerisi
        ? `<p style="font-size:0.82rem;color:var(--color-text-muted);max-width:720px">
             Baris <strong>Kas Utama</strong> adalah uang yang tidak berada di kantong mana pun — tempat kas berada
             sebelum kantong pertama dibuat. Ia tidak bisa diberi outlet. Saldo totalnya tetap terhitung, dan membuat
             kantong baru tidak memindahkan isinya.
           </p>`
        : ''
    }
    <div class="table-scroll"><table class="data-table table-freeze-1">
      <thead><tr><th>Pemegang</th><th>Kantong</th><th>Outlet</th><th>Saldo</th><th>Status</th><th>Aksi</th></tr></thead>
      <tbody>
        ${
          kantong
            .map((k) => {
              if (!k.kantong_nyata) {
                return `<tr style="color:var(--color-text-muted)">
                  <td>${esc(k.holder_name)}</td>
                  <td><em>Kas Utama</em></td>
                  <td>—</td>
                  <td>${formatRupiah(k.balance)}</td>
                  <td>—</td>
                  <td style="font-size:0.75rem">tanpa kantong</td>
                </tr>`;
              }
              return `<tr>
                <td>${esc(k.holder_name)}</td>
                <td>${esc(k.name)}</td>
                <td>${k.outlet_name ? `🏪 ${esc(k.outlet_name)}` : '<span style="color:var(--color-text-muted)">pribadi</span>'}</td>
                <td>${formatRupiah(k.balance)}</td>
                <td>${k.is_active ? 'Aktif' : 'Ditutup'}</td>
                <td><button class="btn-edit-akun" data-json='${escAttr(JSON.stringify(k))}'>Edit</button></td>
              </tr>`;
            })
            .join('') || '<tr><td colspan="6">Belum ada kantong kas.</td></tr>'
        }
      </tbody>
    </table></div>
  `;

  content.querySelector('#btn-new-akun').addEventListener('click', () => openAkunDialog(content, null, staff, outlets));
  content
    .querySelectorAll('.btn-edit-akun')
    .forEach((btn) => btn.addEventListener('click', () => openAkunDialog(content, JSON.parse(btn.dataset.json), staff, outlets)));
}

async function openAkunDialog(content, existing, staff, outlets) {
  const isEdit = !!existing;
  const opsiOutlet = [
    { value: '', label: 'Pribadi — hanya pemegangnya' },
    ...outlets.map((o) => ({
      value: o.id,
      label: `Kas outlet ${o.name}${o.business_unit_name ? ` (${o.business_unit_name})` : ''}`
    }))
  ];

  const values = await formDialog({
    title: isEdit ? `Kantong Kas — ${existing.holder_name}` : 'Tambah Kantong Kas',
    description: isEdit
      ? 'Kantong tidak bisa dipindahkan ke pemegang lain; memindahkannya berarti memindahkan riwayat uangnya tanpa satu pun entri yang mencatatnya. Pakai Transfer.'
      : 'Pilih pemegangnya, lalu namai sesuai peruntukannya — mis. "Kas Operasional Serpong".',
    fields: [
      // Saat mengedit, pemegangnya TIDAK dirender sama sekali — bukan dirender
      // lalu dimatikan. `formDialog` tidak mengenal `disabled`, jadi field yang
      // "dikunci" akan tampil biasa saja dan bisa diubah; penolakannya baru
      // datang dari server, setelah orangnya mengira sudah berhasil memindahkan.
      // Pemegangnya disebut di judul dialog.
      ...(isEdit
        ? []
        : [{ name: 'holder_id', label: 'Pemegang', type: 'select', required: true, options: staff.map((s) => ({ value: s.user_id, label: s.full_name })) }]),
      { name: 'name', label: 'Nama kantong', type: 'text', required: true, value: existing?.name ?? '', placeholder: 'mis. Kas Operasional' },
      { name: 'outlet_id', label: 'Dipakai untuk outlet', type: 'select', value: existing?.outlet_id ?? '', options: opsiOutlet, help: KET_OUTLET_KANTONG_ADMIN },
      ...(isEdit ? [{ name: 'is_active', label: 'Aktif', type: 'checkbox', value: existing.is_active }] : [])
    ],
    submitText: 'Simpan'
  });
  if (!values) return;

  // MENCABUT OUTLET DIKONFIRMASI. Akibatnya tidak terlihat di layar ini: staff
  // yang selama ini bisa mencatat nota dari kantong itu akan berhenti bisa, dan
  // yang ia lihat cuma pilihan kasnya menghilang tanpa sebab yang bisa ia
  // telusuri — lalu ia akan mencatatnya ke kasnya sendiri, persis masalah semula.
  if (isEdit && existing.outlet_id && !values.outlet_id) {
    const ok = await confirmDialog({
      title: 'Jadikan kantong pribadi?',
      message: `Staff di outlet ${esc(existing.outlet_name ?? 'itu')} tidak akan bisa lagi mencatat pengeluaran dari "${esc(existing.name)}" milik ${esc(existing.holder_name)}. Riwayat yang sudah ada tidak berubah.`,
      confirmText: 'Jadikan pribadi'
    });
    if (!ok) return;
  }

  try {
    // TULIS PENUH: keempat field selalu dikirim. RPC-nya tidak punya nilai
    // yang berarti "jangan sentuh", justru supaya pemanggil separuh-jadi
    // ketahuan seketika alih-alih diam-diam mengosongkan field yang tak disebut.
    await aturKantongKas({
      id: existing?.id ?? null,
      holderId: isEdit ? existing.holder_id : values.holder_id,
      name: values.name,
      outletId: values.outlet_id,
      isActive: isEdit ? values.is_active !== false : true
    });
    toast(isEdit ? 'Kantong kas diperbarui.' : 'Kantong kas ditambahkan.', 'success');
    await renderAccountsTab(content);
  } catch (error) {
    toast(error.message ?? 'Gagal menyimpan.', 'error');
  }
}

// ---- Tab: Kategori ----

async function renderCategoriesTab(content) {
  content.innerHTML = loadingHtml('Memuat…', { baris: 5 });
  let cats;
  try {
    cats = await listCashCategories(false);
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
  document.getElementById('btn-new-cat').addEventListener('click', () => openCatDialog(content, null));
  content.querySelectorAll('.btn-edit-cat').forEach((btn) => btn.addEventListener('click', () => openCatDialog(content, JSON.parse(btn.dataset.json))));
  content.querySelectorAll('.btn-del-cat').forEach((btn) =>
    btn.addEventListener('click', sekaliJalan(async () => {
      const ok = await confirmDialog({ title: 'Hapus kategori?', confirmText: 'Hapus', danger: true });
      if (!ok) return;
      try {
        await deleteCashCategory(btn.dataset.id);
        toast('Kategori dihapus.', 'success');
        await renderCategoriesTab(content);
      } catch (error) {
        toast(error.message ?? 'Gagal menghapus.', 'error');
      }
    }))
  );
}

async function openCatDialog(content, existing) {
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
    else await createCashCategory({ name: values.name, direction: values.direction });
    toast(isEdit ? 'Kategori diperbarui.' : 'Kategori ditambahkan.', 'success');
    await renderCategoriesTab(content);
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
