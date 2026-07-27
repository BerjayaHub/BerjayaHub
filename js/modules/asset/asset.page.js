import { toast, confirmDialog, formDialog } from '../../core/ui.js';
import { formatNum } from '../../core/format.js';
import { exportTablePDF } from '../../core/pdf.js';
import { listAttendanceOutlets } from '../attendance/attendance.service.js';
import { getMyScopedOutlets } from '../dispatch/dispatch.service.js';
import {
  ASSET_CONDITION,
  ASSET_CONDITION_BADGE,
  ASSET_CONDITION_OPTIONS,
  conditionText,
  listAssets,
  saveAsset,
  deleteAsset,
  getAssetPhotoUrl
} from './asset.service.js';

/**
 * Inventaris Aset — dipakai Staff App maupun Admin Portal.
 *
 * Bedanya hanya cakupan outlet: staff melihat outlet dalam scope-nya, admin
 * melihat seluruh outlet BU. Isi halamannya sama supaya tidak ada dua tampilan
 * yang harus dijaga sinkron.
 */
export function renderAssetPage(container, ctx) {
  return render(container, ctx, false);
}
export function renderAssetAdminPage(container, ctx) {
  return render(container, ctx, true);
}

async function render(container, { businessUnitId }, isAdmin) {
  container.innerHTML = `<p style="color:var(--color-text-muted)">Memuat inventaris…</p>`;

  const semua = (await listAttendanceOutlets().catch(() => [])).filter((o) => o.business_unit_id === businessUnitId);
  const outlets = isAdmin ? semua : await getMyScopedOutlets(businessUnitId, semua).catch(() => semua);
  if (!outlets.length) {
    container.innerHTML = `<h1>Inventaris Aset</h1><p style="color:var(--color-text-muted)">Belum ada outlet yang bisa kamu akses di BU ini.</p>`;
    return;
  }

  const state = { outletId: isAdmin ? '' : outlets[0].id, condition: '', q: '' };
  let rows = [];

  container.innerHTML = `
    <div class="page-header">
      <h1 style="margin:0">Inventaris Aset</h1>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button id="as-pdf">⇩ Export PDF</button>
        <button class="primary" id="as-new" style="max-width:170px">+ Tambah Aset</button>
      </div>
    </div>

    <div class="inline-card" style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">
      <div class="field" style="margin:0;max-width:220px"><label>Outlet</label>
        <select id="as-outlet">
          ${isAdmin ? '<option value="">Semua outlet</option>' : ''}
          ${outlets.map((o) => `<option value="${o.id}">${esc(o.name)}</option>`).join('')}
        </select>
      </div>
      <div class="field" style="margin:0;max-width:180px"><label>Kondisi</label>
        <select id="as-cond"><option value="">Semua</option>${ASSET_CONDITION_OPTIONS.map((c) => `<option value="${c.value}">${c.label}</option>`).join('')}</select>
      </div>
      <div class="field" style="margin:0;max-width:220px"><label>Cari nama barang</label><input type="text" id="as-q" placeholder="mis. kursi" /></div>
    </div>

    <div id="as-list" style="margin-top:12px"></div>
  `;

  const list = container.querySelector('#as-list');
  container.querySelector('#as-outlet').addEventListener('change', (e) => {
    state.outletId = e.target.value;
    refresh();
  });
  container.querySelector('#as-cond').addEventListener('change', (e) => {
    state.condition = e.target.value;
    refresh();
  });
  let timer;
  container.querySelector('#as-q').addEventListener('input', (e) => {
    state.q = e.target.value.trim();
    clearTimeout(timer);
    timer = setTimeout(refresh, 300);
  });
  container.querySelector('#as-new').addEventListener('click', () => openForm(null));
  container.querySelector('#as-pdf').addEventListener('click', exportPdf);

  async function refresh() {
    list.innerHTML = `<p style="color:var(--color-text-muted)">Memuat…</p>`;
    try {
      rows = await listAssets({ businessUnitId, outletId: state.outletId, condition: state.condition, q: state.q });
    } catch (error) {
      list.innerHTML = `<p class="error-text">${esc(error.message ?? error)}</p>`;
      return;
    }
    const rusak = rows.filter((a) => a.condition === 'rusak').length;
    const totalUnit = rows.reduce((t, a) => t + (Number(a.qty) || 0), 0);

    list.innerHTML = `
      <p style="font-size:0.82rem;color:var(--color-text-muted);margin:0 0 8px">
        <strong>${rows.length}</strong> jenis barang · <strong>${formatNum(totalUnit)}</strong> unit
        ${rusak ? ` · <span style="color:var(--color-danger)"><strong>${rusak}</strong> rusak</span>` : ''}
      </p>
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr><th>Nama Barang</th><th>Jumlah</th><th>Ukuran</th><th>Kondisi</th><th>Foto</th>${isAdmin ? '<th>Outlet</th>' : ''}<th>Aksi</th></tr></thead>
          <tbody>
            ${
              rows
                .map(
                  (a) => `<tr>
                    <td><strong>${esc(a.name)}</strong>${a.notes ? `<div style="font-size:0.74rem;color:var(--color-text-muted)">${esc(a.notes)}</div>` : ''}</td>
                    <td style="text-align:right">${formatNum(a.qty)}</td>
                    <td style="font-size:0.85rem">${esc(a.size ?? '-')}</td>
                    <td><span class="badge ${ASSET_CONDITION_BADGE[a.condition] ?? ''}">${esc(conditionText(a))}</span></td>
                    <td>${a.photo_path ? `<button class="as-photo" data-path="${esc(a.photo_path)}">Lihat</button>` : '<span style="color:var(--color-text-muted)">-</span>'}</td>
                    ${isAdmin ? `<td style="font-size:0.82rem">${esc(a.outlets?.name ?? '-')}</td>` : ''}
                    <td>
                      <button class="as-edit" data-id="${a.id}">Edit</button>
                      ${isAdmin ? `<button class="as-del" data-id="${a.id}">Hapus</button>` : ''}
                    </td>
                  </tr>`
                )
                .join('') || `<tr><td colspan="${isAdmin ? 7 : 6}">Belum ada aset tercatat.</td></tr>`
            }
          </tbody>
        </table>
      </div>
    `;

    list.querySelectorAll('.as-photo').forEach((b) =>
      b.addEventListener('click', async () => {
        try {
          const url = await getAssetPhotoUrl(b.dataset.path);
          if (url) window.open(url, '_blank');
          else toast('Foto tidak ditemukan.', 'warning');
        } catch (error) {
          toast(error.message ?? 'Gagal membuka foto.', 'error');
        }
      })
    );
    list.querySelectorAll('.as-edit').forEach((b) => b.addEventListener('click', () => openForm(rows.find((a) => a.id === b.dataset.id))));
    list.querySelectorAll('.as-del').forEach((b) =>
      b.addEventListener('click', async () => {
        const a = rows.find((x) => x.id === b.dataset.id);
        const ok = await confirmDialog({
          title: `Hapus "${a.name}"?`,
          message: 'Data aset ini akan hilang permanen beserta fotonya.',
          confirmText: 'Hapus',
          danger: true
        });
        if (!ok) return;
        try {
          await deleteAsset(a.id);
          toast('Aset dihapus.', 'success');
          await refresh();
        } catch (error) {
          toast(error.message ?? 'Gagal menghapus.', 'error');
        }
      })
    );
  }

  async function openForm(existing) {
    // Admin bisa memilih "Semua outlet" di filter — untuk menyimpan, outletnya
    // harus tegas, jadi default ke outlet pertama.
    const outletDefault = existing?.outlet_id ?? state.outletId ?? outlets[0].id;

    const values = await formDialog({
      title: existing ? `Edit Aset — ${existing.name}` : 'Tambah Aset',
      fields: [
        {
          name: 'outlet_id',
          label: 'Outlet',
          type: 'select',
          required: true,
          value: outletDefault || outlets[0].id,
          options: outlets.map((o) => ({ value: o.id, label: o.name }))
        },
        { name: 'name', label: 'Nama barang', type: 'text', required: true, value: existing?.name ?? '' },
        { name: 'qty', label: 'Jumlah', type: 'qty', required: true, value: existing?.qty ?? 1 },
        { name: 'size', label: 'Ukuran barang', type: 'text', value: existing?.size ?? '', placeholder: 'mis. 120x60 cm / 3 inci / L' },
        {
          name: 'condition',
          label: 'Kondisi barang',
          type: 'select',
          required: true,
          value: existing?.condition ?? 'normal',
          options: ASSET_CONDITION_OPTIONS
        },
        {
          name: 'condition_note',
          label: 'Keterangan kondisi',
          type: 'text',
          value: existing?.condition_note ?? '',
          placeholder: 'isi kalau kondisi "Lain-lain"',
          help: 'Wajib diisi kalau kondisi dipilih Lain-lain.'
        },
        { name: 'notes', label: 'Catatan (opsional)', type: 'text', value: existing?.notes ?? '' },
        {
          name: 'file',
          label: existing?.photo_path ? 'Ganti foto (opsional)' : 'Foto barang (opsional)',
          type: 'file',
          accept: 'image/*'
        }
      ],
      submitText: 'Simpan',
      onReady: (form) => {
        // Kolom keterangan hanya relevan untuk "Lain-lain" — disembunyikan
        // supaya form tidak terasa penuh isian yang tidak dipakai.
        const cond = form.elements['condition'];
        const noteField = form.elements['condition_note'].closest('.field');
        const sync = () => (noteField.style.display = cond.value === 'lainnya' ? '' : 'none');
        cond.addEventListener('change', sync);
        sync();
      }
    });
    if (!values) return;
    if (values.condition === 'lainnya' && !values.condition_note?.trim()) {
      return toast('Isi keterangan kondisinya dulu.', 'warning');
    }

    try {
      await saveAsset({
        id: existing?.id,
        businessUnitId,
        outletId: values.outlet_id,
        name: values.name,
        qty: values.qty,
        size: values.size,
        condition: values.condition,
        conditionNote: values.condition_note,
        notes: values.notes,
        file: values.file
      });
      toast(existing ? 'Aset diperbarui.' : 'Aset ditambahkan.', 'success');
      await refresh();
    } catch (error) {
      toast(error.message ?? 'Gagal menyimpan aset.', 'error');
    }
  }

  async function exportPdf() {
    if (!rows.length) return toast('Tidak ada data untuk diexport.', 'warning');
    const nama = state.outletId ? outlets.find((o) => o.id === state.outletId)?.name ?? '-' : 'Semua outlet';
    try {
      await exportTablePDF({
        title: 'Inventaris Aset',
        subtitle: `${nama}${state.condition ? ` · Kondisi: ${ASSET_CONDITION[state.condition]}` : ''} · ${rows.length} jenis barang`,
        columns: [
          { header: 'Nama Barang', width: 2 },
          { header: 'Jumlah', width: 0.7 },
          { header: 'Ukuran', width: 1.2 },
          { header: 'Kondisi', width: 1.6 },
          { header: 'Outlet', width: 1.3 },
          { header: 'Catatan', width: 1.6 }
        ],
        rows: rows.map((a) => [a.name, formatNum(a.qty), a.size ?? '-', conditionText(a), a.outlets?.name ?? '-', a.notes ?? '-']),
        filename: 'inventaris-aset'
      });
      toast('PDF inventaris terunduh.', 'success');
    } catch (error) {
      toast(error.message ?? 'Gagal membuat PDF.', 'error');
    }
  }

  await refresh();
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
