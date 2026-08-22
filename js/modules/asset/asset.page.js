import { listMyOutlets } from '../../core/my-outlets.js';
import { toast, confirmDialog, formDialog } from '../../core/ui.js';
import { formatNum } from '../../core/format.js';
import { exportTablePDF, imageToDataUrl } from '../../core/pdf.js';
import { exportTableXLSXFoto } from '../../core/xlsx-foto.js';
import {
  ASSET_CONDITION,
  ASSET_CONDITION_BADGE,
  ASSET_CONDITION_OPTIONS,
  conditionText,
  listAssets,
  saveAsset,
  deleteAsset,
  getAssetPhotoUrl,
  getAssetPhotoUrls
} from './asset.service.js';
import { loadingHtml, sekaliJalan } from '../../core/loading.js';

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
  container.innerHTML = loadingHtml('Memuat inventaris…');

  // Admin maupun staff sama-sama dibatasi scope-nya. Sebelumnya `isAdmin` melewati
  // penyaringan sama sekali, sehingga admin outlet melihat seluruh outlet BU.
  const outlets = await listMyOutlets(businessUnitId).catch(() => []);
  if (!outlets.length) {
    container.innerHTML = `<h1>Inventaris Aset</h1><p style="color:var(--color-text-muted)">Belum ada outlet yang bisa kamu akses di BU ini.</p>`;
    return;
  }

  const state = { outletId: isAdmin ? '' : outlets[0].id, condition: '', q: '' };
  let rows = [];
  /** photo_path -> signed URL, diisi ulang tiap refresh. */
  let fotoUrl = new Map();

  container.innerHTML = `
    <div class="page-header">
      <h1 style="margin:0">Inventaris Aset</h1>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button id="as-pdf">⇩ Export PDF</button>
        ${isAdmin ? '<button id="as-xlsx">⇩ Export Excel</button>' : ''}
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
        <select id="as-cond"><option value="">Semua</option>${ASSET_CONDITION_OPTIONS.map((c) => `<option value="${c.value}">${esc(c.label)}</option>`).join('')}</select>
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
  // `sekaliJalan` menahan klik kedua selagi foto masih diambil. Tanpa itu,
  // menekan dua kali menjalankan dua unduhan yang saling berebut jaringan dan
  // menghasilkan dua file yang sebagian fotonya kosong.
  container.querySelector('#as-xlsx')?.addEventListener('click', sekaliJalan(exportXlsx, { teks: 'Menyiapkan…' }));

  async function refresh() {
    list.innerHTML = loadingHtml('Memuat…', { baris: 5 });
    try {
      rows = await listAssets({ businessUnitId, outletId: state.outletId, condition: state.condition, q: state.q });
    } catch (error) {
      list.innerHTML = `<p class="error-text">${esc(error.message ?? error)}</p>`;
      return;
    }
    // Semua signed URL diambil sekali untuk seluruh halaman. Satu permintaan
    // per baris akan menembakkan puluhan koneksi berbarengan dan sebagian
    // tertunda lama — tabelnya lalu tampak "sebagian fotonya rusak".
    fotoUrl = await getAssetPhotoUrls(rows.map((a) => a.photo_path));

    const rusak = rows.filter((a) => a.condition === 'rusak').length;
    const totalUnit = rows.reduce((t, a) => t + (Number(a.qty) || 0), 0);

    list.innerHTML = `
      <p style="font-size:0.82rem;color:var(--color-text-muted);margin:0 0 8px">
        <strong>${rows.length}</strong> jenis barang · <strong>${formatNum(totalUnit)}</strong> unit
        ${rusak ? ` · <span style="color:var(--color-danger)"><strong>${rusak}</strong> rusak</span>` : ''}
      </p>
      <div class="table-scroll">
        <table class="data-table table-freeze-1 kartu-sempit">
          <thead><tr><th>Nama Barang</th><th>Foto</th><th>Jumlah</th><th>Ukuran</th><th>Kondisi</th>${isAdmin ? '<th>Outlet</th>' : ''}<th>Aksi</th></tr></thead>
          <tbody>
            ${
              rows
                .map(
                  (a) => `<tr>
                    <td data-label="Nama Barang"><strong>${esc(a.name)}</strong>${a.notes ? `<div style="font-size:0.74rem;color:var(--color-text-muted)">${esc(a.notes)}</div>` : ''}</td>
                    <td data-label="Foto">${fotoSel(a, fotoUrl)}</td>
                    <td style="text-align:right" data-label="Jumlah">${formatNum(a.qty)}</td>
                    <td style="font-size:0.85rem" data-label="Ukuran">${esc(a.size ?? '-')}</td>
                    <td data-label="Kondisi"><span class="badge ${ASSET_CONDITION_BADGE[a.condition] ?? ''}">${esc(conditionText(a))}</span></td>
                    ${isAdmin ? `<td style="font-size:0.82rem" data-label="Outlet">${esc(a.outlets?.name ?? '-')}</td>` : ''}
                    <td data-label="Aksi">
                      <button class="as-edit" data-id="${a.id}">Edit</button>
                      <button class="as-del" data-id="${a.id}">Hapus</button>
                    </td>
                  </tr>`
                )
                .join('') || `<tr><td colspan="${isAdmin ? 7 : 6}">Belum ada aset tercatat.</td></tr>`
            }
          </tbody>
        </table>
      </div>
    `;

    list.querySelectorAll('.as-thumb').forEach((img) =>
      img.addEventListener('click', () => window.open(img.src, '_blank'))
    );
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
      b.addEventListener('click', sekaliJalan(async () => {
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
      }))
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
          // Kamera belakang: barang difoto langsung di tempat, bukan dicari-cari
          // di galeri. Galeri tetap tersedia sebagai tombol kedua.
          type: 'photo',
          facing: 'environment',
          help: 'Ambil Foto membuka kamera langsung. Kalau fotonya sudah ada, pakai Dari Galeri.'
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
      toast('Menyiapkan foto untuk PDF…', 'info');

      // Foto diubah jadi data URL kecil. jsPDF memuat gambar secara SINKRON,
      // jadi URL jaringan menghasilkan halaman kosong tanpa error apa pun.
      // Dikerjakan berurutan (bukan Promise.all) supaya ratusan gambar tidak
      // dimuat serentak dan membuat tab menggantung.
      const fotoPdf = new Map();
      for (const a of rows) {
        if (!a.photo_path) continue;
        const url = fotoUrl.get(a.photo_path);
        if (!url) continue;
        const dataUrl = await imageToDataUrl(url, 160, 0.7);
        if (dataUrl) fotoPdf.set(a.id, dataUrl);
      }

      await exportTablePDF({
        title: 'Inventaris Aset',
        subtitle: `${nama}${state.condition ? ` · Kondisi: ${ASSET_CONDITION[state.condition]}` : ''} · ${rows.length} jenis barang`,
        columns: [
          { header: 'Foto', width: 0.9 },
          { header: 'Nama Barang', width: 2 },
          { header: 'Jumlah', width: 0.7 },
          { header: 'Ukuran', width: 1.2 },
          { header: 'Kondisi', width: 1.6 },
          { header: 'Outlet', width: 1.3 },
          { header: 'Catatan', width: 1.6 }
        ],
        rows: rows.map((a) => [
          fotoPdf.has(a.id) ? { image: fotoPdf.get(a.id), w: 46, h: 34 } : '-',
          a.name,
          formatNum(a.qty),
          a.size ?? '-',
          conditionText(a),
          a.outlets?.name ?? '-',
          a.notes ?? '-'
        ]),
        filename: 'inventaris-aset'
      });
      toast('PDF inventaris terunduh.', 'success');
    } catch (error) {
      toast(error.message ?? 'Gagal membuat PDF.', 'error');
    }
  }

  /**
   * Export Excel dengan foto TERTANAM di dalam selnya.
   *
   * Fotonya benar-benar ikut ke dalam berkas, bukan tautan. Bucket `asset-photos`
   * bersifat privat, jadi satu-satunya URL yang bisa ditulis ke dalam file adalah
   * signed URL — dan signed URL kedaluwarsa. File yang hari ini penuh gambar
   * akan jadi deretan sel rusak dalam hitungan hari, di komputer orang yang
   * sudah tidak ingat file itu datang dari mana. Alasan lengkapnya di
   * `core/xlsx-foto.js`.
   */
  async function exportXlsx() {
    if (!rows.length) return toast('Tidak ada data untuk diexport.', 'warning');
    const nama = state.outletId ? outlets.find((o) => o.id === state.outletId)?.name ?? '-' : 'Semua outlet';
    const berfoto = rows.filter((a) => a.photo_path).length;

    try {
      if (berfoto) toast(`Menyiapkan ${berfoto} foto…`, 'info');

      // Berurutan, BUKAN Promise.all. Ratusan gambar yang dimuat serentak
      // membuat sebagian permintaan tertunda lama atau ditolak — dan hasilnya
      // file yang "sebagian fotonya hilang" tanpa sebab yang jelas. Sama seperti
      // yang sudah dilakukan di jalur PDF.
      const fotoSel = new Map();
      for (const a of rows) {
        if (!a.photo_path) continue;
        const url = fotoUrl.get(a.photo_path);
        // Signed URL-nya sendiri gagal dibuat, atau gambarnya gagal dimuat.
        // Dua-duanya ditandai 'GAGAL', bukan dikosongkan: sel kosong terbaca
        // sebagai "barang ini belum difoto", dan orang akan disuruh memfoto
        // ulang barang yang fotonya sudah ada.
        const dataUrl = url ? await imageToDataUrl(url, 220, 0.72) : null;
        fotoSel.set(a.id, dataUrl ?? 'GAGAL');
      }

      const hasil = await exportTableXLSXFoto({
        filename: `inventaris-aset-${new Date().toISOString().slice(0, 10)}`,
        sheetName: 'Inventaris Aset',
        title: 'Inventaris Aset',
        subtitle: `${nama}${state.condition ? ` · Kondisi: ${ASSET_CONDITION[state.condition]}` : ''}${state.q ? ` · Cari: "${state.q}"` : ''} · ${rows.length} jenis barang · diunduh ${new Date().toLocaleString('id-ID')}`,
        columns: [
          { header: 'Foto', foto: true },
          { header: 'Nama Barang', width: 28 },
          { header: 'Jumlah', numeric: true, width: 10 },
          { header: 'Ukuran', width: 16 },
          { header: 'Kondisi', width: 22 },
          { header: 'Outlet', width: 20 },
          { header: 'Catatan', width: 30 }
        ],
        rows: rows.map((a) => [
          a.photo_path ? fotoSel.get(a.id) ?? 'GAGAL' : null,
          a.name,
          // Angka mentah, bukan hasil format. Kolom Jumlah harus bisa
          // dijumlahkan di Excel — dan itu alasan orang minta xlsx, bukan PDF.
          Number(a.qty) || 0,
          a.size ?? '-',
          conditionText(a),
          a.outlets?.name ?? '-',
          a.notes ?? '-'
        ])
      });

      // Dikatakan apa adanya. "Excel terunduh" saja akan menyembunyikan foto
      // yang gagal, dan yang membukanya baru tahu setelah file sampai ke orang lain.
      if (hasil.gagalFoto) {
        toast(`Excel terunduh — ${hasil.adaFoto} foto ikut, ${hasil.gagalFoto} gagal dimuat. Muat ulang halaman lalu coba lagi untuk yang gagal.`, 'warning');
      } else {
        toast(`Excel terunduh — ${hasil.adaFoto} foto ikut di dalamnya.`, 'success');
      }
    } catch (error) {
      toast(error.message ?? 'Gagal membuat Excel.', 'error');
    }
  }

  await refresh();
}

/**
 * Sel foto: thumbnail langsung, diklik membuka ukuran penuh.
 * Kalau signed URL-nya gagal dibuat, tetap sediakan tombol "Lihat" — gagalnya
 * bisa jadi hanya sementara, dan lebih baik user bisa mencoba lagi daripada
 * melihat "-" yang seolah berarti fotonya memang tidak ada.
 */
function fotoSel(a, fotoUrl) {
  if (!a.photo_path) return '<span style="color:var(--color-text-muted)">-</span>';
  const url = fotoUrl.get(a.photo_path);
  if (!url) return `<button class="as-photo" data-path="${esc(a.photo_path)}">Lihat</button>`;
  return `<img src="${esc(url)}" alt="" loading="lazy" class="as-thumb" data-path="${esc(a.photo_path)}"
    style="width:52px;height:52px;object-fit:cover;border-radius:6px;background:#eee;cursor:zoom-in;border:1px solid var(--color-border,#e3e3e3)" />`;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
