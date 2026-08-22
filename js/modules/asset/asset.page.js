import { listMyOutlets } from '../../core/my-outlets.js';
import { listBuOwner } from '../owner/owner.service.js';
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
  getAssetPhotoUrls,
  listKategoriAset,
  pindahAset,
  pindahFotoAset
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

  const state = { outletId: isAdmin ? '' : outlets[0].id, condition: '', category: '', q: '' };
  let rows = [];
  /** Kategori yang sudah dipakai di BU ini — sumber dropdown & pilihan form. */
  let kategori = await listKategoriAset(businessUnitId).catch(() => []);
  /** id aset yang dicentang untuk dipindah (khusus admin). */
  const dipilih = new Set();
  /** photo_path -> signed URL, diisi ulang tiap refresh. */
  let fotoUrl = new Map();

  container.innerHTML = `
    <div class="page-header">
      <h1 style="margin:0">Inventaris Aset</h1>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button id="as-pdf">⇩ Export PDF</button>
        ${isAdmin ? '<button id="as-xlsx">⇩ Export Excel</button>' : ''}
        ${isAdmin ? '<button id="as-move" disabled>↔ Pindahkan (0)</button>' : ''}
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
      <div class="field" style="margin:0;max-width:200px"><label>Kategori</label>
        <select id="as-cat"><option value="">Semua kategori</option>${kategori
          .map((c) => `<option value="${esc(c)}">${esc(c)}</option>`)
          .join('')}</select>
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
  container.querySelector('#as-cat').addEventListener('change', (e) => {
    state.category = e.target.value;
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
  container.querySelector('#as-move')?.addEventListener('click', sekaliJalan(bukaPindah, { teks: 'Memindahkan…' }));

  async function refresh() {
    list.innerHTML = loadingHtml('Memuat…', { baris: 5 });
    try {
      rows = await listAssets({
        businessUnitId,
        outletId: state.outletId,
        condition: state.condition,
        category: state.category,
        q: state.q
      });
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
          <thead><tr>${isAdmin ? '<th style="width:34px"><input type="checkbox" id="as-all" title="Pilih semua yang terlihat" /></th>' : ''}<th>Nama Barang</th><th>Foto</th><th>Kategori</th><th>Jumlah</th><th>Ukuran</th><th>Kondisi</th>${isAdmin ? '<th>Outlet</th>' : ''}<th>Aksi</th></tr></thead>
          <tbody>
            ${
              rows
                .map(
                  (a) => `<tr>
                    ${isAdmin ? `<td data-label="Pilih"><input type="checkbox" class="as-pick" data-id="${a.id}"${dipilih.has(a.id) ? ' checked' : ''} /></td>` : ''}
                    <td data-label="Nama Barang"><strong>${esc(a.name)}</strong>${a.notes ? `<div style="font-size:0.74rem;color:var(--color-text-muted)">${esc(a.notes)}</div>` : ''}</td>
                    <td data-label="Foto">${fotoSel(a, fotoUrl)}</td>
                    <td style="font-size:0.85rem" data-label="Kategori">${esc(a.category ?? '-')}</td>
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
                .join('') ||
                `<tr><td colspan="${isAdmin ? 9 : 7}">${
                  state.q || state.category || state.condition
                    ? 'Tidak ada aset yang cocok dengan saringan ini.'
                    : 'Belum ada aset tercatat.'
                }</td></tr>`
            }
          </tbody>
        </table>
      </div>
    `;

    // CENTANG DISIMPAN DI LUAR TABEL.
    //
    // Tabelnya digambar ulang tiap kali saringan berubah, dan centang yang
    // hidup di DOM akan ikut hilang. Kalau begitu, admin yang memilih 5 aset di
    // outlet A lalu berpindah saringan untuk memilih 3 di outlet B akan
    // memindahkan 3, bukan 8 — tanpa satu pun tanda bahwa 5 lainnya terlepas.
    list.querySelectorAll('.as-pick').forEach((cb) =>
      cb.addEventListener('change', () => {
        if (cb.checked) dipilih.add(cb.dataset.id);
        else dipilih.delete(cb.dataset.id);
        syncPindah();
      })
    );
    list.querySelector('#as-all')?.addEventListener('change', (e) => {
      // "Pilih semua" hanya menyentuh yang SEDANG TERLIHAT. Mencentang seluruh
      // BU dari satu kotak terlalu mudah disalahgunakan, dan akibatnya tidak
      // bisa dibatalkan dengan satu tombol.
      for (const cb of list.querySelectorAll('.as-pick')) {
        cb.checked = e.target.checked;
        if (e.target.checked) dipilih.add(cb.dataset.id);
        else dipilih.delete(cb.dataset.id);
      }
      syncPindah();
    });
    syncPindah();

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

  /** Muat ulang daftar kategori & isi ulang dropdown saringannya. */
  async function muatKategori() {
    kategori = await listKategoriAset(businessUnitId).catch(() => kategori);
    const sel = container.querySelector('#as-cat');
    if (!sel) return;
    // Pilihan yang sedang aktif DIPERTAHANKAN. Menggambar ulang dropdown lalu
    // membiarkannya kembali ke "Semua kategori" akan membuat daftar melebar
    // sendiri tepat setelah orang menyimpan — dan terlihat seperti saringannya
    // rusak.
    const aktif = state.category;
    sel.innerHTML =
      '<option value="">Semua kategori</option>' +
      kategori.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
    sel.value = kategori.includes(aktif) ? aktif : '';
    state.category = sel.value;
  }

  /** Tombol Pindahkan menyebut ANGKANYA, bukan sekadar aktif/mati. */
  function syncPindah() {
    const btn = container.querySelector('#as-move');
    if (!btn) return;
    btn.disabled = dipilih.size === 0;
    btn.textContent = `↔ Pindahkan (${dipilih.size})`;
  }

  /**
   * Pindahkan aset terpilih ke outlet / BU lain.
   *
   * Fotonya ikut dipindahkan SESUDAH barisnya berpindah, karena berkas storage
   * tidak bisa dipindahkan dari dalam SQL. Urutan itu disengaja: kalau
   * pemindahan baris gagal, tidak ada berkas yang terlanjur pindah dan
   * tertinggal di folder yang salah.
   */
  async function bukaPindah() {
    if (!dipilih.size) return;

    let daftarBu = [];
    try {
      daftarBu = await listBuOwner();
    } catch {
      daftarBu = [];
    }
    // Kalau daftar BU tidak bisa diambil (bukan super admin), pemindahan tetap
    // bisa dilakukan DI DALAM BU ini. Menutup fiturnya sama sekali karena satu
    // daftar gagal dimuat jauh lebih merepotkan daripada pilihan yang lebih
    // sempit.
    if (!daftarBu.length) daftarBu = [{ id: businessUnitId, name: 'BU ini' }];

    const terpilih = rows.filter((a) => dipilih.has(a.id));
    const nama = terpilih.slice(0, 5).map((a) => a.name).join(', ');

    const nilai = await formDialog({
      title: `Pindahkan ${dipilih.size} aset`,
      fields: [
        {
          name: 'bu',
          label: 'BU tujuan',
          type: 'select',
          required: true,
          value: businessUnitId,
          options: daftarBu.map((b) => ({ value: b.id, label: b.name }))
        },
        {
          name: 'outlet',
          label: 'Outlet tujuan',
          type: 'select',
          required: true,
          value: outlets[0].id,
          options: outlets.map((o) => ({ value: o.id, label: o.name })),
          help: 'Daftar outlet menyesuaikan BU yang dipilih.'
        }
      ],
      submitText: 'Pindahkan',
      onReady: (form) => {
        const buSel = form.elements['bu'];
        const outSel = form.elements['outlet'];

        // OUTLET HARUS MENGIKUTI BU. Membiarkan keduanya bebas memungkinkan
        // kombinasi yang mustahil (outlet BU A di bawah BU B) — dan itu persis
        // yang ditolak `pindah_aset()`, jadi lebih baik tidak bisa dipilih
        // daripada ditolak setelah menekan tombol.
        const isiOutlet = async () => {
          const bu = buSel.value;
          let daftar = outlets;
          if (bu !== businessUnitId) {
            daftar = await listMyOutlets(bu).catch(() => []);
          }
          outSel.innerHTML = daftar.length
            ? daftar.map((o) => `<option value="${o.id}">${esc(o.name)}</option>`).join('')
            : '<option value="">— tidak ada outlet yang bisa kamu akses —</option>';
        };
        buSel.addEventListener('change', isiOutlet);
      }
    });
    if (!nilai) return;
    if (!nilai.outlet) return toast('Pilih outlet tujuan dulu.', 'warning');

    const ok = await confirmDialog({
      title: `Pindahkan ${dipilih.size} aset?`,
      message: `${nama}${terpilih.length > 5 ? `, dan ${terpilih.length - 5} lainnya` : ''}.\n\nFoto ikut dipindahkan ke folder outlet tujuan.`,
      confirmText: 'Ya, pindahkan'
    });
    if (!ok) return;

    try {
      const hasil = await pindahAset({ ids: [...dipilih], businessUnitId: nilai.bu, outletId: nilai.outlet });

      // Fotonya menyusul. `pindah_aset()` sudah mengosongkan `photo_path` bagi
      // yang berganti outlet, jadi yang gagal di sini berakhir sebagai aset
      // tanpa foto — bukan aset dengan tautan yang selalu gagal dibuka.
      const perluFoto = terpilih
        .filter((a) => a.photo_path && a.outlet_id !== nilai.outlet)
        .map((a) => ({ assetId: a.id, dariPath: a.photo_path, keOutletId: nilai.outlet }));

      let foto = { berhasil: 0, gagal: [] };
      if (perluFoto.length) {
        toast(`Memindahkan ${perluFoto.length} foto…`, 'info');
        foto = await pindahFotoAset(perluFoto);
      }

      dipilih.clear();

      // DIKATAKAN APA ADANYA. "Berhasil dipindahkan" yang menutupi 12 aset
      // ditolak adalah kegagalan terburuk di layar ini: orang akan mencarinya
      // di outlet tujuan dan tidak menemukannya.
      const bagian = [`${hasil.pindah} aset dipindahkan`];
      if (hasil.ditolak) bagian.push(`${hasil.ditolak} ditolak (di luar outlet yang bisa kamu kelola)`);
      if (foto.gagal.length) bagian.push(`${foto.gagal.length} foto gagal ikut — asetnya pindah tanpa foto`);
      else if (foto.berhasil) bagian.push(`${foto.berhasil} foto ikut`);

      toast(bagian.join(' · '), hasil.ditolak || foto.gagal.length ? 'warning' : 'success');
      await muatKategori();
      await refresh();
    } catch (error) {
      toast(error.message ?? 'Gagal memindahkan aset.', 'error');
    }
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
        {
          // Pola persis seperti Master Produk: pilih yang sudah ada, atau ketik
          // nama baru lalu pilih "+ Tambah …". Tidak ada langkah "buat kategori
          // dulu" yang harus dikerjakan admin sebelum barang bisa dicatat.
          name: 'category',
          label: 'Kategori',
          type: 'searchselect',
          allowCreate: true,
          value: existing?.category ?? '',
          options: kategori.map((c) => ({ value: c, label: c })),
          placeholder: 'cari / ketik kategori baru…',
          help: 'Ketik nama baru lalu pilih “+ Tambah …” untuk membuat kategori.'
        },
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
        category: values.category,
        qty: values.qty,
        size: values.size,
        condition: values.condition,
        conditionNote: values.condition_note,
        notes: values.notes,
        file: values.file
      });
      toast(existing ? 'Aset diperbarui.' : 'Aset ditambahkan.', 'success');
      // Kategori baru harus langsung bisa dipakai menyaring. Tanpa ini, orang
      // yang baru saja membuat "Elektronik" tidak akan menemukannya di dropdown
      // sampai halamannya dimuat ulang — dan akan membuatnya lagi.
      await muatKategori();
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
        subtitle: `${nama}${state.category ? ` · Kategori: ${state.category}` : ''}${state.condition ? ` · Kondisi: ${ASSET_CONDITION[state.condition]}` : ''} · ${rows.length} jenis barang`,
        columns: [
          { header: 'Foto', width: 0.9 },
          { header: 'Nama Barang', width: 1.8 },
          { header: 'Kategori', width: 1.1 },
          { header: 'Jumlah', width: 0.7 },
          { header: 'Ukuran', width: 1.2 },
          { header: 'Kondisi', width: 1.6 },
          { header: 'Outlet', width: 1.3 },
          { header: 'Catatan', width: 1.6 }
        ],
        rows: rows.map((a) => [
          fotoPdf.has(a.id) ? { image: fotoPdf.get(a.id), w: 46, h: 34 } : '-',
          a.name,
          a.category ?? '-',
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
        subtitle: `${nama}${state.category ? ` · Kategori: ${state.category}` : ''}${state.condition ? ` · Kondisi: ${ASSET_CONDITION[state.condition]}` : ''}${state.q ? ` · Cari: "${state.q}"` : ''} · ${rows.length} jenis barang · diunduh ${new Date().toLocaleString('id-ID')}`,
        columns: [
          { header: 'Foto', foto: true },
          { header: 'Nama Barang', width: 28 },
          { header: 'Kategori', width: 18 },
          { header: 'Jumlah', numeric: true, width: 10 },
          { header: 'Ukuran', width: 16 },
          { header: 'Kondisi', width: 22 },
          { header: 'Outlet', width: 20 },
          { header: 'Catatan', width: 30 }
        ],
        rows: rows.map((a) => [
          a.photo_path ? fotoSel.get(a.id) ?? 'GAGAL' : null,
          a.name,
          a.category ?? '-',
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
